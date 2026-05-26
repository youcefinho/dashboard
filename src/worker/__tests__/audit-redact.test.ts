// ── audit-redact.test.ts — Sprint 23 (Manager-B) ────────────────────────
//
// Couvre `auditRedact()` (src/worker/lib/audit-redact.ts) — walk récursif
// avec whitelist STRICTE (SENSITIVE_KEYS_REGEX). Le test garantit qu'on
// ne fuit AUCUN secret dans audit_log.details, mais qu'on ne sur-redacte
// PAS les données opérationnelles (email/ip/name/phone → préservés).

import { describe, it, expect } from 'vitest';
import { auditRedact, SENSITIVE_KEYS_REGEX } from '../lib/audit-redact';

describe('S23 — auditRedact (whitelist stricte)', () => {
  it('redacte password mais pas email', () => {
    const { sanitized, redacted } = auditRedact({ password: 'x', email: 'a@b.c' });
    expect(redacted).toBe(true);
    expect(sanitized).toEqual({ password: '[REDACTED]', email: 'a@b.c' });
  });

  it('redacte token / *_secret / *_key / api_key / access_token / refresh_token', () => {
    const input = {
      token: 'abc',
      stripe_webhook_secret: 'whsec_xxx',
      stripe_secret_key: 'sk_test_xxx',
      api_key: 'k_xxx',
      access_token: 'at_xxx',
      refresh_token: 'rt_xxx',
      ciphertext: 'enc_xxx',
    };
    const { sanitized, redacted } = auditRedact(input);
    expect(redacted).toBe(true);
    const s = sanitized as Record<string, string>;
    expect(s.token).toBe('[REDACTED]');
    expect(s.stripe_webhook_secret).toBe('[REDACTED]');
    expect(s.stripe_secret_key).toBe('[REDACTED]');
    expect(s.api_key).toBe('[REDACTED]');
    expect(s.access_token).toBe('[REDACTED]');
    expect(s.refresh_token).toBe('[REDACTED]');
    expect(s.ciphertext).toBe('[REDACTED]');
  });

  it('nested : redact dans sous-objets, préserve les autres clés', () => {
    const input = { data: { api_key: 'k', name: 'foo', child: { secret: 's', label: 'l' } } };
    const { sanitized, redacted } = auditRedact(input);
    expect(redacted).toBe(true);
    expect(sanitized).toEqual({
      data: { api_key: '[REDACTED]', name: 'foo', child: { secret: '[REDACTED]', label: 'l' } },
    });
  });

  it('array : redact par élément, ordre préservé', () => {
    const input = [{ password: 'x' }, { name: 'y' }, { token: 'z', extra: 1 }];
    const { sanitized, redacted } = auditRedact(input);
    expect(redacted).toBe(true);
    expect(sanitized).toEqual([
      { password: '[REDACTED]' },
      { name: 'y' },
      { token: '[REDACTED]', extra: 1 },
    ]);
  });

  it('pas de PII de masse : email/ip/phone/name restent NON redacted', () => {
    const input = {
      email: 'a@b.c',
      ip: '127.0.0.1',
      phone: '5145551234',
      name: 'Jean',
      address: '123 rue',
    };
    const { sanitized, redacted } = auditRedact(input);
    expect(redacted).toBe(false);
    expect(sanitized).toEqual(input);
  });

  it('primitive (string / number / null) → renvoyé inchangé, redacted: false', () => {
    expect(auditRedact('plain')).toEqual({ sanitized: 'plain', redacted: false });
    expect(auditRedact(42)).toEqual({ sanitized: 42, redacted: false });
    expect(auditRedact(null)).toEqual({ sanitized: null, redacted: false });
    expect(auditRedact(undefined)).toEqual({ sanitized: undefined, redacted: false });
  });

  it('SENSITIVE_KEYS_REGEX matche bien les patterns documentés', () => {
    expect(SENSITIVE_KEYS_REGEX.test('password')).toBe(true);
    expect(SENSITIVE_KEYS_REGEX.test('password_hash')).toBe(true);
    expect(SENSITIVE_KEYS_REGEX.test('Token')).toBe(true); // case-insensitive
    expect(SENSITIVE_KEYS_REGEX.test('stripe_webhook_secret')).toBe(true);
    expect(SENSITIVE_KEYS_REGEX.test('hmac_key')).toBe(true);
    // Et ce qui NE doit PAS matcher :
    expect(SENSITIVE_KEYS_REGEX.test('email')).toBe(false);
    expect(SENSITIVE_KEYS_REGEX.test('ip')).toBe(false);
    expect(SENSITIVE_KEYS_REGEX.test('name')).toBe(false);
  });
});
