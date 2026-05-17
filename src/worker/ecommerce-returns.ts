// ── Sprint E6 M2 — Retours / RMA e-commerce (cycle de vie dédié) ────────────
//
// ⚠️ FRONTIÈRE RÉGULÉE — ce fichier orchestre le RETOUR (RMA) marchand
// e-commerce (B2). DISTINCT de src/worker/billing.ts (abo SaaS — INTOUCHABLE)
// et des Invoices/CRM. Le remboursement éventuel est 100 % DÉLÉGUÉ à la
// logique refund M1 (handleCreateRefund) — ZÉRO réimplémentation financière.
//
// Cycle RMA (machine PROPRE, distincte des machines commande E3 / shipment E5) :
//   pending → approved (admin) → received → refunded
//   pending|approved → rejected   (refus possible avant réception)
//
// ⚠️ GARDE ANTI-ABUS NON NÉGOCIABLE : le remboursement n'est déclenché QU'À la
// transition `received` (marchandise physiquement revenue), JAMAIS à la simple
// demande ni à l'approbation. Inoffensif tant que payments_live_enabled=0.
//
// Conventions strictes :
//   - Multi-tenant STRICT : client_id résolu via getClientModules.
//   - Mutations admin (approve/receive/reject) : auth.role === 'admin'
//     (pattern handleUpdateRegion).
//   - Articles retournés : doivent appartenir à la commande ET avoir été
//     LIVRÉS (lecture shipment_items E5, 0 modif).
//   - Idempotence : transitions gardées (statut courant validé) ; refund M1
//     lui-même idempotent (clé déterministe + anti double-restock).
//   - id/created_at/updated_at via DEFAULT schéma — non bindés.

import type { Env } from './types';
import { json, audit } from './helpers';
import { getClientModules } from './modules';
// S3 M2 — validation d'entrée sur la CRÉATION de demande de retour
// (handleCreateReturn, statut 'pending', AUCUN refund). Schéma M1 figé,
// import only. handleUpdateReturn (zone refund régulée) NON touché.
import { validate, createReturnSchema } from '../lib/schemas';
import { validationError } from './lib/validate-response';
// RÉUTILISE la logique refund M1 (handler figé) — JAMAIS dupliquée. À
// `received`, on déclenche le remboursement via ce handler (idempotent,
// anti double-remboursement, anti double-restock côté M1).
import { handleCreateRefund } from './ecommerce-refunds';
// Snapshot du contexte région (E-R) figé à la demande — traçabilité (la
// politique conso applicable relève de M3). 0 modif ecommerce-region.
import { resolveRegionContext } from './ecommerce-region';

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

function forbidden(): Response {
  return json(
    { error: 'Non autorisé', message: 'Action réservée aux administrateurs.' },
    403,
  );
}

// ── Machine RMA PROPRE (distincte E3/E5). 'refunded'/'rejected' = terminaux ──
const RETURN_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['received', 'rejected'],
  received: ['refunded'],
  refunded: [],
  rejected: [],
};

interface OrderRow {
  id: string;
  client_id: string;
}

interface ReturnRow {
  id: string;
  client_id: string;
  order_id: string;
  status: string;
  reason: string | null;
  region_snapshot: string | null;
  created_at: string;
  updated_at: string;
}

interface RmaItemRow {
  id: string;
  return_request_id: string;
  order_item_id: string;
  quantity: number;
  restock: number;
}

async function loadReturn(
  env: Env, clientId: string, returnId: string,
): Promise<{ rr: ReturnRow; items: RmaItemRow[] } | null> {
  const rr = (await env.DB.prepare(
    `SELECT id, client_id, order_id, status, reason, region_snapshot,
            created_at, updated_at
       FROM return_requests WHERE id = ? AND client_id = ?`,
  ).bind(returnId, clientId).first()) as ReturnRow | null;
  if (!rr) return null;
  const { results } = await env.DB.prepare(
    `SELECT id, return_request_id, order_item_id, quantity, restock
       FROM rma_items WHERE return_request_id = ? ORDER BY created_at ASC`,
  ).bind(returnId).all();
  return { rr, items: (results || []) as unknown as RmaItemRow[] };
}

function shapeReturn(rr: ReturnRow, items: RmaItemRow[]): Record<string, unknown> {
  return {
    id: rr.id,
    order_id: rr.order_id,
    status: rr.status,
    reason: rr.reason,
    created_at: rr.created_at,
    updated_at: rr.updated_at,
    items: items.map((it) => ({
      id: it.id,
      order_item_id: it.order_item_id,
      quantity: it.quantity,
      restock: it.restock === 1,
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// M2.3 — POST /api/ecommerce/returns  (demande de retour — statut pending)
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/ecommerce/returns
 *   body { order_id, items:[{order_item_id, quantity, restock?}], reason? }
 *
 * Garde-fous (FR québécois) :
 *   - 404 commande introuvable (multi-tenant strict).
 *   - 400 si aucune ligne.
 *   - 404 si un article n'appartient pas à la commande.
 *   - 409 si un article n'a pas été LIVRÉ (somme shipment_items des envois
 *     non 'failed' < quantité demandée) — on ne retourne pas ce qui n'a
 *     jamais été expédié/reçu (anti-abus).
 *
 * Statut initial : 'pending'. AUCUN remboursement déclenché ici (le refund
 * n'arrive qu'à `received` — garde anti-abus non négociable).
 */
export async function handleCreateReturn(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // S3 M2 — validation d'entrée AVANT la logique (early-return additif).
  // La validation fine ligne-à-ligne (order_item_id/quantity/restock + garde
  // anti-abus « article livré ») reste côté handler, INCHANGÉE.
  const parsed = await request.json().catch(() => null);
  const vr = validate(createReturnSchema, parsed);
  if (!vr.success) return validationError(vr.error);
  const body = vr.data as Record<string, unknown>;

  const orderId = String(body.order_id || '').trim();
  if (!orderId) {
    return json({ error: 'Commande requise', message: 'Précise la commande à retourner.' }, 400);
  }

  const order = (await env.DB.prepare(
    'SELECT id, client_id FROM orders WHERE id = ? AND client_id = ?',
  ).bind(orderId, clientId).first()) as OrderRow | null;
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return json(
      { error: 'Retour vide', message: 'Précise au moins un article à retourner.' },
      400,
    );
  }

  // Lignes de commande valides (multi-tenant via la jointure order_id).
  const { results: oiRes } = await env.DB.prepare(
    'SELECT id, quantity FROM order_items WHERE order_id = ?',
  ).bind(orderId).all();
  const orderedById = new Map(
    (oiRes || []).map((r) => [
      (r as { id: string }).id,
      (r as { quantity: number }).quantity,
    ]),
  );

  // Quantités LIVRÉES par order_item : SUM(shipment_items) des expéditions du
  // tenant non 'failed' (E5, lecture seule — 0 modif). On ne retourne que ce
  // qui a effectivement été expédié (garde anti-abus).
  const { results: shRes } = await env.DB.prepare(
    `SELECT si.order_item_id AS oid, COALESCE(SUM(si.quantity), 0) AS n
       FROM shipment_items si
       JOIN shipments s ON s.id = si.shipment_id
      WHERE s.order_id = ? AND s.client_id = ? AND s.status != 'failed'
      GROUP BY si.order_item_id`,
  ).bind(orderId, clientId).all();
  const deliveredById = new Map(
    (shRes || []).map((r) => [
      (r as { oid: string }).oid,
      (r as { n: number }).n,
    ]),
  );

  const validated: Array<{ order_item_id: string; quantity: number; restock: number }> = [];
  for (const raw of rawItems) {
    const r = raw as { order_item_id?: string; quantity?: unknown; restock?: unknown };
    const oid = (r?.order_item_id || '').toString().trim();
    const qty = Math.max(1, Math.round(Number(r?.quantity) || 0));
    if (!oid || qty < 1) {
      return json(
        {
          error: 'Ligne invalide',
          message: 'Chaque ligne doit cibler un article de la commande avec une quantité ≥ 1.',
        },
        400,
      );
    }
    if (!orderedById.has(oid)) {
      return json(
        {
          error: 'Article hors commande',
          message: "Un article à retourner n'appartient pas à cette commande.",
        },
        404,
      );
    }
    const delivered = deliveredById.get(oid) ?? 0;
    if (qty > delivered) {
      return json(
        {
          error: 'Article non livré',
          message: `Impossible de retourner un article non livré (livré ${delivered}, demandé ${qty}).`,
        },
        409,
      );
    }
    validated.push({
      order_item_id: oid,
      quantity: qty,
      restock: r?.restock === true || r?.restock === 1 ? 1 : 0,
    });
  }

  const reason = body.reason ? String(body.reason).slice(0, 500) : null;

  // Snapshot région figé à la demande (traçabilité — politique conso = M3).
  let regionSnapshot: string | null = null;
  try {
    regionSnapshot = JSON.stringify(await resolveRegionContext(env, clientId));
  } catch {
    regionSnapshot = null;
  }

  // id/created_at/updated_at via DEFAULT schéma — on lit l'id généré.
  const inserted = (await env.DB.prepare(
    `INSERT INTO return_requests
       (client_id, order_id, status, reason, region_snapshot)
     VALUES (?, ?, 'pending', ?, ?)
     RETURNING id`,
  ).bind(clientId, orderId, reason, regionSnapshot).first()) as { id: string } | null;
  const returnId = inserted?.id;
  if (!returnId) return json({ error: 'Échec création de la demande de retour' }, 500);

  for (const v of validated) {
    await env.DB.prepare(
      `INSERT INTO rma_items (return_request_id, order_item_id, quantity, restock)
       VALUES (?, ?, ?, ?)`,
    ).bind(returnId, v.order_item_id, v.quantity, v.restock).run();
  }

  await audit(env, auth.userId, 'create', 'order', orderId, {
    return_request: returnId, lines: validated.length,
  });

  const loaded = await loadReturn(env, clientId, returnId);
  return json({ data: loaded ? shapeReturn(loaded.rr, loaded.items) : null }, 201);
}

// ════════════════════════════════════════════════════════════════════════════
// M2.3 — PATCH /api/ecommerce/returns/:id  (approve | receive | reject)
// ════════════════════════════════════════════════════════════════════════════

/**
 * PATCH /api/ecommerce/returns/:id  body { action:'approve'|'receive'|'reject' }
 *
 * ADMIN uniquement (pattern handleUpdateRegion). Transitions gardées par la
 * machine RMA PROPRE :
 *   - approve : pending  → approved
 *   - reject  : pending|approved → rejected
 *   - receive : approved → received  PUIS déclenche le remboursement en
 *     RÉUTILISANT handleCreateRefund M1 (idempotent, anti double-remboursement,
 *     restock délégué via restock_items pour les rma_items.restock=1). Le RMA
 *     passe ensuite en 'refunded' si le refund a réussi.
 *
 * ⚠️ GARDE ANTI-ABUS : le refund n'est JAMAIS déclenché à approve/reject — UNIQUEMENT
 * à `receive` (marchandise revenue). ⚠️ ZONE RÉGULÉE — chemin remboursement
 * (revue Rochdi requise) ; inoffensif tant que payments_live_enabled=0.
 */
export async function handleUpdateReturn(
  request: Request, env: Env, auth: Auth, returnId: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();

  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const action = String(body.action || '').toLowerCase().trim();
  const ACTION_TO_STATUS: Record<string, string> = {
    approve: 'approved',
    receive: 'received',
    reject: 'rejected',
  };
  const nextStatus = ACTION_TO_STATUS[action];
  if (!nextStatus) {
    return json(
      {
        error: 'Action invalide',
        message: "L'action doit être 'approve', 'receive' ou 'reject'.",
      },
      400,
    );
  }

  const loaded = await loadReturn(env, clientId, returnId);
  if (!loaded) return json({ error: 'Demande de retour introuvable' }, 404);
  const { rr, items } = loaded;

  const allowed = RETURN_TRANSITIONS[rr.status] || [];
  if (!allowed.includes(nextStatus)) {
    return json(
      {
        error: 'Transition invalide',
        message: `Impossible de passer de « ${rr.status} » à « ${nextStatus} ». Transitions permises : ${allowed.length ? allowed.join(', ') : 'aucune (état terminal)'}.`,
      },
      409,
    );
  }

  // approve / reject : simple mise à jour de statut, AUCUN effet financier.
  if (nextStatus !== 'received') {
    await env.DB.prepare(
      "UPDATE return_requests SET status = ?, updated_at = datetime('now') WHERE id = ? AND client_id = ?",
    ).bind(nextStatus, returnId, clientId).run();
    await audit(env, auth.userId, 'update', 'order', rr.order_id, {
      return_request: returnId, from: rr.status, to: nextStatus,
    });
    const after = await loadReturn(env, clientId, returnId);
    return json({ data: after ? shapeReturn(after.rr, after.items) : null });
  }

  // ── receive : marchandise revenue → on marque 'received' PUIS on déclenche
  // le remboursement via la logique refund M1 (RÉUTILISÉE, jamais dupliquée).
  await env.DB.prepare(
    "UPDATE return_requests SET status = 'received', updated_at = datetime('now') WHERE id = ? AND client_id = ?",
  ).bind(returnId, clientId).run();

  // Variantes à remettre en stock : variant_id des order_items dont la ligne
  // RMA porte restock=1. handleCreateRefund (M1) consomme `restock_items`
  // (variant ids) via releaseStock (E2, idempotent, anti double-restock).
  const restockOrderItemIds = items.filter((it) => it.restock === 1).map((it) => it.order_item_id);
  let restockVariantIds: string[] = [];
  if (restockOrderItemIds.length > 0) {
    const placeholders = restockOrderItemIds.map(() => '?').join(',');
    const { results: viRes } = await env.DB.prepare(
      `SELECT variant_id FROM order_items WHERE id IN (${placeholders})`,
    ).bind(...restockOrderItemIds).all();
    restockVariantIds = (viRes || [])
      .map((r) => (r as { variant_id: string | null }).variant_id)
      .filter((v): v is string => !!v);
  }

  // ⚠️ ZONE RÉGULÉE — chemin remboursement (revue Rochdi requise). On RÉUTILISE
  // handleCreateRefund M1 via une Request interne synthétique : amount omis →
  // remboursement TOTAL du solde remboursable restant ; restock_items délégué.
  // handleCreateRefund est idempotent (clé déterministe) + anti double-restock
  // (verrou refunds.restocked) + appelle recordRefundTransition (SEUL décideur
  // financial_status). On NE réimplémente AUCUNE logique financière.
  const refundReq = new Request('https://internal/ecommerce/refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reason: `RMA ${returnId}${rr.reason ? ` — ${rr.reason}` : ''}`.slice(0, 500),
      restock_items: restockVariantIds,
    }),
  });
  const refundRes = await handleCreateRefund(refundReq, env, auth, rr.order_id);

  // Le RMA passe en 'refunded' UNIQUEMENT si le remboursement a abouti (2xx).
  // Sinon il RESTE 'received' (le marchand pourra ré-initier le refund) — on
  // ne ment pas sur l'état financier.
  let finalStatus = 'received';
  if (refundRes.ok) {
    await env.DB.prepare(
      "UPDATE return_requests SET status = 'refunded', updated_at = datetime('now') WHERE id = ? AND client_id = ?",
    ).bind(returnId, clientId).run();
    finalStatus = 'refunded';
  }

  await audit(env, auth.userId, 'update', 'order', rr.order_id, {
    return_request: returnId, from: rr.status, to: finalStatus,
    refund_http: refundRes.status,
  });

  const after = await loadReturn(env, clientId, returnId);
  return json({ data: after ? shapeReturn(after.rr, after.items) : null });
}

// ════════════════════════════════════════════════════════════════════════════
// M2.3 — GET /api/ecommerce/returns?order_id=  (liste tenant)
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ecommerce/returns?order_id= — demandes de retour du tenant
 * (récentes d'abord), filtrables par commande. Multi-tenant strict.
 */
export async function handleListReturns(
  env: Env, auth: Auth, url: URL,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const orderId = (url.searchParams.get('order_id') || '').trim();

  const res = orderId
    ? await env.DB.prepare(
        `SELECT id, client_id, order_id, status, reason, region_snapshot,
                created_at, updated_at
           FROM return_requests
          WHERE client_id = ? AND order_id = ?
          ORDER BY created_at DESC`,
      ).bind(clientId, orderId).all()
    : await env.DB.prepare(
        `SELECT id, client_id, order_id, status, reason, region_snapshot,
                created_at, updated_at
           FROM return_requests
          WHERE client_id = ?
          ORDER BY created_at DESC`,
      ).bind(clientId).all();

  const rows = (res.results || []) as unknown as ReturnRow[];

  // Hydrate les lignes RMA par demande (peu de demandes par commande).
  const out: Record<string, unknown>[] = [];
  for (const rr of rows) {
    const { results: it } = await env.DB.prepare(
      `SELECT id, return_request_id, order_item_id, quantity, restock
         FROM rma_items WHERE return_request_id = ? ORDER BY created_at ASC`,
    ).bind(rr.id).all();
    out.push(shapeReturn(rr, (it || []) as unknown as RmaItemRow[]));
  }

  return json({ data: out });
}
