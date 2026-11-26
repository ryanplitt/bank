import { describe, it, expect, vi } from 'vitest';
import { MAX_SPECTATORS, SAFE_ROLL_INTERVAL_MS } from '@bank/shared';
import { Room } from './Room.js';
import { RoomManager } from './RoomManager.js';

/** A room with deterministic dice so tests are reproducible. */
/** The original, unrestricted rules: most tests exercise mechanics, not the
 *  shipped defaults (banking locked in the safe rolls, doubles double). */
const CLASSIC = { noBankingDuringSafeRolls: false, doublesDuringSafeRolls: 'sum', rounds: 15 };

function makeRoom({ classic = true } = {}) {
  const emitted = { state: [], feed: [] };
  const room = new Room('ABC123', 'host', {
    rules: classic ? CLASSIC : undefined,
    rng: () => 0, // always rolls [1,1]
    emit: (event, payload) => emitted[event === 'state' ? 'state' : 'feed'].push(payload),
  });
  return { room, emitted };
}

describe('Room roster & lobby', () => {
  it('starts in the lobby with the host seated and connected', () => {
    const { room } = makeRoom();
    expect(room.state.phase).toBe('lobby');
    expect(room.players.get('host')).toMatchObject({ name: null, connected: true });
    expect(room.isHost('host')).toBe(true);
  });

  it('rejects duplicate display names', () => {
    const { room } = makeRoom();
    room.join('p2', 'Alex');
    expect(room.join('p3', 'Alex').ok).toBe(false);
    expect(room.enrollName('p2', 'Alex')).toBe('Alex'); // same owner ok
  });

  it('rejects empty names and truncates over-long ones', () => {
    const { room } = makeRoom();
    expect(room.join('p2', '   ').ok).toBe(false);
    const long = room.join('p2', 'this name is definitely longer than twenty chars');
    expect(long.ok).toBe(true);
    expect(long.name.length).toBeLessThanOrEqual(20);
  });

  it('cannot start with fewer than two players', () => {
    const { room } = makeRoom();
    expect(room.canStart()).toBe(false);
    const started = room.start();
    expect(started.ok).toBe(false);
  });

  it('starts once a second player joins', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    expect(room.canStart()).toBe(true);
    expect(room.start().ok).toBe(true);
    expect(room.state.phase).toBe('playing');
  });

  it('cannot join a game once it has started', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.start();
    expect(room.join('p3', 'Charlie').ok).toBe(false);
    room.state = Object.assign({}, room.state, { phase: 'roundOver' });
    // Ends: even across rounds the door stays shut for new joiners.
  });
});

describe('host identity survives presence changes', () => {
  it('keeps the host when the host disconnects, and reunites on resume', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.markDisconnected('host');
    expect(room.isHost('host')).toBe(true); // host role preserved on the roster
    expect(room.players.get('host').connected).toBe(false);
    expect(room.resume('host').ok).toBe(true);
    expect(room.players.get('host').connected).toBe(true);
    expect(room.isHost('host')).toBe(true);
  });

  it('promotes the eldest remaining player when the host is kicked', () => {
    const { room } = makeRoom();
    const { players } = room;
    room.join('p2', 'Brie');
    room.kick('host');
    expect(room.isHost('p2')).toBe(true);
    expect(players.has('host')).toBe(false);
  });

  it('transfers host explicitly', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    expect(room.transferHost('p2').ok).toBe(true);
    expect(room.isHost('p2')).toBe(true);
  });

  it('keeps a disconnected player in the game (not spliced out)', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.start();
    room.doRoll(); // pot builds
    room.markDisconnected('p2');
    expect(room.players.has('p2')).toBe(true);
    expect(room.state.players.find((p) => p.id === 'p2').score).toBe(0); // score intact
  });
});

describe('game flow', () => {
  it('a disconnected player remains on the roster (not dropped)', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    expect(room.markDisconnected('p2')).toBe(false); // players retained
    expect(room.players.has('p2')).toBe(true);
  });

  it('a fully-empty roster reports empty', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.kick('p2');
    room.kick('host');
    expect(room.players.size).toBe(0);
  });

  it('a bank keeps the pot for everyone and finishes the round on full bank', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.start();
    room.doRoll(); // pot 2 with [1,1]? sum 2 → pot 2
    const afterFirst = room.bankPlayer('host');
    expect(afterFirst.ok).toBe(true);
    expect(room.state.phase).toBe('playing'); // still someone in
    expect(room.bankPlayer('host').ok).toBe(false); // already out
    expect(room.bankPlayer('p2').ok).toBe(true);
    expect(room.state.phase).toBe('roundOver');
  });

  it('moves to the next round and carries scores', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.start();
    room.doRoll();
    room.bankPlayer('host');
    room.bankPlayer('p2');
    const scoreHost = room.state.players.find((p) => p.id === 'host').score;
    expect(room.startRound().ok).toBe(true);
    expect(room.state.round).toBe(2);
    expect(room.state.players.find((p) => p.id === 'host').score).toBe(scoreHost);
    expect(room.state.players.every((p) => p.inRound)).toBe(true);
  });

  it('auto-roll clock stops and starts around a round', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.start();
    expect(room.nextRollAt).toBeGreaterThan(0);
    room.doRoll();
    room.bankPlayer('host');
    room.bankPlayer('p2');
    expect(room.state.phase).toBe('roundOver');
    expect(room.nextRollAt).toBeNull(); // clock stopped
    room.startRound();
    expect(room.nextRollAt).toBeGreaterThan(0); // clock restarted
  });

  it('does not reset the shared countdown when someone banks (default)', () => {
    vi.useFakeTimers();
    try {
      const { room } = makeRoom();
      room.join('p2', 'Brie');
      room.start();
      room.doRoll(); // pot builds, schedules a fresh deadline
      const afterRoll = room.nextRollAt;
      expect(afterRoll).toBeGreaterThan(0);

      // Time passes; the deadline drifts into the past but is NOT being refreshed.
      vi.advanceTimersByTime(1000);

      room.bankPlayer('host'); // still playing (p2 remains)
      expect(room.state.phase).toBe('playing');
      // The deadline is unchanged by the bank: everyone races the same clock.
      expect(room.nextRollAt).toBe(afterRoll);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the shared countdown when resetTimerOnBank is enabled', () => {
    vi.useFakeTimers();
    try {
      const { room } = makeRoom();
      room.join('p2', 'Brie');
      // Enable the host option before starting.
      const rules = { ...room.state.rules, resetTimerOnBank: true };
      room.state = Object.assign({}, room.state, { rules });
      room.start();
      room.doRoll();
      const before = room.nextRollAt;
      expect(before).toBeGreaterThan(0);

      // Time passes, then a bank schedules a brand-new window from now.
      vi.advanceTimersByTime(1000);
      room.bankPlayer('host');
      expect(room.state.phase).toBe('playing');
      expect(room.nextRollAt).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('play again resets scores and returns to the lobby', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.start();
    room.doRoll();
    room.bankPlayer('host');
    room.bankPlayer('p2');
    expect(room.playAgain().ok).toBe(true);
    expect(room.state.phase).toBe('lobby');
    expect(room.state.players.every((p) => p.score === 0)).toBe(true);
  });

  it('host corrections: adjust score, rename, kick', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.adjustPlayerScore('p2', 250);
    expect(room.state.players.find((p) => p.id === 'p2').score).toBe(250);
    expect(room.renamePlayer('p2', 'Brie-2').ok).toBe(true);
    expect(room.players.get('p2').name).toBe('Brie-2');
    expect(room.kick('p2').ok).toBe(true);
    expect(room.hasPlayer('p2')).toBe(false);
  });
});

describe('room emptiness', () => {
  it('marks the room empty only once the last connected player drops', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    expect(room.emptySince).toBeNull();

    room.markDisconnected('p2');
    expect(room.emptySince).toBeNull(); // the host is still here

    room.markDisconnected('host');
    expect(typeof room.emptySince).toBe('number');
  });

  it('clears the empty marker when somebody comes back', () => {
    const { room } = makeRoom();
    room.markDisconnected('host');
    expect(room.emptySince).not.toBeNull();
    room.attachSocket('host');
    expect(room.emptySince).toBeNull();
  });

  it('still keeps the roster so an empty room can be resumed into', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.markDisconnected('host');
    room.markDisconnected('p2');
    expect(room.players.size).toBe(2); // nobody spliced out
    expect(room.emptySince).not.toBeNull();
  });

  it('counts a room empty once everyone has been kicked out of it', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.kick('p2');
    room.kick('host');
    expect(room.players.size).toBe(0);
    expect(room.emptySince).not.toBeNull();
  });
});

describe('spectators', () => {
  it('seats and unseats watchers, keeping the count exact', () => {
    const { room } = makeRoom();
    expect(room.spectatorCount).toBe(0);
    expect(room.addSpectator()).toMatchObject({ ok: true });
    expect(room.spectatorCount).toBe(1);
    expect(room.addSpectator()).toMatchObject({ ok: true });
    expect(room.spectatorCount).toBe(2);
    expect(room.removeSpectator()).toMatchObject({ ok: true });
    expect(room.spectatorCount).toBe(1);
    expect(room.removeSpectator()).toMatchObject({ ok: true });
    expect(room.spectatorCount).toBe(0);
  });

  it('rejects a watch once the cap is reached, and the count never exceeds it', () => {
    const { room } = makeRoom();
    for (let i = 0; i < MAX_SPECTATORS; i += 1) {
      expect(room.addSpectator().ok).toBe(true);
    }
    expect(room.spectatorCount).toBe(MAX_SPECTATORS);
    expect(room.addSpectator().ok).toBe(false);
    expect(room.spectatorCount).toBe(MAX_SPECTATORS); // clamped, not overshot
  });

  it('never lets the count drop below zero', () => {
    const { room } = makeRoom();
    expect(room.removeSpectator().ok).toBe(false);
    expect(room.spectatorCount).toBe(0);
  });

  it('exposes the count in public state but keeps watchers out of the roster', () => {
    const { room } = makeRoom();
    room.addSpectator();
    room.addSpectator();
    const pub = room.publicState();
    expect(pub.spectatorCount).toBe(2);
    expect(pub.players.map((p) => p.id)).toEqual(['host']); // no roster entry
  });

  it('still counts a room empty without its players, even with watchers attached', () => {
    const { room } = makeRoom();
    room.addSpectator();
    room.markDisconnected('host');
    expect(room.emptySince).not.toBeNull(); // spectators are not presence
  });
});

describe('tv displays and safe-roll banking', () => {
  it('reports a TV as present only while one is connected', () => {
    const { room } = makeRoom();
    expect(room.publicState().tvPresent).toBe(false);
    room.addSpectator({ tv: true });
    room.addSpectator(); // an ordinary watcher is not a TV
    expect(room.publicState().tvPresent).toBe(true);
    expect(room.publicState().spectatorCount).toBe(2);
    room.removeSpectator({ tv: true });
    expect(room.publicState().tvPresent).toBe(false);
  });

  it('lets a room start with no host and crowns the first player to join', () => {
    const emitted = [];
    const room = new Room('TV1234', null, { rng: () => 0, emit: (e, p) => emitted.push([e, p]) });
    expect(room.hostId).toBeNull();
    expect(room.publicState().players).toEqual([]);
    expect(room.join('p1', 'Ryan').ok).toBe(true);
    expect(room.isHost('p1')).toBe(true);
    room.join('p2', 'Brie');
    expect(room.isHost('p2')).toBe(false);
    expect(room.canStart()).toBe(true);
  });

  it('gives the host seat to the next joiner if the whole table walked away', () => {
    const room = new Room('TV1234', null, { rng: () => 0 });
    room.join('p1', 'Ryan');
    room.removeFromLobby('p1');
    expect(room.players.size).toBe(0);
    room.join('p2', 'Brie');
    expect(room.isHost('p2')).toBe(true);
  });

  it('blocks banking during the safe rolls when the rule is on', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.state = {
      ...room.state,
      rules: { ...room.state.rules, noBankingDuringSafeRolls: true },
    };
    room.start();
    room.doRoll(); // [1,1] → rollNumber 1, pot 2, still inside safeRolls 3

    const blocked = room.bankPlayer('host');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/safe rolls/);
    expect(room.state.players.find((p) => p.id === 'host').inRound).toBe(true);
    expect(blocked.code).toBe('BANKING_LOCKED');
  });

  it('runs the safe rolls fast, then at the normal pace', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.start();
    expect(room.publicState().rollIntervalMs).toBe(SAFE_ROLL_INTERVAL_MS);
    room.doRoll();
    room.doRoll();
    expect(room.publicState().rollIntervalMs).toBe(SAFE_ROLL_INTERVAL_MS); // roll 3 is still safe
    room.doRoll(); // rollNumber 3: the next roll can bust
    expect(room.publicState().rollIntervalMs).toBe(room.state.rules.rollIntervalSeconds * 1000);
  });

  it('numbers narration lines with an increasing seq', () => {
    const { room, emitted } = makeRoom();
    room.join('p2', 'Brie');
    room.join('p3', 'Cal');
    const seqs = emitted.feed.map((e) => e.seq);
    expect(seqs.length).toBeGreaterThan(1);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });
});

describe('review fixes: host, clock, lobby ghosts', () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  it('re-arms the host transfer when someone returns after the timer fired on an empty table', async () => {
    const room = new Room('ABC123', 'A', { hostGraceMs: 30 });
    room.join('A', 'Ann');
    room.join('B', 'Bob');
    room.markDisconnected('A');
    room.markDisconnected('B');
    await sleep(70); // grace expires with nobody connected to take the role
    expect(room.isHost('A')).toBe(true);
    room.resume('B');
    await sleep(70);
    expect(room.isHost('B')).toBe(true); // used to stay stuck on absent Ann
    room.destroy();
  });

  it('playAgain keeps the current host instead of reverting to the eldest player', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.transferHost('p2');
    room.endNow();
    room.playAgain();
    expect(room.hostId).toBe('p2');
    expect(room.state.phase).toBe('lobby');
  });

  it('playAgain starts the transfer countdown if the host is away', async () => {
    const room = new Room('ABC123', 'A', { hostGraceMs: 30 });
    room.join('A', 'Ann');
    room.join('B', 'Bob');
    room.start();
    room.markDisconnected('A');
    room.endNow();
    room.playAgain();
    await sleep(70);
    expect(room.isHost('B')).toBe(true);
    room.destroy();
  });

  it('a plain resume neither pushes the roll deadline out nor repeats within the cooldown', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.start();
    const first = room.nextRollAt;
    room.resume('p2'); // already connected: no fresh window
    expect(room.nextRollAt).toBe(first);

    room.markDisconnected('p2');
    room.nextRollAt -= 5000; // time passes
    const before = room.nextRollAt;
    room.resume('p2'); // genuine reconnect: one fresh window
    expect(room.nextRollAt).toBeGreaterThan(before);

    room.markDisconnected('p2');
    room.nextRollAt -= 5000;
    const again = room.nextRollAt;
    room.resume('p2'); // a second flap inside the cooldown must not extend it
    expect(room.nextRollAt).toBe(again);
    room.destroy();
  });

  it('publishes exactly one snapshot per roll, carrying the next deadline', () => {
    const { room, emitted } = makeRoom();
    room.join('p2', 'Brie');
    room.start();
    const before = emitted.state.length;
    room.doRoll();
    expect(emitted.state.length - before).toBe(1);
    expect(emitted.state.at(-1).nextRollAt).toBe(room.nextRollAt);
    expect(room.nextRollAt).not.toBeNull();
    room.destroy();
  });

  it('stamps serverNow so clients can correct for a skewed clock', () => {
    const { room } = makeRoom();
    expect(Math.abs(room.publicState().serverNow - Date.now())).toBeLessThan(1000);
  });

  it('drops a lobby player who stays gone, freeing the slot and the name', async () => {
    const room = new Room('ABC123', 'host', { lobbyGhostMs: 30 });
    room.join('host', 'Host');
    room.join('p2', 'Brie');
    room.markDisconnected('p2');
    expect(room.players.has('p2')).toBe(true); // still there for a refresh
    await sleep(70);
    expect(room.players.has('p2')).toBe(false);
    expect(room.join('p3', 'Brie').ok).toBe(true); // the name is free again
    room.destroy();
  });

  it('keeps a lobby player who returns inside the grace', async () => {
    const room = new Room('ABC123', 'host', { lobbyGhostMs: 40 });
    room.join('host', 'Host');
    room.join('p2', 'Brie');
    room.markDisconnected('p2');
    room.resume('p2');
    await sleep(90);
    expect(room.players.has('p2')).toBe(true);
    room.destroy();
  });

  it('never drops a player mid-game: the roster is the score sheet', async () => {
    const room = new Room('ABC123', 'host', { lobbyGhostMs: 20 });
    room.join('host', 'Host');
    room.join('p2', 'Brie');
    room.start();
    room.markDisconnected('p2');
    await sleep(60);
    expect(room.players.has('p2')).toBe(true);
    room.destroy();
  });

  it('removeFromLobby re-elects a connected host and refuses once the game started', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    expect(room.removeFromLobby('host').ok).toBe(true);
    expect(room.hostId).toBe('p2');
    room.join('p3', 'Cy');
    room.start();
    expect(room.removeFromLobby('p3').ok).toBe(false);
    room.destroy();
  });

  it('will not start while a seated player is disconnected', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.markDisconnected('p2');
    expect(room.canStart()).toBe(false);
    expect(room.start().ok).toBe(false);
    room.resume('p2');
    expect(room.canStart()).toBe(true);
    room.destroy();
  });

  it('arms nothing once destroyed', async () => {
    const room = new Room('ABC123', 'A', { hostGraceMs: 20, lobbyGhostMs: 20 });
    room.join('A', 'Ann');
    room.join('B', 'Bob');
    room.destroy();
    room.markDisconnected('A');
    expect(room.hostGraceTimer).toBeNull();
    expect(room.ghostTimers.size).toBe(0);
  });

  it('announces watcher arrivals and departures in the snapshot', () => {
    const { room, emitted } = makeRoom();
    room.addSpectator();
    expect(emitted.state.at(-1).spectatorCount).toBe(1);
    room.removeSpectator();
    expect(emitted.state.at(-1).spectatorCount).toBe(0);
  });

  it('clamps host score corrections so a score can never become Infinity', () => {
    const { room } = makeRoom();
    room.join('p2', 'Brie');
    room.adjustPlayerScore('p2', 1e308);
    room.adjustPlayerScore('p2', 1e308);
    const score = room.publicState().players.find((p) => p.id === 'p2').score;
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeLessThanOrEqual(2_000_000);
  });
});

describe('RoomManager', () => {
  it('creates, looks up, and deletes rooms', () => {
    const mgr = new RoomManager();
    const r = mgr.create('AAA111', 'host');
    expect(mgr.get('AAA111')).toBe(r);
    expect(mgr.has('AAA111')).toBe(true);
    expect(mgr.delete('AAA111')).toBe(true);
    expect(mgr.has('AAA111')).toBe(false);
  });

  it('does not duplicate a room that already exists', () => {
    const mgr = new RoomManager();
    const a = mgr.create('AAA111', 'host');
    const b = mgr.create('AAA111', 'host');
    expect(a).toBe(b);
    expect(mgr.size).toBe(1);
  });

  it('reaps idle rooms past the TTL once nobody is connected', () => {
    const mgr = new RoomManager({ ttlMs: 1000, emptyTtlMs: 60_000 });
    const r = mgr.create('AAA111', 'host');
    r.markDisconnected('host'); // still inside the abandoned grace
    r.lastActiveAt = Date.now() - 5000; // simulate staleness
    const reaped = mgr.sweepOnce();
    expect(reaped).toContain('AAA111');
    expect(mgr.has('AAA111')).toBe(false);
  });

  it('never reaps a stale room that somebody is still connected to', () => {
    // A lobby of people waiting on a late friend sends no events for a long
    // while but is very much alive.
    const mgr = new RoomManager({ ttlMs: 1000 });
    const r = mgr.create('AAA111', 'host');
    r.lastActiveAt = Date.now() - 5000;
    expect(mgr.sweepOnce()).toEqual([]);
    expect(mgr.has('AAA111')).toBe(true);
  });

  it('announces a closed room, with the reason, to the onClose hook', () => {
    const closed = [];
    const mgr = new RoomManager({
      ttlMs: 60_000,
      emptyTtlMs: 1,
      onClose: (room, reason) => closed.push([room.code, reason]),
    });
    const r = mgr.create('AAA111', 'host');
    r.markDisconnected('host');
    r.emptySince = Date.now() - 5000;
    mgr.sweepOnce();
    mgr.create('BBB222', 'host');
    mgr.delete('BBB222');
    expect(closed).toEqual([
      ['AAA111', 'abandoned'],
      ['BBB222', 'closed'],
    ]);
  });

  it('keeps a recently-active room alive', () => {
    const mgr = new RoomManager({ ttlMs: 1000 });
    mgr.create('AAA111', 'host'); // just touched
    expect(mgr.sweepOnce()).toEqual([]);
  });

  it('reaps an abandoned room once nobody has been connected for the grace', () => {
    const mgr = new RoomManager({ ttlMs: 60_000, emptyTtlMs: 1000 });
    const r = mgr.create('AAA111', 'host');
    r.markDisconnected('host'); // everyone has closed their tab
    expect(mgr.sweepOnce()).toEqual([]); // still inside the grace
    r.emptySince = Date.now() - 5000; // simulate the wait
    expect(mgr.sweepOnce()).toContain('AAA111');
    expect(mgr.has('AAA111')).toBe(false);
  });

  it('holds an abandoned room through the grace so a refresh can resume', () => {
    const mgr = new RoomManager({ ttlMs: 60_000, emptyTtlMs: 60_000 });
    const r = mgr.create('AAA111', 'host');
    r.markDisconnected('host');
    r.emptySince = Date.now() - 5000;
    expect(mgr.sweepOnce()).toEqual([]);
    expect(mgr.has('AAA111')).toBe(true);
  });

  it('never reaps a room somebody is still connected to', () => {
    const mgr = new RoomManager({ ttlMs: 60_000, emptyTtlMs: 1 });
    mgr.create('AAA111', 'host'); // host is connected
    expect(mgr.sweepOnce()).toEqual([]);
    expect(mgr.has('AAA111')).toBe(true);
  });

  it('sweeper starts and can be stopped without blocking the process', () => {
    const mgr = new RoomManager({ ttlMs: 50 });
    mgr.create('AAA111', 'host').markDisconnected('host');
    mgr.startSweeper(10);
    // Eventually the room is gone.
    return new Promise((resolve) => {
      setTimeout(() => {
        mgr.stopSweeper();
        expect(mgr.has('AAA111')).toBe(false);
        resolve();
      }, 150);
    });
  });
});
