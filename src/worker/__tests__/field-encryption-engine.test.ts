// ── field-encryption-engine.test.ts — Sprint 92 (seq187) ────────────────────
// Tests pour le chiffrement at-rest des champs PII.
// 12 cas : encrypt/decrypt roundtrip, idempotence, clé invalide, champs vides,
// migration progressive, batch lead, rotation de clé.
//
// Utilise le vrai Web Crypto (Workers runtime compatible).

import { describe, it, expect } from 'vitest';
import {
  encryptField,
  decryptField,
  encryptLeadPii,
  decryptLeadPii,
  isEncrypted,
  rotateFieldKey,
  ENCRYPTED_FIELD_PREFIX,
  DEFAULT_PII_FIELDS,
  FIELD_ENCRYPTION_ERROR_CODES,
} from '../lib/field-encryption-engine';
import { exportAesKeyHex, generateAesKey } from '../lib/crypto-engine';

// Helper : génère une clé hex valide pour les tests
async function testKeyHex(): Promise<string> {
  const key = await generateAesKey();
  return exportAesKeyHex(key);
}

// ──────────────────────────────────────────────────────────────────────────
// isEncrypted — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S92 — isEncrypted', () => {
  it('1. String non-chiffrée → false', () => {
    expect(isEncrypted('john@example.com')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted(42)).toBe(false);
  });

  it('2. Préfixe enc: mais format invalide → false', () => {
    expect(isEncrypted('enc:')).toBe(false);
    expect(isEncrypted('enc:abc')).toBe(false);
    expect(isEncrypted('enc:tooshort:data')).toBe(false);
    expect(isEncrypted('enc:zzzzzzzzzzzzzzzzzzzzzzzz:data')).toBe(false); // IV ok mais ct trop court
  });

  it('3. Format enc:<iv24>:<ct32+> valide → true', () => {
    const fakeIv = 'a'.repeat(24);
    const fakeCt = 'b'.repeat(64);
    expect(isEncrypted(`enc:${fakeIv}:${fakeCt}`)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// encryptField / decryptField — 5 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S92 — encryptField / decryptField', () => {
  it('4. Roundtrip : encrypt → decrypt = original', async () => {
    const keyHex = await testKeyHex();
    const original = 'john.doe@example.com';
    const encrypted = await encryptField(original, keyHex);

    expect(encrypted).not.toBe(original);
    expect(encrypted.startsWith(ENCRYPTED_FIELD_PREFIX)).toBe(true);

    const decrypted = await decryptField(encrypted, keyHex);
    expect(decrypted).toBe(original);
  });

  it('5. Idempotence : chiffrer un champ déjà chiffré → retour identique', async () => {
    const keyHex = await testKeyHex();
    const encrypted = await encryptField('test@test.com', keyHex);
    const doubleEncrypted = await encryptField(encrypted, keyHex);

    expect(doubleEncrypted).toBe(encrypted); // Pas de double chiffrement
  });

  it('6. String vide → retour vide (pas de chiffrement)', async () => {
    const keyHex = await testKeyHex();
    const result = await encryptField('', keyHex);
    expect(result).toBe('');
  });

  it('7. Clé invalide → throw KEY_INVALID', async () => {
    await expect(encryptField('data', 'not-a-hex-key')).rejects.toThrow(
      FIELD_ENCRYPTION_ERROR_CODES.KEY_INVALID,
    );
  });

  it('8. Déchiffrer un texte non-chiffré → retour transparent (migration)', async () => {
    const keyHex = await testKeyHex();
    const plainEmail = 'plain@example.com';
    const result = await decryptField(plainEmail, keyHex);
    expect(result).toBe(plainEmail); // Migration progressive
  });
});

// ──────────────────────────────────────────────────────────────────────────
// encryptLeadPii / decryptLeadPii — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S92 — encryptLeadPii / decryptLeadPii', () => {
  it('9. Batch roundtrip sur un lead complet', async () => {
    const keyHex = await testKeyHex();
    const lead = {
      id: 'lead-1',
      name: 'Jean Tremblay',
      email: 'jean@example.com',
      phone: '+1-514-555-1234',
      notes: 'Intéressé par un condo',
      message: 'Bonjour, je cherche...',
      status: 'new',
      score: 85,
    };

    const encrypted = await encryptLeadPii(lead, keyHex);

    // Les champs PII sont chiffrés
    expect(isEncrypted(encrypted.email as string)).toBe(true);
    expect(isEncrypted(encrypted.phone as string)).toBe(true);
    expect(isEncrypted(encrypted.notes as string)).toBe(true);
    expect(isEncrypted(encrypted.message as string)).toBe(true);

    // Les champs non-PII sont inchangés
    expect(encrypted.id).toBe('lead-1');
    expect(encrypted.name).toBe('Jean Tremblay');
    expect(encrypted.status).toBe('new');
    expect(encrypted.score).toBe(85);

    // Déchiffrement → retour aux valeurs originales
    const decrypted = await decryptLeadPii(encrypted, keyHex);
    expect(decrypted.email).toBe('jean@example.com');
    expect(decrypted.phone).toBe('+1-514-555-1234');
    expect(decrypted.notes).toBe('Intéressé par un condo');
    expect(decrypted.message).toBe('Bonjour, je cherche...');
  });

  it('10. Lead avec champs null/undefined → ignorés sans erreur', async () => {
    const keyHex = await testKeyHex();
    const lead = {
      id: 'lead-2',
      email: null,
      phone: undefined,
      notes: '',
    };

    const encrypted = await encryptLeadPii(lead as Record<string, unknown>, keyHex);
    expect(encrypted.email).toBeNull();
    expect(encrypted.phone).toBeUndefined();
    expect(encrypted.notes).toBe('');
  });

  it('11. Champs custom (override DEFAULT_PII_FIELDS)', async () => {
    const keyHex = await testKeyHex();
    const obj = { name: 'Secret Name', age: 30 };

    const encrypted = await encryptLeadPii(obj, keyHex, ['name']);
    expect(isEncrypted(encrypted.name as string)).toBe(true);
    expect(encrypted.age).toBe(30);

    const decrypted = await decryptLeadPii(encrypted, keyHex, ['name']);
    expect(decrypted.name).toBe('Secret Name');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// rotateFieldKey — 1 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S92 — rotateFieldKey', () => {
  it('12. Rotation : ancienne clé → nouvelle clé → déchiffrable avec nouvelle', async () => {
    const oldKeyHex = await testKeyHex();
    const newKeyHex = await testKeyHex();
    const original = 'sensitive@data.com';

    const encryptedOld = await encryptField(original, oldKeyHex);
    const encryptedNew = await rotateFieldKey(encryptedOld, oldKeyHex, newKeyHex);

    // Le ciphertext a changé (nouvelle clé + nouvel IV)
    expect(encryptedNew).not.toBe(encryptedOld);

    // Déchiffrable avec la nouvelle clé
    const decrypted = await decryptField(encryptedNew, newKeyHex);
    expect(decrypted).toBe(original);

    // Non déchiffrable avec l'ancienne clé
    await expect(decryptField(encryptedNew, oldKeyHex)).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Config exports — vérification structurelle
// ──────────────────────────────────────────────────────────────────────────

describe('S92 — config exports', () => {
  it('13. DEFAULT_PII_FIELDS contient les champs attendus', () => {
    expect(DEFAULT_PII_FIELDS).toContain('email');
    expect(DEFAULT_PII_FIELDS).toContain('phone');
    expect(DEFAULT_PII_FIELDS).toContain('notes');
    expect(DEFAULT_PII_FIELDS).toContain('message');
    expect(DEFAULT_PII_FIELDS.length).toBe(4);
  });

  it('14. ENCRYPTED_FIELD_PREFIX = "enc:"', () => {
    expect(ENCRYPTED_FIELD_PREFIX).toBe('enc:');
  });
});
