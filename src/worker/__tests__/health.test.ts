import { describe, it, expect, vi } from 'vitest';
import { handleHealth } from '../health';
import type { Env } from '../types';

describe('Health Check - Phase C.1', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    first: vi.fn(),
  };
  const mockEnv = {
    DB: mockDb,
    START_TIME: Date.now() - 5000, // 5 seconds ago
  } as unknown as Env;

  it('returns 200 and ok status when DB is up', async () => {
    mockDb.first.mockResolvedValueOnce({ val: 1 });

    const response = await handleHealth(mockEnv, 5);
    const json = await response.json() as any;

    expect(response.status).toBe(200);
    expect(json.status).toBe('ok');
    expect(json.db).toBe('ok');
    expect(json.version).toBe('2.1.0');
    expect(json.uptime_s).toBe(5);
  });

  it('returns error when DB prepare throws', async () => {
    mockDb.first.mockRejectedValueOnce(new Error('DB connection failed'));

    const response = await handleHealth(mockEnv, 5);
    const json = await response.json() as any;

    expect(response.status).toBe(503); // Assuming 503 for service unavailable, or at least it's caught
    expect(json.status).toBe('error');
    expect(json.db).toBe('error');
    expect(json.details).toBe('DB connection failed');
  });
});
