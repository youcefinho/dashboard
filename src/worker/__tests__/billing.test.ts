import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, type MockD1 } from './_helpers';
import { handleCreateInvoice } from '../billing';

type Env = { DB: MockD1 };

const AUTH_ADMIN = { userId: 'admin-1', role: 'admin', clientId: 'client-1' };
const AUTH_BROKER = { userId: 'broker-1', role: 'broker', clientId: 'client-1' };

describe('billing.ts — handleCreateInvoice avec devise (Sprint 87)', () => {
  let db: MockD1;

  beforeEach(() => {
    db = createMockD1();
  });

  it('crée une facture avec la devise par défaut CAD si non spécifiée', async () => {
    // Mock de la requête count pour nextInvoiceNumber
    db.seed('SELECT COUNT(*) AS n FROM invoices', [{ n: 5 }]);

    const req = new Request('https://api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        client_id: 'client-1',
        description: 'Test facture CAD',
        items: [
          { label: 'Item 1', qty: 2, unit_price: 50 }
        ]
      })
    });

    const res = await handleCreateInvoice(req, { DB: db } as unknown as Env, AUTH_BROKER);
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBeDefined();

    // Vérifie que l'insertion a bien utilisé CAD
    const insertCall = db.calls.find(c => c.sql.includes('INSERT INTO invoices'));
    expect(insertCall).toBeDefined();
    // Les binds pour (id, client_id, lead_id, amount, currency, description, status, payment_url, ...)
    // amount = 114.975 (avec taxes), currency = 'CAD', status = 'draft'
    expect(insertCall?.args).toContain('CAD');
  });

  it('crée une facture avec une devise supportée explicite (USD)', async () => {
    db.seed('SELECT COUNT(*) AS n FROM invoices', [{ n: 0 }]);

    const req = new Request('https://api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        client_id: 'client-1',
        description: 'Test facture USD',
        currency: 'USD',
        items: [
          { label: 'Item USD', qty: 1, unit_price: 100 }
        ]
      })
    });

    const res = await handleCreateInvoice(req, { DB: db } as unknown as Env, AUTH_BROKER);
    expect(res.status).toBe(201);

    const insertCall = db.calls.find(c => c.sql.includes('INSERT INTO invoices'));
    expect(insertCall).toBeDefined();
    expect(insertCall?.args).toContain('USD');
  });

  it('retombe sur CAD si la devise fournie est invalide', async () => {
    db.seed('SELECT COUNT(*) AS n FROM invoices', [{ n: 0 }]);

    const req = new Request('https://api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        client_id: 'client-1',
        description: 'Test devise invalide',
        currency: 'INVALID_CURRENCY_XYZ',
        items: [
          { label: 'Item 1', qty: 1, unit_price: 10 }
        ]
      })
    });

    const res = await handleCreateInvoice(req, { DB: db } as unknown as Env, AUTH_BROKER);
    expect(res.status).toBe(201);

    const insertCall = db.calls.find(c => c.sql.includes('INSERT INTO invoices'));
    expect(insertCall).toBeDefined();
    expect(insertCall?.args).toContain('CAD');
    expect(insertCall?.args).not.toContain('INVALID_CURRENCY_XYZ');
  });
});
