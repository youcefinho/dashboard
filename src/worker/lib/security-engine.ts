// ── security-engine.ts — Security P0-8 reinforcement ─────────────────────
//
// PURE helpers (zero I/O, zero DB, deterministic) for:
//   • password-reset token generation + constant-time validation (TTL 1h)
//   • TOTP RFC 6238 (6 digits, 30s window, drift ±1)
//   • backup codes (10 codes, dash-separated, single-use)
//
// 100% ADDITIF — n'altère AUCUN handler existant (worker/auth.ts garde son
// propre flow). Ces helpers sont à utiliser par le futur worker/security.ts
// quand il sera créé (Phase P0-8). En attendant, ils sont testés unitaire-
// ment et prêts pour intégration.
//
// Garanties de sécurité :
//   - generatePwdResetToken : 48 chars hex (24 bytes = 192 bits d'entropie)
//   - validatePwdResetToken : constant-time compare (anti-timing attack)
//   - validateTotpCode      : RFC 6238 HOTP-based, drift ±1 par défaut
//   - validateBackupCode    : single-use (retourne `remaining` sans le code)

// ── Codes d'erreur figés ──────────────────────────────────────────────────
export const SECURITY_ERROR_CODES = Object.freeze({
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_USED: 'TOKEN_USED',
  TOTP_INVALID: 'TOTP_INVALID',
  TOTP_MALFORMED: 'TOTP_MALFORMED',
  TOTP_SECRET_INVALID: 'TOTP_SECRET_INVALID',
  BACKUP_CODE_INVALID: 'BACKUP_CODE_INVALID',
  BACKUP_CODE_FORMAT: 'BACKUP_CODE_FORMAT',
} as const);

export type SecurityErrorCode = (typeof SECURITY_ERROR_CODES)[keyof typeof SECURITY_ERROR_CODES];

// ── Constantes RFC ────────────────────────────────────────────────────────
export const PWD_RESET_TTL_MS = 3_600_000; // 1h
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW_SEC = 30;
export const TOTP_DEFAULT_DRIFT = 1;
export const BACKUP_CODES_COUNT = 10;
export const BACKUP_CODE_LENGTH = 8; // 4-4 dash-separated
export const TOTP_SECRET_LENGTH = 16; // base32 chars (80 bits)

// RFC 4648 base32 alphabet (no padding for our 16-char secrets).
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HEX_ALPHABET = '0123456789abcdef';

// ── Helpers internes ──────────────────────────────────────────────────────

/**
 * Constant-time string equality (anti-timing attack).
 * Returns false immediately on length mismatch (length is not secret), but
 * XOR-walks the full string otherwise so total time depends only on length.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Random integer in [0, max) using crypto.getRandomValues for cryptographic entropy. */
function randomInt(max: number): number {
  // Use crypto.getRandomValues when available (Workers + browsers).
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] ?? 0) % max;
  }
  // Last-resort deterministic fallback (test envs without crypto). Math.random
  // is NOT cryptographically secure — but the engine is pure and the caller
  // owns the crypto context in prod.
  return Math.floor(Math.random() * max);
}

// ── Password reset tokens ─────────────────────────────────────────────────

/**
 * Generate a 48-char lowercase hex token (24 bytes = 192 bits entropy).
 * Use this for password reset, email verification, magic links.
 */
export function generatePwdResetToken(): string {
  let token = '';
  for (let i = 0; i < 48; i++) {
    token += HEX_ALPHABET.charAt(randomInt(16));
  }
  return token;
}

/**
 * Constant-time validation of a password reset token against its stored hash.
 * Caller is responsible for hashing the candidate token the same way the
 * stored hash was computed (e.g. SHA-256 hex) BEFORE calling — this helper
 * only does the safe compare.
 */
export function validatePwdResetToken(candidateHash: string, storedHash: string): boolean {
  return constantTimeEqual(candidateHash, storedHash);
}

/**
 * Returns true if a token created at `createdAt` (ms epoch) is still within
 * the TTL window (default 1h). Pure — caller passes `now` for testability.
 */
export function isTokenWithinTtl(createdAt: number, now: number, ttlMs: number = PWD_RESET_TTL_MS): boolean {
  if (!Number.isFinite(createdAt) || !Number.isFinite(now)) return false;
  if (createdAt > now) return false; // future-dated token = invalid
  return now - createdAt <= ttlMs;
}

// ── TOTP RFC 6238 ─────────────────────────────────────────────────────────

/** Validate a base32 secret (RFC 4648 alphabet, length multiple of 8 or our 16 chars). */
export function isValidTotpSecret(secret: string): boolean {
  if (typeof secret !== 'string') return false;
  if (secret.length < 16 || secret.length > 64) return false;
  for (let i = 0; i < secret.length; i++) {
    if (BASE32_ALPHABET.indexOf(secret.charAt(i)) < 0) return false;
  }
  return true;
}

/**
 * Generate a 16-char base32 TOTP secret (RFC 4648, 80 bits entropy).
 * To be QR-encoded as `otpauth://totp/<label>?secret=<this>&issuer=Intralys`.
 */
export function generateTotpSecret(): string {
  let s = '';
  for (let i = 0; i < TOTP_SECRET_LENGTH; i++) {
    s += BASE32_ALPHABET.charAt(randomInt(32));
  }
  return s;
}

/** Decode base32 (RFC 4648) to byte array. Lenient: ignores '=' padding. */
function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean.charAt(i));
    if (idx < 0) throw new Error('base32 invalid char');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** HMAC-SHA1 pure JS — TOTP requires SHA-1 per RFC 6238 §4. */
function hmacSha1(key: Uint8Array, msg: Uint8Array): Uint8Array {
  // SHA-1 block size = 64 bytes.
  const BLOCK = 64;
  let k = key;
  if (k.length > BLOCK) k = sha1(k);
  if (k.length < BLOCK) {
    const padded = new Uint8Array(BLOCK);
    padded.set(k);
    k = padded;
  }
  const oKeyPad = new Uint8Array(BLOCK);
  const iKeyPad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    const b = k[i] ?? 0;
    oKeyPad[i] = b ^ 0x5c;
    iKeyPad[i] = b ^ 0x36;
  }
  const inner = new Uint8Array(iKeyPad.length + msg.length);
  inner.set(iKeyPad);
  inner.set(msg, iKeyPad.length);
  const innerHash = sha1(inner);
  const outer = new Uint8Array(oKeyPad.length + innerHash.length);
  outer.set(oKeyPad);
  outer.set(innerHash, oKeyPad.length);
  return sha1(outer);
}

/** SHA-1 pure JS (FIPS 180-4). Inline for zero-dep TOTP. */
function sha1(input: Uint8Array): Uint8Array {
  // Pre-processing: padding.
  const ml = input.length * 8;
  // Append 1 bit + zeros + 64-bit length.
  const padLen = ((input.length + 9 + 63) & ~63) - input.length;
  const padded = new Uint8Array(input.length + padLen);
  padded.set(input);
  padded[input.length] = 0x80;
  // 64-bit big-endian length (high 32 = 0 for our tiny inputs).
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, ml >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(ml / 0x100000000) >>> 0, false);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const w = new Array<number>(80);
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      const v = (w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0);
      w[i] = ((v << 1) | (v >>> 31)) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20)      { f = (b & c) | ((~b) & d);        k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d;                    k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d);  k = 0x8f1bbcdc; }
      else             { f = b ^ c ^ d;                    k = 0xca62c1d6; }
      const temp = ((((a << 5) | (a >>> 27)) >>> 0) + f + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false);
  outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false);
  outDv.setUint32(12, h3, false);
  outDv.setUint32(16, h4, false);
  return out;
}

/** Compute the 6-digit TOTP for a given secret + counter (RFC 6238). */
function computeTotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const msg = new Uint8Array(8);
  // 64-bit big-endian counter; high 32 = 0 for any realistic time.
  const dv = new DataView(msg.buffer);
  dv.setUint32(0, Math.floor(counter / 0x100000000) >>> 0, false);
  dv.setUint32(4, counter >>> 0, false);
  const hmac = hmacSha1(key, msg);
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const truncated =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  const code = (truncated % 1_000_000).toString().padStart(TOTP_DIGITS, '0');
  return code;
}

/**
 * Validate a 6-digit TOTP code against secret.
 * Accepts drift ±N windows (default ±1 = 30s before/after). Constant-time
 * compare for each candidate.
 *
 * `nowSec` is an optional override (defaults to wall-clock seconds) for tests.
 */
export function validateTotpCode(
  secret: string,
  code: string,
  drift: number = TOTP_DEFAULT_DRIFT,
  nowSec?: number,
): boolean {
  if (!isValidTotpSecret(secret)) return false;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const t = typeof nowSec === 'number' ? nowSec : Math.floor(Date.now() / 1000);
  const counter = Math.floor(t / TOTP_WINDOW_SEC);
  const safeDrift = Math.max(0, Math.min(drift, 5));
  let ok = false;
  for (let d = -safeDrift; d <= safeDrift; d++) {
    try {
      const expected = computeTotp(secret, counter + d);
      // Constant-time check; do NOT short-circuit on first match to keep
      // total time independent of which window matched.
      if (constantTimeEqual(expected, code)) ok = true;
    } catch {
      // base32 decode failure → fall through; final result handles it.
    }
  }
  return ok;
}

// ── Backup codes ──────────────────────────────────────────────────────────

/**
 * Generate `BACKUP_CODES_COUNT` (10) backup codes formatted `XXXX-XXXX`
 * (alnum upper). Codes are dash-separated when serialized to a single string
 * (see `serializeBackupCodes` below).
 */
export function generateBackupCodes(count: number = BACKUP_CODES_COUNT): string[] {
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let left = '';
    let right = '';
    for (let j = 0; j < 4; j++) left += ALPHABET.charAt(randomInt(ALPHABET.length));
    for (let j = 0; j < 4; j++) right += ALPHABET.charAt(randomInt(ALPHABET.length));
    codes.push(`${left}-${right}`);
  }
  return codes;
}

/** Serialize backup codes as a single newline-separated string for storage. */
export function serializeBackupCodes(codes: string[]): string {
  return codes.join('\n');
}

/**
 * Parse raw backup codes string from storage. Accepts newline OR comma
 * separators (legacy compat). Filters empty lines + uppercases + trims.
 */
export function parseBackupCodes(raw: string): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

/**
 * Validate a backup code (single-use). Returns `{valid, remaining}` —
 * `remaining` is the list MINUS the consumed code if valid (the caller
 * persists `remaining`).
 *
 * Comparison is constant-time across the full list to avoid leaking
 * which slot matched.
 */
export function validateBackupCode(
  input: string,
  codes: string[],
): { valid: boolean; remaining: string[] } {
  if (typeof input !== 'string' || !Array.isArray(codes)) {
    return { valid: false, remaining: codes ?? [] };
  }
  const normalized = input.trim().toUpperCase();
  let matchedIndex = -1;
  // Walk ALL codes (no break) — constant-time per attempt regardless of
  // which slot matches.
  for (let i = 0; i < codes.length; i++) {
    const candidate = codes[i] ?? '';
    if (constantTimeEqual(candidate, normalized)) {
      // Record only the first match; subsequent matches (collision = bug)
      // are ignored to preserve idempotency.
      if (matchedIndex < 0) matchedIndex = i;
    }
  }
  if (matchedIndex < 0) return { valid: false, remaining: codes.slice() };
  const remaining = codes.slice(0, matchedIndex).concat(codes.slice(matchedIndex + 1));
  return { valid: true, remaining };
}
