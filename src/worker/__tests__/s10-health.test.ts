// ── s10-health.test.ts — Sprint S10 Manager B ──────────────────────────
// Couvre le champ ADDITIF best-effort `migrations_count` du handler
// `handleHealth` (cf docs/GOLIVE-S10.md §6.4).
//
// ⚠ ÉCRIT, NON EXÉCUTÉ EN VM (VMware) — à exécuter par Rochdi via `bun run test`
// (ou `vitest run`). Couvert par le glob vitest.config.ts:
//   include: ['src/worker/__tests__/**/*.test.ts', ...]
//
// Garanties testées (§6.4) :
//   (a) DB ok + _migrations COUNT=77 → 200, shape existant intact + migrations_count:77
//   (b) COUNT(*) _migrations échoue (throw)  → 200/ok, shape intact, migrations_count OMIS
//   (c) DB KO (SELECT 1 throw)               → 503 STRICTEMENT identique, pas de migrations_count
//   (d) non-régression : { status, db, version, uptime_s } présents, mêmes types,
//       version === '2.1.0'
//
// Nom réel de la table migrations CONFIRMÉ = `_migrations`
//   (scripts/migrate.ts:190 — `CREATE TABLE IF NOT EXISTS _migrations (filename ...)`).

import { describe, it, expect } from 'vitest';
import { handleHealth } from '../health';
import type { Env } from '../types';

/**
 * Construit un Env mock dont DB.prepare(sql) renvoie un statement dont
 * `.first()` se comporte selon le SQL :
 *   - SQL contient 'SELECT 1'                → résout `health1` (ou throw si select1Throws)
 *   - SQL contient 'COUNT(*) AS c FROM _migrations' → résout `migrationsRow`
 *                                              (ou throw si migrationsThrows)
 */
function makeEnv(opts: {
  select1Throws?: boolean;
  migrationsThrows?: boolean;
  migrationsRow?: any;
}): Env {
  const db = {
    prepare(sql: string) {
      const lower = sql.toLowerCase();
      return {
        bind() { return this; },
        first: async () => {
          if (lower.includes('select 1')) {
            if (opts.select1Throws) throw new Error('DB connection failed');
            return { '1': 1 };
          }
          if (lower.includes('count(*)') && lower.includes('_migrations')) {
            if (opts.migrationsThrows) throw new Error('no such table: _migrations');
            return opts.migrationsRow ?? null;
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: {} }),
      };
    },
  };
  return { DB: db } as unknown as Env;
}

describe('S10 §6.4 — /api/health migrations_count (best-effort additif)', () => {
  it('(a) DB ok + _migrations COUNT=77 → 200, shape intact + migrations_count:77', async () => {
    const env = makeEnv({ migrationsRow: { c: 77 } });
    const res = await handleHealth(env, 5);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    // Shape existant INCHANGÉ
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.version).toBe('2.1.0');
    expect(body.uptime_s).toBe(5);
    // Champ additif présent et exact
    expect(body.migrations_count).toBe(77);
    expect(typeof body.migrations_count).toBe('number');
  });

  it('(b) COUNT(*) _migrations échoue → 200/ok, shape intact, migrations_count OMIS', async () => {
    const env = makeEnv({ migrationsThrows: true });
    const res = await handleHealth(env, 12);
    const body = await res.json() as any;

    // JAMAIS de 503 à cause du champ best-effort
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.version).toBe('2.1.0');
    expect(body.uptime_s).toBe(12);
    // Champ OMIS (décision Manager B : omission, pas null)
    expect('migrations_count' in body).toBe(false);
    expect(body.migrations_count).toBeUndefined();
  });

  it('(b-bis) _migrations renvoie une ligne sans entier → champ OMIS, 200/ok', async () => {
    const env = makeEnv({ migrationsRow: { c: null } });
    const res = await handleHealth(env, 1);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect('migrations_count' in body).toBe(false);
  });

  it('(c) DB KO (SELECT 1 throw) → 503 STRICTEMENT identique, pas de migrations_count', async () => {
    const env = makeEnv({ select1Throws: true });
    const res = await handleHealth(env, 5);
    const body = await res.json() as any;

    // Branche 503 inchangée à l'octet près
    expect(res.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.db).toBe('error');
    expect(body.details).toBe('DB connection failed');
    expect(body.version).toBe('2.1.0');
    expect(body.uptime_s).toBe(5);
    // Le champ best-effort n'est JAMAIS ajouté au payload d'erreur
    expect('migrations_count' in body).toBe(false);
    // Aucune lecture _migrations tentée quand DB KO (court-circuit sur 503)
  });

  it('(d) non-régression : clés/types existants stables, version===2.1.0', async () => {
    // Cas succès
    const okBody = await (await handleHealth(makeEnv({ migrationsRow: { c: 3 } }), 9)).json() as any;
    expect(typeof okBody.status).toBe('string');
    expect(typeof okBody.db).toBe('string');
    expect(typeof okBody.version).toBe('string');
    expect(typeof okBody.uptime_s).toBe('number');
    expect(okBody.version).toBe('2.1.0');

    // Cas erreur
    const errRes = await handleHealth(makeEnv({ select1Throws: true }), 9);
    const errBody = await errRes.json() as any;
    expect(errRes.status).toBe(503);
    expect(typeof errBody.status).toBe('string');
    expect(typeof errBody.db).toBe('string');
    expect(typeof errBody.details).toBe('string');
    expect(typeof errBody.version).toBe('string');
    expect(typeof errBody.uptime_s).toBe('number');
    expect(errBody.version).toBe('2.1.0');
  });
});
