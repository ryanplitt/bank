/**
 * Sanitisation and validation of all untrusted input that crosses the socket
 * boundary. Every string that reaches the game layer passes through here so
 * names, codes and rule changes follow the same rules on both create and join.
 */

import { MAX_NAME_LENGTH, normalizeRules } from '@bank/shared';

const GAME_CODE_REGEX = /^[A-Z2-9]{6}$/i;

/**
 * Coerce a display name into a safe trimmed form, or null if it is unusable.
 *
 * Controls are stripped, surrounding whitespace removed, and the result capped
 * at MAX_NAME_LENGTH characters. Empty and whitespace-only names become null.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!stripped) return null;
  return stripped.slice(0, MAX_NAME_LENGTH);
}

/**
 * Normalise a room code to the canonical form: strip whitespace and uppercase.
 *
 * The client is expected to uppercase too, but the server must never trust that,
 * so this is authoritative.
 *
 * @param {unknown} raw
 * @returns {string | null} Normalised code, or null if not a plausible code.
 */
export function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/\s+/g, '').toUpperCase();
  if (!GAME_CODE_REGEX.test(code)) return null;
  return code;
}

/**
 * True when the value looks like a room code. The room manager will do the
 * definitive existence check; this only rejects obviously-garbage input.
 */
export function isPlausibleCode(raw) {
  return normalizeCode(raw) !== null;
}

/**
 * Coerce an unweighted array of zero or more strings into the set of safe
 * names the host wants. Invalid entries are dropped.
 *
 * @param {unknown} raw Players as sent by a host command.
 * @returns {string[]}
 */
export function sanitizeNameList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    const name = sanitizeName(entry);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Validate a rule object against the shared schema. Returns `{ valid: true,
 * rules }` on success or `{ valid: false, reason }` otherwise. Always clamps,
 * never throws.
 *
 * @param {unknown} raw
 * @returns {{ valid: boolean, rules?: object, reason?: string }}
 */
export function validateRules(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'rules must be an object' };
  }
  const rules = normalizeRules(raw);
  // Normalisation silently clamps hostile input; we treat a value outside the
  // allowed range as an explicit rejection so the host is told rather than
  // having their setting quietly changed under them.
  const keys = ['rounds', 'safeRolls', 'sevenBonus', 'rollIntervalSeconds'];
  for (const key of keys) {
    if (raw[key] !== undefined && rules[key] !== raw[key]) {
      return { valid: false, reason: `${key} is out of range` };
    }
  }
  // Booleans are validated separately (they are not range-clamped).
  if (raw.resetTimerOnBank !== undefined && typeof raw.resetTimerOnBank !== 'boolean') {
    return { valid: false, reason: 'resetTimerOnBank must be a boolean' };
  }
  return { valid: true, rules };
}
