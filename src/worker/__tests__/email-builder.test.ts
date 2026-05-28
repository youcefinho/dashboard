import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import {
  handleGetEmailDesigns,
  handleGetEmailDesign,
  handleCreateEmailDesign,
  handleUpdateEmailDesign,
  handleDeleteEmailDesign
} from '../email-builder';

function makeEnv(): Env {
  const db = createMockD1();
  return {
    DB: db as unknown as D1Database,
  } as unknown as Env;
}

describe('Constructeur de Courriels Drag-and-Drop - Tests Unitaires (Sprint 60)', () => {
  const auth = { userId: 'user_agent_888', role: 'user', clientId: 'client_intralys_60' };
  const anotherAuth = { userId: 'user_agent_999', role: 'user', clientId: 'client_competitor' };

  describe('handleGetEmailDesigns', () => {
    it('doit renvoyer uniquement les designs du client courant (isolation)', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      const mockDesigns = [
        { id: 'design_1', client_id: 'client_intralys_60', name: 'Infolettre Mai', subject: 'Nouvelles de mai', html_content: '<p>Mai</p>', design_json: '{}' },
        { id: 'design_2', client_id: 'client_intralys_60', name: 'Promo Vente', subject: 'Vente flash', html_content: '<p>Promo</p>', design_json: '{}' }
      ];
      db.seed("SELECT id, name, subject, updated_at FROM email_designs WHERE client_id = ? ORDER BY updated_at DESC", mockDesigns);

      const res = await handleGetEmailDesigns(env, auth);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toEqual(mockDesigns);

      // Vérifie l'isolation D1
      const call = db.calls.find(c => /select id, name, subject, updated_at/i.test(c.sql));
      expect(call).toBeDefined();
      expect(call!.args).toContain(auth.clientId);
    });
  });

  describe('handleGetEmailDesign', () => {
    it('doit renvoyer le design s il appartient au client courant', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      const mockDesign = { id: 'design_123', client_id: 'client_intralys_60', name: 'Design A', subject: 'Sujet A', html_content: 'html', design_json: '{}' };
      db.seed("SELECT * FROM email_designs WHERE id = ? AND client_id = ? LIMIT 1", [mockDesign]);

      const res = await handleGetEmailDesign(env, auth, 'design_123');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toEqual(mockDesign);
    });

    it('doit renvoyer 404 si le design n existe pas ou n appartient pas au client', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      // Simule qu'aucun design n'est trouvé pour ce client
      db.seed("SELECT * FROM email_designs WHERE id = ? AND client_id = ? LIMIT 1", []);

      const res = await handleGetEmailDesign(env, auth, 'design_other_client');
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toBe('Design introuvable');
    });
  });

  describe('handleCreateEmailDesign', () => {
    it('doit creer et inserer un nouveau design', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      const req = new Request('https://localhost/api/email-designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Nouveau Modèle',
          subject: 'Bienvenue chez Intralys',
          html_content: '<h1>Bienvenue!</h1>',
          design_json: { blocks: [] }
        })
      });

      const res = await handleCreateEmailDesign(req, env, auth);
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.data.success).toBe(true);
      expect(body.data.name).toBe('Nouveau Modèle');
      expect(body.data.id).toBeDefined();

      const insertCall = db.calls.find(c => /insert into email_designs/i.test(c.sql));
      expect(insertCall).toBeDefined();
      expect(insertCall!.args).toContain('Nouveau Modèle');
      expect(insertCall!.args).toContain('Bienvenue chez Intralys');
      expect(insertCall!.args).toContain('<h1>Bienvenue!</h1>');
      expect(insertCall!.args).toContain(JSON.stringify({ blocks: [] }));
      expect(insertCall!.args).toContain(auth.clientId);
    });

    it('doit renvoyer 400 si le nom est manquant', async () => {
      const env = makeEnv();

      const req = new Request('https://localhost/api/email-designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: 'Sans nom'
        })
      });

      const res = await handleCreateEmailDesign(req, env, auth);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe('Le nom du gabarit est requis');
    });
  });

  describe('handleUpdateEmailDesign', () => {
    it('doit mettre a jour le design existant s il appartient au client', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      // Seed l'existence
      db.seed("SELECT id FROM email_designs WHERE id = ? AND client_id = ? LIMIT 1", [{ id: 'design_777' }]);

      const req = new Request('https://localhost/api/email-designs/design_777', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Modèle Mis à Jour',
          subject: 'Nouveau Sujet'
        })
      });

      const res = await handleUpdateEmailDesign(req, env, auth, 'design_777');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.success).toBe(true);

      const updateCall = db.calls.find(c => /update email_designs/i.test(c.sql));
      expect(updateCall).toBeDefined();
      expect(updateCall!.args).toContain('Modèle Mis à Jour');
      expect(updateCall!.args).toContain('Nouveau Sujet');
      expect(updateCall!.args).toContain('design_777');
      expect(updateCall!.args).toContain(auth.clientId);
    });

    it('doit renvoyer 404 lors de la mise a jour si le design n appartient pas au client', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      db.seed("SELECT id FROM email_designs WHERE id = ? AND client_id = ? LIMIT 1", []);

      const req = new Request('https://localhost/api/email-designs/design_other', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hack' })
      });

      const res = await handleUpdateEmailDesign(req, env, auth, 'design_other');
      expect(res.status).toBe(404);
    });
  });

  describe('handleDeleteEmailDesign', () => {
    it('doit supprimer le design s il appartient au client', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      db.seed("SELECT id FROM email_designs WHERE id = ? AND client_id = ? LIMIT 1", [{ id: 'design_to_del' }]);

      const res = await handleDeleteEmailDesign(env, auth, 'design_to_del');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.success).toBe(true);

      const deleteCall = db.calls.find(c => /delete from email_designs/i.test(c.sql));
      expect(deleteCall).toBeDefined();
      expect(deleteCall!.args).toContain('design_to_del');
      expect(deleteCall!.args).toContain(auth.clientId);
    });

    it('doit renvoyer 404 lors de la suppression si le design n appartient pas au client', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      db.seed("SELECT id FROM email_designs WHERE id = ? AND client_id = ? LIMIT 1", []);

      const res = await handleDeleteEmailDesign(env, auth, 'design_other');
      expect(res.status).toBe(404);
    });
  });
});
