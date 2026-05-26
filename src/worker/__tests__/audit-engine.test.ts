// ── audit-engine.test.ts — Security P0-8 audit log helpers ───────────────
// 24 tests covering action whitelist, retention windows, PII sanitization,
// audit entry formatting.

import { describe, it, expect } from 'vitest';
import {
  AUDIT_ERROR_CODES,
  VALID_ACTIONS,
  RETENTION_DAYS_DEFAULT,
  RETENTION_DAYS_MAX,
  validateAuditAction,
  isValidActionFormat,
  isWithinRetention,
  redactPii,
  sanitizeMetadata,
  formatAuditEntry,
} from '../lib/audit-engine';

describe('AUDIT_ERROR_CODES', () => {
  it('exposes canonical codes', () => {
    expect(AUDIT_ERROR_CODES.ACTION_INVALID).toBe('ACTION_INVALID');
    expect(AUDIT_ERROR_CODES.RETENTION_EXPIRED).toBe('RETENTION_EXPIRED');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(AUDIT_ERROR_CODES)).toBe(true);
  });
});

describe('VALID_ACTIONS whitelist', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(VALID_ACTIONS)).toBe(true);
  });
  it('contains the core RBAC + auth actions', () => {
    expect(VALID_ACTIONS).toContain('auth.login');
    expect(VALID_ACTIONS).toContain('rbac.override.set');
    expect(VALID_ACTIONS).toContain('admin.audit_log.viewed');
    expect(VALID_ACTIONS).toContain('consent.log');
    expect(VALID_ACTIONS).toContain('lead.forget');
  });
});

describe('isValidActionFormat', () => {
  it('accepts valid dot-segment actions', () => {
    expect(isValidActionFormat('auth.login')).toBe(true);
    expect(isValidActionFormat('rbac.override.set')).toBe(true);
    expect(isValidActionFormat('admin.audit_log.viewed')).toBe(true);
  });
  it('rejects empty, spaces, uppercase, wildcard', () => {
    expect(isValidActionFormat('')).toBe(false);
    expect(isValidActionFormat('Auth.Login')).toBe(false);
    expect(isValidActionFormat('auth login')).toBe(false);
    expect(isValidActionFormat('auth.*')).toBe(false);
    expect(isValidActionFormat('nosegment')).toBe(false);
  });
  it('rejects non-string inputs', () => {
    expect(isValidActionFormat(null)).toBe(false);
    expect(isValidActionFormat(42)).toBe(false);
  });
  it('rejects actions over 100 chars', () => {
    expect(isValidActionFormat('a.' + 'x'.repeat(100))).toBe(false);
  });
});

describe('validateAuditAction (whitelist + format)', () => {
  it('returns true for whitelisted actions', () => {
    expect(validateAuditAction('auth.login')).toBe(true);
    expect(validateAuditAction('lead.forget')).toBe(true);
  });
  it('returns false for unknown actions (even if well-formatted)', () => {
    expect(validateAuditAction('foo.bar')).toBe(false);
    expect(validateAuditAction('auth.imaginary_method')).toBe(false);
  });
  it('returns false for malformed actions', () => {
    expect(validateAuditAction('AUTH.LOGIN')).toBe(false);
    expect(validateAuditAction('')).toBe(false);
  });
});

describe('isWithinRetention', () => {
  const NOW = 1_700_000_000_000;

  it('accepts a record created today', () => {
    expect(isWithinRetention(NOW - 1000, RETENTION_DAYS_DEFAULT, NOW)).toBe(true);
  });
  it('accepts at the boundary (now - 90d)', () => {
    expect(isWithinRetention(NOW - RETENTION_DAYS_DEFAULT * 86_400_000, RETENTION_DAYS_DEFAULT, NOW)).toBe(true);
  });
  it('rejects past retention', () => {
    expect(isWithinRetention(NOW - 91 * 86_400_000, 90, NOW)).toBe(false);
  });
  it('accepts ISO string input', () => {
    expect(isWithinRetention('2026-01-01T00:00:00Z', 365 * 10, NOW)).toBe(true);
  });
  it('returns false on invalid date string', () => {
    expect(isWithinRetention('not-a-date', 90, NOW)).toBe(false);
  });
  it('clamps retentionDays to RETENTION_DAYS_MAX (10y)', () => {
    expect(isWithinRetention(NOW - 100, RETENTION_DAYS_MAX + 1000, NOW)).toBe(true);
  });
});

describe('redactPii', () => {
  it('redacts simple email', () => {
    expect(redactPii('Contact me at john@example.com please')).toBe('Contact me at [REDACTED] please');
  });
  it('redacts multiple emails in one string', () => {
    expect(redactPii('a@b.com and c@d.com')).toBe('[REDACTED] and [REDACTED]');
  });
  it('redacts IPv4 addresses', () => {
    expect(redactPii('Logged from 192.168.1.1 today')).toBe('Logged from [REDACTED] today');
  });
  it('redacts credit card numbers', () => {
    expect(redactPii('CC: 4111-1111-1111-1111')).toBe('CC: [REDACTED]');
    expect(redactPii('Card 4111111111111111')).toBe('Card [REDACTED]');
  });
  it('redacts phone numbers (international format)', () => {
    expect(redactPii('Call +1 (514) 555-1234')).toContain('[REDACTED]');
    expect(redactPii('Call +1 (514) 555-1234')).not.toMatch(/555/);
  });
  it('leaves clean strings untouched', () => {
    expect(redactPii('No PII here')).toBe('No PII here');
  });
  it('handles empty/non-string input', () => {
    expect(redactPii('')).toBe('');
    // @ts-expect-error testing runtime guard
    expect(redactPii(null)).toBeNull();
  });
});

describe('sanitizeMetadata', () => {
  it('redacts emails inside string values', () => {
    const out = sanitizeMetadata({ msg: 'user john@x.com signed up' });
    expect(out.msg).toBe('user [REDACTED] signed up');
  });
  it('preserves non-PII keys/values', () => {
    const out = sanitizeMetadata({ name: 'Foo', count: 42, active: true });
    expect(out).toEqual({ name: 'Foo', count: 42, active: true });
  });
  it('walks nested objects', () => {
    const out = sanitizeMetadata({ user: { email: 'real-email@test.com only here' } });
    expect((out.user as Record<string, unknown>).email).toBe('[REDACTED] only here');
  });
  it('walks arrays', () => {
    const out = sanitizeMetadata({ emails: ['hello a@b.com', 'plain text'] });
    expect((out.emails as string[])[0]).toBe('hello [REDACTED]');
    expect((out.emails as string[])[1]).toBe('plain text');
  });
  it('drops functions / symbols / bigints', () => {
    // @ts-expect-error testing runtime guard
    const out = sanitizeMetadata({ f: () => 1, n: 5 });
    expect(out.f).toBeNull();
    expect(out.n).toBe(5);
  });
  it('returns {} on null/undefined/non-object', () => {
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata(undefined)).toEqual({});
    expect(sanitizeMetadata('a string')).toEqual({});
  });
  it('wraps top-level arrays under _array', () => {
    const out = sanitizeMetadata(['hello a@b.com']);
    expect(out._array).toEqual(['hello [REDACTED]']);
  });
});

describe('formatAuditEntry', () => {
  it('normalizes a full entry input', () => {
    const entry = formatAuditEntry({
      userId: 'u-1',
      action: 'auth.login',
      resourceType: 'user',
      resourceId: 'u-1',
      metadata: { ip: '1.2.3.4' },
      ip: '1.2.3.4',
      userAgent: 'curl',
      requestId: 'req-1',
      tenantId: 'a-1',
    });
    expect(entry.user_id).toBe('u-1');
    expect(entry.action).toBe('auth.login');
    expect(entry.tenant_id).toBe('a-1');
    expect(entry.redacted).toBe(1); // ip in metadata was redacted
    expect((entry.details as Record<string, unknown>).ip).toBe('[REDACTED]');
  });
  it('sets redacted=0 when no PII in metadata', () => {
    const entry = formatAuditEntry({
      userId: 'u-1',
      action: 'auth.login',
      metadata: { count: 5, ok: true },
    });
    expect(entry.redacted).toBe(0);
  });
  it('defaults nullable fields cleanly', () => {
    const entry = formatAuditEntry({ action: 'auth.login' });
    expect(entry.user_id).toBeNull();
    expect(entry.resource_type).toBeNull();
    expect(entry.details).toEqual({});
  });
});
