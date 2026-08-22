import { useEffect, useState } from 'react';

/**
 * Countdown to the next auto-roll, derived client-side from the server's
 * `nextRollAt` deadline. The server only sends one state snapshot; each client
 * ticks its own bar so there is no per-second broadcast to everyone.
 *
 * `totalMs` is the full roll-interval (rules.rollIntervalSeconds * 1000) used
 * only to render the fill fraction.
 */
export default function Countdown({ nextRollAt, totalMs }) {
  const [msLeft, setMsLeft] = useState(null);

  useEffect(() => {
    if (nextRollAt === null) {
      setMsLeft(null);
      return undefined;
    }
    const tick = () => setMsLeft(Math.max(0, nextRollAt - Date.now()));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [nextRollAt]);

  if (msLeft === null) return null;

  const secsLeft = msLeft / 1000;
  const span = totalMs || 8000;
  const frac = Math.min(1, Math.max(0, msLeft / span));

  return (
    <div className="countdown">
      <div className="countdown-track">
        <div className="countdown-fill" style={{ width: `${frac * 100}%` }} />
      </div>
      <div className={`countdown-label ${secsLeft <= 3 ? 'urgent' : ''}`}>
        {secsLeft <= 0.9 ? 'Rolling…' : `Next roll in ${Math.ceil(secsLeft)}s`}
      </div>
    </div>
  );
}
