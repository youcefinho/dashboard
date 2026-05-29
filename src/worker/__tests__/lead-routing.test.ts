// ── Tests handleRouteLeadPredictive (Sprint 77) ─────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRouteLeadPredictive } from '../lead-routing';
import type { Env } from '../types';

describe('handleRouteLeadPredictive', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  };
  const mockEnv = { DB: mockDb } as unknown as Env;
  const auth = { role: 'admin', userId: 'user-admin' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockDb);
    mockDb.bind.mockReturnValue(mockDb);
  });

  const makeReq = () =>
    new Request('http://localhost/api/leads/lead-1/route-predictive', { method: 'POST' });

  it('refuse les non-admins', async () => {
    const res = await handleRouteLeadPredictive(makeReq(), mockEnv, { role: 'broker', userId: 'u' }, 'lead-1');
    expect(res.status).toBe(403);
  });

  it('retourne 404 si le lead n\'existe pas', async () => {
    mockDb.first.mockResolvedValueOnce(null); // lead lookup
    const res = await handleRouteLeadPredictive(makeReq(), mockEnv, auth, 'lead-1');
    expect(res.status).toBe(404);
  });

  it('retourne 400 si aucun agent actif', async () => {
    mockDb.first.mockResolvedValueOnce({ id: 'lead-1', client_id: 'client-1', type: 'inbound', source: 'facebook' }); // lead
    mockDb.all.mockResolvedValueOnce({ results: [] }); // agents lookup
    const res = await handleRouteLeadPredictive(makeReq(), mockEnv, auth, 'lead-1');
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/aucun agent actif/i);
  });

  it('calcule correctement les scores avec Laplace, met à jour et retourne le meilleur agent', async () => {
    // 1. Mock lead
    mockDb.first.mockResolvedValueOnce({ id: 'lead-1', client_id: 'client-1', type: 'inbound', source: 'facebook' });

    // 2. Mock agents (2 agents)
    mockDb.all.mockResolvedValueOnce({
      results: [
        { id: 'agent-1', name: 'Agent Un', role: 'broker' },
        { id: 'agent-2', name: 'Agent Deux', role: 'broker' }
      ]
    });

    // 3. Mock won, lost, active count pour Agent 1
    // Agent 1: 3 gagnés, 1 perdu, 2 actifs
    // Score Laplace: (3 + 1) / (3 + 1 + 2) = 4 / 6 = 0.6667
    mockDb.first.mockResolvedValueOnce({ c: 3 }); // won count
    mockDb.first.mockResolvedValueOnce({ c: 1 }); // lost count
    mockDb.first.mockResolvedValueOnce({ c: 2 }); // active count

    // 4. Mock won, lost, active count pour Agent 2
    // Agent 2: 1 gagné, 2 perdus, 1 actif
    // Score Laplace: (1 + 1) / (1 + 2 + 2) = 2 / 5 = 0.4
    mockDb.first.mockResolvedValueOnce({ c: 1 }); // won count
    mockDb.first.mockResolvedValueOnce({ c: 2 }); // lost count
    mockDb.first.mockResolvedValueOnce({ c: 1 }); // active count

    // 5. Mock routing score cache insertion, lead update et activity log
    mockDb.run.mockResolvedValue({});

    const res = await handleRouteLeadPredictive(makeReq(), mockEnv, auth, 'lead-1');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      success: boolean;
      assigned_to: string;
      agent_name: string;
      category: string;
      scores: Array<{
        agent_id: string;
        agent_name: string;
        score: number;
        won_count: number;
        lost_count: number;
        active_leads_count: number;
      }>;
    };

    expect(body.success).toBe(true);
    expect(body.assigned_to).toBe('agent-1');
    expect(body.agent_name).toBe('Agent Un');
    expect(body.category).toBe('source:facebook|type:buy');
    expect(body.scores).toHaveLength(2);
    expect(body.scores[0].agent_id).toBe('agent-1');
    expect(body.scores[0].score).toBe(0.6667);
    expect(body.scores[1].agent_id).toBe('agent-2');
    expect(body.scores[1].score).toBe(0.4);
  });
});
