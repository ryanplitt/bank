/**
 * The rules of Bank, as pure functions.
 *
 * Nothing in this module touches sockets, timers, or the clock, and it never
 * calls a random number generator itself — dice are always passed in. That is
 * what makes the whole rule set exhaustively testable, and it is the reason
 * the scoring bugs in the original prototype cannot recur here.
 *
 * State is plain JSON-serialisable data. Every mutating function returns a new
 * state object plus the list of things that just happened, so callers can
 * narrate the game without re-deriving it:
 *
 *     const { state, events } = applyRoll(prev, [3, 4]);
 *
 * Players are tracked by opaque id only. Display names live in the room layer,
 * which keeps this module about arithmetic rather than presentation.
 */

import { FEED_KIND, normalizeRules } from '@bank/shared';

export const PHASE = Object.freeze({
  LOBBY: 'lobby',
  PLAYING: 'playing',
  ROUND_OVER: 'roundOver',
  GAME_OVER: 'gameOver',
});

/** How a roll was resolved — drives the wording and colour in the UI. */
export const ROLL_KIND = Object.freeze({
  /** Face sum added to the pot. */
  ADD: 'add',
  /** A 7 during the safe rolls: pays the seven bonus. */
  SAFE_SEVEN: 'safeSeven',
  /** Doubles that multiplied the pot. */
  DOUBLE: 'double',
  /** A 7 after the safe rolls: the pot is lost and the round ends. */
  BUST: 'bust',
});

/**
 * Roll two dice.
 * @param {(max: number) => number} rng Returns a uniform integer in [0, max).
 * @returns {[number, number]}
 */
export function rollDice(rng) {
  return [rng(6) + 1, rng(6) + 1];
}

/**
 * A fresh game sitting in the lobby.
 * @param {object} [rules] Partial rules; anything missing or invalid falls back
 *   to the shared defaults.
 * @returns {object} state
 */
export function createGame(rules) {
  return {
    phase: PHASE.LOBBY,
    rules: normalizeRules(rules),
    round: 0,
    rollNumber: 0,
    pot: 0,
    lastRoll: null,
    /** How the most recent round ended — drives the "round over" screen. */
    lastRoundResult: null,
    players: [],
    winnerIds: [],
  };
}

/* ------------------------------------------------------------------ *
 * Roster
 * ------------------------------------------------------------------ */

const clone = (state) => ({
  ...state,
  rules: state.rules,
  players: state.players.map((p) => ({ ...p })),
  winnerIds: [...state.winnerIds],
  lastRoll: state.lastRoll ? { ...state.lastRoll, dice: [...state.lastRoll.dice] } : null,
});

/**
 * Add a player. Idempotent — adding an existing id is a no-op.
 *
 * A player who joins mid-game starts on 0 and sits out until the next round,
 * which is both fair and what a table would do.
 */
export function addPlayer(state, playerId) {
  if (state.players.some((p) => p.id === playerId)) return state;
  const next = clone(state);
  next.players.push({
    id: playerId,
    score: 0,
    inRound: false,
    bankedThisRound: null,
  });
  return next;
}

/** Remove a player entirely (a kick, or a lobby departure). */
export function removePlayer(state, playerId) {
  if (!state.players.some((p) => p.id === playerId)) return state;
  const next = clone(state);
  next.players = next.players.filter((p) => p.id !== playerId);
  // Losing the last active player ends the round rather than leaving the game
  // waiting on nobody.
  if (next.phase === PHASE.PLAYING && !next.players.some((p) => p.inRound)) {
    next.phase = PHASE.ROUND_OVER;
    next.lastRoundResult = {
      reason: 'noPlayersLeft',
      round: next.round,
    };
  }
  return next;
}

/** Host correction: nudge a player's score by a delta (may be negative). */
export function adjustScore(state, playerId, delta) {
  const amount = Math.trunc(Number(delta) || 0);
  if (!amount) return state;
  const next = clone(state);
  const player = next.players.find((p) => p.id === playerId);
  if (!player) return state;
  player.score = Math.max(0, player.score + amount);
  return next;
}

/** Replace the rule set. Only meaningful in the lobby. */
export function setRules(state, rules) {
  const next = clone(state);
  next.rules = normalizeRules(rules, state.rules);
  return next;
}

/* ------------------------------------------------------------------ *
 * Play
 * ------------------------------------------------------------------ */

/** Begin round 1. Scores reset; everyone at the table is in. */
export function startGame(state) {
  const next = clone(state);
  next.phase = PHASE.PLAYING;
  next.round = 1;
  next.rollNumber = 0;
  next.pot = 0;
  next.lastRoll = null;
  next.lastRoundResult = null;
  next.winnerIds = [];
  next.players.forEach((p) => {
    p.score = 0;
    p.inRound = true;
    p.bankedThisRound = null;
  });
  return {
    state: next,
    events: [
      { kind: FEED_KIND.GAME_STARTED, rounds: next.rules.rounds },
      { kind: FEED_KIND.ROUND_STARTED, round: 1 },
    ],
  };
}

/**
 * Resolve one roll of the two dice.
 *
 * Safe rolls (the first `rules.safeRolls` of a round):
 *   - a 7 pays `rules.sevenBonus` into the pot;
 *   - doubles either add their sum or double the pot, per `doublesDuringSafeRolls`;
 *   - anything else adds its sum.
 *
 * After the safe rolls:
 *   - a 7 wipes the pot and ends the round — everyone still in gets nothing;
 *   - doubles double the pot;
 *   - anything else adds its sum.
 *
 * House rule worth naming: doubling an empty pot would be a no-op that feels
 * like a bug to players, so doubles on a zero pot add their sum instead. This
 * only comes up when `safeRolls` is set to 0.
 *
 * @param {object} state
 * @param {[number, number]} dice
 * @returns {{ state: object, events: object[] }}
 */
export function applyRoll(state, dice) {
  if (state.phase !== PHASE.PLAYING) {
    throw new Error(`applyRoll called in phase "${state.phase}"`);
  }

  const [d1, d2] = dice;
  const sum = d1 + d2;
  const isDoubles = d1 === d2;
  const isSeven = sum === 7;

  const next = clone(state);
  next.rollNumber += 1;
  const isSafeRoll = next.rollNumber <= next.rules.safeRolls;
  const potBefore = next.pot;

  let kind;
  if (isSeven && !isSafeRoll) {
    kind = ROLL_KIND.BUST;
    next.pot = 0;
  } else if (isSeven) {
    kind = ROLL_KIND.SAFE_SEVEN;
    next.pot += next.rules.sevenBonus;
  } else if (isDoubles && potBefore > 0 && (!isSafeRoll || next.rules.doublesDuringSafeRolls === 'double')) {
    kind = ROLL_KIND.DOUBLE;
    next.pot = potBefore * 2;
  } else {
    kind = ROLL_KIND.ADD;
    next.pot += sum;
  }

  next.lastRoll = {
    dice: [d1, d2],
    sum,
    kind,
    isDoubles,
    rollNumber: next.rollNumber,
    wasSafeRoll: isSafeRoll,
    potBefore,
    potAfter: next.pot,
  };

  const events = [
    {
      kind: FEED_KIND.ROLL,
      dice: [d1, d2],
      sum,
      rollKind: kind,
      rollNumber: next.rollNumber,
      potBefore,
      potAfter: next.pot,
    },
  ];

  if (kind === ROLL_KIND.BUST) {
    const lostIds = next.players.filter((p) => p.inRound).map((p) => p.id);
    next.players.forEach((p) => {
      p.inRound = false;
    });
    next.phase = PHASE.ROUND_OVER;
    next.lastRoundResult = {
      reason: 'busted',
      round: next.round,
      potLost: potBefore,
    };
    events.push({ kind: FEED_KIND.ROUND_BUSTED, round: next.round, lostIds, potLost: potBefore });
    events.push({ kind: FEED_KIND.ROUND_ENDED, round: next.round });
  }

  return { state: next, events };
}

/**
 * A player takes the current pot and sits out the rest of the round.
 *
 * Banking does not reduce the pot — in Bank everyone who banks receives the
 * full amount showing at the moment they bank.
 *
 * @returns {{ state: object, events: object[] }}
 */
export function bank(state, playerId) {
  if (state.phase !== PHASE.PLAYING) {
    throw new Error(`bank called in phase "${state.phase}"`);
  }
  const existing = state.players.find((p) => p.id === playerId);
  if (!existing || !existing.inRound) {
    throw new Error('player is not in the round');
  }
  if (state.pot <= 0) {
    throw new Error('there is nothing in the pot to bank');
  }

  const next = clone(state);
  const player = next.players.find((p) => p.id === playerId);
  const amount = next.pot;
  player.score += amount;
  player.inRound = false;
  player.bankedThisRound = amount;

  const events = [
    { kind: FEED_KIND.BANKED, playerId, amount, total: player.score, round: next.round },
  ];

  // Nobody left to play for: the round is over without needing another roll.
  if (!next.players.some((p) => p.inRound)) {
    next.phase = PHASE.ROUND_OVER;
    next.lastRoundResult = {
      reason: 'allBanked',
      round: next.round,
      pot: next.pot,
    };
    events.push({ kind: FEED_KIND.ROUND_ENDED, round: next.round });
  }

  return { state: next, events };
}

/**
 * Move from a finished round to the next one, or to the end of the game.
 * @returns {{ state: object, events: object[] }}
 */
export function startNextRound(state) {
  if (state.phase !== PHASE.ROUND_OVER) {
    throw new Error(`startNextRound called in phase "${state.phase}"`);
  }

  const next = clone(state);

  if (next.round >= next.rules.rounds) {
    return finish(next);
  }

  next.round += 1;
  next.rollNumber = 0;
  next.pot = 0;
  next.lastRoll = null;
  next.lastRoundResult = null;
  next.phase = PHASE.PLAYING;
  next.players.forEach((p) => {
    p.inRound = true;
    p.bankedThisRound = null;
  });

  return { state: next, events: [{ kind: FEED_KIND.ROUND_STARTED, round: next.round }] };
}

/** End the game immediately, wherever it is (host command, or the last round). */
export function endGame(state) {
  return finish(clone(state));
}

function finish(next) {
  next.phase = PHASE.GAME_OVER;
  next.pot = 0;
  next.players.forEach((p) => {
    p.inRound = false;
  });
  next.winnerIds = winnersOf(next.players);
  return {
    state: next,
    events: [{ kind: FEED_KIND.GAME_OVER, winnerIds: next.winnerIds }],
  };
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

/** Ids of the highest scorers. Ties share the win, so this may hold several. */
export function winnersOf(players) {
  if (players.length === 0) return [];
  const best = Math.max(...players.map((p) => p.score));
  // A game where nobody scored has no winner rather than everybody winning.
  if (best <= 0) return [];
  return players.filter((p) => p.score === best).map((p) => p.id);
}

/** Players sorted best-first, for the scoreboard. */
export function standings(state) {
  return [...state.players].sort((a, b) => b.score - a.score);
}

/** True when the round can no longer progress and needs advancing. */
export function isRoundOver(state) {
  return state.phase === PHASE.ROUND_OVER;
}

export function isGameOver(state) {
  return state.phase === PHASE.GAME_OVER;
}

/** Whether this player may bank right now. Mirrors the guards in bank(). */
export function canBank(state, playerId) {
  if (state.phase !== PHASE.PLAYING || state.pot <= 0) return false;
  const player = state.players.find((p) => p.id === playerId);
  return Boolean(player && player.inRound);
}
