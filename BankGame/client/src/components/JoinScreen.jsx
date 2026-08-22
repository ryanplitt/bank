import { useState, useEffect } from 'react';
import { describeRules } from '@bank/shared';
import { loadIdentity, clearIdentity } from '../session.js';

/**
 * First screen: create or join a room.
 *
 * - The host creates a room and is given a shareable link/code.
 * - A joiner enters their name and a code.
 * - If the browser already holds a session for that code (from a previous visit
 *   that disconnected for any reason), we offer to resume in place rather than
 *   re-joining as a fresh player.
 */
export default function JoinScreen({ connected, create, join, resume }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  function guessCodeFromLocation() {
    const m = /[?&]room=([A-Za-z0-9]{4,8})/.exec(window.location.search || '');
    return m ? m[1].toUpperCase() : '';
  }

  useEffect(() => {
    setCode(guessCodeFromLocation());
  }, []);

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
            <button type="button" className="secondary" disabled={busy} onClick={doCreate}>
              Host a new room
            </button>
          </div>
        </form>
      )}

      <Credit rules={DEFAULT_RULES_SUMMARY} />
    </div>
  );
}

const DEFAULT_RULES_SUMMARY = describeRules({});

function Credit({ rules }) {
  return <p className="credit">Defaults: {rules}</p>;
}
