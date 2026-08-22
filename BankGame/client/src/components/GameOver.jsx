import Scoreboard from './Scoreboard.jsx';
import { C2S } from '@bank/shared';

/** Final standings after the last round, plus a host "play again" action. */
export default function GameOver({ state, me, isHost, host }) {
  const winners = new Set(state.winnerIds || []);
  return (
    <div className="gameover">
      <h2>Game over 🏁</h2>
      {state.winnerIds && state.winnerIds.length > 0 ? (
        <p className="winner-line">
          {(state.players || [])
            .filter((p) => winners.has(p.id))
            .map((p) => p.name)
            .join(' and ')}{' '}
          win{winners.size === 1 ? 's' : ''}!
        </p>
      ) : (
        <p className="winner-line">Nobody banked — no winner this time.</p>
      )}
      <div className="panel">
        <h3>Final standings</h3>
        <Scoreboard players={state.players} me={me} phase="gameOver" />
      </div>
      {isHost && (
        <button type="button" className="big-action" onClick={() => host(C2S.PLAY_AGAIN)}>
          Play again in this room
        </button>
      )}
    </div>
  );
}
