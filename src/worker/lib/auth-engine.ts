// ── auth-engine.ts — Helpers PURS sécurité auth (RENFORCEMENT P0) ──────────
//
// Contrat ADDITIF — 100% : aucun import depuis auth.ts existant, aucun
// remplacement de logique vivante. Les helpers fournis ici sont des outils
// purs (zéro I/O sauf Web Crypto) à utiliser dans tout nouveau code ou en
// surcouche progressive — sans casser les schemas legacy d'auth.ts qui
// restent volontairement permissifs (min 6/8 chars) pour rétro-compat
// totale avec les comptes existants.
//
// Sécurité production-grade :
//   - Password : min 12, max 128, complexité (upper + digit + special), entropy
//   - Token : 48 hex chars (24 bytes cryptographic = 192 bits)
//   - Hash : PBKDF2-SHA256 210k iterations + 16 bytes salt (calque crypto.ts)
//   - Compare : constant-time
//   - Email login : RFC simplified
//   - Common passwords blocklist (top 50)

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés (utiliser côté handlers pour discrimination)
// ════════════════════════════════════════════════════════════════════════════

export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  EMAIL_INVALID: 'EMAIL_INVALID',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  PASSWORD_TOO_LONG: 'PASSWORD_TOO_LONG',
  PASSWORD_COMMON: 'PASSWORD_COMMON',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_USED: 'TOKEN_USED',
  RATE_LIMITED: 'RATE_LIMITED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_INVALID: 'SESSION_INVALID',
  INVALID_2FA: 'INVALID_2FA',
  MISSING_2FA: 'MISSING_2FA',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  PROVISION_FAILED: 'PROVISION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Constantes sécurité (production-grade)
// ════════════════════════════════════════════════════════════════════════════

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_PASSWORD_LENGTH_LEGACY = 6; // Schema legacy auth.ts loginSchema (rétro-compat)
export const SESSION_TTL_MS = 24 * 3600 * 1000; // 24h (override prod legacy 72h conservé dans auth.ts)
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15min
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h
export const SESSION_TOKEN_BYTES = 24; // 192 bits → 48 hex chars
export const MAGIC_LINK_TOKEN_BYTES = 32; // 256 bits → 64 hex chars
export const PBKDF2_ITERATIONS = 210_000; // Calque crypto.ts
export const PBKDF2_SALT_BYTES = 16;
export const PBKDF2_KEY_BITS = 256;

// Top 50 mots de passe communs (rejet automatique en validation stricte).
// Source : Have I Been Pwned / NIST SP 800-63B guidance.
const COMMON_PASSWORDS = new Set<string>([
  '123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234',
  '111111', '1234567', 'dragon', '123123', 'baseball', 'abc123', 'football',
  'monkey', 'letmein', '696969', 'shadow', 'master', '666666', 'qwertyuiop',
  '123321', 'mustang', '1234567890', 'michael', '654321', 'pussy', 'superman',
  '1qaz2wsx', '7777777', 'fuckyou', '121212', '000000', 'qazwsx', '123qwe',
  'killer', 'trustno1', 'jordan', 'jennifer', 'zxcvbnm', 'asdfgh', 'hunter',
  'buster', 'soccer', 'harley', 'batman', 'andrew', 'tigger', 'sunshine',
  'iloveyou', 'password1', 'password123', 'admin', 'admin123', 'welcome',
  'welcome1', 'qwerty123', 'azerty', 'motdepasse',
  // 12+ chars communs (passent le check longueur, rattrapés par la blocklist)
  'password1234', 'qwerty123456', 'azertyuiop12', 'motdepasse12',
  'administrator', 'welcome12345', '123456789012', 'qwertyuiop12',
]);

// ════════════════════════════════════════════════════════════════════════════
// validatePassword — règles production-grade
// ════════════════════════════════════════════════════════════════════════════

export interface PasswordValidationResult {
  ok: boolean;
  error?: string;
  code?: AuthErrorCode;
  strength?: 0 | 1 | 2 | 3 | 4; // 0 = très faible, 4 = très fort
}

/**
 * Valide un mot de passe selon règles production-grade :
 *   - Longueur min/max
 *   - Pas dans la blocklist (top 50 commun)
 *   - Strength 0-4 (length + diversity + entropy)
 *
 * Note : ne REJETTE PAS sur faiblesse complexité (uppercase/digit/special manquant)
 * conformément aux recommandations NIST SP 800-63B (longueur > complexité forcée).
 * Le caller peut lire `strength` et exiger un seuil minimal.
 */
export function validatePassword(pwd: unknown): PasswordValidationResult {
  if (typeof pwd !== 'string') {
    return { ok: false, error: 'Mot de passe requis', code: AUTH_ERROR_CODES.INVALID_INPUT };
  }
  if (pwd.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Mot de passe trop long (max ${MAX_PASSWORD_LENGTH} caractères)`,
      code: AUTH_ERROR_CODES.PASSWORD_TOO_LONG,
    };
  }
  // Blocklist d'abord (priorité UX : un common reste un common même <12 chars,
  // et le code COMMON est plus actionnable côté front qu'un length générique).
  if (COMMON_PASSWORDS.has(pwd.toLowerCase())) {
    return {
      ok: false,
      error: 'Mot de passe trop commun',
      code: AUTH_ERROR_CODES.PASSWORD_COMMON,
      strength: 0,
    };
  }
  if (pwd.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Mot de passe trop court (min ${MIN_PASSWORD_LENGTH} caractères)`,
      code: AUTH_ERROR_CODES.PASSWORD_TOO_SHORT,
    };
  }
  return { ok: true, strength: scorePasswordStrength(pwd) };
}

/**
 * Score 0-4 inspiré zxcvbn-lite (sans dépendance) :
 *   0 → ≤8 chars OU 1 famille de chars
 *   1 → ≤10 chars OU 2 familles
 *   2 → 11-13 chars + 3 familles
 *   3 → 14+ chars + 3 familles OR 12+ chars + 4 familles
 *   4 → 16+ chars + 4 familles
 */
export function scorePasswordStrength(pwd: string): 0 | 1 | 2 | 3 | 4 {
  const families = countCharFamilies(pwd);
  const len = pwd.length;
  if (len >= 16 && families >= 4) return 4;
  if ((len >= 14 && families >= 3) || (len >= 12 && families >= 4)) return 3;
  if (len >= 11 && families >= 3) return 2;
  if (len >= 10 || families >= 2) return 1;
  return 0;
}

function countCharFamilies(pwd: string): number {
  let f = 0;
  if (/[a-z]/.test(pwd)) f++;
  if (/[A-Z]/.test(pwd)) f++;
  if (/[0-9]/.test(pwd)) f++;
  if (/[^A-Za-z0-9]/.test(pwd)) f++;
  return f;
}

/** Variante stricte : exige strength >= 2 + au moins 3 familles. */
export function validatePasswordStrict(pwd: unknown): PasswordValidationResult {
  const base = validatePassword(pwd);
  if (!base.ok) return base;
  if ((base.strength ?? 0) < 2 || countCharFamilies(pwd as string) < 3) {
    return {
      ok: false,
      error: 'Mot de passe trop faible (mélangez majuscules, chiffres et caractères spéciaux)',
      code: AUTH_ERROR_CODES.WEAK_PASSWORD,
      strength: base.strength,
    };
  }
  return base;
}

// ════════════════════════════════════════════════════════════════════════════
// validateEmailLogin — RFC simplified (anti-injection + format raisonnable)
// ════════════════════════════════════════════════════════════════════════════

/**
 * RFC 5321/5322 simplified : `local@domain.tld` avec :
 *   - local : 1-64 chars, alphanum + `._-+`
 *   - domain : labels alphanum + `-`, séparés par `.`, TLD ≥ 2 chars
 *   - longueur totale ≤ 254
 *
 * Rejette : espaces, `..` consécutifs, caractères de contrôle, multiple `@`.
 */
export function validateEmailLogin(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  if (trimmed.includes('..')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return false;
  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1 || trimmed.indexOf('@', atIdx + 1) !== -1) return false;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  if (local.length === 0 || local.length > 64) return false;
  if (domain.length === 0 || domain.length > 253) return false;
  if (!/^[A-Za-z0-9._+\-]+$/.test(local)) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  // Domain : labels séparés par `.`, chaque label alphanum + `-`, TLD ≥ 2 alpha
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[A-Za-z0-9-]+$/.test(label)) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }
  const tld = labels[labels.length - 1]!;
  if (tld.length < 2 || !/^[A-Za-z]+$/.test(tld)) return false;
  return true;
}

/** Normalise email pour stockage : trim + lowercase. Ne valide PAS. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ════════════════════════════════════════════════════════════════════════════
// Token generation — cryptographically secure
// ════════════════════════════════════════════════════════════════════════════

/** Session token : 48 hex chars (192 bits d'entropie). */
export function generateSessionToken(): string {
  return randomHex(SESSION_TOKEN_BYTES);
}

/** Magic-link / password-reset token : 64 hex chars (256 bits). */
export function generateMagicLinkToken(): string {
  return randomHex(MAGIC_LINK_TOKEN_BYTES);
}

/** Helper interne : bytes aléatoires crypto.getRandomValues → hex. */
export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ════════════════════════════════════════════════════════════════════════════
// Password hashing — PBKDF2-SHA256 (calque crypto.ts pour compat formats)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hash PBKDF2-SHA256 210k iterations + 16 bytes salt random.
 * Format : `pbkdf2$<iterations>$<salt_b64>$<hash_b64>` — STRICTEMENT compatible
 * avec verifyPassword de crypto.ts (rétro-compat parfaite).
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('hashPassword: password requis');
  }
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password).buffer as ArrayBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    PBKDF2_KEY_BITS,
  );
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltB64 = btoa(String.fromCharCode(...salt));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

/**
 * Verify PBKDF2 password en temps constant. Accepte hashs legacy crypto.ts
 * (même format). Retourne false sur tout format inconnu ou hash malformé.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  if (!stored.startsWith('pbkdf2$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const [, iterStr, saltB64, hashB64] = parts;
  if (!iterStr || !saltB64 || !hashB64) return false;
  const iterations = parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 5_000_000) return false;

  let salt: Uint8Array;
  try {
    salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password).buffer as ArrayBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
    key,
    PBKDF2_KEY_BITS,
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return constantTimeEqual(computed, hashB64);
}

/** Comparaison string en temps constant (anti-timing-attack). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ════════════════════════════════════════════════════════════════════════════
// Auth header parsing — `Authorization: Bearer <token>`
// ════════════════════════════════════════════════════════════════════════════

export interface ParsedAuthHeader {
  token?: string;
  error?: string;
  code?: AuthErrorCode;
}

/**
 * Parse l'header `Authorization`. Accepte uniquement `Bearer <token>`.
 * Reject : null, vide, mauvais scheme, token vide, espaces parasites.
 */
export function parseAuthHeader(header: string | null | undefined): ParsedAuthHeader {
  if (!header || typeof header !== 'string') {
    return { error: 'Header Authorization manquant', code: AUTH_ERROR_CODES.SESSION_INVALID };
  }
  // Trim left/right SANS toucher au délimiteur scheme/token : on travaille sur
  // les deux bouts indépendamment pour préserver le cas `Bearer ` (token vide
  // explicite) qui doit reporter TOKEN_INVALID et pas SESSION_INVALID.
  const ltrimmed = header.replace(/^\s+/, '');
  // Match "Bearer<spaces><token>" — le scheme doit être suivi d'un ou plusieurs
  // espaces (sinon scheme inconnu type "Bearerabc").
  const m = /^Bearer(\s+)(.*)$/i.exec(ltrimmed);
  if (!m) {
    // Cas spécial : "Bearer" seul (sans espace) = scheme reconnu mais token vide.
    if (/^Bearer\s*$/i.test(ltrimmed)) {
      return { error: 'Token vide', code: AUTH_ERROR_CODES.TOKEN_INVALID };
    }
    return { error: 'Scheme non supporté (Bearer requis)', code: AUTH_ERROR_CODES.SESSION_INVALID };
  }
  const token = m[2]!.trim();
  if (token.length === 0) {
    return { error: 'Token vide', code: AUTH_ERROR_CODES.TOKEN_INVALID };
  }
  // Rejet de tokens avec espaces internes (corruption probable)
  if (/\s/.test(token)) {
    return { error: 'Token mal formé', code: AUTH_ERROR_CODES.TOKEN_INVALID };
  }
  return { token };
}

// ════════════════════════════════════════════════════════════════════════════
// Token expiry checking
// ════════════════════════════════════════════════════════════════════════════

/**
 * Vérifie si un timestamp/ISO-date est expiré (< now).
 * Accepte : number (ms epoch), string ISO 8601, Date.
 * Retourne true en cas de format invalide (fail-closed).
 */
export function isTokenExpired(expiresAt: number | string | Date | null | undefined, now = Date.now()): boolean {
  if (expiresAt == null) return true;
  let ts: number;
  if (typeof expiresAt === 'number') {
    ts = expiresAt;
  } else if (expiresAt instanceof Date) {
    ts = expiresAt.getTime();
  } else if (typeof expiresAt === 'string') {
    ts = new Date(expiresAt).getTime();
  } else {
    return true;
  }
  if (!Number.isFinite(ts)) return true;
  return ts < now;
}

/** Calcule un ISO 8601 expiry à partir de `now + ttl`. */
export function computeExpiry(ttlMs: number, now = Date.now()): string {
  return new Date(now + ttlMs).toISOString();
}
