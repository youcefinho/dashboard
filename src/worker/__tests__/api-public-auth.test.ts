import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requireApiKey, requireScope } from '../api-public-auth';
import type { Env } from '../types';

describe('API Public Auth', () => {
  let mockEnv: any;

  beforeEach(() => {
    mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn(),
      },
    };
  });

  it('devrait rejeter si header Authorization manquant', async () => {
    const req = new Request('http://localhost/api/public/v1/me');
    const result = await requireApiKey(req, mockEnv as unknown as Env) as Response;
    expect(result.status).toBe(401);
    const json: any = await result.json();
    expect(json.error).toBe('Clé API manquante. Utilisez le header Authorization: ApiKey <token>');
  });

  it('devrait rejeter si format de clé invalide', async () => {
    const req = new Request('http://localhost/api/public/v1/me', {
      headers: { Authorization: 'Bearer INVALID_KEY' }
    });
    const result = await requireApiKey(req, mockEnv as unknown as Env) as Response;
    expect(result.status).toBe(401);
  });

  it('devrait rejeter si la clé est introuvable', async () => {
    mockEnv.DB.all.mockResolvedValue({ results: [] });
    const req = new Request('http://localhost/api/public/v1/me', {
      headers: { Authorization: 'Bearer ILYS_testkey123' }
    });
    const result = await requireApiKey(req, mockEnv as unknown as Env) as Response;
    expect(result.status).toBe(401);
    const json: any = await result.json();
    expect(json.error).toBe('Clé API invalide ou expirée');
  });

  it('devrait accepter une clé valide et mettre à jour last_used_at', async () => {
    mockEnv.DB.all.mockResolvedValue({
      results: [{
        id: 'key_1',
        client_id: 'client_1',
        user_id: 'user_1',
        scopes: 'read,write'
      }]
    });

    const req = new Request('http://localhost/api/public/v1/me', {
      headers: { Authorization: 'Bearer ILYS_validkey123' }
    });
    
    const result = await requireApiKey(req, mockEnv as unknown as Env);
    expect(result).not.toBeInstanceOf(Response);
    expect((result as any).clientId).toBe('client_1');
    expect((result as any).scopes).toEqual(['read', 'write']);
    expect(mockEnv.DB.run).toHaveBeenCalled(); // update last_used_at
  });

  it('devrait valider les scopes (requireScope)', () => {
    const authRead = { userId: '1', clientId: '1', scopes: ['read'] };
    const authWrite = { userId: '1', clientId: '1', scopes: ['read', 'write'] };

    expect(requireScope(authRead, 'read')).toBeNull();
    
    const errRes = requireScope(authRead, 'write') as Response;
    expect(errRes.status).toBe(403);
    
    expect(requireScope(authWrite, 'write')).toBeNull();
  });
});
