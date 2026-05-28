// ── Sprint E4 M2 — Provider Stripe (Checkout hébergé tokenisé) ──────────────
//
// ⚠️ FRONTIÈRE RÉGULÉE — provider de paiement marchand e-commerce (B2).
// DISTINCT de src/worker/billing.ts (abo SaaS — INTOUCHABLE, mock, signature
// NON vérifiée). Ici la signature webhook est VRAIMENT vérifiée (HMAC-SHA256
// WebCrypto), et la carte ne touche JAMAIS notre code.
//
// PCI minimal — RÈGLE NON NÉGOCIABLE :
//   - Aucune donnée carte (PAN/CVV/expiry) ne transite/stocke ici.
//   - On crée une **Checkout Session HÉBERGÉE** Stripe (mode payment) : le
//     client saisit sa carte SUR LE DOMAINE STRIPE (session.url), pas chez
//     nous. On ne manipule que des références opaques (session.id / pi id).
//
// Pas de SDK Node Stripe (runtime Workers) → fetch direct vers l'API Stripe +
// vérif HMAC `Stripe-Signature` via WebCrypto (SubtleCrypto).
//
// Flag de sûreté : `payment_provider_config.payments_live_enabled` défaut 0.
//   - Tant que non activé (=0) → on EXIGE une clé `sk_test_` (sandbox). Si la
//     clé bindée n'est pas une clé test, on refuse (aucun fonds réel possible).
//   - Live (=1 + mode 'live') → balise ⚠️ ZONE RÉGULÉE (revue Rochdi requise).

import type { Env } from '../types';
import type {
  PaymentStatus,
  PaymentCapabilities,
  RegionContext,
} from '../../lib/types';
import type { PaymentProvider, PaymentOrderRef } from '../ecommerce-payments';
// P1 sécurité (2026-05-28) — vérification signature webhook Stripe centralisée
// dans payments-engine (HMAC SHA-256 WebCrypto + timing-safe compare identique,
// mais now_ms injectable pour tests déterministes). Revue Rochdi : GO 2026-05-28.
import { verifyStripeSignature } from '../lib/payments-engine';

// ════════════════════════════════════════════════════════════════════════════
// M2.1 — Client Stripe bas niveau (fetch, JAMAIS de SDK Node)
// ════════════════════════════════════════════════════════════════════════════

const STRIPE_API = 'https://api.stripe.com/v1';

/** Config provider Stripe du tenant (réfs opaques uniquement — pas de secret). */
interface StripeTenantConfig {
  /** Stripe Connect : compte connecté marchand (header Stripe-Account). */
  connect_account_ref: string | null;
  /** true seulement si explicitement activé en DB (défaut 0). */
  live_enabled: boolean;
  mode: 'test' | 'live';
}

/**
 * Lit la config Stripe du tenant depuis `payment_provider_config`.
 * `connect_account_ref` = réf compte externe OPAQUE (jamais de PAN/secret).
 * `payments_live_enabled` défaut 0 → sandbox tant que non explicitement posé.
 */
async function loadStripeTenantConfig(
  env: Env,
  clientId: string,
): Promise<StripeTenantConfig> {
  const row = (await env.DB.prepare(
    `SELECT mode, payments_live_enabled, connect_account_ref
       FROM payment_provider_config
      WHERE client_id = ? AND provider = 'stripe'
      ORDER BY updated_at DESC
      LIMIT 1`,
  )
    .bind(clientId)
    .first()) as
    | {
        mode: string | null;
        payments_live_enabled: number | null;
        connect_account_ref: string | null;
      }
    | null;

  const liveEnabled = (row?.payments_live_enabled ?? 0) === 1;
  // mode 'live' effectif UNIQUEMENT si le flag de sûreté est aussi posé.
  const mode: 'test' | 'live' =
    liveEnabled && row?.mode === 'live' ? 'live' : 'test';

  return {
    connect_account_ref: row?.connect_account_ref ?? null,
    live_enabled: liveEnabled,
    mode,
  };
}

/** Erreur normalisée d'appel Stripe (réseau / HTTP / API). */
export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly stripeCode?: string,
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

/**
 * Résout la clé secrète Stripe à utiliser et la valide vs le flag de sûreté.
 *
 * ⚠️ ZONE RÉGULÉE — revue Rochdi requise (sélection clé live).
 * Garde-fou PCI/finances : tant que payments_live_enabled=0 (défaut), on
 * EXIGE une clé `sk_test_*` (sandbox). Une clé live avec le flag à 0 est
 * REFUSÉE → aucun fonds réel ne peut transiter par erreur de config.
 */
function resolveStripeSecret(env: Env, cfg: StripeTenantConfig): string {
  const key = (env.STRIPE_SECRET_KEY || '').trim();
  if (!key) {
    throw new StripeError('Clé secrète Stripe absente (binding Wrangler).', 503);
  }
  const isTestKey = key.startsWith('sk_test_');
  const isLiveKey = key.startsWith('sk_live_');

  if (cfg.mode === 'live' && cfg.live_enabled) {
    // ⚠️ ZONE RÉGULÉE — chemin LIVE (fonds réels). Revue Rochdi requise.
    if (!isLiveKey) {
      throw new StripeError(
        'Mode live demandé mais la clé bindée n\'est pas une clé live Stripe.',
        503,
      );
    }
    return key;
  }

  // Sandbox/test (défaut sûr) : on refuse une clé live tant que non activé.
  if (!isTestKey) {
    throw new StripeError(
      'Sandbox actif (payments_live_enabled=0) : une clé sk_test_ est requise.',
      503,
    );
  }
  return key;
}

/** Encode un objet plat/imbriqué en x-www-form-urlencoded façon Stripe. */
function encodeStripeForm(
  params: Record<string, unknown>,
  out = new URLSearchParams(),
  prefix = '',
): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          encodeStripeForm(item as Record<string, unknown>, out, `${key}[${i}]`);
        } else {
          out.append(`${key}[${i}]`, String(item));
        }
      });
    } else if (typeof v === 'object') {
      encodeStripeForm(v as Record<string, unknown>, out, key);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

/**
 * Appel bas niveau de l'API Stripe.
 *
 * - Auth `Authorization: Bearer <sk_*>` (clé test/live selon flag de sûreté).
 * - `Idempotency-Key` (idempotence Stripe — réutilise l'intention existante).
 * - `Stripe-Account: <connect_account_ref>` si Stripe Connect configuré.
 * - Corps `application/x-www-form-urlencoded` (format natif API Stripe).
 * - Gestion propre réseau (TypeError fetch) / HTTP non-2xx / parse JSON.
 *
 * AUCUNE donnée carte n'est jamais envoyée ici (Checkout hébergé : la carte
 * est saisie côté Stripe, pas chez nous).
 */
async function stripeFetch(
  env: Env,
  clientId: string,
  path: string,
  params: Record<string, unknown>,
  opts: { idempotencyKey?: string } = {},
): Promise<Record<string, unknown>> {
  const cfg = await loadStripeTenantConfig(env, clientId);
  const secret = resolveStripeSecret(env, cfg);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  // Stripe Connect : opère pour le compte du marchand connecté (réf opaque).
  if (cfg.connect_account_ref) headers['Stripe-Account'] = cfg.connect_account_ref;

  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}${path}`, {
      method: 'POST',
      headers,
      body: encodeStripeForm(params).toString(),
    });
  } catch {
    // Erreur réseau (fetch rejette) — pas de double-charge : Stripe-Idempotency
    // protège un éventuel retry ultérieur avec la même clé.
    throw new StripeError('Erreur réseau lors de l\'appel Stripe.', 502);
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new StripeError(`Réponse Stripe illisible (HTTP ${res.status}).`, 502);
  }

  if (!res.ok) {
    const err = (data.error || {}) as { message?: string; code?: string };
    throw new StripeError(
      err.message || `Stripe a refusé la requête (HTTP ${res.status}).`,
      res.status,
      err.code,
    );
  }
  return data;
}

// ════════════════════════════════════════════════════════════════════════════
// M2.2 / M2.3 — Provider Stripe (Checkout hébergé + webhook signé)
// ════════════════════════════════════════════════════════════════════════════

/** URLs de retour Checkout (succès/annulation). Stripe substitue {CHECKOUT_SESSION_ID}. */
function checkoutReturnUrls(order: PaymentOrderRef): {
  success_url: string;
  cancel_url: string;
} {
  // Réf opaque uniquement (session id substitué par Stripe) — pas de donnée
  // sensible dans l'URL. Le front lira l'état réel via le webhook signé.
  const base = `https://app.intralys.io/store/order/${order.id}`;
  return {
    success_url: `${base}?pay=ok&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}?pay=cancel`,
  };
}



export const stripeProvider: PaymentProvider = {
  id: 'stripe',

  /**
   * Stripe : carte (+ wallets, gérés nativement par Checkout sans data carte
   * chez nous) sur EUR/CAD. JAMAIS DZD (resolvePaymentProvider route DZD vers
   * dz_gateway de toute façon — défense en profondeur).
   */
  capabilities(_ctx: RegionContext): PaymentCapabilities {
    return {
      methods: ['card'],
      currencies: ['EUR', 'CAD'],
    };
  },

  /**
   * Crée une **Checkout Session HÉBERGÉE** (mode payment). La carte est saisie
   * sur le domaine Stripe (session.url) — JAMAIS chez nous (PCI minimal).
   * Idempotent via `idemKey` (Stripe réutilise la session pour la même clé).
   *
   * ⚠️ ZONE RÉGULÉE — création paiement (revue Rochdi requise avant live).
   * Inoffensif tant que payments_live_enabled=0 : clé sk_test_ forcée, donc
   * aucune session ne capture de fonds réels (sandbox Stripe).
   */
  async createPayment(
    env: Env,
    order: PaymentOrderRef,
    _ctx: RegionContext,
    idemKey: string,
  ): Promise<{ provider_ref: string; redirect_url?: string; status: PaymentStatus }> {
    const urls = checkoutReturnUrls(order);
    const amount = Math.max(0, Math.round(order.total_cents || 0));

    // Un seul line_item agrégé (montant total commande) — aucune donnée carte,
    // aucun détail sensible. Le détail panier reste côté E3 (commande).
    const params: Record<string, unknown> = {
      mode: 'payment',
      client_reference_id: order.id, // ← retrouvé tel quel dans le webhook
      success_url: urls.success_url,
      cancel_url: urls.cancel_url,
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': order.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': amount,
      'line_items[0][price_data][product_data][name]': `Commande ${order.id}`,
      // Rattache la commande au PaymentIntent (traçabilité, réf opaque only).
      'payment_intent_data[metadata][order_id]': order.id,
      'payment_intent_data[metadata][client_id]': order.client_id,
    };
    if (order.email) params.customer_email = order.email;

    // ⚠️ ZONE RÉGULÉE — appel création paiement. stripeFetch impose la clé
    // sk_test_ tant que payments_live_enabled=0 (sandbox, zéro fonds réel).
    const session = await stripeFetch(
      env,
      order.client_id,
      '/checkout/sessions',
      params,
      { idempotencyKey: idemKey },
    );

    const sessionId = String(session.id || '');
    const url = session.url ? String(session.url) : undefined;
    if (!sessionId) {
      throw new StripeError('Stripe n\'a pas renvoyé d\'identifiant de session.', 502);
    }

    // Statut 'pending' : la commande reste 'unpaid' jusqu'au webhook signé
    // (recordPaymentTransition M1 ne commit QUE sur 'paid').
    return { provider_ref: sessionId, redirect_url: url, status: 'pending' };
  },

  /**
   * Vérifie la SIGNATURE Stripe (HMAC-SHA256 WebCrypto + tolérance timestamp)
   * — VRAIE vérif, ≠ mock billing.ts:88. Signature KO / event non pertinent →
   * `null` (M1 répond 400 ou ignore, AUCUN effet DB).
   *
   * Mapping (contrat figé) :
   *   - checkout.session.completed (payment_status=paid)        → 'paid'
   *   - checkout.session.async_payment_succeeded                → 'paid'
   *   - checkout.session.async_payment_failed / .expired        → 'failed'
   *   - payment_intent.succeeded (paiement direct, sans session) → 'paid'
   *   - payment_intent.payment_failed                            → 'failed'
   *   - autres                                                   → null
   *
   * `payment_ref` = la **Checkout Session id**, car c'est EXACTEMENT ce que
   * M1 `handleInitPayment` stocke dans `payments.provider_ref` à l'init
   * (created.provider_ref = session.id). recordPaymentTransition (M1) relie la
   * transition à NOTRE ligne via `provider_ref = ? AND order_id = ?` : on doit
   * donc renvoyer la session id (pas le PaymentIntent id) pour matcher. Stripe
   * envoie toujours `checkout.session.*` pour une Checkout Session (succès ET
   * échec async) → on s'appuie sur ces events (qui portent la session id), pas
   * sur les events `payment_intent.*` bruts (pas de session id dans l'objet).
   *
   * ⚠️ ZONE RÉGULÉE — webhook live (transition financière). Inoffensif tant
   * que payments_live_enabled=0 (aucune commande réelle marquée payée).
   */
  async handleWebhook(
    env: Env,
    request: Request,
  ): Promise<{ order_id: string; payment_ref: string; status: PaymentStatus } | null> {
    const rawBody = await request.text();
    const sigHeader = request.headers.get('Stripe-Signature');
    const secret = (env.STRIPE_WEBHOOK_SECRET || '').trim();

    // Authentification du webhook = signature vérifiée (jamais confiance au
    // payload sinon). KO → null (M1 : 400, aucune transition).
    const ok = await verifyStripeSignature(rawBody, sigHeader || '', secret);
    if (!ok) return null;

    let event: {
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const type = event.type || '';
    const obj = event.data?.object || {};

    // ── Events Checkout Session ──────────────────────────────────────────
    // `obj.id` = session id = EXACTEMENT le provider_ref stocké par M1 à
    // l'init (created.provider_ref = session.id) → recordPaymentTransition
    // retrouve NOTRE ligne via provider_ref AND order_id. `payment_ref` doit
    // donc être la session id, PAS le PaymentIntent id.
    if (
      type === 'checkout.session.completed' ||
      type === 'checkout.session.async_payment_succeeded'
    ) {
      // Ne marquer payé QUE si le paiement est réellement réglé.
      const paid =
        obj.payment_status === 'paid' || obj.status === 'complete';
      const orderId = String(obj.client_reference_id || '');
      const sessionId = String(obj.id || '');
      if (!orderId || !sessionId || !paid) return null;
      return { order_id: orderId, payment_ref: sessionId, status: 'paid' };
    }

    if (
      type === 'checkout.session.async_payment_failed' ||
      type === 'checkout.session.expired'
    ) {
      const orderId = String(obj.client_reference_id || '');
      const sessionId = String(obj.id || '');
      if (!orderId || !sessionId) return null;
      return { order_id: orderId, payment_ref: sessionId, status: 'failed' };
    }

    // ── Events PaymentIntent (paiement direct hors Checkout — défensif) ───
    // Pas de session id ici : on relie via metadata.order_id (posé à l'init).
    // recordPaymentTransition matche par provider_ref AND order_id : ce chemin
    // ne s'active que si une ligne payments porte ce PaymentIntent id (cas
    // PaymentIntent direct, non utilisé par notre Checkout hébergé actuel).
    if (type === 'payment_intent.succeeded') {
      const md = (obj.metadata || {}) as Record<string, unknown>;
      const orderId = String(md.order_id || '');
      const pi = String(obj.id || '');
      if (!orderId || !pi) return null;
      return { order_id: orderId, payment_ref: pi, status: 'paid' };
    }

    if (type === 'payment_intent.payment_failed') {
      const md = (obj.metadata || {}) as Record<string, unknown>;
      const orderId = String(md.order_id || '');
      const pi = String(obj.id || '');
      if (!orderId || !pi) return null;
      return { order_id: orderId, payment_ref: pi, status: 'failed' };
    }

    // Event non pertinent pour le lifecycle → ignoré (M1 : 200 no-op).
    return null;
  },

  /**
   * ── Sprint E6 M1 — Remboursement Stripe (total/partiel) ──────────────────
   *
   * ⚠️ ZONE RÉGULÉE — revue Rochdi requise (chemin remboursement live).
   * Garde-fou sandbox : `stripeFetch` appelle `resolveStripeSecret` qui FORCE
   * une clé `sk_test_` tant que payments_live_enabled=0 (aucun fonds réel
   * remboursé en sandbox). On NE contourne PAS ce garde-fou — on le réutilise.
   *
   * POST /v1/refunds avec `payment_intent` OU `charge` selon ce que
   * `payment.provider_ref` désigne. À l'init Checkout (createPayment), M1
   * stocke la **Checkout Session id** (`cs_...`) dans payments.provider_ref.
   * Stripe accepte aussi un `payment_intent` (`pi_...`) ou `charge` (`ch_...`).
   * On route selon le préfixe ; pour une session (`cs_...`) on passe par
   * l'expansion `payment_intent` impossible côté /refunds → on exige un
   * `pi_`/`ch_` ; sinon erreur normalisée explicite (M1 mappe en 4xx FR).
   *
   * Idempotent : `Idempotency-Key=idemKey` (Stripe réutilise le refund pour
   * la même clé → pas de double remboursement sur rejeu). AUCUNE donnée carte.
   */
  async refund(
    env: Env,
    payment: { client_id: string; provider_ref: string | null; currency: string },
    amountCents: number,
    idemKey: string,
  ): Promise<{ provider_ref: string; status: 'succeeded' | 'pending' | 'failed' }> {
    const ref = (payment.provider_ref || '').trim();
    if (!ref) {
      throw new StripeError(
        'Référence de paiement Stripe absente — remboursement impossible.',
        422,
      );
    }

    // Route la cible du refund selon le préfixe de la référence opaque.
    const params: Record<string, unknown> = {
      amount: Math.max(0, Math.round(amountCents)),
    };
    if (ref.startsWith('pi_')) {
      params.payment_intent = ref;
    } else if (ref.startsWith('ch_')) {
      params.charge = ref;
    } else {
      // cs_... (Checkout Session) ou autre : /v1/refunds n'accepte pas une
      // session directement. On refuse proprement (M1 → 422 FR québécois) —
      // un PaymentIntent/charge id est requis pour rembourser via Stripe.
      throw new StripeError(
        'Le remboursement Stripe requiert un PaymentIntent (pi_) ou un débit (ch_) ; référence reçue non remboursable directement.',
        422,
      );
    }

    // ⚠️ ZONE RÉGULÉE — appel remboursement. stripeFetch impose sk_test_
    // tant que payments_live_enabled=0 (sandbox, zéro fonds réel remboursé).
    const refund = await stripeFetch(
      env,
      payment.client_id,
      '/refunds',
      params,
      { idempotencyKey: idemKey },
    );

    const refundId = String(refund.id || '');
    if (!refundId) {
      throw new StripeError('Stripe n\'a pas renvoyé d\'identifiant de remboursement.', 502);
    }

    // Stripe refund.status : 'succeeded' | 'pending' | 'failed' |
    // 'requires_action' | 'canceled'. On normalise vers le contrat figé.
    const raw = String(refund.status || '');
    const status: 'succeeded' | 'pending' | 'failed' =
      raw === 'succeeded' ? 'succeeded'
        : raw === 'failed' || raw === 'canceled' ? 'failed'
          : 'pending'; // pending / requires_action → pending (réglé via webhook futur)

    return { provider_ref: refundId, status };
  },
};
