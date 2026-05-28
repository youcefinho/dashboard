// ── storefront-public.ts — LOT STOREFRONT CHECKOUT (Sprint 7) ──────────────
//
// Tunnel acheteur PUBLIC du module e-commerce (B2) : storefront par slug →
// panier anonyme (token) → checkout (adresse/livraison/récap taxes+frais) →
// paiement MOCK → confirmation. Fichier NEUF et ISOLÉ — N'ÉTEND PAS et NE
// MODIFIE PAS les cœurs e-commerce existants (ecommerce-orders.ts /
// ecommerce-cart.ts / ecommerce-payments.ts / ecommerce-refunds.ts /
// ecommerce-cart-recovery.ts) : il les RÉUTILISE PAR IMPORT uniquement (calque
// EXACT du pattern booking-public.ts qui réutilise forms.ts sans le toucher).
//
// ⚠ CORPS RÉELS PHASE B — Manager-B SOLO sur ce fichier. Les signatures
//   (ordre/typage des params, forme de la Response) NE CHANGENT PAS : worker.ts
//   (GELÉ Phase A) câble déjà ces handlers ; src/lib/api.ts (GELÉ Phase A) appelle
//   les endpoints. Contrat §6 verbatim dans docs/LOT-STOREFRONT-CHECKOUT.md
//   (Phase B/C ne lisent QUE ce document + le CODE, jamais le brief).
//
// Conventions imposées (docs/LOT-STOREFRONT-CHECKOUT.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur. JAMAIS
//     de champ `code` (apiFetch / ApiResponse GELÉS — §6.A).
//   - Routes PUBLIQUES = AUCUNE auth, AUCUNE capability. Bornage tenant STRICT :
//     resolveStoreClientId(slug) résout clients.store_slug → clients.id ; TOUTE
//     route publique borne ses requêtes sur ce client_id (anti-fuite cross-tenant).
//     Slug introuvable / vitrine désactivée ⇒ 404 (jamais de 500/throw nu).
//   - Cart PUBLIC par TOKEN : logique calquée sur ecommerce-cart.ts MAIS le
//     clientId vient de resolveStoreClientId(slug), JAMAIS de getClientModules(
//     auth.userId) (pas d'auth ici). Tables carts/cart_items réutilisées telles
//     quelles (DEFAULT SQL E1 pour les id).
//   - Checkout = createOrderCore (CONTRAT FIGÉ, import) en GUEST (email sans
//     customer_id), source 'storefront', tax_region/tax_country passés depuis
//     l'adresse. createOrderCore produit DÉJÀ status='pending' /
//     financial_status='unpaid' / fulfillment_status='unfulfilled' — on N'INVENTE
//     AUCUN statut, on NE touche AUCUN CHECK orders/payments.
//   - Livraison/taxe/coupon : RÉUTILISE resolveShippingRate / computeTax /
//     resolveCouponDiscount PAR IMPORT (montant résolu passé à shipping_cents /
//     discount_cents de createOrderCore — qui recalcule la taxe en interne).
//     Ces cœurs ne sont JAMAIS modifiés.
//   - ⚠ E4/E6 PAIEMENT INACTIF IMPÉRATIF : le checkout public NE DOIT JAMAIS
//     activer un paiement réel. payments_live_enabled=0 ⇒ MOCK ; pas de
//     credentials ⇒ MOCK. ZÉRO stockage de carte (PAN/CVV) — PCI/RGPD, revue
//     légale requise avant prod. La commande reste 'pending'/'unpaid'.
//   - Settings PRO (handleGetStoreSettings / handleSaveStoreSettings) : capability
//     EXISTANTE 'settings.manage' (réutilisée — calque SMS/WhatsApp/IVR/OAuth ;
//     AUCUN ajout à ALL_CAPABILITIES) appliquée DANS le handler (capGuard) +
//     bornage tenant. Lit/écrit clients.store_slug / clients.store_settings_json.
//   - best-effort : table/colonne absente → réponse propre (404 / {data:[]}),
//     JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { requireCapability, type CapAuth } from './capabilities';
import { getClientModules } from './modules';
// Cœurs e-commerce RÉUTILISÉS PAR IMPORT (JAMAIS modifiés) — Manager-B câble les
// corps réels avec ces signatures EXACTES (vérifiées dans le CODE, cf. §6.C) :
//   createOrderCore(env, clientId, input, createdBy?) : Promise<CreateOrderResult>
//     input = { customer_id?, email, items:[{variant_id, quantity}], shipping_cents?,
//               discount_cents?, note?, source?, tax_region?, tax_country? }
//     → { id, order_number, subtotal_cents, tps_cents, tvq_cents, total_cents }
//       (status='pending'/financial='unpaid'/fulfillment='unfulfilled' figés ;
//        autoEnrollForTrigger 'order_created' câblé DANS le cœur). Lève OrderError
//       { status, payload } (409 stock / 404 variante / 400 vide).
//   resolveShippingRate(env, clientId, { country?, weight_grams?, subtotal_cents?, currency? })
//     → { zone_id, rate_id, name, price_cents, matched }  (JAMAIS de throw)
//   computeTax(regime, subtotalCents, { country? }) : TaxResult { lines, totalTaxCents, taxInclusive }
//   resolveCouponDiscount(env, clientId, code, subtotalCents, currency?)
//     → { valid, discount_cents, code?, reason?, couponId? }  (JAMAIS de throw)
//   incrementCouponUsage(env, clientId, couponId) : Promise<void>  (best-effort)
import { createOrderCore } from './ecommerce-orders';
import { resolveShippingRate } from './ecommerce-shipping-zones';
import { computeTax, type TaxRegime } from './ecommerce-tax-engine';
import { resolveCouponDiscount, incrementCouponUsage } from './ecommerce-coupons';
import { resolveTierPrice } from './lib/pricing-engine';

// Auth enrichi au choke-point (worker.ts) pour les routes PRO settings — calque
// le type passé à routeProtected (userId/role/clientId/tenant/capabilities).
export type StoreAuth = CapAuth & { capabilities?: Set<string> };

// ════════════════════════════════════════════════════════════════════════════
// HELPER DE BORNAGE TENANT — résolution slug → client_id (anti-fuite)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Résout le client_id du tenant propriétaire de la boutique `slug`
 * (clients.store_slug → clients.id). Borne tenant de TOUTES les routes
 * publiques storefront : un slug inconnu (ou vitrine désactivée — Manager-B
 * vérifie store_settings_json.enabled) renvoie null ⇒ le handler répond 404,
 * JAMAIS de fuite cross-tenant. Best-effort : toute erreur DB ⇒ null.
 *
 * NOTE Manager-B : ce helper est le SEUL point d'entrée tenant pour le public.
 * Ne JAMAIS lire getClientModules(auth.userId) ici (aucune auth publique).
 */
export async function resolveStoreClientId(
  env: Env,
  slug: string,
): Promise<string | null> {
  const clean = sanitizeInput(slug || '', 200);
  if (!clean) return null;
  try {
    const row = (await env.DB.prepare(
      'SELECT id, store_settings_json FROM clients WHERE store_slug = ?',
    ).bind(clean).first()) as { id: string; store_settings_json: string | null } | null;
    if (!row?.id) return null;
    // Vitrine désactivée (enabled !== true) ⇒ traitée comme introuvable (404,
    // anti-fuite). Absence de réglages = vitrine non publiée ⇒ désactivée.
    const settings = parseStoreSettingsJson(row.store_settings_json);
    if (!settings.enabled) return null;
    return row.id;
  } catch {
    // Colonne store_slug absente (seq 108 non jouée) — best-effort.
    return null;
  }
}

// Garde capability PRO (calque booking-public.ts:capGuard). Réutilise
// 'settings.manage' (déjà dans ALL_CAPABILITIES seq 80). AUCUN ajout.
function capGuard(auth: StoreAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS internes (privés — zéro export hors signatures FIGÉES)
// ════════════════════════════════════════════════════════════════════════════

/** Décode store_settings_json en réglages tolérants (best-effort). */
function parseStoreSettingsJson(
  raw: string | null | undefined,
): { name?: string; currency?: string; enabled: boolean } {
  if (!raw) return { enabled: false };
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: typeof obj.name === 'string' ? obj.name : undefined,
      currency: typeof obj.currency === 'string' ? obj.currency : undefined,
      enabled: obj.enabled === true,
    };
  } catch {
    return { enabled: false };
  }
}

/**
 * Mappe le pays ISO (alpha-2) de l'adresse → régime fiscal du moteur
 * (createOrderCore validera quand même contre l'enum, fallback 'qc'). Carte
 * MINIMALE (CA→qc, DZ→dz, pays UE→eu) ; pays inconnu ⇒ undefined ⇒
 * createOrderCore retombe sur son défaut 'qc' (rétro-compat). On NE duplique
 * AUCUNE formule fiscale — seule la SÉLECTION du régime est ici.
 */
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);
function regimeForCountry(country: string | null | undefined): TaxRegime | undefined {
  const c = String(country || '').toUpperCase().trim();
  if (!/^[A-Z]{2}$/.test(c)) return undefined;
  if (c === 'CA') return 'qc';
  if (c === 'DZ') return 'dz';
  if (EU_COUNTRIES.has(c)) return 'eu';
  return undefined; // ⇒ createOrderCore défaut 'qc'
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
  product_id: string;
  product_title: string;
  variant_title: string | null;
  unit_price_cents: number;
}

/**
 * Charge les lignes du panier (bornées tenant via JOIN p.client_id = clientId)
 * + prix effectif (price_override ?? base_price). Calque shapeCart
 * (ecommerce-cart.ts) mais SANS auth — projection PublicCart. Le variant_id
 * est porté tel quel (les items du panier stockent DÉJÀ variant_id : voir
 * cart_items.variant_id → product_variants → products borné client_id ; la
 * résolution product→variant n'a donc PAS lieu au checkout, le panier porte
 * directement le variant_id, conforme à items:[{variant_id, quantity}] de
 * createOrderCore).
 */
async function loadCartLines(
  env: Env, clientId: string, cartId: string, customerId?: string | null,
): Promise<CartLineRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT ci.id AS id, ci.variant_id AS variant_id, ci.quantity AS quantity,
            p.id AS product_id, p.title AS product_title, v.title AS variant_title,
            COALESCE(v.price_override, p.base_price, 0) AS unit_price_cents
       FROM cart_items ci
       JOIN product_variants v ON v.id = ci.variant_id
       JOIN products p ON p.id = v.product_id AND p.client_id = ?
      WHERE ci.cart_id = ?
      ORDER BY ci.added_at ASC`,
  ).bind(clientId, cartId).all();
  const lines = (results || []) as unknown as CartLineRow[];
  if (customerId && lines.length > 0) {
    for (const line of lines) {
      try {
        const resolved = await resolveTierPrice(env, line.variant_id, customerId, line.quantity);
        if (resolved && resolved.group_applied) {
          line.unit_price_cents = resolved.price_cents;
        }
      } catch {
        // Fallback
      }
    }
  }
  return lines;
}

/** Construit la projection PublicCart (token + items + subtotal). */
function shapePublicCart(
  cart: CartRow, lines: CartLineRow[], currency?: string,
): { token: string; items: PublicCartItem[]; subtotal_cents: number; currency?: string } {
  let subtotalCents = 0;
  const items: PublicCartItem[] = lines.map((ln) => {
    const unit = Math.max(0, Math.round(ln.unit_price_cents || 0));
    const qty = Math.max(1, Math.round(ln.quantity || 1));
    subtotalCents += unit * qty;
    return {
      id: ln.id,
      product_id: ln.product_id,
      variant_id: ln.variant_id,
      name: ln.variant_title ? `${ln.product_title} — ${ln.variant_title}` : ln.product_title,
      price_cents: unit,
      qty,
    };
  });
  return currency
    ? { token: cart.token, items, subtotal_cents: subtotalCents, currency }
    : { token: cart.token, items, subtotal_cents: subtotalCents };
}

type PublicCartItem = {
  id?: string;
  product_id?: string;
  variant_id?: string;
  name: string;
  price_cents: number;
  qty: number;
};

/** Cherche le panier actif du tenant par token (ne crée pas). */
async function findActiveCartByToken(
  env: Env, clientId: string, token: string | null,
): Promise<CartRow | null> {
  if (!token) return null;
  return (await env.DB.prepare(
    `SELECT id, client_id, customer_id, token, status FROM carts
      WHERE token = ? AND client_id = ? AND status = 'active'`,
  ).bind(token, clientId).first()) as CartRow | null;
}

/** Crée un panier actif anonyme (token cart_<uuid> si absent). */
async function createCart(
  env: Env, clientId: string, token: string | null,
): Promise<CartRow> {
  const newToken = token || `cart_${crypto.randomUUID()}`;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO carts (id, client_id, customer_id, token, status)
     VALUES (?, ?, NULL, ?, 'active')`,
  ).bind(id, clientId, newToken).run();
  return { id, client_id: clientId, customer_id: null, token: newToken, status: 'active' };
}

/** Vérifie qu'une variante appartient à un produit ACTIF du tenant. */
async function variantInTenant(
  env: Env, clientId: string, variantId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT v.id FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = ? AND p.client_id = ? AND p.status = 'active'`,
  ).bind(variantId, clientId).first();
  return !!row;
}

/** Devise effective de la boutique (best-effort, fallback CAD). */
async function storeCurrency(env: Env, clientId: string): Promise<string> {
  try {
    const row = (await env.DB.prepare(
      'SELECT default_currency FROM clients WHERE id = ?',
    ).bind(clientId).first()) as { default_currency: string | null } | null;
    return (row?.default_currency || 'CAD').toString().toUpperCase();
  } catch {
    return 'CAD';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// STUBS → CORPS RÉELS Phase B (Manager-B). Signatures FIGÉES Phase A.
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/store/:slug/products — vitrine publique (produits actifs). */
export async function handleStoreProducts(
  env: Env, slug: string, _url: URL,
): Promise<Response> {
  const clientId = await resolveStoreClientId(env, slug);
  if (!clientId) return json({ error: 'Boutique introuvable' }, 404);
  try {
    const currency = await storeCurrency(env, clientId);
    // Réglages vitrine (nom) — déjà chargés via le slug ; relit pour le store.
    const storeRow = (await env.DB.prepare(
      'SELECT store_slug, store_settings_json FROM clients WHERE id = ?',
    ).bind(clientId).first()) as
      { store_slug: string | null; store_settings_json: string | null } | null;
    const settings = parseStoreSettingsJson(storeRow?.store_settings_json);
    const store = {
      slug: storeRow?.store_slug || slug,
      name: settings.name || '',
      currency: settings.currency || currency,
      enabled: settings.enabled,
    };

    // Produits ACTIFS bornés client_id (calque handlePublicListProducts MAIS
    // borné par slug, pas par clé API). Prix = base_price (prix d'appel) ;
    // image principale ; in_stock = stock dispo agrégé > 0 (LEFT JOIN inventory).
    const { results } = await env.DB.prepare(
      `SELECT p.id AS id, p.slug AS slug, p.title AS name, p.description AS description,
              p.base_price AS price_cents, p.currency AS currency,
              (SELECT url FROM product_images i WHERE i.product_id = p.id
                 ORDER BY i.position ASC LIMIT 1) AS image,
              (SELECT COALESCE(SUM(iv.quantity - iv.reserved), 0)
                 FROM product_variants v
                 LEFT JOIN inventory iv ON iv.variant_id = v.id
                WHERE v.product_id = p.id) AS stock_available
         FROM products p
        WHERE p.client_id = ? AND p.status = 'active'
        ORDER BY p.created_at DESC`,
    ).bind(clientId).all();

    const products = ((results || []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      slug: String(r.slug || ''),
      name: String(r.name || ''),
      description: String(r.description || ''),
      price_cents: Math.max(0, Math.round(Number(r.price_cents) || 0)),
      currency: (r.currency ? String(r.currency) : currency),
      image: r.image ? String(r.image) : null,
      in_stock: Number(r.stock_available) > 0,
    }));

    return json({ data: { store, products } });
  } catch {
    return json({ data: { store: { slug, name: '', currency: 'CAD', enabled: true }, products: [] } });
  }
}

/** GET /api/store/:slug/products/:pslug — fiche produit publique. */
export async function handleStoreProduct(
  env: Env, slug: string, pslug: string, url?: URL,
): Promise<Response> {
  const clientId = await resolveStoreClientId(env, slug);
  if (!clientId) return json({ error: 'Boutique introuvable' }, 404);
  try {
    const cleanPslug = sanitizeInput(pslug || '', 200);
    const currency = await storeCurrency(env, clientId);

    // Résolution customerId
    let customerId: string | null = null;
    if (url) {
      const customerIdParam = url.searchParams.get('customer_id');
      if (customerIdParam) {
        customerId = sanitizeInput(customerIdParam, 100);
      } else {
        const token = url.searchParams.get('token');
        if (token) {
          const cart = await findActiveCartByToken(env, clientId, token);
          if (cart?.customer_id) {
            customerId = cart.customer_id;
          }
        }
      }
    }

    // Produit ACTIF borné client_id + slug (calque handlePublicGetProduct).
    const product = (await env.DB.prepare(
      `SELECT id, slug, title, description, base_price, currency
         FROM products
        WHERE client_id = ? AND slug = ? AND status = 'active'`,
    ).bind(clientId, cleanPslug).first()) as
      {
        id: string; slug: string; title: string; description: string | null;
        base_price: number; currency: string | null;
      } | null;
    if (!product) return json({ error: 'Produit introuvable' }, 404);

    // Variantes + stock (prix effectif price_override ?? base_price).
    const { results: variantRows } = await env.DB.prepare(
      `SELECT v.id AS variant_id, v.title AS title, v.price_override AS price_override,
              COALESCE(iv.quantity - iv.reserved, 0) AS available
         FROM product_variants v
         LEFT JOIN inventory iv ON iv.variant_id = v.id
        WHERE v.product_id = ?
        ORDER BY v.position ASC, v.created_at ASC`,
    ).bind(product.id).all();

    const variants = [];
    for (const v of (variantRows || []) as Array<Record<string, unknown>>) {
      let priceCents = v.price_override != null
        ? Math.max(0, Math.round(Number(v.price_override)))
        : Math.max(0, Math.round(Number(product.base_price) || 0));

      if (customerId) {
        try {
          const resolved = await resolveTierPrice(env, String(v.variant_id), customerId, 1);
          if (resolved && resolved.group_applied) {
            priceCents = resolved.price_cents;
          }
        } catch {
          // ignore
        }
      }

      variants.push({
        variant_id: String(v.variant_id),
        title: v.title != null ? String(v.title) : null,
        price_cents: priceCents,
        in_stock: Number(v.available) > 0,
      });
    }

    const image = (await env.DB.prepare(
      `SELECT url FROM product_images WHERE product_id = ?
        ORDER BY position ASC LIMIT 1`,
    ).bind(product.id).first()) as { url: string } | null;

    const data = {
      id: product.id,
      slug: product.slug,
      name: product.title,
      description: product.description || '',
      price_cents: Math.max(0, Math.round(Number(product.base_price) || 0)),
      currency: product.currency || currency,
      image: image?.url || null,
      in_stock: variants.some((v) => v.in_stock),
      variants,
    };
    return json({ data });
  } catch {
    return json({ error: 'Produit introuvable' }, 404);
  }
}

/** GET /api/store/:slug/cart?token= — panier public anonyme. */
export async function handleStoreGetCart(
  env: Env, slug: string, url: URL,
): Promise<Response> {
  const clientId = await resolveStoreClientId(env, slug);
  if (!clientId) return json({ error: 'Boutique introuvable' }, 404);
  try {
    const token = sanitizeInput(url.searchParams.get('token') || '', 100) || null;
    const currency = await storeCurrency(env, clientId);
    let cart = await findActiveCartByToken(env, clientId, token);
    if (!cart) cart = await createCart(env, clientId, token);

    let customerId = cart.customer_id;
    const customerIdParam = url.searchParams.get('customer_id');
    if (customerIdParam) {
      customerId = sanitizeInput(customerIdParam, 100);
      if (customerId && cart.customer_id !== customerId) {
        await env.DB.prepare(
          'UPDATE carts SET customer_id = ? WHERE id = ?',
        ).bind(customerId, cart.id).run();
        cart.customer_id = customerId;
      }
    }

    const lines = await loadCartLines(env, clientId, cart.id, customerId);
    return json({ data: shapePublicCart(cart, lines, currency) });
  } catch {
    return json({ data: { token: '', items: [], subtotal_cents: 0 } });
  }
}

/** POST /api/store/:slug/cart — ajoute une variante au panier public. */
export async function handleStoreAddCartItem(
  request: Request, env: Env, slug: string,
): Promise<Response> {
  const clientId = await resolveStoreClientId(env, slug);
  if (!clientId) return json({ error: 'Boutique introuvable' }, 404);
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: 'Requête invalide' }, 400);

    // Le panier stocke des VARIANTES (cart_items.variant_id). Le front public
    // peut envoyer variant_id direct (fiche produit) ou seulement product_id
    // (carte vitrine) — dans ce dernier cas on résout la 1re variante du produit
    // ACTIF du tenant (résolution product→variant ICI, à l'ajout, conforme au
    // §6.C : le checkout n'a alors plus rien à résoudre).
    let variantId = sanitizeInput((body.variant_id as string) || '', 100);
    const productId = sanitizeInput((body.product_id as string) || '', 100);
    if (!variantId && productId) {
      const v = (await env.DB.prepare(
        `SELECT v.id FROM product_variants v
           JOIN products p ON p.id = v.product_id
          WHERE p.id = ? AND p.client_id = ? AND p.status = 'active'
          ORDER BY v.position ASC, v.created_at ASC LIMIT 1`,
      ).bind(productId, clientId).first()) as { id: string } | null;
      variantId = v?.id || '';
    }
    if (!variantId) {
      return json({ error: 'Variante requise' }, 400);
    }
    if (!(await variantInTenant(env, clientId, variantId))) {
      return json({ error: 'Variante introuvable' }, 404);
    }

    const qty = Math.max(1, Math.round(Number(body.qty ?? body.quantity) || 1));
    const token = sanitizeInput((body.cart_token as string) || (body.token as string) || '', 100) || null;
    const currency = await storeCurrency(env, clientId);
    const customerId = sanitizeInput((body.customer_id as string) || '', 100) || null;

    let cart = await findActiveCartByToken(env, clientId, token);
    if (!cart) cart = await createCart(env, clientId, token);

    if (customerId && cart.customer_id !== customerId) {
      await env.DB.prepare(
        'UPDATE carts SET customer_id = ? WHERE id = ?',
      ).bind(customerId, cart.id).run();
      cart.customer_id = customerId;
    }

    const existing = (await env.DB.prepare(
      'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ?',
    ).bind(cart.id, variantId).first()) as { id: string; quantity: number } | null;
    if (existing) {
      await env.DB.prepare(
        'UPDATE cart_items SET quantity = quantity + ? WHERE id = ?',
      ).bind(qty, existing.id).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO cart_items (id, cart_id, variant_id, quantity) VALUES (?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), cart.id, variantId, qty).run();
    }
    await env.DB.prepare(
      "UPDATE carts SET updated_at = datetime('now') WHERE id = ?",
    ).bind(cart.id).run();

    const lines = await loadCartLines(env, clientId, cart.id, cart.customer_id);
    return json({ data: shapePublicCart(cart, lines, currency) }, 201);
  } catch {
    return json({ error: 'Ajout impossible' }, 400);
  }
}

/** PATCH /api/store/:slug/cart/:itemId — maj quantité (0 = retire). */
export async function handleStoreUpdateCartItem(
  request: Request, env: Env, slug: string, itemId: string,
): Promise<Response> {
  const clientId = await resolveStoreClientId(env, slug);
  if (!clientId) return json({ error: 'Boutique introuvable' }, 404);
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    // La ligne DOIT appartenir à un panier ACTIF du tenant (anti-fuite).
    const cart = (await env.DB.prepare(
      `SELECT c.id, c.client_id, c.customer_id, c.token, c.status
         FROM cart_items ci
         JOIN carts c ON c.id = ci.cart_id
        WHERE ci.id = ? AND c.client_id = ? AND c.status = 'active'`,
    ).bind(itemId, clientId).first()) as CartRow | null;
    if (!cart) return json({ error: 'Ligne de panier introuvable' }, 404);

    const qty = Math.max(0, Math.round(Number(body?.qty ?? body?.quantity) || 0));
    if (qty === 0) {
      await env.DB.prepare('DELETE FROM cart_items WHERE id = ?').bind(itemId).run();
    } else {
      await env.DB.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').bind(qty, itemId).run();
    }
    await env.DB.prepare(
      "UPDATE carts SET updated_at = datetime('now') WHERE id = ?",
    ).bind(cart.id).run();

    const currency = await storeCurrency(env, clientId);
    const lines = await loadCartLines(env, clientId, cart.id, cart.customer_id);
    return json({ data: shapePublicCart(cart, lines, currency) });
  } catch {
    return json({ error: 'Mise à jour impossible' }, 400);
  }
}

/** DELETE /api/store/:slug/cart/:itemId — retire une ligne. */
export async function handleStoreDeleteCartItem(
  env: Env, slug: string, itemId: string, _url: URL,
): Promise<Response> {
  const clientId = await resolveStoreClientId(env, slug);
  if (!clientId) return json({ error: 'Boutique introuvable' }, 404);
  try {
    const cart = (await env.DB.prepare(
      `SELECT c.id, c.client_id, c.customer_id, c.token, c.status
         FROM cart_items ci
         JOIN carts c ON c.id = ci.cart_id
        WHERE ci.id = ? AND c.client_id = ? AND c.status = 'active'`,
    ).bind(itemId, clientId).first()) as CartRow | null;
    if (!cart) return json({ error: 'Ligne de panier introuvable' }, 404);

    await env.DB.prepare('DELETE FROM cart_items WHERE id = ?').bind(itemId).run();
    await env.DB.prepare(
      "UPDATE carts SET updated_at = datetime('now') WHERE id = ?",
    ).bind(cart.id).run();

    const currency = await storeCurrency(env, clientId);
    const lines = await loadCartLines(env, clientId, cart.id, cart.customer_id);
    return json({ data: shapePublicCart(cart, lines, currency) });
  } catch {
    return json({ error: 'Suppression impossible' }, 400);
  }
}

/** POST /api/store/:slug/shipping-quote — devis livraison + aperçu taxes. */
export async function handleStoreShippingQuote(
  request: Request, env: Env, slug: string,
): Promise<Response> {
  const clientId = await resolveStoreClientId(env, slug);
  if (!clientId) return json({ error: 'Boutique introuvable' }, 404);
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const address = (body.address as Record<string, unknown> | undefined) || {};
    const country = sanitizeInput(
      (address.country as string) || (body.country as string) || '', 2,
    ).toUpperCase();
    const token = sanitizeInput((body.cart_token as string) || (body.token as string) || '', 100) || null;
    const currency = await storeCurrency(env, clientId);
    const customerId = sanitizeInput((body.customer_id as string) || '', 100) || null;

    // Sous-total panier (token) borné tenant.
    let subtotalCents = 0;
    let weightGrams: number | null = null;
    const cart = await findActiveCartByToken(env, clientId, token);
    if (cart) {
      if (customerId && cart.customer_id !== customerId) {
        await env.DB.prepare(
          'UPDATE carts SET customer_id = ? WHERE id = ?',
        ).bind(customerId, cart.id).run();
        cart.customer_id = customerId;
      }
      const lines = await loadCartLines(env, clientId, cart.id, cart.customer_id);
      for (const ln of lines) {
        subtotalCents += Math.max(0, Math.round(ln.unit_price_cents || 0))
          * Math.max(1, Math.round(ln.quantity || 1));
      }
      // Poids total best-effort (somme des poids variantes × qté).
      try {
        const { results: wr } = await env.DB.prepare(
          `SELECT ci.quantity AS quantity, v.weight_grams AS weight_grams
             FROM cart_items ci
             JOIN product_variants v ON v.id = ci.variant_id
             JOIN products p ON p.id = v.product_id AND p.client_id = ?
            WHERE ci.cart_id = ?`,
        ).bind(clientId, cart.id).all();
        let w = 0; let has = false;
        for (const r of ((wr || []) as Array<{ quantity: number; weight_grams: number | null }>)) {
          if (r.weight_grams != null) { has = true; w += Math.max(0, r.weight_grams) * Math.max(1, r.quantity); }
        }
        if (has) weightGrams = w;
      } catch { /* poids optionnel */ }
    }

    // Livraison RÉUTILISÉE PAR IMPORT (jamais de throw → matched=false ⇒ 0).
    const ship = await resolveShippingRate(env, clientId, {
      country: country || null,
      weight_grams: weightGrams,
      subtotal_cents: subtotalCents,
      currency,
    });

    // APERÇU taxe uniquement (le checkout laisse createOrderCore recalculer —
    // §6.I.8 : NE PAS double-compter). Régime déduit du pays, fallback 'qc'.
    const regime = regimeForCountry(country) || 'qc';
    const tax = computeTax(regime, subtotalCents, { country: country || undefined });
    const taxCents = tax.totalTaxCents;

    // Total aperçu : tax-inclusive (UE) ⇒ taxe déjà dans le sous-total.
    const totalCents = tax.taxInclusive
      ? subtotalCents + ship.price_cents
      : subtotalCents + taxCents + ship.price_cents;

    return json({
      data: {
        shipping_cents: ship.price_cents,
        shipping_name: ship.name,
        tax_cents: taxCents,
        subtotal_cents: subtotalCents,
        total_cents: totalCents,
        currency,
      },
    });
  } catch {
    return json({
      data: {
        shipping_cents: 0, shipping_name: null,
        tax_cents: 0, subtotal_cents: 0, total_cents: 0,
      },
    });
  }
}

/** POST /api/store/:slug/checkout — conversion panier → commande (MOCK pay). */
export async function handleStoreCheckout(
  request: Request, env: Env, slug: string,
): Promise<Response> {
  const clientId = await resolveStoreClientId(env, slug);
  if (!clientId) return json({ error: 'Boutique introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const email = sanitizeInput((body.email as string) || '', 200);
  if (!email) return json({ error: 'Courriel requis' }, 400);

  const address = (body.address as Record<string, unknown> | undefined) || {};
  const country = sanitizeInput((address.country as string) || '', 2).toUpperCase();
  const token = sanitizeInput((body.cart_token as string) || '', 100) || null;
  if (!token) return json({ error: 'Panier requis' }, 400);

  // Panier ACTIF borné tenant (anti-fuite) + lignes (variant_id porté tel quel
  // — pas de résolution product→variant ici, le cart stocke déjà des variant_id).
  const cart = await findActiveCartByToken(env, clientId, token);
  if (!cart) return json({ error: 'Panier introuvable' }, 404);

  // Résolution du customer_id
  let customerId = cart.customer_id || sanitizeInput((body.customer_id as string) || '', 100) || null;
  if (!customerId && email) {
    try {
      const custRow = await env.DB.prepare(
        'SELECT id FROM customers WHERE email = ? AND client_id = ? LIMIT 1',
      ).bind(email, clientId).first() as { id: string } | null;
      if (custRow) customerId = custRow.id;
    } catch { /* best-effort */ }
  }

  // Mettre à jour le panier avec le customerId s'il a changé
  if (customerId && cart.customer_id !== customerId) {
    await env.DB.prepare(
      'UPDATE carts SET customer_id = ? WHERE id = ?',
    ).bind(customerId, cart.id).run();
    cart.customer_id = customerId;
  }

  const lines = await loadCartLines(env, clientId, cart.id, cart.customer_id);
  if (lines.length === 0) return json({ error: 'Panier vide' }, 400);

  const currency = await storeCurrency(env, clientId);
  let subtotalCents = 0;
  for (const ln of lines) {
    subtotalCents += Math.max(0, Math.round(ln.unit_price_cents || 0))
      * Math.max(1, Math.round(ln.quantity || 1));
  }

  // Coupon RÉUTILISÉ PAR IMPORT (best-effort : code invalide ⇒ pas de remise,
  // le checkout se poursuit). discount_cents passé au paramètre EXISTANT de
  // createOrderCore (la taxe RÉELLE est recalculée par le cœur — §6.I.8).
  let discountCents: number | undefined;
  let appliedCouponId: string | null = null;
  const couponCode = sanitizeInput((body.coupon_code as string) || '', 60);
  if (couponCode) {
    const resolved = await resolveCouponDiscount(env, clientId, couponCode, subtotalCents, currency);
    if (resolved.valid && resolved.discount_cents > 0) {
      discountCents = resolved.discount_cents;
      appliedCouponId = resolved.couponId ?? null;
    }
  }

  // Livraison RÉUTILISÉE PAR IMPORT (matched=false ⇒ price_cents=0, repli).
  let weightGrams: number | null = null;
  try {
    const { results: wr } = await env.DB.prepare(
      `SELECT ci.quantity AS quantity, v.weight_grams AS weight_grams
         FROM cart_items ci
         JOIN product_variants v ON v.id = ci.variant_id
         JOIN products p ON p.id = v.product_id AND p.client_id = ?
        WHERE ci.cart_id = ?`,
    ).bind(clientId, cart.id).all();
    let w = 0; let has = false;
    for (const r of ((wr || []) as Array<{ quantity: number; weight_grams: number | null }>)) {
      if (r.weight_grams != null) { has = true; w += Math.max(0, r.weight_grams) * Math.max(1, r.quantity); }
    }
    if (has) weightGrams = w;
  } catch { /* poids optionnel */ }
  const ship = await resolveShippingRate(env, clientId, {
    country: country || null,
    weight_grams: weightGrams,
    subtotal_cents: subtotalCents,
    currency,
  });

  // tax_region/tax_country depuis l'adresse (sinon défaut 'qc' côté cœur).
  const taxRegion = regimeForCountry(country);
  const taxCountry = /^[A-Z]{2}$/.test(country) ? country : undefined;

  // ── E4/E6 PAIEMENT MOCK IMPÉRATIF ───────────────────────────────────────
  // AUCUN appel de paiement réel (pas d'import ecommerce-payments / pas d'init
  // provider). ZÉRO carte (PAN/CVV) lue/stockée. createOrderCore crée la
  // commande en 'pending'/'unpaid'/'unfulfilled' — le tunnel public N'INVENTE
  // AUCUN statut. Le wiring autoEnrollForTrigger('order_created', …) se
  // déclenche AUTOMATIQUEMENT DANS createOrderCore (rien à câbler ici).
  try {
    const result = await createOrderCore(
      env,
      clientId,
      {
        customer_id: cart.customer_id,      // Client résolu (B2B ou enregistré) ou null.
        email,
        items: lines.map((l) => ({
          variant_id: l.variant_id,
          quantity: Math.max(1, Math.round(l.quantity || 1)),
        })),
        shipping_cents: ship.price_cents,
        discount_cents: discountCents,
        note: sanitizeInput((body.name as string) || '', 200)
          ? `Storefront — ${sanitizeInput((body.name as string) || '', 200)}`
          : undefined,
        source: 'storefront',
        tax_region: taxRegion,
        tax_country: taxCountry,
        shipping_address: address,
        billing_address: body.billing_address || address,
      },
      // Pas de createdBy (acheteur anonyme). L'audit createOrderCore est skip.
    );

    // Succès uniquement : panier converti (idempotent côté lecture).
    await env.DB.prepare(
      `UPDATE carts SET status = 'converted', recovered_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ? AND client_id = ?`,
    ).bind(cart.id, clientId).run();

    if (appliedCouponId) {
      await incrementCouponUsage(env, clientId, appliedCouponId);
    }

    // CheckoutResult — status verbatim createOrderCore ('pending'/'unpaid').
    return json({
      data: {
        order_id: result.id,
        order_number: result.order_number,
        total_cents: result.total_cents,
        status: 'pending',
      },
    }, 201);
  } catch (e) {
    // createOrderCore lève une OrderError { status, payload } (409 stock, 404
    // variante, 400 vide). On NE corrompt PAS le panier (reste 'active').
    const err = e as { status?: number; payload?: Record<string, unknown> };
    if (err && typeof err.status === 'number' && err.payload) {
      // Normalise en { error } (jamais de `code`) — on ne propage pas `message`
      // verbatim si absent.
      const msg = typeof err.payload.error === 'string' ? err.payload.error : 'Commande impossible';
      return json({ error: msg }, err.status);
    }
    return json({ error: 'Commande impossible' }, 500);
  }
}

/** GET /api/store/:slug/order/:id — confirmation commande publique. */
export async function handleStoreGetOrder(
  env: Env, slug: string, orderId: string,
): Promise<Response> {
  const clientId = await resolveStoreClientId(env, slug);
  if (!clientId) return json({ error: 'Boutique introuvable' }, 404);
  try {
    const cleanId = sanitizeInput(orderId || '', 100);
    // Borné client_id (anti-fuite) : une commande d'un autre tenant ⇒ 404.
    const order = (await env.DB.prepare(
      `SELECT id, order_number, total_cents, status
         FROM orders WHERE id = ? AND client_id = ?`,
    ).bind(cleanId, clientId).first()) as
      { id: string; order_number: string; total_cents: number; status: string } | null;
    if (!order) return json({ error: 'Commande introuvable' }, 404);

    const { results } = await env.DB.prepare(
      `SELECT product_title_snapshot AS name, quantity AS qty,
              unit_price_cents AS price_cents, total_cents
         FROM order_items WHERE order_id = ?`,
    ).bind(order.id).all();
    const items = ((results || []) as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.name || ''),
      qty: Math.max(0, Math.round(Number(r.qty) || 0)),
      price_cents: Math.max(0, Math.round(Number(r.price_cents) || 0)),
      total_cents: Math.max(0, Math.round(Number(r.total_cents) || 0)),
    }));

    return json({
      data: {
        order_id: order.id,
        order_number: order.order_number,
        total_cents: order.total_cents,
        status: order.status,
        items,
      },
    });
  } catch {
    return json({ error: 'Commande introuvable' }, 404);
  }
}

// ── PRO (apiFetch — capability 'settings.manage', bornage tenant) ───────────

/** Résout le client_id du tenant connecté (PRO). null ⇒ pas de tenant. */
async function resolveProClientId(env: Env, auth: StoreAuth): Promise<string | null> {
  if (auth.clientId) return auth.clientId;
  try {
    const { clientId } = await getClientModules(env, auth.userId, auth.tenant);
    return clientId;
  } catch {
    return null;
  }
}

/** GET /api/store-settings — réglages vitrine du tenant (PRO). */
export async function handleGetStoreSettings(
  env: Env, auth: StoreAuth,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;
  try {
    const clientId = await resolveProClientId(env, auth);
    if (!clientId) return json({ error: 'Client introuvable' }, 400);

    const row = (await env.DB.prepare(
      'SELECT store_slug, store_settings_json, default_currency FROM clients WHERE id = ?',
    ).bind(clientId).first()) as
      {
        store_slug: string | null; store_settings_json: string | null;
        default_currency: string | null;
      } | null;
    const settings = parseStoreSettingsJson(row?.store_settings_json);
    return json({
      data: {
        slug: row?.store_slug || '',
        name: settings.name || '',
        currency: settings.currency || (row?.default_currency || 'CAD'),
        enabled: settings.enabled,
      },
    });
  } catch {
    return json({ error: 'Réglages indisponibles' }, 500);
  }
}

/** POST /api/store-settings — active/configure la vitrine (PRO). */
export async function handleSaveStoreSettings(
  request: Request, env: Env, auth: StoreAuth,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;
  try {
    const clientId = await resolveProClientId(env, auth);
    if (!clientId) return json({ error: 'Client introuvable' }, 400);

    const body = (await request.json().catch(() => null)) as Partial<{
      slug: string; name: string; currency: string; enabled: boolean;
    }> | null;
    if (!body) return json({ error: 'Requête invalide' }, 400);

    // Réglages courants (pour merge partiel — Partial<StoreSettings>).
    const cur = (await env.DB.prepare(
      'SELECT store_slug, store_settings_json, default_currency FROM clients WHERE id = ?',
    ).bind(clientId).first()) as
      {
        store_slug: string | null; store_settings_json: string | null;
        default_currency: string | null;
      } | null;
    const curSettings = parseStoreSettingsJson(cur?.store_settings_json);

    // Slug : sanitize + slugify léger (a-z0-9-). Vide ⇒ conserve l'existant.
    let slug = cur?.store_slug || '';
    if (typeof body.slug === 'string') {
      const cleaned = sanitizeInput(body.slug, 200)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
      if (cleaned) {
        // Unicité best-effort : refuse si un AUTRE tenant possède ce slug.
        const clash = (await env.DB.prepare(
          'SELECT id FROM clients WHERE store_slug = ? AND id != ?',
        ).bind(cleaned, clientId).first()) as { id: string } | null;
        if (clash) return json({ error: 'Ce slug de boutique est déjà utilisé' }, 409);
        slug = cleaned;
      }
    }

    const name = typeof body.name === 'string'
      ? sanitizeInput(body.name, 200) : (curSettings.name || '');
    const currency = typeof body.currency === 'string'
      ? sanitizeInput(body.currency, 8).toUpperCase()
      : (curSettings.currency || cur?.default_currency || 'CAD');
    const enabled = typeof body.enabled === 'boolean'
      ? body.enabled : curSettings.enabled;

    const settingsJson = JSON.stringify({ name, currency, enabled });
    await env.DB.prepare(
      `UPDATE clients SET store_slug = ?, store_settings_json = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(slug || null, settingsJson, clientId).run();

    return json({ data: { slug, name, currency, enabled } });
  } catch {
    return json({ error: 'Enregistrement impossible' }, 500);
  }
}
