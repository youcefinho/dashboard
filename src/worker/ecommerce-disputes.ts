// ── Sprint E6 M2 — Litiges / chargebacks e-commerce (enregistrement + liste) ─
//
// ⚠️ FRONTIÈRE RÉGULÉE — ce fichier orchestre le LITIGE (chargeback) marchand
// e-commerce (B2). DISTINCT de src/worker/billing.ts (abo SaaS Intralys —
// INTOUCHABLE, ne JAMAIS copier son mock signature) et des Invoices/CRM.
//
// ⚠️ ZONE RÉGULÉE — revue Rochdi requise (traitement dispute / impact fonds).
// RÈGLE DE SÛRETÉ : un webhook dispute = UN ENREGISTREMENT DB SEULEMENT. AUCUN
// mouvement de fonds n'est déclenché ici. Le seul effet financier possible
// (dispute = remboursement forcé constaté) passe par recordRefundTransition M1
// (UPDATE ciblé déterministe idempotent) — JAMAIS une réimplémentation. Tant
// que payment_provider_config.payments_live_enabled=0 (défaut), tout est
// inoffensif (sandbox, aucun fonds réel).
//
// La SIGNATURE du webhook est vérifiée EN AMONT par le provider via
// verifyStripeSignature (stripe-provider.ts, vraie HMAC-SHA256 WebCrypto). On
// ne re-mock JAMAIS la signature ici, et on ne touche JAMAIS billing.ts.
//
// Conventions strictes :
//   - Multi-tenant STRICT (client_id résolu depuis NOTRE ligne payments, pas
//     de confiance aveugle au payload provider).
//   - Idempotence : dédup UNIQUE(provider, provider_dispute_ref) sur disputes
//     (INSERT OR IGNORE + relecture — pattern payment_events M1).
//   - Money en cents INTEGER. ZÉRO donnée carte (réfs opaques uniquement).

import type { Env } from './types';
// Type discriminé FIGÉ exposé par M1 (ecommerce-payments.ts) — on code CONTRE
// sa branche `kind:'dispute'`. M1 reste 0 modif (consommation seulement).
import type { PaymentWebhookOutcome } from './ecommerce-payments';
import type { FinancialStatus } from '../lib/types';
import { json } from './helpers';
import { getClientModules } from './modules';
// RÉUTILISE le SEUL décideur financial_status M1 — JAMAIS dupliqué.
import { recordRefundTransition } from './ecommerce-refunds';
// Renforcement V2 — disputes-engine (isValidDisputeStatus câblé sur
// validation future PATCH status — le INSERT reste hardcodé 'open').
import { isValidDisputeStatus as _isValidDisputeStatus } from './lib/disputes-engine';
void _isValidDisputeStatus;

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

// Branche `dispute` du type discriminé M1 (extraite pour lisibilité — code
// CONTRE le contrat figé, pas de redéfinition divergente).
type DisputeOutcome = Extract<PaymentWebhookOutcome, { kind: 'dispute' }>;

interface PaymentDisputeRow {
  id: string;
  client_id: string;
  order_id: string;
  provider: string;
  amount_cents: number;
}

interface DisputeRow {
  id: string;
  client_id: string;
  order_id: string;
  payment_id: string | null;
  provider: string;
  provider_dispute_ref: string;
  status: string;
  amount_cents: number;
  evidence_json: string | null;
  created_at: string;
  updated_at: string;
}

// ════════════════════════════════════════════════════════════════════════════
// M2.2 — handleDisputeWebhook : litige provider → enregistrement DB (régulé)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Traite un litige (chargeback) reçu via le dispatcher webhook M1.
 *
 * Appelé UNIQUEMENT quand `handlePaymentWebhook` (M1) produit un outcome
 * `{ kind: 'dispute', ... }`. La SIGNATURE du webhook a DÉJÀ été vérifiée par
 * le provider (verifyStripeSignature, vraie HMAC) — on NE re-mock RIEN ici, on
 * NE touche JAMAIS billing.ts.
 *
 * ⚠️ ZONE RÉGULÉE — revue Rochdi requise (traitement dispute). RÈGLE STRICTE :
 * cette fonction ENREGISTRE le litige (table `disputes`) et NE déclenche AUCUN
 * mouvement de fonds. Le seul effet financier autorisé (dispute = remboursement
 * forcé déjà constaté côté provider) passe par recordRefundTransition M1
 * (recalcul DÉTERMINISTE idempotent à partir des `refunds` 'succeeded'
 * existants) — on ne crée AUCUN refund, on ne réimplémente RIEN.
 *
 * Idempotence : dédup UNIQUE(provider, provider_dispute_ref). Un rejeu du même
 * litige ⇒ aucune insertion neuve, aucun double-effet.
 *
 * Multi-tenant : le tenant est résolu depuis NOTRE ligne `payments`
 * (provider_ref = payment_ref AND order_id), jamais depuis le payload brut.
 */
export async function handleDisputeWebhook(
  env: Env,
  outcome: DisputeOutcome,
): Promise<{ recorded: boolean; financial_status?: FinancialStatus }> {
  const { order_id, payment_ref, dispute_ref } = outcome;

  // Relie le litige à NOTRE ligne payments (pas de confiance aveugle au
  // payload) → résout client_id + provider + montant de référence.
  const pay = (await env.DB.prepare(
    `SELECT id, client_id, order_id, provider, amount_cents
       FROM payments
      WHERE provider_ref = ? AND order_id = ?
      LIMIT 1`,
  ).bind(payment_ref, order_id).first()) as PaymentDisputeRow | null;

  if (!pay) {
    // Aucune ligne locale : on n'invente aucun litige (sécurité multi-tenant).
    return { recorded: false };
  }

  const amountCents = Math.max(0, Math.round(pay.amount_cents || 0));

  // ⚠️ ZONE RÉGULÉE — enregistrement litige (revue Rochdi requise). Dédup
  // anti-rejeu UNIQUE(provider, provider_dispute_ref) : INSERT OR IGNORE puis
  // relecture (0 ligne affectée = rejeu → no-op idempotent). AUCUN mouvement
  // de fonds déclenché par cette insertion.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO disputes
       (client_id, order_id, payment_id, provider, provider_dispute_ref,
        status, amount_cents)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`,
  ).bind(
    pay.client_id, pay.order_id, pay.id, pay.provider, dispute_ref, amountCents,
  ).run();

  const row = (await env.DB.prepare(
    `SELECT id, client_id, order_id, payment_id, provider, provider_dispute_ref,
            status, amount_cents, evidence_json, created_at, updated_at
       FROM disputes
      WHERE provider = ? AND provider_dispute_ref = ?
      LIMIT 1`,
  ).bind(pay.provider, dispute_ref).first()) as DisputeRow | null;

  if (!row) return { recorded: false };

  // Impact financier DÉFENSIF : on NE crée AUCUN refund ici (régulé). On se
  // contente d'appeler le SEUL décideur M1 (recordRefundTransition) qui
  // RECALCULE financial_status de façon déterministe à partir des `refunds`
  // 'succeeded' DÉJÀ existants. S'il n'y a aucun refund concrétisé (cas
  // nominal d'un litige juste ouvert), recordRefundTransition est un NO-OP
  // total (refundedCents<=0 → conserve l'état courant). Idempotent, aucun
  // mouvement de fonds. La gestion fine du litige (soumission de preuve,
  // remboursement forcé) reste une ZONE RÉGULÉE — revue Rochdi requise.
  let financialStatus: FinancialStatus | undefined;
  try {
    const bridge = await recordRefundTransition(env, {
      order_id: pay.order_id,
      refund_id: row.id,
      amount_cents: row.amount_cents,
      status: 'open',
    });
    financialStatus = bridge.financial_status;
  } catch {
    // Le pont est défensif (no-op si rien à faire) ; on ne propage pas une
    // erreur de recalcul comme un échec du simple enregistrement du litige.
    financialStatus = undefined;
  }

  return { recorded: true, financial_status: financialStatus };
}

// ════════════════════════════════════════════════════════════════════════════
// M2.2 — GET /api/ecommerce/disputes  (liste tenant, récents d'abord)
// ════════════════════════════════════════════════════════════════════════════

function shapeDispute(d: DisputeRow): Record<string, unknown> {
  return {
    id: d.id,
    order_id: d.order_id,
    payment_id: d.payment_id,
    provider: d.provider,
    provider_dispute_ref: d.provider_dispute_ref,
    status: d.status,
    amount_cents: d.amount_cents,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

/**
 * GET /api/ecommerce/disputes — litiges du tenant (récents d'abord).
 * Multi-tenant strict (client_id résolu). Gating requireModule('ecommerce')
 * hérité du bloc /api/ecommerce/* (worker.ts).
 */
export async function handleListDisputes(env: Env, auth: Auth): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const res = await env.DB.prepare(
    `SELECT id, client_id, order_id, payment_id, provider, provider_dispute_ref,
            status, amount_cents, evidence_json, created_at, updated_at
       FROM disputes
      WHERE client_id = ?
      ORDER BY created_at DESC`,
  ).bind(clientId).all();

  const rows = (res.results || []) as unknown as DisputeRow[];
  return json({ data: rows.map(shapeDispute) });
}
