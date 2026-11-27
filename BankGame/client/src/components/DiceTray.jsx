import { useEffect, useState } from 'react';

/**
 * The dice area. While `rolling`, the dice tumble through random faces in a
 * neutral style: no gold, no red, no doubles ring, nothing that hints at the
 * real result. When `rolling` ends they land on the true faces and only then
 * pick up the colours and effects of the roll (gold seven, doubles, red bust).
 *
 * `rolling` comes from useRollReveal, the same signal that holds the pot back,
 * so the dice reveal and the pot update happen together.
 */
const FACE_INTERVAL = 75; // face-change cadence during the tumble

const randomFace = () => 1 + Math.floor(Math.random() * 6);

/** The stamp that slams down over the dice once they have landed. */
const STAMPS = {
  double: 'DOUBLES!',
  safeSeven: 'LUCKY 7!',
  bust: 'SEVEN!',
};

export default function DiceTray({ lastRoll, rolling = false }) {
  // Key that lets React remount/restart the tumble-in per authoritative roll.
  const rollKey = lastRoll ? `${lastRoll.rollNumber}-${lastRoll.dice.join('')}` : 'idle';
  const [faces, setFaces] = useState([randomFace(), randomFace()]);

  // Flurry of random faces for as long as the roll is in flight. These are
  // random on purpose: they must carry no information about the real dice.
  useEffect(() => {
    if (!rolling) return undefined;
    const id = setInterval(() => setFaces([randomFace(), randomFace()]), FACE_INTERVAL);
    return () => clearInterval(id);
  }, [rolling, rollKey]);

  if (!lastRoll) {
    return (
      <div className="dice-tray" aria-live="polite">
        <div className="dice-empty">The dice are waiting…</div>
      </div>
    );
  }

  return (
    <div className="dice-tray" aria-live="polite">
      <div
        className="dice-anim"
        key={rollKey}
        // No kind until the dice have landed: it drives the gold / red styling.
        data-kind={rolling ? undefined : lastRoll.kind}
      >
        {lastRoll.dice.map((final, i) => (
          <DieFace
            key={i}
            value={rolling ? faces[i] : final}
            final={!rolling}
            doubles={!rolling && lastRoll.isDoubles}
          />
        ))}
      </div>
      {!rolling && STAMPS[lastRoll.kind] && (
        <div className={`roll-stamp roll-stamp--${lastRoll.kind}`} key={`s${rollKey}`} aria-hidden="true">
          {STAMPS[lastRoll.kind]}
        </div>
      )}
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
