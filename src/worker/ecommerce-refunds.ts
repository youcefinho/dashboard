// ── Sprint E6 M1 — Remboursements e-commerce (endpoints + bridge financier) ──
//
// ⚠️ FRONTIÈRE RÉGULÉE — ce fichier orchestre le REMBOURSEMENT marchand
// e-commerce (B2). DISTINCT de src/worker/billing.ts (abo SaaS Intralys —
// INTOUCHABLE) et des Invoices/CRM. Le chemin remboursement live est balisé
// `⚠️ ZONE RÉGULÉE`. Inoffensif tant que payment_provider_config
// .payments_live_enabled=0 (Stripe forcé sk_test_ via resolveStripeSecret
// réutilisé dans stripe-provider.refund — JAMAIS contourné ici).
//
// PCI minimal : AUCUNE donnée carte. On ne manipule que des références opaques
// (payments.provider_ref / refunds.provider_ref).
//
// Conventions strictes :
//   - Multi-tenant STRICT : client_id résolu via getClientModules.
//   - Money en cents INTEGER. Idempotence partout (refund + restock + bridge).
//   - RÉUTILISE : provider.refund? (registry E4), releaseStock (E2),
//     STATUS/financial machine NON dupliquée. recordPaymentTransition (E4)
//     NON modifié — recordRefundTransition est un pont PARALLÈLE dédié.
//   - AUCUN ALTER orders : recordRefundTransition pose financial_status par
//     UPDATE ciblé (financial_status/refunded/partially_refunded existent E1).
//
// Note types.ts (M3 writer ce sprint) : on n'écrit PAS types.ts. Le type
// minimal de retour du bridge réutilise `FinancialStatus` déjà exporté E1.
// Si M3 ajoute un type `Refund` côté lib/types, ce module restera compatible.

import type { Env } from './types';
import type { FinancialStatus } from '../lib/types';
import { json, audit } from './helpers';
import { getClientModules } from './modules';
import { resolvePaymentProvider } from './ecommerce-payments';
import { releaseStock } from './ecommerce-inventory';

type Auth = { userId: string; role: string };

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
// Lignes DB minimales (typage local — M3 possède lib/types ce sprint)
// ════════════════════════════════════════════════════════════════════════════

interface OrderRefundRow {
  id: string;
  client_id: string;
  financial_status: string | null;
}

interface PaymentRefundRow {
  id: string;
  client_id: string;
  order_id: string;
  provider: string;
  amount_cents: number;
  currency: string;
  provider_ref: string | null;
  status: string;
}

interface RefundRow {
  id: string;
  order_id: string;
  payment_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  provider_ref: string | null;
  idempotency_key: string;
  reason: string | null;
  restocked: number;
  created_at: string;
}

// ════════════════════════════════════════════════════════════════════════════
// M1.4 — recordRefundTransition : SEUL décideur partially_refunded/refunded
// ════════════════════════════════════════════════════════════════════════════

/**
 * SEUL décideur du `financial_status` lié au remboursement.
 *
 * Recalcule de façon DÉTERMINISTE la somme des remboursements 'succeeded'
 * d'une commande vs le montant payé (payments.amount_cents du paiement
 * source), puis pose `orders.financial_status` :
 *   - somme == 0                 → on ne touche RIEN (laisse l'état courant).
 *   - 0 < somme < payé           → 'partially_refunded'
 *   - somme >= payé              → 'refunded'
 *
 * UPDATE CIBLÉ sur orders.financial_status — on NE duplique PAS la machine de
 * statut E3, on NE modifie PAS recordPaymentTransition (pont parallèle).
 * Idempotent : recalcul déterministe → un rejeu produit le MÊME résultat
 * (aucune accumulation, aucun effet de bord). Multi-tenant strict.
 *
 * Réutilisable par M2 (RMA / dispute) : appelez après avoir inséré/maj une
 * ligne `refunds` en statut 'succeeded'.
 */
export async function recordRefundTransition(
  env: Env,
  input: { order_id: string; refund_id: string; amount_cents: number; status: string },
): Promise<{ financial_status: FinancialStatus }> {
  const { order_id } = input;

  // Retrouve la commande + un paiement source (montant payé de référence).
  const order = (await env.DB.prepare(
    'SELECT id, client_id, financial_status FROM orders WHERE id = ? LIMIT 1',
  ).bind(order_id).first()) as OrderRefundRow | null;

  if (!order) {
    // Pas de commande locale → on n'invente aucune transition (sécurité).
    return { financial_status: 'unpaid' };
  }

  // Montant payé de référence : somme des paiements encaissés de la commande
  // (statut 'paid'). À défaut, on prend le max amount_cents observé (garde-fou
  // défensif si la ligne payment n'est pas en 'paid' mais un refund existe).
  const paidRow = (await env.DB.prepare(
    `SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS paid_sum,
        COALESCE(MAX(amount_cents), 0) AS max_amount
       FROM payments
      WHERE client_id = ? AND order_id = ?`,
  ).bind(order.client_id, order_id).first()) as
    | { paid_sum: number; max_amount: number }
    | null;

  const paidCents = Math.max(
    0,
    Math.round((paidRow?.paid_sum ?? 0) || (paidRow?.max_amount ?? 0)),
  );

  // Somme DÉTERMINISTE des remboursements concrétisés (succeeded).
  const refRow = (await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS refunded_sum
       FROM refunds
      WHERE client_id = ? AND order_id = ? AND status = 'succeeded'`,
  ).bind(order.client_id, order_id).first()) as { refunded_sum: number } | null;

  const refundedCents = Math.max(0, Math.round(refRow?.refunded_sum ?? 0));

  let next: FinancialStatus;
  if (refundedCents <= 0) {
    // Aucun remboursement concrétisé → on conserve l'état courant tel quel.
    next = (order.financial_status as FinancialStatus) || 'unpaid';
    return { financial_status: next };
  }
  if (paidCents > 0 && refundedCents >= paidCents) {
    next = 'refunded';
  } else {
    next = 'partially_refunded';
  }

  // ⚠️ ZONE RÉGULÉE — transition financière (remboursement). UPDATE ciblé,
  // idempotent (recalcul déterministe : rejeu = même valeur posée).
  await env.DB.prepare(
    "UPDATE orders SET financial_status = ?, updated_at = datetime('now') WHERE id = ? AND client_id = ?",
  ).bind(next, order_id, order.client_id).run();

  return { financial_status: next };
}

// ════════════════════════════════════════════════════════════════════════════
// M1.3 — POST /api/ecommerce/orders/:id/refund   (handler figé pour M2/worker)
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/ecommerce/orders/:id/refund
 *   body { amount_cents?, reason?, restock_items?: string[] }
 *
 * Garde-fous (FR québécois) :
 *   - 404 commande / paiement source introuvable.
 *   - 422 si le provider ne supporte pas le remboursement (cod sans API n'est
 *     PAS un blocage : il a un refund() no-op tracé ; le 422 vise un futur
 *     provider sans refund?).
 *   - 409 si SUM(refunds non-failed) + montant demandé > montant payé.
 *   - idempotency_key déterministe `refund:<order>:<amount>:<seq>` →
 *     INSERT OR IGNORE + relecture (anti double-remboursement, pattern
 *     handleInitPayment).
 *   - restock optionnel via releaseStock (E2, idempotent) si `restock_items`
 *     fourni ; refunds.restocked=1 pose un verrou anti double-restock.
 *
 * ⚠️ ZONE RÉGULÉE — remboursement live (revue Rochdi requise). Inoffensif
 * tant que payments_live_enabled=0 (Stripe forcé sk_test_).
 */
export async function handleCreateRefund(
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

  const order = (await env.DB.prepare(
    'SELECT id, client_id, financial_status FROM orders WHERE id = ? AND client_id = ?',
  ).bind(orderId, clientId).first()) as OrderRefundRow | null;
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  // Paiement source : le plus récent paiement encaissé ('paid') de la commande
  // (le remboursement se rattache au débit réel). À défaut, le plus récent.
  const payment = (await env.DB.prepare(
    `SELECT id, client_id, order_id, provider, amount_cents, currency, provider_ref, status
       FROM payments
      WHERE client_id = ? AND order_id = ?
      ORDER BY (status = 'paid') DESC, created_at DESC
      LIMIT 1`,
  ).bind(clientId, orderId).first()) as PaymentRefundRow | null;
  if (!payment) {
    return json(
      {
        error: 'Aucun paiement',
        message: 'Aucun paiement encaissé n\'est rattaché à cette commande — rien à rembourser.',
      },
      404,
    );
  }

  const paidCents = Math.max(0, Math.round(payment.amount_cents || 0));

  // Montant : explicite si fourni (>0), sinon remboursement TOTAL du reliquat.
  // Somme des remboursements NON échoués (pending+succeeded) déjà engagés.
  const sumRow = (await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS engaged
       FROM refunds
      WHERE client_id = ? AND order_id = ? AND status != 'failed'`,
  ).bind(clientId, orderId).first()) as { engaged: number } | null;
  const alreadyEngaged = Math.max(0, Math.round(sumRow?.engaged ?? 0));
  const remaining = Math.max(0, paidCents - alreadyEngaged);

  const requested = Number.isFinite(body.amount_cents as number)
    ? Math.max(0, Math.round(body.amount_cents as number))
    : remaining;

  if (requested <= 0) {
    return json(
      {
        error: 'Montant invalide',
        message: 'Le montant à rembourser doit être supérieur à zéro.',
      },
      400,
    );
  }

  // Garde-fou montant : on ne rembourse JAMAIS plus que le montant payé.
  if (alreadyEngaged + requested > paidCents) {
    return json(
      {
        error: 'Montant trop élevé',
        message: `Impossible : ce remboursement (${requested} ¢) dépasse le solde remboursable. Payé ${paidCents} ¢, déjà engagé ${alreadyEngaged} ¢, reste ${remaining} ¢.`,
      },
      409,
    );
  }

  // Résolution du provider (registry E4). Si pas de méthode refund? → 422.
  const resolved = await resolvePaymentProvider(env, clientId);
  const provider = resolved.provider;
  const providerRefund = provider?.refund;
  if (!provider || typeof providerRefund !== 'function') {
    return json(
      {
        error: 'Remboursement non supporté',
        message: `Le remboursement n'est pas pris en charge pour le mode de paiement « ${payment.provider} » de cette commande.`,
      },
      422,
    );
  }

  // Idempotence : clé déterministe `refund:<order>:<amount>:<seq>`. seq =
  // nombre de remboursements déjà enregistrés (toute statut) → stable sur
  // rejeu d'une MÊME demande (même order+amount+seq), distincte pour un
  // remboursement partiel ultérieur.
  const seqRow = (await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM refunds WHERE client_id = ? AND order_id = ?',
  ).bind(clientId, orderId).first()) as { n: number } | null;
  const seq = Math.max(0, Math.round(seqRow?.n ?? 0));
  const idemKey = `refund:${orderId}:${requested}:${seq}`;

  // Anti double-remboursement : ligne existante non-échouée pour cette clé →
  // on la retourne sans rappeler le provider (pattern handleInitPayment).
  const existing = (await env.DB.prepare(
    `SELECT id, order_id, payment_id, amount_cents, currency, status,
            provider_ref, idempotency_key, reason, restocked, created_at
       FROM refunds
      WHERE client_id = ? AND idempotency_key = ?
      LIMIT 1`,
  ).bind(clientId, idemKey).first()) as RefundRow | null;
  if (existing && existing.status !== 'failed') {
    return json({ data: shapeRefund(existing) });
  }

  // ⚠️ ZONE RÉGULÉE — appel remboursement provider. stripe-provider.refund
  // réutilise resolveStripeSecret (clé sk_test_ forcée tant que
  // payments_live_enabled=0) — garde-fou NON contourné. cod = no-op tracé,
  // dz = stub no-op (régulé).
  let providerRef = '';
  let refundStatus: 'succeeded' | 'pending' | 'failed' = 'pending';
  try {
    const res = await providerRefund(
      env,
      {
        client_id: payment.client_id,
        provider_ref: payment.provider_ref,
        currency: payment.currency,
      },
      requested,
      idemKey,
    );
    providerRef = res.provider_ref;
    refundStatus = res.status;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Échec du remboursement côté fournisseur.';
    // On trace la tentative échouée (status 'failed') pour audit + n'engage
    // PAS le solde (le garde-fou montant ignore les 'failed').
    const failId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO refunds
         (id, client_id, order_id, payment_id, amount_cents, currency,
          status, provider_ref, idempotency_key, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?)`,
    ).bind(
      failId, clientId, orderId, payment.id, requested, payment.currency,
      null, idemKey, ((body.reason as string) || '').slice(0, 500) || null, auth.userId,
    ).run();
    await audit(env, auth.userId, 'create', 'order', orderId, {
      refund: 'failed', amount_cents: requested, provider: payment.provider, error: msg,
    });
    return json(
      { error: 'Remboursement refusé', message: `Le fournisseur a refusé le remboursement : ${msg}` },
      502,
    );
  }

  // Insertion idempotente (UNIQUE client_id,idempotency_key) + relecture.
  const refundId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO refunds
       (id, client_id, order_id, payment_id, amount_cents, currency,
        status, provider_ref, idempotency_key, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    refundId, clientId, orderId, payment.id, requested, payment.currency,
    refundStatus, providerRef, idemKey,
    ((body.reason as string) || '').slice(0, 500) || null, auth.userId,
  ).run();

  const row = (await env.DB.prepare(
    `SELECT id, order_id, payment_id, amount_cents, currency, status,
            provider_ref, idempotency_key, reason, restocked, created_at
       FROM refunds WHERE client_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(clientId, idemKey).first()) as RefundRow | null;

  // Restock optionnel : seulement si demandé ET pas déjà restocké pour CETTE
  // ligne (verrou refunds.restocked, anti double-restock). releaseStock (E2)
  // est lui-même idempotent (borne à reserved). On libère la réservation des
  // variantes listées (qty 1 par défaut — la quantité fine relève de M2 RMA).
  const restockItems = Array.isArray(body.restock_items)
    ? (body.restock_items as unknown[]).map((v) => String(v)).filter(Boolean)
    : [];
  if (row && restockItems.length > 0 && row.restocked === 0) {
    for (const variantId of restockItems) {
      await releaseStock(env, variantId, 1, {
        type: 'refund', id: orderId, by: auth.userId,
      });
    }
    await env.DB.prepare(
      "UPDATE refunds SET restocked = 1, updated_at = datetime('now') WHERE id = ? AND client_id = ?",
    ).bind(row.id, clientId).run();
  }

  // Pont financier : SEUL décideur partially_refunded/refunded (idempotent).
  let financialStatus: FinancialStatus = (order.financial_status as FinancialStatus) || 'unpaid';
  if (row && row.status === 'succeeded') {
    const bridge = await recordRefundTransition(env, {
      order_id: orderId,
      refund_id: row.id,
      amount_cents: row.amount_cents,
      status: row.status,
    });
    financialStatus = bridge.financial_status;

    // Sprint E7 M1 — recalcul agrégats client BEST-EFFORT (LTV net-of-refunds,
    // idempotent). N'échoue JAMAIS le remboursement (recordRefundTransition E6
    // strictement inchangé ci-dessus).
    try {
      const co = (await env.DB.prepare(
        'SELECT customer_id FROM orders WHERE id = ? AND client_id = ?',
      ).bind(orderId, clientId).first()) as { customer_id: string | null } | null;
      const { recomputeCustomerMetrics } = await import('./ecommerce-customer-metrics');
      await recomputeCustomerMetrics(env, clientId, co?.customer_id ?? null);
    } catch { /* best-effort : silencieux, ne casse jamais le remboursement */ }

    // Sprint E9 M1 — déclencheur workflow 'refund_issued' BEST-EFFORT
    // (moteur Sprint 46 réutilisé). Seulement sur remboursement concrétisé
    // ('succeeded'). N'échoue JAMAIS le remboursement (recordRefundTransition
    // E6 strictement inchangé).
    try {
      const cr = (await env.DB.prepare(
        'SELECT customer_id FROM orders WHERE id = ? AND client_id = ?',
      ).bind(orderId, clientId).first()) as { customer_id: string | null } | null;
      const { autoEnrollForTrigger } = await import('./workflows');
      await autoEnrollForTrigger(env, 'refund_issued', { customerId: cr?.customer_id ?? undefined, orderId });
    } catch { /* best-effort : silencieux, ne casse jamais le remboursement */ }
  }

  await audit(env, auth.userId, 'create', 'order', orderId, {
    refund: row?.id, amount_cents: requested, status: row?.status,
    provider: payment.provider, financial_status: financialStatus,
  });

  const data = row ? shapeRefund(row) : null;
  return json({ data, financial_status: financialStatus }, 201);
}

// ════════════════════════════════════════════════════════════════════════════
// M1.3 — GET /api/ecommerce/orders/:id/refunds
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ecommerce/orders/:id/refunds — liste des remboursements (récents
 * d'abord) de la commande. Multi-tenant strict (client_id résolu).
 */
export async function handleListRefunds(
  env: Env,
  auth: Auth,
  orderId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const order = (await env.DB.prepare(
    'SELECT id FROM orders WHERE id = ? AND client_id = ?',
  ).bind(orderId, clientId).first()) as { id: string } | null;
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  const res = await env.DB.prepare(
    `SELECT id, order_id, payment_id, amount_cents, currency, status,
            provider_ref, idempotency_key, reason, restocked, created_at
       FROM refunds
      WHERE client_id = ? AND order_id = ?
      ORDER BY created_at DESC`,
  ).bind(clientId, orderId).all();

  const rows = (res.results || []) as unknown as RefundRow[];
  return json({ data: rows.map(shapeRefund) });
}

// ────────────────────────────────────────────────────────────────────────────
// Shaping (réfs opaques uniquement — aucune donnée sensible)
// ────────────────────────────────────────────────────────────────────────────

function shapeRefund(r: RefundRow): Record<string, unknown> {
  return {
    id: r.id,
    order_id: r.order_id,
    payment_id: r.payment_id,
    amount_cents: r.amount_cents,
    currency: r.currency,
    status: r.status,
    provider_ref: r.provider_ref,
    reason: r.reason,
    restocked: r.restocked === 1,
    created_at: r.created_at,
  };
}
