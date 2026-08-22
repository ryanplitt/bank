/**
 * Per-player standing: name, total score, in-round/banked-out status, presence.
 * The host badge and a "you" marker make it read well around a table of phones.
 *
 * During a round it highlights who is still in; after a round it shows what
 * each banker collected. During gameOver it doubles as the final leaderboard.
 */
export default function Scoreboard({ players, me, phase, lastRoundResult }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const busted = lastRoundResult && lastRoundResult.reason === 'busted';

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
            {roundState(p, phase, busted)}
          </span>
          <span className="score">{p.score}</span>
        </div>
      ))}
    </div>
  );
}

function roundState(p, phase, busted) {
  const banked = p.bankedThisRound !== null;
  if (phase === 'gameOver') {
    if (p.score > 0) {
      return banked ? `final·+${bankedAmount(p)}` : 'final';
    }
    return '';
  }
  if (phase === 'playing') {
    if (p.inRound) return 'in';
    if (banked) return `banked +${p.bankedThisRound}`;
    return 'out';
  }
  // roundOver: what each player walked away with this round.
  if (busted) {
    return banked ? `banked +${p.bankedThisRound}` : 'busted 💥';
  }
  return banked ? `banked +${p.bankedThisRound}` : 'out';
}

function bankedAmount(p) {
  return p.bankedThisRound ?? 0;
}

