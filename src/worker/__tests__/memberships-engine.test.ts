// ── Tests src/worker/lib/memberships-engine.ts — LOT MEMBERSHIPS (Sprint 6) ──
// Helpers PURS : drip schedule (0-365), lesson availability, member progress,
// validation slug membre, token membre (préfixe distinct). ZÉRO I/O.
import { describe, it, expect } from 'vitest';
import {
  MEMBERSHIPS_ERROR_CODES,
  MAX_DRIP_DELAY_DAYS,
  MEMBER_TOKEN_PREFIX,
  validateDripSchedule,
  isLessonAvailable,
  computeMemberProgress,
  validateMemberSlug,
  generateMemberToken,
  isMemberToken,
} from '../lib/memberships-engine';

describe('validateDripSchedule — 0 à 365 jours entiers', () => {
  it('accepte 0 (disponible dès inscription)', () => {
    expect(validateDripSchedule(0).ok).toBe(true);
  });

  it('accepte la borne haute (365)', () => {
    expect(validateDripSchedule(365).ok).toBe(true);
  });

  it('refuse négatif', () => {
    const r = validateDripSchedule(-1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MEMBERSHIPS_ERROR_CODES.INVALID_DRIP_DELAY);
  });

  it(`refuse > ${MAX_DRIP_DELAY_DAYS}`, () => {
    const r = validateDripSchedule(366);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MEMBERSHIPS_ERROR_CODES.DRIP_TOO_LARGE);
  });

  it('refuse non-entier', () => {
    expect(validateDripSchedule(1.5).ok).toBe(false);
  });

  it('refuse NaN / null / undefined', () => {
    expect(validateDripSchedule(NaN).ok).toBe(false);
    expect(validateDripSchedule(null).ok).toBe(false);
    expect(validateDripSchedule(undefined).ok).toBe(false);
  });

  it('refuse Infinity', () => {
    expect(validateDripSchedule(Infinity).ok).toBe(false);
  });
});

describe('isLessonAvailable — drip check', () => {
  const NOW = new Date('2024-01-15T12:00:00Z').getTime();

  it('drip=0 → toujours disponible', () => {
    expect(isLessonAvailable({ drip_days: 0 }, '2024-01-15T11:00:00', NOW)).toBe(true);
  });

  it('drip>0 sans enrollment → indisponible', () => {
    expect(isLessonAvailable({ drip_days: 7 }, null, NOW)).toBe(false);
  });

  it('drip=7, enrolled il y a 8 jours → disponible', () => {
    const enrolled = new Date(NOW - 8 * 86400 * 1000).toISOString();
    expect(isLessonAvailable({ drip_days: 7 }, enrolled, NOW)).toBe(true);
  });

  it('drip=7, enrolled il y a 5 jours → indisponible', () => {
    const enrolled = new Date(NOW - 5 * 86400 * 1000).toISOString();
    expect(isLessonAvailable({ drip_days: 7 }, enrolled, NOW)).toBe(false);
  });

  it('accepte format SQLite "YYYY-MM-DD HH:MM:SS"', () => {
    // 10 jours avant
    expect(
      isLessonAvailable({ drip_days: 7 }, '2024-01-05 12:00:00', NOW),
    ).toBe(true);
  });

  it('accepte timestamp en ms', () => {
    const ms = NOW - 10 * 86400 * 1000;
    expect(isLessonAvailable({ drip_days: 7 }, ms, NOW)).toBe(true);
  });

  it('date illisible → ne bloque pas (true)', () => {
    expect(isLessonAvailable({ drip_days: 7 }, 'garbage', NOW)).toBe(true);
  });

  it('drip null/undefined → 0 par défaut → disponible', () => {
    expect(isLessonAvailable({ drip_days: null }, null, NOW)).toBe(true);
    expect(isLessonAvailable({}, null, NOW)).toBe(true);
  });
});

describe('computeMemberProgress — % + statut', () => {
  it('0 leçons totales → not_started + 0%', () => {
    const p = computeMemberProgress(0, 0);
    expect(p.pct).toBe(0);
    expect(p.status).toBe('not_started');
  });

  it('aucune complétée → not_started', () => {
    expect(computeMemberProgress(0, 10).status).toBe('not_started');
    expect(computeMemberProgress(0, 10).pct).toBe(0);
  });

  it('partiel → in_progress', () => {
    const p = computeMemberProgress(3, 10);
    expect(p.pct).toBe(30);
    expect(p.status).toBe('in_progress');
  });

  it('toutes complétées → completed + 100%', () => {
    const p = computeMemberProgress(10, 10);
    expect(p.pct).toBe(100);
    expect(p.status).toBe('completed');
  });

  it('arrondit correctement (3/7 ≈ 43%)', () => {
    expect(computeMemberProgress(3, 7).pct).toBe(43);
  });

  it('cap à 100% si completed > total (anti-corruption)', () => {
    const p = computeMemberProgress(15, 10);
    expect(p.pct).toBe(100);
    expect(p.status).toBe('completed');
  });

  it('gère négatifs / NaN gracefully', () => {
    expect(computeMemberProgress(-1, 10).pct).toBe(0);
    expect(computeMemberProgress(NaN, 10).pct).toBe(0);
    expect(computeMemberProgress(5, -1).status).toBe('not_started');
  });
});

describe('validateMemberSlug — grammaire alpha-num + _ + -', () => {
  it('accepte un slug simple', () => {
    expect(validateMemberSlug('mon-espace')).toBe(true);
    expect(validateMemberSlug('mon_espace_2024')).toBe(true);
    expect(validateMemberSlug('abc')).toBe(true);
  });

  it('refuse < 3 chars', () => {
    expect(validateMemberSlug('ab')).toBe(false);
  });

  it('refuse > 120 chars', () => {
    expect(validateMemberSlug('a'.repeat(121))).toBe(false);
  });

  it('refuse leading/trailing punct', () => {
    expect(validateMemberSlug('-abc')).toBe(false);
    expect(validateMemberSlug('abc-')).toBe(false);
    expect(validateMemberSlug('_abc')).toBe(false);
  });

  it('refuse les non-strings', () => {
    expect(validateMemberSlug(null)).toBe(false);
    expect(validateMemberSlug(123)).toBe(false);
  });
});

describe('generateMemberToken — préfixe distinct + entropie', () => {
  it('a le préfixe intralys_member_token_', () => {
    const token = generateMemberToken();
    expect(token.startsWith(MEMBER_TOKEN_PREFIX)).toBe(true);
  });

  it('produit un token différent à chaque appel', () => {
    const a = generateMemberToken();
    const b = generateMemberToken();
    expect(a).not.toBe(b);
  });

  it('a une longueur suffisante (≥ prefix + 24 chars base64)', () => {
    const token = generateMemberToken();
    expect(token.length).toBeGreaterThanOrEqual(MEMBER_TOKEN_PREFIX.length + 24);
  });

  it('utilise des caractères URL-safe (pas de /, +, =)', () => {
    for (let i = 0; i < 5; i++) {
      const token = generateMemberToken();
      expect(token).not.toMatch(/[+/=]/);
    }
  });
});

describe('isMemberToken — guard pour distinguer admin', () => {
  it('reconnaît un token valide', () => {
    expect(isMemberToken(generateMemberToken())).toBe(true);
  });

  it('refuse un token admin (autre préfixe)', () => {
    expect(isMemberToken('intralys_admin_token_xxx')).toBe(false);
    expect(isMemberToken('admin_xxx')).toBe(false);
  });

  it('refuse vide / null / wrong type', () => {
    expect(isMemberToken('')).toBe(false);
    expect(isMemberToken(null)).toBe(false);
    expect(isMemberToken(42)).toBe(false);
  });

  it('refuse un token avec préfixe correct mais trop court', () => {
    expect(isMemberToken(MEMBER_TOKEN_PREFIX + 'short')).toBe(false);
  });
});
