/**
 * RoomManager — code → Room mapping with a TTL sweeper.
 *
 * The original prototype leaked rooms: it inserted into a `games{}` map on
 * create before anyone had joined, and a creator who closed their tab left an
 * immortal entry. Here, rooms are reaped when they sit idle past ROOM_TTL_MS —
 * a sweep happens on a slow interval AND lazily on each access, so a fresh
 * server never accumulates dead rooms even if the interval never fires.
 *
 * A room everyone has *left* is reaped sooner, on EMPTY_ROOM_TTL_MS. Players
 * stay on the roster across a disconnect so they can resume, which means an
 * abandoned room's roster never empties on its own — without this it would sit
 * on a code and a MAX_ROOMS slot for the full half hour with nobody in it.
 */

import { Room, ROOM_TTL_MS, EMPTY_ROOM_TTL_MS } from './Room.js';

export class RoomManager {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || ROOM_TTL_MS;
    /** Grace given to a room nobody is connected to. Never longer than ttlMs. */
    this.emptyTtlMs = options.emptyTtlMs ?? Math.min(this.ttlMs, EMPTY_ROOM_TTL_MS);
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** Total created — used to cap the room count if ever needed. */
    this.createdCount = 0;
    /**
     * Called as `(room, reason)` after a room is closed — reason is 'closed'
     * (explicit delete), 'idle' or 'abandoned' (swept). The socket layer uses
     * it to tell anyone still attached, so a reaped room never leaves clients
     * staring at a dead board.
     */
    this.onClose = options.onClose || null;
  }

  /** Create (or return the existing) room for a code, recording the host. */
  create(code, hostPlayerId, roomOpts = {}) {
    if (this.rooms.has(code)) return this.rooms.get(code);
    const room = new Room(code, hostPlayerId, roomOpts);
    this.rooms.set(code, room);
    this.createdCount += 1;
    return room;
  }

  /** Look up a room by code (no creation), sweeping stale entries on the way. */
  get(code) {
    void this.sweepOnce();
    return this.rooms.get(code) || null;
  }

  has(code) {
    return this.rooms.has(code);
  }

  /** Remove a room and stop its clock. Explicitly or as an idle reap. */
  delete(code) {
    const room = this.rooms.get(code);
    if (!room) return false;
    this.close(code, room, 'closed');
    return true;
  }

  /** Destroy, unregister and announce a room. */
  close(code, room, reason) {
    room.destroy();
    this.rooms.delete(code);
    if (this.onClose) {
      try {
        this.onClose(room, reason);
      } catch {
        // A failing notifier must never stop the sweep.
      }
    }
  }

  /** Total number of live rooms. */
  get size() {
    return this.rooms.size;
  }

  /**
   * Sweep rooms that are idle (> ttlMs since any activity) or abandoned
   * (> emptyTtlMs with nobody connected). Returns the codes reaped.
   *
   * "Idle" only applies to a room nobody is connected to: a lobby full of
   * people waiting for a late friend, or a paused game, sends no events but is
   * very much alive, and reaping it out from under them is a bug, not tidiness.
   */
  sweepOnce() {
    const now = Date.now();
    const reaped = [];
    for (const [code, room] of this.rooms) {
      const idle = now - room.lastActiveAt > this.ttlMs && !room.hasConnectedPlayers();
      const abandoned =
        room.emptySince !== null && now - room.emptySince > this.emptyTtlMs;
      if (idle || abandoned) {
        this.close(code, room, abandoned ? 'abandoned' : 'idle');
        reaped.push(code);
      }
    }
    return reaped;
  }

  /** Start an idle sweep interval (unref'd so it never holds the process). */
  startSweeper(intervalMs = Math.min(this.ttlMs, 60_000)) {
    this.stopSweeper();
    this.sweeper = setInterval(() => {
      this.sweepOnce();
    }, intervalMs);
    if (this.sweeper.unref) this.sweeper.unref();
  }

  stopSweeper() {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }
}
