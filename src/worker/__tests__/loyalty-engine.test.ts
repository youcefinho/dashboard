// ── Tests — Loyalty Engine (Sprint 38 Phase C — Agent C2) ─────────────────
//
// Tests PURS sur les helpers exportés par lib/loyalty-engine.ts (A2).
// Aucun réseau, aucun mock D1 (les fonctions ciblées ne font pas d'I/O).
//
// Couvre les 7 cas du contrat Sprint 38 §C2 :
//   1. computeEarnedPoints basic
//   2. computeEarnedPoints avec tier multiplier
//   3. computeRedeemValueCents
//   4. deriveTier transitions (bronze / silver / gold)
//   5. pickTierMultiplier fallback (benefits null → 1.0)
//   6. pickTierMultiplier gold (parse JSON valide → multiplier)
//   7. computeExpiryDate (null + +365 jours)

import { describe, it, expect } from 'vitest';
import {
  computeEarnedPoints,
  computeRedeemValueCents,
  deriveTier,
  pickTierMultiplier,
  computeExpiryDate,
} from '../lib/loyalty-engine';

// Defaults câblés dans deriveTier : { bronze: 0, silver: 500, gold: 2000 }.
// `null` → fallback DEFAULT_TIER_THRESHOLDS interne (cf. A2).
const defaults = null as Record<string, number> | null;

describe('loyalty-engine — helpers purs (Agent C2)', () => {
  // ── 1. computeEarnedPoints basic ────────────────────────────────────────
  it('computeEarnedPoints basic : 100$ × 1pt/$ × 1.0 → 100 points', () => {
    // subtotalCents = 10000 → 100$
    // earnRate = 1 pt/$, tierMultiplier = 1.0 → 100 * 1 = 100 points
    const points = computeEarnedPoints(10000, 1, 1.0);
    expect(points).toBe(100);
  });

  // ── 2. computeEarnedPoints avec tier multiplier ─────────────────────────
  it('computeEarnedPoints avec tier multiplier : 100$ × 1pt/$ × 2.0 → 200 points', () => {
    const points = computeEarnedPoints(10000, 1, 2.0);
    expect(points).toBe(200);
  });

  // ── 3. computeRedeemValueCents ──────────────────────────────────────────
  it('computeRedeemValueCents : 500 points × 1 cent/pt → 500 cents', () => {
    const cents = computeRedeemValueCents(500, 1);
    expect(cents).toBe(500);
  });

  // ── 4. deriveTier transitions ───────────────────────────────────────────
  it('deriveTier transitions : 0/600/2500 → bronze/silver/gold (defaults)', () => {
    // Defaults : bronze=0, silver=500, gold=2000.
    expect(deriveTier(0, defaults)).toBe('bronze');
    expect(deriveTier(600, defaults)).toBe('silver');
    expect(deriveTier(2500, defaults)).toBe('gold');
  });

  // ── 5. pickTierMultiplier fallback (benefits null) ──────────────────────
  it('pickTierMultiplier fallback : (bronze, null) → 1.0', () => {
    const mult = pickTierMultiplier('bronze', null);
    expect(mult).toBe(1.0);
  });

  // ── 6. pickTierMultiplier gold ──────────────────────────────────────────
  it('pickTierMultiplier gold : parse benefits JSON → 2.0', () => {
    const benefitsJson = '{"gold":{"earn_multiplier":2.0}}';
    const mult = pickTierMultiplier('gold', benefitsJson);
    expect(mult).toBe(2.0);
  });

  // ── 7. computeExpiryDate ────────────────────────────────────────────────
  it('computeExpiryDate : null expiryDays → null', () => {
    const base = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const result = computeExpiryDate(base, null);
    expect(result).toBeNull();
  });

  it('computeExpiryDate : +365 jours → ISO string déplacé', () => {
    const base = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const result = computeExpiryDate(base, 365);
    expect(result).toBe(new Date('2027-01-01T00:00:00.000Z').toISOString());
    // Sanity : c'est bien un ISO string parsable.
    expect(typeof result).toBe('string');
    expect(Number.isNaN(new Date(result as string).getTime())).toBe(false);
  });
});
