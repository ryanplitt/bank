import { useEffect, useRef } from 'react';

const KINDS = {
  playerJoined: ({ name }) => `${name} joined`,
  playerLeft: ({ name }) => `${name} disconnected`,
  playerRejoined: () => `reconnected`,
  playerKicked: ({ name }) => `${name} was kicked`,
  playerRenamed: ({ name }) => `now known as ${name}`,
  hostChanged: ({ name }) => `👑 ${name} is now host`,
  gameStarted: () => 'Game on! 🎉',
  roundStarted: ({ round }) => `Round ${round} begins`,
  roundEnded: ({ round }) => `Round ${round} over`,
  roundBusted: ({ potLost }) => `💥 7! Pot of ${potLost} is lost`,
  roll: ({ dice, sum, rollKind, potAfter }) => {
    const label =
      rollKind === 'bust'
        ? '7 — wiped!'
        : rollKind === 'safeSeven'
          ? 'lucky 7'
          : rollKind === 'double'
            ? 'doubles ♠♠'
            : `rolled ${sum}`;
    return `${label} · ${dice[0]} ${dice[1]} → pot ${potAfter}`;
  },
  banked: ({ name, amount, total }) => `${name} banked ${amount} → ${total}`,
  scoreAdjusted: ({ name, total }) => `${name} score is now ${total}`,
  gameOver: () => 'Game over 🏁',
  paused: () => '⏸ paused',
  resumed: () => '▶ resumed',
};

function line(entry) {
  const fmt = KINDS[entry.kind];
  if (!fmt) return '';
  const name = entry.name || '';
  return fmt({ ...entry, name });
}

/** Append-only narration ticker, newest on top and auto-scrolled to newest. */
export default function RollFeed({ feed }) {
  const ref = useRef(null);
  const newest = [...feed].reverse();

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [feed.length]);

  return (
    <div className="feed" ref={ref}>
      {newest.length === 0 && <div className="feed-empty">The story of this game will appear here.</div>}
      {newest.map((entry, i) => (
        <div className="feed-line" key={newest.length - i}>
          {line(entry)}
        </div>
      ))}
    </div>
  );
}
