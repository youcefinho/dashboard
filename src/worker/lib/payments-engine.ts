// ── Payments engine — Sprint P0-4 renforcement (2026-05-26) ────────────────
//
// Helpers PURS (zéro D1, zéro réseau provider) extraits/complémentaires à
// `ecommerce-payments.ts` pour :
//   - vérification signature webhook Stripe (HMAC SHA-256 — Web Crypto, pas
//     de dépendance npm). Calque exact `Stripe-Signature` header format.
//   - validation amount paiement vs total commande (exact match, pas de
//     sur/sous-paiement non géré).
//   - parsing payload webhook Stripe (event.type + data discrimination).
//   - clé d'idempotence déterministe (calque
//     `ecommerce-payments.buildIdempotencyKey`).
//
// Politique :
//   - Aucun helper ne throw — résultats `{ ok, error?, code? }`.
//   - 100% additif : le provider Stripe concret (`worker/payments/stripe.ts`,
//     M2) reste FIGÉ ; ces helpers sont à appeler depuis le provider OU les
//     tests croisés, sans modifier la signature publique du provider.
//   - ⚠️ ZONE RÉGULÉE — `verifyStripeSignature` est le SEUL chemin de
//     vérification d'authenticité. Toute modif = revue Rochdi requise.
//   - Mode live = inoffensif tant que `payment_provider_config.payments_live_enabled=0`
//     (handler décide). Ce module reste utilisable en test (clé sk_test_…).

// ── Constantes contrat ──────────────────────────────────────────────────────

/** Tolérance horloge pour la signature Stripe (5 minutes, calque Stripe SDK). */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/** Codes d'erreur stables (logs + audit + tests). */
export const PAYMENT_ERROR_CODES = {
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  SIGNATURE_EXPIRED: 'SIGNATURE_EXPIRED',
  MALFORMED_SIGNATURE_HEADER: 'MALFORMED_SIGNATURE_HEADER',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  OVERPAYMENT: 'OVERPAYMENT',
  UNDERPAYMENT: 'UNDERPAYMENT',
  INVALID_EVENT: 'INVALID_EVENT',
  UNKNOWN_EVENT_TYPE: 'UNKNOWN_EVENT_TYPE',
  EMPTY_PAYLOAD: 'EMPTY_PAYLOAD',
} as const;

export type PaymentErrorCode = typeof PAYMENT_ERROR_CODES[keyof typeof PAYMENT_ERROR_CODES];

// ── Stripe signature verification (HMAC SHA-256, Web Crypto) ────────────────

/**
 * Parse l'en-tête `Stripe-Signature` au format `t=<ts>,v1=<sig>,v1=<sig2>,...`.
 * Retourne `null` si malformé.
 */
function parseStripeSignatureHeader(header: string): {
  timestamp: number;
  signatures: string[];
} | null {
  if (typeof header !== 'string' || header.length === 0) return null;
  const parts = header.split(',').map((p) => p.trim()).filter(Boolean);
  let timestamp = 0;
  const signatures: string[] = [];
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx <= 0) return null;
    const k = p.slice(0, idx);
    const v = p.slice(idx + 1);
    if (k === 't') {
      const ts = parseInt(v, 10);
      if (!Number.isFinite(ts) || ts <= 0) return null;
      timestamp = ts;
    } else if (k === 'v1') {
      if (/^[0-9a-f]+$/i.test(v)) signatures.push(v.toLowerCase());
    }
    // v0 (test) et autres schémas ignorés volontairement.
  }
  if (timestamp === 0 || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/** Convertit un ArrayBuffer/Uint8Array en hex lowercase. */
function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    s += b.toString(16).padStart(2, '0');
  }
  return s;
}

/** Comparaison constante-temps (anti-timing-attack) sur deux strings hex. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Vérifie une signature Stripe webhook (HMAC SHA-256). Calque exact
 * `Stripe.webhooks.constructEvent` :
 *   1. Parse header `t=…,v1=…`.
 *   2. Recalcule HMAC SHA-256(`${t}.${payload}`, secret).
 *   3. Compare en temps constant contre les signatures v1 fournies.
 *   4. Vérifie tolérance horloge (≤ STRIPE_SIGNATURE_TOLERANCE_SECONDS).
 *
 * Retourne true UNIQUEMENT si la signature matche ET dans la fenêtre temporelle.
 * `now_ms` injectable pour tests déterministes (Date.now() par défaut).
 *
 * ⚠️ ZONE RÉGULÉE — toute modif = revue Rochdi requise.
 */
export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  now_ms: number = Date.now(),
  toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
  if (typeof payload !== 'string' || typeof secret !== 'string' || secret.length === 0) {
    return false;
  }
  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) return false;

  // Garde temporelle (tolérance ±5 min) — refuse les replays anciens.
  const nowSec = Math.floor(now_ms / 1000);
  if (Math.abs(nowSec - parsed.timestamp) > toleranceSeconds) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const expectedHex = bufToHex(sig);

  for (const candidate of parsed.signatures) {
    if (timingSafeEqualHex(expectedHex, candidate)) return true;
  }
  return false;
}

/** Variante détaillée qui distingue malformé / expiré / mauvaise signature. */
export async function verifyStripeSignatureDetailed(
  payload: string,
  signatureHeader: string,
  secret: string,
  now_ms: number = Date.now(),
  toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): Promise<{ ok: boolean; code?: PaymentErrorCode }> {
  if (typeof payload !== 'string' || typeof secret !== 'string' || secret.length === 0) {
    return { ok: false, code: PAYMENT_ERROR_CODES.INVALID_SIGNATURE };
  }
  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) {
    return { ok: false, code: PAYMENT_ERROR_CODES.MALFORMED_SIGNATURE_HEADER };
  }
  const nowSec = Math.floor(now_ms / 1000);
  if (Math.abs(nowSec - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, code: PAYMENT_ERROR_CODES.SIGNATURE_EXPIRED };
  }
  const ok = await verifyStripeSignature(payload, signatureHeader, secret, now_ms, toleranceSeconds);
  return ok ? { ok: true } : { ok: false, code: PAYMENT_ERROR_CODES.INVALID_SIGNATURE };
}

// ── Amount validation ──────────────────────────────────────────────────────

/**
 * Valide qu'un montant payé correspond EXACTEMENT au total commande.
 * Refuse over/underpayment (politique stricte projet : pas de tolérance,
 * la commande doit être réglée à l'unité de cent près).
 *
 * NB : si un futur produit demande "tip" ou "rounding fee", il faudra ajouter
 * un paramètre tolerance — pour l'instant : strict.
 */
export function validatePaymentAmount(
  orderTotalCents: number,
  paidCents: number,
): { ok: boolean; code?: PaymentErrorCode; delta?: number } {
  if (!Number.isFinite(orderTotalCents) || !Number.isFinite(paidCents)) {
    return { ok: false, code: PAYMENT_ERROR_CODES.AMOUNT_MISMATCH };
  }
  if (!Number.isInteger(orderTotalCents) || !Number.isInteger(paidCents)) {
    return { ok: false, code: PAYMENT_ERROR_CODES.AMOUNT_MISMATCH };
  }
  if (orderTotalCents < 0 || paidCents < 0) {
    return { ok: false, code: PAYMENT_ERROR_CODES.AMOUNT_MISMATCH };
  }
  const delta = paidCents - orderTotalCents;
  if (delta === 0) return { ok: true };
  if (delta > 0) return { ok: false, code: PAYMENT_ERROR_CODES.OVERPAYMENT, delta };
  return { ok: false, code: PAYMENT_ERROR_CODES.UNDERPAYMENT, delta };
}

// ── Stripe webhook payload parsing ─────────────────────────────────────────

/** Subset Stripe.Event minimal qui nous intéresse (zéro dep SDK). */
export interface StripeEventLike {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
  created?: number;
}

/** Liste blanche des event types qu'on traite (M2 — branche transition E4). */
export const HANDLED_STRIPE_EVENT_TYPES: readonly string[] = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'payment_intent.requires_action',
  'charge.refunded',
  'charge.dispute.created',
];

export interface ParsedStripeWebhook {
  ok: boolean;
  code?: PaymentErrorCode;
  type?: string;
  data?: Record<string, unknown>;
  /** Hint discriminant pour le dispatcher : 'transition' | 'refund' | 'dispute'. */
  kind?: 'transition' | 'refund' | 'dispute';
}

/**
 * Parse + valide un objet event Stripe (issu de `JSON.parse(payload)` après
 * vérif signature). Discrimine la cible :
 *   - payment_intent.* → kind='transition' (M1 branche existante).
 *   - charge.refunded   → kind='refund'    (M2 refunds).
 *   - charge.dispute.*  → kind='dispute'   (M2 disputes).
 *
 * NE valide PAS la signature (à faire AVANT via verifyStripeSignature).
 * NE valide PAS le contenu data.object en profondeur (laissé au provider).
 */
export function parseStripeWebhook(event: unknown): ParsedStripeWebhook {
  if (!event || typeof event !== 'object') {
    return { ok: false, code: PAYMENT_ERROR_CODES.EMPTY_PAYLOAD };
  }
  const ev = event as StripeEventLike;
  if (typeof ev.type !== 'string' || ev.type.length === 0) {
    return { ok: false, code: PAYMENT_ERROR_CODES.INVALID_EVENT };
  }
  if (!ev.data || typeof ev.data !== 'object' || !ev.data.object) {
    return { ok: false, code: PAYMENT_ERROR_CODES.INVALID_EVENT };
  }
  if (!HANDLED_STRIPE_EVENT_TYPES.includes(ev.type)) {
    return { ok: false, code: PAYMENT_ERROR_CODES.UNKNOWN_EVENT_TYPE, type: ev.type };
  }
  let kind: 'transition' | 'refund' | 'dispute' = 'transition';
  if (ev.type === 'charge.refunded') kind = 'refund';
  else if (ev.type === 'charge.dispute.created') kind = 'dispute';
  return { ok: true, type: ev.type, data: ev.data.object, kind };
}

// ── Idempotency key ────────────────────────────────────────────────────────

/**
 * Clé d'idempotence déterministe pour une intention de paiement.
 * Format : `<order_id>:<attempt>` (attempt par défaut = 1).
 *
 * Calque `ecommerce-payments.buildIdempotencyKey` (`orderId:method:amount`)
 * — celui-ci est plus simple (sans method/amount) pour les call sites où
 * une retry séquentielle volontaire est attendue (incrémenter attempt).
 *
 * NB : si la commande change de montant, il FAUT incrémenter attempt pour
 * éviter qu'on récupère l'intention précédente (qui aura un mauvais amount).
 */
export function idempotencyKey(orderId: unknown, attempt: unknown = 1): string {
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return '';
  }
  const id = orderId.trim();
  const att = Number(attempt);
  const a = Number.isFinite(att) && att >= 1 && Number.isInteger(att) ? att : 1;
  return `${id}:${a}`;
}
