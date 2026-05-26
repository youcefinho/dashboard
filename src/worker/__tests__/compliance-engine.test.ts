// ── compliance-engine.test.ts — Security P0-8 compliance helpers ─────────
// 22 tests covering Loi 25 consent, GDPR request validation, response
// windows, PII redaction, data export shape.

import { describe, it, expect } from 'vitest';
import {
  COMPLIANCE_ERROR_CODES,
  LOI_25_CONSENT_TYPES,
  GDPR_REQUEST_TYPES,
  GDPR_RESPONSE_WINDOW_MS,
  validateConsentInput,
  computeConsentStatus,
  validateGdprRequest,
  isValidEmail,
  isWithinGdprWindow,
  redactPii,
  buildDataExport,
} from '../lib/compliance-engine';

describe('COMPLIANCE_ERROR_CODES', () => {
  it('exposes canonical codes', () => {
    expect(COMPLIANCE_ERROR_CODES.CONSENT_TYPE_INVALID).toBe('CONSENT_TYPE_INVALID');
    expect(COMPLIANCE_ERROR_CODES.GDPR_TYPE_INVALID).toBe('GDPR_TYPE_INVALID');
    expect(COMPLIANCE_ERROR_CODES.GDPR_WINDOW_EXPIRED).toBe('GDPR_WINDOW_EXPIRED');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(COMPLIANCE_ERROR_CODES)).toBe(true);
  });
});

describe('LOI_25_CONSENT_TYPES', () => {
  it('contains the granular Loi 25 categories', () => {
    expect(LOI_25_CONSENT_TYPES).toContain('marketing');
    expect(LOI_25_CONSENT_TYPES).toContain('analytics');
    expect(LOI_25_CONSENT_TYPES).toContain('personalization');
    expect(LOI_25_CONSENT_TYPES).toContain('profiling');
  });
  it('preserves legacy compliance.ts types', () => {
    expect(LOI_25_CONSENT_TYPES).toContain('marketing_email');
    expect(LOI_25_CONSENT_TYPES).toContain('cookies');
    expect(LOI_25_CONSENT_TYPES).toContain('data_processing');
    expect(LOI_25_CONSENT_TYPES).toContain('third_party_sharing');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(LOI_25_CONSENT_TYPES)).toBe(true);
  });
});

describe('GDPR_REQUEST_TYPES', () => {
  it('lists the 4 GDPR rights (export/deletion/rectification/portability)', () => {
    expect(GDPR_REQUEST_TYPES).toEqual(['export', 'deletion', 'rectification', 'portability']);
  });
  it('is frozen', () => {
    expect(Object.isFrozen(GDPR_REQUEST_TYPES)).toBe(true);
  });
});

describe('validateConsentInput', () => {
  it('accepts a valid marketing consent', () => {
    const r = validateConsentInput({ consent_type: 'marketing', granted: true });
    expect(r.ok).toBe(true);
    expect(r.consentType).toBe('marketing');
    expect(r.granted).toBe(true);
  });
  it('rejects unknown consent type', () => {
    const r = validateConsentInput({ consent_type: 'mind_reading', granted: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('CONSENT_TYPE_INVALID');
  });
  it('rejects non-boolean granted', () => {
    // @ts-expect-error testing runtime guard
    const r = validateConsentInput({ consent_type: 'marketing', granted: 'yes' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('CONSENT_GRANTED_INVALID');
  });
  it('rejects empty payload', () => {
    // @ts-expect-error testing runtime guard
    expect(validateConsentInput(null).ok).toBe(false);
  });
});

describe('computeConsentStatus', () => {
  it('returns active=true for a recent grant with no withdrawal', () => {
    const records = [
      { consent_type: 'marketing', granted: 1 as const, granted_at: '2026-01-01T00:00:00Z' },
    ];
    const status = computeConsentStatus(records, 'marketing');
    expect(status.active).toBe(true);
    expect(status.grantedAt).toBe('2026-01-01T00:00:00Z');
  });
  it('returns active=false when latest record was withdrawn', () => {
    const records = [
      { consent_type: 'marketing', granted: 1 as const, granted_at: '2026-01-01T00:00:00Z', withdrawn_at: '2026-02-01T00:00:00Z' },
    ];
    expect(computeConsentStatus(records, 'marketing').active).toBe(false);
  });
  it('uses LATEST record (sorted by granted_at)', () => {
    const records = [
      { consent_type: 'marketing', granted: 0 as const, granted_at: '2026-01-01T00:00:00Z' },
      { consent_type: 'marketing', granted: 1 as const, granted_at: '2026-03-01T00:00:00Z' },
      { consent_type: 'marketing', granted: 0 as const, granted_at: '2026-02-01T00:00:00Z' },
    ];
    expect(computeConsentStatus(records, 'marketing').active).toBe(true);
  });
  it('filters by consent_type (mixed records)', () => {
    const records = [
      { consent_type: 'marketing', granted: 1 as const, granted_at: '2026-01-01T00:00:00Z' },
      { consent_type: 'analytics', granted: 0 as const, granted_at: '2026-02-01T00:00:00Z' },
    ];
    expect(computeConsentStatus(records, 'analytics').active).toBe(false);
    expect(computeConsentStatus(records, 'marketing').active).toBe(true);
  });
  it('returns active=false on empty input', () => {
    expect(computeConsentStatus([], 'marketing').active).toBe(false);
    expect(computeConsentStatus([], 'unknown').active).toBe(false);
  });
  it('accepts boolean granted (not just 0/1)', () => {
    const records = [
      { consent_type: 'marketing', granted: true, granted_at: '2026-01-01T00:00:00Z' },
    ];
    expect(computeConsentStatus(records, 'marketing').active).toBe(true);
  });
});

describe('isValidEmail', () => {
  it('accepts standard emails', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('first.last+tag@sub.example.co.uk')).toBe(true);
  });
  it('rejects malformed addresses', () => {
    expect(isValidEmail('plain')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('@b.com')).toBe(false);
    expect(isValidEmail('a@b.c')).toBe(false); // TLD too short
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
  });
});

describe('validateGdprRequest', () => {
  it('accepts a valid export request', () => {
    const r = validateGdprRequest({ type: 'export', email: 'user@example.com' });
    expect(r.ok).toBe(true);
    expect(r.type).toBe('export');
    expect(r.email).toBe('user@example.com');
  });
  it('lowercases email', () => {
    const r = validateGdprRequest({ type: 'deletion', email: 'USER@EXAMPLE.COM' });
    expect(r.email).toBe('user@example.com');
  });
  it('rejects unknown type', () => {
    const r = validateGdprRequest({ type: 'mind_wipe', email: 'a@b.com' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('GDPR_TYPE_INVALID');
  });
  it('rejects bad email', () => {
    const r = validateGdprRequest({ type: 'export', email: 'not-an-email' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('GDPR_EMAIL_INVALID');
  });
  it('rejects null input', () => {
    // @ts-expect-error testing runtime guard
    expect(validateGdprRequest(null).ok).toBe(false);
  });
});

describe('isWithinGdprWindow (30 days)', () => {
  it('accepts a fresh request', () => {
    const now = Date.now();
    expect(isWithinGdprWindow(now - 1000, now)).toBe(true);
  });
  it('accepts at the 30-day boundary', () => {
    const now = Date.now();
    expect(isWithinGdprWindow(now - GDPR_RESPONSE_WINDOW_MS, now)).toBe(true);
  });
  it('rejects past 30 days', () => {
    const now = Date.now();
    expect(isWithinGdprWindow(now - GDPR_RESPONSE_WINDOW_MS - 1, now)).toBe(false);
  });
  it('accepts ISO string', () => {
    expect(isWithinGdprWindow(new Date().toISOString())).toBe(true);
  });
  it('rejects invalid date', () => {
    expect(isWithinGdprWindow('not-a-date')).toBe(false);
  });
});

describe('redactPii (re-export)', () => {
  it('redacts an email', () => {
    expect(redactPii('john@x.com sent a message')).toBe('[REDACTED] sent a message');
  });
  it('returns input unchanged when clean', () => {
    expect(redactPii('clean text')).toBe('clean text');
  });
});

describe('buildDataExport', () => {
  it('builds the canonical Loi 25 / GDPR Art 15 shape', () => {
    const fixedNow = new Date('2026-05-26T00:00:00Z');
    const out = buildDataExport({
      lead: { id: 'l-1', name: 'Foo' },
      messages: [{ id: 'm-1' }],
      consents: [{ id: 'c-1' }],
      activities: [{ id: 'a-1' }],
      now: fixedNow,
    });
    expect(out.lead).toEqual({ id: 'l-1', name: 'Foo' });
    expect(out.messages).toHaveLength(1);
    expect(out.exported_at).toBe('2026-05-26T00:00:00.000Z');
    expect(out.purpose).toMatch(/Loi 25/);
  });
  it('defaults to empty arrays for missing collections', () => {
    const out = buildDataExport({ lead: null });
    expect(out.messages).toEqual([]);
    expect(out.consents).toEqual([]);
    expect(out.activities).toEqual([]);
  });
  it('accepts a custom purpose override', () => {
    const out = buildDataExport({ lead: null, purpose: 'Custom export reason' });
    expect(out.purpose).toBe('Custom export reason');
  });
});
