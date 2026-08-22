/**
 * Durable player identity.
 *
 * On first join the server issues a playerId (a fresh uuid) plus an HMAC token
 * derived from that id and the session secret. The client stores both in
 * localStorage and presents them on every connection. A reconnect therefore
 * rebinds the socket to the same player — score, host role and in-round status
 * all survive a refresh or a phone locking its screen.
 *
 * The token is what stops one person impersonating another: knowing someone's
 * playerId is not enough without the matching token. Tokens never touch the
 * state broadcast; they live only in the SESSION reply.
 *
 * Tokens are deliberately not tied to a room, so a returning player can be
 * admitted to a game they were invited back into.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

let secret = null;

/**
 * Install (or refresh) the session secret. Call once at boot with
 * process.env.SESSION_SECRET if provided, otherwise a random per-boot value.
 * In a single-instance deployment a random secret is fine — nothing persists
 * across restarts except client localStorage, and a restart invalidates those
 * tokens just like it clears in-memory rooms, which is consistent.
 */
export function configureSession(secretValue) {
  secret = String(secretValue || createSecret());
}

function createSecret() {
  return randomUUID() + randomUUID();
}

/** A fresh opaque player id. */
export function issuePlayerId() {
  return randomUUID();
}

function tokenFor(playerId) {
  if (!secret) configureSession();
  return createHmac('sha256', secret).update(String(playerId)).digest('base64url');
}

/** A session to hand to a freshly created or rejoining player. */
export function createSession(playerId) {
  return { playerId, token: tokenFor(playerId) };
}

/**
 * Verify an (id, token) pair issued earlier. Constant-time comparison so a
 * wrong token takes the same time as a right one.
 *
 * @param {string} playerId
 * @param {string} token
 * @returns {boolean}
 */
export function verifySession(playerId, token) {
  if (typeof playerId !== 'string' || typeof token !== 'string') return false;
  const expected = Buffer.from(tokenFor(playerId));
  try {
    const supplied = Buffer.from(token);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}
