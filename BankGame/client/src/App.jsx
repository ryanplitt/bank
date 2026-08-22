import { useEffect } from 'react';
import { useGame } from './state/useGame.js';
import JoinScreen from './components/JoinScreen.jsx';
import Lobby from './components/Lobby.jsx';
import GameBoard from './components/GameBoard.jsx';
import './styles.css';

export default function App() {
  const game = useGame();
  const { state, session, me, isHost, connected, lastError, dismissError } = game;

  // Always connect on mount; reconnections happen automatically via the socket.
  const { connect } = game;
  useEffect(() => {
    connect();
  }, [connect]);

  // A connected + session + state means we're in a game; otherwise show Join.
  // We wait for a state snapshot before deciding, so a resume that's in flight
  // doesn't flash the join screen.
  const inGame = Boolean(session && state);

  return (
    <div className="app">
      {!connected && (
        <div className="conn-banner">Connecting to server…</div>
      )}

      {lastError && (
        <div className="err-banner" onClick={dismissError}>
          {lastError.message}
        </div>
      )}

      {!inGame ? (
        <JoinScreen
          connected={connected}
          create={game.create}
          join={game.join}
          resume={game.resume}
        />
      ) : state.phase === 'lobby' ? (
        <Lobby
          state={state}
          me={me}
          isHost={isHost}
          connected={connected}
          feed={game.feed}
          host={game.host}
        />
      ) : (
        <GameBoard
          state={state}
          me={me}
          isHost={isHost}
          canBank={game.canBank}
          feed={game.feed}
          bank={game.bank}
          host={game.host}
        />
      )}
    </div>
  );
}
