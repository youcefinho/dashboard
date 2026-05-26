// ── cookies-consent-engine.test.ts — Tests cookies-consent-engine.ts ─────────
//
// Couvre les helpers PURS du banner cookie : validation 4 catégories,
// encodage compact (computeConsentString/parseConsentString), version semver,
// requiresBannerDisplay, normalizeCategoriesInput.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  COOKIES_CONSENT_ERROR_CODES,
  VALID_COOKIE_CATEGORIES,
  DEFAULT_POLICY_VERSION,
  CONSENT_REFRESH_MS_DEFAULT,
  validateConsentBannerInput,
  computeConsentString,
  parseConsentString,
  consentStringToMap,
  requiresBannerDisplay,
  validateBannerVersion,
  parseVersion,
  compareVersions,
  normalizeCategoriesInput,
} from '../lib/cookies-consent-engine';

// ── Constants ───────────────────────────────────────────────

describe('cookies-consent-engine — constants', () => {
  it('COOKIES_CONSENT_ERROR_CODES is frozen', () => {
    expect(Object.isFrozen(COOKIES_CONSENT_ERROR_CODES)).toBe(true);
  });

  it('VALID_COOKIE_CATEGORIES is frozen and includes 4 IAB categories + legacy alias', () => {
    expect(Object.isFrozen(VALID_COOKIE_CATEGORIES)).toBe(true);
    expect(VALID_COOKIE_CATEGORIES).toContain('necessary');
    expect(VALID_COOKIE_CATEGORIES).toContain('essential'); // legacy alias
    expect(VALID_COOKIE_CATEGORIES).toContain('preferences');
    expect(VALID_COOKIE_CATEGORIES).toContain('analytics');
    expect(VALID_COOKIE_CATEGORIES).toContain('marketing');
  });

  it('DEFAULT_POLICY_VERSION is a valid semver string', () => {
    expect(validateBannerVersion(DEFAULT_POLICY_VERSION)).toBe(true);
  });

  it('CONSENT_REFRESH_MS_DEFAULT equals 180 days', () => {
    expect(CONSENT_REFRESH_MS_DEFAULT).toBe(180 * 24 * 60 * 60 * 1000);
  });
});

// ── validateConsentBannerInput ──────────────────────────────

describe('validateConsentBannerInput', () => {
  it('accepts valid 4-category input with necessary=true', () => {
    const r = validateConsentBannerInput({
      categories: {
        necessary: true,
        preferences: false,
        analytics: false,
        marketing: false,
      },
    });
    expect(r.ok).toBe(true);
  });

  it('accepts essential alias instead of necessary', () => {
    const r = validateConsentBannerInput({
      categories: { essential: true, preferences: true, analytics: false, marketing: false },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects necessary=false (Loi 25 violation)', () => {
    const r = validateConsentBannerInput({
      categories: { necessary: false, preferences: false, analytics: false, marketing: false },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COOKIES_CONSENT_ERROR_CODES.NECESSARY_MUST_BE_TRUE);
  });

  it('rejects unknown category', () => {
    const r = validateConsentBannerInput({
      categories: { necessary: true, evil: true },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COOKIES_CONSENT_ERROR_CODES.UNKNOWN_CATEGORY);
  });

  it('rejects non-boolean category value', () => {
    const r = validateConsentBannerInput({
      categories: { necessary: true, analytics: 'yes' as never },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COOKIES_CONSENT_ERROR_CODES.INVALID_CATEGORY_TYPE);
  });

  it('rejects missing categories field', () => {
    const r = validateConsentBannerInput({});
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COOKIES_CONSENT_ERROR_CODES.INVALID_CATEGORIES);
  });

  it('rejects null input', () => {
    const r = validateConsentBannerInput(null as never);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COOKIES_CONSENT_ERROR_CODES.INVALID_INPUT);
  });

  it('rejects array as categories', () => {
    const r = validateConsentBannerInput({ categories: [] as never });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COOKIES_CONSENT_ERROR_CODES.INVALID_CATEGORIES);
  });

  it('rejects missing necessary AND essential', () => {
    const r = validateConsentBannerInput({
      categories: { preferences: true, analytics: false, marketing: false },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COOKIES_CONSENT_ERROR_CODES.MISSING_CATEGORY);
  });

  it('rejects invalid policy_version (not semver)', () => {
    const r = validateConsentBannerInput({
      categories: { necessary: true, preferences: false, analytics: false, marketing: false },
      policy_version: 'v1',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COOKIES_CONSENT_ERROR_CODES.INVALID_VERSION);
  });

  it('accepts valid policy_version', () => {
    const r = validateConsentBannerInput({
      categories: { necessary: true, preferences: false, analytics: false, marketing: false },
      policy_version: '1.2.3',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects anonymous_id too long', () => {
    const r = validateConsentBannerInput({
      categories: { necessary: true, preferences: false, analytics: false, marketing: false },
      anonymous_id: 'a'.repeat(101),
    });
    expect(r.ok).toBe(false);
  });
});

// ── computeConsentString / parseConsentString ───────────────

describe('computeConsentString', () => {
  it('encodes all-false as v1:N1P0A0M0', () => {
    expect(
      computeConsentString({ preferences: false, analytics: false, marketing: false }),
    ).toBe('v1:N1P0A0M0');
  });

  it('encodes all-true as v1:N1P1A1M1', () => {
    expect(
      computeConsentString({ preferences: true, analytics: true, marketing: true }),
    ).toBe('v1:N1P1A1M1');
  });

  it('encodes mixed values', () => {
    expect(
      computeConsentString({ preferences: false, analytics: true, marketing: false }),
    ).toBe('v1:N1P0A1M0');
  });

  it('necessary is always 1 (even if input says otherwise)', () => {
    const s = computeConsentString({ analytics: false } as never);
    expect(s.startsWith('v1:N1')).toBe(true);
  });

  it('handles null input', () => {
    expect(computeConsentString(null)).toBe('v1:N1P0A0M0');
  });

  it('handles undefined input', () => {
    expect(computeConsentString(undefined)).toBe('v1:N1P0A0M0');
  });
});

describe('parseConsentString', () => {
  it('parses canonical v1 string', () => {
    const p = parseConsentString('v1:N1P0A1M0');
    expect(p).toEqual({
      necessary: true,
      preferences: false,
      analytics: true,
      marketing: false,
    });
  });

  it('parses all-true', () => {
    const p = parseConsentString('v1:N1P1A1M1');
    expect(p.preferences && p.analytics && p.marketing).toBe(true);
  });

  it('returns defaults on invalid string', () => {
    const p = parseConsentString('garbage');
    expect(p.necessary).toBe(true);
    expect(p.preferences).toBe(false);
    expect(p.analytics).toBe(false);
    expect(p.marketing).toBe(false);
  });

  it('returns defaults on empty string', () => {
    const p = parseConsentString('');
    expect(p.necessary).toBe(true);
  });

  it('returns defaults on non-string input', () => {
    const p = parseConsentString(null as never);
    expect(p.necessary).toBe(true);
  });

  it('round-trip stable', () => {
    const original = { preferences: true, analytics: false, marketing: true };
    const str = computeConsentString(original);
    const parsed = parseConsentString(str);
    expect(parsed.preferences).toBe(true);
    expect(parsed.analytics).toBe(false);
    expect(parsed.marketing).toBe(true);
  });

  it('consentStringToMap returns plain map', () => {
    const m = consentStringToMap('v1:N1P1A0M0');
    expect(m.preferences).toBe(true);
    expect(m.analytics).toBe(false);
  });
});

// ── validateBannerVersion / parseVersion / compareVersions ──

describe('validateBannerVersion', () => {
  it('accepts X.Y.Z', () => {
    expect(validateBannerVersion('1.0.0')).toBe(true);
    expect(validateBannerVersion('2.34.567')).toBe(true);
  });

  it('accepts X.Y (no patch)', () => {
    expect(validateBannerVersion('1.0')).toBe(true);
  });

  it('rejects v1 / non-semver', () => {
    expect(validateBannerVersion('v1')).toBe(false);
    expect(validateBannerVersion('latest')).toBe(false);
  });

  it('rejects empty', () => {
    expect(validateBannerVersion('')).toBe(false);
  });

  it('rejects non-string', () => {
    expect(validateBannerVersion(1 as never)).toBe(false);
  });
});

describe('parseVersion', () => {
  it('parses X.Y.Z', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('parses X.Y as X.Y.0', () => {
    expect(parseVersion('1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
  });

  it('returns null on invalid', () => {
    expect(parseVersion('garbage')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('returns 0 when equal', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('returns negative when a < b', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  it('returns positive when a > b', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('returns NaN on invalid input', () => {
    expect(Number.isNaN(compareVersions('garbage', '1.0.0'))).toBe(true);
  });
});

// ── requiresBannerDisplay ───────────────────────────────────

describe('requiresBannerDisplay', () => {
  const NOW = Date.parse('2026-05-26T12:00:00Z');

  it('returns true when never shown', () => {
    expect(requiresBannerDisplay(null, '1.0.0', '1.0.0', { now: NOW })).toBe(true);
  });

  it('returns false when recently shown with same version', () => {
    const recent = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(requiresBannerDisplay(recent, '1.0.0', '1.0.0', { now: NOW })).toBe(false);
  });

  it('returns true when stored version < current (policy bumped)', () => {
    const recent = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(requiresBannerDisplay(recent, '1.0.0', '2.0.0', { now: NOW })).toBe(true);
  });

  it('returns true when shown > 180 days ago', () => {
    const ancient = new Date(NOW - 200 * 24 * 60 * 60 * 1000).toISOString();
    expect(requiresBannerDisplay(ancient, '1.0.0', '1.0.0', { now: NOW })).toBe(true);
  });

  it('accepts ms epoch input', () => {
    expect(
      requiresBannerDisplay(
        NOW - 30 * 24 * 60 * 60 * 1000,
        '1.0.0',
        '1.0.0',
        { now: NOW },
      ),
    ).toBe(false);
  });

  it('returns true on invalid stored version', () => {
    const recent = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(requiresBannerDisplay(recent, 'garbage', '1.0.0', { now: NOW })).toBe(true);
  });

  it('respects custom refreshMs', () => {
    const old10d = new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      requiresBannerDisplay(old10d, '1.0.0', '1.0.0', {
        now: NOW,
        refreshMs: 7 * 24 * 60 * 60 * 1000,
      }),
    ).toBe(true);
  });

  it('returns true on invalid lastShownAt string', () => {
    expect(requiresBannerDisplay('not-a-date', '1.0.0', '1.0.0', { now: NOW })).toBe(true);
  });
});

// ── normalizeCategoriesInput ────────────────────────────────

describe('normalizeCategoriesInput', () => {
  it('forces necessary to true', () => {
    const out = normalizeCategoriesInput({ necessary: false });
    expect(out.necessary).toBe(true);
  });

  it('fills missing categories with false', () => {
    const out = normalizeCategoriesInput({});
    expect(out).toEqual({
      necessary: true,
      preferences: false,
      analytics: false,
      marketing: false,
    });
  });

  it('handles null', () => {
    const out = normalizeCategoriesInput(null);
    expect(out.necessary).toBe(true);
    expect(out.analytics).toBe(false);
  });

  it('preserves truthy optional categories', () => {
    const out = normalizeCategoriesInput({ analytics: true, marketing: true });
    expect(out.analytics).toBe(true);
    expect(out.marketing).toBe(true);
  });
});
