// ── Tests crypto.ts — hashPassword, verifyPassword, base32 ──
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, base32Encode, base32Decode } from '../crypto';

describe('hashPassword + verifyPassword', () => {
  it('hash et vérifie un mot de passe correctement', async () => {
    const password = 'Intralys2026!';
    const hash = await hashPassword(password);
    expect(hash).toContain('pbkdf2$');
    expect(hash.split('$')).toHaveLength(4);

    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it('rejette un mauvais mot de passe', async () => {
    const hash = await hashPassword('correct-password');
    const valid = await verifyPassword('wrong-password', hash);
    expect(valid).toBe(false);
  });

  it('produit des hashes différents pour le même password (salt aléatoire)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
  });

  it('rejette un hash invalide (format incorrect)', async () => {
    const valid = await verifyPassword('test', 'invalid-hash-format');
    expect(valid).toBe(false);
  });

  it('rejette un hash vide', async () => {
    const valid = await verifyPassword('test', '');
    expect(valid).toBe(false);
  });

  it('gère les mots de passe avec caractères spéciaux', async () => {
    const password = 'P@$$w0rd!#éàü';
    const hash = await hashPassword(password);
    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });
});

describe('base32Encode + base32Decode', () => {
  it('encode et décode un buffer correctement', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const encoded = base32Encode(original);
    expect(encoded).toBeTruthy();
    expect(typeof encoded).toBe('string');

    const decoded = base32Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('roundtrip sur des données aléatoires', () => {
    const original = crypto.getRandomValues(new Uint8Array(20));
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('gère un buffer vide', () => {
    const encoded = base32Encode(new Uint8Array(0));
    expect(encoded).toBe('');
  });
});
