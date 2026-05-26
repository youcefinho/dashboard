// ── Sprint 22 — Billing Stripe prod (E4 flag mock) — helpers (Phase B Manager-B)
//
// Helpers réutilisables pour le mode MOCK total (zéro appel api.stripe.com).
// Phase B Manager-B : remplit la logique HMAC SHA-256 v1 dans
// verifyStripeWebhookSignatureSaas (tolérance 300s, parse `t=...,v1=...`,
// constant-time compare). Les 3 autres helpers restent byte-identiques.
// L'idiome de tout handler mutateur : `if (!isStripeConfigured(env)) return mock`.
//
// ⚠️ DISTINCT de src/worker/billing.ts (webhook E4 marchand) — les refs mock
//    n'apparaissent JAMAIS dans payments/payment_events/refunds.

import type { Env } from '../types';

/** True si la clé secrète Stripe SaaS est bindée. En V1 on RESTE mock même si
 *  configured (cf. handlers qui renvoient reason='live_branch_locked'). */
export function isStripeConfigured(env: Env): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

/** Génère un identifiant client Stripe FACTICE pour le provisioning mock.
 *  Format `mock_cus_<clientIdSlice>` — never collides with real `cus_*`. */
export function buildMockStripeCustomer(clientId: string): string {
  return `mock_cus_${clientId.slice(0, 16)}`;
}

/** URL de portail Stripe FACTICE (jamais joignable réseau). Affichée à
 *  l'utilisateur dans le mode démo pour souligner que l'action est simulée. */
export function buildMockPortalUrl(agencyId: string): string {
  return `https://billing.intralys.local/portal/${agencyId}`;
}

export interface SignatureVerificationResult {
  /** true uniquement si HMAC v1 a réussi avec le bon secret. */
  verified: boolean;
  /** true si on est en mode démo (pas de secret bindé). */
  mock: boolean;
  reason?: 'no_secret' | 'invalid_signature' | 'no_signature_header' | 'timestamp_drift';
}

/**
 * Vérification de signature Stripe v1 (HMAC SHA-256, tolérance 300s).
 *
 * Header format Stripe : `t=<unix_ts>,v1=<hex>[,v1=<hex>...]` — plusieurs `v1`
 * possibles en rotation de secret. On recompute HMAC SHA-256 de
 * `${timestamp}.${rawBody}` avec `STRIPE_WEBHOOK_SECRET`, puis on compare
 * constant-time contre CHAQUE `v1=` fourni.
 *
 * Idiome mock :
 *   - Pas de `STRIPE_WEBHOOK_SECRET` → `{ verified:false, mock:true, reason:'no_secret' }`
 *     ⇒ le handler webhook accepte le payload en mode démo et le log avec
 *     `signature_verified=0`, `is_mock=1`.
 *   - Secret bindé mais pas de header `Stripe-Signature` →
 *     `{ verified:false, mock:false, reason:'no_signature_header' }` ⇒ 400 côté handler.
 *   - Secret + header mais drift t±300s → `timestamp_drift`.
 *   - Secret + header mais HMAC ne match aucun `v1=` → `invalid_signature`.
 */
export async function verifyStripeWebhookSignatureSaas(
  env: Env,
  rawBody: string,
  sigHeader: string | null,
): Promise<SignatureVerificationResult> {
  // Pas de secret bindé → mode démo, on accepte tout (handler tag is_mock=1).
  if (!env.STRIPE_WEBHOOK_SECRET) return { verified: false, mock: true, reason: 'no_secret' };
  // Secret bindé mais pas de header → suspect, refus net.
  if (!sigHeader) return { verified: false, mock: false, reason: 'no_signature_header' };

  // Parse `t=<ts>,v1=<hex>[,v1=<hex>...]`. On collecte le timestamp + tous les v1.
  let timestamp: string | null = null;
  const sigs: string[] = [];
  for (const rawPart of sigHeader.split(',')) {
    const eq = rawPart.indexOf('=');
    if (eq < 0) continue;
    const key = rawPart.slice(0, eq).trim();
    const val = rawPart.slice(eq + 1).trim();
    if (key === 't') timestamp = val;
    else if (key === 'v1') sigs.push(val);
  }
  if (!timestamp || sigs.length === 0) {
    return { verified: false, mock: false, reason: 'invalid_signature' };
  }

  // Tolérance 300s (calque officiel Stripe SDK).
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return { verified: false, mock: false, reason: 'timestamp_drift' };
  }

  // HMAC SHA-256 de `${timestamp}.${rawBody}` avec STRIPE_WEBHOOK_SECRET.
  const payload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expectedHex = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time compare contre CHAQUE v1 fourni (rotation de secret côté Stripe).
  for (const provided of sigs) {
    if (provided.length !== expectedHex.length) continue;
    let mismatch = 0;
    for (let i = 0; i < expectedHex.length; i++) {
      mismatch |= expectedHex.charCodeAt(i) ^ provided.charCodeAt(i);
    }
    if (mismatch === 0) return { verified: true, mock: false };
  }
  return { verified: false, mock: false, reason: 'invalid_signature' };
}
