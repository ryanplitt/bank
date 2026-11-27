import { useEffect, useRef, useState } from 'react';

/** Gains this big (or a doubling) count as a big moment. */
export const BIG_GAIN = 50;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Animate a number toward its latest value.
 *
 * Rising values count up with an ease-out (longer for bigger jumps, never
 * sluggish) and report the jump as `gain` so callers can add a pop, a floating
 * "+N" or sparks. A drop snaps straight to the new value: nothing to celebrate.
 * The first value is shown as-is, so a late joiner never watches a replay.
 *
 * @param {number} value The authoritative value.
 * @returns {{ shown: number, gain: null | { id: number, delta: number, doubled: boolean, big: boolean } }}
 */
export function useCountUp(value) {
  const [shown, setShown] = useState(value);
  const [gain, setGain] = useState(null);
  const shownRef = useRef(value);
  const targetRef = useRef(value);
  const idRef = useRef(0);

  useEffect(() => {
    if (value === targetRef.current) return undefined;
    const from = shownRef.current;
    const previousTarget = targetRef.current;
    targetRef.current = value;

    if (value < from || prefersReducedMotion()) {
      shownRef.current = value;
      setShown(value);
      setGain(null);
      return undefined;
    }

    const delta = value - previousTarget;
    const doubled = previousTarget > 0 && value === previousTarget * 2;
    idRef.current += 1;
    setGain({ id: idRef.current, delta, doubled, big: doubled || delta >= BIG_GAIN });

    const duration = Math.min(900, 380 + delta * 6);
    const start = performance.now();
    let raf = 0;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return { shown, gain };
}
