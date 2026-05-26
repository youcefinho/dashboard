// ── shipments-engine tests — Sprint E5 hardening (2026-05-26) ──────────────-
//
// Tests PURS (zéro I/O, zéro D1) sur les helpers additifs du moteur
// expéditions : validateTrackingNumber, computeETA, validateShipmentInput,
// isValidProvider, isValidStatus, SHIPMENT_ERROR_CODES.

import { describe, it, expect } from 'vitest';
import {
  SHIPMENT_ERROR_CODES,
  VALID_PROVIDERS,
  VALID_STATUSES,
  isValidProvider,
  isValidStatus,
  validateTrackingNumber,
  computeETA,
  validateShipmentInput,
} from '../lib/shipments-engine';

describe('shipments-engine — constants', () => {
  it('expose les 7 codes erreur stables', () => {
    expect(SHIPMENT_ERROR_CODES.INVALID_PROVIDER).toBe('invalid_provider');
    expect(SHIPMENT_ERROR_CODES.INVALID_STATUS).toBe('invalid_status');
    expect(SHIPMENT_ERROR_CODES.INVALID_TRACKING).toBe('invalid_tracking');
    expect(SHIPMENT_ERROR_CODES.MISSING_TRACKING).toBe('missing_tracking');
    expect(SHIPMENT_ERROR_CODES.INVALID_ETA).toBe('invalid_eta');
    expect(SHIPMENT_ERROR_CODES.EMPTY_ITEMS).toBe('empty_items');
    expect(SHIPMENT_ERROR_CODES.INVALID_ITEM).toBe('invalid_item');
  });

  it('VALID_PROVIDERS contient les 7 transporteurs supportés', () => {
    expect(VALID_PROVIDERS).toContain('ups');
    expect(VALID_PROVIDERS).toContain('fedex');
    expect(VALID_PROVIDERS).toContain('canada_post');
    expect(VALID_PROVIDERS).toContain('dhl');
    expect(VALID_PROVIDERS).toContain('purolator');
    expect(VALID_PROVIDERS).toContain('usps');
    expect(VALID_PROVIDERS).toContain('generic');
    expect(VALID_PROVIDERS.length).toBe(7);
  });

  it('VALID_STATUSES contient les 5 états machine', () => {
    expect(VALID_STATUSES).toEqual([
      'preparing',
      'shipped',
      'in_transit',
      'delivered',
      'failed',
    ]);
  });
});

describe('shipments-engine — isValidProvider', () => {
  it('accepte les providers connus (case-insensitive)', () => {
    expect(isValidProvider('ups')).toBe(true);
    expect(isValidProvider('UPS')).toBe(true);
    expect(isValidProvider('FedEx')).toBe(true);
    expect(isValidProvider('canada_post')).toBe(true);
  });

  it('rejette les providers inconnus', () => {
    expect(isValidProvider('chronopost')).toBe(false);
    expect(isValidProvider('xyz')).toBe(false);
    expect(isValidProvider('')).toBe(false);
    expect(isValidProvider(null)).toBe(false);
    expect(isValidProvider(undefined)).toBe(false);
    expect(isValidProvider(42)).toBe(false);
  });
});

describe('shipments-engine — isValidStatus', () => {
  it('accepte les statuses connus', () => {
    expect(isValidStatus('preparing')).toBe(true);
    expect(isValidStatus('shipped')).toBe(true);
    expect(isValidStatus('in_transit')).toBe(true);
    expect(isValidStatus('delivered')).toBe(true);
    expect(isValidStatus('failed')).toBe(true);
  });

  it('rejette les statuses inconnus', () => {
    expect(isValidStatus('pending')).toBe(false);
    expect(isValidStatus('cancelled')).toBe(false);
    expect(isValidStatus('')).toBe(false);
    expect(isValidStatus(null)).toBe(false);
  });
});

describe('shipments-engine — validateTrackingNumber (UPS)', () => {
  it('accepte 1Z + 16 alphanum', () => {
    expect(validateTrackingNumber('ups', '1Z999AA10123456784')).toBe(true);
    expect(validateTrackingNumber('UPS', '1zabcdef1234567890')).toBe(true);
  });
  it('rejette les formats non-UPS', () => {
    expect(validateTrackingNumber('ups', '999AA1234567890123')).toBe(false);
    expect(validateTrackingNumber('ups', '1Z99')).toBe(false);
    expect(validateTrackingNumber('ups', 'abc')).toBe(false);
  });
});

describe('shipments-engine — validateTrackingNumber (FedEx)', () => {
  it('accepte 12 chiffres OU 15 chiffres', () => {
    expect(validateTrackingNumber('fedex', '123456789012')).toBe(true);
    expect(validateTrackingNumber('fedex', '123456789012345')).toBe(true);
  });
  it('rejette autres longueurs', () => {
    expect(validateTrackingNumber('fedex', '12345678901')).toBe(false); // 11
    expect(validateTrackingNumber('fedex', '1234567890123')).toBe(false); // 13
    expect(validateTrackingNumber('fedex', '1Z999AA10123456784')).toBe(false);
  });
});

describe('shipments-engine — validateTrackingNumber (Canada Post)', () => {
  it('accepte 16 chiffres numériques', () => {
    expect(validateTrackingNumber('canada_post', '1234567890123456')).toBe(true);
    expect(validateTrackingNumber('canada_post', '1234 5678 9012 3456')).toBe(
      true,
    );
  });
  it('accepte format international AB123456789CD', () => {
    expect(validateTrackingNumber('canada_post', 'AB123456789CD')).toBe(true);
  });
  it('rejette format hors spec', () => {
    expect(validateTrackingNumber('canada_post', '123')).toBe(false);
  });
});

describe('shipments-engine — validateTrackingNumber (DHL/USPS/Generic)', () => {
  it('DHL accepte 10 ou 11 chiffres', () => {
    expect(validateTrackingNumber('dhl', '1234567890')).toBe(true);
    expect(validateTrackingNumber('dhl', '12345678901')).toBe(true);
    expect(validateTrackingNumber('dhl', '123456789')).toBe(false);
  });
  it('USPS accepte 20-22 chiffres', () => {
    expect(validateTrackingNumber('usps', '12345678901234567890')).toBe(true);
    expect(validateTrackingNumber('usps', '1234567890123456789012')).toBe(true);
    expect(validateTrackingNumber('usps', '1234')).toBe(false);
  });
  it('Generic accepte 8+ alphanum', () => {
    expect(validateTrackingNumber('generic', 'ABCD12345')).toBe(true);
    expect(validateTrackingNumber('generic', 'a')).toBe(false);
  });
  it('rejette non-string', () => {
    expect(validateTrackingNumber('ups', null)).toBe(false);
    expect(validateTrackingNumber('ups', 12345)).toBe(false);
  });
});

describe('shipments-engine — computeETA', () => {
  it('ajoute N jours à shippedAt', () => {
    const start = new Date('2026-05-01T00:00:00Z');
    const eta = computeETA(start, 5);
    expect(eta?.toISOString()).toBe('2026-05-06T00:00:00.000Z');
  });
  it('accepte une string ISO', () => {
    const eta = computeETA('2026-05-01T00:00:00Z', 3);
    expect(eta?.toISOString()).toBe('2026-05-04T00:00:00.000Z');
  });
  it('rejette null / NaN / négatif / > 365', () => {
    expect(computeETA(null, 5)).toBeNull();
    expect(computeETA('not-a-date', 5)).toBeNull();
    expect(computeETA(new Date(), Number.NaN)).toBeNull();
    expect(computeETA(new Date(), -1)).toBeNull();
    expect(computeETA(new Date(), 400)).toBeNull();
  });
  it('round les jours fractionnaires', () => {
    const start = new Date('2026-05-01T00:00:00Z');
    const eta = computeETA(start, 2.7);
    expect(eta?.getUTCDate()).toBe(4); // 1 + round(2.7) = 4
  });
});

describe('shipments-engine — validateShipmentInput', () => {
  it('accepte un input vide', () => {
    expect(validateShipmentInput({}).ok).toBe(true);
  });
  it('rejette provider inconnu', () => {
    const r = validateShipmentInput({ provider: 'chronopost' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(SHIPMENT_ERROR_CODES.INVALID_PROVIDER);
  });
  it('rejette status inconnu', () => {
    const r = validateShipmentInput({ status: 'pending' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(SHIPMENT_ERROR_CODES.INVALID_STATUS);
  });
  it('rejette tracking number mal formé pour UPS', () => {
    const r = validateShipmentInput({
      provider: 'ups',
      tracking_number: 'bogus',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(SHIPMENT_ERROR_CODES.INVALID_TRACKING);
  });
  it('accepte tracking UPS valide', () => {
    const r = validateShipmentInput({
      provider: 'ups',
      tracking_number: '1Z999AA10123456784',
    });
    expect(r.ok).toBe(true);
  });
  it('rejette items vide', () => {
    const r = validateShipmentInput({ items: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(SHIPMENT_ERROR_CODES.EMPTY_ITEMS);
  });
  it('rejette ligne sans order_item_id', () => {
    const r = validateShipmentInput({
      items: [{ order_item_id: '', quantity: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(SHIPMENT_ERROR_CODES.INVALID_ITEM);
  });
  it('rejette quantity ≤ 0', () => {
    const r = validateShipmentInput({
      items: [{ order_item_id: 'oi_1', quantity: 0 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(SHIPMENT_ERROR_CODES.INVALID_ITEM);
  });
  it('accepte items valides', () => {
    const r = validateShipmentInput({
      items: [{ order_item_id: 'oi_1', quantity: 2 }],
    });
    expect(r.ok).toBe(true);
  });
});
