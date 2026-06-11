// ── field-encryption-engine.ts — Sprint 92 (seq187) ─────────────────────────
// Chiffrement at-rest des champs PII (email, phone, notes) via AES-GCM 256.
//
// Wrapper haut-niveau de crypto-engine.ts :
//   - encryptField / decryptField : single field
//   - encryptLeadPii / decryptLeadPii : batch sur un objet lead
//   - isEncrypted : détecte le préfixe marqueur
//   - Migration progressive : les champs non-chiffrés sont traités transparemment
//
// ZÉRO I/O. Toutes les fonctions sont pures (sauf crypto.getRandomValues interne).

import {
  importAesKeyHex,
  encryptAesGcm,
  decryptAesGcm,
  validateKeyFormat,
  CRYPTO_ERROR_CODES,
} from './crypto-engine';

// ── Codes d'erreur ────────────────────────────────────────────────────────

export const FIELD_ENCRYPTION_ERROR_CODES = Object.freeze({
  KEY_MISSING: 'FIELD_ENC_KEY_MISSING',
  KEY_INVALID: 'FIELD_ENC_KEY_INVALID',
  ENCRYPT_FAILED: 'FIELD_ENC_ENCRYPT_FAILED',
  DECRYPT_FAILED: 'FIELD_ENC_DECRYPT_FAILED',
  FIELD_INVALID: 'FIELD_ENC_FIELD_INVALID',
} as const);

export type FieldEncryptionErrorCode =
  (typeof FIELD_ENCRYPTION_ERROR_CODES)[keyof typeof FIELD_ENCRYPTION_ERROR_CODES];

// ── Constantes ────────────────────────────────────────────────────────────

/** Préfixe marqueur pour distinguer les champs chiffrés des champs en clair.
 *  Format stocké : `enc:<iv_hex>:<ciphertext_hex>` */
export const ENCRYPTED_FIELD_PREFIX = 'enc:' as const;

/** Champs PII par défaut à chiffrer sur un lead. Configurable par le caller. */
export const DEFAULT_PII_FIELDS = Object.freeze([
  'email',
  'phone',
  'notes',
  'message',
] as const);

export type PiiFieldName = (typeof DEFAULT_PII_FIELDS)[number];

// ── Détection ─────────────────────────────────────────────────────────────

/** Détecte si une valeur est déjà chiffrée (préfixe `enc:`). */
export function isEncrypted(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!value.startsWith(ENCRYPTED_FIELD_PREFIX)) return false;
  // Validation minimale du format : enc:<iv_24hex>:<ciphertext_hex>
  const parts = value.slice(ENCRYPTED_FIELD_PREFIX.length).split(':');
  if (parts.length !== 2) return false;
  const [iv, ct] = parts;
  if (!iv || !ct) return false;
  // IV = 24 hex chars (12 bytes), ciphertext = au moins 32 hex chars (16 bytes tag)
  if (iv.length !== 24) return false;
  if (ct.length < 32) return false;
  if (!/^[0-9a-fA-F]+$/.test(iv)) return false;
  if (!/^[0-9a-fA-F]+$/.test(ct)) return false;
  return true;
}

// ── Chiffrement d'un champ unique ─────────────────────────────────────────

/** Chiffre une valeur plaintext avec une clé AES-256 hex.
 *  Retourne `enc:<iv>:<ciphertext>` (format sérialisé pour stockage D1).
 *  Si la valeur est déjà chiffrée → retourne telle quelle (idempotence). */
export async function encryptField(
  plaintext: string,
  keyHex: string,
): Promise<string> {
  if (typeof plaintext !== 'string') {
    throw new Error(FIELD_ENCRYPTION_ERROR_CODES.FIELD_INVALID);
  }
  // Idempotence : déjà chiffré → no-op
  if (isEncrypted(plaintext)) return plaintext;
  // Valeur vide → pas de chiffrement (optimisation)
  if (plaintext.length === 0) return plaintext;
  if (!validateKeyFormat(keyHex)) {
    throw new Error(FIELD_ENCRYPTION_ERROR_CODES.KEY_INVALID);
  }
  try {
    const key = await importAesKeyHex(keyHex);
    const { ciphertext, iv } = await encryptAesGcm(plaintext, key);
    return `${ENCRYPTED_FIELD_PREFIX}${iv}:${ciphertext}`;
  } catch (e) {
    if (e instanceof Error && Object.values(CRYPTO_ERROR_CODES).includes(e.message as never)) {
      throw e;
    }
    throw new Error(FIELD_ENCRYPTION_ERROR_CODES.ENCRYPT_FAILED);
  }
}

/** Déchiffre une valeur au format `enc:<iv>:<ciphertext>`.
 *  Si la valeur n'est PAS chiffrée → retourne telle quelle (migration progressive). */
export async function decryptField(
  encryptedValue: string,
  keyHex: string,
): Promise<string> {
  if (typeof encryptedValue !== 'string') {
    throw new Error(FIELD_ENCRYPTION_ERROR_CODES.FIELD_INVALID);
  }
  // Pas chiffré → retour transparent (migration progressive)
  if (!isEncrypted(encryptedValue)) return encryptedValue;
  if (!validateKeyFormat(keyHex)) {
    throw new Error(FIELD_ENCRYPTION_ERROR_CODES.KEY_INVALID);
  }
  const payload = encryptedValue.slice(ENCRYPTED_FIELD_PREFIX.length);
  const colonIdx = payload.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(FIELD_ENCRYPTION_ERROR_CODES.DECRYPT_FAILED);
  }
  const ivHex = payload.slice(0, colonIdx);
  const ciphertextHex = payload.slice(colonIdx + 1);
  try {
    const key = await importAesKeyHex(keyHex);
    return await decryptAesGcm(ciphertextHex, key, ivHex);
  } catch {
    throw new Error(FIELD_ENCRYPTION_ERROR_CODES.DECRYPT_FAILED);
  }
}

// ── Chiffrement batch d'un objet lead ─────────────────────────────────────

export type LeadLike = Record<string, unknown>;

/** Chiffre les champs PII d'un objet lead. Retourne une copie shallow.
 *  Les champs null/undefined/non-string sont ignorés.
 *  Les champs déjà chiffrés sont ignorés (idempotence). */
export async function encryptLeadPii(
  lead: LeadLike,
  keyHex: string,
  fields: readonly string[] = DEFAULT_PII_FIELDS,
): Promise<LeadLike> {
  if (!lead || typeof lead !== 'object') return lead;
  const copy = { ...lead };
  for (const field of fields) {
    const val = copy[field];
    if (typeof val !== 'string' || val.length === 0) continue;
    if (isEncrypted(val)) continue;
    copy[field] = await encryptField(val, keyHex);
  }
  return copy;
}

/** Déchiffre les champs PII d'un objet lead. Retourne une copie shallow.
 *  Les champs non-chiffrés sont retournés tels quels (migration progressive). */
export async function decryptLeadPii(
  lead: LeadLike,
  keyHex: string,
  fields: readonly string[] = DEFAULT_PII_FIELDS,
): Promise<LeadLike> {
  if (!lead || typeof lead !== 'object') return lead;
  const copy = { ...lead };
  for (const field of fields) {
    const val = copy[field];
    if (typeof val !== 'string' || val.length === 0) continue;
    if (!isEncrypted(val)) continue;
    copy[field] = await decryptField(val, keyHex);
  }
  return copy;
}

// ── Helpers de rotation de clé ────────────────────────────────────────────

/** Re-chiffre un champ avec une nouvelle clé (rotation).
 *  Déchiffre avec l'ancienne clé → rechiffre avec la nouvelle. */
export async function rotateFieldKey(
  encryptedValue: string,
  oldKeyHex: string,
  newKeyHex: string,
): Promise<string> {
  const plaintext = await decryptField(encryptedValue, oldKeyHex);
  return encryptField(plaintext, newKeyHex);
}
