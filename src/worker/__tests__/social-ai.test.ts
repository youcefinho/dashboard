// ── Tests pour le générateur d'images de réseaux sociaux (Sprint 79) ──
import { describe, it, expect, vi } from 'vitest';
import { handleGenerateSocialImage } from '../social-ai';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';

const mockAuth = { capabilities: new Set(['ai.use']), userId: 'user-1' };

describe('Sprint 79 — Social AI Image Generator', () => {
  it('génère une image et la stocke dans R2 quand env.AI est présent', async () => {
    const mockAi = {
      run: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    const mockR2 = {
      put: vi.fn().mockResolvedValue({}),
    };
    const mockDb = createMockD1();
    mockDb.seed('INSERT INTO files', { success: true });

    const env = {
      AI: mockAi,
      FILES: mockR2,
      DB: mockDb,
      ANTHROPIC_API_KEY: 'sk-ant-mock-real-mode', // force isAiMockMode to return false
    } as unknown as Env;

    const req = new Request('http://localhost/api/social/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Une belle maison au bord du fleuve Saint-Laurent' }),
    });

    const res = await handleGenerateSocialImage(req, env, mockAuth);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { url: string; fileId: string } };
    expect(body.data).toBeDefined();
    expect(body.data.url).toContain('/api/files/');
    expect(mockAi.run).toHaveBeenCalledWith(
      '@cf/bytedance/stable-diffusion-xl-lightning',
      { prompt: 'Une belle maison au bord du fleuve Saint-Laurent' }
    );
    expect(mockR2.put).toHaveBeenCalled();
  });

  it('génère en mode mock si env.AI ou FILES est absent', async () => {
    const mockR2 = {
      put: vi.fn().mockResolvedValue({}),
    };
    const mockDb = createMockD1();
    mockDb.seed('INSERT INTO files', { success: true });

    const env = {
      FILES: mockR2,
      DB: mockDb,
      // No ANTHROPIC_API_KEY -> isAiMockMode returns true
    } as unknown as Env;

    const req = new Request('http://localhost/api/social/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Une maison de courtier' }),
    });

    const res = await handleGenerateSocialImage(req, env, mockAuth);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { url: string; fileId: string } };
    expect(body.data).toBeDefined();
    expect(body.data.url).toContain('/api/files/');
    expect(mockR2.put).toHaveBeenCalled();
  });

  it('valide le prompt vide ou manquant', async () => {
    const env = {} as unknown as Env;
    const req = new Request('http://localhost/api/social/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    const res = await handleGenerateSocialImage(req, env, mockAuth);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Prompt requis');
  });

  it('bloque les requêtes sans capability ai.use', async () => {
    const env = {} as unknown as Env;
    const req = new Request('http://localhost/api/social/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Test' }),
    });
    const badAuth = { capabilities: new Set<string>(), userId: 'user-1' };
    const res = await handleGenerateSocialImage(req, env, badAuth);
    expect(res.status).toBe(403);
  });
});
