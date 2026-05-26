// ── Tests — Orders Engine (Sprint P0-4 renforcement, 2026-05-26) ────────────
//
// Tests PURS sur les helpers exportés par `lib/orders-engine.ts`.
// Zéro réseau, zéro mock D1.
//
// Couverture (17 cas) :
//   - computeOrderTotals          : 6 cas (3 items + tax / discount cap /
//                                     empty / negative / inclusive / overflow)
//   - validateOrderTransition     : 4 cas (pending→paid OK / paid→pending KO /
//                                     terminal cancelled→* KO / unknown KO)
//   - canCancelOrder              : 4 cas (pending OK / shipped KO / delivered KO /
//                                     window expired)
//   - formatOrderNumber           : 2 cas (1 → INV-YYYY-000001 / bad seq fallback)
//   - VALID_ORDER_STATUSES        : 1 cas (frozen, contient 7 statuts)

import { describe, it, expect } from 'vitest';
import {
  computeOrderTotals,
  validateOrderTransition,
  canCancelOrder,
  formatOrderNumber,
  VALID_ORDER_STATUSES,
  ORDER_ERROR_CODES,
  ORDER_TRANSITIONS,
} from '../lib/orders-engine';

// ════════════════════════════════════════════════════════════════════════════
// computeOrderTotals (6 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('computeOrderTotals — pure totals math', () => {
  it('3 items + tax 13% + shipping 500c → totaux exacts', () => {
    // 3 items : 2x 1000c + 1x 2500c = 4500c subtotal
    // tax 13% (déjà calculé externe) = 585c
    // shipping 500c
    // discount 0
    // total = 4500 + 585 + 500 = 5585c
    const r = computeOrderTotals({
      items: [
        { unit_price_cents: 1000, quantity: 2 },
        { unit_price_cents: 2500, quantity: 1 },
      ],
      tax_cents: 585,
      shipping_cents: 500,
      discount_cents: 0,
    });
    expect(r.ok).toBe(true);
    expect(r.data?.subtotal_cents).toBe(4500);
    expect(r.data?.total_cents).toBe(5585);
    expect(r.data?.tax_cents).toBe(585);
    expect(r.data?.shipping_cents).toBe(500);
  });

  it('discount > subtotal → capped à subtotal (total = shipping)', () => {
    const r = computeOrderTotals({
      items: [{ unit_price_cents: 1000, quantity: 1 }],
      discount_cents: 5000, // > subtotal
      shipping_cents: 0,
      tax_cents: 0,
    });
    expect(r.ok).toBe(true);
    expect(r.data?.discount_cents).toBe(1000); // capped
    expect(r.data?.total_cents).toBe(0);
  });

  it('empty items → EMPTY_ORDER', () => {
    const r = computeOrderTotals({ items: [] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ORDER_ERROR_CODES.EMPTY_ORDER);
  });

  it('negative item price → NEGATIVE_AMOUNT', () => {
    const r = computeOrderTotals({
      items: [{ unit_price_cents: -100, quantity: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ORDER_ERROR_CODES.NEGATIVE_AMOUNT);
  });

  it('tax_inclusive (UE) → tax pas ajoutée au total', () => {
    // subtotal 12000 (TTC), tax_cents 2000 (déjà inclus), shipping 500
    // total = 12000 - 0 + 500 = 12500 (PAS 14500)
    const r = computeOrderTotals({
      items: [{ unit_price_cents: 12000, quantity: 1 }],
      tax_cents: 2000,
      shipping_cents: 500,
      tax_inclusive: true,
    });
    expect(r.ok).toBe(true);
    expect(r.data?.total_cents).toBe(12500);
  });

  it('non-integer price → INVALID_ITEM', () => {
    const r = computeOrderTotals({
      items: [{ unit_price_cents: 12.5, quantity: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ORDER_ERROR_CODES.INVALID_ITEM);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateOrderTransition (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validateOrderTransition — state machine', () => {
  it('pending → paid : OK', () => {
    expect(validateOrderTransition('pending', 'paid')).toBe(true);
    expect(validateOrderTransition('pending', 'cancelled')).toBe(true);
  });

  it('paid → pending : KO (pas de rétrogradation)', () => {
    expect(validateOrderTransition('paid', 'pending')).toBe(false);
  });

  it('terminal cancelled → * : KO', () => {
    expect(validateOrderTransition('cancelled', 'paid')).toBe(false);
    expect(validateOrderTransition('cancelled', 'refunded')).toBe(false);
    expect(validateOrderTransition('refunded', 'paid')).toBe(false);
  });

  it('statut inconnu → KO', () => {
    expect(validateOrderTransition('unknown', 'paid')).toBe(false);
    expect(validateOrderTransition('pending', 'magic')).toBe(false);
    expect(validateOrderTransition('pending', 'pending')).toBe(false); // identique
  });
});

// ════════════════════════════════════════════════════════════════════════════
// canCancelOrder (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('canCancelOrder — cancellation rules', () => {
  it('pending → OK', () => {
    expect(canCancelOrder({ status: 'pending' }).ok).toBe(true);
    expect(canCancelOrder({ status: 'paid' }).ok).toBe(true);
    expect(canCancelOrder({ status: 'preparing' }).ok).toBe(true);
  });

  it('shipped → CANCEL_NOT_ALLOWED', () => {
    const r = canCancelOrder({ status: 'shipped' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(ORDER_ERROR_CODES.CANCEL_NOT_ALLOWED);
  });

  it('delivered → CANCEL_NOT_ALLOWED', () => {
    const r = canCancelOrder({ status: 'delivered' });
    expect(r.ok).toBe(false);
  });

  it('window expired (created 2h ago, window 1h) → CANCEL_WINDOW_EXPIRED', () => {
    const now = Date.now();
    const created = now - 2 * 60 * 60 * 1000; // 2h ago
    const r = canCancelOrder({
      status: 'pending',
      created_at: created,
      cancel_window_hours: 1,
      now_ms: now,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(ORDER_ERROR_CODES.CANCEL_WINDOW_EXPIRED);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatOrderNumber (2 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('formatOrderNumber — INV-YYYY-NNNNNN', () => {
  it('seq=1, year=2026 → INV-2026-000001', () => {
    expect(formatOrderNumber(1, 2026)).toBe('INV-2026-000001');
    expect(formatOrderNumber(42, 2026)).toBe('INV-2026-000042');
    expect(formatOrderNumber(999999, 2026)).toBe('INV-2026-999999');
  });

  it('bad seq → fallback INV-0000-000000', () => {
    expect(formatOrderNumber('abc', 2026)).toBe('INV-0000-000000');
    expect(formatOrderNumber(-1, 2026)).toBe('INV-0000-000000');
    expect(formatOrderNumber(null, 2026)).toBe('INV-0000-000000');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALID_ORDER_STATUSES + ORDER_TRANSITIONS frozen (1 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('VALID_ORDER_STATUSES + ORDER_TRANSITIONS — frozen contract', () => {
  it('7 statuts présents, machine immutable', () => {
    expect(VALID_ORDER_STATUSES.length).toBe(7);
    expect(VALID_ORDER_STATUSES).toContain('pending');
    expect(VALID_ORDER_STATUSES).toContain('refunded');
    expect(Object.isFrozen(VALID_ORDER_STATUSES)).toBe(true);
    expect(Object.isFrozen(ORDER_TRANSITIONS)).toBe(true);
    // cancelled + refunded sont terminaux (transitions vides)
    expect(ORDER_TRANSITIONS.cancelled.length).toBe(0);
    expect(ORDER_TRANSITIONS.refunded.length).toBe(0);
  });
});
