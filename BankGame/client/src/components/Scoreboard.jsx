/**
 * Per-player standing: name, total score, in-round/banked status, presence.
 * The host badge and a "you" marker make it read well around a table of phones.
 */
export default function Scoreboard({ players, me, phase }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <div className="scoreboard">
      {sorted.map((p, i) => (
        <div key={p.id} className={`row ${p.id === me?.id ? 'you' : ''}`}>
          <span className="rank">{i + 1}</span>
          <span className="name">
            {p.name}
            {p.host && <span className="badge host" title="host">👑</span>}
            {p.id === me?.id && <span className="badge you-badge">you</span>}
            {!p.connected && <span className="badge away" title="disconnected">⋯</span>}
          </span>
          <span className="state">
            {phase === 'playing' && p.inRound && 'in'}
            {phase === 'playing' && !p.inRound && (p.bankedThisRound !== null ? 'banked' : 'out')}
          </span>
          <span className="score">{p.score}</span>
        </div>
      ))}
    </div>
  );
}
