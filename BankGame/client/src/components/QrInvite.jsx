import { useEffect, useRef, useState } from 'react';

/**
 * Lobby QR invite — a scannable code of the room's join URL, so guests open
 * their camera instead of typing the 6-char code.
 *
 * The QR library is imported and rendered lazily on mount, so the lobby paints
 * instantly and the code becomes scannable a beat after the host opens it —
 * the moment that matters. If the import or the render fails, the invite
 * falls back to a plain text link: it is never broken, just simpler.
 *
 * The component is hidden below 600px; phones stay on the copy-share-link
 * field above, and cramming a code into a cramped mobile lobby helps nobody.
 * Widths ~200px (4px quiet-zone modules) scan reliably on every phone camera.
 */
export default function QrInvite({ url }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    // The canvas is always mounted (below) so the ref is set by the time
    // effects run; guard anyway so a mid-flight teardown skips quietly.
    if (!url || !canvas) return undefined;

    let cancelled = false;

    (async () => {
      let QRCode;
      try {
        QRCode = (await import('qrcode')).default;
      } catch {
        // The library failed to load — fall back to the text link.
        if (!cancelled) setBroken(true);
        return;
      }
      try {
        await new Promise((resolve) => {
          QRCode.toCanvas(
            canvas,
            url,
            {
              width: 216,
              margin: 4, // module margins double as a decent quiet zone
              color: { dark: '#10141c', light: '#ffffff' },
            },
            (err) => {
              if (err && !cancelled) setBroken(true);
              resolve();
            },
          );
        });
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setBroken(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return null;

  return (
    <div className="qr-invite" data-qr-invite={broken ? 'fallback' : ready ? 'ready' : 'loading'}>
      <div className="qr-invite-text">
        <span className="qr-invite-label">Join this room from a phone</span>
        <span className="qr-invite-caption">Scan to join</span>
      </div>

      {/* Always mounted: StrictMode can otherwise run the encode effect before
          the element exists, which would paint a detached canvas. */}
      {broken ? (
        <a href={url} className="qr-invite-fallback">
          {url}
        </a>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className="qr-canvas"
            hidden={!ready}
            aria-label={ready ? `QR code for ${url}` : undefined}
          />
          {!ready && (
            // Reserve the space so the lobby doesn't jump when the code lands.
            <div className="qr-skeleton" aria-hidden="true" />
          )}
        </>
      )}
    </div>
  );
}
