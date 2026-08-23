import { useState } from 'react';
import {
  C2S,
  DOUBLES_MODES,
  RULE_LIMITS,
} from '@bank/shared';

/**
 * Host dashboard — the host's command centre behind a disclosure so the playing
 * view stays clean on their own phone. Rule edits are staged locally and applied
 * on "Apply"; the server is the authority both for validation and for *who* may
 * call these (re-checked even though these controls only show for the host).
 *
 * The most important host action between rounds — "Start next round" — lives
 * prominently on the RoundOver screen, not buried here.
 */
export default function HostPanel({ state, me, host }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => ({ ...state.rules }));

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value) }));
  const applyRules = () => host(C2S.UPDATE_RULES, { rules: draft });

  return (
    <details className="host-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>🎛 Host dashboard</summary>
      <div className="host-body">
        <div className="host-actions">
          <button type="button" onClick={() => host(C2S.FORCE_ROLL)}>Roll now</button>
          <button type="button" onClick={() => host(C2S.SET_PAUSED, { paused: !state.paused })}>
            {state.paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button type="button" className="danger" onClick={() => host(C2S.END_GAME)}>
            End game
          </button>
        </div>

        <fieldset disabled={state.phase !== 'lobby'}>
          <legend>Rules (lobby only)</legend>
          {ruleFields(draft, set, setDraft)}
          <button type="button" onClick={applyRules}>Apply rules</button>
        </fieldset>

        {(state.players || []).length > 1 && (
          <PlayerControls players={state.players} me={me} host={host} />
        )}
      </div>
    </details>
  );
}

function ruleFields(draft, set, setDraft) {
  return (
    <>
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
      <label className="rule-check">
        <input
          type="checkbox"
          checked={Boolean(draft.resetTimerOnBank)}
          onChange={(e) => setDraft((d) => ({ ...d, resetTimerOnBank: e.target.checked }))}
        />
        Reset countdown when someone banks
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
    </>
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
