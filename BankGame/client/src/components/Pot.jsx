import { useEffect, useRef, useState } from 'react';

/** Gains this big (or a doubling) throw sparks. */
const BIG_GAIN = 50;
const SPARKS = 8;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The shared pot, shown big and unambiguous on every device.
 *
 * When the pot grows the number counts up to its new value, the whole card
 * pops with a golden glow, and a "+N" floats up out of it. A doubling or a big
 * gain also throws a ring of sparks. A drop (a bust, a new round) just snaps:
 * there is nothing to celebrate.
 */
export default function Pot({ value, busted }) {
  const [shown, setShown] = useState(value);
  const [gain, setGain] = useState(null); // { id, delta, big }
  const shownRef = useRef(value);
  const targetRef = useRef(value);
  const idRef = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    if (value === targetRef.current) return undefined;
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
    setGain({ id: idRef.current, delta, big: doubled || delta >= BIG_GAIN, doubled });

    // Count up with an ease-out; longer for bigger jumps, but never sluggish.
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

  const classes = ['pot'];
  if (busted) classes.push('pot--busted');
  if (gain) classes.push(gain.big ? 'pot--gain-big' : 'pot--gain');

  return (
    // Keyed by the gain so every increase restarts the pop from the top.
    <div className={classes.join(' ')} key={gain ? `g${gain.id}` : 'idle'}>
      <div className="pot-label">POT</div>
      <div className="pot-value">{shown}</div>
      {gain && (
        <>
          <span className="pot-float" aria-hidden="true">
            {gain.doubled ? '×2' : `+${gain.delta}`}
          </span>
          {gain.big &&
            Array.from({ length: SPARKS }, (_, i) => (
              <span
                key={i}
                className="pot-spark"
                aria-hidden="true"
                style={{ '--angle': `${(360 / SPARKS) * i}deg` }}
              />
            ))}
        </>
      )}
    </div>
  );
}
