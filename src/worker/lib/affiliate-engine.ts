// ── Sprint 49 — affiliate-engine.ts — Engine programme affiliation order-based
//
// Helpers PURE/HANDLER pour affiliates.ts Sprint 49. Étend le module
// affiliation natif S(G2) (seq92) vers un modèle order-based avec tiers
// (starter|silver|gold ⇒ 5/10/15%), commission automatique sur order
// completed, payouts mensuels en batch, link click tracking.
//
// 5 helpers (signatures FIGÉES Phase A, corps Phase B affinés) :
//   - generateAffiliateCode(name)               : pure, slug + suffixe random 4 chars.
//   - computeCommissionForOrder(env, total, tier) : pure (env présent pour
//                                                    extensions Phase B :
//                                                    tier overrides DB, multi-
//                                                    currency, etc.), retourne
//                                                    { cents, pct } par tier.
//   - computeAffiliateMetrics(env, affiliateId)  : async D1, agrège clicks +
//                                                    conversions + total
//                                                    commission + conversion_rate.
//   - attributeOrderToAffiliate(env, orderId, code) : async D1, appelé sur
//                                                    order completed. Résout
//                                                    code → affiliate_id (borné
//                                                    tenant), calcule commission,
//                                                    INSERT affiliate_referrals
//                                                    status='pending'.
//   - createPayoutBatch(env, clientId, start, end) : async D1, sélectionne les
//                                                    referrals confirmed dans
//                                                    la fenêtre [start, end] →
//                                                    groupe par affiliate_id →
//                                                    insère N affiliate_payouts.
//
// Contrats GELÉS (docs/LOT-AFFILIATES-S49.md §6) :
//   - imports RELATIFS uniquement (`../types`)
//   - PAS de throw — best-effort, dégradation gracieuse (calque pricing-engine)
//   - PAS d'appel réseau email/Stripe réel en Phase A. Phase B câblera Stripe
//     Connect (transfer.create) et Resend (notification commission).
//   - Devise locked 'CAD' V1 (cohérence seq120 / seq143 / seq142)
//
// ⚠ NE TOUCHE PAS aux helpers ecommerce-*.ts existants. Pas de mutation
//   directe d'orders/order_items — uniquement affiliate_referrals + lectures
//   orders/affiliates pour le calcul.

import type { Env } from '../types';

// ── Types internes (alignés api.ts client) ────────────────────────────────

/** Tier d'affilié — détermine la commission par défaut. */
export type AffiliateTier = 'starter' | 'silver' | 'gold';

/** Commission_pct par défaut par tier (override possible via affiliates.commission_pct). */
export const TIER_COMMISSION_PCT: Record<AffiliateTier, number> = {
  starter: 0.05,
  silver: 0.10,
  gold: 0.15,
};

/** Whitelist tiers valides (validation HANDLER — PAS de CHECK SQL). */
export const AFFILIATE_TIERS_S49 = ['starter', 'silver', 'gold'] as const;

/** Statuts referral Sprint 49 (validation HANDLER). */
export const REFERRAL_STATUSES = [
  'pending',
  'confirmed',
  'paid',
  'reversed',
] as const;

/** Statuts payout Sprint 49 (validation HANDLER). */
export const PAYOUT_STATUSES = ['pending', 'paid', 'failed'] as const;

/** Méthodes payout (stripe_connect INACTIF V1). */
export const PAYOUT_METHODS = ['manual', 'stripe_connect'] as const;

/** Résultat de computeCommissionForOrder() — montant + pourcentage appliqué. */
export interface CommissionResult {
  /** Commission en cents (round half-up). */
  cents: number;
  /** Pourcentage appliqué ∈ [0..1] (debug + audit). */
  pct: number;
}

/** Résultat de computeAffiliateMetrics() — agrégats UI dashboard. */
export interface AffiliateMetricsResult {
  clicks: number;
  conversions: number;
  total_commission_cents: number;
  conversion_rate: number;
  total_referrals: number;
}

/** Résultat de attributeOrderToAffiliate() — best-effort attribution. */
export interface AttributeOrderResult {
  matched: boolean;
  affiliate_id: string | null;
  commission_cents: number;
  referral_id?: string | null;
  reason?: string;
}

/** Résultat de createPayoutBatch() — agrégats batch créé. */
export interface CreatePayoutBatchResult {
  payouts_created: number;
  total_cents: number;
  referrals_count: number;
  reason?: string;
}

// ── generateAffiliateCode — pure ──────────────────────────────────────────

/**
 * Génère un code affilié à partir d'un nom (slug + suffixe random 4 chars).
 *
 * PURE — pas d'I/O. L'unicité par tenant est garantie par l'INDEX UNIQUE
 * `uniq_affiliates_client_code` (client_id, code) ajouté en seq144 ; le
 * HANDLER doit re-tenter en cas de collision (boucle bornée).
 *
 * Pattern : `[a-z0-9]{1..32}-[a-z0-9]{4}` (suffixe random pour minimiser
 * collisions sans dépendre du nom seul).
 *
 * @param name  Nom à slugifier (peut être vide ⇒ 'aff').
 */
export function generateAffiliateCode(name: string): string {
  const base = (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const slug = base || 'aff';
  // Suffixe random 4 chars [a-z0-9].
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug}-${suffix}`;
}

// ── computeCommissionForOrder — pure (env reserved Phase B) ───────────────

/**
 * Calcule la commission d'un affilié pour un order donné.
 *
 * Algorithme V1 :
 *   commission_cents = round(orderTotal * TIER_COMMISSION_PCT[tier])
 *
 * Tier inconnu ou null ⇒ fallback 'starter' (5%). Order total <= 0 ⇒ 0.
 *
 * Phase B : surcharge possible via `affiliates.commission_pct` (override
 * tier default) — le HANDLER appelle alors directement avec le pct résolu
 * depuis la row affiliate.
 *
 * @param _env       Réservé Phase B (lookups tier overrides DB, multi-currency).
 * @param orderTotal Total order en cents.
 * @param tier       Tier de l'affilié (starter|silver|gold).
 */
export function computeCommissionForOrder(
  _env: Env,
  orderTotal: number,
  tier: AffiliateTier | string | null | undefined,
): CommissionResult {
  const total = Math.max(0, Math.round(Number(orderTotal) || 0));
  if (total <= 0) return { cents: 0, pct: 0 };

  const safeTier: AffiliateTier =
    tier === 'silver' || tier === 'gold' ? tier : 'starter';
  const pct = TIER_COMMISSION_PCT[safeTier];
  const cents = Math.round(total * pct);
  return { cents, pct };
}

// ── computeAffiliateMetrics — async D1 ────────────────────────────────────

/**
 * Calcule les métriques agrégées d'un affilié (clicks + conversions +
 * total commission + conversion rate).
 *
 * Best-effort : si l'une des tables est absente (migration non jouée) ⇒
 * compte 0, ne lève JAMAIS. PAS de bornage tenant ici — le caller (handler)
 * a déjà vérifié l'appartenance via loadAffiliateInTenant.
 */
export async function computeAffiliateMetrics(
  env: Env,
  affiliateId: string,
): Promise<AffiliateMetricsResult> {
  if (!affiliateId) {
    return {
      clicks: 0,
      conversions: 0,
      total_commission_cents: 0,
      conversion_rate: 0,
      total_referrals: 0,
    };
  }

  let clicks = 0;
  let conversions = 0;
  let totalCommission = 0;
  let totalReferrals = 0;

  try {
    const c = (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM affiliate_clicks WHERE affiliate_id = ?',
    )
      .bind(affiliateId)
      .first()) as { n: number } | null;
    clicks = Number(c?.n ?? 0);
  } catch {
    /* best-effort */
  }

  try {
    // Conversions = referrals dont status ∈ (confirmed, paid).
    const conv = (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM affiliate_referrals
       WHERE affiliate_id = ? AND status IN ('confirmed', 'paid')`,
    )
      .bind(affiliateId)
      .first()) as { n: number } | null;
    conversions = Number(conv?.n ?? 0);
  } catch {
    /* best-effort */
  }

  try {
    const tot = (await env.DB.prepare(
      `SELECT COALESCE(SUM(commission_cents), 0) AS s FROM affiliate_referrals
       WHERE affiliate_id = ? AND status IN ('confirmed', 'paid')`,
    )
      .bind(affiliateId)
      .first()) as { s: number } | null;
    totalCommission = Math.max(0, Math.round(Number(tot?.s ?? 0)));
  } catch {
    /* best-effort */
  }

  try {
    const tr = (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM affiliate_referrals WHERE affiliate_id = ?',
    )
      .bind(affiliateId)
      .first()) as { n: number } | null;
    totalReferrals = Number(tr?.n ?? 0);
  } catch {
    /* best-effort */
  }

  const conversionRate = clicks > 0 ? Math.min(1, conversions / clicks) : 0;

  return {
    clicks,
    conversions,
    total_commission_cents: totalCommission,
    conversion_rate: Math.round(conversionRate * 10000) / 10000,
    total_referrals: totalReferrals,
  };
}

// ── attributeOrderToAffiliate — async D1 ──────────────────────────────────

/**
 * Attribue un order à un affilié sur la base du referral code (cookie ou
 * `?aff=` au moment du checkout).
 *
 * Algorithme :
 *   1. Lookup affiliate par code (status='active') — borne tenant via la
 *      client_id de l'order pour empêcher l'attribution cross-tenant.
 *   2. Idempotence : si referral existe déjà pour (order_id), no-op.
 *   3. Lookup order (total_cents + client_id) — empêche l'attribution si
 *      l'order n'existe pas / pas du même tenant que l'affilié.
 *   4. computeCommissionForOrder(env, total, affiliate.tier) → commission_cents.
 *   5. INSERT affiliate_referrals (status='pending').
 *   6. UPDATE orders SET referred_by_affiliate_id, referral_code (snapshot).
 *
 * Best-effort : aucune étape ne lève — un échec quelconque retourne
 * { matched: false, ...reason }. L'order completed n'est JAMAIS rollback.
 *
 * Phase B Manager-B câblera l'appel sur le webhook order.completed
 * (ecommerce-checkout.ts).
 */
export async function attributeOrderToAffiliate(
  env: Env,
  orderId: string,
  referralCode: string,
): Promise<AttributeOrderResult> {
  const result: AttributeOrderResult = {
    matched: false,
    affiliate_id: null,
    commission_cents: 0,
  };

  try {
    const code = (referralCode || '').trim();
    if (!orderId || !code) {
      return { ...result, reason: 'missing_order_or_code' };
    }

    // 1) Order — lookup pour total + client_id (bornage tenant).
    let order: { client_id: string | null; total_cents: number } | null = null;
    try {
      order = (await env.DB.prepare(
        'SELECT client_id, total_cents FROM orders WHERE id = ?',
      )
        .bind(orderId)
        .first()) as { client_id: string | null; total_cents: number } | null;
    } catch {
      return { ...result, reason: 'order_lookup_failed' };
    }
    if (!order) return { ...result, reason: 'order_not_found' };

    // 2) Affilié — code unique par client_id (uniq_affiliates_client_code).
    let affiliate:
      | { id: string; tier: string | null; commission_pct: number | null }
      | null = null;
    try {
      affiliate = (await env.DB.prepare(
        `SELECT id, tier, commission_pct FROM affiliates
         WHERE code = ? AND client_id IS ? AND status = 'active' LIMIT 1`,
      )
        .bind(code, order.client_id)
        .first()) as
        | { id: string; tier: string | null; commission_pct: number | null }
        | null;
    } catch {
      return { ...result, reason: 'affiliate_lookup_failed' };
    }
    if (!affiliate) return { ...result, reason: 'affiliate_not_found' };

    // 3) Idempotence — pas de double referral pour (order_id).
    try {
      const existing = (await env.DB.prepare(
        'SELECT id FROM affiliate_referrals WHERE order_id = ? LIMIT 1',
      )
        .bind(orderId)
        .first()) as { id: string } | null;
      if (existing) {
        return {
          matched: true,
          affiliate_id: affiliate.id,
          commission_cents: 0,
          referral_id: existing.id,
          reason: 'already_attributed',
        };
      }
    } catch {
      /* best-effort — continue */
    }

    // 4) Calcul commission — override via affiliate.commission_pct ou tier default.
    const overridePct =
      affiliate.commission_pct != null && Number.isFinite(affiliate.commission_pct)
        ? Number(affiliate.commission_pct)
        : null;
    let commission: CommissionResult;
    if (overridePct != null && overridePct > 0) {
      const total = Math.max(0, Math.round(Number(order.total_cents) || 0));
      commission = {
        cents: Math.round(total * overridePct),
        pct: overridePct,
      };
    } else {
      commission = computeCommissionForOrder(
        env,
        order.total_cents,
        affiliate.tier as AffiliateTier | null,
      );
    }

    // 5) INSERT referral pending (Phase B : webhook confirm passe à confirmed
    //    après cooling period).
    const referralId = crypto.randomUUID().replace(/-/g, '');
    try {
      await env.DB.prepare(
        `INSERT INTO affiliate_referrals
           (id, client_id, affiliate_id, order_id, commission_cents, status, code)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
        .bind(
          referralId,
          order.client_id,
          affiliate.id,
          orderId,
          commission.cents,
          code,
        )
        .run();
    } catch {
      return { ...result, reason: 'referral_insert_failed' };
    }

    // 6) UPDATE order snapshot (best-effort — l'order n'est jamais rollback).
    try {
      await env.DB.prepare(
        `UPDATE orders SET referred_by_affiliate_id = ?, referral_code = ?
         WHERE id = ?`,
      )
        .bind(affiliate.id, code, orderId)
        .run();
    } catch {
      /* best-effort */
    }

    return {
      matched: true,
      affiliate_id: affiliate.id,
      commission_cents: commission.cents,
      referral_id: referralId,
    };
  } catch {
    return { ...result, reason: 'exception' };
  }
}

// ── createPayoutBatch — async D1 ──────────────────────────────────────────

/**
 * Crée un batch de payouts pour une période donnée.
 *
 * Algorithme :
 *   1. SELECT affiliate_referrals WHERE client_id = ? AND status='confirmed'
 *      AND confirmed_at BETWEEN period_start AND period_end (jamais re-payés
 *      — payout_id IS NULL).
 *   2. Groupe par affiliate_id → agrège SUM(commission_cents) + COUNT(*).
 *   3. INSERT N affiliate_payouts (status='pending', total_cents + referrals_count).
 *   4. UPDATE affiliate_referrals SET payout_id = ? pour chaque referral
 *      regroupé (lock — empêche le re-batch).
 *
 * Best-effort : si la table est absente ou bornée vide ⇒ retourne 0 créés.
 *
 * Phase B Manager-B : ajoutera l'appel Stripe Connect transfer.create après
 * markPaid (handler distinct).
 */
export async function createPayoutBatch(
  env: Env,
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<CreatePayoutBatchResult> {
  if (!clientId || !periodStart || !periodEnd) {
    return {
      payouts_created: 0,
      total_cents: 0,
      referrals_count: 0,
      reason: 'missing_params',
    };
  }

  try {
    // 1) Group by affiliate_id — confirmed referrals dans la fenêtre, non
    //    encore batchés (payout_id IS NULL).
    let grouped: Array<{
      affiliate_id: string;
      total: number;
      count: number;
    }> = [];
    try {
      const res = await env.DB.prepare(
        `SELECT affiliate_id,
                COALESCE(SUM(commission_cents), 0) AS total,
                COUNT(*) AS count
         FROM affiliate_referrals
         WHERE client_id = ?
           AND status = 'confirmed'
           AND payout_id IS NULL
           AND confirmed_at >= ?
           AND confirmed_at <= ?
         GROUP BY affiliate_id`,
      )
        .bind(clientId, periodStart, periodEnd)
        .all();
      grouped = ((res?.results ?? []) as Array<{
        affiliate_id: string;
        total: number;
        count: number;
      }>).filter((r) => r.affiliate_id && r.total > 0);
    } catch {
      return {
        payouts_created: 0,
        total_cents: 0,
        referrals_count: 0,
        reason: 'group_query_failed',
      };
    }

    if (grouped.length === 0) {
      return {
        payouts_created: 0,
        total_cents: 0,
        referrals_count: 0,
        reason: 'no_referrals',
      };
    }

    let payoutsCreated = 0;
    let totalCents = 0;
    let totalReferrals = 0;

    // 2) + 3) + 4) INSERT payouts + lock referrals.
    for (const g of grouped) {
      const payoutId = crypto.randomUUID().replace(/-/g, '');
      try {
        await env.DB.prepare(
          `INSERT INTO affiliate_payouts
             (id, affiliate_id, client_id, period_start, period_end,
              total_cents, referrals_count, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        )
          .bind(
            payoutId,
            g.affiliate_id,
            clientId,
            periodStart,
            periodEnd,
            g.total,
            g.count,
          )
          .run();
        // Lock referrals (empêche re-batch).
        await env.DB.prepare(
          `UPDATE affiliate_referrals
              SET payout_id = ?
            WHERE client_id = ?
              AND affiliate_id = ?
              AND status = 'confirmed'
              AND payout_id IS NULL
              AND confirmed_at >= ?
              AND confirmed_at <= ?`,
        )
          .bind(payoutId, clientId, g.affiliate_id, periodStart, periodEnd)
          .run();
        payoutsCreated += 1;
        totalCents += g.total;
        totalReferrals += g.count;
      } catch {
        /* best-effort — skip ce groupe, continue les autres */
      }
    }

    return {
      payouts_created: payoutsCreated,
      total_cents: totalCents,
      referrals_count: totalReferrals,
    };
  } catch {
    return {
      payouts_created: 0,
      total_cents: 0,
      referrals_count: 0,
      reason: 'exception',
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 49 Bis — Helpers additifs (pure) pour edge cases
//
// Renforce l'engine sans toucher aux 5 helpers existants. Couvre :
//   - computeCommission        : flat | pct | tier-based + cap optionnel.
//   - isSelfReferral           : email match case-insensitive + alias Gmail.
//   - detectFraudPattern       : same IP > N clicks / window + dup fingerprint.
//   - isPayoutEligible         : status confirmed + age minimum jours.
//   - computeReversal          : full | partial sur refund order.
//   - getTierForVolume         : volume cents → tier selon thresholds.
//   - validateCommissionConfig : rate > 0, pct ≤ 1, cap si applicable.
//
// PURE — pas d'I/O, pas de throw. Caller PASSE les paramètres pertinents
// (clicks préfetchés, currentDate Date | string injectable pour tests).
// Best-effort comme le reste du module : valeur fausse / null ⇒ retour
// sécuritaire (0 cents, suspicious=true, eligible=false).
// ════════════════════════════════════════════════════════════════════════════

/** Codes d'erreur du module affilié (UI + logs structurés). */
export const AFFILIATE_ERROR_CODES = {
  AFFILIATE_NOT_FOUND: 'AFFILIATE_NOT_FOUND',
  REFERRAL_INVALID: 'REFERRAL_INVALID',
  SELF_REFERRAL: 'SELF_REFERRAL',
  ALREADY_REVERSED: 'ALREADY_REVERSED',
  PAYOUT_INELIGIBLE: 'PAYOUT_INELIGIBLE',
  STRIPE_NOT_CONFIGURED: 'STRIPE_NOT_CONFIGURED',
  FRAUD_DETECTED: 'FRAUD_DETECTED',
} as const;

/** Modèles d'attribution supportés (résolus tenant config Phase B+). */
export const ATTRIBUTION_MODELS = ['first_touch', 'last_touch', 'multi_touch'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

/** Délai minimum (jours) entre confirmation referral et éligibilité payout. */
export const DEFAULT_PAYOUT_DELAY_DAYS = 14;

/** Règle de commission V2 (flat cents | pct of order | tier-based). */
export type CommissionRule =
  | { kind: 'flat'; cents: number }
  | { kind: 'pct'; pct: number; capCents?: number }
  | { kind: 'tier'; pct: number; capCents?: number };

/** Tier label (étendu vs AffiliateTier — bronze/platinum possibles). */
export type Tier = 'bronze' | 'starter' | 'silver' | 'gold' | 'platinum' | string;

/** Tier threshold (volume minimum en cents pour atteindre ce tier). */
export interface TierThreshold {
  tier: Tier;
  minVolumeCents: number;
  pct?: number;
}

/**
 * Calcule la commission V2 selon la règle passée. Pure.
 *
 *   - flat   : retourne cents (cap au montant order pour éviter négatif).
 *   - pct    : round(orderTotal * pct), borné par capCents si fourni.
 *   - tier   : idem pct mais le caller a déjà résolu le tier via
 *              getTierForVolume(). pct doit être ∈ [0..1].
 *
 * orderTotal ≤ 0 ⇒ 0. pct invalide (NaN/négatif) ⇒ 0.
 */
export function computeCommission(
  orderTotal: number,
  rule: CommissionRule,
  _tier?: Tier,
): number {
  const total = Math.max(0, Math.round(Number(orderTotal) || 0));
  if (total <= 0) return 0;
  if (!rule || typeof rule !== 'object') return 0;

  if (rule.kind === 'flat') {
    const cents = Math.max(0, Math.round(Number(rule.cents) || 0));
    // Cap au total (on ne paie pas + que le panier).
    return Math.min(cents, total);
  }

  if (rule.kind === 'pct' || rule.kind === 'tier') {
    const pct = Number(rule.pct);
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    // pct ∈ [0..1] strict — caller responsabilité (validateCommissionConfig).
    if (pct > 1) return 0;
    const raw = Math.round(total * pct);
    const cap =
      rule.capCents != null && Number.isFinite(Number(rule.capCents)) && Number(rule.capCents) > 0
        ? Math.round(Number(rule.capCents))
        : null;
    return cap != null ? Math.min(raw, cap) : raw;
  }

  return 0;
}

/**
 * Normalise un email pour comparer : lowercase + trim + alias Gmail+ stripped.
 *
 *   "John.Doe+promo@Gmail.com" → "john.doe@gmail.com"
 *   "  jane@Example.COM  "     → "jane@example.com"
 *
 * NB : alias Gmail strip = `+suffix` AVANT le `@` (convention Gmail/G Workspace).
 * Pour les autres providers, le `+` reste valide mais Gmail-style est dominant.
 */
function normalizeEmail(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s.includes('@')) return s;
  const [local, domain] = s.split('@');
  if (!local || !domain) return s;
  const stripped = local.split('+')[0] ?? local;
  return `${stripped}@${domain}`;
}

/**
 * Détecte le self-referral (l'affilié essaye de toucher une commission sur sa
 * propre commande).
 *
 *   - case-insensitive comparison
 *   - alias Gmail+ stripped (john+x@gmail.com == john@gmail.com)
 *   - trim espaces
 *
 * Emails vides / falsy / non-strings ⇒ false (pas de match, pas de blocage).
 */
export function isSelfReferral(
  buyerEmail: string | null | undefined,
  affiliateEmail: string | null | undefined,
): boolean {
  const a = normalizeEmail(buyerEmail);
  const b = normalizeEmail(affiliateEmail);
  if (!a || !b) return false;
  return a === b;
}

/** Click event pour detectFraudPattern (PII-safe : hashed IP/UA). */
export interface ClickEvent {
  /** ISO timestamp ou epoch ms (parsable par Date). */
  clickedAt: string | number | Date;
  /** Hash IP (Loi 25 — pas brut). */
  ipHash?: string | null;
  /** Optional fingerprint (UA hash + headers). */
  fingerprint?: string | null;
  /** Optional affiliate id (cross-account fingerprint detection). */
  affiliateId?: string | null;
}

/**
 * Détecte un pattern de fraude sur une liste de clicks récents.
 *
 * Heuristiques V1 :
 *   - Même `ipHash` > 10 clicks dans `windowMin` minutes ⇒ rate-spike.
 *   - Même `fingerprint` partagé par ≥ 2 affiliateIds distincts ⇒ farming.
 *
 * Pure — caller préfetche les clicks (D1 SELECT WHERE clicked_at >= ...).
 * Retourne `reasons` lisible côté admin (pas de stack trace).
 */
export function detectFraudPattern(
  clicks: ClickEvent[],
  windowMin = 5,
): { suspicious: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!Array.isArray(clicks) || clicks.length === 0) {
    return { suspicious: false, reasons };
  }

  const windowMs = Math.max(1, Math.round(windowMin)) * 60_000;
  const now = Date.now();

  // 1) Rate-spike par IP hash dans la fenêtre.
  const ipCounts = new Map<string, number>();
  for (const c of clicks) {
    if (!c?.ipHash) continue;
    const ts = c.clickedAt instanceof Date ? c.clickedAt.getTime() : new Date(c.clickedAt).getTime();
    if (!Number.isFinite(ts) || now - ts > windowMs) continue;
    ipCounts.set(c.ipHash, (ipCounts.get(c.ipHash) || 0) + 1);
  }
  for (const [ip, n] of ipCounts) {
    if (n > 10) {
      reasons.push(`rate_spike_ip:${ip.slice(0, 8)}…(${n}/${windowMin}min)`);
    }
  }

  // 2) Fingerprint partagé cross-affiliate (farming).
  const fpToAffs = new Map<string, Set<string>>();
  for (const c of clicks) {
    if (!c?.fingerprint || !c?.affiliateId) continue;
    if (!fpToAffs.has(c.fingerprint)) fpToAffs.set(c.fingerprint, new Set());
    fpToAffs.get(c.fingerprint)!.add(c.affiliateId);
  }
  for (const [fp, affs] of fpToAffs) {
    if (affs.size >= 2) {
      reasons.push(
        `fingerprint_shared:${fp.slice(0, 8)}…(${affs.size}_accounts)`,
      );
    }
  }

  return { suspicious: reasons.length > 0, reasons };
}

/** Forme minimale d'un referral pour eligibility / reversal (lecture seule). */
export interface ReferralRecord {
  id?: string;
  status?: string | null;
  commission_cents?: number | null;
  confirmed_at?: string | number | Date | null;
  payout_id?: string | null;
}

/**
 * Détermine si un referral est éligible au payout.
 *
 * Critères :
 *   - status === 'confirmed' (pending = pas encore validé, paid = déjà payé,
 *     reversed = annulé).
 *   - Age depuis confirmed_at >= minDaysAfter (cooling period anti-refund).
 *
 * `currentDate` injectable pour les tests (sinon Date.now()).
 */
export function isPayoutEligible(
  referral: ReferralRecord | null | undefined,
  minDaysAfter: number = DEFAULT_PAYOUT_DELAY_DAYS,
  currentDate?: Date | number | string,
): { eligible: boolean; reason?: string } {
  if (!referral || typeof referral !== 'object') {
    return { eligible: false, reason: AFFILIATE_ERROR_CODES.REFERRAL_INVALID };
  }
  const status = (referral.status || '').toLowerCase();
  if (status !== 'confirmed') {
    return { eligible: false, reason: `status_not_confirmed:${status || 'unknown'}` };
  }
  if (referral.payout_id) {
    return { eligible: false, reason: 'already_in_payout' };
  }
  if (!referral.confirmed_at) {
    return { eligible: false, reason: 'missing_confirmed_at' };
  }

  const confirmedTs =
    referral.confirmed_at instanceof Date
      ? referral.confirmed_at.getTime()
      : new Date(referral.confirmed_at).getTime();
  if (!Number.isFinite(confirmedTs)) {
    return { eligible: false, reason: 'invalid_confirmed_at' };
  }
  const nowTs =
    currentDate instanceof Date
      ? currentDate.getTime()
      : typeof currentDate === 'number'
        ? currentDate
        : typeof currentDate === 'string'
          ? new Date(currentDate).getTime()
          : Date.now();
  const ageMs = nowTs - confirmedTs;
  const minMs = Math.max(0, Math.round(minDaysAfter)) * 86_400_000;
  if (ageMs < minMs) {
    const daysShort = Math.ceil((minMs - ageMs) / 86_400_000);
    return {
      eligible: false,
      reason: `too_recent:wait_${daysShort}d`,
    };
  }
  return { eligible: true };
}

/**
 * Calcule le montant de reversal d'une commission sur refund.
 *
 *   - Full refund (refundedCents == orderCents OU non fourni) ⇒ reverse 100%.
 *   - Partial refund ⇒ reverse au prorata (round half-up).
 *   - Referral déjà reversed ⇒ { reverseAmount: 0, reason: ALREADY_REVERSED }.
 *
 * Caller calcule le ratio refund/order avant d'appeler.
 */
export function computeReversal(
  referral: ReferralRecord | null | undefined,
  refundRatio = 1,
): { reverseAmount: number; reason: string } {
  if (!referral || typeof referral !== 'object') {
    return { reverseAmount: 0, reason: AFFILIATE_ERROR_CODES.REFERRAL_INVALID };
  }
  const status = (referral.status || '').toLowerCase();
  if (status === 'reversed') {
    return { reverseAmount: 0, reason: AFFILIATE_ERROR_CODES.ALREADY_REVERSED };
  }
  const commission = Math.max(0, Math.round(Number(referral.commission_cents) || 0));
  if (commission <= 0) return { reverseAmount: 0, reason: 'no_commission' };

  const ratio = Math.max(0, Math.min(1, Number(refundRatio) || 0));
  if (ratio <= 0) return { reverseAmount: 0, reason: 'no_refund' };

  const amount = Math.round(commission * ratio);
  return {
    reverseAmount: amount,
    reason: ratio >= 1 ? 'full_refund' : 'partial_refund',
  };
}

/**
 * Résout le tier d'un affilié selon son volume de ventes cumulé.
 *
 * Les `tiers` doivent être triés (ou non — on trie par minVolumeCents desc).
 * Retourne le tier dont `minVolumeCents` ≤ volumeCents (premier match du tri
 * descendant). Si rien ne match, retourne le tier le plus bas (premier du tri
 * ascendant) ou 'starter' par défaut.
 */
export function getTierForVolume(
  volumeCents: number,
  tiers: TierThreshold[],
): Tier {
  const v = Math.max(0, Math.round(Number(volumeCents) || 0));
  if (!Array.isArray(tiers) || tiers.length === 0) return 'starter';
  const sorted = [...tiers]
    .filter((t) => t && Number.isFinite(t.minVolumeCents))
    .sort((a, b) => b.minVolumeCents - a.minVolumeCents);
  for (const t of sorted) {
    if (v >= t.minVolumeCents) return t.tier;
  }
  return sorted[sorted.length - 1]?.tier ?? 'starter';
}

/**
 * Valide une CommissionRule. Centralise les règles d'admission (config UI).
 *
 *   - flat   : cents > 0.
 *   - pct    : pct > 0 AND pct ≤ 1 (i.e. 100%).
 *   - tier   : idem pct.
 *
 * Cap optionnel : capCents > 0 si présent.
 */
export function validateCommissionConfig(
  config: CommissionRule | null | undefined,
): { ok: boolean; error?: string } {
  if (!config || typeof config !== 'object') return { ok: false, error: 'config_missing' };

  if (config.kind === 'flat') {
    const c = Number(config.cents);
    if (!Number.isFinite(c) || c <= 0) return { ok: false, error: 'flat_cents_must_be_positive' };
    return { ok: true };
  }

  if (config.kind === 'pct' || config.kind === 'tier') {
    const p = Number(config.pct);
    if (!Number.isFinite(p) || p <= 0) {
      return { ok: false, error: 'pct_must_be_positive' };
    }
    if (p > 1) {
      return { ok: false, error: 'pct_must_be_lte_1' };
    }
    if (config.capCents != null) {
      const cap = Number(config.capCents);
      if (!Number.isFinite(cap) || cap <= 0) {
        return { ok: false, error: 'cap_must_be_positive' };
      }
    }
    return { ok: true };
  }

  return { ok: false, error: 'unknown_kind' };
}

// NB : 5 helpers exposés (generateAffiliateCode pure, computeCommissionForOrder
// pure, computeAffiliateMetrics async, attributeOrderToAffiliate async,
// createPayoutBatch async) + 7 helpers V2 additifs (computeCommission,
// isSelfReferral, detectFraudPattern, isPayoutEligible, computeReversal,
// getTierForVolume, validateCommissionConfig) + 3 constants (ATTRIBUTION_MODELS,
// AFFILIATE_ERROR_CODES, DEFAULT_PAYOUT_DELAY_DAYS). PAS de throw, PAS d'appel
// Stripe/email réel en Phase A. Imports RELATIFS uniquement (`../types`).
// Devise locked 'CAD' V1. Choix figés docs/LOT-AFFILIATES-S49.md §6.
