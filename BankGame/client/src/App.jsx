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

  // A connected state snapshot means we're in — as a seated player (session)
  // or a read-only spectator (watching). Either way we wait for the snapshot
  // before rendering so an in-flight resume doesn't flash the join screen.
  const inGame = Boolean(state && (session || game.watching));
  // Spectators always get the board (in any phase — the countdown and rounds
  // are the show) with their read-only chrome; they never see the lobby
  // controls or get a roster entry.
  const isSpectator = inGame && !session && game.watching;

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
          watch={game.watch}
        />
      ) : isSpectator ? (
        <GameBoard
          state={state}
          me={me}
          isHost={false}
          isSpectator
          canBank={false}
          feed={game.feed}
          bank={game.bank}
          host={game.host}
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
