// ── dropship-portal.test.ts — Sprint 67 Portail Fournisseurs & Dropshipping
//
// Valide le bon fonctionnement et la sécurité du portail dropship :
//   - Garde globale anti-IDOR rejetant les routes interdites avec un code 403.
//   - Accès autorisé aux routes du portail (orders, ship, logout, me).
//   - Listage des commandes filtrées par le dropship_partner_id de l'utilisateur.
//   - Expédition d'une commande via un numéro de suivi valide.
//

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import worker from '../../worker';
import {
  handleListPortalDropshipOrders,
  handleShipPortalDropshipOrder,
  handleListDropshipPartners,
  handleCreateDropshipPartner,
  handleUpdateDropshipPartner,
  handleDeleteDropshipPartner
} from '../dropship-portal';
import type { Env } from '../types';
import { requireAuth } from '../helpers';

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    requireAuth: vi.fn(),
    audit: vi.fn().mockResolvedValue(true)
  };
});

function makeEnv(db = createMockD1()) {
  return { env: { DB: db } as unknown as Env, db };
}

describe('Sprint 67 — Portail Fournisseurs & Dropshipping', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Sécurité — Garde anti-IDOR globale (worker.fetch)', () => {
    it('bloque l\'accès aux endpoints CRM standards pour un partenaire dropship (403)', async () => {
      const { env, db } = makeEnv();
      
      // Simuler l'authentification
      vi.mocked(requireAuth).mockResolvedValue({ userId: 'usr-partner', role: 'store_manager' });
      
      // Seed pour resolveTenantContext
      db.seed('from users where id', [
        { client_id: 'client-1', account_level: 'user', agency_id: null, dropship_partner_id: 'partner-123' }
      ]);
      db.seed('from user_sub_accounts', []);
      db.seed('agency_id from clients', [{ agency_id: null }]);
      // Seed pour resolveCapabilities
      db.seed('select capability_id', []);

      // Requête vers une route interdite (ex: products)
      const req = new Request('http://localhost/api/ecommerce/products', {
        headers: { 'Authorization': 'Bearer fake-token' }
      });
      
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
      const res = await worker.fetch(req, env, mockCtx as any);
      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body.error).toContain('Accès interdit');
    });

    it('autorise l\'accès aux routes du portail dropship pour un partenaire dropship', async () => {
      const { env, db } = makeEnv();
      
      vi.mocked(requireAuth).mockResolvedValue({ userId: 'usr-partner', role: 'store_manager' });
      
      db.seed('from users where id', [
        { client_id: 'client-1', account_level: 'user', agency_id: null, dropship_partner_id: 'partner-123' }
      ]);
      db.seed('from user_sub_accounts', []);
      db.seed('agency_id from clients', [{ agency_id: null }]);
      db.seed('select capability_id', []);

      // Seed pour dropship_suppliers de handleListPortalDropshipOrders
      db.seed('dropship_suppliers', [{ id: 'sup-1', dropship_partner_id: 'partner-123', client_id: 'client-1' }]);
      db.seed('dropship_orders', []);

      // Requête vers la liste des commandes portail
      const req = new Request('http://localhost/api/dropship-portal/orders', {
        headers: { 'Authorization': 'Bearer fake-token' }
      });
      
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
      const res = await worker.fetch(req, env, mockCtx as any);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toEqual([]);
    });
  });

  describe('Logique Portail — Commandes (handleListPortalDropshipOrders)', () => {
    it('filtre les commandes dropship par rapport aux fournisseurs du partenaire', async () => {
      const { env, db } = makeEnv();
      
      const auth = {
        userId: 'usr-partner',
        role: 'store_manager',
        clientId: 'client-1',
        tenant: {
          clientId: 'client-1',
          dropshipPartnerId: 'partner-123'
        } as any
      };

      // 1) Seed les fournisseurs associés au partenaire
      db.seed('from dropship_suppliers', [
        { id: 'sup-1', dropship_partner_id: 'partner-123', client_id: 'client-1' }
      ]);

      // 2) Seed les commandes de dropship pour ces fournisseurs
      db.seed('from dropship_orders', [
        {
          id: 'do-1',
          order_id: 'ord-1',
          supplier_id: 'sup-1',
          status: 'pending',
          created_at: '2026-05-28T12:00:00Z',
          updated_at: '2026-05-28T12:00:00Z',
          customer_id: 'cust-1',
          shipping_address: '123 Rue de la Montagne, Montréal',
          contact_email: 'customer@gmail.com',
          contact_phone: '514-555-0199',
          order_notes: 'Laisser sur le porche'
        }
      ]);

      // 3) Seed les items de la commande
      db.seed('from order_items', [
        {
          id: 'item-1',
          order_id: 'ord-1',
          product_id: 'prod-1',
          variant_id: 'var-1',
          quantity: 2,
          price_cents: 2999,
          name: 'Produit A'
        }
      ]);

      const res = await handleListPortalDropshipOrders(env, auth);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('do-1');
      expect(body.data[0].items).toHaveLength(1);
      expect(body.data[0].items[0].name).toBe('Produit A');
    });
  });

  describe('Logique Portail — Expédition (handleShipPortalDropshipOrder)', () => {
    it('met à jour la commande dropship en "shipped" et renseigne le tracking number', async () => {
      const { env, db } = makeEnv();
      
      const auth = {
        userId: 'usr-partner',
        role: 'store_manager',
        clientId: 'client-1',
        tenant: {
          clientId: 'client-1',
          dropshipPartnerId: 'partner-123'
        } as any
      };

      // Seed de vérification de la commande existante
      db.seed('from dropship_orders', [
        { id: 'do-1', supplier_id: 'sup-1', order_id: 'ord-1' }
      ]);

      const req = new Request('http://localhost/api/dropship-portal/orders/do-1/ship', {
        method: 'POST',
        body: JSON.stringify({ tracking_number: 'TRK-XYZ-999' })
      });

      const res = await handleShipPortalDropshipOrder(req, env, auth, 'do-1');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.success).toBe(true);
      expect(body.data.status).toBe('shipped');
      expect(body.data.tracking_number).toBe('TRK-XYZ-999');

      // Vérifier que l'update SQL a bien été exécuté
      const updateCall = db.calls.find(c => c.sql.toLowerCase().includes('update dropship_orders'));
      expect(updateCall).toBeDefined();
      expect(updateCall!.args).toContain('TRK-XYZ-999');
      expect(updateCall!.args).toContain('do-1');
    });

    it('rejette si le numéro de suivi est manquant', async () => {
      const { env } = makeEnv();
      
      const auth = {
        userId: 'usr-partner',
        role: 'store_manager',
        clientId: 'client-1',
        tenant: {
          clientId: 'client-1',
          dropshipPartnerId: 'partner-123'
        } as any
      };

      const req = new Request('http://localhost/api/dropship-portal/orders/do-1/ship', {
        method: 'POST',
        body: JSON.stringify({ tracking_number: '' })
      });

      const res = await handleShipPortalDropshipOrder(req, env, auth, 'do-1');
      expect(res.status).toBe(400);
    });
  });
});
