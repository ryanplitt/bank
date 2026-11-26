import { useEffect } from 'react';
import RoundProgress from './RoundProgress.jsx';
import Pot from './Pot.jsx';
import DiceTray from './DiceTray.jsx';
import PotHistory, { recentRolls } from './PotHistory.jsx';
import Scoreboard from './Scoreboard.jsx';
import Countdown from './Countdown.jsx';
import QrInvite from './QrInvite.jsx';
import { joinUrl } from '../links.js';

/** Keep the TV from dimming or sleeping while the dashboard is up. */
function useKeepAwake() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.wakeLock) return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) next.release().catch(() => {});
        else lock = next;
      } catch {
        /* denied or unsupported: the screen may dim, nothing else breaks */
      }
    };
    // The lock is released whenever the tab is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) lock.release().catch(() => {});
    };
  }, []);
}

/**
 * The big-screen, read-only dashboard — what a laptop plugged into a TV shows
 * while everyone plays from their phone. In the lobby it is the invitation (room
 * code + QR + who's here); in play it is round progress, the pot, the dice, the
 * recent rolls and a large live leaderboard. No controls, no feed window.
 *
 * It is always a watcher, never a seat, so it can't be a player.
 */
export default function TvDashboard({ state, feed, rolling = false }) {
  const { round, rules, pot, lastRoll, players, phase } = state;
  const lastRolls = recentRolls(feed);
  const busted = phase === 'roundOver' && state.lastRoundResult?.reason === 'busted';
  const inLobby = phase === 'lobby';
  useKeepAwake();

  return (
    <div className="tv-dashboard">
      <header className="tv-top">
        <div className="tv-title">
          BANK
          <span className="tv-code">Room {state.code}</span>
        </div>
        {/* Deliberately tiny: the TV has nothing to click, but a laptop does. */}
        <a className="tv-exit" href="/" title="Leave the TV display">
          Exit
        </a>
      </header>

      {inLobby ? (
        <div className="tv-lobby">
          <div className="tv-join">
            <h2>Join on your phone</h2>
            <div className="tv-join-code">{state.code}</div>
            <QrInvite url={joinUrl(state.code)} />
          </div>
          <section className="tv-score">
            <h2>At the table ({players.length})</h2>
            {players.length === 0 && <p className="tv-waiting">Waiting for the first player…</p>}
            <Scoreboard players={players} me={null} phase={phase} />
          </section>
        </div>
      ) : (
        <>
          <RoundProgress
            round={round}
            total={rules.rounds}
            phase={phase}
            safeRolls={rules.safeRolls}
            rollNumber={state.rollNumber}
          />

          <PhaseBanner state={state} />

          <div className="tv-main">
            <div className="tv-dice-zone">
              <Pot value={pot} busted={busted} />
              <DiceTray lastRoll={lastRoll} rolling={rolling} />
              <div className="tv-roll-note">{lastRoll && !rolling ? rollNote(lastRoll) : ''}</div>
              {phase === 'playing' && (
                <Countdown nextRollAt={state.nextRollAt} totalMs={state.rollIntervalMs ?? rules.rollIntervalSeconds * 1000} />
              )}
              <PotHistory lastRolls={lastRolls} />
            </div>

            <section className="tv-score">
              <h2>Leaderboard</h2>
              <Scoreboard
                players={players}
                me={null}
                phase={phase}
                lastRoundResult={state.lastRoundResult}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function PhaseBanner({ state }) {
  if (state.phase === 'gameOver') {
    const winners = (state.players || []).filter((p) => state.winnerIds?.includes(p.id));
    const label =
      winners.length > 0 ? `${winners.map((p) => p.name).join(' and ')} win!` : 'Nobody banked — no winner.';
    return <div className="tv-banner tv-banner--win">🏁 {label}</div>;
  }
  if (state.phase === 'roundOver') {
    const result = state.lastRoundResult || {};
    return (
      <div className={`tv-banner ${result.reason === 'busted' ? 'tv-banner--bust' : ''}`}>
        {result.reason === 'busted'
          ? `💥 A 7 busted round ${state.round} — ${result.potLost ?? 0} lost.`
          : `🎉 Round ${state.round} complete.`}
      </div>
    );
  }
  return null;
}

function rollNote(lastRoll) {
  switch (lastRoll.kind) {
    case 'bust':
      return 'A 7 swept the pot!';
    case 'safeSeven':
      return 'Lucky 7 — safe roll pays the bonus.';
    case 'double':
      return 'Doubles doubled the pot!';
    default:
      return `Added ${lastRoll.sum} to the pot.`;
  }
}
