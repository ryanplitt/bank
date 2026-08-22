/**
 * Client-side durable identity.
 *
 * On first join the server issues a playerId + HMAC token; we keep both in
 * localStorage keyed by room code. When this client reconnects (refresh, screen
 * unlock, network blip) it replays its playerId/token so the server rebinds the
 * socket to the same player — keeping score, in-round status and host role.
 */

const PREFIX = 'bank.session.';

function keyFor(code) {
  return `${PREFIX}${String(code || '').toUpperCase()}`;
}

export function loadIdentity(code) {
  try {
    const raw = localStorage.getItem(keyFor(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.playerId !== 'string' || typeof parsed.token !== 'string') {
      return null;
    }
    return { playerId: parsed.playerId, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveIdentity(code, playerId, token) {
  try {
    localStorage.setItem(keyFor(code), JSON.stringify({ playerId, token }));
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
