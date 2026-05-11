import { describe, it, expect, beforeEach } from 'bun:test';
import { handleGetPreferences, handleUpdatePreferences, handleGetApiKeys, handleCreateApiKey, handleGetWebhooks, handleCreateWebhook } from '../settings';
import { handleGetUsers, handleInviteUser, handleUpdateUserRole } from '../team';

// Mock Env
const mockDb = {
  data: {} as any,
  prepare: (query: string) => {
    return {
      bind: (...args: any[]) => {
        return {
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ success: true })
        };
      }
    };
  }
};

const mockEnv = { DB: mockDb as any } as any;

describe('Sprint 8 - Settings', () => {
  it('doit récupérer les préférences par défaut', async () => {
    const req = new Request('http://localhost/api/settings/preferences', { headers: { 'X-User-Id': '1' } });
    const res = await handleGetPreferences(req, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(body.data.language).toBe('fr');
  });

  it('doit créer une clé API', async () => {
    const req = new Request('http://localhost/api/settings/api-keys', {
      method: 'POST',
      headers: { 'X-Client-Id': 'gatineau', 'X-User-Id': '1' },
      body: JSON.stringify({ name: 'Test Key' })
    });
    const res = await handleCreateApiKey(req, mockEnv);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.key).toStartWith('ILYS_');
  });

  it('doit créer un webhook', async () => {
    const req = new Request('http://localhost/api/settings/webhooks', {
      method: 'POST',
      headers: { 'X-Client-Id': 'gatineau' },
      body: JSON.stringify({ url: 'https://test.com/webhook', events: 'lead.created' })
    });
    const res = await handleCreateWebhook(req, mockEnv);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.secret).toStartWith('whsec_');
  });
});

describe('Sprint 8 - Team', () => {
  it('doit inviter un utilisateur', async () => {
    const req = new Request('http://localhost/api/team/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@user.com', role: 'manager' })
    });
    const res = await handleInviteUser(req, mockEnv);
    expect(res.status).toBe(201);
  });
});
