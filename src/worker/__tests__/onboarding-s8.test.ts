// ── onboarding-s8.test.ts — Sprint S8 M1 (Manager A) ────────────────────────
//
// Couvre la persistance d'état d'onboarding (table onboarding_state, migration
// seq 76) : GET défaut / GET seedé / PUT upsert + validation + audit non
// sensible / multi-tenant strict / rétro-compat handleWelcomeOnboarding.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Mock : createMockD1 partagé (_helpers.ts). `.run()` renvoie toujours
// {success, meta:{changes:1}} ; `seed(substr, rows)` programme la réponse
// d'un SELECT contenant la sous-chaîne. getClientModules fait 2 SELECT :
//   - "SELECT client_id FROM users WHERE id = ?"  → résolution tenant
//   - "SELECT modules_json FROM clients WHERE id = ?"
// puis le handler fait "... FROM onboarding_state WHERE client_id = ? ...".

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import {
  handleGetOnboardingState,
  handlePutOnboardingState,
  handleWelcomeOnboarding,
} from '../onboarding';

function makeEnv(db = createMockD1()) {
  // tenant résolu : users.client_id = 'client-1'
  db.seed('from users where id', [{ client_id: 'client-1' }]);
  db.seed('modules_json from clients', [{ modules_json: '[]' }]);
  return { env: { DB: db } as unknown as Env, db };
}

const AUTH = { userId: 'user-1' };

function req(body: unknown): Request {
  return new Request('http://x/api/onboarding/state', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

describe('S8 — GET /api/onboarding/state', () => {
  it('renvoie l’état par défaut quand aucune ligne', async () => {
    const { env } = makeEnv();
    const res = await handleGetOnboardingState(env, AUTH);
    const json = (await res.json()) as { data: any };
    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      currentStep: 0,
      completedSteps: [],
      ecommerceOptedIn: false,
      completedAt: null,
      payload: null,
    });
  });

  it('renvoie l’état par défaut si pas de tenant (multi-tenant strict)', async () => {
    const db = createMockD1();
    db.seed('from users where id', [{ client_id: null }]);
    const env = { DB: db } as unknown as Env;
    const res = await handleGetOnboardingState(env, AUTH);
    const json = (await res.json()) as { data: any };
    expect(json.data.currentStep).toBe(0);
  });

  it('parse et renvoie une ligne seedée', async () => {
    const { env, db } = makeEnv();
    db.seed('from onboarding_state where client_id', [
      {
        id: 'onb-1',
        current_step: 3,
        completed_steps_json: '["profile","industry"]',
        payload_json: '{"industry":"resto"}',
        ecommerce_opted_in: 1,
        completed_at: '2026-05-17 12:00:00',
      },
    ]);
    const res = await handleGetOnboardingState(env, AUTH);
    const json = (await res.json()) as { data: any };
    expect(json.data).toEqual({
      currentStep: 3,
      completedSteps: ['profile', 'industry'],
      ecommerceOptedIn: true,
      completedAt: '2026-05-17 12:00:00',
      payload: { industry: 'resto' },
    });
  });

  it('tolère un JSON corrompu (dégrade sans throw)', async () => {
    const { env, db } = makeEnv();
    db.seed('from onboarding_state where client_id', [
      {
        id: 'onb-2',
        current_step: 1,
        completed_steps_json: 'not-json',
        payload_json: '{bad',
        ecommerce_opted_in: 0,
        completed_at: null,
      },
    ]);
    const res = await handleGetOnboardingState(env, AUTH);
    const json = (await res.json()) as { data: any };
    expect(json.data.completedSteps).toEqual([]);
    expect(json.data.payload).toBeNull();
  });
});

describe('S8 — PUT /api/onboarding/state', () => {
  it('rejette un body invalide via validate() → 400 code VALIDATION', async () => {
    const { env } = makeEnv();
    const res = await handlePutOnboardingState(
      req({ currentStep: 'pas-un-nombre' }),
      env,
      AUTH,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.code).toBe('VALIDATION');
    expect(typeof json.error).toBe('string');
  });

  it('400 si pas de tenant (error string rétro-compat front)', async () => {
    const db = createMockD1();
    db.seed('from users where id', [{ client_id: null }]);
    const env = { DB: db } as unknown as Env;
    const res = await handlePutOnboardingState(req({ currentStep: 1 }), env, AUTH);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(typeof json.error).toBe('string');
  });

  it('upsert : émet un INSERT ... ON CONFLICT filtré (client_id, user_id)', async () => {
    const { env, db } = makeEnv();
    const res = await handlePutOnboardingState(
      req({ currentStep: 2, completedSteps: ['profile'], ecommerceOptedIn: true }),
      env,
      AUTH,
    );
    expect(res.status).toBe(200);
    const upsert = db.calls.find(
      (c) => /insert into onboarding_state/i.test(c.sql) && /on conflict/i.test(c.sql),
    );
    expect(upsert).toBeTruthy();
    // bind order : clientId, userId, step, stepsJson, payloadJson, optIn
    expect(upsert!.args[0]).toBe('client-1');
    expect(upsert!.args[1]).toBe('user-1');
    expect(upsert!.args[2]).toBe(2);
    expect(upsert!.args[5]).toBe(1);
  });

  it('renvoie la même shape que GET', async () => {
    const { env, db } = makeEnv();
    db.seed('from onboarding_state where client_id', [
      {
        id: 'onb-3',
        current_step: 4,
        completed_steps_json: '["profile","goals"]',
        payload_json: null,
        ecommerce_opted_in: 0,
        completed_at: null,
      },
    ]);
    const res = await handlePutOnboardingState(req({ currentStep: 4 }), env, AUTH);
    const json = (await res.json()) as { data: any };
    expect(Object.keys(json.data).sort()).toEqual(
      ['completedAt', 'completedSteps', 'currentStep', 'ecommerceOptedIn', 'payload'].sort(),
    );
  });

  it('audit non sensible : aucun champ payload dans details', async () => {
    const { env, db } = makeEnv();
    await handlePutOnboardingState(
      req({ currentStep: 1, payload: { email: 'secret@x.com', name: 'Jean' } }),
      env,
      AUTH,
    );
    const auditCall = db.calls.find((c) => /insert into audit_log/i.test(c.sql));
    expect(auditCall).toBeTruthy();
    const detailsArg = auditCall!.args.find(
      (a) => typeof a === 'string' && a.startsWith('{'),
    ) as string;
    expect(detailsArg).not.toContain('secret@x.com');
    expect(detailsArg).not.toContain('Jean');
  });

  it('corps vide = no-op idempotent (200, état courant)', async () => {
    const { env } = makeEnv();
    const res = await handlePutOnboardingState(req({}), env, AUTH);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: any };
    expect(json.data.currentStep).toBe(0);
  });
});

describe('S8 — handleWelcomeOnboarding rétro-compat + persistance additive', () => {
  it('réponse legacy {data:{success,echo}} INCHANGÉE', async () => {
    const { env } = makeEnv();
    const r = new Request('http://x/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({
        profile: { name: 'A', email: 'a@x.com' },
        industry: 'resto',
        goals: ['g1'],
        teamSize: 'solo',
      }),
    });
    const res = await handleWelcomeOnboarding(r, env, AUTH);
    const json = (await res.json()) as { data: any };
    expect(json.data.success).toBe(true);
    expect(json.data.echo).toBeTruthy();
    expect(json.data.echo.industry).toBe('resto');
  });

  it('businessType "shop" ⇒ ecommerce_opted_in = 1 dans l’upsert', async () => {
    const { env, db } = makeEnv();
    const r = new Request('http://x/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ profile: { name: 'B' }, businessType: 'shop' }),
    });
    await handleWelcomeOnboarding(r, env, AUTH);
    const upsert = db.calls.find(
      (c) => /insert into onboarding_state/i.test(c.sql) && /on conflict/i.test(c.sql),
    );
    expect(upsert).toBeTruthy();
    expect(upsert!.args[5]).toBe(1); // ecommerce_opted_in
  });

  it('businessType "crm" ⇒ ecommerce_opted_in = 0', async () => {
    const { env, db } = makeEnv();
    const r = new Request('http://x/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ profile: { name: 'C' }, businessType: 'crm' }),
    });
    await handleWelcomeOnboarding(r, env, AUTH);
    const upsert = db.calls.find(
      (c) => /insert into onboarding_state/i.test(c.sql) && /on conflict/i.test(c.sql),
    );
    expect(upsert!.args[5]).toBe(0);
  });
});
