// ── Tests src/worker/lib/oauth-engine.ts — LOT OAUTH (Integrations P2-4) ───
// Helpers PURS : whitelist providers, état CSRF, expiration token, redirect_uri,
// parsing erreurs OAuth. ZÉRO I/O.
import { describe, it, expect } from 'vitest';
import {
  OAUTH_ERROR_CODES,
  VALID_OAUTH_PROVIDERS,
  validateProvider,
  isTokenExpired,
  generateOauthState,
  validateStateFormat,
  validateOauthState,
  validateRedirectUri,
  parseOauthError,
  sanitizeScopes,
  MIN_STATE_LENGTH,
} from '../lib/oauth-engine';

describe('OAUTH_ERROR_CODES + VALID_OAUTH_PROVIDERS — figés frozen', () => {
  it('expose des codes stables', () => {
    expect(OAUTH_ERROR_CODES.STATE_INVALID).toBe('oauth.state.invalid');
    expect(OAUTH_ERROR_CODES.PROVIDER_INVALID).toBe('oauth.provider.invalid');
    expect(Object.isFrozen(OAUTH_ERROR_CODES)).toBe(true);
  });

  it('expose une whitelist providers frozen', () => {
    expect(VALID_OAUTH_PROVIDERS).toContain('google');
    expect(VALID_OAUTH_PROVIDERS).toContain('slack');
    expect(VALID_OAUTH_PROVIDERS).toContain('stripe');
    expect(Object.isFrozen(VALID_OAUTH_PROVIDERS)).toBe(true);
  });
});

describe('validateProvider', () => {
  it('accepte les providers whitelistés', () => {
    expect(validateProvider('google')).toBe(true);
    expect(validateProvider('slack')).toBe(true);
    expect(validateProvider('shopify')).toBe(true);
    expect(validateProvider('woocommerce')).toBe(true);
  });

  it('refuse un provider inconnu', () => {
    expect(validateProvider('discord')).toBe(false);
    expect(validateProvider('twitter')).toBe(false);
  });

  it('refuse les non-strings', () => {
    expect(validateProvider(null)).toBe(false);
    expect(validateProvider(undefined)).toBe(false);
    expect(validateProvider(42)).toBe(false);
    expect(validateProvider({})).toBe(false);
  });
});

describe('isTokenExpired — Date | string | number', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('renvoie false si expiresAt absent (sans expiration)', () => {
    expect(isTokenExpired(null, now)).toBe(false);
    expect(isTokenExpired(undefined, now)).toBe(false);
  });

  it('détecte expiration via Date', () => {
    const past = new Date('2026-01-01T11:00:00Z');
    expect(isTokenExpired(past, now)).toBe(true);
    const future = new Date('2026-01-01T13:00:00Z');
    expect(isTokenExpired(future, now)).toBe(false);
  });

  it('détecte expiration via ISO string', () => {
    expect(isTokenExpired('2026-01-01T11:00:00Z', now)).toBe(true);
    expect(isTokenExpired('2026-01-01T13:00:00Z', now)).toBe(false);
  });

  it('refuse de claim "expiré" pour une string invalide (best-effort)', () => {
    expect(isTokenExpired('not-a-date', now)).toBe(false);
  });

  it('détecte expiration via epoch ms', () => {
    const pastMs = now.getTime() - 60 * 60 * 1000;
    const futureMs = now.getTime() + 60 * 60 * 1000;
    expect(isTokenExpired(pastMs, now)).toBe(true);
    expect(isTokenExpired(futureMs, now)).toBe(false);
  });

  it('détecte expiration via epoch s (heuristique < 1e12)', () => {
    const pastSec = Math.floor(now.getTime() / 1000) - 3600;
    const futureSec = Math.floor(now.getTime() / 1000) + 3600;
    expect(isTokenExpired(pastSec, now)).toBe(true);
    expect(isTokenExpired(futureSec, now)).toBe(false);
  });

  it('applique la grâce de 60s (anticipe les latences)', () => {
    const justOverGrace = new Date(now.getTime() + 30 * 1000); // 30s futur < grace 60s
    expect(isTokenExpired(justOverGrace, now, 60)).toBe(true);
    const wellAfterGrace = new Date(now.getTime() + 120 * 1000);
    expect(isTokenExpired(wellAfterGrace, now, 60)).toBe(false);
  });
});

describe('generateOauthState + validateStateFormat', () => {
  it('génère un state de 32 chars hex', () => {
    const s = generateOauthState();
    expect(s).toMatch(/^[0-9a-f]{32}$/);
  });

  it('génère des states uniques', () => {
    const s1 = generateOauthState();
    const s2 = generateOauthState();
    expect(s1).not.toBe(s2);
  });

  it('validateStateFormat accepte les states générés', () => {
    expect(validateStateFormat(generateOauthState())).toBe(true);
  });

  it('refuse les états trop courts', () => {
    expect(validateStateFormat('abc')).toBe(false);
    expect(validateStateFormat('a'.repeat(MIN_STATE_LENGTH - 1))).toBe(false);
  });

  it('refuse les caractères interdits', () => {
    expect(validateStateFormat('a'.repeat(31) + ' ')).toBe(false);
    expect(validateStateFormat('a'.repeat(31) + '/')).toBe(false);
  });

  it('refuse les non-strings', () => {
    expect(validateStateFormat(null)).toBe(false);
    expect(validateStateFormat(123)).toBe(false);
  });
});

describe('validateOauthState — constant-time compare', () => {
  it('accepte deux states identiques', () => {
    const s = generateOauthState();
    expect(validateOauthState(s, s)).toBe(true);
  });

  it('refuse des states différents', () => {
    expect(validateOauthState('abc123', 'abc124')).toBe(false);
  });

  it('refuse longueurs différentes', () => {
    expect(validateOauthState('abc', 'abcd')).toBe(false);
  });

  it('refuse les non-strings', () => {
    expect(validateOauthState(null, 'abc')).toBe(false);
    expect(validateOauthState('abc', null)).toBe(false);
  });

  it('refuse deux chaînes vides', () => {
    expect(validateOauthState('', '')).toBe(false);
  });
});

describe('validateRedirectUri — https only, whitelist, anti-localhost', () => {
  it('accepte une URL https valide', () => {
    expect(validateRedirectUri('https://app.intralys.dev/oauth/callback').ok).toBe(true);
  });

  it('refuse http en prod', () => {
    const r = validateRedirectUri('http://app.intralys.dev/oauth/callback');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(OAUTH_ERROR_CODES.REDIRECT_URI_INVALID);
  });

  it('accepte http://localhost SI allowLocalhost', () => {
    const r = validateRedirectUri('http://localhost:5173/cb', [], { allowLocalhost: true });
    expect(r.ok).toBe(true);
  });

  it('refuse localhost en prod (allowLocalhost=false)', () => {
    const r = validateRedirectUri('https://localhost/cb');
    expect(r.ok).toBe(false);
  });

  it('accepte si dans la whitelist', () => {
    const r = validateRedirectUri(
      'https://app.intralys.dev/cb',
      ['https://app.intralys.dev'],
    );
    expect(r.ok).toBe(true);
  });

  it('refuse si pas dans whitelist', () => {
    const r = validateRedirectUri('https://evil.com/cb', ['https://app.intralys.dev']);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(OAUTH_ERROR_CODES.REDIRECT_URI_NOT_WHITELISTED);
  });

  it('refuse les chaînes invalides', () => {
    expect(validateRedirectUri('').ok).toBe(false);
    expect(validateRedirectUri('not a url').ok).toBe(false);
    expect(validateRedirectUri(null).ok).toBe(false);
  });
});

describe('parseOauthError', () => {
  it('parse une erreur OAuth standard', () => {
    const q = new URLSearchParams('error=access_denied&error_description=User+declined');
    const r = parseOauthError(q);
    expect(r.error).toBe('access_denied');
    expect(r.description).toBe('User declined');
  });

  it('renvoie objet vide si pas d\'erreur', () => {
    expect(parseOauthError(new URLSearchParams('code=abc'))).toEqual({});
  });

  it('tolère null/undefined', () => {
    expect(parseOauthError(null)).toEqual({});
    expect(parseOauthError(undefined)).toEqual({});
  });

  it('extrait error_uri si présent', () => {
    const q = new URLSearchParams('error=server_error&error_uri=https%3A%2F%2Fdocs.example.com');
    expect(parseOauthError(q).uri).toBe('https://docs.example.com');
  });
});

describe('sanitizeScopes — additif helper', () => {
  it('split sur espaces et virgules', () => {
    expect(sanitizeScopes('a b,c d,e')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('déduplique', () => {
    expect(sanitizeScopes('a a b a')).toEqual(['a', 'b']);
  });

  it('accepte un array', () => {
    expect(sanitizeScopes(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('tolère null/undefined', () => {
    expect(sanitizeScopes(null)).toEqual([]);
    expect(sanitizeScopes(undefined)).toEqual([]);
    expect(sanitizeScopes('')).toEqual([]);
  });
});
