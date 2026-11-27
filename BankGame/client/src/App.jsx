import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from './state/useGame.js';
import { useRollReveal } from './state/useRollReveal.js';
import JoinScreen from './components/JoinScreen.jsx';
import Lobby from './components/Lobby.jsx';
import GameBoard from './components/GameBoard.jsx';
import TvDashboard from './components/TvDashboard.jsx';
import ReactionLayer from './components/ReactionLayer.jsx';
import { rememberTvDisplay, roomFromLocation, wantsTvDisplay } from './links.js';
import './styles.css';

export default function App() {
  const game = useGame();
  const { state, session, me, isHost, connected, lastError, dismissError, watching, watch, createTv } = game;

  // Hold the pot, scores and round results back until the dice finish rolling.
  // Only what's drawn is delayed; canBank and host commands use the live state.
  const view = useRollReveal(state, game.feed);

  // Is this tab a TV display? Set by a `?room=CODE&tv=1` link, by starting a game
  // on this screen, or by "Use this screen as the TV" on the join page. A TV is
  // always a read-only watcher: it never takes a seat, so it can't be a player.
  const [tvIntent, setTvIntent] = useState(() => wantsTvDisplay());
  const [urlRoom] = useState(() => roomFromLocation());
  const tvStarted = useRef(false);

  const joinAsTv = useCallback(
    (code) => {
      tvStarted.current = true;
      setTvIntent(true);
      watch(code, { tv: true });
    },
    [watch],
  );
  const startOnTv = useCallback(() => {
    tvStarted.current = true;
    setTvIntent(true);
    createTv();
  }, [createTv]);

  // Always connect on mount; reconnections happen automatically via the socket.
  const { connect } = game;
  useEffect(() => {
    connect();
  }, [connect]);

  // A `?room=CODE&tv=1` link is the TV on the wall: auto-attach read-only so
  // nobody has to type anything with a TV remote.
  useEffect(() => {
    if (!tvIntent || !urlRoom || tvStarted.current || session) return;
    tvStarted.current = true;
    watch(urlRoom, { tv: true });
  }, [tvIntent, urlRoom, session, watch]);

  // Once attached as a TV, make a refresh come back as the TV, not the join form.
  const attachedCode = state?.code;
  useEffect(() => {
    if (tvIntent && watching && attachedCode) rememberTvDisplay(attachedCode);
  }, [tvIntent, watching, attachedCode]);

  // A connected state snapshot means we're in — as a seated player (session)
  // or a read-only spectator (watching). Either way we wait for the snapshot
  // before rendering so an in-flight resume doesn't flash the join screen.
  const inGame = Boolean(state && (session || watching));
  const isSpectator = inGame && !session && watching;
  const showDashboard = isSpectator && tvIntent;

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

      {inGame && (
        <ReactionLayer
          reactions={game.reactions}
          rolling={view.rolling}
          meId={session?.playerId ?? null}
          tv={showDashboard}
        />
      )}

      {!inGame ? (
        <JoinScreen
          connected={connected}
          create={game.create}
          join={game.join}
          resume={game.resume}
          watch={watch}
          onTvDisplay={joinAsTv}
          onStartTv={startOnTv}
          error={lastError}
        />
      ) : showDashboard ? (
        <TvDashboard state={view.state} feed={view.feed} rolling={view.rolling} />
      ) : isSpectator ? (
        <GameBoard
          state={view.state}
          me={me}
          isHost={false}
          isSpectator
          canBank={false}
          feed={view.feed}
          rolling={view.rolling}
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
          state={view.state}
          me={me}
          isHost={isHost}
          canBank={game.canBank}
          react={game.react}
          feed={view.feed}
          rolling={view.rolling}
          bank={game.bank}
          host={game.host}
        />
      )}
    </div>
  );
}
