// ── Sprint 22 (mock) + Sprint 31 (live branch) — Billing Stripe SaaS handlers
//
// 10 handlers Manager-B : persistance D1, capGuard (`billing.view` lectures,
// `settings.manage` mutations), INSERT billing_events, audit.
//
// ⚠️ DISTINCT de src/worker/billing.ts (webhook E4 marchand) — l'extension
//    chirurgicale du webhook SaaS est dans billing.ts:handleStripeWebhook.
//    DISTINCT de saas.ts/plans.ts.
//
// Convention codebase :
//   - signature handler `(env, auth)` pour GET, `(request, env, auth)` pour POST/PATCH/PUT.
//   - `auth: { userId, role?, tenant?, capabilities? }` — calque CatalogAuth / ChecklistAuth.
//   - succès `json({ data })`, erreur `json({ error, code }, status)` — codes
//     stables : STRIPE_NOT_CONFIGURED, AGENCY_ONLY, INVALID_INPUT, PLAN_UNKNOWN,
//     SUBSCRIPTION_NOT_FOUND, STRIPE_API_ERROR, STRIPE_PRICE_MISSING,
//     STRIPE_SUB_MISSING, WEBHOOK_SIGNATURE_INVALID, WEBHOOK_REPLAY.
//
// Double gate live (Sprint 31) dans CHAQUE mutateur :
//   const liveActive = isLiveBranchEnabled(env) && await isTenantLiveEnabled(env, agencyId);
//   if (!liveActive) → fallback mock Sprint 22 préservé bit-pour-bit :
//                       reason ∈ { 'stripe_not_configured', 'tenant_not_activated' }
//                       UPDATE D1 provider='mock' + INSERT billing_events.is_mock=1 + audit
//   else            → branch live (helpers `./lib/saas-billing-live.ts`) :
//                       Stripe API call → UPDATE D1 provider='stripe' + IDs réels +
//                       live_activated_at + audit mock:false.
// Tous les appels `fetch('https://api.stripe.com/...')` sont dans saas-billing-live.

import type { Env } from './types';
import { json, audit } from './helpers';
import { getClientModules } from './modules';
import { requireCapability, type Capability } from './capabilities';
import { resolvePlan } from './plans';
import {
  BillingSubscriptionChangeSchema,
  BillingPortalSessionSchema,
  BillingCancelSchema,
} from '../lib/schemas';
import type {
  PlanTier,
  BillingPeriod,
  SubscriptionStatus,
  BillingProvider,
  BillingPlanCatalog,
  BillingPlanLimits,
  ClientSubscription,
  BillingUsage,
  BillingPortalSession,
  BillingInvoiceMock,
  BillingWebhookConfig,
} from '../lib/types';
import { buildMockPortalUrl } from './lib/saas-billing-mock';
// Sprint 31 — Live Stripe branch (A1 owner). Imports only; no fetch here.
import {
  isLiveBranchEnabled,
  isTenantLiveEnabled,
  stripeFetch,
  findOrCreateStripeCustomer,
  createStripeSubscription,
  updateStripeSubscription,
  cancelStripeSubscription,
  createBillingPortalSession,
} from './lib/saas-billing-live';
// Renforcement V2 — helpers PUR engine (tiers + statuts billing).
import {
  VALID_SUBSCRIPTION_STATUSES,
  isValidPlanTier,
} from './lib/saas-billing-engine';

// ── Auth shape (calque CatalogAuth / ChecklistAuth) ─────────────────────────
type BillingAuth = {
  userId: string;
  role?: string;
  clientId?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
};

// ── Fallback subscription "free" mode démo ─────────────────────────────────
const MOCK_SUBSCRIPTION_FALLBACK: ClientSubscription = {
  id: '',
  agencyId: null,
  clientId: '',
  planTier: 'free',
  status: 'active',
  billingPeriod: null,
  provider: 'mock',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
  trialEndsAt: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  isMock: true,
  createdAt: '',
  updatedAt: null,
};

const MOCK_USAGE_FALLBACK: BillingUsage = {
  subAccounts: { current: 0, limit: null },
  leads: { current: 0, limit: null },
  users: { current: 0, limit: null },
};

const SUPPORTED_WEBHOOK_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.finalized',
  'checkout.session.completed',
];

// ── Garde capability mode-agence-only (calque catalog.ts:42 / onboarding.ts:347)
function capGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> },
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;
}

// ── Helpers internes ───────────────────────────────────────────────────────

const VALID_STATUSES: readonly string[] = VALID_SUBSCRIPTION_STATUSES;

/** True si l'erreur SQLite vient d'une migration seq120 absente. */
function isMissingSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
  return (
    msg.includes('no such column') ||
    msg.includes('no such table') ||
    msg.includes('has no column')
  );
}

/** Normalise un tier string en PlanTier valide (fallback 'free'). */
function asPlanTier(value: unknown): PlanTier {
  if (isValidPlanTier(value)) return value;
  return 'free';
}

/** Normalise un status string en SubscriptionStatus valide (fallback 'active'). */
function asSubscriptionStatus(value: unknown): SubscriptionStatus {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  return (VALID_STATUSES as string[]).includes(v) ? (v as SubscriptionStatus) : 'active';
}

/** Normalise un billingPeriod (null si invalide / absent). */
function asBillingPeriod(value: unknown): BillingPeriod | null {
  return value === 'monthly' || value === 'yearly' ? value : null;
}

/** Normalise le provider (calque Phase A : 'mock' par défaut). */
function asProvider(value: unknown): BillingProvider {
  return value === 'stripe' ? 'stripe' : 'mock';
}

/** Parse JSON safe → unknown object (null si invalide). */
function safeParseJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parse limits_json → BillingPlanLimits (null fallback pour valeurs manquantes). */
function parseLimits(raw: unknown): BillingPlanLimits {
  const obj = safeParseJson(raw);
  if (!obj) return { maxSubAccounts: null, maxLeads: null, maxUsers: null };
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return {
    maxSubAccounts: num(obj.maxSubAccounts),
    maxLeads: num(obj.maxLeads),
    maxUsers: num(obj.maxUsers),
  };
}

/** Parse features_json → string[] (vide si invalide). */
function parseFeatures(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Mappe une row billing_plans → BillingPlanCatalog. */
function rowToPlan(row: Record<string, unknown>): BillingPlanCatalog {
  return {
    id: String(row.id ?? ''),
    tier: asPlanTier(row.tier),
    displayName: String(row.display_name ?? ''),
    description: row.description == null ? null : String(row.description),
    priceMonthlyCents: Number(row.price_monthly_cents ?? 0) || 0,
    priceYearlyCents: Number(row.price_yearly_cents ?? 0) || 0,
    currency: String(row.currency ?? 'CAD'),
    limits: parseLimits(row.limits_json),
    features: parseFeatures(row.features_json),
    displayOrder: Number(row.display_order ?? 0) || 0,
    isActive: Number(row.is_active ?? 1) !== 0,
  };
}

/** Mappe une row subscriptions → ClientSubscription. isMock dérivé de provider/stripe id. */
function rowToSubscription(row: Record<string, unknown>): ClientSubscription {
  const provider = asProvider(row.provider);
  const stripeSubscriptionId = row.stripe_subscription_id == null ? null : String(row.stripe_subscription_id);
  const isMock =
    provider === 'mock' ||
    !stripeSubscriptionId ||
    !stripeSubscriptionId.startsWith('sub_');
  return {
    id: String(row.id ?? ''),
    agencyId: row.agency_id == null ? null : String(row.agency_id),
    clientId: String(row.client_id ?? ''),
    planTier: asPlanTier(row.plan_name),
    status: asSubscriptionStatus(row.status),
    billingPeriod: asBillingPeriod(row.billing_period),
    provider,
    stripeCustomerId: row.stripe_customer_id == null ? null : String(row.stripe_customer_id),
    stripeSubscriptionId,
    stripePriceId: row.stripe_price_id == null ? null : String(row.stripe_price_id),
    trialEndsAt: row.trial_ends_at == null ? null : String(row.trial_ends_at),
    currentPeriodStart: row.current_period_start == null ? null : String(row.current_period_start),
    currentPeriodEnd: row.current_period_end == null ? null : String(row.current_period_end),
    cancelAtPeriodEnd: Number(row.cancel_at_period_end ?? 0) !== 0,
    canceledAt: row.canceled_at == null ? null : String(row.canceled_at),
    isMock,
    createdAt: String(row.created_at ?? ''),
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

/** Mappe une row billing_invoices_mock → BillingInvoiceMock. */
function rowToInvoice(row: Record<string, unknown>): BillingInvoiceMock {
  const status = String(row.status ?? 'draft');
  const validStatus: BillingInvoiceMock['status'] =
    status === 'open' || status === 'paid' || status === 'void' || status === 'uncollectible'
      ? (status as BillingInvoiceMock['status'])
      : 'draft';
  return {
    id: String(row.id ?? ''),
    number: row.number == null ? null : String(row.number),
    amountDueCents: Number(row.amount_due_cents ?? 0) || 0,
    amountPaidCents: Number(row.amount_paid_cents ?? 0) || 0,
    currency: String(row.currency ?? 'CAD'),
    status: validStatus,
    periodStart: row.period_start == null ? null : String(row.period_start),
    periodEnd: row.period_end == null ? null : String(row.period_end),
    hostedInvoiceUrl: row.hosted_invoice_url == null ? null : String(row.hosted_invoice_url),
    pdfUrl: row.pdf_url == null ? null : String(row.pdf_url),
    isMock: Number(row.is_mock ?? 1) !== 0,
    createdAt: String(row.created_at ?? ''),
  };
}

/** Contexte agence (calque saas.ts:handleGetAgencyPlan resolution). */
interface AgencyContext {
  agencyId: string | null;
  clientId: string | null;
  clientIds: string[];
}

/** Résout agencyId + clientIds accessibles pour borner les requêtes tenant. */
async function resolveAgencyContext(
  env: Env,
  auth: BillingAuth,
): Promise<AgencyContext> {
  // Priorité au tenant déjà résolu au choke-point (worker.ts).
  const tenantAgencyId = auth.tenant?.agencyId ?? null;
  const tenantClientIds = auth.tenant?.accessibleClientIds ?? [];

  // Fallback : resolve clientId via getClientModules (legacy mono-tenant).
  let clientId: string | null = null;
  try {
    const r = await getClientModules(env, auth.userId);
    clientId = r.clientId ?? null;
  } catch {
    clientId = null;
  }

  // Si on a un agencyId tenant mais pas la liste de clientIds, on resolve depuis D1.
  let clientIds = tenantClientIds.length > 0 ? [...tenantClientIds] : [];
  if (tenantAgencyId && clientIds.length === 0) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT id FROM clients WHERE agency_id = ?',
      )
        .bind(tenantAgencyId)
        .all();
      clientIds = (results || [])
        .map((r) => (r as { id?: string }).id)
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
    } catch {
      clientIds = [];
    }
  }
  if (clientId && !clientIds.includes(clientId)) clientIds.push(clientId);

  return {
    agencyId: tenantAgencyId,
    clientId,
    clientIds,
  };
}

/** SELECT subscription courante de l'agence (best-effort, null si seq120 absente). */
async function loadCurrentSubscription(
  env: Env,
  agencyId: string,
): Promise<ClientSubscription | null> {
  try {
    const row = (await env.DB.prepare(
      'SELECT * FROM subscriptions WHERE agency_id = ? ORDER BY created_at DESC LIMIT 1',
    )
      .bind(agencyId)
      .first()) as Record<string, unknown> | null;
    if (!row) return null;
    return rowToSubscription(row);
  } catch (err) {
    if (isMissingSchemaError(err)) return null;
    return null;
  }
}

/** Renvoie un fallback sub mock contextualisé (agencyId + clientId réels). */
function fallbackSubscription(ctx: AgencyContext): ClientSubscription {
  return {
    ...MOCK_SUBSCRIPTION_FALLBACK,
    agencyId: ctx.agencyId,
    clientId: ctx.clientId ?? '',
  };
}

/** INSERT best-effort dans billing_events (idempotent via UNIQUE provider+event_id). */
export async function logBillingEvent(
  env: Env,
  params: {
    agencyId?: string | null;
    subscriptionId?: string | null;
    provider?: string;
    providerEventId?: string;
    eventType: string;
    signatureVerified?: boolean;
    isMock?: boolean;
    payload?: unknown;
    error?: string | null;
  },
): Promise<void> {
  const provider = params.provider ?? 'stripe';
  const providerEventId =
    params.providerEventId ?? `mock_evt_${crypto.randomUUID().replace(/-/g, '')}`;
  const payloadJson = (() => {
    try {
      return JSON.stringify(params.payload ?? {});
    } catch {
      return '{}';
    }
  })();
  try {
    await env.DB.prepare(
      `INSERT INTO billing_events
         (agency_id, subscription_id, provider, provider_event_id, event_type,
          signature_verified, is_mock, payload_json, processed_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    )
      .bind(
        params.agencyId ?? null,
        params.subscriptionId ?? null,
        provider,
        providerEventId,
        params.eventType,
        params.signatureVerified ? 1 : 0,
        params.isMock === false ? 0 : 1,
        payloadJson,
        params.error ?? null,
      )
      .run();
  } catch {
    /* best-effort — table seq120 absente ou UNIQUE violation (rejeu) → silent ignore */
  }
}

/** SELECT plan catalog by tier (best-effort, null si absent). */
async function loadPlanByTier(env: Env, tier: PlanTier): Promise<BillingPlanCatalog | null> {
  try {
    const row = (await env.DB.prepare(
      'SELECT * FROM billing_plans WHERE tier = ? AND is_active = 1 LIMIT 1',
    )
      .bind(tier)
      .first()) as Record<string, unknown> | null;
    return row ? rowToPlan(row) : null;
  } catch {
    return null;
  }
}

// ── GET /api/billing/plans ────────────────────────────────────────────────
/** Catalogue billing_plans (is_active=1, ORDER BY display_order). Inject
 *  isCurrent=true pour le plan correspondant à la subscription active. */
export async function handleListBillingPlans(
  env: Env,
  auth: BillingAuth,
): Promise<Response> {
  const guard = capGuard(auth, 'billing.view');
  if (guard) return guard;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM billing_plans WHERE is_active = 1 ORDER BY display_order ASC',
    ).all();
    const plans = (results || []).map((r) => rowToPlan(r as Record<string, unknown>));

    // Resolve current tier (best-effort).
    let currentTier: PlanTier = 'free';
    const ctx = await resolveAgencyContext(env, auth);
    if (ctx.agencyId) {
      try {
        const row = (await env.DB.prepare(
          'SELECT plan_name FROM subscriptions WHERE agency_id = ? ORDER BY created_at DESC LIMIT 1',
        )
          .bind(ctx.agencyId)
          .first()) as { plan_name: string | null } | null;
        if (row?.plan_name) currentTier = asPlanTier(row.plan_name);
      } catch {
        /* best-effort */
      }
    }
    for (const p of plans) p.isCurrent = p.tier === currentTier;
    return json({ data: plans });
  } catch (err) {
    if (isMissingSchemaError(err)) return json({ data: [] as BillingPlanCatalog[] });
    return json({ data: [] as BillingPlanCatalog[] });
  }
}

// ── GET /api/billing/subscription ─────────────────────────────────────────
/** Subscription courante de l'agence (ou fallback free mock contextualisé). */
export async function handleGetCurrentSubscription(
  env: Env,
  auth: BillingAuth,
): Promise<Response> {
  const guard = capGuard(auth, 'billing.view');
  if (guard) return guard;

  try {
    const ctx = await resolveAgencyContext(env, auth);
    if (!ctx.agencyId) {
      return json({ data: fallbackSubscription(ctx) });
    }
    const sub = await loadCurrentSubscription(env, ctx.agencyId);
    if (!sub) return json({ data: fallbackSubscription(ctx) });
    return json({ data: sub });
  } catch {
    return json({ data: { ...MOCK_SUBSCRIPTION_FALLBACK } });
  }
}

// ── POST /api/billing/subscription/change ─────────────────────────────────
/** Change le plan de l'agence courante. V1 mock systématique. */
export async function handleChangeSubscriptionPlan(
  request: Request,
  env: Env,
  auth: BillingAuth,
): Promise<Response> {
  // 1. Body validation
  const body = await request.json().catch(() => ({}));
  const parsed = BillingSubscriptionChangeSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid input', code: 'INVALID_INPUT' }, 400);
  }
  const { planTier, billingPeriod } = parsed.data;

  // 2. Capability + agence-only
  const guard = capGuard(auth, 'settings.manage');
  if (guard) return guard;
  const ctx = await resolveAgencyContext(env, auth);
  if (!ctx.agencyId) {
    return json({ error: 'Réservé aux agences', code: 'AGENCY_ONLY' }, 403);
  }

  // 3. Vérifier que le tier existe (et est actif) dans billing_plans
  let planRow: BillingPlanCatalog | null = null;
  try {
    planRow = await loadPlanByTier(env, planTier);
  } catch {
    planRow = null;
  }
  // Si on a une table seq120 jouée mais pas la ligne → PLAN_UNKNOWN.
  // En l'absence de table (best-effort) on accepte le tier (validation zod
  // a déjà filtré sur l'enum figé).
  if (!planRow) {
    // Distinction : table absente OU tier inconnu ? On rejoue le SELECT pour différencier.
    let tableExists = true;
    try {
      await env.DB.prepare('SELECT 1 FROM billing_plans LIMIT 1').first();
    } catch (err) {
      if (isMissingSchemaError(err)) tableExists = false;
    }
    if (tableExists) {
      return json({ error: 'Plan inconnu', code: 'PLAN_UNKNOWN' }, 400);
    }
    // Table absente → dégrade en accepte (seq120 non jouée).
  }

  // 4. Sprint 31 — Double gate live (clé globale + tenant activé).
  //    Si pas live → fallback mock préservé bit-pour-bit Sprint 22.
  const currentSub = await loadCurrentSubscription(env, ctx.agencyId);
  const liveActive =
    isLiveBranchEnabled(env) && (await isTenantLiveEnabled(env, ctx.agencyId));

  if (!liveActive) {
    // ── Fallback mock (Sprint 22 bit-pour-bit) ─────────────────────────────
    // reason : si tenant non activé alors que clé présente → 'tenant_not_activated'.
    //          sinon (clé absente) → 'stripe_not_configured'.
    const reason = env.STRIPE_SECRET_KEY
      ? 'tenant_not_activated'
      : 'stripe_not_configured';

    let updatedSub: ClientSubscription | null = null;
    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET plan_name = ?, billing_period = ?, provider = 'mock',
               stripe_price_id = NULL, updated_at = datetime('now')
         WHERE agency_id = ?`,
      )
        .bind(planTier, billingPeriod ?? null, ctx.agencyId)
        .run();
      updatedSub = await loadCurrentSubscription(env, ctx.agencyId);
    } catch (err) {
      if (!isMissingSchemaError(err)) {
        // erreur autre que migration absente → best-effort, on continue mock
      }
      updatedSub = null;
    }

    await logBillingEvent(env, {
      agencyId: ctx.agencyId,
      subscriptionId: currentSub?.id ?? updatedSub?.id ?? null,
      eventType: 'customer.subscription.updated',
      signatureVerified: false,
      isMock: true,
      payload: { planTier, billingPeriod: billingPeriod ?? null, reason },
    });

    await audit(env, auth.userId, 'billing.plan.change', 'subscription', currentSub?.id ?? '', {
      tier: planTier,
      period: billingPeriod ?? null,
      mock: true,
      reason,
    });

    const finalSub = updatedSub ?? currentSub ?? fallbackSubscription(ctx);
    return json({
      data: { success: true, mock: true, reason, subscription: finalSub },
    });
  }

  // ── Live branch (Sprint 31) ──────────────────────────────────────────────
  // Resolve Stripe Price ID depuis billing_plans (monthly | yearly).
  let stripePriceId: string | null = null;
  try {
    const priceCol =
      billingPeriod === 'yearly' ? 'stripe_price_yearly_id' : 'stripe_price_monthly_id';
    const priceRow = (await env.DB.prepare(
      `SELECT ${priceCol} AS price_id FROM billing_plans WHERE tier = ? AND is_active = 1 LIMIT 1`,
    )
      .bind(planTier)
      .first()) as { price_id: string | null } | null;
    stripePriceId = priceRow?.price_id ?? null;
  } catch {
    stripePriceId = null;
  }
  if (!stripePriceId) {
    return json(
      { error: 'Stripe Price ID manquant pour ce plan', code: 'STRIPE_PRICE_MISSING' },
      400,
    );
  }

  // Lookup user email (best-effort — Stripe accepte création sans email).
  let userEmail = '';
  try {
    const u = (await env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(auth.userId)
      .first()) as { email: string } | null;
    userEmail = String(u?.email ?? '');
  } catch {
    /* fallback empty */
  }

  try {
    // 1. find-or-create Customer
    const customerId = await findOrCreateStripeCustomer(env, ctx.agencyId, userEmail);

    // 2. createSubscription OU updateSubscription selon présence sub Stripe existante
    let stripeSub: Record<string, unknown>;
    if (currentSub?.stripeSubscriptionId && currentSub.stripeSubscriptionId.startsWith('sub_')) {
      const idemKey = `sub_change_${ctx.agencyId}_${planTier}_${billingPeriod ?? 'monthly'}`;
      stripeSub = await updateStripeSubscription(
        env,
        currentSub.stripeSubscriptionId,
        stripePriceId,
        idemKey,
      );
    } else {
      const idemKey = `sub_create_${ctx.agencyId}_${planTier}_${billingPeriod ?? 'monthly'}`;
      stripeSub = await createStripeSubscription(env, customerId, stripePriceId, idemKey);
    }

    const realSubId = typeof stripeSub.id === 'string' ? stripeSub.id : null;
    const realStatus = asSubscriptionStatus(stripeSub.status);
    const cancelAtPeriodEnd =
      stripeSub.cancel_at_period_end === true || stripeSub.cancel_at_period_end === 1;
    const currentPeriodStart =
      typeof stripeSub.current_period_start === 'number'
        ? new Date(stripeSub.current_period_start * 1000).toISOString()
        : null;
    const currentPeriodEnd =
      typeof stripeSub.current_period_end === 'number'
        ? new Date(stripeSub.current_period_end * 1000).toISOString()
        : null;

    // 3. UPDATE D1 avec données Stripe réelles + live_activated_at (premier passage).
    let updatedSub: ClientSubscription | null = null;
    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET plan_name = ?, billing_period = ?, provider = 'stripe',
               status = ?, stripe_subscription_id = ?, stripe_customer_id = ?,
               stripe_price_id = ?, cancel_at_period_end = ?,
               current_period_start = ?, current_period_end = ?,
               live_activated_at = COALESCE(live_activated_at, datetime('now')),
               updated_at = datetime('now')
         WHERE agency_id = ?`,
      )
        .bind(
          planTier,
          billingPeriod ?? null,
          realStatus,
          realSubId,
          customerId,
          stripePriceId,
          cancelAtPeriodEnd ? 1 : 0,
          currentPeriodStart,
          currentPeriodEnd,
          ctx.agencyId,
        )
        .run();
      updatedSub = await loadCurrentSubscription(env, ctx.agencyId);
    } catch {
      /* best-effort — colonnes seq126 absentes */
    }

    await logBillingEvent(env, {
      agencyId: ctx.agencyId,
      subscriptionId: currentSub?.id ?? updatedSub?.id ?? null,
      providerEventId: `sub_change_${realSubId ?? ctx.agencyId}_${Date.now()}`,
      eventType: 'customer.subscription.updated',
      signatureVerified: false,
      isMock: false,
      payload: { planTier, billingPeriod: billingPeriod ?? null, stripeSubId: realSubId },
    });

    await audit(env, auth.userId, 'billing.plan.change', 'subscription', currentSub?.id ?? '', {
      tier: planTier,
      period: billingPeriod ?? null,
      mock: false,
      stripeSubId: realSubId,
    });

    const finalSub = updatedSub ?? currentSub ?? fallbackSubscription(ctx);
    return json({
      data: { success: true, mock: false, subscription: finalSub },
    });
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message || 'Erreur Stripe';
    return json({ error: msg, code: 'STRIPE_API_ERROR' }, 502);
  }
}

// ── POST /api/billing/subscription/cancel ─────────────────────────────────
/** Annule la subscription (atPeriodEnd=true par défaut). Idempotent. */
export async function handleCancelSubscription(
  request: Request,
  env: Env,
  auth: BillingAuth,
): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const parsed = BillingCancelSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid input', code: 'INVALID_INPUT' }, 400);
  }
  const { reason: cancelReason, atPeriodEnd } = parsed.data;

  const guard = capGuard(auth, 'settings.manage');
  if (guard) return guard;
  const ctx = await resolveAgencyContext(env, auth);
  if (!ctx.agencyId) {
    return json({ error: 'Réservé aux agences', code: 'AGENCY_ONLY' }, 403);
  }

  const currentSub = await loadCurrentSubscription(env, ctx.agencyId);
  if (!currentSub) {
    return json({ error: 'Aucune subscription trouvée', code: 'SUBSCRIPTION_NOT_FOUND' }, 404);
  }

  // Sprint 31 — Double gate live.
  const liveActive =
    isLiveBranchEnabled(env) && (await isTenantLiveEnabled(env, ctx.agencyId));

  // Idempotence : déjà cancel_at_period_end=true ET status cohérent ⇒ no-op.
  if (currentSub.cancelAtPeriodEnd && (atPeriodEnd || currentSub.status === 'canceled')) {
    const idemReason = liveActive
      ? 'already_canceled'
      : env.STRIPE_SECRET_KEY
        ? 'tenant_not_activated'
        : 'stripe_not_configured';
    return json({
      data: {
        success: true,
        mock: !liveActive,
        reason: idemReason,
        subscription: currentSub,
        idempotent: true,
      },
    });
  }

  if (!liveActive) {
    // ── Fallback mock (Sprint 22 bit-pour-bit) ─────────────────────────────
    const reason = env.STRIPE_SECRET_KEY
      ? 'tenant_not_activated'
      : 'stripe_not_configured';
    let updatedSub: ClientSubscription | null = currentSub;
    try {
      if (atPeriodEnd) {
        await env.DB.prepare(
          `UPDATE subscriptions
             SET cancel_at_period_end = 1, canceled_at = datetime('now'),
                 updated_at = datetime('now')
           WHERE agency_id = ?`,
        )
          .bind(ctx.agencyId)
          .run();
      } else {
        await env.DB.prepare(
          `UPDATE subscriptions
             SET cancel_at_period_end = 1, canceled_at = datetime('now'),
                 status = 'canceled', updated_at = datetime('now')
           WHERE agency_id = ?`,
        )
          .bind(ctx.agencyId)
          .run();
      }
      updatedSub = await loadCurrentSubscription(env, ctx.agencyId);
    } catch (err) {
      if (!isMissingSchemaError(err)) {
        // best-effort
      }
    }

    await logBillingEvent(env, {
      agencyId: ctx.agencyId,
      subscriptionId: currentSub.id,
      eventType: 'customer.subscription.deleted',
      signatureVerified: false,
      isMock: true,
      payload: { atPeriodEnd, reason: cancelReason ?? null },
    });

    await audit(env, auth.userId, 'billing.subscription.cancel', 'subscription', currentSub.id, {
      atPeriodEnd,
      reason: cancelReason ?? null,
      mock: true,
    });

    return json({
      data: { success: true, mock: true, reason, subscription: updatedSub ?? currentSub },
    });
  }

  // ── Live branch ──────────────────────────────────────────────────────────
  // Sans sub Stripe attachée, on retombe sur mock (rien à canceler côté Stripe).
  if (!currentSub.stripeSubscriptionId || !currentSub.stripeSubscriptionId.startsWith('sub_')) {
    return json(
      { error: 'Aucune subscription Stripe attachée', code: 'STRIPE_SUB_MISSING' },
      400,
    );
  }

  try {
    const idemKey = `sub_cancel_${ctx.agencyId}_${currentSub.stripeSubscriptionId}_${atPeriodEnd ? 'eop' : 'now'}`;
    const stripeSub = await cancelStripeSubscription(
      env,
      currentSub.stripeSubscriptionId,
      atPeriodEnd,
      idemKey,
    );

    const realStatus = asSubscriptionStatus(stripeSub.status);
    const realCancelAtPeriodEnd =
      stripeSub.cancel_at_period_end === true || stripeSub.cancel_at_period_end === 1;
    const realCanceledAt =
      typeof stripeSub.canceled_at === 'number'
        ? new Date(stripeSub.canceled_at * 1000).toISOString()
        : new Date().toISOString();

    let updatedSub: ClientSubscription | null = currentSub;
    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET cancel_at_period_end = ?, canceled_at = ?, status = ?,
               updated_at = datetime('now')
         WHERE agency_id = ?`,
      )
        .bind(
          realCancelAtPeriodEnd ? 1 : 0,
          realCanceledAt,
          realStatus,
          ctx.agencyId,
        )
        .run();
      updatedSub = await loadCurrentSubscription(env, ctx.agencyId);
    } catch {
      /* best-effort */
    }

    await logBillingEvent(env, {
      agencyId: ctx.agencyId,
      subscriptionId: currentSub.id,
      providerEventId: `sub_cancel_${currentSub.stripeSubscriptionId}_${Date.now()}`,
      eventType: 'customer.subscription.deleted',
      signatureVerified: false,
      isMock: false,
      payload: { atPeriodEnd, reason: cancelReason ?? null },
    });

    await audit(env, auth.userId, 'billing.subscription.cancel', 'subscription', currentSub.id, {
      atPeriodEnd,
      reason: cancelReason ?? null,
      mock: false,
      stripeSubId: currentSub.stripeSubscriptionId,
    });

    return json({
      data: { success: true, mock: false, subscription: updatedSub ?? currentSub },
    });
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message || 'Erreur Stripe';
    return json({ error: msg, code: 'STRIPE_API_ERROR' }, 502);
  }
}

// ── POST /api/billing/subscription/resume ─────────────────────────────────
/** Reprend une subscription annulée. Idempotent : déjà active ⇒ no-op succès. */
export async function handleResumeSubscription(
  env: Env,
  auth: BillingAuth,
): Promise<Response> {
  const guard = capGuard(auth, 'settings.manage');
  if (guard) return guard;
  const ctx = await resolveAgencyContext(env, auth);
  if (!ctx.agencyId) {
    return json({ error: 'Réservé aux agences', code: 'AGENCY_ONLY' }, 403);
  }

  const currentSub = await loadCurrentSubscription(env, ctx.agencyId);
  if (!currentSub) {
    return json({ error: 'Aucune subscription trouvée', code: 'SUBSCRIPTION_NOT_FOUND' }, 404);
  }

  // Sprint 31 — Double gate live.
  const liveActive =
    isLiveBranchEnabled(env) && (await isTenantLiveEnabled(env, ctx.agencyId));

  // Idempotence : déjà active et non-cancel → no-op.
  if (!currentSub.cancelAtPeriodEnd && currentSub.status === 'active') {
    const idemReason = liveActive
      ? 'already_active'
      : env.STRIPE_SECRET_KEY
        ? 'tenant_not_activated'
        : 'stripe_not_configured';
    return json({
      data: {
        success: true,
        mock: !liveActive,
        reason: idemReason,
        subscription: currentSub,
        idempotent: true,
      },
    });
  }

  if (!liveActive) {
    // ── Fallback mock (Sprint 22 bit-pour-bit) ─────────────────────────────
    const reason = env.STRIPE_SECRET_KEY
      ? 'tenant_not_activated'
      : 'stripe_not_configured';
    let updatedSub: ClientSubscription | null = currentSub;
    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET cancel_at_period_end = 0, canceled_at = NULL,
               status = CASE WHEN status = 'canceled' THEN 'active' ELSE status END,
               updated_at = datetime('now')
         WHERE agency_id = ?`,
      )
        .bind(ctx.agencyId)
        .run();
      updatedSub = await loadCurrentSubscription(env, ctx.agencyId);
    } catch (err) {
      if (!isMissingSchemaError(err)) {
        // best-effort
      }
    }

    await logBillingEvent(env, {
      agencyId: ctx.agencyId,
      subscriptionId: currentSub.id,
      eventType: 'customer.subscription.updated',
      signatureVerified: false,
      isMock: true,
      payload: { action: 'resume' },
    });

    await audit(env, auth.userId, 'billing.subscription.resume', 'subscription', currentSub.id, {
      mock: true,
    });

    return json({
      data: { success: true, mock: true, reason, subscription: updatedSub ?? currentSub },
    });
  }

  // ── Live branch ──────────────────────────────────────────────────────────
  if (!currentSub.stripeSubscriptionId || !currentSub.stripeSubscriptionId.startsWith('sub_')) {
    return json(
      { error: 'Aucune subscription Stripe attachée', code: 'STRIPE_SUB_MISSING' },
      400,
    );
  }

  try {
    // `updateStripeSubscription` du helper A1 ne couvre que le change of price.
    // Pour resume on doit poser `cancel_at_period_end=false` → on appelle
    // `stripeFetch` directement (POST /subscriptions/{id}).
    const idemKey = `sub_resume_${ctx.agencyId}_${currentSub.stripeSubscriptionId}`;
    const stripeSub = await stripeFetch(
      env,
      `/subscriptions/${encodeURIComponent(currentSub.stripeSubscriptionId)}`,
      { cancel_at_period_end: 'false' },
      { idempotencyKey: idemKey },
    );

    const realStatus = asSubscriptionStatus(stripeSub.status);
    const realCancelAtPeriodEnd =
      stripeSub.cancel_at_period_end === true || stripeSub.cancel_at_period_end === 1;

    let updatedSub: ClientSubscription | null = currentSub;
    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET cancel_at_period_end = ?, canceled_at = NULL,
               status = ?, updated_at = datetime('now')
         WHERE agency_id = ?`,
      )
        .bind(realCancelAtPeriodEnd ? 1 : 0, realStatus, ctx.agencyId)
        .run();
      updatedSub = await loadCurrentSubscription(env, ctx.agencyId);
    } catch {
      /* best-effort */
    }

    await logBillingEvent(env, {
      agencyId: ctx.agencyId,
      subscriptionId: currentSub.id,
      providerEventId: `sub_resume_${currentSub.stripeSubscriptionId}_${Date.now()}`,
      eventType: 'customer.subscription.updated',
      signatureVerified: false,
      isMock: false,
      payload: { action: 'resume' },
    });

    await audit(env, auth.userId, 'billing.subscription.resume', 'subscription', currentSub.id, {
      mock: false,
      stripeSubId: currentSub.stripeSubscriptionId,
    });

    return json({
      data: { success: true, mock: false, subscription: updatedSub ?? currentSub },
    });
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message || 'Erreur Stripe';
    return json({ error: msg, code: 'STRIPE_API_ERROR' }, 502);
  }
}

// ── POST /api/billing/portal-session ──────────────────────────────────────
/** Crée une session portail Stripe MOCK (V1 toujours mock). */
export async function handleCreatePortalSession(
  request: Request,
  env: Env,
  auth: BillingAuth,
): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const parsed = BillingPortalSessionSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid input', code: 'INVALID_INPUT' }, 400);
  }
  const { returnUrl: bodyReturnUrl } = parsed.data;

  const guard = capGuard(auth, 'settings.manage');
  if (guard) return guard;
  const ctx = await resolveAgencyContext(env, auth);
  if (!ctx.agencyId) {
    return json({ error: 'Réservé aux agences', code: 'AGENCY_ONLY' }, 403);
  }

  // Sprint 31 — Double gate live.
  const liveActive =
    isLiveBranchEnabled(env) && (await isTenantLiveEnabled(env, ctx.agencyId));

  // Lookup sub courante pour récupérer stripe_customer_id si live.
  const currentSub = liveActive ? await loadCurrentSubscription(env, ctx.agencyId) : null;
  const hasStripeCustomer =
    !!currentSub?.stripeCustomerId && currentSub.stripeCustomerId.startsWith('cus_');

  // ── Live branch (customer attaché + live activé) ─────────────────────────
  if (liveActive && hasStripeCustomer) {
    try {
      const returnUrl =
        typeof bodyReturnUrl === 'string' && bodyReturnUrl
          ? bodyReturnUrl
          : 'https://app.intralys.io/settings/billing?return=1';
      const portal = await createBillingPortalSession(
        env,
        currentSub!.stripeCustomerId!,
        returnUrl,
      );
      await audit(env, auth.userId, 'billing.portal.session_created', 'agency', ctx.agencyId, {
        mock: false,
      });
      return json({
        data: {
          url: portal.url,
          expiresAt: new Date(portal.expires_at * 1000).toISOString(),
          isMock: false,
        } satisfies BillingPortalSession,
      });
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || 'Erreur Stripe';
      return json({ error: msg, code: 'STRIPE_API_ERROR' }, 502);
    }
  }

  // ── Fallback mock (Sprint 22 bit-pour-bit) ───────────────────────────────
  // Préservé pour : pas de clé globale OU tenant non activé OU pas de customer attaché.
  const session: BillingPortalSession = {
    url: `${buildMockPortalUrl(ctx.agencyId)}?token=${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    isMock: true,
  };

  await audit(env, auth.userId, 'billing.portal.session_created', 'agency', ctx.agencyId, {
    mock: true,
  });

  return json({ data: session });
}

// ── GET /api/billing/usage ────────────────────────────────────────────────
/** Compte sub_accounts/leads/users courants vs limites du plan actuel. */
export async function handleGetBillingUsage(
  env: Env,
  auth: BillingAuth,
): Promise<Response> {
  const guard = capGuard(auth, 'billing.view');
  if (guard) return guard;

  const ctx = await resolveAgencyContext(env, auth);
  if (!ctx.agencyId) {
    return json({ data: MOCK_USAGE_FALLBACK });
  }
  const agencyId = ctx.agencyId;

  // ── Limites du plan actuel ────────────────────────────────────────────
  // Priorité : billing_plans (seq120). Fallback : plans.ts (PLANS legacy)
  // → conversion Infinity → null pour JSON valide.
  let limits: BillingPlanLimits = { maxSubAccounts: null, maxLeads: null, maxUsers: null };
  let planTier: PlanTier = 'free';
  try {
    const row = (await env.DB.prepare(
      'SELECT plan_name FROM subscriptions WHERE agency_id = ? ORDER BY created_at DESC LIMIT 1',
    )
      .bind(agencyId)
      .first()) as { plan_name: string | null } | null;
    if (row?.plan_name) planTier = asPlanTier(row.plan_name);
  } catch {
    /* best-effort */
  }
  const planRow = await loadPlanByTier(env, planTier);
  if (planRow) {
    limits = planRow.limits;
  } else {
    // Fallback plans.ts (legacy). Infinity → null.
    const legacy = resolvePlan(planTier);
    const j = (v: number): number | null => (Number.isFinite(v) ? v : null);
    limits = {
      maxSubAccounts: j(legacy.maxSubAccounts),
      maxLeads: j(legacy.maxLeads),
      maxUsers: j(legacy.maxUsers),
    };
  }

  // ── 3 COUNT bornés agence — calque saas.ts:293-301 ────────────────────
  async function countAgency(sql: string): Promise<number> {
    try {
      const r = (await env.DB.prepare(sql).bind(agencyId).first()) as
        | { n: number | null }
        | null;
      const n = Number(r?.n ?? 0);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  const subAccounts = await countAgency(
    'SELECT COUNT(*) AS n FROM clients WHERE agency_id = ?',
  );
  const leads = await countAgency(
    'SELECT COUNT(*) AS n FROM leads WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ?)',
  );
  const users = await countAgency(
    'SELECT COUNT(*) AS n FROM user_sub_accounts WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ?)',
  );

  const usage: BillingUsage = {
    subAccounts: { current: subAccounts, limit: limits.maxSubAccounts },
    leads: { current: leads, limit: limits.maxLeads },
    users: { current: users, limit: limits.maxUsers },
  };
  return json({ data: usage });
}

// ── GET /api/billing/invoices ─────────────────────────────────────────────
/** Liste les 50 dernières factures de l'agence (billing_invoices_mock). */
export async function handleListBillingInvoices(
  env: Env,
  auth: BillingAuth,
): Promise<Response> {
  const guard = capGuard(auth, 'billing.view');
  if (guard) return guard;

  const ctx = await resolveAgencyContext(env, auth);
  if (!ctx.agencyId) {
    return json({ data: [] as BillingInvoiceMock[] });
  }
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM billing_invoices_mock WHERE agency_id = ? ORDER BY created_at DESC LIMIT 50',
    )
      .bind(ctx.agencyId)
      .all();
    const invoices = (results || []).map((r) => rowToInvoice(r as Record<string, unknown>));
    return json({ data: invoices });
  } catch (err) {
    if (isMissingSchemaError(err)) return json({ data: [] as BillingInvoiceMock[] });
    return json({ data: [] as BillingInvoiceMock[] });
  }
}

// ── GET /api/billing/webhook-config ───────────────────────────────────────
/** État de la configuration webhook Stripe SaaS (admin diagnostic). */
export async function handleGetWebhookConfig(
  env: Env,
  auth: BillingAuth,
): Promise<Response> {
  const guard = capGuard(auth, 'settings.manage');
  if (guard) return guard;

  try {
    const stripeKeyConfigured = !!env.STRIPE_SECRET_KEY;
    const signingSecretConfigured = !!env.STRIPE_WEBHOOK_SECRET;
    const config: BillingWebhookConfig = {
      endpointUrl: '/api/webhook/stripe',
      signingSecretConfigured,
      stripeKeyConfigured,
      modeMock: !stripeKeyConfigured,
      supportedEvents: SUPPORTED_WEBHOOK_EVENTS,
    };
    return json({ data: config });
  } catch {
    return json({ error: 'Config error', code: 'INTERNAL' }, 500);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Webhook event handlers — EXPORTÉS pour billing.ts:handleStripeWebhook
// (extension chirurgicale du dispatcher SaaS, AVANT le bloc legacy).
//
// Chaque handler est best-effort, jamais throw. Tous logent dans billing_events
// via logBillingEvent (idempotence via UNIQUE provider+event_id).
// ──────────────────────────────────────────────────────────────────────────

interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
  created?: number;
  livemode?: boolean;
}

/** Trouve agency_id + subscription_id via stripe_customer_id ou stripe_subscription_id. */
async function lookupSubByStripeIds(
  env: Env,
  ids: { customer?: string | null; subscription?: string | null },
): Promise<{ id: string; agency_id: string | null } | null> {
  try {
    if (ids.subscription) {
      const row = (await env.DB.prepare(
        'SELECT id, agency_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1',
      )
        .bind(ids.subscription)
        .first()) as { id: string; agency_id: string | null } | null;
      if (row) return row;
    }
    if (ids.customer) {
      const row = (await env.DB.prepare(
        'SELECT id, agency_id FROM subscriptions WHERE stripe_customer_id = ? LIMIT 1',
      )
        .bind(ids.customer)
        .first()) as { id: string; agency_id: string | null } | null;
      if (row) return row;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

/** Handler webhook : customer.subscription.created / .updated. */
export async function applyStripeSubscriptionUpsert(
  env: Env,
  event: StripeEvent,
  signatureVerified: boolean,
): Promise<void> {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const subscriptionId = typeof obj.id === 'string' ? obj.id : null;
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;
  const status = asSubscriptionStatus(obj.status);

  // Try to derive a tier from items[0].price.lookup_key / nickname, fallback 'free'.
  let planTier: PlanTier = 'free';
  let stripePriceId: string | null = null;
  try {
    const items = (obj as { items?: { data?: Array<Record<string, unknown>> } }).items;
    const first = items?.data?.[0] as Record<string, unknown> | undefined;
    const price = (first?.price as Record<string, unknown> | undefined) ?? undefined;
    if (price) {
      stripePriceId = typeof price.id === 'string' ? price.id : null;
      const lookup =
        (typeof price.lookup_key === 'string' && price.lookup_key) ||
        (typeof price.nickname === 'string' && price.nickname) ||
        '';
      const v = lookup.toLowerCase();
      if (isValidPlanTier(v)) planTier = v;
    }
  } catch {
    /* best-effort */
  }

  const cancelAtPeriodEnd = obj.cancel_at_period_end === true || obj.cancel_at_period_end === 1;
  const currentPeriodStart =
    typeof obj.current_period_start === 'number'
      ? new Date(obj.current_period_start * 1000).toISOString()
      : null;
  const currentPeriodEnd =
    typeof obj.current_period_end === 'number'
      ? new Date(obj.current_period_end * 1000).toISOString()
      : null;

  const existing = await lookupSubByStripeIds(env, { customer: customerId, subscription: subscriptionId });

  if (existing) {
    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET plan_name = ?, status = ?, stripe_subscription_id = ?,
               stripe_price_id = ?, cancel_at_period_end = ?,
               current_period_start = ?, current_period_end = ?,
               provider = 'stripe', updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(
          planTier,
          status,
          subscriptionId,
          stripePriceId,
          cancelAtPeriodEnd ? 1 : 0,
          currentPeriodStart,
          currentPeriodEnd,
          existing.id,
        )
        .run();
    } catch {
      /* best-effort — colonnes seq120 absentes */
    }
  }

  await logBillingEvent(env, {
    agencyId: existing?.agency_id ?? null,
    subscriptionId: existing?.id ?? null,
    providerEventId: event.id ?? `mock_evt_${crypto.randomUUID().replace(/-/g, '')}`,
    eventType: event.type ?? 'customer.subscription.updated',
    signatureVerified,
    isMock: !signatureVerified,
    payload: obj,
  });
}

/** Handler webhook : customer.subscription.deleted. */
export async function applyStripeSubscriptionDeleted(
  env: Env,
  event: StripeEvent,
  signatureVerified: boolean,
): Promise<void> {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const subscriptionId = typeof obj.id === 'string' ? obj.id : null;
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;

  const existing = await lookupSubByStripeIds(env, { customer: customerId, subscription: subscriptionId });
  if (existing) {
    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET status = 'canceled', canceled_at = datetime('now'),
               cancel_at_period_end = 1, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(existing.id)
        .run();
    } catch {
      /* best-effort */
    }
  }

  await logBillingEvent(env, {
    agencyId: existing?.agency_id ?? null,
    subscriptionId: existing?.id ?? null,
    providerEventId: event.id ?? `mock_evt_${crypto.randomUUID().replace(/-/g, '')}`,
    eventType: 'customer.subscription.deleted',
    signatureVerified,
    isMock: !signatureVerified,
    payload: obj,
  });
}

/** Handler webhook : customer.subscription.trial_will_end (no-op + log V1). */
export async function applyStripeTrialWillEnd(
  env: Env,
  event: StripeEvent,
  signatureVerified: boolean,
): Promise<void> {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const subscriptionId = typeof obj.id === 'string' ? obj.id : null;
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;

  const existing = await lookupSubByStripeIds(env, { customer: customerId, subscription: subscriptionId });
  if (existing) {
    try {
      const metaJson = JSON.stringify({ trialWillEndNotifiedAt: new Date().toISOString() });
      await env.DB.prepare(
        `UPDATE subscriptions
           SET metadata_json = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(metaJson, existing.id)
        .run();
    } catch {
      /* best-effort */
    }
  }

  await logBillingEvent(env, {
    agencyId: existing?.agency_id ?? null,
    subscriptionId: existing?.id ?? null,
    providerEventId: event.id ?? `mock_evt_${crypto.randomUUID().replace(/-/g, '')}`,
    eventType: 'customer.subscription.trial_will_end',
    signatureVerified,
    isMock: !signatureVerified,
    payload: obj,
  });
}

/** Handler webhook : invoice.payment_failed → status='past_due'. */
export async function applyStripeInvoicePaymentFailed(
  env: Env,
  event: StripeEvent,
  signatureVerified: boolean,
): Promise<void> {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;
  const subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : null;

  const existing = await lookupSubByStripeIds(env, { customer: customerId, subscription: subscriptionId });
  if (existing) {
    try {
      await env.DB.prepare(
        `UPDATE subscriptions
           SET status = 'past_due', updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(existing.id)
        .run();
    } catch {
      /* best-effort */
    }
  }

  await logBillingEvent(env, {
    agencyId: existing?.agency_id ?? null,
    subscriptionId: existing?.id ?? null,
    providerEventId: event.id ?? `mock_evt_${crypto.randomUUID().replace(/-/g, '')}`,
    eventType: 'invoice.payment_failed',
    signatureVerified,
    isMock: !signatureVerified,
    payload: obj,
  });
}

/** Handler webhook : invoice.finalized / invoice.paid → INSERT billing_invoices_mock. */
export async function applyStripeInvoiceUpsert(
  env: Env,
  event: StripeEvent,
  signatureVerified: boolean,
): Promise<void> {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const stripeInvoiceId = typeof obj.id === 'string' ? obj.id : null;
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;
  const subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : null;

  const existing = await lookupSubByStripeIds(env, { customer: customerId, subscription: subscriptionId });
  if (existing?.agency_id) {
    const status =
      event.type === 'invoice.paid'
        ? 'paid'
        : typeof obj.status === 'string'
        ? String(obj.status)
        : 'open';
    const amountDue = Number(obj.amount_due ?? 0) || 0;
    const amountPaid = Number(obj.amount_paid ?? 0) || 0;
    const currency = (typeof obj.currency === 'string' ? obj.currency : 'cad').toUpperCase();
    const number = typeof obj.number === 'string' ? obj.number : null;
    const hostedUrl = typeof obj.hosted_invoice_url === 'string' ? obj.hosted_invoice_url : null;
    const pdfUrl = typeof obj.invoice_pdf === 'string' ? obj.invoice_pdf : null;
    const periodStart =
      typeof obj.period_start === 'number'
        ? new Date(obj.period_start * 1000).toISOString()
        : null;
    const periodEnd =
      typeof obj.period_end === 'number' ? new Date(obj.period_end * 1000).toISOString() : null;

    try {
      // UPSERT par stripe_invoice_id : on tente INSERT, fallback UPDATE si UNIQUE.
      await env.DB.prepare(
        `INSERT INTO billing_invoices_mock
           (agency_id, subscription_id, stripe_invoice_id, number, amount_due_cents,
            amount_paid_cents, currency, status, period_start, period_end,
            hosted_invoice_url, pdf_url, is_mock, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
        .bind(
          existing.agency_id,
          existing.id,
          stripeInvoiceId,
          number,
          amountDue,
          amountPaid,
          currency,
          status,
          periodStart,
          periodEnd,
          hostedUrl,
          pdfUrl,
          signatureVerified ? 0 : 1,
        )
        .run();
    } catch {
      // UNIQUE collision (rejeu) ou colonnes absentes → best-effort UPDATE
      try {
        if (stripeInvoiceId) {
          await env.DB.prepare(
            `UPDATE billing_invoices_mock
               SET status = ?, amount_paid_cents = ?, updated_at = datetime('now')
             WHERE stripe_invoice_id = ?`,
          )
            .bind(status, amountPaid, stripeInvoiceId)
            .run();
        }
      } catch {
        /* best-effort */
      }
    }
  }

  await logBillingEvent(env, {
    agencyId: existing?.agency_id ?? null,
    subscriptionId: existing?.id ?? null,
    providerEventId: event.id ?? `mock_evt_${crypto.randomUUID().replace(/-/g, '')}`,
    eventType: event.type ?? 'invoice.finalized',
    signatureVerified,
    isMock: !signatureVerified,
    payload: obj,
  });
}

/** Handler webhook : event type inconnu → log seul, pas d'effet. */
export async function logStripeUnknownEvent(
  env: Env,
  event: StripeEvent,
  signatureVerified: boolean,
): Promise<void> {
  await logBillingEvent(env, {
    providerEventId: event.id ?? `mock_evt_${crypto.randomUUID().replace(/-/g, '')}`,
    eventType: event.type ?? 'unknown',
    signatureVerified,
    isMock: !signatureVerified,
    payload: event.data?.object ?? {},
  });
}

/**
 * Dispatcher central des events Stripe SaaS. Appelé depuis billing.ts:
 * handleStripeWebhook AVANT le bloc legacy (qui reste byte-identique).
 *
 * @returns true si l'event a été pris en charge par un handler SaaS dédié
 *          (le dispatcher legacy peut quand même tourner après — c'est fait
 *          exprès pour `invoice.paid`/`checkout.session.completed` qui
 *          UPDATE-ent `invoices.status` côté E4-non-marchand legacy).
 */
export async function dispatchStripeSaasEvent(
  env: Env,
  event: StripeEvent,
  signatureVerified: boolean,
): Promise<{ handled: boolean }> {
  const type = event.type ?? '';
  switch (type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await applyStripeSubscriptionUpsert(env, event, signatureVerified);
      return { handled: true };
    case 'customer.subscription.deleted':
      await applyStripeSubscriptionDeleted(env, event, signatureVerified);
      return { handled: true };
    case 'customer.subscription.trial_will_end':
      await applyStripeTrialWillEnd(env, event, signatureVerified);
      return { handled: true };
    case 'invoice.payment_failed':
      await applyStripeInvoicePaymentFailed(env, event, signatureVerified);
      return { handled: true };
    case 'invoice.finalized':
      await applyStripeInvoiceUpsert(env, event, signatureVerified);
      return { handled: true };
    case 'invoice.paid':
      // Parallèle au bloc legacy (qui UPDATE invoices.status) : on INSERT aussi
      // dans billing_invoices_mock pour cohérence côté SaaS.
      await applyStripeInvoiceUpsert(env, event, signatureVerified);
      return { handled: true };
    case 'checkout.session.completed':
      // Legacy seul (UPDATE invoices.status). Côté SaaS : juste un log.
      await logStripeUnknownEvent(env, event, signatureVerified);
      return { handled: false };
    default:
      // Event inconnu — log only, no-op SaaS.
      await logStripeUnknownEvent(env, event, signatureVerified);
      return { handled: false };
  }
}
