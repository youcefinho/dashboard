// ── catalog-engine.test.ts — Tests RENFORCEMENT catalog-engine.ts ──────────
//
// Couvre helpers PURS catalogue (zéro I/O) :
//   - CATALOG_ERROR_CODES + VALID_KINDS + VALID_RECURRENCES
//   - normalizePrice (string|number → number)
//   - dollarsToCents / centsToDollars
//   - validateCategory
//   - validateCatalogItemInput (create + update)

import { describe, it, expect } from 'vitest';
import {
  CATALOG_ERROR_CODES,
  VALID_KINDS,
  VALID_RECURRENCES,
  VALID_CURRENCIES_CATALOG,
  CATALOG_NAME_MAX,
  CATALOG_CATEGORY_MAX,
  CATALOG_PRICE_MAX,
  isValidKind,
  isValidRecurrence,
  isValidCurrency,
  validateCategory,
  normalizePrice,
  dollarsToCents,
  centsToDollars,
  validateCatalogItemInput,
} from '../lib/catalog-engine';

// ════════════════════════════════════════════════════════════════════════════
// Error codes & frozen constants
// ════════════════════════════════════════════════════════════════════════════

describe('CATALOG_ERROR_CODES', () => {
  it('expose >= 8 codes', () => {
    expect(Object.keys(CATALOG_ERROR_CODES).length).toBeGreaterThanOrEqual(8);
  });
  it('codes critiques présents', () => {
    expect(CATALOG_ERROR_CODES.INVALID_KIND).toBe('INVALID_KIND');
    expect(CATALOG_ERROR_CODES.NEGATIVE_PRICE).toBe('NEGATIVE_PRICE');
    expect(CATALOG_ERROR_CODES.MISSING_NAME).toBe('MISSING_NAME');
  });
});

describe('VALID_KINDS / VALID_RECURRENCES (frozen)', () => {
  it('VALID_KINDS contient service/product/subscription', () => {
    expect(VALID_KINDS).toContain('service');
    expect(VALID_KINDS).toContain('product');
    expect(VALID_KINDS).toContain('subscription');
    expect(VALID_KINDS.length).toBe(3);
  });
  it('VALID_KINDS est frozen', () => {
    expect(Object.isFrozen(VALID_KINDS)).toBe(true);
  });
  it('VALID_RECURRENCES contient one_time/monthly/quarterly/yearly', () => {
    expect(VALID_RECURRENCES).toContain('one_time');
    expect(VALID_RECURRENCES).toContain('monthly');
    expect(VALID_RECURRENCES).toContain('quarterly');
    expect(VALID_RECURRENCES).toContain('yearly');
  });
  it('VALID_CURRENCIES_CATALOG inclut CAD/USD/EUR', () => {
    expect(VALID_CURRENCIES_CATALOG).toContain('CAD');
    expect(VALID_CURRENCIES_CATALOG).toContain('USD');
    expect(VALID_CURRENCIES_CATALOG).toContain('EUR');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isValid* helpers
// ════════════════════════════════════════════════════════════════════════════

describe('isValidKind', () => {
  it('accepte service/product/subscription', () => {
    expect(isValidKind('service')).toBe(true);
    expect(isValidKind('product')).toBe(true);
    expect(isValidKind('subscription')).toBe(true);
  });
  it('rejette unknown / null / number', () => {
    expect(isValidKind('unknown')).toBe(false);
    expect(isValidKind(null)).toBe(false);
    expect(isValidKind(42)).toBe(false);
    expect(isValidKind('')).toBe(false);
  });
});

describe('isValidRecurrence', () => {
  it('accepte one_time/monthly/quarterly/yearly', () => {
    expect(isValidRecurrence('one_time')).toBe(true);
    expect(isValidRecurrence('monthly')).toBe(true);
  });
  it('rejette weekly / null', () => {
    expect(isValidRecurrence('weekly')).toBe(false);
    expect(isValidRecurrence(null)).toBe(false);
  });
});

describe('isValidCurrency', () => {
  it('accepte CAD/USD/EUR (case-insensitive)', () => {
    expect(isValidCurrency('CAD')).toBe(true);
    expect(isValidCurrency('cad')).toBe(true);
    expect(isValidCurrency('USD')).toBe(true);
  });
  it('rejette XYZ / null', () => {
    expect(isValidCurrency('XYZ')).toBe(false);
    expect(isValidCurrency(null)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateCategory
// ════════════════════════════════════════════════════════════════════════════

describe('validateCategory', () => {
  it('accepte null/undefined (optionnel)', () => {
    expect(validateCategory(null)).toBe(true);
    expect(validateCategory(undefined)).toBe(true);
  });
  it('accepte string courte', () => {
    expect(validateCategory('Services')).toBe(true);
  });
  it('rejette > CATALOG_CATEGORY_MAX', () => {
    expect(validateCategory('a'.repeat(CATALOG_CATEGORY_MAX + 1))).toBe(false);
  });
  it('accepte string == CATALOG_CATEGORY_MAX', () => {
    expect(validateCategory('a'.repeat(CATALOG_CATEGORY_MAX))).toBe(true);
  });
  it('rejette non-string', () => {
    expect(validateCategory(42)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// normalizePrice
// ════════════════════════════════════════════════════════════════════════════

describe('normalizePrice', () => {
  it('number positif → identique', () => {
    expect(normalizePrice(42.5)).toBe(42.5);
  });
  it('number négatif → 0 (Math.max)', () => {
    expect(normalizePrice(-5)).toBe(0);
  });
  it('string "12.50" → 12.5', () => {
    expect(normalizePrice('12.50')).toBe(12.5);
  });
  it('string "12,50" (virgule fr) → 12.5', () => {
    expect(normalizePrice('12,50')).toBe(12.5);
  });
  it('string vide → 0', () => {
    expect(normalizePrice('')).toBe(0);
  });
  it('string non parsable → NaN', () => {
    expect(Number.isNaN(normalizePrice('abc'))).toBe(true);
  });
  it('null → 0', () => {
    expect(normalizePrice(null)).toBe(0);
  });
  it('undefined → 0', () => {
    expect(normalizePrice(undefined)).toBe(0);
  });
  it('Infinity → NaN', () => {
    expect(Number.isNaN(normalizePrice(Infinity))).toBe(true);
  });
});

describe('dollarsToCents / centsToDollars', () => {
  it('dollarsToCents(12.50) → 1250', () => {
    expect(dollarsToCents(12.5)).toBe(1250);
  });
  it('dollarsToCents("99.99") → 9999', () => {
    expect(dollarsToCents('99.99')).toBe(9999);
  });
  it('centsToDollars(1250) → 12.5', () => {
    expect(centsToDollars(1250)).toBe(12.5);
  });
  it('centsToDollars(NaN) → 0', () => {
    expect(centsToDollars('abc')).toBe(0);
  });
  it('roundtrip dollar→cents→dollar pour 12.34', () => {
    expect(centsToDollars(dollarsToCents(12.34))).toBe(12.34);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateCatalogItemInput
// ════════════════════════════════════════════════════════════════════════════

describe('validateCatalogItemInput (create)', () => {
  it('accepte input minimal valide', () => {
    const r = validateCatalogItemInput({ name: 'Consultation' });
    expect(r.ok).toBe(true);
  });
  it('rejette null input', () => {
    const r = validateCatalogItemInput(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(CATALOG_ERROR_CODES.INVALID_INPUT);
  });
  it('rejette name vide', () => {
    const r = validateCatalogItemInput({ name: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('name');
  });
  it('rejette name uniquement espaces', () => {
    const r = validateCatalogItemInput({ name: '   ' });
    expect(r.ok).toBe(false);
  });
  it('rejette name > CATALOG_NAME_MAX', () => {
    const r = validateCatalogItemInput({ name: 'a'.repeat(CATALOG_NAME_MAX + 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(CATALOG_ERROR_CODES.NAME_TOO_LONG);
  });
  it('rejette kind invalide', () => {
    const r = validateCatalogItemInput({ name: 'X', kind: 'unknown' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(CATALOG_ERROR_CODES.INVALID_KIND);
  });
  it('accepte kind service', () => {
    expect(validateCatalogItemInput({ name: 'X', kind: 'service' }).ok).toBe(true);
  });
  it('rejette recurrence invalide', () => {
    const r = validateCatalogItemInput({ name: 'X', recurrence: 'daily' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(CATALOG_ERROR_CODES.INVALID_RECURRENCE);
  });
  it('rejette unit_price négatif', () => {
    const r = validateCatalogItemInput({ name: 'X', unit_price: -5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(CATALOG_ERROR_CODES.NEGATIVE_PRICE);
  });
  it('rejette unit_price NaN/non-fini', () => {
    const r = validateCatalogItemInput({ name: 'X', unit_price: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(CATALOG_ERROR_CODES.INVALID_PRICE);
  });
  it('rejette unit_price > CATALOG_PRICE_MAX', () => {
    const r = validateCatalogItemInput({
      name: 'X',
      unit_price: CATALOG_PRICE_MAX + 1,
    });
    expect(r.ok).toBe(false);
  });
  it('rejette currency XYZ', () => {
    const r = validateCatalogItemInput({ name: 'X', currency: 'XYZ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(CATALOG_ERROR_CODES.INVALID_CURRENCY);
  });
  it('accepte currency vide (défaut serveur)', () => {
    expect(validateCatalogItemInput({ name: 'X', currency: '' }).ok).toBe(true);
  });
  it('rejette category trop longue', () => {
    const r = validateCatalogItemInput({
      name: 'X',
      category: 'c'.repeat(CATALOG_CATEGORY_MAX + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(CATALOG_ERROR_CODES.CATEGORY_TOO_LONG);
  });
  it('accepte input complet valide', () => {
    expect(
      validateCatalogItemInput({
        name: 'Consultation Premium',
        description: 'Service de conseil',
        kind: 'service',
        unit_price: 250.0,
        currency: 'CAD',
        category: 'Conseil',
        recurrence: 'monthly',
        is_active: true,
      }).ok,
    ).toBe(true);
  });
});

describe('validateCatalogItemInput (update)', () => {
  it('accepte update partiel sans name', () => {
    const r = validateCatalogItemInput({ unit_price: 100 }, 'update');
    expect(r.ok).toBe(true);
  });
  it('rejette name vide en update si fourni', () => {
    const r = validateCatalogItemInput({ name: '' }, 'update');
    expect(r.ok).toBe(false);
  });
  it('accepte objet vide en update', () => {
    expect(validateCatalogItemInput({}, 'update').ok).toBe(true);
  });
  it('accepte update kind seul', () => {
    expect(validateCatalogItemInput({ kind: 'product' }, 'update').ok).toBe(true);
  });
});
