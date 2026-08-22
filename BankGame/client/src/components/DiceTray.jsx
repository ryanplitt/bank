/**
 * The dice area. Renders two die faces with classic pips (dots), animating a
 * roll whenever the dice change. The animation re-triggers by keying off the
 * server's rollNumber, so it plays once per authoritative roll for everyone.
 */
export default function DiceTray({ lastRoll }) {
  // Key used to let React remount/restart the roll animation per dice change.
  const rollKey = lastRoll ? `${lastRoll.rollNumber}-${lastRoll.dice.join('')}` : 'idle';

  // We show the newest lastRoll with a roll animation each time it changes.
  return (
    <div className="dice-tray" aria-live="polite">
      {lastRoll ? (
        <div className="dice-anim" key={rollKey}>
          {lastRoll.dice.map((d, i) => (
            <DieFace key={i} value={d} doubles={lastRoll.isDoubles} />
          ))}
        </div>
      ) : (
        <div className="dice-empty">The dice are waiting…</div>
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

function DieFace({ value, doubles }) {
  const pips = PIP_LAYOUT[value] || [];
  return (
    <div className={`die die--pips ${doubles ? 'die--doubles' : ''}`} data-value={value}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`die-pip ${pips.includes(i) ? 'is-pip' : ''}`} />
      ))}
    </div>
  );
}
