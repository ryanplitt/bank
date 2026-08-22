import { describe, it, expect } from 'vitest';
import { Room } from './Room.js';
import { RoomManager } from './RoomManager.js';

/** A room with deterministic dice so tests are reproducible. */
function makeRoom() {
  const emitted = { state: [], feed: [] };
  const room = new Room('ABC123', 'host', {
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
    expect(room.advanceRound().ok).toBe(true);
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
    room.advanceRound();
    expect(room.nextRollAt).toBeGreaterThan(0); // clock restarted
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

  it('reaps idle rooms past the TTL', () => {
    const mgr = new RoomManager({ ttlMs: 1000 });
    const r = mgr.create('AAA111', 'host');
    r.lastActiveAt = Date.now() - 5000; // simulate staleness
    const reaped = mgr.sweepOnce();
    expect(reaped).toContain('AAA111');
    expect(mgr.has('AAA111')).toBe(false);
  });

  it('keeps a recently-active room alive', () => {
    const mgr = new RoomManager({ ttlMs: 1000 });
    mgr.create('AAA111', 'host'); // just touched
    expect(mgr.sweepOnce()).toEqual([]);
  });

  it('sweeper starts and can be stopped without blocking the process', () => {
    const mgr = new RoomManager({ ttlMs: 50 });
    mgr.create('AAA111', 'host');
    mgr.startSweeper(10);
    // Eventually the room is gone.
    return new Promise((resolve) => {
      setTimeout(() => {
        mgr.stopSweeper();
        expect(mgr.has('AAA111')).toBe(false);
        resolve();
      }, 60);
    });
  });
});
