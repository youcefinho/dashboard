// ── api-versioning-engine.test.ts — Sprint 96 (seq191) ──────────────────────
// Tests pour le versioning strict d'API publique.
// 12 cas : parsing, support/dépréciation, headers, transformation, breaking changes.

import { describe, it, expect } from 'vitest';
import {
  parseApiVersion,
  isVersionSupported,
  isVersionDeprecated,
  buildVersionHeaders,
  transformPayload,
  API_VERSIONS,
  CURRENT_API_VERSION,
  BREAKING_CHANGES,
  V1_TO_V2_FIELD_MAP,
} from '../lib/api-versioning-engine';

// ──────────────────────────────────────────────────────────────────────────
// parseApiVersion — 4 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S96 — parseApiVersion', () => {
  it('1. Path versionné simple → parsed correctement', () => {
    const r = parseApiVersion('/api/v1/leads/abc123');
    expect(r).not.toBeNull();
    expect(r!.version).toBe('v1');
    expect(r!.resource).toBe('leads');
    expect(r!.id).toBe('abc123');
  });

  it('2. Path public versionné → parsed correctement', () => {
    const r = parseApiVersion('/api/public/v2/forms/xyz');
    expect(r).not.toBeNull();
    expect(r!.version).toBe('v2');
    expect(r!.resource).toBe('forms');
    expect(r!.id).toBe('xyz');
  });

  it('3. Path sans version → null', () => {
    expect(parseApiVersion('/api/leads/list')).toBeNull();
    expect(parseApiVersion('/about')).toBeNull();
    expect(parseApiVersion('')).toBeNull();
  });

  it('4. Version non supportée (v3) → null', () => {
    expect(parseApiVersion('/api/v3/leads')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// isVersionSupported / isVersionDeprecated — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S96 — version checks', () => {
  it('5. v1 et v2 sont supportées', () => {
    expect(isVersionSupported('v1')).toBe(true);
    expect(isVersionSupported('v2')).toBe(true);
    expect(isVersionSupported('v3')).toBe(false);
  });

  it('6. v1 est dépréciée, v2 non', () => {
    expect(isVersionDeprecated('v1')).toBe(true);
    expect(isVersionDeprecated('v2')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildVersionHeaders — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S96 — buildVersionHeaders', () => {
  it('7. Version courante → X-API-Version sans Deprecation', () => {
    const h = buildVersionHeaders('v2');
    expect(h['X-API-Version']).toBe('v2');
    expect(h['Deprecation']).toBeUndefined();
    expect(h['Sunset']).toBeUndefined();
  });

  it('8. Version dépréciée → Deprecation + Sunset + migration hint', () => {
    const h = buildVersionHeaders('v1');
    expect(h['X-API-Version']).toBe('v1');
    expect(h['Deprecation']).toBe('true');
    expect(h['Sunset']).toBeDefined();
    expect(h['X-API-Migration']).toContain('v2');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// transformPayload — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S96 — transformPayload', () => {
  it('9. v1→v2 : camelCase → snake_case', () => {
    const v1Data = { firstName: 'Jean', lastName: 'Tremblay', phoneNumber: '+1-514-555' };
    const v2Data = transformPayload(v1Data, 'v1', 'v2');
    expect(v2Data.first_name).toBe('Jean');
    expect(v2Data.last_name).toBe('Tremblay');
    expect(v2Data.phone_number).toBe('+1-514-555');
    expect(v2Data.firstName).toBeUndefined();
  });

  it('10. v2→v1 : snake_case → camelCase (reverse)', () => {
    const v2Data = { first_name: 'Marie', deal_value: 500000 };
    const v1Data = transformPayload(v2Data, 'v2', 'v1');
    expect(v1Data.firstName).toBe('Marie');
    expect(v1Data.dealValue).toBe(500000);
  });

  it('11. Même version → pas de transformation', () => {
    const data = { firstName: 'Test', unknownField: 42 };
    const result = transformPayload(data, 'v1', 'v1');
    expect(result).toEqual(data);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Config structurelle
// ──────────────────────────────────────────────────────────────────────────

describe('S96 — config exports', () => {
  it('12. API_VERSIONS = [v1, v2]', () => {
    expect(API_VERSIONS).toEqual(['v1', 'v2']);
  });

  it('13. CURRENT_API_VERSION = v2', () => {
    expect(CURRENT_API_VERSION).toBe('v2');
  });

  it('14. BREAKING_CHANGES a au moins 4 entrées', () => {
    expect(BREAKING_CHANGES.length).toBeGreaterThanOrEqual(4);
    for (const bc of BREAKING_CHANGES) {
      expect(bc.version).toBeDefined();
      expect(bc.description).toBeDefined();
      expect(bc.migration).toBeDefined();
    }
  });

  it('15. V1_TO_V2_FIELD_MAP couvre les champs essentiels', () => {
    expect(V1_TO_V2_FIELD_MAP.firstName).toBe('first_name');
    expect(V1_TO_V2_FIELD_MAP.createdAt).toBe('created_at');
    expect(V1_TO_V2_FIELD_MAP.dealValue).toBe('deal_value');
  });
});
