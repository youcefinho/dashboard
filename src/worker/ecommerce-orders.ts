// ── Commandes — Sprint E3 M1 (2026-05-16) ────────────────────────────────────
//
// Backend commandes du module Boutique (B2). Enrichit le squelette E1
// (handlers stub orders ré-exportés depuis ./ecommerce.ts) avec :
//   - Création de commande + line items (snapshots figés) + TPS/TVQ QC.
//   - Machine à états du cycle de vie + hooks stock idempotents.
//   - List/Get enrichis (items_count, items snapshots, customer email).
//
// Conventions strictes du projet :
//   - Money TOUJOURS en cents (INTEGER). TPS 5% + TVQ 9.975% calculées
//     SÉPARÉMENT sur le subtotal (jamais en cascade) — réplique exacte de la
//     logique Invoices.tsx (14.975% = 5% + 9.975%). Invoices.tsx : 0 modif.
//   - Multi-tenant STRICT : WHERE client_id = ? résolu via getClientModules
//     (pattern projet, jamais de fuite cross-tenant).
//   - id TEXT applicatif via crypto.randomUUID() (cohérent E1/E2).
//   - Stock : RÉUTILISE reserveStock / releaseStock / commitSale de
//     ./ecommerce-inventory.ts — aucune logique stock dupliquée ici.
//   - Snapshots (title/variant/sku/prix) FIGÉS à la création : l'historique
//     d'une commande ne doit jamais bouger si le catalogue change ensuite.
//   - Gating requireModule('ecommerce') géré AMONT par src/worker.ts (le bloc
//     /api/ecommerce/* est gated globalement — toute route ci-dessous hérite).
//
// E3 = PAS de paiement (Stripe = E4). financial_status géré manuellement via
// la machine à états du lifecycle.

import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';
import { getClientModules } from './modules';
import { reserveStock, releaseStock, commitSale } from './ecommerce-inventory';
import { computeTax, type TaxRegime } from './ecommerce-tax-engine';
import type { OrderStatus, FinancialStatus, FulfillmentStatus } from '../lib/types';
// S3 M2 — validation d'entrée (schémas M1 figés, import only).
import {
  validate,
  createOrderSchema,
  createManualOrderSchema,
  updateOrderStatusSchema,
} from '../lib/schemas';
import { validationError } from './lib/validate-response';

type Auth = { userId: string; role: string };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

// Taxes : déléguées au moteur unique ecommerce-tax-engine.ts (source unique,
// zéro duplication de formule). La stratégie 'qc' y est un wrapper VERBATIM du
// calcul historique (TPS 5% + TVQ 9.975%, arrondies séparément sur le subtotal,
// jamais en cascade) → régression-zéro Québec garantie bit-pour-bit.
// Régime par défaut 'qc' : toute commande sans tax_region (données E3) reste
// Québec, comportement strictement identique à l'ancien code.
const DEFAULT_TAX_REGIME: TaxRegime = 'qc';

/**
 * Résout le régime fiscal + pays d'une commande à créer. Défensif :
 *  - `input.tax_region` (passé par la conversion panier / back-office) prime ;
 *  - sinon défaut 'qc' (rétro-compat E3, régression-zéro Québec).
 * Le mapping/validation fin (boutique → régime, M2) viendra alimenter
 * input.tax_region en amont ; ici on garde un fallback sûr.
 */
function resolveTaxContext(
  input: CreateOrderInput,
): { regime: TaxRegime; country?: string } {
  const raw = (input.tax_region || '').toString().toLowerCase().trim();
  const valid: TaxRegime[] = ['qc', 'eu', 'dz', 'exempt'];
  const regime = (valid as string[]).includes(raw)
    ? (raw as TaxRegime)
    : DEFAULT_TAX_REGIME;
  const country = input.tax_country
    ? input.tax_country.toString().toUpperCase().slice(0, 2)
    : undefined;
  return { regime, country };
}

/** Résout le client_id du tenant courant (réutilise le helper modules). */
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

// ════════════════════════════════════════════════════════════════════════════
// A3 — Numérotation concurrent-safe (#<number>, départ 1001 par tenant)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Génère le prochain numéro de commande du tenant de façon atomique.
 * INSERT OR IGNORE garantit la ligne compteur ; l'incrément se fait via un
 * UNIQUE statement D1 (UPDATE ... RETURNING) — aucune course read-then-write
 * même sous appels concurrents. Format applicatif : `#<number>`.
 */
async function nextOrderNumber(env: Env, clientId: string): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO order_number_counters (client_id, next_number)
     VALUES (?, 1001)`,
  ).bind(clientId).run();

  const row = (await env.DB.prepare(
    `UPDATE order_number_counters
        SET next_number = next_number + 1, updated_at = datetime('now')
      WHERE client_id = ?
      RETURNING next_number`,
  ).bind(clientId).first()) as { next_number: number } | null;

  // next_number renvoyé = valeur APRÈS incrément ; le numéro attribué à CETTE
  // commande est donc (next_number - 1) pour démarrer la séquence à 1001.
  const assigned = (row?.next_number ?? 1002) - 1;
  return `#${assigned}`;
}

// ════════════════════════════════════════════════════════════════════════════
// A1 — Création commande + line items + TPS/TVQ
// ════════════════════════════════════════════════════════════════════════════

export interface CreateOrderInput {
  customer_id?: string | null;
  email: string;
  items: Array<{ variant_id: string; quantity: number }>;
  shipping_cents?: number;
  discount_cents?: number;
  note?: string;
  source?: string;
  // Internationalisation fiscale (E-R) — OPTIONNELS : non fournis ⇒ régime
  // 'qc' par défaut (rétro-compat E3, régression-zéro Québec). N'altère PAS
  // le contrat figé : les appelants existants (cart conversion) n'ont rien à
  // changer et conservent un comportement strictement identique.
  tax_region?: TaxRegime | string;
  tax_country?: string;
}

export interface CreateOrderResult {
  id: string;
  order_number: string;
  subtotal_cents: number;
  tps_cents: number;
  tvq_cents: number;
  total_cents: number;
}

/** Erreur métier propre (mappée en réponse HTTP par le wrapper). */
class OrderError extends Error {
  status: number;
  payload: Record<string, unknown>;
  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.error === 'string' ? payload.error : 'Erreur commande');
    this.status = status;
    this.payload = payload;
  }
}

interface VariantPriceRow {
  variant_id: string;
  variant_title: string | null;
  sku: string | null;
  price_override: number | null;
  product_id: string;
  product_title: string;
  base_price: number;
}

/**
 * Cœur de création de commande — CONTRAT FIGÉ (M2 le consomme pour la
 * conversion de panier). NE PAS modifier la signature.
 *
 * Pour chaque item : résout variante+produit (multi-tenant), calcule le prix
 * effectif (price_override ?? base_price), écrit les snapshots figés, réserve
 * le stock (refuse 409 si insuffisant & backorder interdit). TPS/TVQ calculées
 * séparément sur le subtotal. Génère un order_number concurrent-safe.
 */
export async function createOrderCore(
  env: Env,
  clientId: string,
  input: CreateOrderInput,
  createdBy?: string,
): Promise<CreateOrderResult> {
  const email = sanitizeInput(input.email || '', 200);
  const customerId = input.customer_id || null;
  const note = sanitizeInput(input.note || '', 2000);
  const source = sanitizeInput(input.source || 'web', 50) || 'web';
  const shippingCents = Number.isFinite(input.shipping_cents as number)
    ? Math.max(0, Math.round(input.shipping_cents as number))
    : 0;
  const discountCents = Number.isFinite(input.discount_cents as number)
    ? Math.max(0, Math.round(input.discount_cents as number))
    : 0;

  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    throw new OrderError(400, {
      error: 'Commande vide',
      message: 'Ajoute au moins un article pour créer une commande.',
    });
  }

  // 1) Résolution + snapshots + calcul du subtotal (avant tout écriture DB).
  type Resolved = {
    variantId: string;
    productTitle: string;
    variantTitle: string;
    sku: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  };
  const resolved: Resolved[] = [];
  let subtotalCents = 0;

  for (const raw of items) {
    const variantId = (raw?.variant_id || '').toString();
    const quantity = Math.max(1, Math.round(Number(raw?.quantity) || 0));
    if (!variantId || quantity < 1) {
      throw new OrderError(400, {
        error: 'Article invalide',
        message: 'Chaque ligne doit cibler une variante valide avec une quantité ≥ 1.',
      });
    }

    const v = (await env.DB.prepare(
      `SELECT v.id AS variant_id, v.title AS variant_title, v.sku AS sku,
              v.price_override AS price_override,
              p.id AS product_id, p.title AS product_title, p.base_price AS base_price
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = ? AND p.client_id = ?`,
    ).bind(variantId, clientId).first()) as VariantPriceRow | null;

    if (!v) {
      throw new OrderError(404, {
        error: 'Variante introuvable',
        message: `Une variante demandée n'existe pas ou n'appartient pas à ta boutique.`,
      });
    }

    // Prix effectif : price_override (si défini, même 0) sinon base_price.
    const unitPrice = v.price_override != null
      ? Math.max(0, Math.round(v.price_override))
      : Math.max(0, Math.round(v.base_price ?? 0));
    const lineTotal = unitPrice * quantity;
    subtotalCents += lineTotal;

    resolved.push({
      variantId: v.variant_id,
      productTitle: v.product_title || '',
      variantTitle: v.variant_title || '',
      sku: v.sku || '',
      unitPrice,
      quantity,
      lineTotal,
    });
  }

  // 2) Fiscalité : moteur unique computeTax (source unique, zéro dup formule).
  //    QC = wrapper verbatim → tps=round(sub*0.05), tvq=round(sub*0.09975),
  //    arrondies séparément, jamais en cascade (régression-zéro bit-pour-bit).
  const { regime, country } = resolveTaxContext(input);
  const tax = computeTax(regime, subtotalCents, { country });

  // Forme de retour FIGÉE (contrat E3, consommée par la conversion panier) :
  // pour QC, lines[0]=TPS / lines[1]=TVQ. Pour les autres régimes (mono ou
  // multi-lignes) on agrège dans tps_cents (= 1ère taxe) afin de préserver la
  // forme legacy ; la ventilation complète part dans tax_breakdown_json.
  const isQc = regime === 'qc';
  const tpsCents = isQc
    ? (tax.lines[0]?.amountCents ?? 0)
    : tax.totalTaxCents;
  const tvqCents = isQc
    ? (tax.lines[1]?.amountCents ?? 0)
    : 0;
  const taxBreakdownJson = JSON.stringify(tax.lines);

  // tax-INCLUSIVE (UE) : la taxe est déjà comprise dans le sous-total → ne pas
  // l'ajouter au total. tax-EXCLUSIVE (QC/DZ) : taxe ajoutée par-dessus.
  const totalCents = Math.max(
    0,
    tax.taxInclusive
      ? subtotalCents + shippingCents - discountCents
      : subtotalCents + tax.totalTaxCents + shippingCents - discountCents,
  );

  // 3) Réservation de stock AVANT l'écriture commande (rollback manuel si KO).
  const reservedOk: Array<{ variantId: string; qty: number }> = [];
  for (const r of resolved) {
    const res = await reserveStock(env, r.variantId, r.quantity, {
      type: 'order',
      by: createdBy,
    });
    if (!res.ok) {
      // Libère ce qui a déjà été réservé pour cette tentative (pas d'orphelin).
      for (const done of reservedOk) {
        await releaseStock(env, done.variantId, done.qty, { type: 'order', by: createdBy });
      }
      throw new OrderError(409, {
        error: 'Stock insuffisant',
        message: `Impossible de créer la commande : stock insuffisant pour « ${r.productTitle}${r.variantTitle ? ` — ${r.variantTitle}` : ''} »${r.sku ? ` (${r.sku})` : ''}. ${res.available != null ? `Disponible : ${res.available}.` : ''} Active les commandes en souffrance (backorder) si tu veux passer outre.`,
      });
    }
    reservedOk.push({ variantId: r.variantId, qty: r.quantity });
  }

  // 4) Écriture commande + line items (snapshots figés).
  const orderNumber = await nextOrderNumber(env, clientId);
  const orderId = crypto.randomUUID();

  // Sprint 4 (LOT-ECOM4 §6.F) — multi-devise : persistance de la devise du
  // tenant à l'INSERT (avant : orders.currency restait DEFAULT 'CAD'). SEULE
  // addition au contrat figé. Résolution best-effort via le résolveur EXISTANT
  // resolveRegionContext (ecommerce-region.ts:204, currency ∈ CAD/EUR/DZD) ;
  // tout échec ⇒ fallback 'CAD' = comportement actuel (régression-zéro QC).
  // AUCUN taux de change, JAMAIS sommé multi-devise. La signature de
  // createOrderCore et le calcul de total (subtotal/discount/taxe/shipping)
  // restent BYTE-IDENTIQUES — la devise n'entre dans AUCUN calcul.
  let orderCurrency = 'CAD';
  try {
    const { resolveRegionContext } = await import('./ecommerce-region');
    const ctx = await resolveRegionContext(env, clientId);
    if (ctx?.currency) orderCurrency = ctx.currency;
  } catch { /* best-effort : fallback 'CAD' = comportement actuel */ }

  await env.DB.prepare(
    `INSERT INTO orders
       (id, client_id, customer_id, order_number, status, financial_status,
        fulfillment_status, subtotal_cents, tps_cents, tvq_cents,
        shipping_cents, discount_cents, total_cents, email, note, source,
        tax_region, tax_breakdown_json, currency, placed_at)
     VALUES (?, ?, ?, ?, 'pending', 'unpaid', 'unfulfilled', ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(
    orderId, clientId, customerId, orderNumber,
    subtotalCents, tpsCents, tvqCents, shippingCents, discountCents, totalCents,
    email, note, source,
    regime.toUpperCase(), taxBreakdownJson, orderCurrency,
  ).run();

  for (const r of resolved) {
    // Taxe par ligne : QC = verbatim (round(line*0.05)+round(line*0.09975),
    // séparément). Autres régimes : ventilation issue du moteur appliquée au
    // sous-total de la ligne (cohérence avec le total commande).
    const lineTax = computeTax(regime, r.lineTotal, { country });
    const taxCents = lineTax.totalTaxCents;
    const lineBreakdownJson = JSON.stringify(lineTax.lines);
    await env.DB.prepare(
      `INSERT INTO order_items
         (id, order_id, variant_id, product_title_snapshot,
          variant_title_snapshot, sku_snapshot, unit_price_cents, quantity,
          total_cents, tax_cents, tax_breakdown_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), orderId, r.variantId,
      r.productTitle, r.variantTitle, r.sku,
      r.unitPrice, r.quantity, r.lineTotal, taxCents, lineBreakdownJson,
    ).run();
  }

  if (createdBy) {
    await audit(env, createdBy, 'create', 'order', orderId, {
      orderNumber, total: totalCents, source,
    });
  }

  // Sprint E9 M1 — déclencheur workflow 'order_created' BEST-EFFORT.
  // Réutilise le moteur Sprint 46 (workflows.ts) : tout workflow actif sur
  // ce trigger enrôle la commande/le client. N'échoue JAMAIS la commande
  // (logique E3 strictement inchangée ci-dessus).
  try {
    const { autoEnrollForTrigger } = await import('./workflows');
    await autoEnrollForTrigger(env, 'order_created', { customerId: customerId || undefined, orderId });
  } catch { /* best-effort : silencieux, ne casse jamais la commande */ }

  return {
    id: orderId,
    order_number: orderNumber,
    subtotal_cents: subtotalCents,
    tps_cents: tpsCents,
    tvq_cents: tvqCents,
    total_cents: totalCents,
  };
}

/** Wrapper HTTP de createOrderCore (source forcée 'web' si absente). */
export async function handleCreateOrder(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // S3 M2 — validation d'entrée AVANT la logique (early-return additif).
  const body = await request.json().catch(() => null);
  const v = validate(createOrderSchema, body);
  if (!v.success) return validationError(v.error);

  try {
    const result = await createOrderCore(env, clientId, {
      customer_id: (v.data.customer_id as string) || null,
      email: (v.data.email as string) || '',
      items: (v.data.items as CreateOrderInput['items']) || [],
      shipping_cents: v.data.shipping_cents as number,
      discount_cents: v.data.discount_cents as number,
      note: v.data.note as string,
      source: (v.data.source as string) || 'web',
    }, auth.userId);
    return json({ data: result }, 201);
  } catch (e) {
    if (e instanceof OrderError) return json(e.payload, e.status);
    throw e;
  }
}

/**
 * POST /api/ecommerce/orders/manual — création depuis le back-office.
 * Customer optionnel, source forcée 'manual'. Réutilise createOrderCore.
 */
export async function handleCreateManualOrder(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // S3 M2 — validation d'entrée AVANT la logique (early-return additif).
  const body = await request.json().catch(() => null);
  const v = validate(createManualOrderSchema, body);
  if (!v.success) return validationError(v.error);

  try {
    const result = await createOrderCore(env, clientId, {
      customer_id: (v.data.customer_id as string) || null,
      email: (v.data.email as string) || '',
      items: (v.data.items as CreateOrderInput['items']) || [],
      shipping_cents: v.data.shipping_cents as number,
      discount_cents: v.data.discount_cents as number,
      note: v.data.note as string,
      source: 'manual',
    }, auth.userId);
    return json({ data: result }, 201);
  } catch (e) {
    if (e instanceof OrderError) return json(e.payload, e.status);
    throw e;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// A2 — Cycle de vie + hooks stock idempotents
// ════════════════════════════════════════════════════════════════════════════

// Machine à états validée. cancelled depuis pending/paid/preparing ;
// refunded depuis paid/delivered.
const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['preparing', 'cancelled', 'refunded'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

interface OrderStatusRow {
  id: string;
  status: OrderStatus;
  paid_at: string | null;
  cancelled_at: string | null;
}

/**
 * PATCH /api/ecommerce/orders/:id/status — body { status }.
 * Transition validée par la machine à états (409 FR si invalide). Hooks stock
 * IDEMPOTENTS : commitSale au passage → paid (garde : seulement si on n'était
 * pas déjà payé), releaseStock au passage → cancelled (garde : pas déjà
 * annulé). Met à jour financial_status / fulfillment_status cohérents +
 * timestamps (paid_at / shipped_at / cancelled_at).
 */
export async function handleUpdateOrderStatus(
  request: Request, env: Env, auth: Auth, id: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // S3 M2 — validation d'entrée AVANT la logique (early-return additif).
  // updateOrderStatusSchema (M1) valide déjà status ∈ machine à états ;
  // la suite métier (transitions/hooks stock/timestamps) reste INCHANGÉE.
  const body = await request.json().catch(() => null);
  const v = validate(updateOrderStatusSchema, body);
  if (!v.success) return validationError(v.error);

  const next = v.data.status as OrderStatus;

  const order = (await env.DB.prepare(
    'SELECT id, status, paid_at, cancelled_at FROM orders WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).first()) as OrderStatusRow | null;
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  const current = order.status;
  if (current === next) {
    return json({ error: 'Aucun changement', message: `La commande est déjà « ${next} ».` }, 409);
  }
  const allowed = STATUS_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    return json(
      {
        error: 'Transition invalide',
        message: `Impossible de passer de « ${current} » à « ${next} ». Transitions permises : ${allowed.length ? allowed.join(', ') : 'aucune (état terminal)'}.`,
      },
      409,
    );
  }

  // Champs cohérents selon la cible.
  const sets: string[] = ['status = ?'];
  const params: unknown[] = [next];
  let financial: FinancialStatus | null = null;
  let fulfillment: FulfillmentStatus | null = null;

  if (next === 'paid') {
    financial = 'paid';
    if (!order.paid_at) { sets.push("paid_at = datetime('now')"); }
  } else if (next === 'shipped') {
    fulfillment = 'fulfilled';
    sets.push("shipped_at = datetime('now')");
  } else if (next === 'delivered') {
    fulfillment = 'fulfilled';
  } else if (next === 'cancelled') {
    if (!order.cancelled_at) { sets.push("cancelled_at = datetime('now')"); }
  } else if (next === 'refunded') {
    financial = 'refunded';
  }
  if (financial) { sets.push('financial_status = ?'); params.push(financial); }
  if (fulfillment) { sets.push('fulfillment_status = ?'); params.push(fulfillment); }

  // Hooks stock IDEMPOTENTS (gardés sur le statut précédent).
  const itemsRes = await env.DB.prepare(
    'SELECT variant_id, quantity FROM order_items WHERE order_id = ?',
  ).bind(id).all();
  const lines = (itemsRes.results || []) as Array<{ variant_id: string | null; quantity: number }>;

  if (next === 'paid' && !order.paid_at) {
    // Concrétise la vente une seule fois (garde : paid_at non encore posé).
    // Logique IDENTIQUE à commitOrderSale (Sprint E4) — gardée inline ici pour
    // ne PAS changer le comportement E3 ; le pont paiement passe par le helper.
    for (const ln of lines) {
      if (ln.variant_id) {
        await commitSale(env, ln.variant_id, ln.quantity, {
          type: 'order', id, by: auth.userId,
        });
      }
    }
  } else if (next === 'cancelled' && !order.cancelled_at) {
    // Libère la réservation une seule fois. Si la commande était déjà payée
    // (stock déjà décrémenté via commitSale), la réservation a déjà été
    // consommée → releaseStock no-op (reserved déjà à 0, garde-fou interne).
    for (const ln of lines) {
      if (ln.variant_id) {
        await releaseStock(env, ln.variant_id, ln.quantity, {
          type: 'order', id, by: auth.userId,
        });
      }
    }
  }

  params.push(id, clientId);
  await env.DB.prepare(
    `UPDATE orders SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
  ).bind(...params).run();

  await audit(env, auth.userId, 'update', 'order', id, {
    from: current, to: next,
  });

  // Sprint E7 M1 — recalcul agrégats client BEST-EFFORT (LTV/RFM). Net-of-
  // refunds, idempotent. N'échoue JAMAIS la commande (logique E3 inchangée).
  if (next === 'paid') {
    try {
      const cust = (await env.DB.prepare(
        'SELECT customer_id FROM orders WHERE id = ? AND client_id = ?',
      ).bind(id, clientId).first()) as { customer_id: string | null } | null;
      const { recomputeCustomerMetrics } = await import('./ecommerce-customer-metrics');
      await recomputeCustomerMetrics(env, clientId, cust?.customer_id ?? null);
    } catch { /* best-effort : silencieux, ne casse jamais la commande */ }
  }

  // Sprint E9 M1 — déclencheurs workflow 'order_paid' + 'post_purchase'
  // BEST-EFFORT (moteur Sprint 46 réutilisé). Déclenchés UNE seule fois
  // à la concrétisation du paiement (garde paid_at non encore posé, même
  // garde idempotente que commitSale ci-dessus). N'échoue JAMAIS la
  // transition (logique E3 strictement inchangée).
  if (next === 'paid' && !order.paid_at) {
    try {
      const cust = (await env.DB.prepare(
        'SELECT customer_id FROM orders WHERE id = ? AND client_id = ?',
      ).bind(id, clientId).first()) as { customer_id: string | null } | null;
      const tgt = { customerId: cust?.customer_id ?? undefined, orderId: id };
      const { autoEnrollForTrigger } = await import('./workflows');
      await autoEnrollForTrigger(env, 'order_paid', tgt);
      await autoEnrollForTrigger(env, 'post_purchase', tgt);
    } catch { /* best-effort : silencieux, ne casse jamais la transition */ }
  }

  return json({ data: { id, status: next, success: true } });
}

// ════════════════════════════════════════════════════════════════════════════
// A3 — List / Get enrichis
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ecommerce/orders?status=&limit=&offset=
 * Liste paginée + items_count + email/nom client réconcilié.
 */
export async function handleListOrders(env: Env, auth: Auth, url: URL): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const { limit, offset } = parsePaging(url);

  const where: string[] = ['o.client_id = ?'];
  const params: unknown[] = [clientId];

  const status = url.searchParams.get('status');
  const allValid = ['pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded'];
  if (status && allValid.includes(status)) {
    where.push('o.status = ?');
    params.push(status);
  }
  const whereSql = where.join(' AND ');

  const countRow = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM orders o WHERE ${whereSql}`,
  ).bind(...params).first()) as { n: number } | null;

  const { results } = await env.DB.prepare(
    `SELECT o.*,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count,
        c.email AS customer_email,
        c.first_name AS customer_first_name,
        c.last_name AS customer_last_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id AND c.client_id = o.client_id
      WHERE ${whereSql}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
  ).bind(...params, limit, offset).all();

  return json({ data: results || [], total: countRow?.n || 0, limit, offset });
}

/**
 * GET /api/ecommerce/orders/:id
 * Commande + items (snapshots figés) + customer réconcilié.
 */
export async function handleGetOrder(env: Env, auth: Auth, id: string): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const order = await env.DB.prepare(
    'SELECT * FROM orders WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).first();
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  const { results: items } = await env.DB.prepare(
    'SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at ASC',
  ).bind(id).all();

  let customer: unknown = null;
  if ((order as { customer_id?: string }).customer_id) {
    customer = await env.DB.prepare(
      'SELECT * FROM customers WHERE id = ? AND client_id = ?',
    ).bind((order as { customer_id: string }).customer_id, clientId).first();
  }

  return json({ data: { ...order, items: items || [], customer } });
}

// ════════════════════════════════════════════════════════════════════════════
// E4 — Pont paiement → lifecycle (helper interne RÉUTILISABLE, exporté)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Helper interne exporté pour le PONT paiement E4 (consommé UNIQUEMENT par
 * recordPaymentTransition dans ecommerce-payments.ts). RÉUTILISE la logique
 * stock/statut du lifecycle E3 — ZÉRO duplication : même garde idempotente
 * (`!paid_at`), même commitSale par ligne, même financial_status='paid'.
 *
 * NE déclenche RIEN sauf au passage effectif → payé d'une commande non encore
 * payée (rejeu webhook = no-op total : pas de double commitSale, pas de
 * double timestamp). NE marque jamais payé pour COD/échec (le pont ne
 * l'appelle que pour status='paid').
 *
 * Multi-tenant STRICT (WHERE client_id résolu en amont par le pont via la
 * commande). Comportement de handleUpdateOrderStatus INCHANGÉ : ce helper est
 * une porte d'entrée parallèle pour le webhook, pas un remplacement.
 *
 * Retourne `{ committed }` : true si la vente a été concrétisée par CET appel,
 * false si déjà payée (idempotent) ou commande absente.
 */
export async function commitOrderSale(
  env: Env,
  clientId: string,
  orderId: string,
  by?: string,
): Promise<{ committed: boolean }> {
  const order = (await env.DB.prepare(
    'SELECT id, status, paid_at, cancelled_at FROM orders WHERE id = ? AND client_id = ?',
  ).bind(orderId, clientId).first()) as OrderStatusRow | null;
  if (!order) return { committed: false };

  // Idempotence : déjà payé (paid_at posé) ⇒ no-op total (rejeu webhook sûr).
  if (order.paid_at) return { committed: false };
  // Une commande annulée ne se "paie" pas a posteriori (garde-fou défensif).
  if (order.status === 'cancelled') return { committed: false };

  const itemsRes = await env.DB.prepare(
    'SELECT variant_id, quantity FROM order_items WHERE order_id = ?',
  ).bind(orderId).all();
  const lines = (itemsRes.results || []) as Array<{ variant_id: string | null; quantity: number }>;

  // Concrétise la vente une seule fois — MÊME appel que le lifecycle E3.
  for (const ln of lines) {
    if (ln.variant_id) {
      await commitSale(env, ln.variant_id, ln.quantity, {
        type: 'order', id: orderId, by,
      });
    }
  }

  // financial_status='paid' + paid_at + statut paid si encore 'pending'
  // (transition E3 légale pending→paid). Si déjà 'paid'/au-delà sans paid_at
  // (cas dégénéré), on ne rétrograde rien : on pose juste paid_at/financial.
  const sets: string[] = ["financial_status = 'paid'", "paid_at = datetime('now')"];
  if (order.status === 'pending') sets.push("status = 'paid'");

  await env.DB.prepare(
    `UPDATE orders SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND client_id = ? AND paid_at IS NULL`,
  ).bind(orderId, clientId).run();

  if (by) {
    await audit(env, by, 'update', 'order', orderId, {
      from: order.status, to: 'paid', via: 'payment_webhook',
    });
  }

  // Sprint E7 M1 — recalcul agrégats client BEST-EFFORT après concrétisation
  // de la vente (pont paiement). Net-of-refunds, idempotent. N'échoue JAMAIS
  // le pont paiement (logique E4 strictement inchangée).
  try {
    const cust = (await env.DB.prepare(
      'SELECT customer_id FROM orders WHERE id = ? AND client_id = ?',
    ).bind(orderId, clientId).first()) as { customer_id: string | null } | null;
    const { recomputeCustomerMetrics } = await import('./ecommerce-customer-metrics');
    await recomputeCustomerMetrics(env, clientId, cust?.customer_id ?? null);
  } catch { /* best-effort : silencieux, ne casse jamais le paiement */ }

  return { committed: true };
}
