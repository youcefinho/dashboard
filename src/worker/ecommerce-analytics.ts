// ── Sprint E9 M2 — Analytics e-commerce multi-devise (DERNIER sprint roadmap) ─
//
// Endpoints analytics LIVE (aucune table dédiée — requêtes directes bornées sur
// orders / order_items / refunds, index créés par migration-sprintE9-m1.sql) :
//   - GET /api/ecommerce/analytics/revenue      → revenu NET par devise + AOV
//   - GET /api/ecommerce/analytics/cohorts      → rétention par mois d'acquis.
//   - GET /api/ecommerce/analytics/ltv          → LTV par devise + repurchase
//   - GET /api/ecommerce/analytics/top-products → top produits par devise
//
// ⚠️ DÉCISION FIGÉE CHAMAN — MULTI-DEVISE JAMAIS SOMMÉE :
//   Aucun taux de change en base ⇒ convertir = hardcode INTERDIT. On ventile
//   STRICTEMENT par devise (group by currency), JAMAIS CAD + EUR + DZD. Pattern
//   COUNTED_STATUSES + ventilation copié de ecommerce-customer-metrics.ts (E7)
//   — recopié LOCALEMENT, ce module n'appelle PAS customer-metrics en croisé.
//
// Conventions strictes du projet :
//   - Multi-tenant STRICT : clientId résolu via getClientModules, WHERE
//     client_id = ? PARTOUT (jamais de fuite cross-tenant).
//   - Money en cents (INTEGER). Lectures BORNÉES (fenêtre temporelle + LIMIT +
//     index M1). Garde défensive : vide ⇒ structures vides, JAMAIS 500.
//   - Additif / non destructif : zéro ALTER, zéro écriture (analytics = lecture
//     seule). reports.ts (table leads) INTOUCHÉ — fichier neuf séparé.

import type { Env, RevenueByCurrency, CohortRow, TopProductRow } from './types';
import { json } from './helpers';
import { getClientModules } from './modules';
// Renforcement V2 — constantes de fenêtre analytics depuis l'engine.
import {
  MAX_WINDOW_DAYS,
  DEFAULT_WINDOW_DAYS,
} from './lib/ecommerce-analytics-engine';

type Auth = { userId: string; role: string };

// Statuts comptés dans le revenu/LTV — identique E7 (commande honorée ou en
// traitement ; 'refunded' inclus puis NET des refunds 'succeeded' ;
// 'pending'/'cancelled' EXCLUS = aucun revenu concrétisé). Recopié local.
const COUNTED_STATUSES = ['paid', 'preparing', 'shipped', 'delivered', 'refunded'];

const COHORT_MONTHS = 12;          // fenêtre cohortes bornée (12 mois)
const TOP_PRODUCTS_LIMIT = 20;     // top produits borné
const REFUND_CHUNK = 50;           // chunk binds (pattern défensif E7)

// ── Helpers tenant / réponses (style ecommerce-customer-metrics.ts) ──────────

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
 * Fenêtre temporelle bornée depuis ?days= (défaut 90, plafond 730). Retourne le
 * borne basse ISO 'YYYY-MM-DD HH:MM:SS' (convention datetime('now'), PAS
 * unixepoch). Toute valeur invalide ⇒ défaut (jamais d'erreur).
 */
function resolveWindowStart(url: URL): { days: number; sinceIso: string } {
  const raw = parseInt(url.searchParams.get('days') || '', 10);
  let days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WINDOW_DAYS;
  if (days > MAX_WINDOW_DAYS) days = MAX_WINDOW_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Format 'YYYY-MM-DD HH:MM:SS' aligné sur datetime('now') (comparable lexico).
  const sinceIso = since.toISOString().slice(0, 19).replace('T', ' ');
  return { days, sinceIso };
}

interface OrderRow {
  order_id: string;
  currency: string;
  total_cents: number;
  status: string;
  placed_at: string | null;
  customer_id: string | null;
}

/**
 * Charge les commandes comptables du tenant sur la fenêtre, bornées. Devise par
 * commande prime ; NULL legacy ⇒ 'CAD' (rétro-compat E3, jamais sommé). Utilise
 * idx_orders_client_status_placed (M1). LIMIT dur de sécurité.
 */
async function loadCountedOrders(
  env: Env,
  clientId: string,
  sinceIso: string,
  limit: number,
): Promise<OrderRow[]> {
  const ph = COUNTED_STATUSES.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT id AS order_id,
            UPPER(COALESCE(NULLIF(currency, ''), 'CAD')) AS currency,
            total_cents, status, placed_at, customer_id
       FROM orders
      WHERE client_id = ?
        AND status IN (${ph})
        AND COALESCE(placed_at, created_at) >= ?
      ORDER BY COALESCE(placed_at, created_at) DESC
      LIMIT ?`,
  )
    .bind(clientId, ...COUNTED_STATUSES, sinceIso, limit)
    .all();
  return ((results || []) as unknown as OrderRow[]).map((o) => ({
    ...o,
    total_cents: Math.max(0, Math.round(o.total_cents || 0)),
  }));
}

/**
 * Remboursements 'succeeded' ventilés par devise pour un lot d'order_ids
 * (chunké — D1 limite les binds). NET par devise — jamais cross-devise.
 */
async function loadRefundsByCurrency(
  env: Env,
  clientId: string,
  orderIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < orderIds.length; i += REFUND_CHUNK) {
    const chunk = orderIds.slice(i, i + REFUND_CHUNK);
    const ph = chunk.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT UPPER(COALESCE(NULLIF(currency, ''), 'CAD')) AS currency,
              COALESCE(SUM(amount_cents), 0) AS refunded
         FROM refunds
        WHERE client_id = ? AND status = 'succeeded'
          AND order_id IN (${ph})
        GROUP BY UPPER(COALESCE(NULLIF(currency, ''), 'CAD'))`,
    )
      .bind(clientId, ...chunk)
      .all();
    for (const r of (results || []) as Array<{ currency: string; refunded: number }>) {
      const cur = (r.currency || 'CAD').toUpperCase();
      out.set(cur, (out.get(cur) || 0) + Math.max(0, Math.round(r.refunded || 0)));
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// M2.1 — GET /api/ecommerce/analytics/revenue
// ════════════════════════════════════════════════════════════════════════════

/**
 * Revenu NET-of-refunds GROUPÉ PAR DEVISE (jamais sommé cross-devise) :
 * net = max(0, SUM(orders.total_cents comptés) − SUM(refunds 'succeeded')),
 * + AOV + nb commandes. Fenêtre ?days= bornée. Garde défensive (vide ⇒ []).
 */
export async function handleEcommerceRevenue(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const { days, sinceIso } = resolveWindowStart(url);
    const orders = await loadCountedOrders(env, clientId, sinceIso, 50000);

    if (orders.length === 0) {
      return json({ data: { window_days: days, by_currency: [] as RevenueByCurrency[] } });
    }

    // Agrégat brut par devise (aucune somme cross-devise).
    const agg = new Map<string, { gross: number; orders: number }>();
    for (const o of orders) {
      const cur = (o.currency || 'CAD').toUpperCase();
      const a = agg.get(cur) || { gross: 0, orders: 0 };
      a.gross += o.total_cents;
      a.orders += 1;
      agg.set(cur, a);
    }

    // Refunds 'succeeded' ventilés par devise (NET par devise).
    const refundsByCur = await loadRefundsByCurrency(
      env,
      clientId,
      orders.map((o) => o.order_id),
    );

    const byCurrency: RevenueByCurrency[] = [];
    for (const [currency, a] of agg) {
      const refunds = refundsByCur.get(currency) || 0;
      const net = Math.max(0, a.gross - refunds);
      byCurrency.push({
        currency,
        gross: a.gross,
        refunds,
        net,
        orders: a.orders,
        aov: a.orders > 0 ? Math.round(net / a.orders) : 0,
      });
    }
    byCurrency.sort((x, y) => y.net - x.net);

    return json({ data: { window_days: days, by_currency: byCurrency } });
  } catch (err) {
    console.error('handleEcommerceRevenue failed', err);
    return json({ data: { window_days: DEFAULT_WINDOW_DAYS, by_currency: [] as RevenueByCurrency[] } });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M2.2a — GET /api/ecommerce/analytics/cohorts
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cohortes de rétention par MOIS D'ACQUISITION (1re commande comptée), fenêtre
 * bornée 12 mois. retention[i] = % de la cohorte ayant (re)commandé au mois
 * M+i. retention[0] = 100 par définition (mois d'acquisition). Clients guest
 * (customer_id NULL) ignorés (pas de rétention traçable). Garde défensive.
 */
export async function handleEcommerceCohorts(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    // Fenêtre cohortes : 12 mois glissants (borne dure indépendante de ?days=).
    void url;
    const since = new Date();
    since.setMonth(since.getMonth() - COHORT_MONTHS);
    const sinceIso = since.toISOString().slice(0, 19).replace('T', ' ');

    const orders = await loadCountedOrders(env, clientId, sinceIso, 50000);
    const withCustomer = orders.filter((o) => o.customer_id && (o.placed_at || true));
    if (withCustomer.length === 0) {
      return json({ data: { cohorts: [] as CohortRow[] } });
    }

    // mois 'YYYY-MM' d'une date ISO (placed_at ou fallback).
    const monthOf = (iso: string | null): string | null => {
      if (!iso) return null;
      const s = String(iso);
      return s.length >= 7 ? s.slice(0, 7) : null;
    };
    // Index mois absolu (depuis epoch) pour calcul offset M+i sans dérive.
    const monthIdx = (ym: string): number => {
      const parts = ym.split('-').map((n) => parseInt(n, 10));
      return (parts[0] ?? 0) * 12 + ((parts[1] ?? 1) - 1);
    };

    // 1er mois d'achat compté par client = mois d'acquisition (cohorte).
    const firstMonth = new Map<string, string>();
    // Ensemble des mois actifs par client.
    const activeMonths = new Map<string, Set<string>>();
    for (const o of withCustomer) {
      const cid = String(o.customer_id);
      const ym = monthOf(o.placed_at);
      if (!ym) continue;
      const cur = firstMonth.get(cid);
      if (!cur || ym < cur) firstMonth.set(cid, ym);
      let set = activeMonths.get(cid);
      if (!set) {
        set = new Set<string>();
        activeMonths.set(cid, set);
      }
      set.add(ym);
    }

    // Regroupe les clients par cohorte (mois d'acquisition).
    const cohortMembers = new Map<string, string[]>();
    for (const [cid, fm] of firstMonth) {
      const arr = cohortMembers.get(fm) || [];
      arr.push(cid);
      cohortMembers.set(fm, arr);
    }

    const cohorts: CohortRow[] = [];
    const sortedMonths = Array.from(cohortMembers.keys()).sort();
    for (const cm of sortedMonths) {
      const members = cohortMembers.get(cm)!;
      const size = members.length;
      const baseIdx = monthIdx(cm);
      // Profondeur = nb de mois entre la cohorte et maintenant (borné 12).
      const depth = Math.min(
        COHORT_MONTHS,
        monthIdx(new Date().toISOString().slice(0, 7)) - baseIdx + 1,
      );
      const retention: number[] = [];
      for (let i = 0; i < Math.max(1, depth); i++) {
        let activeCount = 0;
        for (const cid of members) {
          const set = activeMonths.get(cid);
          if (!set) continue;
          // Un client est actif au mois M+i s'il a une commande ce mois-là.
          for (const ym of set) {
            if (monthIdx(ym) === baseIdx + i) {
              activeCount += 1;
              break;
            }
          }
        }
        retention.push(size > 0 ? Math.round((activeCount / size) * 100) : 0);
      }
      cohorts.push({ month: cm, size, retention });
    }

    return json({ data: { cohorts } });
  } catch (err) {
    console.error('handleEcommerceCohorts failed', err);
    return json({ data: { cohorts: [] as CohortRow[] } });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M2.2b — GET /api/ecommerce/analytics/ltv
// ════════════════════════════════════════════════════════════════════════════

/**
 * LTV PAR DEVISE (jamais sommée cross-devise) : net total / nb clients distincts
 * ayant commandé dans cette devise, + repurchase_rate global = % clients avec
 * ≥ 2 commandes comptées (toutes devises confondues — c'est un ratio, pas un
 * montant ⇒ pas de problème FX). Garde défensive (vide ⇒ structures vides).
 */
export async function handleEcommerceLtv(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const { days, sinceIso } = resolveWindowStart(url);
    const orders = await loadCountedOrders(env, clientId, sinceIso, 50000);
    const withCustomer = orders.filter((o) => o.customer_id);

    if (withCustomer.length === 0) {
      return json({ data: { window_days: days, by_currency: [], repurchase_rate: 0 } });
    }

    const refundsByCur = await loadRefundsByCurrency(
      env,
      clientId,
      orders.map((o) => o.order_id),
    );

    // Par devise : gross + clients distincts.
    const perCur = new Map<string, { gross: number; customers: Set<string> }>();
    // Nb de commandes comptées par client (toutes devises) ⇒ repurchase.
    const ordersPerCustomer = new Map<string, number>();
    for (const o of withCustomer) {
      const cid = String(o.customer_id);
      const cur = (o.currency || 'CAD').toUpperCase();
      const p = perCur.get(cur) || { gross: 0, customers: new Set<string>() };
      p.gross += o.total_cents;
      p.customers.add(cid);
      perCur.set(cur, p);
      ordersPerCustomer.set(cid, (ordersPerCustomer.get(cid) || 0) + 1);
    }

    const byCurrency = [] as Array<{
      currency: string;
      net: number;
      customers: number;
      ltv: number;
    }>;
    for (const [currency, p] of perCur) {
      const refunds = refundsByCur.get(currency) || 0;
      const net = Math.max(0, p.gross - refunds);
      const customers = p.customers.size;
      byCurrency.push({
        currency,
        net,
        customers,
        ltv: customers > 0 ? Math.round(net / customers) : 0,
      });
    }
    byCurrency.sort((x, y) => y.net - x.net);

    const totalCustomers = ordersPerCustomer.size;
    let repeat = 0;
    for (const n of ordersPerCustomer.values()) if (n >= 2) repeat += 1;
    const repurchase_rate =
      totalCustomers > 0 ? Math.round((repeat / totalCustomers) * 100) : 0;

    return json({ data: { window_days: days, by_currency: byCurrency, repurchase_rate } });
  } catch (err) {
    console.error('handleEcommerceLtv failed', err);
    return json({ data: { window_days: DEFAULT_WINDOW_DAYS, by_currency: [], repurchase_rate: 0 } });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M2.2c — GET /api/ecommerce/analytics/top-products
// ════════════════════════════════════════════════════════════════════════════

/**
 * Top produits (order_items joints aux commandes comptées) : quantité + revenu
 * VENTILÉ PAR DEVISE de la commande (jamais sommé cross-devise). Bornée
 * (fenêtre + LIMIT). Garde défensive (vide ⇒ []).
 */
export async function handleEcommerceTopProducts(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const { days, sinceIso } = resolveWindowStart(url);
    const ph = COUNTED_STATUSES.map(() => '?').join(', ');

    // Jointure order_items ↔ orders (commandes comptées du tenant, fenêtre).
    // GROUP BY variant_id + devise ⇒ ventilation stricte. LIMIT dur.
    const { results } = await env.DB.prepare(
      `SELECT oi.variant_id AS variant_id,
              MAX(COALESCE(NULLIF(oi.product_title_snapshot, ''), 'Produit')) AS title,
              UPPER(COALESCE(NULLIF(o.currency, ''), 'CAD')) AS currency,
              SUM(oi.quantity) AS qty,
              SUM(oi.total_cents) AS revenue_cents
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.client_id = ?
          AND o.status IN (${ph})
          AND COALESCE(o.placed_at, o.created_at) >= ?
          AND oi.variant_id IS NOT NULL
        GROUP BY oi.variant_id, UPPER(COALESCE(NULLIF(o.currency, ''), 'CAD'))
        ORDER BY revenue_cents DESC
        LIMIT ?`,
    )
      .bind(clientId, ...COUNTED_STATUSES, sinceIso, TOP_PRODUCTS_LIMIT)
      .all();

    const products: TopProductRow[] = ((results || []) as Array<{
      variant_id: string;
      title: string;
      currency: string;
      qty: number;
      revenue_cents: number;
    }>).map((r) => ({
      variant_id: String(r.variant_id),
      title: String(r.title || 'Produit'),
      qty: Math.max(0, Math.round(r.qty || 0)),
      revenue_cents: Math.max(0, Math.round(r.revenue_cents || 0)),
      currency: (r.currency || 'CAD').toUpperCase(),
    }));

    return json({ data: { window_days: days, products } });
  } catch (err) {
    console.error('handleEcommerceTopProducts failed', err);
    return json({ data: { window_days: DEFAULT_WINDOW_DAYS, products: [] as TopProductRow[] } });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 4 LOT-ECOM4 §6.G — EXTENSION ADDITIVE (Manager-C), LECTURE SEULE
// GET /api/ecommerce/analytics/sales-by-channel (handler PRÊT — câblage route
// GELÉ Phase A : worker.ts ne sera PAS modifié par Phase C ; aucune route
// n'est encore câblée pour cet endpoint, la fonction est exportée prête à
// l'emploi pour un câblage Phase A ultérieur).
//
// ⚠ STRICTEMENT ADDITIF : aucun handler analytics existant ci-dessus n'est
//   modifié. CA par PÉRIODE (mois) × CANAL (orders.source) VENTILÉ PAR DEVISE
//   — JAMAIS sommé cross-devise (garde-fou figé :10-14). Données RÉELLES
//   uniquement (orders comptées, zéro chiffre fabriqué). Garde défensive :
//   vide ⇒ structure vide, JAMAIS 500 (calque :163-164). Bornage tenant
//   WHERE client_id = ? systématique. Lecture seule (zéro écriture/ALTER).
// ════════════════════════════════════════════════════════════════════════════

interface SalesByChannelRow {
  period: string;     // 'YYYY-MM' (mois d'enregistrement de la commande)
  channel: string;    // orders.source (web / subscription / manual / …)
  currency: string;   // devise de la commande (jamais agrégée cross-devise)
  orders: number;     // nb de commandes comptées de ce (mois, canal, devise)
  gross_cents: number;// somme total_cents — UNIQUEMENT au sein d'une devise
}

/**
 * CA par période (mois) × canal (orders.source) VENTILÉ PAR DEVISE. Net pas
 * calculé ici (pas de jointure refunds — extension gross volontairement
 * simple ; le NET-of-refunds par devise reste l'apanage de /revenue). Fenêtre
 * ?days= bornée (réutilise resolveWindowStart, plafond 730j). GROUP BY
 * (mois, source, devise) ⇒ aucune somme cross-devise. Garde défensive.
 */
export async function handleEcommerceSalesByChannel(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const { days, sinceIso } = resolveWindowStart(url);
    const ph = COUNTED_STATUSES.map(() => '?').join(', ');

    // GROUP BY mois × source × devise — ventilation STRICTE par devise. La
    // devise NULL legacy ⇒ 'CAD' (rétro-compat E3, calque loadCountedOrders).
    // Source vide ⇒ 'web' (défaut createOrderCore). Borné tenant + fenêtre +
    // LIMIT dur (≤ 24 mois × ~quelques canaux × ≤3 devises).
    const { results } = await env.DB.prepare(
      `SELECT substr(COALESCE(placed_at, created_at), 1, 7) AS period,
              LOWER(COALESCE(NULLIF(source, ''), 'web')) AS channel,
              UPPER(COALESCE(NULLIF(currency, ''), 'CAD')) AS currency,
              COUNT(*) AS orders,
              SUM(total_cents) AS gross_cents
         FROM orders
        WHERE client_id = ?
          AND status IN (${ph})
          AND COALESCE(placed_at, created_at) >= ?
        GROUP BY substr(COALESCE(placed_at, created_at), 1, 7),
                 LOWER(COALESCE(NULLIF(source, ''), 'web')),
                 UPPER(COALESCE(NULLIF(currency, ''), 'CAD'))
        ORDER BY period DESC, gross_cents DESC
        LIMIT 500`,
    )
      .bind(clientId, ...COUNTED_STATUSES, sinceIso)
      .all();

    const rows: SalesByChannelRow[] = ((results || []) as Array<{
      period: string | null;
      channel: string;
      currency: string;
      orders: number;
      gross_cents: number;
    }>)
      .filter((r) => r.period)
      .map((r) => ({
        period: String(r.period),
        channel: String(r.channel || 'web'),
        currency: (r.currency || 'CAD').toUpperCase(),
        orders: Math.max(0, Math.round(r.orders || 0)),
        gross_cents: Math.max(0, Math.round(r.gross_cents || 0)),
      }));

    return json({ data: { window_days: days, by_channel: rows } });
  } catch (err) {
    console.error('handleEcommerceSalesByChannel failed', err);
    return json({ data: { window_days: DEFAULT_WINDOW_DAYS, by_channel: [] as SalesByChannelRow[] } });
  }
}
