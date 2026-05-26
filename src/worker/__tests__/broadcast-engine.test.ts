// ── broadcast-engine.test.ts — Renforcement P1 (2026-05-26) ───────────────
// Tests unitaires des helpers PURS broadcast-engine. 20+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  BROADCAST_ERROR_CODES,
  VALID_CHANNELS,
  MAX_RECIPIENTS,
  MAX_THROTTLE_PER_MIN,
  MAX_SCHEDULED_AHEAD_DAYS,
  validateBroadcastInput,
  validateAbVariants,
  validateScheduledAt,
  computeThrottleSchedule,
  assignVariantBucket,
  validateRecipientCount,
} from '../lib/broadcast-engine';

describe('BROADCAST constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(BROADCAST_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_CHANNELS)).toBe(true);
  });

  it('VALID_CHANNELS contient email + sms', () => {
    expect(VALID_CHANNELS).toContain('email');
    expect(VALID_CHANNELS).toContain('sms');
    expect(VALID_CHANNELS.length).toBe(2);
  });

  it('Caps cohérents', () => {
    expect(MAX_RECIPIENTS).toBe(10000);
    expect(MAX_THROTTLE_PER_MIN).toBe(200);
    expect(MAX_SCHEDULED_AHEAD_DAYS).toBe(90);
  });
});

describe('validateBroadcastInput', () => {
  it('accepte minimum valide email', () => {
    const r = validateBroadcastInput({
      subject: 'Hello',
      body: '<p>Test</p>',
      channel: 'email',
    });
    expect(r.ok).toBe(true);
  });

  it('rejette subject vide email', () => {
    const r = validateBroadcastInput({
      subject: '',
      body: '<p>x</p>',
      channel: 'email',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.SUBJECT_REQUIRED);
  });

  it('subject vide accepté en SMS (label par défaut)', () => {
    const r = validateBroadcastInput({
      subject: '',
      body: 'Hi STOP au 555',
      channel: 'sms',
    });
    expect(r.ok).toBe(true);
  });

  it('rejette body vide', () => {
    const r = validateBroadcastInput({
      subject: 'x',
      body: '',
      channel: 'email',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.BODY_REQUIRED);
  });

  it('rejette channel inconnu', () => {
    const r = validateBroadcastInput({
      subject: 'x',
      body: 'x',
      channel: 'whatsapp',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.CHANNEL_INVALID);
  });

  it('rejette subject trop long', () => {
    const r = validateBroadcastInput({
      subject: 'x'.repeat(300),
      body: 'x',
      channel: 'email',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.SUBJECT_TOO_LONG);
  });

  it('rejette throttle négatif', () => {
    const r = validateBroadcastInput({
      subject: 'x',
      body: 'x',
      channel: 'email',
      throttle_per_min: -1,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.THROTTLE_INVALID);
  });

  it('rejette throttle au-dessus du cap', () => {
    const r = validateBroadcastInput({
      subject: 'x',
      body: 'x',
      channel: 'email',
      throttle_per_min: 500,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.THROTTLE_TOO_HIGH);
  });

  it('accepte throttle au cap exact', () => {
    const r = validateBroadcastInput({
      subject: 'x',
      body: 'x',
      channel: 'email',
      throttle_per_min: MAX_THROTTLE_PER_MIN,
    });
    expect(r.ok).toBe(true);
  });

  it('rejette null/undefined input', () => {
    expect(validateBroadcastInput(null as never).ok).toBe(false);
  });
});

describe('validateRecipientCount', () => {
  it('rejette 0', () => {
    const r = validateRecipientCount(0);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.RECIPIENTS_REQUIRED);
  });

  it('accepte 1', () => {
    expect(validateRecipientCount(1).ok).toBe(true);
  });

  it('accepte cap', () => {
    expect(validateRecipientCount(MAX_RECIPIENTS).ok).toBe(true);
  });

  it('rejette au-dessus du cap', () => {
    const r = validateRecipientCount(MAX_RECIPIENTS + 1);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.RECIPIENTS_TOO_MANY);
  });

  it('rejette NaN', () => {
    expect(validateRecipientCount(NaN).ok).toBe(false);
  });

  it('rejette négatif', () => {
    expect(validateRecipientCount(-5).ok).toBe(false);
  });
});

describe('validateAbVariants', () => {
  it('accepte 2 variantes 50/50', () => {
    const r = validateAbVariants([
      { split_pct: 50 },
      { split_pct: 50 },
    ]);
    expect(r.ok).toBe(true);
  });

  it('accepte 3 variantes 33/33/34', () => {
    const r = validateAbVariants([
      { split_pct: 33 },
      { split_pct: 33 },
      { split_pct: 34 },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejette somme != 100', () => {
    const r = validateAbVariants([
      { split_pct: 60 },
      { split_pct: 30 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.AB_SPLIT_NOT_100);
  });

  it('rejette tableau vide', () => {
    const r = validateAbVariants([]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.AB_VARIANTS_EMPTY);
  });

  it('rejette split_pct négatif', () => {
    const r = validateAbVariants([
      { split_pct: -10 },
      { split_pct: 110 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.AB_SPLIT_INVALID);
  });

  it('rejette split_pct > 100', () => {
    const r = validateAbVariants([{ split_pct: 150 }]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.AB_SPLIT_INVALID);
  });

  it('tolère arrondi flottant ±0.1', () => {
    const r = validateAbVariants([
      { split_pct: 33.33 },
      { split_pct: 33.33 },
      { split_pct: 33.34 },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('validateScheduledAt', () => {
  const now = 1700000000000; // ancre fixe (déterministe)

  it('absent = OK (envoi immédiat)', () => {
    expect(validateScheduledAt(null, now).ok).toBe(true);
    expect(validateScheduledAt(undefined, now).ok).toBe(true);
    expect(validateScheduledAt('', now).ok).toBe(true);
  });

  it('futur valide = OK', () => {
    const future = new Date(now + 3600 * 1000).toISOString();
    expect(validateScheduledAt(future, now).ok).toBe(true);
  });

  it('passé = rejet', () => {
    const past = new Date(now - 3600 * 1000).toISOString();
    const r = validateScheduledAt(past, now);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.SCHEDULED_AT_PAST);
  });

  it('format invalide = rejet', () => {
    const r = validateScheduledAt('not-a-date', now);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.SCHEDULED_AT_INVALID);
  });

  it('au-dessus de 90j = rejet', () => {
    const tooFar = new Date(
      now + (MAX_SCHEDULED_AHEAD_DAYS + 1) * 86400 * 1000,
    ).toISOString();
    const r = validateScheduledAt(tooFar, now);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(BROADCAST_ERROR_CODES.SCHEDULED_AT_TOO_FAR);
  });
});

describe('computeThrottleSchedule', () => {
  it('throttle 0 = 1 batch, 0 min', () => {
    const s = computeThrottleSchedule(100, 0);
    expect(s.batches).toBe(1);
    expect(s.durationMin).toBe(0);
  });

  it('100/50 = 2 batches, 1 min', () => {
    const s = computeThrottleSchedule(100, 50);
    expect(s.batches).toBe(2);
    expect(s.durationMin).toBe(1);
  });

  it('1000/100 = 10 batches, 9 min', () => {
    const s = computeThrottleSchedule(1000, 100);
    expect(s.batches).toBe(10);
    expect(s.durationMin).toBe(9);
  });

  it('total 0 = 0 batches', () => {
    expect(computeThrottleSchedule(0, 50).batches).toBe(0);
  });
});

describe('assignVariantBucket', () => {
  const variants = [
    { id: 'A', split_pct: 50 },
    { id: 'B', split_pct: 50 },
  ];

  it('même recipient → même variante (déterministe)', () => {
    const a1 = assignVariantBucket('lead-123', variants);
    const a2 = assignVariantBucket('lead-123', variants);
    expect(a1?.id).toBe(a2?.id);
  });

  it('1000 leads ~50/50 ±10%', () => {
    let countA = 0;
    let countB = 0;
    for (let i = 0; i < 1000; i++) {
      const v = assignVariantBucket(`lead-${i}`, variants);
      if (v?.id === 'A') countA++;
      else if (v?.id === 'B') countB++;
    }
    expect(countA + countB).toBe(1000);
    expect(Math.abs(countA - 500)).toBeLessThan(100);
  });

  it('variantes vides → null', () => {
    expect(assignVariantBucket('x', [])).toBe(null);
  });

  it('1 variante 100% → toujours elle', () => {
    const v = assignVariantBucket('x', [{ id: 'sole', split_pct: 100 }]);
    expect(v?.id).toBe('sole');
  });

  it('split 90/10 honore la proportion', () => {
    const v = [
      { id: 'A', split_pct: 90 },
      { id: 'B', split_pct: 10 },
    ];
    let countA = 0;
    for (let i = 0; i < 1000; i++) {
      if (assignVariantBucket(`lead-${i}`, v)?.id === 'A') countA++;
    }
    expect(countA).toBeGreaterThan(800);
    expect(countA).toBeLessThan(950);
  });

  it('recipient vide → première variante (fallback safe)', () => {
    expect(assignVariantBucket('', variants)?.id).toBe('A');
  });
});
