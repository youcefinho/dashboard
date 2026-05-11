// ── Tests helpers.ts — sanitize, extractToken, json ──
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeInput, extractToken } from '../helpers';

describe('sanitizeHtml', () => {
  it('échappe les caractères HTML dangereux', () => {
    expect(sanitizeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('échappe les apostrophes', () => {
    expect(sanitizeHtml("l'ami")).toBe("l&#39;ami");
  });

  it('échappe les ampersands', () => {
    expect(sanitizeHtml('A & B')).toBe('A &amp; B');
  });

  it('gère une chaîne vide', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('gère du texte normal sans changement', () => {
    expect(sanitizeHtml('Bonjour Mathis')).toBe('Bonjour Mathis');
  });
});

describe('sanitizeInput', () => {
  it('retourne vide pour null/undefined', () => {
    expect(sanitizeInput(null)).toBe('');
    expect(sanitizeInput(undefined)).toBe('');
    expect(sanitizeInput('')).toBe('');
  });

  it('trim les espaces', () => {
    expect(sanitizeInput('  Bonjour  ')).toBe('Bonjour');
  });

  it('tronque au maxLen', () => {
    const long = 'A'.repeat(1000);
    expect(sanitizeInput(long, 100)).toHaveLength(100);
  });

  it('utilise le maxLen par défaut (500)', () => {
    const long = 'B'.repeat(600);
    expect(sanitizeInput(long)).toHaveLength(500);
  });

  it('retourne la chaîne complète si sous maxLen', () => {
    expect(sanitizeInput('Court', 500)).toBe('Court');
  });
});

describe('extractToken', () => {
  it('extrait le token Bearer valide', () => {
    const req = new Request('http://localhost', {
      headers: { Authorization: 'Bearer abc123xyz890test' },
    });
    expect(extractToken(req)).toBe('abc123xyz890test');
  });

  it('retourne null sans header Authorization', () => {
    const req = new Request('http://localhost');
    expect(extractToken(req)).toBeNull();
  });

  it('retourne null si pas Bearer', () => {
    const req = new Request('http://localhost', {
      headers: { Authorization: 'Basic abc123' },
    });
    expect(extractToken(req)).toBeNull();
  });

  it('retourne null si token trop court (<10 chars)', () => {
    const req = new Request('http://localhost', {
      headers: { Authorization: 'Bearer short' },
    });
    expect(extractToken(req)).toBeNull();
  });

  it('trim le token', () => {
    const req = new Request('http://localhost', {
      headers: { Authorization: 'Bearer   abc123xyz890test   ' },
    });
    expect(extractToken(req)).toBe('abc123xyz890test');
  });
});
