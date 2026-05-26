// ── saas-billing-engine.ts — Helpers PURS SaaS billing (RENFORCEMENT P0-7) ─
//
// Contrat ADDITIF — 100% : aucun import depuis saas-billing.ts existant,
// aucun remplacement de logique vivante. Distinct des helpers Stripe live
// (./saas-billing-live.ts) et mock (./saas-billing-mock.ts).
//
// Helpers PURS (zéro I/O) pour :
//   - Plan tiers + limits par tier (PLAN_LIMITS)
//   - Proration computation (computeProration)
//   - Dunning retry schedule (getDunningSchedule)
//   - Plan transition validation (validatePlanTransition)
//   - MRR/Churn metrics (computeMrr / computeChurnRate)
//   - Mock event ID pattern (mock_evt_<uuid>)

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const BILLING_ERROR_CODES = {
  PLAN_UNKNOWN: 'PLAN_UNKNOWN',
  PLAN_DOWNGRADE_BLOCKED: 'PLAN_DOWNGRADE_BLOCKED',
  PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED',
  PERIOD_UNKNOWN: 'PERIOD_UNKNOWN',
  PRORATION_INVALID: 'PRORATION_INVALID',
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  SUBSCRIPTION_ALREADY_ACTIVE: 'SUBSCRIPTION_ALREADY_ACTIVE',
  STRIPE_NOT_CONFIGURED: 'STRIPE_NOT_CONFIGURED',
  AGENCY_ONLY: 'AGENCY_ONLY',
  INVALID_INPUT: 'INVALID_INPUT',
  WEBHOOK_REPLAY: 'WEBHOOK_REPLAY',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  DUNNING_FINAL_REACHED: 'DUNNING_FINAL_REACHED',
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Plan tiers (frozen) + limits map
// ════════════════════════════════════════════════════════════════════════════

export const VALID_PLAN_TIERS = ['free', 'starter', 'pro', 'unlimited'] as const;
export type PlanTier = (typeof VALID_PLAN_TIERS)[number];

export const VALID_BILLING_PERIODS = ['monthly', 'yearly'] as const;
export type BillingPeriod = (typeof VALID_BILLING_PERIODS)[number];

export interface PlanLimit {
  /** Nombre max sous-comptes/clients dans l'agence. null = illimité. */
  clients: number | null;
  /** Nombre max leads par mois. null = illimité. */
  leads: number | null;
  /** Nombre max users (team members). null = illimité. */
  users: number | null;
  /** Nombre max produits e-commerce. null = illimité. */
  products: number | null;
  /** Stockage max en MB. null = illimité. */
  storageMb: number | null;
  /** Prix mensuel en cents USD (référence). */
  monthlyCents: number;
  /** Prix annuel en cents USD (référence, ~ -17% vs monthly*12). */
  yearlyCents: number;
}

/** Limits par tier, valeurs de référence ALIGNÉES avec docs/PLANS-SAAS.md.
 * Multi-tenant strict — toute valeur null = "illimité" (pas 0). */
export const PLAN_LIMITS: Readonly<Record<PlanTier, PlanLimit>> = Object.freeze({
  free: Object.freeze({
    clients: 1,
    leads: 100,
    users: 1,
    products: 10,
    storageMb: 100,
    monthlyCents: 0,
    yearlyCents: 0,
  }),
  starter: Object.freeze({
    clients: 5,
    leads: 1000,
    users: 3,
    products: 100,
    storageMb: 1000,
    monthlyCents: 2900,
    yearlyCents: 29000,
  }),
  pro: Object.freeze({
    clients: 25,
    leads: 10000,
    users: 10,
    products: 1000,
    storageMb: 10000,
    monthlyCents: 9900,
    yearlyCents: 99000,
  }),
  unlimited: Object.freeze({
    clients: null,
    leads: null,
    users: null,
    products: null,
    storageMb: null,
    monthlyCents: 29900,
    yearlyCents: 299000,
  }),
});

/** Renvoie true si le tier est un PlanTier valide. */
export function isValidPlanTier(tier: unknown): tier is PlanTier {
  return typeof tier === 'string' && (VALID_PLAN_TIERS as readonly string[]).includes(tier);
}

/** Renvoie true si le period est un BillingPeriod valide. */
export function isValidBillingPeriod(period: unknown): period is BillingPeriod {
  return typeof period === 'string' && (VALID_BILLING_PERIODS as readonly string[]).includes(period);
}

/** Récupère les limits d'un tier (fallback 'free' si tier inconnu). */
export function getPlanLimits(tier: PlanTier | string): PlanLimit {
  if (isValidPlanTier(tier)) return PLAN_LIMITS[tier];
  return PLAN_LIMITS.free;
}

/** Récupère le prix d'un tier selon period. Cents. */
export function getPlanPrice(tier: PlanTier, period: BillingPeriod): number {
  const limits = PLAN_LIMITS[tier];
  return period === 'yearly' ? limits.yearlyCents : limits.monthlyCents;
}

/** Compare la valeur actuelle d'un quota au limit. true si dépassé. */
export function isQuotaExceeded(
  current: number,
  limit: number | null,
): boolean {
  if (limit == null) return false; // illimité
  if (!Number.isFinite(current) || current < 0) return false;
  return current > limit;
}

// ════════════════════════════════════════════════════════════════════════════
// Proration — credit/debit cents au changement de plan en cours de cycle
// ════════════════════════════════════════════════════════════════════════════

/**
 * Calcule la proration cents pour un changement de plan en cours de cycle.
 * Retourne CENTS positifs = à débiter (upgrade), négatifs = à créditer (downgrade).
 *
 * Formule (Stripe-style) :
 *   credit_unused = oldPlanCents * (daysRemaining / totalDays)
 *   charge_new    = newPlanCents * (daysRemaining / totalDays)
 *   proration     = round(charge_new - credit_unused)
 *
 * Exemple : 30 jours restants sur cycle 30 jours, $10/mois → $20/mois
 *   credit = 1000 * (30/30) = 1000c
 *   charge = 2000 * (30/30) = 2000c
 *   prorate = 1000c (à débiter immédiatement).
 *
 * Edge cases :
 *   - daysRemaining <= 0 OU totalDays <= 0 → 0 (rien à proratiser).
 *   - daysRemaining > totalDays → cap à totalDays (sécurité).
 *   - Plans identiques (same cents) → 0.
 *   - oldPlanCents/newPlanCents négatifs → traités comme 0.
 */
export function computeProration(
  oldPlanCents: number,
  newPlanCents: number,
  daysRemaining: number,
  totalDays: number,
): number {
  if (!Number.isFinite(oldPlanCents) || oldPlanCents < 0) oldPlanCents = 0;
  if (!Number.isFinite(newPlanCents) || newPlanCents < 0) newPlanCents = 0;
  if (!Number.isFinite(daysRemaining) || daysRemaining <= 0) return 0;
  if (!Number.isFinite(totalDays) || totalDays <= 0) return 0;
  const days = Math.min(daysRemaining, totalDays);
  const ratio = days / totalDays;
  const creditUnused = oldPlanCents * ratio;
  const chargeNew = newPlanCents * ratio;
  return Math.round(chargeNew - creditUnused);
}

// ════════════════════════════════════════════════════════════════════════════
// Dunning — exponential backoff pour retry paiement failed
// ════════════════════════════════════════════════════════════════════════════

/** Schedule de retry Stripe-like : 1d, 3d, 7d, puis abandon. */
export const DUNNING_SCHEDULE_DAYS = [1, 3, 7] as const;
export const DUNNING_MAX_ATTEMPTS = DUNNING_SCHEDULE_DAYS.length;

export interface DunningScheduleResult {
  /** ISO timestamp du prochain retry (null si finalAttempt). */
  nextRetryAt: string | null;
  /** True si l'attempt courant est le dernier (cancel auto après). */
  finalAttempt: boolean;
  /** Nombre de jours d'attente jusqu'au prochain retry. */
  daysUntilNext: number | null;
}

/**
 * Calcule le schedule de retry pour un paiement failed.
 *
 * @param attempt 1-based (1=premier retry après initial fail).
 * @param now base time (default: now).
 */
export function getDunningSchedule(
  attempt: number,
  now: Date = new Date(),
): DunningScheduleResult {
  if (!Number.isFinite(attempt) || attempt < 1) {
    return { nextRetryAt: null, finalAttempt: true, daysUntilNext: null };
  }
  const idx = Math.floor(attempt) - 1;
  if (idx >= DUNNING_SCHEDULE_DAYS.length) {
    return { nextRetryAt: null, finalAttempt: true, daysUntilNext: null };
  }
  const days = DUNNING_SCHEDULE_DAYS[idx]!;
  const next = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const finalAttempt = idx === DUNNING_SCHEDULE_DAYS.length - 1;
  return {
    nextRetryAt: next.toISOString(),
    finalAttempt,
    daysUntilNext: days,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Plan transition validation
// ════════════════════════════════════════════════════════════════════════════

const TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  unlimited: 3,
};

export interface PlanTransitionResult {
  ok: boolean;
  reason?: string;
  /** True si la transition s'applique immédiatement, false si end-of-cycle. */
  immediate?: boolean;
}

/**
 * Valide une transition de plan.
 * Rules :
 *   - Free → any paid : immédiat OK (upgrade).
 *   - Paid → higher tier : immédiat OK (upgrade avec proration).
 *   - Higher → lower (downgrade) : end-of-cycle OK (jamais immédiat — éviter
 *     crédit unused remboursement, source de fraude).
 *   - Same tier (no-op) : rejeté.
 *   - Plan inconnu : rejeté.
 */
export function validatePlanTransition(
  from: PlanTier | string,
  to: PlanTier | string,
): PlanTransitionResult {
  if (!isValidPlanTier(from)) {
    return { ok: false, reason: 'unknown_source_plan' };
  }
  if (!isValidPlanTier(to)) {
    return { ok: false, reason: 'unknown_target_plan' };
  }
  if (from === to) {
    return { ok: false, reason: 'same_plan_noop' };
  }
  const fromRank = TIER_RANK[from];
  const toRank = TIER_RANK[to];
  if (toRank > fromRank) {
    // Upgrade : immédiat avec proration.
    return { ok: true, immediate: true };
  }
  // Downgrade : end-of-cycle.
  return { ok: true, immediate: false };
}

// ════════════════════════════════════════════════════════════════════════════
// Metrics — MRR / Churn
// ════════════════════════════════════════════════════════════════════════════

export interface ActiveSubscription {
  planTier: PlanTier | string;
  billingPeriod: BillingPeriod | string | null;
  status?: string | null;
}

/**
 * MRR = somme normalisée en cents/mois des subs actives.
 * - 'monthly' → monthlyCents
 * - 'yearly'  → yearlyCents / 12 (arrondi cent)
 * - Free tier (0 cents) → ignoré (pas de revenue).
 * - status canceled/incomplete → ignoré (calque Stripe MRR).
 */
export function computeMrr(activeSubscriptions: ActiveSubscription[]): number {
  if (!Array.isArray(activeSubscriptions)) return 0;
  let mrr = 0;
  for (const sub of activeSubscriptions) {
    if (!sub) continue;
    const status = String(sub.status || '').toLowerCase();
    if (status === 'canceled' || status === 'incomplete' || status === 'incomplete_expired') {
      continue;
    }
    if (!isValidPlanTier(sub.planTier)) continue;
    const limits = PLAN_LIMITS[sub.planTier];
    if (sub.billingPeriod === 'yearly') {
      mrr += Math.round(limits.yearlyCents / 12);
    } else if (sub.billingPeriod === 'monthly') {
      mrr += limits.monthlyCents;
    }
    // Si billingPeriod absent (ex: free), ne contribue pas au MRR.
  }
  return mrr;
}

/**
 * Churn rate % = cancelled / (active + cancelled) sur la période.
 * Renvoie 0 si dénominateur 0 (pas de division par zéro).
 * Cappé 0..100.
 */
export function computeChurnRate(
  cancelled: number,
  active: number,
  _periodDays?: number,
): number {
  if (!Number.isFinite(cancelled) || cancelled < 0) cancelled = 0;
  if (!Number.isFinite(active) || active < 0) active = 0;
  const denom = active + cancelled;
  if (denom === 0) return 0;
  const rate = (cancelled / denom) * 100;
  if (rate < 0) return 0;
  if (rate > 100) return 100;
  return Math.round(rate * 100) / 100; // 2 décimales
}

// ════════════════════════════════════════════════════════════════════════════
// Mock event ID generator (mock_evt_<uuid> pattern)
// ════════════════════════════════════════════════════════════════════════════

/** Génère un ID d'événement mock au format mock_evt_<32 hex>. */
export function generateMockEventId(): string {
  // crypto.randomUUID() disponible dans Workers Runtime + Vitest jsdom.
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return `mock_evt_${uuid}`;
}

/** True si l'ID match le pattern mock_evt_*. */
export function isMockEventId(id: unknown): boolean {
  return typeof id === 'string' && /^mock_evt_[a-f0-9]{32}$/.test(id);
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers status / period
// ════════════════════════════════════════════════════════════════════════════

export const VALID_SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const;
export type SubscriptionStatus = (typeof VALID_SUBSCRIPTION_STATUSES)[number];

/** True si statut considéré "actif facturable" (active + trialing). */
export function isBillableStatus(status: unknown): boolean {
  return status === 'active' || status === 'trialing';
}

/** True si statut "fini" (canceled, incomplete_expired). */
export function isTerminalStatus(status: unknown): boolean {
  return status === 'canceled' || status === 'incomplete_expired';
}
