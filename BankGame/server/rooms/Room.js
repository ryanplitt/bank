/**
 * Room.js — the live state of one game room, wrapped around the pure engine.
 *
 * The engine (BankGame/server/game/bank.js) is a set of pure functions that
 * know nothing about sockets or time. A Room owns everything the engine
 * deliberately does not: the roster (id → name + connection presence), the
 * durable host identity, and the auto-roll clock.
 *
 * Every mutating action funnels through here, so the phase/host/presence
 * guards live in one obvious place, and the room emits a single versioned
 * state snapshot plus an append-only narration feed after each change.
 *
 * A Room is not attached to Socket.IO directly. Handlers pass in a broadcast
 * function (`emit(event, payload)`) that delivers to the room's sockets, which
 * keeps this module fully unit-testable.
 */

import { FEED_KIND, MAX_PLAYERS, S2C } from '@bank/shared';
import {
  addPlayer,
  adjustScore,
  applyRoll,
  bank,
  createGame,
  endGame,
  removePlayer,
  rollDice,
  setRules,
  startGame,
  startNextRound,
  PHASE,
} from '../game/bank.js';
import { defaultRng } from '../utils/rng.js';
import { sanitizeName, validateRules } from '../utils/validate.js';

/** A room with no activity for this long is reaped by the RoomManager. */
export const ROOM_TTL_MS = 30 * 60 * 1000;

/**
 * A room nobody is connected to is reaped this long after the last player
 * dropped. Far shorter than ROOM_TTL_MS: an abandoned room holds a code and a
 * MAX_ROOMS slot, and nothing can happen in it until someone comes back. The
 * slack is what lets a refresh, a reconnect or a phone waking up resume in.
 */
export const EMPTY_ROOM_TTL_MS = 2 * 60 * 1000;

export class Room {
  /**
   * @param {string} code The room code this instance is known by.
   * @param {string} hostPlayerId Who joined first and is therefore host.
   * @param {object} [opts] Mostly for tests.
   * @param {(max:number)=>number} [opts.rng] Randomness source for dice.
   * @param {(event:string,payload:any)=>void} [opts.emit] Room broadcast fn.
   */
  constructor(code, hostPlayerId, opts = {}) {
    this.code = code;
    this.rng = opts.rng || defaultRng;
    this.emitToRoom = opts.emit || (() => {});

    this.state = addPlayer(createGame(), hostPlayerId);
    this.hostId = hostPlayerId;
    /** playerId -> { id, name, connected } — display data absent from the engine. */
    this.players = new Map([
      [hostPlayerId, { id: hostPlayerId, name: null, connected: true }],
    ]);
    /** Roll timer handle, or null. */
    this.rollTimer = null;
    /** Socket ids currently attached (used by the io broadcast wrapper). */
    this.socketIds = new Set();
    /** Epoch-ms deadline of the next auto-roll, or null when idle. */
    this.nextRollAt = null;
    /** Monotonic counter, bumped on every state change. */
    this.version = 0;
    /** Cap on narration history kept for late joiners. */
    this.feed = [];
    /** Host paused the clock (players can still bank; no auto-roll). */
    this.paused = false;
    /** Last activity, used by the TTL sweeper. */
    this.lastActiveAt = Date.now();
    /** When the last connected player dropped, or null while anyone is here. */
    this.emptySince = null;
    /** How long a disconnected host keeps host before it transfers (ms). */
    this.hostGraceMs = opts.hostGraceMs || 15_000;
    /** One-shot timer that transfers the host after a too-long absence. */
    this.hostGraceTimer = null;
  }

  /* ------------------------------------------------------------ *
   * Identity & roster
   * ------------------------------------------------------------ */

  /** True if this player id is on the roster. */
  hasPlayer(playerId) {
    return this.players.has(playerId);
  }

  isHost(playerId) {
    return playerId === this.hostId;
  }

  /** Number of players on the roster. */
  get size() {
    return this.players.size;
  }

  /**
   * Set (or rename) a player's display name. Host may rename anyone; players
   * set their own name on join. Returns the new name or null if invalid/taken.
   */
  enrollName(playerId, rawName) {
    const name = sanitizeName(rawName);
    if (!name) return null;
    const taken = [...this.players.values()].some(
      (p) => p.id !== playerId && p.name === name,
    );
    if (taken) return null;
    const entry = this.players.get(playerId);
    if (entry) entry.name = name;
    return name;
  }

  /** Bind a socket to the room and mark its player connected. */
  attachSocket(playerId) {
    const entry = this.players.get(playerId);
    if (entry) entry.connected = true;
    this.refreshEmptiness();
    this.touch();
  }

  /**
   * Recompute whether this room still has anybody in it.
   *
   * "Abandoned" deliberately means nobody is *connected*, not that the roster
   * is empty: disconnected players are kept on the roster precisely so they can
   * resume with score and host role intact, so an empty roster never happens
   * through the disconnect path. The manager sweeps on this rather than making
   * an abandoned room wait out the full idle TTL.
   */
  refreshEmptiness() {
    const anyConnected = [...this.players.values()].some((p) => p.connected);
    this.emptySince = anyConnected ? null : (this.emptySince ?? Date.now());
  }

  /** A socket left the room's socket group (not necessarily the game). */
  detachSocket() {
    this.touch();
  }

  /* ------------------------------------------------------------ *
   * Lobby flow
   * ------------------------------------------------------------ */

  /** A new player joins the lobby. `playerId` must already be issued by the
   *  session layer; this only wires the roster and the engine. */
  join(playerId, rawName) {
    if (this.state.phase !== PHASE.LOBBY) {
      return { ok: false, reason: 'game already started — wait for the next game' };
    }
    if (this.players.size >= MAX_PLAYERS) {
      return { ok: false, reason: 'room is full' };
    }
    const name = this.enrollName(playerId, rawName);
    if (!name) return { ok: false, reason: 'name is invalid or already taken' };

    if (!this.players.has(playerId)) {
      this.state = addPlayer(this.state, playerId);
      this.players.set(playerId, { id: playerId, name, connected: true });
    } else {
      this.players.get(playerId).name = name;
      this.players.get(playerId).connected = true;
    }
    this.publish();
    this.narrate({ kind: FEED_KIND.PLAYER_JOINED, name });
    return { ok: true, name };
  }

  /** A player's socket reconnected mid-game. Name preserved; host preserved. */
  resume(playerId) {
    if (!this.players.has(playerId)) return { ok: false, reason: 'unknown player' };
    this.players.get(playerId).connected = true;
    if (playerId === this.hostId) this.disarmHostGrace();
    this.rescheduleClock();
    this.publish();
    return { ok: true };
  }

  /**
   * Mark a player as disconnected. They stay on the roster with score and host
   * intact so they can rejoin. Returns whether the room is now empty.
   */
  markDisconnected(playerId) {
    const entry = this.players.get(playerId);
    if (entry) {
      entry.connected = false;
      this.publish();
      this.narrate({ kind: FEED_KIND.PLAYER_LEFT, name: entry.name });
      // A disconnecting host keeps the role for a short grace period so a
      // quick refresh (reconnect) restores them as host; if they stay gone,
      // the role transfers to the next player so the table can continue.
      if (playerId === this.hostId) this.armHostGrace();
    }
    this.refreshEmptiness();
    this.touch();
    return this.players.size === 0;
  }

  /** Host removes a player from the roster entirely. */
  kick(playerId) {
    if (!this.players.has(playerId)) return { ok: false, reason: 'unknown player' };
    const name = this.players.get(playerId).name;
    this.state = removePlayer(this.state, playerId);
    this.players.delete(playerId);
    this.refreshEmptiness();
    this.publish();
    this.narrate({ kind: FEED_KIND.PLAYER_KICKED, name });
    this.reelectHostIfNeeded();
    return { ok: true, name };
  }

  /**
   * If the current host has left the roster entirely (e.g. kicked), promote
   * the eldest remaining player. Returns whether a transfer happened.
   */
  reelectHostIfNeeded() {
    if (this.players.has(this.hostId) || this.players.size === 0) return false;
    const next = this.oldestRemaining();
    this.hostId = next.id;
    const name = this.players.get(next.id).name;
    this.publish();
    this.narrate({ kind: FEED_KIND.HOST_CHANGED, playerId: this.hostId, name });
    return true;
  }

  /**
   * Promote the next connected player to host, replacing the current (absent)
   * host who may still be on the roster. Used by the host-grace timer.
   */
  transferHostOnAbsence() {
    const next = [...this.players.values()].find(
      (p) => p.connected && p.id !== this.hostId,
    );
    if (!next) return false;
    this.hostId = next.id;
    this.publish();
    this.narrate({ kind: FEED_KIND.HOST_CHANGED, playerId: this.hostId, name: next.name });
    return true;
  }

  /** Eldest remaining player (join order), or null. */
  oldestRemaining() {
    for (const entry of this.players.values()) return entry;
    return null;
  }

  /** Explicit host transfer to another player. */
  transferHost(playerId) {
    const entry = this.players.get(playerId);
    if (!entry || playerId === this.hostId) return { ok: false, reason: 'bad target' };
    this.hostId = playerId;
    this.publish();
    this.narrate({ kind: FEED_KIND.HOST_CHANGED, playerId, name: entry.name });
    return { ok: true };
  }

  /** True when the game can start from the lobby. */
  canStart() {
    return (
      this.state.phase === PHASE.LOBBY &&
      this.players.size >= 2 &&
      this.players.size <= MAX_PLAYERS &&
      Boolean(this.players?.get(this.hostId)?.connected)
    );
  }

  /* ------------------------------------------------------------ *
   * Host commands
   * ------------------------------------------------------------ */

  applyRules(raw) {
    const check = validateRules(raw);
    if (!check.valid) return { ok: false, reason: check.reason };
    if (this.state.phase !== PHASE.LOBBY) return { ok: false, reason: 'game already started' };
    this.state = setRules(this.state, check.rules);
    this.publish();
    this.narrate({ kind: FEED_KIND.RULES_CHANGED, rules: this.state.rules });
    this.touch();
    return { ok: true };
  }

  adjustPlayerScore(playerId, delta) {
    if (!this.players.has(playerId)) return { ok: false, reason: 'unknown player' };
    const before = this.state.players.find((p) => p.id === playerId)?.score || 0;
    const next = adjustScore(this.state, playerId, delta);
    if (next === this.state) return { ok: false, reason: 'invalid adjustment' };
    this.state = next;
    this.publish();
    this.narrate({
      kind: FEED_KIND.SCORE_ADJUSTED,
      playerId,
      delta: next.players.find((p) => p.id === playerId)?.score - before,
      total: next.players.find((p) => p.id === playerId)?.score,
    });
    this.touch();
    return { ok: true };
  }

  renamePlayer(playerId, rawName) {
    const target = this.players.get(playerId);
    if (!target) return { ok: false, reason: 'unknown player' };
    const name = this.enrollName(playerId, rawName);
    if (!name) return { ok: false, reason: 'name is invalid or already taken' };
    this.publish();
    this.narrate({ kind: FEED_KIND.PLAYER_RENAMED, playerId, name });
    this.touch();
    return { ok: true };
  }

  /* ------------------------------------------------------------ *
   * Game flow
   * ------------------------------------------------------------ */

  start() {
    if (this.state.phase !== PHASE.LOBBY) return { ok: false, reason: 'game already started' };
    if (this.players.size < 2) return { ok: false, reason: 'need at least 2 players' };
    const result = startGame(this.state);
    this.state = result.state;
    this.publish();
    for (const e of result.events) this.narrate(e);
    this.scheduleNextRoll();
    this.touch();
    return { ok: true };
  }

  /** Roll the dice now — from the auto-timer or a host force-roll. */
  doRoll() {
    if (this.state.phase !== PHASE.PLAYING) return { ok: false, reason: 'not in a live round' };
    this.clearRollTimer();
    const result = applyRoll(this.state, rollDice(this.rng));
    this.state = result.state;
    this.publish();
    for (const e of result.events) this.narrate(e);
    if (this.state.phase === PHASE.PLAYING) {
      this.scheduleNextRoll();
    }
    this.touch();
    return { ok: true, result };
  }

  /** A player banks out of the current round, taking the whole pot. */
  bankPlayer(playerId) {
    if (this.state.phase !== PHASE.PLAYING) return { ok: false, reason: 'not in a live round' };
    const entry = this.state.players.find((p) => p.id === playerId);
    if (!entry) return { ok: false, reason: 'not a player' };
    if (!entry.inRound) return { ok: false, reason: 'already out of this round' };
    if (this.state.pot <= 0) return { ok: false, reason: 'nothing in the pot' };
    const result = bank(this.state, playerId);
    this.state = result.state;
    this.publish();
    for (const e of result.events) this.narrate(e);
    if (this.state.phase === PHASE.PLAYING) {
      // By default banking does not reset the shared countdown — everyone races
      // the same deadline. Only when the host enables resetTimerOnBank do we
      // schedule a fresh window for the remaining players.
      if (this.state.rules.resetTimerOnBank) this.scheduleNextRoll();
    } else {
      this.clearRollTimer();
    }
    this.touch();
    return { ok: true, result };
  }

  /** Move from a finished round to the next, or on to the game result. */
  startRound() {
    if (this.state.phase !== PHASE.ROUND_OVER) {
      return { ok: false, reason: 'round is still live' };
    }
    const result = startNextRound(this.state);
    this.state = result.state;
    this.publish();
    for (const e of result.events) this.narrate(e);
    if (this.state.phase === PHASE.PLAYING) {
      this.scheduleNextRoll();
    } else {
      this.clearRollTimer();
    }
    this.touch();
    return { ok: true, result };
  }

  /** Host ends the game early, wherever it is. */
  endNow() {
    const result = endGame(this.state);
    this.state = result.state;
    this.clearRollTimer();
    this.publish();
    for (const e of result.events) this.narrate(e);
    this.touch();
    return { ok: true, result };
  }

  /** Reset to a fresh lobby so this room code can be played again. */
  playAgain() {
    const keep = [...this.players.values()].map((p) => ({ id: p.id, name: p.name }));
    this.state = createGame();
    for (const k of keep) this.state = addPlayer(this.state, k.id);
    this.hostId = this.oldestRemaining().id;
    this.clearRollTimer();
    this.paused = false;
    this.publish();
    this.touch();
    return { ok: true };
  }

  /** Pause or resume the auto-roll clock. */
  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) {
      this.clearRollTimer();
    } else if (this.state.phase === PHASE.PLAYING) {
      this.scheduleNextRoll();
    }
    this.publish();
    this.narrate({ kind: this.paused ? FEED_KIND.PAUSED : FEED_KIND.RESUMED });
    this.touch();
    return { ok: true };
  }

  /* ------------------------------------------------------------ *
   * Clock
   * ------------------------------------------------------------ */

  scheduleNextRoll() {
    this.clearRollTimer();
    if (this.state.phase !== PHASE.PLAYING || this.paused) return;
    const intervalMs = this.state.rules.rollIntervalSeconds * 1000;
    this.nextRollAt = Date.now() + intervalMs;
    this.rollTimer = setTimeout(() => {
      this.rollTimer = null;
      this.nextRollAt = null;
      if (this.state.phase === PHASE.PLAYING && !this.paused) this.doRoll();
    }, intervalMs);
    // Don't keep the process alive just because a game is mid-round.
    if (this.rollTimer.unref) this.rollTimer.unref();
    this.publish();
  }

  clearRollTimer() {
    if (this.rollTimer) {
      clearTimeout(this.rollTimer);
      this.rollTimer = null;
    }
    this.nextRollAt = null;
  }

  /** A reconnect or resume gets a fresh full window to react. */
  rescheduleClock() {
    if (!this.paused) this.scheduleNextRoll();
  }

  /** All done: stop the clock and silence broadcasts. */
  destroy() {
    this.clearRollTimer();
    this.disarmHostGrace();
    this.emitToRoom = () => {};
  }

  /** Start the countdown that transfers host to the next player if unclaimed. */
  armHostGrace() {
    this.disarmHostGrace();
    if (this.players.size < 2) return; // nobody to promote to
    this.hostGraceTimer = setTimeout(() => {
      this.hostGraceTimer = null;
      // Only transfer if the host is still gone.
      if (!(this.players.get(this.hostId)?.connected)) this.transferHostOnAbsence();
    }, this.hostGraceMs);
    if (this.hostGraceTimer.unref) this.hostGraceTimer.unref();
  }

  disarmHostGrace() {
    if (this.hostGraceTimer) {
      clearTimeout(this.hostGraceTimer);
      this.hostGraceTimer = null;
    }
  }

  touch() {
    this.lastActiveAt = Date.now();
  }

  /* ------------------------------------------------------------ *
   * Broadcasting
   * ------------------------------------------------------------ */

  /** The full public state a client replaces its view with on `state`. */
  publicState() {
    const byId = new Map(this.state.players.map((p) => [p.id, p]));
    const players = [...this.players.values()].map((r) => {
      const engine = byId.get(r.id) || {};
      return {
        id: r.id,
        name: r.name,
        connected: Boolean(r.connected),
        host: r.id === this.hostId,
        score: engine.score ?? 0,
        inRound: Boolean(engine.inRound),
        bankedThisRound: engine.bankedThisRound ?? null,
      };
    });
    return {
      version: this.version,
      code: this.code,
      hostId: this.hostId,
      phase: this.state.phase,
      round: this.state.round,
      rollNumber: this.state.rollNumber,
      rules: this.state.rules,
      pot: this.state.pot,
      lastRoll: this.state.lastRoll,
      lastRoundResult: this.state.lastRoundResult,
      winnerIds: this.state.winnerIds,
      players,
      nextRollAt: this.nextRollAt,
      paused: this.paused,
      canStart: this.canStart(),
      canStartRound: this.state.phase === PHASE.ROUND_OVER,
    };
  }

  /** Bump the version and broadcast a fresh snapshot to the room. */
  publish() {
    this.version += 1;
    this.emitToRoom(S2C.STATE, this.publicState());
  }

  /** Emit one narration line to the room and keep it for late joiners. */
  narrate(item) {
    const entry = { ...item, at: Date.now() };
    this.feed.push(entry);
    if (this.feed.length > 120) this.feed.splice(0, this.feed.length - 120);
    this.emitToRoom(S2C.FEED, entry);
  }
}
