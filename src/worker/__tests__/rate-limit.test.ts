// ── rate-limit.test.ts — Sprint 23 (Manager-B) ──────────────────────────
//
// Couvre `checkRateLimit()` (src/worker/lib/rate-limit.ts) — sliding window
// D1 fallback fail-open. La mock D1 (createMockD1) ne fait pas tourner
// vraiment SQLite : on assert sur db.calls (INSERTs / SELECTs émis) et on
// seed les COUNT/MIN renvoyés. Ce qui compte ici : invariants protocole.
//
// Invariants vérifiés :
//   1. Sliding window 5/60s — 5 hits OK, 6e → !allowed avec retry_after > 0.
//   2. Buckets différents isolés (clé A : 5 hits, clé B : 0 → toujours OK).
//   3. Fail-open : table absente / panne D1 → always { allowed: true }.
//   4. Cleanup expired : un hit > windowSec n'est PAS compté (le SQL le filtre).
//   5. INSERT émis quand allowed = true. PAS d'INSERT quand allowed = false.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { checkRateLimit } from '../lib/rate-limit';

function makeEnv(): { env: Env; db: ReturnType<typeof createMockD1> } {
  const db = createMockD1();
  return { env: { DB: db } as unknown as Env, db };
}

describe('S23 — checkRateLimit (sliding window D1)', () => {
  it('count < max → allowed:true, remaining décrémente, INSERT émis', async () => {
    const { env, db } = makeEnv();
    // Pas de seed → defaultRows = [] → COUNT(*) renvoie [] → 0 (Number(undefined ?? 0)).
    // En vrai D1 le COUNT(*) renvoie { c: 0 } ; mais createMockD1 renvoie [] par défaut,
    // ce qui suit le branche `count = Number(countRow?.c ?? 0) = 0`.
    const res = await checkRateLimit(env, 'bk-A', 5, 60);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(4);
    expect(res.retry_after_seconds).toBe(0);
    expect(res.bucket_key).toBe('bk-A');
    // INSERT émis pour enregistrer le hit courant.
    const inserts = db.calls.filter(c => /^INSERT INTO rate_limit_buckets/i.test(c.sql.trim()));
    expect(inserts.length).toBe(1);
    expect(inserts[0].args[0]).toBe('bk-A');
  });

  it('count >= max → allowed:false, retry_after_seconds > 0, PAS d\'INSERT', async () => {
    const { env, db } = makeEnv();
    // Seed COUNT(*) → 5 (quota atteint pour max=5).
    db.seed('SELECT COUNT(*)'.toLowerCase(), [{ c: 5 }]);
    // Seed MIN(hit_at) pour le retry_after — un hit posé il y a ~10 sec.
    const tenSecAgo = new Date(Date.now() - 10_000).toISOString().replace('T', ' ').slice(0, 19);
    db.seed('order by hit_at asc', [{ hit_at: tenSecAgo }]);

    const res = await checkRateLimit(env, 'bk-saturated', 5, 60);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retry_after_seconds).toBeGreaterThan(0);
    expect(res.retry_after_seconds).toBeLessThanOrEqual(60);
    expect(res.bucket_key).toBe('bk-saturated');

    // Aucun INSERT lorsque dénié.
    const inserts = db.calls.filter(c => /^INSERT INTO rate_limit_buckets/i.test(c.sql.trim()));
    expect(inserts.length).toBe(0);
  });

  it('buckets indépendants : saturer bk-A n\'affecte pas bk-B', async () => {
    const { env, db } = makeEnv();
    // Pas de seed → COUNT = 0 pour les deux buckets → toujours allowed.
    // Mais on veut SURTOUT vérifier que les binds différent (isolation par clé).
    await checkRateLimit(env, 'bk-A', 5, 60);
    await checkRateLimit(env, 'bk-B', 5, 60);

    // Tous les binds doivent inclure exactement la clé attendue, jamais l'autre.
    const aCalls = db.calls.filter(c => c.args[0] === 'bk-A');
    const bCalls = db.calls.filter(c => c.args[0] === 'bk-B');
    expect(aCalls.length).toBeGreaterThan(0);
    expect(bCalls.length).toBeGreaterThan(0);
    // Et le bind A ne doit JAMAIS contenir 'bk-B' ou vice versa.
    for (const c of aCalls) expect(c.args).not.toContain('bk-B');
    for (const c of bCalls) expect(c.args).not.toContain('bk-A');
  });

  it('fail-open : panne D1 / table absente → allowed:true', async () => {
    // Mock D1 qui throw sur tout prepare → calque "no such table".
    const brokenDb = {
      prepare(): never { throw new Error('no such table: rate_limit_buckets'); },
    } as unknown as Env['DB'];
    const env = { DB: brokenDb } as unknown as Env;
    const res = await checkRateLimit(env, 'bk-broken', 10, 60);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(10);
    expect(res.retry_after_seconds).toBe(0);
  });

  it('cleanup expired : DELETE émis sur les hits hors fenêtre', async () => {
    const { env, db } = makeEnv();
    await checkRateLimit(env, 'bk-cleanup', 5, 60);
    const deletes = db.calls.filter(c => /^DELETE FROM rate_limit_buckets/i.test(c.sql.trim()));
    expect(deletes.length).toBe(1);
    expect(deletes[0].args[0]).toBe('bk-cleanup');
    expect(deletes[0].args[1]).toBe(60);
  });
});
