// ── Sprint E8 M2.3 — Moteur de synchronisation omnicanal ─────────────────────
//
// Cœur agnostique de sync entre une plateforme externe (Shopify / Woo) et la
// boutique B2. Mappe un payload externe → entité interne via le moteur dot-path
// S51 (`applyLeadMapping` / `resolvePath` — RÉUTILISÉS, jamais dupliqués), et
// concrétise les commandes via `createOrderCore` E3 (contrat figé, 0 modif).
//
// Garde-fous CENTRAUX :
//   - IDEMPOTENCE produit : `channel_product_map.external_id` UNIQUE — rejeu
//     d'un webhook products/update = upsert no-op (même variante).
//   - IDEMPOTENCE commande : `orders.external_id` (idx E1) — rejeu d'un
//     webhook orders/create = createOrderCore non rappelé (commande déjà là).
//   - ANTI-ECHO : avant un push sortant, on vérifie channel_sync_log : si un
//     event `in` (reçu de la plateforme) pour ce external_id est plus récent
//     qu'une courte fenêtre, on SKIP le push (sinon boucle pull↔push infinie).
//   - ATTRIBUTION : `orders.source` = type du canal ('shopify' | 'woo').
//   - STOCK sortant : délégué à `resolveInventoryStrategy(...).onSync(...)`
//     (M1) — aucune logique stock réimplémentée ici.
//
// Multi-tenant STRICT : toutes les écritures portent client_id (résolu via le
// canal). Additif / non destructif : ne touche aucun fichier E1-E7.

import type { Env } from './types';
import { applyLeadMapping, resolvePath } from './lead-mapping';
import { createOrderCore } from './ecommerce-orders';
import { resolveInventoryStrategy } from './ecommerce-inventory-strategy';

// ── Types canal (lecture seule depuis sales_channels — M1) ───────────────────
export interface ChannelRow {
  id: string;
  client_id: string;
  name: string;
  type: 'native' | 'shopify' | 'woo';
  config_ref: string | null;
  shop_domain: string | null;
  external_id: string | null;
  active: number;
}

export interface SyncResult {
  synced: { products: number; orders: number };
  conflicts: number;
  errors: number;
}

// Fenêtre anti-echo : un event sortant est SKIP si un event entrant pour le
// même (channel, external_id) a été journalisé dans les N dernières secondes.
const ANTI_ECHO_WINDOW_SECONDS = 120;

// ── Helpers DB ───────────────────────────────────────────────────────────────

/** Charge un canal actif appartenant au tenant (multi-tenant strict). */
export async function loadChannel(
  env: Env,
  clientId: string,
  channelId: string,
): Promise<ChannelRow | null> {
  return (await env.DB.prepare(
    `SELECT id, client_id, name, type, config_ref, shop_domain, external_id, active
       FROM sales_channels
      WHERE id = ? AND client_id = ?`,
  ).bind(channelId, clientId).first()) as ChannelRow | null;
}

/** Variante de canal résolue par channelId seul (webhook public, pas d'auth). */
export async function loadChannelByIdOnly(
  env: Env,
  channelId: string,
): Promise<ChannelRow | null> {
  return (await env.DB.prepare(
    `SELECT id, client_id, name, type, config_ref, shop_domain, external_id, active
       FROM sales_channels
      WHERE id = ?`,
  ).bind(channelId).first()) as ChannelRow | null;
}

/** Journalise une opération de sync (trace + base de l'anti-echo). */
export async function logSync(
  env: Env,
  channel: ChannelRow,
  direction: 'in' | 'out',
  entityType: 'product' | 'order',
  status: 'ok' | 'conflict' | 'error',
  externalId: string | null,
  detail?: unknown,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO channel_sync_log
         (id, client_id, channel_id, direction, entity_type, status,
          external_id, conflict_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      channel.client_id,
      channel.id,
      direction,
      entityType,
      status,
      externalId || null,
      detail != null ? JSON.stringify(detail).slice(0, 4000) : null,
    ).run();
  } catch {
    /* best-effort : le journal ne doit jamais casser le flux de sync */
  }
}

/**
 * Anti-echo : `true` si un event ENTRANT (`in`) pour ce external_id a été
 * journalisé dans la fenêtre courte → on NE pousse PAS (sinon boucle).
 */
async function recentlyReceivedInbound(
  env: Env,
  channelId: string,
  externalId: string,
): Promise<boolean> {
  if (!externalId) return false;
  const row = (await env.DB.prepare(
    `SELECT 1 AS hit
       FROM channel_sync_log
      WHERE channel_id = ? AND external_id = ? AND direction = 'in'
        AND created_at >= datetime('now', ?)
      LIMIT 1`,
  ).bind(channelId, externalId, `-${ANTI_ECHO_WINDOW_SECONDS} seconds`).first()) as
    | { hit: number }
    | null;
  return !!row;
}

// ── Upsert produit (external_id ↔ variante interne) ──────────────────────────
// On NE modifie PAS ecommerce-products.ts : on écrit directement les tables
// products / product_variants / inventory en respectant leurs conventions
// (id applicatif crypto.randomUUID, money cents, multi-tenant client_id).

interface MappedProduct {
  externalId: string;
  externalSku: string;
  title: string;
  priceCents: number;
  quantity: number | null;
}

/**
 * Mappe un payload produit externe → champs internes via le moteur S51
 * (`applyLeadMapping` réutilisé : agnostique du type cible, cf. lead-mapping
 * l.53). `resolvePath` extrait les champs spécifiques produit (prix, stock).
 */
function mapExternalProduct(
  payload: Record<string, unknown>,
  mappingJson: string | null,
): MappedProduct {
  // applyLeadMapping fournit name/customFields via dot-path — on réutilise sa
  // résolution générique pour le titre (champ canonique 'name').
  const m = applyLeadMapping(payload, mappingJson);

  const idRaw =
    resolvePath(payload, 'id') ??
    resolvePath(payload, 'product_id') ??
    resolvePath(payload, 'variant_id');
  const skuRaw =
    resolvePath(payload, 'sku') ??
    resolvePath(payload, 'variants.0.sku') ??
    resolvePath(payload, 'variant.sku');
  const priceRaw =
    resolvePath(payload, 'price') ??
    resolvePath(payload, 'variants.0.price') ??
    resolvePath(payload, 'variant.price') ??
    resolvePath(payload, 'regular_price');
  const qtyRaw =
    resolvePath(payload, 'inventory_quantity') ??
    resolvePath(payload, 'variants.0.inventory_quantity') ??
    resolvePath(payload, 'stock_quantity');

  const priceFloat = priceRaw != null ? parseFloat(String(priceRaw)) : NaN;
  const priceCents = Number.isFinite(priceFloat)
    ? Math.max(0, Math.round(priceFloat * 100))
    : 0;
  const qtyInt = qtyRaw != null ? parseInt(String(qtyRaw), 10) : NaN;

  return {
    externalId: String(idRaw ?? '').trim(),
    externalSku: String(skuRaw ?? '').trim().slice(0, 100),
    title: (m.name || String(resolvePath(payload, 'title') ?? '') || 'Produit importé')
      .toString()
      .slice(0, 200),
    priceCents,
    quantity: Number.isFinite(qtyInt) ? qtyInt : null,
  };
}

/**
 * Upsert idempotent d'un produit externe.
 *  - Si channel_product_map(channel, external_id) existe → on met à jour la
 *    variante mappée (rejeu = no-op métier hormis prix/stock rafraîchis).
 *  - Sinon : crée produit + variante + inventory et enregistre le mapping.
 */
async function upsertExternalProduct(
  env: Env,
  channel: ChannelRow,
  mappingJson: string | null,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; conflict?: boolean }> {
  const mp = mapExternalProduct(payload, mappingJson);
  if (!mp.externalId) {
    await logSync(env, channel, 'in', 'product', 'error', null, {
      reason: 'external_id manquant dans le payload produit',
    });
    return { ok: false, conflict: true };
  }

  const existing = (await env.DB.prepare(
    `SELECT internal_variant_id FROM channel_product_map
      WHERE channel_id = ? AND external_id = ?`,
  ).bind(channel.id, mp.externalId).first()) as
    | { internal_variant_id: string }
    | null;

  if (existing) {
    // Idempotent : rafraîchit prix + stock de la variante déjà mappée.
    await env.DB.prepare(
      `UPDATE product_variants SET price_override = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(mp.priceCents, existing.internal_variant_id).run();
    if (mp.quantity != null) {
      await env.DB.prepare(
        `UPDATE inventory SET quantity = ?, updated_at = datetime('now')
          WHERE variant_id = ?`,
      ).bind(Math.max(0, mp.quantity), existing.internal_variant_id).run();
    }
    await env.DB.prepare(
      `UPDATE channel_product_map
          SET last_synced_at = datetime('now'), external_sku = ?
        WHERE channel_id = ? AND external_id = ?`,
    ).bind(mp.externalSku || null, channel.id, mp.externalId).run();
    await logSync(env, channel, 'in', 'product', 'ok', mp.externalId);
    return { ok: true };
  }

  // Création produit + variante + inventory (conventions E2 respectées :
  // id applicatif crypto.randomUUID, money cents). ecommerce-products NON
  // modifié — on écrit les tables directement avec les mêmes conventions.
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  // slug NOT NULL + UNIQUE(client_id, slug) : dérivé du titre + suffixe canal
  // (external_id) pour garantir l'unicité multi-canal sans collision.
  const slugBase =
    mp.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'produit';
  const slug = `${slugBase}-${channel.type}-${mp.externalId}`.slice(0, 120);
  await env.DB.prepare(
    `INSERT INTO products (id, client_id, title, slug, base_price, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
  ).bind(productId, channel.client_id, mp.title, slug, mp.priceCents).run();
  await env.DB.prepare(
    `INSERT INTO product_variants (id, product_id, title, sku, price_override)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(
    variantId, productId, 'Default',
    mp.externalSku || null, mp.priceCents,
  ).run();
  await env.DB.prepare(
    `INSERT INTO inventory (id, variant_id, quantity, reserved)
     VALUES (?, ?, ?, 0)`,
  ).bind(
    crypto.randomUUID(), variantId,
    Math.max(0, mp.quantity ?? 0),
  ).run();
  await env.DB.prepare(
    `INSERT INTO channel_product_map
       (id, client_id, channel_id, internal_variant_id, external_id,
        external_sku, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(
    crypto.randomUUID(), channel.client_id, channel.id, variantId,
    mp.externalId, mp.externalSku || null,
  ).run();

  await logSync(env, channel, 'in', 'product', 'ok', mp.externalId);
  return { ok: true };
}

// ── Import commande externe → createOrderCore E3 (contrat figé) ──────────────

interface MappedOrderLine {
  variant_id: string;
  quantity: number;
}

/**
 * Mappe les lignes d'une commande externe → variantes internes via
 * channel_product_map (external line id / sku). Les lignes sans mapping connu
 * sont ignorées (le produit n'a pas encore été synchronisé) et journalisées.
 */
async function resolveOrderLines(
  env: Env,
  channel: ChannelRow,
  payload: Record<string, unknown>,
): Promise<MappedOrderLine[]> {
  const rawLines =
    (resolvePath(payload, 'line_items') as unknown[]) ||
    (resolvePath(payload, 'lineItems') as unknown[]) ||
    [];
  const out: MappedOrderLine[] = [];
  for (const raw of Array.isArray(rawLines) ? rawLines : []) {
    const line = raw as Record<string, unknown>;
    const extId = String(
      line.product_id ?? line.variant_id ?? line.id ?? '',
    ).trim();
    const extSku = String(line.sku ?? '').trim();
    const qty = Math.max(1, Math.round(Number(line.quantity) || 1));
    if (!extId && !extSku) continue;

    const map = (await env.DB.prepare(
      `SELECT internal_variant_id FROM channel_product_map
        WHERE channel_id = ?
          AND (external_id = ? OR (external_sku IS NOT NULL AND external_sku = ?))
        LIMIT 1`,
    ).bind(channel.id, extId, extSku).first()) as
      | { internal_variant_id: string }
      | null;
    if (map) out.push({ variant_id: map.internal_variant_id, quantity: qty });
  }
  return out;
}

/**
 * Import idempotent d'une commande externe. Idempotence : orders.external_id
 * (idx E1) — si une commande existe déjà pour ce external_id sur ce tenant,
 * on NE rappelle PAS createOrderCore (rejeu webhook orders/create = no-op).
 * Attribution : source = type du canal. createOrderCore E3 réutilisé verbatim.
 */
async function importExternalOrder(
  env: Env,
  channel: ChannelRow,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; duplicate?: boolean; conflict?: boolean }> {
  const externalId = String(
    resolvePath(payload, 'id') ??
      resolvePath(payload, 'order_id') ??
      resolvePath(payload, 'number') ??
      '',
  ).trim();
  if (!externalId) {
    await logSync(env, channel, 'in', 'order', 'error', null, {
      reason: 'external_id commande manquant',
    });
    return { ok: false, conflict: true };
  }

  // Idempotence stricte : commande déjà importée pour ce tenant ?
  const dup = (await env.DB.prepare(
    'SELECT id FROM orders WHERE external_id = ? AND client_id = ?',
  ).bind(externalId, channel.client_id).first()) as { id: string } | null;
  if (dup) {
    await logSync(env, channel, 'in', 'order', 'ok', externalId, {
      duplicate: true,
    });
    return { ok: true, duplicate: true };
  }

  const items = await resolveOrderLines(env, channel, payload);
  if (items.length === 0) {
    await logSync(env, channel, 'in', 'order', 'conflict', externalId, {
      reason: 'aucune ligne mappée (produits non encore synchronisés)',
    });
    return { ok: false, conflict: true };
  }

  const email = String(
    resolvePath(payload, 'email') ??
      resolvePath(payload, 'customer.email') ??
      resolvePath(payload, 'billing.email') ??
      '',
  ).trim();

  try {
    const result = await createOrderCore(env, channel.client_id, {
      email: email || 'commande@externe.local',
      items,
      source: channel.type, // attribution canal ('shopify' | 'woo')
      note: `Importée du canal ${channel.name}`,
    });
    // Trace l'external_id sur la commande créée (idempotence future + audit).
    await env.DB.prepare(
      `UPDATE orders SET external_id = ?, updated_at = datetime('now')
        WHERE id = ? AND client_id = ?`,
    ).bind(externalId, result.id, channel.client_id).run();
    await logSync(env, channel, 'in', 'order', 'ok', externalId, {
      order_id: result.id,
    });
    return { ok: true };
  } catch (e) {
    await logSync(env, channel, 'in', 'order', 'error', externalId, {
      reason: e instanceof Error ? e.message : 'createOrderCore a échoué',
    });
    return { ok: false, conflict: true };
  }
}

// ── API moteur (consommée par worker.ts + connecteurs Shopify/Woo) ───────────

/** Mapping personnalisé du canal (config_ref pointe un binding ; ici on lit
 *  un éventuel mapping JSON stocké côté canal — réutilise applyLeadMapping). */
function channelMappingJson(_channel: ChannelRow): string | null {
  // Pas de colonne mapping dédiée en E8 (config_ref = réf secret). Le moteur
  // S51 retombe sur ses alias par défaut (Shopify/Woo exposent title/price/
  // sku/inventory_quantity standard) → mapping null = défaut robuste.
  return null;
}

/**
 * Traite un payload PRODUIT entrant (webhook products/create|update ou pull).
 * Idempotent via channel_product_map.external_id UNIQUE.
 */
export async function ingestProductEvent(
  env: Env,
  channel: ChannelRow,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; conflict?: boolean }> {
  return upsertExternalProduct(
    env, channel, channelMappingJson(channel), payload,
  );
}

/**
 * Traite un payload COMMANDE entrant (webhook orders/create ou pull).
 * Idempotent via orders.external_id. createOrderCore E3 réutilisé.
 */
export async function ingestOrderEvent(
  env: Env,
  channel: ChannelRow,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; duplicate?: boolean; conflict?: boolean }> {
  return importExternalOrder(env, channel, payload);
}

/**
 * Sync sortant du STOCK d'une variante vers la plateforme. Quantité calculée
 * par la stratégie M1 (`resolveInventoryStrategy(...).onSync`). ANTI-ECHO :
 * skip si on vient de recevoir un event entrant pour ce external_id.
 * Le push HTTP réel est délégué au connecteur (callback `pushFn`).
 */
export async function syncProductOut(
  env: Env,
  channel: ChannelRow,
  internalVariantId: string,
  pushFn: (externalId: string, qty: number) => Promise<boolean>,
): Promise<{ pushed: boolean; skipped?: boolean }> {
  const map = (await env.DB.prepare(
    `SELECT external_id FROM channel_product_map
      WHERE channel_id = ? AND internal_variant_id = ? LIMIT 1`,
  ).bind(channel.id, internalVariantId).first()) as
    | { external_id: string }
    | null;
  if (!map) return { pushed: false };

  // ANTI-ECHO : ne pas renvoyer ce qu'on vient juste de recevoir.
  if (await recentlyReceivedInbound(env, channel.id, map.external_id)) {
    await logSync(env, channel, 'out', 'product', 'ok', map.external_id, {
      skipped: 'anti-echo',
    });
    return { pushed: false, skipped: true };
  }

  const strategy = await resolveInventoryStrategy(
    env, channel.client_id, channel.id,
  );
  const { pushQty } = await strategy.onSync(env, internalVariantId, channel.id);

  let ok = false;
  try {
    ok = await pushFn(map.external_id, Math.max(0, pushQty));
  } catch {
    ok = false;
  }
  await logSync(
    env, channel, 'out', 'product', ok ? 'ok' : 'error', map.external_id,
    { pushQty },
  );
  if (ok) {
    await env.DB.prepare(
      `UPDATE channel_product_map
          SET last_synced_at = datetime('now')
        WHERE channel_id = ? AND external_id = ?`,
    ).bind(channel.id, map.external_id).run();
  }
  return { pushed: ok };
}
