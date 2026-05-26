// ── snapshot-import-engine.test.ts — Utils P2-2 import validation helpers ──
// Couvre manifest validation, integrity check, mode whitelist, per-entity
// validation, summary aggregation.

import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_IMPORT_ERROR_CODES,
  BUNDLE_VERSION_SUPPORTED,
  SNAPSHOT_MAGIC_HEADER_EXPECTED,
  IMPORTABLE_ENTITIES,
  VALID_IMPORT_MODES,
  validateBundleManifest,
  validateBundleIntegrity,
  parseImportMode,
  validateEntityBundle,
  computeImportSummary,
} from '../lib/snapshot-import-engine';

describe('SNAPSHOT_IMPORT_ERROR_CODES & constants', () => {
  it('expose codes canoniques + frozen', () => {
    expect(SNAPSHOT_IMPORT_ERROR_CODES.INVALID_MAGIC).toBe('INVALID_MAGIC');
    expect(SNAPSHOT_IMPORT_ERROR_CODES.SIGNATURE_MISSING).toBe('SIGNATURE_MISSING');
    expect(Object.isFrozen(SNAPSHOT_IMPORT_ERROR_CODES)).toBe(true);
  });
  it('BUNDLE_VERSION_SUPPORTED = [1] frozen', () => {
    expect(BUNDLE_VERSION_SUPPORTED).toContain(1);
    expect(Object.isFrozen(BUNDLE_VERSION_SUPPORTED)).toBe(true);
  });
  it('magic header constant', () => {
    expect(SNAPSHOT_MAGIC_HEADER_EXPECTED).toBe('intralys-snapshot-v1');
  });
  it('IMPORTABLE_ENTITIES = 27 entités', () => {
    expect(IMPORTABLE_ENTITIES.size).toBe(27);
    expect(IMPORTABLE_ENTITIES.has('pipelines')).toBe(true);
    expect(IMPORTABLE_ENTITIES.has('workflows')).toBe(true);
    expect(IMPORTABLE_ENTITIES.has('users')).toBe(false); // exclu
    expect(IMPORTABLE_ENTITIES.has('leads')).toBe(false); // exclu
  });
  it('VALID_IMPORT_MODES = [dry_run, commit]', () => {
    expect(VALID_IMPORT_MODES).toEqual(['dry_run', 'commit']);
  });
});

describe('validateBundleManifest', () => {
  const baseValid = {
    magic: 'intralys-snapshot-v1',
    schema_version: 1,
    generated_at: '2026-05-26T00:00:00Z',
    source: { client_id: 'c1', agency_id: null, name: 'X', description: null },
    entities: {},
    signature: { algo: 'sha256', hash_hex: 'a'.repeat(64) },
  };

  it('accepte un manifest valide', () => {
    expect(validateBundleManifest(baseValid).ok).toBe(true);
  });
  it('rejette null / scalar / array', () => {
    expect(validateBundleManifest(null).ok).toBe(false);
    expect(validateBundleManifest('string').ok).toBe(false);
    expect(validateBundleManifest([]).ok).toBe(false);
  });
  it('rejette magic incorrect', () => {
    const r = validateBundleManifest({ ...baseValid, magic: 'other' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('INVALID_MAGIC');
  });
  it('rejette schema_version inconnue', () => {
    const r = validateBundleManifest({ ...baseValid, schema_version: 99 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });
  it('rejette signature manquante / vide / hash_hex bad length', () => {
    expect(validateBundleManifest({ ...baseValid, signature: undefined }).ok).toBe(false);
    expect(
      validateBundleManifest({
        ...baseValid,
        signature: { algo: 'sha256', hash_hex: '' },
      }).ok,
    ).toBe(false);
    expect(
      validateBundleManifest({
        ...baseValid,
        signature: { algo: 'sha256', hash_hex: 'short' },
      }).ok,
    ).toBe(false);
  });
  it('rejette hash_hex non-hex chars', () => {
    const r = validateBundleManifest({
      ...baseValid,
      signature: { algo: 'sha256', hash_hex: 'z'.repeat(64) },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('SIGNATURE_MISSING');
  });
  it('rejette entities = array (doit être object)', () => {
    const r = validateBundleManifest({ ...baseValid, entities: [] as unknown });
    expect(r.ok).toBe(false);
  });
  it('rejette source manquant', () => {
    const r = validateBundleManifest({ ...baseValid, source: undefined });
    expect(r.ok).toBe(false);
  });
});

describe('validateBundleIntegrity (SHA-256)', () => {
  it('true sur match exact', async () => {
    // SHA-256 de "hello" précalculé
    const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    expect(await validateBundleIntegrity('hello', expected)).toBe(true);
  });
  it('false sur mismatch', async () => {
    expect(await validateBundleIntegrity('hello', 'a'.repeat(64))).toBe(false);
  });
  it('false sur expected mauvaise longueur', async () => {
    expect(await validateBundleIntegrity('hello', 'short')).toBe(false);
  });
  it('false sur non-string inputs', async () => {
    expect(await validateBundleIntegrity(null as unknown as string, 'a'.repeat(64))).toBe(false);
    expect(await validateBundleIntegrity('hello', null as unknown as string)).toBe(false);
  });
});

describe('parseImportMode', () => {
  it('accepte dry_run et commit', () => {
    expect(parseImportMode('dry_run')).toBe('dry_run');
    expect(parseImportMode('commit')).toBe('commit');
  });
  it('renvoie null sur invalide', () => {
    expect(parseImportMode('hack')).toBe(null);
    expect(parseImportMode('')).toBe(null);
    expect(parseImportMode(null)).toBe(null);
    expect(parseImportMode(123)).toBe(null);
  });
});

describe('validateEntityBundle', () => {
  it('accepte entité whitelistée + rows valides', () => {
    const r = validateEntityBundle('pipelines', [{ id: 'p1', name: 'X' }, { id: 'p2', name: 'Y' }]);
    expect(r.ok).toBe(true);
    expect(r.valid).toBe(2);
    expect(r.invalid).toBe(0);
    expect(r.errors).toHaveLength(0);
  });
  it('rejette entité hors whitelist', () => {
    const r = validateEntityBundle('users', [{ id: 'u1' }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.reason).toBe('UNKNOWN_ENTITY');
  });
  it('rejette rows = non-array', () => {
    const r = validateEntityBundle('pipelines', 'not-array');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.reason).toBe('ENTITY_NOT_ARRAY');
  });
  it('compte les rows invalides (scalar/array/null)', () => {
    const r = validateEntityBundle('pipelines', [
      { id: 'ok1' },
      null,
      'string',
      ['array'],
      { id: 'ok2' },
    ]);
    expect(r.valid).toBe(2);
    expect(r.invalid).toBe(3);
    expect(r.ok).toBe(false);
  });
  it('rejette row.id non-string ou vide', () => {
    const r = validateEntityBundle('pipelines', [{ id: '' }, { id: 123 }]);
    expect(r.valid).toBe(0);
    expect(r.invalid).toBe(2);
  });
  it('accepte row SANS id (PK absente OK pour certaines entités)', () => {
    const r = validateEntityBundle('pipelines', [{ name: 'sans-id' }]);
    expect(r.valid).toBe(1);
    expect(r.invalid).toBe(0);
  });
  it('accepte tableau vide', () => {
    const r = validateEntityBundle('pipelines', []);
    expect(r.ok).toBe(true);
    expect(r.valid).toBe(0);
  });
});

describe('computeImportSummary', () => {
  it('aggrège totaux cross-entités', () => {
    const s = computeImportSummary({
      pipelines: { created: 2, skipped: 1, failed: 0 },
      workflows: { created: 5, skipped: 0, failed: 1 },
    });
    expect(s.created).toBe(7);
    expect(s.skipped).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.total).toBe(9);
    expect(s.per_entity.pipelines?.created).toBe(2);
  });
  it('renvoie 0 partout sur input null/undefined', () => {
    expect(computeImportSummary(null)).toEqual({
      created: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      per_entity: {},
    });
    expect(computeImportSummary(undefined).total).toBe(0);
  });
  it('skip clés non-objet ou compteurs négatifs', () => {
    const s = computeImportSummary({
      a: { created: -1, skipped: 2, failed: 3 },
      b: { created: 1 },
    });
    // -1 → 0, skipped 2, failed 3
    expect(s.created).toBe(0 + 1);
    expect(s.skipped).toBe(2 + 0);
    expect(s.failed).toBe(3 + 0);
    expect(s.per_entity.a?.created).toBe(0);
  });
  it('compte missing fields comme 0', () => {
    const s = computeImportSummary({ x: {} });
    expect(s.total).toBe(0);
    expect(s.per_entity.x).toEqual({ created: 0, skipped: 0, failed: 0 });
  });
});
