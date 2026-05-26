// ── Sprint 35 — snapshots-signature.test.ts — Tests signature + schema + size ──
// Agent C3 (fichier EXCLUSIF). Couvre :
//   1. Bundle bien formé → verifySignature ok
//   2. Tamper sur entities → verifySignature reject (expected !== actual)
//   3. Tamper sur signature.hash_hex → reject
//   4. schema_version=999 → validateBundleSchema reject
//   5. Bundle > 5 MiB → validateBundleSize reject 'bundle_too_large'
//
// Pas de D1 mock : signPayload / verifySignature / validateBundleSchema /
// validateBundleSize sont purs (crypto.subtle + JSON only).

import { describe, it, expect } from 'vitest';
import {
  signPayload,
  validateBundleSize,
  SNAPSHOT_BUNDLE_MAX_BYTES,
  SNAPSHOT_MAGIC_HEADER,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOTTABLE_ENTITIES,
  type SnapshotBundle,
  type SnapshottableEntity,
} from '../lib/snapshot-export';
import {
  verifySignature,
  validateBundleSchema,
} from '../lib/snapshot-import';

/**
 * Construit un payload unsigned valide avec toutes les 27 entités à []
 * sauf workflows + pipelines qui ont un row d'exemple. Le shape doit
 * matcher `Omit<SnapshotBundle, 'signature'>` strictement.
 */
function makeBaseUnsigned(): Omit<SnapshotBundle, 'signature'> {
  const entities = {} as Record<SnapshottableEntity, Array<Record<string, unknown>>>;
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    entities[entity] = [];
  }
  entities.workflows = [
    { id: 'w1', client_id: 'cli_x', name: 'WF A' },
    { id: 'w2', client_id: 'cli_x', name: 'WF B' },
  ];
  entities.pipelines = [
    { id: 'p1', client_id: 'cli_x', name: 'P A' },
  ];
  return {
    magic: SNAPSHOT_MAGIC_HEADER,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    generated_at: '2026-05-24T00:00:00Z',
    source: {
      client_id: 'cli_x',
      agency_id: null,
      name: 'test',
      description: null,
    },
    entities,
  };
}

describe('snapshot signature — verifySignature', () => {
  it('1. bundle bien formé → verifySignature ok', async () => {
    const unsigned = makeBaseUnsigned();
    const signed = await signPayload(unsigned);
    expect(signed.signature.algo).toBe('sha256');
    expect(signed.signature.hash_hex).toMatch(/^[0-9a-f]{64}$/);

    const result = await verifySignature(signed);
    expect(result.ok).toBe(true);
  });

  it('2. tamper sur entities → verifySignature reject (expected !== actual)', async () => {
    const unsigned = makeBaseUnsigned();
    const signed = await signPayload(unsigned);

    // Deep-clone puis altère un nom de workflow.
    const tampered = JSON.parse(JSON.stringify(signed)) as SnapshotBundle;
    const workflows = tampered.entities.workflows as Array<Record<string, unknown>>;
    workflows[0]!.name = 'tampered';

    const result = await verifySignature(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.expected).toBe(signed.signature.hash_hex);
      expect(result.actual).not.toBe(result.expected);
      expect(result.actual).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('3. tamper sur signature.hash_hex → reject', async () => {
    const unsigned = makeBaseUnsigned();
    const signed = await signPayload(unsigned);

    const tampered = JSON.parse(JSON.stringify(signed)) as SnapshotBundle;
    tampered.signature.hash_hex = '00'.repeat(32);

    const result = await verifySignature(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.expected).toBe('00'.repeat(32));
      expect(result.actual).toBe(signed.signature.hash_hex);
    }
  });
});

describe('snapshot schema — validateBundleSchema', () => {
  it('4. schema_version=999 → validateBundleSchema reject', async () => {
    const unsigned = makeBaseUnsigned();
    const signed = await signPayload(unsigned);

    const bad = JSON.parse(JSON.stringify(signed)) as SnapshotBundle;
    // Cast pour bypasser le type littéral `1` au compile.
    (bad as unknown as { schema_version: number }).schema_version = 999;

    const result = validateBundleSchema(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // L'implem renvoie 'unsupported_schema_version'.
      expect(result.error).toMatch(/schema|version/i);
    }
  });

  it('4b. bundle bien formé → validateBundleSchema ok (contrôle positif)', async () => {
    const unsigned = makeBaseUnsigned();
    const signed = await signPayload(unsigned);
    const result = validateBundleSchema(signed);
    expect(result.ok).toBe(true);
  });
});

describe('snapshot size — validateBundleSize', () => {
  it('5. bundle > 5 MiB → validateBundleSize reject bundle_too_large', () => {
    // 6 MiB > SNAPSHOT_BUNDLE_MAX_BYTES (5 MiB).
    const huge = 'x'.repeat(6 * 1024 * 1024);
    expect(huge.length).toBeGreaterThan(SNAPSHOT_BUNDLE_MAX_BYTES);

    const result = validateBundleSize(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('bundle_too_large');
    }
  });

  it('5b. bundle <= 5 MiB → validateBundleSize ok (contrôle positif)', () => {
    const small = 'x'.repeat(1024); // 1 KiB
    const result = validateBundleSize(small);
    expect(result.ok).toBe(true);
  });
});
