// ── s9-backend.test.ts — Sprint S9 M1 (Manager A) ───────────────────────────
//
// Couvre :
//   1. handleGetClientLeads — rétro-compat STRICTE (params absents → SQL
//      historique byte-identique, réponse { data } seule) + pagination opt-in
//      (limit/offset bornés, réponse { data, total, limit, offset }).
//   2. handlePostWebVitals — beacon best-effort : 204 systématique, validation
//      inline (whitelist name, clamp value, drop garbage), INSERT web_vitals,
//      jamais d'erreur même si DB throw.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Mock : createMockD1 partagé (_helpers.ts). `.all()` → { results }.
// handleGetClientLeads (role!=='broker') fait directement le SELECT leads.
// Le COUNT(*) wrappé est seedé via la sous-chaîne "count(*)".

import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { handleGetClientLeads } from '../leads';
import { handlePostWebVitals } from '../telemetry';

function makeEnv(db = createMockD1()) {
  return { env: { DB: db } as unknown as Env, db };
}

// auth admin : pas de check broker (role !== 'broker' → bypass users SELECT).
const ADMIN = { role: 'admin', userId: 'user-1' };

function leadsReq(qs = ''): URL {
  return new URL(`http://x/api/clients/client-1/leads${qs}`);
}

describe('S9 — handleGetClientLeads rétro-compat (params absents)', () => {
  it('sans limit/offset : SQL historique "LIMIT 200", réponse { data } seule', async () => {
    const { env, db } = makeEnv();
    db.seed('from leads where client_id', [{ id: 'l1' }, { id: 'l2' }]);

    const res = await handleGetClientLeads(env, ADMIN, 'client-1', leadsReq());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: [{ id: 'l1' }, { id: 'l2' }] });
    // Champs pagination ABSENTS quand non paginé (rétro-compat byte).
    expect(body).not.toHaveProperty('total');
    expect(body).not.toHaveProperty('limit');
    expect(body).not.toHaveProperty('offset');

    // Le SELECT leads exécuté contient le cap historique dur "LIMIT 200",
    // sans OFFSET, sans placeholder de limite.
    const selectCall = db.calls.find(
      (c) => /select \* from leads/i.test(c.sql) && !/count\(\*\)/i.test(c.sql)
    );
    expect(selectCall).toBeDefined();
    expect(selectCall!.sql).toContain('ORDER BY created_at DESC LIMIT 200');
    expect(selectCall!.sql).not.toContain('OFFSET');
    // Aucun COUNT(*) émis dans le chemin non paginé.
    expect(db.calls.some((c) => /count\(\*\)/i.test(c.sql))).toBe(false);
  });

  it('filtre status conservé inchangé en mode non paginé', async () => {
    const { env, db } = makeEnv();
    db.seed('from leads where client_id', []);
    await handleGetClientLeads(env, ADMIN, 'client-1', leadsReq('?status=new'));
    const call = db.calls.find((c) => /select \* from leads/i.test(c.sql))!;
    expect(call.sql).toContain('AND status = ?');
    expect(call.args).toContain('new');
  });
});

describe('S9 — handleGetClientLeads pagination opt-in', () => {
  it('avec limit/offset : réponse { data, total, limit, offset } + SQL paginé', async () => {
    const { env, db } = makeEnv();
    db.seed('count(*)', [{ cnt: 57 }]);
    db.seed('from leads where client_id', [{ id: 'l1' }]);

    const res = await handleGetClientLeads(
      env,
      ADMIN,
      'client-1',
      leadsReq('?limit=20&offset=40')
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: 'l1' }]);
    expect(body.total).toBe(57);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(40);

    const pageCall = db.calls.find(
      (c) => /select \* from leads/i.test(c.sql) && /offset/i.test(c.sql)
    )!;
    expect(pageCall.sql).toContain('LIMIT ? OFFSET ?');
    expect(pageCall.args.slice(-2)).toEqual([20, 40]);
  });

  it('limit clampé à MAX_LIMIT=200 et plancher 1', async () => {
    const { env, db } = makeEnv();
    db.seed('count(*)', [{ cnt: 0 }]);
    db.seed('from leads where client_id', []);

    await handleGetClientLeads(env, ADMIN, 'client-1', leadsReq('?limit=9999'));
    let call = db.calls.find((c) => /offset/i.test(c.sql))!;
    expect(call.args.slice(-2)).toEqual([200, 0]);

    db.calls.length = 0;
    await handleGetClientLeads(env, ADMIN, 'client-1', leadsReq('?limit=0&offset=-5'));
    call = db.calls.find((c) => /offset/i.test(c.sql))!;
    // limit 0 → plancher 1 ; offset négatif → 0.
    expect(call.args.slice(-2)).toEqual([1, 0]);
  });

  it('offset seul (sans limit) active la pagination, limit défaut 200', async () => {
    const { env, db } = makeEnv();
    db.seed('count(*)', [{ cnt: 3 }]);
    db.seed('from leads where client_id', []);
    const res = await handleGetClientLeads(env, ADMIN, 'client-1', leadsReq('?offset=10'));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.limit).toBe(200);
    expect(body.offset).toBe(10);
    expect(body.total).toBe(3);
  });
});

function vitalsReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://x/api/telemetry/web-vitals', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
  });
}

describe('S9 — handlePostWebVitals beacon', () => {
  it('payload valide : 204 + INSERT web_vitals avec valeurs validées', async () => {
    const { env, db } = makeEnv();
    const res = await handlePostWebVitals(
      vitalsReq(
        { name: 'LCP', value: 2400.5, rating: 'good', delta: 0, id: 'sess-1', navigationType: 'navigate' },
        { Referer: 'https://app.intralys.ca/dashboard' }
      ),
      env
    );
    expect(res.status).toBe(204);

    const ins = db.calls.find((c) => /insert into web_vitals/i.test(c.sql))!;
    expect(ins).toBeDefined();
    // bind order: name, value, rating, url, session_id, client_id
    expect(ins.args[0]).toBe('LCP');
    expect(ins.args[1]).toBe(2400.5);
    expect(ins.args[2]).toBe('good');
    expect(ins.args[3]).toBe('https://app.intralys.ca/dashboard');
    expect(ins.args[4]).toBe('sess-1');
    expect(ins.args[5]).toBeNull(); // client_id best-effort → NULL
  });

  it('metric inconnue → 204 sans INSERT', async () => {
    const { env, db } = makeEnv();
    const res = await handlePostWebVitals(vitalsReq({ name: 'FOO', value: 1 }), env);
    expect(res.status).toBe(204);
    expect(db.calls.some((c) => /insert into web_vitals/i.test(c.sql))).toBe(false);
  });

  it('value non finie → 204 sans INSERT', async () => {
    const { env, db } = makeEnv();
    const res = await handlePostWebVitals(vitalsReq({ name: 'CLS', value: 'abc' }), env);
    expect(res.status).toBe(204);
    expect(db.calls.some((c) => /insert into web_vitals/i.test(c.sql))).toBe(false);
  });

  it('value hors borne → clampée [0, 600000]', async () => {
    const { env, db } = makeEnv();
    await handlePostWebVitals(vitalsReq({ name: 'INP', value: 9_999_999 }), env);
    const ins = db.calls.find((c) => /insert into web_vitals/i.test(c.sql))!;
    expect(ins.args[1]).toBe(600000);

    db.calls.length = 0;
    await handlePostWebVitals(vitalsReq({ name: 'INP', value: -50 }), env);
    const ins2 = db.calls.find((c) => /insert into web_vitals/i.test(c.sql))!;
    expect(ins2.args[1]).toBe(0);
  });

  it('rating invalide → NULL (pas de rejet)', async () => {
    const { env, db } = makeEnv();
    await handlePostWebVitals(vitalsReq({ name: 'TTFB', value: 100, rating: 'bogus' }), env);
    const ins = db.calls.find((c) => /insert into web_vitals/i.test(c.sql))!;
    expect(ins.args[2]).toBeNull();
  });

  it('body JSON illisible → 204 sans throw, sans INSERT', async () => {
    const { env, db } = makeEnv();
    const res = await handlePostWebVitals(vitalsReq('{not-json'), env);
    expect(res.status).toBe(204);
    expect(db.calls.some((c) => /insert into web_vitals/i.test(c.sql))).toBe(false);
  });

  it('DB.run throw → toujours 204 (beacon best-effort, jamais bloquant)', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;
    // Force le .run() à throw uniquement sur l'INSERT web_vitals.
    const realPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = realPrepare(sql);
      if (/insert into web_vitals/i.test(sql)) {
        return {
          ...stmt,
          bind: () => ({ ...stmt, run: () => { throw new Error('DB down'); } }),
        } as typeof stmt;
      }
      return stmt;
    });

    const res = await handlePostWebVitals(vitalsReq({ name: 'FCP', value: 800 }), env);
    expect(res.status).toBe(204);
  });
});
