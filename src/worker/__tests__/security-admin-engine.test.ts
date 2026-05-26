// ── security-admin-engine.test.ts — Security P0-8 admin helpers ──────────
// 22 tests covering capability overrides validation, audit filters parsing,
// path extraction, audit log entry formatting.

import { describe, it, expect } from 'vitest';
import {
  SECURITY_ADMIN_ERROR_CODES,
  SEQ80_CAPABILITIES,
  parseAuditFilters,
  validateCapabilityOverride,
  extractUserIdFromPath,
  formatAuditLogEntry,
  isSeq80Capability,
} from '../lib/security-admin-engine';

describe('SECURITY_ADMIN_ERROR_CODES', () => {
  it('exposes the canonical codes', () => {
    expect(SECURITY_ADMIN_ERROR_CODES.AGENCY_ONLY).toBe('AGENCY_ONLY');
    expect(SECURITY_ADMIN_ERROR_CODES.OVERRIDE_INVALID).toBe('OVERRIDE_INVALID');
    expect(SECURITY_ADMIN_ERROR_CODES.CAPABILITY_UNKNOWN).toBe('CAPABILITY_UNKNOWN');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(SECURITY_ADMIN_ERROR_CODES)).toBe(true);
  });
});

describe('SEQ80_CAPABILITIES (frozen, 12 caps)', () => {
  it('lists exactly the seq80 capabilities', () => {
    expect(SEQ80_CAPABILITIES).toHaveLength(12);
    expect(SEQ80_CAPABILITIES).toContain('ai.use');
    expect(SEQ80_CAPABILITIES).toContain('settings.manage');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(SEQ80_CAPABILITIES)).toBe(true);
  });
});

describe('isSeq80Capability', () => {
  it('returns true for known caps', () => {
    expect(isSeq80Capability('ai.use')).toBe(true);
    expect(isSeq80Capability('settings.manage')).toBe(true);
  });
  it('returns false for unknown caps', () => {
    expect(isSeq80Capability('fake.cap')).toBe(false);
    expect(isSeq80Capability('')).toBe(false);
    expect(isSeq80Capability(null)).toBe(false);
  });
});

describe('parseAuditFilters', () => {
  it('returns defaults on empty query', () => {
    const q = new URLSearchParams();
    const out = parseAuditFilters(q);
    expect(out).toEqual({
      action: undefined,
      userId: undefined,
      resourceType: undefined,
      from: undefined,
      to: undefined,
      limit: 50,
      offset: 0,
    });
  });
  it('parses all filters from snake_case keys', () => {
    const q = new URLSearchParams({
      action: 'login',
      user_id: 'u-1',
      resource_type: 'lead',
      date_from: '2026-01-01',
      date_to: '2026-12-31',
      limit: '25',
      offset: '100',
    });
    const out = parseAuditFilters(q);
    expect(out.action).toBe('login');
    expect(out.userId).toBe('u-1');
    expect(out.resourceType).toBe('lead');
    expect(out.from).toBe('2026-01-01');
    expect(out.to).toBe('2026-12-31');
    expect(out.limit).toBe(25);
    expect(out.offset).toBe(100);
  });
  it('also accepts camelCase keys', () => {
    const q = new URLSearchParams({ userId: 'u-2', resourceType: 'order' });
    const out = parseAuditFilters(q);
    expect(out.userId).toBe('u-2');
    expect(out.resourceType).toBe('order');
  });
  it('clamps limit to [1, 200] and offset to >= 0', () => {
    const q = new URLSearchParams({ limit: '9999', offset: '-50' });
    const out = parseAuditFilters(q);
    expect(out.limit).toBe(200);
    expect(out.offset).toBe(0);
  });
  it('returns default limit on garbage input', () => {
    const q = new URLSearchParams({ limit: 'abc' });
    expect(parseAuditFilters(q).limit).toBe(50);
  });
  it('trims and drops empty strings', () => {
    const q = new URLSearchParams({ action: '   ', user_id: 'real' });
    const out = parseAuditFilters(q);
    expect(out.action).toBeUndefined();
    expect(out.userId).toBe('real');
  });
  it('truncates oversized strings (defense-in-depth)', () => {
    const q = new URLSearchParams({ action: 'x'.repeat(500) });
    const out = parseAuditFilters(q);
    expect(out.action).toHaveLength(100);
  });
});

describe('validateCapabilityOverride', () => {
  it('accepts a valid override', () => {
    const result = validateCapabilityOverride({ capability: 'ai.use', granted: true });
    expect(result.ok).toBe(true);
    expect(result.capability).toBe('ai.use');
    expect(result.granted).toBe(true);
  });
  it('rejects unknown capability with CAPABILITY_UNKNOWN', () => {
    const result = validateCapabilityOverride({ capability: 'fake.cap', granted: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CAPABILITY_UNKNOWN');
  });
  it('rejects non-boolean granted', () => {
    // @ts-expect-error testing runtime guard
    const r = validateCapabilityOverride({ capability: 'ai.use', granted: 'yes' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('OVERRIDE_INVALID');
  });
  it('rejects missing capability field', () => {
    const r = validateCapabilityOverride({ granted: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('OVERRIDE_INVALID');
  });
  it('rejects non-object input', () => {
    // @ts-expect-error testing runtime guard
    expect(validateCapabilityOverride(null).ok).toBe(false);
    // @ts-expect-error testing runtime guard
    expect(validateCapabilityOverride('xxx').ok).toBe(false);
  });
  it('blocks granting a capability the caller does not have', () => {
    const userCaps = new Set(['leads.read', 'leads.write']);
    const result = validateCapabilityOverride(
      { capability: 'settings.manage', granted: true },
      userCaps,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('AGENCY_ONLY');
  });
  it('allows granting a capability the caller DOES have', () => {
    const userCaps = new Set(['team.manage', 'ai.use']);
    const result = validateCapabilityOverride(
      { capability: 'ai.use', granted: true },
      userCaps,
    );
    expect(result.ok).toBe(true);
  });
  it('allows revoking a capability even if caller does not have it', () => {
    // Revoke (granted=false) should not require possession.
    const userCaps = new Set(['leads.read']);
    const result = validateCapabilityOverride(
      { capability: 'ai.use', granted: false },
      userCaps,
    );
    expect(result.ok).toBe(true);
  });
});

describe('extractUserIdFromPath', () => {
  it('extracts userId from /api/admin/capability-overrides/<userId>', () => {
    const r = extractUserIdFromPath('/api/admin/capability-overrides/u-42');
    expect(r.userId).toBe('u-42');
    expect(r.capability).toBeNull();
  });
  it('extracts userId + capability from full path', () => {
    const r = extractUserIdFromPath('/api/admin/capability-overrides/u-42/ai.use');
    expect(r.userId).toBe('u-42');
    expect(r.capability).toBe('ai.use');
  });
  it('decodes URI-encoded userId', () => {
    const r = extractUserIdFromPath('/api/admin/capability-overrides/u%2042');
    expect(r.userId).toBe('u 42');
  });
  it('strips query string and hash', () => {
    const r = extractUserIdFromPath('/api/admin/capability-overrides/u-42?foo=bar#x');
    expect(r.userId).toBe('u-42');
  });
  it('returns empty userId for malformed paths', () => {
    expect(extractUserIdFromPath('/api/other/route').userId).toBe('');
    expect(extractUserIdFromPath('').userId).toBe('');
  });
  it('handles malformed URI gracefully (no throw)', () => {
    const r = extractUserIdFromPath('/api/admin/capability-overrides/%E0%A4%A');
    expect(typeof r.userId).toBe('string');
  });
});

describe('formatAuditLogEntry', () => {
  it('normalizes a full DB row', () => {
    const row = {
      id: 42,
      user_id: 'u-1',
      action: 'login',
      resource_type: 'user',
      resource_id: 'u-1',
      details: '{"ip":"1.2.3.4"}',
      ip: '1.2.3.4',
      user_agent: 'curl',
      request_id: 'req-1',
      tenant_id: 'a-1',
      redacted: 0,
      created_at: '2026-01-01T00:00:00Z',
    };
    const entry = formatAuditLogEntry(row);
    expect(entry.id).toBe(42);
    expect(entry.details).toEqual({ ip: '1.2.3.4' });
    expect(entry.redacted).toBe(0);
  });
  it('parses details from object (when D1 returns parsed JSON)', () => {
    const row = { id: 1, action: 'x', details: { a: 1 } };
    expect(formatAuditLogEntry(row).details).toEqual({ a: 1 });
  });
  it('returns empty details on bad JSON', () => {
    const row = { id: 1, action: 'x', details: '{bad json' };
    expect(formatAuditLogEntry(row).details).toEqual({});
  });
  it('defaults null fields cleanly', () => {
    const entry = formatAuditLogEntry({});
    expect(entry.user_id).toBeNull();
    expect(entry.tenant_id).toBeNull();
    expect(entry.created_at).toBe('');
    expect(entry.id).toBe(0);
  });
  it('does NOT unwrap array details (audit_log.details is JSON object)', () => {
    const row = { id: 1, action: 'x', details: '[1,2,3]' };
    expect(formatAuditLogEntry(row).details).toEqual({});
  });
});
