// ── crypto-engine.ts — AES-GCM 256 helpers (Web Crypto Workers native) ─────
// Utils P2-2 RENFORCEMENT — additif au `crypto.ts` (PBKDF2 + TOTP).
//
// Couvre :
//   - AES-GCM 256-bit key gen + import/export (hex)
//   - encrypt / decrypt avec IV 12 bytes unique
//   - generateIv random
//   - validateKeyFormat (64 hex chars = 256 bits)
//   - constantTimeBytesEqual (anti-timing)
//
// ZÉRO state. Toutes les fonctions pures par rapport à leur input (sauf les
// `generate*` qui appellent crypto.getRandomValues).

export const CRYPTO_ERROR_CODES = Object.freeze({
  KEY_INVALID: 'KEY_INVALID',
  KEY_IMPORT_FAILED: 'KEY_IMPORT_FAILED',
  IV_INVALID: 'IV_INVALID',
  CIPHERTEXT_INVALID: 'CIPHERTEXT_INVALID',
  DECRYPT_FAILED: 'DECRYPT_FAILED',
  ENCRYPT_FAILED: 'ENCRYPT_FAILED',
} as const);

export type CryptoErrorCode = (typeof CRYPTO_ERROR_CODES)[keyof typeof CRYPTO_ERROR_CODES];

/** Taille clé AES en bits (256 = AES-256). */
export const AES_KEY_BITS = 256 as const;

/** Taille IV en bytes pour AES-GCM (NIST recommande 12 bytes). */
export const AES_GCM_IV_BYTES = 12 as const;

/** Tag length pour AES-GCM (en bits). 128 = max sécurité. */
export const AES_GCM_TAG_BITS = 128 as const;

// ───────────────────────────────────────────────────────────────────────────
// Hex helpers
// ───────────────────────────────────────────────────────────────────────────

/** Uint8Array → hex string lowercase (sans 0x prefix). */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Hex string → Uint8Array. Throws si chars invalides ou longueur impaire. */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') throw new Error(CRYPTO_ERROR_CODES.KEY_INVALID);
  const clean = hex.toLowerCase().replace(/^0x/, '');
  if (clean.length % 2 !== 0) throw new Error(CRYPTO_ERROR_CODES.KEY_INVALID);
  if (!/^[0-9a-f]*$/.test(clean)) throw new Error(CRYPTO_ERROR_CODES.KEY_INVALID);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Validation
// ───────────────────────────────────────────────────────────────────────────

/** Une clé AES-256 sérialisée = 64 chars hex (32 bytes × 2). Valide format. */
export function validateKeyFormat(key: unknown): boolean {
  if (typeof key !== 'string') return false;
  if (key.length !== 64) return false;
  return /^[0-9a-fA-F]{64}$/.test(key);
}

/** IV AES-GCM = 12 bytes (96 bits) → 24 chars hex. */
export function validateIvFormat(iv: unknown): boolean {
  if (typeof iv !== 'string') return false;
  if (iv.length !== AES_GCM_IV_BYTES * 2) return false;
  return /^[0-9a-fA-F]+$/.test(iv);
}

// ───────────────────────────────────────────────────────────────────────────
// Random generation
// ───────────────────────────────────────────────────────────────────────────

/** Génère une CryptoKey AES-GCM 256 bits (extractable pour export hex). */
export async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: AES_KEY_BITS },
    true, // extractable (sinon on ne peut pas exporter en hex pour rotation)
    ['encrypt', 'decrypt'],
  );
}

/** Export une CryptoKey AES en hex (64 chars). */
export async function exportAesKeyHex(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToHex(new Uint8Array(raw));
}

/** Import une clé AES-256 depuis hex (64 chars). Throws KEY_INVALID si format KO. */
export async function importAesKeyHex(hex: string): Promise<CryptoKey> {
  if (!validateKeyFormat(hex)) {
    throw new Error(CRYPTO_ERROR_CODES.KEY_INVALID);
  }
  const bytes = hexToBytes(hex);
  return crypto.subtle.importKey(
    'raw',
    bytes.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false, // non-extractable une fois ré-importée → defense in depth
    ['encrypt', 'decrypt'],
  );
}

/** Génère un IV 12 bytes random (Uint8Array). */
export function generateIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
}

// ───────────────────────────────────────────────────────────────────────────
// Encrypt / Decrypt
// ───────────────────────────────────────────────────────────────────────────

export interface EncryptedPayload {
  /** Hex du ciphertext (inclut le tag GCM 16 bytes en suffixe). */
  ciphertext: string;
  /** Hex de l'IV (24 chars). */
  iv: string;
}

/** Encrypt une string plaintext avec une CryptoKey AES-GCM + IV optionnel.
 *  Si pas d'IV → on en génère un random (recommandé). */
export async function encryptAesGcm(
  plaintext: string,
  key: CryptoKey,
  iv?: Uint8Array,
): Promise<EncryptedPayload> {
  if (typeof plaintext !== 'string') {
    throw new Error(CRYPTO_ERROR_CODES.ENCRYPT_FAILED);
  }
  const ivBytes = iv ?? generateIv();
  if (ivBytes.length !== AES_GCM_IV_BYTES) {
    throw new Error(CRYPTO_ERROR_CODES.IV_INVALID);
  }
  const data = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes.buffer.slice(
        ivBytes.byteOffset,
        ivBytes.byteOffset + ivBytes.byteLength,
      ) as ArrayBuffer,
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    data.buffer as ArrayBuffer,
  );
  return {
    ciphertext: bytesToHex(new Uint8Array(cipherBuf)),
    iv: bytesToHex(ivBytes),
  };
}

/** Decrypt un ciphertext hex avec key + iv (hex). Returns string plaintext.
 *  Throws DECRYPT_FAILED si tampered ou wrong key/iv. */
export async function decryptAesGcm(
  ciphertextHex: string,
  key: CryptoKey,
  ivHex: string,
): Promise<string> {
  if (typeof ciphertextHex !== 'string' || ciphertextHex.length === 0) {
    throw new Error(CRYPTO_ERROR_CODES.CIPHERTEXT_INVALID);
  }
  if (!validateIvFormat(ivHex)) {
    throw new Error(CRYPTO_ERROR_CODES.IV_INVALID);
  }
  let cipher: Uint8Array;
  let ivBytes: Uint8Array;
  try {
    cipher = hexToBytes(ciphertextHex);
    ivBytes = hexToBytes(ivHex);
  } catch {
    throw new Error(CRYPTO_ERROR_CODES.CIPHERTEXT_INVALID);
  }
  try {
    const plainBuf = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes.buffer.slice(
          ivBytes.byteOffset,
          ivBytes.byteOffset + ivBytes.byteLength,
        ) as ArrayBuffer,
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      cipher.buffer.slice(
        cipher.byteOffset,
        cipher.byteOffset + cipher.byteLength,
      ) as ArrayBuffer,
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    throw new Error(CRYPTO_ERROR_CODES.DECRYPT_FAILED);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Constant-time comparison (anti-timing)
// ───────────────────────────────────────────────────────────────────────────

/** Compare 2 Uint8Array en temps constant. Renvoie true si égales (même longueur
 *  ET même bytes). Conçu pour MAC / tag comparison. */
export function constantTimeBytesEqual(a: unknown, b: unknown): boolean {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Variante string-hex de constantTimeBytesEqual (utile pour comparer 2 hashes). */
export function constantTimeHexEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const aLow = a.toLowerCase();
  const bLow = b.toLowerCase();
  let diff = 0;
  for (let i = 0; i < aLow.length; i++) {
    diff |= aLow.charCodeAt(i) ^ bLow.charCodeAt(i);
  }
  return diff === 0;
}
