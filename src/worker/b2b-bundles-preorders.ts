// ── Sprint 48 — b2b-bundles-preorders.ts — Handlers REST B2B + bundles + pre-orders
//
// 22 handlers AUTHED (cap clients.manage) + 1 PUBLIC (POST /api/public/preorders).
// Phase B (Sprint 48) : tous les handlers sont fonctionnels — CRUD complet
// customer_groups + assignments + tier_prices + product_bundles + bundle_items
// + preorders (notify/cancel/convert). Bornage tenant strict (WHERE
// client_id = ?) + cap clients.manage + audit best-effort sur toutes les
// mutations.
//
// Routes câblées dans `src/worker.ts` (Phase A, ordre anti-shadowing :
// suffixes /:id/<action> AVANT /:id générique).
//
// ⚠ DISTINCT de `ecommerce-*.ts` (Sprint E1+) — module NEUF qui ÉTEND le
//   pipeline e-commerce sans toucher aux handlers/order existants. Tables
//   additives seq143 (customer_groups + customer_group_assignments +
//   tier_prices + product_bundles + bundle_items + preorder_queue).
//
// Contrats GELÉS (docs/LOT-B2B-BUNDLES-PREORDERS-S48.md §6) :
//   - succès : json({ data })
//   - erreur : json({ error }, status)   — champ optionnel `code` autorisé
//     uniquement pour PRICING_ERROR_CODES (Sprint 48 renforcement wire-up).
//   - imports RELATIFS uniquement (`./types`, `./capabilities`, `./helpers`,
//                                  `./lib/pricing-engine`, `./lib/rate-limit`)
//   - capabilities FIGÉES :
//       * clients.manage : groups CRUD + assign, tier_prices CRUD + resolve,
//                          bundles CRUD + items, preorders list + notify +
//                          cancel + convert
//       * PUBLIC : POST /api/public/preorders (visitor join — rate-limit +
//                  honeypot champ `website`)
//     AUCUN ajout à ALL_CAPABILITIES seq 80.
//
// Bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR).
// Garde capability au top de chaque handler authed.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit } from './helpers';
import { checkRateLimit } from './lib/rate-limit';
import {
  resolveTierPrice,
  processPreorderNotification,
  // ── Sprint 48 renforcement — helpers PURE additifs (wire-up handlers) ──
  computeBundlePrice,
  computePreorderDeposit,
  isCurrencySupported,
  validatePricingInput,
  PRICING_ERROR_CODES,
  type BundlePriceItem,
} from './lib/pricing-engine';

/** Auth enrichi au choke-point worker.ts (calque warehouse-dropship.ts). */
export type B2bBundlesPreordersAuth = CapAuth & { capabilities?: Set<string> };

// ── Gardes capability ─────────────────────────────────────────────────────

/** Cap `clients.manage` (groups / tiers / bundles / preorders). */
function clientsCapGuard(auth: B2bBundlesPreordersAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'clients.manage');
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

/** Best-effort audit log (calque warehouse-dropship). */
async function logAudit(
  env: Env,
  auth: B2bBundlesPreordersAuth,
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

/** UUID hex 32 (calque warehouse-dropship newId). */
function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Récupère client_id tenant — null si introuvable (auth context). */
function clientIdOf(auth: B2bBundlesPreordersAuth): string | null {
  return auth.clientId ?? null;
}

/** Lit une ligne customer_groups bornée tenant. */
async function loadCustomerGroup(
  env: Env,
  groupId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM customer_groups WHERE id = ? AND client_id = ?`,
    )
      .bind(groupId, clientId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/** Lit une ligne tier_prices bornée tenant. */
async function loadTierPrice(
  env: Env,
  tierId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM tier_prices WHERE id = ? AND client_id = ?`,
    )
      .bind(tierId, clientId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/** Lit une ligne product_bundles bornée tenant. */
async function loadBundle(
  env: Env,
  bundleId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM product_bundles WHERE id = ? AND client_id = ?`,
    )
      .bind(bundleId, clientId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/**
 * Lit une ligne bundle_items bornée tenant via JOIN product_bundles
 * (defense-in-depth IDOR — bundle_items n'a pas de client_id direct).
 */
async function loadBundleItem(
  env: Env,
  itemId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT i.*
       FROM bundle_items i
       INNER JOIN product_bundles b ON b.id = i.bundle_id
       WHERE i.id = ? AND b.client_id = ?`,
    )
      .bind(itemId, clientId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/** Lit une ligne preorder_queue bornée tenant. */
async function loadPreorder(
  env: Env,
  preorderId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM preorder_queue WHERE id = ? AND client_id = ?`,
    )
      .bind(preorderId, clientId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Customer Groups CRUD + assignments (7)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/customer-groups — liste groups tenant (cap clients.manage). */
export async function handleListCustomerGroups(
  env: Env,
  auth: B2bBundlesPreordersAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ data: [] });
    const res = await env.DB.prepare(
      `SELECT * FROM customer_groups WHERE client_id = ?
       ORDER BY is_active DESC, name ASC`,
    )
      .bind(clientId)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/** POST /api/customer-groups — créer group (cap clients.manage). */
export async function handleCreateCustomerGroup(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);

    const body = await readJsonBody(request);
    const name =
      typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    if (!name) return json({ error: 'name requis' }, 400);

    const slug =
      typeof body.slug === 'string' ? body.slug.trim().slice(0, 200) : null;
    const description =
      typeof body.description === 'string'
        ? body.description.slice(0, 1000)
        : null;

    // Validation default_discount_pct : clamp [0..100].
    const discountRaw = body.default_discount_pct;
    let defaultDiscountPct = 0;
    if (discountRaw !== undefined && discountRaw !== null) {
      const n = Number(discountRaw);
      if (!Number.isFinite(n)) {
        return json({ error: 'default_discount_pct invalide' }, 400);
      }
      if (n < 0 || n > 100) {
        return json({ error: 'default_discount_pct doit être entre 0 et 100' }, 400);
      }
      defaultDiscountPct = n;
    }

    const isActive =
      body.is_active === false || body.is_active === 0 ? 0 : 1;

    const id = newId();

    try {
      await env.DB.prepare(
        `INSERT INTO customer_groups
           (id, client_id, name, slug, description, default_discount_pct, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, clientId, name, slug, description, defaultDiscountPct, isActive)
        .run();
    } catch {
      return json({ error: 'Création group échouée' }, 500);
    }

    await logAudit(env, auth, 'customer_group.create', 'customer_group', id, {
      name,
      default_discount_pct: defaultDiscountPct,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        name,
        slug,
        description,
        default_discount_pct: defaultDiscountPct,
        is_active: isActive,
      },
    });
  } catch {
    return json({ error: 'Erreur création group' }, 500);
  }
}

/** PATCH /api/customer-groups/:id — mise à jour group (cap clients.manage). */
export async function handleUpdateCustomerGroup(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
  groupId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!groupId) return json({ error: 'group_id requis' }, 400);

    const existing = await loadCustomerGroup(env, groupId, clientId);
    if (!existing) return json({ error: 'Group introuvable' }, 404);

    const body = await readJsonBody(request);
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 200);
      if (!name) return json({ error: 'name invalide' }, 400);
      sets.push('name = ?');
      binds.push(name);
    }
    if (typeof body.slug === 'string' || body.slug === null) {
      sets.push('slug = ?');
      binds.push(
        typeof body.slug === 'string' ? body.slug.trim().slice(0, 200) : null,
      );
    }
    if (typeof body.description === 'string' || body.description === null) {
      sets.push('description = ?');
      binds.push(
        typeof body.description === 'string'
          ? body.description.slice(0, 1000)
          : null,
      );
    }
    if (body.default_discount_pct !== undefined && body.default_discount_pct !== null) {
      const n = Number(body.default_discount_pct);
      if (!Number.isFinite(n)) {
        return json({ error: 'default_discount_pct invalide' }, 400);
      }
      if (n < 0 || n > 100) {
        return json({ error: 'default_discount_pct doit être entre 0 et 100' }, 400);
      }
      sets.push('default_discount_pct = ?');
      binds.push(n);
    }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?');
      binds.push(body.is_active === false || body.is_active === 0 ? 0 : 1);
    }

    if (sets.length === 0) {
      return json({ data: existing });
    }

    sets.push("updated_at = datetime('now')");
    binds.push(groupId, clientId);

    try {
      await env.DB.prepare(
        `UPDATE customer_groups SET ${sets.join(', ')}
         WHERE id = ? AND client_id = ?`,
      )
        .bind(...binds)
        .run();
    } catch {
      return json({ error: 'Mise à jour group échouée' }, 500);
    }

    await logAudit(env, auth, 'customer_group.update', 'customer_group', groupId, {
      fields: sets.length - 1,
    });

    const updated = await loadCustomerGroup(env, groupId, clientId);
    return json({ data: updated ?? { id: groupId } });
  } catch {
    return json({ error: 'Erreur mise à jour group' }, 500);
  }
}

/** DELETE /api/customer-groups/:id — soft-delete group (cap clients.manage). */
export async function handleDeleteCustomerGroup(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  groupId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!groupId) return json({ error: 'group_id requis' }, 400);

    const existing = await loadCustomerGroup(env, groupId, clientId);
    if (!existing) return json({ error: 'Group introuvable' }, 404);

    try {
      await env.DB.prepare(
        `UPDATE customer_groups
            SET is_active = 0, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
        .bind(groupId, clientId)
        .run();
    } catch {
      return json({ error: 'Suppression group échouée' }, 500);
    }

    await logAudit(env, auth, 'customer_group.delete', 'customer_group', groupId, {
      soft: true,
    });

    return json({ data: { id: groupId, is_active: 0 } });
  } catch {
    return json({ error: 'Erreur suppression group' }, 500);
  }
}

/** POST /api/customer-groups/:id/assign — assigner customer au group (cap clients.manage). */
export async function handleAssignCustomerToGroup(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
  groupId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!groupId) return json({ error: 'group_id requis' }, 400);

    // Bornage tenant : le group doit appartenir au client.
    const existing = await loadCustomerGroup(env, groupId, clientId);
    if (!existing) return json({ error: 'Group introuvable' }, 404);

    const body = await readJsonBody(request);
    const customerId =
      typeof body.customer_id === 'string' ? body.customer_id.trim() : '';
    if (!customerId) return json({ error: 'customer_id requis' }, 400);

    const expiresAt =
      typeof body.expires_at === 'string' && body.expires_at.trim().length > 0
        ? body.expires_at.trim().slice(0, 40)
        : null;

    const id = newId();

    try {
      // INSERT OR IGNORE pour respecter UNIQUE(group_id, customer_id) sans
      // throw — l'idempotence côté caller est garantie.
      await env.DB.prepare(
        `INSERT OR IGNORE INTO customer_group_assignments
           (id, group_id, customer_id, client_id, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(id, groupId, customerId, clientId, expiresAt)
        .run();
    } catch {
      return json({ error: 'Assignation customer échouée' }, 500);
    }

    await logAudit(
      env,
      auth,
      'customer_group.assign',
      'customer_group_assignment',
      groupId,
      { customer_id: customerId, expires_at: expiresAt },
    );

    return json({
      data: {
        id,
        group_id: groupId,
        customer_id: customerId,
        client_id: clientId,
        expires_at: expiresAt,
      },
    });
  } catch {
    return json({ error: 'Erreur assignation customer' }, 500);
  }
}

/** POST /api/customer-groups/:id/remove — retirer customer du group (cap clients.manage). */
export async function handleRemoveCustomerFromGroup(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
  groupId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!groupId) return json({ error: 'group_id requis' }, 400);

    const existing = await loadCustomerGroup(env, groupId, clientId);
    if (!existing) return json({ error: 'Group introuvable' }, 404);

    const body = await readJsonBody(request);
    const customerId =
      typeof body.customer_id === 'string' ? body.customer_id.trim() : '';
    if (!customerId) return json({ error: 'customer_id requis' }, 400);

    try {
      await env.DB.prepare(
        `DELETE FROM customer_group_assignments
          WHERE group_id = ? AND customer_id = ? AND client_id = ?`,
      )
        .bind(groupId, customerId, clientId)
        .run();
    } catch {
      return json({ error: 'Retrait customer échoué' }, 500);
    }

    await logAudit(
      env,
      auth,
      'customer_group.remove',
      'customer_group_assignment',
      groupId,
      { customer_id: customerId },
    );

    return json({
      data: { group_id: groupId, customer_id: customerId, removed: true },
    });
  } catch {
    return json({ error: 'Erreur retrait customer' }, 500);
  }
}

/** GET /api/customers/:id/groups — liste groups d'un customer (cap clients.manage). */
export async function handleGetCustomerGroups(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  customerId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId || !customerId) return json({ data: [] });
    const res = await env.DB.prepare(
      `SELECT g.*
       FROM customer_groups g
       INNER JOIN customer_group_assignments a ON a.group_id = g.id
       WHERE a.customer_id = ?
         AND a.client_id = ?
         AND (a.expires_at IS NULL OR a.expires_at > datetime('now'))`,
    )
      .bind(customerId, clientId)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Tier Prices CRUD + resolve (5)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/tier-prices — liste tier_prices tenant (cap clients.manage). */
export async function handleListTierPrices(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  variantId: string | null,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ data: [] });
    let res;
    if (variantId) {
      res = await env.DB.prepare(
        `SELECT * FROM tier_prices
         WHERE client_id = ? AND product_variant_id = ?
         ORDER BY group_id ASC, min_quantity ASC`,
      )
        .bind(clientId, variantId)
        .all();
    } else {
      res = await env.DB.prepare(
        `SELECT * FROM tier_prices WHERE client_id = ?
         ORDER BY product_variant_id ASC, group_id ASC, min_quantity ASC
         LIMIT 500`,
      )
        .bind(clientId)
        .all();
    }
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/** POST /api/tier-prices — créer tier (cap clients.manage). */
export async function handleCreateTierPrice(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);

    const body = await readJsonBody(request);
    const variantId =
      typeof body.product_variant_id === 'string'
        ? body.product_variant_id.trim()
        : '';
    const groupId =
      typeof body.group_id === 'string' ? body.group_id.trim() : '';
    if (!variantId) return json({ error: 'product_variant_id requis' }, 400);
    if (!groupId) return json({ error: 'group_id requis' }, 400);

    // Validation price_cents >= 0.
    const priceRaw = body.price_cents;
    if (priceRaw === undefined || priceRaw === null) {
      return json({ error: 'price_cents requis' }, 400);
    }
    const priceCents = Math.round(Number(priceRaw));
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      return json({ error: 'price_cents doit être >= 0' }, 400);
    }

    // Validation min_quantity > 0 (default 1).
    const minQtyRaw = body.min_quantity;
    let minQuantity = 1;
    if (minQtyRaw !== undefined && minQtyRaw !== null) {
      minQuantity = Math.round(Number(minQtyRaw));
      if (!Number.isFinite(minQuantity) || minQuantity <= 0) {
        return json({ error: 'min_quantity doit être > 0' }, 400);
      }
    }

    // Bornage tenant : group doit appartenir au client.
    const group = await loadCustomerGroup(env, groupId, clientId);
    if (!group) return json({ error: 'Group introuvable' }, 404);

    const id = newId();

    try {
      await env.DB.prepare(
        `INSERT INTO tier_prices
           (id, product_variant_id, group_id, client_id, price_cents, min_quantity)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, variantId, groupId, clientId, priceCents, minQuantity)
        .run();
    } catch {
      return json({ error: 'Création tier price échouée' }, 500);
    }

    await logAudit(env, auth, 'tier_price.create', 'tier_price', id, {
      product_variant_id: variantId,
      group_id: groupId,
      price_cents: priceCents,
      min_quantity: minQuantity,
    });

    return json({
      data: {
        id,
        product_variant_id: variantId,
        group_id: groupId,
        client_id: clientId,
        price_cents: priceCents,
        min_quantity: minQuantity,
      },
    });
  } catch {
    return json({ error: 'Erreur création tier price' }, 500);
  }
}

/** PATCH /api/tier-prices/:id — mise à jour tier (cap clients.manage). */
export async function handleUpdateTierPrice(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
  tierId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!tierId) return json({ error: 'tier_id requis' }, 400);

    const existing = await loadTierPrice(env, tierId, clientId);
    if (!existing) return json({ error: 'Tier price introuvable' }, 404);

    const body = await readJsonBody(request);
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (body.price_cents !== undefined && body.price_cents !== null) {
      const n = Math.round(Number(body.price_cents));
      if (!Number.isFinite(n) || n < 0) {
        return json({ error: 'price_cents doit être >= 0' }, 400);
      }
      sets.push('price_cents = ?');
      binds.push(n);
    }
    if (body.min_quantity !== undefined && body.min_quantity !== null) {
      const n = Math.round(Number(body.min_quantity));
      if (!Number.isFinite(n) || n <= 0) {
        return json({ error: 'min_quantity doit être > 0' }, 400);
      }
      sets.push('min_quantity = ?');
      binds.push(n);
    }

    if (sets.length === 0) {
      return json({ data: existing });
    }

    sets.push("updated_at = datetime('now')");
    binds.push(tierId, clientId);

    try {
      await env.DB.prepare(
        `UPDATE tier_prices SET ${sets.join(', ')}
         WHERE id = ? AND client_id = ?`,
      )
        .bind(...binds)
        .run();
    } catch {
      return json({ error: 'Mise à jour tier price échouée' }, 500);
    }

    await logAudit(env, auth, 'tier_price.update', 'tier_price', tierId, {
      fields: sets.length - 1,
    });

    const updated = await loadTierPrice(env, tierId, clientId);
    return json({ data: updated ?? { id: tierId } });
  } catch {
    return json({ error: 'Erreur mise à jour tier price' }, 500);
  }
}

/** DELETE /api/tier-prices/:id — supprimer tier (cap clients.manage). */
export async function handleDeleteTierPrice(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  tierId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!tierId) return json({ error: 'tier_id requis' }, 400);

    const existing = await loadTierPrice(env, tierId, clientId);
    if (!existing) return json({ error: 'Tier price introuvable' }, 404);

    try {
      await env.DB.prepare(
        `DELETE FROM tier_prices WHERE id = ? AND client_id = ?`,
      )
        .bind(tierId, clientId)
        .run();
    } catch {
      return json({ error: 'Suppression tier price échouée' }, 500);
    }

    await logAudit(env, auth, 'tier_price.delete', 'tier_price', tierId, {});

    return json({ data: { id: tierId, deleted: true } });
  } catch {
    return json({ error: 'Erreur suppression tier price' }, 500);
  }
}

/**
 * GET /api/tier-prices/resolve?variant_id=&customer_id=&quantity=
 * Résout le prix applicable via pricing-engine.resolveTierPrice. Fonctionnel
 * en Phase A (le moteur est déjà câblé). Cap clients.manage.
 */
export async function handleResolveTierPrice(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  url: URL,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const variantId = url.searchParams.get('variant_id') ?? '';
    const customerId = url.searchParams.get('customer_id') ?? '';
    const quantityRaw = url.searchParams.get('quantity') ?? '1';
    const quantity = Math.max(1, Math.round(Number(quantityRaw) || 1));
    if (!variantId) {
      return json({ error: 'variant_id requis' }, 400);
    }
    const result = await resolveTierPrice(env, variantId, customerId, quantity);
    return json({ data: result });
  } catch {
    return json({ error: 'Erreur resolve tier price' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Product Bundles CRUD + items (7)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/product-bundles — liste bundles tenant (cap clients.manage). */
export async function handleListProductBundles(
  env: Env,
  auth: B2bBundlesPreordersAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ data: [] });
    const res = await env.DB.prepare(
      `SELECT * FROM product_bundles WHERE client_id = ?
       ORDER BY is_active DESC, created_at DESC LIMIT 200`,
    )
      .bind(clientId)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/** POST /api/product-bundles — créer bundle (cap clients.manage). */
export async function handleCreateBundle(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);

    const body = await readJsonBody(request);
    const name =
      typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    if (!name) return json({ error: 'name requis' }, 400);

    const description =
      typeof body.description === 'string'
        ? body.description.slice(0, 1000)
        : null;

    // Validation total_price_cents : optionnel, doit être >= 0 si fourni.
    let totalPriceCents: number | null = null;
    if (body.total_price_cents !== undefined && body.total_price_cents !== null) {
      const n = Math.round(Number(body.total_price_cents));
      if (!Number.isFinite(n) || n < 0) {
        return json({ error: 'total_price_cents doit être >= 0' }, 400);
      }
      totalPriceCents = n;
    }

    // Validation discount_pct : optionnel, [0..100].
    let discountPct = 0;
    if (body.discount_pct !== undefined && body.discount_pct !== null) {
      const n = Number(body.discount_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return json({ error: 'discount_pct doit être entre 0 et 100' }, 400);
      }
      discountPct = n;
    }

    // ── Wire-up pricing-engine (Sprint 48 renforcement) ────────────────────
    // Currency optionnel — devise locked 'CAD' V1 mais accepte override + ISO
    // 4217 whitelist via isCurrencySupported. validatePricingInput borne
    // discount à MAX_DISCOUNT_PCT (80%) — code erreur déterministe.
    const currency =
      typeof body.currency === 'string' ? body.currency.toUpperCase() : 'CAD';
    if (body.currency !== undefined && !isCurrencySupported(currency)) {
      return json(
        { error: `currency '${currency}' non supportée`, code: PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED },
        400,
      );
    }
    const validation = validatePricingInput({
      qty: 1,
      currency,
      discountPct: discountPct,
    });
    if (!validation.ok) {
      const status = validation.error === PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED ? 400 : 400;
      return json(
        {
          error: validation.message ?? 'Pricing input invalide',
          code: validation.error,
        },
        status,
      );
    }

    // Si items[] fourni dans le body, calcule net_price_cents preview via
    // computeBundlePrice (override total_price_cents > discount_pct si présent).
    // Pas de persistance — les items sont stockés via handleAddBundleItem.
    let netPriceCents = totalPriceCents;
    if (Array.isArray(body.items) && body.items.length > 0) {
      const items: BundlePriceItem[] = (body.items as Array<Record<string, unknown>>)
        .map((it) => ({
          unit_price_cents: Math.max(0, Math.round(Number(it?.unit_price_cents) || 0)),
          quantity: Math.max(0, Math.round(Number(it?.quantity) || 0)),
        }));
      const priced = computeBundlePrice(items, totalPriceCents, discountPct);
      netPriceCents = priced.net;
    }

    const isActive =
      body.is_active === false || body.is_active === 0 ? 0 : 1;

    const id = newId();

    try {
      await env.DB.prepare(
        `INSERT INTO product_bundles
           (id, client_id, name, description, total_price_cents, discount_pct, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          clientId,
          name,
          description,
          totalPriceCents,
          discountPct,
          isActive,
        )
        .run();
    } catch {
      return json({ error: 'Création bundle échouée' }, 500);
    }

    await logAudit(env, auth, 'bundle.create', 'product_bundle', id, {
      name,
      total_price_cents: totalPriceCents,
      net_price_cents: netPriceCents,
      currency,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        name,
        description,
        total_price_cents: totalPriceCents,
        net_price_cents: netPriceCents,
        discount_pct: discountPct,
        currency,
        is_active: isActive,
      },
    });
  } catch {
    return json({ error: 'Erreur création bundle' }, 500);
  }
}

/** GET /api/product-bundles/:id — détail bundle (cap clients.manage). */
export async function handleGetBundle(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  bundleId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId || !bundleId) return json({ error: 'Paramètres manquants' }, 400);
    const row = await env.DB.prepare(
      `SELECT * FROM product_bundles WHERE id = ? AND client_id = ?`,
    )
      .bind(bundleId, clientId)
      .first();
    if (!row) return json({ error: 'Bundle introuvable' }, 404);
    return json({ data: row });
  } catch {
    return json({ error: 'Erreur lecture bundle' }, 500);
  }
}

/** PATCH /api/product-bundles/:id — mise à jour bundle (cap clients.manage). */
export async function handleUpdateBundle(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
  bundleId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!bundleId) return json({ error: 'bundle_id requis' }, 400);

    const existing = await loadBundle(env, bundleId, clientId);
    if (!existing) return json({ error: 'Bundle introuvable' }, 404);

    const body = await readJsonBody(request);
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 200);
      if (!name) return json({ error: 'name invalide' }, 400);
      sets.push('name = ?');
      binds.push(name);
    }
    if (typeof body.description === 'string' || body.description === null) {
      sets.push('description = ?');
      binds.push(
        typeof body.description === 'string'
          ? body.description.slice(0, 1000)
          : null,
      );
    }
    if (body.total_price_cents !== undefined) {
      if (body.total_price_cents === null) {
        sets.push('total_price_cents = ?');
        binds.push(null);
      } else {
        const n = Math.round(Number(body.total_price_cents));
        if (!Number.isFinite(n) || n < 0) {
          return json({ error: 'total_price_cents doit être >= 0' }, 400);
        }
        sets.push('total_price_cents = ?');
        binds.push(n);
      }
    }
    if (body.discount_pct !== undefined && body.discount_pct !== null) {
      const n = Number(body.discount_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return json({ error: 'discount_pct doit être entre 0 et 100' }, 400);
      }
      // ── Wire-up validatePricingInput (Sprint 48 renforcement) ──
      // Borne au MAX_DISCOUNT_PCT (80%) pour cohérence cross-API.
      const currency =
        typeof body.currency === 'string' ? body.currency.toUpperCase() : 'CAD';
      if (body.currency !== undefined && !isCurrencySupported(currency)) {
        return json(
          {
            error: `currency '${currency}' non supportée`,
            code: PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED,
          },
          400,
        );
      }
      const validation = validatePricingInput({ qty: 1, currency, discountPct: n });
      if (!validation.ok) {
        return json(
          {
            error: validation.message ?? 'Pricing input invalide',
            code: validation.error,
          },
          400,
        );
      }
      sets.push('discount_pct = ?');
      binds.push(n);
    }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?');
      binds.push(body.is_active === false || body.is_active === 0 ? 0 : 1);
    }

    if (sets.length === 0) {
      return json({ data: existing });
    }

    sets.push("updated_at = datetime('now')");
    binds.push(bundleId, clientId);

    try {
      await env.DB.prepare(
        `UPDATE product_bundles SET ${sets.join(', ')}
         WHERE id = ? AND client_id = ?`,
      )
        .bind(...binds)
        .run();
    } catch {
      return json({ error: 'Mise à jour bundle échouée' }, 500);
    }

    await logAudit(env, auth, 'bundle.update', 'product_bundle', bundleId, {
      fields: sets.length - 1,
    });

    const updated = await loadBundle(env, bundleId, clientId);
    return json({ data: updated ?? { id: bundleId } });
  } catch {
    return json({ error: 'Erreur mise à jour bundle' }, 500);
  }
}

/** DELETE /api/product-bundles/:id — soft-delete bundle (cap clients.manage). */
export async function handleDeleteBundle(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  bundleId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!bundleId) return json({ error: 'bundle_id requis' }, 400);

    const existing = await loadBundle(env, bundleId, clientId);
    if (!existing) return json({ error: 'Bundle introuvable' }, 404);

    try {
      await env.DB.prepare(
        `UPDATE product_bundles
            SET is_active = 0, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
        .bind(bundleId, clientId)
        .run();
    } catch {
      return json({ error: 'Suppression bundle échouée' }, 500);
    }

    await logAudit(env, auth, 'bundle.delete', 'product_bundle', bundleId, {
      soft: true,
    });

    return json({ data: { id: bundleId, is_active: 0 } });
  } catch {
    return json({ error: 'Erreur suppression bundle' }, 500);
  }
}

/** GET /api/product-bundles/:id/items — liste items d'un bundle (cap clients.manage). */
export async function handleListBundleItems(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  bundleId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId || !bundleId) return json({ data: [] });
    // Bornage tenant via JOIN product_bundles (defense-in-depth IDOR).
    const res = await env.DB.prepare(
      `SELECT i.*
       FROM bundle_items i
       INNER JOIN product_bundles b ON b.id = i.bundle_id
       WHERE i.bundle_id = ? AND b.client_id = ?
       ORDER BY i.created_at ASC`,
    )
      .bind(bundleId, clientId)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/** POST /api/product-bundles/:id/items — ajouter item au bundle (cap clients.manage). */
export async function handleAddBundleItem(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
  bundleId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!bundleId) return json({ error: 'bundle_id requis' }, 400);

    // Bornage tenant : bundle doit appartenir au client.
    const bundle = await loadBundle(env, bundleId, clientId);
    if (!bundle) return json({ error: 'Bundle introuvable' }, 404);

    const body = await readJsonBody(request);
    const variantId =
      typeof body.product_variant_id === 'string'
        ? body.product_variant_id.trim()
        : '';
    if (!variantId) return json({ error: 'product_variant_id requis' }, 400);

    let quantity = 1;
    if (body.quantity !== undefined && body.quantity !== null) {
      const n = Math.round(Number(body.quantity));
      if (!Number.isFinite(n) || n <= 0) {
        return json({ error: 'quantity doit être > 0' }, 400);
      }
      quantity = n;
    }

    const id = newId();

    try {
      await env.DB.prepare(
        `INSERT INTO bundle_items
           (id, bundle_id, product_variant_id, quantity)
         VALUES (?, ?, ?, ?)`,
      )
        .bind(id, bundleId, variantId, quantity)
        .run();
    } catch {
      return json({ error: 'Ajout bundle item échoué' }, 500);
    }

    await logAudit(env, auth, 'bundle_item.add', 'bundle_item', id, {
      bundle_id: bundleId,
      product_variant_id: variantId,
      quantity,
    });

    return json({
      data: {
        id,
        bundle_id: bundleId,
        product_variant_id: variantId,
        quantity,
      },
    });
  } catch {
    return json({ error: 'Erreur ajout bundle item' }, 500);
  }
}

/** DELETE /api/bundle-items/:id — supprimer un item d'un bundle (cap clients.manage). */
export async function handleRemoveBundleItem(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  itemId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!itemId) return json({ error: 'item_id requis' }, 400);

    // Bornage tenant via JOIN product_bundles (bundle_items n'a pas de client_id).
    const existing = await loadBundleItem(env, itemId, clientId);
    if (!existing) return json({ error: 'Bundle item introuvable' }, 404);

    try {
      // DELETE bornage via sous-requête JOIN client_id (defense-in-depth IDOR).
      await env.DB.prepare(
        `DELETE FROM bundle_items
          WHERE id = ?
            AND bundle_id IN (
              SELECT id FROM product_bundles WHERE client_id = ?
            )`,
      )
        .bind(itemId, clientId)
        .run();
    } catch {
      return json({ error: 'Suppression bundle item échouée' }, 500);
    }

    await logAudit(env, auth, 'bundle_item.remove', 'bundle_item', itemId, {});

    return json({ data: { id: itemId, deleted: true } });
  } catch {
    return json({ error: 'Erreur suppression bundle item' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Pre-orders (1 PUBLIC + 4 AUTHED)
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/public/preorders — PUBLIC visitor join waitlist.
 *
 * Phase A : fonctionnel minimal. Rate-limit bucket `preorder_join:<ip>` max
 * 5/300s (calque /api/public/tickets) + honeypot champ `website` doit être
 * vide. Body : `{ variant_id, email, quantity? }`. Insert preorder_queue
 * status='queued'. Le client_id est résolu via lookup product_variants → products.
 *
 * AUCUNE auth — pré-requireAuth. PAS de throw.
 */
export async function handlePublicCreatePreorder(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Rate-limit IP (calque /api/public/tickets).
    const ip =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const rl = await checkRateLimit(env, `preorder_join:${ip}`, 5, 300);
    if (!rl.allowed) {
      return json(
        { error: 'Trop de requêtes, réessayez plus tard' },
        429,
      );
    }

    const body = await readJsonBody(request);

    // Honeypot — visiteur humain ne le remplit pas. Si rempli ⇒ bot, on retourne
    // 200 silencieux (anti-fingerprint : ne pas révéler le piège).
    const honeypot = typeof body.website === 'string' ? body.website.trim() : '';
    if (honeypot.length > 0) {
      return json({ data: { id: 'bot', status: 'cancelled' } });
    }

    const variantId =
      typeof body.variant_id === 'string' ? body.variant_id.trim() : '';
    const email =
      typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';
    const quantityRaw = body.quantity;
    const quantity =
      typeof quantityRaw === 'number'
        ? Math.max(1, Math.round(quantityRaw))
        : Math.max(1, Math.round(Number(quantityRaw) || 1));

    if (!variantId) return json({ error: 'variant_id requis' }, 400);
    if (!email || !email.includes('@')) {
      return json({ error: 'email invalide' }, 400);
    }

    // ── Wire-up pricing-engine (Sprint 48 renforcement) ────────────────────
    // Currency optionnel — devise locked 'CAD' V1 mais accepte override + ISO
    // 4217 whitelist. deposit_pct optionnel (defaults DEFAULT_DEPOSIT_PCT=20%).
    const currency =
      typeof body.currency === 'string' ? body.currency.toUpperCase() : 'CAD';
    if (body.currency !== undefined && !isCurrencySupported(currency)) {
      return json(
        {
          error: `currency '${currency}' non supportée`,
          code: PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED,
        },
        400,
      );
    }
    // depositPct optionnel — borné [0..100] par validatePricingInput.
    let depositPct: number | undefined;
    if (body.deposit_pct !== undefined && body.deposit_pct !== null) {
      const n = Number(body.deposit_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return json(
          { error: 'deposit_pct doit être entre 0 et 100', code: PRICING_ERROR_CODES.DEPOSIT_INVALID },
          400,
        );
      }
      depositPct = n;
    }

    // Résolution client_id via variant → product → client_id.
    // Best-effort : si pas résolu ⇒ 404 (variant introuvable).
    // Lit aussi v.price_cents pour computePreorderDeposit preview.
    let clientId: string | null = null;
    let variantPriceCents = 0;
    try {
      const variantRow = (await env.DB.prepare(
        `SELECT p.client_id AS client_id, v.price_cents AS price_cents
         FROM product_variants v
         INNER JOIN products p ON p.id = v.product_id
         WHERE v.id = ?`,
      )
        .bind(variantId)
        .first()) as { client_id?: string; price_cents?: number } | null;
      clientId = variantRow?.client_id ?? null;
      variantPriceCents = Math.max(0, Math.round(Number(variantRow?.price_cents ?? 0)));
    } catch {
      /* best-effort */
    }

    if (!clientId) {
      return json({ error: 'Variant introuvable' }, 404);
    }

    const id = crypto.randomUUID().replace(/-/g, '');

    try {
      await env.DB.prepare(
        `INSERT INTO preorder_queue
           (id, variant_id, customer_id, client_id, quantity, email, status)
         VALUES (?, ?, '', ?, ?, ?, 'queued')`,
      )
        .bind(id, variantId, clientId, quantity, email)
        .run();
    } catch {
      return json({ error: 'Création preorder échouée' }, 500);
    }

    // ── computePreorderDeposit (Sprint 48 renforcement) ──
    // Preview deposit/balance pour le client (sum invariant garanti).
    const totalCents = variantPriceCents * quantity;
    const { deposit, balance } = computePreorderDeposit(totalCents, depositPct);

    return json({
      data: {
        id,
        status: 'queued',
        currency,
        total_cents: totalCents,
        deposit_cents: deposit,
        balance_cents: balance,
      },
    });
  } catch {
    return json({ error: 'Erreur création preorder' }, 500);
  }
}

/** GET /api/preorders — liste preorders tenant (cap clients.manage). */
export async function handleListPreorders(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  url: URL,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ data: [] });

    const variantId = url.searchParams.get('variant_id');
    const customerId = url.searchParams.get('customer_id');
    const status = url.searchParams.get('status');

    const where: string[] = ['client_id = ?'];
    const binds: unknown[] = [clientId];
    if (variantId) {
      where.push('variant_id = ?');
      binds.push(variantId);
    }
    if (customerId) {
      where.push('customer_id = ?');
      binds.push(customerId);
    }
    if (status) {
      where.push('status = ?');
      binds.push(status);
    }

    const res = await env.DB.prepare(
      `SELECT * FROM preorder_queue
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT 300`,
    )
      .bind(...binds)
      .all();
    return json({ data: res?.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

/**
 * POST /api/preorders/:id/notify — notify customer (cap clients.manage).
 * Câble pricing-engine.processPreorderNotification — fonctionnel Phase A
 * (UPDATE status='notified' + email_sent=false en Phase A).
 */
export async function handleNotifyPreorder(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  preorderId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId || !preorderId) {
      return json({ error: 'Paramètres manquants' }, 400);
    }

    // Bornage tenant.
    const existing = (await env.DB.prepare(
      `SELECT id FROM preorder_queue WHERE id = ? AND client_id = ?`,
    )
      .bind(preorderId, clientId)
      .first()) as { id?: string } | null;
    if (!existing) return json({ error: 'Preorder introuvable' }, 404);

    const result = await processPreorderNotification(env, preorderId);
    await logAudit(env, auth, 'preorder.notify', 'preorder', preorderId, {
      notified: result.notified,
      email_sent: result.email_sent,
      reason: result.reason ?? null,
    });
    return json({ data: result });
  } catch {
    return json({ error: 'Erreur notify preorder' }, 500);
  }
}

/** POST /api/preorders/:id/cancel — cancel preorder (cap clients.manage). */
export async function handleCancelPreorder(
  env: Env,
  auth: B2bBundlesPreordersAuth,
  preorderId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!preorderId) return json({ error: 'preorder_id requis' }, 400);

    const existing = await loadPreorder(env, preorderId, clientId);
    if (!existing) return json({ error: 'Preorder introuvable' }, 404);

    // Idempotent : déjà cancelled / converted ⇒ ne pas écraser.
    const currentStatus =
      typeof (existing as Record<string, unknown>).status === 'string'
        ? String((existing as Record<string, unknown>).status)
        : '';
    if (currentStatus === 'cancelled') {
      return json({ data: { id: preorderId, status: 'cancelled' } });
    }
    if (currentStatus === 'converted') {
      return json({ error: 'Preorder déjà converti' }, 400);
    }

    try {
      await env.DB.prepare(
        `UPDATE preorder_queue
            SET status = 'cancelled'
          WHERE id = ? AND client_id = ?`,
      )
        .bind(preorderId, clientId)
        .run();
    } catch {
      return json({ error: 'Annulation preorder échouée' }, 500);
    }

    await logAudit(env, auth, 'preorder.cancel', 'preorder', preorderId, {
      previous_status: currentStatus,
    });

    return json({ data: { id: preorderId, status: 'cancelled' } });
  } catch {
    return json({ error: 'Erreur annulation preorder' }, 500);
  }
}

/**
 * POST /api/preorders/:id/convert — convertit preorder en order (cap clients.manage).
 *
 * Body : `{ order_id: string }` — l'order doit être créé en amont via le
 * pipeline e-commerce S(E1) classique. Ce handler se contente de LINKER le
 * preorder (status='converted', converted_order_id=order_id) et de notifier
 * le customer best-effort via processPreorderNotification (status passera de
 * 'queued' → 'notified' avant le passage à 'converted' si pas déjà notifié).
 */
export async function handleConvertPreorder(
  request: Request,
  env: Env,
  auth: B2bBundlesPreordersAuth,
  preorderId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = clientIdOf(auth);
    if (!clientId) return json({ error: 'Client requis' }, 400);
    if (!preorderId) return json({ error: 'preorder_id requis' }, 400);

    const existing = await loadPreorder(env, preorderId, clientId);
    if (!existing) return json({ error: 'Preorder introuvable' }, 404);

    const currentStatus =
      typeof (existing as Record<string, unknown>).status === 'string'
        ? String((existing as Record<string, unknown>).status)
        : '';
    if (currentStatus === 'cancelled') {
      return json({ error: 'Preorder annulé — conversion impossible' }, 400);
    }
    if (currentStatus === 'converted') {
      return json({ error: 'Preorder déjà converti' }, 400);
    }

    const body = await readJsonBody(request);
    const orderId =
      typeof body.order_id === 'string' ? body.order_id.trim() : '';
    if (!orderId) return json({ error: 'order_id requis' }, 400);

    // Notify customer best-effort (passe status 'queued' → 'notified' si
    // pas déjà notifié) avant le UPDATE 'converted' final.
    let notifyResult: Awaited<ReturnType<typeof processPreorderNotification>> | null =
      null;
    try {
      notifyResult = await processPreorderNotification(env, preorderId);
    } catch {
      /* best-effort */
    }

    // UPDATE final : link order_id + status='converted'.
    try {
      await env.DB.prepare(
        `UPDATE preorder_queue
            SET status = 'converted', converted_order_id = ?
          WHERE id = ? AND client_id = ?`,
      )
        .bind(orderId, preorderId, clientId)
        .run();
    } catch {
      return json({ error: 'Conversion preorder échouée' }, 500);
    }

    await logAudit(env, auth, 'preorder.convert', 'preorder', preorderId, {
      order_id: orderId,
      previous_status: currentStatus,
      notified: notifyResult?.notified ?? false,
      email_sent: notifyResult?.email_sent ?? false,
    });

    return json({
      data: {
        id: preorderId,
        status: 'converted',
        converted_order_id: orderId,
        notified: notifyResult?.notified ?? false,
        email_sent: notifyResult?.email_sent ?? false,
      },
    });
  } catch {
    return json({ error: 'Erreur conversion preorder' }, 500);
  }
}

// NB : 22 handlers AUTHED (cap clients.manage) + 1 PUBLIC (visitor preorder
// join — rate-limit + honeypot). Phase B (Sprint 48) : tous fonctionnels.
//   - Customer groups CRUD (list/create/update/delete soft + assign INSERT OR
//     IGNORE / remove DELETE / getCustomerGroups).
//   - Tier prices CRUD (list/create/update/delete) + resolve (engine câblé).
//   - Product bundles CRUD (list/get/create/update/delete soft) + bundle_items
//     (list/add/remove via JOIN tenant bornage).
//   - Preorders : list / notify (engine câblé) / cancel idempotent / convert
//     (link order_id + notify best-effort).
// Validations métier : default_discount_pct ∈ [0..100], price_cents >= 0,
// min_quantity > 0, total_price_cents >= 0, discount_pct ∈ [0..100]. Tous les
// handlers : try/catch externe, audit best-effort, bornage WHERE client_id = ?.
// AUCUN ajout ALL_CAPABILITIES seq 80. Choix figés docs/LOT-B2B-BUNDLES-PREORDERS-S48.md §6.
//
// ── Sprint 48 renforcement (additif, zéro régression) ──────────────────────
// Wire-up des 8 nouveaux helpers PURE pricing-engine.ts dans 3 call sites :
//   - handleCreateBundle : validatePricingInput({qty:1, currency, discountPct})
//     + isCurrencySupported(currency) + computeBundlePrice(items, total,
//     discountPct) si items[] body → net_price_cents preview en réponse.
//   - handleUpdateBundle : isCurrencySupported(currency) + validatePricingInput
//     borne discount au MAX_DISCOUNT_PCT (80%).
//   - handlePublicCreatePreorder : isCurrencySupported(currency) optionnel +
//     computePreorderDeposit(variant.price × qty, deposit_pct?) preview
//     deposit/balance en réponse (sum invariant garanti).
// Code erreur déterministe via PRICING_ERROR_CODES (CURRENCY_NOT_SUPPORTED,
// DEPOSIT_INVALID, DISCOUNT_INVALID, INVALID_QUANTITY).
// S39 tax-engine INTOUCHÉ — computeFinalPrice (non câblé ici) délègue taxCents.
