// ── saas-billing.test.ts — Sprint 22 (Manager-B) ────────────────────────────
//
// Couvre les 10 handlers du module saas-billing.ts (migration seq120) :
//   - GET    /api/billing/plans                         → handleListBillingPlans
//   - GET    /api/billing/subscription                  → handleGetCurrentSubscription
//   - POST   /api/billing/subscription/change           → handleChangeSubscriptionPlan
//   - POST   /api/billing/subscription/cancel           → handleCancelSubscription
//   - POST   /api/billing/subscription/resume           → handleResumeSubscription
//   - POST   /api/billing/portal-session                → handleCreatePortalSession
//   - GET    /api/billing/usage                         → handleGetBillingUsage
//   - GET    /api/billing/invoices                      → handleListBillingInvoices
//   - GET    /api/billing/webhook-config                → handleGetWebhookConfig
//
// Approche : harness mock D1 (`createMockD1` + `seed`) — calqué sur
// onboarding-checklist-s21.test.ts. Vitest n'exécute pas D1 en VM : on
// assert sur `db.calls` et sur le shape des réponses.
//
// Contrats vérifiés :
//   1. Idiome mock systématique (success:true, mock:true, reason).
//   2. Capability agence-only (settings.manage mutations / billing.view lectures).
//   3. AGENCY_ONLY 403 si pas de tenant.agencyId.
//   4. PLAN_UNKNOWN si tier valide enum mais absent de billing_plans.
//   5. INVALID_INPUT si body zod invalide.
//   6. SUBSCRIPTION_NOT_FOUND pour cancel/resume sans sub.
//   7. Idempotence cancel/resume.
//   8. Dégradation seq120 absente → 200 + shape vide (PAS 500).

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import {
  handleListBillingPlans,
  handleGetCurrentSubscription,
  handleChangeSubscriptionPlan,
  handleCancelSubscription,
  handleResumeSubscription,
  handleCreatePortalSession,
  handleGetBillingUsage,
  handleListBillingInvoices,
  handleGetWebhookConfig,
} from '../saas-billing';

// ── Auth helpers ───────────────────────────────────────────────────────────

type Auth = {
  userId: string;
  role?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
};

const AUTH_LEGACY: Auth = { userId: 'user-1', role: 'admin' };

const AUTH_AGENCY_FULL: Auth = {
  userId: 'user-1',
  role: 'admin',
  tenant: { agencyId: 'agency-1', accessibleClientIds: ['client-1'] },
  capabilities: new Set(['billing.view', 'settings.manage']),
};

const AUTH_AGENCY_VIEW_ONLY: Auth = {
  userId: 'user-2',
  role: 'broker',
  tenant: { agencyId: 'agency-1', accessibleClientIds: ['client-1'] },
  capabilities: new Set(['billing.view']),
};

// ── Env / seed helpers ─────────────────────────────────────────────────────

interface MakeEnvOpts {
  clientId?: string | null;
  /** Subscriptions row (single). Set to null to simulate "no row". */
  subscription?: Record<string, unknown> | null;
  /** Plans (catalog rows). Set to undefined to use defaults. */
  plans?: Record<string, unknown>[] | null;
  /** Invoices rows. Set to undefined → []. */
  invoices?: Record<string, unknown>[] | null;
  /** STRIPE_SECRET_KEY bound ? */
  stripeKey?: string;
  /** STRIPE_WEBHOOK_SECRET bound ? */
  webhookSecret?: string;
  /** count rows used by handleGetBillingUsage. */
  counts?: { sub_accounts?: number; leads?: number; users?: number };
  /** Simule seq120 totalement absente (toute table billing_* throw). */
  missingSeq120?: boolean;
}

function defaultPlans(): Record<string, unknown>[] {
  return [
    {
      id: 'p1',
      tier: 'free',
      display_name: 'Gratuit',
      description: 'Pour tester Intralys.',
      price_monthly_cents: 0,
      price_yearly_cents: 0,
      currency: 'CAD',
      limits_json: '{"maxSubAccounts":2,"maxLeads":500,"maxUsers":3}',
      features_json: null,
      display_order: 10,
      is_active: 1,
    },
    {
      id: 'p2',
      tier: 'starter',
      display_name: 'Starter',
      description: 'Pour démarrer.',
      price_monthly_cents: 4900,
      price_yearly_cents: 49000,
      currency: 'CAD',
      limits_json: '{"maxSubAccounts":5,"maxLeads":2500,"maxUsers":10}',
      features_json: null,
      display_order: 20,
      is_active: 1,
    },
    {
      id: 'p3',
      tier: 'pro',
      display_name: 'Pro',
      description: 'Pour grossir.',
      price_monthly_cents: 14900,
      price_yearly_cents: 149000,
      currency: 'CAD',
      limits_json: '{"maxSubAccounts":10,"maxLeads":10000,"maxUsers":25}',
      features_json: null,
      display_order: 30,
      is_active: 1,
    },
    {
      id: 'p4',
      tier: 'unlimited',
      display_name: 'Illimité',
      description: 'Sans limite.',
      price_monthly_cents: 49900,
      price_yearly_cents: 499000,
      currency: 'CAD',
      limits_json: '{"maxSubAccounts":null,"maxLeads":null,"maxUsers":null}',
      features_json: null,
      display_order: 40,
      is_active: 1,
    },
  ];
}

function makeEnv(opts: MakeEnvOpts = {}) {
  const db = createMockD1();
  // ⚠ Mock D1 = 1er-match wins par substring. Les counts d'usage doivent être
  // seedés AVANT `select id from clients where agency_id` car celui-ci est
  // contenu dans le sous-SELECT des requêtes COUNT FROM leads / user_sub_accounts.
  if (opts.counts) {
    db.seed('count(*) as n from clients where agency_id', [{ n: opts.counts.sub_accounts ?? 0 }]);
    db.seed('count(*) as n from leads', [{ n: opts.counts.leads ?? 0 }]);
    db.seed('count(*) as n from user_sub_accounts', [{ n: opts.counts.users ?? 0 }]);
  }
  // users → client_id
  const clientId = opts.clientId === undefined ? 'client-1' : opts.clientId;
  db.seed('from users where id', [{ client_id: clientId }]);
  // clients.modules_json
  db.seed('modules_json from clients', [{ modules_json: '["crm"]' }]);
  // clients.id list pour resolveAgencyContext
  db.seed('select id from clients where agency_id', [{ id: 'client-1' }]);

  // billing_plans rows
  if (opts.plans === undefined) {
    db.seed('from billing_plans', defaultPlans());
  } else if (opts.plans) {
    db.seed('from billing_plans', opts.plans);
  }
  // subscription row (single).
  if (opts.subscription !== undefined) {
    if (opts.subscription) {
      db.seed('from subscriptions where agency_id', [opts.subscription]);
      db.seed('from subscriptions where stripe', [opts.subscription]);
    }
    // null → pas de seed → mock D1 retourne []
  }
  // For handleListBillingPlans: SELECT plan_name FROM subscriptions
  if (opts.subscription !== undefined && opts.subscription) {
    db.seed('plan_name from subscriptions', [
      { plan_name: opts.subscription.plan_name as string },
    ]);
  }
  // Invoices
  if (opts.invoices !== undefined && opts.invoices) {
    db.seed('from billing_invoices_mock', opts.invoices);
  }

  const env = {
    DB: db,
    STRIPE_SECRET_KEY: opts.stripeKey,
    STRIPE_WEBHOOK_SECRET: opts.webhookSecret,
  } as unknown as Env;

  return { env, db };
}

function postReq(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 1. handleListBillingPlans
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — GET /api/billing/plans', () => {
  it('liste les 4 plans seedés triés par display_order', async () => {
    const { env } = makeEnv({
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'starter',
        status: 'active',
        provider: 'mock',
        created_at: '2026-05-22 10:00:00',
      },
    });
    const res = await handleListBillingPlans(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ tier: string; isCurrent?: boolean }> };
    expect(body.data).toHaveLength(4);
    expect(body.data.map((p) => p.tier)).toEqual(['free', 'starter', 'pro', 'unlimited']);
    expect(body.data.find((p) => p.tier === 'starter')?.isCurrent).toBe(true);
    expect(body.data.find((p) => p.tier === 'pro')?.isCurrent).toBe(false);
  });

  it('seq120 absente → tableau vide (200)', async () => {
    const { env, db } = makeEnv({ plans: null });
    // Forcer une "table absente" : on remplace prepare pour throw sur billing_plans
    const orig = db.prepare.bind(db);
    (db as unknown as { prepare: typeof orig }).prepare = (sql: string) => {
      if (/from billing_plans/i.test(sql)) {
        throw new Error('SqliteError: no such table: billing_plans');
      }
      return orig(sql);
    };
    const res = await handleListBillingPlans(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('legacy (sans tenant agence) → ne bloque pas (capGuard skip)', async () => {
    const { env } = makeEnv();
    const res = await handleListBillingPlans(env, AUTH_LEGACY);
    expect(res.status).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. handleGetCurrentSubscription
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — GET /api/billing/subscription', () => {
  it('row réelle → retourne ClientSubscription mappée', async () => {
    const { env } = makeEnv({
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'pro',
        status: 'active',
        billing_period: 'monthly',
        provider: 'stripe',
        stripe_customer_id: 'cus_xyz',
        stripe_subscription_id: 'sub_xyz',
        stripe_price_id: 'price_xyz',
        cancel_at_period_end: 0,
        created_at: '2026-05-22 10:00:00',
        updated_at: '2026-05-22 11:00:00',
      },
    });
    const res = await handleGetCurrentSubscription(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { planTier: string; isMock: boolean; agencyId: string } };
    expect(body.data.planTier).toBe('pro');
    expect(body.data.agencyId).toBe('agency-1');
    expect(body.data.isMock).toBe(false);
  });

  it('pas de tenant agence (legacy) → fallback subscription mock', async () => {
    const { env } = makeEnv();
    const res = await handleGetCurrentSubscription(env, AUTH_LEGACY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { planTier: string; isMock: boolean } };
    expect(body.data.planTier).toBe('free');
    expect(body.data.isMock).toBe(true);
  });

  it('seq120 absente → fallback mock (200)', async () => {
    const { env, db } = makeEnv();
    const orig = db.prepare.bind(db);
    (db as unknown as { prepare: typeof orig }).prepare = (sql: string) => {
      if (/from subscriptions where agency_id/i.test(sql)) {
        throw new Error('SqliteError: no such column: provider');
      }
      return orig(sql);
    };
    const res = await handleGetCurrentSubscription(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { planTier: string; isMock: boolean } };
    expect(body.data.planTier).toBe('free');
    expect(body.data.isMock).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. handleChangeSubscriptionPlan
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — POST /api/billing/subscription/change', () => {
  it('body invalide → 400 INVALID_INPUT', async () => {
    const { env } = makeEnv();
    const res = await handleChangeSubscriptionPlan(
      postReq('/api/billing/subscription/change', { planTier: 'bogus' }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('sans agence → 403 AGENCY_ONLY', async () => {
    const { env } = makeEnv();
    const res = await handleChangeSubscriptionPlan(
      postReq('/api/billing/subscription/change', { planTier: 'pro' }),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AGENCY_ONLY');
  });

  it('capability settings.manage manquante → 403', async () => {
    const { env } = makeEnv();
    const res = await handleChangeSubscriptionPlan(
      postReq('/api/billing/subscription/change', { planTier: 'pro' }),
      env,
      AUTH_AGENCY_VIEW_ONLY,
    );
    expect(res.status).toBe(403);
  });

  it('sans STRIPE_SECRET_KEY → mock + reason=stripe_not_configured', async () => {
    const { env, db } = makeEnv({
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'free',
        status: 'active',
        provider: 'mock',
        created_at: '2026-05-22 10:00:00',
      },
    });
    const res = await handleChangeSubscriptionPlan(
      postReq('/api/billing/subscription/change', { planTier: 'pro', billingPeriod: 'yearly' }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { success: boolean; mock: boolean; reason: string };
    };
    expect(body.data).toMatchObject({ success: true, mock: true, reason: 'stripe_not_configured' });

    // UPDATE subscriptions émis
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /plan_name = \?/i.test(c.sql),
    );
    expect(update).toBeTruthy();
    expect(update!.args).toEqual(['pro', 'yearly', 'agency-1']);

    // INSERT billing_events émis avec is_mock=1
    const evt = db.calls.find((c) => /insert into billing_events/i.test(c.sql));
    expect(evt).toBeTruthy();

    // Audit émis
    const audit = db.calls.find((c) => /insert into audit_log/i.test(c.sql));
    expect(audit).toBeTruthy();
  });

  it('avec STRIPE_SECRET_KEY mais tenant non activé → mock + reason=tenant_not_activated', async () => {
    // Sprint 31 : `isLiveBranchEnabled` détecte sk_test_/sk_live_, mais sans
    // `payment_provider_config.payments_live_enabled=1` pour le tenant, le
    // handler retombe sur le path mock avec reason='tenant_not_activated'
    // (cf. saas-billing.ts:532).
    const { env } = makeEnv({
      stripeKey: 'sk_test_xxx',
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'free',
        status: 'active',
        provider: 'mock',
        created_at: '2026-05-22 10:00:00',
      },
    });
    const res = await handleChangeSubscriptionPlan(
      postReq('/api/billing/subscription/change', { planTier: 'pro' }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { reason: string; mock: boolean } };
    expect(body.data.mock).toBe(true);
    expect(body.data.reason).toBe('tenant_not_activated');
  });

  it('tier inconnu en base → 400 PLAN_UNKNOWN', async () => {
    // On force `loadPlanByTier` à retourner null mais le probe `SELECT 1
    // FROM billing_plans LIMIT 1` doit réussir (table existe). Le mock D1
    // résout par 1er-match → on seed `from billing_plans where tier` à [] mais
    // `from billing_plans` (général) garde les 4 plans.
    const db = createMockD1();
    db.seed('from users where id', [{ client_id: 'client-1' }]);
    db.seed('modules_json from clients', [{ modules_json: '["crm"]' }]);
    db.seed('select id from clients where agency_id', [{ id: 'client-1' }]);
    // Ordre des seeds : le plus spécifique D'ABORD (1er-match) — donc
    // `from billing_plans where tier` AVANT `from billing_plans`.
    db.seed('from billing_plans where tier', []);
    db.seed('from billing_plans', defaultPlans());
    const env = { DB: db } as unknown as Env;
    const res = await handleChangeSubscriptionPlan(
      postReq('/api/billing/subscription/change', { planTier: 'pro' }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('PLAN_UNKNOWN');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. handleCancelSubscription
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — POST /api/billing/subscription/cancel', () => {
  it('body invalide → 400 INVALID_INPUT', async () => {
    const { env } = makeEnv();
    const res = await handleCancelSubscription(
      postReq('/api/billing/subscription/cancel', { atPeriodEnd: 'not-a-bool' }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(400);
  });

  it('sans subscription → 404 SUBSCRIPTION_NOT_FOUND', async () => {
    const { env } = makeEnv();
    const res = await handleCancelSubscription(
      postReq('/api/billing/subscription/cancel', { atPeriodEnd: true }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('cancel à la fin de période → UPDATE cancel_at_period_end=1 + billing_event', async () => {
    const { env, db } = makeEnv({
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'pro',
        status: 'active',
        provider: 'mock',
        cancel_at_period_end: 0,
        created_at: '2026-05-22 10:00:00',
      },
    });
    const res = await handleCancelSubscription(
      postReq('/api/billing/subscription/cancel', { reason: 'too expensive', atPeriodEnd: true }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(200);
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /cancel_at_period_end = 1/i.test(c.sql),
    );
    expect(update).toBeTruthy();
    const evt = db.calls.find(
      (c) => /insert into billing_events/i.test(c.sql),
    );
    expect(evt).toBeTruthy();
  });

  it('idempotent : déjà cancel_at_period_end=1 → no-op', async () => {
    const { env, db } = makeEnv({
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'pro',
        status: 'active',
        provider: 'mock',
        cancel_at_period_end: 1,
        created_at: '2026-05-22 10:00:00',
      },
    });
    const res = await handleCancelSubscription(
      postReq('/api/billing/subscription/cancel', { atPeriodEnd: true }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { idempotent?: boolean } };
    expect(body.data.idempotent).toBe(true);
    // Pas d'UPDATE
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /cancel_at_period_end = 1/i.test(c.sql),
    );
    expect(update).toBeFalsy();
  });

  it('atPeriodEnd=false → status=canceled immédiat', async () => {
    const { env, db } = makeEnv({
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'pro',
        status: 'active',
        provider: 'mock',
        cancel_at_period_end: 0,
        created_at: '2026-05-22 10:00:00',
      },
    });
    await handleCancelSubscription(
      postReq('/api/billing/subscription/cancel', { atPeriodEnd: false }),
      env,
      AUTH_AGENCY_FULL,
    );
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /status = 'canceled'/i.test(c.sql),
    );
    expect(update).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. handleResumeSubscription
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — POST /api/billing/subscription/resume', () => {
  it('sans subscription → 404 SUBSCRIPTION_NOT_FOUND', async () => {
    const { env } = makeEnv();
    const res = await handleResumeSubscription(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(404);
  });

  it('subscription cancel_at_period_end=1 → reverse + billing_event', async () => {
    const { env, db } = makeEnv({
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'pro',
        status: 'active',
        provider: 'mock',
        cancel_at_period_end: 1,
        created_at: '2026-05-22 10:00:00',
      },
    });
    const res = await handleResumeSubscription(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /cancel_at_period_end = 0/i.test(c.sql),
    );
    expect(update).toBeTruthy();
  });

  it('idempotent : déjà active non-cancel → no-op', async () => {
    const { env, db } = makeEnv({
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'pro',
        status: 'active',
        provider: 'mock',
        cancel_at_period_end: 0,
        created_at: '2026-05-22 10:00:00',
      },
    });
    const res = await handleResumeSubscription(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { idempotent?: boolean } };
    expect(body.data.idempotent).toBe(true);
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /cancel_at_period_end = 0/i.test(c.sql),
    );
    expect(update).toBeFalsy();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. handleCreatePortalSession
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — POST /api/billing/portal-session', () => {
  it('body invalide (returnUrl non-URL) → 400', async () => {
    const { env } = makeEnv();
    const res = await handleCreatePortalSession(
      postReq('/api/billing/portal-session', { returnUrl: 'not-a-url' }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(400);
  });

  it('sans agence → 403 AGENCY_ONLY', async () => {
    const { env } = makeEnv();
    const res = await handleCreatePortalSession(
      postReq('/api/billing/portal-session', {}),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(403);
  });

  it('agence + capability → URL mock unique + expiresAt + isMock=true', async () => {
    const { env } = makeEnv();
    const res = await handleCreatePortalSession(
      postReq('/api/billing/portal-session', {}),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { url: string; expiresAt: string; isMock: boolean };
    };
    expect(body.data.isMock).toBe(true);
    expect(body.data.url).toMatch(/billing\.intralys\.local\/portal\/agency-1\?token=/);
    expect(typeof body.data.expiresAt).toBe('string');
    // expiresAt ~ +1h
    const delta = new Date(body.data.expiresAt).getTime() - Date.now();
    expect(delta).toBeGreaterThan(3500_000);
    expect(delta).toBeLessThanOrEqual(3700_000);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. handleGetBillingUsage
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — GET /api/billing/usage', () => {
  it('agence + plan starter → counts + limits', async () => {
    // Mock D1 = 1er-match wins par substring. `loadPlanByTier('starter')`
    // exécute `SELECT * FROM billing_plans WHERE tier = ?`. Pour que la ligne
    // starter sorte (pas free en tête de defaultPlans), on passe `plans` avec
    // SEULEMENT le plan starter.
    const { env } = makeEnv({
      plans: [defaultPlans().find((p) => p.tier === 'starter')!],
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'starter',
        status: 'active',
        provider: 'mock',
        created_at: '2026-05-22 10:00:00',
      },
      counts: { sub_accounts: 1, leads: 42, users: 3 },
    });
    const res = await handleGetBillingUsage(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        subAccounts: { current: number; limit: number | null };
        leads: { current: number; limit: number | null };
        users: { current: number; limit: number | null };
      };
    };
    expect(body.data.subAccounts.current).toBe(1);
    expect(body.data.subAccounts.limit).toBe(5);
    expect(body.data.leads).toEqual({ current: 42, limit: 2500 });
    expect(body.data.users).toEqual({ current: 3, limit: 10 });
  });

  it('plan unlimited → limit=null', async () => {
    // Idem starter : on isole le plan unlimited via `plans` pour que le mock
    // D1 (1er-match wins par substring) retourne la bonne ligne.
    const { env } = makeEnv({
      plans: [defaultPlans().find((p) => p.tier === 'unlimited')!],
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'unlimited',
        status: 'active',
        provider: 'mock',
        created_at: '2026-05-22 10:00:00',
      },
    });
    const res = await handleGetBillingUsage(env, AUTH_AGENCY_FULL);
    const body = (await res.json()) as {
      data: { subAccounts: { limit: number | null } };
    };
    expect(body.data.subAccounts.limit).toBe(null);
  });

  it('sans agence (legacy) → fallback usage 0/null', async () => {
    const { env } = makeEnv();
    const res = await handleGetBillingUsage(env, AUTH_LEGACY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { subAccounts: { current: number } } };
    expect(body.data.subAccounts.current).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. handleListBillingInvoices
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — GET /api/billing/invoices', () => {
  it('vide initial', async () => {
    const { env } = makeEnv();
    const res = await handleListBillingInvoices(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('liste mappée', async () => {
    const { env } = makeEnv({
      invoices: [
        {
          id: 'inv-1',
          number: 'INV-001',
          amount_due_cents: 14900,
          amount_paid_cents: 14900,
          currency: 'CAD',
          status: 'paid',
          period_start: '2026-05-01',
          period_end: '2026-05-31',
          hosted_invoice_url: null,
          pdf_url: null,
          is_mock: 1,
          created_at: '2026-05-22 10:00:00',
        },
      ],
    });
    const res = await handleListBillingInvoices(env, AUTH_AGENCY_FULL);
    const body = (await res.json()) as {
      data: Array<{ id: string; status: string; amountDueCents: number }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('inv-1');
    expect(body.data[0].status).toBe('paid');
    expect(body.data[0].amountDueCents).toBe(14900);
  });

  it('seq120 absente → tableau vide', async () => {
    const { env, db } = makeEnv();
    const orig = db.prepare.bind(db);
    (db as unknown as { prepare: typeof orig }).prepare = (sql: string) => {
      if (/from billing_invoices_mock/i.test(sql)) {
        throw new Error('SqliteError: no such table: billing_invoices_mock');
      }
      return orig(sql);
    };
    const res = await handleListBillingInvoices(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 9. handleGetWebhookConfig
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — GET /api/billing/webhook-config', () => {
  it('sans clé → modeMock=true', async () => {
    const { env } = makeEnv();
    const res = await handleGetWebhookConfig(env, AUTH_AGENCY_FULL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        modeMock: boolean;
        stripeKeyConfigured: boolean;
        signingSecretConfigured: boolean;
        supportedEvents: string[];
      };
    };
    expect(body.data.modeMock).toBe(true);
    expect(body.data.stripeKeyConfigured).toBe(false);
    expect(body.data.signingSecretConfigured).toBe(false);
    expect(body.data.supportedEvents.length).toBe(8);
  });

  it('avec clé + secret → modeMock=false', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx', webhookSecret: 'whsec_xxx' });
    const res = await handleGetWebhookConfig(env, AUTH_AGENCY_FULL);
    const body = (await res.json()) as {
      data: { modeMock: boolean; stripeKeyConfigured: boolean; signingSecretConfigured: boolean };
    };
    expect(body.data.modeMock).toBe(false);
    expect(body.data.stripeKeyConfigured).toBe(true);
    expect(body.data.signingSecretConfigured).toBe(true);
  });

  it('capability settings.manage manquante → 403', async () => {
    const { env } = makeEnv();
    const res = await handleGetWebhookConfig(env, AUTH_AGENCY_VIEW_ONLY);
    expect(res.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 10. Cross-tenant isolation (regression guard)
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — Cross-tenant isolation', () => {
  it('handleGetCurrentSubscription borne SQL par agency_id', async () => {
    const { env, db } = makeEnv({
      subscription: {
        id: 'sub-X',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'pro',
        status: 'active',
        provider: 'mock',
        created_at: '2026-05-22 10:00:00',
      },
    });
    await handleGetCurrentSubscription(env, AUTH_AGENCY_FULL);
    const sel = db.calls.find(
      (c) => /from subscriptions where agency_id/i.test(c.sql),
    );
    expect(sel).toBeTruthy();
    expect(sel!.args[0]).toBe('agency-1');
  });

  it('handleListBillingInvoices borne SQL par agency_id', async () => {
    const { env, db } = makeEnv({
      invoices: [{ id: 'inv-1', status: 'paid', is_mock: 1 }],
    });
    await handleListBillingInvoices(env, AUTH_AGENCY_FULL);
    const sel = db.calls.find((c) => /from billing_invoices_mock where agency_id/i.test(c.sql));
    expect(sel).toBeTruthy();
    expect(sel!.args[0]).toBe('agency-1');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 11. Sprint 31 (Agent A4) — Live path extensions
// ──────────────────────────────────────────────────────────────────────────
//
// Tests AJOUTÉS au-dessus des tests Sprint 22 (préservés byte-identiques).
//
// Contrat actuel (V1, sans Manager-B live wiring) : avec STRIPE_SECRET_KEY
// bindée + tenant flag actif, le handler retourne TOUJOURS mock+reason=
// 'live_branch_locked' (cf. saas-billing.ts:519 — V1 verrou Sprint 22).
//
// Quand Manager-B branchera la voie live (Sprint 31 wiring), `reason` deviendra
// absent (success live) ET stripeFetch sera appelé. Les tests `.todo` ci-dessous
// documentent ce contrat futur sans casser le sprint actuel.

describe('S31 — handleChangeSubscriptionPlan (live gate sans tenant flag)', () => {
  // ── NOTE Sprint 31 ────────────────────────────────────────────────────────
  // Le verrou V1 "live_branch_locked" a été retiré : la branche live est
  // wirée. Le gate effectif est désormais le double check
  // `isLiveBranchEnabled(env)` + `isTenantLiveEnabled(env, agencyId)`.
  // Tant que `payment_provider_config.payments_live_enabled=1` n'est PAS
  // seedé, le handler retombe sur le path mock avec reason='tenant_not_activated'
  // (cf. saas-billing.ts:528-534). Les 2 tests ci-dessous valident ce path
  // pour sk_test_ et sk_live_.

  it('STRIPE_SECRET_KEY=sk_test_ sans tenant flag → mock+tenant_not_activated', async () => {
    const { env, db } = makeEnv({
      stripeKey: 'sk_test_abc',
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'free',
        status: 'active',
        provider: 'mock',
        created_at: '2026-05-22 10:00:00',
      },
    });

    const res = await handleChangeSubscriptionPlan(
      postReq('/api/billing/subscription/change', { planTier: 'pro', billingPeriod: 'monthly' }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { mock: boolean; reason: string } };
    expect(body.data.mock).toBe(true);
    expect(body.data.reason).toBe('tenant_not_activated');

    // UPDATE D1 émis (cohérence UX — provider reste 'mock')
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /plan_name = \?/i.test(c.sql),
    );
    expect(update).toBeTruthy();
    expect(update!.args).toEqual(['pro', 'monthly', 'agency-1']);

    // billing_events INSERT émis avec is_mock=1
    const evt = db.calls.find((c) => /insert into billing_events/i.test(c.sql));
    expect(evt).toBeTruthy();
  });

  it('STRIPE_SECRET_KEY=sk_live_ sans tenant flag → mock+tenant_not_activated', async () => {
    const { env } = makeEnv({
      stripeKey: 'sk_live_real',
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'free',
        status: 'active',
        provider: 'mock',
        created_at: '2026-05-22 10:00:00',
      },
    });

    const res = await handleChangeSubscriptionPlan(
      postReq('/api/billing/subscription/change', { planTier: 'pro' }),
      env,
      AUTH_AGENCY_FULL,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { reason: string } };
    expect(body.data.reason).toBe('tenant_not_activated');
  });

  // ──────────────────────────────────────────────────────────────────────
  // CONTRAT FUTUR (.todo) — Manager-B branche la voie live Sprint 31
  // ──────────────────────────────────────────────────────────────────────
  // Quand Manager-B aura wired la voie live dans handleChangeSubscriptionPlan
  // (call stripeFetch + UPDATE stripe_subscription_id réel), retirer le `.todo`
  // et activer ces tests. Tests préservés byte-identiques en attendant.

  it.todo('LIVE wired: sk_test_ + tenant flag → appel stripeFetch (mock spy) + UPDATE stripe_subscription_id réel');
  it.todo('LIVE wired: tenant flag absent → fallback mock même si sk_live_');
  it.todo('LIVE wired: stripeFetch throw → erreur propagée + rollback subscription D1');
});

describe('S31 — Sprint 22 mock path preservation (regression guard)', () => {
  it('SANS STRIPE_SECRET_KEY → reason=stripe_not_configured (mock path Sprint 22 intact)', async () => {
    const { env } = makeEnv({
      subscription: {
        id: 'sub-1',
        agency_id: 'agency-1',
        client_id: 'client-1',
        plan_name: 'free',
        status: 'active',
        provider: 'mock',
        created_at: '2026-05-22 10:00:00',
      },
    });
    const res = await handleChangeSubscriptionPlan(
      postReq('/api/billing/subscription/change', { planTier: 'pro' }),
      env,
      AUTH_AGENCY_FULL,
    );
    const body = (await res.json()) as { data: { reason: string; mock: boolean } };
    expect(body.data.mock).toBe(true);
    expect(body.data.reason).toBe('stripe_not_configured');
  });
});
