// ── webhooks-engine.ts — helpers PURS pour LOT WEBHOOKS (Integrations P2-4) ─
//
// Engine helpers RENFORCEMENT pour webhooks-dispatch.ts + webhooks-queue.ts.
// ZÉRO I/O DB. Une seule dépendance crypto WebCrypto pour HMAC SHA-256.
// Toutes les fonctions sont déterministes et testables.
//
// Périmètre :
//   - Signature webhook style Stripe : `t=<ts>,v1=<hmac>` (timing-safe).
//   - Vérification signature avec tolérance temporelle (anti-replay).
//   - Backoff exponentiel borné (cap 1 h).
//   - Validation URL webhook (https only, pas de localhost en prod).
//   - Validation event subscription contre une whitelist.
//   - Clé d'idempotence pour deliveries (subscription_id + event_id).
//
// 100% additif : webhooks-dispatch.ts garde sa version simple
// (`generateWebhookSignature` / `verifyWebhookSignature`). Cet engine
// fournit une variante plus stricte (timestamp + tolerance) et des helpers
// orthogonaux. Migration facultative côté handlers.

// ── Codes d'erreur stables ──────────────────────────────────────────────────
export const WEBHOOKS_ERROR_CODES = Object.freeze({
  URL_INVALID: 'webhooks.url.invalid',
  URL_NOT_HTTPS: 'webhooks.url.not_https',
  URL_LOCALHOST: 'webhooks.url.localhost',
  EVENT_INVALID: 'webhooks.event.invalid',
  EVENTS_EMPTY: 'webhooks.events.empty',
  SIGNATURE_INVALID: 'webhooks.signature.invalid',
  SIGNATURE_MISSING: 'webhooks.signature.missing',
  SIGNATURE_EXPIRED: 'webhooks.signature.expired',
  SECRET_MISSING: 'webhooks.secret.missing',
} as const);

// ── Constantes ──────────────────────────────────────────────────────────────
export const MAX_RETRIES = 10;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const DEFAULT_TOLERANCE_SECONDS = 300; // 5 min — calque Stripe
export const MAX_BACKOFF_MS = 3_600_000; // 1 heure
export const INITIAL_BACKOFF_MS = 1_000; // 1 seconde
export const MAX_URL_LENGTH = 2048;

// ── Whitelist event types — étendre via PR explicite ──────────────────────
// Liste indicative (sous-domaines CRM/booking/ecommerce/social/etc).
// On accepte le wildcard '*' pour tout-souscrire.
export const VALID_EVENT_PREFIXES = Object.freeze([
  'lead',
  'contact',
  'task',
  'booking',
  'appointment',
  'message',
  'conversation',
  'order',
  'product',
  'invoice',
  'payment',
  'refund',
  'subscription',
  'social',
  'form',
  'funnel',
  'webhook',
  'survey',
  'campaign',
  'pipeline',
] as const);

// ── Génération signature (style Stripe : t=<ts>,v1=<hmac>) ─────────────────
// payload signé = `${ts}.${payload}` (anti-replay : le timestamp est
// inclus dans le calcul HMAC, le receiver doit vérifier la fraîcheur).
export async function generateSignature(
  payload: string,
  secret: string,
  ts: number,
): Promise<string> {
  if (typeof payload !== 'string') {
    throw new TypeError('payload must be a string');
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TypeError('secret must be a non-empty string');
  }
  if (!Number.isFinite(ts) || ts <= 0) {
    throw new TypeError('ts must be a positive number');
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = encoder.encode(`${ts}.${payload}`);
  const sigBuf = await crypto.subtle.sign('HMAC', key, data);
  const hex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${ts},v1=${hex}`;
}

// ── Parsing d'un en-tête signature ─────────────────────────────────────────
// Accepte plusieurs schemes v1=<hex> (rotation des secrets) — on retourne
// tous les hashes v1.
export interface ParsedSignature {
  ts?: number;
  v1: string[];
}
export function parseSignatureHeader(header: string | null | undefined): ParsedSignature | null {
  if (typeof header !== 'string' || header.length === 0) return null;
  const parts = header.split(',').map((p) => p.trim()).filter(Boolean);
  const out: ParsedSignature = { v1: [] };
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (!value) continue;
    if (key === 't') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) out.ts = n;
    } else if (key === 'v1') {
      if (/^[0-9a-fA-F]+$/.test(value)) out.v1.push(value.toLowerCase());
    }
  }
  if (out.v1.length === 0 || out.ts === undefined) return null;
  return out;
}

// ── Vérification signature (timing-safe + tolerance) ───────────────────────
// Retourne true si UN AU MOINS des hashes v1 matche ET le timestamp est dans
// la tolérance (anti-replay). Tolerance en secondes (défaut 300s = 5 min).
export async function verifySignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  toleranceSec = DEFAULT_TOLERANCE_SECONDS,
  now: Date = new Date(),
): Promise<boolean> {
  if (typeof secret !== 'string' || secret.length === 0) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed || parsed.ts === undefined) return false;

  // Tolerance check (anti-replay).
  const nowSec = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSec - parsed.ts) > toleranceSec) return false;

  // Recompute expected.
  const expectedFull = await generateSignature(payload, secret, parsed.ts);
  // expectedFull = "t=<ts>,v1=<hex>" — on extrait juste le hex.
  const m = /v1=([0-9a-fA-F]+)/.exec(expectedFull);
  if (!m) return false;
  const expected = m[1]!.toLowerCase();

  for (const candidate of parsed.v1) {
    if (timingSafeEqualHex(candidate, expected)) return true;
  }
  return false;
}

// ── Comparaison hex timing-safe ────────────────────────────────────────────
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── Backoff exponentiel borné ──────────────────────────────────────────────
// attemptN = 0 → INITIAL_BACKOFF_MS, 1 → 2x, 2 → 4x, ... cap à MAX_BACKOFF_MS.
// Tolérant aux attemptN négatifs / non-finite (retourne INITIAL_BACKOFF_MS).
export function computeRetryDelay(attemptN: number): number {
  if (!Number.isFinite(attemptN) || attemptN <= 0) return INITIAL_BACKOFF_MS;
  // Cap à 30 pour éviter overflow Math.pow.
  const n = Math.min(Math.floor(attemptN), 30);
  const delay = INITIAL_BACKOFF_MS * Math.pow(2, n);
  return Math.min(delay, MAX_BACKOFF_MS);
}

// ── Validation URL webhook ─────────────────────────────────────────────────
// Règles :
//   - URL valide + longueur bornée.
//   - https only en prod (allowHttp option pour dev).
//   - Pas de localhost / 127.0.0.1 / ::1 en prod.
//   - Pas d'IP privée 10.*, 172.16-31.*, 192.168.* (anti-SSRF).
export function validateWebhookUrl(
  url: unknown,
  options: { allowHttp?: boolean; allowLocalhost?: boolean } = {},
): { ok: boolean; error?: string } {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) {
    return { ok: false, error: WEBHOOKS_ERROR_CODES.URL_INVALID };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: WEBHOOKS_ERROR_CODES.URL_INVALID };
  }
  const allowHttp = options.allowHttp === true;
  const allowLocalhost = options.allowLocalhost === true;
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && allowHttp)) {
    return { ok: false, error: WEBHOOKS_ERROR_CODES.URL_NOT_HTTPS };
  }
  const host = parsed.hostname.toLowerCase();
  const isLocalhost =
    host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocalhost && !allowLocalhost) {
    return { ok: false, error: WEBHOOKS_ERROR_CODES.URL_LOCALHOST };
  }
  // Anti-SSRF : refuse les IP privées (sauf si allowLocalhost=true pour dev).
  if (!allowLocalhost && isPrivateIPv4(host)) {
    return { ok: false, error: WEBHOOKS_ERROR_CODES.URL_LOCALHOST };
  }
  return { ok: true };
}

// Détection IP privée IPv4 (anti-SSRF).
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

// ── Validation event subscription ──────────────────────────────────────────
// Accepte un tableau de events au format "<prefix>.<action>" OU '*' (wildcard).
// Le préfixe doit être dans VALID_EVENT_PREFIXES.
export function validateEventSubscription(
  events: unknown,
): { ok: boolean; error?: string; invalid?: string[] } {
  if (events === '*') return { ok: true };
  if (typeof events === 'string') {
    return validateEventSubscription([events]);
  }
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, error: WEBHOOKS_ERROR_CODES.EVENTS_EMPTY };
  }
  const invalid: string[] = [];
  const whitelist = VALID_EVENT_PREFIXES as readonly string[];
  for (const e of events) {
    if (typeof e !== 'string' || e.length === 0) {
      invalid.push(String(e));
      continue;
    }
    if (e === '*') continue;
    // Format "<prefix>.<action>" — on vérifie le prefix.
    const dot = e.indexOf('.');
    if (dot <= 0) {
      invalid.push(e);
      continue;
    }
    const prefix = e.slice(0, dot);
    const action = e.slice(dot + 1);
    if (!whitelist.includes(prefix) || action.length === 0) {
      invalid.push(e);
      continue;
    }
    if (!/^[a-z0-9_]+$/i.test(action)) {
      invalid.push(e);
      continue;
    }
  }
  if (invalid.length > 0) {
    return { ok: false, error: WEBHOOKS_ERROR_CODES.EVENT_INVALID, invalid };
  }
  return { ok: true };
}

// ── Clé d'idempotence pour delivery ────────────────────────────────────────
// Format stable : `<webhookId>:<eventId>` — utilisable comme PK pour
// déduplication. Inputs vides ⇒ chaîne vide (caller doit gérer).
export function idempotencyKeyForDelivery(
  webhookId: unknown,
  eventId: unknown,
): string {
  const w = typeof webhookId === 'string' ? webhookId.trim() : '';
  const e = typeof eventId === 'string' ? eventId.trim() : '';
  if (!w || !e) return '';
  return `${w}:${e}`;
}
