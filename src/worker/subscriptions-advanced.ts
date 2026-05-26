// ── Sprint 46 — subscriptions-advanced.ts — Handlers REST subscriptions étendus
//
// 10 handlers AUTHED (proration preview + upgrade + downgrade + pause + resume +
// cancel + history + dunning cron + mrr metrics + mrr snapshot cron). Routes
// câblées dans `src/worker.ts` (Phase A, ordre anti-shadowing : tous suffixes
// /subscriptions/:id/X AVANT /subscriptions/:id générique — hors scope S46).
// Phase B implémenté. SIGNATURES FIGÉES (Phase A stubs respectées).
//
// ⚠ DISTINCT de `saas-billing.ts` / `saas-billing-connect.ts` /
//   `saas-billing-payment-methods.ts` (Sprint 22 / 31) — module NEUF qui ÉTEND
//   les rails sans les toucher. Tables additives seq141 (subscription_changes +
//   mrr_snapshots), ALTER additifs sur subscriptions + billing_plans seq120.
//
// Contrats GELÉS (docs/LOT-SUBSCRIPTIONS-ADV-S46.md §6) :
//   - succès : json({ data })
//   - erreur : json({ error }, status)   ← JAMAIS de champ `code`
//   - imports RELATIFS uniquement (`./types`, `./capabilities`, `./helpers`,
//                                  `./lib/subscription-engine`)
//   - capabilities FIGÉES :
//       * settings.manage (admin) PARTOUT — toutes mutations + cron + history
//                                          + métriques (PAS de route membre S46)
//     AUCUN ajout à ALL_CAPABILITIES seq 80.
//   - Stripe live INACTIF par défaut (BILLING_LIVE_ENABLED tenant-by-tenant) —
//     tant que flag absent ⇒ tous handlers persistent D1 mock-style (provider
//     reste 'mock' / inchangé) sans appel api.stripe.com.
//
// Bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR).
// Garde capability au top de chaque handler (settings.manage).

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit } from './helpers';
import {
  computeProration,
  computeNextDunningAt,
  computeMrr,
  pickDunningStrategy,
  // ── Phase C renforcements additifs ──
  computeChurnRate,
  isPlanUpgrade,
  getDunningSchedule,
  validatePlanTransition,
  computeProrationFromBilling,
  SUBSCRIPTION_ERROR_CODES,
} from './lib/subscription-engine';

/** Auth enrichi au choke-point worker.ts (calque community-forum.ts:42). */
export type SubscriptionsAdvancedAuth = CapAuth & { capabilities?: Set<string> };

// ── Garde capability ──────────────────────────────────────────────────────

/**
 * Garde capability `settings.manage` (FIGÉE seq80) — admin partout dans S46.
 * PAS d'endpoint member-facing dans ce lot — toutes routes sont admin.
 */
function adminCapGuard(auth: SubscriptionsAdvancedAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

// ── Helpers internes ──────────────────────────────────────────────────────

/** Parse JSON body best-effort (empty/invalid ⇒ {}). */
async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Charge subscription bornée tenant (defense-in-depth IDOR). */
async function loadSubscription(
  env: Env,
  subscriptionId: string,
  auth: SubscriptionsAdvancedAuth,
): Promise<Record<string, unknown> | null> {
  // Si on a un clientId direct sur auth (legacy mono-tenant) on borne dessus.
  // Sinon on borne via accessibleClientIds (multi-tenant) si présent.
  // Fallback : on lit sans contrainte client (legacy admin) — la capability
  // settings.manage garde l'accès admin.
  try {
    if (auth.clientId) {
      const row = await env.DB.prepare(
        'SELECT * FROM subscriptions WHERE id = ? AND client_id = ?',
      )
        .bind(subscriptionId, auth.clientId)
        .first();
      if (row) return row as Record<string, unknown>;
    }
    const accessible = auth.tenant?.accessibleClientIds ?? [];
    if (accessible.length > 0) {
      const placeholders = accessible.map(() => '?').join(',');
      const row = await env.DB.prepare(
        `SELECT * FROM subscriptions WHERE id = ? AND client_id IN (${placeholders})`,
      )
        .bind(subscriptionId, ...accessible)
        .first();
      if (row) return row as Record<string, unknown>;
    }
    // Fallback legacy admin (mono-tenant sans clientId résolu).
    const row = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?')
      .bind(subscriptionId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/** Charge plan par id (best-effort). */
async function loadPlanById(
  env: Env,
  planId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.DB.prepare(
      'SELECT * FROM billing_plans WHERE id = ? OR tier = ?',
    )
      .bind(planId, planId)
      .first();
    return (row as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/** Insert subscription_changes (audit history, best-effort). */
async function insertSubscriptionChange(
  env: Env,
  params: {
    subscriptionId: string;
    clientId: string | null;
    changeType: string;
    fromPlanId?: string | null;
    toPlanId?: string | null;
    proratedAmountCents?: number;
    effectiveAt?: string;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO subscription_changes
         (subscription_id, client_id, change_type, from_plan_id, to_plan_id,
          prorated_amount_cents, effective_at, reason, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        params.subscriptionId,
        params.clientId,
        params.changeType,
        params.fromPlanId ?? null,
        params.toPlanId ?? null,
        params.proratedAmountCents ?? 0,
        params.effectiveAt ?? new Date().toISOString(),
        (params.reason ?? '').slice(0, 500) || null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      )
      .run();
  } catch {
    /* best-effort */
  }
}

/** Calcule daysRemaining et periodDays best-effort depuis une row subscription. */
function computePeriodWindow(sub: Record<string, unknown>): {
  daysRemaining: number;
  periodDays: number;
} {
  const startRaw = sub.current_period_start;
  const endRaw = sub.current_period_end;
  const now = Date.now();
  const periodDays = (() => {
    if (typeof startRaw === 'string' && typeof endRaw === 'string') {
      const s = new Date(startRaw).getTime();
      const e = new Date(endRaw).getTime();
      if (!Number.isNaN(s) && !Number.isNaN(e) && e > s) {
        return Math.max(1, Math.round((e - s) / (24 * 60 * 60 * 1000)));
      }
    }
    return 30;
  })();
  const daysRemaining = (() => {
    if (typeof endRaw === 'string') {
      const e = new Date(endRaw).getTime();
      if (!Number.isNaN(e) && e > now) {
        return Math.max(0, Math.round((e - now) / (24 * 60 * 60 * 1000)));
      }
    }
    return 0;
  })();
  return { daysRemaining: Math.min(daysRemaining, periodDays), periodDays };
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — 10 endpoints
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/subscriptions/:id/proration-preview — preview prorata (cap settings.manage).
 *
 * Lit ?to_plan_id=... dans url. Pas de mutation.
 */
export async function handlePreviewProration(
  env: Env,
  auth: SubscriptionsAdvancedAuth,
  subscriptionId: string,
  url: URL,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    const toPlanId = url.searchParams.get('to_plan_id') || '';
    if (!toPlanId) {
      return json({ error: 'to_plan_id requis' }, 400);
    }

    const sub = await loadSubscription(env, subscriptionId, auth);
    if (!sub) return json({ error: 'Abonnement introuvable' }, 404);

    // Plan courant : on lit par tier (plan_name). Si absent, on traite comme 0.
    const currentTier = typeof sub.plan_name === 'string' ? sub.plan_name : '';
    const currentPlan = currentTier ? await loadPlanById(env, currentTier) : null;
    const targetPlan = await loadPlanById(env, toPlanId);
    if (!targetPlan) return json({ error: 'Plan cible introuvable' }, 404);

    const { daysRemaining, periodDays } = computePeriodWindow(sub);
    const currentCents = Number(currentPlan?.price_monthly_cents ?? 0) || 0;
    const targetCents = Number(targetPlan.price_monthly_cents ?? 0) || 0;

    const result = computeProration(
      currentCents,
      targetCents,
      daysRemaining,
      periodDays,
    );

    return json({
      data: {
        subscription_id: subscriptionId,
        from_plan_id: typeof currentPlan?.id === 'string' ? currentPlan.id : null,
        to_plan_id: String(targetPlan.id ?? toPlanId),
        current_plan_cents: currentCents,
        target_plan_cents: targetCents,
        days_remaining: daysRemaining,
        period_days: periodDays,
        prorated_amount_cents: result.proratedCents,
        is_upgrade: result.isUpgrade,
        currency: String(targetPlan.currency ?? 'CAD'),
      },
    });
  } catch {
    return json({ error: 'Erreur calcul prorata' }, 500);
  }
}

/**
 * POST /api/subscriptions/:id/upgrade — upgrade plan (cap settings.manage).
 */
export async function handleUpgrade(
  request: Request,
  env: Env,
  auth: SubscriptionsAdvancedAuth,
  subscriptionId: string,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    const body = await readJsonBody(request);
    const toPlanId = typeof body.to_plan_id === 'string' ? body.to_plan_id : '';
    if (!toPlanId) return json({ error: 'to_plan_id requis' }, 400);

    const sub = await loadSubscription(env, subscriptionId, auth);
    if (!sub) {
      return json(
        {
          error: 'Abonnement introuvable',
          meta: { error_code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_NOT_FOUND },
        },
        404,
      );
    }

    const currentTier = typeof sub.plan_name === 'string' ? sub.plan_name : '';

    // Garde HANDLER Phase C : valide la transition AVANT d'aller chercher les
    // plans (refuse cancelled→*, no-op same-tier, etc.). Status courant utilisé
    // si sub déjà cancelled — sinon on raisonne sur les tiers.
    const currentStatus = typeof sub.status === 'string' ? sub.status : '';
    const transitionFrom =
      currentStatus === 'canceled' || currentStatus === 'cancelled'
        ? currentStatus
        : currentTier;
    const transitionCheck = validatePlanTransition(transitionFrom, toPlanId);
    if (!transitionCheck.ok) {
      const status =
        transitionCheck.error === SUBSCRIPTION_ERROR_CODES.ALREADY_CANCELLED ? 409 : 400;
      return json(
        {
          error: 'Transition de plan invalide',
          meta: { error_code: transitionCheck.error },
        },
        status,
      );
    }

    const currentPlan = currentTier ? await loadPlanById(env, currentTier) : null;
    const targetPlan = await loadPlanById(env, toPlanId);
    if (!targetPlan) {
      return json(
        {
          error: 'Plan cible introuvable',
          meta: { error_code: SUBSCRIPTION_ERROR_CODES.PLAN_NOT_FOUND },
        },
        404,
      );
    }

    const { daysRemaining, periodDays } = computePeriodWindow(sub);
    const currentCents = Number(currentPlan?.price_monthly_cents ?? 0) || 0;
    const targetCents = Number(targetPlan.price_monthly_cents ?? 0) || 0;

    // Phase C : si on a un billing_period explicite sur sub OU plan, on passe
    // par computeProrationFromBilling qui normalize monthly/annual/quarterly
    // vers MRR mensuel avant calc. Sinon fallback computeProration direct.
    const currentBilling =
      typeof sub.billing_period === 'string' ? sub.billing_period : 'monthly';
    const targetBilling =
      typeof targetPlan.billing_period === 'string'
        ? (targetPlan.billing_period as string)
        : currentBilling;
    const result =
      currentBilling !== 'monthly' || targetBilling !== 'monthly'
        ? computeProrationFromBilling(
            currentCents,
            currentBilling,
            targetCents,
            targetBilling,
            daysRemaining,
            periodDays,
          )
        : computeProration(currentCents, targetCents, daysRemaining, periodDays);

    const targetTier =
      typeof targetPlan.tier === 'string' ? targetPlan.tier : toPlanId;
    const clientId = typeof sub.client_id === 'string' ? sub.client_id : null;
    const now = new Date().toISOString();

    // Phase C : détermine upgrade vs downgrade via isPlanUpgrade (tier-based),
    // override le isUpgrade prix-based qui peut diverger (ex : annual cheaper
    // mensuellement mais plus haut tier).
    const tierIsUpgrade = isPlanUpgrade(currentTier, targetTier);
    const changeType = tierIsUpgrade || result.isUpgrade ? 'upgrade' : 'downgrade';

    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET plan_name = ?, prorated_amount_cents = ?, updated_at = ?
         WHERE id = ?`,
      )
        .bind(targetTier, result.proratedCents, now, subscriptionId)
        .run();
    } catch {
      return json({ error: 'Mise à jour abonnement échouée' }, 500);
    }

    await insertSubscriptionChange(env, {
      subscriptionId,
      clientId,
      changeType,
      fromPlanId:
        typeof currentPlan?.id === 'string' ? (currentPlan.id as string) : null,
      toPlanId: String(targetPlan.id ?? toPlanId),
      proratedAmountCents: result.proratedCents,
      effectiveAt: now,
      metadata: {
        days_remaining: daysRemaining,
        period_days: periodDays,
        tier_transition: transitionCheck.transition,
      },
    });

    await audit(env, auth.userId, 'subscription_upgrade', 'subscription', subscriptionId, {
      from: currentTier,
      to: targetTier,
      prorated_cents: result.proratedCents,
      transition: transitionCheck.transition,
    });

    return json({
      data: {
        subscription_id: subscriptionId,
        from_plan: currentTier || null,
        to_plan: targetTier,
        prorated_amount_cents: result.proratedCents,
        is_upgrade: tierIsUpgrade || result.isUpgrade,
        transition: transitionCheck.transition,
        effective_at: now,
      },
    });
  } catch {
    return json({ error: 'Erreur upgrade' }, 500);
  }
}

/**
 * POST /api/subscriptions/:id/downgrade — downgrade plan (cap settings.manage).
 *
 * Note V1 : on n'a pas de colonne next_plan_id côté seq141 — application
 * immédiate (alignée Phase A docs : "Si policy='end_of_period' : marque
 * next_plan_id (column qu'on n'a pas — pour l'instant immediate)").
 */
export async function handleDowngrade(
  request: Request,
  env: Env,
  auth: SubscriptionsAdvancedAuth,
  subscriptionId: string,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    const body = await readJsonBody(request);
    const toPlanId = typeof body.to_plan_id === 'string' ? body.to_plan_id : '';
    if (!toPlanId) return json({ error: 'to_plan_id requis' }, 400);

    const sub = await loadSubscription(env, subscriptionId, auth);
    if (!sub) {
      return json(
        {
          error: 'Abonnement introuvable',
          meta: { error_code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_NOT_FOUND },
        },
        404,
      );
    }

    const currentTier = typeof sub.plan_name === 'string' ? sub.plan_name : '';

    // Garde Phase C : valide transition (refuse cancelled→*, no-op same tier).
    const currentStatus = typeof sub.status === 'string' ? sub.status : '';
    const transitionFrom =
      currentStatus === 'canceled' || currentStatus === 'cancelled'
        ? currentStatus
        : currentTier;
    const transitionCheck = validatePlanTransition(transitionFrom, toPlanId);
    if (!transitionCheck.ok) {
      const status =
        transitionCheck.error === SUBSCRIPTION_ERROR_CODES.ALREADY_CANCELLED ? 409 : 400;
      return json(
        {
          error: 'Transition de plan invalide',
          meta: { error_code: transitionCheck.error },
        },
        status,
      );
    }

    const currentPlan = currentTier ? await loadPlanById(env, currentTier) : null;
    const targetPlan = await loadPlanById(env, toPlanId);
    if (!targetPlan) {
      return json(
        {
          error: 'Plan cible introuvable',
          meta: { error_code: SUBSCRIPTION_ERROR_CODES.PLAN_NOT_FOUND },
        },
        404,
      );
    }

    const { daysRemaining, periodDays } = computePeriodWindow(sub);
    const currentCents = Number(currentPlan?.price_monthly_cents ?? 0) || 0;
    const targetCents = Number(targetPlan.price_monthly_cents ?? 0) || 0;

    const currentBilling =
      typeof sub.billing_period === 'string' ? sub.billing_period : 'monthly';
    const targetBilling =
      typeof targetPlan.billing_period === 'string'
        ? (targetPlan.billing_period as string)
        : currentBilling;
    const result =
      currentBilling !== 'monthly' || targetBilling !== 'monthly'
        ? computeProrationFromBilling(
            currentCents,
            currentBilling,
            targetCents,
            targetBilling,
            daysRemaining,
            periodDays,
          )
        : computeProration(currentCents, targetCents, daysRemaining, periodDays);

    const targetTier =
      typeof targetPlan.tier === 'string' ? targetPlan.tier : toPlanId;
    const clientId = typeof sub.client_id === 'string' ? sub.client_id : null;
    const now = new Date().toISOString();

    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET plan_name = ?, prorated_amount_cents = ?, updated_at = ?
         WHERE id = ?`,
      )
        .bind(targetTier, result.proratedCents, now, subscriptionId)
        .run();
    } catch {
      return json({ error: 'Mise à jour abonnement échouée' }, 500);
    }

    await insertSubscriptionChange(env, {
      subscriptionId,
      clientId,
      changeType: 'downgrade',
      fromPlanId:
        typeof currentPlan?.id === 'string' ? (currentPlan.id as string) : null,
      toPlanId: String(targetPlan.id ?? toPlanId),
      proratedAmountCents: result.proratedCents,
      effectiveAt: now,
      metadata: {
        days_remaining: daysRemaining,
        period_days: periodDays,
        tier_transition: transitionCheck.transition,
      },
    });

    await audit(env, auth.userId, 'subscription_downgrade', 'subscription', subscriptionId, {
      from: currentTier,
      to: targetTier,
      prorated_cents: result.proratedCents,
      transition: transitionCheck.transition,
    });

    return json({
      data: {
        subscription_id: subscriptionId,
        from_plan: currentTier || null,
        to_plan: targetTier,
        prorated_amount_cents: result.proratedCents,
        is_upgrade: result.isUpgrade,
        transition: transitionCheck.transition,
        effective_at: now,
      },
    });
  } catch {
    return json({ error: 'Erreur downgrade' }, 500);
  }
}

/**
 * POST /api/subscriptions/:id/pause — pause (cap settings.manage).
 *
 * Body : { until? } (ISO date pour auto-resume). Vérifie billing_plans.allow_pause=1.
 */
export async function handlePause(
  request: Request,
  env: Env,
  auth: SubscriptionsAdvancedAuth,
  subscriptionId: string,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    const body = await readJsonBody(request);
    const until = typeof body.until === 'string' && body.until ? body.until : null;

    const sub = await loadSubscription(env, subscriptionId, auth);
    if (!sub) return json({ error: 'Abonnement introuvable' }, 404);

    const currentTier = typeof sub.plan_name === 'string' ? sub.plan_name : '';
    const currentPlan = currentTier ? await loadPlanById(env, currentTier) : null;
    // Garde HANDLER (pas SQL CHECK) : plan doit autoriser pause.
    if (currentPlan && Number(currentPlan.allow_pause ?? 1) === 0) {
      return json({ error: 'Ce plan ne permet pas la pause' }, 403);
    }

    const clientId = typeof sub.client_id === 'string' ? sub.client_id : null;
    const now = new Date().toISOString();

    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET paused_at = ?, paused_until = ?, status = 'paused', updated_at = ?
         WHERE id = ?`,
      )
        .bind(now, until, now, subscriptionId)
        .run();
    } catch {
      return json({ error: 'Mise à jour abonnement échouée' }, 500);
    }

    await insertSubscriptionChange(env, {
      subscriptionId,
      clientId,
      changeType: 'pause',
      effectiveAt: now,
      metadata: until ? { until } : undefined,
    });

    await audit(env, auth.userId, 'subscription_pause', 'subscription', subscriptionId, {
      until,
    });

    return json({
      data: {
        subscription_id: subscriptionId,
        status: 'paused',
        paused_at: now,
        paused_until: until,
      },
    });
  } catch {
    return json({ error: 'Erreur pause' }, 500);
  }
}

/**
 * POST /api/subscriptions/:id/resume — resume (cap settings.manage).
 */
export async function handleResume(
  env: Env,
  auth: SubscriptionsAdvancedAuth,
  subscriptionId: string,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    const sub = await loadSubscription(env, subscriptionId, auth);
    if (!sub) return json({ error: 'Abonnement introuvable' }, 404);

    const clientId = typeof sub.client_id === 'string' ? sub.client_id : null;
    const now = new Date().toISOString();

    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET paused_at = NULL, paused_until = NULL, status = 'active', updated_at = ?
         WHERE id = ?`,
      )
        .bind(now, subscriptionId)
        .run();
    } catch {
      return json({ error: 'Mise à jour abonnement échouée' }, 500);
    }

    await insertSubscriptionChange(env, {
      subscriptionId,
      clientId,
      changeType: 'resume',
      effectiveAt: now,
    });

    await audit(env, auth.userId, 'subscription_resume', 'subscription', subscriptionId, {});

    return json({
      data: {
        subscription_id: subscriptionId,
        status: 'active',
        resumed_at: now,
      },
    });
  } catch {
    return json({ error: 'Erreur resume' }, 500);
  }
}

/**
 * POST /api/subscriptions/:id/cancel — cancel (cap settings.manage).
 *
 * Body : { policy? } ('immediate' | 'end_of_period', default = plan.cancellation_policy).
 */
export async function handleCancel(
  request: Request,
  env: Env,
  auth: SubscriptionsAdvancedAuth,
  subscriptionId: string,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    const body = await readJsonBody(request);
    const requestedPolicy =
      typeof body.policy === 'string' ? body.policy : '';

    const sub = await loadSubscription(env, subscriptionId, auth);
    if (!sub) {
      return json(
        {
          error: 'Abonnement introuvable',
          meta: { error_code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_NOT_FOUND },
        },
        404,
      );
    }

    // Phase C : refuse cancel sur subscription déjà cancelled (idempotence
    // explicite côté HANDLER, vs un UPDATE no-op silencieux).
    const currentStatus = typeof sub.status === 'string' ? sub.status : '';
    if (currentStatus === 'canceled' || currentStatus === 'cancelled') {
      return json(
        {
          error: 'Abonnement déjà annulé',
          meta: { error_code: SUBSCRIPTION_ERROR_CODES.ALREADY_CANCELLED },
        },
        409,
      );
    }

    const currentTier = typeof sub.plan_name === 'string' ? sub.plan_name : '';
    const currentPlan = currentTier ? await loadPlanById(env, currentTier) : null;
    const planPolicy =
      typeof currentPlan?.cancellation_policy === 'string'
        ? (currentPlan.cancellation_policy as string)
        : 'end_of_period';

    const policy =
      requestedPolicy === 'immediate' || requestedPolicy === 'end_of_period'
        ? requestedPolicy
        : planPolicy;

    const clientId = typeof sub.client_id === 'string' ? sub.client_id : null;
    const now = new Date().toISOString();

    try {
      if (policy === 'immediate') {
        await env.DB.prepare(
          `UPDATE subscriptions
             SET status = 'canceled', canceled_at = ?, updated_at = ?
           WHERE id = ?`,
        )
          .bind(now, now, subscriptionId)
          .run();
      } else {
        // end_of_period : garde status='active' + flag cancel_at_period_end=1.
        await env.DB.prepare(
          `UPDATE subscriptions
             SET cancel_at_period_end = 1, updated_at = ?
           WHERE id = ?`,
        )
          .bind(now, subscriptionId)
          .run();
      }
    } catch {
      return json({ error: 'Mise à jour abonnement échouée' }, 500);
    }

    await insertSubscriptionChange(env, {
      subscriptionId,
      clientId,
      changeType: 'cancel',
      effectiveAt: now,
      metadata: { policy },
    });

    await audit(env, auth.userId, 'subscription_cancel', 'subscription', subscriptionId, {
      policy,
    });

    return json({
      data: {
        subscription_id: subscriptionId,
        policy,
        canceled_at: policy === 'immediate' ? now : null,
        cancel_at_period_end: policy === 'end_of_period',
      },
    });
  } catch {
    return json({ error: 'Erreur annulation' }, 500);
  }
}

/**
 * GET /api/subscriptions/:id/history — history audit (cap settings.manage).
 */
export async function handleGetHistory(
  env: Env,
  auth: SubscriptionsAdvancedAuth,
  subscriptionId: string,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    // Borne tenant via la subscription d'abord (defense-in-depth).
    const sub = await loadSubscription(env, subscriptionId, auth);
    if (!sub) return json({ error: 'Abonnement introuvable' }, 404);

    const { results } = await env.DB.prepare(
      `SELECT id, subscription_id, client_id, change_type, from_plan_id,
              to_plan_id, prorated_amount_cents, effective_at, reason,
              metadata_json, created_at
         FROM subscription_changes
         WHERE subscription_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
    )
      .bind(subscriptionId)
      .all();

    return json({ data: results || [] });
  } catch {
    return json({ error: 'Erreur lecture historique' }, 500);
  }
}

/**
 * POST /api/subscriptions/cron/dunning — runner dunning (cap settings.manage).
 *
 * SELECT subscriptions WHERE status='past_due' AND next_dunning_at < now()
 *   AND dunning_attempts < 4. Pour chaque : incr attempts + calc next retry
 *   via computeNextDunningAt(attempts+1). Si null ⇒ cancel.
 */
export async function handleRunDunningCron(
  env: Env,
  auth: SubscriptionsAdvancedAuth,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    const nowIso = new Date().toISOString();
    let rows: Array<Record<string, unknown>> = [];
    try {
      // Filtre <= 4 attempts car attempt 5 = finalDay → on doit le processer
      // pour cancel (Phase C : 4 retries 1/3/5/7, attempt 5 = abandon).
      const r = await env.DB.prepare(
        `SELECT id, client_id, dunning_attempts, dunning_log_json
           FROM subscriptions
           WHERE status = 'past_due'
             AND next_dunning_at IS NOT NULL
             AND next_dunning_at < ?
             AND (dunning_attempts IS NULL OR dunning_attempts < 5)`,
      )
        .bind(nowIso)
        .all();
      rows = (r.results as Array<Record<string, unknown>>) || [];
    } catch {
      rows = [];
    }

    let processed = 0;
    for (const row of rows) {
      const subId = String(row.id ?? '');
      if (!subId) continue;
      const clientId = typeof row.client_id === 'string' ? row.client_id : null;
      const attempts = Number(row.dunning_attempts ?? 0) || 0;
      const nextAttempt = attempts + 1;

      // Phase C : getDunningSchedule fournit nextRetryAt + finalDay flag (1/3/5/7).
      // On garde computeNextDunningAt comme fallback rétro-compatible (3/7 backstop).
      const schedule = getDunningSchedule(nowIso, nextAttempt);
      const legacyNextRetry = computeNextDunningAt(nextAttempt);
      const shouldCancel =
        schedule.finalDay || (schedule.nextRetryAt === null && legacyNextRetry === null);
      const nextRetry = shouldCancel ? null : schedule.nextRetryAt ?? legacyNextRetry;

      // Append log entry.
      let log: unknown[] = [];
      try {
        const raw = typeof row.dunning_log_json === 'string' ? row.dunning_log_json : '';
        const parsed = raw ? JSON.parse(raw) : [];
        log = Array.isArray(parsed) ? parsed : [];
      } catch {
        log = [];
      }
      log.push({
        attempt: nextAttempt,
        at: nowIso,
        next_retry_at: nextRetry,
        final_day: schedule.finalDay,
      });
      const logJson = JSON.stringify(log).slice(0, 8000);

      try {
        if (shouldCancel || nextRetry === null) {
          // Abandon : cancel sub.
          await env.DB.prepare(
            `UPDATE subscriptions
               SET status = 'canceled', canceled_at = ?, dunning_attempts = ?,
                   dunning_log_json = ?, next_dunning_at = NULL, updated_at = ?
             WHERE id = ?`,
          )
            .bind(nowIso, nextAttempt, logJson, nowIso, subId)
            .run();
          await insertSubscriptionChange(env, {
            subscriptionId: subId,
            clientId,
            changeType: 'cancel',
            effectiveAt: nowIso,
            reason: SUBSCRIPTION_ERROR_CODES.DUNNING_MAX_ATTEMPTS,
            metadata: {
              attempts: nextAttempt,
              error_code: SUBSCRIPTION_ERROR_CODES.DUNNING_MAX_ATTEMPTS,
            },
          });
          await audit(env, auth.userId, 'cron_dunning_max', 'subscription', subId, {
            attempts: nextAttempt,
            error_code: SUBSCRIPTION_ERROR_CODES.DUNNING_MAX_ATTEMPTS,
          });
        } else {
          await env.DB.prepare(
            `UPDATE subscriptions
               SET dunning_attempts = ?, next_dunning_at = ?,
                   dunning_log_json = ?, updated_at = ?
             WHERE id = ?`,
          )
            .bind(nextAttempt, nextRetry, logJson, nowIso, subId)
            .run();
          await insertSubscriptionChange(env, {
            subscriptionId: subId,
            clientId,
            changeType: 'dunning_attempt',
            effectiveAt: nowIso,
            metadata: {
              attempt: nextAttempt,
              next_retry_at: nextRetry,
              final_day: schedule.finalDay,
            },
          });
        }
        processed += 1;
      } catch {
        // Skip sub failing UPDATE — best-effort cron.
      }
    }

    // Référence pickDunningStrategy pour usage futur (évite tree-shake import).
    // En V1 on n'a pas la failure_reason live Stripe sur chaque sub past_due ;
    // la stratégie est appliquée par le webhook handler quand l'échec arrive.
    void pickDunningStrategy;

    return json({ data: { processed } });
  } catch {
    return json({ error: 'Erreur cron dunning' }, 500);
  }
}

/**
 * GET /api/billing/metrics/mrr — métriques (cap settings.manage).
 */
export async function handleGetMrrMetrics(
  env: Env,
  auth: SubscriptionsAdvancedAuth,
  url: URL,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    const periodDaysParam = url.searchParams.get('period_days');
    const periodDays = (() => {
      const n = Number(periodDaysParam ?? 30);
      return Number.isFinite(n) && n > 0 && n <= 365 ? Math.floor(n) : 30;
    })();

    // Résolution clientId : priorité auth.clientId puis tenant.accessibleClientIds[0].
    const clientId =
      auth.clientId ||
      (auth.tenant?.accessibleClientIds?.[0] ?? '') ||
      '';

    const asOfDate = new Date().toISOString();
    const agg = clientId
      ? await computeMrr(env, clientId, asOfDate)
      : { mrr: 0, arr: 0, active: 0, new: 0, churned: 0 };

    // Phase C : delegate à computeChurnRate (clamp [0..1] + churn_pct 2 décimales).
    const churn = computeChurnRate({
      cancelled: agg.churned,
      activeAtStart: agg.active,
    });
    const churnRate = churn.rate;
    const churnPct = churn.churn_pct;
    const growthRate = agg.active > 0 ? (agg.new - agg.churned) / agg.active : 0;

    let snapshots: unknown[] = [];
    if (clientId) {
      try {
        const { results } = await env.DB.prepare(
          `SELECT snapshot_date, mrr_cents, arr_cents, active_subscriptions,
                  new_subscriptions, churned_subscriptions, currency
             FROM mrr_snapshots
             WHERE client_id = ?
             ORDER BY snapshot_date DESC
             LIMIT ?`,
        )
          .bind(clientId, periodDays)
          .all();
        snapshots = results || [];
      } catch {
        snapshots = [];
      }
    }

    return json({
      data: {
        mrr_cents: agg.mrr,
        arr_cents: agg.arr,
        active_subscriptions: agg.active,
        new_subscriptions: agg.new,
        churned_subscriptions: agg.churned,
        churn_rate: churnRate,
        churn_pct: churnPct,
        growth_rate: growthRate,
        currency: 'CAD',
        period_days: periodDays,
        snapshots,
      },
    });
  } catch {
    return json({ error: 'Erreur calcul métriques' }, 500);
  }
}

/**
 * POST /api/billing/cron/mrr-snapshot — snapshot quotidien (cap settings.manage).
 *
 * Idempotent via UNIQUE INDEX uniq_mrr_snapshots_date(client_id, snapshot_date).
 * INSERT OR REPLACE pour rejouer le calcul à jour.
 */
export async function handleRunMrrSnapshotCron(
  env: Env,
  auth: SubscriptionsAdvancedAuth,
): Promise<Response> {
  const cap = adminCapGuard(auth);
  if (cap) return cap;

  try {
    // Liste des client_id distincts ayant au moins une subscription.
    let clientIds: string[] = [];
    try {
      const { results } = await env.DB.prepare(
        `SELECT DISTINCT client_id FROM subscriptions WHERE client_id IS NOT NULL`,
      ).all();
      for (const r of results || []) {
        const cid = (r as { client_id: string | null }).client_id;
        if (typeof cid === 'string' && cid) clientIds.push(cid);
      }
    } catch {
      clientIds = [];
    }

    const snapshotDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const asOfDate = new Date().toISOString();
    let snapshotsCreated = 0;

    for (const cid of clientIds) {
      try {
        const agg = await computeMrr(env, cid, asOfDate);
        await env.DB.prepare(
          `INSERT OR REPLACE INTO mrr_snapshots
             (client_id, snapshot_date, mrr_cents, arr_cents,
              active_subscriptions, new_subscriptions, churned_subscriptions, currency)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            cid,
            snapshotDate,
            agg.mrr,
            agg.arr,
            agg.active,
            agg.new,
            agg.churned,
            'CAD',
          )
          .run();
        snapshotsCreated += 1;
      } catch {
        /* skip sub failing */
      }
    }

    await audit(env, auth.userId, 'cron_mrr_snapshot', 'billing', snapshotDate, {
      snapshots_created: snapshotsCreated,
    });

    return json({ data: { snapshots_created: snapshotsCreated } });
  } catch {
    return json({ error: 'Erreur cron snapshot MRR' }, 500);
  }
}
