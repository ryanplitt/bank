import { useCallback, useEffect, useRef, useState } from 'react';

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
import PotHistory, { recentRolls } from './PotHistory.jsx';
import { isBankingLocked } from '@bank/shared';

/**
 * The narration feed kinds that briefly tint the whole board — a green flash
 * when someone banks, red when the 7 sweeps the pot. Everyone watches the
 * shared screen; the flash marks the moment without covering it.
 */
const FLASH_FEED_KINDS = new Set(['banked', 'roundBusted']);

/**
 * The main in-game view. Every player sees a compact header with round progress,
 * the pot, animated dice and a BANK button. The host additionally gets a full
 * dashboard and the "start next round" action. On desktop (the host's shared
 * screen, or anyone) the same view lays out into a roomier dashboard grid.
 */
export default function GameBoard({ state, me, isHost, canBank, feed, bank, host, isSpectator = false }) {
  const { round, rules, pot, lastRoll, nextRollAt, players, phase } = state;
  const roundOver = phase === 'roundOver';
  const busted = roundOver && state.lastRoundResult?.reason === 'busted';
  // The "no banking during safe rolls" rule locks the button until the last
  // safe roll has landed (same shared check the server enforces).
  const bankingLocked = phase === 'playing' && isBankingLocked(rules, state.rollNumber);
  // While a TV display is connected, seated phones become controllers: the TV
  // carries the dice, history, scoreboard and feed, so the phone keeps only the
  // pot, your own score, the countdown and BANK.
  const compact = Boolean(state.tvPresent && !isSpectator);
  const myScore = players.find((p) => p.id === me?.id)?.score;

  // Which round's bust reveal has already played out here. Storing the round
  // number rather than a boolean means the next bust re-arms the reveal without
  // needing to be reset, and a re-render can never replay one we've finished.
  // Arriving (or resuming) onto a round that already busted counts as seen:
  // replaying a 3-second "SEVEN!" for something that happened a minute ago
  // only delays the host's start-next-round button.
  const [revealedRound, setRevealedRound] = useState(() => (busted ? round : null));
  // Spectators keep this board mounted across games, and round numbers repeat,
  // so a new lobby re-arms the reveal.
  useEffect(() => {
    if (phase === 'lobby') setRevealedRound(null);
  }, [phase]);
  // Stable per round, so an unrelated state push can't restart the reveal's
  // hand-off timer and strand the board on the bust screen.
  const endReveal = useCallback(() => setRevealedRound(round), [round]);
  // The reveal is a beat *before* the round-over screen, never a replacement:
  // once it has played, busted rounds land on RoundOver like any other.
  const showReveal = busted && revealedRound !== round;

  // The state snapshot only carries the newest roll; the history strip is
  // rebuilt from the narration feed's roll lines instead (the feed is the
  // cheap, always-kept per-roll history here). Newest last, capped.
  const lastRolls = recentRolls(feed);

  // Round drama flash: the newest feed line being a bank or a bust briefly
  // tints the whole board. Same animation-restart trick as Pot's pulse —
  // class off, forced reflow, class on — so every event re-triggers it.
  const boardRef = useRef(null);
  // Keys off the whole `feed`: every new narration line gets a fresh array
  // identity, so the longest-history check re-runs for each of them; lines
  // that aren't banks/busts exit the guard before touching the DOM.
  useEffect(() => {
    const latest = feed.length > 0 ? feed[feed.length - 1] : null;
    if (!latest || !FLASH_FEED_KINDS.has(latest.kind)) return;
    const el = boardRef.current;
    if (!el) return;
    const variant = latest.kind === 'roundBusted' ? 'bust' : 'bank';
    el.classList.remove('board-flash--bank', 'board-flash--bust');
    // Force a reflow so the re-add restarts the animation.
    void el.offsetWidth;
    el.classList.add(`board-flash--${variant}`);
  }, [feed]);

  if (phase === 'gameOver') {
    return <GameOver state={state} me={me} isHost={isHost} host={host} />;
  }

  return (
    <div
      className={`board${isHost ? ' board--host' : ''}${isSpectator ? ' is-spectator' : ''}`}
      ref={boardRef}
    >
      {isSpectator && (
        <div className="spectator-banner">
          <span className="spectator-title">You&apos;re watching 📡</span>
          <span className="spectator-meta">
            {state.spectatorCount - 1} other watcher{state.spectatorCount - 1 === 1 ? '' : 's'} · read-only · the scoreboard below is live
          </span>
        </div>
      )}
      <header className="board-head">
        <RoundProgress
          round={round}
          total={rules.rounds}
          phase={phase}
          safeRolls={rules.safeRolls}
          rollNumber={state.rollNumber}
        />
        {state.paused && <div className="paused-chip">⏸ paused</div>}
      </header>

      {showReveal ? (
        <BustReveal key={round} state={state} onDone={endReveal} />
      ) : roundOver ? (
        <RoundOver state={state} isHost={isHost} host={host} />
      ) : (
        <div className="board-main">
          <div className="dice-zone">
            <Pot value={pot} />
            {compact ? (
              typeof myScore === 'number' && (
                <div className="my-score">
                  Your score <strong>{myScore}</strong>
                </div>
              )
            ) : (
              <>
                <DiceTray lastRoll={lastRoll} />
                {lastRoll && <div className="roll-note">{rollNote(lastRoll)}</div>}
                <PotHistory lastRolls={lastRolls} />
              </>
            )}
          </div>

          {phase === 'playing' && (
            <Countdown nextRollAt={nextRollAt} totalMs={state.rollIntervalMs ?? rules.rollIntervalSeconds * 1000} />
          )}

          {/* A spectator's BANK button exists only to say "not for you": muted,
              disabled on purpose, explicit that the countdown keeps rolling
              without them. */}
          <BankButton
            disabled={isSpectator}
            canBank={isSpectator ? false : canBank}
            pot={pot}
            hint={
              isSpectator
                ? 'read-only for spectators'
                : bankingLocked
                  ? `banking unlocks after roll ${rules.safeRolls}`
                  : undefined
            }
            onClick={bank}
          />
        </div>
      )}

      {isHost && (
        <HostPanel state={state} host={host} me={me} />
      )}

      {!compact && (
        <section className="panel">
          <h3>Scores</h3>
          <Scoreboard
            players={players}
            me={me}
            phase={phase}
            lastRoundResult={state.lastRoundResult}
          />
        </section>
      )}

      {!compact && (
        <section className="panel">
          <h3>Feed</h3>
          <RollFeed feed={feed} />
        </section>
      )}
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
