// ── admin-analytics-real.test.ts — LOT RÉEL Manager C (§6.C.3) ─────────
// Couvre le passage FABRIQUÉ → RÉEL/HONNÊTE de `handleAdminOverview` :
//   - activeMonthly = COUNT(DISTINCT user_id) FROM feature_events (RÉEL),
//     `null` si la table est absente (JAMAIS le proxy `*0.68`).
//   - leadsConversions = GROUP BY date(created_at) sur leads (RÉEL),
//     `[]` si table absente (JAMAIS du Math.random).
//   - mrr === null (JAMAIS 8420), tous les deltas === null.
//   - Aucun champ usersGrowth (série supprimée — était 100% Math.random).
//   - Préservation des champs déjà réels : totalUsers, leadsThisMonth,
//     conversionRate (réel si leads ce mois, null sinon).
//
// ⚠ ÉCRIT, NON EXÉCUTÉ EN VM (VMware) — `bun run test` / `vitest run` par Rochdi.
// Couvert par glob vitest.config.ts: include ['src/worker/__tests__/**/*.test.ts'].

import { describe, it, expect } from 'vitest';
import {
  handleAdminOverview,
  handleAdminActivityHeatmap,
  handleAdminFeaturesUsage,
} from '../admin-analytics';
import type { Env } from '../types';

const ADMIN = { userId: 'u1', role: 'admin' };

/**
 * Env mock : DB.prepare(sql) route selon le SQL.
 *   - 'count(*) as c from users'                → usersRow
 *   - 'from leads where created_at'             → leadsMonthRow (count mois)
 *   - "status = 'won'"                          → wonRow
 *   - 'count(distinct user_id) ... feature_events' → activeRow | throw
 *   - 'group by date(created_at)'               → .all() seriesRows | throw
 */
function makeEnv(opts: {
  usersRow?: any;
  leadsMonthRow?: any;
  wonRow?: any;
  activeRow?: any;
  featureEventsThrows?: boolean;
  seriesRows?: any[];
  seriesThrows?: boolean;
}): Env {
  const db = {
    prepare(sql: string) {
      const s = sql.toLowerCase();
      return {
        bind() { return this; },
        first: async () => {
          if (s.includes('from users')) return opts.usersRow ?? { c: 0 };
          if (s.includes("status = 'won'")) return opts.wonRow ?? { c: 0 };
          if (s.includes('count(distinct user_id)') && s.includes('feature_events')) {
            if (opts.featureEventsThrows) throw new Error('no such table: feature_events');
            return opts.activeRow ?? null;
          }
          if (s.includes('from leads where created_at')) return opts.leadsMonthRow ?? { c: 0 };
          return null;
        },
        all: async () => {
          if (s.includes('group by date(created_at)')) {
            if (opts.seriesThrows) throw new Error('no such table: leads');
            return { results: opts.seriesRows ?? [] };
          }
          return { results: [] };
        },
        run: async () => ({ success: true, meta: {} }),
      };
    },
  };
  return { DB: db } as unknown as Env;
}

function req() {
  return new Request('https://x/api/admin/overview?period=30d');
}

describe('LOT RÉEL §6.C.3 — handleAdminOverview : fabriqué → réel/honnête', () => {
  it('refuse les non-admins (403)', async () => {
    const res = await handleAdminOverview(req(), makeEnv({}), { userId: 'u', role: 'member' });
    expect(res.status).toBe(403);
  });

  it('activeMonthly = COUNT(DISTINCT user_id) feature_events RÉEL (pas le proxy *0.68)', async () => {
    const env = makeEnv({
      usersRow: { c: 100 },
      leadsMonthRow: { c: 40 },
      wonRow: { c: 8 },
      activeRow: { c: 37 },
      seriesRows: [{ d: '2026-05-01', leads: 12, conversions: 3 }],
    });
    const body = (await (await handleAdminOverview(req(), env, ADMIN)).json()) as any;

    expect(body.data.activeMonthly).toBe(37);
    // L'ancien proxy aurait donné Math.floor(100 * 0.68) = 68 — interdit.
    expect(body.data.activeMonthly).not.toBe(68);
  });

  it('activeMonthly = null si feature_events absente (JAMAIS un proxy inventé)', async () => {
    const env = makeEnv({
      usersRow: { c: 100 },
      leadsMonthRow: { c: 40 },
      wonRow: { c: 8 },
      featureEventsThrows: true,
      seriesRows: [],
    });
    const body = (await (await handleAdminOverview(req(), env, ADMIN)).json()) as any;

    expect(body.data.activeMonthly).toBeNull();
    expect(body.data.activeMonthly).not.toBe(68);
  });

  it('mrr === null (JAMAIS 8420) et tous les deltas === null', async () => {
    const env = makeEnv({
      usersRow: { c: 12 },
      leadsMonthRow: { c: 5 },
      wonRow: { c: 1 },
      activeRow: { c: 4 },
      seriesRows: [],
    });
    const body = (await (await handleAdminOverview(req(), env, ADMIN)).json()) as any;

    expect(body.data.mrr).toBeNull();
    expect(body.data.mrr).not.toBe(8420);
    expect(body.data.deltaTotalUsers).toBeNull();
    expect(body.data.deltaActiveMonthly).toBeNull();
    expect(body.data.deltaLeads).toBeNull();
    expect(body.data.deltaConversion).toBeNull();
    expect(body.data.deltaMrr).toBeNull();
  });

  it('leadsConversions = série RÉELLE GROUP BY date(created_at)', async () => {
    const seriesRows = [
      { d: '2026-05-01', leads: 10, conversions: 2 },
      { d: '2026-05-02', leads: 7, conversions: 3 },
    ];
    const env = makeEnv({
      usersRow: { c: 50 },
      leadsMonthRow: { c: 17 },
      wonRow: { c: 5 },
      activeRow: { c: 20 },
      seriesRows,
    });
    const body = (await (await handleAdminOverview(req(), env, ADMIN)).json()) as any;

    expect(body.data.leadsConversions).toEqual([
      { label: '2026-05-01', leads: 10, conversions: 2 },
      { label: '2026-05-02', leads: 7, conversions: 3 },
    ]);
  });

  it('leadsConversions = [] si table leads absente (JAMAIS du Math.random)', async () => {
    const env = makeEnv({
      usersRow: { c: 0 },
      leadsMonthRow: { c: 0 },
      activeRow: null,
      seriesThrows: true,
    });
    const body = (await (await handleAdminOverview(req(), env, ADMIN)).json()) as any;

    expect(body.data.leadsConversions).toEqual([]);
    // Plus aucune série fabriquée d'utilisateurs.
    expect('usersGrowth' in body.data).toBe(false);
  });

  it('préserve les champs déjà réels : totalUsers + conversionRate réel', async () => {
    const env = makeEnv({
      usersRow: { c: 142 },
      leadsMonthRow: { c: 40 },
      wonRow: { c: 13 },
      activeRow: { c: 60 },
      seriesRows: [],
    });
    const body = (await (await handleAdminOverview(req(), env, ADMIN)).json()) as any;

    expect(body.data.totalUsers).toBe(142);
    expect(body.data.leadsThisMonth).toBe(40);
    // conversionRate RÉEL = wonCount / leadsThisMonth = 13/40 = 0.325 — calculé,
    // distinct du 0.22 hardcodé d'avant (ratio volontairement non-0.22).
    expect(body.data.conversionRate).toBeCloseTo(13 / 40, 5);
    expect(body.data.conversionRate).not.toBe(0.22);
  });

  it('conversionRate === null quand aucun lead ce mois (honnête, pas 0.22 inventé)', async () => {
    const env = makeEnv({
      usersRow: { c: 10 },
      leadsMonthRow: { c: 0 },
      wonRow: { c: 0 },
      activeRow: { c: 2 },
      seriesRows: [],
    });
    const body = (await (await handleAdminOverview(req(), env, ADMIN)).json()) as any;

    expect(body.data.conversionRate).toBeNull();
    expect(body.data.conversionRate).not.toBe(0.22);
  });
});

// ── LOT RÉEL-bis — handleAdminActivityHeatmap ───────────────────────────
// Couvre le passage FABRIQUÉ → RÉEL/HONNÊTE :
//   - heatmap = agrégat RÉEL feature_events GROUP BY dow,hour.
//   - table absente / vide ⇒ grille 7×24 de ZÉROS (JAMAIS le jitter
//     Math.random / pattern "business hours" d'avant).
//   - structure de réponse préservée : { data: { heatmap: number[7][24] } }.

function heatmapEnv(opts: { heatmapRows?: any[]; throws?: boolean }): Env {
  const db = {
    prepare(sql: string) {
      const s = sql.toLowerCase();
      return {
        bind() { return this; },
        first: async () => null,
        all: async () => {
          if (s.includes('from feature_events') && s.includes('group by dow, hour')) {
            if (opts.throws) throw new Error('no such table: feature_events');
            return { results: opts.heatmapRows ?? [] };
          }
          return { results: [] };
        },
        run: async () => ({ success: true, meta: {} }),
      };
    },
  };
  return { DB: db } as unknown as Env;
}

function heatReq() {
  return new Request('https://x/api/admin/activity-heatmap?period=7d');
}

describe('LOT RÉEL-bis — handleAdminActivityHeatmap : fabriqué → réel/honnête', () => {
  it('refuse les non-admins (403)', async () => {
    const res = await handleAdminActivityHeatmap(heatReq(), heatmapEnv({}), { userId: 'u', role: 'member' });
    expect(res.status).toBe(403);
  });

  it('heatmap = agrégat RÉEL feature_events (cellules ciblées, reste à 0)', async () => {
    const env = heatmapEnv({
      heatmapRows: [
        { dow: 0, hour: 9, c: 12 },   // Lundi 9h
        { dow: 4, hour: 14, c: 7 },   // Vendredi 14h
      ],
    });
    const body = (await (await handleAdminActivityHeatmap(heatReq(), env, ADMIN)).json()) as any;
    const grid = body.data.heatmap as number[][];

    expect(grid.length).toBe(7);
    expect(grid[0].length).toBe(24);
    expect(grid[0][9]).toBe(12);
    expect(grid[4][14]).toBe(7);
    // Cellule sans event = 0 RÉEL, pas un jitter inventé.
    expect(grid[2][3]).toBe(0);
  });

  it('table feature_events absente ⇒ grille 7×24 de ZÉROS (JAMAIS le jitter Math.random)', async () => {
    const env = heatmapEnv({ throws: true });
    const body = (await (await handleAdminActivityHeatmap(heatReq(), env, ADMIN)).json()) as any;
    const grid = body.data.heatmap as number[][];

    expect(grid.length).toBe(7);
    expect(grid.every(row => row.length === 24)).toBe(true);
    // 100% à 0 : aucune valeur fabriquée (l'ancien fallback donnait des
    // bases 8/28/36 + jitter — strictement interdit maintenant).
    expect(grid.every(row => row.every(v => v === 0))).toBe(true);
  });

  it('aucune ligne (table vide) ⇒ grille de zéros, pas de synthetic', async () => {
    const env = heatmapEnv({ heatmapRows: [] });
    const body = (await (await handleAdminActivityHeatmap(heatReq(), env, ADMIN)).json()) as any;
    const grid = body.data.heatmap as number[][];

    expect(grid.every(row => row.every(v => v === 0))).toBe(true);
  });
});

// ── LOT RÉEL-bis — handleAdminFeaturesUsage ─────────────────────────────
// Couvre le passage FABRIQUÉ → RÉEL/HONNÊTE :
//   - sessions/uniqueUsers = COUNT / COUNT(DISTINCT) RÉELS feature_events.
//   - lastUsedAt = MAX(event_time) RÉEL, ou null si jamais utilisée
//     (JAMAIS une date Math.random).
//   - trend30d = COUNT par jour RÉEL, 0 si pas d'event (JAMAIS le sin/jitter).
//   - by_role = ratios RÉELS user_id distinct / users du rôle, 0 si pas de
//     source (JAMAIS les proxies +0.15/-0.25).
//   - table absente ⇒ tout à 0 / null honnête, structure préservée.

function featEnv(opts: {
  usersCount?: number;
  usersByRole?: { role: string; c: number }[];
  perFeature?: Record<string, { sessions: number; unique_users: number; last_ts: number | null }>;
  trendByFeature?: Record<string, { d: string; c: number }[]>;
  roleByFeature?: Record<string, { role: string; u: number }[]>;
  featureEventsThrows?: boolean;
}): Env {
  const db = {
    prepare(sql: string) {
      const s = sql.toLowerCase();
      let boundId: string | undefined;
      const api: any = {
        bind(...args: any[]) { boundId = args[0]; return api; },
        first: async () => {
          if (s.includes('count(*) as c from users')) return { c: opts.usersCount ?? 0 };
          if (s.includes('count(*) as sessions') && s.includes('feature_events')) {
            if (opts.featureEventsThrows) throw new Error('no such table: feature_events');
            const pf = opts.perFeature?.[boundId as string];
            return pf ?? { sessions: 0, unique_users: 0, last_ts: null };
          }
          return null;
        },
        all: async () => {
          if (s.includes('from users group by role')) {
            return { results: opts.usersByRole ?? [] };
          }
          if (s.includes("strftime('%j'") && s.includes('feature_events')) {
            if (opts.featureEventsThrows) throw new Error('no such table: feature_events');
            return { results: opts.trendByFeature?.[boundId as string] ?? [] };
          }
          if (s.includes('count(distinct user_id) as u') && s.includes('group by role')) {
            if (opts.featureEventsThrows) throw new Error('no such table: feature_events');
            return { results: opts.roleByFeature?.[boundId as string] ?? [] };
          }
          return { results: [] };
        },
        run: async () => ({ success: true, meta: {} }),
      };
      return api;
    },
  };
  return { DB: db } as unknown as Env;
}

function featReq() {
  return new Request('https://x/api/admin/features-usage');
}

describe('LOT RÉEL-bis — handleAdminFeaturesUsage : fabriqué → réel/honnête', () => {
  it('refuse les non-admins (403)', async () => {
    const res = await handleAdminFeaturesUsage(featReq(), featEnv({}), { userId: 'u', role: 'member' });
    expect(res.status).toBe(403);
  });

  it('sessions/uniqueUsers/lastUsedAt = valeurs RÉELLES feature_events', async () => {
    const lastTs = 1_700_000_000; // epoch-s
    const env = featEnv({
      usersCount: 100,
      perFeature: {
        cmd_palette: { sessions: 340, unique_users: 41, last_ts: lastTs },
      },
    });
    const body = (await (await handleAdminFeaturesUsage(featReq(), env, ADMIN)).json()) as any;
    const cmd = body.data.features.find((f: any) => f.id === 'cmd_palette');

    expect(cmd.sessions).toBe(340);
    expect(cmd.uniqueUsers).toBe(41);
    expect(cmd.lastUsedAt).toBe(new Date(lastTs * 1000).toISOString());
    // adoptionRate RÉEL = 41/100, PAS la valeur seed 0.78 d'avant.
    expect(cmd.adoptionRate).toBeCloseTo(41 / 100, 5);
    expect(cmd.adoptionRate).not.toBe(0.78);
  });

  it('feature jamais utilisée ⇒ sessions/uniqueUsers 0, lastUsedAt null (JAMAIS Math.random)', async () => {
    const env = featEnv({ usersCount: 50, perFeature: {} });
    const body = (await (await handleAdminFeaturesUsage(featReq(), env, ADMIN)).json()) as any;
    const f = body.data.features[0];

    expect(f.sessions).toBe(0);
    expect(f.uniqueUsers).toBe(0);
    expect(f.lastUsedAt).toBeNull();
    expect(f.adoptionRate).toBe(0);
    // trend 30j = 30 zéros RÉELS, pas le sin()/jitter d'avant.
    expect(f.trend30d.length).toBe(30);
    expect(f.trend30d.every((v: number) => v === 0)).toBe(true);
  });

  it('table feature_events absente ⇒ tout 0/null honnête, structure préservée', async () => {
    const env = featEnv({ usersCount: 80, featureEventsThrows: true });
    const body = (await (await handleAdminFeaturesUsage(featReq(), env, ADMIN)).json()) as any;

    expect(Array.isArray(body.data.features)).toBe(true);
    expect(body.data.features.length).toBe(10);
    for (const f of body.data.features) {
      expect(f.sessions).toBe(0);
      expect(f.uniqueUsers).toBe(0);
      expect(f.lastUsedAt).toBeNull();
      expect(f.adoptionRate).toBe(0);
      expect(f.trend30d.every((v: number) => v === 0)).toBe(true);
    }
    // by_role : 6 entrées, ratios 0 (JAMAIS les proxies +0.15/-0.25).
    expect(body.data.by_role.length).toBe(6);
    for (const r of body.data.by_role) {
      expect(r.admin).toBe(0);
      expect(r.member).toBe(0);
      expect(r.viewer).toBe(0);
    }
  });

  it('by_role = ratios RÉELS user distinct / users du rôle (JAMAIS +0.15/-0.25)', async () => {
    const env = featEnv({
      usersCount: 100,
      usersByRole: [
        { role: 'admin', c: 4 },
        { role: 'member', c: 80 },
        { role: 'viewer', c: 16 },
      ],
      perFeature: { cmd_palette: { sessions: 200, unique_users: 30, last_ts: 1_700_000_000 } },
      roleByFeature: {
        cmd_palette: [
          { role: 'admin', u: 2 },
          { role: 'member', u: 20 },
          { role: 'viewer', u: 1 },
        ],
      },
    });
    const body = (await (await handleAdminFeaturesUsage(featReq(), env, ADMIN)).json()) as any;
    const row = body.data.by_role.find((r: any) => r.feature_id === 'cmd_palette');

    expect(row.admin).toBeCloseTo(2 / 4, 5);
    expect(row.member).toBeCloseTo(20 / 80, 5);
    expect(row.viewer).toBeCloseTo(1 / 16, 5);
    // L'ancien proxy aurait été adoption+0.15 / -0.25 — interdit.
    expect(row.admin).not.toBeCloseTo(0.30 + 0.15, 2);
  });

  it('trend30d = COUNT par jour RÉEL (le jour courant peuplé, autres à 0)', async () => {
    const todayIso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const env = featEnv({
      usersCount: 100,
      perFeature: { cmd_palette: { sessions: 9, unique_users: 5, last_ts: 1_700_000_000 } },
      trendByFeature: { cmd_palette: [{ d: todayIso, c: 9 }] },
    });
    const body = (await (await handleAdminFeaturesUsage(featReq(), env, ADMIN)).json()) as any;
    const cmd = body.data.features.find((f: any) => f.id === 'cmd_palette');

    expect(cmd.trend30d.length).toBe(30);
    // Aujourd'hui = dernier bucket (index 29).
    expect(cmd.trend30d[29]).toBe(9);
    // Les autres jours = 0 RÉEL (aucun sin/jitter).
    expect(cmd.trend30d.slice(0, 29).every((v: number) => v === 0)).toBe(true);
  });
});
