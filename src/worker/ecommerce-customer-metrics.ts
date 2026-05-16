// ── Sprint E7 M1 — Customer 360 + métriques LTV multi-devise ─────────────────
//
// Recalcul des agrégats client (customers.total_spent_cents / orders_count /
// avg_order_value_cents / first_order_at / last_order_at) + payload Customer
// 360 (vue unifiée commandes / remboursements / expéditions / retours /
// panier / lead CRM).
//
// ⚠️ DÉCISION FIGÉE CHAMAN — LTV PAR DEVISE BOUTIQUE :
//   - total_spent_cents = somme NET (commandes − remboursements 'succeeded'),
//     UNIQUEMENT pour la devise boutique (resolveRegionContext().currency).
//   - AUCUNE conversion FX (aucun taux de change en base ⇒ convertir serait du
//     hardcode INTERDIT). On ne somme JAMAIS CAD + EUR + DZD.
//   - Les autres devises sont ventilées séparément (spend_by_currency) — pour
//     information, jamais agrégées dans total_spent_cents.
//
// Conventions strictes :
//   - Multi-tenant STRICT : client_id propagé partout (WHERE client_id = ?).
//   - Money en cents (INTEGER). Recalcul FULL (jamais incrémental) ⇒ idempotent
//     bit-pour-bit (un rejeu produit exactement le même résultat).
//   - AUCUN ALTER : les colonnes agrégées existent depuis E1, peuplées par un
//     UPDATE ciblé. migration-sprintE7-m1.sql = index perf uniquement.
//   - RÉUTILISE resolveRegionContext (E-R) + getLinkedLeadForCustomer (E1) +
//     pattern de pagination bornée processWorkflowQueue (workflows.ts) — zéro
//     duplication de logique existante.

import type { Env } from './types';
import type { SupportedCurrency } from '../lib/types';
import { resolveRegionContext } from './ecommerce-region';
import { getLinkedLeadForCustomer } from './customer-reconcile';
import { json } from './helpers';
import { getClientModules } from './modules';

type Auth = { userId: string; role: string };

// Statuts de commande comptés dans la LTV (commande honorée ou en cours de
// traitement ; 'refunded' inclus puis NET des remboursements succeeded ;
// 'pending'/'cancelled' EXCLUS = pas de revenu concrétisé).
const COUNTED_STATUSES = ['paid', 'preparing', 'shipped', 'delivered', 'refunded'];

interface OrderAggRow {
  currency: string | null;
  total_cents: number;
  status: string;
  placed_at: string | null;
  order_id: string;
}

interface CurrencyAgg {
  gross_cents: number;
  orders_count: number;
  refunded_cents: number;
  first_order_at: string | null;
  last_order_at: string | null;
  order_ids: string[];
}

/**
 * Recalcule de façon FULL (jamais incrémental ⇒ idempotent) les agrégats d'un
 * client puis les écrit par UPDATE ciblé.
 *
 * NET-OF-REFUNDS : total_spent_cents = SUM(orders.total_cents WHERE status ∈
 * COUNTED_STATUSES AND currency = devise_boutique) − SUM(refunds.amount_cents
 * 'succeeded' rattachés à CES commandes), clampé ≥ 0. Les autres devises sont
 * agrégées séparément (jamais sommées à la devise boutique — aucune FX).
 *
 * Garde-fou guest checkout : customer_id nullable ⇒ if(!customerId) no-op.
 *
 * Contrat FIGÉ (M2/M3 en dépendent) : retourne la devise boutique + les
 * agrégats NETS de la devise boutique.
 */
export async function recomputeCustomerMetrics(
  env: Env,
  clientId: string,
  customerId: string | null | undefined,
): Promise<{
  total_spent_cents: number;
  orders_count: number;
  avg_order_value_cents: number;
  currency: string;
}> {
  // Devise boutique de référence (résolue côté tenant — JAMAIS hardcodée).
  const region = await resolveRegionContext(env, clientId);
  const shopCurrency: SupportedCurrency = region.currency;

  // Garde-fou guest checkout : pas de client ⇒ rien à recalculer.
  if (!customerId) {
    return {
      total_spent_cents: 0,
      orders_count: 0,
      avg_order_value_cents: 0,
      currency: shopCurrency,
    };
  }

  // Toutes les commandes comptables du client, multi-tenant strict. La devise
  // par commande prime ; à défaut (NULL legacy) on rattache à la devise
  // boutique (rétro-compat E3 où currency pouvait être implicite).
  const placeholders = COUNTED_STATUSES.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT id AS order_id,
            COALESCE(NULLIF(currency, ''), ?) AS currency,
            total_cents, status, placed_at
       FROM orders
      WHERE client_id = ? AND customer_id = ?
        AND status IN (${placeholders})`,
  )
    .bind(shopCurrency, clientId, customerId, ...COUNTED_STATUSES)
    .all();

  const orders = (results || []) as unknown as OrderAggRow[];

  // Agrégation par devise (ventilation — aucune somme cross-devise).
  const byCurrency = new Map<string, CurrencyAgg>();
  for (const o of orders) {
    const cur = (o.currency || shopCurrency).toUpperCase();
    let agg = byCurrency.get(cur);
    if (!agg) {
      agg = {
        gross_cents: 0,
        orders_count: 0,
        refunded_cents: 0,
        first_order_at: null,
        last_order_at: null,
        order_ids: [],
      };
      byCurrency.set(cur, agg);
    }
    agg.gross_cents += Math.max(0, Math.round(o.total_cents || 0));
    agg.orders_count += 1;
    agg.order_ids.push(o.order_id);
    const placed = o.placed_at;
    if (placed) {
      if (!agg.first_order_at || placed < agg.first_order_at) agg.first_order_at = placed;
      if (!agg.last_order_at || placed > agg.last_order_at) agg.last_order_at = placed;
    }
  }

  // Remboursements 'succeeded' rattachés aux commandes du client, ventilés par
  // devise du refund (refunds.currency = devise du paiement source). NET par
  // devise — jamais de soustraction cross-devise.
  if (orders.length > 0) {
    const allIds = orders.map((o) => o.order_id);
    // Chunk borné (D1 limite le nombre de bind params) — pattern défensif.
    for (let i = 0; i < allIds.length; i += 50) {
      const chunk = allIds.slice(i, i + 50);
      const ph = chunk.map(() => '?').join(', ');
      const { results: refRows } = await env.DB.prepare(
        `SELECT UPPER(COALESCE(NULLIF(currency, ''), ?)) AS currency,
                COALESCE(SUM(amount_cents), 0) AS refunded
           FROM refunds
          WHERE client_id = ? AND status = 'succeeded'
            AND order_id IN (${ph})
          GROUP BY UPPER(COALESCE(NULLIF(currency, ''), ?))`,
      )
        .bind(shopCurrency, clientId, ...chunk, shopCurrency)
        .all();
      for (const r of (refRows || []) as Array<{ currency: string; refunded: number }>) {
        const agg = byCurrency.get((r.currency || shopCurrency).toUpperCase());
        if (agg) agg.refunded_cents += Math.max(0, Math.round(r.refunded || 0));
      }
    }
  }

  // Devise boutique : agrégat NET clampé ≥ 0 (jamais négatif).
  const shopAgg = byCurrency.get(shopCurrency.toUpperCase());
  const netSpent = shopAgg
    ? Math.max(0, shopAgg.gross_cents - shopAgg.refunded_cents)
    : 0;
  const ordersCount = shopAgg ? shopAgg.orders_count : 0;
  const aov = ordersCount > 0 ? Math.round(netSpent / ordersCount) : 0;
  const firstAt = shopAgg ? shopAgg.first_order_at : null;
  const lastAt = shopAgg ? shopAgg.last_order_at : null;

  // UPDATE ciblé (multi-tenant strict). first_order_at/last_order_at = NULL si
  // aucune commande dans la devise boutique (recalcul full ⇒ idempotent).
  await env.DB.prepare(
    `UPDATE customers
        SET total_spent_cents = ?,
            orders_count = ?,
            avg_order_value_cents = ?,
            first_order_at = ?,
            last_order_at = ?,
            updated_at = datetime('now')
      WHERE id = ? AND client_id = ?`,
  )
    .bind(netSpent, ordersCount, aov, firstAt, lastAt, customerId, clientId)
    .run();

  return {
    total_spent_cents: netSpent,
    orders_count: ordersCount,
    avg_order_value_cents: aov,
    currency: shopCurrency,
  };
}

/**
 * Recalcul batch (cron) — BORNÉ. Pattern identique à processWorkflowQueue :
 * page de LIMIT 50, on traite les clients touchés par une commande comptable.
 * Best-effort par client (un échec isolé ne casse pas le batch). Idempotent
 * (recalcul full par client). Non destructif.
 */
export async function recomputeAllCustomerMetrics(
  env: Env,
): Promise<{ updated: number }> {
  // Clients distincts ayant au moins une commande comptable (borne LIMIT 50,
  // pattern pagination workflows.ts — le cron repasse régulièrement).
  const placeholders = COUNTED_STATUSES.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT client_id, customer_id
       FROM orders
      WHERE customer_id IS NOT NULL
        AND status IN (${placeholders})
      GROUP BY client_id, customer_id
      ORDER BY MAX(updated_at) DESC
      LIMIT 50`,
  )
    .bind(...COUNTED_STATUSES)
    .all();

  const rows = (results || []) as Array<{ client_id: string; customer_id: string }>;
  let updated = 0;
  for (const r of rows) {
    try {
      await recomputeCustomerMetrics(env, r.client_id, r.customer_id);
      updated += 1;
    } catch (err) {
      console.error('recomputeCustomerMetrics batch failed', r.customer_id, err);
    }
  }
  return { updated };
}

// ════════════════════════════════════════════════════════════════════════════
// M1.4 — GET /api/ecommerce/customers/:id/360
// ════════════════════════════════════════════════════════════════════════════

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

/**
 * GET /api/ecommerce/customers/:id/360 — vue unifiée du client.
 *
 * Agrège : customer + metrics (NET devise boutique) + spend_by_currency
 * (ventilation, jamais sommée) + orders[] + refunds[] + shipments[] (READ
 * ecommerce-shipments) + returns[] (READ ecommerce-returns) + active_cart +
 * linked_lead (getLinkedLeadForCustomer E1 réutilisé). Multi-tenant strict.
 */
export async function handleGetCustomer360(
  env: Env,
  auth: Auth,
  customerId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const customer = (await env.DB.prepare(
    'SELECT * FROM customers WHERE id = ? AND client_id = ?',
  )
    .bind(customerId, clientId)
    .first()) as Record<string, unknown> | null;
  if (!customer) return json({ error: 'Client introuvable' }, 404);

  // Recalcul à la volée (idempotent) ⇒ metrics toujours fraîches sur la fiche.
  const metrics = await recomputeCustomerMetrics(env, clientId, customerId);

  // Commandes du client (toutes, récentes d'abord).
  const { results: orderRows } = await env.DB.prepare(
    `SELECT * FROM orders
      WHERE client_id = ? AND customer_id = ?
      ORDER BY created_at DESC`,
  )
    .bind(clientId, customerId)
    .all();
  const orders = (orderRows || []) as Array<Record<string, unknown>>;
  const orderIds = orders.map((o) => String(o.id));

  // Ventilation multi-devise (NET par devise — aucune somme cross-devise).
  const spendMap = new Map<
    string,
    { currency: string; net_spent_cents: number; orders_count: number }
  >();
  for (const o of orders) {
    const status = String(o.status || '');
    if (!COUNTED_STATUSES.includes(status)) continue;
    const cur = String(o.currency || metrics.currency || 'CAD').toUpperCase();
    let s = spendMap.get(cur);
    if (!s) {
      s = { currency: cur, net_spent_cents: 0, orders_count: 0 };
      spendMap.set(cur, s);
    }
    s.net_spent_cents += Math.max(0, Math.round((o.total_cents as number) || 0));
    s.orders_count += 1;
  }

  let refunds: Array<Record<string, unknown>> = [];
  if (orderIds.length > 0) {
    for (let i = 0; i < orderIds.length; i += 50) {
      const chunk = orderIds.slice(i, i + 50);
      const ph = chunk.map(() => '?').join(', ');
      const { results: refRows } = await env.DB.prepare(
        `SELECT * FROM refunds
          WHERE client_id = ? AND order_id IN (${ph})
          ORDER BY created_at DESC`,
      )
        .bind(clientId, ...chunk)
        .all();
      refunds = refunds.concat((refRows || []) as Array<Record<string, unknown>>);
    }
    // Déduit les remboursements succeeded de la ventilation (NET par devise).
    for (const rf of refunds) {
      if (String(rf.status || '') !== 'succeeded') continue;
      const cur = String(rf.currency || metrics.currency || 'CAD').toUpperCase();
      const s = spendMap.get(cur);
      if (s) {
        s.net_spent_cents = Math.max(
          0,
          s.net_spent_cents - Math.max(0, Math.round((rf.amount_cents as number) || 0)),
        );
      }
    }
  }

  // Shipments + returns (READ seul — modules E5/E6, multi-tenant strict).
  let shipments: Array<Record<string, unknown>> = [];
  let returns: Array<Record<string, unknown>> = [];
  if (orderIds.length > 0) {
    for (let i = 0; i < orderIds.length; i += 50) {
      const chunk = orderIds.slice(i, i + 50);
      const ph = chunk.map(() => '?').join(', ');
      const { results: shRows } = await env.DB.prepare(
        `SELECT * FROM shipments
          WHERE client_id = ? AND order_id IN (${ph})
          ORDER BY created_at DESC`,
      )
        .bind(clientId, ...chunk)
        .all();
      shipments = shipments.concat((shRows || []) as Array<Record<string, unknown>>);

      const { results: rtRows } = await env.DB.prepare(
        `SELECT * FROM return_requests
          WHERE client_id = ? AND order_id IN (${ph})
          ORDER BY created_at DESC`,
      )
        .bind(clientId, ...chunk)
        .all();
      returns = returns.concat((rtRows || []) as Array<Record<string, unknown>>);
    }
  }

  // Panier actif du client (le plus récent non converti / non abandonné).
  const activeCart = (await env.DB.prepare(
    `SELECT * FROM carts
      WHERE client_id = ? AND customer_id = ? AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1`,
  )
    .bind(clientId, customerId)
    .first()) as Record<string, unknown> | null;

  // Lien CRM (réutilise le helper bidirectionnel E1 — zéro duplication).
  let linkedLead: { id: string; name: string; email: string } | null = null;
  try {
    linkedLead = await getLinkedLeadForCustomer(env, customerId);
  } catch {
    linkedLead = null;
  }

  return json({
    data: {
      customer,
      metrics,
      spend_by_currency: Array.from(spendMap.values()),
      orders,
      refunds,
      shipments,
      returns,
      active_cart: activeCart,
      linked_lead: linkedLead,
    },
  });
}
