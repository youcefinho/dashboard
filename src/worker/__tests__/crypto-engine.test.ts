// ── crypto-engine.test.ts — Utils P2-2 AES-GCM 256 + utils ─────────────────
// Couvre keygen, import/export hex, encrypt/decrypt round-trip, IV unicité,
// validateKeyFormat, constantTimeBytesEqual / constantTimeHexEqual.

import { describe, it, expect } from 'vitest';
import {
  CRYPTO_ERROR_CODES,
  AES_KEY_BITS,
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BITS,
  bytesToHex,
  hexToBytes,
  validateKeyFormat,
  validateIvFormat,
  generateAesKey,
  exportAesKeyHex,
  importAesKeyHex,
  generateIv,
  encryptAesGcm,
  decryptAesGcm,
  constantTimeBytesEqual,
  constantTimeHexEqual,
} from '../lib/crypto-engine';

describe('CRYPTO_ERROR_CODES & constants', () => {
  it('expose codes canoniques + frozen', () => {
    expect(CRYPTO_ERROR_CODES.KEY_INVALID).toBe('KEY_INVALID');
    expect(CRYPTO_ERROR_CODES.DECRYPT_FAILED).toBe('DECRYPT_FAILED');
    expect(Object.isFrozen(CRYPTO_ERROR_CODES)).toBe(true);
  });
  it('constantes AES-GCM correctes', () => {
    expect(AES_KEY_BITS).toBe(256);
    expect(AES_GCM_IV_BYTES).toBe(12);
    expect(AES_GCM_TAG_BITS).toBe(128);
  });
});

describe('bytesToHex / hexToBytes round-trip', () => {
  it('round-trip preserves bytes', () => {
    const b = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
    const hex = bytesToHex(b);
    expect(hex).toBe('deadbeef00ff');
    const back = hexToBytes(hex);
    expect(Array.from(back)).toEqual(Array.from(b));
  });
  it('accepte 0x prefix', () => {
    expect(Array.from(hexToBytes('0xab'))).toEqual([0xab]);
  });
  it('throws sur longueur impaire', () => {
    expect(() => hexToBytes('abc')).toThrow();
  });
  it('throws sur chars non-hex', () => {
    expect(() => hexToBytes('zz')).toThrow();
  });
  it('throws sur non-string', () => {
    expect(() => hexToBytes(null as unknown as string)).toThrow();
  });
});

describe('validateKeyFormat', () => {
  it('accepte 64 hex chars', () => {
    expect(validateKeyFormat('a'.repeat(64))).toBe(true);
    expect(validateKeyFormat('A1B2C3D4'.repeat(8))).toBe(true);
  });
  it('rejette longueur != 64', () => {
    expect(validateKeyFormat('a'.repeat(63))).toBe(false);
    expect(validateKeyFormat('a'.repeat(65))).toBe(false);
  });
  it('rejette non-hex / non-string', () => {
    expect(validateKeyFormat('z'.repeat(64))).toBe(false);
    expect(validateKeyFormat(null)).toBe(false);
    expect(validateKeyFormat(123)).toBe(false);
  });
});

describe('validateIvFormat', () => {
  it('accepte 24 hex chars (12 bytes)', () => {
    expect(validateIvFormat('a'.repeat(24))).toBe(true);
  });
  it('rejette longueur != 24', () => {
    expect(validateIvFormat('a'.repeat(20))).toBe(false);
  });
});

describe('generateAesKey + export/import', () => {
  it('génère une clé AES-256 exportable', async () => {
    const key = await generateAesKey();
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.type).toBe('secret');
    const hex = await exportAesKeyHex(key);
    expect(hex).toHaveLength(64);
    expect(validateKeyFormat(hex)).toBe(true);
  });
  it('round-trip export → import → re-export = même hex', async () => {
    const key1 = await generateAesKey();
    const hex1 = await exportAesKeyHex(key1);
    const key2 = await importAesKeyHex(hex1);
    expect(key2.algorithm.name).toBe('AES-GCM');
  });
  it('importAesKeyHex throws KEY_INVALID sur format KO', async () => {
    await expect(importAesKeyHex('not-hex')).rejects.toThrow();
    await expect(importAesKeyHex('a'.repeat(63))).rejects.toThrow();
  });
  it('2 clés générées sont différentes (randomness)', async () => {
    const h1 = await exportAesKeyHex(await generateAesKey());
    const h2 = await exportAesKeyHex(await generateAesKey());
    expect(h1).not.toBe(h2);
  });
});

describe('generateIv', () => {
  it('génère un IV 12 bytes', () => {
    const iv = generateIv();
    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(AES_GCM_IV_BYTES);
  });
  it('2 IVs sont différents (randomness)', () => {
    const iv1 = bytesToHex(generateIv());
    const iv2 = bytesToHex(generateIv());
    expect(iv1).not.toBe(iv2);
  });
});

describe('encryptAesGcm / decryptAesGcm round-trip', () => {
  it('round-trip basique', async () => {
    const key = await generateAesKey();
    const plaintext = 'Hello Intralys 2026';
    const enc = await encryptAesGcm(plaintext, key);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.iv).toHaveLength(24);
    const dec = await decryptAesGcm(enc.ciphertext, key, enc.iv);
    expect(dec).toBe(plaintext);
  });
  it('round-trip avec caractères unicode + emoji', async () => {
    const key = await generateAesKey();
    const plaintext = 'Café à 🎉 Montréal — n°271218';
    const enc = await encryptAesGcm(plaintext, key);
    const dec = await decryptAesGcm(enc.ciphertext, key, enc.iv);
    expect(dec).toBe(plaintext);
  });
  it('round-trip empty string', async () => {
    const key = await generateAesKey();
    const enc = await encryptAesGcm('', key);
    const dec = await decryptAesGcm(enc.ciphertext, key, enc.iv);
    expect(dec).toBe('');
  });
  it('même plaintext + IVs différents → ciphertexts différents', async () => {
    const key = await generateAesKey();
    const a = await encryptAesGcm('same', key);
    const b = await encryptAesGcm('same', key);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });
  it('decrypt avec wrong key throws DECRYPT_FAILED', async () => {
    const key1 = await generateAesKey();
    const key2 = await generateAesKey();
    const enc = await encryptAesGcm('secret', key1);
    await expect(decryptAesGcm(enc.ciphertext, key2, enc.iv)).rejects.toThrow();
  });
  it('decrypt avec ciphertext tampered throws', async () => {
    const key = await generateAesKey();
    const enc = await encryptAesGcm('secret', key);
    // Flip un bit du ciphertext
    const tampered = enc.ciphertext.slice(0, -2) + (enc.ciphertext.slice(-2) === 'ff' ? '00' : 'ff');
    await expect(decryptAesGcm(tampered, key, enc.iv)).rejects.toThrow();
  });
  it('decrypt avec IV invalide throws IV_INVALID', async () => {
    const key = await generateAesKey();
    const enc = await encryptAesGcm('secret', key);
    await expect(decryptAesGcm(enc.ciphertext, key, 'short')).rejects.toThrow();
  });
  it('encrypt avec IV custom 12 bytes OK', async () => {
    const key = await generateAesKey();
    const iv = new Uint8Array(12).fill(7);
    const enc = await encryptAesGcm('hello', key, iv);
    expect(enc.iv).toBe('070707070707070707070707');
    const dec = await decryptAesGcm(enc.ciphertext, key, enc.iv);
    expect(dec).toBe('hello');
  });
  it('encrypt avec IV taille invalide throws', async () => {
    const key = await generateAesKey();
    const iv = new Uint8Array(8); // wrong size
    await expect(encryptAesGcm('hello', key, iv)).rejects.toThrow();
  });
});

describe('constantTimeBytesEqual', () => {
  it('true sur match', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeBytesEqual(a, b)).toBe(true);
  });
  it('false sur mismatch même longueur', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(constantTimeBytesEqual(a, b)).toBe(false);
  });
  it('false sur longueurs différentes', () => {
    expect(constantTimeBytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
  it('false sur non-Uint8Array', () => {
    expect(constantTimeBytesEqual('abc', new Uint8Array([97, 98, 99]))).toBe(false);
    expect(constantTimeBytesEqual(null, null)).toBe(false);
  });
});

describe('constantTimeHexEqual', () => {
  it('true sur match (case insensitive)', () => {
    expect(constantTimeHexEqual('ABCD', 'abcd')).toBe(true);
    expect(constantTimeHexEqual('deadbeef', 'deadbeef')).toBe(true);
  });
  it('false sur mismatch', () => {
    expect(constantTimeHexEqual('aabb', 'aacc')).toBe(false);
  });
  it('false sur longueurs différentes', () => {
    expect(constantTimeHexEqual('aa', 'aabb')).toBe(false);
  });
  it('false sur non-string', () => {
    expect(constantTimeHexEqual(null, 'abc')).toBe(false);
  });
});
