// ══════════════════════════════════════════════════════════════════════════
// Tests — Report Templates (Sprint 15 / LOT REPORT-TEMPLATES, Manager-B Phase B)
// ══════════════════════════════════════════════════════════════════════════
// DÉTERMINISTE, offline-safe : mock minimal de Env.DB (D1) en mémoire.
// Couvre : capGuard (reports.view lecture / workflows.manage clone), bornage
// tenant (système + tenant, jamais cross-tenant), 404 zéro-leak, validation
// config whitelist (rejet 400 hors whitelist), clone via handleCreateDashboard
// (dashboard_id String), réponses { data } / { error } jamais `code`.
//
// NB : filesystem VMware Z: sans runner → non exécuté ici, validation hôte.

import { describe, it, expect } from 'vitest';
import {
  handleGetReportTemplates,
  handleApplyReportTemplate,
} from '../report-templates';

type Row = Record<string, unknown>;

// Mock D1 : matche par sous-chaîne SQL ; INSERT dashboards renvoie last_row_id.
function makeDB(opts: {
  templates?: Row[]; // lignes renvoyées pour SELECT report_templates
  templateById?: Row | null; // ligne renvoyée pour SELECT ... WHERE id = ?
  lastRowId?: number;
}) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async all() {
          calls.push({ sql, args: bound });
          if (/FROM report_templates/i.test(sql)) {
            return { results: opts.templates ?? [] };
          }
          return { results: [] };
        },
        async first() {
          calls.push({ sql, args: bound });
          if (/FROM report_templates/i.test(sql) && /WHERE id = \?/i.test(sql)) {
            return opts.templateById ?? null;
          }
          return null;
        },
        async run() {
          calls.push({ sql, args: bound });
          return {
            success: true,
            meta: { changes: 1, last_row_id: opts.lastRowId ?? 42 },
          };
        },
      };
      return stmt;
    },
  };
  return { DB, calls };
}

// Auth mode-agence (enforcement réel) avec capabilities données.
function agencyAuth(caps: string[], clientId = 'cli_1') {
  return {
    userId: 'u1',
    role: 'broker',
    clientId,
    tenant: {
      userId: 'u1',
      role: 'broker',
      clientId,
      agencyId: 'ag_1',
      accountLevel: 'agency',
      accessibleClientIds: [clientId],
    },
    capabilities: new Set<string>(caps),
  };
}

// Auth legacy/mono-tenant (pas de bridage capability).
function legacyAuth(clientId: string | null = 'cli_legacy') {
  return { userId: 'u1', role: 'admin', clientId } as never;
}

const validConfig = {
  cols: 12,
  widgets: [
    { id: 'w1', type: 'kpi', title: 'Leads', source: 'leads', metric: 'count' },
    {
      id: 'w2',
      type: 'barchart',
      title: 'Par statut',
      source: 'leads',
      dimension: 'status',
      metric: 'count',
    },
  ],
};

describe('handleGetReportTemplates', () => {
  it('403 si capability reports.view manquante en mode agence', async () => {
    const { DB } = makeDB({});
    const resp = await handleGetReportTemplates(
      { DB } as never,
      agencyAuth(['workflows.manage']),
    );
    expect(resp.status).toBe(403);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
    expect('code' in body).toBe(false);
  });

  it('liste système + tenant, config parsée, is_system normalisé', async () => {
    const { DB, calls } = makeDB({
      templates: [
        {
          id: 'sys1',
          client_id: null,
          agency_id: null,
          name: 'Ventes',
          description: 'd',
          category: 'sales',
          config: JSON.stringify(validConfig),
          is_system: 1,
        },
        {
          id: 'ten1',
          client_id: 'cli_1',
          agency_id: 'ag_1',
          name: 'Custom',
          description: null,
          category: null,
          config: '{bad json',
          is_system: 0,
        },
      ],
    });
    const resp = await handleGetReportTemplates(
      { DB } as never,
      agencyAuth(['reports.view']),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]!.config).toEqual(validConfig);
    expect(body.data[0]!.is_system).toBe(1);
    expect(body.data[1]!.config).toBeNull(); // JSON invalide → null best-effort
    // Bornage tenant : clientId de l'auth utilisé dans le bind (jamais body).
    const sel = calls.find((c) => /FROM report_templates/i.test(c.sql))!;
    expect(sel.args).toContain('cli_1');
  });

  it('table absente → { data: [] }, jamais 500', async () => {
    const DB = {
      prepare() {
        return {
          bind() {
            return this;
          },
          all() {
            throw new Error('no such table: report_templates');
          },
          first() {
            throw new Error('no such table');
          },
          run() {
            throw new Error('no such table');
          },
        };
      },
    };
    const resp = await handleGetReportTemplates(
      { DB } as never,
      agencyAuth(['reports.view']),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

describe('handleApplyReportTemplate', () => {
  it('403 si capability workflows.manage manquante en mode agence', async () => {
    const { DB } = makeDB({});
    const resp = await handleApplyReportTemplate(
      { DB } as never,
      agencyAuth(['reports.view']),
      'sys1',
    );
    expect(resp.status).toBe(403);
  });

  it('404 zéro-leak si template introuvable / hors périmètre', async () => {
    const { DB } = makeDB({ templateById: null });
    const resp = await handleApplyReportTemplate(
      { DB } as never,
      agencyAuth(['workflows.manage']),
      'other_tenant',
    );
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
    expect('code' in body).toBe(false);
  });

  it('400 si config hors whitelist (source invalide) — jamais persisté', async () => {
    const { DB, calls } = makeDB({
      templateById: {
        id: 'bad',
        client_id: null,
        agency_id: null,
        name: 'Bad',
        description: null,
        category: null,
        config: JSON.stringify({
          cols: 12,
          widgets: [{ id: 'x', source: 'payments', metric: 'sum' }],
        }),
        is_system: 1,
      },
    });
    const resp = await handleApplyReportTemplate(
      { DB } as never,
      agencyAuth(['workflows.manage']),
      'bad',
    );
    expect(resp.status).toBe(400);
    // AUCUN INSERT dans dashboards (config non validée jamais clonée).
    expect(calls.some((c) => /INSERT INTO dashboards/i.test(c.sql))).toBe(false);
  });

  it('clone valide → { data: { dashboard_id: "42" } } (id INTEGER→String)', async () => {
    const { DB, calls } = makeDB({
      templateById: {
        id: 'sys1',
        client_id: null,
        agency_id: null,
        name: 'Ventes',
        description: null,
        category: 'sales',
        config: JSON.stringify(validConfig),
        is_system: 1,
      },
      lastRowId: 42,
    });
    const resp = await handleApplyReportTemplate(
      { DB } as never,
      agencyAuth(['workflows.manage']),
      'sys1',
    );
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as { data: { dashboard_id: string } };
    expect(body.data.dashboard_id).toBe('42');
    expect(typeof body.data.dashboard_id).toBe('string');
    // Clone via handleCreateDashboard → INSERT dashboards avec config validée.
    const ins = calls.find((c) => /INSERT INTO dashboards/i.test(c.sql));
    expect(ins).toBeDefined();
    // La config sérialisée clonée contient les widgets whitelistés.
    expect(String(ins!.args[2])).toContain('"source":"leads"');
  });

  it('legacy/mono-tenant : applique un template système (pas de bridage cap)', async () => {
    const { DB } = makeDB({
      templateById: {
        id: 'sys1',
        client_id: null,
        agency_id: null,
        name: 'Ventes',
        description: null,
        category: 'sales',
        config: JSON.stringify(validConfig),
        is_system: 1,
      },
      lastRowId: 7,
    });
    const resp = await handleApplyReportTemplate({ DB } as never, legacyAuth(null), 'sys1');
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as { data: { dashboard_id: string } };
    expect(body.data.dashboard_id).toBe('7');
  });
});
