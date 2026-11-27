import { useEffect, useRef, useState } from 'react';
import { reactionById } from '@bank/shared';

const BUBBLE_MS = 3600;
const CALLOUT_MS = 2400;

/** A stable pseudo-random 0..1 from an id, so a bubble's path never reshuffles. */
const unit = (id, salt) => {
  const x = Math.sin(id * 9301 + salt * 49297) * 233280;
  return x - Math.floor(x);
};

/**
 * Taunts, floating over everything. Each reaction rises up the screen as a big
 * emoji tagged with who sent it. Flip-offs and anything aimed at someone also
 * slap a callout across the middle ("Ryan 🖕 Brie — Up yours!"), and if it is
 * aimed at *you* your phone buzzes and the screen jolts.
 *
 * Reactions are held while the dice are tumbling, then released together: a 💀
 * landing before the reveal would give the roll away.
 */
export default function ReactionLayer({ reactions, rolling, meId, tv = false }) {
  const seen = useRef(reactions.at(-1)?.id ?? 0);
  const queue = useRef([]);
  const [active, setActive] = useState([]);
  const [jolt, setJolt] = useState(0);
  const timers = useRef([]);

  // Pick up new arrivals.
  useEffect(() => {
    const fresh = reactions.filter((r) => r.id > seen.current);
    if (fresh.length === 0) return;
    seen.current = reactions.at(-1).id;
    queue.current.push(...fresh);
    flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactions]);

  // Release anything held back once the dice have landed.
  useEffect(() => {
    if (!rolling) flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling]);

  function flush() {
    if (rolling && queue.current.length) return;
    const ready = queue.current.splice(0);
    if (ready.length === 0) return;
    setActive((prev) => [...prev, ...ready].slice(-14));
    for (const r of ready) {
      if (meId && r.targetId === meId) {
        setJolt((n) => n + 1);
        if (typeof navigator !== 'undefined') navigator.vibrate?.([90, 50, 90]);
      }
      timers.current.push(
        setTimeout(() => setActive((prev) => prev.filter((x) => x.id !== r.id)), BUBBLE_MS),
      );
    }
  }

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const callouts = active.filter((r) => r.reaction === 'flip' || r.targetId).slice(-2);

  return (
    <div className={`reaction-layer${tv ? ' reaction-layer--tv' : ''}`} aria-hidden="true">
      {jolt > 0 && <div className="reaction-jolt" key={jolt} />}

      {active.map((r) => {
        const def = reactionById(r.reaction);
        if (!def) return null;
        const left = 8 + unit(r.id, 1) * 80;
        const sway = (unit(r.id, 2) - 0.5) * 90;
        const size = r.reaction === 'flip' ? 1.5 : 1;
        return (
          <div
            key={r.id}
            className="reaction-bubble"
            style={{ left: `${left}%`, '--sway': `${sway}px`, '--grow': size }}
          >
            <span className="reaction-bubble-emoji">{def.emoji}</span>
            <span className="reaction-bubble-name">{r.from}</span>
          </div>
        );
      })}

      {callouts.map((r) => {
        const def = reactionById(r.reaction);
        if (!def) return null;
        const atMe = meId && r.targetId === meId;
        return (
          <div
            key={`c${r.id}`}
            className={`reaction-callout${r.reaction === 'flip' ? ' reaction-callout--flip' : ''}${
              atMe ? ' reaction-callout--at-me' : ''
            }`}
            style={{ animationDuration: `${CALLOUT_MS}ms` }}
          >
            <div className="reaction-callout-who">
              {r.from}
              {r.target ? <> → {atMe ? 'YOU' : r.target}</> : null}
            </div>
            <div className="reaction-callout-emoji">{def.emoji}</div>
            <div className="reaction-callout-text">{def.text}</div>
          </div>
        );
      })}
    </div>
  );
}
