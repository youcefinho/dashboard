import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { handleStoreProduct, handleStoreGetCart, handleStoreCheckout } from '../storefront-public';

function makeEnv(): { env: Env; db: ReturnType<typeof createMockD1> } {
  const db = createMockD1();
  const env = { DB: db } as unknown as Env;
  return { env, db };
}

function getUrl(path: string): URL {
  return new URL(`http://x${path}`);
}

function postReq(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('Sprint 68 — B2B Pricing on Public Storefront', () => {
  it('handleStoreProduct : résout le prix B2B spécifique si customer_id est fourni', async () => {
    const { env, db } = makeEnv();

    // 1) Mock clients (un seul pour resolveStoreClientId et storeCurrency)
    db.seed('from clients', [
      { id: 'client-1', store_slug: 'my-store', store_settings_json: JSON.stringify({ enabled: true }), default_currency: 'CAD' }
    ]);

    // 2) Mock lookup product ACTIF
    db.seed('from products', [
      { id: 'p-1', slug: 'product-1', title: 'Product 1', description: 'Desc', base_price: 10000, currency: 'CAD' }
    ]);

    // 3) Mock product_variants (fiche produit)
    db.seed('left join inventory', [
      { variant_id: 'v-1', title: 'Variant 1', price_override: 10000, available: 10 }
    ]);

    // 4) Mock product_images
    db.seed('from product_images', [{ url: 'http://img.jpg' }]);

    // 5) Mock resolveTierPrice intern loops
    db.seed('price_cents from product_variants', [{ price_cents: 10000 }]);
    db.seed('from customer_group_assignments', [{ group_id: 'group-vip' }]);
    db.seed('from tier_prices', [
      { price_cents: 8000, group_id: 'group-vip', min_quantity: 1 }
    ]);

    const url = getUrl('/api/store/my-store/products/product-1?customer_id=cust-vip');
    const res = await handleStoreProduct(env, 'my-store', 'product-1', url);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: Record<string, any> };
    expect(body.data.variants[0].price_cents).toBe(8000); // 8000c B2B price instead of 10000c base price
  });

  it('handleStoreGetCart : applique le tarif B2B sur les lignes de panier pour un client connecté', async () => {
    const { env, db } = makeEnv();

    // 1) Mock clients
    db.seed('from clients', [
      { id: 'client-1', store_slug: 'my-store', store_settings_json: JSON.stringify({ enabled: true }), default_currency: 'CAD' }
    ]);

    // 2) Mock active cart lookup
    db.seed('from carts', [
      { id: 'cart-1', client_id: 'client-1', customer_id: 'cust-vip', token: 'token-1', status: 'active' }
    ]);

    // 3) Mock loadCartLines (référence cart_items)
    db.seed('from cart_items', [
      { id: 'line-1', variant_id: 'v-1', quantity: 2, product_id: 'p-1', product_title: 'Product 1', variant_title: 'Variant 1', unit_price_cents: 10000 }
    ]);

    // 4) Mock resolveTierPrice intern loops
    db.seed('price_cents from product_variants', [{ price_cents: 10000 }]);
    db.seed('from customer_group_assignments', [{ group_id: 'group-vip' }]);
    db.seed('from tier_prices', [
      { price_cents: 7500, group_id: 'group-vip', min_quantity: 1 }
    ]);

    const url = getUrl('/api/store/my-store/cart?token=token-1');
    const res = await handleStoreGetCart(env, 'my-store', url);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: Record<string, any> };
    expect(body.data.items[0].price_cents).toBe(7500); // 7500c instead of 10000c
    expect(body.data.subtotal_cents).toBe(15000); // 7500c * 2 qty = 15000c
  });

  it('handleStoreCheckout : applique le tarif B2B et crée la commande avec le bon customer_id', async () => {
    const { env, db } = makeEnv();

    // 1) Mock clients
    db.seed('from clients', [
      { id: 'client-1', store_slug: 'my-store', store_settings_json: JSON.stringify({ enabled: true }), default_currency: 'CAD' }
    ]);

    // 2) Mock active cart lookup
    db.seed('from carts', [
      { id: 'cart-1', client_id: 'client-1', customer_id: null, token: 'token-1', status: 'active' }
    ]);

    // 3) Mock customer search by email
    db.seed('from customers', [{ id: 'cust-vip' }]);

    // 4) Mock loadCartLines (référence cart_items)
    db.seed('from cart_items', [
      { id: 'line-1', variant_id: 'v-1', quantity: 2, product_id: 'p-1', product_title: 'Product 1', variant_title: 'Variant 1', unit_price_cents: 10000 }
    ]);

    // 5) Mock resolveTierPrice in storefront-public & createOrderCore
    db.seed('price_cents from product_variants', [{ price_cents: 10000 }]);
    db.seed('from customer_group_assignments', [{ group_id: 'group-vip' }]);
    db.seed('from tier_prices', [
      { price_cents: 7500, group_id: 'group-vip', min_quantity: 1 }
    ]);

    // 6) Mock checkout sub-routines (shipping, tax, counter, warehouses, inventory, location_stocks)
    db.seed('from order_routing_rules', []);
    db.seed('from warehouses', [{ id: 'wh-1', is_default: 1, name: 'Warehouse 1' }]);
    db.seed('join products', [
      { variant_id: 'v-1', variant_title: 'Variant 1', sku: 'SKU1', price_override: 10000, product_id: 'p-1', product_title: 'Product 1', base_price: 10000 }
    ]);
    db.seed('from shipping_zones', []);
    db.seed('from order_number_counters', []);
    db.seed('update order_number_counters', [{ next_number: 1002 }]);
    db.seed('from inventory', [{ quantity: 100, reserved: 0 }]);
    db.seed('from location_stocks', [{ quantity: 100, reserved: 0, location_id: 'wh-1' }]);
    db.seed('update inventory', []);

    const payload = {
      email: 'vip@customer.com',
      cart_token: 'token-1',
      address: { country: 'CA' }
    };
    
    const req = postReq('/api/store/my-store/checkout', payload);
    const res = await handleStoreCheckout(req, env, 'my-store');
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: Record<string, any> };
    expect(body.data.total_cents).toBe(17246); // (7500 * 2) = 15000 subtotal + 5% TPS (750c) + 9.975% TVQ (1496c) = 17246c

    // Verify customer_id resolved & bound during orders insertions
    const orderInserts = db.calls.filter(c => /insert into orders/i.test(c.sql));
    expect(orderInserts.length).toBeGreaterThan(0);
    // (id, client_id, customer_id, order_number, ...)
    expect(orderInserts[0].args[2]).toBe('cust-vip'); // Bound correctly to orders table
  });
});
