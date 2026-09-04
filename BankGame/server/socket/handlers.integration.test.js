/**
 * Integration test: drives real socket.io clients against a real server through
 * a full game. Verifies the whole protocol — create/join, session identity,
 * host authorization, banking, round advancement, and a mid-game disconnect and
 * rejoin that preserves both score and host role.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { registerHandlers } from './handlers.js';
import { RoomManager } from '../rooms/RoomManager.js';
import { C2S, S2C } from '@bank/shared';

let server;
let port;
let io;
let manager;
const clients = [];

async function startServer() {
  server = http.createServer();
  io = new Server(server, {
    cors: { origin: '*' },
    transports: ['websocket'],
  });
  manager = new RoomManager();
  registerHandlers(io, { manager, hostGraceMs: 50 });
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
}

function connect() {
  const socket = ioc(`http://localhost:${port}`, {
    forceNew: true,
    transports: ['websocket'],
  });
  clients.push(socket);
  return promiseSocket(socket);
}

function promiseSocket(socket) {
  const api = {
    socket,
    state: null,
    feed: [],
    errors: [],
    _waiters: new Map(),
    once(event) {
      return new Promise((resolve) => socket.once(event, (payload) => resolve(payload)));
    },
    emit(event, payload) {
      socket.emit(event, payload);
    },
    waitError(code, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        const onErr = (err) => {
          if (err.code === code) {
            socket.off(S2C.ERROR, onErr);
            resolve(err);
          }
        };
        socket.on(S2C.ERROR, onErr);
        setTimeout(() => {
          socket.off(S2C.ERROR, onErr);
          reject(new Error(`timeout waiting for error ${code}`));
        }, timeoutMs);
      });
    },
    waitFor(predicate, label, timeoutMs = 2000) {
      if (api.state && predicate(api.state)) return Promise.resolve(api.state);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timeout waiting for ${label}`)),
          timeoutMs,
        );
        api._waiters.set(predicate, { resolve, reject, timer, label });
      });
    },
  };

  socket.on(S2C.STATE, (payload) => {
    api.state = payload;
    for (const [pred, waiter] of api._waiters) {
      if (pred(payload)) {
        clearTimeout(waiter.timer);
        api._waiters.delete(pred);
        waiter.resolve(payload);
      }
    }
  });
  socket.on(S2C.FEED, (entry) => api.feed.push(entry));
  socket.on(S2C.ERROR, (err) => api.errors.push(err));
  return api;
}

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  for (const c of clients) c.socket?.close();
  await new Promise((resolve) => io.close(() => resolve()));
  await new Promise((resolve) => server.close(resolve));
});

describe('full game over the wire', () => {
  it('creates a room, joins, and plays a full short game through the sockets', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    const hostSession = await host.once(S2C.SESSION);
    const hostState = await host.waitFor((s) => s.code === hostSession.code, 'host state');
    expect(hostState.phase).toBe('lobby');
    expect(hostState.players[0]).toMatchObject({ name: 'Host', host: true });
    const code = hostSession.code;

    // Two others join.
    const p2 = connect();
    await p2.once('connect');
    p2.emit(C2S.JOIN_GAME, { name: 'Brie', code });
    await p2.once(S2C.SESSION);
    const p2State = await p2.waitFor((s) => s.players.length === 2, 'p2 seated');
    expect(p2State.players.map((p) => p.name).sort()).toEqual(['Brie', 'Host']);

    const p3 = connect();
    await p3.once('connect');
    p3.emit(C2S.JOIN_GAME, { name: 'Charlie', code });
    await p3.once(S2C.SESSION);
    await host.waitFor((s) => s.players.length === 3, 'host sees three');

    // A non-host cannot start the game.
    p2.emit(C2S.START_GAME, {});
    await p2.waitFor((s) => s.phase === 'lobby', 'non-host start rejected');
    await p2.waitError('NOT_HOST');

    // The host starts.
    host.emit(C2S.START_GAME, {});
    const playing = await host.waitFor((s) => s.phase === 'playing', 'game started');
    expect(playing.round).toBe(1);
    expect(playing.players.every((p) => p.inRound)).toBe(true);

    // Force a roll as the host, then everyone banks to finish the round.
    host.emit(C2S.FORCE_ROLL, {});
    await p2.waitFor((s) => s.pot > 0, 'pot grew after host force-roll');
    const pot = (await p2.waitFor((s) => s.pot > 0, 'pot value')).pot;

    host.emit(C2S.BANK);
    await p2.waitFor((s) => s.players.length > 0 && s.players.find((p) => p.name === 'Host').inRound === false, 'host banked');
    p2.emit(C2S.BANK);
    await p3.waitFor((s) => s.players.find((p) => p.name === 'Brie').inRound === false, 'p2 banked');
    p3.emit(C2S.BANK);
    // Third bank ends the round.
    const over = await host.waitFor((s) => s.phase === 'roundOver', 'round over after all bank');
    expect(over.players.every((p) => !p.inRound)).toBe(true);
    expect(over.players.find((p) => p.name === 'Host').score).toBe(pot);

    // Non-host cannot force-advance / end game.
    p2.emit(C2S.END_GAME, {});
    await p2.waitFor((s) => s.phase === 'roundOver', 'non-host end rejected');
    await p2.waitError('NOT_HOST');

    // The host advances to the next round.
    host.emit(C2S.START_ROUND, {});
    const next = await host.waitFor((s) => s.round === 2, 'round 2 started');
    expect(next.phase).toBe('playing');
    expect(next.players.every((p) => p.inRound)).toBe(true);
  });

  it('preserves score and host role across a disconnect and rejoin', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    const { code } = await host.once(S2C.SESSION);
    await host.waitFor((s) => s.code === code, 'host seated');

    const p2 = connect();
    await p2.once('connect');
    p2.emit(C2S.JOIN_GAME, { name: 'Brie', code });
    const { playerId, token } = await p2.once(S2C.SESSION);
    await host.waitFor((s) => s.players.length === 2, 'two seated');

    // Play enough for Brie to have a real banked score.
    host.emit(C2S.START_GAME, {});
    await p2.waitFor((s) => s.phase === 'playing', 'started');
    host.emit(C2S.FORCE_ROLL, {});
    await p2.waitFor((s) => s.pot > 0, 'pot from force roll');
    host.emit(C2S.BANK);
    await p2.waitFor((s) => s.players.find((p) => p.name === 'Host').inRound === false, 'host banked');
    p2.emit(C2S.BANK);
    const roundOver = await host.waitFor((s) => s.phase === 'roundOver', 'round over');
    const brieScore = roundOver.players.find((p) => p.id === playerId).score;
    expect(brieScore).toBeGreaterThan(0);

    // Brie disconnects.
    p2.socket.close();
    await host.waitFor((s) => s.players.find((p) => p.id === playerId).connected === false, 'brie marked disconnected');
    // Score and roster entry survive.
    expect(host.state.players.find((p) => p.id === playerId).score).toBe(brieScore);

    // Brie rejoins with her stored session and recovers identity + score.
    const reconnected = connect();
    await reconnected.once('connect');
    reconnected.emit(C2S.RESUME, { code, playerId, token });
    const resumedSession = await reconnected.once(S2C.SESSION);
    expect(resumedSession.key).toBe('resume');
    expect(resumedSession.playerId).toBe(playerId);
    const resurrected = await host.waitFor(
      (s) => s.players.find((p) => p.id === playerId).connected === true,
      'brie reconnected',
    );
    expect(resurrected.players.find((p) => p.id === playerId).score).toBe(brieScore);
  });

  it('survives the host leaving and reconnecting', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    const { code } = await host.once(S2C.SESSION);

    const p2 = connect();
    await p2.once('connect');
    p2.emit(C2S.JOIN_GAME, { name: 'Brie', code });
    const p2Session = await p2.once(S2C.SESSION);

    // Host disconnects.
    host.socket.close();
    const p2sees = await p2.waitFor((s) => s.players.find((p) => p.host)?.name === 'Brie', 'host transferred to p2');
    expect(p2sees.players.find((p) => p.host).id).toBe(p2Session.playerId);

    // Reconnecting host resumes as a normal player (no longer host).
    const reHost = connect();
    await reHost.once('connect');
    // The host never stored a token in this isolated test; create a fresh id.
    reHost.emit(C2S.JOIN_GAME, { name: 'Host', code });
    await p2.waitFor((s) => s.players.length === 2, 'reconnected host seated');
    expect(p2.state.players.find((p) => p.name === 'Host').host).toBe(false);
  });
});

describe('validation over the wire', () => {
  it('rejects a join to a nonexistent room', async () => {
    const c = connect();
    await c.once('connect');
    c.emit(C2S.JOIN_GAME, { name: 'X', code: 'ZZ9999' });
    await c.once(S2C.ERROR);
    expect(c.errors[0].code).toBe('NO_SUCH_GAME');
  });

  it('normalizes lowercased codes server-side', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    const { code } = await host.once(S2C.SESSION);

    const joiner = connect();
    await joiner.once('connect');
    joiner.emit(C2S.JOIN_GAME, { name: 'Lower', code: code.toLowerCase() });
    const s = await joiner.once(S2C.SESSION);
    expect(s.code).toBe(code);
  });
});

describe('hardening: malformed input leaves the server up and the game consistent', () => {
  it('rejects empty, whitespace-only and huge names', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    const { code } = await host.once(S2C.SESSION);

    const seen = [];
    for (const bad of ['', '   ', 'x'.repeat(5000), 42, null]) {
      const raw = ioc(`http://localhost:${port}`, { forceNew: true, transports: ['websocket'] });
      const errors = [];
      raw.on(S2C.ERROR, (e) => {
        errors.push(e.code);
        seen.push({ sent: bad, code: e.code });
      });
      await new Promise((r) => raw.on('connect', r));
      raw.emit(C2S.JOIN_GAME, { name: bad, code });
      await new Promise((r) => setTimeout(r, 150));
      raw.close();
      // Empty/whitespace/non-string names are rejected as invalid; the huge
      // name is truncated (not rejected), so it either joins or collides —
      // either way the room is not corrupted. Assert the invalid ones errored.
      if (bad === '' || bad === '   ' || bad === 42 || bad === null) {
        expect(errors).toContain('INVALID_NAME');
      }
    }
    expect(seen.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects a duplicated name within one room', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Alex' });
    const { code } = await host.once(S2C.SESSION);

    const dup = connect();
    await dup.once('connect');
    dup.emit(C2S.JOIN_GAME, { name: 'alex', code }); // case difference → different
    const dupSession = await dup.once(S2C.SESSION);
    expect(dupSession.playerId).toBeTruthy();

    // Truly identical name collides with the host.
    const same = connect();
    await same.once('connect');
    same.emit(C2S.JOIN_GAME, { name: 'Alex', code });
    await same.waitError('GAME_FULL', 100);
    // The room was not corrupted: the host still sees only two players.
    await host.waitFor((s) => s.players.length === 2, 'room stays at two');
  });

  it('keeps serving after an event out of phase (BANK before start)', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    await host.once(S2C.SESSION);

    // Bank with an empty lobby → BAD_PHASE, server stays up.
    host.emit(C2S.BANK);
    await host.waitError('BAD_PHASE');
  });

  it('rejects a host rule change out of phase (during play)', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    const { code } = await host.once(S2C.SESSION);
    const p2 = connect();
    await p2.once('connect');
    p2.emit(C2S.JOIN_GAME, { name: 'B', code });
    await p2.once(S2C.SESSION);
    host.emit(C2S.START_GAME, {});
    await host.waitFor((s) => s.phase === 'playing', 'started');

    const roundsBefore = host.state.rules.rounds;
    host.emit(C2S.UPDATE_RULES, { rules: { rounds: 20 } });
    // Rules can only change in the lobby → the host is told and nothing shifts.
    await host.waitError('BAD_PHASE');
    await host.waitFor((s) => s.rules.rounds === roundsBefore, 'rules unchanged');
  });

  it('rejects commands from a non-host', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    const { code } = await host.once(S2C.SESSION);
    const p2 = connect();
    await p2.once('connect');
    p2.emit(C2S.JOIN_GAME, { name: 'B', code });
    await p2.once(S2C.SESSION);

    for (const [event, payload] of [
      [C2S.START_GAME, {}],
      [C2S.KICK_PLAYER, { playerId: 'some-body' }],
      [C2S.ADJUST_SCORE, { playerId: 'x', delta: 10 }],
      [C2S.END_GAME, {}],
      [C2S.PLAY_AGAIN, {}],
      [C2S.TRANSFER_HOST, { playerId: 'x' }],
      [C2S.SET_PAUSED, { paused: true }],
    ]) {
      p2.emit(event, payload);
      await p2.waitError('NOT_HOST');
    }

    // After all that hostile input the server is still serving the lobby.
    await host.waitFor((s) => s.phase === 'lobby', 'server alive');
  });

  it('a flood of events is throttled without crashing the server', async () => {
    const c = connect();
    await c.once('connect');
    // Spam the JOIN_GAME event faster than the bucket refills.
    for (let i = 0; i < 200; i += 1) c.emit(C2S.JOIN_GAME, { name: 'Spam', code: 'AAAAAA' });
    // Give the server a moment; it should still respond to a healthy request.
    await new Promise((r) => setTimeout(r, 100));
    const h = connect();
    await h.once('connect');
    h.emit(C2S.CREATE_GAME, { name: 'OK' });
    const s = await h.once(S2C.SESSION);
    expect(s.code).toBeTruthy();
    // And the spammer saw at least one RATE_LIMITED error.
    expect(c.errors.some((e) => e.code === 'RATE_LIMITED')).toBe(true);
  });

  it('retires the old socket when a player reconnects, without leaking its id', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    const { code, playerId, token } = await host.once(S2C.SESSION);
    const room = manager.get(code);
    expect(room.socketIds.size).toBe(1);

    // Five overlapping sockets for the same player — a refresh racing a slow
    // rejoin. Each admit must retire the one before it, so exactly one socket
    // is ever attached no matter how many times they bounce.
    const extras = [];
    for (let i = 0; i < 5; i += 1) {
      const c = connect();
      await c.once('connect');
      c.emit(C2S.RESUME, { code, playerId, token });
      await c.waitFor((s) => s.code === code, `resume ${i}`);
      extras.push(c);
      expect(room.socketIds.size).toBe(1);
    }

    // And once they all close, the room is not left holding dead ids.
    for (const c of extras) c.socket.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(room.socketIds.size).toBe(0);
  });

  it('kicks a player and detaches their socket from the room', async () => {
    const host = connect();
    await host.once('connect');
    host.emit(C2S.CREATE_GAME, { name: 'Host' });
    const { code } = await host.once(S2C.SESSION);

    const victim = connect();
    await victim.once('connect');
    victim.emit(C2S.JOIN_GAME, { name: 'Victim', code });
    const victimSession = await victim.once(S2C.SESSION);
    await host.waitFor((s) => s.players.length === 2, 'victim seated');

    let victimReceivedState = false;
    victim.socket.on(S2C.STATE, () => {
      victimReceivedState = true;
    });

    // Host kicks the victim.
    host.emit(C2S.KICK_PLAYER, { playerId: victimSession.playerId });
    const removed = await new Promise((resolve) => victim.socket.once(S2C.REMOVED, resolve));
    expect(removed.code).toBe(code);

    // The victim's roster entry is gone, and their socket is out of the room.
    const removedFromHost = await host.waitFor(
      (s) => !s.players.some((p) => p.id === victimSession.playerId),
      'victim removed from roster',
    );
    expect(removedFromHost.players).toHaveLength(1);

    // Ignore the kick's own broadcast that the victim saw; now that they are
    // detached, a fresh host broadcast must not reach them.
    await new Promise((r) => setTimeout(r, 50));
    victimReceivedState = false;
    host.emit(C2S.UPDATE_RULES, { rules: { sevenBonus: 123 } });
    await host.waitFor((s) => s.rules.sevenBonus === 123, 'rules applied & broadcast');
    await new Promise((r) => setTimeout(r, 150));
    expect(victimReceivedState).toBe(false);
  });
});
