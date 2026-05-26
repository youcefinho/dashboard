// ── saas-billing-webhook.test.ts — Sprint 22 (Manager-B) ────────────────────
//
// Couvre :
//   1. Signature HMAC v1 (verifyStripeWebhookSignatureSaas)
//      - no_secret / no_signature_header / timestamp_drift / invalid_signature / verified
//   2. Dispatcher SaaS (dispatchStripeSaasEvent)
//      - customer.subscription.created/updated/deleted/trial_will_end
//      - invoice.payment_failed / invoice.finalized / invoice.paid
//      - checkout.session.completed → handled=false (laisse legacy s'exécuter)
//      - event-type inconnu → log only, no-op
//   3. Webhook end-to-end via handleStripeWebhook (billing.ts) — extension
//      chirurgicale dispatcher SaaS + bloc legacy byte-identique préservé.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { verifyStripeWebhookSignatureSaas } from '../lib/saas-billing-mock';
import {
  dispatchStripeSaasEvent,
  applyStripeSubscriptionUpsert,
  applyStripeSubscriptionDeleted,
  applyStripeTrialWillEnd,
  applyStripeInvoicePaymentFailed,
  applyStripeInvoiceUpsert,
} from '../saas-billing';
import { handleStripeWebhook } from '../billing';

function makeEnv(opts?: { stripeKey?: string; webhookSecret?: string }) {
  const db = createMockD1();
  return {
    env: {
      DB: db,
      STRIPE_SECRET_KEY: opts?.stripeKey,
      STRIPE_WEBHOOK_SECRET: opts?.webhookSecret,
    } as unknown as Env,
    db,
  };
}

// HMAC SHA-256 hex util pour signer un payload comme Stripe le ferait.
async function signStripe(secret: string, body: string, ts: number): Promise<string> {
  const payload = `${ts}.${body}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${ts},v1=${hex}`;
}

// ──────────────────────────────────────────────────────────────────────────
// 1. verifyStripeWebhookSignatureSaas
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — verifyStripeWebhookSignatureSaas', () => {
  it('sans STRIPE_WEBHOOK_SECRET → mock:true reason=no_secret', async () => {
    const { env } = makeEnv();
    const r = await verifyStripeWebhookSignatureSaas(env, '{}', 't=1,v1=abc');
    expect(r).toEqual({ verified: false, mock: true, reason: 'no_secret' });
  });

  it('secret bindé mais pas de header → reason=no_signature_header', async () => {
    const { env } = makeEnv({ webhookSecret: 'whsec_xxx' });
    const r = await verifyStripeWebhookSignatureSaas(env, '{}', null);
    expect(r).toEqual({ verified: false, mock: false, reason: 'no_signature_header' });
  });

  it('signature mal-formée (pas de v1=) → invalid_signature', async () => {
    const { env } = makeEnv({ webhookSecret: 'whsec_xxx' });
    const r = await verifyStripeWebhookSignatureSaas(env, '{}', 't=123');
    expect(r.verified).toBe(false);
    expect(r.reason).toBe('invalid_signature');
  });

  it('drift > 300s → timestamp_drift', async () => {
    const { env } = makeEnv({ webhookSecret: 'whsec_xxx' });
    const body = '{}';
    const oldTs = Math.floor(Date.now() / 1000) - 1000;
    const header = await signStripe('whsec_xxx', body, oldTs);
    const r = await verifyStripeWebhookSignatureSaas(env, body, header);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe('timestamp_drift');
  });

  it('signature valide → verified:true', async () => {
    const { env } = makeEnv({ webhookSecret: 'whsec_xxx' });
    const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.created' });
    const ts = Math.floor(Date.now() / 1000);
    const header = await signStripe('whsec_xxx', body, ts);
    const r = await verifyStripeWebhookSignatureSaas(env, body, header);
    expect(r).toEqual({ verified: true, mock: false });
  });

  it('signature invalide (mauvais secret) → invalid_signature', async () => {
    const { env } = makeEnv({ webhookSecret: 'whsec_xxx' });
    const body = '{}';
    const ts = Math.floor(Date.now() / 1000);
    const header = await signStripe('whsec_DIFFERENT', body, ts);
    const r = await verifyStripeWebhookSignatureSaas(env, body, header);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe('invalid_signature');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Dispatcher SaaS — per event type
// ──────────────────────────────────────────────────────────────────────────

describe('S22 — dispatchStripeSaasEvent (per event)', () => {
  it('customer.subscription.created → upsert + INSERT billing_events', async () => {
    const { env, db } = makeEnv({ webhookSecret: 'whsec_xxx' });
    db.seed('from subscriptions where stripe_subscription_id', [
      { id: 'sub-row', agency_id: 'agency-1' },
    ]);
    await applyStripeSubscriptionUpsert(
      env,
      {
        id: 'evt_1',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_xyz',
            customer: 'cus_xyz',
            status: 'active',
            cancel_at_period_end: false,
            current_period_start: 1716370000,
            current_period_end: 1718962000,
            items: { data: [{ price: { id: 'price_xyz', lookup_key: 'pro' } }] },
          },
        },
      },
      true,
    );
    const update = db.calls.find(
      (c) =>
        /update subscriptions/i.test(c.sql) &&
        /plan_name = \?/i.test(c.sql) &&
        /provider = 'stripe'/i.test(c.sql),
    );
    expect(update).toBeTruthy();
    const evt = db.calls.find((c) => /insert into billing_events/i.test(c.sql));
    expect(evt).toBeTruthy();
  });

  it('customer.subscription.updated → status + period UPDATE', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions where stripe_subscription_id', [
      { id: 'sub-row', agency_id: 'agency-1' },
    ]);
    await applyStripeSubscriptionUpsert(
      env,
      {
        id: 'evt_2',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_xyz',
            customer: 'cus_xyz',
            status: 'past_due',
            cancel_at_period_end: true,
          },
        },
      },
      true,
    );
    const update = db.calls.find((c) => /update subscriptions/i.test(c.sql));
    expect(update).toBeTruthy();
  });

  it('customer.subscription.deleted → status=canceled', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions where stripe_subscription_id', [
      { id: 'sub-row', agency_id: 'agency-1' },
    ]);
    await applyStripeSubscriptionDeleted(
      env,
      {
        id: 'evt_3',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_xyz', customer: 'cus_xyz' } },
      },
      true,
    );
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /status = 'canceled'/i.test(c.sql),
    );
    expect(update).toBeTruthy();
  });

  it('customer.subscription.trial_will_end → metadata_json UPDATE', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions where stripe_subscription_id', [
      { id: 'sub-row', agency_id: 'agency-1' },
    ]);
    await applyStripeTrialWillEnd(
      env,
      {
        id: 'evt_4',
        type: 'customer.subscription.trial_will_end',
        data: { object: { id: 'sub_xyz', customer: 'cus_xyz' } },
      },
      true,
    );
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /metadata_json = \?/i.test(c.sql),
    );
    expect(update).toBeTruthy();
  });

  it('invoice.payment_failed → status=past_due', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions where stripe_subscription_id', [
      { id: 'sub-row', agency_id: 'agency-1' },
    ]);
    await applyStripeInvoicePaymentFailed(
      env,
      {
        id: 'evt_5',
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_xyz', subscription: 'sub_xyz' } },
      },
      true,
    );
    const update = db.calls.find(
      (c) => /update subscriptions/i.test(c.sql) && /status = 'past_due'/i.test(c.sql),
    );
    expect(update).toBeTruthy();
  });

  it('invoice.finalized → INSERT billing_invoices_mock', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions where stripe_subscription_id', [
      { id: 'sub-row', agency_id: 'agency-1' },
    ]);
    await applyStripeInvoiceUpsert(
      env,
      {
        id: 'evt_6',
        type: 'invoice.finalized',
        data: {
          object: {
            id: 'in_xyz',
            customer: 'cus_xyz',
            subscription: 'sub_xyz',
            amount_due: 14900,
            amount_paid: 0,
            currency: 'cad',
            status: 'open',
            number: 'INV-001',
          },
        },
      },
      true,
    );
    const ins = db.calls.find((c) => /insert into billing_invoices_mock/i.test(c.sql));
    expect(ins).toBeTruthy();
    expect(ins!.args.find((a: unknown) => a === 'in_xyz')).toBeTruthy();
  });

  it('invoice.paid → INSERT billing_invoices_mock (status=paid) en // du legacy', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions where stripe_subscription_id', [
      { id: 'sub-row', agency_id: 'agency-1' },
    ]);
    const result = await dispatchStripeSaasEvent(
      env,
      {
        id: 'evt_7',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_xyz',
            customer: 'cus_xyz',
            subscription: 'sub_xyz',
            amount_due: 14900,
            amount_paid: 14900,
            currency: 'cad',
          },
        },
      },
      true,
    );
    // handled=true (SaaS prend en charge en //), mais legacy reste libre
    expect(result.handled).toBe(true);
    const ins = db.calls.find((c) => /insert into billing_invoices_mock/i.test(c.sql));
    expect(ins).toBeTruthy();
  });

  it('checkout.session.completed → handled=false (laisse legacy gérer)', async () => {
    const { env } = makeEnv();
    const result = await dispatchStripeSaasEvent(
      env,
      {
        id: 'evt_8',
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: 'invoice-1' } },
      },
      false,
    );
    expect(result.handled).toBe(false);
  });

  it('event type inconnu → handled=false + log seul', async () => {
    const { env, db } = makeEnv();
    const result = await dispatchStripeSaasEvent(
      env,
      { id: 'evt_unknown', type: 'unknown.event', data: { object: {} } },
      false,
    );
    expect(result.handled).toBe(false);
    const evt = db.calls.find((c) => /insert into billing_events/i.test(c.sql));
    expect(evt).toBeTruthy();
  });

  it('sans secret → signature_verified=0 mais event persisté (mock mode)', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions where stripe_subscription_id', [
      { id: 'sub-row', agency_id: 'agency-1' },
    ]);
    await applyStripeSubscriptionUpsert(
      env,
      {
        id: 'evt_mock',
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_xyz', customer: 'cus_xyz', status: 'active' } },
      },
      false, // signatureVerified=false
    );
    const evt = db.calls.find((c) => /insert into billing_events/i.test(c.sql));
    expect(evt).toBeTruthy();
    // bind args : agency_id, subscription_id, provider, provider_event_id, event_type, sig, is_mock, payload, error
    // sig=0, is_mock=1
    const sigArg = evt!.args[5];
    const mockArg = evt!.args[6];
    expect(sigArg).toBe(0);
    expect(mockArg).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. handleStripeWebhook end-to-end
// ──────────────────────────────────────────────────────────────────────────

function webhookReq(body: string, sigHeader?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sigHeader) headers['stripe-signature'] = sigHeader;
  return new Request('http://x/api/webhook/stripe', {
    method: 'POST',
    body,
    headers,
  });
}

describe('S22 — handleStripeWebhook (billing.ts extension)', () => {
  it('sans STRIPE_WEBHOOK_SECRET → accepte payload sans signature, persiste mock', async () => {
    const { env, db } = makeEnv();
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_xyz', status: 'active' } },
    });
    const res = await handleStripeWebhook(webhookReq(body), env);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { received: boolean };
    expect(j.received).toBe(true);
    const evt = db.calls.find((c) => /insert into billing_events/i.test(c.sql));
    expect(evt).toBeTruthy();
  });

  it('avec STRIPE_WEBHOOK_SECRET + signature invalide → 400 WEBHOOK_SIGNATURE_INVALID, PAS persisté', async () => {
    const { env, db } = makeEnv({ webhookSecret: 'whsec_xxx' });
    const body = JSON.stringify({ id: 'evt_2', type: 'customer.subscription.created' });
    const ts = Math.floor(Date.now() / 1000);
    const badHeader = await signStripe('whsec_WRONG', body, ts);
    const res = await handleStripeWebhook(webhookReq(body, badHeader), env);
    expect(res.status).toBe(400);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    const evt = db.calls.find((c) => /insert into billing_events/i.test(c.sql));
    expect(evt).toBeFalsy();
  });

  it('avec secret + signature valide → 200 + signature_verified=1', async () => {
    const { env, db } = makeEnv({ webhookSecret: 'whsec_xxx' });
    db.seed('from subscriptions where stripe_subscription_id', [
      { id: 'sub-row', agency_id: 'agency-1' },
    ]);
    const body = JSON.stringify({
      id: 'evt_3',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_xyz', status: 'active' } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = await signStripe('whsec_xxx', body, ts);
    const res = await handleStripeWebhook(webhookReq(body, sig), env);
    expect(res.status).toBe(200);
    const evt = db.calls.find((c) => /insert into billing_events/i.test(c.sql));
    expect(evt).toBeTruthy();
    const sigArg = evt!.args[5];
    expect(sigArg).toBe(1); // verified
  });

  it('invoice.paid → bloc legacy UPDATE invoices.status préservé byte-identique', async () => {
    const { env, db } = makeEnv();
    const body = JSON.stringify({
      id: 'evt_paid',
      type: 'invoice.paid',
      data: { object: { id: 'in_xyz', client_reference_id: 'invoice-42' } },
    });
    const res = await handleStripeWebhook(webhookReq(body), env);
    expect(res.status).toBe(200);
    // Vérifier le legacy UPDATE invoices.status='paid' WHERE id=?
    const legacy = db.calls.find(
      (c) => /update invoices set status = 'paid'/i.test(c.sql),
    );
    expect(legacy).toBeTruthy();
    expect(legacy!.args[0]).toBe('invoice-42');
  });

  it('checkout.session.completed → bloc legacy UPDATE invoices préservé', async () => {
    const { env, db } = makeEnv();
    const body = JSON.stringify({
      id: 'evt_co',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'invoice-99' } },
    });
    const res = await handleStripeWebhook(webhookReq(body), env);
    expect(res.status).toBe(200);
    const legacy = db.calls.find(
      (c) => /update invoices set status = 'paid'/i.test(c.sql),
    );
    expect(legacy).toBeTruthy();
    expect(legacy!.args[0]).toBe('invoice-99');
  });

  it('JSON body invalide → 400 (catch global)', async () => {
    const { env } = makeEnv();
    const req = new Request('http://x/api/webhook/stripe', {
      method: 'POST',
      body: '{invalid-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await handleStripeWebhook(req, env);
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Sprint 31 (Agent A4) — extension webhook 3 events (Connect + PM)
// ──────────────────────────────────────────────────────────────────────────
//
// Tests AJOUTÉS au-dessus des tests Sprint 22 (préservés byte-identiques).
// Ces tests vérifient l'extension chirurgicale du dispatcher dans
// billing.ts:handleStripeWebhook (entre dispatchStripeSaasEvent et le bloc
// legacy). Aucun test Sprint 22 n'est modifié ni supprimé.

describe('S31 — handleStripeWebhook account.updated (Connect)', () => {
  it('UPDATE stripe_connect_accounts avec charges/payouts/details_submitted', async () => {
    const { env, db } = makeEnv();
    const body = JSON.stringify({
      id: 'evt_acct_1',
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_xyz',
          object: 'account',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          capabilities: { card_payments: 'active' },
          requirements: { currently_due: [], eventually_due: [], past_due: [] },
        },
      },
    });
    const res = await handleStripeWebhook(webhookReq(body), env);
    expect(res.status).toBe(200);

    const update = db.calls.find(
      (c) =>
        /update stripe_connect_accounts/i.test(c.sql) &&
        /charges_enabled = \?/i.test(c.sql) &&
        /payouts_enabled = \?/i.test(c.sql) &&
        /details_submitted = \?/i.test(c.sql) &&
        /where stripe_account_id = \?/i.test(c.sql),
    );
    expect(update).toBeTruthy();
    // bind order : charges, payouts, details, capabilities_json, requirements_json, completedAt, stripeAccountId
    expect(update!.args[0]).toBe(1);
    expect(update!.args[1]).toBe(1);
    expect(update!.args[2]).toBe(1);
    expect(update!.args[6]).toBe('acct_xyz');
  });

  it('details_submitted=false → onboarding_completed_at NOT set (COALESCE)', async () => {
    const { env, db } = makeEnv();
    const body = JSON.stringify({
      id: 'evt_acct_2',
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_xyz',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        },
      },
    });
    const res = await handleStripeWebhook(webhookReq(body), env);
    expect(res.status).toBe(200);
    const update = db.calls.find((c) => /update stripe_connect_accounts/i.test(c.sql));
    expect(update).toBeTruthy();
    // arg[5] = completedAt (null si details_submitted=false)
    expect(update!.args[5]).toBeNull();
  });

  it('audit log billing_events émis (account.updated)', async () => {
    const { env, db } = makeEnv();
    const body = JSON.stringify({
      id: 'evt_acct_3',
      type: 'account.updated',
      data: { object: { id: 'acct_xyz', details_submitted: false } },
    });
    await handleStripeWebhook(webhookReq(body), env);
    const evt = db.calls.find(
      (c) =>
        /insert into billing_events/i.test(c.sql) &&
        c.args.includes('account.updated'),
    );
    expect(evt).toBeTruthy();
  });
});

describe('S31 — handleStripeWebhook payment_method.attached', () => {
  it('INSERT payment_methods (brand, last4 only, jamais le PAN)', async () => {
    const { env, db } = makeEnv();
    // Lookup agency via metadata.agencyId direct sur le PM
    const body = JSON.stringify({
      id: 'evt_pm_1',
      type: 'payment_method.attached',
      data: {
        object: {
          id: 'pm_xyz',
          object: 'payment_method',
          customer: 'cus_xyz',
          type: 'card',
          metadata: { agencyId: 'agency-1' },
          card: {
            brand: 'visa',
            last4: '4242',
            exp_month: 12,
            exp_year: 2028,
          },
        },
      },
    });
    const res = await handleStripeWebhook(webhookReq(body), env);
    expect(res.status).toBe(200);

    const insert = db.calls.find((c) => /insert into payment_methods/i.test(c.sql));
    expect(insert).toBeTruthy();
    // bind order : agency_id, stripe_payment_method_id, stripe_customer_id, type, brand, last4, exp_month, exp_year
    expect(insert!.args[0]).toBe('agency-1');
    expect(insert!.args[1]).toBe('pm_xyz');
    expect(insert!.args[2]).toBe('cus_xyz');
    expect(insert!.args[3]).toBe('card');
    expect(insert!.args[4]).toBe('visa');
    expect(insert!.args[5]).toBe('4242');
    expect(insert!.args[6]).toBe(12);
    expect(insert!.args[7]).toBe(2028);
    // PAN ne doit JAMAIS apparaître nulle part
    const allArgs = JSON.stringify(insert!.args);
    expect(allArgs).not.toMatch(/\d{13,19}/); // pas de PAN
  });

  it('résolution agency via subscriptions.stripe_customer_id si pas metadata', async () => {
    const { env, db } = makeEnv();
    db.seed('select agency_id from subscriptions where stripe_customer_id', [
      { agency_id: 'agency-2' },
    ]);
    const body = JSON.stringify({
      id: 'evt_pm_2',
      type: 'payment_method.attached',
      data: {
        object: {
          id: 'pm_yyy',
          customer: 'cus_yyy',
          type: 'card',
          card: { brand: 'mastercard', last4: '5555', exp_month: 6, exp_year: 2027 },
        },
      },
    });
    const res = await handleStripeWebhook(webhookReq(body), env);
    expect(res.status).toBe(200);
    const insert = db.calls.find((c) => /insert into payment_methods/i.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert!.args[0]).toBe('agency-2');
  });

  it('pas de résolution agency → PAS d\'INSERT (best-effort skip)', async () => {
    const { env, db } = makeEnv();
    // pas de seed subscriptions → lookup retourne null
    const body = JSON.stringify({
      id: 'evt_pm_3',
      type: 'payment_method.attached',
      data: {
        object: {
          id: 'pm_zzz',
          customer: 'cus_zzz',
          type: 'card',
          card: { brand: 'amex', last4: '0005' },
        },
      },
    });
    const res = await handleStripeWebhook(webhookReq(body), env);
    expect(res.status).toBe(200);
    const insert = db.calls.find((c) => /insert into payment_methods/i.test(c.sql));
    expect(insert).toBeFalsy();
  });

  it('audit log billing_events émis avec payload trimmed (pas de PAN)', async () => {
    const { env, db } = makeEnv();
    const body = JSON.stringify({
      id: 'evt_pm_4',
      type: 'payment_method.attached',
      data: {
        object: {
          id: 'pm_aaa',
          customer: 'cus_aaa',
          type: 'card',
          metadata: { agencyId: 'agency-1' },
          card: { brand: 'visa', last4: '4242' },
        },
      },
    });
    await handleStripeWebhook(webhookReq(body), env);
    const evt = db.calls.find(
      (c) =>
        /insert into billing_events/i.test(c.sql) &&
        c.args.includes('payment_method.attached'),
    );
    expect(evt).toBeTruthy();
    // payload (arg index 7) ne doit pas contenir un PAN. brand + last4 only.
    const payloadStr = String(evt!.args[7]);
    expect(payloadStr).toContain('visa');
    expect(payloadStr).toContain('4242');
    expect(payloadStr).not.toMatch(/\d{13,19}/);
  });
});

describe('S31 — handleStripeWebhook setup_intent.succeeded', () => {
  it('audit log seul, pas d\'INSERT/UPDATE D1 hors billing_events', async () => {
    const { env, db } = makeEnv();
    const body = JSON.stringify({
      id: 'evt_si_1',
      type: 'setup_intent.succeeded',
      data: {
        object: {
          id: 'seti_xyz',
          object: 'setup_intent',
          customer: 'cus_xyz',
          status: 'succeeded',
        },
      },
    });
    const res = await handleStripeWebhook(webhookReq(body), env);
    expect(res.status).toBe(200);
    // billing_events INSERT émis avec eventType billing.setup_intent.succeeded
    const evt = db.calls.find(
      (c) =>
        /insert into billing_events/i.test(c.sql) &&
        c.args.includes('billing.setup_intent.succeeded'),
    );
    expect(evt).toBeTruthy();
    // PAS de INSERT INTO payment_methods (c'est le webhook PM.attached qui fait ça)
    const insertPm = db.calls.find((c) => /insert into payment_methods/i.test(c.sql));
    expect(insertPm).toBeFalsy();
    // PAS de UPDATE stripe_connect_accounts
    const updateConnect = db.calls.find((c) => /update stripe_connect_accounts/i.test(c.sql));
    expect(updateConnect).toBeFalsy();
  });

  it('payload trimmed : id + customer only, pas de payment_method PII', async () => {
    const { env, db } = makeEnv();
    const body = JSON.stringify({
      id: 'evt_si_2',
      type: 'setup_intent.succeeded',
      data: {
        object: {
          id: 'seti_yyy',
          customer: 'cus_yyy',
          // Si Stripe expand payment_method, on ne doit pas tout balancer dans le log.
          payment_method: { id: 'pm_yyy', card: { last4: '4242', brand: 'visa', number_full: 'SHOULD_BE_TRIMMED' } },
        },
      },
    });
    await handleStripeWebhook(webhookReq(body), env);
    const evt = db.calls.find(
      (c) =>
        /insert into billing_events/i.test(c.sql) &&
        c.args.includes('billing.setup_intent.succeeded'),
    );
    expect(evt).toBeTruthy();
    const payloadStr = String(evt!.args[7]);
    // Trim contract : seuls id + customer figurent dans le payload loggé
    expect(payloadStr).toContain('seti_yyy');
    expect(payloadStr).toContain('cus_yyy');
    expect(payloadStr).not.toContain('SHOULD_BE_TRIMMED');
  });
});
