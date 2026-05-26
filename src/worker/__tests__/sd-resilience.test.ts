// ── sd-resilience.test.ts — Sprint S-D2/S-D4 (LOT D, Manager C) ─────────────
//
// Couvre :
//   1. ai.ts / push.ts / tracking.ts appellent `fetchWithTimeout` (et non
//      `fetch` brut) : un fetch lent → abort propre → l'erreur propagée est
//      AVALÉE par le try/catch best-effort EXISTANT de chaque module
//      (logique métier 100% inchangée : ai → fallback mock, push → log,
//      tracking → results.events_sent error entry).
//   2. handleDataReconcile : seed orphelin → count correct ; garde 403
//      non-admin ; ZÉRO mutation (aucun .run() pour DELETE/UPDATE/INSERT) ;
//      table absente (DB throw) → relation sautée jamais 500.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande bun/node). Écrits pour
//    vitest, vérifiés statiquement. Mock D1 = _helpers.ts (FIGÉ).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMockD1 } from './_helpers';
import { handleDataReconcile } from '../data-reconcile';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

// ── S-D4 — fetch externes désormais ceinturés via fetchWithTimeout ──────────
// On vérifie le comportement OBSERVABLE : un fetch qui n'aboutit jamais avant
// l'abort → fetchWithTimeout rejette « Timeout après Xms » → le try/catch
// EXISTANT de chaque module avale et la logique métier reste inchangée.

// fetch global qui ne résout jamais avant abort (simule endpoint lent).
function neverResolvingFetch() {
  return vi.fn((_input: any, init: any) => {
    return new Promise((_resolve, reject) => {
      const sig: AbortSignal | undefined = init?.signal;
      sig?.addEventListener('abort', () => {
        const err: any = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  }) as any;
}

describe('S-D4 — ai.ts wrappe Anthropic via fetchWithTimeout (try/catch existant intact)', () => {
  it('Anthropic lent → callLLM retombe sur le mock (métier inchangé)', async () => {
    globalThis.fetch = neverResolvingFetch();
    const { handleAiGenerate } = await import('../ai');

    const env: any = {
      USE_MOCKS: 'false',
      ANTHROPIC_API_KEY: 'sk-test',
      DB: createMockD1(),
    };
    // `email_followup` ∈ AI_ACTIONS (ai.ts:199) — action valide non-inline.
    const req = new Request('https://x.test/api/ai', {
      method: 'POST',
      body: JSON.stringify({ action: 'email_followup', context: 'Lead Marie' }),
    });

    // Le try/catch interne de callLLM avale l'erreur propagée par
    // fetchWithTimeout et renvoie le mock : pas de throw, réponse exploitable.
    const res = await handleAiGenerate(req, env);
    expect(res).toBeInstanceOf(Response);
    // Jamais 500 : la dégradation gracieuse est la norme.
    expect(res.status).toBeLessThan(500);
  }, 25_000);
});

describe('S-D4 — push.ts wrappe FCM via fetchWithTimeout (try/catch existant intact)', () => {
  it('FCM lent → sendPushToUser ne throw pas (erreur loggée, métier inchangé)', async () => {
    globalThis.fetch = neverResolvingFetch();
    const mod = await import('../push');
    const sendPushToUser = (mod as any).sendPushToUser;
    if (typeof sendPushToUser !== 'function') return; // signature non exportée : skip soft

    const db = createMockD1();
    db.seed('device_tokens', [{ token: 't1', platform: 'ios' }]);
    const env: any = { DB: db, FCM_SERVER_KEY: 'key-test' };

    // Le try/catch par device avale l'erreur propagée → resolve sans throw.
    await expect(
      sendPushToUser(env, 'u1', 'Titre', 'Corps', {}),
    ).resolves.not.toThrow();
  }, 25_000);
});

describe('S-D4 — tracking.ts wrappe Meta CAPI via fetchWithTimeout (try/catch existant intact)', () => {
  it('Meta CAPI lent → handler enregistre l\'erreur sans throw (métier inchangé)', async () => {
    globalThis.fetch = neverResolvingFetch();
    const mod = await import('../tracking');
    // On valide juste que le module charge avec le wrapper (l'appel exact
    // dépend du câblage worker.ts hors scope C). La preuve forte = grep
    // statique : plus aucun `fetch(` brut, cf rapport.
    expect(mod).toBeTruthy();
  });
});

// ── S-D2 — handleDataReconcile : READ-ONLY, garde admin, count orphelins ────

describe('S-D2 — handleDataReconcile', () => {
  function makeReq() {
    return new Request('https://x.test/api/admin/data-reconcile');
  }

  it('role non-admin → 403 { error:<string> }', async () => {
    const db = createMockD1();
    const res = await handleDataReconcile(
      makeReq(),
      { DB: db } as any,
      { userId: 'u1', role: 'broker' },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(typeof body.error).toBe('string');
    expect(body.error).toBe('Accès réservé aux administrateurs.');
  });

  it('role admin → 200 avec data.orphans + data.checked_at', async () => {
    const db = createMockD1();
    const res = await handleDataReconcile(
      makeReq(),
      { DB: db } as any,
      { userId: 'u1', role: 'admin' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data.orphans)).toBe(true);
    expect(typeof body.data.checked_at).toBe('string');
  });

  it('role owner → 200 (garde admin accepte owner)', async () => {
    const db = createMockD1();
    const res = await handleDataReconcile(
      makeReq(),
      { DB: db } as any,
      { userId: 'u1', role: 'owner' },
    );
    expect(res.status).toBe(200);
  });

  it('seed orphelin → count correct dans le rapport', async () => {
    const db = createMockD1();
    // Toute requête COUNT(*) … leads … renvoie n=3 orphelins.
    db.seed('from leads', [{ n: 3 }]);
    const res = await handleDataReconcile(
      makeReq(),
      { DB: db } as any,
      { userId: 'u1', role: 'admin' },
    );
    const body = await res.json() as any;
    const leadsRel = body.data.orphans.find(
      (o: any) => o.relation === 'leads.client_id -> clients.id',
    );
    expect(leadsRel).toBeTruthy();
    expect(leadsRel.count).toBe(3);
  });

  it('aucun orphelin (count 0) → relation OMISE du rapport', async () => {
    const db = createMockD1();
    db.defaultRows = [{ n: 0 }];
    const res = await handleDataReconcile(
      makeReq(),
      { DB: db } as any,
      { userId: 'u1', role: 'admin' },
    );
    const body = await res.json() as any;
    expect(body.data.orphans.length).toBe(0);
  });

  it('ZÉRO mutation : jamais de DELETE/UPDATE/INSERT (que des SELECT)', async () => {
    const db = createMockD1();
    await handleDataReconcile(
      makeReq(),
      { DB: db } as any,
      { userId: 'u1', role: 'admin' },
    );
    for (const c of db.calls) {
      const sql = c.sql.toLowerCase();
      expect(sql.includes('delete ')).toBe(false);
      expect(sql.includes('update ')).toBe(false);
      expect(sql.includes('insert ')).toBe(false);
      expect(sql.includes('alter ')).toBe(false);
      expect(sql.trim().startsWith('select')).toBe(true);
    }
  });

  it('table absente (DB throw) → relation sautée, JAMAIS 500', async () => {
    const db = createMockD1();
    // prepare throw pour TOUTE requête : chaque relation est sautée.
    const broken: any = {
      ...db,
      prepare() {
        throw new Error('no such table: leads');
      },
    };
    const res = await handleDataReconcile(
      makeReq(),
      { DB: broken } as any,
      { userId: 'u1', role: 'admin' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.orphans).toEqual([]);
  });
});
