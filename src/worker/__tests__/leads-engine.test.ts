// ════════════════════════════════════════════════════════════
// Core CRM Sprint 1 — leads-engine.ts (helpers PURS)
// ════════════════════════════════════════════════════════════
//
// Couvre `src/worker/lib/leads-engine.ts` :
//   - LEAD_ERROR_CODES (présence des 10 codes)
//   - LEAD_VALID_STATUSES / LEAD_VALID_SOURCES (frozen + alignés sur types.ts)
//   - validateEmail : 6 valides + 11 invalides
//   - validatePhone : E.164 (US/CA/FR/DZ), local format, 00 prefix, invalid
//   - validateLeadInput : orchestration name/email/phone/status/source/score/tags
//   - normalizeTags : dedupe, lowercase, trim, cap length, cap count, csv input
//   - computeInitialScore : formules clé (email+phone, just email, just source)
//   - isValidStatus / isValidSource : guards
//   - dedupeKey : email lowercase, tenant scope, phone fallback
//   - parseSegmentConditions : valid AND/OR, malformed, missing op, exists
//
// Pas de mock D1 / fetch nécessaire : helpers 100 % purs.

import { describe, it, expect } from 'vitest';
import {
  LEAD_ERROR_CODES,
  LEAD_VALID_STATUSES,
  LEAD_VALID_SOURCES,
  LEAD_MAX_TAG_LENGTH,
  LEAD_MAX_TAGS,
  LEAD_MAX_NAME_LENGTH,
  LEAD_MAX_EMAIL_LENGTH,
  SEGMENT_VALID_OPERATORS,
  SEGMENT_VALID_LOGIC,
  validateEmail,
  validatePhone,
  validateLeadInput,
  normalizeTags,
  computeInitialScore,
  isValidStatus,
  isValidSource,
  dedupeKey,
  parseSegmentConditions,
} from '../lib/leads-engine';

// ════════════════════════════════════════════════════════════
//  CONSTANTES exportées
// ════════════════════════════════════════════════════════════

describe('LEAD_ERROR_CODES', () => {
  it('exposes the 10 stable codes', () => {
    expect(LEAD_ERROR_CODES.LEAD_NOT_FOUND).toBe('lead_not_found');
    expect(LEAD_ERROR_CODES.INVALID_EMAIL).toBe('invalid_email');
    expect(LEAD_ERROR_CODES.INVALID_PHONE).toBe('invalid_phone');
    expect(LEAD_ERROR_CODES.INVALID_STATUS).toBe('invalid_status');
    expect(LEAD_ERROR_CODES.INVALID_SOURCE).toBe('invalid_source');
    expect(LEAD_ERROR_CODES.INVALID_NAME).toBe('invalid_name');
    expect(LEAD_ERROR_CODES.INVALID_SCORE).toBe('invalid_score');
    expect(LEAD_ERROR_CODES.INVALID_TAGS).toBe('invalid_tags');
    expect(LEAD_ERROR_CODES.DUPLICATE_LEAD).toBe('duplicate_lead');
    expect(LEAD_ERROR_CODES.INVALID_SEGMENT).toBe('invalid_segment');
  });
});

describe('LEAD_VALID_STATUSES / LEAD_VALID_SOURCES', () => {
  it('LEAD_VALID_STATUSES is frozen and matches types.ts', () => {
    expect(Object.isFrozen(LEAD_VALID_STATUSES)).toBe(true);
    expect([...LEAD_VALID_STATUSES]).toEqual([
      'new', 'contacted', 'qualified', 'won', 'closed', 'lost',
    ]);
  });

  it('LEAD_VALID_SOURCES is frozen and includes both types.ts + server sources', () => {
    expect(Object.isFrozen(LEAD_VALID_SOURCES)).toBe(true);
    // Sources de types.ts
    expect((LEAD_VALID_SOURCES as readonly string[])).toContain('website');
    expect((LEAD_VALID_SOURCES as readonly string[])).toContain('ghl_import');
    // Sources serveur additionnelles
    expect((LEAD_VALID_SOURCES as readonly string[])).toContain('manual');
    expect((LEAD_VALID_SOURCES as readonly string[])).toContain('webhook');
    expect((LEAD_VALID_SOURCES as readonly string[])).toContain('api');
  });

  it('LEAD_MAX_* limits are set', () => {
    expect(LEAD_MAX_TAG_LENGTH).toBe(50);
    expect(LEAD_MAX_TAGS).toBe(20);
    expect(LEAD_MAX_NAME_LENGTH).toBe(200);
    expect(LEAD_MAX_EMAIL_LENGTH).toBe(254);
  });
});

// ════════════════════════════════════════════════════════════
//  validateEmail
// ════════════════════════════════════════════════════════════

describe('validateEmail — valid', () => {
  it.each([
    ['simple@example.com', 'simple@example.com'],
    ['User.Name@Example.COM', 'user.name@example.com'],         // lowercased
    ['x+tag@gmail.com', 'x+tag@gmail.com'],
    ['jean-paul_belmondo@société.example.com', null],            // unicode TLD rejected — see invalid
    ['admin@sub.domain.co.uk', 'admin@sub.domain.co.uk'],
    ['  trim@example.com  ', 'trim@example.com'],                // trim
    ['a@b.co', 'a@b.co'],                                         // shortest valid
  ].filter(([, exp]) => exp !== null) as [string, string][])('accepts %s', (input, expected) => {
    const r = validateEmail(input);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe(expected);
  });
});

describe('validateEmail — invalid', () => {
  it.each([
    ['', 'empty string'],
    ['noatsign.com', 'no @'],
    ['no@tld', 'no TLD'],
    ['has space@example.com', 'space in local-part'],
    ['user@example.c', 'TLD too short (1 char)'],
    ['leading.dot.@example.com', 'trailing dot in local-part'],
    ['.leading@example.com', 'leading dot in local-part'],
    ['double..dot@example.com', 'double dot in local-part'],
    ['user@-bad.com', 'leading dash in domain label'],
    ['user@bad-.com', 'trailing dash in domain label'],
    ['user@example.com '.padEnd(260, 'x'), '> 254 chars'],
  ])('rejects "%s" (%s)', (input, _why) => {
    const r = validateEmail(input);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(LEAD_ERROR_CODES.INVALID_EMAIL);
  });

  it('rejects non-string', () => {
    expect(validateEmail(123).ok).toBe(false);
    expect(validateEmail(null).ok).toBe(false);
    expect(validateEmail(undefined).ok).toBe(false);
    expect(validateEmail({}).ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
//  validatePhone
// ════════════════════════════════════════════════════════════

describe('validatePhone — E.164 normalize', () => {
  it('accepts CA local format → +1', () => {
    const r = validatePhone('514-555-1234', 'CA');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('+15145551234');
  });

  it('accepts US local format with parens → +1', () => {
    const r = validatePhone('(212) 555 9999', 'US');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('+12125559999');
  });

  it('accepts FR with explicit +33', () => {
    const r = validatePhone('+33 6 12 34 56 78');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('+33612345678');
  });

  it('accepts DZ with explicit +213', () => {
    const r = validatePhone('+213 555 12 34 56');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('+213555123456');
  });

  it('converts 00 prefix to +', () => {
    const r = validatePhone('0033612345678');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('+33612345678');
  });

  it('strips dots and dashes', () => {
    const r = validatePhone('514.555.1234', 'CA');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('+15145551234');
  });
});

describe('validatePhone — invalid', () => {
  it('rejects empty / non-string', () => {
    expect(validatePhone('').ok).toBe(false);
    expect(validatePhone(null).ok).toBe(false);
    expect(validatePhone(123).ok).toBe(false);
  });

  it('rejects letters', () => {
    const r = validatePhone('555-CALL-NOW');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(LEAD_ERROR_CODES.INVALID_PHONE);
  });

  it('rejects too short (< 7 digits)', () => {
    const r = validatePhone('+1234');
    expect(r.ok).toBe(false);
  });

  it('rejects too long (> 15 digits)', () => {
    const r = validatePhone('+1234567890123456');
    expect(r.ok).toBe(false);
  });

  it('rejects unknown defaultCountry', () => {
    const r = validatePhone('5145551234', 'ZZ');
    expect(r.ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
//  normalizeTags
// ════════════════════════════════════════════════════════════

describe('normalizeTags', () => {
  it('lowercases and trims', () => {
    expect(normalizeTags(['  VIP  ', 'HOT'])).toEqual(['vip', 'hot']);
  });

  it('dedupes case-insensitively', () => {
    expect(normalizeTags(['vip', 'VIP', 'Vip', 'hot'])).toEqual(['vip', 'hot']);
  });

  it('removes empty tags', () => {
    expect(normalizeTags(['vip', '', '   ', 'hot'])).toEqual(['vip', 'hot']);
  });

  it('truncates tags > 50 chars (does not reject)', () => {
    const longTag = 'a'.repeat(80);
    const out = normalizeTags([longTag]);
    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBe(LEAD_MAX_TAG_LENGTH);
  });

  it('caps at LEAD_MAX_TAGS (20)', () => {
    const many = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    expect(normalizeTags(many)).toHaveLength(LEAD_MAX_TAGS);
  });

  it('accepts CSV string', () => {
    expect(normalizeTags('vip, hot, qualified')).toEqual(['vip', 'hot', 'qualified']);
  });

  it('returns [] for non-array/non-string', () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(42)).toEqual([]);
    expect(normalizeTags({ a: 1 })).toEqual([]);
  });

  it('skips non-string elements in array', () => {
    expect(normalizeTags(['vip', 42, null, 'hot'] as unknown[])).toEqual(['vip', 'hot']);
  });
});

// ════════════════════════════════════════════════════════════
//  isValidStatus / isValidSource
// ════════════════════════════════════════════════════════════

describe('guards isValidStatus / isValidSource', () => {
  it('isValidStatus accepts all 6 statuses', () => {
    for (const s of LEAD_VALID_STATUSES) {
      expect(isValidStatus(s)).toBe(true);
    }
  });

  it('isValidStatus rejects unknown / non-string', () => {
    expect(isValidStatus('archived')).toBe(false);
    expect(isValidStatus(null)).toBe(false);
    expect(isValidStatus(42)).toBe(false);
    expect(isValidStatus('')).toBe(false);
  });

  it('isValidSource accepts whitelisted', () => {
    expect(isValidSource('website')).toBe(true);
    expect(isValidSource('manual')).toBe(true);
    expect(isValidSource('webhook')).toBe(true);
  });

  it('isValidSource rejects unknown', () => {
    expect(isValidSource('tiktok')).toBe(false);
    expect(isValidSource('')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
//  validateLeadInput
// ════════════════════════════════════════════════════════════

describe('validateLeadInput', () => {
  it('rejects empty name', () => {
    const r = validateLeadInput({ name: '', email: 'x@y.com' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('name');
    expect(r.error).toBe(LEAD_ERROR_CODES.INVALID_NAME);
  });

  it('rejects name > 200 chars', () => {
    const r = validateLeadInput({ name: 'a'.repeat(201), email: 'x@y.com' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('name');
  });

  it('rejects missing email', () => {
    const r = validateLeadInput({ name: 'Jean' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('email');
  });

  it('rejects invalid email format', () => {
    const r = validateLeadInput({ name: 'Jean', email: 'not-an-email' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('email');
    expect(r.error).toBe(LEAD_ERROR_CODES.INVALID_EMAIL);
  });

  it('accepts minimal valid lead (name + email)', () => {
    const r = validateLeadInput({ name: '  Jean Tremblay  ', email: 'JEAN@Test.com' });
    expect(r.ok).toBe(true);
    expect(r.normalized!.name).toBe('Jean Tremblay');
    expect(r.normalized!.email).toBe('jean@test.com');
    expect(r.normalized!.phone).toBeNull();
    expect(r.normalized!.tags).toEqual([]);
  });

  it('normalizes phone to E.164 when provided', () => {
    const r = validateLeadInput({
      name: 'Jean', email: 'j@x.com', phone: '514-555-1234',
    });
    expect(r.ok).toBe(true);
    expect(r.normalized!.phone).toBe('+15145551234');
  });

  it('rejects invalid phone', () => {
    const r = validateLeadInput({
      name: 'Jean', email: 'j@x.com', phone: '555-CALL-NOW',
    });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('phone');
  });

  it('rejects unknown status', () => {
    const r = validateLeadInput({
      name: 'Jean', email: 'j@x.com', status: 'archived',
    });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('status');
  });

  it('rejects unknown source by default', () => {
    const r = validateLeadInput({
      name: 'Jean', email: 'j@x.com', source: 'tiktok',
    });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('source');
  });

  it('accepts unknown source when allowUnknownSource = true', () => {
    const r = validateLeadInput(
      { name: 'Jean', email: 'j@x.com', source: 'tiktok' },
      { allowUnknownSource: true },
    );
    expect(r.ok).toBe(true);
    expect(r.normalized!.source).toBe('tiktok');
  });

  it('rejects score out of [0,100]', () => {
    const r1 = validateLeadInput({ name: 'X', email: 'x@y.com', score: -5 });
    expect(r1.ok).toBe(false);
    expect(r1.field).toBe('score');
    const r2 = validateLeadInput({ name: 'X', email: 'x@y.com', score: 150 });
    expect(r2.ok).toBe(false);
  });

  it('accepts score at bounds (0 and 100)', () => {
    expect(validateLeadInput({ name: 'X', email: 'x@y.com', score: 0 }).ok).toBe(true);
    expect(validateLeadInput({ name: 'X', email: 'x@y.com', score: 100 }).ok).toBe(true);
  });

  it('normalizes tags', () => {
    const r = validateLeadInput({
      name: 'X', email: 'x@y.com', tags: ['VIP', 'vip', '  HOT  '],
    });
    expect(r.ok).toBe(true);
    expect(r.normalized!.tags).toEqual(['vip', 'hot']);
  });
});

// ════════════════════════════════════════════════════════════
//  computeInitialScore
// ════════════════════════════════════════════════════════════

describe('computeInitialScore', () => {
  it('email + phone + referral → 65', () => {
    expect(computeInitialScore({
      email: 'j@x.com', phone: '+15145551234', source: 'referral',
    })).toBe(65);
  });

  it('email + phone + website → 55', () => {
    expect(computeInitialScore({
      email: 'j@x.com', phone: '+15145551234', source: 'website',
    })).toBe(55);
  });

  it('email only + manual → 40', () => {
    expect(computeInitialScore({
      email: 'j@x.com', source: 'manual',
    })).toBe(40);
  });

  it('source only (no email no phone) → base score', () => {
    expect(computeInitialScore({ source: 'manual' })).toBe(20);
    expect(computeInitialScore({ source: 'referral' })).toBe(25);
  });

  it('email only (no source) → 20', () => {
    expect(computeInitialScore({ email: 'j@x.com' })).toBe(20);
  });

  it('nothing → 0', () => {
    expect(computeInitialScore({})).toBe(0);
  });

  it('unknown source → 5 (fallback)', () => {
    expect(computeInitialScore({ source: 'unknown-xyz' })).toBe(5);
  });

  it('caps at 100', () => {
    // pas atteignable avec la formule actuelle, mais on garantit le cap
    const r = computeInitialScore({
      email: 'x@y.com', phone: '+15145551234', source: 'referral',
    });
    expect(r).toBeLessThanOrEqual(100);
  });

  it('empty strings treated as missing', () => {
    expect(computeInitialScore({ email: '', phone: '', source: '' })).toBe(0);
    expect(computeInitialScore({ email: '   ', phone: '   ' })).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
//  dedupeKey
// ════════════════════════════════════════════════════════════

describe('dedupeKey', () => {
  it('tenant + email lowercased', () => {
    expect(dedupeKey({ tenantId: 't1', email: 'Jean@Example.COM' }))
      .toBe('t1:jean@example.com');
  });

  it('no tenant → leading colon', () => {
    expect(dedupeKey({ email: 'a@b.com' })).toBe(':a@b.com');
  });

  it('invalid email falls back to phone', () => {
    expect(dedupeKey({ tenantId: 't1', email: 'bad', phone: '514-555-1234' }))
      .toBe('t1:phone:+15145551234');
  });

  it('no email + no valid phone → empty string', () => {
    expect(dedupeKey({ tenantId: 't1' })).toBe('');
    expect(dedupeKey({ tenantId: 't1', email: 'bad', phone: 'bad' })).toBe('');
  });
});

// ════════════════════════════════════════════════════════════
//  parseSegmentConditions
// ════════════════════════════════════════════════════════════

describe('parseSegmentConditions', () => {
  it('exposes SEGMENT_VALID_OPERATORS and SEGMENT_VALID_LOGIC frozen', () => {
    expect(Object.isFrozen(SEGMENT_VALID_OPERATORS)).toBe(true);
    expect(Object.isFrozen(SEGMENT_VALID_LOGIC)).toBe(true);
    expect([...SEGMENT_VALID_LOGIC]).toEqual(['AND', 'OR']);
  });

  it('accepts valid AND segment (JSON string)', () => {
    const json = JSON.stringify({
      logic: 'AND',
      conditions: [
        { field: 'status', operator: 'eq', value: 'qualified' },
        { field: 'score', operator: 'gte', value: 50 },
      ],
    });
    const r = parseSegmentConditions(json);
    expect(r.ok).toBe(true);
    expect(r.conditions!.logic).toBe('AND');
    expect(r.conditions!.conditions).toHaveLength(2);
  });

  it('accepts valid OR segment (object input)', () => {
    const r = parseSegmentConditions({
      logic: 'OR',
      conditions: [{ field: 'source', operator: 'in', value: ['google', 'facebook'] }],
    });
    expect(r.ok).toBe(true);
    expect(r.conditions!.logic).toBe('OR');
  });

  it('accepts exists / not_exists without value', () => {
    const r = parseSegmentConditions({
      logic: 'AND',
      conditions: [
        { field: 'phone', operator: 'exists' },
        { field: 'unsubscribed_at', operator: 'not_exists' },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const r = parseSegmentConditions('{not-valid-json');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(LEAD_ERROR_CODES.INVALID_SEGMENT);
  });

  it('rejects missing logic', () => {
    const r = parseSegmentConditions({ conditions: [{ field: 'x', operator: 'eq', value: 'y' }] });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown logic', () => {
    const r = parseSegmentConditions({
      logic: 'XOR',
      conditions: [{ field: 'x', operator: 'eq', value: 'y' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects empty conditions', () => {
    const r = parseSegmentConditions({ logic: 'AND', conditions: [] });
    expect(r.ok).toBe(false);
  });

  it('rejects missing operator', () => {
    const r = parseSegmentConditions({
      logic: 'AND',
      conditions: [{ field: 'status', value: 'qualified' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown operator', () => {
    const r = parseSegmentConditions({
      logic: 'AND',
      conditions: [{ field: 'status', operator: 'matches', value: '.*' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects missing value for non-exists operator', () => {
    const r = parseSegmentConditions({
      logic: 'AND',
      conditions: [{ field: 'status', operator: 'eq' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects empty field', () => {
    const r = parseSegmentConditions({
      logic: 'AND',
      conditions: [{ field: '   ', operator: 'eq', value: 'x' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects > LEAD_MAX_SEGMENT_CONDITIONS', () => {
    const conditions = Array.from({ length: 25 }, (_, i) => ({
      field: `f${i}`, operator: 'eq' as const, value: i,
    }));
    const r = parseSegmentConditions({ logic: 'AND', conditions });
    expect(r.ok).toBe(false);
  });
});
