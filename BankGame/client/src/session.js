/**
 * Client-side durable identity.
 *
 * On first join the server issues a playerId + HMAC token; we keep both in
 * localStorage keyed by room code. When this client reconnects (refresh, screen
 * unlock, network blip) it replays its playerId/token so the server rebinds the
 * socket to the same player — keeping score, in-round status and host role.
 *
 * Rooms live for minutes to hours, so an identity older than MAX_AGE_MS can only
 * point at a room that no longer exists. Old entries are pruned on every save so
 * the store cannot grow without bound across many games.
 */

const PREFIX = 'bank.session.';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function keyFor(code) {
  return `${PREFIX}${String(code || '').toUpperCase()}`;
}

function isStale(parsed) {
  return typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt > MAX_AGE_MS;
}

export function loadIdentity(code) {
  try {
    const raw = localStorage.getItem(keyFor(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.playerId !== 'string' || typeof parsed.token !== 'string') {
      return null;
    }
    if (isStale(parsed)) {
      localStorage.removeItem(keyFor(code));
      return null;
    }
    return { playerId: parsed.playerId, token: parsed.token };
  } catch {
    return null;
  }
}

/** Remove every stored identity that is malformed, undated or past MAX_AGE_MS. */
function pruneIdentities() {
  const doomed = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      if (!parsed || typeof parsed.savedAt !== 'number' || isStale(parsed)) doomed.push(key);
    } catch {
      doomed.push(key);
    }
  }
  for (const key of doomed) localStorage.removeItem(key);
}

export function saveIdentity(code, playerId, token) {
  try {
    pruneIdentities();
    localStorage.setItem(keyFor(code), JSON.stringify({ playerId, token, savedAt: Date.now() }));
  } catch {
    // Storage can be full or blocked (private mode); session identity degrades
    // gracefully to a fresh join next time.
  }
}

export function clearIdentity(code) {
  try {
    localStorage.removeItem(keyFor(code));
  } catch {
    // ignore
  }
}

/** True when a stored session exists for this room, so we can auto-resume. */
export function hasIdentity(code) {
  return loadIdentity(code) !== null;
}
