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
// Phase 1 V2 — câblage engine (⚠️ behavior-change assumé) : `available` calculé
// via inventory-engine.computeAvailable → désormais CLAMPÉ ≥0 + arrondi (le
// calcul inline ne clampait pas : réservé>quantité donnait un négatif).
import { computeAvailable } from './lib/inventory-engine';
// S3 M2 — validation d'entrée (schéma M1 figé, import only). S'ajoute APRÈS
// le gate multi-tenant S2 (resolveVariant) : validation d'entrée puis garde
// tenant — additif, ordre logique préservé.
import { validate, adjustInventorySchema } from '../lib/schemas';
import { validationError } from './lib/validate-response';

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
 *
 * [S2 multi-tenant] CŒUR de l'isolation de ce module. `inventory` et
 * `inventory_movements` N'ONT PAS de colonne `client_id` (schéma E1 ~l.100-125)
 * — l'isolation tenant passe EXCLUSIVEMENT par cette chaîne de jointure
 * `product_variants v → products p WHERE p.client_id = ?`. Plaquer un
 * `WHERE client_id = ?` sur inventory casserait (no such column). Tout handler
 * public DOIT passer ce gate AVANT toute lecture/écriture inventory.
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

/**
 * [S2 multi-tenant] Assertion défensive (défense en profondeur) : la variante
 * appartient-elle bien à un produit du tenant `clientId` ? Réutilise la chaîne
 * de jointure validée `resolveVariant`. Sémantique inchangée pour les appels
 * légitimes (le tenant possède sa variante → true). Utilisée par les helpers
 * stock exposés à E3 (reserveStock/releaseStock/commitSale) pour garantir
 * qu'aucun appelant ne contourne le gate, même si l'upstream oubliait de le
 * faire. Ne sur-restreint AUCUN cas légitime.
 */
async function assertVariantTenant(
  env: Env, clientId: string, variantId: string,
): Promise<boolean> {
  return (await resolveVariant(env, clientId, variantId)) !== null;
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
  // [S2 multi-tenant] tenant-scoped via le gate resolveVariant exécuté par
  // chaque handler appelant AVANT cet appel (variantId déjà prouvé du tenant).
  // inventory n'a pas de client_id : scoping par variant_id (déjà validé).
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
  const available = computeAvailable(inv.quantity ?? 0, inv.reserved ?? 0);
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

  // Charger les stocks par localisation
  let locStocksRes = await env.DB.prepare(
    `SELECT ls.location_id, ls.quantity, ls.reserved, w.name AS warehouse_name
       FROM location_stocks ls
       JOIN warehouses w ON w.id = ls.location_id
      WHERE ls.variant_id = ? AND ls.client_id = ? AND w.is_active = 1`
  ).bind(variantId, clientId).all();

  let locStocks = (locStocksRes?.results || []) as unknown as Array<{
    location_id: string;
    warehouse_name: string;
    quantity: number;
    reserved: number;
  }>;

  // Migration automatique à la volée du stock global existant
  if (locStocks.length === 0 && (inv.quantity > 0 || inv.reserved > 0)) {
    const defaultWh = await env.DB.prepare(
      `SELECT id, name FROM warehouses WHERE client_id = ? AND is_active = 1 ORDER BY is_default DESC, name ASC LIMIT 1`
    ).bind(clientId).first() as { id: string; name: string } | null;

    if (defaultWh) {
      await env.DB.prepare(
        `INSERT INTO location_stocks (location_id, variant_id, client_id, quantity, reserved, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).bind(defaultWh.id, variantId, clientId, inv.quantity, inv.reserved).run();

      locStocks = [{
        location_id: defaultWh.id,
        warehouse_name: defaultWh.name,
        quantity: inv.quantity,
        reserved: inv.reserved,
      }];
    }
  }

  const shaped = shapeInventory(inv);
  return json({
    data: {
      ...shaped,
      location_stocks: locStocks.map((r) => ({
        location_id: r.location_id,
        warehouse_name: r.warehouse_name,
        quantity: r.quantity ?? 0,
        reserved: r.reserved ?? 0,
      })),
    }
  });
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

  // 1) Gestion Multi-Localisation (location_stocks)
  if (body.location_stocks && Array.isArray(body.location_stocks)) {
    const locStocksInput = body.location_stocks as Array<{ location_id: string; quantity: number }>;
    let computedTotalQty = 0;

    for (const item of locStocksInput) {
      if (!item.location_id || !Number.isFinite(item.quantity)) continue;
      const newLocQty = Math.max(0, Math.round(item.quantity));
      computedTotalQty += newLocQty;

      // Charger l'ancien stock pour cette localisation
      const oldLoc = await env.DB.prepare(
        `SELECT quantity, reserved FROM location_stocks WHERE location_id = ? AND variant_id = ? AND client_id = ?`
      ).bind(item.location_id, variantId, clientId).first() as { quantity: number; reserved: number } | null;

      const oldQty = oldLoc?.quantity ?? 0;
      const oldReserved = oldLoc?.reserved ?? 0;

      // UPDATE ou INSERT
      await env.DB.prepare(
        `INSERT INTO location_stocks (location_id, variant_id, client_id, quantity, reserved, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(location_id, variant_id) DO UPDATE SET quantity = excluded.quantity, updated_at = datetime('now')`
      ).bind(item.location_id, variantId, clientId, newLocQty, oldReserved).run();

      const delta = newLocQty - oldQty;
      if (delta !== 0) {
        await env.DB.prepare(
          `INSERT INTO inventory_movements
             (id, variant_id, delta, reason, note, created_by)
           VALUES (?, ?, ?, 'adjustment', ?, ?)`
        ).bind(
          crypto.randomUUID(), variantId, delta,
          `Ajustement manuel (localisation ${item.location_id})`, auth.userId,
        ).run();
      }
    }

    // On prépare l'UPDATE de inventory.quantity
    quantityDelta = computedTotalQty - (inv.quantity ?? 0);
    sets.push('quantity = ?');
    params.push(computedTotalQty);
  } else if (Number.isFinite(body.quantity as number)) {
    // Rétrocompatibilité : si stock global fourni, on l'applique sur le warehouse par défaut
    const newQty = Math.max(0, Math.round(body.quantity as number));
    quantityDelta = newQty - (inv.quantity ?? 0);
    sets.push('quantity = ?');
    params.push(newQty);

    // Trouver le default warehouse
    const defaultWh = await env.DB.prepare(
      `SELECT id FROM warehouses WHERE client_id = ? AND is_active = 1 ORDER BY is_default DESC, name ASC LIMIT 1`
    ).bind(clientId).first() as { id: string } | null;

    if (defaultWh) {
      await env.DB.prepare(
        `INSERT INTO location_stocks (location_id, variant_id, client_id, quantity, reserved, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(location_id, variant_id) DO UPDATE SET quantity = excluded.quantity, updated_at = datetime('now')`
      ).bind(defaultWh.id, variantId, clientId, newQty, inv.reserved).run();
    }
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

  // Si on a modifié la quantité legacy globale (sans passer par location_stocks)
  if (quantityDelta !== 0 && !body.location_stocks) {
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

  await maybeNotifyLowStock(env, auth, clientId, ctx, fresh);

  // Charger les stocks locaux mis à jour
  const locStocksRes = await env.DB.prepare(
    `SELECT ls.location_id, ls.quantity, ls.reserved, w.name AS warehouse_name
       FROM location_stocks ls
       JOIN warehouses w ON w.id = ls.location_id
      WHERE ls.variant_id = ? AND ls.client_id = ? AND w.is_active = 1`
  ).bind(variantId, clientId).all();

  const shaped = shapeInventory(fresh);
  return json({
    data: {
      ...shaped,
      location_stocks: ((locStocksRes?.results || []) as any[]).map((r) => ({
        location_id: r.location_id,
        warehouse_name: r.warehouse_name,
        quantity: r.quantity ?? 0,
        reserved: r.reserved ?? 0,
      })),
    }
  });
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

  const parsed = await request.json().catch(() => null);
  const vi = validate(adjustInventorySchema, parsed);
  if (!vi.success) return validationError(vi.error);
  const body = vi.data as Record<string, unknown>;

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

  // Récupérer le location_id ou warehouse_id
  let locationId = (body.location_id || body.warehouse_id) as string | undefined;

  const inv = await ensureInventory(env, variantId);

  // Si pas de localisation fournie, on cherche le default warehouse du client pour faire l'ajustement
  if (!locationId) {
    const defaultWh = await env.DB.prepare(
      `SELECT id FROM warehouses WHERE client_id = ? AND is_active = 1 ORDER BY is_default DESC, name ASC LIMIT 1`
    ).bind(clientId).first() as { id: string } | null;
    if (defaultWh) {
      locationId = defaultWh.id;
    }
  }

  if (locationId) {
    // 1) Ajustement par localisation (location_stocks)
    const oldLoc = await env.DB.prepare(
      `SELECT quantity, reserved FROM location_stocks WHERE location_id = ? AND variant_id = ? AND client_id = ?`
    ).bind(locationId, variantId, clientId).first() as { quantity: number; reserved: number } | null;

    const oldQty = oldLoc?.quantity ?? 0;
    const oldReserved = oldLoc?.reserved ?? 0;
    const newLocQty = oldQty + delta;

    if (
      newLocQty < 0 &&
      (inv.track_inventory ?? 1) === 1 &&
      (inv.allow_backorder ?? 0) === 0
    ) {
      return json(
        {
          error: 'Stock insuffisant',
          message: `Impossible : il ne reste que ${oldQty} unité(s) dans la localisation.`,
        },
        409,
      );
    }

    await env.DB.prepare(
      `INSERT INTO location_stocks (location_id, variant_id, client_id, quantity, reserved, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(location_id, variant_id) DO UPDATE SET quantity = excluded.quantity, updated_at = datetime('now')`
    ).bind(locationId, variantId, clientId, newLocQty, oldReserved).run();

    // Mouvement de stock local
    await env.DB.prepare(
      `INSERT INTO inventory_movements
         (id, variant_id, delta, reason, reference_type, reference_id, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), variantId, delta, reason,
      referenceType, referenceId, note ?? `Ajustement de stock (localisation ${locationId})`, auth.userId,
    ).run();

    // Recalculer le stock global dans inventory
    const totalStock = await env.DB.prepare(
      `SELECT SUM(quantity) as total_qty, SUM(reserved) as total_res FROM location_stocks WHERE variant_id = ? AND client_id = ?`
    ).bind(variantId, clientId).first() as { total_qty: number; total_res: number } | null;

    const newTotalQty = totalStock?.total_qty ?? 0;
    const newTotalRes = totalStock?.total_res ?? 0;

    await env.DB.prepare(
      `UPDATE inventory SET quantity = ?, reserved = ?, updated_at = datetime('now') WHERE variant_id = ?`
    ).bind(newTotalQty, newTotalRes, variantId).run();
  } else {
    // 2) Ajustement global classique (legacy)
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
  }

  await audit(env, auth.userId, 'adjust', 'inventory', variantId, {
    delta, reason, productId: ctx.productId,
  });

  const fresh = await env.DB.prepare(
    'SELECT * FROM inventory WHERE variant_id = ?',
  ).bind(variantId).first() as InventoryRow;

  await maybeNotifyLowStock(env, auth, clientId, ctx, fresh);

  // Charger les stocks locaux
  const locStocksRes = await env.DB.prepare(
    `SELECT ls.location_id, ls.quantity, ls.reserved, w.name AS warehouse_name
       FROM location_stocks ls
       JOIN warehouses w ON w.id = ls.location_id
      WHERE ls.variant_id = ? AND ls.client_id = ? AND w.is_active = 1`
  ).bind(variantId, clientId).all();

  const shaped = shapeInventory(fresh);
  return json({
    data: {
      ...shaped,
      location_stocks: ((locStocksRes?.results || []) as any[]).map((r) => ({
        location_id: r.location_id,
        warehouse_name: r.warehouse_name,
        quantity: r.quantity ?? 0,
        reserved: r.reserved ?? 0,
      })),
    }
  });
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

  // [S2 multi-tenant] déjà couvert upstream L327 (resolveVariant) — variantId
  // prouvé du tenant clientId. inventory_movements sans client_id : on ne lit
  // QUE les mouvements de la variante validée (scope tenant hérité).
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

  // [S2 multi-tenant] tenant-scoped OK via la chaîne
  // inventory i → product_variants v → products p WHERE p.client_id = ?.
  // Filtrage tenant explicite dans la clause (pas de client_id sur inventory :
  // c'est le pattern correct, défense déjà en profondeur ici).
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

    // [S2 multi-tenant] ctx provient de resolveVariant (déjà validé tenant
    // par le handler appelant) — ctx.variantId est prouvé du tenant clientId.
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
  reason?: 'not_found' | 'insufficient' | 'tenant_mismatch';
  available?: number;
  quantity?: number;
  reserved?: number;
}

/**
 * [S2 multi-tenant] Référence optionnelle vers le tenant pour les helpers stock
 * exposés à E3. `clientId` est OPTIONNEL et purement RÉTRO-COMPATIBLE : s'il est
 * fourni, on ajoute une assertion défensive (la variante doit appartenir au
 * tenant) — sinon comportement strictement inchangé (E3 a déjà validé l'ordre
 * et ses lignes upstream). Aucun appel légitime n'est cassé ni sur-restreint.
 */
type StockRef = { type?: string; id?: string; by?: string; clientId?: string; locationId?: string; warehouseId?: string };

/**
 * [S2 multi-tenant] Garde commune des helpers stock exposés. Si `ref.clientId`
 * est fourni : refuse (sans effet de bord) si la variante n'appartient pas au
 * tenant — défense en profondeur contre un appelant E3 qui aurait sauté le
 * gate. Si absent : passe (rétro-compat, scope assuré par l'appelant). Ne
 * sur-restreint JAMAIS un appel légitime du tenant propriétaire.
 */
async function guardStockTenant(
  env: Env, variantId: string, ref?: StockRef,
): Promise<boolean> {
  if (!ref?.clientId) return true; // rétro-compat : scope upstream (E3)
  return assertVariantTenant(env, ref.clientId, variantId);
}

/**
 * Réserve `qty` unités (incrémente reserved). Respecte allow_backorder :
 * refuse si available < qty et que le backorder est interdit + track on.
 * NE décrémente PAS quantity (réservation ≠ vente). Trace un mouvement
 * 'reservation' (delta négatif informatif sur le disponible).
 */
export async function reserveStock(
  env: Env, variantId: string, qty: number,
  ref?: StockRef,
): Promise<StockOpResult> {
  const n = Math.max(0, Math.round(qty));
  if (n === 0) return { ok: true };
  if (!(await guardStockTenant(env, variantId, ref))) {
    return { ok: false, reason: 'tenant_mismatch' };
  }

  const locationId = ref?.locationId || ref?.warehouseId;
  const inv = await ensureInventory(env, variantId);

  if (locationId) {
    // Réservation locale
    const oldLoc = await env.DB.prepare(
      `SELECT quantity, reserved FROM location_stocks WHERE location_id = ? AND variant_id = ?`
    ).bind(locationId, variantId).first() as { quantity: number; reserved: number } | null;

    const oldQty = oldLoc?.quantity ?? 0;
    const oldReserved = oldLoc?.reserved ?? 0;
    const locAvailable = oldQty - oldReserved;

    if (
      locAvailable < n &&
      (inv.track_inventory ?? 1) === 1 &&
      (inv.allow_backorder ?? 0) === 0
    ) {
      return { ok: false, reason: 'insufficient', available: locAvailable, quantity: oldQty, reserved: oldReserved };
    }

    await env.DB.prepare(
      `INSERT INTO location_stocks (location_id, variant_id, client_id, quantity, reserved, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(location_id, variant_id) DO UPDATE SET reserved = reserved + ?, updated_at = datetime('now')`
    ).bind(locationId, variantId, ref?.clientId ?? 'system', oldQty, oldReserved + n, n).run();

    // Mettre à jour globalement dans inventory
    await env.DB.prepare(
      `UPDATE inventory SET reserved = reserved + ?, updated_at = datetime('now') WHERE variant_id = ?`
    ).bind(n, variantId).run();

    await env.DB.prepare(
      `INSERT INTO inventory_movements
         (id, variant_id, delta, reason, reference_type, reference_id, note, created_by)
       VALUES (?, ?, ?, 'reservation', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), variantId, -n,
      ref?.type || 'order', ref?.id || null, `Réservation de stock (localisation ${locationId})`, ref?.by || null,
    ).run();

    return { ok: true, available: locAvailable - n };
  } else {
    // Réservation globale (legacy)
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
}

/**
 * Libère `qty` unités réservées (annulation panier / commande expirée).
 * reserved ne descend jamais sous 0 (garde-fou). Trace un mouvement 'return'
 * informatif (delta positif sur le disponible).
 */
export async function releaseStock(
  env: Env, variantId: string, qty: number,
  ref?: StockRef,
): Promise<StockOpResult> {
  const n = Math.max(0, Math.round(qty));
  if (n === 0) return { ok: true };
  if (!(await guardStockTenant(env, variantId, ref))) {
    return { ok: false, reason: 'tenant_mismatch' };
  }

  const locationId = ref?.locationId || ref?.warehouseId;
  const inv = await ensureInventory(env, variantId);

  if (locationId) {
    // Libération locale
    const oldLoc = await env.DB.prepare(
      `SELECT quantity, reserved FROM location_stocks WHERE location_id = ? AND variant_id = ?`
    ).bind(locationId, variantId).first() as { quantity: number; reserved: number } | null;

    const oldReserved = oldLoc?.reserved ?? 0;
    const release = Math.min(n, oldReserved);
    if (release === 0) return { ok: true, reserved: oldReserved };

    await env.DB.prepare(
      `UPDATE location_stocks SET reserved = max(0, reserved - ?), updated_at = datetime('now')
        WHERE location_id = ? AND variant_id = ?`
    ).bind(release, locationId, variantId).run();

    await env.DB.prepare(
      `UPDATE inventory SET reserved = max(0, reserved - ?), updated_at = datetime('now') WHERE variant_id = ?`
    ).bind(release, variantId).run();

    await env.DB.prepare(
      `INSERT INTO inventory_movements
         (id, variant_id, delta, reason, reference_type, reference_id, note, created_by)
       VALUES (?, ?, ?, 'return', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), variantId, release,
      ref?.type || 'order', ref?.id || null, `Libération de réservation (localisation ${locationId})`, ref?.by || null,
    ).run();

    return { ok: true, reserved: oldReserved - release };
  } else {
    // Libération globale
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
}

/**
 * Concrétise une vente : décrémente quantity ET libère la réservation
 * correspondante (la marchandise quitte vraiment le stock). Trace un mouvement
 * 'sale'. À appeler par E3 au paiement confirmé d'une commande.
 */
export async function commitSale(
  env: Env, variantId: string, qty: number,
  ref?: StockRef,
): Promise<StockOpResult> {
  const n = Math.max(0, Math.round(qty));
  if (n === 0) return { ok: true };
  if (!(await guardStockTenant(env, variantId, ref))) {
    return { ok: false, reason: 'tenant_mismatch' };
  }

  const locationId = ref?.locationId || ref?.warehouseId;
  const inv = await ensureInventory(env, variantId);

  if (locationId) {
    // Vente locale
    const oldLoc = await env.DB.prepare(
      `SELECT quantity, reserved FROM location_stocks WHERE location_id = ? AND variant_id = ?`
    ).bind(locationId, variantId).first() as { quantity: number; reserved: number } | null;

    const oldQty = oldLoc?.quantity ?? 0;
    const oldReserved = oldLoc?.reserved ?? 0;
    const newLocQty = oldQty - n;

    if (
      newLocQty < 0 &&
      (inv.track_inventory ?? 1) === 1 &&
      (inv.allow_backorder ?? 0) === 0
    ) {
      return {
        ok: false, reason: 'insufficient',
        available: oldQty - oldReserved,
        quantity: oldQty, reserved: oldReserved,
      };
    }

    const releasedReserve = Math.min(n, oldReserved);
    await env.DB.prepare(
      `UPDATE location_stocks
          SET quantity = ?, reserved = max(0, reserved - ?), updated_at = datetime('now')
        WHERE location_id = ? AND variant_id = ?`
    ).bind(newLocQty, releasedReserve, locationId, variantId).run();

    await env.DB.prepare(
      `UPDATE inventory
          SET quantity = quantity - ?, reserved = max(0, reserved - ?), updated_at = datetime('now')
        WHERE variant_id = ?`
    ).bind(n, releasedReserve, variantId).run();

    await env.DB.prepare(
      `INSERT INTO inventory_movements
         (id, variant_id, delta, reason, reference_type, reference_id, note, created_by)
       VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), variantId, -n,
      ref?.type || 'order', ref?.id || null, `Vente confirmée (localisation ${locationId})`, ref?.by || null,
    ).run();

    return { ok: true, quantity: newLocQty };
  } else {
    // Vente globale
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
}
