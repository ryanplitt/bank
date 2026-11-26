import { useState, useEffect } from 'react';
import { describeRules } from '@bank/shared';
import { loadIdentity, clearIdentity } from '../session.js';
import { roomFromLocation } from '../links.js';

/**
 * First screen: create or join a room.
 *
 * - The host creates a room and is given a shareable link/code.
 * - A joiner enters their name and a code.
 * - If the browser already holds a session for that code (from a previous visit
 *   that disconnected for any reason), we offer to resume in place rather than
 *   re-joining as a fresh player.
 */
export default function JoinScreen({
  connected,
  create,
  join,
  resume,
  watch,
  onTvDisplay,
  onStartTv,
  error = null,
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCode(roomFromLocation());
  }, []);

  // Every action locks the form while it is in flight. A failed one (wrong
  // code, name taken, game full, expired session…) answers with an error and
  // never reaches a state change, so unlock here or the screen stays stuck on
  // "One moment…" until a refresh.
  useEffect(() => {
    if (error) setBusy(false);
  }, [error]);

  const resumeAvailable = code && loadIdentity(code);

  function doCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    create(name.trim());
  }

  function doJoin(e) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setBusy(true);
    const norm = code.trim().toUpperCase();
    const ident = loadIdentity(norm);
    if (ident) {
      // Returning player: resume under their existing identity.
      resume(norm, ident.playerId, ident.token);
    } else {
      join(name.trim(), norm);
    }
  }

  function doWatch(e) {
    e.preventDefault();
    const norm = code.trim().toUpperCase();
    if (!norm) return;
    setBusy(true);
    // No name, no seat, no session — just ride the room's broadcast read-only.
    watch(norm);
  }

  function doTvDisplay() {
    const norm = code.trim().toUpperCase();
    if (!norm || !onTvDisplay) return;
    setBusy(true);
    // This screen becomes the room's TV: read-only, no name, no seat.
    onTvDisplay(norm);
  }

  function doStartTv() {
    if (!onStartTv) return;
    setBusy(true);
    // This screen creates the room and shows it: no name, no seat. The first
    // phone to join the code becomes the host.
    onStartTv();
  }

  function doResume() {
    const norm = code.trim().toUpperCase();
    const ident = loadIdentity(norm);
    if (!ident) return;
    setBusy(true);
    resume(norm, ident.playerId, ident.token);
  }

  function doLeave() {
    // Forget the stored session so the next visit is a clean join.
    const norm = code.trim().toUpperCase();
    if (norm) clearIdentity(norm);
    setCode('');
    setBusy(false);
  }

  const pending = busy && connected === false ? 'Connecting…' : busy ? 'One moment…' : null;

  return (
    <div className="join">
      <h1 className="logo">BANK</h1>
      <p className="tagline">Push your luck. Bank before the 7.</p>

      {resumeAvailable && !busy ? (
        <div className="resume-card">
          <p>Welcome back — pick up where you left off in room <strong>{code}</strong>.</p>
          <button type="button" className="big-action" onClick={doResume}>
            Resume
          </button>
          <button type="button" className="linklike" onClick={doLeave}>
            Start over with a new name
          </button>
        </div>
      ) : (
        <form className="join-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            Your name
            <input
              value={name}
              maxLength={20}
              placeholder="e.g. Ryan"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Room code
            <input
              value={code}
              maxLength={6}
              placeholder="ABC234"
              autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>

          {pending && <div className="pending">{pending}</div>}

          <div className="join-actions">
            <button type="submit" className="big-action" disabled={busy} onClick={doJoin}>
              Join room
            </button>
            <button type="submit" className="secondary" disabled={busy} onClick={doCreate}>
              Host a new room
            </button>
          </div>

          {code.trim() && (
            <button
              type="button"
              className="watch-action"
              disabled={busy}
              onClick={(e) => doWatch(e)}
              title="Open the room link read-only — no seat taken, nothing to fill in"
            >
              👁 Watch a game
            </button>
          )}
        </form>
      )}

      {onStartTv && (
        <div className="tv-entry">
          <h2>On a TV or big screen?</h2>
          <p>
            Start the game right here. This screen only shows the game — everyone joins from their
            phone with the code, and the first to join becomes the host.
          </p>
          <button type="button" className="tv-action" disabled={busy} onClick={doStartTv}>
            📺 Start a game on this TV
          </button>
          {onTvDisplay && (
            <button
              type="button"
              className="linklike"
              disabled={busy || !code.trim()}
              onClick={doTvDisplay}
              title="Enter the room code above first"
            >
              or use this screen as the TV for room {code.trim() || '…'}
            </button>
          )}
        </div>
      )}

      <Credit rules={DEFAULT_RULES_SUMMARY} />
    </div>
  );
}

const DEFAULT_RULES_SUMMARY = describeRules({});

function Credit({ rules }) {
  return <p className="credit">Defaults: {rules}</p>;
}
