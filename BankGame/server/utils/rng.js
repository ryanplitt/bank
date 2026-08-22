import { randomInt } from 'node:crypto';

/**
 * Default randomness source: a uniform integer in [0, max).
 *
 * Uses the crypto RNG rather than Math.random so dice cannot be predicted from
 * observed rolls. It is not a security boundary, but it costs nothing and
 * removes the question entirely.
 *
 * @param {number} max Exclusive upper bound.
 * @returns {number}
 */
export function defaultRng(max) {
  return randomInt(max);
}

/**
 * Deterministic RNG with the same signature as defaultRng, for tests and for
 * reproducing a reported game. mulberry32 — small, fast, good enough spread.
 *
 * @param {number} seed
 * @returns {(max: number) => number}
 */
export function createSeededRng(seed) {
  let a = seed >>> 0;
  return function seededRng(max) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(unit * max);
  };
}
