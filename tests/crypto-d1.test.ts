// ── tests/crypto-d1.test.ts — Sprint 92 (seq187) ────────────────────────────
// Tests unitaires du chiffrement PII at rest (AES-GCM 256 + HMAC blind search).
// Couvre : crypto-engine, field-encryption-engine, crypto-search.

import { describe, it, expect } from 'vitest';
import {
  generateAesKey,
  exportAesKeyHex,
  importAesKeyHex,
  encryptAesGcm,
  decryptAesGcm,
  generateIv,
  validateKeyFormat,
  bytesToHex,
} from '../src/worker/lib/crypto-engine';
import {
  encryptField,
  decryptField,
  isEncrypted,
  encryptLeadPii,
  decryptLeadPii,
  rotateFieldKey,
  ENCRYPTED_FIELD_PREFIX,
} from '../src/worker/lib/field-encryption-engine';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeKeyHex(): Promise<string> {
  const key = await generateAesKey();
  return exportAesKeyHex(key);
}

// ── Tests AES-GCM bas niveau (crypto-engine) ─────────────────────────────────

describe('crypto-engine — AES-GCM 256', () => {
  it('génère une clé 256 bits valide (64 chars hex)', async () => {
    const key = await generateAesKey();
    const hex = await exportAesKeyHex(key);
    expect(hex).toHaveLength(64);
    expect(validateKeyFormat(hex)).toBe(true);
  });

  it('import/export roundtrip est stable', async () => {
    const keyHex = await makeKeyHex();
    const imported = await importAesKeyHex(keyHex);
    expect(imported).toBeTruthy();
    expect(imported.algorithm).toMatchObject({ name: 'AES-GCM' });
  });

  it('encrypt → decrypt roundtrip préserve le plaintext', async () => {
    const key = await generateAesKey();
    const plaintext = 'Bonjour Québec! 🍁';
    const { ciphertext, iv } = await encryptAesGcm(plaintext, key);
    const decrypted = await decryptAesGcm(ciphertext, key, iv);
    expect(decrypted).toBe(plaintext);
  });

  it('IV unique par appel (même plaintext → ciphertext différent)', async () => {
    const key = await generateAesKey();
    const plaintext = 'test@intralys.com';
    const result1 = await encryptAesGcm(plaintext, key);
    const result2 = await encryptAesGcm(plaintext, key);
    expect(result1.iv).not.toBe(result2.iv);
    expect(result1.ciphertext).not.toBe(result2.ciphertext);
  });

  it('génère un IV de 12 bytes (24 hex chars)', () => {
    const iv = generateIv();
    expect(iv).toHaveLength(12);
    const hex = bytesToHex(iv);
    expect(hex).toHaveLength(24);
  });

  it('decrypt échoue avec une mauvaise clé', async () => {
    const key1 = await generateAesKey();
    const key2 = await generateAesKey();
    const { ciphertext, iv } = await encryptAesGcm('secret', key1);
    await expect(decryptAesGcm(ciphertext, key2, iv)).rejects.toThrow();
  });
});

// ── Tests field-encryption (wrapper haut niveau) ─────────────────────────────

describe('field-encryption-engine — chiffrement champs PII', () => {
  it('encryptField retourne un format enc:<iv>:<ciphertext>', async () => {
    const keyHex = await makeKeyHex();
    const encrypted = await encryptField('test@example.com', keyHex);
    expect(encrypted.startsWith(ENCRYPTED_FIELD_PREFIX)).toBe(true);
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it('decryptField retrouve le plaintext original', async () => {
    const keyHex = await makeKeyHex();
    const original = 'rochdi@intralys.com';
    const encrypted = await encryptField(original, keyHex);
    const decrypted = await decryptField(encrypted, keyHex);
    expect(decrypted).toBe(original);
  });

  it('chiffrement Unicode (accents, émojis québécois)', async () => {
    const keyHex = await makeKeyHex();
    const original = 'André Côté-Légaré 🏒🍁 je suis icitte';
    const encrypted = await encryptField(original, keyHex);
    const decrypted = await decryptField(encrypted, keyHex);
    expect(decrypted).toBe(original);
  });

  it('chaîne vide → pas de chiffrement (optimisation)', async () => {
    const keyHex = await makeKeyHex();
    const encrypted = await encryptField('', keyHex);
    expect(encrypted).toBe('');
    expect(isEncrypted(encrypted)).toBe(false);
  });

  it('idempotence : déjà chiffré → retourne tel quel', async () => {
    const keyHex = await makeKeyHex();
    const encrypted = await encryptField('test@test.com', keyHex);
    const doubleEncrypted = await encryptField(encrypted, keyHex);
    expect(doubleEncrypted).toBe(encrypted);
  });

  it('fail-safe : decryptField sur plaintext non-chiffré → retourne tel quel', async () => {
    const keyHex = await makeKeyHex();
    const plaintext = 'ceci-est-du-texte-en-clair';
    const result = await decryptField(plaintext, keyHex);
    expect(result).toBe(plaintext);
  });

  it('encryptLeadPii chiffre les bons champs (email, phone, notes, message)', async () => {
    const keyHex = await makeKeyHex();
    const lead = {
      id: 'lead-1',
      name: 'Marie Tremblay',
      email: 'marie@example.com',
      phone: '+15145551234',
      notes: 'Intéressée par un condo',
      message: 'Bonjour, je voudrais...',
      status: 'new',
      source: 'web',
    };
    const encrypted = await encryptLeadPii(lead, keyHex);

    // Les champs PII sont chiffrés
    expect(isEncrypted(encrypted.email as string)).toBe(true);
    expect(isEncrypted(encrypted.phone as string)).toBe(true);
    expect(isEncrypted(encrypted.notes as string)).toBe(true);
    expect(isEncrypted(encrypted.message as string)).toBe(true);

    // Les champs non-PII restent en clair
    expect(encrypted.id).toBe('lead-1');
    expect(encrypted.name).toBe('Marie Tremblay');
    expect(encrypted.status).toBe('new');
    expect(encrypted.source).toBe('web');
  });

  it('decryptLeadPii → roundtrip complet avec encryptLeadPii', async () => {
    const keyHex = await makeKeyHex();
    const lead = {
      email: 'test@intralys.com',
      phone: '+14185559876',
      notes: 'Note secrète ici',
      message: 'Message initial',
    };
    const encrypted = await encryptLeadPii(lead, keyHex);
    const decrypted = await decryptLeadPii(encrypted, keyHex);
    expect(decrypted.email).toBe(lead.email);
    expect(decrypted.phone).toBe(lead.phone);
    expect(decrypted.notes).toBe(lead.notes);
    expect(decrypted.message).toBe(lead.message);
  });

  it('rotation de clé : rotateFieldKey rechiffre correctement', async () => {
    const oldKeyHex = await makeKeyHex();
    const newKeyHex = await makeKeyHex();
    const original = 'donnée-sensible@example.com';

    const encrypted = await encryptField(original, oldKeyHex);
    const rotated = await rotateFieldKey(encrypted, oldKeyHex, newKeyHex);

    // La valeur re-chiffrée avec la nouvelle clé
    expect(isEncrypted(rotated)).toBe(true);
    expect(rotated).not.toBe(encrypted); // Différent car clé + IV différents

    // Déchiffrable avec la nouvelle clé
    const decrypted = await decryptField(rotated, newKeyHex);
    expect(decrypted).toBe(original);

    // Plus déchiffrable avec l'ancienne clé (le test vérifie le rejet)
    await expect(decryptField(rotated, oldKeyHex)).rejects.toThrow();
  });

  it('batch : 50 champs chiffrés/déchiffrés correctement', async () => {
    const keyHex = await makeKeyHex();
    const values = Array.from({ length: 50 }, (_, i) => `user${i}@test-intralys.com`);

    const encrypted = await Promise.all(values.map(v => encryptField(v, keyHex)));
    const decrypted = await Promise.all(encrypted.map(e => decryptField(e, keyHex)));

    expect(decrypted).toEqual(values);
  });
});

// ── Tests isEncrypted (détection format) ─────────────────────────────────────

describe('isEncrypted — détection de format', () => {
  it('retourne false pour du texte en clair', () => {
    expect(isEncrypted('test@example.com')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted(42)).toBe(false);
  });

  it('retourne false pour un faux préfixe enc:', () => {
    expect(isEncrypted('enc:trop-court')).toBe(false);
    expect(isEncrypted('enc:pas-hex-du-tout:nope')).toBe(false);
  });

  it('retourne true pour un champ correctement chiffré', async () => {
    const keyHex = await makeKeyHex();
    const encrypted = await encryptField('secret@test.com', keyHex);
    expect(isEncrypted(encrypted)).toBe(true);
  });
});
