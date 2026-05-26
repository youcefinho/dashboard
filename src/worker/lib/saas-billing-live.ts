// ── Sprint 31 — Billing Stripe LIVE (SaaS Intralys) — helper core (A1) ─────
//
// Helper bas niveau d'appels Stripe pour la branche LIVE SaaS (abo agence →
// Intralys). DISTINCT de :
//   - src/worker/payments/stripe-provider.ts  → E4 marchand (vente produits
//     tenant via Connect, scope client). On en CALQUE le pattern (stripeFetch
//     POST x-www-form-urlencoded, Idempotency-Key, Stripe-Account).
//   - src/worker/lib/saas-billing-mock.ts     → branche MOCK (Phase A/B,
//     idiome `if (!isStripeConfigured(env)) return mock`). Conservé tel quel.
//
// Activation en V1 — DOUBLE GATE :
//   1. `isLiveBranchEnabled(env)`  → clé `STRIPE_SECRET_KEY` bindée
//      (`sk_live_*` OU `sk_test_*` ; `sk_test_*` = sandbox SaaS, pas de fonds
//      réels). Sans clé : aucune branche live n'est active globalement.
//   2. `isTenantLiveEnabled(env, agencyId)` → flag tenant
//      `payment_provider_config.payments_live_enabled = 1` AND `provider='stripe'`.
//      Tant que ce flag n'est pas posé sur le tenant, on RESTE en mock pour
//      ce tenant même si la clé globale est présente (cf. revue Rochdi).
//
// Manager-B brancherait ces helpers DANS saas-billing.ts derrière les deux
// gates ci-dessus. Aucun appel direct depuis ce fichier — pure plomberie.
//
// AUCUN SDK Node — fetch direct vers api.stripe.com (runtime Cloudflare Workers).
// AUCUNE donnée carte ne transite ici : SetupIntent / Portal Session redirigent
// l'utilisateur sur le domaine Stripe (PCI minimal).

import type { Env } from '../types';
import { createLogger } from './logger';

// ════════════════════════════════════════════════════════════════════════════
// A1.1 — Constantes + erreur normalisée
// ════════════════════════════════════════════════════════════════════════════

/** Base URL API Stripe (calque stripe-provider.ts:34). */
export const STRIPE_API = 'https://api.stripe.com/v1';

/**
 * Erreur normalisée d'appel Stripe SaaS (réseau / HTTP / API).
 *
 * Calque structurel de `StripeError` (stripe-provider.ts:83) mais DISTINCTE de
 * nom (`StripeSaasError`) pour que les catch côté handler SaaS ne capturent
 * jamais accidentellement les erreurs E4 marchand (et inversement).
 *
 * - `code`       : code Stripe API (ex 'resource_missing', 'parameter_invalid').
 * - `statusCode` : statut HTTP renvoyé par Stripe (ou 502 réseau).
 * - `raw`        : payload JSON Stripe brut (debug / log Manager-B).
 */
export class StripeSaasError extends Error {
  readonly code?: string;
  readonly statusCode: number;
  readonly raw?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code?: string,
    raw?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StripeSaasError';
    this.statusCode = statusCode;
    this.code = code;
    this.raw = raw;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// A1.2 — Garde-fous d'activation (double gate global + tenant)
// ════════════════════════════════════════════════════════════════════════════

/**
 * True si la clé Stripe SaaS est bindée ET reconnue comme une vraie clé Stripe
 * (`sk_live_` OU `sk_test_`). Garde-fou GLOBAL — borne l'activation au niveau
 * Worker. Une clé absente ou de format inconnu ⇒ branche live OFF globalement.
 *
 * Note : `sk_test_` est accepté ici comme branche live "sandbox" (appels réels
 * api.stripe.com en mode test, zéro fonds réels). C'est volontaire — permet le
 * smoke-test live sans toucher d'argent. Le passage `sk_live_` reste une
 * décision Rochdi (rotation secret Wrangler).
 */
export function isLiveBranchEnabled(env: Env): boolean {
  const key = (env.STRIPE_SECRET_KEY || '').trim();
  return key.startsWith('sk_live_') || key.startsWith('sk_test_');
}

/**
 * True si CE tenant a explicitement activé la branche live Stripe SaaS.
 * Lit `payment_provider_config` (seq E4, partagée — UNIQUE (client_id,
 * provider)), filtre `provider='stripe'` AND `payments_live_enabled=1`.
 *
 * Défensif : table absente / row absente / colonne nulle ⇒ false (mock).
 * NE THROW JAMAIS — la branche live d'un tenant ne doit JAMAIS planter le
 * handler en cas de souci DB ; on retombe sur mock proprement.
 */
export async function isTenantLiveEnabled(
  env: Env,
  agencyId: string,
): Promise<boolean> {
  if (!agencyId) return false;
  try {
    const row = (await env.DB.prepare(
      `SELECT payments_live_enabled
         FROM payment_provider_config
        WHERE client_id = ? AND provider = 'stripe'
        LIMIT 1`,
    )
      .bind(agencyId)
      .first()) as { payments_live_enabled: number | null } | null;
    return (row?.payments_live_enabled ?? 0) === 1;
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// A1.3 — Encodage form-urlencoded + appel bas niveau Stripe
// ════════════════════════════════════════════════════════════════════════════

/**
 * Encode un objet plat/imbriqué en x-www-form-urlencoded façon Stripe.
 * Calque BYTE-IDENTIQUE de `encodeStripeForm` (stripe-provider.ts:132).
 * Réimplémenté localement pour préserver l'isolation Manager-A (fichier
 * EXCLUSIF — pas d'import croisé vers le module marchand E4).
 */
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
 * Appel bas niveau de l'API Stripe (branche SaaS Intralys).
 *
 * Calque le pattern de `stripeFetch` (stripe-provider.ts:169) :
 *   - POST `application/x-www-form-urlencoded` (format natif Stripe).
 *   - `Authorization: Bearer <STRIPE_SECRET_KEY>` (clé SaaS globale Intralys
 *     — PAS la clé tenant marchand, qui partage le binding mais sert un autre
 *     domaine fonctionnel).
 *   - `Idempotency-Key: <opts.idempotencyKey>` si fourni (anti double-charge
 *     sur retry).
 *   - `Stripe-Account: <opts.stripeAccount>` si fourni (Connect : opère pour
 *     le compte d'un sous-marchand SaaS — utile pour les helpers Connect ci-
 *     dessous, JAMAIS pour Customer/Subscription SaaS de l'agence chez nous).
 *   - Erreur réseau (TypeError fetch) ⇒ StripeSaasError(502).
 *   - HTTP non-2xx ⇒ StripeSaasError(status, code, raw).
 *
 * AUCUNE donnée carte n'est envoyée ici : SetupIntent / Portal redirigent
 * l'utilisateur sur le domaine Stripe (PCI minimal).
 */
export async function stripeFetch(
  env: Env,
  path: string,
  params: Record<string, unknown>,
  opts: { idempotencyKey?: string; stripeAccount?: string } = {},
): Promise<Record<string, unknown>> {
  const secret = (env.STRIPE_SECRET_KEY || '').trim();
  if (!secret) {
    throw new StripeSaasError(
      'Clé secrète Stripe SaaS absente (binding Wrangler).',
      503,
      'no_secret',
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.stripeAccount) headers['Stripe-Account'] = opts.stripeAccount;

  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}${path}`, {
      method: 'POST',
      headers,
      body: encodeStripeForm(params).toString(),
    });
  } catch {
    throw new StripeSaasError(
      'Erreur réseau lors de l\'appel Stripe SaaS.',
      502,
      'network_error',
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new StripeSaasError(
      `Réponse Stripe SaaS illisible (HTTP ${res.status}).`,
      502,
      'invalid_json',
    );
  }

  if (!res.ok) {
    const err = (data.error || {}) as { message?: string; code?: string };
    // Log structuré sans PII (logger.ts: aucune introspection, on contrôle ctx).
    createLogger(env).warn('stripe_saas_api_error', {
      path,
      status: res.status,
      code: err.code,
    });
    throw new StripeSaasError(
      err.message || `Stripe a refusé la requête SaaS (HTTP ${res.status}).`,
      res.status,
      err.code,
      data,
    );
  }
  return data;
}

/**
 * GET bas niveau de l'API Stripe (search / retrieve / list).
 *
 * Stripe attend les paramètres en query-string pour GET. Calque structurel
 * de `stripeFetch` ci-dessus, méthode GET + query params (pas de body), pas
 * d'Idempotency-Key (GETs sont naturellement idempotents).
 */
async function stripeFetchGet(
  env: Env,
  path: string,
  query: Record<string, unknown> = {},
  opts: { stripeAccount?: string } = {},
): Promise<Record<string, unknown>> {
  const secret = (env.STRIPE_SECRET_KEY || '').trim();
  if (!secret) {
    throw new StripeSaasError(
      'Clé secrète Stripe SaaS absente (binding Wrangler).',
      503,
      'no_secret',
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
  };
  if (opts.stripeAccount) headers['Stripe-Account'] = opts.stripeAccount;

  const qs = encodeStripeForm(query).toString();
  const url = `${STRIPE_API}${path}${qs ? `?${qs}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers });
  } catch {
    throw new StripeSaasError(
      'Erreur réseau lors de l\'appel Stripe SaaS (GET).',
      502,
      'network_error',
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new StripeSaasError(
      `Réponse Stripe SaaS illisible (HTTP ${res.status}).`,
      502,
      'invalid_json',
    );
  }

  if (!res.ok) {
    const err = (data.error || {}) as { message?: string; code?: string };
    createLogger(env).warn('stripe_saas_api_error', {
      path,
      method: 'GET',
      status: res.status,
      code: err.code,
    });
    throw new StripeSaasError(
      err.message || `Stripe a refusé la requête SaaS (HTTP ${res.status}).`,
      res.status,
      err.code,
      data,
    );
  }
  return data;
}

// ════════════════════════════════════════════════════════════════════════════
// A1.4 — Customer (find or create par email + metadata.agency_id)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cherche un Customer Stripe SaaS pour cette agence, le crée s'il n'existe pas.
 *
 * Stratégie de recherche : `GET /v1/customers/search` avec une requête Stripe
 * Search filtrant sur `metadata['agency_id']` ET `email`. Stripe Search
 * garantit l'unicité métier de notre côté (1 customer par agence/email).
 *
 * Création : `POST /v1/customers` avec `email` + `metadata[agency_id]` posé.
 * Idempotency-Key = `saas_cust_<agencyId>` pour qu'un double appel concurrent
 * ne crée jamais 2 customers (Stripe réutilise alors le 1er).
 *
 * Retourne l'ID Stripe (`cus_...`).
 */
export async function findOrCreateStripeCustomer(
  env: Env,
  agencyId: string,
  email: string,
): Promise<string> {
  if (!agencyId) {
    throw new StripeSaasError(
      'agencyId requis pour findOrCreateStripeCustomer.',
      422,
      'agency_id_required',
    );
  }
  if (!email) {
    throw new StripeSaasError(
      'email requis pour findOrCreateStripeCustomer.',
      422,
      'email_required',
    );
  }

  // Échappement minimal pour la query Stripe Search (les valeurs doivent être
  // entre guillemets doubles, et un guillemet dans la valeur se backslash).
  const escAgency = agencyId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escEmail = email.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const searchQuery =
    `metadata['agency_id']:"${escAgency}" AND email:"${escEmail}"`;

  const search = await stripeFetchGet(env, '/customers/search', {
    query: searchQuery,
    limit: 1,
  });

  const data = (search.data as Array<{ id?: string }> | undefined) || [];
  if (data.length > 0 && data[0]?.id) {
    return String(data[0].id);
  }

  // Pas de hit : on crée. Idempotency-Key bornée à l'agence pour éviter
  // les doubles créations concurrentes (premier gagne, retry réutilise).
  const created = await stripeFetch(
    env,
    '/customers',
    {
      email,
      'metadata[agency_id]': agencyId,
    },
    { idempotencyKey: `saas_cust_${agencyId}` },
  );

  const id = String(created.id || '');
  if (!id) {
    throw new StripeSaasError(
      'Stripe n\'a pas renvoyé d\'identifiant Customer.',
      502,
      'no_customer_id',
    );
  }
  return id;
}

// ════════════════════════════════════════════════════════════════════════════
// A1.5 — Subscription (create / update / cancel)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Crée une Subscription Stripe pour un Customer SaaS sur un Price donné.
 * Idempotency-Key fourni par l'appelant (Manager-B borne par agencyId+priceId).
 *
 * Comportement Stripe par défaut : facturation cyclique selon le Price
 * (monthly/yearly géré par le Price côté Stripe), `collection_method=charge_
 * automatically` (la PM par défaut du Customer est débitée).
 */
export async function createStripeSubscription(
  env: Env,
  customerId: string,
  priceId: string,
  idemKey: string,
): Promise<Record<string, unknown>> {
  return stripeFetch(
    env,
    '/subscriptions',
    {
      customer: customerId,
      'items[0][price]': priceId,
    },
    { idempotencyKey: idemKey },
  );
}

/**
 * Update du Price d'une Subscription existante (changement de plan).
 *
 * Pattern Stripe : on doit fournir l'ID de l'item courant à modifier (pas
 * juste le price). Manager-B aura typiquement fait un retrieve avant pour
 * connaître `subscription.items.data[0].id` — ici on encode la mutation
 * via le helper `proration_behavior='create_prorations'` (défaut Stripe,
 * facturation au prorata du changement).
 *
 * NOTE : ce helper attend que l'appelant ait déjà résolu l'item id via un
 * retrieve préalable. Pour rester self-contained sans imposer ce 2-call
 * pattern à Manager-B, on utilise `items[0][id]` posé par l'appelant via
 * un wrapper côté Manager-B. Ici on pose juste price + proration ; si
 * Manager-B veut cibler un item précis, il fera son propre call.
 *
 * Approche retenue : POST /v1/subscriptions/{id} avec `items[0][price]`
 * (replace simple — Stripe applique le price au premier item).
 */
export async function updateStripeSubscription(
  env: Env,
  subscriptionId: string,
  priceId: string,
  idemKey: string,
): Promise<Record<string, unknown>> {
  return stripeFetch(
    env,
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      'items[0][price]': priceId,
      proration_behavior: 'create_prorations',
    },
    { idempotencyKey: idemKey },
  );
}

/**
 * Annule une Subscription, immédiatement OU à la fin de la période courante.
 *
 * - `atPeriodEnd=true`  → POST /v1/subscriptions/{id} `cancel_at_period_end=true`
 *   (la sub reste active jusqu'à `current_period_end`, puis canceled).
 * - `atPeriodEnd=false` → DELETE /v1/subscriptions/{id} (annulation immédiate
 *   — Stripe ne charge pas le reste de la période, pas de prorata refund).
 *   Côté API Stripe la méthode est DELETE ; on émule via stripeFetch en POST
 *   est impossible. Pour rester sur 1 seule plomberie POST/GET, on utilise
 *   la voie POST `cancel_at_period_end=false` + `proration_behavior='none'`
 *   PUIS DELETE indisponible → on bascule sur le pattern documenté Stripe
 *   "cancel now" qui est aussi accessible via POST avec un body vide sur
 *   /v1/subscriptions/{id}/cancel (endpoint cancel récent).
 */
export async function cancelStripeSubscription(
  env: Env,
  subId: string,
  atPeriodEnd: boolean,
  idemKey: string,
): Promise<Record<string, unknown>> {
  if (atPeriodEnd) {
    // Cancel programmé en fin de période — sub reste active jusqu'au prochain
    // renouvellement, puis Stripe transitionne status='canceled' automatiquement.
    return stripeFetch(
      env,
      `/subscriptions/${encodeURIComponent(subId)}`,
      { cancel_at_period_end: 'true' },
      { idempotencyKey: idemKey },
    );
  }
  // Cancel immédiat — endpoint dédié /cancel (POST). Pas de prorata refund
  // automatique (à gérer côté handler si politique commerciale le requiert).
  return stripeFetch(
    env,
    `/subscriptions/${encodeURIComponent(subId)}/cancel`,
    {},
    { idempotencyKey: idemKey },
  );
}

// ════════════════════════════════════════════════════════════════════════════
// A1.6 — Billing Portal (gestion abonnement / PM par le client lui-même)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Crée une Billing Portal Session Stripe (page hébergée Stripe).
 *
 * Le portail Stripe gère TOUT côté Stripe : update PM, change plan (selon
 * config portal côté dashboard Stripe), download factures, cancel sub. Notre
 * job ici = créer la session + rediriger l'utilisateur sur `session.url`.
 * Au retour (`returnUrl`), Manager-B refresh sa vue depuis le webhook.
 *
 * Retourne `{ url, expires_at }` — la session a une URL one-shot (Stripe la
 * révoque après usage) avec un TTL court (~5 min côté Stripe).
 */
export async function createBillingPortalSession(
  env: Env,
  customerId: string,
  returnUrl: string,
): Promise<{ url: string; expires_at: number }> {
  const session = await stripeFetch(env, '/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
  });
  const url = String(session.url || '');
  const expiresAt = Number(session.expires_at || 0);
  if (!url) {
    throw new StripeSaasError(
      'Stripe n\'a pas renvoyé d\'URL pour la Billing Portal Session.',
      502,
      'no_portal_url',
    );
  }
  return { url, expires_at: expiresAt };
}

// ════════════════════════════════════════════════════════════════════════════
// A1.7 — Payment Methods (SetupIntent, list, detach, set default)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Crée un SetupIntent (collecte d'une PM sans charge immédiate).
 *
 * Le `client_secret` est renvoyé au frontend, qui le passe à Stripe.js pour
 * confirmer la collecte de la carte sur le domaine Stripe. AUCUNE donnée
 * carte ne transite ici (PCI minimal — calque PCI minimal de stripe-provider).
 *
 * Idempotency-Key fourni par l'appelant.
 */
export async function createSetupIntent(
  env: Env,
  customerId: string,
  idemKey: string,
): Promise<{ id: string; client_secret: string }> {
  const intent = await stripeFetch(
    env,
    '/setup_intents',
    {
      customer: customerId,
      'payment_method_types[0]': 'card',
      usage: 'off_session',
    },
    { idempotencyKey: idemKey },
  );
  const id = String(intent.id || '');
  const clientSecret = String(intent.client_secret || '');
  if (!id || !clientSecret) {
    throw new StripeSaasError(
      'Stripe n\'a pas renvoyé un SetupIntent valide.',
      502,
      'no_setup_intent',
    );
  }
  return { id, client_secret: clientSecret };
}

/**
 * Liste les PaymentMethods d'un Customer (par défaut : cartes).
 *
 * GET /v1/payment_methods?customer=...&type=card. Retourne le tableau brut
 * `data` (objets Stripe PaymentMethod — Manager-B normalise pour l'UI).
 */
export async function listPaymentMethods(
  env: Env,
  customerId: string,
  type: string = 'card',
): Promise<Array<Record<string, unknown>>> {
  const res = await stripeFetchGet(env, '/payment_methods', {
    customer: customerId,
    type,
  });
  const data = (res.data as Array<Record<string, unknown>> | undefined) || [];
  return data;
}

/**
 * Détache une PaymentMethod du Customer (POST /v1/payment_methods/{id}/detach).
 *
 * Après détachement, la PM ne peut plus être utilisée pour de futures charges.
 * Stripe la garde côté lecture (audit), mais elle disparaît de la liste du
 * Customer. Ne retourne rien — un succès silencieux est suffisant pour
 * Manager-B (il refresh la liste après).
 */
export async function detachPaymentMethod(
  env: Env,
  pmId: string,
): Promise<void> {
  await stripeFetch(
    env,
    `/payment_methods/${encodeURIComponent(pmId)}/detach`,
    {},
  );
}

/**
 * Pose la PaymentMethod par défaut d'un Customer pour les factures futures.
 *
 * Pattern Stripe : `POST /v1/customers/{id}` avec
 * `invoice_settings[default_payment_method]=<pmId>`. La prochaine Invoice
 * (renouvellement de Subscription, ou Invoice manuelle) chargera cette PM.
 */
export async function setDefaultPaymentMethod(
  env: Env,
  customerId: string,
  pmId: string,
): Promise<void> {
  await stripeFetch(
    env,
    `/customers/${encodeURIComponent(customerId)}`,
    {
      'invoice_settings[default_payment_method]': pmId,
    },
  );
}

// ════════════════════════════════════════════════════════════════════════════
// A1.8 — Connect (Express accounts — onboarding marchand depuis SaaS)
// ════════════════════════════════════════════════════════════════════════════
//
// Stripe Connect — `account[type]='express'` : onboarding hébergé Stripe (KYC
// + bank). DISTINCT de l'usage Connect côté stripe-provider.ts (qui CONSOMME
// `connect_account_ref` déjà provisionné via header Stripe-Account). Ici on
// PROVISIONNE le compte Connect lui-même (création + lien onboarding).
//
// Manager-B persistera `account.id` dans `payment_provider_config
// .connect_account_ref` côté tenant après onboarding réussi.

/**
 * Crée un Stripe Connect Account de type 'express' pour un client SaaS.
 *
 * - `type='express'` : Stripe gère l'onboarding (formulaires KYC + bank) sur
 *   son domaine via Account Link (helper suivant).
 * - `country` : code ISO 2 lettres (CA par défaut — marché principal Intralys).
 * - `email`   : email du marchand (Stripe envoie les emails KYC dessus).
 * - `metadata[client_id]` : trace du tenant interne (réversible en sens
 *   inverse via search côté Manager-B / webhook).
 *
 * Idempotency-Key bornée par clientId pour éviter doubles créations.
 * Retourne `{ id }` — l'ID `acct_...` à persister côté tenant.
 */
export async function createConnectAccount(
  env: Env,
  clientId: string,
  email: string,
  country: string = 'CA',
): Promise<{ id: string }> {
  if (!clientId) {
    throw new StripeSaasError(
      'clientId requis pour createConnectAccount.',
      422,
      'client_id_required',
    );
  }
  if (!email) {
    throw new StripeSaasError(
      'email requis pour createConnectAccount.',
      422,
      'email_required',
    );
  }
  const acct = await stripeFetch(
    env,
    '/accounts',
    {
      type: 'express',
      country,
      email,
      'metadata[client_id]': clientId,
      // Capabilities standard pour un marchand Express CA/EU/US (Manager-B
      // peut étendre selon le pays — ici on reste sur le strict minimum
      // qui correspond aux cas d'usage Intralys).
      'capabilities[card_payments][requested]': 'true',
      'capabilities[transfers][requested]': 'true',
    },
    { idempotencyKey: `saas_acct_${clientId}` },
  );
  const id = String(acct.id || '');
  if (!id) {
    throw new StripeSaasError(
      'Stripe n\'a pas renvoyé d\'identifiant Account.',
      502,
      'no_account_id',
    );
  }
  return { id };
}

/**
 * Crée un Account Link (URL one-shot pour l'onboarding Express hébergé).
 *
 * Stripe redirige l'utilisateur sur son domaine pour remplir KYC + bank info.
 * Au retour, deux URLs possibles :
 *   - `returnUrl`  : onboarding terminé (charges_enabled possible si tout OK).
 *   - `refreshUrl` : link expiré (TTL court Stripe ~minutes) — Manager-B doit
 *     recréer un Account Link et rediriger à nouveau.
 *
 * `type='account_onboarding'` est le mode "compléter l'inscription" (≠
 * 'account_update' qui ouvre les champs déjà remplis pour modification).
 */
export async function createConnectAccountLink(
  env: Env,
  accountId: string,
  refreshUrl: string,
  returnUrl: string,
): Promise<{ url: string; expires_at: number }> {
  const link = await stripeFetch(env, '/account_links', {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  const url = String(link.url || '');
  const expiresAt = Number(link.expires_at || 0);
  if (!url) {
    throw new StripeSaasError(
      'Stripe n\'a pas renvoyé d\'URL pour l\'Account Link.',
      502,
      'no_account_link_url',
    );
  }
  return { url, expires_at: expiresAt };
}

/**
 * Récupère l'état complet d'un Connect Account (statut KYC, capabilities,
 * payouts_enabled, charges_enabled, requirements pending, etc.).
 *
 * GET /v1/accounts/{id}. Manager-B utilise typiquement le retour pour :
 *   - Afficher dans l'UI l'état "Onboarding en cours / Vérifié / Bloqué".
 *   - Décider si on peut commencer à router des paiements vers ce compte.
 *   - Lister les "requirements.currently_due" pour relancer l'utilisateur.
 */
export async function retrieveConnectAccount(
  env: Env,
  accountId: string,
): Promise<Record<string, unknown>> {
  return stripeFetchGet(
    env,
    `/accounts/${encodeURIComponent(accountId)}`,
    {},
  );
}
