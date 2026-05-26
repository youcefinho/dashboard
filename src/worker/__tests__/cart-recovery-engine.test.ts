// ════════════════════════════════════════════════════════════════════════════
// Sprint 40 hardening — cart-recovery-engine.ts pure helpers tests (2026-05-26)
// ════════════════════════════════════════════════════════════════════════════
//
// Couvre `src/worker/lib/cart-recovery-engine.ts` — helpers PURS uniquement
// (aucun mock D1 nécessaire). Validation : éligibilité, génération codes,
// shape parsing, escalade humaine, constantes contractuelles.

import { describe, it, expect } from 'vitest';

import {
  CART_RECOVERY_DELAYS_MIN,
  CART_RECOVERY_ERROR_CODES,
  CART_RECOVERY_EXPIRY_MIN,
  HUMAN_ESCALATION_THRESHOLD,
  MAX_RECOVERY_STEPS,
  generateCartToken,
  generateCouponCode,
  getNextRecoveryStep,
  isRecoveryEligible,
  isValidCartToken,
  isValidRecoveryStep,
  parseRecoveryAttempts,
  parseRecoveryTimestamp,
  shouldEscalateToHuman,
  type RecoveryAttempt,
} from '../lib/cart-recovery-engine';

// ── Constants ───────────────────────────────────────────────────────────────

describe('CART_RECOVERY_DELAYS_MIN', () => {
  it('expose les délais figés [60, 1440, 4320] minutes (1h/24h/72h)', () => {
    expect(CART_RECOVERY_DELAYS_MIN).toEqual([60, 1440, 4320]);
    expect(CART_RECOVERY_DELAYS_MIN.length).toBe(3);
  });

  it('MAX_RECOVERY_STEPS = 3', () => {
    expect(MAX_RECOVERY_STEPS).toBe(3);
  });

  it('CART_RECOVERY_EXPIRY_MIN = somme délais = 5820 minutes (≈ 97h)', () => {
    expect(CART_RECOVERY_EXPIRY_MIN).toBe(60 + 1440 + 4320);
  });

  it('expose 9 codes erreur stables', () => {
    const codes = Object.values(CART_RECOVERY_ERROR_CODES);
    expect(codes.length).toBeGreaterThanOrEqual(6);
    expect(codes).toContain('CART_NOT_FOUND');
    expect(codes).toContain('RECOVERY_COMPLETED');
    expect(codes).toContain('RECOVERY_EXPIRED');
    expect(codes).toContain('RECOVERY_OPTIN_REQUIRED');
  });
});

// ── parseRecoveryTimestamp ──────────────────────────────────────────────────

describe('parseRecoveryTimestamp', () => {
  it('parse SQLite "YYYY-MM-DD HH:MM:SS" (UTC implicite)', () => {
    const ms = parseRecoveryTimestamp('2026-05-26 12:00:00');
    expect(ms).toBe(Date.UTC(2026, 4, 26, 12, 0, 0));
  });

  it('parse ISO 8601 avec Z', () => {
    const ms = parseRecoveryTimestamp('2026-05-26T12:00:00Z');
    expect(ms).toBe(Date.UTC(2026, 4, 26, 12, 0, 0));
  });

  it('retourne NaN pour null/undefined/empty', () => {
    expect(Number.isNaN(parseRecoveryTimestamp(null))).toBe(true);
    expect(Number.isNaN(parseRecoveryTimestamp(undefined))).toBe(true);
    expect(Number.isNaN(parseRecoveryTimestamp(''))).toBe(true);
    expect(Number.isNaN(parseRecoveryTimestamp('   '))).toBe(true);
  });

  it('retourne NaN pour string invalide', () => {
    expect(Number.isNaN(parseRecoveryTimestamp('not-a-date'))).toBe(true);
  });
});

// ── getNextRecoveryStep ─────────────────────────────────────────────────────

describe('getNextRecoveryStep', () => {
  const NOW = new Date('2026-05-26T12:00:00Z');

  it('currentStep=0 → step=1 éligible immédiat (jamais envoyé)', () => {
    const r = getNextRecoveryStep(null, 0, NOW);
    expect(r.step).toBe(1);
    expect(r.eligible).toBe(true);
    expect(r.nextDueAt).toBeNull();
  });

  it('currentStep=1 + last il y a 30min → step=2 PAS éligible (need 24h)', () => {
    const last = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const r = getNextRecoveryStep(last, 1, NOW);
    expect(r.step).toBe(2);
    expect(r.eligible).toBe(false);
    expect(r.nextDueAt).toBeTruthy();
  });

  it('currentStep=1 + last il y a 25h → step=2 éligible (>24h délai)', () => {
    const last = new Date(NOW.getTime() - 25 * 60 * 60_000).toISOString();
    const r = getNextRecoveryStep(last, 1, NOW);
    expect(r.step).toBe(2);
    expect(r.eligible).toBe(true);
  });

  it('currentStep=2 + last il y a 73h → step=3 éligible (>72h délai)', () => {
    const last = new Date(NOW.getTime() - 73 * 60 * 60_000).toISOString();
    const r = getNextRecoveryStep(last, 2, NOW);
    expect(r.step).toBe(3);
    expect(r.eligible).toBe(true);
  });

  it('currentStep=3 → step=null (séquence terminée)', () => {
    const r = getNextRecoveryStep('2026-05-23T12:00:00Z', 3, NOW);
    expect(r.step).toBeNull();
    expect(r.eligible).toBe(false);
    expect(r.nextDueAt).toBeNull();
  });

  it('currentStep négatif → clamp à 0, retourne step=1', () => {
    const r = getNextRecoveryStep(null, -5, NOW);
    expect(r.step).toBe(1);
    expect(r.eligible).toBe(true);
  });

  it('currentStep NaN → clamp à 0', () => {
    const r = getNextRecoveryStep(null, NaN, NOW);
    expect(r.step).toBe(1);
    expect(r.eligible).toBe(true);
  });

  it('timestamp last invalide → éligible immédiat (fallback)', () => {
    const r = getNextRecoveryStep('not-a-date', 1, NOW);
    expect(r.step).toBe(2);
    expect(r.eligible).toBe(true);
  });

  it('currentStep=1 + last EXACTEMENT à 24h → éligible (>=)', () => {
    const last = new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString();
    const r = getNextRecoveryStep(last, 1, NOW);
    expect(r.step).toBe(2);
    expect(r.eligible).toBe(true);
  });
});

// ── generateCouponCode ──────────────────────────────────────────────────────

describe('generateCouponCode', () => {
  it('format default CART-XXXXXX (6 hex uppercase)', () => {
    const code = generateCouponCode();
    expect(code).toMatch(/^CART-[A-F0-9]{6}$/);
  });

  it('prefix custom (REC) respecté', () => {
    const code = generateCouponCode('REC');
    expect(code).toMatch(/^REC-[A-F0-9]{6}$/);
  });

  it('prefix lowercase → uppercased', () => {
    const code = generateCouponCode('welcome');
    expect(code).toMatch(/^WELCOME-[A-F0-9]{6}$/);
  });

  it('prefix avec caractères invalides → strippés', () => {
    const code = generateCouponCode('A!B@C#');
    expect(code).toMatch(/^ABC-[A-F0-9]{6}$/);
  });

  it('prefix vide → fallback CART', () => {
    const code = generateCouponCode('');
    expect(code).toMatch(/^CART-[A-F0-9]{6}$/);
  });

  it('uniqueness : 1000 itérations, <1% collision (16M espace)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generateCouponCode());
    // ≥ 995 uniques (16M espace, collision attendue ~0.03 sur 1000)
    expect(codes.size).toBeGreaterThanOrEqual(995);
  });
});

// ── generateCartToken ───────────────────────────────────────────────────────

describe('generateCartToken', () => {
  it('format 32 chars base64url ([A-Za-z0-9_-])', () => {
    const t = generateCartToken();
    expect(t.length).toBe(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('aucun padding =, +, /', () => {
    for (let i = 0; i < 100; i++) {
      const t = generateCartToken();
      expect(t).not.toContain('=');
      expect(t).not.toContain('+');
      expect(t).not.toContain('/');
    }
  });

  it('uniqueness : 1000 itérations, 100% uniques (192 bits entropie)', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generateCartToken());
    expect(tokens.size).toBe(1000);
  });
});

// ── isRecoveryEligible ──────────────────────────────────────────────────────

describe('isRecoveryEligible', () => {
  const NOW = new Date('2026-05-26T12:00:00Z');

  it('cart complété (recovery_completed_at posé) → no (RECOVERY_COMPLETED)', () => {
    const r = isRecoveryEligible(
      { recovery_completed_at: '2026-05-25T12:00:00Z', status: 'abandoned' },
      NOW,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('RECOVERY_COMPLETED');
  });

  it('max steps atteint (count=3) → no (RECOVERY_MAX_STEPS_REACHED)', () => {
    const r = isRecoveryEligible(
      { status: 'abandoned', recovery_email_sent_count: 3 },
      NOW,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('RECOVERY_MAX_STEPS_REACHED');
  });

  it('cart expiré (abandoned il y a >97h) → no (RECOVERY_EXPIRED)', () => {
    const abandoned = new Date(
      NOW.getTime() - (CART_RECOVERY_EXPIRY_MIN + 60) * 60_000,
    ).toISOString();
    const r = isRecoveryEligible(
      { status: 'abandoned', abandoned_at: abandoned },
      NOW,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('RECOVERY_EXPIRED');
  });

  it('email_optin=false → no (RECOVERY_OPTIN_REQUIRED)', () => {
    const r = isRecoveryEligible(
      { status: 'abandoned', email_optin: false },
      NOW,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('RECOVERY_OPTIN_REQUIRED');
  });

  it('email_optin=0 (D1 boolean) → no', () => {
    const r = isRecoveryEligible(
      { status: 'abandoned', email_optin: 0 },
      NOW,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('RECOVERY_OPTIN_REQUIRED');
  });

  it('status=open (cart actif) → no (RECOVERY_STATUS_INVALID)', () => {
    const r = isRecoveryEligible({ status: 'open' }, NOW);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('RECOVERY_STATUS_INVALID');
  });

  it('cart abandoned + optin true + jamais envoyé → eligible', () => {
    const r = isRecoveryEligible(
      {
        status: 'abandoned',
        email_optin: true,
        abandoned_at: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
      },
      NOW,
    );
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('email_optin undefined → laisse passer (caller doit checker)', () => {
    const r = isRecoveryEligible({ status: 'abandoned' }, NOW);
    expect(r.eligible).toBe(true);
  });
});

// ── shouldEscalateToHuman ───────────────────────────────────────────────────

describe('shouldEscalateToHuman', () => {
  const makeAttempt = (
    step: 1 | 2 | 3,
    clicked: string | null = null,
  ): RecoveryAttempt => ({
    step,
    channel: 'email',
    ts: '2026-05-26T12:00:00Z',
    coupon_code: null,
    opened_at: null,
    clicked_at: clicked,
  });

  it('0 attempts → false (rien à escalader)', () => {
    expect(shouldEscalateToHuman([])).toBe(false);
  });

  it('1 attempt sans click → false (<3 threshold)', () => {
    expect(shouldEscalateToHuman([makeAttempt(1)])).toBe(false);
  });

  it('3 attempts AUCUN click → true (escalade)', () => {
    const attempts = [makeAttempt(1), makeAttempt(2), makeAttempt(3)];
    expect(shouldEscalateToHuman(attempts)).toBe(true);
  });

  it('3 attempts AVEC 1 click → false (déjà engagé)', () => {
    const attempts = [
      makeAttempt(1),
      makeAttempt(2, '2026-05-26T12:00:00Z'),
      makeAttempt(3),
    ];
    expect(shouldEscalateToHuman(attempts)).toBe(false);
  });

  it('input non-array → false (safe)', () => {
    // @ts-expect-error test runtime safety
    expect(shouldEscalateToHuman(null)).toBe(false);
    // @ts-expect-error test runtime safety
    expect(shouldEscalateToHuman('foo')).toBe(false);
  });

  it('HUMAN_ESCALATION_THRESHOLD = 3', () => {
    expect(HUMAN_ESCALATION_THRESHOLD).toBe(3);
  });
});

// ── parseRecoveryAttempts ───────────────────────────────────────────────────

describe('parseRecoveryAttempts', () => {
  it('null/undefined/empty → []', () => {
    expect(parseRecoveryAttempts(null)).toEqual([]);
    expect(parseRecoveryAttempts(undefined)).toEqual([]);
    expect(parseRecoveryAttempts('')).toEqual([]);
    expect(parseRecoveryAttempts('   ')).toEqual([]);
  });

  it('JSON malformé → []', () => {
    expect(parseRecoveryAttempts('{"foo')).toEqual([]);
    expect(parseRecoveryAttempts('not-json')).toEqual([]);
  });

  it('JSON valide mais pas array (object) → []', () => {
    expect(parseRecoveryAttempts('{"step":1}')).toEqual([]);
  });

  it('array valide → array typé', () => {
    const json = JSON.stringify([
      {
        step: 1,
        channel: 'email',
        ts: '2026-05-26T12:00:00Z',
        coupon_code: 'CART-AAAAAA',
        opened_at: null,
        clicked_at: null,
      },
    ]);
    const r = parseRecoveryAttempts(json);
    expect(r.length).toBe(1);
    expect(r[0].step).toBe(1);
    expect(r[0].channel).toBe('email');
    expect(r[0].coupon_code).toBe('CART-AAAAAA');
  });

  it('entries invalides filtrées (step=99, channel=invalid)', () => {
    const json = JSON.stringify([
      { step: 1, channel: 'email', ts: '2026-05-26T12:00:00Z' },
      { step: 99, channel: 'email', ts: '2026-05-26T12:00:00Z' }, // step invalide
      { step: 2, channel: 'pigeon', ts: '2026-05-26T12:00:00Z' }, // channel invalide
      { step: 3, channel: 'sms' }, // ts manquant
      'string-not-object',
      null,
    ]);
    const r = parseRecoveryAttempts(json);
    expect(r.length).toBe(1);
    expect(r[0].step).toBe(1);
  });

  it('normalise opened_at/clicked_at/coupon_code undefined → null', () => {
    const json = JSON.stringify([
      { step: 1, channel: 'email', ts: '2026-05-26T12:00:00Z' },
    ]);
    const r = parseRecoveryAttempts(json);
    expect(r[0].opened_at).toBeNull();
    expect(r[0].clicked_at).toBeNull();
    expect(r[0].coupon_code).toBeNull();
  });
});

// ── isValidCartToken ────────────────────────────────────────────────────────

describe('isValidCartToken', () => {
  it('token base64url 32 chars → true', () => {
    const t = generateCartToken();
    expect(isValidCartToken(t)).toBe(true);
  });

  it('token avec caractère invalide (/, +, =) → false', () => {
    expect(isValidCartToken('abc/def+ghi=jkl=========')).toBe(false);
  });

  it('trop court (<16) → false', () => {
    expect(isValidCartToken('abc')).toBe(false);
  });

  it('trop long (>64) → false', () => {
    expect(isValidCartToken('a'.repeat(65))).toBe(false);
  });

  it('null/undefined/empty → false', () => {
    expect(isValidCartToken(null)).toBe(false);
    expect(isValidCartToken(undefined)).toBe(false);
    expect(isValidCartToken('')).toBe(false);
  });
});

// ── isValidRecoveryStep ─────────────────────────────────────────────────────

describe('isValidRecoveryStep', () => {
  it('1, 2, 3 (number) → true', () => {
    expect(isValidRecoveryStep(1)).toBe(true);
    expect(isValidRecoveryStep(2)).toBe(true);
    expect(isValidRecoveryStep(3)).toBe(true);
  });

  it('"1", "2", "3" (string URL param) → true', () => {
    expect(isValidRecoveryStep('1')).toBe(true);
    expect(isValidRecoveryStep('2')).toBe(true);
    expect(isValidRecoveryStep('3')).toBe(true);
  });

  it('0, 4, null, undefined, "abc" → false', () => {
    expect(isValidRecoveryStep(0)).toBe(false);
    expect(isValidRecoveryStep(4)).toBe(false);
    expect(isValidRecoveryStep(null)).toBe(false);
    expect(isValidRecoveryStep(undefined)).toBe(false);
    expect(isValidRecoveryStep('abc')).toBe(false);
  });
});
