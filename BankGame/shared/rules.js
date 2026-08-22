/**
 * Rule configuration for a game of Bank, shared by client and server.
 *
 * The client uses RULE_LIMITS to render the host's controls; the server uses
 * normalizeRules() as the authority. Keeping both in one file is what stops
 * the two from drifting apart.
 */

export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 2;
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
  rounds: 15,
  /** How many opening rolls of each round are "safe" from a 7. */
  safeRolls: 3,
  /** Points a 7 contributes during the safe rolls. */
  sevenBonus: 70,
  /** Behaviour of doubles during the safe rolls. See DOUBLES_MODES. */
  doublesDuringSafeRolls: 'sum',
  /** Seconds between automatic rolls; the banking window. */
  rollIntervalSeconds: 8,
});

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
  return (
    `${r.rounds} rounds · first ${r.safeRolls} rolls are safe (a 7 pays ${r.sevenBonus}) · ` +
    `${doubles} · ${r.rollIntervalSeconds}s between rolls`
  );
}
