// ── Abonnements produit — Sprint 4 LOT E-COMMERCE B2 enrichi (2026-05-19) ────
//
// CRUD + cycle d'abonnements produit pour le module Boutique B2.
//
// PHASE C (Manager-C) = CORPS RÉEL des 6 handlers. Signatures FIGÉES au
// contrat docs/LOT-ECOM4.md §6.E — INCHANGÉES (Phase A les a câblées dans
// worker.ts). Le corps ci-dessous remplit les stubs SANS toucher worker.ts /
// api.ts / migration / i18n (tous GELÉS Phase A).
//
// MODÈLE FIGÉ (§6.E) — AUCUN PRÉLÈVEMENT RÉEL :
//   - Un abonnement = une variante commandée à intervalle régulier (table
//     NEUVE `product_subscriptions` seq 85). Aucune colonne paiement.
//   - À l'échéance (next_run_at <= now), le cycle appelle createOrderCore
//     (contrat FIGÉ, signature INCHANGÉE) avec une commande COD/mock
//     (source 'subscription'). createOrderCore réserve le stock, calcule
//     TPS/TVQ, génère le numéro — comportement strictement E3.
//   - JAMAIS de lecture `payments_live_enabled`, JAMAIS de touch tables
//     E4/E6 régulées (payments/refunds/disputes), JAMAIS de settlement/FX.
//
// Conventions strictes du projet :
//   - Multi-tenant STRICT : clientId via getClientModules (calque
//     ecommerce-orders.ts:76) → WHERE client_id = ?. JAMAIS de fuite.
//   - Gating requireModule('ecommerce') AMONT (bloc worker.ts). Mutations
//     (create/update/delete/cycle) = role admin (calque handleUpdateRegion
//     ecommerce-region.ts:254). ZÉRO capability ALL_CAPABILITIES (figée).
//   - Réponses { data } / { error } normalisées (apiFetch GELÉ, JAMAIS `code`).

import type { Env } from './types';
import { json } from './helpers';
import { getClientModules } from './modules';
import { createOrderCore } from './ecommerce-orders';

type Auth = { userId: string; role: string };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const DUE_BATCH = 100; // borne dure : nb max d'abonnements traités par run

const VALID_STATUS = ['active', 'paused', 'cancelled'];
const VALID_INTERVAL = ['day', 'week', 'month'];

/** Résout le client_id du tenant courant (calque ecommerce-orders.ts:76). */
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

function forbidden(): Response {
  return json(
    { error: 'Non autorisé', message: 'Action réservée aux administrateurs.' },
    403,
  );
}

function parsePaging(url: URL): { limit: number; offset: number } {
  const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') || '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

interface SubscriptionRow {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  customer_id: string | null;
  variant_id: string | null;
  quantity: number;
  interval_unit: string;
  interval_count: number;
  unit_price_cents: number;
  currency: string;
  status: string;
  next_run_at: string | null;
  last_run_at: string | null;
  cycles_completed: number;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Avance une date 'YYYY-MM-DD HH:MM:SS' (convention datetime('now')) de
 * `count` × `unit`. Calcul JS pur (pas de dépendance D1) ; rendu au même
 * format lexico-comparable que next_run_at. unit invalide ⇒ 'month'.
 */
function advanceRunAt(from: string | null, unit: string, count: number): string {
  const base = from ? new Date(from.replace(' ', 'T') + 'Z') : new Date();
  const d = isNaN(base.getTime()) ? new Date() : base;
  const n = Number.isFinite(count) && count > 0 ? Math.round(count) : 1;
  const u = VALID_INTERVAL.includes(unit) ? unit : 'month';
  if (u === 'day') d.setUTCDate(d.getUTCDate() + n);
  else if (u === 'week') d.setUTCDate(d.getUTCDate() + n * 7);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/ecommerce/subscriptions — liste paginée des abonnements du tenant
// ════════════════════════════════════════════════════════════════════════════

export async function handleListSubscriptions(
  env: Env, auth: Auth, url: URL,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const { limit, offset } = parsePaging(url);
    const statusFilter = (url.searchParams.get('status') || '').trim();
    const bindStatus = VALID_STATUS.includes(statusFilter) ? statusFilter : null;

    const where = bindStatus
      ? 'WHERE client_id = ? AND status = ?'
      : 'WHERE client_id = ?';
    const whereBinds = bindStatus ? [clientId, bindStatus] : [clientId];

    const countRow = (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_subscriptions ${where}`,
    ).bind(...whereBinds).first()) as { n: number } | null;

    const { results } = await env.DB.prepare(
      `SELECT id, client_id, agency_id, customer_id, variant_id, quantity,
              interval_unit, interval_count, unit_price_cents, currency, status,
              next_run_at, last_run_at, cycles_completed, created_at, updated_at
         FROM product_subscriptions
         ${where}
         ORDER BY datetime(COALESCE(next_run_at, created_at)) ASC, id ASC
         LIMIT ? OFFSET ?`,
    ).bind(...whereBinds, limit, offset).all();

    return json({ data: (results || []) as unknown as SubscriptionRow[], total: countRow?.n ?? 0 });
  } catch (err) {
    console.error('handleListSubscriptions failed', err);
    return json({ data: [], total: 0 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/ecommerce/subscriptions — création (admin only)
// ════════════════════════════════════════════════════════════════════════════

export async function handleCreateSubscription(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();

  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: {
    customer_id?: string | null;
    variant_id?: string;
    quantity?: number;
    interval_unit?: string;
    interval_count?: number;
    unit_price_cents?: number;
    currency?: string;
    agency_id?: string | null;
    next_run_at?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const variantId = (body.variant_id || '').toString().trim();
  if (!variantId) {
    return json({ error: 'Variante requise', message: 'Sélectionne une variante à renouveler.' }, 400);
  }

  const quantity = Math.max(1, Math.round(Number(body.quantity) || 1));
  const intervalUnit = VALID_INTERVAL.includes((body.interval_unit || '').toString())
    ? (body.interval_unit as string)
    : 'month';
  const intervalCount = Math.max(1, Math.round(Number(body.interval_count) || 1));
  const unitPriceCents = Math.max(0, Math.round(Number(body.unit_price_cents) || 0));
  const currency = (body.currency || 'CAD').toString().toUpperCase().slice(0, 3) || 'CAD';
  const customerId = body.customer_id ? body.customer_id.toString() : null;
  const agencyId = body.agency_id ? body.agency_id.toString() : null;
  // next_run_at fourni (ISO) sinon échéance immédiate (datetime('now')) → le
  // 1er run sera dû au prochain cycle. Aucune conversion, stockage tel quel.
  const nextRunAt = body.next_run_at ? body.next_run_at.toString() : null;

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO product_subscriptions
       (id, client_id, agency_id, customer_id, variant_id, quantity,
        interval_unit, interval_count, unit_price_cents, currency, status,
        next_run_at, last_run_at, cycles_completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', COALESCE(?, datetime('now')),
             NULL, 0, datetime('now'), datetime('now'))`,
  ).bind(
    id, clientId, agencyId, customerId, variantId, quantity,
    intervalUnit, intervalCount, unitPriceCents, currency, nextRunAt,
  ).run();

  return json({ data: { id } });
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/ecommerce/subscriptions/:id — détail (borné tenant)
// ════════════════════════════════════════════════════════════════════════════

export async function handleGetSubscription(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const row = (await env.DB.prepare(
      `SELECT id, client_id, agency_id, customer_id, variant_id, quantity,
              interval_unit, interval_count, unit_price_cents, currency, status,
              next_run_at, last_run_at, cycles_completed, created_at, updated_at
         FROM product_subscriptions
        WHERE id = ? AND client_id = ?`,
    ).bind(id, clientId).first()) as SubscriptionRow | null;

    if (!row) return json({ error: 'Abonnement introuvable' }, 404);
    return json({ data: row });
  } catch (err) {
    console.error('handleGetSubscription failed', err);
    return json({ error: 'Abonnement introuvable' }, 404);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/ecommerce/subscriptions/:id — maj / pause / reprise / annulation
// (admin only). status géré applicativement (énum sans CHECK §6.E).
// ════════════════════════════════════════════════════════════════════════════

export async function handleUpdateSubscription(
  request: Request, env: Env, auth: Auth, id: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();

  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: {
    quantity?: number;
    interval_unit?: string;
    interval_count?: number;
    unit_price_cents?: number;
    currency?: string;
    customer_id?: string | null;
    status?: string;
    next_run_at?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const existing = (await env.DB.prepare(
    `SELECT id FROM product_subscriptions WHERE id = ? AND client_id = ?`,
  ).bind(id, clientId).first()) as { id: string } | null;
  if (!existing) return json({ error: 'Abonnement introuvable' }, 404);

  // Patch partiel non destructif : seuls les champs fournis sont mis à jour.
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (body.quantity != null) {
    sets.push('quantity = ?');
    binds.push(Math.max(1, Math.round(Number(body.quantity) || 1)));
  }
  if (body.interval_unit != null && VALID_INTERVAL.includes(body.interval_unit)) {
    sets.push('interval_unit = ?');
    binds.push(body.interval_unit);
  }
  if (body.interval_count != null) {
    sets.push('interval_count = ?');
    binds.push(Math.max(1, Math.round(Number(body.interval_count) || 1)));
  }
  if (body.unit_price_cents != null) {
    sets.push('unit_price_cents = ?');
    binds.push(Math.max(0, Math.round(Number(body.unit_price_cents) || 0)));
  }
  if (body.currency != null) {
    sets.push('currency = ?');
    binds.push((body.currency || 'CAD').toString().toUpperCase().slice(0, 3) || 'CAD');
  }
  if (body.customer_id !== undefined) {
    sets.push('customer_id = ?');
    binds.push(body.customer_id ? body.customer_id.toString() : null);
  }
  if (body.status != null && VALID_STATUS.includes(body.status)) {
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (body.next_run_at !== undefined) {
    sets.push('next_run_at = ?');
    binds.push(body.next_run_at ? body.next_run_at.toString() : null);
  }

  if (sets.length === 0) {
    return json({ error: 'Aucun champ à mettre à jour' }, 400);
  }

  sets.push("updated_at = datetime('now')");
  await env.DB.prepare(
    `UPDATE product_subscriptions SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
  ).bind(...binds, id, clientId).run();

  return json({ data: { id } });
}

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/ecommerce/subscriptions/:id — suppression (admin only)
// ════════════════════════════════════════════════════════════════════════════

export async function handleDeleteSubscription(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();

  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const existing = (await env.DB.prepare(
    `SELECT id FROM product_subscriptions WHERE id = ? AND client_id = ?`,
  ).bind(id, clientId).first()) as { id: string } | null;
  if (!existing) return json({ error: 'Abonnement introuvable' }, 404);

  await env.DB.prepare(
    `DELETE FROM product_subscriptions WHERE id = ? AND client_id = ?`,
  ).bind(id, clientId).run();

  return json({ data: { id } });
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/ecommerce/subscriptions/run-due — cycle des abonnements échus
// (admin only). Pour CHAQUE abonnement échu : createOrderCore (commande
// COD/mock source 'subscription') puis avance next_run_at + cycles_completed.
// AUCUN prélèvement réel, AUCUNE lecture payments_live_enabled, AUCUN touch
// tables E4/E6 (§6.E). Best-effort : une erreur n'arrête JAMAIS la boucle ;
// table absente ⇒ { data: { processed: 0 } }, jamais 500/throw.
// ════════════════════════════════════════════════════════════════════════════

export async function handleRunDueSubscriptions(
  _request: Request, env: Env, auth: Auth,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();

  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const orders: Array<{ subscription_id: string; order_id: string; order_number: string }> = [];
  let processed = 0;

  try {
    // Échus = status 'active' ET next_run_at <= now (index idx_..._due). Borné
    // tenant + LIMIT dur. next_run_at NULL ⇒ jamais dû (pas encore programmé).
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, agency_id, customer_id, variant_id, quantity,
              interval_unit, interval_count, unit_price_cents, currency, status,
              next_run_at, last_run_at, cycles_completed, created_at, updated_at
         FROM product_subscriptions
        WHERE client_id = ?
          AND status = 'active'
          AND next_run_at IS NOT NULL
          AND next_run_at <= datetime('now')
        ORDER BY datetime(next_run_at) ASC
        LIMIT ?`,
    ).bind(clientId, DUE_BATCH).all();

    const due = (results || []) as unknown as SubscriptionRow[];

    for (const sub of due) {
      try {
        if (!sub.variant_id) {
          // Abonnement sans variante : impossible de générer une commande —
          // on avance quand même l'échéance pour ne pas boucler dessus.
          const nextRun = advanceRunAt(sub.next_run_at, sub.interval_unit, sub.interval_count);
          await env.DB.prepare(
            `UPDATE product_subscriptions
                SET next_run_at = ?, last_run_at = datetime('now'),
                    updated_at = datetime('now')
              WHERE id = ? AND client_id = ?`,
          ).bind(nextRun, sub.id, clientId).run();
          continue;
        }

        // Commande COD/mock : createOrderCore (signature FIGÉE, contrat E3 —
        // réserve stock, TPS/TVQ, numéro). AUCUN paiement réel. Le résolveur
        // de devise interne (ecommerce-orders §6.F) persiste orders.currency ;
        // ZÉRO lecture payments_live_enabled, ZÉRO table E4/E6.
        const result = await createOrderCore(
          env,
          clientId,
          {
            customer_id: sub.customer_id || null,
            email: '',
            items: [
              {
                variant_id: sub.variant_id,
                quantity: Math.max(1, Math.round(sub.quantity || 1)),
              },
            ],
            source: 'subscription',
          },
          auth.userId,
        );

        const nextRun = advanceRunAt(sub.next_run_at, sub.interval_unit, sub.interval_count);
        await env.DB.prepare(
          `UPDATE product_subscriptions
              SET next_run_at = ?, last_run_at = datetime('now'),
                  cycles_completed = cycles_completed + 1,
                  updated_at = datetime('now')
            WHERE id = ? AND client_id = ?`,
        ).bind(nextRun, sub.id, clientId).run();

        processed += 1;
        orders.push({
          subscription_id: sub.id,
          order_id: result.id,
          order_number: result.order_number,
        });
      } catch (subErr) {
        // Best-effort STRICT : l'échec d'un abonnement (stock insuffisant,
        // variante supprimée…) n'arrête pas la boucle. On NE touche pas
        // next_run_at (réessai au prochain run).
        console.error('subscription cycle failed', sub.id, subErr);
      }
    }

    return json({ data: { processed, orders } });
  } catch (err) {
    // Table absente / erreur globale ⇒ best-effort : structure vide, jamais
    // 500 (calque garde-fou analytics « vide ⇒ structure vide »).
    console.error('handleRunDueSubscriptions failed', err);
    return json({ data: { processed: 0, orders: [] } });
  }
}
