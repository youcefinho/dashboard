// ── funnel-checkout.ts — Sprint 62 Entonnoirs d'Achat & Upsell en 1-Clic ──────────
//
// Gère le checkout public des entonnoirs d'achat (funnels) et le mécanisme
// d'upsell/bump en 1-clic sans ressaisie de carte bancaire (paiement mocké/sandbox).
// Comprend également le CRUD pour l'administration des offres liées aux étapes (PRO).
//
// Conventions strictes du projet :
//   - Isolation multi-tenant stricte : validation systématique du client_id.
//   - Zéro FK matérielles (D1 SQLite standard).
//   - Money en cents (INTEGER).

import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';
import { requireCapability, type CapAuth } from './capabilities';
import { getClientModules } from './modules';
import { createOrderCore, commitOrderSale } from './ecommerce-orders';
import { resolveShippingRate } from './ecommerce-shipping-zones';
import type { TaxRegime } from './ecommerce-tax-engine';
import { resolveCouponDiscount, incrementCouponUsage } from './ecommerce-coupons';

type FunnelAuth = CapAuth & { capabilities?: Set<string> };

// ════════════════════════════════════════════════════════════════════════════
// HELPERS DE RÉSOLUTION & UTILITAIRES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Résout le client_id et funnel_id associés à un slug de publication de funnel.
 */
async function resolveFunnelPublication(
  env: Env,
  slug: string,
): Promise<{ clientId: string; funnelId: string } | null> {
  const clean = sanitizeInput(slug || '', 200);
  if (!clean) return null;
  try {
    const row = (await env.DB.prepare(
      'SELECT client_id, funnel_id FROM funnel_publications WHERE slug = ? AND is_active = 1',
    ).bind(clean).first()) as { client_id: string; funnel_id: string } | null;
    if (!row?.client_id || !row?.funnel_id) return null;
    return { clientId: row.client_id, funnelId: row.funnel_id };
  } catch {
    return null;
  }
}

/**
 * Mappe le pays ISO de l'adresse vers le régime fiscal.
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
  return undefined;
}

/**
 * Résout la devise par défaut du tenant.
 */
async function getStoreCurrency(env: Env, clientId: string): Promise<string> {
  try {
    const row = (await env.DB.prepare(
      'SELECT default_currency FROM clients WHERE id = ?',
    ).bind(clientId).first()) as { default_currency: string | null } | null;
    return (row?.default_currency || 'CAD').toUpperCase();
  } catch {
    return 'CAD';
  }
}

/**
 * Résout le client_id pour l'utilisateur PRO connecté.
 */
async function resolveProClientId(env: Env, auth: FunnelAuth): Promise<string | null> {
  if (auth.clientId) return auth.clientId;
  try {
    const { clientId } = await getClientModules(env, auth.userId, auth.tenant);
    return clientId;
  } catch {
    return null;
  }
}

function capGuard(auth: FunnelAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS PUBLICS (CHECKOUT & UPSELL EN 1-CLIC)
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/p/:slug/checkout
 * Gère le checkout initial d'un entonnoir d'achat (crée et paie la commande parente).
 */
export async function handleFunnelCheckout(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const pub = await resolveFunnelPublication(env, slug);
  if (!pub) return json({ error: 'Entonnoir de vente introuvable' }, 404);
  const { clientId, funnelId } = pub;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const email = sanitizeInput((body.email as string) || '', 200);
  if (!email) return json({ error: 'Courriel requis' }, 400);

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return json({ error: 'Aucun article sélectionné' }, 400);

  const address = (body.address as Record<string, unknown> | undefined) || {};
  const country = sanitizeInput((address.country as string) || '', 2).toUpperCase();
  const name = sanitizeInput((body.name as string) || '', 200);

  const currency = await getStoreCurrency(env, clientId);

  // 1) Résolution des prix des variantes pour le sous-total
  let subtotalCents = 0;
  const itemsToCreate = [];

  for (const item of items) {
    const variantId = sanitizeInput((item.variant_id as string) || '', 100);
    const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
    if (!variantId) return json({ error: 'Variante invalide' }, 400);

    const v = (await env.DB.prepare(
      `SELECT v.id, v.price_override, p.base_price 
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = ? AND p.client_id = ? AND p.status = 'active'`,
    ).bind(variantId, clientId).first()) as { id: string; price_override: number | null; base_price: number } | null;

    if (!v) return json({ error: `Variante introuvable : ${variantId}` }, 404);

    const unitPrice = v.price_override != null ? v.price_override : v.base_price;
    subtotalCents += unitPrice * quantity;
    itemsToCreate.push({ variant_id: variantId, quantity });
  }

  // 2) Devis livraison
  const ship = await resolveShippingRate(env, clientId, {
    country: country || null,
    subtotal_cents: subtotalCents,
    currency,
  });

  // 3) Code de réduction / coupon
  let discountCents = 0;
  let appliedCouponId: string | null = null;
  const couponCode = sanitizeInput((body.coupon_code as string) || '', 60);
  if (couponCode) {
    const resolved = await resolveCouponDiscount(env, clientId, couponCode, subtotalCents, currency);
    if (resolved.valid && resolved.discount_cents > 0) {
      discountCents = resolved.discount_cents;
      appliedCouponId = resolved.couponId ?? null;
    }
  }

  const taxRegion = regimeForCountry(country);
  const taxCountry = /^[A-Z]{2}$/.test(country) ? country : undefined;

  try {
    // 4) Création de la commande parente initiale
    const result = await createOrderCore(env, clientId, {
      customer_id: null,
      email,
      items: itemsToCreate,
      shipping_cents: ship.price_cents,
      discount_cents: discountCents || undefined,
      note: name ? `Entonnoir Checkout — ${name}` : `Entonnoir Checkout`,
      source: 'funnel',
      tax_region: taxRegion,
      tax_country: taxCountry,
    });

    // 5) Simulation du paiement (validation immédiate / mocké)
    await commitOrderSale(env, clientId, result.id, 'funnel_buyer');

    if (appliedCouponId) {
      await incrementCouponUsage(env, clientId, appliedCouponId);
    }

    // Incrémenter les statistiques du funnel (conversion)
    await env.DB.prepare(
      `UPDATE funnels SET total_submissions = total_submissions + 1, total_conversions = total_conversions + 1
        WHERE id = ?`,
    ).bind(funnelId).run();

    await env.DB.prepare(
      `INSERT INTO funnel_analytics (id, funnel_id, event_type, created_at)
       VALUES (?, ?, 'conversion', datetime('now'))`,
    ).bind(crypto.randomUUID(), funnelId).run();

    return json({
      data: {
        order_id: result.id,
        order_number: result.order_number,
        total_cents: result.total_cents,
        status: 'paid',
      },
    }, 201);
  } catch (e) {
    const err = e as { status?: number; payload?: Record<string, unknown> };
    if (err?.status && err?.payload) {
      const msg = typeof err.payload.error === 'string' ? err.payload.error : 'Commande impossible';
      return json({ error: msg }, err.status);
    }
    return json({ error: 'Commande impossible' }, 500);
  }
}

/**
 * POST /api/p/:slug/upsell
 * Gère l'achat en 1-clic pour une offre d'upsell, bump ou downsell sans ressaisie de carte.
 */
export async function handleFunnelUpsell(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const pub = await resolveFunnelPublication(env, slug);
  if (!pub) return json({ error: 'Entonnoir de vente introuvable' }, 404);
  const { clientId, funnelId } = pub;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const parentOrderId = sanitizeInput((body.parent_order_id as string) || '', 100);
  const stepId = sanitizeInput((body.step_id as string) || '', 100);
  const variantId = sanitizeInput((body.variant_id as string) || '', 100);

  if (!parentOrderId || !stepId || !variantId) {
    return json({ error: 'Paramètres requis manquants (parent_order_id, step_id, variant_id)' }, 400);
  }

  // 1) Vérifier et charger la commande parente pour récupérer les informations de l'acheteur
  const parentOrder = (await env.DB.prepare(
    'SELECT id, email, tax_region, currency, order_number FROM orders WHERE id = ? AND client_id = ?',
  ).bind(parentOrderId, clientId).first()) as {
    id: string;
    email: string;
    tax_region: string | null;
    currency: string;
    order_number: string;
  } | null;

  if (!parentOrder) {
    return json({ error: 'Commande parente introuvable' }, 404);
  }

  // 2) Récupérer l'offre d'upsell configurée dans funnel_offers
  const offer = (await env.DB.prepare(
    'SELECT id, product_variant_id, type, price_cents FROM funnel_offers WHERE funnel_id = ? AND step_id = ? AND product_variant_id = ? AND is_active = 1',
  ).bind(funnelId, stepId, variantId).first()) as {
    id: string;
    product_variant_id: string;
    type: string;
    price_cents: number;
  } | null;

  if (!offer) {
    return json({ error: 'Offre d\'upsell introuvable ou inactive' }, 404);
  }

  // 3) Résoudre le prix normal de la variante pour calculer la réduction nécessaire
  const v = (await env.DB.prepare(
    `SELECT price_override FROM product_variants WHERE id = ?`,
  ).bind(variantId).first()) as { price_override: number | null } | null;

  const product = (await env.DB.prepare(
    `SELECT base_price FROM products p 
       JOIN product_variants v ON v.product_id = p.id
      WHERE v.id = ?`,
  ).bind(variantId).first()) as { base_price: number } | null;

  if (!v || !product) {
    return json({ error: 'Produit ou variante associée introuvable' }, 404);
  }

  const normalPrice = v.price_override != null ? v.price_override : product.base_price;

  // Calcul de la différence de prix à appliquer comme discount
  let discountCents = 0;
  if (normalPrice > offer.price_cents) {
    discountCents = normalPrice - offer.price_cents;
  }

  try {
    // 4) Créer la nouvelle commande liée pour l'upsell
    const result = await createOrderCore(env, clientId, {
      customer_id: null,
      email: parentOrder.email,
      items: [{ variant_id: variantId, quantity: 1 }],
      shipping_cents: 0, // Pas de frais de port sur un upsell direct
      discount_cents: discountCents || undefined,
      note: `Upsell 1-Clic (${offer.type}) pour la commande ${parentOrder.order_number}`,
      source: 'funnel_upsell',
      tax_region: parentOrder.tax_region || undefined,
    });

    // 5) Marquer directement comme payée (1-clic sans ressaisie de carte)
    await commitOrderSale(env, clientId, result.id, 'funnel_buyer');

    // Incrémenter les conversions du funnel
    await env.DB.prepare(
      `UPDATE funnels SET total_conversions = total_conversions + 1 WHERE id = ?`,
    ).bind(funnelId).run();

    return json({
      data: {
        order_id: result.id,
        order_number: result.order_number,
        total_cents: result.total_cents,
        status: 'paid',
      },
    }, 201);
  } catch (e) {
    const err = e as { status?: number; payload?: Record<string, unknown> };
    if (err?.status && err?.payload) {
      return json({ error: err.payload.error }, err.status);
    }
    return json({ error: 'Commande d\'upsell impossible' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS PRO D'ADMINISTRATION DES OFFRES (CRUD)
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/funnels/:funnelId/offers
 * Liste toutes les offres de vente (bumps, upsells) configurées pour un funnel donné.
 */
export async function handleGetFunnelOffers(
  env: Env,
  auth: FunnelAuth,
  funnelId: string,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;

  const clientId = await resolveProClientId(env, auth);
  if (!clientId) return json({ error: 'Client introuvable' }, 400);

  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM funnel_offers WHERE funnel_id = ? AND client_id = ? ORDER BY created_at DESC`,
    ).bind(funnelId, clientId).all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

/**
 * POST /api/funnels/:funnelId/offers
 * Crée ou met à jour une offre pour une étape de funnel.
 */
export async function handleSaveFunnelOffer(
  request: Request,
  env: Env,
  auth: FunnelAuth,
  funnelId: string,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;

  const clientId = await resolveProClientId(env, auth);
  if (!clientId) return json({ error: 'Client introuvable' }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const id = sanitizeInput((body.id as string) || crypto.randomUUID(), 100);
  const stepId = sanitizeInput((body.step_id as string) || '', 100);
  const productVariantId = sanitizeInput((body.product_variant_id as string) || '', 100);
  const type = sanitizeInput((body.type as string) || 'upsell', 30);
  const priceCents = Math.max(0, Math.round(Number(body.price_cents) || 0));
  const isActive = body.is_active === false ? 0 : 1;

  if (!stepId || !productVariantId) {
    return json({ error: 'step_id et product_variant_id requis' }, 400);
  }

  if (!['bump', 'upsell', 'downsell'].includes(type)) {
    return json({ error: 'Type invalide (bump, upsell, downsell)' }, 400);
  }

  try {
    const existing = (await env.DB.prepare(
      'SELECT id FROM funnel_offers WHERE id = ? AND client_id = ?',
    ).bind(id, clientId).first()) as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        `UPDATE funnel_offers 
            SET step_id = ?, product_variant_id = ?, type = ?, price_cents = ?, is_active = ?, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      ).bind(stepId, productVariantId, type, priceCents, isActive, id, clientId).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO funnel_offers (id, client_id, funnel_id, step_id, product_variant_id, type, price_cents, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, clientId, funnelId, stepId, productVariantId, type, priceCents, isActive).run();
    }

    await audit(env, auth.userId, 'save_offer', 'funnel_offer', id, { funnelId, stepId, type });

    return json({ data: { id, success: true } }, existing ? 200 : 201);
  } catch {
    return json({ error: 'Enregistrement de l\'offre impossible' }, 500);
  }
}

/**
 * DELETE /api/funnels/:funnelId/offers/:offerId
 * Supprime une offre de funnel.
 */
export async function handleDeleteFunnelOffer(
  env: Env,
  auth: FunnelAuth,
  funnelId: string,
  offerId: string,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;

  const clientId = await resolveProClientId(env, auth);
  if (!clientId) return json({ error: 'Client introuvable' }, 400);

  try {
    const existing = (await env.DB.prepare(
      'SELECT id FROM funnel_offers WHERE id = ? AND funnel_id = ? AND client_id = ?',
    ).bind(offerId, funnelId, clientId).first()) as { id: string } | null;

    if (!existing) {
      return json({ error: 'Offre introuvable' }, 404);
    }

    await env.DB.prepare(
      'DELETE FROM funnel_offers WHERE id = ? AND funnel_id = ? AND client_id = ?',
    ).bind(offerId, funnelId, clientId).run();

    await audit(env, auth.userId, 'delete_offer', 'funnel_offer', offerId, { funnelId });

    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Suppression de l\'offre impossible' }, 500);
  }
}
