import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from './state/useGame.js';
import JoinScreen from './components/JoinScreen.jsx';
import Lobby from './components/Lobby.jsx';
import GameBoard from './components/GameBoard.jsx';
import TvDashboard from './components/TvDashboard.jsx';
import { rememberTvDisplay, roomFromLocation, wantsTvDisplay } from './links.js';
import './styles.css';

export default function App() {
  const game = useGame();
  const { state, session, me, isHost, connected, lastError, dismissError, watching, watch } = game;

  // The room this tab is the TV display for, or ''. Set by a `?room=CODE&tv=1`
  // link or by "Use as TV display" on the join screen. A TV display is always a
  // read-only watcher: it never takes a seat, so it can't be a player.
  const [tvRoom, setTvRoom] = useState(() => (wantsTvDisplay() ? roomFromLocation() : ''));
  const tvStarted = useRef(false);

  const startTvDisplay = useCallback(
    (code) => {
      tvStarted.current = true;
      setTvRoom(code);
      rememberTvDisplay(code); // a refresh comes back as the TV, not the join form
      watch(code);
    },
    [watch],
  );

  // Always connect on mount; reconnections happen automatically via the socket.
  const { connect } = game;
  useEffect(() => {
    connect();
  }, [connect]);

  // A `?tv=1` link is the TV on the wall: auto-attach read-only so nobody has
  // to type a name or press "Watch a game" with a TV remote.
  useEffect(() => {
    if (!tvRoom || tvStarted.current || session) return;
    tvStarted.current = true;
    watch(tvRoom);
  }, [tvRoom, session, watch]);

  // A connected state snapshot means we're in — as a seated player (session)
  // or a read-only spectator (watching). Either way we wait for the snapshot
  // before rendering so an in-flight resume doesn't flash the join screen.
  const inGame = Boolean(state && (session || watching));
  const isSpectator = inGame && !session && watching;
  const showDashboard = isSpectator && Boolean(tvRoom);

  return (
    <div className={showDashboard ? 'app app--tv' : 'app'}>
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
          watch={watch}
          onTvDisplay={startTvDisplay}
          error={lastError}
        />
      ) : showDashboard ? (
        <TvDashboard state={state} feed={game.feed} />
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
