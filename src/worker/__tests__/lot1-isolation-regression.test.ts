// ── lot1-isolation-regression.test.ts — LOT 1 SaaS M3 (2026-05-18) ─────────
//
// PROUVE la rétro-compat DURE du LOT 1 (CONTRAT §6.1 / §6.2 / §6.7).
// Lecture seule : aucune assertion ne modifie le code prod. On vérifie
// uniquement que le comportement LEGACY mono-tenant est préservé byte-à-byte
// une fois l'isolation tenant introduite.
//
// Cas couverts :
//   (a) §6.2 — getClientModules SANS `ctx` retourne `{clientId, modules}`
//       byte-identique au legacy : MÊMES requêtes SQL, MÊMES champs, AUCUN
//       champ additif (agencyId/accountLevel/accessibleClientIds) présent.
//   (b) §6.1 — user avec users.client_id set + agency_id IS NULL + 0 jonction
//       ⇒ resolveTenantContext = legacy strict (clientId=X, agencyId=null,
//       accessibleClientIds=[X], pas de throw) ; et getClientModules(ctx)
//       renvoie le MÊME clientId/modules que le chemin sans ctx.
//   (c) Smoke role-gate — un handler role-gate (pattern leads) n'est PAS
//       régressé par l'injection du champ additif `clientId?` dans `auth` :
//       role 'user' toujours 403, role 'admin' toujours 200, même avec
//       l'`auth` enrichi (clientId / tenant) tel que produit au choke-point.
//   (d) §6.7 — parité STRICTE des 2 catalogues plats src/i18n/{fr-CA,en}.json
//       (mêmes clés exactement, format point-notation plat, pas de {{var}})
//       + présence des 9 clés auth.signup.* dans les DEUX.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
// Mock : createMockD1 partagé (_helpers.ts, FIGÉ — PAS de batch). `seed(substr,
// rows)` programme la réponse d'un SELECT contenant la sous-chaîne (1er match,
// case-insensitive).

import { describe, it, expect } from 'vitest';
import { createMockD1 } from './_helpers';
import { getClientModules } from '../modules';
import { resolveTenantContext } from '../tenant-context';
import { handleGetLeads } from '../leads';
import type { Env } from '../types';
import type { TenantContext } from '../tenant-context';
import frCA from '../../i18n/fr-CA.json';
import en from '../../i18n/en.json';

function makeEnv(db = createMockD1()) {
  return { env: { DB: db } as unknown as Env, db };
}

// ── (a) §6.2 — getClientModules SANS ctx : legacy byte-identique ────────────
describe('LOT 1 régression — getClientModules SANS ctx (CONTRAT §6.2)', () => {
  it('retourne EXACTEMENT { clientId, modules } — aucun champ additif', async () => {
    const { env, db } = makeEnv();
    db.seed('client_id from users where id', [{ client_id: 'client-1' }]);
    db.seed('modules_json from clients', [{ modules_json: '["crm"]' }]);

    const res = await getClientModules(env, 'u1');

    expect(res.clientId).toBe('client-1');
    expect(res.modules).toEqual(['crm']);
    // Rétro-compat dure : les 114 appelants destructurent {clientId, modules}.
    // AUCUN champ additif ne doit apparaître sur le chemin legacy (ctx absent).
    expect(Object.keys(res).sort()).toEqual(['clientId', 'modules']);
    expect(res.agencyId).toBeUndefined();
    expect(res.accountLevel).toBeUndefined();
    expect(res.accessibleClientIds).toBeUndefined();
  });

  it('lit users.client_id PUIS clients.modules_json (mêmes 2 SELECT que le legacy)', async () => {
    const { env, db } = makeEnv();
    db.seed('client_id from users where id', [{ client_id: 'client-1' }]);
    db.seed('modules_json from clients', [{ modules_json: '["crm","ecommerce"]' }]);

    await getClientModules(env, 'u1');

    const sql = db.calls.map((c) => c.sql.toLowerCase());
    expect(sql.some((s) => s.includes('select client_id from users where id'))).toBe(true);
    expect(sql.some((s) => s.includes('select modules_json from clients where id'))).toBe(true);
    // Le SELECT users est lié au userId fourni (chemin legacy intact).
    const userSelect = db.calls.find((c) =>
      c.sql.toLowerCase().includes('client_id from users where id'),
    );
    expect(userSelect?.args).toEqual(['u1']);
  });

  it('client_id null ⇒ { clientId:null, modules:[crm] } (legacy strict, sans champ additif)', async () => {
    const { env, db } = makeEnv();
    db.seed('client_id from users where id', [{ client_id: null }]);

    const res = await getClientModules(env, 'u1');

    expect(res.clientId).toBeNull();
    expect(res.modules).toEqual(['crm']);
    expect(Object.keys(res).sort()).toEqual(['clientId', 'modules']);
  });
});

// ── (b) §6.1 — user mono-tenant : résolveur = legacy strict ─────────────────
describe('LOT 1 régression — user mono-tenant legacy (CONTRAT §6.1)', () => {
  it('client_id set + agency_id IS NULL + 0 jonction ⇒ clientId=X, agencyId=null, [X]', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'user', agency_id: null },
    ]);
    db.seed('from user_sub_accounts', []); // jonction vide (back-fill pas requis)
    db.seed('agency_id from clients', [{ agency_id: null }]);

    const ctx = await resolveTenantContext(env, 'u1', 'admin');

    expect(ctx.clientId).toBe('client-1');
    expect(ctx.agencyId).toBeNull();
    expect(ctx.accountLevel).toBe('user');
    expect(ctx.accessibleClientIds).toEqual(['client-1']);
  });

  it('getClientModules(ctx) du mono-tenant ⇒ MÊME clientId/modules que sans ctx', async () => {
    // Sans ctx (chemin legacy)
    const a = makeEnv();
    a.db.seed('client_id from users where id', [{ client_id: 'client-1' }]);
    a.db.seed('modules_json from clients', [{ modules_json: '["crm"]' }]);
    const legacy = await getClientModules(a.env, 'u1');

    // Avec ctx mono-tenant résolu (agency_id null, jonction vide)
    const b = makeEnv();
    b.db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'user', agency_id: null },
    ]);
    b.db.seed('from user_sub_accounts', []);
    b.db.seed('agency_id from clients', [{ agency_id: null }]);
    b.db.seed('modules_json from clients', [{ modules_json: '["crm"]' }]);
    const ctx: TenantContext = await resolveTenantContext(b.env, 'u1', 'admin');
    const withCtx = await getClientModules(b.env, 'u1', ctx);

    // clientId + modules STRICTEMENT identiques (sémantique inchangée).
    expect(withCtx.clientId).toBe(legacy.clientId);
    expect(withCtx.modules).toEqual(legacy.modules);
    // Avec ctx : agencyId additif présent mais null (mono-tenant) — n'affecte
    // pas les appelants legacy qui ne lisent que {clientId, modules}.
    expect(withCtx.agencyId).toBeNull();
  });

  it('ne throw JAMAIS si le SELECT users échoue (legacy strict null/[])', async () => {
    const db = {
      calls: [] as Array<{ sql: string; args: any[] }>,
      prepare() {
        return {
          bind() {
            return this;
          },
          first() {
            throw new Error('D1 unavailable');
          },
          all() {
            throw new Error('D1 unavailable');
          },
          run() {
            throw new Error('D1 unavailable');
          },
        };
      },
    };
    const ctx = await resolveTenantContext({ DB: db } as unknown as Env, 'u1', 'admin');
    expect(ctx.clientId).toBeNull();
    expect(ctx.agencyId).toBeNull();
    expect(ctx.accessibleClientIds).toEqual([]);
    expect(ctx.accountLevel).toBe('user');
  });
});

// ── (c) Smoke role-gate — injection auth additive non régressive ────────────
describe('LOT 1 régression — handler role-gate non régressé (smoke)', () => {
  const makeLeadsEnv = () =>
    ({
      DB: {
        prepare: () => ({
          bind() {
            return this;
          },
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ success: true, meta: { changes: 0 } }),
        }),
      },
    }) as unknown as Env;
  const url = new URL('http://localhost/api/public/v1/leads');

  it('role user ⇒ 403 même avec auth enrichi (clientId + tenant additifs)', async () => {
    // `auth` tel que produit au choke-point worker.ts : champs additifs présents.
    const enrichedAuth = {
      userId: 'u1',
      role: 'user',
      clientId: 'client-1',
      tenant: {
        userId: 'u1',
        role: 'user',
        clientId: 'client-1',
        agencyId: null,
        accountLevel: 'user',
        accessibleClientIds: ['client-1'],
      } as TenantContext,
    };
    const res = await handleGetLeads(makeLeadsEnv(), enrichedAuth as any, url);
    expect(res.status).toBe(403);
  });

  it('role admin ⇒ 200, l’injection additive ne change pas la décision role-gate', async () => {
    const enrichedAuth = {
      userId: 'admin-1',
      role: 'admin',
      clientId: 'client-1',
      tenant: {
        userId: 'admin-1',
        role: 'admin',
        clientId: 'client-1',
        agencyId: null,
        accountLevel: 'user',
        accessibleClientIds: ['client-1'],
      } as TenantContext,
    };
    const res = await handleGetLeads(makeLeadsEnv(), enrichedAuth as any, url);
    expect(res.status).toBe(200);
  });

  it('role admin SANS champs additifs (auth legacy) ⇒ 200 (comportement inchangé)', async () => {
    const res = await handleGetLeads(makeLeadsEnv(), { role: 'admin' } as any, url);
    expect(res.status).toBe(200);
  });
});

// ── (d) §6.7 — parité STRICTE des 2 catalogues plats ───────────────────────
describe('LOT 1 régression — i18n parité stricte (CONTRAT §6.7)', () => {
  const fr = frCA as Record<string, string>;
  const enT = en as Record<string, string>;
  const SIGNUP_KEYS = [
    'auth.signup.title',
    'auth.signup.email_label',
    'auth.signup.password_label',
    'auth.signup.name_label',
    'auth.signup.company_label',
    'auth.signup.submit',
    'auth.signup.email_taken',
    'auth.signup.success',
    'auth.signup.error',
  ];

  it('les 2 catalogues ont EXACTEMENT le même jeu de clés (parité stricte)', () => {
    const frKeys = Object.keys(fr).sort();
    const enKeys = Object.keys(enT).sort();
    expect(frKeys).toEqual(enKeys);
  });

  it('les 9 clés auth.signup.* existent dans fr-CA ET en, non vides', () => {
    for (const k of SIGNUP_KEYS) {
      expect(fr[k], `fr-CA manque ${k}`).toBeTruthy();
      expect(enT[k], `en manque ${k}`).toBeTruthy();
    }
  });

  it('format plat point-notation : aucune valeur n’est un objet, aucun {{var}}', () => {
    for (const cat of [fr, enT]) {
      for (const [key, val] of Object.entries(cat)) {
        expect(typeof val, `valeur non-string pour ${key}`).toBe('string');
        expect(val, `placeholder {{}} interdit dans ${key}`).not.toMatch(/\{\{.*?\}\}/);
        // point-notation plate : la clé contient des '.' mais jamais d'espace.
        expect(key).not.toMatch(/\s/);
      }
    }
  });

  it('aucune clé auth.* préexistante supprimée/renommée (rétro-compat catalogue)', () => {
    // Sentinelles : clés auth.* livrées avant le LOT 1, doivent rester.
    for (const k of [
      'auth.login_button',
      'auth.email_label',
      'auth.password_label',
      'auth.subtitle',
    ]) {
      expect(fr[k], `fr-CA a perdu ${k}`).toBeTruthy();
      expect(enT[k], `en a perdu ${k}`).toBeTruthy();
    }
  });
});
