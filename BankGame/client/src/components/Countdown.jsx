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
  // The short gaps between safe rolls tick by in a second: flagging every one
  // as urgent would just flicker, so urgency is for the real banking windows.
  const urgent = span >= 3000 && secsLeft <= 2;

  return (
    <div className={`countdown${urgent ? ' countdown--urgent' : ''}`}>
      <div className="countdown-track">
        <div className="countdown-fill" style={{ width: `${frac * 100}%` }} />
      </div>
      {/* "Rolling…" only once the deadline has actually passed: saying it any
          earlier announces a roll the dice haven't made yet. */}
      <div className={`countdown-label ${urgent ? 'urgent' : ''}`}>
        {msLeft <= 0 ? 'Rolling…' : `Next roll in ${Math.ceil(secsLeft)}s`}
      </div>
    </div>
  );
}
