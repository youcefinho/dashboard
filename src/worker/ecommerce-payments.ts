// ── Paiement multi-provider/région — Sprint E4 M1 (2026-05-16) ──────────────
//
// Abstraction `PaymentProvider` + registry + résolution région→provider +
// endpoint d'init + dispatch webhook public + pont paiement→lifecycle E3.
//
// ⚠️ FRONTIÈRE RÉGULÉE — ce fichier orchestre le paiement marchand
// e-commerce (B2). DISTINCT de src/worker/billing.ts (abo SaaS Intralys —
// INTOUCHABLE, ne JAMAIS confondre / copier son pattern mock).
//
// PCI minimal : AUCUNE donnée carte (PAN/CVV/expiry) ne transite ici. La
// tokenisation est 100 % côté provider (M2/M3 implémentent les providers
// concrets). On ne manipule que des références opaques (provider_ref).
//
// Flag de sûreté : `payment_provider_config.payments_live_enabled` défaut 0
// (sandbox/test) — tant que non activé, l'init reste inoffensive.
//
// Conventions strictes :
//   - Multi-tenant : client_id résolu via getClientModules (pattern projet).
//   - Money en cents INTEGER. Devise issue de resolveRegionContext (E-R).
//   - Idempotence : clé déterministe (order+method+amount) à l'init +
//     dédup UNIQUE(provider, provider_event_id) au webhook.
//   - Réutilise le lifecycle E3 via commitOrderSale (ZÉRO duplication
//     stock/statut). Consomme resolveRegionContext (0 modif région/taxe).

import type { Env } from './types';
import type {
  PaymentStatus,
  PaymentMethod,
  PaymentProviderId,
  PaymentCapabilities,
  PaymentInitResult,
  RegionContext,
  SupportedCurrency,
} from '../lib/types';
import { json, audit } from './helpers';
import { getClientModules } from './modules';
import { resolveRegionContext } from './ecommerce-region';
import { commitOrderSale } from './ecommerce-orders';
// E4 M2 — bootstrap registry (side-effect : registerProvider stripe/cod/dz).
// Importé APRÈS la déclaration de REGISTRY + registerProvider pour éviter
// le TDZ (Temporal Dead Zone) sur REGISTRY lors de l'initialisation circulaire.
// bootProviders() reçoit registerProvider en paramètre → pas d'import circulaire.
import { bootProviders } from './payments/register';
// Renforcement V2 — payments-engine disponible (verifyStripeSignature,
// validatePaymentAmount, parseStripeWebhook) — sera câblé au prochain batch.

type Auth = { userId: string; role: string };

// ════════════════════════════════════════════════════════════════════════════
// Contrat FIGÉ — interface PaymentProvider (M2/M3 implémentent CONTRE ceci)
// ════════════════════════════════════════════════════════════════════════════

/** Commande minimale passée au provider (snapshot — pas de donnée carte). */
export interface PaymentOrderRef {
  id: string;
  client_id: string;
  total_cents: number;
  currency: SupportedCurrency;
  email: string | null;
}

export interface PaymentProvider {
  id: PaymentProviderId;
  /** Méthodes/devises supportées dans le contexte région donné. */
  capabilities(ctx: RegionContext): PaymentCapabilities;
  /**
   * Crée l'intention de paiement côté provider. Idempotent via `idemKey`
   * (le provider DOIT réutiliser une intention existante pour la même clé).
   * AUCUNE donnée carte en entrée/sortie — uniquement une référence opaque.
   */
  createPayment(
    env: Env,
    order: PaymentOrderRef,
    ctx: RegionContext,
    idemKey: string,
  ): Promise<{ provider_ref: string; redirect_url?: string; status: PaymentStatus }>;
  /**
   * Vérifie la SIGNATURE du webhook (responsabilité du provider — M2/M3) et
   * renvoie le résultat normalisé, ou null si non pertinent / signature KO.
   */
  handleWebhook(
    env: Env,
    request: Request,
  ): Promise<{ order_id: string; payment_ref: string; status: PaymentStatus } | null>;
  /**
   * ── Sprint E6 M1 — extension ADDITIVE OPTIONNELLE (contrat E4 NON cassé) ──
   * Rembourse (total/partiel) un paiement déjà capturé chez le provider.
   * OPTIONNEL : un provider qui ne l'implémente PAS (cod/dz aujourd'hui, ou
   * tout futur provider) reste un `PaymentProvider` valide — aucune rupture
   * de l'interface figée E4. Idempotent via `idemKey` (le provider DOIT
   * réutiliser un remboursement existant pour la même clé). AUCUNE donnée
   * carte — `payment` ne porte que des références opaques.
   *
   * ⚠️ ZONE RÉGULÉE — chemin remboursement live (revue Rochdi requise) ;
   * inoffensif tant que payments_live_enabled=0 (clé sk_test_ forcée Stripe).
   */
  refund?(
    env: Env,
    payment: { client_id: string; provider_ref: string | null; currency: string },
    amountCents: number,
    idemKey: string,
  ): Promise<{ provider_ref: string; status: 'succeeded' | 'pending' | 'failed' }>;
}

// ════════════════════════════════════════════════════════════════════════════
// Registry — M2/M3 enregistrent leurs providers concrets via registerProvider
// ════════════════════════════════════════════════════════════════════════════

const REGISTRY = new Map<PaymentProviderId, PaymentProvider>();

/** Enregistre/écrase un provider (appelé par M2/M3 à l'import de leur module). */
export function registerProvider(p: PaymentProvider): void {
  REGISTRY.set(p.id, p);
}

// Bootstrap immédiat : bootProviders reçoit registerProvider en paramètre,
// pas d'import circulaire (register.ts n'importe plus registerProvider).
bootProviders(registerProvider);

/** Provider enregistré (ou null si M2/M3 ne l'ont pas encore branché). */
export function getProvider(id: PaymentProviderId): PaymentProvider | null {
  return REGISTRY.get(id) ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// Résolution région → provider courant (consomme resolveRegionContext E-R)
// ════════════════════════════════════════════════════════════════════════════

interface ProviderConfigRow {
  provider: string;
  mode: string | null;
  payments_live_enabled: number | null;
}

/**
 * Choisit l'identifiant de provider par défaut selon la devise/région quand le
 * tenant n'a pas de `payment_provider_config` explicite :
 *   - DZD          → 'dz_gateway' (Stripe indisponible en DZD)
 *   - CAD / EUR     → 'stripe'
 *   - COD ('cod')   → universel (toujours proposable en repli, géré côté init)
 */
function defaultProviderForCurrency(currency: SupportedCurrency): PaymentProviderId {
  if (currency === 'DZD') return 'dz_gateway';
  return 'stripe';
}

export interface ResolvedPaymentProvider {
  /** Provider courant résolu (peut être non enregistré tant que M2/M3 absents). */
  provider_id: PaymentProviderId;
  provider: PaymentProvider | null;
  ctx: RegionContext;
  /** Capabilities filtrées par devise région (Stripe absent si DZD, etc.). */
  capabilities: PaymentCapabilities;
  /** Flag de sûreté : true seulement si explicitement activé en DB (défaut 0). */
  live_enabled: boolean;
  mode: 'test' | 'live';
}

/**
 * Résout le provider de paiement du tenant : contexte région (E-R) +
 * `payment_provider_config`. Capabilities filtrées pour ne JAMAIS proposer une
 * devise non supportée (ex Stripe hors DZD). COD reste universellement
 * proposable en repli (méthode 'cod' injectée si absente).
 */
export async function resolvePaymentProvider(
  env: Env,
  clientId: string,
): Promise<ResolvedPaymentProvider> {
  const ctx = await resolveRegionContext(env, clientId);

  const cfg = (await env.DB.prepare(
    `SELECT provider, mode, payments_live_enabled
       FROM payment_provider_config
      WHERE client_id = ?
      ORDER BY updated_at DESC
      LIMIT 1`,
  ).bind(clientId).first()) as ProviderConfigRow | null;

  const providerId: PaymentProviderId = (() => {
    const raw = (cfg?.provider || '').toLowerCase();
    if (raw === 'stripe' || raw === 'cod' || raw === 'dz_gateway') {
      return raw as PaymentProviderId;
    }
    return defaultProviderForCurrency(ctx.currency);
  })();

  const provider = getProvider(providerId);

  // Capabilities : si le provider est branché, on les filtre par la devise
  // région ; sinon repli déterministe sûr (au pire COD seul → jamais de
  // capture, comportement inoffensif).
  let capabilities: PaymentCapabilities;
  if (provider) {
    const caps = provider.capabilities(ctx);
    const currencies = caps.currencies.filter((c) => c === ctx.currency);
    const methods: PaymentMethod[] = currencies.length > 0 ? [...caps.methods] : [];
    if (!methods.includes('cod')) methods.push('cod'); // COD universel (repli)
    capabilities = { methods, currencies: currencies.length ? currencies : [ctx.currency] };
  } else {
    capabilities = { methods: ['cod'], currencies: [ctx.currency] };
  }

  // ⚠️ ZONE RÉGULÉE — live actif UNIQUEMENT si explicitement posé en DB.
  const liveEnabled = (cfg?.payments_live_enabled ?? 0) === 1;
  const mode: 'test' | 'live' = liveEnabled && cfg?.mode === 'live' ? 'live' : 'test';

  return {
    provider_id: providerId,
    provider,
    ctx,
    capabilities,
    live_enabled: liveEnabled,
    mode,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Idempotence — clé déterministe d'init (order + method + amount)
// ════════════════════════════════════════════════════════════════════════════

function buildIdempotencyKey(orderId: string, method: string, amountCents: number): string {
  return `${orderId}:${method}:${amountCents}`;
}

async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// M1.3 — Endpoint init paiement  POST /api/ecommerce/orders/:id/payment
// ════════════════════════════════════════════════════════════════════════════

interface OrderPayRow {
  id: string;
  client_id: string;
  total_cents: number;
  email: string | null;
  paid_at: string | null;
  status: string;
}

interface ExistingPaymentRow {
  id: string;
  status: string;
  provider_ref: string | null;
}

/**
 * POST /api/ecommerce/orders/:id/payment  body { method }
 * Gated requireModule('ecommerce') (hérité du bloc) + multi-tenant strict.
 *
 * Idempotent : clé déterministe (order+method+amount). Un paiement existant
 * NON échoué pour cette clé est RETOURNÉ tel quel (anti double-charge) — on ne
 * recrée pas d'intention. Sinon délègue à provider.createPayment puis insère
 * la ligne `payments`. COD n'est JAMAIS marqué payé ici (status pending_cod —
 * capture = jamais à la création).
 *
 * ⚠️ ZONE RÉGULÉE — création paiement (revue Rochdi requise avant live).
 */
export async function handleInitPayment(
  request: Request,
  env: Env,
  auth: Auth,
  orderId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }
  const method = String(body.method || '').toLowerCase().trim();
  if (!method) {
    return json({ error: 'Méthode requise', message: 'Précise une méthode de paiement.' }, 400);
  }

  const order = (await env.DB.prepare(
    'SELECT id, client_id, total_cents, email, paid_at, status FROM orders WHERE id = ? AND client_id = ?',
  ).bind(orderId, clientId).first()) as OrderPayRow | null;
  if (!order) return json({ error: 'Commande introuvable' }, 404);
  if (order.paid_at) {
    return json({ error: 'Déjà payée', message: 'Cette commande est déjà réglée.' }, 409);
  }
  if (order.status === 'cancelled') {
    return json({ error: 'Commande annulée', message: 'Impossible de payer une commande annulée.' }, 409);
  }

  const resolved = await resolvePaymentProvider(env, clientId);

  // Méthode autorisée par les capabilities de la région (COD universel).
  if (!resolved.capabilities.methods.includes(method as PaymentMethod)) {
    return json(
      {
        error: 'Méthode indisponible',
        message: `La méthode « ${method} » n'est pas disponible pour ta région. Disponibles : ${resolved.capabilities.methods.join(', ')}.`,
      },
      400,
    );
  }

  const amountCents = Math.max(0, Math.round(order.total_cents || 0));
  const idemKey = buildIdempotencyKey(orderId, method, amountCents);

  // Anti double-charge : paiement existant non-échoué pour cette clé → on le
  // retourne sans recréer d'intention provider.
  const existing = (await env.DB.prepare(
    `SELECT id, status, provider_ref
       FROM payments
      WHERE client_id = ? AND idempotency_key = ?
      LIMIT 1`,
  ).bind(clientId, idemKey).first()) as ExistingPaymentRow | null;
  if (existing && existing.status !== 'failed') {
    return json({
      data: {
        payment_id: existing.id,
        status: existing.status as PaymentStatus,
      } as PaymentInitResult,
    });
  }

  // COD : aucune capture, aucun appel provider de capture — statut pending_cod
  // (la commande reste 'unpaid' tant que non encaissée hors-ligne).
  let providerRef = '';
  let redirectUrl: string | undefined;
  let status: PaymentStatus;

  if (method === 'cod') {
    status = 'pending_cod';
    providerRef = `cod:${orderId}`;
  } else {
    const provider = resolved.provider;
    if (!provider) {
      // Provider pas encore branché (M2/M3) — refus propre, rien d'écrit.
      return json(
        {
          error: 'Fournisseur indisponible',
          message: `Le fournisseur de paiement « ${resolved.provider_id} » n'est pas encore configuré.`,
        },
        503,
      );
    }
    // ⚠️ ZONE RÉGULÉE — création paiement live (signature/capture déléguée
    // au provider M2/M3 ; inoffensif tant que payments_live_enabled=0).
    const created = await provider.createPayment(
      env,
      {
        id: order.id,
        client_id: order.client_id,
        total_cents: amountCents,
        currency: resolved.ctx.currency,
        email: order.email,
      },
      resolved.ctx,
      idemKey,
    );
    providerRef = created.provider_ref;
    redirectUrl = created.redirect_url;
    status = created.status;
  }

  const paymentId = crypto.randomUUID();
  // INSERT OR IGNORE + relecture : course concurrente sur la même clé →
  // une seule ligne (UNIQUE client_id,idempotency_key), on renvoie la gagnante.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO payments
       (id, client_id, order_id, provider, method, amount_cents, currency,
        status, provider_ref, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    paymentId, clientId, orderId, resolved.provider_id, method,
    amountCents, resolved.ctx.currency, status, providerRef, idemKey,
  ).run();

  const row = (await env.DB.prepare(
    'SELECT id, status, provider_ref FROM payments WHERE client_id = ? AND idempotency_key = ? LIMIT 1',
  ).bind(clientId, idemKey).first()) as ExistingPaymentRow | null;

  await audit(env, auth.userId, 'create', 'order', orderId, {
    payment: row?.id, method, provider: resolved.provider_id, status,
  });

  const result: PaymentInitResult = {
    payment_id: row?.id || paymentId,
    status: (row?.status as PaymentStatus) || status,
  };
  if (redirectUrl) result.redirect_url = redirectUrl;
  return json({ data: result }, 201);
}

// ════════════════════════════════════════════════════════════════════════════
// M1.3 — Dispatch webhook PUBLIC  POST /api/webhook/payments/:provider
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhook/payments/:provider — PUBLIC (pas de session).
 * Authentification = vérification de SIGNATURE du provider, DÉLÉGUÉE à
 * provider.handleWebhook (M2/M3). On ne fait JAMAIS confiance au payload
 * sans cette vérif côté provider.
 *
 * Dédup anti-rejeu : UNIQUE(provider, provider_event_id) sur payment_events.
 * Un événement déjà journalisé ⇒ 200 no-op (pas de re-déclenchement du pont).
 *
 * ── Sprint E6 M1 — discrimination du résultat ───────────────────────────────
 * Le dispatcher renvoie désormais un résultat DISCRIMINÉ
 * `{ kind: 'transition' | 'dispute', ... }` afin que M2 puisse brancher le
 * traitement des litiges (`kind:'dispute'`) sans dupliquer le dispatch. M1
 * n'implémente QUE la branche `kind:'transition'` (comportement E4 inchangé) ;
 * l'aiguillage `kind:'dispute'` (chargeback Stripe) est laissé à M2 — ici on
 * fournit uniquement la forme de retour + la discrimination.
 *
 * ⚠️ ZONE RÉGULÉE — webhook live (transition financière). Inoffensif tant que
 * payments_live_enabled=0 (aucune commande réelle ne sera marquée payée).
 */

/**
 * Résultat normalisé discriminé du dispatch webhook (Sprint E6 M1).
 * - `transition` : transition de paiement classique (E4 — M1 traite).
 * - `dispute`    : litige / chargeback (M2 traitera ; M1 expose seulement la
 *                  forme et la discrimination, AUCUNE impl dispute ici).
 */
export type PaymentWebhookOutcome =
  | { kind: 'transition'; order_id: string; payment_ref: string; status: PaymentStatus }
  | { kind: 'dispute'; order_id: string; payment_ref: string; dispute_ref: string };

export async function handlePaymentWebhook(
  request: Request,
  env: Env,
  providerId: string,
): Promise<Response> {
  const pid = (providerId || '').toLowerCase();
  if (pid !== 'stripe' && pid !== 'cod' && pid !== 'dz_gateway') {
    return json({ error: 'Provider inconnu' }, 404);
  }
  const provider = getProvider(pid as PaymentProviderId);
  if (!provider) {
    // Provider pas branché (M2/M3) : 200 pour éviter les retries inutiles du
    // provider, mais AUCUN effet (aucune transition).
    return json({ ok: true, ignored: true });
  }

  // Signature vérifiée DANS le provider (M2/M3). null = non pertinent / KO.
  let result: { order_id: string; payment_ref: string; status: PaymentStatus } | null;
  try {
    result = await provider.handleWebhook(env, request);
  } catch {
    return json({ error: 'Webhook rejeté' }, 400);
  }
  if (!result) {
    return json({ ok: true, ignored: true });
  }

  // ── Sprint E6 M1 — normalisation discriminée ────────────────────────────
  // Le contrat E4 figé de provider.handleWebhook renvoie une transition
  // (`{order_id, payment_ref, status}`). On la normalise en outcome
  // `kind:'transition'`. La branche `kind:'dispute'` (chargeback) sera
  // alimentée par M2 quand le provider exposera les événements de litige —
  // M1 ne décide RIEN sur les litiges (file-ownership : impl dispute = M2).
  const outcome: PaymentWebhookOutcome = {
    kind: 'transition',
    order_id: result.order_id,
    payment_ref: result.payment_ref,
    status: result.status,
  };
  // M2 (kind='dispute') : quand le provider exposera des événements de litige
  // (chargeback Stripe), M2 produira ici un outcome `{kind:'dispute', ...}` et
  // l'aiguillera vers son recordDisputeTransition (ecommerce-disputes.ts —
  // hors file-ownership M1). M1 ne traite QUE 'transition' ci-dessous.

  // Dédup : provider_ref sert d'identifiant d'événement déterministe (le
  // provider renvoie une ref stable par transition). UNIQUE(provider,
  // provider_event_id) ⇒ INSERT OR IGNORE : 0 ligne affectée = rejeu.
  const eventId = outcome.payment_ref;
  const insertRes = await env.DB.prepare(
    `INSERT OR IGNORE INTO payment_events
       (id, provider, provider_event_id, type, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    pid,
    eventId,
    outcome.status,
    JSON.stringify({ order_id: outcome.order_id, status: outcome.status }),
  ).run();

  const inserted = (insertRes.meta?.changes ?? 0) > 0;
  if (!inserted) {
    // Rejeu déjà traité → no-op idempotent (200, pas de double-commit).
    return json({ ok: true, duplicate: true });
  }

  await recordPaymentTransition(env, {
    order_id: outcome.order_id,
    payment_ref: outcome.payment_ref,
    status: outcome.status,
  });

  return json({ ok: true });
}

// ════════════════════════════════════════════════════════════════════════════
// M1.4 — recordPaymentTransition : pont paiement → lifecycle E3 (SEUL pont)
// ════════════════════════════════════════════════════════════════════════════

/**
 * SEUL déclencheur du pont paiement → cycle de vie commande.
 * Map PaymentStatus → financial_status :
 *   - 'paid'        → réutilise le lifecycle E3 via commitOrderSale
 *                     (commitSale gardé !paid_at, IDEMPOTENT — pas de
 *                     double-commit sur rejeu).
 *   - 'pending_cod' → la commande RESTE 'unpaid' (COD ≠ capture). On ne
 *                     touche pas le stock ni paid_at.
 *   - 'failed'      → la commande RESTE 'unpaid', aucun commit stock.
 *   - 'pending' / 'authorized' → en attente, aucun effet lifecycle.
 *
 * Met à jour la ligne `payments` correspondante (status courant). ZÉRO
 * duplication de la logique stock/statut (déléguée à commitOrderSale qui
 * réutilise commitSale E3). Idempotent de bout en bout.
 */
export async function recordPaymentTransition(
  env: Env,
  input: { order_id: string; payment_ref: string; status: PaymentStatus },
): Promise<{ committed: boolean }> {
  const { order_id, payment_ref, status } = input;

  // Retrouve le paiement (par ref provider) pour résoudre le tenant — pas de
  // confiance aveugle au payload : on relie à NOTRE ligne payments.
  const pay = (await env.DB.prepare(
    `SELECT id, client_id, order_id FROM payments
      WHERE provider_ref = ? AND order_id = ? LIMIT 1`,
  ).bind(payment_ref, order_id).first()) as
    | { id: string; client_id: string; order_id: string }
    | null;

  if (!pay) {
    // Aucune ligne locale : on n'invente pas de transition (sécurité).
    return { committed: false };
  }

  // Statut du paiement mis à jour (traçabilité) — toujours sûr.
  await env.DB.prepare(
    "UPDATE payments SET status = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(status, pay.id).run();

  if (status === 'paid') {
    // ⚠️ ZONE RÉGULÉE — concrétisation financière. Réutilise le lifecycle E3
    // (idempotent : commitOrderSale est no-op si déjà payé).
    return await commitOrderSale(env, pay.client_id, pay.order_id, 'payment_webhook');
  }

  // pending_cod / failed / pending / authorized : la commande reste 'unpaid'.
  // Aucun commit stock, aucun paid_at — COD n'est PAS un encaissement.
  return { committed: false };
}
