/**
 * A compact, always-visible progress indicator of how far into the game we are
 * ("Round 4 of 15"). Shown to every player on their phone so nobody is ever lost
 * about where the game stands.
 *
 * While a round is still inside its "safe" opening rolls (a 7 only pays the
 * bonus, never busts the pot) the strip shows a small gold note — "safe until
 * roll 3". It disappears the moment the dangerous rolls begin, so the marker
 * is never stale and never lies.
 */
export default function RoundProgress({ round, total, phase, safeRolls, rollNumber }) {
  const current = Math.min(round, total);
  const frac = total > 0 ? current / total : 0;
  const dots = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const state =
      phase === 'gameOver'
        ? 'done'
        : n === current
          ? 'current'
          : n < current
            ? 'done'
            : 'todo';
    return <span key={n} className={`round-dot round-dot--${state}`} />;
  });

  // Roll N (1-based) is safe while N <= safeRolls; the marker therefore shows
  // right up until the last safe roll has landed, then gets out of the way.
  const safeWindowOpen =
    phase === 'playing' &&
    typeof safeRolls === 'number' &&
    safeRolls > 0 &&
    typeof rollNumber === 'number' &&
    rollNumber < safeRolls;

  return (
    <div
      className={`round-progress ${safeWindowOpen ? 'round-progress--safe' : ''}`}
      role="img"
      aria-label={`Round ${current} of ${total}${safeWindowOpen ? `, safe until roll ${safeRolls}` : ''}`}
    >
      <div className="round-progress-bar">{dots}</div>
      <div className="round-progress-label">
        <span>
          Round <strong>{current}</strong> of {total}
          {safeWindowOpen && (
            <span className="round-progress-safe">safe until roll {safeRolls}</span>
          )}
        </span>
        <span className="round-progress-pct">{Math.round(frac * 100)}%</span>
      </div>
    </div>
  );
}
