// ── returns-engine tests — Sprint E6 M2 hardening (2026-05-26) ─────────────-
//
// Tests PURS sur les helpers RMA : isWithinReturnWindow, validateRmaReason,
// validateReturnItems, computeReturnRefund, RETURN_ERROR_CODES.

import { describe, it, expect } from 'vitest';
import {
  RETURN_ERROR_CODES,
  RMA_REASON_WHITELIST,
  RETURN_WINDOW_DAYS,
  isWithinReturnWindow,
  validateRmaReason,
  validateReturnItems,
  computeReturnRefund,
  type OrderItemSnapshot,
} from '../lib/returns-engine';

describe('returns-engine — constants', () => {
  it('expose les 8 codes erreur stables', () => {
    expect(RETURN_ERROR_CODES.WINDOW_EXPIRED).toBe('window_expired');
    expect(RETURN_ERROR_CODES.INVALID_REASON).toBe('invalid_reason');
    expect(RETURN_ERROR_CODES.EMPTY_ITEMS).toBe('empty_items');
    expect(RETURN_ERROR_CODES.ITEM_NOT_IN_ORDER).toBe('item_not_in_order');
    expect(RETURN_ERROR_CODES.ITEM_NOT_DELIVERED).toBe('item_not_delivered');
    expect(RETURN_ERROR_CODES.QUANTITY_OVER_DELIVERED).toBe(
      'quantity_over_delivered',
    );
    expect(RETURN_ERROR_CODES.INVALID_QUANTITY).toBe('invalid_quantity');
    expect(RETURN_ERROR_CODES.INVALID_AMOUNT).toBe('invalid_amount');
  });

  it('RETURN_WINDOW_DAYS = 14 (compromis LPC + marge)', () => {
    expect(RETURN_WINDOW_DAYS).toBe(14);
  });

  it('RMA_REASON_WHITELIST contient les 10 raisons', () => {
    expect(RMA_REASON_WHITELIST.length).toBe(10);
    expect(RMA_REASON_WHITELIST).toContain('defective');
    expect(RMA_REASON_WHITELIST).toContain('wrong_item');
    expect(RMA_REASON_WHITELIST).toContain('other');
  });
});

describe('returns-engine — validateRmaReason', () => {
  it('accepte raisons whitelist (case-insensitive)', () => {
    expect(validateRmaReason('defective')).toBe(true);
    expect(validateRmaReason('DEFECTIVE')).toBe(true);
    expect(validateRmaReason('  wrong_item  ')).toBe(true);
  });
  it('rejette raison non-whitelist', () => {
    expect(validateRmaReason('changed_mind')).toBe(false);
    expect(validateRmaReason('')).toBe(false);
    expect(validateRmaReason(null)).toBe(false);
    expect(validateRmaReason(42)).toBe(false);
  });
});

describe('returns-engine — isWithinReturnWindow', () => {
  const orderDate = new Date('2026-05-01T00:00:00Z');

  it('accepte retour le jour même (0d)', () => {
    expect(isWithinReturnWindow(orderDate, orderDate)).toBe(true);
  });
  it('accepte retour à 7 jours (LPC Québec)', () => {
    const now = new Date('2026-05-08T00:00:00Z');
    expect(isWithinReturnWindow(orderDate, now)).toBe(true);
  });
  it('accepte retour à 13 jours (avant fenêtre)', () => {
    const now = new Date('2026-05-14T00:00:00Z');
    expect(isWithinReturnWindow(orderDate, now)).toBe(true);
  });
  it('accepte retour à 14 jours (limite fenêtre)', () => {
    const now = new Date('2026-05-15T00:00:00Z');
    expect(isWithinReturnWindow(orderDate, now)).toBe(true);
  });
  it('rejette retour à 15 jours (hors fenêtre)', () => {
    const now = new Date('2026-05-16T00:00:00Z');
    expect(isWithinReturnWindow(orderDate, now)).toBe(false);
  });
  it('rejette commande dans le futur (orderDate > now)', () => {
    const future = new Date('2026-06-01T00:00:00Z');
    const now = new Date('2026-05-01T00:00:00Z');
    expect(isWithinReturnWindow(future, now)).toBe(false);
  });
  it('rejette dates invalides', () => {
    expect(isWithinReturnWindow(null)).toBe(false);
    expect(isWithinReturnWindow('not-a-date')).toBe(false);
    expect(isWithinReturnWindow(orderDate, 'bogus')).toBe(false);
  });
  it('accepte window custom', () => {
    const now = new Date('2026-05-30T00:00:00Z'); // +29j
    expect(isWithinReturnWindow(orderDate, now, 30)).toBe(true);
    expect(isWithinReturnWindow(orderDate, now, 14)).toBe(false);
  });
});

describe('returns-engine — validateReturnItems', () => {
  const orderItems: OrderItemSnapshot[] = [
    { id: 'oi_1', quantity: 2, unit_price_cents: 1500, delivered_quantity: 2 },
    { id: 'oi_2', quantity: 5, unit_price_cents: 500, delivered_quantity: 3 },
    { id: 'oi_3', quantity: 1, unit_price_cents: 9999, delivered_quantity: 0 },
  ];

  it('rejette items vide', () => {
    const r = validateReturnItems([], orderItems);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(RETURN_ERROR_CODES.EMPTY_ITEMS);
  });
  it('rejette quantité ≤ 0', () => {
    const r = validateReturnItems(
      [{ order_item_id: 'oi_1', quantity: 0 }],
      orderItems,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(RETURN_ERROR_CODES.INVALID_QUANTITY);
  });
  it('rejette item hors commande', () => {
    const r = validateReturnItems(
      [{ order_item_id: 'oi_404', quantity: 1 }],
      orderItems,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(RETURN_ERROR_CODES.ITEM_NOT_IN_ORDER);
  });
  it('rejette article non livré (delivered=0)', () => {
    const r = validateReturnItems(
      [{ order_item_id: 'oi_3', quantity: 1 }],
      orderItems,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(RETURN_ERROR_CODES.ITEM_NOT_DELIVERED);
  });
  it('rejette qty > delivered (partiel)', () => {
    const r = validateReturnItems(
      [{ order_item_id: 'oi_2', quantity: 4 }],
      orderItems,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.code).toBe(RETURN_ERROR_CODES.QUANTITY_OVER_DELIVERED);
  });
  it('accepte items valides + restock flag', () => {
    const r = validateReturnItems(
      [
        { order_item_id: 'oi_1', quantity: 2, restock: true },
        { order_item_id: 'oi_2', quantity: 3, restock: false },
      ],
      orderItems,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.eligibleItems[0].restock).toBe(1);
      expect(r.eligibleItems[1].restock).toBe(0);
    }
  });
  it('accepte qty exact == delivered', () => {
    const r = validateReturnItems(
      [{ order_item_id: 'oi_2', quantity: 3 }],
      orderItems,
    );
    expect(r.ok).toBe(true);
  });
});

describe('returns-engine — computeReturnRefund', () => {
  const orderItems: OrderItemSnapshot[] = [
    { id: 'oi_1', quantity: 2, unit_price_cents: 1500, delivered_quantity: 2 },
    { id: 'oi_2', quantity: 5, unit_price_cents: 500, delivered_quantity: 3 },
  ];

  it('calcule le montant total + breakdown', () => {
    const r = computeReturnRefund(
      [
        { order_item_id: 'oi_1', quantity: 2, restock: 1 },
        { order_item_id: 'oi_2', quantity: 1, restock: 0 },
      ],
      orderItems,
    );
    // 2 * 1500 + 1 * 500 = 3500
    expect(r.amount).toBe(3500);
    expect(r.breakdown.length).toBe(2);
    expect(r.breakdown[0].line_total_cents).toBe(3000);
    expect(r.breakdown[1].line_total_cents).toBe(500);
  });
  it('retourne 0 si items inconnus', () => {
    const r = computeReturnRefund(
      [{ order_item_id: 'unknown', quantity: 1, restock: 0 }],
      orderItems,
    );
    expect(r.amount).toBe(0);
  });
  it('retourne 0 si quantity=0', () => {
    const r = computeReturnRefund(
      [{ order_item_id: 'oi_1', quantity: 0, restock: 0 }],
      orderItems,
    );
    expect(r.amount).toBe(0);
  });
});
