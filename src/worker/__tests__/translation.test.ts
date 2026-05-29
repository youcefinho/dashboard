import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTranslateMessage } from '../ai';
import type { Env } from '../types';

describe('Handler de Traduction (handleTranslateMessage)', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    run: vi.fn(),
  };

  const mockEnv = {
    DB: mockDb,
    USE_MOCKS: 'true',
  } as unknown as Env;

  const mockAuth = {
    userId: 'user_123',
    role: 'admin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devrait retourner 404 si le message n\'existe pas', async () => {
    mockDb.first.mockResolvedValueOnce(null);

    const res = await handleTranslateMessage(mockEnv, mockAuth, 'message_id_invalid');
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain('Message introuvable');
  });

  it('devrait retourner le texte déjà traduit s\'il est en cache (translated_content non nul)', async () => {
    mockDb.first.mockResolvedValueOnce({
      id: 'msg_1',
      body: 'Hello',
      translated_content: 'Bonjour',
      client_id: 'client_123',
    });

    const res = await handleTranslateMessage(mockEnv, mockAuth, 'msg_1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.translated_content).toBe('Bonjour');
    expect(mockDb.run).not.toHaveBeenCalled();
  });

  it('devrait traduire et persister le résultat si le cache est vide', async () => {
    mockDb.first.mockResolvedValueOnce({
      id: 'msg_1',
      body: 'Hello my friend',
      translated_content: null,
      client_id: 'client_123',
    });
    mockDb.run.mockResolvedValueOnce({}); // update message query

    const res = await handleTranslateMessage(mockEnv, mockAuth, 'msg_1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.translated_content).toContain('Bonjour');
    expect(mockDb.run).toHaveBeenCalled();
  });

  it('devrait respecter la sécurité multi-tenant', async () => {
    mockDb.first.mockResolvedValueOnce({
      id: 'msg_1',
      body: 'Hello',
      translated_content: 'Bonjour',
      client_id: 'client_different',
    });

    const restrictedAuth = {
      userId: 'user_123',
      role: 'user',
      clientId: 'client_123',
    };

    const res = await handleTranslateMessage(mockEnv, restrictedAuth, 'msg_1');
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain('Accès non autorisé');
  });
});
