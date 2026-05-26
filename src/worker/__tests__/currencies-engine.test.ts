// ── currencies-engine.test.ts — Utils P2-2 currencies pure helpers ────────
// Couvre validation ISO 4217, FX rate, conversion, round per-currency,
// staleness TTL/max, parse filtres.
//
// Multi-tenant N/A (helpers neutres, currency_rates est shared).

import { describe, it, expect } from 'vitest';
import {
  CURRENCIES_ERROR_CODES,
  VALID_CURRENCIES_FULL,
  FX_CACHE_TTL_HOURS,
  MAX_FX_AGE_HOURS_STALE,
  MAX_FX_RATE,
  validateCurrencyCode,
  isSupportedCurrency,
  validateFxRate,
  validateAmount,
  ageInHours,
  isRateStale,
  isRateTooOld,
  decimalsForCurrency,
  roundForCurrency,
  convertAmount,
  parseRatesFilters,
} from '../lib/currencies-engine';

describe('CURRENCIES_ERROR_CODES', () => {
  it('expose les codes canoniques', () => {
    expect(CURRENCIES_ERROR_CODES.INVALID_CODE).toBe('INVALID_CODE');
    expect(CURRENCIES_ERROR_CODES.INVALID_RATE).toBe('INVALID_RATE');
    expect(CURRENCIES_ERROR_CODES.STALE_RATE).toBe('STALE_RATE');
  });
  it('est frozen', () => {
    expect(Object.isFrozen(CURRENCIES_ERROR_CODES)).toBe(true);
  });
});

describe('VALID_CURRENCIES_FULL', () => {
  it('contient au moins 30 devises ISO 4217', () => {
    expect(VALID_CURRENCIES_FULL.size).toBeGreaterThanOrEqual(30);
  });
  it('inclut nos SupportedCurrencyExt (CAD/USD/EUR/DZD/MAD)', () => {
    expect(VALID_CURRENCIES_FULL.has('CAD')).toBe(true);
    expect(VALID_CURRENCIES_FULL.has('USD')).toBe(true);
    expect(VALID_CURRENCIES_FULL.has('EUR')).toBe(true);
    expect(VALID_CURRENCIES_FULL.has('DZD')).toBe(true);
    expect(VALID_CURRENCIES_FULL.has('MAD')).toBe(true);
  });
});

describe('validateCurrencyCode', () => {
  it('accepte 3 lettres uppercase', () => {
    expect(validateCurrencyCode('USD')).toBe(true);
    expect(validateCurrencyCode('EUR')).toBe(true);
    expect(validateCurrencyCode('XYZ')).toBe(true); // format OK même si non whitelisté
  });
  it('rejette lowercase / 2-4 lettres / non-string / chiffres / espaces', () => {
    expect(validateCurrencyCode('usd')).toBe(false);
    expect(validateCurrencyCode('US')).toBe(false);
    expect(validateCurrencyCode('USDD')).toBe(false);
    expect(validateCurrencyCode('US1')).toBe(false);
    expect(validateCurrencyCode(' US')).toBe(false);
    expect(validateCurrencyCode(null)).toBe(false);
    expect(validateCurrencyCode(123)).toBe(false);
  });
});

describe('isSupportedCurrency', () => {
  it('accepte uniquement les codes whitelistés', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('DZD')).toBe(true);
    expect(isSupportedCurrency('XYZ')).toBe(false); // format valide mais hors whitelist
  });
});

describe('validateFxRate', () => {
  it('accepte 0 < rate < MAX_FX_RATE finis', () => {
    expect(validateFxRate(1)).toBe(true);
    expect(validateFxRate(0.0001)).toBe(true);
    expect(validateFxRate(42.5)).toBe(true);
  });
  it('rejette 0, négatif, NaN, Infinity, > seuil', () => {
    expect(validateFxRate(0)).toBe(false);
    expect(validateFxRate(-1)).toBe(false);
    expect(validateFxRate(Number.NaN)).toBe(false);
    expect(validateFxRate(Number.POSITIVE_INFINITY)).toBe(false);
    expect(validateFxRate(MAX_FX_RATE)).toBe(false);
    expect(validateFxRate(MAX_FX_RATE + 1)).toBe(false);
    expect(validateFxRate('1' as unknown)).toBe(false);
  });
});

describe('validateAmount', () => {
  it('accepte les nombres finis (positifs et négatifs)', () => {
    expect(validateAmount(0)).toBe(true);
    expect(validateAmount(-50)).toBe(true);
    expect(validateAmount(99.99)).toBe(true);
  });
  it('rejette NaN / Infinity / non-number', () => {
    expect(validateAmount(Number.NaN)).toBe(false);
    expect(validateAmount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(validateAmount('5' as unknown)).toBe(false);
  });
});

describe('ageInHours / isRateStale / isRateTooOld', () => {
  it('ageInHours calcule un delta positif', () => {
    const now = new Date('2026-05-26T12:00:00Z');
    const past = '2026-05-26T11:00:00Z'; // 1h
    expect(ageInHours(past, now)).toBeCloseTo(1, 5);
  });
  it('ageInHours renvoie null sur timestamp invalide', () => {
    expect(ageInHours('not-a-date')).toBe(null);
  });
  it('isRateStale true si > TTL', () => {
    const now = new Date('2026-05-26T12:00:00Z');
    const past = new Date(now.getTime() - (FX_CACHE_TTL_HOURS + 1) * 3600_000).toISOString();
    expect(isRateStale(past, now)).toBe(true);
  });
  it('isRateStale false si dans TTL', () => {
    const now = new Date('2026-05-26T12:00:00Z');
    const recent = new Date(now.getTime() - 1 * 3600_000).toISOString();
    expect(isRateStale(recent, now)).toBe(false);
  });
  it('isRateTooOld true si > MAX_FX_AGE_HOURS_STALE', () => {
    const now = new Date('2026-05-26T12:00:00Z');
    const ancient = new Date(now.getTime() - (MAX_FX_AGE_HOURS_STALE + 1) * 3600_000).toISOString();
    expect(isRateTooOld(ancient, now)).toBe(true);
  });
  it('isRateTooOld false si récent', () => {
    const now = new Date('2026-05-26T12:00:00Z');
    expect(isRateTooOld(now.toISOString(), now)).toBe(false);
  });
});

describe('decimalsForCurrency', () => {
  it('JPY = 0 décimal (zero-decimal currency)', () => {
    expect(decimalsForCurrency('JPY')).toBe(0);
  });
  it('KRW = 0 décimal', () => {
    expect(decimalsForCurrency('KRW')).toBe(0);
  });
  it('USD/EUR/CAD = 2 décimales (default)', () => {
    expect(decimalsForCurrency('USD')).toBe(2);
    expect(decimalsForCurrency('EUR')).toBe(2);
    expect(decimalsForCurrency('CAD')).toBe(2);
  });
  it('code invalide → fallback 2', () => {
    expect(decimalsForCurrency('xxx')).toBe(2);
  });
});

describe('roundForCurrency', () => {
  it('JPY arrondit à l\'entier (0 décimal)', () => {
    expect(roundForCurrency(100.4, 'JPY')).toBe(100);
    expect(roundForCurrency(100.6, 'JPY')).toBe(101);
  });
  it('USD arrondit à 2 décimales', () => {
    expect(roundForCurrency(10.236, 'USD')).toBe(10.24);
    expect(roundForCurrency(10.234, 'USD')).toBe(10.23);
  });
  it('amount NaN → 0', () => {
    expect(roundForCurrency(Number.NaN, 'USD')).toBe(0);
  });
});

describe('convertAmount', () => {
  it('convertit USD→EUR avec rate', () => {
    const r = convertAmount(100, 'USD', 'EUR', 0.92);
    expect(r).not.toBe(null);
    expect(r!.converted).toBe(92);
    expect(r!.precision).toBe(2);
    expect(r!.rate).toBe(0.92);
  });
  it('same-currency court-circuite avec rate=1', () => {
    const r = convertAmount(50, 'USD', 'USD', 999);
    expect(r!.converted).toBe(50);
    expect(r!.rate).toBe(1);
  });
  it('JPY round à entier après conversion', () => {
    const r = convertAmount(100, 'USD', 'JPY', 155.78);
    expect(r!.converted).toBe(15578);
    expect(r!.precision).toBe(0);
  });
  it('renvoie null si rate invalide (cross-currency)', () => {
    expect(convertAmount(100, 'USD', 'EUR', 0)).toBe(null);
    expect(convertAmount(100, 'USD', 'EUR', -1)).toBe(null);
    expect(convertAmount(100, 'USD', 'EUR', Number.NaN)).toBe(null);
  });
  it('renvoie null si code invalide', () => {
    expect(convertAmount(100, 'usd', 'EUR', 0.9)).toBe(null);
    expect(convertAmount(100, 'USD', 'EU', 0.9)).toBe(null);
  });
  it('renvoie null si amount invalide', () => {
    expect(convertAmount(Number.NaN, 'USD', 'EUR', 0.9)).toBe(null);
  });
});

describe('parseRatesFilters', () => {
  it('parse base/quote/limit/source', () => {
    const q = new URLSearchParams('base=usd&quote=eur&limit=50&source=ecb');
    const r = parseRatesFilters(q);
    expect(r.base).toBe('USD');
    expect(r.quote).toBe('EUR');
    expect(r.limit).toBe(50);
    expect(r.source).toBe('ecb');
  });
  it('clamp limit à 500 max', () => {
    const r = parseRatesFilters(new URLSearchParams('limit=9999'));
    expect(r.limit).toBe(500);
  });
  it('ignore source non whitelistée', () => {
    const r = parseRatesFilters(new URLSearchParams('source=hacker'));
    expect(r.source).toBeUndefined();
  });
  it('ignore base/quote format invalide', () => {
    const r = parseRatesFilters(new URLSearchParams('base=usdollar&quote=12'));
    expect(r.base).toBeUndefined();
    expect(r.quote).toBeUndefined();
  });
  it('default limit = 100 si absent', () => {
    expect(parseRatesFilters(new URLSearchParams()).limit).toBe(100);
  });
});
