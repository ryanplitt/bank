import { useState } from 'react';
import {
  C2S,
  DOUBLES_MODES,
  RULE_LIMITS,
} from '@bank/shared';

/**
 * Host controls behind a disclosure so it doesn't clutter the host's own play
 * view. Rule edits are staged locally and applied on "Apply"; the server is the
 * authority both for validation and for *who* may call these (re-checked even
 * though the button only appears for the host).
 */
export default function HostPanel({ state, me, host }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => ({ ...state.rules }));

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value) }));

  const applyRules = () => host(C2S.UPDATE_RULES, { rules: draft });

  return (
    <details className="host-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Host controls</summary>
      <div className="host-body">
        <fieldset disabled={state.phase !== 'lobby'}>
          <legend>Rules (lobby only)</legend>
          <label>
            Rounds
            <input
              type="number"
              value={draft.rounds}
              min={RULE_LIMITS.rounds.min}
              max={RULE_LIMITS.rounds.max}
              onChange={set('rounds')}
            />
          </label>
          <label>
            Safe rolls
            <input
              type="number"
              value={draft.safeRolls}
              min={RULE_LIMITS.safeRolls.min}
              max={RULE_LIMITS.safeRolls.max}
              onChange={set('safeRolls')}
            />
          </label>
          <label>
            Seven bonus
            <input
              type="number"
              value={draft.sevenBonus}
              min={RULE_LIMITS.sevenBonus.min}
              max={RULE_LIMITS.sevenBonus.max}
              onChange={set('sevenBonus')}
            />
          </label>
          <label>
            Seconds per roll
            <input
              type="number"
              value={draft.rollIntervalSeconds}
              min={RULE_LIMITS.rollIntervalSeconds.min}
              max={RULE_LIMITS.rollIntervalSeconds.max}
              onChange={set('rollIntervalSeconds')}
            />
          </label>
          <label>
            Doubles during safe rolls
            <select
              value={draft.doublesDuringSafeRolls}
              onChange={(e) => setDraft((d) => ({ ...d, doublesDuringSafeRolls: e.target.value }))}
            >
              {DOUBLES_MODES.map((m) => (
                <option key={m} value={m}>
                  {m === 'double' ? 'Double the pot' : 'Add their sum'}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={applyRules}>Apply rules</button>
        </fieldset>

        <div className="host-actions">
          <button type="button" onClick={() => host(C2S.FORCE_ROLL)}>Force roll</button>
          <button type="button" onClick={() => host(C2S.FORCE_END_ROUND)}>Force end round</button>
          <button type="button" onClick={() => host(C2S.END_GAME)}>End game now</button>
          <button type="button" onClick={() => host(C2S.SET_PAUSED, { paused: !state.paused })}>
            {state.paused ? 'Resume' : 'Pause'}
          </button>
        </div>

        {(state.players || []).length > 1 && (
          <PlayerControls players={state.players} me={me} host={host} />
        )}
      </div>
    </details>
  );
}

function PlayerControls({ players, me, host }) {
  const [sel, setSel] = useState('');
  const other = players.filter((p) => p.id !== me.id);
  return (
    <div className="player-controls">
      <select value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="" disabled>Pick a player…</option>
        {other.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <div className="player-actions">
        <button
          type="button"
          disabled={!sel}
          onClick={() => host(C2S.RENAME_PLAYER, { playerId: sel, name: prompt('New name:') ?? undefined })}
        >
          Rename
        </button>
        <button
          type="button"
          disabled={!sel}
          onClick={() => host(C2S.KICK_PLAYER, { playerId: sel })}
        >
          Kick
        </button>
        <button
          type="button"
          disabled={!sel}
          onClick={() => {
            const n = Number(prompt('Delta (e.g. 50 or -100):'));
            if (Number.isFinite(n)) host(C2S.ADJUST_SCORE, { playerId: sel, delta: n });
          }}
        >
          Adjust score
        </button>
        <button
          type="button"
          disabled={!sel}
          onClick={() => host(C2S.TRANSFER_HOST, { playerId: sel })}
        >
          Make host
        </button>
      </div>
    </div>
  );
}
