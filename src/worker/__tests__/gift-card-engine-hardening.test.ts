// ── Gift card engine hardening tests — Sprint 38 (2026-05-26) ───────────────
//
// Tests PURS sur les helpers additifs introduits par le hardening Sprint 38 :
//   - generateGiftCardCodePrefixed() (format `GC-XXXX-XXXX-XXXX-XXXX`)
//   - validateGiftCardCode()
//   - applyGiftCardCharge()
//   - isGiftCardExpired()
//   - GIFTCARD_ERROR_CODES
//
// Aucun I/O, aucun mock D1 (helpers PURS).

import { describe, it, expect } from 'vitest';
import {
  generateGiftCardCodePrefixed,
  validateGiftCardCode,
  applyGiftCardCharge,
  isGiftCardExpired,
  GIFTCARD_ERROR_CODES,
} from '../lib/gift-card-engine';

describe('gift-card-engine hardening — constants', () => {
  // ── 1. GIFTCARD_ERROR_CODES ──────────────────────────────────────────────
  it('expose les 8 codes stables (string)', () => {
    expect(GIFTCARD_ERROR_CODES.INVALID_FORMAT).toBe('invalid_format');
    expect(GIFTCARD_ERROR_CODES.CARD_NOT_FOUND).toBe('card_not_found');
    expect(GIFTCARD_ERROR_CODES.CARD_EXPIRED).toBe('card_expired');
    expect(GIFTCARD_ERROR_CODES.CARD_VOIDED).toBe('card_voided');
    expect(GIFTCARD_ERROR_CODES.CARD_REDEEMED).toBe('card_redeemed');
    expect(GIFTCARD_ERROR_CODES.INSUFFICIENT_BALANCE).toBe('insufficient_balance');
    expect(GIFTCARD_ERROR_CODES.INVALID_AMOUNT).toBe('invalid_amount');
    expect(GIFTCARD_ERROR_CODES.AMOUNT_OVER_BALANCE).toBe('amount_over_balance');
  });
});

describe('gift-card-engine hardening — generateGiftCardCodePrefixed', () => {
  // ── 2. format `GC-XXXX-XXXX-XXXX-XXXX` hex uppercase ─────────────────────
  it('génère un code au format `GC-XXXX-XXXX-XXXX-XXXX` hex uppercase', () => {
    const code = generateGiftCardCodePrefixed();
    expect(code).toMatch(/^GC-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(code.startsWith('GC-')).toBe(true);
    expect(code.length).toBe(22); // 'GC-' + 16 hex + 3 dashes
  });

  // ── 3. entropie : 200 codes uniques ──────────────────────────────────────
  it('génère 200 codes uniques (no collision)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      codes.add(generateGiftCardCodePrefixed());
    }
    expect(codes.size).toBe(200);
  });
});

describe('gift-card-engine hardening — validateGiftCardCode', () => {
  // ── 4. validate format GC-* valide ───────────────────────────────────────
  it('accepte un code GC-* hex valide', () => {
    const result = validateGiftCardCode('GC-A1B2-C3D4-E5F6-7890');
    expect(result.ok).toBe(true);
  });

  // ── 5. validate format `XXXX-XXXX-XXXX-XXXX` rétro-compat (sans préfixe) ──
  it('accepte le format ambigu-safe rétro-compat (sans préfixe)', () => {
    // Caractères ambigu-safe : A-H, J, K, M, N, P-Z, 2-9.
    const result = validateGiftCardCode('ABCD-EFGH-JKMN-PQRS');
    expect(result.ok).toBe(true);
  });

  // ── 6. validate code invalide → invalid_format ───────────────────────────
  it('rejette un code malformé', () => {
    const result = validateGiftCardCode('FOO-BAR');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(GIFTCARD_ERROR_CODES.INVALID_FORMAT);
    }
  });

  // ── 7. validate empty / non-string → invalid_format ──────────────────────
  it('rejette string vide ou non-string', () => {
    const r1 = validateGiftCardCode('');
    expect(r1.ok).toBe(false);
    const r2 = validateGiftCardCode(null as unknown as string);
    expect(r2.ok).toBe(false);
  });
});

describe('gift-card-engine hardening — applyGiftCardCharge', () => {
  // ── 8. apply charge normale ──────────────────────────────────────────────
  it('balance 1000 - charge 300 → newBalance 700', () => {
    const r = applyGiftCardCharge(1000, 300);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.newBalance).toBe(700);
      expect(r.charged).toBe(300);
    }
  });

  // ── 9. apply charge = balance → 0 ────────────────────────────────────────
  it('balance 500 - charge 500 → newBalance 0 (carte vidée)', () => {
    const r = applyGiftCardCharge(500, 500);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.newBalance).toBe(0);
      expect(r.charged).toBe(500);
    }
  });

  // ── 10. refuse over-balance ──────────────────────────────────────────────
  it('balance 500 - charge 1000 → refuse amount_over_balance', () => {
    const r = applyGiftCardCharge(500, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(GIFTCARD_ERROR_CODES.AMOUNT_OVER_BALANCE);
    }
  });

  // ── 11. refuse charge <= 0 ───────────────────────────────────────────────
  it('charge <= 0 → invalid_amount', () => {
    const r1 = applyGiftCardCharge(1000, 0);
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.code).toBe(GIFTCARD_ERROR_CODES.INVALID_AMOUNT);
    }
    const r2 = applyGiftCardCharge(1000, -100);
    expect(r2.ok).toBe(false);
  });

  // ── 12. refuse balance négatif ───────────────────────────────────────────
  it('balance négatif → invalid_amount', () => {
    const r = applyGiftCardCharge(-100, 50);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(GIFTCARD_ERROR_CODES.INVALID_AMOUNT);
    }
  });
});

describe('gift-card-engine hardening — isGiftCardExpired', () => {
  // ── 13. expires_at futur → false ─────────────────────────────────────────
  it('expires_at = 2030 → false (pas expiré)', () => {
    const now = new Date('2026-05-26T00:00:00.000Z');
    expect(isGiftCardExpired({ expires_at: '2030-01-01T00:00:00.000Z' }, now)).toBe(
      false,
    );
  });

  // ── 14. expires_at passé → true ─────────────────────────────────────────
  it('expires_at = 2020 → true (expiré)', () => {
    const now = new Date('2026-05-26T00:00:00.000Z');
    expect(isGiftCardExpired({ expires_at: '2020-01-01T00:00:00.000Z' }, now)).toBe(
      true,
    );
  });

  // ── 15. expires_at = null → false (no-expiry) ───────────────────────────
  it('expires_at = null → false (pas d\'expiration)', () => {
    const now = new Date('2026-05-26T00:00:00.000Z');
    expect(isGiftCardExpired({ expires_at: null }, now)).toBe(false);
    expect(isGiftCardExpired({}, now)).toBe(false);
  });
});
