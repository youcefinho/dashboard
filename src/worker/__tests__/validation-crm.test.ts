// ── S3 M3 — Tests couche de validation CRM ──────────────────
// Vérifie pour chaque mutation durcie :
//  1. payload légitime réel → la logique métier procède (pas de 400 VALIDATION)
//  2. payload invalide → 400 { error, code:'VALIDATION' }
//  3. non-régression : les payloads légitimes historiques passent toujours
//
// Mock D1 : _helpers.ts (figé S2) — db.prepare().bind().all()/.first()/.run()
// + seed() pour programmer les SELECT (client lookup, dédup, etc).

import { describe, it, expect } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import { handleCreateLead, handlePatchLead, handleBulkLeads } from '../leads';
import { handleCreateTask, handlePatchTask } from '../tasks';
import { handleCreatePipeline, handleCreatePipelineStage } from '../pipelines';
import { handlePublicFormSubmit, handleCreateForm } from '../forms';

const adminAuth = { role: 'admin', userId: 'user-1' };

function envWith(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function expectValidation400(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  const j = (await res.json()) as { error: string; code?: string };
  expect(j.code).toBe('VALIDATION');
  expect(typeof j.error).toBe('string');
  expect(j.error.length).toBeGreaterThan(0);
}

// ════════════════════════════════════════════════════════════
// leads.ts — handleCreateLead
// ════════════════════════════════════════════════════════════
describe('handleCreateLead — validation', () => {
  it('payload légitime → procède (pas de 400 VALIDATION)', async () => {
    const db = createMockD1();
    db.seed('from clients where', [{ id: 'c1' }]); // client existe
    db.seed('from leads where lower(email)', []); // pas de doublon
    const res = await handleCreateLead(
      makeReq({ client_id: 'c1', name: 'Jean Tremblay', email: 'jean@test.com', phone: '514-555-1234', source: 'manual' }),
      envWith(db),
      adminAuth,
    );
    expect(res.status).toBe(201);
  });

  it('non-régression : payload historique minimal (client_id+name+email)', async () => {
    const db = createMockD1();
    db.seed('from clients where', [{ id: 'c1' }]);
    db.seed('from leads where lower(email)', []);
    const res = await handleCreateLead(
      makeReq({ client_id: 'c1', name: 'X', email: 'x@y.com' }),
      envWith(db),
      adminAuth,
    );
    expect(res.status).toBe(201);
  });

  it('client_id manquant → 400 VALIDATION', async () => {
    const res = await handleCreateLead(
      makeReq({ name: 'X', email: 'x@y.com' }),
      envWith(createMockD1()),
      adminAuth,
    );
    await expectValidation400(res);
  });

  it('JSON invalide → 400 VALIDATION', async () => {
    const res = await handleCreateLead(makeReq('{not json'), envWith(createMockD1()), adminAuth);
    await expectValidation400(res);
  });

  it('non-admin reste 403 (auth avant validation)', async () => {
    const res = await handleCreateLead(makeReq({}), envWith(createMockD1()), { role: 'user', userId: 'u' });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════
// leads.ts — handlePatchLead
// ════════════════════════════════════════════════════════════
describe('handlePatchLead — validation', () => {
  it('payload légitime (status) → procède', async () => {
    const db = createMockD1();
    db.seed('select pipeline_id, stage_id from leads', [{ pipeline_id: null, stage_id: null }]);
    db.seed("from workflows where is_active", []);
    db.seed('select name, client_id from leads', [{ name: 'Lead', client_id: 'c1' }]);
    db.seed("from users where role = 'admin'", []);
    db.seed('select * from leads where id', [{ id: 'l1', client_id: 'c1' }]);
    const res = await handlePatchLead(
      makeReq({ status: 'contacted' }),
      envWith(db),
      adminAuth,
      'l1',
    );
    expect(res.status).toBe(200);
  });

  it('non-régression : move pipeline/stage', async () => {
    const db = createMockD1();
    db.seed('select pipeline_id, stage_id from leads', [{ pipeline_id: 'p0', stage_id: 's0' }]);
    db.seed("from workflows where is_active", []);
    const res = await handlePatchLead(
      makeReq({ pipeline_id: 'p1', stage_id: 's2' }),
      envWith(db),
      adminAuth,
      'l1',
    );
    expect(res.status).toBe(200);
  });

  it('deal_value de mauvais type (string) → 400 VALIDATION', async () => {
    const res = await handlePatchLead(
      makeReq({ deal_value: 'beaucoup' }),
      envWith(createMockD1()),
      adminAuth,
      'l1',
    );
    await expectValidation400(res);
  });

  it('JSON invalide → 400 VALIDATION', async () => {
    const res = await handlePatchLead(makeReq('xxx'), envWith(createMockD1()), adminAuth, 'l1');
    await expectValidation400(res);
  });
});

// ════════════════════════════════════════════════════════════
// leads.ts — handleBulkLeads
// ════════════════════════════════════════════════════════════
describe('handleBulkLeads — validation', () => {
  it('payload légitime → procède', async () => {
    const db = createMockD1();
    const res = await handleBulkLeads(
      makeReq({ ids: ['a', 'b'], action: 'change_status', value: 'contacted' }),
      envWith(db),
      adminAuth,
    );
    expect(res.status).toBe(200);
  });

  it('ids vide → 400 VALIDATION', async () => {
    const res = await handleBulkLeads(
      makeReq({ ids: [], action: 'delete' }),
      envWith(createMockD1()),
      adminAuth,
    );
    await expectValidation400(res);
  });

  it('action hors allowlist → 400 VALIDATION', async () => {
    const res = await handleBulkLeads(
      makeReq({ ids: ['a'], action: 'drop_table' }),
      envWith(createMockD1()),
      adminAuth,
    );
    await expectValidation400(res);
  });
});

// ════════════════════════════════════════════════════════════
// tasks.ts — handleCreateTask / handlePatchTask
// ════════════════════════════════════════════════════════════
describe('handleCreateTask — validation', () => {
  it('payload légitime → procède', async () => {
    const db = createMockD1();
    const res = await handleCreateTask(
      makeReq({ title: 'Rappeler le client', priority: 'high', due_date: '2026-06-01' }),
      envWith(db),
      { userId: 'u1', role: 'admin' },
    );
    expect(res.status).toBe(201);
  });

  it('non-régression : title seul (defaults posés côté handler)', async () => {
    const res = await handleCreateTask(
      makeReq({ title: 'Tâche minimale' }),
      envWith(createMockD1()),
      { userId: 'u1', role: 'admin' },
    );
    expect(res.status).toBe(201);
  });

  it('title manquant → 400 VALIDATION', async () => {
    const res = await handleCreateTask(
      makeReq({ description: 'sans titre' }),
      envWith(createMockD1()),
      { userId: 'u1', role: 'admin' },
    );
    await expectValidation400(res);
  });
});

describe('handlePatchTask — validation', () => {
  it('payload légitime → procède', async () => {
    const db = createMockD1();
    db.seed('select status, lead_id from tasks', [{ status: 'todo', lead_id: null }]);
    const res = await handlePatchTask(
      makeReq({ status: 'done' }),
      envWith(db),
      { userId: 'u1', role: 'admin' },
      't1',
    );
    expect(res.status).toBe(200);
  });

  it('JSON invalide → 400 VALIDATION', async () => {
    const db = createMockD1();
    db.seed('select status, lead_id from tasks', [{ status: 'todo', lead_id: null }]);
    const res = await handlePatchTask(makeReq('nope'), envWith(db), { userId: 'u1', role: 'admin' }, 't1');
    await expectValidation400(res);
  });
});

// ════════════════════════════════════════════════════════════
// pipelines.ts — handleCreatePipeline / handleCreatePipelineStage
// ════════════════════════════════════════════════════════════
describe('handleCreatePipeline — validation', () => {
  it('payload légitime (admin) → procède', async () => {
    const res = await handleCreatePipeline(
      makeReq({ name: 'Ventes', client_id: 'c1', color: '#0891b2' }),
      envWith(createMockD1()),
      adminAuth,
    );
    expect(res.status).toBe(201);
  });

  it('name manquant → 400 VALIDATION', async () => {
    const res = await handleCreatePipeline(
      makeReq({ client_id: 'c1' }),
      envWith(createMockD1()),
      adminAuth,
    );
    await expectValidation400(res);
  });
});

describe('handleCreatePipelineStage — validation', () => {
  it('payload légitime → procède', async () => {
    const db = createMockD1();
    db.seed('max(sort_order)', [{ max_pos: 2 }]);
    const res = await handleCreatePipelineStage(
      makeReq({ name: 'Qualifié', color: '#9ca3af', probability: 40 }),
      envWith(db),
      adminAuth,
      'p1',
    );
    expect(res.status).toBe(201);
  });

  it('name manquant → 400 VALIDATION', async () => {
    const res = await handleCreatePipelineStage(
      makeReq({ color: '#fff' }),
      envWith(createMockD1()),
      adminAuth,
      'p1',
    );
    await expectValidation400(res);
  });
});

// ════════════════════════════════════════════════════════════
// forms.ts — handlePublicFormSubmit (public, permissif) / handleCreateForm
// ════════════════════════════════════════════════════════════
describe('handlePublicFormSubmit — validation (endpoint public, permissif)', () => {
  it('form légitime avec champs dynamiques arbitraires → procède', async () => {
    const db = createMockD1();
    db.seed('from forms where id', [{
      id: 'f1', client_id: 'c1', form_type: 'form',
      submit_action: 'none', success_message: 'Merci', settings_json: '{}', fields: '[]',
    }]);
    const res = await handlePublicFormSubmit(
      makeReq({ form_id: 'f1', data: { nom: 'Marie', email: 'marie@x.com', message_libre: 'Bonjour', champ_perso_42: 'oui' } }),
      envWith(db),
    );
    expect(res.status).toBe(201);
  });

  it('form_id manquant → 400 VALIDATION (pas un faux rejet de form légitime)', async () => {
    const res = await handlePublicFormSubmit(
      makeReq({ data: { nom: 'X' } }),
      envWith(createMockD1()),
    );
    await expectValidation400(res);
  });

  it('data absent → 400 VALIDATION', async () => {
    const res = await handlePublicFormSubmit(
      makeReq({ form_id: 'f1' }),
      envWith(createMockD1()),
    );
    await expectValidation400(res);
  });
});

describe('handleCreateForm — validation', () => {
  it('payload légitime → procède', async () => {
    const res = await handleCreateForm(
      makeReq({ client_id: 'c1', name: 'Contact', slug: 'contact', form_type: 'form' }),
      envWith(createMockD1()),
      adminAuth,
    );
    expect(res.status).toBe(201);
  });

  it('slug manquant → 400 VALIDATION', async () => {
    const res = await handleCreateForm(
      makeReq({ client_id: 'c1', name: 'Contact' }),
      envWith(createMockD1()),
      adminAuth,
    );
    await expectValidation400(res);
  });

  it('non-admin reste 403 (auth avant validation)', async () => {
    const res = await handleCreateForm(makeReq({}), envWith(createMockD1()), { role: 'user', userId: 'u' });
    expect(res.status).toBe(403);
  });
});
