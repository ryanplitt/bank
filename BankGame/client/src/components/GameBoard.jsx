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
import PotHistory from './PotHistory.jsx';

/**
 * The narration feed kinds that briefly tint the whole board — a green flash
 * when someone banks, red when the 7 sweeps the pot. Everyone watches the
 * shared screen; the flash marks the moment without covering it.
 */
const FLASH_FEED_KINDS = new Set(['banked', 'roundBusted']);

/** How many of the feed's roll lines the pot-history strip shows. */
const POT_HISTORY_SIZE = 8;

/**
 * The main in-game view. Every player sees a compact header with round progress,
 * the pot, animated dice and a BANK button. The host additionally gets a full
 * dashboard and the "start next round" action. On desktop (the host's shared
 * screen, or anyone) the same view lays out into a roomier dashboard grid.
 */
export default function GameBoard({ state, me, isHost, canBank, feed, bank, host }) {
  const { round, rules, pot, lastRoll, nextRollAt, players, phase } = state;
  const roundOver = phase === 'roundOver';
  const busted = roundOver && state.lastRoundResult?.reason === 'busted';

  // Which round's bust reveal has already played out here. Storing the round
  // number rather than a boolean means the next bust re-arms the reveal without
  // needing to be reset, and a re-render can never replay one we've finished.
  const [revealedRound, setRevealedRound] = useState(null);
  // Stable per round, so an unrelated state push can't restart the reveal's
  // hand-off timer and strand the board on the bust screen.
  const endReveal = useCallback(() => setRevealedRound(round), [round]);
  // The reveal is a beat *before* the round-over screen, never a replacement:
  // once it has played, busted rounds land on RoundOver like any other.
  const showReveal = busted && revealedRound !== round;

  // The state snapshot only carries the newest roll; the history strip is
  // rebuilt from the narration feed's roll lines instead (the feed is the
  // cheap, always-kept per-roll history here). Newest last, capped.
  const lastRolls = feed.filter((e) => e.kind === 'roll').slice(-POT_HISTORY_SIZE);

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

  const boardClass = `board ${isHost ? 'board--host' : ''}`;

  if (phase === 'gameOver') {
    return <GameOver state={state} me={me} isHost={isHost} host={host} />;
  }

  return (
    <div className={boardClass} ref={boardRef}>
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
            <DiceTray lastRoll={lastRoll} />
            {lastRoll && <div className="roll-note">{rollNote(lastRoll)}</div>}
            <PotHistory lastRolls={lastRolls} />
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
