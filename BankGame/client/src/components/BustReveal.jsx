import { useEffect, useState } from 'react';
import DiceTray from './DiceTray.jsx';

/**
 * The dramatic "seven-out" reveal. When a round is busted on a 7, this is shown
 * for a beat so every player gets to SEE the dice land on 7 and read the big
 * flag — then it hands off to the normal RoundOver screen.
 *
 * Deterministic and client-side: it is driven only by shared server state
 * (lastRoll + lastRoundResult), so late joiners/reconnects land here too, and
 * all devices reveal and advance in sync.
 *
 * This screen only ever *shows* the reveal. Deciding what comes after it is
 * GameBoard's job, so `onDone` must actually move the board on — otherwise the
 * round has no way to end.
 */
export default function BustReveal({ state, onDone }) {
  const [showFlag, setShowFlag] = useState(false);
  const potLost = state.lastRoundResult ? state.lastRoundResult.potLost ?? 0 : 0;

  // Wait for the shake to settle, then pop in the flag.
  useEffect(() => {
    const t = setTimeout(() => setShowFlag(true), 250);
    return () => clearTimeout(t);
  }, []);

  // After a natural beat, hand over to the standard round-over screen, which
  // carries the host's "start next round" action.
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="bust-reveal">
      <DiceTray lastRoll={state.lastRoll} />
      <div className={`seven-flag ${showFlag ? 'seven-flag--show' : ''}`}>
        <div className="seven-flag-title">😵 SEVEN!</div>
        <div className="seven-flag-sub">
          Everyone still in is out — <strong>{potLost}</strong> was lost.
        </div>
      </div>
    </div>
  );
}
