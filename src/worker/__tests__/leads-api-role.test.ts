// ── Tests handleGetLeads + handlePatchLead avec role 'api' (Sprint 13.5 Phase C) ──
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetLeads, handlePatchLead } from '../leads';
import type { Env } from '../types';

describe('handleGetLeads — role api', () => {
  let mockEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn(),
        run: vi.fn(),
      },
    };
  });

  const makeUrl = (qs = '') => new URL(`http://localhost/api/public/v1/leads${qs}`);

  it('refuse role user normal (ni admin ni api)', async () => {
    const res = await handleGetLeads(mockEnv as Env, { role: 'user' }, makeUrl());
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/administrateurs/);
  });

  it('accepte role api et force le filtrage par clientId du auth', async () => {
    mockEnv.DB.all.mockResolvedValue({ results: [{ id: 'lead_1', name: 'Test', client_id: 'client_abc' }] });

    const res = await handleGetLeads(mockEnv as Env, { role: 'api', clientId: 'client_abc' }, makeUrl());

    expect(res.status).toBe(200);
    // Vérifier que le bind a inclus 'client_abc' (filtrage par clientId du auth)
    const bindCall = (mockEnv.DB.bind as any).mock.calls.flat();
    expect(bindCall).toContain('client_abc');
  });

  it('accepte role admin (legacy)', async () => {
    mockEnv.DB.all.mockResolvedValue({ results: [] });
    const res = await handleGetLeads(mockEnv as Env, { role: 'admin' }, makeUrl());
    expect(res.status).toBe(200);
  });

  it('role api avec clientId écrase un client_id passé en query (sécurité)', async () => {
    mockEnv.DB.all.mockResolvedValue({ results: [] });

    await handleGetLeads(
      mockEnv as Env,
      { role: 'api', clientId: 'client_owner' },
      makeUrl('?client_id=client_attacker')
    );

    const bindCall = (mockEnv.DB.bind as any).mock.calls.flat();
    // Le clientId de l'auth (client_owner) doit gagner
    expect(bindCall).toContain('client_owner');
    expect(bindCall).not.toContain('client_attacker');
  });
});

describe('handlePatchLead — role api', () => {
  let mockEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        run: vi.fn(),
      },
    };
  });

  it('refuse role user', async () => {
    const req = new Request('http://localhost/api/public/v1/leads/lead_1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'contacted' }),
    });
    const res = await handlePatchLead(req, mockEnv as Env, { role: 'user', userId: 'u1' }, 'lead_1');
    expect(res.status).toBe(403);
  });

  it('accepte role api', async () => {
    mockEnv.DB.first.mockResolvedValue({ pipeline_id: 'p1', stage_id: 's1' });
    const req = new Request('http://localhost/api/public/v1/leads/lead_1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'contacted' }),
    });
    const res = await handlePatchLead(req, mockEnv as Env, { role: 'api', userId: 'api_user', clientId: 'c1' }, 'lead_1');
    expect(res.status).toBe(200);
  });
});
