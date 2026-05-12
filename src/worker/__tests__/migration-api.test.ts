import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleGetMigrationSession, handleGetMigrationErrors } from '../migration-ghl-api';

describe('GHL Migration API Routes', () => {
  let env: any;
  const auth = { userId: 'admin-123', role: 'admin' };

  beforeEach(() => {
    env = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(() => {
          return Promise.resolve({
            id: 'sess-123',
            status: 'running',
            imported_records: 42,
            error_log_json: '["Error 1", "Error 2"]'
          });
        }),
      }
    };
  });

  it('handleGetMigrationSession - return session data', async () => {
    const res = await handleGetMigrationSession(env, auth, 'sess-123');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.id).toBe('sess-123');
    expect(json.data.imported_records).toBe(42);
  });

  it('handleGetMigrationErrors - return parsed errors', async () => {
    const res = await handleGetMigrationErrors(env, auth, 'sess-123');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data).toEqual(['Error 1', 'Error 2']);
  });

  it('admin only protection on get session', async () => {
    const res = await handleGetMigrationSession(env, { userId: '1', role: 'user' }, 'sess-123');
    expect(res.status).toBe(403);
  });

  it('admin only protection on get errors', async () => {
    const res = await handleGetMigrationErrors(env, { userId: '1', role: 'user' }, 'sess-123');
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent session', async () => {
    env.DB.first = vi.fn().mockResolvedValue(null);
    const res = await handleGetMigrationSession(env, auth, 'invalid-id');
    expect(res.status).toBe(404);
  });

  it('returns empty array if no errors', async () => {
    env.DB.first = vi.fn().mockResolvedValue({ id: 'sess-123', error_log_json: null });
    const res = await handleGetMigrationErrors(env, auth, 'sess-123');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data).toEqual([]);
  });

  it('returns empty array if error_log_json is empty string', async () => {
    env.DB.first = vi.fn().mockResolvedValue({ id: 'sess-123', error_log_json: "" });
    const res = await handleGetMigrationErrors(env, auth, 'sess-123');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data).toEqual([]);
  });
});
