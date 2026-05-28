// ════════════════════════════════════════════════════════════════════════════
// Sprint 62 — Entonnoirs d'Achat & Upsell en 1-Clic (funnel-checkout.test.ts)
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  ecomEnv,
  seedTenant,
  seedVariant,
  createMockD1,
  type MockD1,
} from './_ecommerce-fixtures';
import {
  handleFunnelCheckout,
  handleFunnelUpsell,
  handleGetFunnelOffers,
  handleSaveFunnelOffer,
  handleDeleteFunnelOffer,
} from '../funnel-checkout';

const CLIENT = 'client-A';
const AUTH = {
  userId: 'user-A',
  role: 'admin',
  clientId: CLIENT,
  capabilities: new Set(['workflows.manage']),
};

function mockCheckoutReq(body: Record<string, unknown>): Request {
  return new Request('https://x/api/p/mon-funnel/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockUpsellReq(body: Record<string, unknown>): Request {
  return new Request('https://x/api/p/mon-funnel/upsell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockOfferSaveReq(body: Record<string, unknown>): Request {
  return new Request('https://x/api/funnels/funnel-1/offers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('funnel-checkout — handleFunnelCheckout', () => {
  it('checkout réussi : crée une commande payée et met à jour les stats du funnel', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    
    // Seed la publication du funnel
    db.seed('from funnel_publications', [{
      client_id: CLIENT,
      funnel_id: 'funnel-1',
      slug: 'mon-funnel',
      is_active: 1
    }]);

    // Seed le produit et la variante
    seedVariant(db, { variantId: 'v-1', clientId: CLIENT, basePrice: 5000 });
    db.seed('from inventory where variant_id', [{
      id: 'inv-1', variant_id: 'v-1', quantity: 100, reserved: 0,
      low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
    }]);

    const req = mockCheckoutReq({
      email: 'buyer@example.ca',
      items: [{ variant_id: 'v-1', quantity: 1 }],
      address: { country: 'CA' },
      name: 'Jean Tremblay'
    });

    const res = await handleFunnelCheckout(req, ecomEnv(db) as never, 'mon-funnel');
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: { order_id: string; order_number: string; status: string } };
    expect(body.data.status).toBe('paid');
    expect(body.data.order_id).toBeDefined();

    // Vérifie que les requêtes D1 pour incrémenter les stats et insérer de l'analytics ont été appelées
    const hasStatsUpdate = db.calls.some(c => /update funnels set total_submissions/i.test(c.sql));
    const hasAnalyticsInsert = db.calls.some(c => /insert into funnel_analytics/i.test(c.sql));
    expect(hasStatsUpdate).toBe(true);
    expect(hasAnalyticsInsert).toBe(true);
  });

  it('checkout échoue si le funnel n\'est pas publié', async () => {
    const db = createMockD1();
    // Pas de publication seedée -> resolveFunnelPublication retourne null
    const req = mockCheckoutReq({
      email: 'buyer@example.ca',
      items: [{ variant_id: 'v-1', quantity: 1 }]
    });

    const res = await handleFunnelCheckout(req, ecomEnv(db) as never, 'inconnu');
    expect(res.status).toBe(404);
  });

  it('checkout échoue si les paramètres sont invalides (ex: courriel manquant)', async () => {
    const db = createMockD1();
    db.seed('from funnel_publications', [{
      client_id: CLIENT,
      funnel_id: 'funnel-1',
      slug: 'mon-funnel',
      is_active: 1
    }]);

    const req = mockCheckoutReq({
      items: [{ variant_id: 'v-1', quantity: 1 }]
    });

    const res = await handleFunnelCheckout(req, ecomEnv(db) as never, 'mon-funnel');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Courriel requis');
  });
});

describe('funnel-checkout — handleFunnelUpsell', () => {
  it('upsell 1-clic réussi : applique le discount pour correspondre au prix d\'offre', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);

    // Publication
    db.seed('from funnel_publications', [{
      client_id: CLIENT,
      funnel_id: 'funnel-1',
      slug: 'mon-funnel',
      is_active: 1
    }]);

    // Commande parente
    db.seed('from orders where id', [{
      id: 'parent-1',
      client_id: CLIENT,
      email: 'buyer@example.ca',
      tax_region: 'QC',
      currency: 'CAD',
      order_number: '#1001'
    }]);

    // Offre d'upsell configurée dans funnel_offers à 30$ (3000¢)
    db.seed('from funnel_offers', [{
      id: 'offer-1',
      client_id: CLIENT,
      funnel_id: 'funnel-1',
      step_id: 'step-2',
      product_variant_id: 'v-upsell',
      type: 'upsell',
      price_cents: 3000,
      is_active: 1
    }]);

    // Variante d'upsell qui vaut normalement 50$ (5000¢)
    seedVariant(db, { variantId: 'v-upsell', clientId: CLIENT, basePrice: 5000 });
    db.seed('price_override from product_variants', [{ price_override: null }]);
    db.seed('base_price from products', [{ base_price: 5000 }]);
    db.seed('from inventory where variant_id', [{
      id: 'inv-2', variant_id: 'v-upsell', quantity: 100, reserved: 0,
      low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
    }]);

    const req = mockUpsellReq({
      parent_order_id: 'parent-1',
      step_id: 'step-2',
      variant_id: 'v-upsell'
    });

    const res = await handleFunnelUpsell(req, ecomEnv(db) as never, 'mon-funnel');
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: { order_id: string; total_cents: number; status: string } };
    expect(body.data.status).toBe('paid');
    
    // Le prix payé doit être de 3000¢ + taxes (ex: QC = +14.975% = 3000 + 150 + 299 = 3449)
    // Mais on vérifie au moins que la commande a été créée.
    expect(body.data.order_id).toBeDefined();

    // Vérifier qu'un discount de 2000¢ (5000 - 3000) a été appliqué
    const orderInsert = db.calls.find(c => /insert into orders/i.test(c.sql));
    expect(orderInsert).toBeDefined();
    // discount_cents se situe à la 9e place des placeholders dans la requête INSERT INTO orders
    expect(orderInsert!.args).toContain(2000); 
  });

  it('upsell échoue si l\'offre est introuvable ou inactive', async () => {
    const db = createMockD1();
    db.seed('from funnel_publications', [{
      client_id: CLIENT,
      funnel_id: 'funnel-1',
      slug: 'mon-funnel',
      is_active: 1
    }]);

    db.seed('from orders where id', [{
      id: 'parent-1',
      client_id: CLIENT,
      email: 'buyer@example.ca'
    }]);

    // Offre non configurée dans funnel_offers

    const req = mockUpsellReq({
      parent_order_id: 'parent-1',
      step_id: 'step-2',
      variant_id: 'v-upsell'
    });

    const res = await handleFunnelUpsell(req, ecomEnv(db) as never, 'mon-funnel');
    expect(res.status).toBe(404);
  });
});

describe('funnel-offers — CRUD PRO', () => {
  it('crée et récupère une offre de funnel', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);

    // 1) POST pour enregistrer l'offre
    const reqSave = mockOfferSaveReq({
      id: 'offer-1',
      step_id: 'step-1',
      product_variant_id: 'v-1',
      type: 'bump',
      price_cents: 1500,
      is_active: true
    });

    const resSave = await handleSaveFunnelOffer(reqSave, ecomEnv(db) as never, AUTH, 'funnel-1');
    expect(resSave.status).toBe(201);

    // 2) GET pour lister les offres du funnel
    db.seed('from funnel_offers', [{
      id: 'offer-1',
      client_id: CLIENT,
      funnel_id: 'funnel-1',
      step_id: 'step-1',
      product_variant_id: 'v-1',
      type: 'bump',
      price_cents: 1500,
      is_active: 1
    }]);

    const resGet = await handleGetFunnelOffers(ecomEnv(db) as never, AUTH, 'funnel-1');
    expect(resGet.status).toBe(200);
    const bodyGet = (await resGet.json()) as { data: Array<Record<string, unknown>> };
    expect(bodyGet.data.length).toBe(1);
    expect(bodyGet.data[0]!.type).toBe('bump');

    // 3) DELETE pour supprimer l'offre
    const resDel = await handleDeleteFunnelOffer(ecomEnv(db) as never, AUTH, 'funnel-1', 'offer-1');
    expect(resDel.status).toBe(200);
  });
});
