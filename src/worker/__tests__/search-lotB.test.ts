// ── search-lotB.test.ts — LOT B / S-B2 (Manager A, Phase A) ────────────────
//
// Couvre handleGlobalSearch :
//   1. q < 2 caractères → { data:{ results:[], total:0 } }, aucune erreur, aucune query.
//   2. Isolation multi-tenant : admin → pas de filtre client_id ; non-admin →
//      client_id résolu via SELECT users puis filtré sur CHAQUE entité.
//   3. Whitelist `types` (CSV) : seules les entités demandées sont requêtées.
//   4. LIMIT borné [1..50] (défaut 20) appliqué par type.
//   5. Forme de réponse { data:{ results, total } } + champs SearchResult.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
// Mock : createMockD1 partagé (_helpers.ts figé). `.all()` → { results }.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { handleGlobalSearch } from '../search';

function makeEnv(db = createMockD1()) {
  return { env: { DB: db } as unknown as Env, db };
}

const ADMIN = { role: 'admin', userId: 'admin-1' };
const BROKER = { role: 'broker', userId: 'broker-1' };

function searchUrl(qs = ''): URL {
  return new URL(`http://x/api/search${qs}`);
}

describe('S-B2 — handleGlobalSearch : q trop court', () => {
  it('q absent → { data:{ results:[], total:0 } }, aucune query SQL', async () => {
    const { env, db } = makeEnv();
    const res = await handleGlobalSearch(env, ADMIN, searchUrl());
    const body = (await res.json()) as { data: { results: unknown[]; total: number } };
    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([]);
    expect(body.data.total).toBe(0);
    expect(db.calls.length).toBe(0);
  });

  it('q = 1 caractère → vide, pas d\'erreur', async () => {
    const { env, db } = makeEnv();
    const res = await handleGlobalSearch(env, ADMIN, searchUrl('?q=a'));
    const body = (await res.json()) as { data: { results: unknown[]; total: number }; error?: string };
    expect(body.error).toBeUndefined();
    expect(body.data.total).toBe(0);
    expect(db.calls.length).toBe(0);
  });
});

describe('S-B2 — isolation multi-tenant', () => {
  it('admin : aucun filtre client_id sur les entités', async () => {
    const { env, db } = makeEnv();
    db.seed('from leads', [{ id: 'l1', name: 'Marie', email: 'm@x.co', phone: '', status: 'new', client_id: 'c9' }]);
    const res = await handleGlobalSearch(env, ADMIN, searchUrl('?q=marie&types=leads'));
    const body = (await res.json()) as { data: { results: { url: string }[]; total: number } };
    expect(body.data.total).toBe(1);
    expect(body.data.results[0].url).toBe('/leads/l1');
    // admin ne résout JAMAIS le client_id (pas de SELECT users)
    const userLookup = db.calls.find(c => /from users/i.test(c.sql));
    expect(userLookup).toBeUndefined();
    // aucune clause de filtre tenant
    const leadsCall = db.calls.find(c => /from leads/i.test(c.sql));
    expect(leadsCall && /and client_id = \?/i.test(leadsCall.sql)).toBe(false);
  });

  it('non-admin : résout client_id via SELECT users puis filtre chaque entité', async () => {
    const { env, db } = makeEnv();
    db.seed('select client_id from users', [{ client_id: 'tenant-7' }]);
    db.seed('from leads', [{ id: 'l1', name: 'Bob', email: '', phone: '', status: 'new', client_id: 'tenant-7' }]);
    const res = await handleGlobalSearch(env, BROKER, searchUrl('?q=bob'));
    const body = (await res.json()) as { data: { total: number } };
    expect(body.data.total).toBeGreaterThanOrEqual(1);
    // SELECT users effectué pour résoudre le tenant
    const userLookup = db.calls.find(c => /from users/i.test(c.sql));
    expect(userLookup).toBeDefined();
    // chaque entité filtrée sur le tenant résolu
    for (const ent of ['from leads', 'from clients', 'from tasks', 'from conversations']) {
      const call = db.calls.find(c => c.sql.toLowerCase().includes(ent));
      expect(call, ent).toBeDefined();
      expect(call!.args).toContain('tenant-7');
    }
  });

  it('non-admin sans client_id → sentinelle, jamais cross-tenant', async () => {
    const { env, db } = makeEnv();
    db.seed('select client_id from users', [{ client_id: null }]);
    const res = await handleGlobalSearch(env, BROKER, searchUrl('?q=test&types=leads'));
    await res.json();
    const leadsCall = db.calls.find(c => /from leads/i.test(c.sql));
    expect(leadsCall!.args).toContain('__no_tenant__');
  });
});

describe('S-B2 — whitelist types', () => {
  it('types=leads,tasks → seules ces entités requêtées', async () => {
    const { env, db } = makeEnv();
    const res = await handleGlobalSearch(env, ADMIN, searchUrl('?q=abc&types=leads,tasks'));
    await res.json();
    expect(db.calls.some(c => /from leads/i.test(c.sql))).toBe(true);
    expect(db.calls.some(c => /from tasks/i.test(c.sql))).toBe(true);
    expect(db.calls.some(c => /from clients/i.test(c.sql))).toBe(false);
    expect(db.calls.some(c => /from conversations/i.test(c.sql))).toBe(false);
  });

  it('types invalides ignorés → fallback tous types', async () => {
    const { env, db } = makeEnv();
    const res = await handleGlobalSearch(env, ADMIN, searchUrl('?q=abc&types=foo,bar'));
    await res.json();
    expect(db.calls.some(c => /from leads/i.test(c.sql))).toBe(true);
    expect(db.calls.some(c => /from clients/i.test(c.sql))).toBe(true);
    expect(db.calls.some(c => /from tasks/i.test(c.sql))).toBe(true);
    expect(db.calls.some(c => /from conversations/i.test(c.sql))).toBe(true);
  });
});

describe('S-B2 — LIMIT borné', () => {
  it('limit=999 → clampé à 50 dans les bindings', async () => {
    const { env, db } = makeEnv();
    const res = await handleGlobalSearch(env, ADMIN, searchUrl('?q=abc&types=leads&limit=999'));
    await res.json();
    const call = db.calls.find(c => /from leads/i.test(c.sql))!;
    expect(call.args[call.args.length - 1]).toBe(50);
  });

  it('limit absent → défaut 20', async () => {
    const { env, db } = makeEnv();
    const res = await handleGlobalSearch(env, ADMIN, searchUrl('?q=abc&types=tasks'));
    await res.json();
    const call = db.calls.find(c => /from tasks/i.test(c.sql))!;
    expect(call.args[call.args.length - 1]).toBe(20);
  });

  it('limit=0 → clampé à 1', async () => {
    const { env, db } = makeEnv();
    const res = await handleGlobalSearch(env, ADMIN, searchUrl('?q=abc&types=tasks&limit=0'));
    await res.json();
    const call = db.calls.find(c => /from tasks/i.test(c.sql))!;
    expect(call.args[call.args.length - 1]).toBe(1);
  });
});

describe('S-B2 — forme de réponse', () => {
  it('{ data:{ results, total } } + SearchResult bien formé', async () => {
    const { env, db } = makeEnv();
    db.seed('from clients', [{ id: 'cl1', name: 'Acme', email: 'a@acme.co', phone: '', city: 'Montréal' }]);
    const res = await handleGlobalSearch(env, ADMIN, searchUrl('?q=acme&types=clients'));
    const body = (await res.json()) as { data: { results: any[]; total: number } };
    expect(body.data.total).toBe(1);
    const r = body.data.results[0];
    expect(r.type).toBe('client');
    expect(r.id).toBe('cl1');
    expect(r.title).toBe('Acme');
    expect(r.url).toBe('/clients/cl1/leads');
    expect(typeof r.subtitle).toBe('string');
  });
});
