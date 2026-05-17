// ── Tests moteur sync omnicanal — Sprint S5 M3.C1/C2/C3 ─────────────────────
//
// Couvre src/worker/ecommerce-channel-sync.ts (LECTURE SEULE — 0 modif prod) :
//   - ingestProductEvent  → idempotence channel_product_map (logique applicative)
//   - ingestOrderEvent     → idempotence orders.external_id (createOrderCore
//                             non rappelé sur rejeu) + attribution source canal
//   - syncProductOut       → anti-echo (skip si event entrant récent) + maj
//                             last_synced_at + résilience push qui throw
//
// ⚠️ LIMITE MOCK D1 (documentée dans le RAPPORT M3, pas le doc partagé) :
// le mock ne simule NI UNIQUE, NI FK, NI INSERT OR IGNORE, NI meta.changes
// (.run() → {changes:1}). L'idempotence au niveau BASE (contrainte
// channel_product_map.external_id / orders.external_id) n'est donc PAS
// prouvable ici. On prouve la LOGIQUE APPLICATIVE : on seed l'état « déjà
// mappé / déjà importé » via db.seed et on asserte que le code RELIT le map
// AVANT d'agir et NE ré-INSÈRE PAS / NE rappelle PAS createOrderCore
// (absence de l'INSERT/appel via db.calls). Le run réel (contraintes DB
// effectives) reste requis côté Rochdi.
//
// Déterministe, environment:'node'. Mock D1 partagé (_helpers.createMockD1),
// fixtures M1 FIGÉES réutilisées (seedTenant — pour cohérence, non muté).
// Complément NON-chevauchant à ecommerce-multitenant.inventory.test.ts (S2).

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, type MockD1 } from './_helpers';
import {
  ingestProductEvent,
  ingestOrderEvent,
  syncProductOut,
  type ChannelRow,
} from '../ecommerce-channel-sync';

type Env = { DB: MockD1 };

const CLIENT_A = 'client-A';

function env(db: MockD1): Env {
  return { DB: db };
}

const CHANNEL: ChannelRow = {
  id: 'chan-1',
  client_id: CLIENT_A,
  name: 'Boutique Shopify',
  type: 'shopify',
  config_ref: null,
  shop_domain: 'demo.myshopify.com',
  external_id: null,
  active: 1,
};

/** Helper : vrai si une commande SQL matchant `re` a été enregistrée. */
function called(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}

// ════════════════════════════════════════════════════════════════════════════
// M3.C1 — ingestProductEvent : idempotence channel_product_map (applicative)
// ════════════════════════════════════════════════════════════════════════════

describe('ingestProductEvent — mapping déjà existant (idempotent applicatif)', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('mapping présent → UPDATE prix/stock, PAS de ré-INSERT produit/variant', async () => {
    // Le code lit d'abord channel_product_map ; on seed l'état "déjà mappé".
    db.seed('from channel_product_map', [
      { internal_variant_id: 'var-existant' },
    ]);

    const res = await ingestProductEvent(env(db), CHANNEL, {
      id: 'ext-prod-1',
      title: 'T-shirt',
      sku: 'TS-001',
      price: '29.99',
      inventory_quantity: 12,
    });

    expect(res.ok).toBe(true);

    // Le code a RELU le map avant d'agir (preuve : SELECT sur la table map).
    expect(called(db, /select internal_variant_id from channel_product_map/i)).toBe(true);

    // Idempotence applicative : aucune ré-création produit/variant/inventory,
    // aucun nouvel INSERT dans channel_product_map.
    expect(called(db, /insert into products/i)).toBe(false);
    expect(called(db, /insert into product_variants/i)).toBe(false);
    expect(called(db, /insert into inventory/i)).toBe(false);
    expect(called(db, /insert into channel_product_map/i)).toBe(false);

    // Effet attendu d'un rejeu : rafraîchit prix variant + stock + map.
    expect(called(db, /update product_variants set price_override/i)).toBe(true);
    expect(called(db, /update inventory set quantity/i)).toBe(true);
    expect(called(db, /update channel_product_map\s+set last_synced_at/i)).toBe(true);
  });

  it('mapping présent sans quantité dans le payload → pas d UPDATE inventory', async () => {
    db.seed('from channel_product_map', [
      { internal_variant_id: 'var-existant' },
    ]);

    const res = await ingestProductEvent(env(db), CHANNEL, {
      id: 'ext-prod-1',
      title: 'T-shirt',
      sku: 'TS-001',
      price: '29.99',
      // pas d'inventory_quantity / stock_quantity → mp.quantity == null
    });

    expect(res.ok).toBe(true);
    expect(called(db, /update product_variants set price_override/i)).toBe(true);
    // Le code ne touche inventory que si mp.quantity != null.
    expect(called(db, /update inventory set quantity/i)).toBe(false);
  });
});

describe('ingestProductEvent — mapping absent (création) / payload invalide', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('mapping absent → INSERT produit + variant + inventory + map', async () => {
    // channel_product_map vide → branche création.
    db.seed('from channel_product_map', []);

    const res = await ingestProductEvent(env(db), CHANNEL, {
      id: 'ext-prod-NEW',
      title: 'Casquette',
      sku: 'CAP-9',
      price: '15.00',
      inventory_quantity: 7,
    });

    expect(res.ok).toBe(true);
    expect(called(db, /insert into products/i)).toBe(true);
    expect(called(db, /insert into product_variants/i)).toBe(true);
    expect(called(db, /insert into inventory/i)).toBe(true);
    expect(called(db, /insert into channel_product_map/i)).toBe(true);
    // Pas d'UPDATE de variante existante (rien à rafraîchir, c'est une création).
    expect(called(db, /update product_variants set price_override/i)).toBe(false);
  });

  it('external_id manquant dans le payload → conflict + log error, aucun INSERT', async () => {
    db.seed('from channel_product_map', []);

    const res = await ingestProductEvent(env(db), CHANNEL, {
      // ni id, ni product_id, ni variant_id → externalId vide
      title: 'Produit sans id externe',
      price: '9.99',
    });

    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    // Journalisé en error (best-effort) AVANT toute écriture produit.
    expect(called(db, /insert into channel_sync_log/i)).toBe(true);
    expect(called(db, /insert into products/i)).toBe(false);
    expect(called(db, /insert into channel_product_map/i)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M3.C2 — ingestOrderEvent : idempotence orders.external_id (applicative)
// ════════════════════════════════════════════════════════════════════════════

describe('ingestOrderEvent — idempotence externe (createOrderCore non rappelé)', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('commande déjà importée (même external_id, même tenant) → duplicate, pas d INSERT INTO orders', async () => {
    // importExternalOrder lit : SELECT id FROM orders WHERE external_id = ?
    // AND client_id = ?  → on matérialise l'état "déjà importé".
    db.seed('from orders where external_id', [{ id: 'order-deja-la' }]);

    const res = await ingestOrderEvent(env(db), CHANNEL, {
      id: 'ext-order-42',
      email: 'client@externe.com',
      line_items: [{ product_id: 'ext-prod-1', quantity: 2 }],
    });

    expect(res.ok).toBe(true);
    expect(res.duplicate).toBe(true);

    // Le code a relu orders par external_id AVANT d'agir.
    expect(called(db, /from orders where external_id/i)).toBe(true);

    // Idempotence applicative : createOrderCore NON rappelé → aucun
    // INSERT INTO orders (createOrderCore insère la commande). Le rejeu
    // n'a créé AUCUNE commande ni résolu les lignes.
    expect(called(db, /insert into orders/i)).toBe(false);
    expect(called(db, /from channel_product_map/i)).toBe(false);
  });

  it('external_id commande manquant → conflict + log error, aucune résolution de lignes', async () => {
    const res = await ingestOrderEvent(env(db), CHANNEL, {
      // ni id, ni order_id, ni number
      email: 'x@y.com',
      line_items: [{ product_id: 'p1', quantity: 1 }],
    });

    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    expect(called(db, /insert into channel_sync_log/i)).toBe(true);
    expect(called(db, /insert into orders/i)).toBe(false);
  });

  it('aucune ligne mappée (produits non synchronisés) → conflict, createOrderCore non appelé', async () => {
    // Pas de duplicate (orders vide) MAIS channel_product_map ne résout rien.
    db.seed('from orders where external_id', []);
    db.seed('from channel_product_map', []); // resolveOrderLines → 0 ligne

    const res = await ingestOrderEvent(env(db), CHANNEL, {
      id: 'ext-order-99',
      email: 'client@externe.com',
      line_items: [{ product_id: 'inconnu', quantity: 1 }],
    });

    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    // Lignes vides → on n'appelle PAS createOrderCore (pas d'INSERT orders).
    expect(called(db, /insert into orders/i)).toBe(false);
    // Conflit journalisé.
    expect(called(db, /insert into channel_sync_log/i)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M3.C3 — syncProductOut : anti-echo + maj last_synced_at + résilience push
// ════════════════════════════════════════════════════════════════════════════

describe('syncProductOut — anti-echo & robustesse du push sortant', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('event entrant récent (anti-echo) → push SKIP, pushFn JAMAIS appelé, log skipped', async () => {
    // map variant→external_id présent.
    db.seed('select external_id from channel_product_map', [
      { external_id: 'ext-prod-1' },
    ]);
    // recentlyReceivedInbound : SELECT 1 AS hit FROM channel_sync_log ...
    // Needle unique au SELECT anti-echo ('select 1 as hit'), n'attrape PAS
    // l'INSERT INTO channel_sync_log de logSync. → on simule un hit
    // (event entrant tout juste reçu).
    db.seed('select 1 as hit', [{ hit: 1 }]);

    let pushCalled = false;
    const pushFn = async () => {
      pushCalled = true;
      return true;
    };

    const res = await syncProductOut(env(db), CHANNEL, 'var-1', pushFn);

    expect(res.pushed).toBe(false);
    expect(res.skipped).toBe(true);
    expect(pushCalled).toBe(false); // anti-echo : on ne renvoie pas ce qu'on reçoit
    // Skip journalisé.
    expect(called(db, /insert into channel_sync_log/i)).toBe(true);
    // Pas de maj last_synced_at sur un skip.
    expect(called(db, /update channel_product_map\s+set last_synced_at/i)).toBe(false);
  });

  it('pushFn réussit → pushed=true + UPDATE last_synced_at', async () => {
    db.seed('select external_id from channel_product_map', [
      { external_id: 'ext-prod-1' },
    ]);
    // Pas de seed 'select 1 as hit' → defaultRows [] → recentlyReceivedInbound
    // renvoie false (pas d'anti-echo). resolveInventoryStrategy lit ses propres
    // tables non seedées → stratégie par défaut, pushQty borné >= 0.

    const pushFn = async () => true;
    const res = await syncProductOut(env(db), CHANNEL, 'var-1', pushFn);

    expect(res.pushed).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(called(db, /update channel_product_map\s+set\s+last_synced_at/i)).toBe(true);
  });

  it('pushFn throw → pas de crash, error loggée, last_synced_at NON mis à jour', async () => {
    db.seed('select external_id from channel_product_map', [
      { external_id: 'ext-prod-1' },
    ]);
    // Pas d'anti-echo seedé → push tenté, mais pushFn throw.

    const pushFn = async () => {
      throw new Error('connecteur Shopify HS');
    };

    // Ne doit PAS rejeter (le code catch en interne → ok=false).
    const res = await syncProductOut(env(db), CHANNEL, 'var-1', pushFn);

    expect(res.pushed).toBe(false);
    // Échec journalisé en 'error'.
    expect(called(db, /insert into channel_sync_log/i)).toBe(true);
    // Push raté → on ne touche PAS last_synced_at.
    expect(called(db, /update channel_product_map\s+set\s+last_synced_at/i)).toBe(false);
  });

  it('variant non mappé sur ce canal → pushed=false, pushFn jamais appelé', async () => {
    // channel_product_map ne renvoie aucun external_id pour ce variant.
    db.seed('select external_id from channel_product_map', []);

    let pushCalled = false;
    const res = await syncProductOut(env(db), CHANNEL, 'var-inconnu', async () => {
      pushCalled = true;
      return true;
    });

    expect(res.pushed).toBe(false);
    expect(pushCalled).toBe(false);
  });
});
