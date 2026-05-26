// ── Panier + conversion commande — Sprint E3 M2 (2026-05-16) ─────────────────
//
// Backend panier du module Boutique (B2). S'appuie sur les tables E1
// (`carts` / `cart_items`) et CONSOMME le contrat figé M1
// `createOrderCore` pour la conversion panier → commande (zéro duplication
// de la logique commande / TPS-TVQ / stock).
//
// Conventions strictes du projet :
//  - Money TOUJOURS en cents (INTEGER). Aperçu TPS 5% + TVQ 9.975% calculé
//    SÉPARÉMENT sur le sous-total (jamais en cascade) — réplique exacte de la
//    logique M1/Invoices.tsx. AUCUNE persistance de taxes au panier : c'est la
//    commande (createOrderCore) qui fige le calcul fiscal.
//  - Multi-tenant STRICT : WHERE client_id = ? résolu via getClientModules
//    (pattern projet, jamais de fuite cross-tenant). Toute variante manipulée
//    est vérifiée appartenir à un produit du tenant courant.
//  - id TEXT applicatif : on laisse les DEFAULT SQL E1
//    (lower(hex(randomblob(16)))) jouer sur carts/cart_items.
//  - Gating requireModule('ecommerce') géré AMONT par src/worker.ts (le bloc
//    /api/ecommerce/* est gated globalement — toute route ci-dessous hérite).
//
// E3 = PAS de paiement (Stripe = E4). La conversion crée une commande
// 'pending' / 'unpaid' via le cœur M1 ; le lifecycle reste géré côté orders.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { getClientModules } from './modules';
import { createOrderCore } from './ecommerce-orders';
import { computeTax } from './ecommerce-tax-engine';
// Sprint 4 — résolution coupon EN AMONT (réutilise le cœur Manager-B,
// zéro duplication). On passe le montant résolu au `discount_cents`
// EXISTANT de createOrderCore — createOrderCore reste INCHANGÉ (§6.C).
import { resolveCouponDiscount, incrementCouponUsage } from './ecommerce-coupons';
// S3 M2 — validation d'entrée (schéma M1 figé, import only).
import { validate, addCartItemSchema, updateCartItemSchema } from '../lib/schemas';
import { validationError } from './lib/validate-response';

type Auth = { userId: string; role: string };

// Aperçu fiscal LECTURE SEULE — calculé par le MÊME moteur unique que la
// commande (ecommerce-tax-engine.ts) : la cohérence cart↔order est donc
// garantie par construction (zéro formule dupliquée). L'aperçu panier reste
// Québec (régime par défaut, identique à createOrderCore) — c'est la commande
// qui fige le régime réel à la conversion.
const PREVIEW_REGIME = 'qc' as const;

/** Résout le client_id du tenant courant (réutilise le helper modules). */
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

interface CartRow {
  id: string;
  client_id: string;
  customer_id: string | null;
  token: string;
  status: string;
}

interface CartLineRow {
  id: string;
  variant_id: string;
  quantity: number;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  unit_price_cents: number;
}

/**
 * Charge le panier actif (multi-tenant) avec ses lignes + prix effectif
 * (price_override ?? base_price), calcule le sous-total et un APERÇU
 * TPS/TVQ non persisté. Renvoie la forme JSON consommée par le front M3.
 */
async function shapeCart(env: Env, clientId: string, cart: CartRow): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare(
    `SELECT ci.id AS id, ci.variant_id AS variant_id, ci.quantity AS quantity,
            p.title AS product_title, v.title AS variant_title, v.sku AS sku,
            COALESCE(v.price_override, p.base_price, 0) AS unit_price_cents
       FROM cart_items ci
       JOIN product_variants v ON v.id = ci.variant_id
       JOIN products p ON p.id = v.product_id AND p.client_id = ?
      WHERE ci.cart_id = ?
      ORDER BY ci.added_at ASC`,
  ).bind(clientId, cart.id).all();

  const lines = (results || []) as unknown as CartLineRow[];
  let subtotalCents = 0;
  const items = lines.map((ln) => {
    const unit = Math.max(0, Math.round(ln.unit_price_cents || 0));
    const qty = Math.max(1, Math.round(ln.quantity || 1));
    const lineTotal = unit * qty;
    subtotalCents += lineTotal;
    return {
      id: ln.id,
      variant_id: ln.variant_id,
      quantity: qty,
      product_title: ln.product_title,
      variant_title: ln.variant_title,
      sku: ln.sku,
      unit_price_cents: unit,
      total_cents: lineTotal,
    };
  });

  // Aperçu fiscal LECTURE SEULE — moteur unique (même source que la commande).
  // Régime QC : lines[0]=TPS, lines[1]=TVQ (identique à createOrderCore).
  const tax = computeTax(PREVIEW_REGIME, subtotalCents, {});
  const tpsCents = tax.lines[0]?.amountCents ?? 0;
  const tvqCents = tax.lines[1]?.amountCents ?? 0;

  return {
    id: cart.id,
    token: cart.token,
    status: cart.status,
    customer_id: cart.customer_id,
    items,
    subtotal_cents: subtotalCents,
    // Préfixe `preview_` : signale explicitement que ces taxes ne sont PAS
    // figées et seront recalculées par createOrderCore à la conversion.
    preview_tps_cents: tpsCents,
    preview_tvq_cents: tvqCents,
    preview_total_cents: subtotalCents + tax.totalTaxCents,
  };
}

/** Vérifie qu'une variante existe ET appartient à un produit du tenant. */
async function variantInTenant(env: Env, clientId: string, variantId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT v.id FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = ? AND p.client_id = ?`,
  ).bind(variantId, clientId).first();
  return !!row;
}

/** Récupère le panier active ciblé par customer_id ou token (sans le créer). */
async function findActiveCart(
  env: Env, clientId: string, customerId: string | null, token: string | null,
): Promise<CartRow | null> {
  if (token) {
    return (await env.DB.prepare(
      `SELECT id, client_id, customer_id, token, status FROM carts
        WHERE token = ? AND client_id = ? AND status = 'active'`,
    ).bind(token, clientId).first()) as CartRow | null;
  }
  if (customerId) {
    return (await env.DB.prepare(
      `SELECT id, client_id, customer_id, token, status FROM carts
        WHERE customer_id = ? AND client_id = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
    ).bind(customerId, clientId).first()) as CartRow | null;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// A1 — CRUD panier
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ecommerce/cart?customer_id= | ?token=
 * Récupère le panier actif du client/token, ou en crée un (status='active').
 * Si ?token= absent et qu'on crée pour un customer, on génère un token unique.
 */
export async function handleGetCart(env: Env, auth: Auth, url: URL): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const customerId = sanitizeInput(url.searchParams.get('customer_id') || '', 100) || null;
  const token = sanitizeInput(url.searchParams.get('token') || '', 100) || null;
  if (!customerId && !token) {
    return json(
      { error: 'Paramètre requis', message: 'Fournis customer_id ou token pour cibler un panier.' },
      400,
    );
  }

  let cart = await findActiveCart(env, clientId, customerId, token);
  if (!cart) {
    const newToken = token || `cart_${crypto.randomUUID()}`;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO carts (id, client_id, customer_id, token, status)
       VALUES (?, ?, ?, ?, 'active')`,
    ).bind(id, clientId, customerId, newToken).run();
    cart = { id, client_id: clientId, customer_id: customerId, token: newToken, status: 'active' };
  }

  return json({ data: await shapeCart(env, clientId, cart) });
}

/**
 * POST /api/ecommerce/cart/items — body { variant_id, quantity, customer_id?, token? }
 * Ajoute la variante au panier actif (ciblé via customer_id/token) ou
 * incrémente la quantité si la ligne existe déjà. Crée le panier au besoin.
 */
export async function handleAddCartItem(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // S3 M2 — validation d'entrée AVANT la logique (early-return additif).
  // Le gate multi-tenant variantInTenant (S2) reste APRÈS, intact.
  const parsed = await request.json().catch(() => null);
  const vc = validate(addCartItemSchema, parsed);
  if (!vc.success) return validationError(vc.error);
  const body = vc.data as Record<string, unknown>;

  const variantId = sanitizeInput((body.variant_id as string) || '', 100);
  const quantity = Math.max(1, Math.round(Number(body.quantity) || 1));
  if (!variantId) {
    return json({ error: 'Variante requise', message: 'Précise la variante à ajouter au panier.' }, 400);
  }
  if (!(await variantInTenant(env, clientId, variantId))) {
    return json(
      { error: 'Variante introuvable', message: `Cette variante n'existe pas ou n'appartient pas à ta boutique.` },
      404,
    );
  }

  const customerId = sanitizeInput((body.customer_id as string) || '', 100) || null;
  const token = sanitizeInput((body.token as string) || '', 100) || null;
  if (!customerId && !token) {
    return json(
      { error: 'Paramètre requis', message: 'Fournis customer_id ou token pour cibler un panier.' },
      400,
    );
  }

  let cart = await findActiveCart(env, clientId, customerId, token);
  if (!cart) {
    const newToken = token || `cart_${crypto.randomUUID()}`;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO carts (id, client_id, customer_id, token, status)
       VALUES (?, ?, ?, ?, 'active')`,
    ).bind(id, clientId, customerId, newToken).run();
    cart = { id, client_id: clientId, customer_id: customerId, token: newToken, status: 'active' };
  }

  const existing = (await env.DB.prepare(
    'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ?',
  ).bind(cart.id, variantId).first()) as { id: string; quantity: number } | null;

  if (existing) {
    await env.DB.prepare(
      'UPDATE cart_items SET quantity = quantity + ? WHERE id = ?',
    ).bind(quantity, existing.id).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO cart_items (id, cart_id, variant_id, quantity) VALUES (?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), cart.id, variantId, quantity).run();
  }
  await env.DB.prepare(
    "UPDATE carts SET updated_at = datetime('now') WHERE id = ?",
  ).bind(cart.id).run();

  return json({ data: await shapeCart(env, clientId, cart) }, 201);
}

/**
 * PATCH /api/ecommerce/cart/items/:id — body { quantity }
 * Met à jour la quantité d'une ligne (0 = supprime). Multi-tenant : la ligne
 * doit appartenir à un panier du tenant courant.
 */
export async function handleUpdateCartItem(
  request: Request, env: Env, auth: Auth, itemId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // S4 M2 — validation d'entrée AVANT la logique (early-return additif,
  // remplace la double-lecture try/catch). Le gate multi-tenant (404 cart)
  // reste APRÈS, prioritaire et intact.
  const parsed = await request.json().catch(() => null);
  const vq = validate(updateCartItemSchema, parsed);
  if (!vq.success) return validationError(vq.error);
  const body = vq.data as Record<string, unknown>;

  const cart = (await env.DB.prepare(
    `SELECT c.id, c.client_id, c.customer_id, c.token, c.status
       FROM cart_items ci
       JOIN carts c ON c.id = ci.cart_id
      WHERE ci.id = ? AND c.client_id = ?`,
  ).bind(itemId, clientId).first()) as CartRow | null;
  if (!cart) return json({ error: 'Ligne de panier introuvable' }, 404);

  const quantity = Math.max(0, Math.round(Number(body.quantity) || 0));
  if (quantity === 0) {
    await env.DB.prepare('DELETE FROM cart_items WHERE id = ?').bind(itemId).run();
  } else {
    await env.DB.prepare(
      'UPDATE cart_items SET quantity = ? WHERE id = ?',
    ).bind(quantity, itemId).run();
  }
  await env.DB.prepare(
    "UPDATE carts SET updated_at = datetime('now') WHERE id = ?",
  ).bind(cart.id).run();

  return json({ data: await shapeCart(env, clientId, cart) });
}

/**
 * DELETE /api/ecommerce/cart/items/:id — retire la ligne du panier.
 * Multi-tenant strict.
 */
export async function handleDeleteCartItem(
  env: Env, auth: Auth, itemId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const cart = (await env.DB.prepare(
    `SELECT c.id, c.client_id, c.customer_id, c.token, c.status
       FROM cart_items ci
       JOIN carts c ON c.id = ci.cart_id
      WHERE ci.id = ? AND c.client_id = ?`,
  ).bind(itemId, clientId).first()) as CartRow | null;
  if (!cart) return json({ error: 'Ligne de panier introuvable' }, 404);

  await env.DB.prepare('DELETE FROM cart_items WHERE id = ?').bind(itemId).run();
  await env.DB.prepare(
    "UPDATE carts SET updated_at = datetime('now') WHERE id = ?",
  ).bind(cart.id).run();

  return json({ data: await shapeCart(env, clientId, cart) });
}

// ════════════════════════════════════════════════════════════════════════════
// A2 — Conversion panier → commande (RÉUTILISE createOrderCore — zéro dup)
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/ecommerce/cart/:id/convert
 * body { email?, customer_id?, shipping_cents?, discount_cents?, note? }
 *
 * Mappe les cart_items en items:[{variant_id, quantity}] et délègue à
 * createOrderCore (contrat figé M1) : c'est LUI qui calcule TPS/TVQ, réserve
 * le stock et génère le numéro de commande. Au succès → cart status='converted'
 * + recovered_at. L'échec stock (409 de createOrderCore) est propagé proprement
 * SANS toucher le panier (il reste 'active', l'utilisateur peut ajuster).
 */
export async function handleConvertCart(
  request: Request, env: Env, auth: Auth, cartId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const cart = (await env.DB.prepare(
    `SELECT id, client_id, customer_id, token, status FROM carts
      WHERE id = ? AND client_id = ?`,
  ).bind(cartId, clientId).first()) as CartRow | null;
  if (!cart) return json({ error: 'Panier introuvable' }, 404);
  if (cart.status === 'converted') {
    return json(
      { error: 'Panier déjà converti', message: 'Ce panier a déjà donné lieu à une commande.' },
      409,
    );
  }

  const { results } = await env.DB.prepare(
    `SELECT ci.variant_id AS variant_id, ci.quantity AS quantity
       FROM cart_items ci
       JOIN product_variants v ON v.id = ci.variant_id
       JOIN products p ON p.id = v.product_id AND p.client_id = ?
      WHERE ci.cart_id = ?`,
  ).bind(clientId, cart.id).all();
  const cartLines = (results || []) as Array<{ variant_id: string; quantity: number }>;
  if (cartLines.length === 0) {
    return json(
      { error: 'Panier vide', message: 'Ajoute au moins un article avant de convertir le panier.' },
      400,
    );
  }

  // Résolution courriel : body > customer rattaché au panier > customer body.
  const customerId = sanitizeInput((body.customer_id as string) || '', 100)
    || cart.customer_id || null;
  let email = sanitizeInput((body.email as string) || '', 200);
  if (!email && customerId) {
    const c = (await env.DB.prepare(
      'SELECT email FROM customers WHERE id = ? AND client_id = ?',
    ).bind(customerId, clientId).first()) as { email: string } | null;
    email = c?.email || '';
  }
  if (!email) {
    return json(
      { error: 'Courriel requis', message: 'Un courriel est requis pour créer la commande.' },
      400,
    );
  }

  // ── Sprint 4 — résolution coupon EN AMONT (Manager-B) ──────────────────
  // SI un code promo est fourni, on calcule le `discount_cents` via le cœur
  // partagé resolveCouponDiscount (borné tenant, fenêtre/quota/plancher/
  // devise). Le montant remplace `body.discount_cents` et est passé au
  // paramètre EXISTANT de createOrderCore — createOrderCore et le calcul
  // total restent INCHANGÉS (§6.C : subtotal→-discount→taxe→+shipping).
  // Best-effort : table coupons absente / code invalide ⇒ pas de remise,
  // la conversion se poursuit (un code invalide ne bloque pas la commande).
  let discountCents = body.discount_cents as number | undefined;
  let appliedCouponId: string | null = null;
  const promoCode = sanitizeInput((body.code as string) || (body.coupon_code as string) || '', 60);
  if (promoCode) {
    // Sous-total panier (prix effectif × qté) — même source que shapeCart,
    // sert uniquement à vérifier le plancher min_order_cents du coupon.
    const { results: priced } = await env.DB.prepare(
      `SELECT ci.quantity AS quantity,
              COALESCE(v.price_override, p.base_price, 0) AS unit_price_cents
         FROM cart_items ci
         JOIN product_variants v ON v.id = ci.variant_id
         JOIN products p ON p.id = v.product_id AND p.client_id = ?
        WHERE ci.cart_id = ?`,
    ).bind(clientId, cart.id).all();
    const subtotalCents = ((priced || []) as Array<{ quantity: number; unit_price_cents: number }>)
      .reduce((s, ln) => s
        + Math.max(0, Math.round(ln.unit_price_cents || 0))
          * Math.max(1, Math.round(ln.quantity || 1)), 0);
    const couponCurrency = body.currency ? String(body.currency) : null;
    const resolved = await resolveCouponDiscount(
      env, clientId, promoCode, subtotalCents, couponCurrency,
    );
    if (resolved.valid && resolved.discount_cents > 0) {
      discountCents = resolved.discount_cents;
      appliedCouponId = resolved.couponId ?? null;
    }
  }

  try {
    const result = await createOrderCore(
      env,
      clientId,
      {
        customer_id: customerId,
        email,
        items: cartLines.map((l) => ({
          variant_id: l.variant_id,
          quantity: Math.max(1, Math.round(l.quantity || 1)),
        })),
        shipping_cents: body.shipping_cents as number,
        discount_cents: discountCents,
        note: body.note as string,
        source: 'cart',
      },
      auth.userId,
    );

    // Succès uniquement : on marque le panier converti (idempotent côté lecture).
    await env.DB.prepare(
      `UPDATE carts
          SET status = 'converted', recovered_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ? AND client_id = ?`,
    ).bind(cart.id, clientId).run();

    // Sprint 4 — incrémente le compteur d'usage du coupon appliqué
    // (best-effort, borné tenant, jamais bloquant). Uniquement APRÈS succès
    // de createOrderCore + marquage panier converti.
    if (appliedCouponId) {
      await incrementCouponUsage(env, clientId, appliedCouponId);
    }

    return json(
      {
        data: {
          order_id: result.id,
          order_number: result.order_number,
          total_cents: result.total_cents,
        },
      },
      201,
    );
  } catch (e) {
    // createOrderCore lève une OrderError (409 stock, 404 variante, 400…).
    // On NE corrompt PAS le panier : il reste 'active' pour ajustement.
    const err = e as { status?: number; payload?: Record<string, unknown> };
    if (err && typeof err.status === 'number' && err.payload) {
      return json(err.payload, err.status);
    }
    throw e;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// A3 — Historique des commandes d'un client (Customer 360 / dashboard M3)
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ecommerce/customers/:id/orders
 * Commandes d'un client boutique (multi-tenant strict), plus récentes d'abord,
 * + items_count. Utile au panneau Customer 360 et au dashboard Boutique (M3).
 */
export async function handleCustomerOrders(
  env: Env, auth: Auth, customerId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const customer = await env.DB.prepare(
    'SELECT id FROM customers WHERE id = ? AND client_id = ?',
  ).bind(customerId, clientId).first();
  if (!customer) return json({ error: 'Client boutique introuvable' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT o.*,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
       FROM orders o
      WHERE o.customer_id = ? AND o.client_id = ?
      ORDER BY o.created_at DESC`,
  ).bind(customerId, clientId).all();

  return json({ data: results || [], total: (results || []).length });
}
