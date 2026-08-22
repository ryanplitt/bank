/**
 * socket/handlers.js — the thin translation layer between socket.io events and
 * the Room / RoomManager / session layers.
 *
 * Everything here is "validate → authorize → delegate to the room → let the
 * room broadcast". The room owns the engine state and its own clock; handlers
 * never mutate game state directly. Authentication is session-token based
 * (never a socket id), and every host command re-checks that the requester is
 * the host of the room they are talking about.
 *
 * Error handling is deliberate: a throwing handler must never kill the process
 * or wedge the socket. Every handler is wrapped so a bad payload becomes a
 * normal error event, not an uncaught exception.
 */

import {
  C2S,
  ERROR_CODES,
  GAME_CODE_LENGTH,
  S2C,
} from '@bank/shared';
import { generateGameCode } from '../utils/generateGameCode.js';
import { normalizeCode, sanitizeName } from '../utils/validate.js';
import { createSession, issuePlayerId, verifySession } from '../utils/session.js';
import { RoomManager } from '../rooms/RoomManager.js';
import { logger } from '../utils/log.js';

/** Cap on concurrent rooms, a cheap guard against abuse. */
export const MAX_ROOMS = 200;

/** A tiny per-socket token bucket to stop an event flood. */
export class TokenBucket {
  constructor(tokens = 120, refillPerSec = 40) {
    this.capacity = tokens;
    this.tokens = tokens;
    this.last = Date.now();
    this.rate = refillPerSec / 1000;
  }

  take() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Attach every socket handler to the given io instance.
 *
 * @param {import('socket.io').Server} io
 * @param {object} deps
 * @param {RoomManager} [deps.manager]
 * @param {WeakMap<object, TokenBucket>} [deps.buckets]
 */
export function registerHandlers(io, deps = {}) {
  const manager = deps.manager || new RoomManager();
  const buckets = deps.buckets || new WeakMap();
  let sweeperStarted = false;

  function bucketFor(socket) {
    let b = buckets.get(socket);
    if (!b) {
      b = new TokenBucket();
      buckets.set(socket, b);
    }
    return b;
  }

  if (!sweeperStarted) {
    sweeperStarted = true;
    manager.startSweeper();
  }

  /** Create a room whose broadcast targets this io server's room by code. */
  function makeRoom(code, hostPlayerId) {
    const room = manager.create(code, hostPlayerId, {
      emit: (event, payload) => io.to(code).emit(event, payload),
      hostGraceMs: deps.hostGraceMs,
    });
    return room;
  }

  io.on('connection', (socket) => {
    const wrap = (fn) => (payload) => {
      if (!bucketFor(socket).take()) {
        logger.info({ event: 'rate_limited', code: socket.data?.game?.code });
        return sendError(socket, ERROR_CODES.RATE_LIMITED, 'slow down');
      }
      try {
        fn(payload);
      } catch (err) {
        logError(socket, err);
        sendError(socket, ERROR_CODES.INTERNAL, 'something went wrong on the server');
      }
    };

    socket.on(C2S.CREATE_GAME, wrap((p) => onCreate(socket, p)));
    socket.on(C2S.JOIN_GAME, wrap((p) => onJoin(socket, p)));
    socket.on(C2S.RESUME, wrap((p) => onResume(socket, p)));
    socket.on(C2S.LEAVE_GAME, wrap(() => onLeave(socket)));
    socket.on(C2S.BANK, wrap(() => onBank(socket)));

    for (const [event, handler] of [
      [C2S.START_GAME, onStart],
      [C2S.UPDATE_RULES, onUpdateRules],
      [C2S.KICK_PLAYER, onKick],
      [C2S.RENAME_PLAYER, onRename],
      [C2S.ADJUST_SCORE, onAdjustScore],
      [C2S.FORCE_ROLL, onForceRoll],
      [C2S.START_ROUND, onStartRound],
      [C2S.TRANSFER_HOST, onTransferHost],
      [C2S.END_GAME, onEndGame],
      [C2S.PLAY_AGAIN, onPlayAgain],
      [C2S.SET_PAUSED, onSetPaused],
    ]) {
      socket.on(event, wrap((p) => hostCommand(socket, handler, p)));
    }

    socket.on('disconnect', () => onDisconnect(socket));
  });

  /* ------------------------------------------------------------------ *
   * Session & presence
   * ------------------------------------------------------------------ */

  function admit(socket, code, playerId) {
    const room = manager.get(code);
    // A player should only ever be attached to one live socket per room. If
    // they already have a socket here (e.g. a refresh raced a slow rejoin),
    // detach the old one so closing it later can't mark the player disconnected
    // or trigger a host-grace transfer while they're actively present.
    for (const other of io.sockets.sockets.values()) {
      if (
        other !== socket &&
        other.data?.game?.playerId === playerId &&
        other.data?.game?.code === code
      ) {
        other.leave(code);
        other.data.game = null;
      }
    }
    room.attachSocket(playerId);
    socket.join(code);
    // Track the socket in the room's membership for io.to broadcasting.
    room.socketIds.add(socket.id);
    socket.data.game = { code, playerId, room };
    return room;
  }

  function onDisconnect(socket) {
    const ctx = socket.data.game;
    if (!ctx) return;
    const code = ctx.code;
    const room = ctx.room;
    room.socketIds.delete(socket.id);
    socket.leave(code);
    room.markDisconnected(ctx.playerId);
    // If the room is now truly empty, drop it from the manager.
    if (room.players.size === 0) manager.delete(code);
    logger.info({ event: 'socket_disconnected', code, playerId: ctx.playerId });
    socket.data.game = null;
  }

  function onCreate(socket, payload) {
    const rawName = sanitizeName(payload?.name);
    if (!rawName) return sendError(socket, ERROR_CODES.INVALID_NAME, 'enter a name');
    if (manager.size >= MAX_ROOMS) {
      return sendError(socket, ERROR_CODES.SERVER_BUSY, 'too many rooms right now');
    }

    const playerId = issuePlayerId();
    let code = '';
    do {
      code = generateGameCode(GAME_CODE_LENGTH);
    } while (manager.has(code));

    const room = makeRoom(code, playerId);
    const joined = room.join(playerId, rawName);
    if (!joined.ok) {
      manager.delete(code);
      return sendError(socket, ERROR_CODES.INTERNAL, joined.reason);
    }

    const session = createSession(playerId);
    admit(socket, code, playerId);
    socket.emit(S2C.SESSION, { key: 'create', ...session, code });
    socket.emit(S2C.STATE, room.publicState());
    logger.info({ event: 'room_created', code, host: rawName });
  }

  function onJoin(socket, payload) {
    const name = sanitizeName(payload?.name);
    if (!name) return sendError(socket, ERROR_CODES.INVALID_NAME, 'enter a name');
    const code = normalizeCode(payload?.code);
    if (!code) return sendError(socket, ERROR_CODES.INVALID_CODE, 'enter that code');

    const room = manager.get(code);
    if (!room) return sendError(socket, ERROR_CODES.NO_SUCH_GAME, 'no game with that code');

    // A returning player who still has a valid session resumes as them rather
    // than creating a duplicate roster entry.
    if (payload?.token && verifySession(payload.playerId, payload.token)) {
      return onResume(socket, { code, playerId: payload.playerId, token: payload.token });
    }

    const playerId = issuePlayerId();
    const joined = room.join(playerId, name);
    if (!joined.ok) return sendError(socket, ERROR_CODES.GAME_FULL, joined.reason);

    const session = createSession(playerId);
    admit(socket, code, playerId);
    socket.emit(S2C.SESSION, { key: 'join', ...session, code });
    socket.emit(S2C.STATE, room.publicState());
    for (const f of room.feed) socket.emit(S2C.FEED, f);
    logger.info({ event: 'player_joined', code, name });
  }

  function onResume(socket, payload) {
    const code = normalizeCode(payload?.code);
    if (!code) return sendError(socket, ERROR_CODES.INVALID_CODE, 'bad code');
    const playerId = payload?.playerId;
    const token = payload?.token;
    if (!verifySession(playerId, token)) {
      return sendError(socket, ERROR_CODES.SESSION_EXPIRED, 'session has expired');
    }
    const room = manager.get(code);
    if (!room) return sendError(socket, ERROR_CODES.NO_SUCH_GAME, 'no game with that code');
    const resumed = room.resume(playerId);
    if (!resumed.ok) return sendError(socket, ERROR_CODES.NOT_IN_GAME, resumed.reason);

    admit(socket, code, playerId);
    socket.emit(S2C.SESSION, { key: 'resume', playerId, token, code });
    socket.emit(S2C.STATE, room.publicState());
    for (const f of room.feed) socket.emit(S2C.FEED, f);
    logger.info({ event: 'player_resumed', code, playerId });
  }

  function onLeave(socket) {
    const ctx = socket.data.game;
    if (!ctx) return;
    ctx.room.socketIds.delete(socket.id);
    socket.leave(ctx.code);
    // Marking the player disconnected (even though this socket stays open) lets
    // a departing host stop being host after the grace period, and shows them
    // greyed-out to the rest of the table.
    ctx.room.markDisconnected(ctx.playerId);
    socket.data.game = null;
  }

  /* ------------------------------------------------------------------ *
   * Play
   * ------------------------------------------------------------------ */

  function onBank(socket) {
    const ctx = socket.data.game;
    if (!ctx) return sendError(socket, ERROR_CODES.NOT_IN_GAME, 'you are not in a game');
    const room = manager.get(ctx.code);
    if (!room) return sendError(socket, ERROR_CODES.NO_SUCH_GAME, 'room no longer exists');
    const res = room.bankPlayer(ctx.playerId);
    if (!res.ok) {
      const code = res.reason.includes('pot')
        ? ERROR_CODES.NOTHING_TO_BANK
        : res.reason.includes('already') || res.reason.includes('out')
          ? ERROR_CODES.ALREADY_BANKED
          : ERROR_CODES.BAD_PHASE;
      return sendError(socket, code, res.reason);
    }
  }

  /* ------------------------------------------------------------------ *
   * Host commands
   * ------------------------------------------------------------------ */

  function hostCommand(socket, handler, payload) {
    const ctx = socket.data.game;
    if (!ctx) return sendError(socket, ERROR_CODES.NOT_IN_GAME, 'you are not in a game');
    const room = manager.get(ctx.code);
    if (!room) return sendError(socket, ERROR_CODES.NO_SUCH_GAME, 'room no longer exists');
    if (!room.isHost(ctx.playerId)) {
      return sendError(socket, ERROR_CODES.NOT_HOST, 'only the host can do that');
    }
    const result = handler(socket, room, payload);
    if (result && result.ok === false) {
      const code = result.reason?.includes('round') || result.reason?.includes('started')
        ? ERROR_CODES.BAD_PHASE
        : ERROR_CODES.NOT_IN_GAME;
      return sendError(socket, code, result.reason);
    }
  }

  function onStart(_s, room) {
    return room.start();
  }
  function onUpdateRules(_s, room, p) {
    return room.applyRules(p?.rules);
  }
  function onKick(_s, room, p) {
    const target = String(p?.playerId || '');
    if (!target) return { ok: false, reason: 'need a player id' };
    const result = room.kick(target);
    if (result.ok) {
      // Tell the removed client's socket it is no longer welcome so it stops
      // showing a stale in-game view, and detach it from the room channel.
      for (const s of io.sockets.sockets.values()) {
        if (s.data?.game?.playerId === target) {
          s.leave(room.code);
          s.data.game = null;
          s.emit(S2C.REMOVED, { code: room.code });
        }
      }
    }
    return result;
  }
  function onRename(_s, room, p) {
    const target = String(p?.playerId || '');
    if (!target) return { ok: false, reason: 'need a player id' };
    return room.renamePlayer(target, p?.name);
  }
  function onAdjustScore(_s, room, p) {
    const target = String(p?.playerId || '');
    const delta = Number(p?.delta);
    if (!target || !Number.isFinite(delta)) return { ok: false, reason: 'bad request' };
    return room.adjustPlayerScore(target, delta);
  }
  function onForceRoll(_s, room) {
    return room.doRoll();
  }
  function onStartRound(_s, room) {
    return room.startRound();
  }
  function onTransferHost(_s, room, p) {
    const target = String(p?.playerId || '');
    if (!target) return { ok: false, reason: 'need a player id' };
    return room.transferHost(target);
  }
  function onEndGame(_s, room) {
    return room.endNow();
  }
  function onPlayAgain(_s, room) {
    return room.playAgain();
  }
  function onSetPaused(_s, room, p) {
    return room.setPaused(Boolean(p?.paused));
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  function sendError(socket, code, message) {
    socket.emit(S2C.ERROR, { code, message });
  }

  function logError(socket, err) {
    logger.error({
      event: 'handler_error',
      code: socket.data?.game?.code,
      message: err && err.message ? err.message : String(err),
    });
  }
}
