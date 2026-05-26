// ── snapshots-list-engine.test.ts — Utils P2-2 list/CRUD pure helpers ──────
// Couvre validation nom/desc/status, taille bundle, checksum SHA-256, parse
// filtres list, sanitize filename, compute summary.

import { describe, it, expect } from 'vitest';
import {
  SNAPSHOTS_LIST_ERROR_CODES,
  MAX_SNAPSHOT_NAME_LENGTH,
  MAX_SNAPSHOT_DESCRIPTION_LENGTH,
  MAX_BUNDLE_SIZE_MB,
  MAX_BUNDLE_SIZE_BYTES,
  VALID_SNAPSHOT_STATUSES,
  MAX_LIST_LIMIT,
  DEFAULT_LIST_LIMIT,
  validateSnapshotName,
  validateSnapshotDescription,
  validateSnapshotStatus,
  validateBundleSize,
  computeBundleChecksum,
  checksumsEqual,
  parseSnapshotFilters,
  sanitizeFilenamePart,
  computeTablesSummary,
  parseTablesSummaryJson,
} from '../lib/snapshots-list-engine';

describe('SNAPSHOTS_LIST_ERROR_CODES & constants', () => {
  it('expose les codes canoniques + frozen', () => {
    expect(SNAPSHOTS_LIST_ERROR_CODES.BUNDLE_TOO_LARGE).toBe('BUNDLE_TOO_LARGE');
    expect(Object.isFrozen(SNAPSHOTS_LIST_ERROR_CODES)).toBe(true);
  });
  it('caps cohérents', () => {
    expect(MAX_SNAPSHOT_NAME_LENGTH).toBe(200);
    expect(MAX_SNAPSHOT_DESCRIPTION_LENGTH).toBe(2000);
    expect(MAX_BUNDLE_SIZE_MB).toBe(50);
    expect(MAX_BUNDLE_SIZE_BYTES).toBe(50 * 1024 * 1024);
    expect(DEFAULT_LIST_LIMIT).toBe(100);
    expect(MAX_LIST_LIMIT).toBe(100);
  });
  it('statuses whitelist = draft|published|archived', () => {
    expect(VALID_SNAPSHOT_STATUSES.has('draft')).toBe(true);
    expect(VALID_SNAPSHOT_STATUSES.has('published')).toBe(true);
    expect(VALID_SNAPSHOT_STATUSES.has('archived')).toBe(true);
    expect(VALID_SNAPSHOT_STATUSES.has('deleted')).toBe(false);
  });
});

describe('validateSnapshotName', () => {
  it('accepte un nom non vide', () => {
    expect(validateSnapshotName('My snapshot')).toBe(true);
    expect(validateSnapshotName('A'.repeat(200))).toBe(true);
  });
  it('rejette vide / whitespace-only / > MAX', () => {
    expect(validateSnapshotName('')).toBe(false);
    expect(validateSnapshotName('   ')).toBe(false);
    expect(validateSnapshotName('A'.repeat(201))).toBe(false);
    expect(validateSnapshotName(null)).toBe(false);
    expect(validateSnapshotName(123)).toBe(false);
  });
});

describe('validateSnapshotDescription', () => {
  it('accepte vide / null / undefined', () => {
    expect(validateSnapshotDescription(null)).toBe(true);
    expect(validateSnapshotDescription(undefined)).toBe(true);
    expect(validateSnapshotDescription('')).toBe(true);
  });
  it('accepte ≤ 2000 chars', () => {
    expect(validateSnapshotDescription('x')).toBe(true);
    expect(validateSnapshotDescription('y'.repeat(2000))).toBe(true);
  });
  it('rejette > 2000 chars / non-string non-null', () => {
    expect(validateSnapshotDescription('z'.repeat(2001))).toBe(false);
    expect(validateSnapshotDescription(123)).toBe(false);
  });
});

describe('validateSnapshotStatus', () => {
  it('accepte draft/published/archived', () => {
    expect(validateSnapshotStatus('draft')).toBe(true);
    expect(validateSnapshotStatus('published')).toBe(true);
    expect(validateSnapshotStatus('archived')).toBe(true);
  });
  it('rejette autres / non-string', () => {
    expect(validateSnapshotStatus('deleted')).toBe(false);
    expect(validateSnapshotStatus('DRAFT')).toBe(false); // case sensitive
    expect(validateSnapshotStatus(null)).toBe(false);
  });
});

describe('validateBundleSize', () => {
  it('accepte une taille raisonnable', () => {
    const r = validateBundleSize(1024);
    expect(r.ok).toBe(true);
    expect(r.size).toBe(1024);
  });
  it('rejette > MAX_BUNDLE_SIZE_BYTES', () => {
    const r = validateBundleSize(MAX_BUNDLE_SIZE_BYTES + 1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('BUNDLE_TOO_LARGE');
  });
  it('rejette négatif / NaN / non-number', () => {
    expect(validateBundleSize(-1).ok).toBe(false);
    expect(validateBundleSize(Number.NaN).ok).toBe(false);
    expect(validateBundleSize('1024' as unknown).ok).toBe(false);
  });
  it('accepte 0 (bundle vide)', () => {
    expect(validateBundleSize(0).ok).toBe(true);
  });
});

describe('computeBundleChecksum + checksumsEqual', () => {
  it('produit un SHA-256 hex 64 chars stable', async () => {
    const h1 = await computeBundleChecksum('hello world');
    expect(h1).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h1)).toBe(true);
    const h2 = await computeBundleChecksum('hello world');
    expect(h1).toBe(h2); // deterministic
  });
  it('accepte string ou Uint8Array', async () => {
    const fromStr = await computeBundleChecksum('abc');
    const fromBytes = await computeBundleChecksum(new TextEncoder().encode('abc'));
    expect(fromStr).toBe(fromBytes);
  });
  it('hashes différents pour input différents', async () => {
    const h1 = await computeBundleChecksum('a');
    const h2 = await computeBundleChecksum('b');
    expect(h1).not.toBe(h2);
  });
  it('checksumsEqual time-constant true sur match', async () => {
    const h = await computeBundleChecksum('payload');
    expect(checksumsEqual(h, h)).toBe(true);
  });
  it('checksumsEqual false sur mismatch / non-string', () => {
    expect(checksumsEqual('abc', 'abd')).toBe(false);
    expect(checksumsEqual('abc', 'abcd')).toBe(false);
    expect(checksumsEqual(null, 'abc')).toBe(false);
  });
});

describe('parseSnapshotFilters', () => {
  it('parse status valide', () => {
    const r = parseSnapshotFilters(new URLSearchParams('status=draft'));
    expect(r.status).toBe('draft');
  });
  it('ignore status invalide', () => {
    const r = parseSnapshotFilters(new URLSearchParams('status=hacker'));
    expect(r.status).toBeUndefined();
  });
  it('parse createdAfter / createdBefore ISO', () => {
    const r = parseSnapshotFilters(
      new URLSearchParams('created_after=2026-01-01&created_before=2026-12-31'),
    );
    expect(r.createdAfter).toBe('2026-01-01');
    expect(r.createdBefore).toBe('2026-12-31');
  });
  it('ignore dates invalides', () => {
    const r = parseSnapshotFilters(new URLSearchParams('created_after=notadate'));
    expect(r.createdAfter).toBeUndefined();
  });
  it('clamp limit à MAX_LIST_LIMIT', () => {
    const r = parseSnapshotFilters(new URLSearchParams('limit=9999'));
    expect(r.limit).toBe(MAX_LIST_LIMIT);
  });
  it('default limit si absent', () => {
    expect(parseSnapshotFilters(new URLSearchParams()).limit).toBe(DEFAULT_LIST_LIMIT);
  });
});

describe('sanitizeFilenamePart', () => {
  it('remplace les chars dangereux par -', () => {
    // / et space sont remplacés. Dots préservés (font partie de \w.-).
    expect(sanitizeFilenamePart('hello world/../etc')).toBe('hello-world-..-etc');
    expect(sanitizeFilenamePart('foo<bar>baz')).toBe('foo-bar-baz');
  });
  it('fallback "snapshot" si vide', () => {
    expect(sanitizeFilenamePart('')).toBe('snapshot');
    expect(sanitizeFilenamePart('!!!')).toBe('snapshot');
  });
  it('cap à 80 chars', () => {
    expect(sanitizeFilenamePart('a'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
  it('preserve dots et underscores', () => {
    expect(sanitizeFilenamePart('my_file.json')).toBe('my_file.json');
  });
});

describe('computeTablesSummary', () => {
  it('compte les rows par entité', () => {
    const s = computeTablesSummary({
      pipelines: [{ id: '1' }, { id: '2' }],
      workflows: [],
      other: [{ id: 'x' }],
    });
    expect(s.pipelines).toBe(2);
    expect(s.workflows).toBe(0);
    expect(s.other).toBe(1);
  });
  it('returns {} sur null/undefined', () => {
    expect(computeTablesSummary(null)).toEqual({});
    expect(computeTablesSummary(undefined)).toEqual({});
  });
  it('skip non-array values', () => {
    const s = computeTablesSummary({ a: [{}], b: 'not-array' as unknown });
    expect(s.a).toBe(1);
    expect(s.b).toBe(0);
  });
});

describe('parseTablesSummaryJson', () => {
  it('parse un summary JSON valide', () => {
    const s = parseTablesSummaryJson(JSON.stringify({ pipelines: 5, workflows: 3 }));
    expect(s).toEqual({ pipelines: 5, workflows: 3 });
  });
  it('renvoie null sur JSON invalide', () => {
    expect(parseTablesSummaryJson('not json')).toBe(null);
    expect(parseTablesSummaryJson('')).toBe(null);
    expect(parseTablesSummaryJson(null)).toBe(null);
  });
  it('renvoie null sur array (pas object)', () => {
    expect(parseTablesSummaryJson('[1,2,3]')).toBe(null);
  });
  it('skip valeurs négatives ou non-number', () => {
    const s = parseTablesSummaryJson(JSON.stringify({ a: 5, b: -1, c: 'x' }));
    expect(s).toEqual({ a: 5 });
  });
});
