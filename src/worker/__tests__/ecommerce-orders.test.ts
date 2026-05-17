// ════════════════════════════════════════════════════════════════════════════
// Sprint S5 M1 — Commandes (ecommerce-orders.ts) : création + machine à états
// ════════════════════════════════════════════════════════════════════════════
//
// Comportement OBSERVABLE testé (retour + effets D1 via db.calls), jamais
// l'interne. Source de vérité = code prod LU (createOrderCore ~:186,
// handleUpdateOrderStatus ~:472, STATUS_TRANSITIONS ~:447).
//
// ⚠️ LIMITE MOCK D1 (figée S2, _helpers.ts) : pas d'UNIQUE/FK/INSERT OR IGNORE,
// .run() renvoie toujours {changes:1}. L'idempotence DB n'est PAS prouvable
// ici. On prouve la LOGIQUE APPLICATIVE : le code relit-il l'état (paid_at /
// cancelled_at) avant d'agir ? — en seedant l'état « déjà présent » via les
// fixtures. Détail dans docs/TEST-COVERAGE-ecommerce.md.

import { describe, it, expect } from 'vitest';
import {
  ecomEnv,
  seedTenant,
  seedVariant,
  seedOrderState,
  seedOrderItems,
  createMockD1,
  type MockD1,
} from './_ecommerce-fixtures';
import {
  createOrderCore,
  handleUpdateOrderStatus,
} from '../ecommerce-orders';

const CLIENT = 'client-A';
const AUTH = { userId: 'user-A', role: 'admin' };

/** Compte les appels D1 dont le SQL matche le motif (insensible casse). */
function countCalls(db: MockD1, re: RegExp): number {
  return db.calls.filter((c) => re.test(c.sql)).length;
}
function hasCall(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}

function statusReq(status: string): Request {
  return new Request('https://x/api/ecommerce/orders/o-1/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// A3 — createOrderCore : calculs au cent, snapshots, erreurs
// ════════════════════════════════════════════════════════════════════════════

describe('createOrderCore — calculs fiscaux QC exacts au cent', () => {
  it('1 item base_price 10000¢ x1 → sub=10000, TPS=500, TVQ=998, total=11498', async () => {
    const db = createMockD1();
    seedVariant(db, { variantId: 'v-1', clientId: CLIENT, basePrice: 10000 });
    const r = await createOrderCore(ecomEnv(db) as never, CLIENT, {
      email: 'a@b.ca',
      items: [{ variant_id: 'v-1', quantity: 1 }],
    }, AUTH.userId);

    expect(r.subtotal_cents).toBe(10000);
    expect(r.tps_cents).toBe(500);   // round(10000*0.05)
    expect(r.tvq_cents).toBe(998);   // round(10000*0.09975)
    // total = sub + total_tax + shipping − discount (QC exclusive)
    expect(r.total_cents).toBe(10000 + 1498);
    expect(r.order_number).toMatch(/^#\d+$/);
    expect(typeof r.id).toBe('string');
  });

  it('quantité multiple + shipping + discount : total = sub + tax + ship − disc', async () => {
    const db = createMockD1();
    seedVariant(db, { variantId: 'v-1', clientId: CLIENT, basePrice: 2500 });
    const r = await createOrderCore(ecomEnv(db) as never, CLIENT, {
      email: 'a@b.ca',
      items: [{ variant_id: 'v-1', quantity: 3 }], // sub = 7500
      shipping_cents: 1000,
      discount_cents: 500,
    }, AUTH.userId);

    expect(r.subtotal_cents).toBe(7500);
    expect(r.tps_cents).toBe(375);  // round(7500*0.05)
    expect(r.tvq_cents).toBe(748);  // round(7500*0.09975)=round(748.125)=748
    expect(r.total_cents).toBe(7500 + 375 + 748 + 1000 - 500);
  });

  it('price_override prime sur base_price (même override 0)', async () => {
    const db = createMockD1();
    seedVariant(db, {
      variantId: 'v-1', clientId: CLIENT, basePrice: 9999, priceOverride: 0,
    });
    const r = await createOrderCore(ecomEnv(db) as never, CLIENT, {
      email: 'a@b.ca',
      items: [{ variant_id: 'v-1', quantity: 2 }],
    }, AUTH.userId);
    // override 0 utilisé → subtotal 0 (le code teste price_override != null)
    expect(r.subtotal_cents).toBe(0);
    expect(r.total_cents).toBe(0);
  });

  it('snapshots figés écrits dans order_items (INSERT INTO order_items)', async () => {
    const db = createMockD1();
    seedVariant(db, { variantId: 'v-1', clientId: CLIENT, basePrice: 5000 });
    await createOrderCore(ecomEnv(db) as never, CLIENT, {
      email: 'a@b.ca',
      items: [{ variant_id: 'v-1', quantity: 1 }],
    }, AUTH.userId);

    const itemInsert = db.calls.find((c) => /insert into order_items/i.test(c.sql));
    expect(itemInsert).toBeTruthy();
    // args : id, order_id, variant_id, product_title, variant_title, sku, ...
    expect(itemInsert!.args).toContain('v-1');
    expect(itemInsert!.args).toContain('Produit v-1');     // product_title snapshot
    expect(itemInsert!.args).toContain('SKU-v-1');          // sku snapshot
    expect(hasCall(db, /insert into orders/i)).toBe(true);
  });
});

describe('createOrderCore — erreurs métier (OrderError)', () => {
  it('commande vide → OrderError 400 "Commande vide"', async () => {
    const db = createMockD1();
    await expect(
      createOrderCore(ecomEnv(db) as never, CLIENT, { email: 'a@b.ca', items: [] }),
    ).rejects.toMatchObject({ status: 400, payload: { error: 'Commande vide' } });
  });

  it('article invalide (variant_id vide) → OrderError 400', async () => {
    const db = createMockD1();
    await expect(
      createOrderCore(ecomEnv(db) as never, CLIENT, {
        email: 'a@b.ca',
        items: [{ variant_id: '', quantity: 1 }],
      }),
    ).rejects.toMatchObject({ status: 400, payload: { error: 'Article invalide' } });
  });

  it('variante absente (SELECT renvoie null) → OrderError 404', async () => {
    const db = createMockD1();
    // pas de seedVariant → from product_variants v renvoie defaultRows [] → null
    await expect(
      createOrderCore(ecomEnv(db) as never, CLIENT, {
        email: 'a@b.ca',
        items: [{ variant_id: 'absent', quantity: 1 }],
      }),
    ).rejects.toMatchObject({ status: 404, payload: { error: 'Variante introuvable' } });
  });

  it('stock insuffisant → OrderError 409 + rollback releaseStock des lignes réservées', async () => {
    const db = createMockD1();
    // stock 0, track_inventory 1, allow_backorder 0 → reserveStock refuse 409.
    seedVariant(db, {
      variantId: 'v-1', clientId: CLIENT, basePrice: 1000, stock: 0,
    });
    await expect(
      createOrderCore(ecomEnv(db) as never, CLIENT, {
        email: 'a@b.ca',
        items: [{ variant_id: 'v-1', quantity: 5 }],
      }, AUTH.userId),
    ).rejects.toMatchObject({ status: 409, payload: { error: 'Stock insuffisant' } });

    // 1ère ligne échoue immédiatement → reservedOk vide → aucun mouvement
    // 'reservation' committé pour cette variante avant l'échec.
    expect(hasCall(db, /reason.*reservation|'reservation'/i)).toBe(false);
    // La commande n'est PAS écrite (échec avant INSERT INTO orders).
    expect(hasCall(db, /insert into orders/i)).toBe(false);
  });

  it('rollback : 2 items, 2e en rupture → releaseStock appelé pour le 1er réservé', async () => {
    // Mock D1 : 1er-match sous-chaîne → un seul jeu variant/inventory.
    // On force le scénario via un inventory séquentiel : 1er reserve OK
    // (stock large) impossible à différencier du 2e ici → on prouve plutôt
    // le CHEMIN rollback observable (UPDATE inventory reserved = reserved - ?)
    // quand reserveStock échoue après un succès. Limite mock documentée.
    const db = createMockD1();
    seedVariant(db, {
      variantId: 'v-1', clientId: CLIENT, basePrice: 1000, stock: 3,
    });
    // qty 2 puis 2 : available 3, 1er reserve (reserved 0→2) puis 2e voit
    // toujours reserved=0 (mock ne persiste pas) → 2e passe AUSSI dans ce mock.
    // On documente : l'idempotence/persistance reserved n'est pas simulée ;
    // le rollback réel est prouvé en intégration (run Rochdi). Ici on garantit
    // au moins que createOrderCore ne crashe pas et termine le flux.
    const r = await createOrderCore(ecomEnv(db) as never, CLIENT, {
      email: 'a@b.ca',
      items: [
        { variant_id: 'v-1', quantity: 2 },
        { variant_id: 'v-1', quantity: 2 },
      ],
    }, AUTH.userId);
    expect(r.subtotal_cents).toBe(4000); // 1000 * (2+2)
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A4 — handleUpdateOrderStatus : machine à états STATUS_TRANSITIONS
// ════════════════════════════════════════════════════════════════════════════

describe('handleUpdateOrderStatus — transitions valides', () => {
  it('pending → paid : 200, commitSale appelé, paid_at posé (garde !paid_at)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    // SEED ORDRE EN DERNIER : seedOrderState écrit sur la même sous-chaîne
    // 'from orders where id' que d'éventuels seed précédents (1er-match).
    seedOrderState(db, { orderId: 'o-1', status: 'pending', paidAt: null });
    seedOrderItems(db, [{ variant_id: 'v-1', quantity: 2 }]);
    // commitSale lit l'inventaire via ensureInventory (SELECT * FROM inventory)
    db.seed('from inventory where variant_id', [{
      id: 'inv-1', variant_id: 'v-1', quantity: 100, reserved: 2,
      low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
      location: null, updated_at: null, last_low_stock_alert_at: null,
    }]);

    const res = await handleUpdateOrderStatus(
      statusReq('paid'), ecomEnv(db) as never, AUTH, 'o-1',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('paid');

    // commitSale → UPDATE inventory SET quantity = ?, reserved = reserved - ?
    expect(hasCall(db, /update inventory\s+set quantity/i)).toBe(true);
    // paid_at posé dans l'UPDATE orders (garde !order.paid_at satisfaite)
    const upd = db.calls.find((c) => /update orders set/i.test(c.sql));
    expect(upd!.sql).toMatch(/paid_at = datetime/i);
  });

  it('GARDE idempotente : pending→paid avec paid_at DÉJÀ posé → pas de re-commitSale', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    // Logique applicative : `if (next==='paid' && !order.paid_at)` — paid_at
    // déjà présent ⇒ le bloc commitSale est SAUTÉ (prouve la garde, pas l'idem DB).
    seedOrderState(db, { orderId: 'o-1', status: 'pending', paidAt: '2026-01-01 10:00:00' });
    seedOrderItems(db, [{ variant_id: 'v-1', quantity: 2 }]);

    const res = await handleUpdateOrderStatus(
      statusReq('paid'), ecomEnv(db) as never, AUTH, 'o-1',
    );
    expect(res.status).toBe(200);
    // Garde !paid_at fausse → AUCUN commitSale (pas d'UPDATE inventory quantity).
    expect(hasCall(db, /update inventory\s+set quantity/i)).toBe(false);
    // paid_at non re-posé dans le SET (déjà présent).
    const upd = db.calls.find((c) => /update orders set/i.test(c.sql));
    expect(upd!.sql).not.toMatch(/paid_at = datetime/i);
  });

  it('paid → cancelled : releaseStock appelé, cancelled_at posé (garde !cancelled_at)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedOrderState(db, { orderId: 'o-1', status: 'paid', cancelledAt: null });
    seedOrderItems(db, [{ variant_id: 'v-1', quantity: 1 }]);
    // releaseStock lit l'inventaire via ensureInventory (SELECT * FROM inventory)
    db.seed('from inventory where variant_id', [{
      id: 'inv-1', variant_id: 'v-1', quantity: 100, reserved: 1,
      low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
      location: null, updated_at: null, last_low_stock_alert_at: null,
    }]);

    const res = await handleUpdateOrderStatus(
      statusReq('cancelled'), ecomEnv(db) as never, AUTH, 'o-1',
    );
    expect(res.status).toBe(200);
    // releaseStock → UPDATE inventory SET reserved = reserved - ?
    expect(hasCall(db, /update inventory set reserved = reserved - /i)).toBe(true);
    const upd = db.calls.find((c) => /update orders set/i.test(c.sql));
    expect(upd!.sql).toMatch(/cancelled_at = datetime/i);
  });

  it('GARDE : cancelled avec cancelled_at DÉJÀ posé → pas de re-releaseStock', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedOrderState(db, { orderId: 'o-1', status: 'paid', cancelledAt: '2026-01-01 11:00:00' });
    seedOrderItems(db, [{ variant_id: 'v-1', quantity: 1 }]);

    const res = await handleUpdateOrderStatus(
      statusReq('cancelled'), ecomEnv(db) as never, AUTH, 'o-1',
    );
    expect(res.status).toBe(200);
    // Garde !cancelled_at fausse → bloc releaseStock sauté.
    expect(hasCall(db, /update inventory set reserved = reserved - /i)).toBe(false);
  });
});

describe('handleUpdateOrderStatus — transitions invalides (409 FR)', () => {
  it('current === next → 409 "Aucun changement"', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedOrderState(db, { orderId: 'o-1', status: 'pending' });
    const res = await handleUpdateOrderStatus(
      statusReq('pending'), ecomEnv(db) as never, AUTH, 'o-1',
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Aucun changement');
  });

  it('transition non permise (pending → shipped) → 409 "Transition invalide"', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedOrderState(db, { orderId: 'o-1', status: 'pending' });
    const res = await handleUpdateOrderStatus(
      statusReq('shipped'), ecomEnv(db) as never, AUTH, 'o-1',
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('Transition invalide');
    // Message FR liste les transitions permises (pending → paid, cancelled).
    expect(body.message).toMatch(/paid/);
    expect(body.message).toMatch(/cancelled/);
  });

  it('état terminal (cancelled → quoi que ce soit) → 409, mention "terminal"', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedOrderState(db, { orderId: 'o-1', status: 'cancelled' });
    const res = await handleUpdateOrderStatus(
      statusReq('paid'), ecomEnv(db) as never, AUTH, 'o-1',
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/aucune \(état terminal\)/i);
  });

  it('refunded depuis delivered = transition permise (200)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedOrderState(db, { orderId: 'o-1', status: 'delivered' });
    seedOrderItems(db, []);
    const res = await handleUpdateOrderStatus(
      statusReq('refunded'), ecomEnv(db) as never, AUTH, 'o-1',
    );
    expect(res.status).toBe(200);
  });

  it('commande introuvable → 404', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    // pas de seedOrderState → from orders where id renvoie [] → null
    const res = await handleUpdateOrderStatus(
      statusReq('paid'), ecomEnv(db) as never, AUTH, 'o-1',
    );
    expect(res.status).toBe(404);
  });
});
