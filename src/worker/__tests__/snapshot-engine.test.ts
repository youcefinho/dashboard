// ── snapshot-engine.test.ts — Sprint 35 renforcement (helpers PURS) ─────────
// 100 % additif. NE remplace pas snapshots-signature / snapshots-export-coverage /
// snapshots-import-idempotent (qui couvrent les fichiers existants).
//
// Couvre `src/worker/lib/snapshot-engine.ts` :
//   - signBundle / verifyBundleSignature (HMAC SHA-256)
//   - validateBundleStructure (codes d'erreur stables)
//   - buildIdMapping (uuid + unicité)
//   - topologicalSort (depth + parent AVANT enfant)
//   - parseSignatureMismatch (3 formats)
//   - validateEngineBundleSize (10 MiB cap)
//   - SNAPSHOT_ERROR_CODES (stabilité contractuelle)
//
// Tests offline-safe (zéro D1, zéro réseau). Web Crypto API native Workers
// (crypto.subtle.importKey / sign / digest / randomUUID) supportée par
// l'environnement vitest pool workers.

import { describe, it, expect } from 'vitest';
import {
  signBundle,
  verifyBundleSignature,
  validateBundleStructure,
  buildIdMapping,
  topologicalSort,
  parseSignatureMismatch,
  validateEngineBundleSize,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_MAX_BUNDLE_BYTES,
  type EntityRecord,
} from '../lib/snapshot-engine';
import {
  SNAPSHOTTABLE_ENTITIES,
  SNAPSHOT_MAGIC_HEADER,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotBundle,
  type SnapshottableEntity,
} from '../lib/snapshot-export';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeBundle(overrides: Partial<SnapshotBundle> = {}): SnapshotBundle {
  const entities = {} as Record<SnapshottableEntity, Array<Record<string, unknown>>>;
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    entities[entity] = [];
  }
  return {
    magic: SNAPSHOT_MAGIC_HEADER,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    generated_at: '2026-05-26T00:00:00.000Z',
    source: {
      client_id: 'cli_test',
      agency_id: null,
      name: 'test',
      description: null,
    },
    entities,
    signature: { algo: 'sha256', hash_hex: 'a'.repeat(64) },
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// HMAC signBundle / verifyBundleSignature
// ═════════════════════════════════════════════════════════════════════════════

describe('snapshot-engine — signBundle (HMAC SHA-256)', () => {
  it('produit un hex 64 caractères déterministe pour même (content, secret)', async () => {
    const content = '{"foo":"bar"}';
    const secret = 'tenant-secret-A';
    const sig1 = await signBundle(content, secret);
    const sig2 = await signBundle(content, secret);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);
    expect(sig1).toBe(sig2);
  });

  it('produit des signatures différentes pour des secrets différents (même content)', async () => {
    const content = '{"foo":"bar"}';
    const sigA = await signBundle(content, 'secret-A');
    const sigB = await signBundle(content, 'secret-B');
    expect(sigA).not.toBe(sigB);
    expect(sigA).toMatch(/^[0-9a-f]{64}$/);
    expect(sigB).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produit des signatures différentes pour des contents différents (même secret)', async () => {
    const secret = 'tenant-secret';
    const sig1 = await signBundle('{"a":1}', secret);
    const sig2 = await signBundle('{"a":2}', secret);
    expect(sig1).not.toBe(sig2);
  });

  it('throw "empty_secret" si secret vide', async () => {
    await expect(signBundle('content', '')).rejects.toThrow(
      SNAPSHOT_ERROR_CODES.EMPTY_SECRET,
    );
  });
});

describe('snapshot-engine — verifyBundleSignature (constant-time)', () => {
  it('accept signature valide', async () => {
    const content = '{"data":"valid"}';
    const secret = 'shared-secret';
    const sig = await signBundle(content, secret);
    const ok = await verifyBundleSignature(content, sig, secret);
    expect(ok).toBe(true);
  });

  it('reject signature corrompue (1 caractère altéré)', async () => {
    const content = '{"data":"valid"}';
    const secret = 'shared-secret';
    const sig = await signBundle(content, secret);
    // Flip un caractère hex (a↔b)
    const tampered = sig[0] === 'a' ? 'b' + sig.slice(1) : 'a' + sig.slice(1);
    const ok = await verifyBundleSignature(content, tampered, secret);
    expect(ok).toBe(false);
  });

  it('reject signature de longueur ≠ 64', async () => {
    const ok = await verifyBundleSignature('content', 'tooshort', 'secret');
    expect(ok).toBe(false);
  });

  it('reject signature avec caractères non-hex', async () => {
    const ok = await verifyBundleSignature(
      'content',
      'z'.repeat(64),
      'secret',
    );
    expect(ok).toBe(false);
  });

  it('reject si secret vide', async () => {
    const ok = await verifyBundleSignature('content', 'a'.repeat(64), '');
    expect(ok).toBe(false);
  });

  it('reject si content modifié (même signature, secret correct)', async () => {
    const secret = 'shared-secret';
    const sig = await signBundle('original-content', secret);
    const ok = await verifyBundleSignature('modified-content', sig, secret);
    expect(ok).toBe(false);
  });

  it('case-insensitive sur la signature (hex upper / lower mix)', async () => {
    const content = '{"x":1}';
    const secret = 'k';
    const sig = await signBundle(content, secret);
    const okUpper = await verifyBundleSignature(content, sig.toUpperCase(), secret);
    expect(okUpper).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// validateBundleStructure
// ═════════════════════════════════════════════════════════════════════════════

describe('snapshot-engine — validateBundleStructure', () => {
  it('accept bundle bien formé', () => {
    const bundle = makeBundle();
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.magic).toBe(SNAPSHOT_MAGIC_HEADER);
    }
  });

  it('accept bundle avec entities vide ({})', () => {
    const bundle = makeBundle({
      entities: {} as Record<SnapshottableEntity, Array<Record<string, unknown>>>,
    });
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(true);
  });

  it('reject raw=null avec code INVALID_JSON', () => {
    const result = validateBundleStructure(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(SNAPSHOT_ERROR_CODES.INVALID_JSON);
  });

  it('reject raw=string avec code INVALID_JSON', () => {
    const result = validateBundleStructure('not-an-object');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(SNAPSHOT_ERROR_CODES.INVALID_JSON);
  });

  it('reject magic absent avec code INVALID_MAGIC', () => {
    const bundle = makeBundle();
    // @ts-expect-error - test purposes
    delete bundle.magic;
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(SNAPSHOT_ERROR_CODES.INVALID_MAGIC);
  });

  it('reject schema_version=null avec code UNSUPPORTED_SCHEMA_VERSION', () => {
    const bundle = makeBundle();
    (bundle as unknown as { schema_version: number | null }).schema_version = null;
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(SNAPSHOT_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION);
    }
  });

  it('reject schema_version=999 avec code UNSUPPORTED_SCHEMA_VERSION', () => {
    const bundle = makeBundle();
    (bundle as unknown as { schema_version: number }).schema_version = 999;
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(SNAPSHOT_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION);
    }
  });

  it('reject entity hors whitelist avec code ENTITY_NOT_WHITELISTED', () => {
    const bundle = makeBundle();
    (bundle.entities as Record<string, unknown>).leads = [{ id: 'l1' }];
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(SNAPSHOT_ERROR_CODES.ENTITY_NOT_WHITELISTED);
    }
  });

  it('reject entity non-array avec code ENTITY_NOT_ARRAY', () => {
    const bundle = makeBundle();
    (bundle.entities as Record<string, unknown>).workflows = { not: 'array' };
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(SNAPSHOT_ERROR_CODES.ENTITY_NOT_ARRAY);
    }
  });

  it('reject signature absente avec code MISSING_SIGNATURE', () => {
    const bundle = makeBundle();
    // @ts-expect-error - test purposes
    delete bundle.signature;
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(SNAPSHOT_ERROR_CODES.MISSING_SIGNATURE);
    }
  });

  it('reject signature.hash_hex vide avec code MISSING_SIGNATURE', () => {
    const bundle = makeBundle({ signature: { algo: 'sha256', hash_hex: '' } });
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(SNAPSHOT_ERROR_CODES.MISSING_SIGNATURE);
    }
  });

  it('reject source absent avec code MALFORMED_BUNDLE', () => {
    const bundle = makeBundle();
    // @ts-expect-error - test purposes
    delete bundle.source;
    const result = validateBundleStructure(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(SNAPSHOT_ERROR_CODES.MALFORMED_BUNDLE);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// buildIdMapping
// ═════════════════════════════════════════════════════════════════════════════

describe('snapshot-engine — buildIdMapping', () => {
  it('100 entités distinctes → 100 uuids uniques', () => {
    const entities: EntityRecord = {
      workflows: Array.from({ length: 100 }, (_, i) => ({
        id: `wf_${i}`,
        client_id: 'cli_x',
      })),
    };
    const mapping = buildIdMapping(entities);
    const keys = Object.keys(mapping);
    expect(keys.length).toBe(100);
    const values = Object.values(mapping);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(100);
    // Tous au format uuid v4 (8-4-4-4-12 hex).
    for (const v of values) {
      expect(v).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it('rows sans id (ou id non-string) sont ignorées sans crasher', () => {
    const entities: EntityRecord = {
      workflows: [
        { id: 'wf_1', client_id: 'cli_x' },
        { client_id: 'cli_x' }, // pas d'id
        { id: 42 as unknown as string, client_id: 'cli_x' }, // id non-string
        { id: '', client_id: 'cli_x' }, // id vide
      ],
    };
    const mapping = buildIdMapping(entities);
    expect(Object.keys(mapping)).toEqual(['wf_1']);
  });

  it('même old_id partagé entre 2 entités → 1 seul mapping (premier wins)', () => {
    const sharedId = 'shared-id-x';
    const entities: EntityRecord = {
      workflows: [{ id: sharedId, client_id: 'cli_x' }],
      forms: [{ id: sharedId, client_id: 'cli_x' }],
    };
    const mapping = buildIdMapping(entities);
    expect(Object.keys(mapping)).toEqual([sharedId]);
    expect(mapping[sharedId]).toMatch(/^[0-9a-f]{8}-/i);
  });

  it('entities={} → mapping vide', () => {
    expect(buildIdMapping({})).toEqual({});
  });

  it('entities avec clé hors whitelist → silencieusement ignoré', () => {
    const entities = {
      // @ts-expect-error - test purposes
      leads: [{ id: 'l1' }],
      workflows: [{ id: 'wf_1' }],
    } as EntityRecord;
    const mapping = buildIdMapping(entities);
    expect(Object.keys(mapping)).toEqual(['wf_1']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// topologicalSort
// ═════════════════════════════════════════════════════════════════════════════

describe('snapshot-engine — topologicalSort', () => {
  it('workflows AVANT workflow_steps (parent → enfant)', () => {
    const entities: EntityRecord = {
      workflow_steps: [{ id: 's1', workflow_id: 'wf_1' }],
      workflows: [{ id: 'wf_1', client_id: 'cli_x', folder_id: 'f1' }],
      workflow_folders: [{ id: 'f1', client_id: 'cli_x' }],
    };
    const sorted = topologicalSort(entities);
    const order = sorted.map((s) => s.entity);
    const idxFolder = order.indexOf('workflow_folders');
    const idxWf = order.indexOf('workflows');
    const idxStep = order.indexOf('workflow_steps');
    expect(idxFolder).toBeGreaterThanOrEqual(0);
    expect(idxFolder).toBeLessThan(idxWf);
    expect(idxWf).toBeLessThan(idxStep);
  });

  it('forms AVANT form_field_options', () => {
    const entities: EntityRecord = {
      form_field_options: [{ id: 'opt_1', form_id: 'f1' }],
      forms: [{ id: 'f1', client_id: 'cli_x' }],
    };
    const sorted = topologicalSort(entities);
    const order = sorted.map((s) => s.entity);
    expect(order.indexOf('forms')).toBeLessThan(order.indexOf('form_field_options'));
  });

  it('pipelines AVANT pipeline_stages', () => {
    const entities: EntityRecord = {
      pipeline_stages: [{ id: 's1', pipeline_id: 'p1', sort_order: 1 }],
      pipelines: [{ id: 'p1', client_id: 'cli_x' }],
    };
    const sorted = topologicalSort(entities);
    const order = sorted.map((s) => s.entity);
    expect(order.indexOf('pipelines')).toBeLessThan(order.indexOf('pipeline_stages'));
  });

  it('calendars AVANT availability_rules', () => {
    const entities: EntityRecord = {
      availability_rules: [{ id: 'a1', calendar_id: 'c1', day_of_week: 1 }],
      calendars: [{ id: 'c1', client_id: 'cli_x' }],
    };
    const sorted = topologicalSort(entities);
    const order = sorted.map((s) => s.entity);
    expect(order.indexOf('calendars')).toBeLessThan(
      order.indexOf('availability_rules'),
    );
  });

  it('template_folders AVANT email_templates / sms_templates / forms', () => {
    const entities: EntityRecord = {
      email_templates: [{ id: 'et_1', folder_id: 'tf_1' }],
      sms_templates: [{ id: 'st_1', folder_id: 'tf_1' }],
      forms: [{ id: 'f_1', folder_id: 'tf_1' }],
      template_folders: [{ id: 'tf_1', client_id: 'cli_x' }],
    };
    const sorted = topologicalSort(entities);
    const order = sorted.map((s) => s.entity);
    const idxTf = order.indexOf('template_folders');
    expect(idxTf).toBeLessThan(order.indexOf('email_templates'));
    expect(idxTf).toBeLessThan(order.indexOf('sms_templates'));
    expect(idxTf).toBeLessThan(order.indexOf('forms'));
  });

  it('depth=0 pour entités sans dépendance (workflow_folders, calendars, etc.)', () => {
    const entities: EntityRecord = {
      workflow_folders: [{ id: 'f1' }],
      calendars: [{ id: 'c1' }],
      pipelines: [{ id: 'p1' }],
    };
    const sorted = topologicalSort(entities);
    for (const s of sorted) {
      expect(s.depth).toBe(0);
    }
  });

  it('depth croît avec la chaîne de dépendance (folders=0, workflows=1, steps=2)', () => {
    const entities: EntityRecord = {
      workflow_folders: [{ id: 'f1' }],
      workflows: [{ id: 'wf_1', folder_id: 'f1' }],
      workflow_steps: [{ id: 's1', workflow_id: 'wf_1' }],
    };
    const sorted = topologicalSort(entities);
    const byEntity = new Map(sorted.map((s) => [s.entity, s.depth]));
    expect(byEntity.get('workflow_folders')).toBe(0);
    expect(byEntity.get('workflows')).toBe(1);
    expect(byEntity.get('workflow_steps')).toBe(2);
  });

  it('entities={} → tableau vide', () => {
    expect(topologicalSort({})).toEqual([]);
  });

  it('ordre déterministe : 2 calls successifs produisent le même output', () => {
    const entities: EntityRecord = {
      workflows: [{ id: 'wf_1' }],
      pipelines: [{ id: 'p_1' }],
      forms: [{ id: 'f_1' }],
      calendars: [{ id: 'c_1' }],
    };
    const sorted1 = topologicalSort(entities).map((s) => s.entity);
    const sorted2 = topologicalSort(entities).map((s) => s.entity);
    expect(sorted1).toEqual(sorted2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// parseSignatureMismatch
// ═════════════════════════════════════════════════════════════════════════════

describe('snapshot-engine — parseSignatureMismatch', () => {
  it('extrait depuis format "expected=<hex> actual=<hex>"', () => {
    const exp = 'a'.repeat(64);
    const act = 'b'.repeat(64);
    const result = parseSignatureMismatch(
      `signature_mismatch: expected=${exp} actual=${act}`,
    );
    expect(result).toEqual({ expected: exp, actual: act });
  });

  it('extrait depuis format "expected: <hex>, actual: <hex>"', () => {
    const exp = 'c'.repeat(64);
    const act = 'd'.repeat(64);
    const result = parseSignatureMismatch(
      `Error: expected: ${exp}, actual: ${act}`,
    );
    expect(result).toEqual({ expected: exp, actual: act });
  });

  it('extrait depuis JSON {"meta":{"expected","actual"}}', () => {
    const exp = 'e'.repeat(64);
    const act = 'f'.repeat(64);
    const json = JSON.stringify({
      error: 'signature_mismatch',
      meta: { expected: exp, actual: act },
    });
    const result = parseSignatureMismatch(json);
    expect(result).toEqual({ expected: exp, actual: act });
  });

  it('extrait depuis Error instance', () => {
    const exp = '0'.repeat(64);
    const act = '1'.repeat(64);
    const err = new Error(`expected=${exp} actual=${act}`);
    const result = parseSignatureMismatch(err);
    expect(result).toEqual({ expected: exp, actual: act });
  });

  it('retourne null si format inconnu', () => {
    expect(parseSignatureMismatch('random error message')).toBeNull();
    expect(parseSignatureMismatch('')).toBeNull();
    expect(parseSignatureMismatch('expected=short actual=alsoshort')).toBeNull();
  });

  it('retourne null si hex pas exactement 64 caractères', () => {
    expect(
      parseSignatureMismatch(`expected=${'a'.repeat(63)} actual=${'b'.repeat(63)}`),
    ).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// validateEngineBundleSize + constants
// ═════════════════════════════════════════════════════════════════════════════

describe('snapshot-engine — validateEngineBundleSize', () => {
  it('accept bundle <= 10 MiB', () => {
    const small = 'x'.repeat(1024); // 1 KiB
    const result = validateEngineBundleSize(small);
    expect(result.ok).toBe(true);
  });

  it('reject bundle > 10 MiB avec code BUNDLE_TOO_LARGE', () => {
    const huge = 'x'.repeat(SNAPSHOT_MAX_BUNDLE_BYTES + 1);
    const result = validateEngineBundleSize(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(SNAPSHOT_ERROR_CODES.BUNDLE_TOO_LARGE);
    }
  });

  it('accept bundle exactement = 10 MiB (borne incluse)', () => {
    const exact = 'x'.repeat(SNAPSHOT_MAX_BUNDLE_BYTES);
    const result = validateEngineBundleSize(exact);
    expect(result.ok).toBe(true);
  });

  it('SNAPSHOT_MAX_BUNDLE_BYTES vaut 10 MiB strict', () => {
    expect(SNAPSHOT_MAX_BUNDLE_BYTES).toBe(10 * 1024 * 1024);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SNAPSHOT_ERROR_CODES — stabilité contractuelle
// ═════════════════════════════════════════════════════════════════════════════

describe('snapshot-engine — SNAPSHOT_ERROR_CODES (stabilité)', () => {
  it('expose au moins 8 codes stables', () => {
    expect(Object.keys(SNAPSHOT_ERROR_CODES).length).toBeGreaterThanOrEqual(8);
  });

  it('chaque code est snake_case lower (stable contract)', () => {
    for (const [, value] of Object.entries(SNAPSHOT_ERROR_CODES)) {
      expect(value).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('valeurs distinctes (pas de doublon)', () => {
    const values = Object.values(SNAPSHOT_ERROR_CODES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
