// ════════════════════════════════════════════════════════════
// S3 M1.4 — Tests de la couche de validation (NON-RÉGRESSION)
// ════════════════════════════════════════════════════════════
//
// Garantit que :
//  1. validate() conserve sa signature/forme de retour figée.
//  2. Un payload RÉALISTE de chaque mutation critique PASSE (aucun
//     payload légitime actuel rejeté — preuve de non-régression).
//  3. Un payload clairement invalide ÉCHOUE avec un message FR.
//  4. validationError() produit une 400 rétro-compat (`error` string
//     racine + `code:'VALIDATION'` additif).
//
// environment: node — déterministe, zéro I/O réseau, zéro dépendance
// au worker runtime (json() de helpers.ts est pur).

import { describe, it, expect } from 'vitest';
import {
  validate,
  createOrderSchema,
  createManualOrderSchema,
  updateOrderStatusSchema,
  createProductSchema,
  updateProductSchema,
  adjustInventorySchema,
  addCartItemSchema,
  createReturnSchema,
  createLeadSchema,
  webhookLeadIngestSchema,
  createTaskSchemaS3,
  patchTaskSchema,
  patchLeadSchemaS3,
  bulkLeadsSchemaS3,
  createPipelineSchema,
  createPipelineStageSchema,
  publicFormSubmitSchema,
  createFormSchema,
} from '../../lib/schemas';
import { validationError } from '../lib/validate-response';

// ── 1. Contrat de validate() (signature/forme figée) ────────

describe('validate() — contrat figé', () => {
  it('succès → { success: true, data }', () => {
    const r = validate(updateOrderStatusSchema, { status: 'paid' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe('paid');
  });

  it('échec → { success: false, error: <string> }', () => {
    const r = validate(updateOrderStatusSchema, { status: 'inexistant' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(typeof r.error).toBe('string');
      expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it('le succès ne contient JAMAIS de clé error', () => {
    const r = validate(createLeadSchema, {
      client_id: 'c1', name: 'Jean Tremblay', email: 'jean@ex.qc.ca',
    });
    expect(r.success).toBe(true);
    expect('error' in r).toBe(false);
  });
});

// ── 2. NON-RÉGRESSION : payloads RÉELS légitimes → success ──
//
// Chaque payload ci-dessous est représentatif d'un appel actuel
// (dérivé de la lecture du handler cible). TOUS doivent passer :
// si l'un échoue, un schéma rejette un payload légitime → KO.

describe('Non-régression — payloads légitimes réels passent', () => {
  const legit: Array<[string, Parameters<typeof validate>[0], unknown]> = [
    ['createOrder (cart conversion)', createOrderSchema, {
      email: 'client@boutique.qc.ca',
      items: [{ variant_id: 'v-1', quantity: 2 }],
      customer_id: null,
      shipping_cents: 1500,
      discount_cents: 0,
      source: 'web',
    }],
    ['createOrder (minimal : email + items)', createOrderSchema, {
      email: 'a@b.ca',
      items: [{ variant_id: 'v-9' }], // quantity coercée côté handler
    }],
    ['createManualOrder (back-office, customer_id absent)', createManualOrderSchema, {
      email: 'manuel@interne.ca',
      items: [{ variant_id: 'v-2', quantity: 1 }],
      note: 'Commande téléphone',
    }],
    ['updateOrderStatus', updateOrderStatusSchema, { status: 'preparing' }],
    ['createProduct (titre seul)', createProductSchema, { title: 'T-shirt' }],
    ['createProduct (complet + variantes)', createProductSchema, {
      title: 'Chandail', slug: 'chandail', description: 'Coton bio',
      status: 'active', base_price: 4999, currency: 'CAD',
      variants: [{ title: 'M', sku: 'CH-M', price_override: null }],
    }],
    ['updateProduct (1 champ)', updateProductSchema, { status: 'archived' }],
    ['adjustInventory (delta positif)', adjustInventorySchema, { delta: 5, reason: 'restock' }],
    ['adjustInventory (delta négatif minimal)', adjustInventorySchema, { delta: -3 }],
    ['addCartItem', addCartItemSchema, { variant_id: 'v-7', quantity: 1, token: 'tok-abc' }],
    ['addCartItem (variant seul)', addCartItemSchema, { variant_id: 'v-7' }],
    ['createReturn', createReturnSchema, {
      order_id: 'ord-1', items: [{ order_item_id: 'oi-1', quantity: 1 }], reason: 'Trop petit',
    }],
    ['createReturn (order seul)', createReturnSchema, { order_id: 'ord-2' }],
    ['createLead', createLeadSchema, {
      client_id: 'c1', name: 'Marie Côté', email: 'MARIE@EX.CA', phone: '514-555-0000',
      source: 'manual',
    }],
    ['webhookLead ingest', webhookLeadIngestSchema, {
      name: 'Prospect Web', email: 'p@site.com', message: 'Intéressé', source: 'facebook',
      extra_champ_inconnu: 'toléré', // passthrough
    }],
    ['createTask (titre seul)', createTaskSchemaS3, { title: 'Rappeler le client' }],
    ['createTask (complet)', createTaskSchemaS3, {
      title: 'Suivi', description: 'Relance', priority: 'high', status: 'todo',
      due_date: '2026-06-01', lead_id: 'l-1', assigned_to: 'u-2',
    }],
    ['patchTask (1 champ)', patchTaskSchema, { status: 'done' }],
    ['patchLead (move pipeline)', patchLeadSchemaS3, {
      pipeline_id: 'pipeline-default', stage_id: 'stage-contacted',
    }],
    ['patchLead (status + score)', patchLeadSchemaS3, { status: 'contacted', score: 80 }],
    ['bulkLeads', bulkLeadsSchemaS3, {
      ids: ['l-1', 'l-2'], action: 'change_status', value: 'contacted',
    }],
    ['createPipeline', createPipelineSchema, { name: 'Ventes', client_id: 'c1' }],
    ['createPipelineStage', createPipelineStageSchema, {
      name: 'Qualification', probability: 30, wip_limit: 0,
    }],
    ['publicFormSubmit', publicFormSubmitSchema, {
      form_id: 'f-1', data: { nom: 'Léo', courriel: 'leo@x.ca', message: 'Allo' },
    }],
    ['createForm', createFormSchema, {
      client_id: 'c1', name: 'Contact', slug: 'contact',
      fields: [{ key: 'email', type: 'email' }], submit_action: 'create_lead',
    }],
  ];

  it.each(legit)('%s → success', (_label, schema, payload) => {
    const r = validate(schema, payload);
    if (!r.success) {
      throw new Error(`Payload légitime rejeté: ${r.error}`);
    }
    expect(r.success).toBe(true);
  });
});

// ── 3. Payloads clairement invalides → échec FR ─────────────

describe('Rejet des payloads clairement invalides', () => {
  const invalid: Array<[string, Parameters<typeof validate>[0], unknown]> = [
    ['createOrder sans email', createOrderSchema, { items: [{ variant_id: 'v1' }] }],
    ['createOrder sans items', createOrderSchema, { email: 'a@b.ca' }],
    ['createOrder items vide', createOrderSchema, { email: 'a@b.ca', items: [] }],
    ['updateOrderStatus statut inconnu', updateOrderStatusSchema, { status: 'zzz' }],
    ['createProduct sans titre', createProductSchema, { description: 'x' }],
    ['adjustInventory delta 0', adjustInventorySchema, { delta: 0 }],
    ['adjustInventory delta absent', adjustInventorySchema, { reason: 'restock' }],
    ['addCartItem sans variant', addCartItemSchema, { quantity: 2 }],
    ['createReturn sans order_id', createReturnSchema, { reason: 'x' }],
    ['createLead sans client_id', createLeadSchema, { name: 'X', email: 'x@y.ca' }],
    ['createLead sans email', createLeadSchema, { client_id: 'c1', name: 'X' }],
    ['createTask sans titre', createTaskSchemaS3, { description: 'rien' }],
    ['bulkLeads ids vide', bulkLeadsSchemaS3, { ids: [], action: 'delete' }],
    ['bulkLeads action invalide', bulkLeadsSchemaS3, { ids: ['l1'], action: 'nuke' }],
    ['createPipeline sans client_id', createPipelineSchema, { name: 'P' }],
    ['publicFormSubmit sans data', publicFormSubmitSchema, { form_id: 'f1' }],
    ['createForm sans slug', createFormSchema, { client_id: 'c1', name: 'N' }],
    ['payload null', createLeadSchema, null],
    ['payload string au lieu objet', createLeadSchema, 'pas un objet'],
  ];

  it.each(invalid)('%s → échec avec message string', (_label, schema, payload) => {
    const r = validate(schema, payload);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(typeof r.error).toBe('string');
      expect(r.error.length).toBeGreaterThan(0);
    }
  });
});

// ── 4. validationError() — forme + rétro-compat front ───────

describe('validationError() — 400 rétro-compat', () => {
  it('status 400 + JSON', async () => {
    const res = validationError('email: Email requis');
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('`error` reste une STRING racine (rétro-compat api.ts data.error)', async () => {
    const res = validationError('items: Ajoute au moins un article');
    const body = await res.json() as { error: unknown; code: unknown; fields?: unknown };
    expect(typeof body.error).toBe('string');
    expect(body.error).toBe('items: Ajoute au moins un article');
  });

  it('`code:"VALIDATION"` additif présent', async () => {
    const res = validationError('x: y');
    const body = await res.json() as { code: unknown };
    expect(body.code).toBe('VALIDATION');
  });

  it('`fields` best-effort extrait le chemin préfixé', async () => {
    const res = validationError('client_id: client_id requis');
    const body = await res.json() as { fields?: string[] };
    expect(body.fields).toEqual(['client_id']);
  });

  it('message libre sans chemin → pas de `fields`', async () => {
    const res = validationError('Données invalides');
    const body = await res.json() as { fields?: string[]; error: string };
    expect(body.fields).toBeUndefined();
    expect(body.error).toBe('Données invalides');
  });

  it('message vide → fallback FR lisible', async () => {
    const res = validationError('');
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Données invalides');
  });

  it('chaîne bout-à-bout : validate() échec → validationError()', async () => {
    const v = validate(createLeadSchema, { name: 'X' });
    expect(v.success).toBe(false);
    if (!v.success) {
      const res = validationError(v.error);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code: string };
      expect(typeof body.error).toBe('string');
      expect(body.code).toBe('VALIDATION');
    }
  });
});
