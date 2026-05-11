import { describe, it, expect } from 'bun:test';
import { handleGetClients, handleCreateClient } from '../leads';

// Mock Env
const mockDb = {
  data: {} as any,
  prepare: (query: string) => {
    const chain = {
      bind: (...args: any[]) => chain,
      first: async () => null,
      all: async () => ({ results: [{ id: 'client_1', name: 'Mathis Guimont', email: 'mathis@test.com' }] }),
      run: async () => ({ success: true })
    };
    return chain;
  }
};

const mockEnv = { DB: mockDb as any } as any;

describe('Sprint 8 - Agency Master View', () => {
  it('doit récupérer la liste des sous-comptes (clients) pour l\'admin', async () => {
    const res = await handleGetClients(mockEnv, { userId: 'admin_1', role: 'admin' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(body.data[0].name).toBe('Mathis Guimont');
  });

  it('doit créer un nouveau sous-compte (client) depuis le SaaS Configurator', async () => {
    const req = new Request('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nouvelle Agence', email: 'contact@agence.com', phone: '1234567890' })
    });
    const res = await handleCreateClient(req, mockEnv, { userId: 'admin_1', role: 'admin' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
  });

  it('doit rejeter la création de sous-compte si le nom est manquant', async () => {
    const req = new Request('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ email: 'contact@agence.com' })
    });
    const res = await handleCreateClient(req, mockEnv, { userId: 'admin_1', role: 'admin' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('Nom et email requis');
  });
});
