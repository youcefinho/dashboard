// ── Tests — Cart Engine (Sprint P0-4 renforcement, 2026-05-26) ──────────────
//
// Tests PURS sur les helpers exportés par `lib/cart-engine.ts`.
// Zéro réseau, zéro mock D1.
//
// Couverture (16 cas) :
//   - generateCartToken     : 3 cas (32 hex, unicité, validé par isValidCartToken)
//   - isValidCartToken      : 3 cas (legacy cart_<uuid> / moderne 32hex / garbage)
//   - isCartExpired         : 3 cas (2h ago, 30 min ago, converted-jamais-expired)
//   - isCartAbandoned       : 2 cas (25h ago active → true, 25h converted → false)
//   - validateCartItem      : 3 cas (OK / qty 0 too low / qty 200 too high)
//   - mergeCartItems        : 2 cas (dedupe by variant_id + cap MAX, skip invalids)

import { describe, it, expect } from 'vitest';
import {
  generateCartToken,
  isValidCartToken,
  isCartExpired,
  isCartAbandoned,
  validateCartItem,
  mergeCartItems,
  CART_ERROR_CODES,
  CART_EXPIRY_HOURS,
  ABANDONED_THRESHOLD_HOURS,
  MAX_ITEM_QUANTITY,
} from '../lib/cart-engine';

// ════════════════════════════════════════════════════════════════════════════
// generateCartToken (3 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('generateCartToken — 32 hex chars secure random', () => {
  it('32 hex chars, lowercase', () => {
    const t = generateCartToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  it('100 tokens uniques (collision improbable 128 bits)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateCartToken());
    expect(set.size).toBe(100);
  });

  it('validé par isValidCartToken', () => {
    const t = generateCartToken();
    expect(isValidCartToken(t)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isValidCartToken (3 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('isValidCartToken — legacy + modern formats', () => {
  it('legacy cart_<uuid> → accept', () => {
    expect(isValidCartToken('cart_550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('modern 32 hex → accept', () => {
    expect(isValidCartToken('abcdef0123456789abcdef0123456789')).toBe(true);
  });

  it('garbage → reject', () => {
    expect(isValidCartToken('')).toBe(false);
    expect(isValidCartToken('cart_xyz')).toBe(false);
    expect(isValidCartToken('short')).toBe(false);
    expect(isValidCartToken(null)).toBe(false);
    expect(isValidCartToken(12345)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isCartExpired (3 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('isCartExpired — 1h expiry window', () => {
  it('created 2h ago, expiry 1h → true', () => {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    const cart = {
      updated_at: new Date(twoHoursAgo).toISOString(),
      status: 'active',
    };
    expect(isCartExpired(cart, now)).toBe(true);
  });

  it('updated 30 min ago → false', () => {
    const now = Date.now();
    const thirtyMinAgo = now - 30 * 60 * 1000;
    const cart = {
      updated_at: new Date(thirtyMinAgo).toISOString(),
      status: 'active',
    };
    expect(isCartExpired(cart, now)).toBe(false);
  });

  it('status=converted, même très ancien → false (jamais expiré)', () => {
    const now = Date.now();
    const veryOld = now - 365 * 24 * 60 * 60 * 1000; // 1 an
    const cart = {
      updated_at: new Date(veryOld).toISOString(),
      status: 'converted',
    };
    expect(isCartExpired(cart, now)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isCartAbandoned (2 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('isCartAbandoned — 24h+ active', () => {
  it('active, 25h ago → true', () => {
    const now = Date.now();
    const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;
    const cart = {
      updated_at: new Date(twentyFiveHoursAgo).toISOString(),
      status: 'active',
    };
    expect(isCartAbandoned(cart, now)).toBe(true);
  });

  it('converted, 25h ago → false (pas active)', () => {
    const now = Date.now();
    const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;
    const cart = {
      updated_at: new Date(twentyFiveHoursAgo).toISOString(),
      status: 'converted',
    };
    expect(isCartAbandoned(cart, now)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateCartItem (3 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validateCartItem — variant_id + qty 1..99', () => {
  it('OK : variant + qty 5', () => {
    const r = validateCartItem({ variant_id: 'var_abc123', quantity: 5 });
    expect(r.ok).toBe(true);
    expect(r.data?.variant_id).toBe('var_abc123');
    expect(r.data?.quantity).toBe(5);
  });

  it('qty 0 → QUANTITY_TOO_LOW', () => {
    const r = validateCartItem({ variant_id: 'var_x', quantity: 0 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CART_ERROR_CODES.QUANTITY_TOO_LOW);
  });

  it('qty 200 → QUANTITY_TOO_HIGH', () => {
    const r = validateCartItem({ variant_id: 'var_x', quantity: 200 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CART_ERROR_CODES.QUANTITY_TOO_HIGH);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// mergeCartItems (2 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('mergeCartItems — dedupe + sum + cap', () => {
  it('dedupe par variant_id, somme quantités', () => {
    const merged = mergeCartItems([
      { variant_id: 'A', quantity: 2 },
      { variant_id: 'B', quantity: 1 },
      { variant_id: 'A', quantity: 3 }, // somme avec 1ère
    ]);
    expect(merged.length).toBe(2);
    expect(merged[0]).toEqual({ variant_id: 'A', quantity: 5 });
    expect(merged[1]).toEqual({ variant_id: 'B', quantity: 1 });
  });

  it('cap MAX_ITEM_QUANTITY + skip invalids', () => {
    const merged = mergeCartItems([
      { variant_id: 'A', quantity: 50 },
      { variant_id: 'A', quantity: 80 }, // total = 130, capped à 99
      { variant_id: '', quantity: 5 }, // skip variant vide
      { variant_id: 'B', quantity: -3 }, // skip qty négative
      null,
      'garbage',
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].variant_id).toBe('A');
    expect(merged[0].quantity).toBe(MAX_ITEM_QUANTITY);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Constants sanity (sentinel — couvre les imports inutilisés sinon)
// ════════════════════════════════════════════════════════════════════════════

describe('CART constants — contract sanity', () => {
  it('CART_EXPIRY_HOURS=1 et ABANDONED_THRESHOLD_HOURS=24', () => {
    expect(CART_EXPIRY_HOURS).toBe(1);
    expect(ABANDONED_THRESHOLD_HOURS).toBe(24);
  });
});
