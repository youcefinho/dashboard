// ══════════════════════════════════════════════════════════════════════════
// Tests — Scheduled Reports : dashboard_id RÉTRO-COMPAT (LOT REPORT-TEMPLATES)
// ══════════════════════════════════════════════════════════════════════════
// DÉTERMINISTE, offline-safe : mock minimal de Env.DB (D1).
// Couvre buildDashboardDigestHtml :
//   - dashboard rendu (config tenant-bornée → widgets agrégés via le moteur
//     GELÉ handleRunReportWidget, Request synthétique) ;
//   - RÉTRO-COMPAT : dashboard introuvable / hors périmètre ⇒ fallback
//     buildActivityDigestHtml (digest activité générique) ;
//   - structure ActivityDigest { subject, html, text }.
//
// NB : filesystem VMware Z: sans runner → non exécuté ici, validation hôte.

import { describe, it, expect } from 'vitest';
import { buildDashboardDigestHtml } from '../scheduled-reports';

type Row = Record<string, unknown>;

// Mock D1 : sert la config dashboard + des comptes leads pour le moteur widget
// (handleRunReportWidget appelle runGenericSource → SELECT ... FROM leads).
function makeDB(opts: {
  dashboardRow?: Row | null; // SELECT ... FROM dashboards
  leadsBuckets?: Row[]; // SELECT ... FROM leads GROUP BY bucket
  activityCount?: number; // COUNT(*) fallback activité
}) {
  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async all() {
          // Moteur widget : agrégat GROUP BY bucket sur leads.
          if (/FROM leads/i.test(sql) && /GROUP BY bucket/i.test(sql)) {
            return { results: opts.leadsBuckets ?? [] };
          }
          return { results: [] };
        },
        async first() {
          if (/FROM dashboards/i.test(sql)) {
            return opts.dashboardRow ?? null;
          }
          // Fallback digest activité : COUNT(*) AS n.
          if (/COUNT\(\*\) AS n/i.test(sql)) {
            return { n: opts.activityCount ?? 0 };
          }
          return null;
        },
        async run() {
          return { success: true, meta: { changes: 1, last_row_id: 1 } };
        },
      };
      return stmt;
    },
  };
  return { DB };
}

const dashConfig = {
  cols: 12,
  widgets: [
    { id: 'w1', title: 'Total leads', type: 'kpi', source: 'leads', metric: 'count' },
    {
      id: 'w2',
      title: 'Leads par statut',
      type: 'barchart',
      source: 'leads',
      dimension: 'status',
      metric: 'count',
    },
  ],
};

describe('buildDashboardDigestHtml', () => {
  it('rend les widgets du dashboard (valeurs agrégées) — digest dashboard', async () => {
    const { DB } = makeDB({
      dashboardRow: { name: 'Pipeline', config: JSON.stringify(dashConfig) },
      leadsBuckets: [
        { bucket: 'new', val: 12 },
        { bucket: 'won', val: 5 },
      ],
    });
    const digest = await buildDashboardDigestHtml(
      { DB } as never,
      'cli_1',
      'ag_1',
      99,
      'weekly',
    );
    expect(digest.subject).toContain('Pipeline');
    expect(digest.subject).toContain('hebdomadaire');
    // Le HTML mentionne les titres de widgets + le total agrégé (12+5=17).
    expect(digest.html).toContain('Pipeline');
    expect(digest.html).toContain('Total leads');
    expect(digest.html).toContain('17');
    expect(digest.text).toContain('Leads par statut');
  });

  it('RÉTRO-COMPAT : dashboard introuvable ⇒ fallback digest activité', async () => {
    const { DB } = makeDB({ dashboardRow: null, activityCount: 3 });
    const digest = await buildDashboardDigestHtml(
      { DB } as never,
      'cli_1',
      'ag_1',
      404,
      'weekly',
    );
    // Sujet du digest activité générique (buildActivityDigestHtml).
    expect(digest.subject).toContain('rapport hebdomadaire');
    expect(digest.subject).toMatch(/nouveau\(x\) lead/);
    expect(digest.html).toContain('Nouveaux leads');
  });

  it('structure ActivityDigest complète { subject, html, text }', async () => {
    const { DB } = makeDB({
      dashboardRow: { name: 'D', config: JSON.stringify({ cols: 12, widgets: [] }) },
    });
    const digest = await buildDashboardDigestHtml(
      { DB } as never,
      'cli_1',
      null,
      1,
      'monthly',
    );
    expect(typeof digest.subject).toBe('string');
    expect(digest.html.startsWith('<!doctype html>')).toBe(true);
    expect(typeof digest.text).toBe('string');
    expect(digest.subject).toContain('mensuel');
  });
});
