import { useEffect, useRef, useState } from 'react';

const SPLASH_MS = 1500;

/**
 * "ROUND 3" flashes across the screen as a round begins. It never blocks
 * input (pointer-events: none) and is skipped when you arrive mid-round.
 */
export default function RoundSplash({ round, total, phase, rollNumber }) {
  const [splash, setSplash] = useState(null);
  const shownFor = useRef(null);

  useEffect(() => {
    // A fresh round: playing, nothing rolled yet, and not one we already showed.
    if (phase !== 'playing' || rollNumber !== 0 || shownFor.current === round) return undefined;
    shownFor.current = round;
    setSplash({ id: round, last: round >= total });
    return undefined;
  }, [round, total, phase, rollNumber]);

  // Its own effect: the one above re-runs on every roll, and re-running must
  // not cancel the timer that takes the splash down again.
  useEffect(() => {
    if (!splash) return undefined;
    const id = setTimeout(() => setSplash(null), SPLASH_MS);
    return () => clearTimeout(id);
  }, [splash]);

  if (!splash) return null;
  return (
    <div className="round-splash" key={splash.id} aria-hidden="true">
      <div className="round-splash-small">{splash.last ? 'FINAL' : 'GET READY'}</div>
      <div className="round-splash-big">ROUND {round}</div>
    </div>
  );
}
