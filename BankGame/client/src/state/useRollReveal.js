/**
 * useRollReveal — keep the numbers from spoiling the dice.
 *
 * The server publishes one snapshot per roll: the new dice, the new pot, the
 * new scores and, on a bust, the end of the round, all at once. Rendered
 * straight away, the pot jumps and the round-over screen appears while the dice
 * are still tumbling. This hook holds everything *except* the dice back for the
 * length of the roll animation, then lets the rest through.
 *
 * It only delays what is shown. `canBank`, host commands and everything else
 * keep using the live state, so nothing the player can do is ever stale.
 */

import { useEffect, useReducer, useRef } from 'react';

/** Long enough for the tumble, the face-cycle and the settle (see DiceTray). */
export const ROLL_ANIM_MS = 1250;

/** Snapshot fields that reveal the outcome of a roll. */
const HELD_FIELDS = [
  'pot',
  'players',
  'phase',
  'round',
  'rollNumber',
  'lastRoundResult',
  'winnerIds',
  'canStart',
  'canStartRound',
];

/** Identity of a roll: changes once per authoritative roll, never on a bank,
 *  a join or a pause. */
function rollKeyOf(state) {
  const r = state?.lastRoll;
  return r ? `${state.code}:${state.round}:${r.rollNumber}:${r.dice.join('')}` : null;
}

/**
 * @param {object|null} state Live snapshot from the server.
 * @param {object[]} feed Live narration feed.
 * @returns {{ state: object|null, feed: object[], rolling: boolean }} What to render.
 */
export function useRollReveal(state, feed) {
  const [, bump] = useReducer((n) => n + 1, 0);
  const key = rollKeyOf(state);

  const seenKey = useRef(key);
  // The last view we were showing while *not* holding: what a hold falls back to.
  const settled = useRef({ state, lastSeq: feed.at(-1)?.seq ?? 0 });
  const holdUntil = useRef(0);
  const snapshot = useRef(null);

  const now = Date.now();
  if (key !== seenKey.current) {
    const isNewRoll = key !== null && settled.current.state?.code === state?.code;
    seenKey.current = key;
    if (isNewRoll) {
      // Freeze the previous view; the dice alone move on.
      if (now >= holdUntil.current) snapshot.current = settled.current;
      holdUntil.current = now + ROLL_ANIM_MS;
    }
  }

  const holding = state !== null && snapshot.current !== null && now < holdUntil.current;
  if (!holding) {
    settled.current = { state, lastSeq: feed.at(-1)?.seq ?? 0 };
    snapshot.current = null;
  }

  // Release the hold when the animation is done.
  useEffect(() => {
    const wait = holdUntil.current - Date.now();
    if (wait <= 0) return undefined;
    const id = setTimeout(bump, wait + 20);
    return () => clearTimeout(id);
  }, [key]);

  if (!holding) return { state, feed, rolling: false };

  const frozen = snapshot.current;
  const view = { ...state };
  for (const field of HELD_FIELDS) view[field] = frozen.state[field];
  return { state: view, feed: feed.filter((e) => (e.seq ?? 0) <= frozen.lastSeq), rolling: true };
}
