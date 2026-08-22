import { describe, it, expect } from 'vitest';
import {
  PHASE,
  ROLL_KIND,
  addPlayer,
  adjustScore,
  applyRoll,
  bank,
  canBank,
  createGame,
  endGame,
  removePlayer,
  rollDice,
  setRules,
  standings,
  startGame,
  startNextRound,
} from './bank.js';
import { createSeededRng } from '../utils/rng.js';
import { DEFAULT_RULES } from '@bank/shared';

/** A game already under way with the given players, ready for its first roll. */
function playingGame(playerIds = ['a', 'b'], rules) {
  let state = createGame(rules);
  for (const id of playerIds) state = addPlayer(state, id);
  return startGame(state).state;
}

const roll = (state, dice) => applyRoll(state, dice).state;
const score = (state, id) => state.players.find((p) => p.id === id).score;

describe('createGame', () => {
  it('starts in the lobby with the default rules', () => {
    const state = createGame();
    expect(state.phase).toBe(PHASE.LOBBY);
    expect(state.rules).toEqual(DEFAULT_RULES);
    expect(state.pot).toBe(0);
    expect(state.round).toBe(0);
  });

  it('coerces hostile rule input instead of trusting it', () => {
    const state = createGame({
      rounds: 99999,
      safeRolls: -4,
      rollIntervalSeconds: 'banana',
      doublesDuringSafeRolls: 'evil',
      __proto__: { polluted: true },
    });
    expect(state.rules.rounds).toBe(30); // clamped to the max
    expect(state.rules.safeRolls).toBe(0); // clamped to the min
    expect(state.rules.rollIntervalSeconds).toBe(DEFAULT_RULES.rollIntervalSeconds);
    expect(state.rules.doublesDuringSafeRolls).toBe('sum');
    expect(state.rules.polluted).toBeUndefined();
  });
});

describe('roster', () => {
  it('adds players idempotently', () => {
    let state = addPlayer(addPlayer(createGame(), 'a'), 'a');
    expect(state.players).toHaveLength(1);
    state = addPlayer(state, 'b');
    expect(state.players.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('sits a mid-game joiner out until the next round', () => {
    let state = playingGame(['a', 'b']);
    state = addPlayer(state, 'late');
    expect(state.players.find((p) => p.id === 'late').inRound).toBe(false);

    state = roll(state, [3, 4]); // safe seven, keeps playing
    state = bank(state, 'a').state;
    state = bank(state, 'b').state;
    state = startNextRound(state).state;
    expect(state.players.find((p) => p.id === 'late').inRound).toBe(true);
  });

  it('ends the round when the last active player is removed', () => {
    let state = playingGame(['a', 'b']);
    state = removePlayer(state, 'a');
    expect(state.phase).toBe(PHASE.PLAYING);
    state = removePlayer(state, 'b');
    expect(state.phase).toBe(PHASE.ROUND_OVER);
  });

  it('survives removing a player who was never there', () => {
    const state = playingGame(['a']);
    expect(removePlayer(state, 'ghost')).toBe(state);
  });
});

describe('safe rolls', () => {
  it('pays the seven bonus for a 7', () => {
    const state = roll(playingGame(), [3, 4]);
    expect(state.pot).toBe(DEFAULT_RULES.sevenBonus);
    expect(state.lastRoll.kind).toBe(ROLL_KIND.SAFE_SEVEN);
    expect(state.phase).toBe(PHASE.PLAYING);
  });

  it('adds the face sum for an ordinary roll', () => {
    const state = roll(playingGame(), [2, 6]);
    expect(state.pot).toBe(8);
    expect(state.lastRoll.kind).toBe(ROLL_KIND.ADD);
  });

  it('adds the sum for doubles by default rather than doubling', () => {
    let state = roll(playingGame(), [2, 6]); // pot 8
    state = roll(state, [4, 4]); // doubles during safe rolls
    // 8 + 8 and 8 * 2 agree here, so this only checks the kind; the next test
    // uses a pot where adding and doubling give different answers.
    expect(state.pot).toBe(16);
    expect(state.lastRoll.kind).toBe(ROLL_KIND.ADD);
  });

  it('distinguishes adding from doubling when the two differ', () => {
    let state = roll(playingGame(), [5, 6]); // pot 11
    state = roll(state, [3, 3]); // +6 in 'sum' mode, x2 would be 22
    expect(state.pot).toBe(17);
  });

  it('doubles during safe rolls when configured to', () => {
    let state = playingGame(['a', 'b'], { doublesDuringSafeRolls: 'double' });
    state = roll(state, [5, 6]); // pot 11
    state = roll(state, [3, 3]);
    expect(state.pot).toBe(22);
    expect(state.lastRoll.kind).toBe(ROLL_KIND.DOUBLE);
  });

  it('never busts on a 7 within the safe window', () => {
    let state = playingGame();
    for (let i = 0; i < DEFAULT_RULES.safeRolls; i += 1) {
      state = roll(state, [3, 4]);
      expect(state.phase).toBe(PHASE.PLAYING);
    }
    expect(state.pot).toBe(DEFAULT_RULES.sevenBonus * DEFAULT_RULES.safeRolls);
  });
});

describe('after the safe rolls', () => {
  /** Burn through the safe rolls with 2s so the pot is small and predictable. */
  function pastSafeRolls(rules) {
    let state = playingGame(['a', 'b'], rules);
    for (let i = 0; i < state.rules.safeRolls; i += 1) state = roll(state, [1, 1]);
    return state;
  }

  it('wipes the pot and ends the round on a 7', () => {
    let state = pastSafeRolls();
    const potBefore = state.pot;
    expect(potBefore).toBeGreaterThan(0);

    const { state: after, events } = applyRoll(state, [1, 6]);
    expect(after.pot).toBe(0);
    expect(after.phase).toBe(PHASE.ROUND_OVER);
    expect(after.lastRoll.kind).toBe(ROLL_KIND.BUST);
    expect(after.players.every((p) => !p.inRound)).toBe(true);
    expect(events.map((e) => e.kind)).toContain('roundBusted');
    expect(events.find((e) => e.kind === 'roundBusted').potLost).toBe(potBefore);
  });

  it('doubles the pot on doubles', () => {
    let state = pastSafeRolls();
    const before = state.pot;
    state = roll(state, [5, 5]);
    expect(state.pot).toBe(before * 2);
    expect(state.lastRoll.kind).toBe(ROLL_KIND.DOUBLE);
  });

  it('adds the sum on anything else', () => {
    let state = pastSafeRolls();
    const before = state.pot;
    state = roll(state, [2, 6]);
    expect(state.pot).toBe(before + 8);
  });

  it('adds the sum rather than doubling nothing when the pot is empty', () => {
    // Only reachable with safeRolls: 0, where the very first roll can be doubles.
    let state = playingGame(['a', 'b'], { safeRolls: 0 });
    state = roll(state, [4, 4]);
    expect(state.pot).toBe(8);
    expect(state.lastRoll.kind).toBe(ROLL_KIND.ADD);
  });

  it('busts on the very first roll when there is no safe window', () => {
    const state = roll(playingGame(['a', 'b'], { safeRolls: 0 }), [3, 4]);
    expect(state.phase).toBe(PHASE.ROUND_OVER);
    expect(state.pot).toBe(0);
  });
});

describe('banking', () => {
  it('pays the full pot and does not reduce it for anyone else', () => {
    let state = roll(playingGame(['a', 'b', 'c']), [3, 4]); // pot 70
    state = bank(state, 'a').state;
    expect(score(state, 'a')).toBe(70);
    expect(state.pot).toBe(70);

    state = bank(state, 'b').state;
    expect(score(state, 'b')).toBe(70);
    expect(state.pot).toBe(70);
  });

  it('takes the banker out of the round', () => {
    let state = roll(playingGame(), [3, 4]);
    state = bank(state, 'a').state;
    expect(state.players.find((p) => p.id === 'a').inRound).toBe(false);
    expect(canBank(state, 'a')).toBe(false);
  });

  it('protects banked points from a later bust', () => {
    let state = playingGame(['a', 'b']);
    state = roll(state, [3, 4]); // pot 70
    state = bank(state, 'a').state;
    for (let i = state.rollNumber; i < state.rules.safeRolls; i += 1) state = roll(state, [1, 1]);
    state = roll(state, [3, 4]); // bust

    expect(score(state, 'a')).toBe(70);
    expect(score(state, 'b')).toBe(0);
    expect(state.phase).toBe(PHASE.ROUND_OVER);
  });

  it('ends the round once everyone has banked', () => {
    let state = roll(playingGame(['a', 'b']), [3, 4]);
    const first = bank(state, 'a');
    expect(first.state.phase).toBe(PHASE.PLAYING);

    const second = bank(first.state, 'b');
    expect(second.state.phase).toBe(PHASE.ROUND_OVER);
    expect(second.events.map((e) => e.kind)).toContain('roundEnded');
  });

  it('refuses to bank an empty pot', () => {
    expect(() => bank(playingGame(), 'a')).toThrow(/pot/i);
    expect(canBank(playingGame(), 'a')).toBe(false);
  });

  it('refuses to bank twice', () => {
    let state = roll(playingGame(['a', 'b']), [3, 4]);
    state = bank(state, 'a').state;
    expect(() => bank(state, 'a')).toThrow(/not in the round/i);
  });

  it('refuses to bank for an unknown player', () => {
    const state = roll(playingGame(), [3, 4]);
    expect(() => bank(state, 'nobody')).toThrow(/not in the round/i);
  });

  it('refuses to bank outside a live round', () => {
    const state = createGame();
    expect(() => bank(state, 'a')).toThrow(/phase/i);
  });
});

describe('rounds and the end of the game', () => {
  it('resets the pot and re-seats everyone each round', () => {
    let state = roll(playingGame(['a', 'b']), [3, 4]);
    state = bank(state, 'a').state;
    state = bank(state, 'b').state;
    state = startNextRound(state).state;

    expect(state.round).toBe(2);
    expect(state.pot).toBe(0);
    expect(state.rollNumber).toBe(0);
    expect(state.lastRoll).toBeNull();
    expect(state.players.every((p) => p.inRound)).toBe(true);
    expect(state.players.every((p) => p.bankedThisRound === null)).toBe(true);
    expect(score(state, 'a')).toBe(70); // scores carry over
  });

  it('ends the game after the configured number of rounds', () => {
    let state = playingGame(['a', 'b'], { rounds: 3 });
    for (let r = 1; r <= 3; r += 1) {
      state = roll(state, [3, 4]);
      state = bank(state, 'a').state;
      state = bank(state, 'b').state;
      expect(state.phase).toBe(PHASE.ROUND_OVER);
      state = startNextRound(state).state;
    }
    expect(state.phase).toBe(PHASE.GAME_OVER);
    expect(state.round).toBe(3);
  });

  it('names the highest scorer the winner', () => {
    let state = roll(playingGame(['a', 'b'], { rounds: 1 }), [3, 4]);
    state = bank(state, 'a').state;
    state = bank(state, 'b').state;
    state = adjustScore(state, 'a', 5);
    state = startNextRound(state).state;
    expect(state.winnerIds).toEqual(['a']);
  });

  it('lets a tie share the win', () => {
    let state = roll(playingGame(['a', 'b'], { rounds: 1 }), [3, 4]);
    state = bank(state, 'a').state;
    state = bank(state, 'b').state;
    state = startNextRound(state).state;
    expect(state.winnerIds.sort()).toEqual(['a', 'b']);
  });

  it('declares nobody the winner when nobody scored', () => {
    let state = playingGame(['a', 'b'], { rounds: 1, safeRolls: 0 });
    state = roll(state, [3, 4]); // instant bust, nobody banked
    state = startNextRound(state).state;
    expect(state.phase).toBe(PHASE.GAME_OVER);
    expect(state.winnerIds).toEqual([]);
  });

  it('can be ended early by the host', () => {
    let state = roll(playingGame(['a', 'b'], { rounds: 15 }), [3, 4]);
    state = bank(state, 'a').state;
    const { state: ended } = endGame(state);
    expect(ended.phase).toBe(PHASE.GAME_OVER);
    expect(ended.winnerIds).toEqual(['a']);
    expect(ended.pot).toBe(0);
  });

  it('rejects advancing a round that is still live', () => {
    expect(() => startNextRound(playingGame())).toThrow(/phase/i);
  });

  it('rejects rolling once the round is over', () => {
    let state = playingGame(['a', 'b'], { safeRolls: 0 });
    state = roll(state, [3, 4]);
    expect(() => applyRoll(state, [1, 1])).toThrow(/phase/i);
  });
});

describe('host corrections', () => {
  it('adjusts a score up and down', () => {
    let state = playingGame(['a']);
    state = adjustScore(state, 'a', 250);
    expect(score(state, 'a')).toBe(250);
    state = adjustScore(state, 'a', -100);
    expect(score(state, 'a')).toBe(150);
  });

  it('never drives a score below zero', () => {
    const state = adjustScore(playingGame(['a']), 'a', -500);
    expect(score(state, 'a')).toBe(0);
  });

  it('ignores no-op and nonsense adjustments', () => {
    const state = playingGame(['a']);
    expect(adjustScore(state, 'a', 0)).toBe(state);
    expect(adjustScore(state, 'a', 'lots')).toBe(state);
    expect(adjustScore(state, 'ghost', 10)).toBe(state);
  });

  it('re-validates rules on change', () => {
    const state = setRules(createGame(), { rounds: 20, safeRolls: 500 });
    expect(state.rules.rounds).toBe(20);
    expect(state.rules.safeRolls).toBe(10);
  });
});

describe('immutability', () => {
  it('never mutates the state it was given', () => {
    const before = roll(playingGame(['a', 'b']), [3, 4]);
    const snapshot = JSON.parse(JSON.stringify(before));
    applyRoll(before, [2, 2]);
    bank(before, 'a');
    adjustScore(before, 'a', 100);
    removePlayer(before, 'b');
    expect(before).toEqual(snapshot);
  });
});

describe('standings', () => {
  it('sorts best first', () => {
    let state = playingGame(['a', 'b', 'c']);
    state = adjustScore(state, 'b', 300);
    state = adjustScore(state, 'c', 100);
    expect(standings(state).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('dice', () => {
  it('only ever produces 1..6', () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 5000; i += 1) {
      const [d1, d2] = rollDice(rng);
      expect(d1).toBeGreaterThanOrEqual(1);
      expect(d1).toBeLessThanOrEqual(6);
      expect(d2).toBeGreaterThanOrEqual(1);
      expect(d2).toBeLessThanOrEqual(6);
    }
  });

  it('is reproducible from a seed', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 50 }, () => rollDice(a));
    const seqB = Array.from({ length: 50 }, () => rollDice(b));
    expect(seqA).toEqual(seqB);
  });

  it('covers all 6 faces', () => {
    const rng = createSeededRng(1);
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) rollDice(rng).forEach((d) => seen.add(d));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('fuzz: invariants hold across many random games', () => {
  it('survives 2000 games of random play without breaking its own rules', () => {
    const rng = createSeededRng(20260822);
    let gamesCompleted = 0;
    let bustsSeen = 0;
    let banksSeen = 0;

    for (let g = 0; g < 2000; g += 1) {
      const playerIds = ['p1', 'p2', 'p3'].slice(0, 2 + (rng(2) ? 1 : 0));
      const rules = {
        rounds: 1 + rng(5),
        safeRolls: rng(4),
        rollIntervalSeconds: 3 + rng(10),
        doublesDuringSafeRolls: rng(2) ? 'double' : 'sum',
      };

      let state = playingGame(playerIds, rules);
      const previousScores = new Map(playerIds.map((id) => [id, 0]));
      let guard = 0;

      while (state.phase !== PHASE.GAME_OVER) {
        guard += 1;
        expect(guard).toBeLessThan(100000); // must always terminate

        if (state.phase === PHASE.ROUND_OVER) {
          state = startNextRound(state).state;
          continue;
        }

        // Randomly bank someone who is eligible, otherwise roll.
        const eligible = state.players.filter((p) => p.inRound);
        if (state.pot > 0 && eligible.length > 0 && rng(3) === 0) {
          const target = eligible[rng(eligible.length)];
          const result = bank(state, target.id);
          banksSeen += 1;
          state = result.state;
        } else {
          const result = applyRoll(state, rollDice(rng));
          if (result.state.lastRoll.kind === ROLL_KIND.BUST) bustsSeen += 1;
          state = result.state;
        }

        // --- invariants ---
        expect(state.pot).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(state.pot)).toBe(true);
        expect(state.round).toBeGreaterThanOrEqual(1);
        expect(state.round).toBeLessThanOrEqual(state.rules.rounds);
        expect(state.players).toHaveLength(playerIds.length);
        for (const p of state.players) {
          expect(p.score).toBeGreaterThanOrEqual(previousScores.get(p.id)); // monotonic
          expect(Number.isInteger(p.score)).toBe(true);
          previousScores.set(p.id, p.score);
        }
        // A live round always has someone still in it.
        if (state.phase === PHASE.PLAYING) {
          expect(state.players.some((p) => p.inRound)).toBe(true);
        }
      }

      expect(state.winnerIds.every((id) => playerIds.includes(id))).toBe(true);
      if (state.winnerIds.length > 0) {
        const best = Math.max(...state.players.map((p) => p.score));
        expect(state.winnerIds).toHaveLength(
          state.players.filter((p) => p.score === best).length,
        );
      }
      gamesCompleted += 1;
    }

    expect(gamesCompleted).toBe(2000);
    // Sanity: the fuzzer actually exercised both interesting paths.
    expect(bustsSeen).toBeGreaterThan(100);
    expect(banksSeen).toBeGreaterThan(100);
  });
});
