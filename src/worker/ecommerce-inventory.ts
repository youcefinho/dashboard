// ── Inventaire / mouvements / alertes stock — Sprint E2 M2 (2026-05-16) ──────
//
// Backend stock du module Boutique (B2). Enrichit le schéma E1 (tables
// `inventory` 1:1 product_variants + `inventory_movements` audit trail).
//
// Conventions strictes du projet :
//  - Money n/a ici (quantités INTEGER pures). Pas de TPS/TVQ.
//  - Multi-tenant STRICT : on vérifie toujours que la variante appartient à un
//    produit du tenant courant (jointure products.client_id, jamais de fuite).
//  - Gating requireModule('ecommerce') géré AMONT par src/worker.ts (le bloc
//    /api/ecommerce/* est gated globalement — toute route ci-dessous hérite).
//  - id TEXT applicatif via crypto.randomUUID() (cohérent E1/E2-M1).
//  - Réutilise json / sanitizeInput / audit / createNotification (zéro dup).
//
// available = quantity - reserved (jamais stocké, toujours dérivé).
//
// Helpers stock exposés pour E3 (commandes) : reserveStock / releaseStock /
// commitSale — atomiques côté logique (update inventory + INSERT movement),
// idempotents sur la création de la ligne inventory (upsert défensif).

import type { Env } from './types';
import { json, sanitizeInput, audit, createNotification } from './helpers';
import { getClientModules } from './modules';

type Auth = { userId: string; role: string };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/** Résout le client_id du tenant courant (réutilise le helper M2). */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
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

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

interface VariantContext {
  variantId: string;
  productId: string;
  productTitle: string;
  sku: string | null;
}

/**
 * Vérifie que la variante existe ET appartient à un produit du tenant courant.
 * Retourne le contexte produit (titre/sku) utile aux notifications, ou null.
 */
async function resolveVariant(
  env: Env, clientId: string, variantId: string,
): Promise<VariantContext | null> {
  const row = await env.DB.prepare(
    `SELECT v.id AS variant_id, v.sku AS sku, p.id AS product_id, p.title AS product_title
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = ? AND p.client_id = ?`,
  ).bind(variantId, clientId).first() as
    | { variant_id: string; sku: string | null; product_id: string; product_title: string }
    | null;
  if (!row) return null;
  return {
    variantId: row.variant_id,
    productId: row.product_id,
    productTitle: row.product_title,
    sku: row.sku,
  };
}

interface InventoryRow {
  id: string;
  variant_id: string;
  quantity: number;
  reserved: number;
  low_stock_threshold: number;
  track_inventory: number;
  allow_backorder: number;
  location: string | null;
  updated_at: string | null;
  last_low_stock_alert_at: string | null;
}

/**
 * Upsert défensif : garantit l'existence de la ligne inventory pour la variante.
 * Idempotent — si M1 (ou un appel concurrent) l'a déjà créée, on ne duplique
 * pas (variant_id est UNIQUE → INSERT OR IGNORE). Retourne la ligne fraîche.
 */
async function ensureInventory(env: Env, variantId: string): Promise<InventoryRow> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO inventory (id, variant_id, quantity, reserved)
     VALUES (?, ?, 0, 0)`,
  ).bind(crypto.randomUUID(), variantId).run();
  const row = await env.DB.prepare(
    'SELECT * FROM inventory WHERE variant_id = ?',
  ).bind(variantId).first() as InventoryRow;
  return row;
}

function shapeInventory(inv: InventoryRow) {
  const available = (inv.quantity ?? 0) - (inv.reserved ?? 0);
  return {
    variant_id: inv.variant_id,
    quantity: inv.quantity ?? 0,
    reserved: inv.reserved ?? 0,
    available,
    low_stock_threshold: inv.low_stock_threshold ?? 5,
    track_inventory: inv.track_inventory ?? 1,
    allow_backorder: inv.allow_backorder ?? 0,
    location: inv.location ?? null,
    is_low_stock:
      (inv.track_inventory ?? 1) === 1 &&
      available <= (inv.low_stock_threshold ?? 5),
    updated_at: inv.updated_at ?? null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// M2.1 — INVENTAIRE CRUD par variante
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/ecommerce/variants/:vid/inventory — état stock (auto-crée si absent). */
export async function handleGetInventory(
  env: Env, auth: Auth, variantId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const ctx = await resolveVariant(env, clientId, variantId);
  if (!ctx) return json({ error: 'Variante introuvable' }, 404);

  const inv = await ensureInventory(env, variantId);
  return json({ data: shapeInventory(inv) });
}

/**
 * PUT /api/ecommerce/variants/:vid/inventory
 * Set quantity / low_stock_threshold / track_inventory / allow_backorder /
 * location. La quantité fixée ici est un "set" absolu : on logge le delta
 * résultant comme mouvement 'adjustment' pour garder l'audit trail cohérent.
 */
export async function handleSetInventory(
  request: Request, env: Env, auth: Auth, variantId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const ctx = await resolveVariant(env, clientId, variantId);
  if (!ctx) return json({ error: 'Variante introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const inv = await ensureInventory(env, variantId);

  const sets: string[] = [];
  const params: unknown[] = [];
  let quantityDelta = 0;

  if (Number.isFinite(body.quantity as number)) {
    const newQty = Math.max(0, Math.round(body.quantity as number));
    quantityDelta = newQty - (inv.quantity ?? 0);
    sets.push('quantity = ?');
    params.push(newQty);
  }
  if (Number.isFinite(body.low_stock_threshold as number)) {
    sets.push('low_stock_threshold = ?');
    params.push(Math.max(0, Math.round(body.low_stock_threshold as number)));
  }
  if ('track_inventory' in body) {
    sets.push('track_inventory = ?');
    params.push(body.track_inventory ? 1 : 0);
  }
  if ('allow_backorder' in body) {
    sets.push('allow_backorder = ?');
    params.push(body.allow_backorder ? 1 : 0);
  }
  if ('location' in body) {
    sets.push('location = ?');
    params.push(sanitizeInput((body.location as string) || '', 200) || null);
  }
  if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);

  params.push(variantId);
  await env.DB.prepare(
    `UPDATE inventory SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE variant_id = ?`,
  ).bind(...params).run();

  // Si on a modifié la quantité, on trace le mouvement (audit trail intègre).
  if (quantityDelta !== 0) {
    await env.DB.prepare(
      `INSERT INTO inventory_movements
         (id, variant_id, delta, reason, note, created_by)
       VALUES (?, ?, ?, 'adjustment', ?, ?)`,
    ).bind(
      crypto.randomUUID(), variantId, quantityDelta,
      'Ajustement manuel (set inventaire)', auth.userId,
    ).run();
  }

  await audit(env, auth.userId, 'update', 'inventory', variantId, {
    productId: ctx.productId,
  });

  const fresh = await env.DB.prepare(
    'SELECT * FROM inventory WHERE variant_id = ?',
  ).bind(variantId).first() as InventoryRow;

  // Best-effort : alerte si on vient de passer sous le seuil.
  await maybeNotifyLowStock(env, auth, clientId, ctx, fresh);

  return json({ data: shapeInventory(fresh) });
}

// ════════════════════════════════════════════════════════════════════════════
// M2.2 — MOUVEMENTS DE STOCK + audit
// ════════════════════════════════════════════════════════════════════════════

const ALLOWED_REASONS = ['sale', 'restock', 'adjustment', 'return', 'reservation'];

/**
 * POST /api/ecommerce/variants/:vid/inventory/adjust
 * Body { delta, reason?, note?, reference_type?, reference_id? }.
 * Applique le delta sur quantity + INSERT inventory_movements (atomique
 * logique). Refuse quantity < 0 si track_inventory=1 & allow_backorder=0.
 */
export async function handleAdjustInventory(
  request: Request, env: Env, auth: Auth, variantId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const ctx = await resolveVariant(env, clientId, variantId);
  if (!ctx) return json({ error: 'Variante introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  if (!Number.isFinite(body.delta as number) || Math.round(body.delta as number) === 0) {
    return json(
      { error: 'Delta invalide', message: 'Le mouvement de stock doit être un nombre non nul.' },
      400,
    );
  }
  const delta = Math.round(body.delta as number);
  const reason = ALLOWED_REASONS.includes(body.reason as string)
    ? (body.reason as string)
    : 'adjustment';
  const note = sanitizeInput((body.note as string) || '', 500) || null;
  const referenceType = sanitizeInput((body.reference_type as string) || '', 50) || null;
  const referenceId = sanitizeInput((body.reference_id as string) || '', 100) || null;

  const inv = await ensureInventory(env, variantId);
  const newQty = (inv.quantity ?? 0) + delta;

  if (
    newQty < 0 &&
    (inv.track_inventory ?? 1) === 1 &&
    (inv.allow_backorder ?? 0) === 0
  ) {
    return json(
      {
        error: 'Stock insuffisant',
        message: `Impossible : il ne reste que ${inv.quantity ?? 0} unité(s) pour « ${ctx.productTitle} »${ctx.sku ? ` (${ctx.sku})` : ''}. Active les commandes en souffrance (backorder) si tu veux autoriser le négatif.`,
      },
      409,
    );
  }

  // Transaction logique : update stock + trace le mouvement ensemble.
  await env.DB.prepare(
    `UPDATE inventory SET quantity = ?, updated_at = datetime('now')
       WHERE variant_id = ?`,
  ).bind(newQty, variantId).run();
  await env.DB.prepare(
    `INSERT INTO inventory_movements
       (id, variant_id, delta, reason, reference_type, reference_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), variantId, delta, reason,
    referenceType, referenceId, note, auth.userId,
  ).run();

  await audit(env, auth.userId, 'adjust', 'inventory', variantId, {
    delta, reason, productId: ctx.productId,
  });

  const fresh = await env.DB.prepare(
    'SELECT * FROM inventory WHERE variant_id = ?',
  ).bind(variantId).first() as InventoryRow;

  // Best-effort : alerte stock faible si l'ajustement fait passer sous le seuil.
  await maybeNotifyLowStock(env, auth, clientId, ctx, fresh);

  return json({ data: shapeInventory(fresh) });
}

/**
 * GET /api/ecommerce/variants/:vid/inventory/movements
 * Historique paginé (plus récents d'abord) + total.
 */
export async function handleListMovements(
  env: Env, auth: Auth, variantId: string, url: URL,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const ctx = await resolveVariant(env, clientId, variantId);
  if (!ctx) return json({ error: 'Variante introuvable' }, 404);

  const { limit, offset } = parsePaging(url);

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM inventory_movements WHERE variant_id = ?',
  ).bind(variantId).first() as { n: number } | null;

  const { results } = await env.DB.prepare(
    `SELECT * FROM inventory_movements WHERE variant_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(variantId, limit, offset).all();

  return json({ data: results || [], total: countRow?.n || 0, limit, offset });
}

// ════════════════════════════════════════════════════════════════════════════
// M2.3 — ALERTES STOCK FAIBLE
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ecommerce/inventory/low-stock
 * Variantes du tenant où available <= seuil ET track_inventory=1.
 */
export async function handleListLowStock(
  env: Env, auth: Auth, url: URL,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const { limit, offset } = parsePaging(url);

  const baseFrom = `
    FROM inventory i
    JOIN product_variants v ON v.id = i.variant_id
    JOIN products p ON p.id = v.product_id
    WHERE p.client_id = ?
      AND i.track_inventory = 1
      AND (i.quantity - i.reserved) <= i.low_stock_threshold`;

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n ${baseFrom}`,
  ).bind(clientId).first() as { n: number } | null;

  const { results } = await env.DB.prepare(
    `SELECT
        i.variant_id,
        i.quantity,
        i.reserved,
        (i.quantity - i.reserved) AS available,
        i.low_stock_threshold,
        i.location,
        v.sku,
        v.title AS variant_title,
        p.id AS product_id,
        p.title AS product_title
      ${baseFrom}
      ORDER BY available ASC, p.title ASC
      LIMIT ? OFFSET ?`,
  ).bind(clientId, limit, offset).all();

  return json({ data: results || [], total: countRow?.n || 0, limit, offset });
}

/**
 * Notifie le tenant si la variante vient de passer (ou reste) sous le seuil.
 * Anti-spam : on ne re-notifie pas tant qu'on n'est pas repassé au-dessus du
 * seuil (réarmement via last_low_stock_alert_at remis à NULL). Best-effort —
 * n'échoue jamais l'ajustement appelant (try/catch global).
 */
async function maybeNotifyLowStock(
  env: Env,
  auth: Auth,
  clientId: string,
  ctx: VariantContext,
  inv: InventoryRow,
): Promise<void> {
  try {
    const available = (inv.quantity ?? 0) - (inv.reserved ?? 0);
    const isLow =
      (inv.track_inventory ?? 1) === 1 &&
      available <= (inv.low_stock_threshold ?? 5);

    if (!isLow) {
      // Repassé au-dessus du seuil → réarme l'alerte pour la prochaine fois.
      if (inv.last_low_stock_alert_at) {
        await env.DB.prepare(
          'UPDATE inventory SET last_low_stock_alert_at = NULL WHERE variant_id = ?',
        ).bind(ctx.variantId).run();
      }
      return;
    }

    // Déjà notifié et toujours sous le seuil → on ne re-spamme pas.
    if (inv.last_low_stock_alert_at) return;

    await env.DB.prepare(
      `UPDATE inventory SET last_low_stock_alert_at = datetime('now')
         WHERE variant_id = ?`,
    ).bind(ctx.variantId).run();

    const skuPart = ctx.sku ? ` (${ctx.sku})` : '';
    await createNotification(
      env,
      auth.userId,
      `Stock faible : ${ctx.productTitle}${skuPart}`,
      `Il ne reste que ${available} unité(s) en stock. Pense à réapprovisionner.`,
      '📦',
      '/boutique/produits',
      clientId,
    );
  } catch {
    /* best-effort : une alerte ratée ne doit jamais casser l'ajustement */
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers stock réutilisables — exposés pour E3 (commandes)
// ════════════════════════════════════════════════════════════════════════════

export interface StockOpResult {
  ok: boolean;
  reason?: 'not_found' | 'insufficient';
  available?: number;
  quantity?: number;
  reserved?: number;
}

/**
 * Réserve `qty` unités (incrémente reserved). Respecte allow_backorder :
 * refuse si available < qty et que le backorder est interdit + track on.
 * NE décrémente PAS quantity (réservation ≠ vente). Trace un mouvement
 * 'reservation' (delta négatif informatif sur le disponible).
 */
export async function reserveStock(
  env: Env, variantId: string, qty: number,
  ref?: { type?: string; id?: string; by?: string },
): Promise<StockOpResult> {
  const n = Math.max(0, Math.round(qty));
  if (n === 0) return { ok: true };
  const inv = await ensureInventory(env, variantId);
  const available = (inv.quantity ?? 0) - (inv.reserved ?? 0);

  if (
    available < n &&
    (inv.track_inventory ?? 1) === 1 &&
    (inv.allow_backorder ?? 0) === 0
  ) {
    return { ok: false, reason: 'insufficient', available, quantity: inv.quantity, reserved: inv.reserved };
  }

  await env.DB.prepare(
    `UPDATE inventory SET reserved = reserved + ?, updated_at = datetime('now')
       WHERE variant_id = ?`,
  ).bind(n, variantId).run();
  await env.DB.prepare(
    `INSERT INTO inventory_movements
       (id, variant_id, delta, reason, reference_type, reference_id, note, created_by)
     VALUES (?, ?, ?, 'reservation', ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), variantId, -n,
    ref?.type || 'order', ref?.id || null, 'Réservation de stock', ref?.by || null,
  ).run();

  return { ok: true, available: available - n };
}

/**
 * Libère `qty` unités réservées (annulation panier / commande expirée).
 * reserved ne descend jamais sous 0 (garde-fou). Trace un mouvement 'return'
 * informatif (delta positif sur le disponible).
 */
export async function releaseStock(
  env: Env, variantId: string, qty: number,
  ref?: { type?: string; id?: string; by?: string },
): Promise<StockOpResult> {
  const n = Math.max(0, Math.round(qty));
  if (n === 0) return { ok: true };
  const inv = await ensureInventory(env, variantId);
  const release = Math.min(n, inv.reserved ?? 0);
  if (release === 0) return { ok: true, reserved: inv.reserved ?? 0 };

  await env.DB.prepare(
    `UPDATE inventory SET reserved = reserved - ?, updated_at = datetime('now')
       WHERE variant_id = ?`,
  ).bind(release, variantId).run();
  await env.DB.prepare(
    `INSERT INTO inventory_movements
       (id, variant_id, delta, reason, reference_type, reference_id, note, created_by)
     VALUES (?, ?, ?, 'return', ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), variantId, release,
    ref?.type || 'order', ref?.id || null, 'Libération de réservation', ref?.by || null,
  ).run();

  return { ok: true, reserved: (inv.reserved ?? 0) - release };
}

/**
 * Concrétise une vente : décrémente quantity ET libère la réservation
 * correspondante (la marchandise quitte vraiment le stock). Trace un mouvement
 * 'sale'. À appeler par E3 au paiement confirmé d'une commande.
 */
export async function commitSale(
  env: Env, variantId: string, qty: number,
  ref?: { type?: string; id?: string; by?: string },
): Promise<StockOpResult> {
  const n = Math.max(0, Math.round(qty));
  if (n === 0) return { ok: true };
  const inv = await ensureInventory(env, variantId);
  const newQty = (inv.quantity ?? 0) - n;

  if (
    newQty < 0 &&
    (inv.track_inventory ?? 1) === 1 &&
    (inv.allow_backorder ?? 0) === 0
  ) {
    return {
      ok: false, reason: 'insufficient',
      available: (inv.quantity ?? 0) - (inv.reserved ?? 0),
      quantity: inv.quantity, reserved: inv.reserved,
    };
  }

  const releasedReserve = Math.min(n, inv.reserved ?? 0);
  await env.DB.prepare(
    `UPDATE inventory
        SET quantity = ?, reserved = reserved - ?, updated_at = datetime('now')
      WHERE variant_id = ?`,
  ).bind(newQty, releasedReserve, variantId).run();
  await env.DB.prepare(
    `INSERT INTO inventory_movements
       (id, variant_id, delta, reason, reference_type, reference_id, note, created_by)
     VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), variantId, -n,
    ref?.type || 'order', ref?.id || null, 'Vente confirmée', ref?.by || null,
  ).run();

  return { ok: true, quantity: newQty };
}
