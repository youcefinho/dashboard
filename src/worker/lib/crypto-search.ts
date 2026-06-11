// ── crypto-search.ts — Sprint 92 (seq187) ───────────────────────────────────
// Blind index HMAC-SHA256 pour recherche sur champs chiffrés.
//
// Principe : même input → même hash déterministe → recherche exacte possible
// sur un champ chiffré (AES-GCM) sans déchiffrer. Le hash est stocké dans
// une colonne séparée (email_hash, phone_hash) indexée en D1.
//
// ZÉRO I/O. Fonctions pures (sauf crypto.subtle.sign / importKey).

import { bytesToHex, hexToBytes } from './crypto-engine';

// ── Import clé HMAC ──────────────────────────────────────────────────────

/** Importe une clé HMAC-SHA256 depuis une clé hex (64 chars = 256 bits).
 *  La clé est non-extractable (defense in depth). */
export async function importHmacKey(keyHex: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(keyHex);
  return crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(
      keyBytes.byteOffset,
      keyBytes.byteOffset + keyBytes.byteLength,
    ) as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false, // non-extractable
    ['sign'],
  );
}

// ── Calcul blind index ───────────────────────────────────────────────────

/** Calcule le hash de recherche blind pour un champ PII.
 *  Normalise : trim().toLowerCase() avant hash (recherche insensible à la casse).
 *  Retourne hex string de 64 chars (SHA-256 = 32 bytes × 2). */
export async function computeSearchHash(
  value: string,
  key: CryptoKey,
): Promise<string> {
  const normalized = value.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer,
  );
  return bytesToHex(new Uint8Array(signature));
}

// ── Helper batch pour leads ──────────────────────────────────────────────

/** Calcule email_hash et phone_hash pour un lead.
 *  Retourne null pour chaque champ absent/vide. */
export async function computeLeadSearchHashes(
  lead: { email?: string | null; phone?: string | null },
  keyHex: string,
): Promise<{ email_hash: string | null; phone_hash: string | null }> {
  const hmacKey = await importHmacKey(keyHex);

  const emailHash = lead.email?.trim()
    ? await computeSearchHash(lead.email, hmacKey)
    : null;

  const phoneHash = lead.phone?.trim()
    ? await computeSearchHash(lead.phone, hmacKey)
    : null;

  return { email_hash: emailHash, phone_hash: phoneHash };
}
