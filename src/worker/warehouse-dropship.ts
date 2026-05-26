// ── Sprint 47 — warehouse-dropship.ts — Handlers REST multi-warehouse + dropship
//
// 19 handlers AUTHED (5 warehouses + 3 transfers + 5 suppliers + 4 routings +
// 2 dropship_orders). Routes câblées dans `src/worker.ts` (Phase A, ordre
// anti-shadowing : tous suffixes spécifiques avant routes génériques).
// Phase B : 14 stubs 501 remplis. routeOrderToSupplier câble bien
// warehouse-engine.routeOrderItems().
//
// ⚠ DISTINCT de `ecommerce-*.ts` (Sprint E1+) — module NEUF qui ÉTEND le
//   pipeline e-commerce sans toucher aux handlers/order existants. Tables
//   additives seq142 (warehouses + inventory_transfers + dropship_suppliers
//   + dropship_routings + dropship_orders) + ALTER additif inventory.warehouse_id.
//
// Contrats GELÉS (docs/LOT-WAREHOUSE-DROPSHIP-S47.md §6) :
//   - succès : json({ data })
//   - erreur : json({ error }, status)   ← JAMAIS de champ `code`
//   - imports RELATIFS uniquement (`./types`, `./capabilities`, `./helpers`,
//                                  `./lib/warehouse-engine`,
//                                  `./migration-ghl-oauth` pour encrypt)
//   - capabilities FIGÉES :
//       * clients.manage  (admin/owner client) : warehouses CRUD + default,
//                          inventory_transfers CRUD + complete, dropship_routings
//                          CRUD, dropship_orders list + route
//       * settings.manage (admin agence) : dropship_suppliers CRUD + import-csv
//                          (secrets api_key sensibles ⇒ admin only)
//     AUCUN ajout à ALL_CAPABILITIES seq 80.
//   - supplier_api FLAG INACTIF par défaut (api_endpoint NULL ⇒ notifySupplier
//     `sent:false, reason:'no_endpoint'`) — pas d'appel api supplier en Phase B.
//   - api_key_encrypted via TOKEN_KEY AES-GCM (migration-ghl-oauth.ts
//     encryptToken/decryptToken réutilisés verbatim) — chiffrement au
//     POST/PATCH, jamais retourné en clair en GET (masqué `***`).
//
// Bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR).
// Garde capability au top de chaque handler.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit } from './helpers';
import {
  routeOrderItems,
  executeTransfer,
  parseSupplierCsv,
  computeInventoryLevel,
  isReorderNeeded,
  isLowStock,
  validateTransfer,
  allocateFifo,
  buildDropshipPayload,
  WAREHOUSE_ERROR_CODES,
} from './lib/warehouse-engine';
import type {
  SupplierCsvFormat,
  StockMovement,
  WarehouseAllocationCandidate,
} from './lib/warehouse-engine';
import { encryptToken } from './migration-ghl-oauth';

/** Auth enrichi au choke-point worker.ts (calque subscriptions-advanced.ts). */
export type WarehouseDropshipAuth = CapAuth & { capabilities?: Set<string> };

// ── Gardes capability ─────────────────────────────────────────────────────

/** Cap `clients.manage` (warehouses/transfers/routings/dropship_orders). */
function clientsCapGuard(auth: WarehouseDropshipAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'clients.manage');
}

/** Cap `settings.manage` (dropship_suppliers — secrets api_key admin only). */
function settingsCapGuard(auth: WarehouseDropshipAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

// ── Helpers internes ──────────────────────────────────────────────────────

/** Parse JSON body best-effort (empty/invalid ⇒ {}). */
async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** UUID hex 32 (calque warehouse-engine routeOrderItems). */
function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Best-effort audit log (calque subscriptions-advanced). */
async function logAudit(
  env: Env,
  auth: WarehouseDropshipAuth,
  action: string,
  refType: string,
  refId: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await audit(
      env,
      auth.userId ?? 'system',
      action,
      refType,
      refId ?? '',
      meta ?? {},
    );
  } catch {
    /* best-effort */
  }
}

/** Lit une ligne warehouses bornée tenant (defense-in-depth IDOR). */
async function loadWarehouse(
  env: Env,
  warehouseId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM warehouses WHERE id = ? AND client_id = ?`,
    )
      .bind(warehouseId, clientId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/** Lit une ligne dropship_suppliers bornée tenant. */
async function loadSupplier(
  env: Env,
  supplierId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM dropship_suppliers WHERE id = ? AND client_id = ?`,
    )
      .bind(supplierId, clientId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/** Lit une ligne dropship_routings bornée tenant. */
async function loadRouting(
  env: Env,
  routingId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM dropship_routings WHERE id = ? AND client_id = ?`,
    )
      .bind(routingId, clientId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/**
 * Construit un map { warehouseId: level } pour un variant donné, basé sur
 * stock_movements si dispo, sinon fallback sur inventory.quantity - reserved.
 * Best-effort : si schema absent ou exception ⇒ {} (callers handle as missing).
 *
 * Utilisé par les handlers transfer pour alimenter validateTransfer().
 */
async function buildLevelsForVariant(
  env: Env,
  clientId: string,
  variantId: string,
): Promise<Record<string, number>> {
  const levels: Record<string, number> = {};

  // 1) Tentative stock_movements (engine semantics — somme signée par type).
  try {
    const res = await env.DB.prepare(
      `SELECT warehouse_id, type, quantity FROM stock_movements
        WHERE client_id = ? AND variant_id = ?`,
    )
      .bind(clientId, variantId)
      .all();
    const rows = (res?.results ?? []) as unknown as Array<{
      warehouse_id: string;
      type: string;
      quantity: number;
    }>;
    if (rows.length > 0) {
      const grouped: Record<string, StockMovement[]> = {};
      for (const r of rows) {
        if (!r.warehouse_id) continue;
        (grouped[r.warehouse_id] ||= []).push({
          type: r.type,
          quantity: r.quantity,
          warehouse_id: r.warehouse_id,
          variant_id: variantId,
        });
      }
      for (const [whId, movs] of Object.entries(grouped)) {
        levels[whId] = computeInventoryLevel(movs);
      }
      return levels;
    }
  } catch {
    /* fallback sur inventory snapshot */
  }

  // 2) Fallback : lecture inventory snapshot (quantity - reserved par warehouse).
  try {
    const res = await env.DB.prepare(
      `SELECT warehouse_id, quantity, reserved FROM inventory WHERE variant_id = ?`,
    )
      .bind(variantId)
      .all();
    const rows = (res?.results ?? []) as unknown as Array<{
      warehouse_id: string | null;
      quantity: number;
      reserved: number;
    }>;
    for (const r of rows) {
      if (!r.warehouse_id) continue;
      const avail = Math.max(0, (r.quantity ?? 0) - (r.reserved ?? 0));
      levels[r.warehouse_id] = avail;
    }
  } catch {
    /* best-effort */
  }
  return levels;
}

/** Masque api_key_encrypted dans une ligne supplier avant retour HTTP. */
function maskSupplier(row: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...row };
  if (Object.prototype.hasOwnProperty.call(masked, 'api_key_encrypted')) {
    masked.api_key_set = masked.api_key_encrypted ? '***' : null;
    delete masked.api_key_encrypted;
  }
  return masked;
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Warehouses (5)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/warehouses — liste warehouses tenant-scoped (cap clients.manage). */
export async function handleListWarehouses(
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ data: [] });
    const res = await env.DB.prepare(
      `SELECT * FROM warehouses WHERE client_id = ? ORDER BY is_default DESC, name ASC`,
    )
      .bind(clientId)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/** POST /api/warehouses — créer warehouse (cap clients.manage). */
export async function handleCreateWarehouse(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);

    const body = await readJsonBody(request);
    const name =
      typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    if (!name) return json({ error: 'name requis' }, 400);

    const address =
      typeof body.address === 'string' ? body.address.slice(0, 500) : null;
    const country =
      typeof body.country === 'string' ? body.country.slice(0, 100) : null;
    const countrySubdiv =
      typeof body.country_subdiv === 'string'
        ? body.country_subdiv.slice(0, 100)
        : null;
    const contactEmail =
      typeof body.contact_email === 'string'
        ? body.contact_email.slice(0, 200)
        : null;
    const contactPhone =
      typeof body.contact_phone === 'string'
        ? body.contact_phone.slice(0, 50)
        : null;
    const isActive =
      body.is_active === false || body.is_active === 0 ? 0 : 1;
    const isDefault =
      body.is_default === true || body.is_default === 1 ? 1 : 0;

    const id = newId();

    try {
      // Si on crée comme default : démarquer les autres (unicité applicative).
      if (isDefault) {
        try {
          await env.DB.prepare(
            `UPDATE warehouses SET is_default = 0, updated_at = datetime('now')
             WHERE client_id = ? AND is_default = 1`,
          )
            .bind(clientId)
            .run();
        } catch {
          /* best-effort */
        }
      }

      await env.DB.prepare(
        `INSERT INTO warehouses
           (id, client_id, name, address, country, country_subdiv,
            is_active, is_default, contact_email, contact_phone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          clientId,
          name,
          address,
          country,
          countrySubdiv,
          isActive,
          isDefault,
          contactEmail,
          contactPhone,
        )
        .run();
    } catch {
      return json({ error: 'Création warehouse échouée' }, 500);
    }

    await logAudit(env, auth, 'warehouse.create', 'warehouse', id, {
      name,
      is_default: isDefault === 1,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        name,
        address,
        country,
        country_subdiv: countrySubdiv,
        is_active: isActive,
        is_default: isDefault,
        contact_email: contactEmail,
        contact_phone: contactPhone,
      },
    });
  } catch {
    return json({ error: 'Erreur création warehouse' }, 500);
  }
}

/** PATCH /api/warehouses/:id — mise à jour warehouse (cap clients.manage). */
export async function handleUpdateWarehouse(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
  warehouseId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!warehouseId) return json({ error: 'warehouse_id requis' }, 400);

    const existing = await loadWarehouse(env, warehouseId, clientId);
    if (!existing) return json({ error: 'Warehouse introuvable' }, 404);

    const body = await readJsonBody(request);
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (typeof body.name === 'string') {
      sets.push('name = ?');
      binds.push(body.name.trim().slice(0, 200));
    }
    if (typeof body.address === 'string' || body.address === null) {
      sets.push('address = ?');
      binds.push(
        typeof body.address === 'string' ? body.address.slice(0, 500) : null,
      );
    }
    if (typeof body.country === 'string' || body.country === null) {
      sets.push('country = ?');
      binds.push(
        typeof body.country === 'string' ? body.country.slice(0, 100) : null,
      );
    }
    if (typeof body.country_subdiv === 'string' || body.country_subdiv === null) {
      sets.push('country_subdiv = ?');
      binds.push(
        typeof body.country_subdiv === 'string'
          ? body.country_subdiv.slice(0, 100)
          : null,
      );
    }
    if (typeof body.contact_email === 'string' || body.contact_email === null) {
      sets.push('contact_email = ?');
      binds.push(
        typeof body.contact_email === 'string'
          ? body.contact_email.slice(0, 200)
          : null,
      );
    }
    if (typeof body.contact_phone === 'string' || body.contact_phone === null) {
      sets.push('contact_phone = ?');
      binds.push(
        typeof body.contact_phone === 'string'
          ? body.contact_phone.slice(0, 50)
          : null,
      );
    }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?');
      binds.push(body.is_active === false || body.is_active === 0 ? 0 : 1);
    }

    if (sets.length === 0) {
      return json({ data: existing });
    }

    sets.push("updated_at = datetime('now')");
    binds.push(warehouseId, clientId);

    try {
      await env.DB.prepare(
        `UPDATE warehouses SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
      )
        .bind(...binds)
        .run();
    } catch {
      return json({ error: 'Mise à jour warehouse échouée' }, 500);
    }

    await logAudit(env, auth, 'warehouse.update', 'warehouse', warehouseId, {
      fields: sets.length - 1, // -1 pour updated_at
    });

    const updated = await loadWarehouse(env, warehouseId, clientId);
    return json({ data: updated ?? { id: warehouseId } });
  } catch {
    return json({ error: 'Erreur mise à jour warehouse' }, 500);
  }
}

/** DELETE /api/warehouses/:id — soft-delete warehouse (cap clients.manage). */
export async function handleDeleteWarehouse(
  env: Env,
  auth: WarehouseDropshipAuth,
  warehouseId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!warehouseId) return json({ error: 'warehouse_id requis' }, 400);

    const existing = await loadWarehouse(env, warehouseId, clientId);
    if (!existing) return json({ error: 'Warehouse introuvable' }, 404);

    try {
      await env.DB.prepare(
        `UPDATE warehouses
            SET is_active = 0, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
        .bind(warehouseId, clientId)
        .run();
    } catch {
      return json({ error: 'Suppression warehouse échouée' }, 500);
    }

    await logAudit(env, auth, 'warehouse.delete', 'warehouse', warehouseId, {
      soft: true,
    });

    return json({ data: { id: warehouseId, is_active: 0 } });
  } catch {
    return json({ error: 'Erreur suppression warehouse' }, 500);
  }
}

/** POST /api/warehouses/:id/default — set warehouse par défaut (cap clients.manage). */
export async function handleSetDefaultWarehouse(
  env: Env,
  auth: WarehouseDropshipAuth,
  warehouseId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!warehouseId) return json({ error: 'warehouse_id requis' }, 400);

    const existing = await loadWarehouse(env, warehouseId, clientId);
    if (!existing) return json({ error: 'Warehouse introuvable' }, 404);

    // Unmark all + mark sélectionné (unicité applicative : 1 default par client).
    try {
      await env.DB.prepare(
        `UPDATE warehouses
            SET is_default = 0, updated_at = datetime('now')
          WHERE client_id = ? AND is_default = 1`,
      )
        .bind(clientId)
        .run();
    } catch {
      /* best-effort — on continue pour ne pas bloquer le set */
    }

    try {
      await env.DB.prepare(
        `UPDATE warehouses
            SET is_default = 1, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
        .bind(warehouseId, clientId)
        .run();
    } catch {
      return json({ error: 'Définition warehouse par défaut échouée' }, 500);
    }

    await logAudit(env, auth, 'warehouse.set_default', 'warehouse', warehouseId, {});

    return json({ data: { id: warehouseId, is_default: 1 } });
  } catch {
    return json({ error: 'Erreur set default warehouse' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Inventory Transfers (3)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/inventory-transfers — liste transfers tenant (cap clients.manage). */
export async function handleListInventoryTransfers(
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ data: [] });
    const res = await env.DB.prepare(
      `SELECT * FROM inventory_transfers WHERE client_id = ?
       ORDER BY created_at DESC LIMIT 200`,
    )
      .bind(clientId)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/** POST /api/inventory-transfers — créer transfer (cap clients.manage). */
export async function handleCreateInventoryTransfer(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);

    const body = await readJsonBody(request);
    const fromWarehouseId =
      typeof body.from_warehouse_id === 'string' ? body.from_warehouse_id : '';
    const toWarehouseId =
      typeof body.to_warehouse_id === 'string' ? body.to_warehouse_id : '';
    const variantId =
      typeof body.variant_id === 'string' ? body.variant_id : '';
    const quantityRaw = body.quantity;
    const quantity =
      typeof quantityRaw === 'number'
        ? Math.round(quantityRaw)
        : Math.round(Number(quantityRaw) || 0);
    const notes =
      typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null;

    if (!fromWarehouseId) return json({ error: 'from_warehouse_id requis' }, 400);
    if (!toWarehouseId) return json({ error: 'to_warehouse_id requis' }, 400);
    if (fromWarehouseId === toWarehouseId) {
      return json({ error: 'from_warehouse_id et to_warehouse_id identiques' }, 400);
    }
    if (!variantId) return json({ error: 'variant_id requis' }, 400);
    if (quantity <= 0) return json({ error: 'quantity > 0 requis' }, 400);

    // Bornage tenant : les 2 warehouses doivent appartenir au client.
    const fromWh = await loadWarehouse(env, fromWarehouseId, clientId);
    const toWh = await loadWarehouse(env, toWarehouseId, clientId);
    if (!fromWh || !toWh) {
      return json({ error: 'Warehouse(s) introuvable(s) pour ce client' }, 404);
    }

    // Validation engine : calcule levels par warehouse (stock_movements ou
    // fallback inventory), puis check same_warehouse + qty + stock suffisant.
    // Câble warehouse-engine.validateTransfer() — codes erreur whitelist
    // WAREHOUSE_ERROR_CODES injectés dans le message (contrat figé §6 :
    // pas de champ `code` séparé).
    //
    // Fail-open : si AUCUN level n'est disponible (pas de stock_movements ni
    // d'inventory snapshot pour ce variant), on saute la validation stock —
    // V1 best-effort, ne bloque pas un transfer légit sur schema incomplet.
    // SAME_WAREHOUSE / INVALID_QUANTITY restent toujours évalués (input pur).
    const levels = await buildLevelsForVariant(env, clientId, variantId);
    const hasLevels = Object.keys(levels).length > 0;
    if (hasLevels) {
      const validation = validateTransfer(
        {
          sourceWarehouseId: fromWarehouseId,
          targetWarehouseId: toWarehouseId,
          variantId,
          qty: quantity,
        },
        levels,
      );
      if (!validation.ok) {
        const errCode = validation.error;
        const status =
          errCode === WAREHOUSE_ERROR_CODES.INSUFFICIENT_STOCK ? 409 : 400;
        const msg =
          errCode === WAREHOUSE_ERROR_CODES.INSUFFICIENT_STOCK
            ? `Stock insuffisant (${errCode})`
            : errCode === WAREHOUSE_ERROR_CODES.SAME_WAREHOUSE
            ? `Warehouses identiques (${errCode})`
            : errCode === WAREHOUSE_ERROR_CODES.INVALID_QUANTITY
            ? `Quantité invalide (${errCode})`
            : errCode === WAREHOUSE_ERROR_CODES.WAREHOUSE_NOT_FOUND
            ? `Warehouse source introuvable (${errCode})`
            : `Transfer invalide (${errCode ?? 'invalid_transfer'})`;
        return json({ error: msg }, status);
      }
    }

    const id = newId();

    try {
      await env.DB.prepare(
        `INSERT INTO inventory_transfers
           (id, client_id, from_warehouse_id, to_warehouse_id, variant_id,
            quantity, status, notes, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
        .bind(
          id,
          clientId,
          fromWarehouseId,
          toWarehouseId,
          variantId,
          quantity,
          notes,
          auth.userId ?? null,
        )
        .run();
    } catch {
      return json({ error: 'Création transfer échouée' }, 500);
    }

    await logAudit(env, auth, 'inventory_transfer.create', 'inventory_transfer', id, {
      from: fromWarehouseId,
      to: toWarehouseId,
      variant_id: variantId,
      quantity,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        from_warehouse_id: fromWarehouseId,
        to_warehouse_id: toWarehouseId,
        variant_id: variantId,
        quantity,
        status: 'pending',
        notes,
      },
    });
  } catch {
    return json({ error: 'Erreur création transfer' }, 500);
  }
}

/** POST /api/inventory-transfers/:id/complete — applique transfer (cap clients.manage). */
export async function handleCompleteInventoryTransfer(
  env: Env,
  auth: WarehouseDropshipAuth,
  transferId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!transferId) return json({ error: 'transfer_id requis' }, 400);

    // Bornage tenant : vérifier que le transfer appartient au client.
    let existing: Record<string, unknown> | null = null;
    try {
      existing = (await env.DB.prepare(
        `SELECT * FROM inventory_transfers WHERE id = ? AND client_id = ?`,
      )
        .bind(transferId, clientId)
        .first()) as Record<string, unknown> | null;
    } catch {
      existing = null;
    }
    if (!existing) return json({ error: 'Transfer introuvable' }, 404);

    const result = await executeTransfer(env, transferId);

    await logAudit(env, auth, 'inventory_transfer.complete', 'inventory_transfer', transferId, {
      ok: result.ok,
      reason: result.reason ?? null,
    });

    if (!result.ok) {
      // Best-effort : on retourne 409 si déjà terminal, 400 si payload invalide,
      // 500 sinon. PAS de champ `code` (contrat figé).
      const reason = result.reason ?? 'failed';
      const status =
        reason === 'already_terminal'
          ? 409
          : reason === 'invalid_payload' || reason === 'no_id'
          ? 400
          : reason === 'not_found'
          ? 404
          : 500;
      return json({ error: `Transfer non appliqué : ${reason}` }, status);
    }

    return json({ data: { id: transferId, status: 'completed' } });
  } catch {
    return json({ error: 'Erreur complétion transfer' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Dropship Suppliers (5)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/dropship-suppliers — liste suppliers tenant (cap settings.manage). */
export async function handleListDropshipSuppliers(
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = settingsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ data: [] });
    // Masque api_key_encrypted en GET (jamais retourné en clair ni hash).
    const res = await env.DB.prepare(
      `SELECT id, client_id, name, api_endpoint,
              CASE WHEN api_key_encrypted IS NOT NULL THEN '***' ELSE NULL END AS api_key_set,
              csv_format_json, contact_email, default_shipping_cost_cents,
              is_active, created_at, updated_at
       FROM dropship_suppliers WHERE client_id = ?
       ORDER BY name ASC`,
    )
      .bind(clientId)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/** POST /api/dropship-suppliers — créer supplier (cap settings.manage). */
export async function handleCreateDropshipSupplier(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = settingsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);

    const body = await readJsonBody(request);
    const name =
      typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    if (!name) return json({ error: 'name requis' }, 400);

    const apiEndpoint =
      typeof body.api_endpoint === 'string'
        ? body.api_endpoint.trim().slice(0, 500) || null
        : null;
    const apiKeyPlain =
      typeof body.api_key === 'string' && body.api_key.length > 0
        ? body.api_key
        : null;
    const csvFormatJson =
      body.csv_format_json !== undefined && body.csv_format_json !== null
        ? typeof body.csv_format_json === 'string'
          ? body.csv_format_json.slice(0, 4000)
          : JSON.stringify(body.csv_format_json).slice(0, 4000)
        : null;
    const contactEmail =
      typeof body.contact_email === 'string'
        ? body.contact_email.slice(0, 200)
        : null;
    const defaultShippingCents =
      typeof body.default_shipping_cost_cents === 'number'
        ? Math.max(0, Math.round(body.default_shipping_cost_cents))
        : Math.max(0, Math.round(Number(body.default_shipping_cost_cents) || 0));
    const isActive =
      body.is_active === false || body.is_active === 0 ? 0 : 1;

    // Chiffrement api_key — AES-GCM TOKEN_KEY (migration-ghl-oauth réutilisé).
    let apiKeyEncrypted: string | null = null;
    if (apiKeyPlain) {
      try {
        apiKeyEncrypted = await encryptToken(apiKeyPlain, env);
      } catch {
        return json({ error: 'Chiffrement api_key échoué' }, 500);
      }
    }

    const id = newId();

    try {
      await env.DB.prepare(
        `INSERT INTO dropship_suppliers
           (id, client_id, name, api_endpoint, api_key_encrypted,
            csv_format_json, contact_email, default_shipping_cost_cents, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          clientId,
          name,
          apiEndpoint,
          apiKeyEncrypted,
          csvFormatJson,
          contactEmail,
          defaultShippingCents,
          isActive,
        )
        .run();
    } catch {
      return json({ error: 'Création supplier échouée' }, 500);
    }

    await logAudit(env, auth, 'dropship_supplier.create', 'dropship_supplier', id, {
      name,
      has_api_key: apiKeyEncrypted !== null,
      has_endpoint: apiEndpoint !== null,
    });

    // Retour masqué (jamais d'api_key en clair, jamais d'api_key_encrypted brut).
    return json({
      data: {
        id,
        client_id: clientId,
        name,
        api_endpoint: apiEndpoint,
        api_key_set: apiKeyEncrypted ? '***' : null,
        csv_format_json: csvFormatJson,
        contact_email: contactEmail,
        default_shipping_cost_cents: defaultShippingCents,
        is_active: isActive,
      },
    });
  } catch {
    return json({ error: 'Erreur création supplier' }, 500);
  }
}

/** PATCH /api/dropship-suppliers/:id — mise à jour supplier (cap settings.manage). */
export async function handleUpdateDropshipSupplier(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
  supplierId: string,
): Promise<Response> {
  const cap = settingsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!supplierId) return json({ error: 'supplier_id requis' }, 400);

    const existing = await loadSupplier(env, supplierId, clientId);
    if (!existing) return json({ error: 'Supplier introuvable' }, 404);

    const body = await readJsonBody(request);
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (typeof body.name === 'string') {
      sets.push('name = ?');
      binds.push(body.name.trim().slice(0, 200));
    }
    if (typeof body.api_endpoint === 'string' || body.api_endpoint === null) {
      sets.push('api_endpoint = ?');
      binds.push(
        typeof body.api_endpoint === 'string'
          ? body.api_endpoint.trim().slice(0, 500) || null
          : null,
      );
    }
    // api_key : seulement écrire si explicitement fourni. null ⇒ suppression
    // de la clé. String non vide ⇒ chiffrement + write.
    if (Object.prototype.hasOwnProperty.call(body, 'api_key')) {
      if (body.api_key === null || body.api_key === '') {
        sets.push('api_key_encrypted = ?');
        binds.push(null);
      } else if (typeof body.api_key === 'string') {
        let enc: string;
        try {
          enc = await encryptToken(body.api_key, env);
        } catch {
          return json({ error: 'Chiffrement api_key échoué' }, 500);
        }
        sets.push('api_key_encrypted = ?');
        binds.push(enc);
      }
    }
    if (body.csv_format_json !== undefined) {
      sets.push('csv_format_json = ?');
      if (body.csv_format_json === null) {
        binds.push(null);
      } else if (typeof body.csv_format_json === 'string') {
        binds.push(body.csv_format_json.slice(0, 4000));
      } else {
        binds.push(JSON.stringify(body.csv_format_json).slice(0, 4000));
      }
    }
    if (typeof body.contact_email === 'string' || body.contact_email === null) {
      sets.push('contact_email = ?');
      binds.push(
        typeof body.contact_email === 'string'
          ? body.contact_email.slice(0, 200)
          : null,
      );
    }
    if (body.default_shipping_cost_cents !== undefined) {
      const cents =
        typeof body.default_shipping_cost_cents === 'number'
          ? Math.max(0, Math.round(body.default_shipping_cost_cents))
          : Math.max(0, Math.round(Number(body.default_shipping_cost_cents) || 0));
      sets.push('default_shipping_cost_cents = ?');
      binds.push(cents);
    }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?');
      binds.push(body.is_active === false || body.is_active === 0 ? 0 : 1);
    }

    if (sets.length === 0) {
      const masked = maskSupplier(existing);
      return json({ data: masked });
    }

    sets.push("updated_at = datetime('now')");
    binds.push(supplierId, clientId);

    try {
      await env.DB.prepare(
        `UPDATE dropship_suppliers SET ${sets.join(', ')}
          WHERE id = ? AND client_id = ?`,
      )
        .bind(...binds)
        .run();
    } catch {
      return json({ error: 'Mise à jour supplier échouée' }, 500);
    }

    await logAudit(env, auth, 'dropship_supplier.update', 'dropship_supplier', supplierId, {
      fields: sets.length - 1,
      api_key_touched: Object.prototype.hasOwnProperty.call(body, 'api_key'),
    });

    const updated = await loadSupplier(env, supplierId, clientId);
    return json({ data: updated ? maskSupplier(updated) : { id: supplierId } });
  } catch {
    return json({ error: 'Erreur mise à jour supplier' }, 500);
  }
}

/** DELETE /api/dropship-suppliers/:id — soft-delete supplier (cap settings.manage). */
export async function handleDeleteDropshipSupplier(
  env: Env,
  auth: WarehouseDropshipAuth,
  supplierId: string,
): Promise<Response> {
  const cap = settingsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!supplierId) return json({ error: 'supplier_id requis' }, 400);

    const existing = await loadSupplier(env, supplierId, clientId);
    if (!existing) return json({ error: 'Supplier introuvable' }, 404);

    try {
      await env.DB.prepare(
        `UPDATE dropship_suppliers
            SET is_active = 0, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
        .bind(supplierId, clientId)
        .run();
    } catch {
      return json({ error: 'Suppression supplier échouée' }, 500);
    }

    await logAudit(env, auth, 'dropship_supplier.delete', 'dropship_supplier', supplierId, {
      soft: true,
    });

    return json({ data: { id: supplierId, is_active: 0 } });
  } catch {
    return json({ error: 'Erreur suppression supplier' }, 500);
  }
}

/** POST /api/dropship-suppliers/:id/import-csv — import catalogue CSV (cap settings.manage). */
export async function handleImportSupplierCatalogCsv(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
  supplierId: string,
): Promise<Response> {
  const cap = settingsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!supplierId) return json({ error: 'supplier_id requis' }, 400);

    const supplier = await loadSupplier(env, supplierId, clientId);
    if (!supplier) return json({ error: 'Supplier introuvable' }, 404);

    const body = await readJsonBody(request);
    const csvText = typeof body.csvText === 'string' ? body.csvText : '';
    if (!csvText) return json({ error: 'csvText requis' }, 400);

    // Format mapping : priorité body.format_json, sinon supplier.csv_format_json.
    let format: SupplierCsvFormat | null = null;
    const fmtRaw = body.format_json ?? supplier.csv_format_json ?? null;
    if (fmtRaw) {
      try {
        if (typeof fmtRaw === 'string') {
          format = JSON.parse(fmtRaw) as SupplierCsvFormat;
        } else if (typeof fmtRaw === 'object') {
          format = fmtRaw as SupplierCsvFormat;
        }
      } catch {
        format = null;
      }
    }

    const items = parseSupplierCsv(csvText, format);

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      if (!item.sku) {
        skipped += 1;
        continue;
      }

      // Match SKU → product_variants.sku (bornage tenant via JOIN products
      // ou via client_id direct si présent sur product_variants). On lit
      // l'id du variant et l'éventuel routing existant.
      let variantId: string | null = null;
      try {
        const row = (await env.DB.prepare(
          `SELECT pv.id AS id
             FROM product_variants pv
             LEFT JOIN products p ON p.id = pv.product_id
            WHERE pv.sku = ?
              AND (p.client_id = ? OR pv.client_id = ?)
            LIMIT 1`,
        )
          .bind(item.sku, clientId, clientId)
          .first()) as { id?: string } | null;
        variantId = row?.id ?? null;
      } catch {
        // Schema variant : pas de client_id direct → on tente une variante
        // de la requête avec JOIN seul (best-effort).
        try {
          const row = (await env.DB.prepare(
            `SELECT pv.id AS id
               FROM product_variants pv
               JOIN products p ON p.id = pv.product_id
              WHERE pv.sku = ? AND p.client_id = ?
              LIMIT 1`,
          )
            .bind(item.sku, clientId)
            .first()) as { id?: string } | null;
          variantId = row?.id ?? null;
        } catch {
          variantId = null;
        }
      }

      if (!variantId) {
        skipped += 1;
        continue;
      }

      // Routing existant pour ce variant+client ?
      let existingRoutingId: string | null = null;
      try {
        const row = (await env.DB.prepare(
          `SELECT id FROM dropship_routings
            WHERE client_id = ? AND variant_id = ?
            LIMIT 1`,
        )
          .bind(clientId, variantId)
          .first()) as { id?: string } | null;
        existingRoutingId = row?.id ?? null;
      } catch {
        existingRoutingId = null;
      }

      if (existingRoutingId) {
        // UPDATE routing avec supplier_sku + cost_cents (sans changer supplier_id).
        try {
          await env.DB.prepare(
            `UPDATE dropship_routings
                SET supplier_sku = ?, cost_cents = ?, updated_at = datetime('now')
              WHERE id = ? AND client_id = ?`,
          )
            .bind(item.sku, item.cost_cents, existingRoutingId, clientId)
            .run();
          updated += 1;
        } catch {
          skipped += 1;
        }
      } else {
        // INSERT nouveau routing pointant vers ce supplier.
        const id = newId();
        try {
          await env.DB.prepare(
            `INSERT INTO dropship_routings
               (id, client_id, variant_id, supplier_id, auto_route,
                supplier_sku, cost_cents)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
          )
            .bind(id, clientId, variantId, supplierId, item.sku, item.cost_cents)
            .run();
          imported += 1;
        } catch {
          skipped += 1;
        }
      }
    }

    await logAudit(env, auth, 'dropship_supplier.import_csv', 'dropship_supplier', supplierId, {
      parsed: items.length,
      imported,
      updated,
      skipped,
    });

    return json({ data: { imported, updated, skipped, parsed: items.length } });
  } catch {
    return json({ error: 'Erreur import CSV catalogue' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Dropship Routings (4)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/dropship-routings — liste routings tenant (cap clients.manage). */
export async function handleListDropshipRoutings(
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ data: [] });
    const res = await env.DB.prepare(
      `SELECT * FROM dropship_routings WHERE client_id = ?
       ORDER BY created_at DESC LIMIT 500`,
    )
      .bind(clientId)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/** POST /api/dropship-routings — créer routing (cap clients.manage). */
export async function handleCreateDropshipRouting(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);

    const body = await readJsonBody(request);
    const variantId =
      typeof body.variant_id === 'string' ? body.variant_id : '';
    const supplierId =
      typeof body.supplier_id === 'string' ? body.supplier_id : '';
    if (!variantId) return json({ error: 'variant_id requis' }, 400);
    if (!supplierId) return json({ error: 'supplier_id requis' }, 400);

    // Bornage tenant : supplier doit appartenir au client.
    const supplier = await loadSupplier(env, supplierId, clientId);
    if (!supplier) return json({ error: 'Supplier introuvable pour ce client' }, 404);

    // UNIQUE (client_id, variant_id) — fail-fast HANDLER 409 si déjà existant.
    try {
      const dup = (await env.DB.prepare(
        `SELECT id FROM dropship_routings WHERE client_id = ? AND variant_id = ? LIMIT 1`,
      )
        .bind(clientId, variantId)
        .first()) as { id?: string } | null;
      if (dup?.id) {
        return json({ error: 'Routing déjà existant pour ce variant' }, 409);
      }
    } catch {
      /* best-effort — on tente l'INSERT, le UNIQUE SQL backstop. */
    }

    const autoRoute =
      body.auto_route === false || body.auto_route === 0 ? 0 : 1;
    const supplierSku =
      typeof body.supplier_sku === 'string'
        ? body.supplier_sku.slice(0, 200)
        : null;
    const costCents =
      typeof body.cost_cents === 'number'
        ? Math.max(0, Math.round(body.cost_cents))
        : Math.max(0, Math.round(Number(body.cost_cents) || 0));

    const id = newId();

    try {
      await env.DB.prepare(
        `INSERT INTO dropship_routings
           (id, client_id, variant_id, supplier_id, auto_route, supplier_sku, cost_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, clientId, variantId, supplierId, autoRoute, supplierSku, costCents)
        .run();
    } catch (e) {
      // UNIQUE SQL backstop ⇒ 409. Sinon 500.
      const msg = String(e ?? '');
      if (/UNIQUE/i.test(msg) || /constraint failed/i.test(msg)) {
        return json({ error: 'Routing déjà existant pour ce variant' }, 409);
      }
      return json({ error: 'Création routing échouée' }, 500);
    }

    await logAudit(env, auth, 'dropship_routing.create', 'dropship_routing', id, {
      variant_id: variantId,
      supplier_id: supplierId,
      auto_route: autoRoute,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        variant_id: variantId,
        supplier_id: supplierId,
        auto_route: autoRoute,
        supplier_sku: supplierSku,
        cost_cents: costCents,
      },
    });
  } catch {
    return json({ error: 'Erreur création routing' }, 500);
  }
}

/** PATCH /api/dropship-routings/:id — mise à jour routing (cap clients.manage). */
export async function handleUpdateDropshipRouting(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
  routingId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!routingId) return json({ error: 'routing_id requis' }, 400);

    const existing = await loadRouting(env, routingId, clientId);
    if (!existing) return json({ error: 'Routing introuvable' }, 404);

    const body = await readJsonBody(request);
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (typeof body.supplier_id === 'string' && body.supplier_id.length > 0) {
      // Bornage tenant : nouveau supplier doit appartenir au client.
      const supplier = await loadSupplier(env, body.supplier_id, clientId);
      if (!supplier) {
        return json({ error: 'Supplier introuvable pour ce client' }, 404);
      }
      sets.push('supplier_id = ?');
      binds.push(body.supplier_id);
    }
    if (body.auto_route !== undefined) {
      sets.push('auto_route = ?');
      binds.push(body.auto_route === false || body.auto_route === 0 ? 0 : 1);
    }
    if (typeof body.supplier_sku === 'string' || body.supplier_sku === null) {
      sets.push('supplier_sku = ?');
      binds.push(
        typeof body.supplier_sku === 'string'
          ? body.supplier_sku.slice(0, 200)
          : null,
      );
    }
    if (body.cost_cents !== undefined) {
      const cents =
        typeof body.cost_cents === 'number'
          ? Math.max(0, Math.round(body.cost_cents))
          : Math.max(0, Math.round(Number(body.cost_cents) || 0));
      sets.push('cost_cents = ?');
      binds.push(cents);
    }

    if (sets.length === 0) {
      return json({ data: existing });
    }

    sets.push("updated_at = datetime('now')");
    binds.push(routingId, clientId);

    try {
      await env.DB.prepare(
        `UPDATE dropship_routings SET ${sets.join(', ')}
          WHERE id = ? AND client_id = ?`,
      )
        .bind(...binds)
        .run();
    } catch {
      return json({ error: 'Mise à jour routing échouée' }, 500);
    }

    await logAudit(env, auth, 'dropship_routing.update', 'dropship_routing', routingId, {
      fields: sets.length - 1,
    });

    const updated = await loadRouting(env, routingId, clientId);
    return json({ data: updated ?? { id: routingId } });
  } catch {
    return json({ error: 'Erreur mise à jour routing' }, 500);
  }
}

/** DELETE /api/dropship-routings/:id — supprimer routing (cap clients.manage). */
export async function handleDeleteDropshipRouting(
  env: Env,
  auth: WarehouseDropshipAuth,
  routingId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!routingId) return json({ error: 'routing_id requis' }, 400);

    const existing = await loadRouting(env, routingId, clientId);
    if (!existing) return json({ error: 'Routing introuvable' }, 404);

    // DELETE dur (routings sont des mappings de config — pas de soft).
    try {
      await env.DB.prepare(
        `DELETE FROM dropship_routings WHERE id = ? AND client_id = ?`,
      )
        .bind(routingId, clientId)
        .run();
    } catch {
      return json({ error: 'Suppression routing échouée' }, 500);
    }

    await logAudit(env, auth, 'dropship_routing.delete', 'dropship_routing', routingId, {});

    return json({ data: { id: routingId, deleted: true } });
  } catch {
    return json({ error: 'Erreur suppression routing' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Dropship Orders (2)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/dropship-orders — liste dropship_orders tenant (cap clients.manage). */
export async function handleListDropshipOrders(
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ data: [] });
    const res = await env.DB.prepare(
      `SELECT * FROM dropship_orders WHERE client_id = ?
       ORDER BY created_at DESC LIMIT 200`,
    )
      .bind(clientId)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/**
 * POST /api/dropship-orders/route/:orderId — dispatch order vers supplier(s).
 *
 * Câble warehouse-engine.routeOrderItems(). Garde cap clients.manage.
 * Best-effort : si pas de routing trouvé pour aucun variant ⇒ retourne
 * `data:{ items_routed: N, dropship_orders: [] }`.
 */
export async function handleRouteOrderToSupplier(
  env: Env,
  auth: WarehouseDropshipAuth,
  orderId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  if (!orderId) return json({ error: 'order_id requis' }, 400);

  try {
    const result = await routeOrderItems(env, orderId);
    await logAudit(env, auth, 'dropship.order.routed', 'order', orderId, {
      items_routed: result.items_routed,
      dropship_orders_count: result.dropship_orders.length,
    });
    return json({ data: result });
  } catch {
    return json({ error: 'route_order_failed' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Renforcement engine (additifs — câblage helpers PURS)
// ════════════════════════════════════════════════════════════════════════════
//
// 4 handlers additifs câblant les helpers PURS du renforcement warehouse-engine
// (computeInventoryLevel / isLowStock / isReorderNeeded / allocateFifo /
// buildDropshipPayload). 100 % additifs — zéro impact sur les 19 handlers
// existants. Gardes capability identiques (clients.manage). Bornage tenant
// strict via auth.clientId.

/**
 * GET /api/warehouses/:id/inventory — liste l'inventaire d'un warehouse
 * tenant-scopé. Calcule chaque niveau via computeInventoryLevel() depuis
 * stock_movements (fallback inventory snapshot). Expose un flag `low_stock`
 * par variant via isLowStock(level, threshold).
 *
 * Câble : computeInventoryLevel + isLowStock.
 */
export async function handleListWarehouseInventory(
  env: Env,
  auth: WarehouseDropshipAuth,
  warehouseId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ data: [] });
    if (!warehouseId) return json({ error: 'warehouse_id requis' }, 400);

    // Bornage tenant : warehouse appartient au client.
    const wh = await loadWarehouse(env, warehouseId, clientId);
    if (!wh) {
      return json(
        { error: `Warehouse introuvable (${WAREHOUSE_ERROR_CODES.WAREHOUSE_NOT_FOUND})` },
        404,
      );
    }

    // Liste les variants ayant un mouvement OU une ligne inventory sur ce wh.
    // Best-effort : on tente stock_movements d'abord, fallback inventory.
    const variants: Array<{
      variant_id: string;
      threshold: number;
    }> = [];

    try {
      const res = await env.DB.prepare(
        `SELECT variant_id, type, quantity
           FROM stock_movements
          WHERE client_id = ? AND warehouse_id = ?`,
      )
        .bind(clientId, warehouseId)
        .all();
      const rows = (res?.results ?? []) as unknown as Array<{
        variant_id: string;
        type: string;
        quantity: number;
      }>;

      // Group movements par variant.
      const byVariant: Record<string, StockMovement[]> = {};
      for (const r of rows) {
        if (!r.variant_id) continue;
        (byVariant[r.variant_id] ||= []).push({
          type: r.type,
          quantity: r.quantity,
          warehouse_id: warehouseId,
          variant_id: r.variant_id,
        });
      }

      // Pour chaque variant, lit threshold depuis inventory (best-effort).
      const data = [];
      for (const [variantId, movs] of Object.entries(byVariant)) {
        const level = computeInventoryLevel(movs);
        let threshold = 5;
        try {
          const inv = (await env.DB.prepare(
            `SELECT low_stock_threshold FROM inventory WHERE variant_id = ?`,
          )
            .bind(variantId)
            .first()) as { low_stock_threshold?: number } | null;
          threshold = inv?.low_stock_threshold ?? 5;
        } catch {
          /* default threshold */
        }
        data.push({
          warehouse_id: warehouseId,
          variant_id: variantId,
          level,
          low_stock_threshold: threshold,
          low_stock: isLowStock(level, threshold),
        });
        variants.push({ variant_id: variantId, threshold });
      }

      if (data.length > 0) {
        return json({ data });
      }
      // Sinon fallback inventory snapshot.
    } catch {
      /* fallback inventory */
    }

    // Fallback inventory snapshot.
    try {
      const res = await env.DB.prepare(
        `SELECT variant_id, quantity, reserved, low_stock_threshold
           FROM inventory WHERE warehouse_id = ?`,
      )
        .bind(warehouseId)
        .all();
      const rows = (res?.results ?? []) as unknown as Array<{
        variant_id: string;
        quantity: number;
        reserved: number;
        low_stock_threshold: number | null;
      }>;
      const data = rows.map((r) => {
        const level = Math.max(0, (r.quantity ?? 0) - (r.reserved ?? 0));
        const threshold = r.low_stock_threshold ?? 5;
        return {
          warehouse_id: warehouseId,
          variant_id: r.variant_id,
          level,
          low_stock_threshold: threshold,
          low_stock: isLowStock(level, threshold),
        };
      });
      return json({ data });
    } catch {
      return json({ data: [] });
    }
  } catch {
    return json({ error: 'Erreur lecture inventory warehouse' }, 500);
  }
}

/**
 * GET /api/warehouses/reorder-suggestions — suggère les variants à
 * réapprovisionner par warehouse selon isReorderNeeded().
 *
 * Câble : isReorderNeeded + computeInventoryLevel.
 *
 * Lecture inventory + champs optionnels lead_time_days/demand_per_day depuis
 * la ligne inventory (fallback defaults 7 jours / 1 unité par jour).
 */
export async function handleGetReorderSuggestions(
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ data: [] });

    // Liste tous les variants tenant-scopés avec snapshot inventory.
    let rows: Array<{
      variant_id: string;
      warehouse_id: string | null;
      quantity: number;
      reserved: number;
      low_stock_threshold: number | null;
      lead_time_days?: number | null;
      demand_per_day?: number | null;
    }> = [];
    try {
      // JOIN product_variants→products pour bornage tenant.
      const res = await env.DB.prepare(
        `SELECT i.variant_id, i.warehouse_id, i.quantity, i.reserved,
                i.low_stock_threshold
           FROM inventory i
           JOIN product_variants pv ON pv.id = i.variant_id
           JOIN products p ON p.id = pv.product_id
          WHERE p.client_id = ?`,
      )
        .bind(clientId)
        .all();
      rows = (res?.results ?? []) as typeof rows;
    } catch {
      rows = [];
    }

    const suggestions = [];
    for (const r of rows) {
      const level = Math.max(0, (r.quantity ?? 0) - (r.reserved ?? 0));
      const threshold = r.low_stock_threshold ?? 5;
      const lead = r.lead_time_days ?? 7;
      const demand = r.demand_per_day ?? 1;
      const evaluation = isReorderNeeded(level, threshold, lead, demand);
      if (evaluation.needed) {
        suggestions.push({
          variant_id: r.variant_id,
          warehouse_id: r.warehouse_id,
          level,
          threshold,
          suggested_qty: evaluation.suggestedQty,
        });
      }
    }

    return json({ data: suggestions });
  } catch {
    return json({ error: 'Erreur calcul reorder suggestions' }, 500);
  }
}

/**
 * POST /api/orders/:orderId/allocate-fifo — alloue un order item via
 * allocateFifo() sur les warehouses actifs du tenant (FIFO created_at ASC).
 *
 * Body : { variant_id, qty }. Retourne le mapping warehouse → qty à puiser.
 *
 * Câble : allocateFifo.
 */
export async function handleAllocateOrderFifo(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
  orderId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!orderId) return json({ error: 'order_id requis' }, 400);

    const body = await readJsonBody(request);
    const variantId =
      typeof body.variant_id === 'string' ? body.variant_id : '';
    const qty =
      typeof body.qty === 'number'
        ? Math.round(body.qty)
        : Math.round(Number(body.qty) || 0);

    if (!variantId) return json({ error: 'variant_id requis' }, 400);
    if (qty <= 0) {
      return json(
        { error: `Quantité invalide (${WAREHOUSE_ERROR_CODES.INVALID_QUANTITY})` },
        400,
      );
    }

    // Construit la liste WarehouseAllocationCandidate :
    //  - warehouse actifs du client + leurs created_at.
    //  - available = computeInventoryLevel(stock_movements) OU
    //                inventory.quantity - reserved en fallback.
    let warehouses: WarehouseAllocationCandidate[] = [];
    try {
      const res = await env.DB.prepare(
        `SELECT id, created_at FROM warehouses
          WHERE client_id = ? AND is_active = 1
          ORDER BY created_at ASC`,
      )
        .bind(clientId)
        .all();
      const whRows = (res?.results ?? []) as unknown as Array<{
        id: string;
        created_at: string;
      }>;

      const levels = await buildLevelsForVariant(env, clientId, variantId);
      warehouses = whRows.map((w) => ({
        id: w.id,
        available: levels[w.id] ?? 0,
        created_at: w.created_at ?? '',
      }));
    } catch {
      warehouses = [];
    }

    const allocations = allocateFifo(warehouses, variantId, qty);
    const allocatedTotal = allocations.reduce((s, a) => s + a.quantity, 0);
    const shortfall = Math.max(0, qty - allocatedTotal);

    return json({
      data: {
        order_id: orderId,
        variant_id: variantId,
        qty_requested: qty,
        qty_allocated: allocatedTotal,
        shortfall,
        allocations,
      },
    });
  } catch {
    return json({ error: 'Erreur allocation FIFO' }, 500);
  }
}

/**
 * POST /api/dropship-orders/build-payload/:orderId/:supplierId — assemble le
 * payload supplier (shape API supplier-flat V1) via buildDropshipPayload().
 *
 * Câble : buildDropshipPayload.
 *
 * Retourne le JSON exact qui serait POST vers supplier.api_endpoint (Phase B
 * câblera l'appel réseau réel). Utile pour preview UI client + tests.
 */
export async function handleBuildDropshipPayloadForOrder(
  env: Env,
  auth: WarehouseDropshipAuth,
  orderId: string,
  supplierId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!orderId) return json({ error: 'order_id requis' }, 400);
    if (!supplierId) return json({ error: 'supplier_id requis' }, 400);

    // Bornage tenant : supplier doit appartenir au client.
    const supplier = await loadSupplier(env, supplierId, clientId);
    if (!supplier) {
      return json(
        {
          error: `Supplier introuvable (${WAREHOUSE_ERROR_CODES.SUPPLIER_NOT_FOUND})`,
        },
        404,
      );
    }

    // Lecture order tenant-scopé.
    let order: Record<string, unknown> | null = null;
    try {
      order = (await env.DB.prepare(
        `SELECT * FROM orders WHERE id = ? AND client_id = ?`,
      )
        .bind(orderId, clientId)
        .first()) as Record<string, unknown> | null;
    } catch {
      order = null;
    }
    if (!order) return json({ error: 'Order introuvable' }, 404);

    // Lecture items + lookup supplier_sku via dropship_routings.
    let items: Array<{ sku?: string; quantity?: number; cost_cents?: number }> = [];
    try {
      const res = await env.DB.prepare(
        `SELECT oi.variant_id, oi.quantity,
                pv.sku AS variant_sku,
                dr.supplier_sku, dr.cost_cents
           FROM order_items oi
           LEFT JOIN product_variants pv ON pv.id = oi.variant_id
           LEFT JOIN dropship_routings dr
             ON dr.variant_id = oi.variant_id
            AND dr.client_id = ?
            AND dr.supplier_id = ?
          WHERE oi.order_id = ?`,
      )
        .bind(clientId, supplierId, orderId)
        .all();
      const rows = (res?.results ?? []) as unknown as Array<{
        variant_id: string;
        quantity: number;
        variant_sku: string | null;
        supplier_sku: string | null;
        cost_cents: number | null;
      }>;
      items = rows
        .filter((r) => r.supplier_sku || r.variant_sku)
        .map((r) => ({
          sku: r.supplier_sku ?? r.variant_sku ?? '',
          quantity: r.quantity ?? 0,
          cost_cents: r.cost_cents ?? undefined,
        }));
    } catch {
      items = [];
    }

    const payload = buildDropshipPayload(
      order as Parameters<typeof buildDropshipPayload>[0],
      { id: supplierId },
      items,
    );

    return json({ data: payload });
  } catch {
    return json({ error: 'Erreur build dropship payload' }, 500);
  }
}

// NB : 19 handlers exposés (5 warehouses + 3 transfers + 5 suppliers + 4 routings
// + 2 dropship_orders) + 4 handlers additifs renforcement (handleListWarehouseInventory,
// handleGetReorderSuggestions, handleAllocateOrderFifo, handleBuildDropshipPayloadForOrder).
// Phase B : 14 stubs remplis + 4 lecteurs safe (list*) + 1
// routing dispatcher (routeOrderToSupplier). Toutes signatures FIGÉES Phase A.
// Gardes capability appliquées AU TOP de chaque handler (clients.manage /
// settings.manage). Bornage tenant via auth.clientId partout. api_key_encrypted
// via TOKEN_KEY AES-GCM (encryptToken import migration-ghl-oauth) — jamais
// retourné en clair en GET. Erreurs sans champ `code` (contrat figé §6).
// Choix figés docs/LOT-WAREHOUSE-DROPSHIP-S47.md §6.
