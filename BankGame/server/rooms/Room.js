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

import { FEED_KIND, MAX_PLAYERS, MAX_SPECTATORS, S2C } from '@bank/shared';
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

/**
 * A lobby player whose socket dropped keeps their seat this long (so a refresh
 * or a phone waking up resumes in place), then is removed. Without this a
 * player who closed their tab would hold a slot and their name for the room's
 * whole life.
 */
export const LOBBY_GHOST_MS = 30 * 1000;

/**
 * A returning player gets a fresh full roll window to react, but only once per
 * this period per room. Otherwise anyone holding a token could reconnect in a
 * loop and keep pushing the next auto-roll out forever.
 */
export const RESUME_GRACE_COOLDOWN_MS = 30 * 1000;

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
    /** Read-only watchers on the broadcast, beyond the player cap. A plain
     *  integer by design: no roster entries, no presence, and `emptySince`
     *  deliberately still only counts players. */
    this.spectatorCount = 0;
    /** playerId -> socket id of the one live socket seated as that player. */
    this.socketByPlayer = new Map();
    /** playerId -> timer that drops a disconnected lobby player. */
    this.ghostTimers = new Map();
    this.lobbyGhostMs = opts.lobbyGhostMs ?? LOBBY_GHOST_MS;
    /** When a resume last bought a returning player a fresh roll window. */
    this.lastResumeGraceAt = 0;
    /** Network origin of the creator, for the per-address room cap. */
    this.creatorIp = opts.creatorIp || null;
    /** Set by destroy(): no timer may be (re)armed on a closed room. */
    this.destroyed = false;
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

  /** True while at least one seated player has a live connection. */
  hasConnectedPlayers() {
    for (const p of this.players.values()) if (p.connected) return true;
    return false;
  }

  /* ------------------------------------------------------------ *
   * Spectators (read-only watchers on the broadcast)
   * ------------------------------------------------------------ */

  /**
   * Seat one more watcher on the broadcast channel. Only a count is kept —
   * no roster entry, no engine player, no presence — so a watcher can never
   * affect the game. Returns `{ ok: false }` at MAX_SPECTATORS.
   */
  addSpectator() {
    if (this.spectatorCount >= MAX_SPECTATORS) {
      return { ok: false, reason: 'spectator cap reached' };
    }
    this.spectatorCount += 1;
    this.touch();
    this.publish(); // the "N watching" count is part of the snapshot
    return { ok: true };
  }

  /** Unseat a watcher. Guards at the floor so a stray disconnect can never
   *  drive the count negative. */
  removeSpectator() {
    if (this.spectatorCount <= 0) return { ok: false, reason: 'no spectators' };
    this.spectatorCount -= 1;
    this.touch();
    this.publish();
    return { ok: true };
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
    this.cancelGhost(playerId);
    this.ensureHostPresent();
    this.publish();
    this.narrate({ kind: FEED_KIND.PLAYER_JOINED, name });
    return { ok: true, name };
  }

  /** A player's socket reconnected mid-game. Name preserved; host preserved. */
  resume(playerId) {
    const entry = this.players.get(playerId);
    if (!entry) return { ok: false, reason: 'unknown player' };
    const wasConnected = entry.connected;
    entry.connected = true;
    this.cancelGhost(playerId);
    if (playerId === this.hostId) this.disarmHostGrace();
    // Someone else coming back while the host is still away re-arms the
    // transfer: the original timer may have fired when nobody was connected to
    // receive the role, and nothing else would ever retry it.
    else this.ensureHostPresent();
    // A genuine reconnect earns a fresh window to react — but not a plain
    // repeat RESUME on a live seat, and not more than once per cooldown, or a
    // reconnect loop could hold the next roll off indefinitely.
    const now = Date.now();
    if (!wasConnected && now - this.lastResumeGraceAt >= RESUME_GRACE_COOLDOWN_MS) {
      this.lastResumeGraceAt = now;
      this.rescheduleClock();
    }
    this.publish();
    return { ok: true };
  }

  /**
   * Mark a player as disconnected. They stay on the roster with score and host
   * intact so they can rejoin. Returns whether the room is now empty.
   */
  markDisconnected(playerId) {
    if (this.destroyed) return true;
    const entry = this.players.get(playerId);
    if (entry && entry.connected) {
      entry.connected = false;
      this.publish();
      this.narrate({ kind: FEED_KIND.PLAYER_LEFT, name: entry.name });
      // A disconnecting host keeps the role for a short grace period so a
      // quick refresh (reconnect) restores them as host; if they stay gone,
      // the role transfers to the next player so the table can continue.
      if (playerId === this.hostId) this.armHostGrace();
      // In the lobby a vanished player is dropped after a short grace rather
      // than squatting on a slot (and their name) for the room's lifetime.
      if (this.state.phase === PHASE.LOBBY) this.scheduleGhost(playerId);
    }
    this.refreshEmptiness();
    this.touch();
    return this.players.size === 0;
  }

  /** Drop `playerId` from the lobby if they are still gone after the grace. */
  scheduleGhost(playerId) {
    this.cancelGhost(playerId);
    if (this.destroyed) return;
    const timer = setTimeout(() => {
      this.ghostTimers.delete(playerId);
      const entry = this.players.get(playerId);
      if (this.state.phase === PHASE.LOBBY && entry && !entry.connected) {
        this.removeFromLobby(playerId);
      }
    }, this.lobbyGhostMs);
    if (timer.unref) timer.unref();
    this.ghostTimers.set(playerId, timer);
  }

  cancelGhost(playerId) {
    const timer = this.ghostTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.ghostTimers.delete(playerId);
    }
  }

  /**
   * A player leaves the lobby for good (explicit leave, or a ghost timing out).
   * Only meaningful before the game starts — mid-game the roster is the score
   * sheet, so absent players stay on it.
   */
  removeFromLobby(playerId) {
    if (this.state.phase !== PHASE.LOBBY) return { ok: false, reason: 'game already started' };
    const entry = this.players.get(playerId);
    if (!entry) return { ok: false, reason: 'unknown player' };
    this.cancelGhost(playerId);
    this.state = removePlayer(this.state, playerId);
    this.players.delete(playerId);
    this.socketByPlayer.delete(playerId);
    this.refreshEmptiness();
    this.reelectHostIfNeeded();
    this.publish();
    this.narrate({ kind: FEED_KIND.PLAYER_LEFT, name: entry.name });
    this.touch();
    return { ok: true, name: entry.name };
  }

  /** Host removes a player from the roster entirely. */
  kick(playerId) {
    if (!this.players.has(playerId)) return { ok: false, reason: 'unknown player' };
    const name = this.players.get(playerId).name;
    this.cancelGhost(playerId);
    this.state = removePlayer(this.state, playerId);
    this.players.delete(playerId);
    this.socketByPlayer.delete(playerId);
    this.refreshEmptiness();
    this.publish();
    this.narrate({ kind: FEED_KIND.PLAYER_KICKED, name });
    this.reelectHostIfNeeded();
    return { ok: true, name };
  }

  /**
   * If the current host has left the roster entirely (e.g. kicked), promote
   * the eldest remaining player, preferring one who is actually connected.
   * Returns whether a transfer happened.
   */
  reelectHostIfNeeded() {
    if (this.players.has(this.hostId) || this.players.size === 0) return false;
    const next = this.nextHostCandidate();
    this.hostId = next.id;
    this.publish();
    this.narrate({ kind: FEED_KIND.HOST_CHANGED, playerId: this.hostId, name: next.name });
    this.ensureHostPresent();
    return true;
  }

  /** Eldest connected player, else eldest of anyone; null on an empty roster. */
  nextHostCandidate() {
    let eldest = null;
    for (const entry of this.players.values()) {
      if (entry.connected) return entry;
      eldest ??= entry;
    }
    return eldest;
  }

  /**
   * If the host is away and no transfer is pending, start the grace countdown.
   * Idempotent; called whenever anyone (re)connects or the host changes.
   */
  ensureHostPresent() {
    if (this.destroyed || this.hostGraceTimer) return;
    const host = this.players.get(this.hostId);
    if (host && !host.connected) this.armHostGrace();
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

  /** Whether every seated player currently has a live connection. */
  everyoneConnected() {
    for (const p of this.players.values()) if (!p.connected) return false;
    return true;
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
      Boolean(this.players?.get(this.hostId)?.connected) &&
      // The lobby tells the host "everyone must be connected"; enforce it so a
      // player who has just dropped is not silently dealt into a game.
      this.everyoneConnected()
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
    if (!this.everyoneConnected()) {
      return { ok: false, reason: 'everyone must be connected to start' };
    }
    const result = startGame(this.state);
    this.state = result.state;
    // Arm the clock *before* publishing so one snapshot carries the deadline.
    this.scheduleNextRoll();
    this.publish();
    for (const e of result.events) this.narrate(e);
    this.touch();
    return { ok: true };
  }

  /** Roll the dice now — from the auto-timer or a host force-roll. */
  doRoll() {
    if (this.state.phase !== PHASE.PLAYING) return { ok: false, reason: 'not in a live round' };
    this.clearRollTimer();
    const result = applyRoll(this.state, rollDice(this.rng));
    this.state = result.state;
    if (this.state.phase === PHASE.PLAYING) {
      this.scheduleNextRoll();
    }
    this.publish();
    for (const e of result.events) this.narrate(e);
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
    if (this.state.phase === PHASE.PLAYING) {
      // By default banking does not reset the shared countdown — everyone races
      // the same deadline. Only when the host enables resetTimerOnBank do we
      // schedule a fresh window for the remaining players.
      if (this.state.rules.resetTimerOnBank) this.scheduleNextRoll();
    } else {
      this.clearRollTimer();
    }
    this.publish();
    for (const e of result.events) this.narrate(e);
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
    if (this.state.phase === PHASE.PLAYING) {
      this.scheduleNextRoll();
    } else {
      this.clearRollTimer();
    }
    this.publish();
    for (const e of result.events) this.narrate(e);
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
    // Whoever is hosting stays host. Only fall back to a connected player if
    // the host has somehow left the roster.
    if (!this.players.has(this.hostId)) this.hostId = this.nextHostCandidate().id;
    this.clearRollTimer();
    this.paused = false;
    // Back in the lobby: anyone who is gone starts the ghost countdown, and an
    // absent host starts the transfer countdown.
    for (const p of this.players.values()) if (!p.connected) this.scheduleGhost(p.id);
    this.ensureHostPresent();
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
    // No publish here: every caller publishes right after changing state, so
    // one snapshot carries both the new state and the new deadline.
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
    this.destroyed = true;
    this.clearRollTimer();
    this.disarmHostGrace();
    for (const timer of this.ghostTimers.values()) clearTimeout(timer);
    this.ghostTimers.clear();
    this.emitToRoom = () => {};
  }

  /** Start the countdown that transfers host to the next player if unclaimed. */
  armHostGrace() {
    this.disarmHostGrace();
    if (this.destroyed || this.players.size < 2) return; // nobody to promote to
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
      spectatorCount: this.spectatorCount,
      /** Server clock at send time. `nextRollAt` is an absolute server epoch,
       *  so clients subtract their offset from this to count down correctly
       *  even when their own clock is wrong. */
      serverNow: Date.now(),
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
