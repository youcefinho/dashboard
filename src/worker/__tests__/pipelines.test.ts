import { describe, it, expect, vi } from 'vitest';
import { handleGetPipelineForecast, handleCreatePipeline } from '../pipelines';
import type { Env } from '../types';

describe('Pipelines - Smoke Tests', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
    batch: vi.fn(),
  };
  const mockEnv = { DB: mockDb } as unknown as Env;

  it('handleGetPipelineForecast computes weighted revenue correctly', async () => {
    // Mock user
    mockDb.first.mockResolvedValueOnce({ client_id: 'client_123' });
    // Mock pipeline
    mockDb.first.mockResolvedValueOnce({ id: 'pipe_1' });
    
    // Mock leads and stages
    mockDb.all.mockResolvedValueOnce({
      results: [
        { deal_value: 100000, probability: 50, status: 'new', created_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z' },
        { deal_value: 200000, probability: 25, status: 'contacted', created_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z' },
      ]
    });

    const url = new URL('http://localhost/api/pipelines/pipe_1/forecast?period=90d');
    const response = await handleGetPipelineForecast(mockEnv, { role: 'user', userId: 'user_1' }, 'pipe_1', url);
    const json = await response.json() as any;

    expect(response.status).toBe(200);
    expect(json.total_pipeline_value).toBe(300000);
    expect(json.weighted_total).toBe(100000 * 0.5 + 200000 * 0.25);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data[0].weighted_revenue).toBe(100000 * 0.5 + 200000 * 0.25);
    expect(json.data[0].deal_count).toBe(2);
  });

  it('handleCreatePipeline creates a pipeline and audits', async () => {
    mockDb.first.mockResolvedValueOnce({ client_id: 'client_123' });
    mockDb.run.mockResolvedValueOnce({});
    // audit mock
    mockDb.run.mockResolvedValueOnce({}); 

    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Pipeline', client_id: 'client_123' })
    });

    const response = await handleCreatePipeline(req, mockEnv, { role: 'user', userId: 'user_1' });
    const json = await response.json() as any;

    expect(response.status).toBe(201);
    expect(json.data.success).toBe(true);
    expect(json.data.id).toBeTruthy();
  });
});
