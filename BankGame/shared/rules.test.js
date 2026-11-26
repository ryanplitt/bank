import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, describeRules, isBankingLocked, normalizeRules } from './rules.js';

describe('isBankingLocked', () => {
  const rules = normalizeRules({ safeRolls: 3, noBankingDuringSafeRolls: true });

  it('is never locked when the rule is off', () => {
    expect(isBankingLocked(DEFAULT_RULES, 0)).toBe(false);
    expect(isBankingLocked({ ...rules, noBankingDuringSafeRolls: false }, 1)).toBe(false);
  });

  it('is locked until roll #safeRolls has landed, then lifts', () => {
    expect(isBankingLocked(rules, 0)).toBe(true);
    expect(isBankingLocked(rules, 2)).toBe(true);
    expect(isBankingLocked(rules, 3)).toBe(false); // last safe roll landed
    expect(isBankingLocked(rules, 4)).toBe(false);
  });

  it('fails open on missing or garbage input', () => {
    expect(isBankingLocked(undefined, 1)).toBe(false);
    expect(isBankingLocked(rules, undefined)).toBe(false);
    expect(isBankingLocked(rules, NaN)).toBe(false);
  });
});

describe('noBankingDuringSafeRolls rule', () => {
  it('defaults off and ignores non-boolean input', () => {
    expect(DEFAULT_RULES.noBankingDuringSafeRolls).toBe(false);
    expect(normalizeRules({ noBankingDuringSafeRolls: 'yes' }).noBankingDuringSafeRolls).toBe(false);
    expect(normalizeRules({ noBankingDuringSafeRolls: true }).noBankingDuringSafeRolls).toBe(true);
  });

  it('is described in plain words', () => {
    expect(describeRules(normalizeRules({ noBankingDuringSafeRolls: true }))).toMatch(
      /no banking during the safe rolls/,
    );
    expect(describeRules(DEFAULT_RULES)).toMatch(/banking allowed at any time/);
  });
});
