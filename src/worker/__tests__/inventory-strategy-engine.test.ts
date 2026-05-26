// ── Tests — Inventory Strategy Engine (Sprint P0-6, 2026-05-26) ──────────────
//
// Tests PURS sur les helpers exportés par lib/inventory-strategy-engine.ts.

import { describe, it, expect } from 'vitest';
import {
  allocateFifo,
  allocateLifo,
  allocateFefo,
  allocateByStrategy,
  validateBatch,
  STRATEGY_ERROR_CODES,
  VALID_STRATEGIES,
  type InventoryBatch,
} from '../lib/inventory-strategy-engine';

const v = 'variant-1';

describe('inventory-strategy-engine — allocateFifo', () => {
  it('alloc dans l\'ordre received_at ASC : 12 sur [10@d1, 5@d2, 20@d3] → [10@d1, 2@d2]', () => {
    const batches: InventoryBatch[] = [
      { id: 'b1', variant_id: v, qty: 10, received_at: '2026-01-01' },
      { id: 'b2', variant_id: v, qty: 5, received_at: '2026-01-02' },
      { id: 'b3', variant_id: v, qty: 20, received_at: '2026-01-03' },
    ];
    const r = allocateFifo(batches, 12);
    expect(r.totalAllocated).toBe(12);
    expect(r.remaining).toBe(0);
    expect(r.allocated.length).toBe(2);
    expect(r.allocated[0]?.batchId).toBe('b1');
    expect(r.allocated[0]?.takenQty).toBe(10);
    expect(r.allocated[1]?.batchId).toBe('b2');
    expect(r.allocated[1]?.takenQty).toBe(2);
    expect(r.allocated[1]?.remainingInBatch).toBe(3);
  });

  it('qty > total disponible → remaining > 0', () => {
    const batches: InventoryBatch[] = [
      { id: 'b1', variant_id: v, qty: 5, received_at: '2026-01-01' },
    ];
    const r = allocateFifo(batches, 10);
    expect(r.totalAllocated).toBe(5);
    expect(r.remaining).toBe(5);
  });

  it('batches sans received_at passent en queue', () => {
    const batches: InventoryBatch[] = [
      { id: 'b1', variant_id: v, qty: 3 }, // pas de date
      { id: 'b2', variant_id: v, qty: 5, received_at: '2026-01-01' },
    ];
    // qty=7 force la consommation de b2 puis fallback b1
    const r = allocateFifo(batches, 7);
    expect(r.allocated[0]?.batchId).toBe('b2');
    expect(r.allocated[1]?.batchId).toBe('b1');
    expect(r.totalAllocated).toBe(7);
  });

  it('qty 0 → no-op', () => {
    const r = allocateFifo([{ variant_id: v, qty: 10 }], 0);
    expect(r.totalAllocated).toBe(0);
    expect(r.allocated.length).toBe(0);
  });

  it('aucun batch → remaining = qty', () => {
    const r = allocateFifo([], 5);
    expect(r.remaining).toBe(5);
    expect(r.totalAllocated).toBe(0);
  });
});

describe('inventory-strategy-engine — allocateLifo', () => {
  it('alloc dans l\'ordre received_at DESC : 12 sur [10@d1, 5@d2, 20@d3] → [12@d3]', () => {
    const batches: InventoryBatch[] = [
      { id: 'b1', variant_id: v, qty: 10, received_at: '2026-01-01' },
      { id: 'b2', variant_id: v, qty: 5, received_at: '2026-01-02' },
      { id: 'b3', variant_id: v, qty: 20, received_at: '2026-01-03' },
    ];
    const r = allocateLifo(batches, 12);
    expect(r.totalAllocated).toBe(12);
    expect(r.allocated.length).toBe(1);
    expect(r.allocated[0]?.batchId).toBe('b3');
    expect(r.allocated[0]?.takenQty).toBe(12);
    expect(r.allocated[0]?.remainingInBatch).toBe(8);
  });

  it('LIFO consomme plusieurs batches récents', () => {
    const batches: InventoryBatch[] = [
      { id: 'b1', variant_id: v, qty: 10, received_at: '2026-01-01' },
      { id: 'b2', variant_id: v, qty: 5, received_at: '2026-01-02' },
      { id: 'b3', variant_id: v, qty: 3, received_at: '2026-01-03' },
    ];
    const r = allocateLifo(batches, 7);
    expect(r.allocated[0]?.batchId).toBe('b3');
    expect(r.allocated[1]?.batchId).toBe('b2');
    expect(r.allocated[0]?.takenQty).toBe(3);
    expect(r.allocated[1]?.takenQty).toBe(4);
  });
});

describe('inventory-strategy-engine — allocateFefo', () => {
  it('alloc par expiry ASC (le plus proche en premier)', () => {
    const batches: InventoryBatch[] = [
      { id: 'b1', variant_id: v, qty: 10, expiry: '2026-12-01' },
      { id: 'b2', variant_id: v, qty: 5, expiry: '2026-06-01' },
      { id: 'b3', variant_id: v, qty: 20, expiry: '2027-01-01' },
    ];
    const r = allocateFefo(batches, 7);
    expect(r.allocated[0]?.batchId).toBe('b2');
    expect(r.allocated[1]?.batchId).toBe('b1');
  });

  it('batches sans expiry passent en queue', () => {
    const batches: InventoryBatch[] = [
      { id: 'b1', variant_id: v, qty: 3 },
      { id: 'b2', variant_id: v, qty: 5, expiry: '2026-12-01' },
    ];
    const r = allocateFefo(batches, 4);
    expect(r.allocated[0]?.batchId).toBe('b2');
  });
});

describe('inventory-strategy-engine — allocateByStrategy', () => {
  it('dispatch fifo', () => {
    const batches: InventoryBatch[] = [
      { id: 'b1', variant_id: v, qty: 5, received_at: '2026-01-01' },
    ];
    const r = allocateByStrategy('fifo', batches, 3);
    expect(r.strategy).toBe('fifo');
    expect(r.error).toBeUndefined();
    expect(r.totalAllocated).toBe(3);
  });

  it('dispatch lifo', () => {
    const r = allocateByStrategy('lifo', [{ variant_id: v, qty: 5 }], 3);
    expect(r.strategy).toBe('lifo');
  });

  it('dispatch fefo', () => {
    const r = allocateByStrategy('fefo', [{ variant_id: v, qty: 5 }], 3);
    expect(r.strategy).toBe('fefo');
  });

  it('stratégie inconnue → erreur', () => {
    const r = allocateByStrategy('bogus', [{ variant_id: v, qty: 5 }], 3);
    expect(r.error).toBe(STRATEGY_ERROR_CODES.STRATEGY_INVALID);
    expect(r.totalAllocated).toBe(0);
  });

  it('VALID_STRATEGIES contient fifo/lifo/fefo', () => {
    expect(VALID_STRATEGIES).toContain('fifo');
    expect(VALID_STRATEGIES).toContain('lifo');
    expect(VALID_STRATEGIES).toContain('fefo');
  });
});

describe('inventory-strategy-engine — validateBatch', () => {
  it('batch valide minimal', () => {
    const r = validateBatch({ variant_id: v, qty: 10 });
    expect(r.ok).toBe(true);
  });

  it('variant_id manquant → erreur', () => {
    const r = validateBatch({ qty: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(STRATEGY_ERROR_CODES.BATCH_VARIANT_MISSING);
  });

  it('qty <= 0 → erreur', () => {
    const r = validateBatch({ variant_id: v, qty: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(STRATEGY_ERROR_CODES.BATCH_QTY_INVALID);
  });

  it('qty float → erreur', () => {
    const r = validateBatch({ variant_id: v, qty: 1.5 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(STRATEGY_ERROR_CODES.BATCH_QTY_INVALID);
  });

  it('received_at invalide → erreur', () => {
    const r = validateBatch({
      variant_id: v,
      qty: 10,
      received_at: 'not-a-date',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(STRATEGY_ERROR_CODES.BATCH_DATE_INVALID);
  });

  it('expiry < received_at → erreur', () => {
    const r = validateBatch({
      variant_id: v,
      qty: 10,
      received_at: '2026-06-01',
      expiry: '2026-05-01',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(STRATEGY_ERROR_CODES.BATCH_EXPIRY_BEFORE_RECEIPT);
  });

  it('batch complet valide', () => {
    const r = validateBatch({
      variant_id: v,
      qty: 100,
      received_at: '2026-01-01',
      expiry: '2027-01-01',
    });
    expect(r.ok).toBe(true);
  });
});
