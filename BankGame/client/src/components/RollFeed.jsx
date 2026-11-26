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
  tvMode: ({ enabled }) => (enabled ? '📺 TV mode on' : '📺 TV mode off'),
};

function line(entry) {
  const fmt = KINDS[entry.kind];
  if (!fmt) return '';
  const name = entry.name || '';
  return fmt({ ...entry, name });
}

/** How many of the newest narration lines to show. The feed used to scroll in
 *  its own little window, which fought the page scroll on phones; now it is a
 *  plain, capped list of recent activity and the page itself scrolls. */
const FEED_VISIBLE_MAX = 12;

/** Append-only narration ticker, newest on top. */
export default function RollFeed({ feed }) {
  const newest = [...feed].slice(-FEED_VISIBLE_MAX).reverse();

  return (
    <div className="feed">
      {newest.length === 0 && <div className="feed-empty">The story of this game will appear here.</div>}
      {newest.map((entry, i) => (
        <div className="feed-line" key={entry.seq ?? `${entry.at ?? ''}-${i}`}>
          {line(entry)}
        </div>
      ))}
    </div>
  );
}
