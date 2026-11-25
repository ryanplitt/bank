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

/** Live rooms one network address may have created. A household can run a few
 *  tables; one client cannot fill the server. */
export const MAX_ROOMS_PER_IP = 8;

/** Concurrent sockets per address. Generous: a whole party shares one NAT. */
export const MAX_SOCKETS_PER_IP = 150;

/** Best-effort client address. Fly's edge sets `fly-client-ip` (and overwrites
 *  any client-supplied value); otherwise fall back to the socket peer. */
function clientIp(socket) {
  const fly = socket.handshake?.headers?.['fly-client-ip'];
  return (typeof fly === 'string' && fly) || socket.handshake?.address || 'unknown';
}

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
  const maxRoomsPerIp = deps.maxRoomsPerIp ?? MAX_ROOMS_PER_IP;
  const maxSocketsPerIp = deps.maxSocketsPerIp ?? MAX_SOCKETS_PER_IP;
  /** address -> live socket count (entries are deleted at zero). */
  const socketsByIp = new Map();
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
  function makeRoom(code, hostPlayerId, creatorIp) {
    const room = manager.create(code, hostPlayerId, {
      emit: (event, payload) => io.to(code).emit(event, payload),
      hostGraceMs: deps.hostGraceMs,
      lobbyGhostMs: deps.lobbyGhostMs,
      creatorIp,
    });
    return room;
  }

  /**
   * A room was reaped (or deleted). Anyone still attached — players on a quiet
   * lobby, spectators — would otherwise sit on a frozen board whose every
   * action fails, and keep receiving whatever a reused code broadcasts next.
   * Tell them, and take them out of the channel.
   */
  function closeRoom(room, reason) {
    for (const id of [...room.socketIds]) {
      const s = io.sockets.sockets.get(id);
      if (!s) continue;
      if (s.data.game?.room === room) s.data.game = null;
      s.leave(room.code);
      s.emit(S2C.REMOVED, { code: room.code, reason });
    }
    room.socketIds.clear();
    room.socketByPlayer.clear();
    logger.info({ event: 'room_closed', code: room.code, reason });
  }
  manager.onClose = closeRoom;

  // Cheap connection cap per address, checked before a socket is admitted.
  io.use((socket, next) => {
    if ((socketsByIp.get(clientIp(socket)) || 0) >= maxSocketsPerIp) {
      return next(new Error('too many connections'));
    }
    next();
  });

  io.on('connection', (socket) => {
    const ip = clientIp(socket);
    socket.data.ip = ip;
    socketsByIp.set(ip, (socketsByIp.get(ip) || 0) + 1);

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
    socket.on(C2S.WATCH_GAME, wrap((p) => onWatch(socket, p)));
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

    socket.on('disconnect', () => {
      const n = (socketsByIp.get(ip) || 1) - 1;
      if (n <= 0) socketsByIp.delete(ip);
      else socketsByIp.set(ip, n);
      try {
        onDisconnect(socket);
      } catch (err) {
        logError(socket, err);
      }
    });
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
    const previousId = room.socketByPlayer.get(playerId);
    if (previousId && previousId !== socket.id) {
      const other = io.sockets.sockets.get(previousId);
      if (other) {
        other.leave(code);
        other.data.game = null;
      }
      // Drop its id too: that socket's own disconnect handler bails out once
      // `data.game` is null (deliberately, so it can't mark a present player
      // absent), which would otherwise strand the id here for the room's life.
      room.socketIds.delete(previousId);
    }
    room.socketByPlayer.set(playerId, socket.id);
    room.attachSocket(playerId);
    socket.join(code);
    // Track the socket in the room's membership for io.to broadcasting.
    room.socketIds.add(socket.id);
    socket.data.game = { code, playerId, room };
    return room;
  }

  /**
   * Take this socket out of whatever room it currently occupies. Every path
   * that ends or replaces a seat goes through here, so a counter or presence
   * flag can never be left behind (a leaked spectator, or a host who still
   * looks connected and keeps an abandoned room alive).
   *
   * @param {{ explicitLeave?: boolean }} [opts] A deliberate leave from the
   *   lobby removes the seat outright instead of leaving a ghost to time out.
   */
  function detach(socket, { explicitLeave = false } = {}) {
    const ctx = socket.data.game;
    if (!ctx) return;
    const { code, room } = ctx;
    room.socketIds.delete(socket.id);
    socket.leave(code);
    socket.data.game = null;
    if (ctx.spectating) {
      room.removeSpectator();
      return;
    }
    if (room.socketByPlayer.get(ctx.playerId) === socket.id) {
      room.socketByPlayer.delete(ctx.playerId);
    }
    if (explicitLeave && room.state.phase === 'lobby') {
      room.removeFromLobby(ctx.playerId);
      // Nobody left at the table: close it now rather than waiting out the sweep.
      if (room.size === 0) manager.delete(code);
    } else {
      room.markDisconnected(ctx.playerId);
    }
  }

  /** A seated player holds exactly one seat per socket; leave before another. */
  function refuseIfSeated(socket) {
    if (!socket.data.game?.playerId) return false;
    sendError(socket, ERROR_CODES.ALREADY_IN_GAME, 'you are already in a game');
    return true;
  }

  function onDisconnect(socket) {
    const ctx = socket.data.game;
    if (!ctx) return;
    logger.info({ event: 'socket_disconnected', code: ctx.code, playerId: ctx.playerId });
    // Deliberately not dropped from the roster here: it outlives a disconnect so
    // a refresh can resume with score and host intact (in the lobby a short
    // grace timer reclaims the seat). The manager's sweeper reclaims the room
    // once nobody has been connected for EMPTY_ROOM_TTL_MS.
    detach(socket);
  }

  function onCreate(socket, payload) {
    const rawName = sanitizeName(payload?.name);
    if (!rawName) return sendError(socket, ERROR_CODES.INVALID_NAME, 'enter a name');
    if (refuseIfSeated(socket)) return;
    if (manager.size >= MAX_ROOMS) {
      return sendError(socket, ERROR_CODES.SERVER_BUSY, 'too many rooms right now');
    }
    const ip = socket.data.ip;
    let mine = 0;
    for (const r of manager.rooms.values()) if (r.creatorIp === ip) mine += 1;
    if (mine >= maxRoomsPerIp) {
      return sendError(socket, ERROR_CODES.SERVER_BUSY, 'you already have several games running');
    }

    const playerId = issuePlayerId();
    let code = '';
    do {
      code = generateGameCode(GAME_CODE_LENGTH);
    } while (manager.has(code));

    const room = makeRoom(code, playerId, ip);
    const joined = room.join(playerId, rawName);
    if (!joined.ok) {
      manager.delete(code);
      return sendError(socket, ERROR_CODES.INTERNAL, joined.reason);
    }

    const session = createSession(playerId);
    detach(socket); // a watcher becoming a host gives up its watching seat
    admit(socket, code, playerId);
    socket.emit(S2C.SESSION, { key: 'create', ...session, code });
    socket.emit(S2C.STATE, room.publicState());
    for (const f of room.feed) socket.emit(S2C.FEED, f);
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
    if (refuseIfSeated(socket)) return;

    const playerId = issuePlayerId();
    const joined = room.join(playerId, name);
    if (!joined.ok) return sendError(socket, ERROR_CODES.GAME_FULL, joined.reason);

    const session = createSession(playerId);
    detach(socket); // a watcher taking a seat gives up its watching seat
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

    const ctx = socket.data.game;
    if (ctx?.playerId) {
      // Already seated here as this very player (a duplicate resume): nothing
      // to rebind — just resend what a fresh arrival would get.
      if (ctx.playerId !== playerId || ctx.code !== code) return refuseIfSeated(socket);
      socket.emit(S2C.SESSION, { key: 'resume', playerId, token, code });
      socket.emit(S2C.STATE, room.publicState());
      for (const f of room.feed) socket.emit(S2C.FEED, f);
      return;
    }

    const resumed = room.resume(playerId);
    if (!resumed.ok) return sendError(socket, ERROR_CODES.NOT_IN_GAME, resumed.reason);

    detach(socket); // a watcher resuming a seat gives up its watching seat
    admit(socket, code, playerId);
    socket.emit(S2C.SESSION, { key: 'resume', playerId, token, code });
    socket.emit(S2C.STATE, room.publicState());
    for (const f of room.feed) socket.emit(S2C.FEED, f);
    logger.info({ event: 'player_resumed', code, playerId });
  }

  function onLeave(socket) {
    detach(socket, { explicitLeave: true });
  }

  /* ------------------------------------------------------------------ *
   * Spectators
   * ------------------------------------------------------------------ */

  /** How much of the narration feed a freshly-arriving watcher catches up on. */
  const SPECTATOR_FEED_REPLAY = 40;

  /** Hand a watcher the current snapshot plus recent history. */
  function resendWatch(socket, room) {
    socket.emit(S2C.STATE, room.publicState());
    for (const f of [...room.feed].slice(-SPECTATOR_FEED_REPLAY)) {
      socket.emit(S2C.FEED, f);
    }
  }

  /** Attach as a read-only watcher: the code, a seat in the broadcast channel,
   *  and a distinct `spectating` ctx — no player id, so bank/host logic below
   *  has nothing to authorize against. No session is issued for watchers. */
  function onWatch(socket, payload) {
    const code = normalizeCode(payload?.code);
    if (!code) return sendError(socket, ERROR_CODES.INVALID_CODE, 'enter that code');
    const room = manager.get(code);
    if (!room) return sendError(socket, ERROR_CODES.NO_SUCH_GAME, 'no game with that code');

    // A seated player watching their own game would orphan their roster entry
    // (their presence would never be cleared), so refuse a role switch.
    if (socket.data.game?.playerId) {
      return sendError(socket, ERROR_CODES.NOT_IN_GAME, 'you are already seated in a game');
    }
    // Re-watch (e.g. a refresh in flight): no double-count, just refresh the
    // snapshot and feed.
    if (socket.data.game?.spectating && socket.data.game.code === code) {
      return resendWatch(socket, room);
    }

    // Seat first, then release any previous watch: if this room is full the
    // watcher keeps the one they had.
    const joined = room.addSpectator();
    if (!joined.ok) {
      return sendError(socket, ERROR_CODES.SERVER_BUSY, 'that game has too many watchers');
    }
    detach(socket);
    socket.join(code);
    room.socketIds.add(socket.id);
    socket.data.game = { code, spectating: true, room };
    resendWatch(socket, room);
    logger.info({ event: 'spectator_joined', code });
  }

  /* ------------------------------------------------------------------ *
   * Play
   * ------------------------------------------------------------------ */

  function onBank(socket) {
    const ctx = socket.data.game;
    if (!ctx) return sendError(socket, ERROR_CODES.NOT_IN_GAME, 'you are not in a game');
    // Watchers carry a spectating ctx with no player id: they ride the
    // broadcast but may never play, whatever their (muted) button says.
    if (ctx.spectating) {
      return sendError(socket, ERROR_CODES.NOT_IN_GAME, 'spectators cannot bank');
    }
    const room = manager.get(ctx.code);
    if (!room || room !== ctx.room) {
      return sendError(socket, ERROR_CODES.NO_SUCH_GAME, 'room no longer exists');
    }
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
    if (!room || room !== ctx.room) {
      return sendError(socket, ERROR_CODES.NO_SUCH_GAME, 'room no longer exists');
    }
    if (ctx.spectating || !room.isHost(ctx.playerId)) {
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
  function onKick(socket, room, p) {
    const target = String(p?.playerId || '');
    if (!target) return { ok: false, reason: 'need a player id' };
    if (target === socket.data.game?.playerId) {
      return { ok: false, reason: 'you cannot kick yourself' };
    }
    const result = room.kick(target);
    if (result.ok) {
      // Tell the removed client's socket it is no longer welcome so it stops
      // showing a stale in-game view, and detach it from the room channel.
      // `kick` already forgot the player's socket mapping, so find it by the
      // ctx the socket is carrying.
      for (const id of [...room.socketIds]) {
        const s = io.sockets.sockets.get(id);
        if (s?.data?.game?.playerId !== target) continue;
        s.leave(room.code);
        s.data.game = null;
        room.socketIds.delete(id);
        s.emit(S2C.REMOVED, { code: room.code, reason: 'kicked' });
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
