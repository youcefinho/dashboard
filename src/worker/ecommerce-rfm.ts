// ── Sprint E7 M2 — Segmentation RFM paramétrable ────────────────────────────
//
// Recency / Frequency / Monetary → RfmSegment (union E1 RFM_SEGMENTS, jamais
// redéfinie). Les agrégats source (customers.last_order_at / orders_count /
// total_spent_cents) sont peuplés par M1 (ecommerce-customer-metrics.ts) — on
// les LIT, on ne les recalcule pas ici.
//
// Conventions strictes Chaman :
//   - Multi-tenant STRICT : WHERE client_id = ? partout.
//   - PAS de magic number hardcodé : tous les seuils viennent de
//     customer_segment_config (seedé idempotemment via INSERT OR IGNORE).
//   - Idempotent : un rejeu produit exactement le même rfm_segment.
//   - Batch borné (LIMIT 50, pattern processWorkflowQueue / M1) — best-effort
//     par client (un échec isolé ne casse pas le lot). Additif, non destructif.
//   - AUCUN ALTER : seule table neuve = customer_segment_config (M2.1).

import type { Env } from './types';
import type { RfmSegment } from '../lib/types';
import { json } from './helpers';
import { getClientModules } from './modules';

type Auth = { userId: string; role: string };

// ── Défauts de seuils (seedés une fois par client, JAMAIS lus en dur) ────────
//
// Ces valeurs ne servent qu'à amorcer customer_segment_config la 1re fois
// (INSERT OR IGNORE). Une fois la ligne créée, c'est la config tenant qui fait
// foi : un tenant peut surcharger ses seuils sans toucher au code.
const DEFAULT_RECENCY_DAYS = { hot: 30, warm: 90, cold: 180 };
const DEFAULT_FREQUENCY = { low: 1, mid: 3, high: 6 };
const DEFAULT_MONETARY_CENTS = { low: 5_000, mid: 25_000, high: 100_000 };

interface SegmentConfig {
  recency: { hot: number; warm: number; cold: number };
  frequency: { low: number; mid: number; high: number };
  monetary: { low: number; mid: number; high: number };
  abandoned_cart_ttl_minutes: number;
}

function safeParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    const v = JSON.parse(raw) as Partial<T>;
    return { ...fallback, ...(v as object) } as T;
  } catch {
    return fallback;
  }
}

/**
 * Lit (ou seed idempotemment) la config de segmentation d'un tenant.
 *
 * Exporté pour réutilisation par ecommerce-cart-recovery.ts (le TTL panier
 * abandonné vit dans la même table — une seule source de vérité par tenant).
 * INSERT OR IGNORE ⇒ aucun double-INSERT possible (UNIQUE(client_id)).
 */
export async function getSegmentConfig(
  env: Env,
  clientId: string,
): Promise<SegmentConfig> {
  // Seed best-effort des défauts (idempotent : la 2e fois = no-op grâce à
  // UNIQUE(client_id) + OR IGNORE).
  await env.DB.prepare(
    `INSERT OR IGNORE INTO customer_segment_config
       (client_id, recency_days_json, frequency_thresholds_json,
        monetary_thresholds_json, abandoned_cart_ttl_minutes)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      clientId,
      JSON.stringify(DEFAULT_RECENCY_DAYS),
      JSON.stringify(DEFAULT_FREQUENCY),
      JSON.stringify(DEFAULT_MONETARY_CENTS),
      1440,
    )
    .run();

  const row = (await env.DB.prepare(
    `SELECT recency_days_json, frequency_thresholds_json,
            monetary_thresholds_json, abandoned_cart_ttl_minutes
       FROM customer_segment_config WHERE client_id = ? LIMIT 1`,
  )
    .bind(clientId)
    .first()) as {
    recency_days_json: string | null;
    frequency_thresholds_json: string | null;
    monetary_thresholds_json: string | null;
    abandoned_cart_ttl_minutes: number | null;
  } | null;

  return {
    recency: safeParse(row?.recency_days_json, DEFAULT_RECENCY_DAYS),
    frequency: safeParse(row?.frequency_thresholds_json, DEFAULT_FREQUENCY),
    monetary: safeParse(row?.monetary_thresholds_json, DEFAULT_MONETARY_CENTS),
    abandoned_cart_ttl_minutes:
      typeof row?.abandoned_cart_ttl_minutes === 'number' &&
      row.abandoned_cart_ttl_minutes > 0
        ? row.abandoned_cart_ttl_minutes
        : 1440,
  };
}

// ── Scoring R/F/M → score 1..3 ──────────────────────────────────────────────

/** Récence : plus c'est récent, plus le score est haut (3 = très récent). */
function recencyScore(daysSinceLastOrder: number | null, c: SegmentConfig): number {
  if (daysSinceLastOrder === null) return 0; // jamais commandé
  if (daysSinceLastOrder <= c.recency.hot) return 3;
  if (daysSinceLastOrder <= c.recency.warm) return 2;
  if (daysSinceLastOrder <= c.recency.cold) return 1;
  return 0;
}

function frequencyScore(ordersCount: number, c: SegmentConfig): number {
  if (ordersCount >= c.frequency.high) return 3;
  if (ordersCount >= c.frequency.mid) return 2;
  if (ordersCount >= c.frequency.low) return 1;
  return 0;
}

function monetaryScore(totalSpentCents: number, c: SegmentConfig): number {
  if (totalSpentCents >= c.monetary.high) return 3;
  if (totalSpentCents >= c.monetary.mid) return 2;
  if (totalSpentCents >= c.monetary.low) return 1;
  return 0;
}

/**
 * Mappe (R,F,M) ∈ {0..3}³ vers la taxonomie E1 RFM_SEGMENTS. Déterministe ⇒
 * idempotent (mêmes agrégats ⇒ même segment). Union autorisée :
 * champions | loyal | potential_loyalist | new | promising |
 * needs_attention | at_risk | hibernating | lost.
 */
function deriveSegment(r: number, f: number, m: number): RfmSegment {
  // Aucune commande comptable : pas de récence ⇒ client « nouveau » ou perdu.
  if (r === 0 && f === 0 && m === 0) return 'lost';

  const value = f + m; // engagement + valeur combinés

  // Très récent : on protège / capitalise.
  if (r === 3) {
    if (value >= 5) return 'champions';
    if (value >= 3) return 'loyal';
    if (f <= 1) return 'new';
    return 'potential_loyalist';
  }

  // Récent moyen : potentiel à activer.
  if (r === 2) {
    if (value >= 5) return 'loyal';
    if (value >= 3) return 'potential_loyalist';
    return 'promising';
  }

  // Ancien (r === 1) : risque de décrochage croissant avec la valeur passée.
  if (r === 1) {
    if (value >= 4) return 'at_risk';
    return 'needs_attention';
  }

  // r === 0 mais a déjà commandé (F/M > 0) : dormant.
  if (value >= 3) return 'at_risk';
  if (value >= 1) return 'hibernating';
  return 'lost';
}

// ── Helper unitaire (contrat figé) ──────────────────────────────────────────

interface CustomerAggRow {
  id: string;
  last_order_at: string | null;
  orders_count: number | null;
  total_spent_cents: number | null;
}

function daysBetween(fromIso: string | null, nowMs: number): number | null {
  if (!fromIso) return null;
  const t = Date.parse(fromIso.includes('T') ? fromIso : fromIso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/**
 * Recalcule rfm_segment pour un client précis (customerId fourni) ou pour TOUS
 * les clients d'un tenant (customerId omis, page bornée LIMIT 200 pour rester
 * sûr sous le cron). UPDATE ciblé idempotent. Lit les agrégats peuplés par M1.
 *
 * Contrat FIGÉ : recomputeRfm(env, clientId, customerId?) -> { updated }.
 */
export async function recomputeRfm(
  env: Env,
  clientId: string,
  customerId?: string,
): Promise<{ updated: number }> {
  const config = await getSegmentConfig(env, clientId);
  const nowMs = Date.now();

  const rows = customerId
    ? ([
        (await env.DB.prepare(
          `SELECT id, last_order_at, orders_count, total_spent_cents
             FROM customers WHERE id = ? AND client_id = ? LIMIT 1`,
        )
          .bind(customerId, clientId)
          .first()) as CustomerAggRow | null,
      ].filter(Boolean) as CustomerAggRow[])
    : (((
        await env.DB.prepare(
          `SELECT id, last_order_at, orders_count, total_spent_cents
             FROM customers WHERE client_id = ?
             ORDER BY updated_at DESC LIMIT 200`,
        )
          .bind(clientId)
          .all()
      ).results || []) as unknown as CustomerAggRow[]);

  let updated = 0;
  for (const cust of rows) {
    try {
      const rDays = daysBetween(cust.last_order_at, nowMs);
      const fCount = Math.max(0, Math.round(cust.orders_count || 0));
      const mCents = Math.max(0, Math.round(cust.total_spent_cents || 0));

      const segment = deriveSegment(
        recencyScore(rDays, config),
        frequencyScore(fCount, config),
        monetaryScore(mCents, config),
      );

      // UPDATE ciblé idempotent (multi-tenant strict).
      await env.DB.prepare(
        `UPDATE customers
            SET rfm_segment = ?, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
        .bind(segment, cust.id, clientId)
        .run();
      updated += 1;
    } catch (err) {
      console.error('recomputeRfm failed', cust.id, err);
    }
  }

  return { updated };
}

// ── Batch cron (contrat figé : SANS request) ────────────────────────────────

/**
 * Recalcul RFM batch borné — pattern processWorkflowQueue : on prend les
 * clients (tenant + customer) touchés récemment, page LIMIT 50, best-effort.
 * Le cron repasse régulièrement (couverture progressive). Idempotent.
 *
 * Contrat FIGÉ : recomputeAllRfmSegments(env) -> { updated }.
 */
export async function recomputeAllRfmSegments(
  env: Env,
): Promise<{ updated: number }> {
  const { results } = await env.DB.prepare(
    `SELECT client_id, id AS customer_id
       FROM customers
      WHERE last_order_at IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 50`,
  ).all();

  const rows = (results || []) as Array<{ client_id: string; customer_id: string }>;
  let updated = 0;
  for (const r of rows) {
    try {
      const res = await recomputeRfm(env, r.client_id, r.customer_id);
      updated += res.updated;
    } catch (err) {
      console.error('recomputeAllRfmSegments batch failed', r.customer_id, err);
    }
  }
  return { updated };
}

// ── HTTP handler (contrat figé : (request, env, auth)) ──────────────────────

async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/**
 * POST /api/ecommerce/customers/rfm/recompute
 * Body optionnel { customer_id?: string } — recalcul ciblé ou tenant entier.
 * Réponse : { updated: number }.
 */
export async function handleRecomputeRfm(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) {
    return json(
      { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
      400,
    );
  }

  let customerId: string | undefined;
  try {
    const body = (await request.json()) as { customer_id?: string } | null;
    if (body && typeof body.customer_id === 'string' && body.customer_id) {
      customerId = body.customer_id;
    }
  } catch {
    // pas de body / body invalide ⇒ recalcul tenant entier (borné)
  }

  const { updated } = await recomputeRfm(env, clientId, customerId);
  return json({ data: { updated } });
}
