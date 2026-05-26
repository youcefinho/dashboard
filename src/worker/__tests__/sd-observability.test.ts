// ── sd-observability.test.ts — Sprint S-D §6.3 (LOT D, Manager B) ──────────
//
// Couvre `handleAdminWebVitals` (src/worker/observability-ops.ts) :
//   1. Garde admin : role ∉ {admin,owner} → 403 { error:<string> }.
//   2. Agrégation : seed web_vitals → count/avg/p75 corrects + shape §6.3.
//   3. Best-effort : table absente / SQL throw → { data:{ metrics:[] } } 200,
//      JAMAIS 500/503.
//   4. Période : invalide → '7d' ; '24h'/'30d' acceptés.
//
// health.ts NON modifié par Manager B (anti-sur-scope §6.4) → aucun test de
// non-régression health ici (couvert par s10-health.test.ts, intact).
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande bun/node). Écrits pour
//    vitest, vérifiés statiquement. Glob : src/worker/__tests__/**/*.test.ts.

import { describe, it, expect } from 'vitest';
import { handleAdminWebVitals } from '../observability-ops';
import type { Env } from '../types';

// Mock D1 spécialisé : route selon le SQL.
//   - 'select datetime'                 → { since } (borne basse)
//   - 'group by metric_name'            → agrégat count/avg (.all)
//   - 'order by value asc' + 'offset'   → ligne p75 (.first) selon metric_name
// `throwOnAgg` / `throwOnSince` simulent table absente / DB KO.
function makeEnv(opts: {
  aggRows?: Array<{ metric_name: string; count: number; avg: number }>;
  // p75 par metric_name (valeur renvoyée par la requête nearest-rank)
  p75?: Record<string, number>;
  since?: string;
  throwOnAgg?: boolean;
  throwOnSince?: boolean;
}): Env {
  const db = {
    prepare(sql: string) {
      const lower = sql.toLowerCase();
      let bound: any[] = [];
      const stmt: any = {
        bind(...a: any[]) { bound = a; return stmt; },
        all: async () => {
          if (lower.includes('group by metric_name')) {
            if (opts.throwOnAgg) throw new Error('no such table: web_vitals');
            return { results: opts.aggRows ?? [] };
          }
          return { results: [] };
        },
        first: async () => {
          if (lower.includes("select datetime('now'")) {
            if (opts.throwOnSince) throw new Error('DB KO');
            return { since: opts.since ?? '2026-05-10 00:00:00' };
          }
          if (lower.includes('order by value asc') && lower.includes('offset')) {
            const metric = bound[0] as string;
            const v = opts.p75?.[metric];
            return typeof v === 'number' ? { value: v } : null;
          }
          return null;
        },
        run: async () => ({ success: true, meta: {} }),
      };
      return stmt;
    },
  };
  return { DB: db } as unknown as Env;
}

function req(period?: string): Request {
  const q = period ? `?period=${period}` : '';
  return new Request(`https://x.test/api/admin/web-vitals${q}`);
}

const ADMIN = { userId: 'u1', role: 'admin' };

describe('S-D §6.3 — handleAdminWebVitals : garde admin', () => {
  it('role non-admin → 403 avec error string brute', async () => {
    const env = makeEnv({});
    const res = await handleAdminWebVitals(
      req(), env, { userId: 'u1', role: 'broker' },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(typeof body.error).toBe('string');
    expect(body.error).toBe('Accès réservé aux administrateurs.');
  });

  it('role owner → autorisé (200)', async () => {
    const env = makeEnv({ aggRows: [] });
    const res = await handleAdminWebVitals(
      req(), env, { userId: 'u1', role: 'owner' },
    );
    expect(res.status).toBe(200);
  });
});

describe('S-D §6.3 — agrégation count/avg/p75', () => {
  it('seed web_vitals → metrics agrégées + shape exact §6.3', async () => {
    const env = makeEnv({
      aggRows: [
        { metric_name: 'LCP', count: 4, avg: 2500.456 },
        { metric_name: 'CLS', count: 2, avg: 0.123 },
      ],
      p75: { LCP: 3200.789, CLS: 0.2 },
      since: '2026-05-10 00:00:00',
    });
    const res = await handleAdminWebVitals(req('7d'), env, ADMIN);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Shape §6.3 : { data: { metrics:[...], period, since } }
    expect(body.data.period).toBe('7d');
    expect(body.data.since).toBe('2026-05-10 00:00:00');
    expect(Array.isArray(body.data.metrics)).toBe(true);
    expect(body.data.metrics).toHaveLength(2);

    const lcp = body.data.metrics.find((m: any) => m.metric_name === 'LCP');
    expect(lcp.count).toBe(4);
    expect(lcp.avg).toBe(2500.46);   // round2
    expect(lcp.p75).toBe(3200.79);   // round2 nearest-rank

    const cls = body.data.metrics.find((m: any) => m.metric_name === 'CLS');
    expect(cls.count).toBe(2);
    expect(cls.avg).toBe(0.12);
    expect(cls.p75).toBe(0.2);

    // Chaque metric a EXACTEMENT les 4 clés contractuelles
    for (const m of body.data.metrics) {
      expect(Object.keys(m).sort()).toEqual(
        ['avg', 'count', 'metric_name', 'p75'],
      );
    }
  });

  it('metric sans p75 retrouvé (offset hors plage) → p75 = 0', async () => {
    const env = makeEnv({
      aggRows: [{ metric_name: 'INP', count: 1, avg: 180 }],
      p75: {}, // aucune ligne renvoyée par la requête p75
    });
    const res = await handleAdminWebVitals(req(), env, ADMIN);
    const body = await res.json() as any;
    expect(body.data.metrics[0].p75).toBe(0);
    expect(body.data.metrics[0].count).toBe(1);
  });
});

describe('S-D §6.3 — best-effort (JAMAIS 500/503)', () => {
  it('table absente / SQL throw sur agrégat → 200 metrics:[]', async () => {
    const env = makeEnv({ throwOnAgg: true });
    const res = await handleAdminWebVitals(req('30d'), env, ADMIN);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.metrics).toEqual([]);
    expect(body.data.period).toBe('30d');
    expect(typeof body.data.since).toBe('string');
  });

  it('agrégat vide → 200 metrics:[]', async () => {
    const env = makeEnv({ aggRows: [] });
    const res = await handleAdminWebVitals(req(), env, ADMIN);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.metrics).toEqual([]);
  });

  it('lecture `since` KO → fallback ISO JS, agrégat toujours servi, 200', async () => {
    const env = makeEnv({
      throwOnSince: true,
      aggRows: [{ metric_name: 'TTFB', count: 3, avg: 90 }],
      p75: { TTFB: 120 },
    });
    const res = await handleAdminWebVitals(req('24h'), env, ADMIN);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.period).toBe('24h');
    expect(typeof body.data.since).toBe('string');         // fallback ISO
    expect(body.data.since).toMatch(/\d{4}-\d{2}-\d{2}T/);  // ISO format
    expect(body.data.metrics[0].metric_name).toBe('TTFB');
  });
});

describe('S-D §6.3 — paramètre period', () => {
  it('period invalide → défaut 7d', async () => {
    const env = makeEnv({ aggRows: [] });
    const res = await handleAdminWebVitals(req('bogus'), env, ADMIN);
    const body = await res.json() as any;
    expect(body.data.period).toBe('7d');
  });

  it('period absent → défaut 7d', async () => {
    const env = makeEnv({ aggRows: [] });
    const res = await handleAdminWebVitals(req(), env, ADMIN);
    const body = await res.json() as any;
    expect(body.data.period).toBe('7d');
  });

  it('period 24h et 30d acceptés tels quels', async () => {
    const env = makeEnv({ aggRows: [] });
    const b24 = await (await handleAdminWebVitals(req('24h'), env, ADMIN)).json() as any;
    expect(b24.data.period).toBe('24h');
    const b30 = await (await handleAdminWebVitals(req('30d'), env, ADMIN)).json() as any;
    expect(b30.data.period).toBe('30d');
  });
});
