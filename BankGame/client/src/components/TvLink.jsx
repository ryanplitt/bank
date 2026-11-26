import { useState } from 'react';
import { tvUrl } from '../links.js';

/**
 * The host's "put this on a TV" card.
 *
 * A TV display is a separate screen (a laptop plugged into a TV, say) that
 * opens the link below and becomes a read-only dashboard: it takes no seat and
 * never counts as a player. While one is connected the server reports
 * `tvPresent` and phones simplify themselves — there is nothing to switch on.
 */
export default function TvLink({ state }) {
  const [copied, setCopied] = useState(false);
  const url = tvUrl(state.code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (non-secure context); the field stays selectable */
    }
  }

  return (
    <div className="tv-link">
      <div className="tv-link-head">
        <strong>📺 TV display</strong>
        <span className="tv-link-sub">
          {state.tvPresent ? 'connected ✓' : 'nothing connected yet'}
        </span>
      </div>
      <p className="tv-link-help">
        On the laptop or TV browser, open this link (or choose &ldquo;Use this screen as the TV display&rdquo;
        on the join page and enter <strong>{state.code}</strong>). It only shows the game — it never
        joins as a player. While a TV is connected, everyone&apos;s phone switches to a simple controller
        view automatically.
      </p>
      <p className="share-field" onClick={copy} title="Click to copy">
        {copied ? 'Copied!' : url}
      </p>
    </div>
  );
}
