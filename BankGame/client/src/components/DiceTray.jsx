import { useEffect, useState } from 'react';

/**
 * The dice area. Renders two die faces with classic pips (dots) and plays a
 * lively, multi-phase roll each time the dice change.
 *
 * The animation re-triggers by keying off the server's rollNumber, so it plays
 * once per authoritative roll for everyone. The sequence is purely cosmetic —
 * the final face values always come from `lastRoll.dice`:
 *
 *   1. Tumble-in          (CSS keyframes `die-roll`)
 *   2. Shake & face-cycle  (JS: brief flurry of random faces while the dice wiggle)
 *   3. Settle on the truth (CSS keyframes `die-settle` weighted bounce)
 *
 * Rolls are styled by their kind: an ordinary add is plain, a safe 7 glows
 * gold, doubles pop with a ring, and the destructive 7 (bust) shakes red.
 */
const CYCLE_MS = 700; // how long the dice visibly "roll" before settling
const CYCLE_INTERVAL = 75; // face-change cadence during the shake

export default function DiceTray({ lastRoll }) {
  // Key that lets React remount/restart the sequence per authoritative roll.
  const rollKey = lastRoll ? `${lastRoll.rollNumber}-${lastRoll.dice.join('')}` : 'idle';
  const [cycling, setCycling] = useState(null);

  // Start the cosmetic face-cycling whenever a new roll lands; flip to the
  // real faces after the shake. Cleaned up if the roll changes mid-flight.
  useEffect(() => {
    if (!lastRoll) return undefined;
    const [d1, d2] = lastRoll.dice;
    setCycling([d1, d2]);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      const shown = [1 + ((n * 7) % 6), 1 + ((n * 5) % 6)];
      setCycling([shown[0] === d1 ? d1 : shown[0], shown[1] === d2 ? d2 : shown[1]]);
      if (n * CYCLE_INTERVAL >= CYCLE_MS) {
        clearInterval(id);
        setCycling([d1, d2]); // settle on the authoritative faces
      }
    }, CYCLE_INTERVAL);
    return () => clearInterval(id);
  }, [rollKey, lastRoll]);

  if (!lastRoll) {
    return (
      <div className="dice-tray" aria-live="polite">
        <div className="dice-empty">The dice are waiting…</div>
      </div>
    );
  }

  const shown = cycling || lastRoll.dice;
  const isRolling = cycling && cycling.join(':') !== lastRoll.dice.join(':');

  return (
    <div className="dice-tray" aria-live="polite">
      <div className="dice-anim" key={rollKey} data-kind={lastRoll.kind}>
        {lastRoll.dice.map((final, i) => (
          <DieFace
            key={i}
            value={isRolling ? shown[i] : final}
            final={!isRolling}
            doubles={lastRoll.isDoubles}
          />
        ))}
      </div>
    </div>
  );
}

// Pip layout per face (1–6) as a 3×3 grid of positions.
const PIP_LAYOUT = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DieFace({ value, final, doubles }) {
  const pips = PIP_LAYOUT[value] || [];
  return (
    <div
      className={`die die--pips ${doubles ? 'die--doubles' : ''} ${final ? 'die--final' : 'die--shaking'}`}
      data-value={value}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`die-pip ${pips.includes(i) ? 'is-pip' : ''}`} />
      ))}
    </div>
  );
}
