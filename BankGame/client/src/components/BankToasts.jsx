import { useEffect, useRef, useState } from 'react';

const TOAST_MS = 2600;

/**
 * "💰 Ryan banked 76!" banners. Watches the (already reveal-delayed) feed for
 * new bank lines and slides one in per bank, so a bank is an event everyone
 * sees, not just a number that quietly changes. Lines already in the feed when
 * this mounts are history and never replay.
 */
export default function BankToasts({ feed, players }) {
  const seen = useRef(feed.at(-1)?.seq ?? 0);
  const [toasts, setToasts] = useState([]);
  const timers = useRef([]);

  useEffect(() => {
    const fresh = feed.filter((e) => e.kind === 'banked' && (e.seq ?? 0) > seen.current);
    seen.current = Math.max(seen.current, feed.at(-1)?.seq ?? 0);
    if (fresh.length === 0) return undefined;
    const added = fresh.map((e) => ({
      id: e.seq,
      text: `${players.find((p) => p.id === e.playerId)?.name ?? 'Someone'} banked ${e.amount}!`,
    }));
    setToasts((prev) => [...prev, ...added].slice(-3));
    // Not cleaned up when the feed moves on: the next feed line must not cancel
    // a toast's removal. They are cleared on unmount below.
    for (const t of added) {
      timers.current.push(
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), TOAST_MS),
      );
    }
    return undefined;
    // `players` is read only for names; a score change must not replay a toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="bank-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="bank-toast" key={t.id}>
          <span className="bank-toast-coin">💰</span> {t.text}
        </div>
      ))}
    </div>
  );
}
