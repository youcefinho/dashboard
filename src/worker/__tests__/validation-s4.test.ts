// ── S4 M2 — Tests couche de validation (renforcement) ───────
// Vérifie pour chaque mutation durcie en Phase B M2 :
//  1. payload légitime réel → la logique métier procède (pas de 400 VALIDATION)
//  2. non-régression : payloads historiques minimaux passent toujours
//  3. payload invalide → 400 { error, code:'VALIDATION' }
//
// Mock D1 : _helpers.ts (figé S2) — db.prepare().bind().all()/.first()/.run()
// + seed() pour programmer les SELECT (lookups tenant, dédup, etc).
//
// Couvre : lead-notes (create/update), ecommerce-cart (updateCartItem),
// webhook lead ingest (validation POST-mapping), templates (create/update),
// appointments (create/update).

import { describe, it, expect } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import { handleCreateLeadNote, handleUpdateLeadNote } from '../lead-notes';
import { handleUpdateCartItem } from '../ecommerce-cart';
import { ingestLead } from '../leads';
import { handleCreateTemplate, handleUpdateTemplate } from '../templates';
import { handleCreateAppointment, handleUpdateAppointment } from '../appointments';

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
// lead-notes.ts — handleCreateLeadNote
// ════════════════════════════════════════════════════════════
describe('handleCreateLeadNote — validation', () => {
  it('payload légitime → procède (201)', async () => {
    const db = createMockD1();
    const res = await handleCreateLeadNote(
      makeReq({ body: 'Appel effectué, à rappeler vendredi', category: 'call', is_pinned: true }),
      envWith(db),
      adminAuth,
      'lead-1',
    );
    expect(res.status).toBe(201);
  });

  it('non-régression : body seul (defaults handler)', async () => {
    const res = await handleCreateLeadNote(
      makeReq({ body: 'Note minimale' }),
      envWith(createMockD1()),
      adminAuth,
      'lead-1',
    );
    expect(res.status).toBe(201);
  });

  it('non-régression : category hors allowlist acceptée (filtrée côté handler → general)', async () => {
    const res = await handleCreateLeadNote(
      makeReq({ body: 'Note', category: 'categorie_inconnue_libre' }),
      envWith(createMockD1()),
      adminAuth,
      'lead-1',
    );
    expect(res.status).toBe(201);
  });

  it('body manquant → 400 VALIDATION', async () => {
    const res = await handleCreateLeadNote(
      makeReq({ category: 'call' }),
      envWith(createMockD1()),
      adminAuth,
      'lead-1',
    );
    await expectValidation400(res);
  });

  it('JSON invalide → 400 VALIDATION', async () => {
    const res = await handleCreateLeadNote(
      makeReq('{pas du json'),
      envWith(createMockD1()),
      adminAuth,
      'lead-1',
    );
    await expectValidation400(res);
  });
});

// ════════════════════════════════════════════════════════════
// lead-notes.ts — handleUpdateLeadNote
// ════════════════════════════════════════════════════════════
describe('handleUpdateLeadNote — validation', () => {
  it('payload légitime (body) → procède (200)', async () => {
    const res = await handleUpdateLeadNote(
      makeReq({ body: 'Note corrigée' }),
      envWith(createMockD1()),
      adminAuth,
      'lead-1',
      'note-1',
    );
    expect(res.status).toBe(200);
  });

  it('non-régression : is_pinned seul', async () => {
    const res = await handleUpdateLeadNote(
      makeReq({ is_pinned: true }),
      envWith(createMockD1()),
      adminAuth,
      'lead-1',
      'note-1',
    );
    expect(res.status).toBe(200);
  });

  it('is_pinned mauvais type (string) → 400 VALIDATION', async () => {
    const res = await handleUpdateLeadNote(
      makeReq({ is_pinned: 'oui' }),
      envWith(createMockD1()),
      adminAuth,
      'lead-1',
      'note-1',
    );
    await expectValidation400(res);
  });

  it('JSON invalide → 400 VALIDATION', async () => {
    const res = await handleUpdateLeadNote(
      makeReq('nope'),
      envWith(createMockD1()),
      adminAuth,
      'lead-1',
      'note-1',
    );
    await expectValidation400(res);
  });
});

// ════════════════════════════════════════════════════════════
// ecommerce-cart.ts — handleUpdateCartItem
// ════════════════════════════════════════════════════════════
describe('handleUpdateCartItem — validation', () => {
  it('payload légitime { quantity } → procède (200)', async () => {
    const db = createMockD1();
    // getClientModules : SELECT client_id FROM users WHERE id → user-1 lié à c1
    db.seed('from users where', [{ client_id: 'c1' }]);
    // getClientModules : SELECT modules_json FROM clients WHERE id
    db.seed('from clients where', [{ modules_json: '["crm","ecommerce"]' }]);
    // handleUpdateCartItem : JOIN carts c ON c.id = ci.cart_id
    db.seed('join carts c on c.id', [{ id: 'cart1', client_id: 'c1', customer_id: null, token: 't', status: 'active' }]);
    // shapeCart : SELECT ci.id AS id ... FROM cart_items
    db.seed('from cart_items ci', []);
    const res = await handleUpdateCartItem(
      makeReq({ quantity: 3 }),
      envWith(db),
      { userId: 'user-1', role: 'admin' },
      'item-1',
    );
    expect(res.status).toBe(200);
  });

  it('non-régression : quantity absent (coercée à 0 côté handler = suppression)', async () => {
    const db = createMockD1();
    db.seed('from users where', [{ client_id: 'c1' }]);
    db.seed('from clients where', [{ modules_json: '["crm","ecommerce"]' }]);
    db.seed('join carts c on c.id', [{ id: 'cart1', client_id: 'c1', customer_id: null, token: 't', status: 'active' }]);
    db.seed('from cart_items ci', []);
    const res = await handleUpdateCartItem(
      makeReq({}),
      envWith(db),
      { userId: 'user-1', role: 'admin' },
      'item-1',
    );
    expect(res.status).toBe(200);
  });

  it('quantity mauvais type (string) → 400 VALIDATION', async () => {
    const db = createMockD1();
    db.seed('from users where', [{ client_id: 'c1' }]);
    db.seed('from clients where', [{ modules_json: '["crm","ecommerce"]' }]);
    const res = await handleUpdateCartItem(
      makeReq({ quantity: 'trois' }),
      envWith(db),
      { userId: 'user-1', role: 'admin' },
      'item-1',
    );
    await expectValidation400(res);
  });

  it('JSON invalide → 400 VALIDATION', async () => {
    const db = createMockD1();
    db.seed('from users where', [{ client_id: 'c1' }]);
    db.seed('from clients where', [{ modules_json: '["crm","ecommerce"]' }]);
    const res = await handleUpdateCartItem(
      makeReq('{xxx'),
      envWith(db),
      { userId: 'user-1', role: 'admin' },
      'item-1',
    );
    await expectValidation400(res);
  });
});

// ════════════════════════════════════════════════════════════
// leads.ts — ingestLead (validation APRÈS mapping)
// ════════════════════════════════════════════════════════════
describe('ingestLead — validation POST-mapping', () => {
  it('payload légitime (name+email) → procède (mapping puis validation OK)', async () => {
    const db = createMockD1();
    db.seed('from leads where', []); // pas de doublon (dédup)
    const res = await ingestLead(envWith(db), {
      request: makeReq({ name: 'Sophie Gagnon', email: 'sophie@test.com', phone: '418-555-0000' }),
      clientId: 'c1',
      sourceKey: 'site_web',
      body: { name: 'Sophie Gagnon', email: 'sophie@test.com', phone: '418-555-0000' },
    });
    // création (201) ou idempotent (200) selon dédup — jamais 400 VALIDATION
    expect(res.status).not.toBe(400);
    expect([200, 201]).toContain(res.status);
  });

  it('non-régression : payload minimal name+email', async () => {
    const db = createMockD1();
    db.seed('from leads where', []);
    const res = await ingestLead(envWith(db), {
      request: makeReq({ name: 'X', email: 'x@y.com' }),
      clientId: 'c1',
      sourceKey: 'form',
      body: { name: 'X', email: 'x@y.com' },
    });
    expect(res.status).not.toBe(400);
  });

  it('name/email absents après mapping → 400 VALIDATION (post-mapping)', async () => {
    const db = createMockD1();
    const res = await ingestLead(envWith(db), {
      request: makeReq({ phone: '514-000-0000' }),
      clientId: 'c1',
      sourceKey: 'form',
      body: { phone: '514-000-0000' },
    });
    await expectValidation400(res);
  });
});

// ════════════════════════════════════════════════════════════
// templates.ts — handleCreateTemplate / handleUpdateTemplate
// ════════════════════════════════════════════════════════════
describe('handleCreateTemplate — validation', () => {
  it('payload légitime → procède (201)', async () => {
    const res = await handleCreateTemplate(
      makeReq({ name: 'Bienvenue', subject: 'Bonjour {{nom}}', body_html: '<p>Salut</p>', category: 'onboarding' }),
      envWith(createMockD1()),
      adminAuth,
    );
    expect(res.status).toBe(201);
  });

  it('non-régression : body_html absent (handler accepte || "")', async () => {
    const res = await handleCreateTemplate(
      makeReq({ name: 'Sans corps', subject: 'Sujet' }),
      envWith(createMockD1()),
      adminAuth,
    );
    expect(res.status).toBe(201);
  });

  it('name manquant → 400 VALIDATION', async () => {
    const res = await handleCreateTemplate(
      makeReq({ subject: 'Sujet seul' }),
      envWith(createMockD1()),
      adminAuth,
    );
    await expectValidation400(res);
  });

  it('non-admin reste 403 (auth avant validation)', async () => {
    const res = await handleCreateTemplate(
      makeReq({}),
      envWith(createMockD1()),
      { role: 'user', userId: 'u' },
    );
    expect(res.status).toBe(403);
  });
});

describe('handleUpdateTemplate — validation', () => {
  it('payload légitime (name) → procède (200)', async () => {
    const res = await handleUpdateTemplate(
      makeReq({ name: 'Renommé' }),
      envWith(createMockD1()),
      adminAuth,
      'tpl-1',
    );
    expect(res.status).toBe(200);
  });

  it('subject mauvais type (number) → 400 VALIDATION', async () => {
    const res = await handleUpdateTemplate(
      makeReq({ subject: 42 }),
      envWith(createMockD1()),
      adminAuth,
      'tpl-1',
    );
    await expectValidation400(res);
  });

  it('non-admin reste 403 (auth avant validation)', async () => {
    const res = await handleUpdateTemplate(
      makeReq({}),
      envWith(createMockD1()),
      { role: 'user', userId: 'u' },
      'tpl-1',
    );
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════
// appointments.ts — handleCreateAppointment / handleUpdateAppointment
// ════════════════════════════════════════════════════════════
describe('handleCreateAppointment — validation', () => {
  it('payload légitime → procède (201)', async () => {
    const res = await handleCreateAppointment(
      makeReq({
        title: 'Visite propriété',
        start_time: '2026-06-01T10:00:00Z',
        end_time: '2026-06-01T11:00:00Z',
        type: 'visit',
        client_id: 'c1',
      }),
      envWith(createMockD1()),
      adminAuth,
    );
    expect(res.status).toBe(201);
  });

  it('non-régression : title+start+end seuls (defaults handler)', async () => {
    const res = await handleCreateAppointment(
      makeReq({ title: 'RDV', start_time: '2026-06-01T10:00:00Z', end_time: '2026-06-01T11:00:00Z' }),
      envWith(createMockD1()),
      adminAuth,
    );
    expect(res.status).toBe(201);
  });

  it('start_time manquant → 400 VALIDATION', async () => {
    const res = await handleCreateAppointment(
      makeReq({ title: 'RDV sans heure', end_time: '2026-06-01T11:00:00Z' }),
      envWith(createMockD1()),
      adminAuth,
    );
    await expectValidation400(res);
  });

  it('JSON invalide → 400 VALIDATION', async () => {
    const res = await handleCreateAppointment(
      makeReq('{pas json'),
      envWith(createMockD1()),
      adminAuth,
    );
    await expectValidation400(res);
  });
});

describe('handleUpdateAppointment — validation', () => {
  it('payload légitime (status) → procède (200)', async () => {
    const db = createMockD1();
    db.seed('from appointments where id', [{ lead_id: null, client_id: 'c1', title: 'RDV' }]);
    const res = await handleUpdateAppointment(
      makeReq({ status: 'confirmed' }),
      envWith(db),
      adminAuth,
      'appt-1',
    );
    expect(res.status).toBe(200);
  });

  it('non-régression : title seul', async () => {
    const res = await handleUpdateAppointment(
      makeReq({ title: 'Nouveau titre' }),
      envWith(createMockD1()),
      adminAuth,
      'appt-1',
    );
    expect(res.status).toBe(200);
  });

  it('start_time mauvais type (number) → 400 VALIDATION', async () => {
    const res = await handleUpdateAppointment(
      makeReq({ start_time: 12345 }),
      envWith(createMockD1()),
      adminAuth,
      'appt-1',
    );
    await expectValidation400(res);
  });

  it('JSON invalide → 400 VALIDATION', async () => {
    const res = await handleUpdateAppointment(
      makeReq('xxx'),
      envWith(createMockD1()),
      adminAuth,
      'appt-1',
    );
    await expectValidation400(res);
  });
});
