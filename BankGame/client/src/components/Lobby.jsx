import Scoreboard from './Scoreboard.jsx';
import HostPanel from './HostPanel.jsx';
import { C2S, describeRules } from '@bank/shared';

/** Pre-game lobby: show who's here, the rules, a share link, and a start. */
export default function Lobby({ state, me, isHost, connected, feed, host }) {
  const canStart = Boolean(state.canStart && isHost && connected);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?room=${state.code}`
      : '';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      /* clipboard unavailable (non-secure context); the field stays copyable */
    }
  }

  return (
    <div className="lobby">
      <header className="lobby-head">
        <h2>Room {state.code}</h2>
        <p className="share-field" onClick={copyLink} title="Click to copy">
          {shareUrl}
        </p>
      </header>

      <div className="panel">
        <h3>At the table ({state.players.length})</h3>
        <Scoreboard players={state.players} me={me} phase={state.phase} />
      </div>

      <div className="panel">
        <h3>Rules</h3>
        <p className="rules-summary">{describeRules(state.rules)}</p>
      </div>

      {isHost && <HostPanel state={state} host={host} me={me} />}

      <div className="lobby-actions">
        {isHost ? (
          <button
            type="button"
            className="big-action"
            disabled={!canStart}
            onClick={() => host(C2S.START_GAME)}
          >
            Start game
          </button>
        ) : (
          <p className="waiting">Waiting for the host to start…</p>
        )}
        {isHost && !canStart && (
          <p className="hint">
            {state.players.length >= 2 ? 'Everyone must be connected to start.' : 'Need at least 2 players.'}
          </p>
        )}
      </div>

      {feed.length > 0 && (
        <div className="panel">
          <h3>Activity</h3>
          {feed.slice(-3).map((e, i) => (
            <div key={i} className="feed-line">
              {String(e.kind).replace(/([A-Z])/g, ' $1').toLowerCase()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
