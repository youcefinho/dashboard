// ── calls-outbound-engine.test.ts — Tests RENFORCEMENT calls-outbound-engine.ts
//
// Couvre validation requête outbound, shouldRecordCall opt-in CRTC, retry
// backoff exponentiel, call reason / jurisdiction whitelists.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  CALLS_OUTBOUND_ERROR_CODES,
  VALID_CALL_REASONS,
  VALID_JURISDICTIONS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_MAX_ATTEMPTS,
  computeRetrySchedule,
  validateOutboundRequest,
  shouldRecordCall,
  validateCallReason,
  validateJurisdiction,
} from '../lib/calls-outbound-engine';

describe('calls-outbound-engine — constants', () => {
  it('exposes call reason whitelist', () => {
    expect(VALID_CALL_REASONS).toContain('sales');
    expect(VALID_CALL_REASONS).toContain('support');
    expect(VALID_CALL_REASONS).toContain('followup');
    expect(VALID_CALL_REASONS).toContain('scheduled');
    expect(VALID_CALL_REASONS).toContain('other');
  });

  it('exposes jurisdiction whitelist', () => {
    expect(VALID_JURISDICTIONS).toContain('qc');
    expect(VALID_JURISDICTIONS).toContain('ca');
    expect(VALID_JURISDICTIONS).toContain('us');
    expect(VALID_JURISDICTIONS).toContain('eu');
  });

  it('exposes stable error codes', () => {
    expect(CALLS_OUTBOUND_ERROR_CODES.INVALID_TO).toBe('invalid_to');
    expect(CALLS_OUTBOUND_ERROR_CODES.CONSENT_REQUIRED).toBe('consent_required');
  });

  it('exposes retry policy caps', () => {
    expect(RETRY_BASE_DELAY_MS).toBe(1000);
    expect(RETRY_MAX_DELAY_MS).toBe(60_000);
    expect(RETRY_MAX_ATTEMPTS).toBe(5);
  });
});

describe('calls-outbound-engine — validateOutboundRequest', () => {
  it('accepts valid minimal request', () => {
    const r = validateOutboundRequest({ to: '+14165551234' });
    expect(r.ok).toBe(true);
  });

  it('rejects missing/invalid to', () => {
    expect(validateOutboundRequest({}).ok).toBe(false);
    expect(validateOutboundRequest({ to: '4165551234' }).ok).toBe(false);
    expect(validateOutboundRequest({ to: '+0123' }).ok).toBe(false);
  });

  it('rejects invalid from', () => {
    const r = validateOutboundRequest({ to: '+14165551234', from: '514-555-1234' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('from');
  });

  it('accepts valid optional from', () => {
    const r = validateOutboundRequest({ to: '+14165551234', from: '+15145551234' });
    expect(r.ok).toBe(true);
  });

  it('rejects leadId too long', () => {
    const r = validateOutboundRequest({
      to: '+14165551234',
      leadId: 'x'.repeat(65),
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CALLS_OUTBOUND_ERROR_CODES.INVALID_LEAD_ID);
  });

  it('requires consent when record=true (CRTC bi-party)', () => {
    const r = validateOutboundRequest({
      to: '+14165551234',
      record: true,
      consentObtained: false,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CALLS_OUTBOUND_ERROR_CODES.CONSENT_REQUIRED);
  });

  it('accepts record=true with consent=true', () => {
    const r = validateOutboundRequest({
      to: '+14165551234',
      record: true,
      consentObtained: true,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts record=false without consent', () => {
    const r = validateOutboundRequest({
      to: '+14165551234',
      record: false,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects invalid reason', () => {
    const r = validateOutboundRequest({ to: '+14165551234', reason: 'transfer-to-mars' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('reason');
  });

  it('accepts whitelisted reason', () => {
    expect(validateOutboundRequest({ to: '+14165551234', reason: 'sales' }).ok).toBe(true);
    expect(validateOutboundRequest({ to: '+14165551234', reason: 'support' }).ok).toBe(true);
  });

  it('rejects invalid jurisdiction', () => {
    const r = validateOutboundRequest({ to: '+14165551234', jurisdiction: 'mars' });
    expect(r.ok).toBe(false);
  });

  it('accepts whitelisted jurisdiction', () => {
    expect(validateOutboundRequest({ to: '+14165551234', jurisdiction: 'qc' }).ok).toBe(true);
    expect(validateOutboundRequest({ to: '+14165551234', jurisdiction: 'eu' }).ok).toBe(true);
  });
});

describe('calls-outbound-engine — shouldRecordCall', () => {
  it('returns false without consent regardless of jurisdiction', () => {
    expect(shouldRecordCall(false, 'qc')).toBe(false);
    expect(shouldRecordCall(undefined, 'us')).toBe(false);
    expect(shouldRecordCall(null, 'eu')).toBe(false);
  });

  it('returns true for consent=true + valid jurisdiction (CRTC strict cross)', () => {
    expect(shouldRecordCall(true, 'qc')).toBe(true);
    expect(shouldRecordCall(true, 'ca')).toBe(true);
    expect(shouldRecordCall(true, 'us')).toBe(true);
    expect(shouldRecordCall(true, 'eu')).toBe(true);
  });

  it('returns true for consent=true + missing jurisdiction (safe default)', () => {
    expect(shouldRecordCall(true, undefined)).toBe(true);
    expect(shouldRecordCall(true, null)).toBe(true);
  });

  it('returns false for unknown jurisdiction', () => {
    expect(shouldRecordCall(true, 'mars')).toBe(false);
  });

  it('rejects non-strict-true consent (1, "true", "yes")', () => {
    expect(shouldRecordCall(1, 'qc')).toBe(false);
    expect(shouldRecordCall('true', 'qc')).toBe(false);
    expect(shouldRecordCall('yes', 'qc')).toBe(false);
  });
});

describe('calls-outbound-engine — computeRetrySchedule', () => {
  it('returns exponential backoff for valid attempts', () => {
    expect(computeRetrySchedule(1).delayMs).toBe(1000); // 1s
    expect(computeRetrySchedule(2).delayMs).toBe(2000); // 2s
    expect(computeRetrySchedule(3).delayMs).toBe(4000); // 4s
    expect(computeRetrySchedule(4).delayMs).toBe(8000); // 8s
    expect(computeRetrySchedule(5).delayMs).toBe(16_000); // 16s
  });

  it('caps delay at RETRY_MAX_DELAY_MS', () => {
    const r = computeRetrySchedule(10);
    expect(r.delayMs).toBeLessThanOrEqual(RETRY_MAX_DELAY_MS);
  });

  it('flags finalAttempt at RETRY_MAX_ATTEMPTS', () => {
    expect(computeRetrySchedule(5).finalAttempt).toBe(true);
    expect(computeRetrySchedule(4).finalAttempt).toBe(false);
  });

  it('flags exhausted beyond RETRY_MAX_ATTEMPTS', () => {
    const r = computeRetrySchedule(6);
    expect(r.finalAttempt).toBe(true);
    expect(r.delayMs).toBe(0);
  });

  it('floors negative/non-integer attempts to 1', () => {
    expect(computeRetrySchedule(0).attempt).toBe(1);
    expect(computeRetrySchedule(-3).attempt).toBe(1);
    expect(computeRetrySchedule(1.7).attempt).toBe(1);
  });
});

describe('calls-outbound-engine — validators', () => {
  it('validateCallReason whitelist', () => {
    expect(validateCallReason('sales')).toBe(true);
    expect(validateCallReason('weird')).toBe(false);
    expect(validateCallReason('')).toBe(false);
    expect(validateCallReason(null)).toBe(false);
  });

  it('validateJurisdiction whitelist', () => {
    expect(validateJurisdiction('qc')).toBe(true);
    expect(validateJurisdiction('eu')).toBe(true);
    expect(validateJurisdiction('mars')).toBe(false);
    expect(validateJurisdiction(null)).toBe(false);
  });
});
