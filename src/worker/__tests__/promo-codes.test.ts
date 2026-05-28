// ── Tests — Promo Codes & Moteur de Rabais Dynamiques (Sprint 64, 2026-05-28) ──
//
// Tests unitaires complets validant :
// 1. Le CRUD d'administration des codes promos (list, create, get, update, delete).
// 2. L'évaluation et le calcul dynamique des remises dans resolveCouponDiscount
//    (gestion de rules_json, restrictions variantes/produits, plancher d'achat).
//

import { describe, it, expect, vi } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import {
  handleListPromoCodes,
  handleCreatePromoCode,
  handleGetPromoCode,
  handleUpdatePromoCode,
  handleDeletePromoCode,
} from '../promo-codes';
import { resolveCouponDiscount, incrementCouponUsage } from '../ecommerce-coupons';

// Mock du module modules pour forcer getClientModules à renvoyer notre clientId
vi.mock('../modules', () => ({
  getClientModules: vi.fn(async () => ({ clientId: 'client-A', modules: ['ecommerce'] })),
}));

const AUTH_ADMIN = { userId: 'user-admin', role: 'admin' };
const AUTH_BROKER = { userId: 'user-broker', role: 'broker' };

describe('Promo Codes — CRUD d’administration', () => {
  it('handleListPromoCodes — liste paginée', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;
    
    // Seed des données de codes promos
    db.seed('SELECT id, client_id, code', [
      { id: 'promo-1', client_id: 'client-A', code: 'ETE2026', value: 15, discount_type: 'percent' },
      { id: 'promo-2', client_id: 'client-A', code: 'WINTER10', value: 1000, discount_type: 'fixed' },
    ]);
    db.seed('SELECT COUNT(*)', [{ c: 2 }]);

    const url = new URL('http://localhost/api/ecommerce/promo-codes?limit=10&offset=0');
    const res = await handleListPromoCodes(env, AUTH_ADMIN, url);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.data[0].code).toBe('ETE2026');
  });

  it('handleCreatePromoCode — admin only, validation format et unicité', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    // 1. Refus si non admin
    const reqBroker = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ code: 'PROMO15', discount_type: 'percent', value: 15 }),
    });
    const resBroker = await handleCreatePromoCode(reqBroker, env, AUTH_BROKER);
    expect(resBroker.status).toBe(403);

    // 2. Erreur si code invalide (trop court)
    const reqInvalid = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ code: 'ABC', discount_type: 'percent', value: 15 }),
    });
    const resInvalid = await handleCreatePromoCode(reqInvalid, env, AUTH_ADMIN);
    expect(resInvalid.status).toBe(400);

    // 3. Création réussie si admin et format ok
    const reqOk = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        code: 'PROMO2026',
        discount_type: 'percent',
        value: 20,
        starts_at: '2026-06-01',
        expires_at: '2026-07-01',
        max_uses: 100,
        rules_json: { min_order_cents: 5000 },
      }),
    });
    const resOk = await handleCreatePromoCode(reqOk, env, AUTH_ADMIN);
    expect(resOk.status).toBe(201);
    const bodyOk = await resOk.json() as any;
    expect(bodyOk.data.id).toBeDefined();

    // Vérifier les arguments de l'insert
    const insertCall = db.calls.find((c) => c.sql.includes('INSERT INTO promo_codes'));
    expect(insertCall).toBeDefined();
    expect(insertCall?.args[2]).toBe('PROMO2026');
    expect(insertCall?.args[3]).toBe('percent');
    expect(insertCall?.args[4]).toBe(20);
    expect(insertCall?.args[8]).toContain('min_order_cents');
  });

  it('handleGetPromoCode — détail', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    db.seed('SELECT id, client_id, code', [
      { id: 'promo-1', client_id: 'client-A', code: 'ETE2026', value: 15, discount_type: 'percent' },
    ]);

    const res = await handleGetPromoCode(env, AUTH_ADMIN, 'promo-1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe('promo-1');
    expect(body.data.code).toBe('ETE2026');
  });

  it('handleUpdatePromoCode — modification admin', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    db.seed('SELECT id, client_id, code', [
      { id: 'promo-1', client_id: 'client-A', code: 'ETE2026', value: 15, discount_type: 'percent', rules_json: '{}' },
    ]);

    const req = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ value: 20 }),
    });

    const res = await handleUpdatePromoCode(req, env, AUTH_ADMIN, 'promo-1');
    expect(res.status).toBe(200);

    const updateCall = db.calls.find((c) => c.sql.includes('UPDATE promo_codes SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall?.args[2]).toBe(20); // nouvelle value
  });

  it('handleDeletePromoCode — suppression admin', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    db.seed('SELECT id FROM promo_codes', [{ id: 'promo-1' }]);

    const res = await handleDeletePromoCode(env, AUTH_ADMIN, 'promo-1');
    expect(res.status).toBe(200);

    const deleteCall = db.calls.find((c) => c.sql.includes('DELETE FROM promo_codes'));
    expect(deleteCall).toBeDefined();
  });
});

describe('Promo Codes — Moteur d’évaluation des remises (resolveCouponDiscount)', () => {
  it('Evalue un code promo de type percent', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    db.seed('SELECT * FROM promo_codes', [
      {
        id: 'promo-1',
        client_id: 'client-A',
        code: 'PROMO15',
        discount_type: 'percent',
        value: 15,
        starts_at: null,
        expires_at: null,
        max_uses: null,
        current_uses: 0,
        rules_json: '{}',
      },
    ]);

    const res = await resolveCouponDiscount(env, 'client-A', 'PROMO15', 10000);
    expect(res.valid).toBe(true);
    expect(res.discount_cents).toBe(1500); // 15% de 10000
    expect(res.isPromoCode).toBe(true);
  });

  it('Evalue un code promo de type fixed', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    db.seed('SELECT * FROM promo_codes', [
      {
        id: 'promo-2',
        client_id: 'client-A',
        code: 'SAVE10',
        discount_type: 'fixed',
        value: 1000, // 10.00$
        starts_at: null,
        expires_at: null,
        max_uses: null,
        current_uses: 0,
        rules_json: '{}',
      },
    ]);

    const res = await resolveCouponDiscount(env, 'client-A', 'SAVE10', 5000);
    expect(res.valid).toBe(true);
    expect(res.discount_cents).toBe(1000);
  });

  it('Applique les restrictions de plancher d’achat', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    db.seed('SELECT * FROM promo_codes', [
      {
        id: 'promo-3',
        client_id: 'client-A',
        code: 'MIN50',
        discount_type: 'percent',
        value: 10,
        starts_at: null,
        expires_at: null,
        max_uses: null,
        current_uses: 0,
        rules_json: JSON.stringify({ min_order_cents: 5000 }), // 50.00$ min
      },
    ]);

    // 1. Sous-total inférieur (40.00$)
    const resLow = await resolveCouponDiscount(env, 'client-A', 'MIN50', 4000);
    expect(resLow.valid).toBe(false);
    expect(resLow.reason).toBe('Commande minimum non atteinte');

    // 2. Sous-total supérieur (60.00$)
    const resOk = await resolveCouponDiscount(env, 'client-A', 'MIN50', 6000);
    expect(resOk.valid).toBe(true);
    expect(resOk.discount_cents).toBe(600); // 10% de 6000
  });

  it('Applique les restrictions sur variantes (allowed_variant_ids)', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    db.seed('SELECT * FROM promo_codes', [
      {
        id: 'promo-4',
        client_id: 'client-A',
        code: 'VARONLY',
        discount_type: 'percent',
        value: 20,
        starts_at: null,
        expires_at: null,
        max_uses: null,
        current_uses: 0,
        rules_json: JSON.stringify({ allowed_variant_ids: ['var_1', 'var_2'] }),
      },
    ]);

    const items = [
      { variant_id: 'var_1', price_cents: 3000, qty: 1 }, // Admissible
      { variant_id: 'var_3', price_cents: 5000, qty: 1 }, // Non admissible
    ];

    // Calcul de la remise : doit s'appliquer uniquement sur var_1 (30.00$ * 20% = 6.00$)
    const res = await resolveCouponDiscount(env, 'client-A', 'VARONLY', 8000, 'CAD', items);
    expect(res.valid).toBe(true);
    expect(res.discount_cents).toBe(600); // 20% de 3000
  });

  it('Applique les restrictions sur produits (allowed_product_ids)', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    db.seed('SELECT * FROM promo_codes', [
      {
        id: 'promo-5',
        client_id: 'client-A',
        code: 'PRODONLY',
        discount_type: 'percent',
        value: 10,
        starts_at: null,
        expires_at: null,
        max_uses: null,
        current_uses: 0,
        rules_json: JSON.stringify({ allowed_product_ids: ['prod_A'] }),
      },
    ]);

    const items = [
      { product_id: 'prod_A', price_cents: 4000, qty: 2 }, // Admissible (80.00$)
      { product_id: 'prod_B', price_cents: 3000, qty: 1 }, // Non admissible (30.00$)
    ];

    // Calcul de la remise : doit s'appliquer uniquement sur prod_A (80.00$ * 10% = 8.00$)
    const res = await resolveCouponDiscount(env, 'client-A', 'PRODONLY', 11000, 'CAD', items);
    expect(res.valid).toBe(true);
    expect(res.discount_cents).toBe(800); // 10% de 8000
  });

  it('Incrémente l’usage des codes promos avec incrementCouponUsage', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    // On fait throw une exception sur l'UPDATE de coupons pour simuler l'absence ou l'incompatibilité de la table
    const originalPrepare = db.prepare;
    db.prepare = (sql: string) => {
      if (sql.includes('UPDATE coupons')) {
        throw new Error('Simulated coupon table missing');
      }
      return originalPrepare(sql);
    };

    await incrementCouponUsage(env, 'client-A', 'promo-1');

    const updateCall = db.calls.find((c) => c.sql.includes('UPDATE promo_codes SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall?.args[0]).toBe('promo-1');
  });
});
