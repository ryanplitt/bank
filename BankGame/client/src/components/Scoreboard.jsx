import { useLayoutEffect, useRef } from 'react';
import { useCountUp } from '../state/useCountUp.js';

/**
 * Per-player standing: name, total score, in-round/banked-out status, presence.
 * The host badge and a "you" marker make it read well around a table of phones.
 *
 * During a round it highlights who is still in; after a round it shows what
 * each banker collected. During gameOver it doubles as the final leaderboard.
 */
export default function Scoreboard({ players, me, phase, lastRoundResult }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const busted = lastRoundResult && lastRoundResult.reason === 'busted';
  const rowRefs = useRef(new Map());
  const lastTops = useRef(new Map());

  // FLIP: when a bank reshuffles the standings, slide each row from where it
  // was to where it now is instead of teleporting.
  const order = sorted.map((p) => p.id).join(',');
  useLayoutEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tops = new Map();
    for (const [id, el] of rowRefs.current) {
      if (!el) continue;
      const top = el.offsetTop;
      tops.set(id, top);
      const before = lastTops.current.get(id);
      if (!reduce && before !== undefined && before !== top) {
        el.style.transition = 'none';
        el.style.transform = `translateY(${before - top}px)`;
        void el.offsetWidth; // commit the starting position
        el.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.9, 0.3, 1)';
        el.style.transform = '';
      }
    }
    lastTops.current = tops;
  }, [order]);

  return (
    <div className="scoreboard">
      {sorted.map((p, i) => (
        <PlayerRow
          key={p.id}
          p={p}
          rank={i + 1}
          mine={p.id === me?.id}
          status={roundState(p, phase, busted)}
          rowRef={(el) => {
            if (el) rowRefs.current.set(p.id, el);
            else rowRefs.current.delete(p.id);
          }}
        />
      ))}
    </div>
  );
}

function PlayerRow({ p, rank, mine, status, rowRef }) {
  const { shown, gain } = useCountUp(p.score);
  return (
    <div
      ref={rowRef}
      className={`row ${mine ? 'you' : ''}`}
    >
      {/* Keyed per gain so the glow replays on every bank, without remounting
          the row (which would cancel its slide to a new rank). */}
      {gain && <span className="row-glow" key={gain.id} aria-hidden="true" />}
      <span className="rank">{rank}</span>
      <span className="name">
        {p.name}
        {p.host && (
          <span className="badge host" title="host">
            host
          </span>
        )}
        {mine && <span className="badge you-badge">you</span>}
        {!p.connected && (
          <span className="badge away" title="disconnected">
            ⋯
          </span>
        )}
      </span>
      <span className="state">{status}</span>
      <span className="score">
        {shown}
        {gain && (
          <span className="score-float" key={gain.id} aria-hidden="true">
            +{gain.delta}
          </span>
        )}
      </span>
    </div>
  );
}

function roundState(p, phase, busted) {
  if (phase === 'lobby') return ''; // nobody is in or out until the game starts
  const banked = p.bankedThisRound !== null;
  if (phase === 'gameOver') {
    if (p.score > 0) {
      return banked ? `final·+${bankedAmount(p)}` : 'final';
    }
    return '';
  }
  if (phase === 'playing') {
    if (p.inRound) return 'in';
    if (banked) return `banked +${p.bankedThisRound}`;
    return 'out';
  }
  // roundOver: what each player walked away with this round.
  if (busted) {
    return banked ? `banked +${p.bankedThisRound}` : 'busted 💥';
  }
  return banked ? `banked +${p.bankedThisRound}` : 'out';
}

function bankedAmount(p) {
  return p.bankedThisRound ?? 0;
}

