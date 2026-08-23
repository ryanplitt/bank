import Countdown from './Countdown.jsx';
import BankButton from './BankButton.jsx';
import Scoreboard from './Scoreboard.jsx';
import RollFeed from './RollFeed.jsx';
import HostPanel from './HostPanel.jsx';
import GameOver from './GameOver.jsx';
import RoundOver from './RoundOver.jsx';
import RoundProgress from './RoundProgress.jsx';
import DiceTray from './DiceTray.jsx';
import BustReveal from './BustReveal.jsx';
import Pot from './Pot.jsx';

/**
 * The main in-game view. Every player sees a compact header with round progress,
 * the pot, animated dice and a BANK button. The host additionally gets a full
 * dashboard and the "start next round" action. On desktop (the host's shared
 * screen, or anyone) the same view lays out into a roomier dashboard grid.
 */
export default function GameBoard({ state, me, isHost, canBank, feed, bank, host }) {
  const { round, rules, pot, lastRoll, nextRollAt, players, phase } = state;
  const roundOver = phase === 'roundOver';
  const busted = phase === 'roundOver' && state.lastRoundResult?.reason === 'busted';

  if (phase === 'gameOver') {
    return <GameOver state={state} me={me} isHost={isHost} host={host} />;
  }

  return (
    <div className="board">
      <header className="board-head">
        <RoundProgress round={round} total={rules.rounds} phase={phase} />
        {state.paused && <div className="paused-chip">⏸ paused</div>}
      </header>

      {roundOver && !busted ? (
        <RoundOver state={state} isHost={isHost} host={host} />
      ) : busted ? (
        <BustReveal state={state} />
      ) : (
        <div className="board-main">
          <div className="dice-zone">
            <Pot value={pot} />
            <DiceTray lastRoll={lastRoll} />
            {lastRoll && <div className="roll-note">{rollNote(lastRoll)}</div>}
          </div>

          {phase === 'playing' && (
            <Countdown nextRollAt={nextRollAt} totalMs={rules.rollIntervalSeconds * 1000} />
          )}

          <BankButton canBank={canBank} pot={pot} onClick={bank} />
        </div>
      )}

      {isHost && (
        <HostPanel state={state} host={host} me={me} />
      )}

      <section className="panel">
        <h3>Scores</h3>
        <Scoreboard
          players={players}
          me={me}
          phase={phase}
          lastRoundResult={state.lastRoundResult}
        />
      </section>

      <section className="panel">
        <h3>Feed</h3>
        <RollFeed feed={feed} />
      </section>
    </div>
  );
}

function rollNote(lastRoll) {
  switch (lastRoll.kind) {
    case 'bust':
      return 'A 7 swept the pot! Round over.';
    case 'safeSeven':
      return 'Lucky 7 — safe roll pays the bonus.';
    case 'double':
      return 'Doubles doubled the pot!';
    default:
      return `Added ${lastRoll.sum} to the pot.`;
  }
}
