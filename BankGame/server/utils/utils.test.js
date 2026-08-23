import { describe, it, expect } from 'vitest';
import { sanitizeName, normalizeCode, validateRules, sanitizeNameList } from './validate.js';
import { configureSession, createSession, verifySession, issuePlayerId } from './session.js';

describe('sanitizeName', () => {
  it('trims and keeps a normal name', () => {
    expect(sanitizeName('  Ryan  ')).toBe('Ryan');
  });

  it('returns null for empty and whitespace-only', () => {
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName(null)).toBeNull();
    expect(sanitizeName(undefined)).toBeNull();
    expect(sanitizeName(42)).toBeNull();
  });

  it('strips control characters', () => {
    expect(sanitizeName('Rya\nn\x00')).toBe('Ryan');
    expect(sanitizeName('\u0001Evil\u0002')).toBe('Evil');
  });

  it('caps at 20 characters', () => {
    expect(sanitizeName('a'.repeat(50))).toBe('a'.repeat(20));
  });
});

describe('normalizeCode', () => {
  it('uppercases and trims whitespace', () => {
    expect(normalizeCode('  ab2345  ')).toBe('AB2345');
  });

  it('accepts valid codes', () => {
    expect(normalizeCode('ABC234')).toBe('ABC234');
    expect(normalizeCode('AB2345')).toBe('AB2345');
  });

  it('rejects malformed codes', () => {
    expect(normalizeCode('')).toBeNull();
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode('12345')).toBeNull(); // too short
    expect(normalizeCode('1234567')).toBeNull(); // too long
    expect(normalizeCode(undefined)).toBeNull();
  });

  it('rejects codes with characters outside the alphabet', () => {
    expect(normalizeCode('ABC-!@')).toBeNull();
  });
});

describe('sanitizeNameList', () => {
  it('drops invalid and duplicate entries, keeps valid ones', () => {
    expect(sanitizeNameList(['a', ' b ', 'a', null, '  '])).toEqual(['a', 'b']);
  });
});

describe('validateRules', () => {
  it('accepts a valid rule set', () => {
    const res = validateRules({ rounds: 10, safeRolls: 3, sevenBonus: 100 });
    expect(res.valid).toBe(true);
    expect(res.rules.rounds).toBe(10);
  });

  it('accepts a boolean resetTimerOnBank and rejects a non-boolean', () => {
    expect(validateRules({ resetTimerOnBank: true }).valid).toBe(true);
    expect(validateRules({ resetTimerOnBank: false }).valid).toBe(true);
    expect(validateRules({ resetTimerOnBank: 'yes' }).valid).toBe(false);
    expect(validateRules({ resetTimerOnBank: 1 }).valid).toBe(false);
  });

  it('rejects out-of-range values rather than silently clamping', () => {
    expect(validateRules({ rounds: 999 }).valid).toBe(false);
    expect(validateRules({ safeRolls: -1 }).valid).toBe(false);
    expect(validateRules({ sevenBonus: 999999 }).valid).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(validateRules(null).valid).toBe(false);
    expect(validateRules('nope').valid).toBe(false);
    expect(validateRules([]).valid).toBe(false);
  });
});

describe('session', () => {
  it('issues and verifies a token', () => {
    configureSession('test-secret');
    const id = issuePlayerId();
    const { token } = createSession(id);
    expect(verifySession(id, token)).toBe(true);
  });

  it('rejects a wrong token or wrong id', () => {
    configureSession('test-secret');
    const id = issuePlayerId();
    const { token } = createSession(id);
    expect(verifySession(id, 'wrong')).toBe(false);
    expect(verifySession('other-id', token)).toBe(false);
    expect(verifySession(id, undefined)).toBe(false);
  });

  it('tokens are bound to the secret (different secret invalidates)', () => {
    configureSession('secret-one');
    const id = issuePlayerId();
    const { token } = createSession(id);
    configureSession('secret-two');
    expect(verifySession(id, token)).toBe(false);
  });
});
