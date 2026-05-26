// ── meta-engine.ts — helpers PURS pour LOT META (Integrations P2-4) ────────
//
// Engine helpers RENFORCEMENT pour meta.ts. ZÉRO I/O DB. Une seule dépendance
// crypto WebCrypto pour la vérification HMAC SHA-256 du webhook Meta
// (X-Hub-Signature-256). Toutes les fonctions sont déterministes et testables.
//
// Périmètre :
//   - Codes d'erreur stables + scopes OAuth Meta figés (whitelist).
//   - Validation du paramètre `state` (anti-CSRF — 32+ chars hex).
//   - Vérification de la signature webhook X-Hub-Signature-256 (HMAC SHA-256
//     timing-safe via `verifyMetaSignature` côté meta-leadgen mais ici on
//     fournit une version pure réutilisable).
//   - Validation page_id / ig_business_id (Meta : digits, longueur bornée).
//   - Parsing tolérant d'un événement webhook Meta (page : messaging | leadgen).
//
// 100% additif : meta.ts continue de fonctionner sans cet engine. Les
// handlers peuvent l'appeler EN AMONT pour valider AVANT toute requête DB
// ou tout appel à graph.facebook.com.

// ── Codes d'erreur stables ──────────────────────────────────────────────────
export const META_ERROR_CODES = Object.freeze({
  STATE_INVALID: 'meta.state.invalid',
  STATE_MISSING: 'meta.state.missing',
  PAGE_ID_INVALID: 'meta.page_id.invalid',
  IG_ID_INVALID: 'meta.ig_id.invalid',
  SIGNATURE_INVALID: 'meta.signature.invalid',
  SIGNATURE_MISSING: 'meta.signature.missing',
  APP_SECRET_MISSING: 'meta.app_secret.missing',
  WEBHOOK_BODY_INVALID: 'meta.webhook.body_invalid',
  WEBHOOK_OBJECT_UNSUPPORTED: 'meta.webhook.object_unsupported',
} as const);

// ── Scopes OAuth Meta (figés v18.0) ─────────────────────────────────────────
// Whitelist appliquée par les handlers d'autorisation. Tout scope demandé
// hors de cette liste doit être refusé en amont (compliance Meta).
export const META_OAUTH_SCOPES = Object.freeze([
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_messaging',
  'pages_show_list',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_content_publish',
  'leads_retrieval',
  'business_management',
] as const);
export type MetaScope = (typeof META_OAUTH_SCOPES)[number];

// Bornes raisonnables pour validation IDs Meta (Graph API).
export const MIN_STATE_LENGTH = 32;
export const MAX_STATE_LENGTH = 128;
export const MIN_META_ID_LENGTH = 8; // page/ig ids historiques
export const MAX_META_ID_LENGTH = 32;

// ── State CSRF (anti-CSRF OAuth Meta) ───────────────────────────────────────
// Validation pure : 32+ chars, hexadécimal (lowercase OU uppercase OU mixed).
// On accepte aussi un format opaque tant qu'il fait au moins 32 chars
// alphanumériques (calque la concat de 2 randomUUID — voir oauth.ts:243).
export function validateMetaState(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  if (state.length < MIN_STATE_LENGTH || state.length > MAX_STATE_LENGTH) return false;
  // Hex strict OU alphanumérique opaque (URL-safe base subset).
  return /^[A-Za-z0-9_-]+$/.test(state);
}

// ── Validation IDs Meta (page_id, ig_business_id) ──────────────────────────
// Meta = identifiants numériques (chaînes de digits 8-32 chars typiquement).
export function validatePageId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  if (id.length < MIN_META_ID_LENGTH || id.length > MAX_META_ID_LENGTH) return false;
  return /^[0-9]+$/.test(id);
}

export function validateIgId(id: unknown): boolean {
  // Même grammaire que page_id côté Graph API.
  return validatePageId(id);
}

// ── Vérification signature webhook Meta (X-Hub-Signature-256) ───────────────
// HMAC SHA-256 du body brut avec META_APP_SECRET en clé. Comparaison
// timing-safe via comparaison byte-à-byte after-XOR (Web Crypto pur).
// Format attendu de l'en-tête : "sha256=<hex>" (insensible à la casse hex).
//
// Retourne :
//   - true si signature valide
//   - false si signature présente mais invalide
//   - null si appSecret absent (caller doit logguer warn + continuer legacy)
export async function verifyMetaWebhookSignature(
  payload: string,
  sigHeader: string | null | undefined,
  appSecret: string | null | undefined,
): Promise<boolean | null> {
  if (!appSecret) return null;
  if (typeof sigHeader !== 'string' || sigHeader.length === 0) return false;

  // Format "sha256=<hex>" — on extrait la partie hex, insensible à la casse
  // sur le préfixe (Meta envoie en lowercase mais on est tolérant).
  const match = /^sha256=([0-9a-fA-F]+)$/i.exec(sigHeader.trim());
  if (!match) return false;
  const providedHex = match[1]!.toLowerCase();

  // HMAC SHA-256(payload, appSecret) → hex
  const encoder = new TextEncoder();
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(appSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    return false;
  }
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expectedHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqualHex(providedHex, expectedHex);
}

// ── Comparaison hex timing-safe (constant-time sur même longueur) ──────────
// Évite les attaques timing sur la comparaison de signatures.
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── Parsing d'un événement webhook Meta (page : messaging | leadgen) ───────
// Best-effort : renvoie kind 'unknown' si l'objet n'est pas reconnu.
// Ne lève JAMAIS — on protège les handlers d'un body malformé.
export type MetaWebhookKind = 'messaging' | 'leadgen' | 'unknown';
export interface MetaWebhookParseResult {
  kind: MetaWebhookKind;
  data: Array<{ pageId: string; payload: unknown; subKind: 'messaging' | 'leadgen' }>;
  error?: string;
}

export function parseMetaWebhookEvent(body: unknown): MetaWebhookParseResult {
  if (!body || typeof body !== 'object') {
    return { kind: 'unknown', data: [], error: META_ERROR_CODES.WEBHOOK_BODY_INVALID };
  }
  const b = body as Record<string, unknown>;
  if (b.object !== 'page') {
    return { kind: 'unknown', data: [], error: META_ERROR_CODES.WEBHOOK_OBJECT_UNSUPPORTED };
  }
  const entries = Array.isArray(b.entry) ? b.entry : [];
  const out: MetaWebhookParseResult['data'] = [];
  let hasMessaging = false;
  let hasLeadgen = false;

  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const entry = e as Record<string, unknown>;
    const pageId = typeof entry.id === 'string' ? entry.id : '';
    if (!pageId) continue;

    // Branch leadgen (entry.changes[].field === 'leadgen').
    if (Array.isArray(entry.changes)) {
      for (const c of entry.changes) {
        if (!c || typeof c !== 'object') continue;
        const change = c as Record<string, unknown>;
        if (change.field === 'leadgen' && change.value) {
          hasLeadgen = true;
          out.push({ pageId, payload: change.value, subKind: 'leadgen' });
        }
      }
    }

    // Branch messaging (entry.messaging[]).
    if (Array.isArray(entry.messaging)) {
      for (const m of entry.messaging) {
        if (!m || typeof m !== 'object') continue;
        hasMessaging = true;
        out.push({ pageId, payload: m, subKind: 'messaging' });
      }
    }
  }

  const kind: MetaWebhookKind = hasLeadgen && !hasMessaging
    ? 'leadgen'
    : hasMessaging && !hasLeadgen
      ? 'messaging'
      : out.length > 0
        ? 'messaging' // mixed → on garde le sub-kind par item
        : 'unknown';

  return { kind, data: out };
}

// ── Validation des scopes demandés contre la whitelist Meta ────────────────
export function validateRequestedMetaScopes(scopes: string): {
  ok: boolean;
  invalid?: string[];
} {
  if (typeof scopes !== 'string' || scopes.length === 0) return { ok: false, invalid: [] };
  const list = scopes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return { ok: false, invalid: [] };
  const whitelist = META_OAUTH_SCOPES as readonly string[];
  const invalid = list.filter((s) => !whitelist.includes(s));
  return invalid.length === 0 ? { ok: true } : { ok: false, invalid };
}
