import { useEffect, useMemo, useState } from 'react';

const COLORS = ['#f4c542', '#2ecc71', '#e74c3c', '#4aa3ff', '#c77dff', '#ffffff'];

/**
 * A one-shot burst of confetti that falls over the whole screen and removes
 * itself. Pure CSS motion; every piece gets its own position, size, colour,
 * delay and spin from a handful of custom properties.
 */
export default function Confetti({ pieces = 48, ms = 4500 }) {
  const [alive, setAlive] = useState(true);
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        size: 6 + Math.random() * 8,
        delay: Math.random() * 0.9,
        fall: 2.4 + Math.random() * 1.8,
        drift: (Math.random() - 0.5) * 160,
        spin: 360 + Math.random() * 720,
        color: COLORS[i % COLORS.length],
      })),
    [pieces],
  );

  useEffect(() => {
    const id = setTimeout(() => setAlive(false), ms);
    return () => clearTimeout(id);
  }, [ms]);

  if (!alive) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b) => (
        <span
          key={b.id}
          className="confetti-bit"
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.size * 0.45,
            background: b.color,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.fall}s`,
            '--drift': `${b.drift}px`,
            '--spin': `${b.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}
