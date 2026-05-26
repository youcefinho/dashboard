// ── auth-engine.test.ts — Tests RENFORCEMENT auth-engine.ts ─────────────────
//
// Couvre les helpers PURS sécurité : validation password (faible/fort/commun),
// validation email RFC, génération tokens (entropy + unicité), hash/verify
// PBKDF2 (roundtrip + wrong password), parseAuthHeader, expiry checking.
//
// Aucun mock — module pur (Web Crypto natif Workers / Vitest).

import { describe, it, expect } from 'vitest';
import {
  AUTH_ERROR_CODES,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  SESSION_TTL_MS,
  MAGIC_LINK_TTL_MS,
  validatePassword,
  validatePasswordStrict,
  scorePasswordStrength,
  validateEmailLogin,
  normalizeEmail,
  generateSessionToken,
  generateMagicLinkToken,
  randomHex,
  hashPassword,
  verifyPassword,
  constantTimeEqual,
  parseAuthHeader,
  isTokenExpired,
  computeExpiry,
} from '../lib/auth-engine';

// ════════════════════════════════════════════════════════════════════════════
// AUTH_ERROR_CODES — sanity
// ════════════════════════════════════════════════════════════════════════════

describe('AUTH_ERROR_CODES', () => {
  it('expose >= 10 codes', () => {
    expect(Object.keys(AUTH_ERROR_CODES).length).toBeGreaterThanOrEqual(10);
  });
  it('codes spécifiques attendus', () => {
    expect(AUTH_ERROR_CODES.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
    expect(AUTH_ERROR_CODES.EMAIL_TAKEN).toBe('EMAIL_TAKEN');
    expect(AUTH_ERROR_CODES.WEAK_PASSWORD).toBe('WEAK_PASSWORD');
    expect(AUTH_ERROR_CODES.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
    expect(AUTH_ERROR_CODES.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(AUTH_ERROR_CODES.ACCOUNT_LOCKED).toBe('ACCOUNT_LOCKED');
    expect(AUTH_ERROR_CODES.INVALID_2FA).toBe('INVALID_2FA');
  });
});

describe('Constantes sécurité', () => {
  it('MIN_PASSWORD_LENGTH = 12 (NIST guidance)', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });
  it('MAX_PASSWORD_LENGTH = 128', () => {
    expect(MAX_PASSWORD_LENGTH).toBe(128);
  });
  it('SESSION_TTL_MS = 24h', () => {
    expect(SESSION_TTL_MS).toBe(24 * 3600 * 1000);
  });
  it('MAGIC_LINK_TTL_MS = 15min', () => {
    expect(MAGIC_LINK_TTL_MS).toBe(15 * 60 * 1000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validatePassword
// ════════════════════════════════════════════════════════════════════════════

describe('validatePassword', () => {
  it('rejette non-string', () => {
    expect(validatePassword(undefined).ok).toBe(false);
    expect(validatePassword(null).ok).toBe(false);
    expect(validatePassword(12345).ok).toBe(false);
  });
  it('rejette 8 chars (trop court)', () => {
    const r = validatePassword('Abcd123!');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AUTH_ERROR_CODES.PASSWORD_TOO_SHORT);
  });
  it('rejette 11 chars (trop court de 1)', () => {
    expect(validatePassword('Abcd123!xyz').ok).toBe(false);
  });
  it('accepte 12 chars random', () => {
    const r = validatePassword('Zx9!kPqRm#Lv');
    expect(r.ok).toBe(true);
    expect(r.strength).toBeGreaterThanOrEqual(2);
  });
  it('rejette >128 chars (trop long)', () => {
    const r = validatePassword('A1!' + 'a'.repeat(130));
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AUTH_ERROR_CODES.PASSWORD_TOO_LONG);
  });
  it('rejette "password123" (common)', () => {
    const r = validatePassword('password123');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AUTH_ERROR_CODES.PASSWORD_COMMON);
  });
  it('rejette common 12+ chars insensible à la casse', () => {
    const r = validatePassword('PASSWORD1234');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AUTH_ERROR_CODES.PASSWORD_COMMON);
  });
  it('rejette "administrator" common 13 chars', () => {
    expect(validatePassword('administrator').code).toBe(AUTH_ERROR_CODES.PASSWORD_COMMON);
  });
  it('rejette "motdepasse" français commun', () => {
    expect(validatePassword('motdepasse').ok).toBe(false);
  });
});

describe('scorePasswordStrength', () => {
  it('0 pour 8 chars 1 famille', () => {
    expect(scorePasswordStrength('aaaaaaaa')).toBe(0);
  });
  it('>=1 pour 10+ chars 1 famille', () => {
    expect(scorePasswordStrength('aaaaaaaaaa')).toBeGreaterThanOrEqual(1);
  });
  it('>=2 pour 12 chars 3 familles', () => {
    expect(scorePasswordStrength('Abcd1234efgh')).toBeGreaterThanOrEqual(2);
  });
  it('>=3 pour 14 chars 3 familles', () => {
    expect(scorePasswordStrength('Abcd1234efghij')).toBeGreaterThanOrEqual(3);
  });
  it('4 pour 16+ chars 4 familles', () => {
    expect(scorePasswordStrength('Abcd1234!@#$wxyz')).toBe(4);
  });
});

describe('validatePasswordStrict', () => {
  it('rejette pwd valid-but-weak (1 famille)', () => {
    const r = validatePasswordStrict('aaaaaaaaaaaa');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(AUTH_ERROR_CODES.WEAK_PASSWORD);
  });
  it('accepte pwd 3 familles + 12 chars', () => {
    const r = validatePasswordStrict('Abcd1234efgh');
    expect(r.ok).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateEmailLogin
// ════════════════════════════════════════════════════════════════════════════

describe('validateEmailLogin', () => {
  it('accepte emails standards', () => {
    expect(validateEmailLogin('user@example.com')).toBe(true);
    expect(validateEmailLogin('user.name+tag@sub.example.co.uk')).toBe(true);
    expect(validateEmailLogin('a@b.io')).toBe(true);
  });
  it('rejette non-string', () => {
    expect(validateEmailLogin(undefined)).toBe(false);
    expect(validateEmailLogin(null)).toBe(false);
    expect(validateEmailLogin(123)).toBe(false);
  });
  it('rejette vide', () => {
    expect(validateEmailLogin('')).toBe(false);
    expect(validateEmailLogin('   ')).toBe(false);
  });
  it('rejette sans @', () => {
    expect(validateEmailLogin('userexample.com')).toBe(false);
  });
  it('rejette double @', () => {
    expect(validateEmailLogin('user@@example.com')).toBe(false);
    expect(validateEmailLogin('user@a@b.com')).toBe(false);
  });
  it('rejette espaces', () => {
    expect(validateEmailLogin('user @example.com')).toBe(false);
    expect(validateEmailLogin('user@ example.com')).toBe(false);
  });
  it('rejette double point consécutif', () => {
    expect(validateEmailLogin('user..name@example.com')).toBe(false);
  });
  it('rejette TLD trop court', () => {
    expect(validateEmailLogin('user@example.c')).toBe(false);
  });
  it('rejette TLD numérique', () => {
    expect(validateEmailLogin('user@example.123')).toBe(false);
  });
  it('rejette > 254 chars', () => {
    const long = 'a'.repeat(250) + '@b.co';
    expect(validateEmailLogin(long)).toBe(false);
  });
  it('rejette local > 64 chars', () => {
    expect(validateEmailLogin('a'.repeat(65) + '@b.co')).toBe(false);
  });
  it('rejette caractères de contrôle', () => {
    expect(validateEmailLogin('user\x00@example.com')).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trim + lowercase', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Token generation
// ════════════════════════════════════════════════════════════════════════════

describe('generateSessionToken', () => {
  it('48 chars hex', () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[0-9a-f]{48}$/);
  });
  it('unicité sur 1000 itérations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateSessionToken());
    expect(seen.size).toBe(1000);
  });
});

describe('generateMagicLinkToken', () => {
  it('64 chars hex', () => {
    const t = generateMagicLinkToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });
  it('unicité sur 500 itérations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateMagicLinkToken());
    expect(seen.size).toBe(500);
  });
});

describe('randomHex', () => {
  it('longueur = bytes * 2', () => {
    expect(randomHex(8)).toHaveLength(16);
    expect(randomHex(32)).toHaveLength(64);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// hashPassword + verifyPassword roundtrip
// ════════════════════════════════════════════════════════════════════════════

describe('hashPassword + verifyPassword', () => {
  it('roundtrip OK', async () => {
    const pwd = 'Zx9!kPqRm#Lv';
    const hash = await hashPassword(pwd);
    expect(hash.startsWith('pbkdf2$')).toBe(true);
    expect(await verifyPassword(pwd, hash)).toBe(true);
  });
  it('wrong password → false', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('wrong-pwd-12345', hash)).toBe(false);
  });
  it('même password produit hashs différents (salt random)', async () => {
    const a = await hashPassword('SamePwd!123');
    const b = await hashPassword('SamePwd!123');
    expect(a).not.toBe(b);
  });
  it('hash includes 210k iterations', async () => {
    const h = await hashPassword('Test!Pwd1234');
    expect(h).toMatch(/^pbkdf2\$210000\$/);
  });
  it('hashPassword throw sur empty string', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });
  it('verifyPassword false sur hash invalide', async () => {
    expect(await verifyPassword('any', 'not-a-pbkdf2-hash')).toBe(false);
    expect(await verifyPassword('any', 'pbkdf2$bad')).toBe(false);
    expect(await verifyPassword('any', 'pbkdf2$210000$$')).toBe(false);
  });
  it('verifyPassword false sur iterations hors bornes', async () => {
    expect(await verifyPassword('any', 'pbkdf2$5$salt$hash')).toBe(false);
    expect(await verifyPassword('any', 'pbkdf2$99999999$salt$hash')).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('strings égales → true', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });
  it('longueurs différentes → false', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
  it('un seul char diff → false', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });
  it('vides → true', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// parseAuthHeader
// ════════════════════════════════════════════════════════════════════════════

describe('parseAuthHeader', () => {
  it('extrait token valide', () => {
    const r = parseAuthHeader('Bearer abc123token');
    expect(r.token).toBe('abc123token');
    expect(r.error).toBeUndefined();
  });
  it('null/undefined → error', () => {
    expect(parseAuthHeader(null).error).toBeDefined();
    expect(parseAuthHeader(undefined).error).toBeDefined();
    expect(parseAuthHeader('').error).toBeDefined();
  });
  it('rejette scheme non-Bearer', () => {
    const r = parseAuthHeader('Basic abc');
    expect(r.token).toBeUndefined();
    expect(r.code).toBe(AUTH_ERROR_CODES.SESSION_INVALID);
  });
  it('rejette token vide après Bearer', () => {
    const r = parseAuthHeader('Bearer ');
    expect(r.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
  });
  it('rejette token avec espace interne', () => {
    const r = parseAuthHeader('Bearer abc def');
    expect(r.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
  });
  it('trim header global', () => {
    const r = parseAuthHeader('  Bearer xyz789  ');
    expect(r.token).toBe('xyz789');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isTokenExpired + computeExpiry
// ════════════════════════════════════════════════════════════════════════════

describe('isTokenExpired', () => {
  it('null/undefined → expiré (fail-closed)', () => {
    expect(isTokenExpired(null)).toBe(true);
    expect(isTokenExpired(undefined)).toBe(true);
  });
  it('timestamp passé → expiré', () => {
    expect(isTokenExpired(Date.now() - 1000)).toBe(true);
  });
  it('timestamp futur → non expiré', () => {
    expect(isTokenExpired(Date.now() + 100_000)).toBe(false);
  });
  it('ISO string passé → expiré', () => {
    expect(isTokenExpired('2020-01-01T00:00:00Z')).toBe(true);
  });
  it('ISO string futur → non expiré', () => {
    expect(isTokenExpired('2099-01-01T00:00:00Z')).toBe(false);
  });
  it('Date passé → expiré', () => {
    expect(isTokenExpired(new Date(Date.now() - 1000))).toBe(true);
  });
  it('format invalide → expiré (fail-closed)', () => {
    expect(isTokenExpired('not-a-date')).toBe(true);
  });
  it('respecte now custom', () => {
    const futureTs = Date.now() + 5000;
    expect(isTokenExpired(futureTs, futureTs + 1)).toBe(true);
    expect(isTokenExpired(futureTs, futureTs - 1)).toBe(false);
  });
});

describe('computeExpiry', () => {
  it('retourne ISO 8601 à now + ttl', () => {
    const now = 1_700_000_000_000;
    const iso = computeExpiry(60_000, now);
    expect(new Date(iso).getTime()).toBe(now + 60_000);
  });
});
