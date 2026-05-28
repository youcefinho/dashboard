import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mocks de modules (avant import du SUT) ───────────────────────────────────

vi.mock('../modules', () => ({
  getClientModules: vi.fn(async (_env: any, _userId: string) => ({
    clientId: 'cli_A',
    modules: [],
  })),
}));

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    audit: vi.fn().mockResolvedValue(true),
  };
});

// Imports des handlers et dépendances après le mocking
import {
  handleGetDialerCampaigns,
  handleCreateDialerCampaign,
  handleGetDialerCampaign,
  handleUpdateDialerCampaign,
  handleDeleteDialerCampaign,
  handleGetDialerCurrentLead,
} from '../dialer';
import { getClientModules } from '../modules';
import { audit } from '../helpers';

function makeAuth(overrides = {}) {
  return {
    userId: 'u_agent_1',
    role: 'agent',
    clientId: 'cli_A',
    ...overrides,
  } as any;
}

function makeEnv(db: any): Env {
  return { DB: db } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientModules).mockImplementation(async () => ({
    clientId: 'cli_A',
    modules: [],
  }));
});

describe('Power Dialer Handler - Tests Unitaires (Sprint 54)', () => {
  const mockAuth = makeAuth();

  describe('handleGetDialerCampaigns', () => {
    it('doit retourner les campagnes du client triées par date de création', async () => {
      const db = createMockD1();
      const campaigns = [
        { id: 'camp1', client_id: 'cli_A', name: 'Campagne A', leads_json: '["l1","l2"]', status: 'draft' },
        { id: 'camp2', client_id: 'cli_A', name: 'Campagne B', leads_json: '["l3"]', status: 'active' },
      ];
      db.seed('from dialer_campaigns', campaigns);

      const response = await handleGetDialerCampaigns(new Request('http://localhost'), makeEnv(db), mockAuth);
      expect(response.status).toBe(200);

      const body = await response.json() as any;
      expect(body.data).toHaveLength(2);
      expect(body.data[0].id).toBe('camp1');
      expect(body.data[0].lead_ids).toEqual(['l1', 'l2']);

      const sqlCall = db.calls.find(c => c.sql.includes('SELECT * FROM dialer_campaigns'));
      expect(sqlCall).toBeDefined();
      expect(sqlCall?.args[0]).toBe('cli_A');
    });
  });

  describe('handleCreateDialerCampaign', () => {
    it('doit échouer si le corps de la requête est vide ou invalide (validation Zod)', async () => {
      const db = createMockD1();
      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
      });

      const response = await handleCreateDialerCampaign(req, makeEnv(db), mockAuth);
      expect(response.status).toBe(400);

      const body = await response.json() as any;
      expect(body.error).toBe('Validation échouée');
    });

    it('doit créer la campagne et auditer l action si les leads sont valides', async () => {
      const db = createMockD1();
      // Simuler que les leads spécifiés appartiennent bien au client
      db.seed('SELECT id FROM leads', [{ id: 'lead1' }, { id: 'lead2' }]);
      // Simuler le retour de l INSERT
      db.seed('INSERT INTO dialer_campaigns', [
        { id: 'camp_new', client_id: 'cli_A', name: 'Nouveau Dialer', leads_json: '["lead1","lead2"]', status: 'draft', current_index: 0, script_markdown: '# Script' }
      ]);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Nouveau Dialer',
          lead_ids: ['lead1', 'lead2'],
          script_markdown: '# Script',
        }),
      });

      const response = await handleCreateDialerCampaign(req, makeEnv(db), mockAuth);
      expect(response.status).toBe(201);

      const body = await response.json() as any;
      expect(body.data.id).toBe('camp_new');
      expect(body.data.lead_ids).toEqual(['lead1', 'lead2']);

      // Vérifier l'insertion en BD
      const insertCall = db.calls.find(c => c.sql.includes('INSERT INTO dialer_campaigns'));
      expect(insertCall).toBeDefined();
      expect(insertCall?.args[0]).toBe('cli_A');
      expect(insertCall?.args[1]).toBe('Nouveau Dialer');

      // Vérifier l'audit
      expect(audit).toHaveBeenCalledWith(
        expect.any(Object),
        mockAuth.userId,
        'create',
        'dialer_campaign',
        'camp_new',
        expect.objectContaining({ name: 'Nouveau Dialer', leads_count: 2 })
      );
    });

    it('doit échouer si aucun prospect spécifié n est valide', async () => {
      const db = createMockD1();
      // Aucun lead valide
      db.seed('SELECT id FROM leads', []);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Nouveau Dialer',
          lead_ids: ['lead_invalide'],
        }),
      });

      const response = await handleCreateDialerCampaign(req, makeEnv(db), mockAuth);
      expect(response.status).toBe(400);

      const body = await response.json() as any;
      expect(body.error).toBe('Campagne invalide');
    });
  });

  describe('handleGetDialerCampaign', () => {
    it('doit retourner une erreur 404 si la campagne n existe pas', async () => {
      const db = createMockD1();
      // first() retourne null
      db.seed('SELECT * FROM dialer_campaigns', []);

      const response = await handleGetDialerCampaign(new Request('http://localhost'), makeEnv(db), mockAuth, 'inconnue');
      expect(response.status).toBe(404);
    });

    it('doit retourner la campagne si elle existe', async () => {
      const db = createMockD1();
      const campaign = { id: 'camp1', client_id: 'cli_A', name: 'Campagne A', leads_json: '["l1"]', status: 'draft' };
      db.seed('SELECT * FROM dialer_campaigns', [campaign]);

      const response = await handleGetDialerCampaign(new Request('http://localhost'), makeEnv(db), mockAuth, 'camp1');
      expect(response.status).toBe(200);

      const body = await response.json() as any;
      expect(body.data.id).toBe('camp1');
      expect(body.data.lead_ids).toEqual(['l1']);
    });
  });

  describe('handleUpdateDialerCampaign', () => {
    it('doit mettre à jour la campagne, enregistrer l audit et retourner le résultat mis à jour', async () => {
      const db = createMockD1();
      db.seed('SELECT id, name, status, current_index FROM dialer_campaigns', [{ id: 'camp1', name: 'Campagne A', status: 'draft', current_index: 0 }]);
      db.seed('SELECT * FROM dialer_campaigns WHERE id = ?', [{ id: 'camp1', client_id: 'cli_A', name: 'Nom Modifié', status: 'active', current_index: 1, leads_json: '["l1"]' }]);

      const req = new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Nom Modifié',
          status: 'active',
          current_index: 1,
        }),
      });

      const response = await handleUpdateDialerCampaign(req, makeEnv(db), mockAuth, 'camp1');
      expect(response.status).toBe(200);

      const body = await response.json() as any;
      expect(body.data.name).toBe('Nom Modifié');
      expect(body.data.status).toBe('active');
      expect(body.data.current_index).toBe(1);

      expect(audit).toHaveBeenCalledWith(
        expect.any(Object),
        mockAuth.userId,
        'update',
        'dialer_campaign',
        'camp1',
        expect.objectContaining({ name: 'Nom Modifié', status: 'active', current_index: 1 })
      );
    });
  });

  describe('handleDeleteDialerCampaign', () => {
    it('doit supprimer la campagne et auditer l action', async () => {
      const db = createMockD1();
      db.seed('SELECT id FROM dialer_campaigns', [{ id: 'camp1' }]);

      const response = await handleDeleteDialerCampaign(new Request('http://localhost'), makeEnv(db), mockAuth, 'camp1');
      expect(response.status).toBe(200);

      const deleteCall = db.calls.find(c => c.sql.includes('DELETE FROM dialer_campaigns'));
      expect(deleteCall).toBeDefined();

      expect(audit).toHaveBeenCalledWith(
        expect.any(Object),
        mockAuth.userId,
        'delete',
        'dialer_campaign',
        'camp1'
      );
    });
  });

  describe('handleGetDialerCurrentLead', () => {
    it('doit renvoyer le premier lead au démarrage (direction=current)', async () => {
      const db = createMockD1();
      db.seed('SELECT * FROM dialer_campaigns', [{ id: 'camp1', current_index: 0, leads_json: '["l1","l2"]', script_markdown: '# Script' }]);
      db.seed('SELECT * FROM leads', [{ id: 'l1', client_id: 'cli_A', name: 'Prospect 1' }]);

      const response = await handleGetDialerCurrentLead(
        new Request('http://localhost/api/dialer/campaigns/camp1/lead?direction=current'),
        makeEnv(db),
        mockAuth,
        'camp1'
      );
      expect(response.status).toBe(200);

      const body = await response.json() as any;
      expect(body.data.campaign_completed).toBe(false);
      expect(body.data.current_index).toBe(0);
      expect(body.data.lead.name).toBe('Prospect 1');

      // Loi 25 : Vérification de l'audit log sur le lead
      expect(audit).toHaveBeenCalledWith(
        expect.any(Object),
        mockAuth.userId,
        'view',
        'lead',
        'l1',
        expect.objectContaining({ context: 'power_dialer', campaign_id: 'camp1' })
      );
    });

    it('doit incrémenter l index et renvoyer le lead suivant (direction=next)', async () => {
      const db = createMockD1();
      db.seed('SELECT * FROM dialer_campaigns', [{ id: 'camp1', current_index: 0, leads_json: '["l1","l2"]' }]);
      db.seed('SELECT * FROM leads', [{ id: 'l2', client_id: 'cli_A', name: 'Prospect 2' }]);

      const response = await handleGetDialerCurrentLead(
        new Request('http://localhost/api/dialer/campaigns/camp1/lead?direction=next'),
        makeEnv(db),
        mockAuth,
        'camp1'
      );
      expect(response.status).toBe(200);

      const body = await response.json() as any;
      expect(body.data.campaign_completed).toBe(false);
      expect(body.data.current_index).toBe(1);
      expect(body.data.lead.name).toBe('Prospect 2');

      const updateCall = db.calls.find(c => c.sql.includes('UPDATE dialer_campaigns SET current_index = ?'));
      expect(updateCall).toBeDefined();
      expect(updateCall?.args[0]).toBe(1);
    });

    it('doit marquer la campagne completed si l index dépasse la file', async () => {
      const db = createMockD1();
      db.seed('SELECT * FROM dialer_campaigns', [{ id: 'camp1', current_index: 1, leads_json: '["l1"]' }]);

      const response = await handleGetDialerCurrentLead(
        new Request('http://localhost/api/dialer/campaigns/camp1/lead?direction=next'),
        makeEnv(db),
        mockAuth,
        'camp1'
      );
      expect(response.status).toBe(200);

      const body = await response.json() as any;
      expect(body.data.campaign_completed).toBe(true);
      expect(body.data.current_index).toBe(1);

      const updateCompleted = db.calls.find(c => c.sql.includes("UPDATE dialer_campaigns SET status = 'completed'"));
      expect(updateCompleted).toBeDefined();
    });

    it('doit passer au lead suivant récursivement si le lead courant est absent/supprimé de la DB', async () => {
      const db = createMockD1();
      // Campagne avec l1 et l2.
      db.seed('SELECT * FROM dialer_campaigns', [{ id: 'camp1', current_index: 0, leads_json: '["l1","l2"]' }]);

      // Surcharger prepare pour intercepter et simuler l1 absent et l2 présent via bind
      const originalPrepare = db.prepare;
      db.prepare = (sql: string) => {
        const stmt = originalPrepare(sql);
        if (sql.includes('SELECT * FROM leads')) {
          let targetLeadId = '';
          return {
            bind(...args: any[]) {
              targetLeadId = args[0];
              stmt.bind(...args);
              return this;
            },
            all() {
              stmt.all();
              return { results: targetLeadId === 'l2' ? [{ id: 'l2', client_id: 'cli_A', name: 'Prospect 2' }] : [] };
            },
            first() {
              stmt.first();
              return targetLeadId === 'l2' ? { id: 'l2', client_id: 'cli_A', name: 'Prospect 2' } : null;
            },
            run() {
              return stmt.run();
            }
          } as any;
        }
        return stmt;
      };

      const response = await handleGetDialerCurrentLead(
        new Request('http://localhost/api/dialer/campaigns/camp1/lead?direction=current'),
        makeEnv(db),
        mockAuth,
        'camp1'
      );
      expect(response.status).toBe(200);

      const body = await response.json() as any;
      // Il doit passer automatiquement à l'index 1 (l2)
      expect(body.data.campaign_completed).toBe(false);
      expect(body.data.current_index).toBe(1);
      expect(body.data.lead.name).toBe('Prospect 2');
    });
  });
});
