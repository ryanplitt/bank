import { useEffect, useState } from 'react';
import { REACTIONS, REACTION_COOLDOWN_MS } from '@bank/shared';

/**
 * The heckle drawer: a row of reactions under BANK. Tap one to fire it at the
 * whole table; switch on "aim" and pick a player to fire it at them instead.
 * The middle finger is first in line, because of course it is.
 */
export default function ReactionTray({ players, me, react, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(null); // player id, or null = everyone
  const [cooling, setCooling] = useState(false);

  const others = players.filter((p) => p.id !== me?.id && p.name);
  // The player we were aiming at left: back to the whole table.
  const aimed = others.find((p) => p.id === target) ? target : null;

  useEffect(() => {
    if (!cooling) return undefined;
    const id = setTimeout(() => setCooling(false), REACTION_COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [cooling]);

  function fire(id) {
    if (cooling || disabled) return;
    react(id, aimed);
    setCooling(true);
  }

  return (
    <div className="reaction-tray">
      <button
        type="button"
        className="reaction-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        😈 {open ? 'Hide taunts' : 'Taunt'}
      </button>

      {open && (
        <div className="reaction-sheet">
          {others.length > 0 && (
            <div className="reaction-aim" role="group" aria-label="Aim at">
              <button
                type="button"
                className={`aim-chip${aimed === null ? ' is-on' : ''}`}
                onClick={() => setTarget(null)}
              >
                🎯 Everyone
              </button>
              {others.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`aim-chip${aimed === p.id ? ' is-on' : ''}`}
                  onClick={() => setTarget(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <div className="reaction-grid">
            {REACTIONS.map((r) => (
              <button
                type="button"
                key={r.id}
                className={`reaction-btn${r.id === 'flip' ? ' reaction-btn--flip' : ''}`}
                disabled={cooling || disabled}
                onClick={() => fire(r.id)}
                title={r.text}
              >
                <span className="reaction-emoji">{r.emoji}</span>
                <span className="reaction-label">{r.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
