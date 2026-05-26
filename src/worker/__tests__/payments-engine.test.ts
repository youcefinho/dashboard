// ── Tests — Payments Engine (Sprint P0-4 renforcement, 2026-05-26) ──────────
//
// Tests PURS sur les helpers exportés par `lib/payments-engine.ts`.
// Zéro réseau, zéro mock D1, zéro appel Stripe live.
//
// Couverture (16 cas) :
//   - verifyStripeSignature       : 4 cas (valid HMAC OK / tampered KO /
//                                     expired KO / bad header KO)
//   - verifyStripeSignatureDetailed: 2 cas (codes stables : MALFORMED + EXPIRED)
//   - validatePaymentAmount       : 4 cas (exact OK / overpayment / underpayment /
//                                     non-int)
//   - parseStripeWebhook          : 4 cas (transition OK / refund OK /
//                                     dispute OK / unknown type KO)
//   - idempotencyKey              : 2 cas (deterministic / bad orderId)

import { describe, it, expect } from 'vitest';
import {
  verifyStripeSignature,
  verifyStripeSignatureDetailed,
  validatePaymentAmount,
  parseStripeWebhook,
  idempotencyKey,
  PAYMENT_ERROR_CODES,
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  HANDLED_STRIPE_EVENT_TYPES,
} from '../lib/payments-engine';

// ── Helper : signe un payload comme Stripe le ferait (pour les tests valid) ─

async function signStripe(payload: string, secret: string, timestampSec: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${timestampSec}.${payload}`),
  );
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    hex += b.toString(16).padStart(2, '0');
  }
  return `t=${timestampSec},v1=${hex}`;
}

// ════════════════════════════════════════════════════════════════════════════
// verifyStripeSignature (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('verifyStripeSignature — HMAC SHA-256 + tolerance', () => {
  const SECRET = 'whsec_test_dummy_secret_value';

  it('valid HMAC + ts récent → true', async () => {
    const payload = '{"type":"payment_intent.succeeded","data":{"object":{}}}';
    const now = Date.now();
    const tsSec = Math.floor(now / 1000);
    const header = await signStripe(payload, SECRET, tsSec);
    const ok = await verifyStripeSignature(payload, header, SECRET, now);
    expect(ok).toBe(true);
  });

  it('tampered payload → false', async () => {
    const payload = '{"type":"ok"}';
    const now = Date.now();
    const tsSec = Math.floor(now / 1000);
    const header = await signStripe(payload, SECRET, tsSec);
    const tamperedPayload = '{"type":"evil"}';
    const ok = await verifyStripeSignature(tamperedPayload, header, SECRET, now);
    expect(ok).toBe(false);
  });

  it('ts trop ancien (> tolerance) → false', async () => {
    const payload = '{"x":1}';
    const now = Date.now();
    const oldTs = Math.floor(now / 1000) - STRIPE_SIGNATURE_TOLERANCE_SECONDS - 60;
    const header = await signStripe(payload, SECRET, oldTs);
    const ok = await verifyStripeSignature(payload, header, SECRET, now);
    expect(ok).toBe(false);
  });

  it('header malformé → false', async () => {
    const ok1 = await verifyStripeSignature('{}', 'garbage', SECRET);
    expect(ok1).toBe(false);
    const ok2 = await verifyStripeSignature('{}', '', SECRET);
    expect(ok2).toBe(false);
    const ok3 = await verifyStripeSignature('{}', 't=,v1=', SECRET);
    expect(ok3).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// verifyStripeSignatureDetailed (2 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('verifyStripeSignatureDetailed — stable error codes', () => {
  const SECRET = 'whsec_test_secret_value_longer';

  it('header garbage → MALFORMED_SIGNATURE_HEADER', async () => {
    const r = await verifyStripeSignatureDetailed('{}', 'not-a-header', SECRET);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PAYMENT_ERROR_CODES.MALFORMED_SIGNATURE_HEADER);
  });

  it('ts ancien → SIGNATURE_EXPIRED', async () => {
    const payload = '{}';
    const now = Date.now();
    const oldTs = Math.floor(now / 1000) - STRIPE_SIGNATURE_TOLERANCE_SECONDS - 60;
    const header = await signStripe(payload, SECRET, oldTs);
    const r = await verifyStripeSignatureDetailed(payload, header, SECRET, now);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PAYMENT_ERROR_CODES.SIGNATURE_EXPIRED);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validatePaymentAmount (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validatePaymentAmount — exact match', () => {
  it('exact match → OK', () => {
    const r = validatePaymentAmount(2999, 2999);
    expect(r.ok).toBe(true);
  });

  it('overpayment → OVERPAYMENT + delta positif', () => {
    const r = validatePaymentAmount(2999, 3000);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PAYMENT_ERROR_CODES.OVERPAYMENT);
    expect(r.delta).toBe(1);
  });

  it('underpayment → UNDERPAYMENT + delta négatif', () => {
    const r = validatePaymentAmount(2999, 2998);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PAYMENT_ERROR_CODES.UNDERPAYMENT);
    expect(r.delta).toBe(-1);
  });

  it('non-integer → AMOUNT_MISMATCH', () => {
    const r1 = validatePaymentAmount(2999, 29.99);
    expect(r1.ok).toBe(false);
    expect(r1.code).toBe(PAYMENT_ERROR_CODES.AMOUNT_MISMATCH);
    const r2 = validatePaymentAmount(NaN, 100);
    expect(r2.ok).toBe(false);
    const r3 = validatePaymentAmount(-100, 100);
    expect(r3.ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// parseStripeWebhook (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('parseStripeWebhook — discriminated kind', () => {
  it('payment_intent.succeeded → kind=transition', () => {
    const r = parseStripeWebhook({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_123', amount: 2999 } },
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('transition');
    expect(r.type).toBe('payment_intent.succeeded');
  });

  it('charge.refunded → kind=refund', () => {
    const r = parseStripeWebhook({
      type: 'charge.refunded',
      data: { object: { id: 'ch_123', amount_refunded: 1000 } },
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('refund');
  });

  it('charge.dispute.created → kind=dispute', () => {
    const r = parseStripeWebhook({
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_123' } },
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('dispute');
  });

  it('event inconnu → UNKNOWN_EVENT_TYPE', () => {
    const r = parseStripeWebhook({
      type: 'invoice.weird_event_we_dont_handle',
      data: { object: {} },
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PAYMENT_ERROR_CODES.UNKNOWN_EVENT_TYPE);
    // empty payload
    const r2 = parseStripeWebhook(null);
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe(PAYMENT_ERROR_CODES.EMPTY_PAYLOAD);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// idempotencyKey (2 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('idempotencyKey — deterministic', () => {
  it('même orderId + attempt → même clé', () => {
    expect(idempotencyKey('ord_abc')).toBe('ord_abc:1');
    expect(idempotencyKey('ord_abc', 1)).toBe('ord_abc:1');
    expect(idempotencyKey('ord_abc', 2)).toBe('ord_abc:2');
    expect(idempotencyKey('ord_abc', 1)).toBe(idempotencyKey('ord_abc', 1));
  });

  it('bad orderId → "" (string vide)', () => {
    expect(idempotencyKey('')).toBe('');
    expect(idempotencyKey(null)).toBe('');
    expect(idempotencyKey(undefined)).toBe('');
    expect(idempotencyKey(123)).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HANDLED_STRIPE_EVENT_TYPES — contract sanity
// ════════════════════════════════════════════════════════════════════════════

describe('HANDLED_STRIPE_EVENT_TYPES — sanity', () => {
  it('contient au moins payment_intent.succeeded + charge.refunded', () => {
    expect(HANDLED_STRIPE_EVENT_TYPES).toContain('payment_intent.succeeded');
    expect(HANDLED_STRIPE_EVENT_TYPES).toContain('charge.refunded');
    expect(HANDLED_STRIPE_EVENT_TYPES.length).toBeGreaterThanOrEqual(5);
  });
});
