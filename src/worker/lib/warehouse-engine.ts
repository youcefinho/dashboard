// ── Sprint 47 — warehouse-engine.ts — Engine multi-warehouse + dropshipping ──
//
// Helpers PURE/HANDLER pour warehouse-dropship.ts. Étend le pipeline e-commerce
// S(E1) (seq58) + payment S(E4) (seq62) sans toucher aux handlers ecommerce-*.ts.
//
// 4 helpers (signatures FIGÉES Phase A, corps Phase B implémentés) :
//   - routeOrderItems()  : async D1, dispatche les items d'un order vers les
//                           suppliers configurés (dropship_routings.auto_route=1)
//                           OU assigne au warehouse par défaut sinon.
//   - executeTransfer()  : async D1, applique un inventory_transfer (delta sur
//                           inventory + UPDATE status='completed').
//   - parseSupplierCsv() : pure, parse un CSV catalogue selon format mapping
//                           (csv_format_json supplier) → liste d'items normalisés.
//   - notifySupplier()   : async, notifie le supplier d'un nouvel order via
//                           api_endpoint si configuré, sinon flag inactif.
//
// Contrats GELÉS (docs/LOT-WAREHOUSE-DROPSHIP-S47.md §6) :
//   - imports RELATIFS uniquement (`../types`)
//   - PAS de throw — best-effort, dégradation gracieuse (calque
//     community-engine / subscription-engine)
//   - PAS d'appel réseau supplier.api en Phase A (flag inactif tant que
//     `api_endpoint` NULL ou vide ⇒ retourne `sent:false, reason:'no_endpoint'`)
//   - Devise locked 'CAD' V1 (cohérence seq120)
//   - api_key chiffrée via TOKEN_KEY HMAC HANDLER (lib/crypto.ts) — jamais en
//     clair en mémoire au-delà du temps d'un appel réseau (Phase B)
//
// ⚠ NE TOUCHE PAS aux helpers ecommerce-*.ts existants. Pas de mutation
//   directe d'orders/order_items ici — uniquement inventory + inventory_transfers
//   + dropship_orders.

import type { Env } from '../types';

// ── Types internes (alignés api.ts client) ────────────────────────────────

/** Item d'order minimal (lecture order_items). */
export interface OrderItemLite {
  id: string;
  variant_id: string;
  quantity: number;
}

/** Routing dropship minimal (lecture dropship_routings). */
export interface DropshipRoutingLite {
  id: string;
  variant_id: string;
  supplier_id: string;
  auto_route: number;
  supplier_sku: string | null;
  cost_cents: number;
}

/** Item parsé depuis un CSV catalogue supplier. */
export interface ParsedSupplierCatalogItem {
  sku: string;
  name: string;
  cost_cents: number;
  stock_qty: number;
}

/** Mapping CSV format (stocké JSON dans dropship_suppliers.csv_format_json). */
export interface SupplierCsvFormat {
  /** Colonne CSV pour le SKU (default: 'sku'). */
  sku?: string;
  /** Colonne CSV pour le nom produit (default: 'name'). */
  name?: string;
  /** Colonne CSV pour le coût (default: 'cost_cents'). Cents INT attendu. */
  cost?: string;
  /** Colonne CSV pour le stock (default: 'stock_qty'). */
  stock?: string;
}

/** Résultat de routeOrderItems(). */
export interface RouteOrderItemsResult {
  /** Nombre d'items traités (= items de l'order). */
  items_routed: number;
  /** Lignes dropship_orders insérées (1 par supplier dispatché). */
  dropship_orders: Array<{
    id: string;
    supplier_id: string;
    order_id: string;
  }>;
}

/** Résultat de executeTransfer(). */
export interface ExecuteTransferResult {
  ok: boolean;
  reason?: string;
}

/** Résultat de notifySupplier(). */
export interface NotifySupplierResult {
  sent: boolean;
  ref: string | null;
  reason?: string;
}

// ── routeOrderItems — async D1 ────────────────────────────────────────────

/**
 * Dispatche les items d'un order vers leurs suppliers configurés OU les assigne
 * au warehouse par défaut du client. Idempotent best-effort : si déjà appelé
 * sur le même order, les inserts dropship_orders peuvent doubler — Phase B
 * câblera un UNIQUE (order_id, supplier_id) si besoin.
 *
 * Pour chaque order_item :
 *   - Lookup dropship_routings WHERE variant_id = ? AND auto_route = 1
 *   - Si trouvé : INSERT dropship_orders (status='pending')
 *   - Sinon : ne fait rien côté dropship — caller route au warehouse par défaut
 *             via inventory.warehouse_id (logique Phase B inventory routing)
 *
 * Phase A : implémentation safe — si pas d'order ou pas d'items ⇒
 * { items_routed: 0, dropship_orders: [] }.
 */
export async function routeOrderItems(
  env: Env,
  orderId: string,
): Promise<RouteOrderItemsResult> {
  try {
    if (!orderId) return { items_routed: 0, dropship_orders: [] };

    // Lecture des items de l'order (best-effort — schema seq58).
    const itemsRes = await env.DB.prepare(
      `SELECT id, variant_id, quantity FROM order_items WHERE order_id = ?`,
    )
      .bind(orderId)
      .all();
    const items = (itemsRes?.results ?? []) as unknown as OrderItemLite[];
    if (items.length === 0) return { items_routed: 0, dropship_orders: [] };

    // Lecture client_id de l'order (best-effort — bornage tenant).
    const orderRow = (await env.DB.prepare(
      `SELECT client_id FROM orders WHERE id = ?`,
    )
      .bind(orderId)
      .first()) as { client_id?: string } | null;
    const clientId = orderRow?.client_id ?? null;

    const dropshipOrders: Array<{ id: string; supplier_id: string; order_id: string }> = [];

    for (const item of items) {
      if (!item.variant_id) continue;
      const routing = (await env.DB.prepare(
        `SELECT id, supplier_id, auto_route FROM dropship_routings
         WHERE variant_id = ? AND auto_route = 1
         ${clientId ? 'AND client_id = ?' : ''}
         LIMIT 1`,
      )
        .bind(...(clientId ? [item.variant_id, clientId] : [item.variant_id]))
        .first()) as { id: string; supplier_id: string; auto_route: number } | null;

      if (routing && routing.supplier_id) {
        // INSERT dropship_orders (status='pending').
        const id = crypto.randomUUID().replace(/-/g, '');
        try {
          await env.DB.prepare(
            `INSERT INTO dropship_orders
               (id, client_id, order_id, supplier_id, status)
             VALUES (?, ?, ?, ?, 'pending')`,
          )
            .bind(id, clientId, orderId, routing.supplier_id)
            .run();
          dropshipOrders.push({ id, supplier_id: routing.supplier_id, order_id: orderId });
        } catch {
          /* best-effort */
        }
      }
      // Else : pas de routing dropship — caller assignera warehouse_id default.
    }

    return { items_routed: items.length, dropship_orders: dropshipOrders };
  } catch {
    return { items_routed: 0, dropship_orders: [] };
  }
}

// ── executeTransfer — async D1 ────────────────────────────────────────────

/**
 * Applique un inventory_transfer : subtract from source warehouse + add to
 * destination warehouse + UPDATE status='completed' + completed_at.
 *
 * Phase A : implémentation safe — vérifie statut pending|in_transit, applique
 * les deltas sur inventory (jointure applicative variant_id + warehouse_id),
 * UPDATE le transfer. Si déjà completed/cancelled ⇒ no-op + reason.
 *
 * NB : Phase B affinera la sémantique inventory (split par warehouse_id —
 * pour V1 on UPDATE la ligne inventory matching warehouse_id + variant_id ou
 * insert si absente. Caller doit avoir initialisé les lignes inventory par
 * warehouse via /api/inventory/warehouse-init).
 */
export async function executeTransfer(
  env: Env,
  transferId: string,
): Promise<ExecuteTransferResult> {
  try {
    if (!transferId) return { ok: false, reason: 'no_id' };

    const transfer = (await env.DB.prepare(
      `SELECT id, client_id, from_warehouse_id, to_warehouse_id, variant_id,
              quantity, status
       FROM inventory_transfers WHERE id = ?`,
    )
      .bind(transferId)
      .first()) as {
      id: string;
      client_id: string;
      from_warehouse_id: string;
      to_warehouse_id: string;
      variant_id: string;
      quantity: number;
      status: string;
    } | null;

    if (!transfer) return { ok: false, reason: 'not_found' };
    if (transfer.status === 'completed' || transfer.status === 'cancelled') {
      return { ok: false, reason: 'already_terminal' };
    }
    if (!transfer.variant_id || transfer.quantity <= 0) {
      return { ok: false, reason: 'invalid_payload' };
    }

    // Subtract from source (UPDATE existing row matched on warehouse_id+variant_id).
    try {
      await env.DB.prepare(
        `UPDATE inventory SET quantity = MAX(0, quantity - ?), updated_at = datetime('now')
         WHERE variant_id = ? AND warehouse_id = ?`,
      )
        .bind(transfer.quantity, transfer.variant_id, transfer.from_warehouse_id)
        .run();
    } catch {
      /* best-effort */
    }

    // Add to destination (UPDATE existing or upsert via INSERT OR IGNORE then UPDATE).
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO inventory (variant_id, warehouse_id, quantity)
         VALUES (?, ?, 0)`,
      )
        .bind(transfer.variant_id, transfer.to_warehouse_id)
        .run();
      await env.DB.prepare(
        `UPDATE inventory SET quantity = quantity + ?, updated_at = datetime('now')
         WHERE variant_id = ? AND warehouse_id = ?`,
      )
        .bind(transfer.quantity, transfer.variant_id, transfer.to_warehouse_id)
        .run();
    } catch {
      /* best-effort */
    }

    // UPDATE transfer status + completed_at.
    try {
      await env.DB.prepare(
        `UPDATE inventory_transfers SET status = 'completed', completed_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(transferId)
        .run();
    } catch {
      /* best-effort */
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: 'exception' };
  }
}

// ── parseSupplierCsv — pure ───────────────────────────────────────────────

/**
 * Parse un CSV catalogue supplier selon un mapping de colonnes (csv_format_json).
 *
 * PURE — pas d'I/O, pas de throw. Si CSV vide ou invalide ⇒ retourne [].
 *
 * Format CSV attendu : 1ère ligne = header, suivantes = data. Séparateur ','.
 * Pas de support quotes/escapes avancés en V1 (CSV simple supplier-flat).
 *
 * Mapping default si format absent :
 *   sku   ← 'sku'
 *   name  ← 'name'
 *   cost  ← 'cost_cents'
 *   stock ← 'stock_qty'
 */
export function parseSupplierCsv(
  csvText: string,
  format?: SupplierCsvFormat | null,
): ParsedSupplierCatalogItem[] {
  if (!csvText || typeof csvText !== 'string') return [];

  const fmt: Required<SupplierCsvFormat> = {
    sku: format?.sku ?? 'sku',
    name: format?.name ?? 'name',
    cost: format?.cost ?? 'cost_cents',
    stock: format?.stock ?? 'stock_qty',
  };

  // Normalize line endings + split.
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  if (!headerLine) return [];

  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  const idxSku = headers.indexOf(fmt.sku.toLowerCase());
  const idxName = headers.indexOf(fmt.name.toLowerCase());
  const idxCost = headers.indexOf(fmt.cost.toLowerCase());
  const idxStock = headers.indexOf(fmt.stock.toLowerCase());

  // SKU est obligatoire pour identifier une ligne ; les autres dégradent en defaults.
  if (idxSku < 0) return [];

  const out: ParsedSupplierCatalogItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(',').map((c) => c.trim());
    const sku = cols[idxSku];
    if (!sku) continue;
    const name = idxName >= 0 ? (cols[idxName] ?? '') : '';
    const costRaw = idxCost >= 0 ? (cols[idxCost] ?? '0') : '0';
    const stockRaw = idxStock >= 0 ? (cols[idxStock] ?? '0') : '0';
    const cost_cents = Math.max(0, Math.round(Number(costRaw) || 0));
    const stock_qty = Math.max(0, Math.round(Number(stockRaw) || 0));
    out.push({ sku, name, cost_cents, stock_qty });
  }
  return out;
}

// ── notifySupplier — async ────────────────────────────────────────────────

/**
 * Notifie un supplier d'un nouvel order via son api_endpoint configuré.
 *
 * Phase A : implémentation safe — si `api_endpoint` NULL ou vide ⇒ flag inactif
 * (`sent:false, reason:'no_endpoint'`). Sinon best-effort log + retourne
 * `sent:true` avec ref pseudo (`mock-${orderRef}`). Phase B câblera l'appel
 * réseau réel avec api_key déchiffrée TOKEN_KEY HMAC + retry exponentiel +
 * webhook tracking_number.
 *
 * PAS de throw — best-effort, dégradation gracieuse.
 */
export async function notifySupplier(
  env: Env,
  supplierId: string,
  orderRef: string,
): Promise<NotifySupplierResult> {
  try {
    if (!supplierId || !orderRef) return { sent: false, ref: null, reason: 'no_payload' };

    const supplier = (await env.DB.prepare(
      `SELECT id, api_endpoint, is_active FROM dropship_suppliers WHERE id = ?`,
    )
      .bind(supplierId)
      .first()) as { id: string; api_endpoint: string | null; is_active: number } | null;

    if (!supplier) return { sent: false, ref: null, reason: 'not_found' };
    if (!supplier.is_active) return { sent: false, ref: null, reason: 'inactive' };
    if (!supplier.api_endpoint || supplier.api_endpoint.trim().length === 0) {
      return { sent: false, ref: null, reason: 'no_endpoint' };
    }

    // Phase A : mock — Phase B appellera api.stripe-style avec api_key déchiffrée.
    return { sent: true, ref: `mock-${orderRef}` };
  } catch {
    return { sent: false, ref: null, reason: 'exception' };
  }
}

// ── Renforcement (helpers PURS additifs Phase B+) ────────────────────────
//
// 6 helpers PURS (zéro I/O, zéro throw, déterministes) + 2 constants
// whitelist. Aucune régression possible vs handlers existants : les fonctions
// async ci-dessus continuent d'utiliser la sémantique D1 UPDATE par
// (variant_id, warehouse_id). Les helpers ci-dessous fournissent les
// primitives de calcul (inventory level, reorder, transfer validation, FIFO
// allocation, dropship payload assembly) pour les futurs callers (cron
// stock-alert, UI client preview, supplier API real-call Phase B).

// ── Constants whitelist (calque enum HANDLER seq142 §2.+§5.) ─────────────

/**
 * Types de mouvements de stock comptabilisés par computeInventoryLevel().
 * 'in' + 'transfer_in' = entrées (+qty), 'out' + 'transfer_out' = sorties (-qty).
 * 'adjustment' = signed (caller passe la valeur signée +/-). Tout autre type
 * non listé est IGNORÉ silencieusement (forward-compat).
 */
export const STOCK_MOVEMENT_TYPES = {
  IN: 'in',
  OUT: 'out',
  TRANSFER_IN: 'transfer_in',
  TRANSFER_OUT: 'transfer_out',
  ADJUSTMENT: 'adjustment',
} as const;

export type StockMovementType =
  (typeof STOCK_MOVEMENT_TYPES)[keyof typeof STOCK_MOVEMENT_TYPES];

/**
 * Codes erreur whitelist warehouse engine (réutilisés par les helpers PURS et
 * les handlers async pour cohérence cross-couche). Le contrat figé §6 interdit
 * de retourner ces codes dans le JSON HTTP (champ `error` text only), mais ils
 * sont utiles côté caller pour brancher la logique (ex : suggestedQty si
 * REORDER_NEEDED, retry si DROPSHIP_FAILED).
 */
export const WAREHOUSE_ERROR_CODES = {
  WAREHOUSE_NOT_FOUND: 'warehouse_not_found',
  INSUFFICIENT_STOCK: 'insufficient_stock',
  INVALID_TRANSFER: 'invalid_transfer',
  SUPPLIER_NOT_FOUND: 'supplier_not_found',
  DROPSHIP_FAILED: 'dropship_failed',
  SAME_WAREHOUSE: 'same_warehouse',
  INVALID_QUANTITY: 'invalid_quantity',
} as const;

export type WarehouseErrorCode =
  (typeof WAREHOUSE_ERROR_CODES)[keyof typeof WAREHOUSE_ERROR_CODES];

// ── Types renforcement ───────────────────────────────────────────────────

/**
 * Mouvement de stock lu depuis une table stock_movements (ou équivalent).
 * Le calcul `computeInventoryLevel()` somme les quantités signées selon
 * `type` — voir constants STOCK_MOVEMENT_TYPES.
 */
export interface StockMovement {
  /** Identifiant mouvement (non utilisé par le calcul — utile pour debug). */
  id?: string;
  /** Type de mouvement (whitelist STOCK_MOVEMENT_TYPES). */
  type: StockMovementType | string;
  /** Quantité (positive — le signe est déduit du `type`). Pour 'adjustment',
   *  caller passe la valeur SIGNÉE (+5 ou -3). */
  quantity: number;
  /** Optionnels — non utilisés par le calcul mais propagés pour debug. */
  warehouse_id?: string;
  product_id?: string;
  variant_id?: string;
  created_at?: string;
}

/** Résultat de isReorderNeeded(). */
export interface ReorderEvaluation {
  /** True si le niveau actuel < seuil (déclenche réapprovisionnement). */
  needed: boolean;
  /** Quantité suggérée à commander si needed=true, sinon 0. Calcul classique :
   *  demand_per_day * lead_time_days + safety_stock (threshold sert de safety). */
  suggestedQty: number;
}

/** Résultat de validateTransfer(). */
export interface TransferValidation {
  /** True si le transfer est valide (qty > 0, warehouses ≠, stock suffisant). */
  ok: boolean;
  /** Code erreur whitelist si !ok (WAREHOUSE_ERROR_CODES). */
  error?: WarehouseErrorCode;
}

/** Warehouse minimal pour FIFO allocation (created_at ASC = oldest first). */
export interface WarehouseAllocationCandidate {
  /** Identifiant warehouse. */
  id: string;
  /** Stock disponible dans ce warehouse pour le variant cible. */
  available: number;
  /** Date de création du warehouse (ou de la ligne stock) — sert au tri FIFO. */
  created_at: string;
}

/** Une allocation FIFO produit le mapping warehouse → qty à puiser. */
export interface Allocation {
  /** Identifiant warehouse source. */
  warehouse_id: string;
  /** Quantité à puiser dans ce warehouse (toujours > 0 — pas d'entrée à 0). */
  quantity: number;
}

/** Payload supplier pour buildDropshipPayload() (shape API supplier-flat V1). */
export interface SupplierOrderPayload {
  /** Identifiant supplier (config dropship_suppliers.id). */
  supplier_id: string;
  /** Référence order interne (jamais le supplier_order_ref retour). */
  order_ref: string;
  /** Items à dispatcher (SKU supplier + qty). */
  items: Array<{
    sku: string;
    quantity: number;
    cost_cents?: number;
  }>;
  /** Adresse de livraison normalisée. */
  shipping_address: {
    name: string;
    line1: string;
    line2?: string | null;
    city: string;
    country_subdiv?: string | null;
    country: string;
    postal_code?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  /** Devise locked 'CAD' V1 (cohérence seq120). */
  currency: 'CAD';
  /** Notes optionnelles transmises au supplier. */
  notes?: string | null;
}

// ── computeInventoryLevel — pure ──────────────────────────────────────────

/**
 * Calcule le niveau d'inventaire net à partir d'une liste de mouvements.
 *
 * Sémantique des signes (whitelist STOCK_MOVEMENT_TYPES) :
 *   - 'in'           ⇒ +quantity
 *   - 'transfer_in'  ⇒ +quantity
 *   - 'out'          ⇒ -quantity
 *   - 'transfer_out' ⇒ -quantity
 *   - 'adjustment'   ⇒ +quantity (caller passe la valeur SIGNÉE)
 *   - tout autre type ⇒ ignoré (forward-compat, pas de throw)
 *
 * PURE — pas d'I/O, pas de throw. Si liste vide ou non-array ⇒ retourne 0.
 * Niveau clampé à 0 minimum (jamais négatif côté output — un over-out massive
 * sur stock initial vide reste à 0 plutôt que de renvoyer -N qui n'a pas de
 * sens métier inventory).
 */
export function computeInventoryLevel(movements: StockMovement[] | null | undefined): number {
  if (!movements || !Array.isArray(movements) || movements.length === 0) return 0;

  let level = 0;
  for (const m of movements) {
    if (!m || typeof m !== 'object') continue;
    const qty = Number(m.quantity);
    if (!Number.isFinite(qty)) continue;
    switch (m.type) {
      case STOCK_MOVEMENT_TYPES.IN:
      case STOCK_MOVEMENT_TYPES.TRANSFER_IN:
        level += Math.abs(qty);
        break;
      case STOCK_MOVEMENT_TYPES.OUT:
      case STOCK_MOVEMENT_TYPES.TRANSFER_OUT:
        level -= Math.abs(qty);
        break;
      case STOCK_MOVEMENT_TYPES.ADJUSTMENT:
        // adjustment : signe préservé tel que fourni par le caller.
        level += qty;
        break;
      default:
        // Type inconnu — ignoré (forward-compat).
        break;
    }
  }

  return Math.max(0, Math.round(level));
}

// ── isReorderNeeded — pure ────────────────────────────────────────────────

/**
 * Évalue si un réapprovisionnement est nécessaire pour un niveau d'inventaire
 * donné, selon la formule classique :
 *
 *   needed         = level < threshold
 *   suggestedQty   = ceil(demandPerDay * leadTimeDays) + threshold (safety)
 *                    - level
 *
 * PURE — pas d'I/O, pas de throw. Inputs invalides (NaN/négatifs) sont
 * clampés à 0. Si needed=false ⇒ suggestedQty=0.
 */
export function isReorderNeeded(
  level: number,
  threshold: number,
  leadTimeDays: number,
  demandPerDay: number,
): ReorderEvaluation {
  const lvl = Math.max(0, Number.isFinite(level) ? Math.round(level) : 0);
  const thr = Math.max(0, Number.isFinite(threshold) ? Math.round(threshold) : 0);
  const lead = Math.max(0, Number.isFinite(leadTimeDays) ? Math.round(leadTimeDays) : 0);
  const demand = Math.max(0, Number.isFinite(demandPerDay) ? demandPerDay : 0);

  const needed = lvl < thr;
  if (!needed) return { needed: false, suggestedQty: 0 };

  // safety_stock = threshold ⇒ on commande de quoi couvrir lead*demand + safety - lvl.
  const target = Math.ceil(demand * lead) + thr;
  const suggestedQty = Math.max(0, target - lvl);
  return { needed: true, suggestedQty };
}

// ── isLowStock — pure ─────────────────────────────────────────────────────

/**
 * Test trivial level < threshold (alerte UI / cron stock-alert).
 * PURE — pas d'I/O, pas de throw. Inputs invalides ⇒ false (fail-closed).
 */
export function isLowStock(level: number, threshold: number): boolean {
  if (!Number.isFinite(level) || !Number.isFinite(threshold)) return false;
  return level < threshold;
}

// ── validateTransfer — pure ───────────────────────────────────────────────

/**
 * Valide un transfer inter-warehouse sans appel D1 (utilisé en preview UI
 * + double-check côté handler avant executeTransfer).
 *
 * Refus :
 *   - sourceWarehouseId == targetWarehouseId ⇒ SAME_WAREHOUSE
 *   - qty <= 0 ⇒ INVALID_QUANTITY
 *   - levels[sourceWarehouseId] manquant ⇒ WAREHOUSE_NOT_FOUND
 *   - levels[sourceWarehouseId] < qty ⇒ INSUFFICIENT_STOCK
 *
 * PURE — pas d'I/O, pas de throw. `levels` est un map
 * { warehouseId: stockDispo } fourni par le caller (généralement issu de
 * computeInventoryLevel() ou lecture inventory direct).
 */
export function validateTransfer(
  input: {
    sourceWarehouseId: string;
    targetWarehouseId: string;
    productId?: string;
    variantId?: string;
    qty: number;
  },
  levels: Record<string, number>,
): TransferValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: WAREHOUSE_ERROR_CODES.INVALID_TRANSFER };
  }
  const { sourceWarehouseId, targetWarehouseId, qty } = input;
  if (!sourceWarehouseId || !targetWarehouseId) {
    return { ok: false, error: WAREHOUSE_ERROR_CODES.WAREHOUSE_NOT_FOUND };
  }
  if (sourceWarehouseId === targetWarehouseId) {
    return { ok: false, error: WAREHOUSE_ERROR_CODES.SAME_WAREHOUSE };
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: WAREHOUSE_ERROR_CODES.INVALID_QUANTITY };
  }
  const sourceLevel = levels?.[sourceWarehouseId];
  if (sourceLevel === undefined || sourceLevel === null) {
    return { ok: false, error: WAREHOUSE_ERROR_CODES.WAREHOUSE_NOT_FOUND };
  }
  if (sourceLevel < qty) {
    return { ok: false, error: WAREHOUSE_ERROR_CODES.INSUFFICIENT_STOCK };
  }
  return { ok: true };
}

// ── allocateFifo — pure ───────────────────────────────────────────────────

/**
 * Répartit une qty cible entre plusieurs warehouses selon ordre FIFO
 * (created_at ASC = oldest first). Vide chaque warehouse jusqu'à `available`
 * puis passe au suivant. Si la somme des disponibilités < qty ⇒ retourne ce
 * qu'on peut allouer (allocation partielle, caller décide quoi faire — split
 * dropship + warehouse, ou refus).
 *
 * PURE — pas d'I/O, pas de throw. Input vide / qty <= 0 ⇒ retourne [].
 * Warehouses avec available <= 0 sont ignorés (pas d'entrée fantôme).
 *
 * Note : la signature spec demande `Warehouse[]` mais on accepte le shape
 * minimal `WarehouseAllocationCandidate` pour rester PUR (pas de dépendance
 * à un schéma DB complet).
 */
export function allocateFifo(
  warehouses: WarehouseAllocationCandidate[] | null | undefined,
  _productId: string,
  qty: number,
): Allocation[] {
  if (!warehouses || !Array.isArray(warehouses) || warehouses.length === 0) return [];
  if (!Number.isFinite(qty) || qty <= 0) return [];

  // Trie FIFO : oldest created_at first. Tie-breaker stable : id ASC.
  const sorted = [...warehouses]
    .filter((w) => w && w.id && Number.isFinite(w.available) && w.available > 0)
    .sort((a, b) => {
      const ca = a.created_at ?? '';
      const cb = b.created_at ?? '';
      if (ca < cb) return -1;
      if (ca > cb) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const allocations: Allocation[] = [];
  let remaining = Math.round(qty);

  for (const w of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.floor(w.available));
    if (take <= 0) continue;
    allocations.push({ warehouse_id: w.id, quantity: take });
    remaining -= take;
  }

  return allocations;
}

// ── buildDropshipPayload — pure ───────────────────────────────────────────

/**
 * Assemble le payload supplier (shape API supplier-flat V1) à partir d'un
 * order interne + un supplier config + des items à dispatcher.
 *
 * PURE — pas d'I/O, pas de throw. Champs manquants ⇒ valeurs par défaut
 * safe (string vides, null). Devise locked 'CAD' V1.
 *
 * Le shape de sortie est volontairement plat et JSON-serializable direct
 * pour POST vers supplier.api_endpoint (Phase B câblera l'appel réel avec
 * api_key déchiffrée TOKEN_KEY HMAC).
 */
export function buildDropshipPayload(
  order: {
    id?: string;
    ref?: string;
    shipping_name?: string;
    shipping_line1?: string;
    shipping_line2?: string | null;
    shipping_city?: string;
    shipping_country_subdiv?: string | null;
    shipping_country?: string;
    shipping_postal_code?: string | null;
    shipping_phone?: string | null;
    shipping_email?: string | null;
    notes?: string | null;
  } | null | undefined,
  supplier: { id?: string } | null | undefined,
  items: Array<{ sku?: string; quantity?: number; cost_cents?: number }> | null | undefined,
): SupplierOrderPayload {
  const orderRef = (order?.ref || order?.id || '').toString();
  const supplierId = (supplier?.id || '').toString();

  const normalizedItems = (items ?? [])
    .filter((it) => it && typeof it === 'object' && typeof it.sku === 'string' && it.sku.length > 0)
    .map((it) => {
      const out: { sku: string; quantity: number; cost_cents?: number } = {
        sku: String(it.sku),
        quantity: Math.max(
          0,
          Math.round(typeof it.quantity === 'number' ? it.quantity : Number(it.quantity) || 0),
        ),
      };
      if (typeof it.cost_cents === 'number' && Number.isFinite(it.cost_cents)) {
        out.cost_cents = Math.max(0, Math.round(it.cost_cents));
      }
      return out;
    })
    .filter((it) => it.quantity > 0);

  return {
    supplier_id: supplierId,
    order_ref: orderRef,
    items: normalizedItems,
    shipping_address: {
      name: order?.shipping_name ?? '',
      line1: order?.shipping_line1 ?? '',
      line2: order?.shipping_line2 ?? null,
      city: order?.shipping_city ?? '',
      country_subdiv: order?.shipping_country_subdiv ?? null,
      country: order?.shipping_country ?? '',
      postal_code: order?.shipping_postal_code ?? null,
      phone: order?.shipping_phone ?? null,
      email: order?.shipping_email ?? null,
    },
    currency: 'CAD',
    notes: order?.notes ?? null,
  };
}

// NB : 4 helpers async D1 (routeOrderItems, executeTransfer, parseSupplierCsv,
// notifySupplier) + 6 helpers PURS additifs (computeInventoryLevel,
// isReorderNeeded, isLowStock, validateTransfer, allocateFifo,
// buildDropshipPayload) + 2 constants whitelist (STOCK_MOVEMENT_TYPES,
// WAREHOUSE_ERROR_CODES). PAS de throw, PAS d'appel supplier.api réel en
// Phase A. Imports RELATIFS uniquement (`../types`). Devise locked 'CAD' V1.
// api_key déchiffrement TOKEN_KEY HMAC réservé Phase B (handlers stubs Phase A
// retournent `not_implemented` 501). Choix figés docs/LOT-WAREHOUSE-DROPSHIP-S47.md §6.
