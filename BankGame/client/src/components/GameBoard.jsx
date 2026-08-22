import Countdown from './Countdown.jsx';
import BankButton from './BankButton.jsx';
import Scoreboard from './Scoreboard.jsx';
import RollFeed from './RollFeed.jsx';
import HostPanel from './HostPanel.jsx';
import GameOver from './GameOver.jsx';

/**
 * The main in-game view: pot, dice, countdown, scoreboard, feed, and the BANK
 * button. The host's extra controls sit behind a disclosure so their playing
 * view stays clean too.
 */
export default function GameBoard({ state, me, isHost, canBank, feed, bank, host }) {
  const { round, rules, pot, lastRoll, nextRollAt, players } = state;

  if (state.phase === 'gameOver') {
    return <GameOver state={state} me={me} isHost={isHost} host={host} />;
  }

  return (
    <div className="board">
      <header className="board-head">
        <div className="round">Round {round} / {rules.rounds}</div>
        {state.paused && <div className="paused-chip">⏸ paused</div>}
      </header>

      <div className="pot">
        <div className="pot-label">POT</div>
        <div className="pot-value">{pot}</div>
      </div>

      <div className="dice-row">
        {lastRoll ? (
          lastRoll.dice.map((d, i) => <DiceFace key={i} value={d} big={lastRoll.isDoubles} />)
        ) : (
          <div className="dice-empty">The dice are waiting…</div>
        )}
      </div>
      {lastRoll && <div className="roll-note">{rollNote(lastRoll)}</div>}

      {state.phase === 'playing' && (
        <Countdown nextRollAt={nextRollAt} totalMs={rules.rollIntervalSeconds * 1000} />
      )}

      <BankButton canBank={canBank} pot={pot} onClick={bank} />

      {isHost && <HostPanel state={state} host={host} me={me} />}

      <section className="panel">
        <h3>Scores</h3>
        <Scoreboard players={players} me={me} phase={state.phase} />
      </section>

      <section className="panel">
        <h3>Feed</h3>
        <RollFeed feed={feed} />
      </section>
    </div>
  );
}

function DiceFace({ value, big }) {
  return <span className={`die ${big ? 'doubles' : ''}`}>{value}</span>;
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
