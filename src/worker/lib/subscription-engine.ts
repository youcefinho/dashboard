// ── Sprint 46 — subscription-engine.ts — Engine subscriptions avancées ──────
//
// Helpers PURE/HANDLER pour subscriptions-advanced.ts. Étend billing S22/S31
// sans toucher saas-billing*.ts.
//
// 4 helpers (signatures FIGÉES Phase A, corps Phase B implémentés) :
//   - computeProration()     : pure, calcul prorata upgrade/downgrade
//   - computeNextDunningAt() : pure, schedule retry dunning (1d / 3d / 7d)
//   - computeMrr()           : async D1, agrège subscriptions actives → MRR/ARR
//   - pickDunningStrategy()  : pure, choisit retry strategy par failure reason
//
// Contrats GELÉS (docs/LOT-SUBSCRIPTIONS-ADV-S46.md §6) :
//   - imports RELATIFS uniquement (`../types`)
//   - PAS de throw — best-effort, dégradation gracieuse (calque community-engine)
//   - PAS d'appel réseau api.stripe.com (réservé Phase B sous flag tenant levé)
//   - Devise locked 'CAD' V1 (cohérence seq120)
//
// ⚠ NE TOUCHE PAS aux helpers saas-billing-*.ts existants (Sprint 22 / 31).

import type { Env } from '../types';

// ── Types internes (alignés api.ts client) ────────────────────────────────

/** Plan billing minimal (lecture billing_plans). */
export interface PlanLite {
  id: string;
  tier: string;
  price_monthly_cents: number;
  price_yearly_cents: number;
  currency: string;
  trial_days: number;
  allow_pause: number;
  cancellation_policy: string;
}

/** Résultat pure d'un calcul de prorata. */
export interface ProrationResult {
  /** Montant prorata en cents (positif = surcharge upgrade, négatif = crédit downgrade). */
  proratedCents: number;
  /** true si nouveau plan plus cher (upgrade), false si downgrade (refund). */
  isUpgrade: boolean;
}

/** Aggrégat MRR computé par computeMrr(). */
export interface MrrAggregate {
  mrr: number;
  arr: number;
  active: number;
  new: number;
  churned: number;
}

/** Stratégie dunning par failure reason (whitelist HANDLER). */
export interface DunningStrategy {
  /** Délai en heures avant la prochaine tentative. */
  retryDelayHours: number;
  /** Nombre max de tentatives avant abandon final. */
  maxAttempts: number;
}

// ── computeProration — pure ───────────────────────────────────────────────

/**
 * Calcule le prorata entre plan courant et nouveau plan (upgrade/downgrade au
 * milieu de période). PURE — pas d'I/O, pas de throw.
 *
 * Formule V1 (linéaire jour-par-jour) :
 *   dailyDelta    = (newPlanCents - currentPlanCents) / periodDays
 *   proratedCents = round(dailyDelta * daysRemaining)
 *     > 0 ⇒ upgrade  (surcharge facturée immédiatement)
 *     < 0 ⇒ downgrade (crédit reporté sur prochaine facture)
 *
 * Signature acceptée en 2 formes (rétro-compat Phase A) :
 *   computeProration(currentPlanCents, newPlanCents, daysRemaining, periodDays)
 *   computeProration(currentPlan: PlanLite, newPlan: PlanLite, daysRemaining, periodDays)
 *     → dans ce cas on lit price_monthly_cents sur chaque plan.
 */
export function computeProration(
  currentPlan: PlanLite | number | null,
  newPlan: PlanLite | number,
  daysRemaining: number,
  periodDays: number,
): ProrationResult {
  // Normalisation : extrait les cents quelle que soit la forme.
  const currentCents =
    currentPlan == null
      ? 0
      : typeof currentPlan === 'number'
        ? currentPlan
        : Number(currentPlan.price_monthly_cents ?? 0) || 0;
  const newCents =
    typeof newPlan === 'number'
      ? newPlan
      : Number(newPlan.price_monthly_cents ?? 0) || 0;

  // Garde-fous best-effort : pas de division par 0, jours bornés [0, periodDays].
  const safePeriod = periodDays > 0 ? periodDays : 30;
  const safeDays = Math.max(0, Math.min(daysRemaining, safePeriod));

  const dailyDelta = (newCents - currentCents) / safePeriod;
  const proratedCents = Math.round(dailyDelta * safeDays);
  const isUpgrade = newCents > currentCents;

  return { proratedCents, isUpgrade };
}

// ── computeNextDunningAt — pure ───────────────────────────────────────────

/**
 * Schedule de retry dunning : 1d / 3d / 7d puis NULL (abandon final).
 *
 * Mapping :
 *   attempt = 0 ⇒ null (no dunning yet, premier échec pas encore retry-é)
 *   attempt = 1 ⇒ +1 jour
 *   attempt = 2 ⇒ +3 jours
 *   attempt = 3 ⇒ +7 jours
 *   attempt ≥ 4 ⇒ null (max attempts atteint, abandon)
 *
 * Retourne un timestamp ISO 8601 (Date.now() + delta), ou null si abandon.
 * PURE — pas d'I/O, pas de throw.
 */
export function computeNextDunningAt(attempt: number): string | null {
  let daysAhead: number;
  switch (attempt) {
    case 1:
      daysAhead = 1;
      break;
    case 2:
      daysAhead = 3;
      break;
    case 3:
      daysAhead = 7;
      break;
    default:
      // attempt === 0 (pas encore commencé) OU attempt ≥ 4 (abandon).
      return null;
  }
  const next = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

// ── computeMrr — async D1 ─────────────────────────────────────────────────

/**
 * Agrège le MRR à une date donnée pour un tenant.
 *
 * Logique V1 (calcul HANDLER, pas de SQL CHECK) :
 *   - SELECT subscriptions WHERE client_id = ? AND status = 'active'
 *     AND (paused_at IS NULL OR paused_until < asOfDate)
 *   - Pour chaque sub : JOIN billing_plans (par plan_name = tier) → price_*_cents
 *   - billing_period 'yearly' ⇒ mrr += price_yearly_cents / 12 (sinon monthly)
 *   - active = COUNT(*)
 *   - new = subscriptions créées dans la fenêtre [asOfDate - 30d, asOfDate]
 *   - churned = canceled_at dans la même fenêtre
 *   - arr = mrr * 12
 *
 * Best-effort — panne D1 ⇒ aggregate zéros (jamais throw).
 */
export async function computeMrr(
  env: Env,
  clientId: string,
  asOfDate: string,
): Promise<MrrAggregate> {
  // Fenêtre 30j antérieure pour new/churned.
  let windowStart: string;
  try {
    const d = new Date(asOfDate);
    if (Number.isNaN(d.getTime())) {
      windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    } else {
      windowStart = new Date(d.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }
  } catch {
    windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  let mrr = 0;
  let active = 0;
  let newCount = 0;
  let churned = 0;

  try {
    // Actives non-pausées à asOfDate. LEFT JOIN tolérant : si billing_plans
    // n'a pas la ligne (legacy / mock sans tier seedé), on tombe à 0 (skip).
    const { results } = await env.DB.prepare(
      `SELECT
         s.billing_period AS billing_period,
         bp.price_monthly_cents AS price_monthly_cents,
         bp.price_yearly_cents AS price_yearly_cents
       FROM subscriptions s
       LEFT JOIN billing_plans bp ON bp.tier = s.plan_name
       WHERE s.client_id = ?
         AND s.status = 'active'
         AND (s.paused_at IS NULL OR s.paused_until IS NULL OR s.paused_until < ?)`,
    )
      .bind(clientId, asOfDate)
      .all();

    for (const row of results || []) {
      const r = row as {
        billing_period: string | null;
        price_monthly_cents: number | null;
        price_yearly_cents: number | null;
      };
      active += 1;
      if (r.billing_period === 'yearly') {
        const yearly = Number(r.price_yearly_cents ?? 0) || 0;
        mrr += Math.round(yearly / 12);
      } else {
        // 'monthly' ou null (default V1).
        mrr += Number(r.price_monthly_cents ?? 0) || 0;
      }
    }
  } catch {
    // panne D1 — dégrade gracieusement.
  }

  try {
    const r = (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM subscriptions
       WHERE client_id = ? AND created_at >= ? AND created_at <= ?`,
    )
      .bind(clientId, windowStart, asOfDate)
      .first()) as { n: number | null } | null;
    newCount = Number(r?.n ?? 0) || 0;
  } catch {
    /* best-effort */
  }

  try {
    const r = (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM subscriptions
       WHERE client_id = ? AND status IN ('canceled','cancelled')
         AND canceled_at >= ? AND canceled_at <= ?`,
    )
      .bind(clientId, windowStart, asOfDate)
      .first()) as { n: number | null } | null;
    churned = Number(r?.n ?? 0) || 0;
  } catch {
    /* best-effort */
  }

  return { mrr, arr: mrr * 12, active, new: newCount, churned };
}

// ── pickDunningStrategy — pure ────────────────────────────────────────────

/**
 * Choisit la stratégie retry selon la raison d'échec Stripe.
 *
 * Whitelist HANDLER (codes Stripe canoniques) :
 *   - 'card_declined'              ⇒ 24h, 3 attempts
 *   - 'insufficient_funds'         ⇒ 72h, 4 attempts (plus de marge)
 *   - 'expired_card'               ⇒ 0h,  1 attempt  (immediate fail, user update)
 *   - default                      ⇒ 24h, 3 attempts (safe fallback)
 */
export function pickDunningStrategy(failureReason: string): DunningStrategy {
  switch ((failureReason || '').toLowerCase()) {
    case 'card_declined':
      return { retryDelayHours: 24, maxAttempts: 3 };
    case 'insufficient_funds':
      return { retryDelayHours: 72, maxAttempts: 4 };
    case 'expired_card':
      return { retryDelayHours: 0, maxAttempts: 1 };
    default:
      return { retryDelayHours: 24, maxAttempts: 3 };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 46 Phase C — Renforcements additifs (helpers PURE supplémentaires)
//
// 5 helpers PURE additionnels (zéro I/O, zéro throw) qui étendent les rails
// posés Phase A/B sans toucher aux 4 helpers ci-dessus :
//   - computeChurnRate()       : taux de churn mensuel cancelled/active_at_start
//   - computeNetMrr()          : décompose Net MRR (new + expansion - contraction - churn)
//   - computeProrationFromDays : variante pure (déjà couvert ci-dessus, alias)
//   - isPlanUpgrade()          : compare tiers (free<starter<pro<unlimited)
//   - getDunningSchedule()     : schedule explicite [1,3,5,7] + finalDay flag
//   - validatePlanTransition() : whitelist transitions (free→paid OK, etc.)
//
// + Constantes exportées :
//   - MRR_PERIOD_MULTIPLIER (monthly=1, annual=1/12, quarterly=1/3, weekly=4.33)
//   - DUNNING_RETRY_DAYS [1, 3, 5, 7]
//   - SUBSCRIPTION_ERROR_CODES (énum codes erreur HANDLER)
//   - PLAN_TIER_ORDER (ordre canonique tiers)
//
// ⚠ ZÉRO RÉGRESSION — additif strict, signatures Phase A/B INTACTES.
// ════════════════════════════════════════════════════════════════════════════

// ── Constantes ─────────────────────────────────────────────────────────────

/**
 * Multiplicateurs pour normaliser tout cycle de facturation vers MRR mensuel.
 *
 * Formule : `MRR_contribution = amount_cents * MRR_PERIOD_MULTIPLIER[period]`
 *   - monthly    : 1            (déjà mensuel)
 *   - annual     : 1/12         (étalé 12 mois)
 *   - quarterly  : 1/3          (étalé 3 mois)
 *   - weekly     : 4.345        (52.14 semaines/an ÷ 12 mois ≈ 4.345 semaines/mois)
 *
 * NB : weekly=4.345 = (365.25 ÷ 7) ÷ 12 (année moyenne avec bissextile). Pattern
 * SaaS standard (Stripe, Chargebee). Variante simplifiée 4.33 acceptée mais on
 * privilégie 4.345 pour matcher la formule officielle.
 */
export const MRR_PERIOD_MULTIPLIER: Readonly<Record<string, number>> = Object.freeze({
  monthly: 1,
  annual: 1 / 12,
  yearly: 1 / 12, // alias canonique seq120
  quarterly: 1 / 3,
  weekly: 4.345,
  week: 4.345, // alias court
});

/**
 * Schedule de retry dunning étendu Phase C : 4 tentatives sur 7 jours.
 * Diffère de `computeNextDunningAt` Phase B (1/3/7) — Phase C affine à 1/3/5/7
 * pour couvrir un pattern Stripe SMB plus agressif (4 retries au lieu de 3).
 * `getDunningSchedule()` ci-dessous utilise ce schedule.
 */
export const DUNNING_RETRY_DAYS: ReadonlyArray<number> = Object.freeze([1, 3, 5, 7]);

/**
 * Codes erreur canoniques pour les handlers subscriptions-advanced. Permet aux
 * clients API + UI dashboard de différencier les cas (vs un message libre).
 *
 * Convention : SCREAMING_SNAKE_CASE, préfixe SUBSCRIPTION_ ou PLAN_ ou STRIPE_.
 * Contrat HANDLER : exposés dans `meta.error_code` (cohérent autres lots),
 * jamais dans le champ `code` top-level (FIGÉ docs §6 : succès {data}, erreur
 * {error} sans code top-level).
 */
export const SUBSCRIPTION_ERROR_CODES = Object.freeze({
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  PLAN_INVALID: 'PLAN_INVALID',
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
  ALREADY_PAUSED: 'ALREADY_PAUSED',
  PRORATION_FAILED: 'PRORATION_FAILED',
  STRIPE_NOT_CONFIGURED: 'STRIPE_NOT_CONFIGURED',
  TRANSITION_INVALID: 'TRANSITION_INVALID',
  DUNNING_MAX_ATTEMPTS: 'DUNNING_MAX_ATTEMPTS',
  PLAN_DOES_NOT_ALLOW_PAUSE: 'PLAN_DOES_NOT_ALLOW_PAUSE',
} as const);

export type SubscriptionErrorCode =
  (typeof SUBSCRIPTION_ERROR_CODES)[keyof typeof SUBSCRIPTION_ERROR_CODES];

/**
 * Ordre canonique des tiers (du moins cher au plus cher). Utilisé par
 * `isPlanUpgrade()` pour décider upgrade vs downgrade. Tiers inconnus traités
 * comme rang -1 (lower than free).
 */
export const PLAN_TIER_ORDER: ReadonlyArray<string> = Object.freeze([
  'free',
  'starter',
  'pro',
  'business',
  'unlimited',
  'enterprise',
]);

// ── Types additifs ─────────────────────────────────────────────────────────

/** Résultat computeChurnRate() — taux + breakdown. */
export interface ChurnRateResult {
  /** Ratio [0..1] : cancelled / active_at_start. */
  rate: number;
  /** Pourcentage [0..100] : rate * 100, arrondi 2 décimales. */
  churn_pct: number;
  /** Nombre subscriptions cancelled dans la fenêtre. */
  cancelled: number;
  /** Nombre subscriptions actives au début de la fenêtre. */
  active_at_start: number;
}

/** Type d'event subscription pour computeNetMrr(). */
export type SubscriptionEventType = 'new' | 'expansion' | 'contraction' | 'churn';

/** Event MRR atomique. */
export interface SubscriptionEvent {
  type: SubscriptionEventType;
  /** Delta MRR signé (cents). Pour churn/contraction : positif, sera soustrait. */
  mrrDeltaCents: number;
  /** Timestamp ISO (optionnel — utile pour scoping fenêtre future). */
  at?: string;
}

/** Décomposition Net MRR. */
export interface NetMrrBreakdown {
  /** MRR additionnel des nouveaux subscriptions de la fenêtre (cents). */
  new: number;
  /** MRR additionnel par upgrades existants (cents). */
  expansion: number;
  /** MRR perdu par downgrades existants (cents, positif). */
  contraction: number;
  /** MRR perdu par cancellations (cents, positif). */
  churned: number;
  /** Net = new + expansion - contraction - churned (cents, signé). */
  net: number;
}

/** Résultat getDunningSchedule(). */
export interface DunningScheduleResult {
  /** Prochain retry ISO 8601, ou null si max atteint / attempt invalide. */
  nextRetryAt: string | null;
  /** true si attempt courant est le dernier (prochain = abandon). */
  finalDay: boolean;
  /** Numéro de tentative courant (1-indexed). Renvoyé pour debugging. */
  attemptNumber: number;
}

/** Résultat validatePlanTransition(). */
export interface PlanTransitionResult {
  ok: boolean;
  error?: SubscriptionErrorCode;
  /** Type de transition détectée (info), ou null si invalide. */
  transition?: 'upgrade' | 'downgrade' | 'reactivate' | 'cancel_to_free' | 'no_op';
}

// ── computeChurnRate — pure ────────────────────────────────────────────────

/**
 * Calcule le taux de churn mensuel classique :
 *   rate = cancelled / active_at_start
 *
 * Edge cases :
 *   - active_at_start <= 0  ⇒ rate = 0 (pas de base, pas de churn défini)
 *   - cancelled > active    ⇒ rate clampé à 1 (ne dépasse jamais 100%)
 *   - cancelled < 0         ⇒ traité comme 0 (best-effort)
 *
 * Signature flexible — accepte soit :
 *   computeChurnRate({ cancelled, activeAtStart })
 *   computeChurnRate(subscriptions[], startDate, endDate)
 *     → où chaque sub a { status, canceled_at, created_at }
 *
 * PURE — pas d'I/O, pas de throw.
 */
export function computeChurnRate(
  arg1:
    | { cancelled: number; activeAtStart: number }
    | ReadonlyArray<{
        status?: string | null;
        canceled_at?: string | null;
        created_at?: string | null;
      }>,
  startDate?: string,
  endDate?: string,
): ChurnRateResult {
  let cancelled = 0;
  let activeAtStart = 0;

  if (Array.isArray(arg1)) {
    // Mode array : compte depuis les subscriptions + window.
    const start = startDate ? Date.parse(startDate) : 0;
    const end = endDate ? Date.parse(endDate) : Date.now();
    const safeStart = Number.isNaN(start) ? 0 : start;
    const safeEnd = Number.isNaN(end) ? Date.now() : end;

    for (const sub of arg1) {
      // active_at_start : créée AVANT startDate ET pas cancelled avant startDate.
      const createdAt = sub.created_at ? Date.parse(sub.created_at) : 0;
      const canceledAt = sub.canceled_at ? Date.parse(sub.canceled_at) : NaN;
      const isCancelled =
        sub.status === 'canceled' || sub.status === 'cancelled';

      if (!Number.isNaN(createdAt) && createdAt < safeStart) {
        // Existait à start ET pas cancelled avant start.
        if (Number.isNaN(canceledAt) || canceledAt >= safeStart) {
          activeAtStart += 1;
        }
      }
      // cancelled dans la fenêtre [start, end].
      if (
        isCancelled &&
        !Number.isNaN(canceledAt) &&
        canceledAt >= safeStart &&
        canceledAt <= safeEnd
      ) {
        cancelled += 1;
      }
    }
  } else {
    const counts = arg1 as { cancelled: number; activeAtStart: number };
    cancelled = Math.max(0, Number(counts.cancelled) || 0);
    activeAtStart = Math.max(0, Number(counts.activeAtStart) || 0);
  }

  if (activeAtStart <= 0) {
    return { rate: 0, churn_pct: 0, cancelled, active_at_start: activeAtStart };
  }

  const rawRate = cancelled / activeAtStart;
  const rate = Math.min(1, Math.max(0, rawRate));
  const churn_pct = Math.round(rate * 100 * 100) / 100; // 2 décimales

  return { rate, churn_pct, cancelled, active_at_start: activeAtStart };
}

// ── computeNetMrr — pure ───────────────────────────────────────────────────

/**
 * Décompose le Net MRR d'une fenêtre à partir d'une liste d'events typés.
 *
 * Net MRR = new + expansion - contraction - churned
 *
 * Convention `mrrDeltaCents` :
 *   - new         : positif (montant du nouveau MRR ajouté)
 *   - expansion   : positif (delta entre nouveau et ancien plan)
 *   - contraction : positif EN MAGNITUDE (sera soustrait dans le net)
 *   - churn       : positif EN MAGNITUDE (MRR perdu, sera soustrait)
 *
 * Si l'event passé a un mrrDeltaCents négatif, il est `Math.abs()` pour
 * éviter une double négation accidentelle. Best-effort — events inconnus skip.
 *
 * PURE — pas d'I/O, pas de throw.
 */
export function computeNetMrr(
  events: ReadonlyArray<SubscriptionEvent>,
): NetMrrBreakdown {
  let newSum = 0;
  let expansion = 0;
  let contraction = 0;
  let churned = 0;

  for (const ev of events || []) {
    const delta = Math.abs(Number(ev?.mrrDeltaCents) || 0);
    switch (ev?.type) {
      case 'new':
        newSum += delta;
        break;
      case 'expansion':
        expansion += delta;
        break;
      case 'contraction':
        contraction += delta;
        break;
      case 'churn':
        churned += delta;
        break;
      default:
      // skip unknown event types (best-effort)
    }
  }

  const net = newSum + expansion - contraction - churned;
  return { new: newSum, expansion, contraction, churned, net };
}

// ── isPlanUpgrade — pure ───────────────────────────────────────────────────

/**
 * Détermine si la transition `oldTier → newTier` est un upgrade selon l'ordre
 * canonique `PLAN_TIER_ORDER`. Cas particuliers :
 *   - same tier             ⇒ false (no-op, pas upgrade)
 *   - tier inconnu (old)    ⇒ rang -1 (anything > -1 = upgrade)
 *   - tier inconnu (new)    ⇒ rang -1 (jamais upgrade)
 *   - free → paid           ⇒ true
 *   - paid → free           ⇒ false (downgrade / cancel)
 *
 * Match case-insensitive (tolère 'Pro', 'PRO', 'pro').
 *
 * PURE — pas d'I/O, pas de throw.
 */
export function isPlanUpgrade(oldTier: string, newTier: string): boolean {
  const oldNorm = (oldTier || '').toLowerCase().trim();
  const newNorm = (newTier || '').toLowerCase().trim();
  if (!oldNorm || !newNorm) return false;
  if (oldNorm === newNorm) return false;

  const oldRank = PLAN_TIER_ORDER.indexOf(oldNorm);
  const newRank = PLAN_TIER_ORDER.indexOf(newNorm);
  // Tier nouveau inconnu = jamais upgrade (safer).
  if (newRank < 0) return false;
  return newRank > oldRank;
}

// ── getDunningSchedule — pure ──────────────────────────────────────────────

/**
 * Schedule dunning explicite Phase C (4 tentatives sur 7 jours) : days 1, 3, 5, 7.
 *
 * Différent de `computeNextDunningAt` (Phase B, 3 tentatives 1/3/7) — Phase C
 * affine pour cas SMB où on retry plus tôt (day 5 ajouté). Les 2 coexistent —
 * `computeNextDunningAt` reste utilisé par `handleRunDunningCron` (intact),
 * `getDunningSchedule` est exposé pour les nouveaux call-sites webhook Stripe.
 *
 *   attempt 1 ⇒ +1 jour,  finalDay=false
 *   attempt 2 ⇒ +3 jours, finalDay=false
 *   attempt 3 ⇒ +5 jours, finalDay=false
 *   attempt 4 ⇒ +7 jours, finalDay=true  (dernière chance — après ⇒ abandon)
 *   attempt ≥ 5 ⇒ nextRetryAt=null, finalDay=true (max atteint)
 *   attempt ≤ 0 ⇒ nextRetryAt=null (pas commencé)
 *
 * @param failedAt   Date du dernier échec (ISO ou Date). Sert de base au delta.
 * @param attempt    Numéro de tentative courant (1-indexed).
 *
 * PURE — pas d'I/O, pas de throw.
 */
export function getDunningSchedule(
  failedAt: Date | string,
  attempt: number,
): DunningScheduleResult {
  const safeAttempt = Math.floor(Number(attempt) || 0);
  if (safeAttempt <= 0) {
    return { nextRetryAt: null, finalDay: false, attemptNumber: safeAttempt };
  }
  if (safeAttempt > DUNNING_RETRY_DAYS.length) {
    return { nextRetryAt: null, finalDay: true, attemptNumber: safeAttempt };
  }

  let base: number;
  if (failedAt instanceof Date) {
    base = failedAt.getTime();
  } else if (typeof failedAt === 'string') {
    const parsed = Date.parse(failedAt);
    base = Number.isNaN(parsed) ? Date.now() : parsed;
  } else {
    base = Date.now();
  }

  const daysAhead = DUNNING_RETRY_DAYS[safeAttempt - 1] ?? 7;
  const nextRetryAt = new Date(base + daysAhead * 24 * 60 * 60 * 1000).toISOString();
  const finalDay = safeAttempt === DUNNING_RETRY_DAYS.length;
  return { nextRetryAt, finalDay, attemptNumber: safeAttempt };
}

// ── validatePlanTransition — pure ──────────────────────────────────────────

/**
 * Whitelist HANDLER des transitions de plan autorisées.
 *
 * Règles V1 :
 *   - free → paid             OK   (upgrade)
 *   - paid → paid (different) OK   (upgrade ou downgrade selon tiers)
 *   - paid → paid (same)      KO   (no-op — TRANSITION_INVALID)
 *   - paid → free             OK   (trigger cancellation côté HANDLER)
 *   - cancelled → active      KO   (passer par /reactivate, pas un simple plan change)
 *   - cancelled → free        KO   (déjà cancelled, no-op)
 *   - free → free             KO   (no-op)
 *
 * @param from   Tier courant (ou 'cancelled' si sub annulée — handler le passe).
 * @param to     Tier cible.
 *
 * Retourne { ok, error?, transition? }. PURE — pas d'I/O, pas de throw.
 */
export function validatePlanTransition(
  from: string,
  to: string,
): PlanTransitionResult {
  const fromNorm = (from || '').toLowerCase().trim();
  const toNorm = (to || '').toLowerCase().trim();

  if (!toNorm) {
    return {
      ok: false,
      error: SUBSCRIPTION_ERROR_CODES.PLAN_INVALID,
    };
  }

  // cancelled → * : on refuse, doit passer par /reactivate.
  if (fromNorm === 'cancelled' || fromNorm === 'canceled') {
    return {
      ok: false,
      error: SUBSCRIPTION_ERROR_CODES.ALREADY_CANCELLED,
    };
  }

  // no-op : same tier ou free → free.
  if (fromNorm === toNorm) {
    return {
      ok: false,
      error: SUBSCRIPTION_ERROR_CODES.TRANSITION_INVALID,
      transition: 'no_op',
    };
  }

  // free → paid.
  if (fromNorm === 'free' && toNorm !== 'free') {
    return { ok: true, transition: 'upgrade' };
  }

  // paid → free : déclenche cancellation côté HANDLER.
  if (fromNorm !== 'free' && toNorm === 'free') {
    return { ok: true, transition: 'cancel_to_free' };
  }

  // paid → paid : decide upgrade vs downgrade via isPlanUpgrade().
  return {
    ok: true,
    transition: isPlanUpgrade(fromNorm, toNorm) ? 'upgrade' : 'downgrade',
  };
}

// ── computeProrationFromBilling — pure (helper convenience) ─────────────────

/**
 * Variante haut-niveau de `computeProration()` qui prend un billing period
 * symbolique (monthly/annual/quarterly/weekly) et normalize automatiquement
 * les montants vers le MRR mensuel équivalent avant calcul.
 *
 * Use case : webhook Stripe `customer.subscription.updated` avec changement
 * de période ET de plan dans le même event (ex : monthly $49 → annual $490).
 *
 * Formule :
 *   oldMrr = oldAmountCents * MRR_PERIOD_MULTIPLIER[oldPeriod]
 *   newMrr = newAmountCents * MRR_PERIOD_MULTIPLIER[newPeriod]
 *   ⇒ délègue à computeProration(oldMrr, newMrr, daysRemaining, daysInPeriod)
 *
 * PURE — pas d'I/O, pas de throw. Période inconnue ⇒ fallback monthly (×1).
 */
export function computeProrationFromBilling(
  oldAmountCents: number,
  oldPeriod: string,
  newAmountCents: number,
  newPeriod: string,
  daysRemaining: number,
  daysInPeriod: number,
): ProrationResult {
  const oldMult = MRR_PERIOD_MULTIPLIER[oldPeriod.toLowerCase()] ?? 1;
  const newMult = MRR_PERIOD_MULTIPLIER[newPeriod.toLowerCase()] ?? 1;
  const oldMrr = Math.round((Number(oldAmountCents) || 0) * oldMult);
  const newMrr = Math.round((Number(newAmountCents) || 0) * newMult);
  return computeProration(oldMrr, newMrr, daysRemaining, daysInPeriod);
}
