/**
 * Pot history strip — a compact rolling receipt of the round for the shared
 * screen (and a quiet ticker on phones).
 *
 * The state snapshot only carries the single most recent roll, so the entries
 * are derived client-side from the narration feed's 'roll' lines — which is
 * exactly what the feed exists for: every 'roll' entry already carries `dice`,
 * `rollKind`, `sum` and `potAfter`, no protocol or server change needed.
 *
 * Each chip shows what the roll scored (face sum, doubles, the safe 7 bonus,
 * or a bust) and the pot right after it, with a dashed connector joining the
 * chips left-to-right, oldest to newest. Mobile collapses it to a horizontal
 * scroll of small chips; on wide screens the chips open up with a pip preview.
 */

export default function PotHistory({ lastRolls }) {
  if (lastRolls.length === 0) return null;

  return (
    <div className="pot-history" role="list" aria-label="Pot history, oldest to newest">
      {lastRolls.map((entry, i) => (
        <div
          key={`${entry.rollNumber ?? i}-${entry.at ?? i}`}
          className="pot-history-chip"
          data-kind={entry.rollKind}
          role="listitem"
        >
          <span className="pot-history-pips" aria-hidden="true">
            {(entry.dice || []).map((value, j) => (
              <DiePreview key={j} value={value} />
            ))}
          </span>
          <span className="pot-history-main">{chipLabel(entry)}</span>
          <span className="pot-history-pot">pot {entry.potAfter}</span>
        </div>
      ))}
    </div>
  );
}

/** One-line scoring of a roll for the chip — mirrors RollFeed's wording. */
function chipLabel(entry) {
  switch (entry.rollKind) {
    case 'bust':
      return 'bust';
    case 'safeSeven':
      return '7⁺';
    case 'double':
      return `×2 ${entry.sum}`;
    default:
      return String(entry.sum);
  }
}

/** Tiny static die face (3×3 grid of pips) so each chip doubles as a
 *  thumbnail of the roll itself. */
function DiePreview({ value }) {
  const pips = PIP_LAYOUT[value] || [];
  return (
    <span className="pot-history-die" data-value={value}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`pot-history-pip ${pips.includes(i) ? 'is-on' : ''}`} />
      ))}
    </span>
  );
}

// Pip positions per face on the 3×3 grid.
const PIP_LAYOUT = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
