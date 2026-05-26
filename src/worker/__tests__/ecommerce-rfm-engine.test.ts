// ── ecommerce-rfm-engine.test.ts — Renforcement P2-3 (2026-05-26) ──────────
// Tests unitaires des helpers PURS ecommerce-rfm-engine.ts. 15+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  RFM_ERROR_CODES,
  RFM_SEGMENT_LABELS,
  computeQuintileScore,
  computeRfmScore,
  assignSegment,
  validateRfmInput,
} from '../lib/ecommerce-rfm-engine';

describe('RFM constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(RFM_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(RFM_SEGMENT_LABELS)).toBe(true);
  });

  it('RFM_SEGMENT_LABELS contient 12 segments industrie', () => {
    expect(RFM_SEGMENT_LABELS).toContain('champions');
    expect(RFM_SEGMENT_LABELS).toContain('loyal');
    expect(RFM_SEGMENT_LABELS).toContain('potential_loyalist');
    expect(RFM_SEGMENT_LABELS).toContain('new');
    expect(RFM_SEGMENT_LABELS).toContain('promising');
    expect(RFM_SEGMENT_LABELS).toContain('need_attention');
    expect(RFM_SEGMENT_LABELS).toContain('about_to_sleep');
    expect(RFM_SEGMENT_LABELS).toContain('at_risk');
    expect(RFM_SEGMENT_LABELS).toContain('cannot_lose');
    expect(RFM_SEGMENT_LABELS).toContain('hibernating');
    expect(RFM_SEGMENT_LABELS).toContain('lost');
    expect(RFM_SEGMENT_LABELS).toContain('unknown');
  });
});

describe('computeQuintileScore', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it('valeur top → quintile 5', () => {
    expect(computeQuintileScore(95, sorted)).toBe(5);
  });

  it('valeur bottom → quintile 1', () => {
    expect(computeQuintileScore(10, sorted)).toBe(1);
  });

  it('valeur médiane → quintile 3', () => {
    expect(computeQuintileScore(50, sorted)).toBe(3);
  });

  it('liste vide ⇒ 1 (garde défensive)', () => {
    expect(computeQuintileScore(50, [])).toBe(1);
  });

  it('valeur non finie ⇒ 1', () => {
    expect(computeQuintileScore(NaN, sorted)).toBe(1);
  });

  it('liste avec NaN filtrés', () => {
    expect(computeQuintileScore(50, [NaN, 10, 50, 90])).toBeGreaterThan(0);
  });

  it('au-dessus du max ⇒ 5', () => {
    expect(computeQuintileScore(999, sorted)).toBe(5);
  });
});

describe('computeRfmScore', () => {
  const sortedR = [1, 5, 10, 30, 60, 90, 180]; // jours depuis dernière commande
  const sortedF = [1, 2, 3, 5, 8, 13, 21]; // nb commandes
  const sortedM = [1000, 5000, 10000, 25000, 50000, 100000, 200000]; // cents

  it('client récent + fréquent + dépensier ⇒ scores élevés', () => {
    const r = computeRfmScore(
      { recency: 1, frequency: 21, monetary: 200000 },
      sortedR,
      sortedF,
      sortedM,
    );
    expect(r.r).toBeGreaterThanOrEqual(4);
    expect(r.f).toBeGreaterThanOrEqual(4);
    expect(r.m).toBeGreaterThanOrEqual(4);
  });

  it('client ancien + rare + petit ⇒ scores bas', () => {
    const r = computeRfmScore(
      { recency: 180, frequency: 1, monetary: 1000 },
      sortedR,
      sortedF,
      sortedM,
    );
    expect(r.r).toBeLessThanOrEqual(2);
    expect(r.f).toBeLessThanOrEqual(2);
    expect(r.m).toBeLessThanOrEqual(2);
  });

  it('combined = r*100 + f*10 + m (déterministe)', () => {
    const r = computeRfmScore(
      { recency: 30, frequency: 5, monetary: 25000 },
      sortedR,
      sortedF,
      sortedM,
    );
    expect(r.combined).toBe(r.r * 100 + r.f * 10 + r.m);
  });

  it('input invalide ⇒ scores fallback', () => {
    const r = computeRfmScore(
      { recency: NaN, frequency: NaN, monetary: NaN } as never,
      sortedR,
      sortedF,
      sortedM,
    );
    expect(r.r).toBeGreaterThanOrEqual(1);
    expect(r.f).toBeGreaterThanOrEqual(1);
    expect(r.m).toBeGreaterThanOrEqual(1);
  });
});

describe('assignSegment', () => {
  it('R=5 F=5 M=5 ⇒ champions', () => {
    expect(assignSegment({ r: 5, f: 5, m: 5 })).toBe('champions');
  });

  it('R=5 F=1 M=1 ⇒ new', () => {
    expect(assignSegment({ r: 5, f: 1, m: 1 })).toBe('new');
  });

  it('R=4 F=4 M=4 ⇒ loyal', () => {
    expect(assignSegment({ r: 4, f: 4, m: 4 })).toBe('loyal');
  });

  it('R=2 F=5 M=5 ⇒ cannot_lose (gros client en train de partir)', () => {
    expect(assignSegment({ r: 2, f: 5, m: 5 })).toBe('cannot_lose');
  });

  it('R=2 F=3 M=3 ⇒ at_risk', () => {
    expect(assignSegment({ r: 2, f: 3, m: 3 })).toBe('at_risk');
  });

  it('R=1 F=1 M=1 ⇒ lost', () => {
    expect(assignSegment({ r: 1, f: 1, m: 1 })).toBe('lost');
  });

  it('R=1 F=5 M=5 ⇒ cannot_lose', () => {
    expect(assignSegment({ r: 1, f: 5, m: 5 })).toBe('cannot_lose');
  });

  it('scores hors [1..5] clampés', () => {
    expect(assignSegment({ r: 10, f: 10, m: 10 })).toBe('champions');
    expect(assignSegment({ r: -1, f: -1, m: -1 })).toBe('lost');
  });

  it('input non-objet ⇒ unknown', () => {
    expect(assignSegment(null as never)).toBe('unknown');
  });

  it('scores NaN ⇒ unknown', () => {
    expect(assignSegment({ r: NaN, f: 3, m: 3 })).toBe('unknown');
  });
});

describe('validateRfmInput', () => {
  it('accepte input valide', () => {
    expect(validateRfmInput({ recency: 30, frequency: 5, monetary: 10000 }).ok).toBe(true);
  });

  it('rejette recency négative', () => {
    const r = validateRfmInput({ recency: -1, frequency: 5, monetary: 10000 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(RFM_ERROR_CODES.RECENCY_INVALID);
  });

  it('rejette frequency manquante', () => {
    const r = validateRfmInput({ recency: 30, monetary: 10000 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(RFM_ERROR_CODES.FREQUENCY_INVALID);
  });

  it('rejette monetary négatif', () => {
    const r = validateRfmInput({ recency: 30, frequency: 5, monetary: -100 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(RFM_ERROR_CODES.MONETARY_INVALID);
  });

  it('rejette input non-objet', () => {
    expect(validateRfmInput(null).ok).toBe(false);
    expect(validateRfmInput('abc').ok).toBe(false);
  });

  it('rejette NaN', () => {
    expect(validateRfmInput({ recency: NaN, frequency: 5, monetary: 10000 }).ok).toBe(false);
  });
});
