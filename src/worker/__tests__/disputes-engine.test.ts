// ── disputes-engine tests — Sprint E6 M2 hardening (2026-05-26) ────────────-
//
// Tests PURS sur les helpers dispute : isWithinEvidenceWindow,
// validateEvidenceFields, parseStripeDispute, isValidDisputeStatus.

import { describe, it, expect } from 'vitest';
import {
  DISPUTE_ERROR_CODES,
  DISPUTE_STATUSES,
  EVIDENCE_WINDOW_DAYS,
  EVIDENCE_REQUIRED_FIELDS,
  isValidDisputeStatus,
  isWithinEvidenceWindow,
  validateEvidenceFields,
  parseStripeDispute,
} from '../lib/disputes-engine';

describe('disputes-engine — constants', () => {
  it('expose les 6 codes erreur stables', () => {
    expect(DISPUTE_ERROR_CODES.UNKNOWN_EVENT).toBe('unknown_event');
    expect(DISPUTE_ERROR_CODES.MISSING_DATA).toBe('missing_data');
    expect(DISPUTE_ERROR_CODES.EVIDENCE_WINDOW_EXPIRED).toBe(
      'evidence_window_expired',
    );
    expect(DISPUTE_ERROR_CODES.EVIDENCE_INCOMPLETE).toBe(
      'evidence_incomplete',
    );
    expect(DISPUTE_ERROR_CODES.INVALID_STATUS).toBe('invalid_status');
    expect(DISPUTE_ERROR_CODES.INVALID_AMOUNT).toBe('invalid_amount');
  });

  it('DISPUTE_STATUSES contient 10 états Stripe-aligned', () => {
    expect(DISPUTE_STATUSES.length).toBe(10);
    expect(DISPUTE_STATUSES).toContain('open');
    expect(DISPUTE_STATUSES).toContain('won');
    expect(DISPUTE_STATUSES).toContain('lost');
    expect(DISPUTE_STATUSES).toContain('closed');
  });

  it('EVIDENCE_WINDOW_DAYS = 7 (default safe Intralys)', () => {
    expect(EVIDENCE_WINDOW_DAYS).toBe(7);
  });
});

describe('disputes-engine — isValidDisputeStatus', () => {
  it('accepte statuses connus', () => {
    expect(isValidDisputeStatus('open')).toBe(true);
    expect(isValidDisputeStatus('won')).toBe(true);
    expect(isValidDisputeStatus('charge_refunded')).toBe(true);
  });
  it('rejette statuses inconnus', () => {
    expect(isValidDisputeStatus('pending')).toBe(false);
    expect(isValidDisputeStatus('')).toBe(false);
    expect(isValidDisputeStatus(null)).toBe(false);
  });
});

describe('disputes-engine — isWithinEvidenceWindow', () => {
  const created = new Date('2026-05-01T00:00:00Z');

  it('accepte le jour même', () => {
    expect(isWithinEvidenceWindow(created, created)).toBe(true);
  });
  it('accepte à 6 jours', () => {
    expect(
      isWithinEvidenceWindow(created, new Date('2026-05-07T00:00:00Z')),
    ).toBe(true);
  });
  it('accepte à 7 jours (limite)', () => {
    expect(
      isWithinEvidenceWindow(created, new Date('2026-05-08T00:00:00Z')),
    ).toBe(true);
  });
  it('rejette à 8 jours (hors fenêtre)', () => {
    expect(
      isWithinEvidenceWindow(created, new Date('2026-05-09T00:00:00Z')),
    ).toBe(false);
  });
  it('rejette futur', () => {
    expect(
      isWithinEvidenceWindow(
        new Date('2026-06-01T00:00:00Z'),
        new Date('2026-05-01T00:00:00Z'),
      ),
    ).toBe(false);
  });
  it('rejette dates invalides', () => {
    expect(isWithinEvidenceWindow(null)).toBe(false);
    expect(isWithinEvidenceWindow('not-a-date')).toBe(false);
  });
  it('accepte window custom (21j Stripe par défaut)', () => {
    expect(
      isWithinEvidenceWindow(created, new Date('2026-05-21T00:00:00Z'), 21),
    ).toBe(true);
  });
});

describe('disputes-engine — validateEvidenceFields', () => {
  it('rejette null/undefined', () => {
    const r = validateEvidenceFields(null);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(DISPUTE_ERROR_CODES.EVIDENCE_INCOMPLETE);
    expect(r.missing).toEqual([...EVIDENCE_REQUIRED_FIELDS]);
  });

  it('liste champs manquants', () => {
    const r = validateEvidenceFields({
      customer_email_address: 'a@b.com',
      // customer_name manquant
      // product_description manquant
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('customer_name');
    expect(r.missing).toContain('product_description');
  });

  it('exige au moins UN of service_documentation/receipt', () => {
    const r = validateEvidenceFields({
      customer_email_address: 'a@b.com',
      customer_name: 'John',
      product_description: 'Widget',
      // ni service_documentation ni receipt
    });
    expect(r.ok).toBe(false);
    expect(r.missing?.some((m) => m.startsWith('one_of:'))).toBe(true);
  });

  it('accepte evidence complet avec receipt', () => {
    const r = validateEvidenceFields({
      customer_email_address: 'a@b.com',
      customer_name: 'John',
      product_description: 'Widget',
      receipt: 'rcpt_123',
    });
    expect(r.ok).toBe(true);
  });

  it('accepte evidence complet avec service_documentation', () => {
    const r = validateEvidenceFields({
      customer_email_address: 'a@b.com',
      customer_name: 'John',
      product_description: 'Widget',
      service_documentation: 'doc_abc',
    });
    expect(r.ok).toBe(true);
  });

  it('rejette strings vides ou whitespace-only', () => {
    const r = validateEvidenceFields({
      customer_email_address: '   ',
      customer_name: '',
      product_description: 'Widget',
      receipt: 'rcpt_1',
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('customer_email_address');
    expect(r.missing).toContain('customer_name');
  });
});

describe('disputes-engine — parseStripeDispute', () => {
  const baseDispute = {
    id: 'dp_test_123',
    amount: 5000,
    currency: 'cad',
    status: 'needs_response',
    reason: 'fraudulent',
    charge: 'ch_test_456',
    created: 1700000000,
  };

  it('charge.dispute.created → kind=created', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.created',
      data: { object: baseDispute },
    });
    expect('kind' in r).toBe(true);
    if ('kind' in r) {
      expect(r.kind).toBe('created');
      expect(r.data.dispute_ref).toBe('dp_test_123');
      expect(r.data.amount_cents).toBe(5000);
      expect(r.data.currency).toBe('CAD');
      expect(r.data.charge_ref).toBe('ch_test_456');
      expect(r.data.created_at).toBe(1700000000);
    }
  });

  it('charge.dispute.funds_withdrawn → kind=funds_withdrawn', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.funds_withdrawn',
      data: { object: baseDispute },
    });
    expect('kind' in r && r.kind).toBe('funds_withdrawn');
  });

  it('charge.dispute.closed + status=won → kind=won', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.closed',
      data: { object: { ...baseDispute, status: 'won' } },
    });
    expect('kind' in r && r.kind).toBe('won');
  });

  it('charge.dispute.closed + status=lost → kind=lost', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.closed',
      data: { object: { ...baseDispute, status: 'lost' } },
    });
    expect('kind' in r && r.kind).toBe('lost');
  });

  it('charge.dispute.closed sans status précis → kind=closed', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.closed',
      data: { object: { ...baseDispute, status: 'closed' } },
    });
    expect('kind' in r && r.kind).toBe('closed');
  });

  it('charge.dispute.updated → kind=updated', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.updated',
      data: { object: baseDispute },
    });
    expect('kind' in r && r.kind).toBe('updated');
  });

  it('type inconnu → erreur unknown_event', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.exploded',
      data: { object: baseDispute },
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.code).toBe(DISPUTE_ERROR_CODES.UNKNOWN_EVENT);
  });

  it('event sans data.object → erreur missing_data', () => {
    const r = parseStripeDispute({ type: 'charge.dispute.created' });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.code).toBe(DISPUTE_ERROR_CODES.MISSING_DATA);
  });

  it('dispute sans id → erreur missing_data', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.created',
      data: { object: { ...baseDispute, id: undefined } },
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.code).toBe(DISPUTE_ERROR_CODES.MISSING_DATA);
  });

  it('event null → erreur unknown_event', () => {
    const r = parseStripeDispute(null);
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.code).toBe(DISPUTE_ERROR_CODES.UNKNOWN_EVENT);
  });

  it('arrondit amount fractionnaire', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.created',
      data: { object: { ...baseDispute, amount: 5000.7 } },
    });
    if ('kind' in r) expect(r.data.amount_cents).toBe(5001);
  });

  it('clamp amount négatif à 0', () => {
    const r = parseStripeDispute({
      type: 'charge.dispute.created',
      data: { object: { ...baseDispute, amount: -100 } },
    });
    if ('kind' in r) expect(r.data.amount_cents).toBe(0);
  });
});
