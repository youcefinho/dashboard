import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import {
  handleGetInternalChannels,
  handleCreateInternalChannel,
  handleGetInternalChannelMessages,
  handleSendInternalMessage
} from '../internal-chat';

// Mock broadcastChatMessageToUser
const broadcastMock = vi.fn(async () => {});
vi.mock('../notifications-ws', () => {
  return {
    broadcastChatMessageToUser: (...args: any[]) => broadcastMock(...args)
  };
});

function makeEnv(): Env {
  const db = createMockD1();
  return {
    DB: db as unknown as D1Database,
  } as unknown as Env;
}

describe('Clavardage Interne Equipe - Tests Unitaires (Sprint 57)', () => {
  const auth = { userId: 'user_collab_123', role: 'user', clientId: 'client_intralys_57' };

  beforeEach(() => {
    broadcastMock.mockClear();
  });

  describe('handleGetInternalChannels', () => {
    it('doit retourner la liste des canaux pour le tenant courant', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      const mockChannels = [
        { id: 'chan_1', client_id: 'client_intralys_57', name: 'General', description: 'Canal general', is_private: 0 },
        { id: 'chan_2', client_id: 'client_intralys_57', name: 'Urgent', description: 'Canal d urgence', is_private: 1 }
      ];
      db.seed("SELECT * FROM internal_channels", mockChannels);

      const res = await handleGetInternalChannels(env, auth);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toEqual(mockChannels);

      // Vérifie l'isolation du tenant
      const call = db.calls.find((c) => /select \* from internal_channels/i.test(c.sql));
      expect(call).toBeDefined();
      expect(call!.args).toContain('client_intralys_57');
    });
  });

  describe('handleCreateInternalChannel', () => {
    it('doit inserer un nouveau canal dans la base de donnees', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      const req = new Request('https://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Nouveau Canal',
          description: 'Description du canal',
          is_private: 0
        })
      });

      const res = await handleCreateInternalChannel(req, env, auth);
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.data.name).toBe('Nouveau Canal');
      expect(body.data.success).toBe(true);

      const insertCall = db.calls.find((c) => /insert into internal_channels/i.test(c.sql));
      expect(insertCall).toBeDefined();
      expect(insertCall!.args).toContain('Nouveau Canal');
      expect(insertCall!.args).toContain('client_intralys_57');
    });

    it('doit renvoyer une erreur 400 si le nom est manquant', async () => {
      const env = makeEnv();

      const req = new Request('https://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Sans nom' })
      });

      const res = await handleCreateInternalChannel(req, env, auth);
      expect(res.status).toBe(400);
    });
  });

  describe('handleGetInternalChannelMessages', () => {
    it('doit renvoyer l historique des messages du canal', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      // Seed le check d'existence et isolation du canal
      db.seed("SELECT id FROM internal_channels", [{ id: 'chan_123' }]);

      const mockMessages = [
        { id: 'm1', channel_id: 'chan_123', user_id: 'user_1', content: 'Bonjour', user_name: 'Collab A', avatar_url: null },
        { id: 'm2', channel_id: 'chan_123', user_id: 'user_2', content: 'Salut', user_name: 'Collab B', avatar_url: 'avatar.png' }
      ];
      db.seed("SELECT m.*, u.name as user_name", mockMessages);

      const res = await handleGetInternalChannelMessages(env, auth, 'chan_123');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toEqual(mockMessages);
    });

    it('doit renvoyer 404 si le canal n appartient pas au tenant', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;
      // Aucun canal trouvé avec ce client_id
      db.seed("SELECT id FROM internal_channels", []);

      const res = await handleGetInternalChannelMessages(env, auth, 'chan_wrong');
      expect(res.status).toBe(404);
    });
  });

  describe('handleSendInternalMessage', () => {
    it('doit inserer le message et le diffuser a tous les utilisateurs du tenant via WebSocket', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      db.seed("SELECT id, name FROM internal_channels", [{ id: 'chan_123', name: 'General' }]);
      db.seed("SELECT name, avatar_url FROM users WHERE id = ?", [{ name: 'Rochdi', avatar_url: 'avatar_url' }]);
      // Seed les collaborateurs du tenant
      db.seed("SELECT id FROM users WHERE client_id = ?", [
        { id: 'user_collab_123' },
        { id: 'user_collab_456' }
      ]);

      const req = new Request('https://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Salut tout le monde!' })
      });

      const res = await handleSendInternalMessage(req, env, auth, 'chan_123');
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.data.success).toBe(true);

      // Insertion D1
      const insertMsg = db.calls.find((c) => /insert into internal_messages/i.test(c.sql));
      expect(insertMsg).toBeDefined();
      expect(insertMsg!.args).toContain('Salut tout le monde!');
      expect(insertMsg!.args).toContain('chan_123');

      // Diffusion WebSocket pour chaque collab
      expect(broadcastMock).toHaveBeenCalledTimes(2);
      expect(broadcastMock).toHaveBeenNthCalledWith(1, env, 'user_collab_123', expect.objectContaining({
        content: 'Salut tout le monde!',
        user_name: 'Rochdi'
      }));
      expect(broadcastMock).toHaveBeenNthCalledWith(2, env, 'user_collab_456', expect.objectContaining({
        content: 'Salut tout le monde!',
        user_name: 'Rochdi'
      }));
    });
  });
});
