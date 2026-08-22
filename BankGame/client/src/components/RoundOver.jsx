import { C2S } from '@bank/shared';

/**
 * The screen shown between rounds, once a round has ended and is waiting for
 * the host to start the next one. It makes it obvious how the round ended
 * (everyone banked vs. a 7 wiped the pot) and hands the host a single big
 * "Start round" action. Players just wait for the host.
 */
export default function RoundOver({ state, isHost, host }) {
  const { round, rules, lastRoundResult, players } = state;
  const result = lastRoundResult || {};
  const nextRound = round + 1;
  const isFinalRound = round >= rules.rounds;
  const label = isFinalRound ? 'Final round' : `Round ${nextRound} of ${rules.rounds}`;

  return (
    <div className={`round-over round-over--${result.reason || 'done'}`}>
      <div className="round-over-head">
        <div className="round-over-badge">
          {result.reason === 'busted' ? '💥 Round busted' : '🎉 Round complete'}
        </div>
        <h2>{roundLabel(result, round)}</h2>
        {result.reason === 'busted' ? (
          <p className="round-over-detail">
            A 7 swept the pot — <strong>{result.potLost ?? 0}</strong> was lost and
            everyone still in got nothing.
          </p>
        ) : result.reason === 'allBanked' ? (
          <p className="round-over-detail">
            Everyone banked — the pot of <strong>{result.pot ?? 0}</strong> was collected
            in full by {bankersLabel(players)}.
          </p>
        ) : (
          <p className="round-over-detail">The round is over.</p>
        )}
      </div>

      {isHost ? (
        isFinalRound ? (
          <div className="round-over-action">
            <p className="round-over-hint">That was the final round. Time for the results!</p>
            <button
              type="button"
              className="big-action round-over-start"
              onClick={() => host(C2S.START_ROUND)}
            >
              See final results →
            </button>
          </div>
        ) : (
          <div className="round-over-action">
            <p className="round-over-hint">The room is paused until you kick things off.</p>
            <button
              type="button"
              className="big-action round-over-start"
              onClick={() => host(C2S.START_ROUND)}
            >
              ▶ Start {label}
            </button>
          </div>
        )
      ) : (
        <div className="round-over-action">
          <p className="round-over-hint">
            Round complete. Waiting for the host to start{' '}
            {isFinalRound ? 'the results' : `round ${nextRound}`}…
          </p>
        </div>
      )}
    </div>
  );
}

function roundLabel(result, round) {
  if (result.reason === 'busted') return `A 7 busted round ${round}`;
  if (result.reason === 'allBanked') return `Round ${round} — everyone banked`;
  return `Round ${round} over`;
}

function bankersLabel(players) {
  const banked = (players || []).filter((p) => p.bankedThisRound !== null);
  if (banked.length === 0) return 'no one';
  return banked.map((p) => p.name).join(', ');
}
