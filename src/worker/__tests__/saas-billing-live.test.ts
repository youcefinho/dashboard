// ── saas-billing-live.test.ts — Sprint 31 Agent A4 ──────────────────────────
//
// Couvre les helpers/branches "live Stripe" du module lib/saas-billing-live.ts
// (owned by Agent A1, parallel sprint). Toutes les calls Stripe HTTP sont
// mockées via vi.spyOn(globalThis, 'fetch'). Aucune call réseau réelle.
//
// Contrats vérifiés :
//   1. isLiveBranchEnabled — true si STRIPE_SECRET_KEY commence par sk_live_ ou sk_test_.
//   2. isTenantLiveEnabled — SELECT payment_provider_config.payments_live_enabled=1
//      AND provider='stripe' (calque A1 §A1.2).
//   3. stripeFetch — POST x-www-form-urlencoded + Idempotency-Key header
//      + Authorization Bearer (toujours POST — calque A1 §A1.3).
//   4. createStripeSubscription — POST /v1/subscriptions avec items[0][price].
//   5. cancelStripeSubscription atPeriodEnd=true → POST /v1/subscriptions/sub_X
//      avec cancel_at_period_end=true.
//   6. findOrCreateStripeCustomer — search par metadata['agency_id']+email
//      (GET /v1/customers/search) puis création si pas trouvé.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import {
  isLiveBranchEnabled,
  isTenantLiveEnabled,
  stripeFetch,
  createStripeSubscription,
  cancelStripeSubscription,
  findOrCreateStripeCustomer,
  StripeSaasError,
} from '../lib/saas-billing-live';

function makeEnv(opts?: { stripeKey?: string }) {
  const db = createMockD1();
  return {
    env: {
      DB: db,
      STRIPE_SECRET_KEY: opts?.stripeKey,
    } as unknown as Env,
    db,
  };
}

/** Stub global.fetch with a JSON response. Returns the spy for assertions. */
function stubFetchJson(payload: unknown, status = 200) {
  const res = new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
}

/** Helper to read a header (case-insensitive) from RequestInit. */
function getHeader(init: RequestInit | undefined, name: string): string | null {
  const h = init?.headers;
  if (!h) return null;
  if (h instanceof Headers) return h.get(name);
  const lk = name.toLowerCase();
  for (const [k, v] of Object.entries(h as Record<string, string>)) {
    if (k.toLowerCase() === lk) return String(v);
  }
  return null;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
// 1. isLiveBranchEnabled
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — isLiveBranchEnabled', () => {
  it('true si STRIPE_SECRET_KEY commence par sk_live_', () => {
    const { env } = makeEnv({ stripeKey: 'sk_live_abc123' });
    expect(isLiveBranchEnabled(env)).toBe(true);
  });

  it('true si STRIPE_SECRET_KEY commence par sk_test_', () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_abc123' });
    expect(isLiveBranchEnabled(env)).toBe(true);
  });

  it('false si STRIPE_SECRET_KEY absent', () => {
    const { env } = makeEnv();
    expect(isLiveBranchEnabled(env)).toBe(false);
  });

  it('false si STRIPE_SECRET_KEY mal-formée (pas de préfixe sk_)', () => {
    const { env } = makeEnv({ stripeKey: 'not-a-key' });
    expect(isLiveBranchEnabled(env)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. isTenantLiveEnabled
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — isTenantLiveEnabled', () => {
  it('true si row payments_live_enabled=1 AND provider=stripe', async () => {
    const { env, db } = makeEnv({ stripeKey: 'sk_test_xxx' });
    db.seed('from payment_provider_config', [{ payments_live_enabled: 1 }]);
    const r = await isTenantLiveEnabled(env, 'agency-1');
    expect(r).toBe(true);
    // Le bind doit contenir l'agencyId (cross-tenant safety)
    const sel = db.calls.find((c) => /from payment_provider_config/i.test(c.sql));
    expect(sel).toBeTruthy();
    expect(sel!.args[0]).toBe('agency-1');
  });

  it('false si row payments_live_enabled=0', async () => {
    const { env, db } = makeEnv({ stripeKey: 'sk_test_xxx' });
    db.seed('from payment_provider_config', [{ payments_live_enabled: 0 }]);
    const r = await isTenantLiveEnabled(env, 'agency-1');
    expect(r).toBe(false);
  });

  it('false si pas de row', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const r = await isTenantLiveEnabled(env, 'agency-1');
    expect(r).toBe(false);
  });

  it('false si agencyId vide (guard)', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const r = await isTenantLiveEnabled(env, '');
    expect(r).toBe(false);
  });

  it('false best-effort si table absente (catch silencieux)', async () => {
    const { env, db } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const orig = db.prepare.bind(db);
    (db as unknown as { prepare: typeof orig }).prepare = (sql: string) => {
      if (/from payment_provider_config/i.test(sql)) {
        throw new Error('SqliteError: no such table: payment_provider_config');
      }
      return orig(sql);
    };
    const r = await isTenantLiveEnabled(env, 'agency-1');
    expect(r).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. stripeFetch (toujours POST x-www-form-urlencoded — calque A1 §A1.3)
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — stripeFetch', () => {
  it('POST avec body url-encoded + Idempotency-Key header + Bearer auth', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const spy = stubFetchJson({ id: 'cus_xyz', object: 'customer' });
    const out = await stripeFetch(
      env,
      '/customers',
      { email: 'a@b.c', 'metadata[agency_id]': 'agency-1' },
      { idempotencyKey: 'idem-key-1' },
    );
    expect(out).toMatchObject({ id: 'cus_xyz' });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/v1/customers');
    expect(init?.method).toBe('POST');
    expect(getHeader(init, 'Authorization')).toMatch(/Bearer sk_test_xxx/);
    expect(getHeader(init, 'Idempotency-Key')).toBe('idem-key-1');
    expect(getHeader(init, 'Content-Type')).toMatch(/application\/x-www-form-urlencoded/);
    const body = String(init?.body ?? '');
    expect(body).toMatch(/email=a%40b\.c/);
    expect(body).toMatch(/metadata%5Bagency_id%5D=agency-1/);
  });

  it('sans STRIPE_SECRET_KEY → throw StripeSaasError(503, no_secret)', async () => {
    const { env } = makeEnv();
    await expect(stripeFetch(env, '/customers', {})).rejects.toMatchObject({
      name: 'StripeSaasError',
      statusCode: 503,
      code: 'no_secret',
    });
  });

  it('HTTP non-2xx → throw StripeSaasError avec code Stripe', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    stubFetchJson({ error: { message: 'Invalid card', code: 'card_declined' } }, 402);
    let caught: unknown = null;
    try {
      await stripeFetch(env, '/customers', {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StripeSaasError);
    expect((caught as StripeSaasError).statusCode).toBe(402);
    expect((caught as StripeSaasError).code).toBe('card_declined');
  });

  it('Stripe-Account header posé si opts.stripeAccount', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const spy = stubFetchJson({ id: 'acct_xyz' });
    await stripeFetch(env, '/accounts', {}, { stripeAccount: 'acct_xyz' });
    const [, init] = spy.mock.calls[0];
    expect(getHeader(init, 'Stripe-Account')).toBe('acct_xyz');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. createStripeSubscription
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — createStripeSubscription', () => {
  it('POST /v1/subscriptions avec customer + items[0][price]', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const spy = stubFetchJson({
      id: 'sub_xyz',
      object: 'subscription',
      status: 'active',
    });
    const out = await createStripeSubscription(env, 'cus_xyz', 'price_xyz', 'idem-sub-1');
    expect(out).toMatchObject({ id: 'sub_xyz' });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/v1/subscriptions');
    expect(init?.method).toBe('POST');
    expect(getHeader(init, 'Idempotency-Key')).toBe('idem-sub-1');
    const body = String(init?.body ?? '');
    expect(body).toMatch(/customer=cus_xyz/);
    expect(body).toMatch(/items%5B0%5D%5Bprice%5D=price_xyz/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. cancelStripeSubscription
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — cancelStripeSubscription', () => {
  it('atPeriodEnd=true → POST /v1/subscriptions/sub_X cancel_at_period_end=true', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const spy = stubFetchJson({
      id: 'sub_xyz',
      cancel_at_period_end: true,
      status: 'active',
    });
    await cancelStripeSubscription(env, 'sub_xyz', true, 'idem-cancel-1');
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/v1/subscriptions/sub_xyz');
    expect(init?.method).toBe('POST');
    const body = String(init?.body ?? '');
    expect(body).toMatch(/cancel_at_period_end=true/);
    // Endpoint sans /cancel suffix
    expect(String(url)).not.toContain('/cancel');
  });

  it('atPeriodEnd=false → POST /v1/subscriptions/sub_X/cancel (endpoint dédié)', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const spy = stubFetchJson({ id: 'sub_xyz', status: 'canceled' });
    await cancelStripeSubscription(env, 'sub_xyz', false, 'idem-cancel-2');
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/v1/subscriptions/sub_xyz/cancel');
    expect(init?.method).toBe('POST');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. findOrCreateStripeCustomer
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — findOrCreateStripeCustomer', () => {
  it('cherche par metadata[agency_id]+email → trouve existant (1 call)', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const spy = stubFetchJson({
      object: 'search_result',
      data: [{ id: 'cus_existing', object: 'customer' }],
    });
    const out = await findOrCreateStripeCustomer(env, 'agency-1', 'a@b.c');
    expect(out).toBe('cus_existing');
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    // GET search avec query Stripe Search
    expect(String(url)).toContain('/v1/customers/search');
    expect(init?.method).toBe('GET');
    expect(decodeURIComponent(String(url))).toMatch(/metadata\['agency_id'\]:"agency-1"/);
    expect(decodeURIComponent(String(url))).toMatch(/email:"a@b\.c"/);
  });

  it('pas trouvé → POST /v1/customers (2 calls total : search + create)', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ object: 'search_result', data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'cus_new', object: 'customer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const out = await findOrCreateStripeCustomer(env, 'agency-1', 'a@b.c');
    expect(out).toBe('cus_new');
    expect(spy).toHaveBeenCalledTimes(2);
    // 2ème appel = POST /customers
    const [url2, init2] = spy.mock.calls[1];
    expect(String(url2)).toContain('/v1/customers');
    expect(String(url2)).not.toContain('/search');
    expect(init2?.method).toBe('POST');
    expect(getHeader(init2, 'Idempotency-Key')).toBe('saas_cust_agency-1');
    const body = String(init2?.body ?? '');
    expect(body).toMatch(/metadata%5Bagency_id%5D=agency-1/);
    expect(body).toMatch(/email=a%40b\.c/);
  });

  it('agencyId vide → throw StripeSaasError(422)', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    await expect(findOrCreateStripeCustomer(env, '', 'a@b.c')).rejects.toMatchObject({
      statusCode: 422,
      code: 'agency_id_required',
    });
  });

  it('email vide → throw StripeSaasError(422)', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    await expect(findOrCreateStripeCustomer(env, 'agency-1', '')).rejects.toMatchObject({
      statusCode: 422,
      code: 'email_required',
    });
  });
});
