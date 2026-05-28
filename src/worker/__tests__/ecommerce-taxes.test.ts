// ════════════════════════════════════════════════════════════════════════════
// Sprint 70 — Tests de taxes multi-régions (ecommerce-taxes.ts / D1 tax_rates)
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import {
  ecomEnv,
  seedTenant,
  seedVariant,
  createMockD1,
} from './_ecommerce-fixtures';
import {
  handleListTaxRates,
  handleCreateTaxRate,
  handleUpdateTaxRate,
  handleDeleteTaxRate,
} from '../ecommerce-taxes';
import { createOrderCore } from '../ecommerce-orders';

const CLIENT = 'client-A';
const AUTH = { userId: 'user-A', role: 'admin' };

function createReq(body: Record<string, unknown>): Request {
  return new Request('https://x/api/tax-rates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function updateReq(body: Record<string, unknown>): Request {
  return new Request('https://x/api/tax-rates/tr-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('ecommerce-taxes CRUD', () => {
  it('Crée un taux de taxe en base', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);

    const req = createReq({
      country: 'CA',
      state_province: 'QC',
      rate_tps: 0.05,
      rate_tvq: 0.09975,
      rate_tva: 0,
      is_active: 1,
    });

    const res = await handleCreateTaxRate(req, ecomEnv(db) as never, AUTH);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { country: string; rate_tps: number } };
    expect(body.data.country).toBe('CA');
    expect(body.data.rate_tps).toBe(0.05);

    // Vérifie qu'il y a eu un INSERT dans tax_rates
    expect(db.calls.some((c) => /insert into tax_rates/i.test(c.sql))).toBe(true);
  });

  it('Met à jour un taux de taxe', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    
    // Seed un taux de taxe existant pour le SELECT de vérification
    db.seed('SELECT id FROM tax_rates WHERE id = ? AND client_id = ?', [{ id: 'tr-1' }]);

    const req = updateReq({
      rate_tps: 0.06,
      is_active: 0,
    });

    const res = await handleUpdateTaxRate(req, ecomEnv(db) as never, AUTH, 'tr-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; rate_tps: number; is_active: number } };
    expect(body.data.id).toBe('tr-1');
    expect(body.data.rate_tps).toBe(0.06);
    expect(body.data.is_active).toBe(0);

    expect(db.calls.some((c) => /update tax_rates set/i.test(c.sql))).toBe(true);
  });

  it('Supprime un taux de taxe', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    db.seed('SELECT id FROM tax_rates WHERE id = ? AND client_id = ?', [{ id: 'tr-1' }]);

    const res = await handleDeleteTaxRate(ecomEnv(db) as never, AUTH, 'tr-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; deleted: boolean } };
    expect(body.data.id).toBe('tr-1');
    expect(body.data.deleted).toBe(true);

    expect(db.calls.some((c) => /delete from tax_rates/i.test(c.sql))).toBe(true);
  });

  it('Liste les taux de taxe', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    db.seed('SELECT id, client_id, country, state_province, rate_tps, rate_tvq, rate_tva, is_active, created_at, updated_at', [
      { id: 'tr-1', client_id: CLIENT, country: 'CA', state_province: 'QC', rate_tps: 0.05, rate_tvq: 0.09975, rate_tva: 0, is_active: 1 },
    ]);

    const res = await handleListTaxRates(ecomEnv(db) as never, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; country: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('tr-1');
    expect(body.data[0].country).toBe('CA');
  });
});

describe('createOrderCore avec tax_rates', () => {
  it('Calcule la TPS et la TVQ selon tax_rates', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedVariant(db, { variantId: 'v-1', clientId: CLIENT, basePrice: 10000 });

    // Seed la table tax_rates pour CA/QC
    db.seed('SELECT rate_tps, rate_tvq, rate_tva FROM tax_rates', [
      { rate_tps: 0.05, rate_tvq: 0.09975, rate_tva: 0 },
    ]);

    const r = await createOrderCore(ecomEnv(db) as never, CLIENT, {
      email: 'a@b.ca',
      items: [{ variant_id: 'v-1', quantity: 1 }],
      tax_country: 'CA',
      shipping_address: { state: 'QC' },
    }, AUTH.userId);

    expect(r.subtotal_cents).toBe(10000);
    expect(r.tps_cents).toBe(500); // 5%
    expect(r.tvq_cents).toBe(998); // 9.975%
    expect(r.total_cents).toBe(11498);
  });

  it('Calcule la TVH pour l\'Ontario via tax_rates', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedVariant(db, { variantId: 'v-1', clientId: CLIENT, basePrice: 10000 });

    // Seed la table tax_rates pour CA/ON (TVH 13%)
    db.seed('SELECT rate_tps, rate_tvq, rate_tva FROM tax_rates', [
      { rate_tps: 0.13, rate_tvq: 0, rate_tva: 0 },
    ]);

    const r = await createOrderCore(ecomEnv(db) as never, CLIENT, {
      email: 'a@b.ca',
      items: [{ variant_id: 'v-1', quantity: 1 }],
      tax_country: 'CA',
      shipping_address: { state: 'ON' },
    }, AUTH.userId);

    expect(r.subtotal_cents).toBe(10000);
    expect(r.tps_cents).toBe(1300); // 13%
    expect(r.tvq_cents).toBe(0);
    expect(r.total_cents).toBe(11300);
  });

  it('Calcule la TVA inclusive pour l\'Europe (France) via tax_rates', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedVariant(db, { variantId: 'v-1', clientId: CLIENT, basePrice: 12000 });

    // Seed la table tax_rates pour FR (TVA 20% inclusive)
    db.seed('SELECT rate_tps, rate_tvq, rate_tva FROM tax_rates', [
      { rate_tps: 0, rate_tvq: 0, rate_tva: 0.20 },
    ]);

    const r = await createOrderCore(ecomEnv(db) as never, CLIENT, {
      email: 'a@b.ca',
      items: [{ variant_id: 'v-1', quantity: 1 }],
      tax_country: 'FR',
      shipping_address: { country: 'FR' },
    }, AUTH.userId);

    expect(r.subtotal_cents).toBe(12000);
    // TVA inclusive: 12000 - 12000/1.2 = 2000
    expect(r.tps_cents).toBe(2000);
    expect(r.tvq_cents).toBe(0);
    // Prix total inchangé car la taxe est incluse
    expect(r.total_cents).toBe(12000);
  });

  it('Retombe sur le calcul fiscal legacy (QC) s\'il n\'y a pas de configuration tax_rates', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedVariant(db, { variantId: 'v-1', clientId: CLIENT, basePrice: 10000 });

    // Pas de seed tax_rates -> la requête D1 renvoie null

    const r = await createOrderCore(ecomEnv(db) as never, CLIENT, {
      email: 'a@b.ca',
      items: [{ variant_id: 'v-1', quantity: 1 }],
      tax_country: 'CA',
      shipping_address: { state: 'QC' },
    }, AUTH.userId);

    // Fallback QC legacy actif: TPS 5% + TVQ 9.975%
    expect(r.subtotal_cents).toBe(10000);
    expect(r.tps_cents).toBe(500);
    expect(r.tvq_cents).toBe(998);
    expect(r.total_cents).toBe(11498);
  });
});
