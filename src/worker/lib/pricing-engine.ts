// ── Sprint 48 — pricing-engine.ts — Engine B2B tier pricing + bundles + preorders
//
// Helpers PURE/HANDLER pour b2b-bundles-preorders.ts. Étend le pipeline
// e-commerce S(E1) (seq58) sans toucher aux handlers ecommerce-*.ts.
//
// 3 helpers (signatures FIGÉES Phase A, corps Phase B affinés) :
//   - resolveTierPrice()             : async D1, lookup customer groups +
//                                       tier_prices, applique le meilleur tier
//                                       (min_quantity ≤ qty), fallback
//                                       variant.price legacy si aucun match.
//   - computeBundleDiscount()        : pure, calcule discount d'un bundle vs
//                                       sum des items individuels.
//   - processPreorderNotification()  : async D1, UPDATE preorder status='notified'
//                                       + send email best-effort (Phase B).
//
// Contrats GELÉS (docs/LOT-B2B-BUNDLES-PREORDERS-S48.md §6) :
//   - imports RELATIFS uniquement (`../types`)
//   - PAS de throw — best-effort, dégradation gracieuse (calque
//     warehouse-engine / subscription-engine)
//   - PAS d'appel réseau email réel en Phase A (Phase B câblera Resend /
//     sendgrid). En Phase A : log + flag `email_sent:false`.
//   - Devise locked 'CAD' V1 (cohérence seq120 / seq142)
//
// ⚠ NE TOUCHE PAS aux helpers ecommerce-*.ts existants. Pas de mutation
//   directe d'orders/order_items ici — uniquement preorder_queue + lecture
//   product_variants pour fallback prix.

import type { Env } from '../types';

// ── Types internes (alignés api.ts client) ────────────────────────────────

/** Résultat de resolveTierPrice() — meilleur prix pour (variant, customer, qty). */
export interface ResolveTierPriceResult {
  /** Prix unitaire en cents (tier matché OU variant.price fallback). */
  price_cents: number;
  /** Group ID appliqué (null si pas de tier match — fallback variant.price). */
  group_applied: string | null;
  /** Pourcentage de remise vs variant.price legacy (0 si pas de tier). */
  discount_pct: number;
}

/** Item composant d'un bundle pour computeBundleDiscount(). */
export interface BundleItemForCompute {
  /** Prix unitaire (cents) de la variant individuelle. */
  unit_price_cents: number;
  /** Quantité dans le bundle (>= 1). */
  quantity: number;
}

/** Résultat de computeBundleDiscount() — analyse économique du bundle. */
export interface ComputeBundleDiscountResult {
  /** Somme prix items individuels (cents). */
  sum_items_cents: number;
  /** Discount absolu en cents (sum_items - total_price). */
  discount_cents: number;
  /** Pourcentage de remise (0..100). */
  discount_pct: number;
}

/** Résultat de processPreorderNotification(). */
export interface ProcessPreorderNotificationResult {
  notified: boolean;
  email_sent: boolean;
  reason?: string;
}

// ── resolveTierPrice — async D1 ───────────────────────────────────────────

/**
 * Résout le prix unitaire applicable pour (variant, customer, quantity).
 *
 * Algorithme :
 *   1. Lookup groups actifs du customer via customer_group_assignments
 *      (filtré expires_at NULL OR > now).
 *   2. Pour chaque group, lookup tier_prices WHERE product_variant_id = ?
 *      AND group_id = ? AND min_quantity <= ? ORDER BY min_quantity DESC.
 *   3. Prend le tier_prices.price_cents le PLUS BAS parmi les matches
 *      (best deal customer).
 *   4. Fallback : si aucun match → SELECT product_variants.price (legacy).
 *
 * Phase A : implémentation safe — best-effort, fail-open (si DB panne,
 * retourne 0 + group null). PAS de throw.
 */
export async function resolveTierPrice(
  env: Env,
  variantId: string,
  customerId: string,
  quantity: number,
): Promise<ResolveTierPriceResult> {
  const safeQty = Math.max(1, Math.round(Number(quantity) || 1));
  try {
    if (!variantId) {
      return { price_cents: 0, group_applied: null, discount_pct: 0 };
    }

    // Fallback prix variant (toujours lu pour calculer discount_pct).
    let basePriceCents = 0;
    try {
      const variantRow = (await env.DB.prepare(
        `SELECT price_cents FROM product_variants WHERE id = ?`,
      )
        .bind(variantId)
        .first()) as { price_cents?: number } | null;
      basePriceCents = Math.max(0, Math.round(Number(variantRow?.price_cents ?? 0)));
    } catch {
      /* best-effort — basePriceCents reste 0 */
    }

    // Pas de customer ⇒ pas de tier ⇒ price = variant.price legacy.
    if (!customerId) {
      return { price_cents: basePriceCents, group_applied: null, discount_pct: 0 };
    }

    // Lookup groups actifs du customer (expires_at NULL OR > now).
    let groupIds: string[] = [];
    try {
      const groupsRes = await env.DB.prepare(
        `SELECT group_id FROM customer_group_assignments
         WHERE customer_id = ?
           AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
        .bind(customerId)
        .all();
      groupIds = ((groupsRes?.results ?? []) as Array<{ group_id: string }>)
        .map((r) => r.group_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    } catch {
      /* best-effort — groupIds reste [] */
    }

    if (groupIds.length === 0) {
      return { price_cents: basePriceCents, group_applied: null, discount_pct: 0 };
    }

    // Lookup tier_prices matching min_quantity ≤ qty pour tous les groups.
    // On joint par IN (?, ?, ...) — D1 supporte bind variadique.
    const placeholders = groupIds.map(() => '?').join(',');
    let bestTier: { price_cents: number; group_id: string } | null = null;
    try {
      const tiersRes = await env.DB.prepare(
        `SELECT price_cents, group_id, min_quantity
         FROM tier_prices
         WHERE product_variant_id = ?
           AND group_id IN (${placeholders})
           AND min_quantity <= ?
         ORDER BY price_cents ASC, min_quantity DESC
         LIMIT 1`,
      )
        .bind(variantId, ...groupIds, safeQty)
        .first();
      if (tiersRes) {
        const row = tiersRes as { price_cents: number; group_id: string };
        bestTier = {
          price_cents: Math.max(0, Math.round(Number(row.price_cents))),
          group_id: String(row.group_id),
        };
      }
    } catch {
      /* best-effort */
    }

    if (!bestTier) {
      return { price_cents: basePriceCents, group_applied: null, discount_pct: 0 };
    }

    // Calcul discount_pct vs base price (clamp [0..100]).
    let discountPct = 0;
    if (basePriceCents > 0 && bestTier.price_cents < basePriceCents) {
      discountPct = Math.min(
        100,
        Math.max(0, Math.round(((basePriceCents - bestTier.price_cents) / basePriceCents) * 100)),
      );
    }

    return {
      price_cents: bestTier.price_cents,
      group_applied: bestTier.group_id,
      discount_pct: discountPct,
    };
  } catch {
    return { price_cents: 0, group_applied: null, discount_pct: 0 };
  }
}

// ── computeBundleDiscount — pure ──────────────────────────────────────────

/**
 * Calcule la mécanique économique d'un bundle.
 *
 * PURE — pas d'I/O, pas de throw. Si items vide ⇒ 0/0/0.
 *
 * @param items  Liste des items composant le bundle (unit_price + qty).
 * @param totalPriceCents  Prix de vente du bundle complet (override). Si null
 *                         ou <= 0 ⇒ discount nul (sum_items préservé).
 */
export function computeBundleDiscount(
  items: BundleItemForCompute[],
  totalPriceCents: number | null | undefined,
): ComputeBundleDiscountResult {
  if (!Array.isArray(items) || items.length === 0) {
    return { sum_items_cents: 0, discount_cents: 0, discount_pct: 0 };
  }

  const sumItemsCents = items.reduce((acc, it) => {
    const price = Math.max(0, Math.round(Number(it?.unit_price_cents) || 0));
    const qty = Math.max(0, Math.round(Number(it?.quantity) || 0));
    return acc + price * qty;
  }, 0);

  const total = Math.max(0, Math.round(Number(totalPriceCents ?? 0)));
  if (total <= 0 || total >= sumItemsCents) {
    return { sum_items_cents: sumItemsCents, discount_cents: 0, discount_pct: 0 };
  }

  const discountCents = sumItemsCents - total;
  const discountPct =
    sumItemsCents > 0
      ? Math.min(100, Math.max(0, Math.round((discountCents / sumItemsCents) * 100)))
      : 0;

  return {
    sum_items_cents: sumItemsCents,
    discount_cents: discountCents,
    discount_pct: discountPct,
  };
}

// ── processPreorderNotification — async D1 ────────────────────────────────

/**
 * Notify un preorder qu'un variant restocké est disponible.
 *
 * Phase A : implémentation safe — UPDATE preorder_queue SET status='notified',
 * notified_at = now WHERE id = ? AND status = 'queued'. Email best-effort
 * (Phase A : log + email_sent:false ; Phase B câblera Resend / sendgrid avec
 * template HTML + Loi 25 unsubscribe).
 *
 * PAS de throw — best-effort, dégradation gracieuse.
 */
export async function processPreorderNotification(
  env: Env,
  preorderId: string,
): Promise<ProcessPreorderNotificationResult> {
  try {
    if (!preorderId) {
      return { notified: false, email_sent: false, reason: 'no_id' };
    }

    const preorder = (await env.DB.prepare(
      `SELECT id, variant_id, customer_id, client_id, email, status
       FROM preorder_queue WHERE id = ?`,
    )
      .bind(preorderId)
      .first()) as {
      id: string;
      variant_id: string;
      customer_id: string;
      client_id: string;
      email: string | null;
      status: string;
    } | null;

    if (!preorder) {
      return { notified: false, email_sent: false, reason: 'not_found' };
    }
    if (preorder.status !== 'queued') {
      return { notified: false, email_sent: false, reason: 'not_queued' };
    }

    // UPDATE status='notified' + notified_at.
    try {
      await env.DB.prepare(
        `UPDATE preorder_queue
            SET status = 'notified', notified_at = datetime('now')
          WHERE id = ? AND status = 'queued'`,
      )
        .bind(preorderId)
        .run();
    } catch {
      return { notified: false, email_sent: false, reason: 'update_failed' };
    }

    // Email best-effort — Phase A : log + email_sent=false. Phase B câblera
    // Resend / sendgrid avec template HTML + Loi 25 unsubscribe.
    let emailSent = false;
    if (preorder.email && preorder.email.includes('@')) {
      // Phase B placeholder : log only, no real send.
      emailSent = false;
    }

    return { notified: true, email_sent: emailSent };
  } catch {
    return { notified: false, email_sent: false, reason: 'exception' };
  }
}

// NB : 3 helpers exposés (resolveTierPrice async, computeBundleDiscount pure,
// processPreorderNotification async). PAS de throw, PAS d'appel email réel
// en Phase A. Imports RELATIFS uniquement (`../types`). Devise locked 'CAD' V1.
// Choix figés docs/LOT-B2B-BUNDLES-PREORDERS-S48.md §6.

// ════════════════════════════════════════════════════════════════════════════
// SPRINT 48 — RENFORCEMENT (additif, zéro régression)
//
// 8 nouveaux helpers PURE (pas d'I/O — délégation explicite à S39 tax engine
// préservée intouchée) :
//   - computeBundlePrice()       : sum items, override bundle_price OR discount %.
//   - getVolumeTierDiscount()    : match qty → tier threshold (10/50/100/500).
//   - computePreorderDeposit()   : split deposit/balance (default 20% / cap 100%).
//   - convertCurrency()          : apply rate from S39 currency_rates table.
//   - isCurrencySupported()      : ISO 4217 whitelist (~170 codes).
//   - validatePricingInput()     : bornes strictes (qty/currency/discount).
//   - computeFinalPrice()        : orchestrator { subtotal, discount, tax, total }.
//
// Constants : DEFAULT_DEPOSIT_PCT=20, MAX_DISCOUNT_PCT=80, PRICING_ERROR_CODES,
// ISO_4217_CODES (Set, lookup O(1)).
//
// Contrats :
//   - PURE — pas de throw (retour { ok, error? } pour validation).
//   - Rounding cents : toujours Math.round() pour éviter floating drift.
//   - Tax engine S39 (QC/EU/DZ) INTOUCHÉ — computeFinalPrice accepte un
//     `taxCents` calculé en amont par le tax engine, ne le calcule pas.
//   - Currency conversion : best-effort, identité si from===to OU rate manquant.
// ════════════════════════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────────────────────

/** Default deposit pct pour pré-commandes (charge à l'order, reste à fulfillment). */
export const DEFAULT_DEPOSIT_PCT = 20;

/** Borne supérieure d'un discount appliqué (anti-abus admin). */
export const MAX_DISCOUNT_PCT = 80;

/** Codes erreur déterministes pour validatePricingInput / orchestrateur. */
export const PRICING_ERROR_CODES = {
  BUNDLE_EMPTY: 'BUNDLE_EMPTY',
  INVALID_TIER: 'INVALID_TIER',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  CURRENCY_NOT_SUPPORTED: 'CURRENCY_NOT_SUPPORTED',
  DEPOSIT_INVALID: 'DEPOSIT_INVALID',
  DISCOUNT_INVALID: 'DISCOUNT_INVALID',
} as const;

export type PricingErrorCode = (typeof PRICING_ERROR_CODES)[keyof typeof PRICING_ERROR_CODES];

/**
 * ISO 4217 whitelist (devises actives, sous-set ~170 codes).
 *
 * Sources : ISO 4217:2015 + amendments. Devises retirées (ex DEM, FRF, ITL,
 * VEF, ZWD) exclues. Currencies funds / metal (XAU/XAG/XPT/XPD/XBA/XBT)
 * exclues — uniquement fiat utilisable e-commerce.
 *
 * UPPERCASE uniquement. Lookup O(1) via Set.
 */
export const ISO_4217_CODES = new Set<string>([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BOV',
  'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD',
  'CAD', 'CDF', 'CHE', 'CHF', 'CHW', 'CLF', 'CLP', 'CNY', 'COP', 'COU',
  'CRC', 'CUC', 'CUP', 'CVE', 'CZK',
  'DJF', 'DKK', 'DOP', 'DZD',
  'EGP', 'ERN', 'ETB', 'EUR',
  'FJD', 'FKP',
  'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD',
  'HKD', 'HNL', 'HRK', 'HTG', 'HUF',
  'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK',
  'JMD', 'JOD', 'JPY',
  'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT',
  'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD',
  'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR',
  'MWK', 'MXN', 'MXV', 'MYR', 'MZN',
  'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD',
  'OMR',
  'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG',
  'QAR',
  'RON', 'RSD', 'RUB', 'RWF',
  'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SLL', 'SOS',
  'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL',
  'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS',
  'UAH', 'UGX', 'USD', 'USN', 'UYI', 'UYU', 'UYW', 'UZS',
  'VES', 'VND', 'VUV',
  'WST',
  'XAF', 'XCD', 'XOF', 'XPF',
  'YER',
  'ZAR', 'ZMW', 'ZWL',
]);

/** Volume tier par défaut (utilisé par getVolumeTierDiscount si pas de tiers DB). */
export const DEFAULT_VOLUME_TIERS: ReadonlyArray<{ min: number; discountPct: number }> = [
  { min: 10, discountPct: 5 },
  { min: 50, discountPct: 10 },
  { min: 100, discountPct: 15 },
  { min: 500, discountPct: 20 },
];

// ── computeBundlePrice — pure ─────────────────────────────────────────────

/** Item pour computeBundlePrice (variant + qty + prix). */
export interface BundlePriceItem {
  unit_price_cents: number;
  quantity: number;
}

/** Résultat de computeBundlePrice — décomposition gross/discount/net. */
export interface ComputeBundlePriceResult {
  gross: number;
  discount: number;
  net: number;
}

/**
 * Calcule le prix d'un bundle.
 *
 * Stratégie :
 *   1. `gross` = somme(items.unit_price_cents × quantity), rounded cents.
 *   2. Si `bundlePrice` fourni (>= 0) ⇒ `net = bundlePrice`, `discount = gross - net` (clamped >= 0).
 *   3. Sinon, applique `discountPct` (clamped [0..100]) sur gross.
 *   4. Empty bundle ⇒ { 0, 0, 0 }.
 *
 * PURE — pas de throw. Rounding à chaque étape pour éviter floating drift.
 */
export function computeBundlePrice(
  items: BundlePriceItem[],
  bundlePrice?: number | null,
  discountPct: number = 0,
): ComputeBundlePriceResult {
  if (!Array.isArray(items) || items.length === 0) {
    return { gross: 0, discount: 0, net: 0 };
  }

  const gross = items.reduce((acc, it) => {
    const price = Math.max(0, Math.round(Number(it?.unit_price_cents) || 0));
    const qty = Math.max(0, Math.round(Number(it?.quantity) || 0));
    return acc + price * qty;
  }, 0);

  // Override bundle_price (cas le plus simple — admin a fixé un prix de vente).
  if (bundlePrice !== undefined && bundlePrice !== null) {
    const overrideRaw = Number(bundlePrice);
    if (Number.isFinite(overrideRaw) && overrideRaw >= 0) {
      const net = Math.round(overrideRaw);
      const discount = Math.max(0, gross - net);
      return { gross, discount, net };
    }
  }

  // Sinon : applique discountPct (clamped [0..100]).
  const pctRaw = Number(discountPct);
  const pct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, pctRaw)) : 0;
  const discount = Math.round((gross * pct) / 100);
  const net = Math.max(0, gross - discount);
  return { gross, discount, net };
}

// ── getVolumeTierDiscount — pure ──────────────────────────────────────────

/** Tier de volume (qty min + discount). */
export interface VolumeTier {
  min: number;
  discountPct: number;
}

/** Résultat de getVolumeTierDiscount — tier matché + prochain seuil éventuel. */
export interface VolumeTierResult {
  tier: VolumeTier | null;
  discountPct: number;
  nextThreshold?: number;
}

/**
 * Match une quantité à un tier de volume.
 *
 * Algorithme :
 *   1. Trie tiers par `min` ASC.
 *   2. Trouve le tier avec le plus grand `min ≤ qty`.
 *   3. Si pas de match ⇒ tier=null, discountPct=0, nextThreshold = premier tier.min.
 *   4. Si match ⇒ tier matched, discountPct, nextThreshold = tier suivant.min (si existe).
 *
 * PURE — pas de throw. Si `tiers` est vide ou invalide ⇒ no-tier.
 */
export function getVolumeTierDiscount(
  qty: number,
  tiers: ReadonlyArray<VolumeTier> = DEFAULT_VOLUME_TIERS,
): VolumeTierResult {
  const safeQty = Math.max(0, Math.round(Number(qty) || 0));

  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { tier: null, discountPct: 0 };
  }

  // Filtre + tri ASC (immutable copy — pas de mutation du caller).
  const sorted = tiers
    .filter(
      (t): t is VolumeTier =>
        t !== null &&
        typeof t === 'object' &&
        Number.isFinite(Number(t.min)) &&
        Number.isFinite(Number(t.discountPct)),
    )
    .map((t) => ({
      min: Math.max(0, Math.round(Number(t.min))),
      discountPct: Math.max(0, Math.min(100, Number(t.discountPct))),
    }))
    .sort((a, b) => a.min - b.min);

  if (sorted.length === 0) {
    return { tier: null, discountPct: 0 };
  }

  let matchedIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur && cur.min <= safeQty) {
      matchedIdx = i;
    } else {
      break;
    }
  }

  const firstTier = sorted[0]!; // sorted.length > 0 garanti par check ci-dessus
  if (matchedIdx < 0) {
    return { tier: null, discountPct: 0, nextThreshold: firstTier.min };
  }

  const matched = sorted[matchedIdx]!; // matchedIdx ∈ [0, sorted.length)
  const next = sorted[matchedIdx + 1];
  return {
    tier: matched,
    discountPct: matched.discountPct,
    nextThreshold: next ? next.min : undefined,
  };
}

// ── computePreorderDeposit — pure ─────────────────────────────────────────

/** Résultat de computePreorderDeposit — split deposit/balance. */
export interface PreorderDepositResult {
  deposit: number;
  balance: number;
}

/**
 * Split un total cents en (deposit, balance) selon depositPct.
 *
 * Default 20% du prix total chargé à la pré-commande, le reste à fulfillment.
 *
 * Bornes :
 *   - totalCents < 0 ⇒ { 0, 0 }
 *   - depositPct clampé [0..100]
 *   - deposit = round(total × pct / 100), balance = total - deposit
 *
 * PURE — pas de throw. Sum invariant : deposit + balance === total (toujours).
 */
export function computePreorderDeposit(
  totalCents: number,
  depositPct: number = DEFAULT_DEPOSIT_PCT,
): PreorderDepositResult {
  const totalRaw = Number(totalCents);
  if (!Number.isFinite(totalRaw) || totalRaw < 0) {
    return { deposit: 0, balance: 0 };
  }
  const total = Math.round(totalRaw);

  const pctRaw = Number(depositPct);
  const pct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, pctRaw)) : DEFAULT_DEPOSIT_PCT;

  const deposit = Math.round((total * pct) / 100);
  const balance = Math.max(0, total - deposit);
  return { deposit, balance };
}

// ── convertCurrency — pure ────────────────────────────────────────────────

/** Map devise → rate (depuis currency_rates S39). */
export type CurrencyRateMap = Record<string, number> | Map<string, number>;

/**
 * Convertit un montant cents d'une devise vers une autre.
 *
 * Comportement :
 *   - from === to ⇒ identité (retourne amountCents tel quel).
 *   - rates fourni en map { 'USD': 1.0, 'CAD': 1.35, ... } OR Map().
 *   - Lookup rate dans rates[to/from] OR rates[to] (assume rates relatifs à `from`).
 *   - amountCents × rate, rounded cents.
 *   - amount < 0 ou rate non trouvé ⇒ retourne amountCents (best-effort identité).
 *
 * Cohérence S39 : `rates` provient de la table `currency_rates` (cache ECB/
 * Frankfurter alimenté par cron). Si rate manquant, identité = pas de conversion
 * silencieuse erronée.
 *
 * PURE — pas de throw, pas d'I/O DB ici (DB lookup côté handler appelant).
 */
export function convertCurrency(
  amountCents: number,
  from: string,
  to: string,
  rates: CurrencyRateMap,
): number {
  const amountRaw = Number(amountCents);
  if (!Number.isFinite(amountRaw)) return 0;

  const fromCode = typeof from === 'string' ? from.toUpperCase().trim() : '';
  const toCode = typeof to === 'string' ? to.toUpperCase().trim() : '';

  // Identité — même devise.
  if (fromCode && toCode && fromCode === toCode) {
    return Math.round(amountRaw);
  }

  // Lookup rate dans rates (support Record et Map).
  const lookup = (key: string): number | undefined => {
    if (!key) return undefined;
    if (rates instanceof Map) return rates.get(key);
    if (rates && typeof rates === 'object') {
      const v = (rates as Record<string, number>)[key];
      return typeof v === 'number' ? v : undefined;
    }
    return undefined;
  };

  // Stratégie : essaie rates[`${from}_${to}`], rates[to], puis rates[`${to}/${from}`].
  let rate: number | undefined =
    lookup(`${fromCode}_${toCode}`) ?? lookup(toCode);
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    // Fallback : tente l'inverse (rates de `to` → `from`), si dispo.
    const inverse = lookup(fromCode);
    if (inverse !== undefined && Number.isFinite(inverse) && inverse > 0) {
      rate = 1 / inverse;
    }
  }

  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    // Pas de rate connu : identité best-effort (pas de conversion silencieuse fausse).
    return Math.round(amountRaw);
  }

  return Math.round(amountRaw * rate);
}

// ── isCurrencySupported — pure ────────────────────────────────────────────

/**
 * Vérifie qu'un code devise est ISO 4217 (whitelist ~170 codes).
 *
 * Strict UPPERCASE — lowercase rejected (force discipline call-site).
 * Pas de trim — si tu passes ' USD ', c'est `false`. Le caller doit
 * normaliser en amont.
 */
export function isCurrencySupported(code: string): boolean {
  if (typeof code !== 'string') return false;
  if (code.length !== 3) return false;
  if (code !== code.toUpperCase()) return false;
  return ISO_4217_CODES.has(code);
}

// ── validatePricingInput — pure ───────────────────────────────────────────

/** Input pour validatePricingInput — sous-set de computeFinalPrice. */
export interface PricingInput {
  qty: number;
  currency: string;
  discountPct?: number;
  depositPct?: number;
}

/** Résultat de validatePricingInput — ok + code erreur déterministe. */
export interface ValidatePricingInputResult {
  ok: boolean;
  error?: PricingErrorCode;
  message?: string;
}

/**
 * Valide les bornes strictes d'un input de pricing.
 *
 * Règles :
 *   - qty entier > 0 (Math.round, NaN rejeté)
 *   - currency ISO 4217 uppercase (whitelist)
 *   - discountPct, si fourni, ∈ [0, MAX_DISCOUNT_PCT]
 *   - depositPct, si fourni, ∈ [0, 100]
 *
 * Retourne { ok: false, error: code } au premier échec (fail-fast).
 *
 * Le code MAX_DISCOUNT_PCT (80%) est volontairement strict — au-delà,
 * passer par une approbation admin (Phase B).
 */
export function validatePricingInput(input: PricingInput): ValidatePricingInputResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: PRICING_ERROR_CODES.INVALID_QUANTITY, message: 'input requis' };
  }

  // Quantity strict > 0.
  const qtyRaw = Number(input.qty);
  if (!Number.isFinite(qtyRaw) || qtyRaw <= 0 || Math.round(qtyRaw) !== qtyRaw) {
    return {
      ok: false,
      error: PRICING_ERROR_CODES.INVALID_QUANTITY,
      message: 'qty doit être un entier > 0',
    };
  }

  // Currency ISO 4217 uppercase whitelist.
  if (!isCurrencySupported(input.currency)) {
    return {
      ok: false,
      error: PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED,
      message: `currency '${input.currency}' non supportée (ISO 4217 UPPERCASE requis)`,
    };
  }

  // Discount pct optionnel ∈ [0, MAX_DISCOUNT_PCT].
  if (input.discountPct !== undefined && input.discountPct !== null) {
    const dpct = Number(input.discountPct);
    if (!Number.isFinite(dpct) || dpct < 0 || dpct > MAX_DISCOUNT_PCT) {
      return {
        ok: false,
        error: PRICING_ERROR_CODES.DISCOUNT_INVALID,
        message: `discountPct doit être ∈ [0, ${MAX_DISCOUNT_PCT}]`,
      };
    }
  }

  // Deposit pct optionnel ∈ [0, 100].
  if (input.depositPct !== undefined && input.depositPct !== null) {
    const dep = Number(input.depositPct);
    if (!Number.isFinite(dep) || dep < 0 || dep > 100) {
      return {
        ok: false,
        error: PRICING_ERROR_CODES.DEPOSIT_INVALID,
        message: 'depositPct doit être ∈ [0, 100]',
      };
    }
  }

  return { ok: true };
}

// ── computeFinalPrice — orchestrator pure ─────────────────────────────────

/** Options pour computeFinalPrice — composition pricing complet. */
export interface ComputeFinalPriceOptions {
  /** Override bundle price (cents) — prioritaire sur discountPct. */
  bundlePrice?: number | null;
  /** Discount pct global appliqué au subtotal (clamped [0, MAX_DISCOUNT_PCT]). */
  discountPct?: number;
  /** Taxe en cents — DÉLÉGUÉ au tax engine S39 (QC/EU/DZ). Ne pas calculer ici. */
  taxCents?: number;
  /** Devise source des items (defaults 'CAD'). */
  currency?: string;
}

/** Résultat orchestrateur — décomposition complète. */
export interface ComputeFinalPriceResult {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  currency: string;
  ok: boolean;
  error?: PricingErrorCode;
}

/**
 * Orchestrateur PURE — assemble bundle pricing + discount + tax (délégué).
 *
 * Pipeline :
 *   1. computeBundlePrice(items, bundlePrice, discountPct) ⇒ { gross, discount, net }.
 *   2. subtotal = gross, discount = bundle.discount, tax = taxCents (passé verbatim).
 *   3. total = net + tax.
 *   4. Si items vide ⇒ { 0,0,0,0, ok=false, error=BUNDLE_EMPTY }.
 *
 * ⚠ NE CALCULE PAS la taxe — le tax engine S39 (QC TPS/TVQ, EU VAT, DZ TVA)
 * reste autoritaire. Passe `taxCents` calculé en amont.
 *
 * PURE — pas de throw. Rounding cents partout (anti floating drift).
 */
export function computeFinalPrice(
  items: BundlePriceItem[],
  options: ComputeFinalPriceOptions = {},
): ComputeFinalPriceResult {
  const currency = (options.currency ?? 'CAD').toUpperCase();

  if (!Array.isArray(items) || items.length === 0) {
    return {
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
      currency,
      ok: false,
      error: PRICING_ERROR_CODES.BUNDLE_EMPTY,
    };
  }

  // Borne discountPct au MAX_DISCOUNT_PCT (anti-abus).
  const requestedPct = Number(options.discountPct ?? 0);
  const safeDiscountPct = Number.isFinite(requestedPct)
    ? Math.max(0, Math.min(MAX_DISCOUNT_PCT, requestedPct))
    : 0;

  const bundle = computeBundlePrice(items, options.bundlePrice, safeDiscountPct);

  const taxRaw = Number(options.taxCents ?? 0);
  const tax = Number.isFinite(taxRaw) && taxRaw >= 0 ? Math.round(taxRaw) : 0;

  const total = Math.max(0, bundle.net + tax);

  return {
    subtotal: bundle.gross,
    discount: bundle.discount,
    tax,
    total,
    currency,
    ok: true,
  };
}

// NB additif : 8 helpers PURE additifs (computeBundlePrice / getVolumeTierDiscount
// / computePreorderDeposit / convertCurrency / isCurrencySupported /
// validatePricingInput / computeFinalPrice) + 4 constants (DEFAULT_DEPOSIT_PCT
// / MAX_DISCOUNT_PCT / PRICING_ERROR_CODES / ISO_4217_CODES + DEFAULT_VOLUME_TIERS).
// Zéro régression : les 3 helpers originaux (resolveTierPrice / computeBundleDiscount
// / processPreorderNotification) sont INTOUCHÉS. Tax engine S39 (QC/EU/DZ)
// INTOUCHÉ — orchestrateur computeFinalPrice accepte `taxCents` pré-calculé.
// Multi-tenant : aucun helper additif ne touche la DB ⇒ pas de bornage tenant
// à gérer ici (handler caller responsable). Rounding cents partout. Pas de throw.
