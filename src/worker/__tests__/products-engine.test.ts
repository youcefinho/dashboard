// ── Tests — Products Engine (Sprint P0-4 renforcement, 2026-05-26) ──────────
//
// Tests PURS sur les helpers exportés par `lib/products-engine.ts`.
// Zéro réseau, zéro mock D1 (toutes les fonctions ciblées sont PURES).
//
// Couverture (18 cas) :
//   - validateSku                : 6 cas (empty / too-short / too-long / good
//                                   ASCII / special chars / accents)
//   - validateSkuDetailed        : 2 cas (code stables empty / good)
//   - validateCurrency           : 4 cas (CAD / lowercase / 4 lettres / JPY non listé)
//   - normalizePriceCents        : 6 cas (int direct / decimal / EU "12,50" /
//                                   string with $ / negative / overflow)
//   - validateProductInput       : 4 cas (OK complet / missing name / bad price /
//                                   bad currency)
//   - validateVariantMatrix      : 4 cas (OK / duplicate / missing axis /
//                                   too many)
//   - PRODUCT_ERROR_CODES        : 1 cas (présence codes stables)

import { describe, it, expect } from 'vitest';
import {
  validateSku,
  validateSkuDetailed,
  validateCurrency,
  normalizePriceCents,
  validateProductInput,
  validateVariantMatrix,
  PRODUCT_ERROR_CODES,
  SUPPORTED_CURRENCIES,
  MAX_SKU_LENGTH,
  MAX_VARIANTS,
} from '../lib/products-engine';

// ════════════════════════════════════════════════════════════════════════════
// validateSku (6 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validateSku — SKU format validation', () => {
  it('empty string → reject', () => {
    expect(validateSku('')).toBe(false);
    expect(validateSku('   ')).toBe(false);
  });

  it('too short (1 char) → reject', () => {
    expect(validateSku('A')).toBe(false);
  });

  it('too long (> 64 chars) → reject', () => {
    expect(validateSku('A'.repeat(MAX_SKU_LENGTH + 1))).toBe(false);
  });

  it('valid ASCII alphanumeric + - _ . → accept', () => {
    expect(validateSku('SKU-001')).toBe(true);
    expect(validateSku('PROD_v2.1')).toBe(true);
    expect(validateSku('ABC123')).toBe(true);
  });

  it('special chars (space, /, @, $) → reject', () => {
    expect(validateSku('SKU 001')).toBe(false);
    expect(validateSku('SKU/001')).toBe(false);
    expect(validateSku('SKU@001')).toBe(false);
    expect(validateSku('SKU$001')).toBe(false);
  });

  it('accented chars (é, à, ñ) → reject', () => {
    expect(validateSku('SKUé')).toBe(false);
    expect(validateSku('PRODUITà')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateSkuDetailed (2 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validateSkuDetailed — stable error codes', () => {
  it('empty → code INVALID_SKU', () => {
    const r = validateSkuDetailed('');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_ERROR_CODES.INVALID_SKU);
  });

  it('good SKU → ok true, no code', () => {
    const r = validateSkuDetailed('SKU-001');
    expect(r.ok).toBe(true);
    expect(r.code).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateCurrency (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validateCurrency — ISO 4217 + whitelist', () => {
  it('CAD (in whitelist) → accept', () => {
    expect(validateCurrency('CAD')).toBe(true);
    expect(SUPPORTED_CURRENCIES).toContain('CAD');
  });

  it('lowercase cad → accept (normalisé)', () => {
    expect(validateCurrency('cad')).toBe(true);
  });

  it('4 lettres CADD → reject (mauvais format)', () => {
    expect(validateCurrency('CADD')).toBe(false);
    expect(validateCurrency('CA')).toBe(false);
  });

  it('JPY (ISO valide mais hors whitelist projet) → reject', () => {
    expect(validateCurrency('JPY')).toBe(false);
    expect(validateCurrency('BRL')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// normalizePriceCents (6 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('normalizePriceCents — string + number normalization', () => {
  it('integer number 1250 → 1250 cents (déjà cents)', () => {
    expect(normalizePriceCents(1250)).toBe(1250);
  });

  it('decimal number 12.50 → 1250 cents', () => {
    expect(normalizePriceCents(12.5)).toBe(1250);
    expect(normalizePriceCents(0.99)).toBe(99);
  });

  it('EU string "12,50" → 1250 cents', () => {
    expect(normalizePriceCents('12,50')).toBe(1250);
  });

  it('string with $ "$12.50" → 1250 cents', () => {
    expect(normalizePriceCents('$12.50')).toBe(1250);
    expect(normalizePriceCents(' 12.50 ')).toBe(1250);
  });

  it('negative → null', () => {
    expect(normalizePriceCents(-1)).toBeNull();
    expect(normalizePriceCents('-10.00')).toBeNull();
  });

  it('overflow (> MAX_PRICE_CENTS) → null', () => {
    expect(normalizePriceCents(1e15)).toBeNull();
    // garbage string
    expect(normalizePriceCents('12abc')).toBeNull();
    expect(normalizePriceCents(NaN)).toBeNull();
    expect(normalizePriceCents(Infinity)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateProductInput (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validateProductInput — full product payload', () => {
  it('OK complet avec name + sku + price + currency', () => {
    const r = validateProductInput({
      name: 'T-shirt premium',
      sku: 'TSHIRT-001',
      price_cents: 2999,
      currency: 'CAD',
    });
    expect(r.ok).toBe(true);
    expect(r.data?.name).toBe('T-shirt premium');
    expect(r.data?.sku).toBe('TSHIRT-001');
    expect(r.data?.price_cents).toBe(2999);
    expect(r.data?.currency).toBe('CAD');
  });

  it('missing name → INVALID_NAME', () => {
    const r = validateProductInput({ price_cents: 100, currency: 'CAD' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_ERROR_CODES.INVALID_NAME);
    expect(r.field).toBe('name');
  });

  it('bad price (string garbage) → INVALID_PRICE', () => {
    const r = validateProductInput({
      name: 'OK', price_cents: 'abc' as unknown, currency: 'CAD',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_ERROR_CODES.INVALID_PRICE);
  });

  it('bad currency (JPY hors whitelist) → INVALID_CURRENCY', () => {
    const r = validateProductInput({
      name: 'OK', price_cents: 100, currency: 'JPY',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_ERROR_CODES.INVALID_CURRENCY);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateVariantMatrix (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validateVariantMatrix — variants + axes', () => {
  it('OK : 4 variantes sur 2 axes (size × color)', () => {
    const variants = [
      { options: { size: 'M', color: 'red' }, sku: 'TS-M-RED' },
      { options: { size: 'M', color: 'blue' }, sku: 'TS-M-BLU' },
      { options: { size: 'L', color: 'red' }, sku: 'TS-L-RED' },
      { options: { size: 'L', color: 'blue' }, sku: 'TS-L-BLU' },
    ];
    const r = validateVariantMatrix(variants, ['size', 'color']);
    expect(r.ok).toBe(true);
  });

  it('duplicate combo → DUPLICATE_VARIANT', () => {
    const variants = [
      { options: { size: 'M', color: 'red' } },
      { options: { size: 'M', color: 'red' } }, // dup
    ];
    const r = validateVariantMatrix(variants, ['size', 'color']);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_ERROR_CODES.DUPLICATE_VARIANT);
  });

  it('missing axis value → MISSING_AXIS_VALUE', () => {
    const variants = [{ options: { size: 'M' } as Record<string, string> }];
    const r = validateVariantMatrix(variants, ['size', 'color']);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_ERROR_CODES.MISSING_AXIS_VALUE);
    expect(r.field).toBe('color');
  });

  it('> MAX_VARIANTS → TOO_MANY_VARIANTS', () => {
    const variants = Array.from({ length: MAX_VARIANTS + 1 }, (_, i) => ({
      options: { size: `S${i}` },
    }));
    const r = validateVariantMatrix(variants, ['size']);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_ERROR_CODES.TOO_MANY_VARIANTS);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PRODUCT_ERROR_CODES (1 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('PRODUCT_ERROR_CODES — stable codes', () => {
  it('expose au moins 10 codes stables', () => {
    const codes = Object.values(PRODUCT_ERROR_CODES);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    // chaque code = string upper_snake
    for (const c of codes) {
      expect(typeof c).toBe('string');
      expect(c).toMatch(/^[A-Z_]+$/);
    }
  });
});
