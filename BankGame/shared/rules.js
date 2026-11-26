/**
 * Rule configuration for a game of Bank, shared by client and server.
 *
 * The client uses RULE_LIMITS to render the host's controls; the server uses
 * normalizeRules() as the authority. Keeping both in one file is what stops
 * the two from drifting apart.
 */

export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 2;
/** Soft cap on read-only watchers attached to one room. A plain integer on
 *  the room; it never counts against the player cap. */
export const MAX_SPECTATORS = 40;
export const MAX_NAME_LENGTH = 20;
export const GAME_CODE_LENGTH = 6;

/**
 * How doubles behave during the "safe" opening rolls of a round.
 * - 'sum'    : doubles just add their face sum, like any other roll.
 * - 'double' : doubles double the pot even this early (faster, swingier).
 */
export const DOUBLES_MODES = ['sum', 'double'];

export const DEFAULT_RULES = Object.freeze({
  /** Number of rounds in a game. */
  rounds: 10,
  /** How many opening rolls of each round are "safe" from a 7. */
  safeRolls: 3,
  /** Points a 7 contributes during the safe rolls. */
  sevenBonus: 70,
  /** Behaviour of doubles during the safe rolls. See DOUBLES_MODES. */
  doublesDuringSafeRolls: 'double',
  /** Seconds between automatic rolls; the banking window. */
  rollIntervalSeconds: 5,
  /** Whether banking resets the shared countdown for everyone (false = one
   *  fixed deadline that everyone races against). */
  resetTimerOnBank: false,
  /** Whether the BANK button is locked while the round is still inside its
   *  opening safe rolls (rollNumber < safeRolls). */
  noBankingDuringSafeRolls: true,
});

/**
 * How long clients show the dice tumbling before the pot, scores and results
 * appear. The server starts the next countdown only after this, so the full
 * banking window begins once the player can actually see the new pot.
 */
export const ROLL_REVEAL_MS = 1000;

/**
 * Gap, counted from when the pot is revealed, before the next automatic roll
 * that is still inside the safe window. A safe roll can't bust, so there is
 * nothing to decide and no reason to wait the full rollIntervalSeconds.
 */
export const SAFE_ROLL_INTERVAL_MS = 1000;

export const RULE_LIMITS = Object.freeze({
  rounds: { min: 1, max: 30 },
  safeRolls: { min: 0, max: 10 },
  sevenBonus: { min: 0, max: 500 },
  rollIntervalSeconds: { min: 3, max: 60 },
});

function clampInt(value, fallback, { min, max }) {
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Whether the "no banking during safe rolls" rule is blocking banking right now.
 *
 * The single definition used by the engine, the room and every client, so the
 * BANK button and the server can never disagree about the boundary: safe rolls
 * are 1..safeRolls, so the lock lifts the moment roll #safeRolls has landed
 * (rollNumber === safeRolls), when the next roll is the first dangerous one.
 * Callers still check the phase and the pot themselves.
 *
 * @param {object} [rules] The room's rules.
 * @param {number} [rollNumber] Rolls so far this round.
 */
export function isBankingLocked(rules, rollNumber) {
  return Boolean(
    rules &&
      rules.noBankingDuringSafeRolls &&
      Number.isFinite(rollNumber) &&
      Number.isFinite(rules.safeRolls) &&
      rollNumber < rules.safeRolls,
  );
}

/**
 * Coerce arbitrary (untrusted) input into a valid rule set.
 *
 * Never throws and never returns an out-of-range value: unknown keys are
 * dropped and bad values fall back to the default, so a malicious or buggy
 * client cannot put the engine into an impossible configuration.
 *
 * @param {object} [partial] Candidate rules, possibly partial or garbage.
 * @param {object} [base] Rules to layer on top of (defaults to DEFAULT_RULES).
 * @returns {object} A complete, valid, frozen rule set.
 */
export function normalizeRules(partial, base = DEFAULT_RULES) {
  const input = partial && typeof partial === 'object' ? partial : {};
  const start = { ...DEFAULT_RULES, ...base };

  const doublesMode = DOUBLES_MODES.includes(input.doublesDuringSafeRolls)
    ? input.doublesDuringSafeRolls
    : start.doublesDuringSafeRolls;

  const resetTimerOnBank =
    typeof input.resetTimerOnBank === 'boolean'
      ? input.resetTimerOnBank
      : start.resetTimerOnBank;

  const noBankingDuringSafeRolls =
    typeof input.noBankingDuringSafeRolls === 'boolean'
      ? input.noBankingDuringSafeRolls
      : start.noBankingDuringSafeRolls;

  return Object.freeze({
    rounds: clampInt(input.rounds, start.rounds, RULE_LIMITS.rounds),
    safeRolls: clampInt(input.safeRolls, start.safeRolls, RULE_LIMITS.safeRolls),
    sevenBonus: clampInt(input.sevenBonus, start.sevenBonus, RULE_LIMITS.sevenBonus),
    doublesDuringSafeRolls: doublesMode,
    rollIntervalSeconds: clampInt(
      input.rollIntervalSeconds,
      start.rollIntervalSeconds,
      RULE_LIMITS.rollIntervalSeconds,
    ),
    resetTimerOnBank,
    noBankingDuringSafeRolls,
  });
}

/**
 * Human-readable one-line summary of a rule set, for the lobby.
 * @param {object} rules
 * @returns {string}
 */
export function describeRules(rules) {
  const r = normalizeRules(rules);
  const doubles =
    r.doublesDuringSafeRolls === 'double'
      ? 'doubles always double the pot'
      : `doubles add their sum for the first ${r.safeRolls} rolls`;
  const banking = r.noBankingDuringSafeRolls
    ? 'no banking during the safe rolls'
    : 'banking allowed at any time';
  return (
    `${r.rounds} rounds · first ${r.safeRolls} rolls are safe (a 7 pays ${r.sevenBonus}) · ` +
    `${doubles} · ${r.rollIntervalSeconds}s between rolls · ` +
    `${banking} · ` +
    `banking ${r.resetTimerOnBank ? 'resets' : 'does not reset'} the countdown`
  );
}
