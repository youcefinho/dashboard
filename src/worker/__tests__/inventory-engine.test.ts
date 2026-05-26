// ── Tests — Inventory Engine (Sprint P0-6, 2026-05-26) ───────────────────────
//
// Tests PURS sur les helpers exportés par lib/inventory-engine.ts.
// Aucun réseau, aucun mock D1.

import { describe, it, expect } from 'vitest';
import {
  computeAvailable,
  isLowStock,
  validateStockAdjustment,
  validateStockMovement,
  INVENTORY_ERROR_CODES,
  VALID_ADJUSTMENT_REASONS,
  VALID_MOVEMENT_TYPES,
} from '../lib/inventory-engine';

describe('inventory-engine — computeAvailable', () => {
  it('10 on_hand, 3 reserved → 7', () => {
    expect(computeAvailable(10, 3)).toBe(7);
  });

  it('0 on_hand → 0', () => {
    expect(computeAvailable(0, 0)).toBe(0);
  });

  it('reserved > on_hand → 0 (jamais négatif visible)', () => {
    expect(computeAvailable(5, 10)).toBe(0);
  });

  it('valeurs négatives clampées à 0', () => {
    expect(computeAvailable(-5, -3)).toBe(0);
  });

  it('arrondit les flottants', () => {
    expect(computeAvailable(10.4, 3.2)).toBe(7);
    expect(computeAvailable(10.6, 3.6)).toBe(7);
  });
});

describe('inventory-engine — isLowStock', () => {
  it('available <= threshold → true', () => {
    expect(isLowStock(3, 5)).toBe(true);
    expect(isLowStock(5, 5)).toBe(true);
  });

  it('available > threshold → false', () => {
    expect(isLowStock(10, 5)).toBe(false);
  });

  it('threshold <= 0 → désactivé (false)', () => {
    expect(isLowStock(0, 0)).toBe(false);
    expect(isLowStock(0, -5)).toBe(false);
  });

  it('available = 0 et threshold > 0 → true', () => {
    expect(isLowStock(0, 5)).toBe(true);
  });
});

describe('inventory-engine — validateStockAdjustment', () => {
  it('delta valide + reason whitelist → ok', () => {
    const r = validateStockAdjustment(10, 5, 'restock');
    expect(r.ok).toBe(true);
  });

  it('delta négatif accepté si résultat >= 0', () => {
    const r = validateStockAdjustment(10, -3, 'sale');
    expect(r.ok).toBe(true);
  });

  it('delta = 0 → erreur', () => {
    const r = validateStockAdjustment(10, 0, 'restock');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(INVENTORY_ERROR_CODES.DELTA_ZERO);
  });

  it('delta non-fini → erreur', () => {
    const r = validateStockAdjustment(10, Number.NaN, 'restock');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(INVENTORY_ERROR_CODES.DELTA_INVALID);
  });

  it('reason hors whitelist → erreur', () => {
    const r = validateStockAdjustment(10, 1, 'bogus');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(INVENTORY_ERROR_CODES.REASON_INVALID);
  });

  it('delta qui rendrait stock négatif → refus (default)', () => {
    const r = validateStockAdjustment(2, -5, 'sale');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(INVENTORY_ERROR_CODES.DELTA_NEGATIVE_UNALLOWED);
  });

  it('allowNegative=true → accepte négatif', () => {
    const r = validateStockAdjustment(2, -5, 'sale', { allowNegative: true });
    expect(r.ok).toBe(true);
  });

  it('toutes les reasons whitelist passent', () => {
    for (const reason of VALID_ADJUSTMENT_REASONS) {
      const r = validateStockAdjustment(10, 1, reason);
      expect(r.ok).toBe(true);
    }
  });
});

describe('inventory-engine — validateStockMovement', () => {
  it('inbound avec toWarehouse → ok', () => {
    const r = validateStockMovement({ type: 'inbound', qty: 10, toWarehouse: 'wh1' });
    expect(r.ok).toBe(true);
  });

  it('inbound sans toWarehouse → erreur', () => {
    const r = validateStockMovement({ type: 'inbound', qty: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(INVENTORY_ERROR_CODES.TRANSFER_MISSING_WAREHOUSE);
  });

  it('outbound avec fromWarehouse → ok', () => {
    const r = validateStockMovement({ type: 'outbound', qty: 5, fromWarehouse: 'wh1' });
    expect(r.ok).toBe(true);
  });

  it('outbound sans fromWarehouse → erreur', () => {
    const r = validateStockMovement({ type: 'outbound', qty: 5 });
    expect(r.ok).toBe(false);
  });

  it('transfer avec from + to distincts → ok', () => {
    const r = validateStockMovement({
      type: 'transfer',
      qty: 3,
      fromWarehouse: 'wh1',
      toWarehouse: 'wh2',
    });
    expect(r.ok).toBe(true);
  });

  it('transfer from == to → erreur', () => {
    const r = validateStockMovement({
      type: 'transfer',
      qty: 3,
      fromWarehouse: 'wh1',
      toWarehouse: 'wh1',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(INVENTORY_ERROR_CODES.TRANSFER_SAME_WAREHOUSE);
  });

  it('transfer partial (missing to) → erreur', () => {
    const r = validateStockMovement({
      type: 'transfer',
      qty: 3,
      fromWarehouse: 'wh1',
    });
    expect(r.ok).toBe(false);
  });

  it('type invalide → erreur', () => {
    const r = validateStockMovement({ type: 'bogus', qty: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(INVENTORY_ERROR_CODES.MOVEMENT_TYPE_INVALID);
  });

  it('qty <= 0 → erreur', () => {
    const r = validateStockMovement({
      type: 'inbound',
      qty: 0,
      toWarehouse: 'wh1',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(INVENTORY_ERROR_CODES.QTY_NEGATIVE);
  });

  it('qty NaN → erreur', () => {
    const r = validateStockMovement({
      type: 'inbound',
      qty: Number.NaN,
      toWarehouse: 'wh1',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(INVENTORY_ERROR_CODES.QTY_INVALID);
  });

  it('tous les types valides reconnus', () => {
    expect(VALID_MOVEMENT_TYPES.length).toBeGreaterThan(0);
    for (const t of VALID_MOVEMENT_TYPES) {
      // adjustment/return ne demandent pas de warehouse spécifique
      const r = validateStockMovement({
        type: t,
        qty: 1,
        fromWarehouse: 'wh1',
        toWarehouse: t === 'transfer' ? 'wh2' : 'wh1',
      });
      // transfer requiert from != to, on a déjà ce cas
      if (t !== 'transfer') {
        expect(r.ok).toBe(true);
      }
    }
  });
});
