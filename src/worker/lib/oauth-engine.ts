// ── oauth-engine.ts — helpers PURS pour LOT OAUTH (Integrations P2-4) ──────
//
// Engine helpers RENFORCEMENT pour oauth.ts. ZÉRO I/O DB / réseau.
// Toutes les fonctions sont déterministes et testables.
//
// Périmètre :
//   - Whitelist providers OAuth génériques (google_calendar | outlook | gbp |
//     meta | shopify | woocommerce | stripe).
//   - Génération/validation `state` CSRF (32 hex random, comparaison timing-safe).
//   - Validation expiration token (date | string | number).
//   - Validation `redirect_uri` contre une whitelist (https obligatoire,
//     pas de localhost en prod).
//   - Parsing de l'erreur OAuth (callback `?error=...&error_description=...`).
//
// 100% additif : oauth.ts continue de fonctionner sans cet engine.

// ── Codes d'erreur stables ──────────────────────────────────────────────────
export const OAUTH_ERROR_CODES = Object.freeze({
  PROVIDER_INVALID: 'oauth.provider.invalid',
  PROVIDER_NOT_CONFIGURED: 'oauth.provider.not_configured',
  STATE_INVALID: 'oauth.state.invalid',
  STATE_MISMATCH: 'oauth.state.mismatch',
  STATE_EXPIRED: 'oauth.state.expired',
  REDIRECT_URI_INVALID: 'oauth.redirect_uri.invalid',
  REDIRECT_URI_NOT_WHITELISTED: 'oauth.redirect_uri.not_whitelisted',
  TOKEN_EXPIRED: 'oauth.token.expired',
  TOKEN_INVALID: 'oauth.token.invalid',
  CALLBACK_ERROR: 'oauth.callback.error',
} as const);

// ── Whitelist providers (figés — étendre via PR explicite uniquement) ───────
// Inclut les providers v1 (google/slack via oauth.ts) + Sprint Integrations
// (google_calendar, outlook, gbp, meta, shopify, woocommerce, stripe).
// On garde google + slack pour rétrocompat avec oauth.ts:OauthProvider.
export const VALID_OAUTH_PROVIDERS = Object.freeze([
  'google',
  'slack',
  'google_calendar',
  'outlook',
  'gbp',
  'meta',
  'shopify',
  'woocommerce',
  'stripe',
] as const);
export type OauthProviderName = (typeof VALID_OAUTH_PROVIDERS)[number];

// Bornes raisonnables pour validation state OAuth.
export const STATE_BYTE_LENGTH = 16; // 16 bytes random → 32 hex chars
export const MIN_STATE_LENGTH = 32;
export const MAX_STATE_LENGTH = 128;
export const DEFAULT_STATE_TTL_SECONDS = 600; // 10 min — calque oauth.ts

// ── Validation provider ─────────────────────────────────────────────────────
export function validateProvider(p: unknown): p is OauthProviderName {
  if (typeof p !== 'string') return false;
  return (VALID_OAUTH_PROVIDERS as readonly string[]).includes(p);
}

// ── Détection expiration token ──────────────────────────────────────────────
// Accepte Date, ISO string, ou epoch ms (number). Tolérant aux types — null
// ou invalide ⇒ considéré comme NON expiré (best-effort, calque le
// comportement de oauth.ts:getOauthAccessToken l.519 : pas d'expires_at = OK).
//
// `now` est paramétrable pour permettre les tests déterministes.
export function isTokenExpired(
  expiresAt: number | string | Date | null | undefined,
  now: Date = new Date(),
  graceSeconds = 60,
): boolean {
  if (expiresAt == null) return false;
  let expMs: number;
  if (expiresAt instanceof Date) {
    expMs = expiresAt.getTime();
  } else if (typeof expiresAt === 'number') {
    // Heuristique : si valeur < 10^12 ⇒ secondes (epoch s), sinon ms.
    expMs = expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
  } else if (typeof expiresAt === 'string') {
    const parsed = Date.parse(expiresAt);
    if (Number.isNaN(parsed)) return false;
    expMs = parsed;
  } else {
    return false;
  }
  if (!Number.isFinite(expMs)) return false;
  // Grace : on considère "expiré" 60s avant le vrai expires_at pour
  // anticiper les latences réseau (calque oauth.ts:519 — `+ 60_000`).
  return expMs <= now.getTime() + graceSeconds * 1000;
}

// ── Génération state CSRF (32 hex random) ──────────────────────────────────
// Utilise crypto.getRandomValues (WebCrypto). PAS Math.random (insuffisant).
export function generateOauthState(): string {
  const bytes = new Uint8Array(STATE_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Validation state (format) ──────────────────────────────────────────────
export function validateStateFormat(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  if (state.length < MIN_STATE_LENGTH || state.length > MAX_STATE_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(state);
}

// ── Comparaison constant-time states (CSRF anti-timing) ────────────────────
// Compare deux chaînes ASCII en temps constant. Longueurs différentes ⇒
// false IMMÉDIAT (impossible d'éviter en JS, mais on ne fuite pas le contenu).
export function validateOauthState(
  received: unknown,
  stored: unknown,
): boolean {
  if (typeof received !== 'string' || typeof stored !== 'string') return false;
  if (received.length !== stored.length) return false;
  if (received.length === 0) return false;
  let mismatch = 0;
  for (let i = 0; i < received.length; i++) {
    mismatch |= received.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── Validation redirect_uri ────────────────────────────────────────────────
// Règles :
//   1. URL valide.
//   2. https obligatoire (ou http localhost UNIQUEMENT en dev — paramètre).
//   3. Si une whitelist est fournie, l'origine (scheme://host[:port]) doit y
//      figurer EXACTEMENT (pas de wildcard, pas de starts-with).
export function validateRedirectUri(
  uri: unknown,
  whitelist: string[] = [],
  options: { allowLocalhost?: boolean } = {},
): { ok: boolean; error?: string } {
  if (typeof uri !== 'string' || uri.length === 0) {
    return { ok: false, error: OAUTH_ERROR_CODES.REDIRECT_URI_INVALID };
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, error: OAUTH_ERROR_CODES.REDIRECT_URI_INVALID };
  }

  const allowLocalhost = options.allowLocalhost === true;
  const isLocalhost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1';

  if (parsed.protocol !== 'https:') {
    // http accepté UNIQUEMENT pour localhost ET seulement si allowLocalhost.
    if (!(parsed.protocol === 'http:' && isLocalhost && allowLocalhost)) {
      return { ok: false, error: OAUTH_ERROR_CODES.REDIRECT_URI_INVALID };
    }
  }

  // Pas de localhost en prod (allowLocalhost === false).
  if (!allowLocalhost && isLocalhost) {
    return { ok: false, error: OAUTH_ERROR_CODES.REDIRECT_URI_INVALID };
  }

  if (whitelist.length > 0) {
    const origin = parsed.origin;
    if (!whitelist.includes(origin) && !whitelist.includes(uri)) {
      return { ok: false, error: OAUTH_ERROR_CODES.REDIRECT_URI_NOT_WHITELISTED };
    }
  }
  return { ok: true };
}

// ── Parsing de l'erreur OAuth retournée par le provider ────────────────────
// Standard OAuth 2.0 §4.1.2.1 : `?error=...&error_description=...&error_uri=...`
export interface OauthCallbackError {
  error?: string;
  description?: string;
  uri?: string;
}
export function parseOauthError(query: URLSearchParams | undefined | null): OauthCallbackError {
  if (!query) return {};
  const error = query.get('error');
  const description = query.get('error_description');
  const uri = query.get('error_uri');
  const out: OauthCallbackError = {};
  if (error) out.error = error;
  if (description) out.description = description;
  if (uri) out.uri = uri;
  return out;
}

// ── Sanitization scopes (helper additif) ───────────────────────────────────
// Normalise scopes en array trimé + dédupliqué, sans casse aux callers.
export function sanitizeScopes(scopes: string | string[] | null | undefined): string[] {
  if (!scopes) return [];
  const arr = Array.isArray(scopes)
    ? scopes
    : scopes.split(/[\s,]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const t = String(s).trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
