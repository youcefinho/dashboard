// ── Stratégie d'inventaire multi-canal — Sprint E8 M1 (2026-05-16) ──────────
//
// Omnicanal concurrent (B2) : une boutique peut vendre via plusieurs canaux
// (natif Intralys, Shopify, WooCommerce). Chaque canal porte une STRATÉGIE
// d'inventaire qui décide comment réserver / vendre / libérer du stock.
//
// ⚠️ GARDE-FOU CENTRAL — RÉTRO-COMPAT BIT-POUR-BIT
//   `ecommerce-inventory.ts` (reserveStock / commitSale / releaseStock) est
//   consommé par E2/E3/E6/E7. Il N'est PAS modifié : on le WRAPPE.
//   Le mode par défaut `intralys_master` DÉLÈGUE VERBATIM à ces helpers
//   (mêmes args, même StockOpResult, zéro changement de comportement) ⇒ toute
//   boutique existante SANS canal externe se comporte exactement comme avant.
//   `resolveInventoryStrategy` retourne `intralys_master` par défaut si aucun
//   canal / aucune config ⇒ régression-zéro garantie.
//
// `StockOpResult` est IMPORTÉ depuis ecommerce-inventory.ts (type E2 verbatim,
// jamais redéfini ici). Idempotence : héritée des helpers E2 en master/pool ;
// pour `partitioned`, opérations atomiques bornées (UPDATE conditionnel).
//
// Conventions strictes : multi-tenant via client_id (getClientModules),
// mutations admin-only (pattern ecommerce-region.handleUpdateRegion).
// Additif / non destructif : aucun fichier E2-E7 modifié.

import type { Env } from './types';
import { json } from './helpers';
import { getClientModules } from './modules';
import {
  reserveStock,
  releaseStock,
  commitSale,
  type StockOpResult,
} from './ecommerce-inventory';

type Auth = { userId: string; role: string };

// ── Contrats FIGÉS (M2/M3 codent contre — NE PAS changer) ────────────────────

export type InventoryStrategyKind =
  | 'intralys_master'
  | 'partitioned'
  | 'shared_pool';

export interface InventoryStrategy {
  onReserve(
    env: Env, variantId: string, qty: number,
    ref?: StockRef, channelId?: string,
  ): Promise<StockOpResult>;
  onCommit(
    env: Env, variantId: string, qty: number,
    ref?: StockRef, channelId?: string,
  ): Promise<StockOpResult>;
  onRelease(
    env: Env, variantId: string, qty: number,
    ref?: StockRef, channelId?: string,
  ): Promise<StockOpResult>;
  onSync(
    env: Env, variantId: string, channelId: string,
  ): Promise<{ pushQty: number }>;
}

/** Référence mouvement — forme identique à celle attendue par les helpers E2. */
export type StockRef = { type?: string; id?: string; by?: string };

// Ré-export du type E2 pour que M2/M3 importent depuis CE module si pratique
// (la SOURCE reste ecommerce-inventory.ts — aucun doublon de définition).
export type { StockOpResult } from './ecommerce-inventory';

// ── Helpers internes ─────────────────────────────────────────────────────────

/** Stock physique disponible (quantity - reserved) d'une variante. */
async function physicalAvailable(env: Env, variantId: string): Promise<number> {
  const inv = (await env.DB.prepare(
    'SELECT quantity, reserved FROM inventory WHERE variant_id = ?',
  ).bind(variantId).first()) as { quantity: number; reserved: number } | null;
  if (!inv) return 0;
  return Math.max(0, (inv.quantity ?? 0) - (inv.reserved ?? 0));
}

/** Ligne d'allocation canal↔variante (mode partitioned). */
interface AllocRow {
  id: string;
  allocated_qty: number;
  reserved_qty: number;
}

async function loadAllocation(
  env: Env, channelId: string, variantId: string,
): Promise<AllocRow | null> {
  return (await env.DB.prepare(
    `SELECT id, allocated_qty, reserved_qty
       FROM channel_inventory_allocation
      WHERE channel_id = ? AND variant_id = ?`,
  ).bind(channelId, variantId).first()) as AllocRow | null;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. intralys_master — DÉLÉGATION VERBATIM aux helpers stock E2
// ════════════════════════════════════════════════════════════════════════════
// Aucune logique propre : on relaie tel quel. Comportement strictement
// identique à une boutique mono-canal pré-E8 (régression-zéro prouvée :
// les appels sortants sont les helpers E2 inchangés, mêmes arguments).

const intralysMasterStrategy: InventoryStrategy = {
  onReserve: (env, variantId, qty, ref) => reserveStock(env, variantId, qty, ref),
  onCommit: (env, variantId, qty, ref) => commitSale(env, variantId, qty, ref),
  onRelease: (env, variantId, qty, ref) => releaseStock(env, variantId, qty, ref),
  async onSync(env, variantId) {
    // Intralys est maître : on POUSSE le stock dispo vers les plateformes.
    // Le push réel (API Shopify/Woo) est branché par M2 — ici on calcule
    // seulement la quantité à pousser.
    return { pushQty: await physicalAvailable(env, variantId) };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 2. partitioned — STOCK CLOISONNÉ par canal (channel_inventory_allocation)
// ════════════════════════════════════════════════════════════════════════════
// Chaque canal a un quota alloué (allocated_qty) et son propre reserved_qty.
// N'altère JAMAIS inventory.quantity/reserved : pas d'impact sur les autres
// canaux ni sur le mode master. Échecs renvoyés au MÊME format StockOpResult
// que E2 (ok:false, reason:'insufficient'/'not_found').

const partitionedStrategy: InventoryStrategy = {
  async onReserve(env, variantId, qty, _ref, channelId) {
    const n = Math.max(0, Math.round(qty));
    if (n === 0) return { ok: true };
    if (!channelId) return { ok: false, reason: 'not_found' };
    const a = await loadAllocation(env, channelId, variantId);
    if (!a) return { ok: false, reason: 'not_found' };
    const free = (a.allocated_qty ?? 0) - (a.reserved_qty ?? 0);
    if (free < n) {
      return { ok: false, reason: 'insufficient', available: free };
    }
    // UPDATE conditionnel atomique : garde-fou anti-survente concurrente.
    const res = await env.DB.prepare(
      `UPDATE channel_inventory_allocation
          SET reserved_qty = reserved_qty + ?, updated_at = datetime('now')
        WHERE id = ? AND (allocated_qty - reserved_qty) >= ?`,
    ).bind(n, a.id, n).run();
    if (!res.meta.changes) {
      return { ok: false, reason: 'insufficient', available: free };
    }
    return { ok: true, available: free - n };
  },

  async onCommit(env, variantId, qty, _ref, channelId) {
    const n = Math.max(0, Math.round(qty));
    if (n === 0) return { ok: true };
    if (!channelId) return { ok: false, reason: 'not_found' };
    const a = await loadAllocation(env, channelId, variantId);
    if (!a) return { ok: false, reason: 'not_found' };
    if ((a.allocated_qty ?? 0) < n) {
      return { ok: false, reason: 'insufficient', available: a.allocated_qty ?? 0 };
    }
    // Vente concrète : on retire du quota alloué ET de la réserve canal.
    const releaseReserve = Math.min(n, a.reserved_qty ?? 0);
    await env.DB.prepare(
      `UPDATE channel_inventory_allocation
          SET allocated_qty = allocated_qty - ?,
              reserved_qty   = reserved_qty - ?,
              updated_at     = datetime('now')
        WHERE id = ?`,
    ).bind(n, releaseReserve, a.id).run();
    return { ok: true, quantity: (a.allocated_qty ?? 0) - n };
  },

  async onRelease(env, variantId, qty, _ref, channelId) {
    const n = Math.max(0, Math.round(qty));
    if (n === 0) return { ok: true };
    if (!channelId) return { ok: false, reason: 'not_found' };
    const a = await loadAllocation(env, channelId, variantId);
    if (!a) return { ok: false, reason: 'not_found' };
    const release = Math.min(n, a.reserved_qty ?? 0);
    if (release === 0) return { ok: true, reserved: a.reserved_qty ?? 0 };
    await env.DB.prepare(
      `UPDATE channel_inventory_allocation
          SET reserved_qty = reserved_qty - ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(release, a.id).run();
    return { ok: true, reserved: (a.reserved_qty ?? 0) - release };
  },

  async onSync(env, variantId, channelId) {
    const a = await loadAllocation(env, channelId, variantId);
    if (!a) return { pushQty: 0 };
    // On pousse vers la plateforme le disponible CLOISONNÉ de ce canal.
    return { pushQty: Math.max(0, (a.allocated_qty ?? 0) - (a.reserved_qty ?? 0)) };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 3. shared_pool — POOL UNIQUE partagé (helpers E2) + trace canal pour sync
// ════════════════════════════════════════════════════════════════════════════
// Tous les canaux puisent dans le MÊME stock physique. reserveStock E2 est
// déjà atomique (UPDATE reserved + check disponible) ⇒ pas de survente.
// On délègue verbatim à E2 (la trace canal vit dans la référence mouvement).

function withChannelRef(ref: StockRef | undefined, channelId?: string): StockRef {
  // Annote la référence du mouvement avec le canal sans en changer la forme.
  if (!channelId) return ref ?? {};
  return { ...(ref ?? {}), id: ref?.id ?? `channel:${channelId}` };
}

const sharedPoolStrategy: InventoryStrategy = {
  onReserve: (env, variantId, qty, ref, channelId) =>
    reserveStock(env, variantId, qty, withChannelRef(ref, channelId)),
  onCommit: (env, variantId, qty, ref, channelId) =>
    commitSale(env, variantId, qty, withChannelRef(ref, channelId)),
  onRelease: (env, variantId, qty, ref, channelId) =>
    releaseStock(env, variantId, qty, withChannelRef(ref, channelId)),
  async onSync(env, variantId) {
    // Pool partagé : on pousse le disponible global vers chaque plateforme.
    return { pushQty: await physicalAvailable(env, variantId) };
  },
};

// ── Résolution stratégie ─────────────────────────────────────────────────────

const STRATEGIES: Record<InventoryStrategyKind, InventoryStrategy> = {
  intralys_master: intralysMasterStrategy,
  partitioned: partitionedStrategy,
  shared_pool: sharedPoolStrategy,
};

function coerceKind(raw: string | null | undefined): InventoryStrategyKind {
  const v = (raw || '').toLowerCase().trim();
  return v === 'partitioned' || v === 'shared_pool'
    ? (v as InventoryStrategyKind)
    : 'intralys_master';
}

/**
 * Résout la stratégie d'inventaire d'un tenant (optionnellement d'un canal
 * précis). DÉFAUT `intralys_master` si aucun canal / aucune config trouvée
 * ⇒ rétro-compat absolue : toute boutique pré-E8 délègue verbatim aux
 * helpers stock E2 (comportement bit-pour-bit identique).
 */
export async function resolveInventoryStrategy(
  env: Env, clientId: string, channelId?: string,
): Promise<InventoryStrategy> {
  try {
    if (channelId) {
      const row = (await env.DB.prepare(
        `SELECT inventory_strategy FROM sales_channels
          WHERE id = ? AND client_id = ?`,
      ).bind(channelId, clientId).first()) as
        | { inventory_strategy: string | null }
        | null;
      return STRATEGIES[coerceKind(row?.inventory_strategy)];
    }
    // Pas de canal explicite : on prend la stratégie du canal natif du tenant
    // s'il existe ; sinon défaut master (boutique mono-canal pré-E8).
    const row = (await env.DB.prepare(
      `SELECT inventory_strategy FROM sales_channels
        WHERE client_id = ? AND active = 1
        ORDER BY (type = 'native') DESC, created_at ASC
        LIMIT 1`,
    ).bind(clientId).first()) as
      | { inventory_strategy: string | null }
      | null;
    return STRATEGIES[coerceKind(row?.inventory_strategy)];
  } catch {
    // Toute erreur (table absente avant migration, etc.) ⇒ défaut master :
    // jamais de régression pour une boutique existante.
    return STRATEGIES.intralys_master;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Handlers CRUD canaux de vente — noms FIGÉS (M2 câble worker.ts)
// ════════════════════════════════════════════════════════════════════════════
// Pattern multi-tenant + admin-only aligné ecommerce-region.handleUpdateRegion.

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

const VALID_TYPES = ['native', 'shopify', 'woo'] as const;
const VALID_STRATEGIES: InventoryStrategyKind[] = [
  'intralys_master', 'partitioned', 'shared_pool',
];

/** GET /api/ecommerce/channels — liste des canaux du tenant courant. */
export async function handleListChannels(env: Env, auth: Auth): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const { results } = await env.DB.prepare(
    `SELECT id, name, type, inventory_strategy, config_ref, shop_domain,
            external_id, active, created_at, updated_at
       FROM sales_channels
      WHERE client_id = ?
      ORDER BY (type = 'native') DESC, created_at ASC`,
  ).bind(clientId).all();
  return json({ data: results || [] });
}

/** POST /api/ecommerce/channels — crée un canal (ADMIN). */
export async function handleCreateChannel(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: {
    name?: string; type?: string; inventory_strategy?: string;
    config_ref?: string; shop_domain?: string; external_id?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const type = String(body.type || 'native').toLowerCase().trim();
  if (!(VALID_TYPES as readonly string[]).includes(type)) {
    return json(
      { error: 'Type invalide', message: "type doit être 'native', 'shopify' ou 'woo'." },
      400,
    );
  }
  const strategy = coerceKind(body.inventory_strategy);
  const name = String(body.name || 'Canal').trim().slice(0, 80) || 'Canal';
  // config_ref = RÉFÉRENCE binding secret (ex 'SHOPIFY') — jamais une clé.
  const configRef = body.config_ref
    ? String(body.config_ref).trim().slice(0, 64)
    : null;
  const shopDomain = body.shop_domain
    ? String(body.shop_domain).trim().slice(0, 200)
    : null;
  const externalId = body.external_id
    ? String(body.external_id).trim().slice(0, 200)
    : null;

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO sales_channels
       (id, client_id, name, type, inventory_strategy, config_ref,
        shop_domain, external_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, clientId, name, type, strategy, configRef, shopDomain, externalId,
  ).run();

  return json({ data: { id, success: true } }, 201);
}

/** PATCH /api/ecommerce/channels/:id — maj d'un canal (ADMIN, patch partiel). */
export async function handleUpdateChannel(
  request: Request, env: Env, auth: Auth, id: string,
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

  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof body.name === 'string') {
    sets.push('name = ?');
    params.push(body.name.trim().slice(0, 80) || 'Canal');
  }
  if (typeof body.config_ref === 'string') {
    sets.push('config_ref = ?');
    params.push(body.config_ref.trim().slice(0, 64) || null);
  }
  if (typeof body.shop_domain === 'string') {
    sets.push('shop_domain = ?');
    params.push(body.shop_domain.trim().slice(0, 200) || null);
  }
  if (typeof body.external_id === 'string') {
    sets.push('external_id = ?');
    params.push(body.external_id.trim().slice(0, 200) || null);
  }
  if (typeof body.active === 'number' || typeof body.active === 'boolean') {
    sets.push('active = ?');
    params.push(body.active ? 1 : 0);
  }
  if (typeof body.inventory_strategy === 'string') {
    const s = body.inventory_strategy.toLowerCase().trim();
    if (!(VALID_STRATEGIES as string[]).includes(s)) {
      return json(
        { error: 'Stratégie invalide', message: "inventory_strategy doit être 'intralys_master', 'partitioned' ou 'shared_pool'." },
        400,
      );
    }
    sets.push('inventory_strategy = ?');
    params.push(s);
  }
  if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);

  params.push(id, clientId);
  const res = await env.DB.prepare(
    `UPDATE sales_channels SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
  ).bind(...params).run();
  if (!res.meta.changes) return json({ error: 'Canal introuvable' }, 404);
  return json({ data: { id, success: true } });
}

/** DELETE /api/ecommerce/channels/:id — supprime un canal (ADMIN). */
export async function handleDeleteChannel(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const res = await env.DB.prepare(
    'DELETE FROM sales_channels WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).run();
  if (!res.meta.changes) return json({ error: 'Canal introuvable' }, 404);
  return json({ data: { success: true } });
}

/**
 * PATCH /api/ecommerce/channels/:id/strategy — change la stratégie
 * d'inventaire d'un canal (ADMIN). Valide l'enum strictement.
 */
export async function handleSetInventoryStrategy(
  request: Request, env: Env, auth: Auth, channelId: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: { inventory_strategy?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const s = String(body.inventory_strategy || '').toLowerCase().trim();
  if (!(VALID_STRATEGIES as string[]).includes(s)) {
    return json(
      { error: 'Stratégie invalide', message: "inventory_strategy doit être 'intralys_master', 'partitioned' ou 'shared_pool'." },
      400,
    );
  }

  const res = await env.DB.prepare(
    `UPDATE sales_channels
        SET inventory_strategy = ?, updated_at = datetime('now')
      WHERE id = ? AND client_id = ?`,
  ).bind(s, channelId, clientId).run();
  if (!res.meta.changes) return json({ error: 'Canal introuvable' }, 404);
  return json({ data: { id: channelId, inventory_strategy: s, success: true } });
}
