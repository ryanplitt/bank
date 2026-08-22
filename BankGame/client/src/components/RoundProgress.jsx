/**
 * A compact, always-visible progress indicator of how far into the game we are
 * ("Round 4 of 15"). Shown to every player on their phone so nobody is ever lost
 * about where the game stands.
 */
export default function RoundProgress({ round, total, phase }) {
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

  return (
    <div className="round-progress" role="img" aria-label={`Round ${current} of ${total}`}>
      <div className="round-progress-bar">{dots}</div>
      <div className="round-progress-label">
        <span>Round <strong>{current}</strong> of {total}</span>
        <span className="round-progress-pct">{Math.round(frac * 100)}%</span>
      </div>
    </div>
  );
}
