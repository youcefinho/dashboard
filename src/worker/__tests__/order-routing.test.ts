// ── order-routing.test.ts — Sprint 66 Moteur de Routage Intelligent des Commandes ──────────────────
//
// Valide le moteur de routage pur et son intégration dans le cycle de création
// de commandes e-commerce (createOrderCore).
//
// Approche : Harness mock D1, sans I/O réseau, avec assertions SQL précises.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import {
  evaluateCondition,
  evaluateRule,
  evaluateRoutingRules,
} from '../lib/order-routing-engine';
import { createOrderCore } from '../ecommerce-orders';

// ── Helpers Env ────────────────────────────────────────────────────────────
function makeEnv(): { env: Env; db: ReturnType<typeof createMockD1> } {
  const db = createMockD1();
  const env = { DB: db } as unknown as Env;
  return { env, db };
}

// ════════════════════════════════════════════════════════════════════════════
// PARTIE 1 : MOTEUR DE ROUTAGE PUR (order-routing-engine.ts)
// ════════════════════════════════════════════════════════════════════════════

describe('Moteur de routage pur — evaluateCondition', () => {
  it('shipping_country : equals insensible à la casse', () => {
    const address = { country: 'CA' };
    const cond = { field: 'shipping_country' as const, operator: 'equals' as const, value: 'ca' };
    expect(evaluateCondition(address, cond)).toBe(true);
  });

  it('shipping_country : not_equals', () => {
    const address = { country: 'US' };
    const cond = { field: 'shipping_country' as const, operator: 'not_equals' as const, value: 'CA' };
    expect(evaluateCondition(address, cond)).toBe(true);
  });

  it('shipping_country_subdiv : equals avec state/province', () => {
    const address1 = { state: 'QC' };
    const address2 = { province: 'QC' };
    const address3 = { country_subdiv: 'QC' };
    const cond = { field: 'shipping_country_subdiv' as const, operator: 'equals' as const, value: 'qc' };

    expect(evaluateCondition(address1, cond)).toBe(true);
    expect(evaluateCondition(address2, cond)).toBe(true);
    expect(evaluateCondition(address3, cond)).toBe(true);
  });

  it('shipping_postal_code : starts_with', () => {
    const address = { postal_code: 'G1A 1A1' };
    const cond = { field: 'shipping_postal_code' as const, operator: 'starts_with' as const, value: 'G1A' };
    expect(evaluateCondition(address, cond)).toBe(true);
  });

  it('shipping_postal_code : contains', () => {
    const address = { zip: '90210' };
    const cond = { field: 'shipping_postal_code' as const, operator: 'contains' as const, value: '021' };
    expect(evaluateCondition(address, cond)).toBe(true);
  });
});

describe('Moteur de routage pur — evaluateRule', () => {
  const rule = {
    id: 'r-1',
    client_id: 'c-1',
    name: 'Rule QC',
    priority: 10,
    action_warehouse_id: 'wh-qc',
    is_active: 1,
    conditions_json: JSON.stringify([
      { field: 'shipping_country', operator: 'equals', value: 'CA' },
      { field: 'shipping_country_subdiv', operator: 'equals', value: 'QC' },
    ]),
  };

  it('matche si toutes les conditions sont remplies (ET logique)', () => {
    const address = { country: 'CA', state: 'QC' };
    expect(evaluateRule(rule, address)).toBe(true);
  });

  it('ne matche pas si une condition échoue', () => {
    const address = { country: 'CA', state: 'ON' };
    expect(evaluateRule(rule, address)).toBe(false);
  });

  it('règle sans conditions (catch-all) matche toujours', () => {
    const catchAllRule = {
      ...rule,
      conditions_json: '[]',
    };
    const address = { country: 'FR', state: 'IDF' };
    expect(evaluateRule(catchAllRule, address)).toBe(true);
  });
});

describe('Moteur de routage pur — evaluateRoutingRules', () => {
  const rules = [
    {
      id: 'rule-low',
      client_id: 'c-1',
      name: 'CA Rule',
      priority: 10,
      action_warehouse_id: 'wh-ca',
      is_active: 1,
      conditions_json: JSON.stringify([
        { field: 'shipping_country', operator: 'equals', value: 'CA' },
      ]),
    },
    {
      id: 'rule-high',
      client_id: 'c-1',
      name: 'QC Rule',
      priority: 100,
      action_warehouse_id: 'wh-qc',
      is_active: 1,
      conditions_json: JSON.stringify([
        { field: 'shipping_country_subdiv', operator: 'equals', value: 'QC' },
      ]),
    },
    {
      id: 'rule-inactive',
      client_id: 'c-1',
      name: 'Inactive Rule',
      priority: 200,
      action_warehouse_id: 'wh-inactive',
      is_active: 0,
      conditions_json: JSON.stringify([]),
    },
  ];

  it('prend la règle active de plus haute priorité en premier', () => {
    const address = { country: 'CA', state: 'QC' };
    const whId = evaluateRoutingRules(rules, address);
    expect(whId).toBe('wh-qc'); // Priorité 100 > Priorité 10. Inactive (200) est ignorée.
  });

  it('retombe sur la priorité plus basse si la plus haute ne correspond pas', () => {
    const address = { country: 'CA', state: 'ON' };
    const whId = evaluateRoutingRules(rules, address);
    expect(whId).toBe('wh-ca'); // wh-qc ne correspond pas, wh-ca oui.
  });

  it('retourne null si aucun match', () => {
    const address = { country: 'FR' };
    const whId = evaluateRoutingRules(rules, address);
    expect(whId).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PARTIE 2 : INTÉGRATION BACKEND (createOrderCore)
// ════════════════════════════════════════════════════════════════════════════

describe('Routage des commandes — Intégration createOrderCore', () => {
  const mockRules = [
    {
      id: 'rule-qc',
      client_id: 'client-1',
      name: 'Règle Québec',
      priority: 50,
      conditions_json: JSON.stringify([
        { field: 'shipping_country_subdiv', operator: 'equals', value: 'QC' },
      ]),
      action_warehouse_id: 'wh-quebec',
      is_active: 1,
    },
  ];

  const mockWarehouses = [
    { id: 'wh-default', is_default: 1, name: 'Dépôt principal', is_active: 1 },
    { id: 'wh-quebec', is_default: 0, name: 'Dépôt Québec', is_active: 1 },
  ];

  const mockVariant = {
    variant_id: 'var-1',
    variant_title: 'Variante 1',
    sku: 'SKU-VAR1',
    price_override: 1000,
    product_id: 'prod-1',
    product_title: 'Produit 1',
    base_price: 1000,
  };

  const mockInventory = {
    id: 'inv-1',
    variant_id: 'var-1',
    quantity: 10,
    reserved: 0,
    low_stock_threshold: 2,
    track_inventory: 1,
    allow_backorder: 0,
  };

  it('route vers l’entrepôt correspondant à la règle géographique', async () => {
    const { env, db } = makeEnv();

    // Seed de la base mockée
    db.seed('from order_routing_rules', mockRules);
    db.seed('from warehouses', mockWarehouses);
    db.seed('from product_variants v', [mockVariant]);
    db.seed('returning next_number', [{ next_number: 1001 }]);
    db.seed('from inventory', [mockInventory]);
    db.seed('from location_stocks', [
      { location_id: 'wh-quebec', variant_id: 'var-1', quantity: 5, reserved: 0 },
    ]);

    const orderInput = {
      customer_id: 'cust-1',
      email: 'client@example.com',
      items: [{ variant_id: 'var-1', quantity: 2 }],
      shipping_cents: 0,
      discount_cents: 0,
      note: 'Routage Québec',
      source: 'web',
      shipping_address: {
        country: 'CA',
        state: 'QC',
        postal_code: 'G1A 1A1',
      },
    };

    const res = await createOrderCore(env, 'client-1', orderInput, 'user-1');

    expect(res.id).toBeDefined();
    expect(res.order_number).toBe('#1000');

    // Assertion 1 : Persistance du warehouse_id dans `orders`
    const insertOrderCalls = db.calls.filter(c => /insert into orders/i.test(c.sql));
    expect(insertOrderCalls.length).toBe(1);
    
    // Le warehouseId ("wh-quebec") est l'avant-dernier ou l'un des paramètres du bind.
    // L'INSERT bind orderId, clientId, customerId, orderNumber, subtotalCents, tpsCents, tvqCents, ...
    // Le matchedWhId ("wh-quebec") est passé comme paramètre.
    expect(insertOrderCalls[0].args).toContain('wh-quebec');

    // Assertion 2 : Adresse persistée sous forme de JSON string
    expect(insertOrderCalls[0].args).toContain(JSON.stringify(orderInput.shipping_address));

    // Assertion 3 : Réservation de stock sur l'entrepôt Québec
    const locationStocksUpdate = db.calls.filter(c => /insert into location_stocks/i.test(c.sql));
    expect(locationStocksUpdate.length).toBe(1);
    expect(locationStocksUpdate[0].args[0]).toBe('wh-quebec'); // locationId
    expect(locationStocksUpdate[0].args[4]).toBe(2); // reserved + 2
  });

  it('retombe sur le warehouse par défaut (fallback) si aucune règle ne correspond', async () => {
    const { env, db } = makeEnv();

    db.seed('from order_routing_rules', mockRules);
    db.seed('from warehouses', mockWarehouses);
    db.seed('from product_variants v', [mockVariant]);
    db.seed('returning next_number', [{ next_number: 1002 }]);
    db.seed('from inventory', [mockInventory]);
    db.seed('from location_stocks', [
      { location_id: 'wh-default', variant_id: 'var-1', quantity: 8, reserved: 0 },
    ]);

    const orderInput = {
      customer_id: 'cust-1',
      email: 'client@example.com',
      items: [{ variant_id: 'var-1', quantity: 1 }],
      shipping_cents: 0,
      discount_cents: 0,
      note: 'Routage fallback',
      source: 'web',
      shipping_address: {
        country: 'CA',
        state: 'ON', // Ontario -> Ne matche pas QC
        postal_code: 'M5V 2T6',
      },
    };

    const res = await createOrderCore(env, 'client-1', orderInput, 'user-1');

    expect(res.id).toBeDefined();
    
    // Assertion : Utilisé l'entrepôt par défaut "wh-default"
    const insertOrderCalls = db.calls.filter(c => /insert into orders/i.test(c.sql));
    expect(insertOrderCalls[0].args).toContain('wh-default');

    // Assertion : Réservation locale sur wh-default
    const locationStocksUpdate = db.calls.filter(c => /insert into location_stocks/i.test(c.sql));
    expect(locationStocksUpdate.length).toBe(1);
    expect(locationStocksUpdate[0].args[0]).toBe('wh-default');
  });

  it('utilise le warehouse par défaut si aucune adresse de livraison n’est fournie', async () => {
    const { env, db } = makeEnv();

    db.seed('from order_routing_rules', mockRules);
    db.seed('from warehouses', mockWarehouses);
    db.seed('from product_variants v', [mockVariant]);
    db.seed('returning next_number', [{ next_number: 1003 }]);
    db.seed('from inventory', [mockInventory]);
    db.seed('from location_stocks', [
      { location_id: 'wh-default', variant_id: 'var-1', quantity: 5, reserved: 0 },
    ]);

    const orderInput = {
      customer_id: 'cust-1',
      email: 'client@example.com',
      items: [{ variant_id: 'var-1', quantity: 1 }],
      shipping_cents: 0,
      discount_cents: 0,
      note: 'Routage sans adresse',
      source: 'web',
      shipping_address: null as any,
    };

    const res = await createOrderCore(env, 'client-1', orderInput, 'user-1');

    expect(res.id).toBeDefined();

    const insertOrderCalls = db.calls.filter(c => /insert into orders/i.test(c.sql));
    expect(insertOrderCalls[0].args).toContain('wh-default');
  });
});
