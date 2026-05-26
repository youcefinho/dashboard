// ── lot3-quota.test.ts — LOT 3 SaaS M1 (2026-05-18) ─────────────────────────
//
// Couvre requireQuota (CONTRAT §6.14, calque EXACT requireModule) :
//   - garde-fou #1 ABSOLU : agencyId falsy ⇒ null IMMÉDIAT, 0 requête (db.calls)
//   - plan free dépassé ⇒ 403 QUOTA_EXCEEDED
//   - sous quota ⇒ null
//   - plan pro : limites hautes ⇒ null
//   - plan unlimited ⇒ null SANS COUNT (1 seule requête : le SELECT plan)
//   - subscription absente ⇒ fallback `free`
//   - panne D1 (plan ou COUNT) ⇒ null, JAMAIS throw
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Mock : createMockD1 partagé (_helpers.ts, FIGÉ — pas de batch, pas d'ext.).
// `seed(substr, rows)` programme la réponse d'un SELECT contenant la sous-chaîne
// (1er match, case-insensitive). Sous-chaînes discriminantes :
//   - 'from subscriptions'        → SELECT plan_name (plan actif agence)
//   - 'from clients where agency' → COUNT subAccounts
//   - 'from leads where client_id'→ COUNT leads
//   - 'from user_sub_accounts'    → COUNT users
//
// Pour simuler une panne D1 : on remplace db.prepare par un throw ciblé.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { requireQuota, resolvePlan, PLANS } from '../plans';

function makeEnv(db = createMockD1()) {
  return { env: { DB: db } as unknown as Env, db };
}

describe('resolvePlan — fallback sûr', () => {
  it('plan connu ⇒ ses limites', () => {
    expect(resolvePlan('pro')).toEqual(PLANS.pro);
    expect(resolvePlan('UNLIMITED')).toEqual(PLANS.unlimited); // case-insensitive
  });

  it('null / inconnu ⇒ free (subscriptions.plan_name SANS CHECK réel)', () => {
    expect(resolvePlan(null)).toEqual(PLANS.free);
    expect(resolvePlan(undefined)).toEqual(PLANS.free);
    expect(resolvePlan('enterprise-xyz')).toEqual(PLANS.free);
  });
});

describe('requireQuota — CONTRAT §6.14 (calque requireModule)', () => {
  it('garde-fou #1 ABSOLU : agencyId null ⇒ null IMMÉDIAT, 0 requête D1', async () => {
    const { env, db } = makeEnv();
    const r = await requireQuota(env, null, 'leads');
    expect(r).toBeNull();
    expect(db.calls.length).toBe(0); // AUCUNE requête (rétro-compat byte-identique)
  });

  it('garde-fou #1 : agencyId undefined ⇒ null, 0 requête', async () => {
    const { env, db } = makeEnv();
    const r = await requireQuota(env, undefined, 'subAccounts');
    expect(r).toBeNull();
    expect(db.calls.length).toBe(0);
  });

  it('garde-fou #1 : agencyId chaîne vide ⇒ null, 0 requête', async () => {
    const { env, db } = makeEnv();
    const r = await requireQuota(env, '', 'users');
    expect(r).toBeNull();
    expect(db.calls.length).toBe(0);
  });

  it('plan free dépassé (2 sous-comptes, limite 2) ⇒ 403 QUOTA_EXCEEDED', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions', [{ plan_name: 'free' }]);
    db.seed('from clients where agency', [{ n: 2 }]); // == limite ⇒ >= ⇒ refus
    const r = await requireQuota(env, 'ag-1', 'subAccounts');
    expect(r).not.toBeNull();
    expect(r!.status).toBe(403);
    const body = await r!.json();
    expect(body.code).toBe('QUOTA_EXCEEDED');
    expect(body.kind).toBe('subAccounts');
    expect(body.limit).toBe(2);
    expect(body.current).toBe(2);
    expect(typeof body.error).toBe('string');
    expect(body.error).toContain('free');
  });

  it('plan free SOUS quota (1 lead, limite 500) ⇒ null', async () => {
    const { env } = makeEnv();
    const db = createMockD1();
    db.seed('from subscriptions', [{ plan_name: 'free' }]);
    db.seed('from leads where client_id', [{ n: 1 }]);
    const r = await requireQuota({ DB: db } as unknown as Env, 'ag-1', 'leads');
    expect(r).toBeNull();
  });

  it('plan pro : 9 sous-comptes < 10 ⇒ null (limites hautes)', async () => {
    const db = createMockD1();
    db.seed('from subscriptions', [{ plan_name: 'pro' }]);
    db.seed('from clients where agency', [{ n: 9 }]);
    const r = await requireQuota({ DB: db } as unknown as Env, 'ag-1', 'subAccounts');
    expect(r).toBeNull();
  });

  it('plan pro : 10 sous-comptes == 10 ⇒ 403 (>= avant INSERT)', async () => {
    const db = createMockD1();
    db.seed('from subscriptions', [{ plan_name: 'pro' }]);
    db.seed('from clients where agency', [{ n: 10 }]);
    const r = await requireQuota({ DB: db } as unknown as Env, 'ag-1', 'subAccounts');
    expect(r).not.toBeNull();
    expect(r!.status).toBe(403);
  });

  it('plan unlimited ⇒ null SANS COUNT (1 seule requête : SELECT plan)', async () => {
    const db = createMockD1();
    db.seed('from subscriptions', [{ plan_name: 'unlimited' }]);
    const r = await requireQuota({ DB: db } as unknown as Env, 'ag-1', 'leads');
    expect(r).toBeNull();
    // Seule la lecture du plan a été émise (Infinity ⇒ pas de COUNT).
    expect(db.calls.length).toBe(1);
    expect(db.calls[0].sql.toLowerCase()).toContain('from subscriptions');
  });

  it('subscription absente ⇒ fallback free (501 leads > 500 ⇒ 403)', async () => {
    const db = createMockD1();
    db.seed('from subscriptions', []); // aucune ligne ⇒ plan_name null ⇒ free
    db.seed('from leads where client_id', [{ n: 501 }]);
    const r = await requireQuota({ DB: db } as unknown as Env, 'ag-1', 'leads');
    expect(r).not.toBeNull();
    expect(r!.status).toBe(403);
    const body = await r!.json();
    expect(body.limit).toBe(500); // = PLANS.free.maxLeads
  });

  it('panne D1 sur le SELECT plan ⇒ null, JAMAIS throw (best-effort)', async () => {
    const db = createMockD1();
    db.prepare = () => {
      throw new Error('D1 down');
    };
    const r = await requireQuota({ DB: db } as unknown as Env, 'ag-1', 'subAccounts');
    expect(r).toBeNull();
  });

  it('panne D1 sur le COUNT seulement ⇒ null, JAMAIS throw', async () => {
    const db = createMockD1();
    db.seed('from subscriptions', [{ plan_name: 'free' }]);
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (sql.toLowerCase().includes('count(*)')) throw new Error('D1 down mid-count');
      return realPrepare(sql);
    };
    const r = await requireQuota({ DB: db } as unknown as Env, 'ag-1', 'subAccounts');
    expect(r).toBeNull();
  });

  it('users : COUNT via user_sub_accounts borné agence ⇒ requête attendue', async () => {
    const db = createMockD1();
    db.seed('from subscriptions', [{ plan_name: 'free' }]);
    db.seed('from user_sub_accounts', [{ n: 3 }]); // == 3 (free.maxUsers) ⇒ 403
    const r = await requireQuota({ DB: db } as unknown as Env, 'ag-1', 'users');
    expect(r).not.toBeNull();
    expect(r!.status).toBe(403);
    const countCall = db.calls.find((c) => c.sql.toLowerCase().includes('count(*)'));
    expect(countCall).toBeDefined();
    expect(countCall!.sql.toLowerCase()).toContain('from user_sub_accounts');
    expect(countCall!.sql.toLowerCase()).toContain('client_id in (select id from clients where agency_id');
  });
});
