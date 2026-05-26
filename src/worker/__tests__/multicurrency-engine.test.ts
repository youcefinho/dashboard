// ── Tests — Multicurrency Engine (Sprint 39) ──────────────────────────────
//
// Couvre `src/worker/lib/multicurrency-engine.ts` (helpers PURS additifs).
//
// Stratégie : PURE, aucun mock D1 / fetch. Mock uniquement `Date.now()` pour
// isRateStale (déterminisme cross-runner).

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  convertCurrency,
  isRateStale,
  formatCurrency,
  safeAdd,
  safeAddCrossCurrency,
  getDefaultCurrencyForRegion,
  parseRateFromApi,
  MULTICURRENCY_ERROR_CODES,
} from '../lib/multicurrency-engine';

// ── convertCurrency ────────────────────────────────────────────────────────

describe('convertCurrency', () => {
  it('USD → CAD : 10000 cents × 1.36 ⇒ 13600 cents (Math.round)', () => {
    expect(convertCurrency(10000, 'USD', 'CAD', 1.36)).toBe(13600);
  });

  it('EUR → USD : 5000 cents × 1.0857 ⇒ 5429 cents (round, pas floor)', () => {
    expect(convertCurrency(5000, 'EUR', 'USD', 1.0857)).toBe(5429);
  });

  it('same currency ⇒ identity (rate ignoré)', () => {
    expect(convertCurrency(1234, 'CAD', 'CAD', 99.99)).toBe(1234);
  });

  it('currency code invalide (lowercase) ⇒ null', () => {
    expect(convertCurrency(1000, 'usd', 'CAD', 1.36)).toBeNull();
  });

  it('currency code inconnu (ZZZ) ⇒ null', () => {
    expect(convertCurrency(1000, 'ZZZ', 'CAD', 1.36)).toBeNull();
  });

  it('rate ≤ 0 ⇒ null', () => {
    expect(convertCurrency(1000, 'USD', 'CAD', 0)).toBeNull();
    expect(convertCurrency(1000, 'USD', 'CAD', -1.5)).toBeNull();
  });

  it('rate NaN / Infinity ⇒ null', () => {
    expect(convertCurrency(1000, 'USD', 'CAD', NaN)).toBeNull();
    expect(convertCurrency(1000, 'USD', 'CAD', Infinity)).toBeNull();
  });

  it('amountCents NaN ⇒ null', () => {
    expect(convertCurrency(NaN, 'USD', 'CAD', 1.36)).toBeNull();
  });
});

// ── isRateStale ────────────────────────────────────────────────────────────

describe('isRateStale', () => {
  const FIXED_NOW = new Date('2026-05-26T12:00:00Z').getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rate 3 jours ⇒ false (frais)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const threeDaysAgo = new Date(FIXED_NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(isRateStale(threeDaysAgo)).toBe(false);
  });

  it('rate 8 jours ⇒ true (stale, default maxDays=7)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const eightDaysAgo = new Date(FIXED_NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isRateStale(eightDaysAgo)).toBe(true);
  });

  it('rate 7 jours exact ⇒ false (limite incluse)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const sevenDaysAgo = new Date(FIXED_NOW - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(isRateStale(sevenDaysAgo)).toBe(false);
  });

  it('maxDays custom (1j) : rate 2j ⇒ true', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const twoDaysAgo = new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(isRateStale(twoDaysAgo, 1)).toBe(true);
  });

  it('date invalide ⇒ true (fail-safe)', () => {
    expect(isRateStale('not-a-date')).toBe(true);
  });

  it('Date object accepté', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const d = new Date(FIXED_NOW - 10 * 24 * 60 * 60 * 1000);
    expect(isRateStale(d)).toBe(true);
  });
});

// ── formatCurrency ─────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('USD en-US : 123456 cents ⇒ contient "1,234.56" et "$"', () => {
    const out = formatCurrency(123456, 'USD', 'en-US');
    expect(out).toContain('1,234.56');
    expect(out).toContain('$');
  });

  it('CAD fr-CA : 123456 cents ⇒ contient "1" suivi de "234,56" et "$"', () => {
    const out = formatCurrency(123456, 'CAD', 'fr-CA');
    // fr-CA utilise NBSP comme séparateur de milliers + virgule décimale.
    expect(out).toMatch(/1.234,56/);
    expect(out).toContain('$');
  });

  it('EUR fr-FR : 100000 cents ⇒ contient "1" "000,00" et "€"', () => {
    const out = formatCurrency(100000, 'EUR', 'fr-FR');
    expect(out).toMatch(/1.000,00/);
    expect(out).toContain('€');
  });

  it('currency invalide ⇒ empty string (fail-safe, pas de throw)', () => {
    expect(formatCurrency(1000, 'ZZZ', 'en-US')).toBe('');
  });

  it('amountCents NaN ⇒ empty string', () => {
    expect(formatCurrency(NaN, 'USD', 'en-US')).toBe('');
  });
});

// ── safeAdd ────────────────────────────────────────────────────────────────

describe('safeAdd', () => {
  it('même devise ⇒ ok + somme arrondie', () => {
    const r = safeAdd(1000, 2500, 'CAD');
    expect(r.ok).toBe(true);
    expect(r.value).toBe(3500);
  });

  it('currency invalide ⇒ ok:false + INVALID_CURRENCY', () => {
    const r = safeAdd(100, 200, 'zzz');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MULTICURRENCY_ERROR_CODES.INVALID_CURRENCY);
  });

  it('amount NaN ⇒ ok:false + INVALID_AMOUNT', () => {
    const r = safeAdd(NaN, 100, 'CAD');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MULTICURRENCY_ERROR_CODES.INVALID_AMOUNT);
  });
});

describe('safeAddCrossCurrency', () => {
  it('devises distinctes ⇒ ok:false + MISMATCH', () => {
    const r = safeAddCrossCurrency(1000, 'CAD', 500, 'USD');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MULTICURRENCY_ERROR_CODES.MISMATCH);
  });

  it('devises identiques ⇒ ok + somme', () => {
    const r = safeAddCrossCurrency(1000, 'EUR', 2000, 'EUR');
    expect(r.ok).toBe(true);
    expect(r.value).toBe(3000);
  });
});

// ── getDefaultCurrencyForRegion ────────────────────────────────────────────

describe('getDefaultCurrencyForRegion', () => {
  it.each([
    ['qc', 'CAD'],
    ['eu', 'EUR'],
    ['dz', 'DZD'],
    ['us', 'USD'],
    ['rest', 'USD'],
  ] as const)('region %s ⇒ %s', (region, expected) => {
    expect(getDefaultCurrencyForRegion(region)).toBe(expected);
  });
});

// ── parseRateFromApi ───────────────────────────────────────────────────────

describe('parseRateFromApi', () => {
  it('shape openexchangerates (rates + timestamp unix s) ⇒ extrait target', () => {
    const raw = {
      base: 'USD',
      rates: { EUR: 0.9123, CAD: 1.3621 },
      timestamp: 1716537600, // 2024-05-24 unix s
    };
    const out = parseRateFromApi(raw, 'EUR');
    expect(out).not.toBeNull();
    expect(out!.rate).toBe(0.9123);
    expect(out!.updatedAt).toMatch(/^2024-05-24T/);
  });

  it('shape frankfurter (rates + date ISO) ⇒ extrait target', () => {
    const raw = {
      base: 'CAD',
      rates: { USD: 0.73 },
      date: '2026-05-24',
    };
    const out = parseRateFromApi(raw, 'USD');
    expect(out).not.toBeNull();
    expect(out!.rate).toBe(0.73);
    expect(out!.updatedAt).toBe('2026-05-24T00:00:00.000Z');
  });

  it('shape directe { rate, updatedAt }', () => {
    const out = parseRateFromApi({
      rate: 1.5,
      updatedAt: '2026-05-26T10:00:00Z',
    });
    expect(out).toEqual({ rate: 1.5, updatedAt: '2026-05-26T10:00:00.000Z' });
  });

  it('target absent dans rates ⇒ null', () => {
    const raw = { rates: { EUR: 0.91 }, date: '2026-05-24' };
    expect(parseRateFromApi(raw, 'JPY')).toBeNull();
  });

  it('payload null / non-object ⇒ null', () => {
    expect(parseRateFromApi(null)).toBeNull();
    expect(parseRateFromApi('string')).toBeNull();
    expect(parseRateFromApi(42)).toBeNull();
  });

  it('rate ≤ 0 dans rates ⇒ null', () => {
    const raw = { rates: { EUR: 0 }, date: '2026-05-24' };
    expect(parseRateFromApi(raw, 'EUR')).toBeNull();
  });
});
