// ── data-reconcile-engine.test.ts — Tests data-reconcile-engine.ts ───────────
//
// Couvre les helpers PURS reconcile : validation query (pass/dryRun/batchSize),
// isStaleRecord, formatReconcileReport, chunkBatch, computeReconcileSummary.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  DATA_RECONCILE_ERROR_CODES,
  RECONCILE_PASS_TYPES,
  MAX_BATCH_SIZE,
  DEFAULT_BATCH_SIZE,
  DEFAULT_STALE_DAYS,
  validateReconcileQuery,
  isStaleRecord,
  formatReconcileReport,
  chunkBatch,
  computeReconcileSummary,
} from '../lib/data-reconcile-engine';

// ── Constants ───────────────────────────────────────────────

describe('data-reconcile-engine — constants', () => {
  it('DATA_RECONCILE_ERROR_CODES is frozen', () => {
    expect(Object.isFrozen(DATA_RECONCILE_ERROR_CODES)).toBe(true);
  });

  it('RECONCILE_PASS_TYPES is frozen and contains brief types', () => {
    expect(Object.isFrozen(RECONCILE_PASS_TYPES)).toBe(true);
    expect(RECONCILE_PASS_TYPES).toContain('orphans');
    expect(RECONCILE_PASS_TYPES).toContain('duplicates');
    expect(RECONCILE_PASS_TYPES).toContain('stale');
  });

  it('MAX_BATCH_SIZE is 1000', () => {
    expect(MAX_BATCH_SIZE).toBe(1000);
  });

  it('DEFAULT_STALE_DAYS is sensible', () => {
    expect(DEFAULT_STALE_DAYS).toBeGreaterThan(0);
    expect(DEFAULT_STALE_DAYS).toBeLessThanOrEqual(365);
  });
});

// ── validateReconcileQuery ──────────────────────────────────

describe('validateReconcileQuery', () => {
  it('accepts minimal valid input', () => {
    const r = validateReconcileQuery({ pass: 'orphans' });
    expect(r.ok).toBe(true);
    expect(r.pass).toBe('orphans');
    expect(r.dryRun).toBe(true); // default
    expect(r.batchSize).toBe(DEFAULT_BATCH_SIZE);
  });

  it('accepts duplicates pass', () => {
    const r = validateReconcileQuery({ pass: 'duplicates' });
    expect(r.ok).toBe(true);
  });

  it('accepts stale pass', () => {
    const r = validateReconcileQuery({ pass: 'stale' });
    expect(r.ok).toBe(true);
    expect(r.thresholdDays).toBe(DEFAULT_STALE_DAYS);
  });

  it('rejects null input', () => {
    const r = validateReconcileQuery(null as never);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DATA_RECONCILE_ERROR_CODES.INVALID_INPUT);
  });

  it('rejects missing pass', () => {
    const r = validateReconcileQuery({});
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DATA_RECONCILE_ERROR_CODES.INVALID_PASS_TYPE);
  });

  it('rejects unknown pass', () => {
    const r = validateReconcileQuery({ pass: 'evil' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DATA_RECONCILE_ERROR_CODES.INVALID_PASS_TYPE);
  });

  it('rejects non-boolean dryRun', () => {
    const r = validateReconcileQuery({ pass: 'orphans', dryRun: 'yes' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DATA_RECONCILE_ERROR_CODES.INVALID_DRY_RUN);
  });

  it('accepts dryRun=false', () => {
    const r = validateReconcileQuery({ pass: 'orphans', dryRun: false });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(false);
  });

  it('rejects batchSize > MAX_BATCH_SIZE', () => {
    const r = validateReconcileQuery({ pass: 'orphans', batchSize: 9999 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DATA_RECONCILE_ERROR_CODES.INVALID_BATCH_SIZE);
  });

  it('rejects batchSize < 1', () => {
    const r = validateReconcileQuery({ pass: 'orphans', batchSize: 0 });
    expect(r.ok).toBe(false);
  });

  it('rejects non-integer batchSize', () => {
    const r = validateReconcileQuery({ pass: 'orphans', batchSize: 1.5 });
    expect(r.ok).toBe(false);
  });

  it('accepts batchSize at MAX_BATCH_SIZE boundary', () => {
    const r = validateReconcileQuery({ pass: 'orphans', batchSize: MAX_BATCH_SIZE });
    expect(r.ok).toBe(true);
    expect(r.batchSize).toBe(MAX_BATCH_SIZE);
  });

  it('rejects thresholdDays < 1', () => {
    const r = validateReconcileQuery({ pass: 'stale', thresholdDays: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DATA_RECONCILE_ERROR_CODES.INVALID_THRESHOLD_DAYS);
  });

  it('rejects thresholdDays > 10 years', () => {
    const r = validateReconcileQuery({ pass: 'stale', thresholdDays: 99999 });
    expect(r.ok).toBe(false);
  });

  it('accepts custom valid thresholdDays', () => {
    const r = validateReconcileQuery({ pass: 'stale', thresholdDays: 365 });
    expect(r.ok).toBe(true);
    expect(r.thresholdDays).toBe(365);
  });
});

// ── isStaleRecord ───────────────────────────────────────────

describe('isStaleRecord', () => {
  const NOW = Date.parse('2026-05-26T12:00:00Z');

  it('returns true when updated_at older than threshold', () => {
    const old = '2024-01-01T00:00:00Z';
    expect(isStaleRecord({ updated_at: old }, 90, NOW)).toBe(true);
  });

  it('returns false when updated_at recent', () => {
    const recent = new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStaleRecord({ updated_at: recent }, 90, NOW)).toBe(false);
  });

  it('falls back to created_at if updated_at missing', () => {
    const old = '2024-01-01T00:00:00Z';
    expect(isStaleRecord({ created_at: old }, 90, NOW)).toBe(true);
  });

  it('falls back to last_seen_at as middle priority', () => {
    const old = '2024-01-01T00:00:00Z';
    expect(isStaleRecord({ last_seen_at: old }, 90, NOW)).toBe(true);
  });

  it('returns false on null input', () => {
    expect(isStaleRecord(null, 90, NOW)).toBe(false);
  });

  it('returns false on empty object', () => {
    expect(isStaleRecord({}, 90, NOW)).toBe(false);
  });

  it('accepts Date directly', () => {
    expect(isStaleRecord(new Date('2024-01-01'), 90, NOW)).toBe(true);
  });

  it('returns false on invalid date string', () => {
    expect(isStaleRecord({ updated_at: 'garbage' }, 90, NOW)).toBe(false);
  });

  it('returns false on invalid threshold', () => {
    expect(isStaleRecord({ updated_at: '2020-01-01' }, 0, NOW)).toBe(false);
    expect(isStaleRecord({ updated_at: '2020-01-01' }, NaN as never, NOW)).toBe(false);
  });

  it('boundary: exactly at threshold returns false (>= strict)', () => {
    const threshold = 90;
    const boundary = NOW - threshold * 24 * 60 * 60 * 1000;
    expect(isStaleRecord({ updated_at: new Date(boundary) }, threshold, NOW)).toBe(false);
  });
});

// ── formatReconcileReport ───────────────────────────────────

describe('formatReconcileReport', () => {
  it('returns empty report for empty input', () => {
    const r = formatReconcileReport([]);
    expect(r.summary.total).toBe(0);
    expect(r.details).toEqual([]);
    expect(typeof r.generated_at).toBe('string');
  });

  it('returns empty report for null input', () => {
    const r = formatReconcileReport(null);
    expect(r.summary.total).toBe(0);
  });

  it('aggregates counts by type', () => {
    const r = formatReconcileReport([
      { relation: 'leads.client_id', type: 'orphans', count: 5 },
      { relation: 'messages.lead_id', type: 'orphans', count: 3 },
      { relation: 'customers.email', type: 'duplicates', count: 2 },
    ]);
    expect(r.summary.total).toBe(10);
    expect(r.summary.byType.orphans).toBe(8);
    expect(r.summary.byType.duplicates).toBe(2);
    expect(r.details.length).toBe(3);
  });

  it('skips entries with count <= 0', () => {
    const r = formatReconcileReport([
      { relation: 'a', type: 'orphans', count: 5 },
      { relation: 'b', type: 'orphans', count: 0 },
      { relation: 'c', type: 'orphans', count: -1 },
    ]);
    expect(r.summary.total).toBe(5);
    expect(r.details.length).toBe(1);
  });

  it('groups by relation', () => {
    const r = formatReconcileReport([
      { relation: 'leads.client_id', type: 'orphans', count: 5 },
    ]);
    expect(r.summary.byRelation['leads.client_id']).toBe(5);
  });

  it('handles missing relation/type with defaults', () => {
    const r = formatReconcileReport([
      { count: 3 }, // no relation/type
    ]);
    expect(r.summary.total).toBe(3);
    expect(r.details[0]?.relation).toBe('unknown');
    expect(r.details[0]?.type).toBe('orphans');
  });

  it('uses provided `now` for generated_at', () => {
    const fixed = new Date('2026-05-26T12:00:00Z');
    const r = formatReconcileReport([], fixed);
    expect(r.generated_at).toBe('2026-05-26T12:00:00.000Z');
  });

  it('ignores non-finite counts', () => {
    const r = formatReconcileReport([
      { relation: 'a', type: 'orphans', count: NaN as never },
      { relation: 'b', type: 'orphans', count: Infinity as never },
      { relation: 'c', type: 'orphans', count: 5 },
    ]);
    expect(r.summary.total).toBe(5);
  });
});

// ── chunkBatch ──────────────────────────────────────────────

describe('chunkBatch', () => {
  it('returns empty array for empty input', () => {
    expect(chunkBatch([], 10)).toEqual([]);
  });

  it('returns single chunk if items fit in one batch', () => {
    expect(chunkBatch([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('splits items into multiple chunks', () => {
    const r = chunkBatch([1, 2, 3, 4, 5], 2);
    expect(r).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('clamps batchSize to MAX_BATCH_SIZE', () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    const r = chunkBatch(items, 9999);
    expect(r).toEqual([items]);
  });

  it('clamps batchSize to >= 1', () => {
    const r = chunkBatch([1, 2, 3], 0);
    expect(r.length).toBe(3); // forces batch of 1
  });

  it('handles non-array input gracefully', () => {
    expect(chunkBatch(null as never, 10)).toEqual([]);
  });
});

// ── computeReconcileSummary ─────────────────────────────────

describe('computeReconcileSummary', () => {
  it('returns total=0 healthy=true for empty report', () => {
    const r = computeReconcileSummary({
      summary: { total: 0, byType: {}, byRelation: {} },
      details: [],
      generated_at: '2026-05-26T12:00:00Z',
    });
    expect(r.total).toBe(0);
    expect(r.healthy).toBe(true);
  });

  it('returns healthy=false when total > 0', () => {
    const r = computeReconcileSummary({
      summary: { total: 5, byType: { orphans: 5 }, byRelation: {} },
      details: [],
      generated_at: '2026-05-26T12:00:00Z',
    });
    expect(r.total).toBe(5);
    expect(r.healthy).toBe(false);
  });

  it('handles null/undefined gracefully', () => {
    expect(computeReconcileSummary(null)).toEqual({ total: 0, healthy: true });
    expect(computeReconcileSummary(undefined)).toEqual({ total: 0, healthy: true });
  });
});
