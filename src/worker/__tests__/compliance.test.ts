// ── Tests compliance.ts — tokens, footers, AMF ──
import { describe, it, expect } from 'vitest';
import {
  generateUnsubscribeToken,
  extractEmailFromToken,
  generateCaslFooter,
  generateAmfDisclaimer,
} from '../compliance';

describe('generateUnsubscribeToken + extractEmailFromToken', () => {
  it('génère un token et le décode correctement', () => {
    const email = 'sophie@email.com';
    const token = generateUnsubscribeToken(email, 'secret123');
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const extracted = extractEmailFromToken(token);
    expect(extracted).toBe(email);
  });

  it('génère des tokens différents avec des secrets différents', () => {
    const email = 'marc@email.com';
    const token1 = generateUnsubscribeToken(email, 'secret-a');
    const token2 = generateUnsubscribeToken(email, 'secret-b');
    expect(token1).not.toBe(token2);
  });

  it('le même email + secret donne le même token (déterministe)', () => {
    const email = 'test@test.com';
    const secret = 'same-secret';
    const token1 = generateUnsubscribeToken(email, secret);
    const token2 = generateUnsubscribeToken(email, secret);
    expect(token1).toBe(token2);
  });

  it('retourne null pour un token invalide', () => {
    expect(extractEmailFromToken('')).toBeNull();
    expect(extractEmailFromToken('invalid')).toBeNull();
  });

  it('gère les emails avec caractères spéciaux', () => {
    const email = 'jean-françois.dubé@courtier-qc.ca';
    const token = generateUnsubscribeToken(email, 'secret');
    const extracted = extractEmailFromToken(token);
    expect(extracted).toBe(email);
  });
});

describe('generateCaslFooter', () => {
  it('contient le lien de désabonnement', () => {
    const footer = generateCaslFooter('https://crm.intralys.com/api/unsubscribe/abc123');
    expect(footer).toContain('https://crm.intralys.com/api/unsubscribe/abc123');
  });

  it('contient la mention CASL', () => {
    const footer = generateCaslFooter('https://example.com/unsub');
    expect(footer).toContain('CASL');
    expect(footer).toContain('LCAP');
  });

  it('contient le lien Se désabonner', () => {
    const footer = generateCaslFooter('https://example.com/unsub');
    expect(footer).toContain('Se désabonner');
  });
});

describe('generateAmfDisclaimer', () => {
  it('contient le numéro de certificat', () => {
    const disclaimer = generateAmfDisclaimer('AMF-12345');
    expect(disclaimer).toContain('AMF-12345');
  });

  it('contient la mention AMF', () => {
    const disclaimer = generateAmfDisclaimer('CERT-999');
    expect(disclaimer).toContain('Mentions légales');
  });

  it('contient le disclaimer rendements', () => {
    const disclaimer = generateAmfDisclaimer('CERT-001');
    expect(disclaimer).toContain('rendements passés');
  });

  it('échappe le HTML dans le certificat (XSS)', () => {
    const disclaimer = generateAmfDisclaimer('<script>alert("xss")</script>');
    expect(disclaimer).not.toContain('<script>');
    expect(disclaimer).toContain('&lt;script&gt;');
  });
});
