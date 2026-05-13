import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetSessions, handleDeleteSession, handleDeleteOtherSessions, handleGenerateBackupCodes } from '../auth';
import type { Env } from '../types';

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ userId: 'my_unique_id', role: 'admin' }),
    extractToken: vi.fn().mockReturnValue('current_token'),
    audit: vi.fn().mockResolvedValue(true)
  };
});

vi.mock('../crypto', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed_pw')
}));

describe('Auth Sessions & 2FA Tests - Phase D', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    all: vi.fn(),
    run: vi.fn(),
    first: vi.fn(),
    batch: vi.fn(),
  };
  const mockEnv = { DB: mockDb, DEV_BYPASS_AUTH: 'true' } as unknown as Env;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleGetSessions', () => {
    it('returns sessions with current session marked', async () => {
      mockDb.all.mockResolvedValueOnce({
        results: [
          { token: 'current_token', ip_address: '1.1.1.1', user_agent: 'Chrome', created_at: '2026-05-01' },
          { token: 'other_token', ip_address: '2.2.2.2', user_agent: 'Firefox', created_at: '2026-05-02' }
        ]
      });

      const req = new Request('http://localhost', { headers: { 'Authorization': 'Bearer current_token' } });
      const res = await handleGetSessions(req, mockEnv);
      const json = await res.json() as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
      expect(json.data.find((s: any) => s.token === 'current_token').is_current).toBe(true);
      expect(json.data.find((s: any) => s.token === 'other_token').is_current).toBe(false);
    });
  });

  describe('handleDeleteSession', () => {
    it('deletes specific session successfully', async () => {
      mockDb.run.mockResolvedValueOnce({ success: true });

      const req = new Request('http://localhost/api/auth/sessions/sess_2', { method: 'DELETE' });
      const res = await handleDeleteSession(req, mockEnv, 'sess_2');
      
      expect(res.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM admin_sessions WHERE token = ? AND user_id = ?');
      expect(mockDb.bind).toHaveBeenCalledWith('sess_2', 'admin');
    });
  });

  describe('handleDeleteOtherSessions', () => {
    it('deletes all sessions except current one', async () => {
      mockDb.run.mockResolvedValueOnce({ success: true });

      const req = new Request('http://localhost/api/auth/sessions/others', { 
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer current_token' }
      });
      const res = await handleDeleteOtherSessions(req, mockEnv);
      
      expect(res.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM admin_sessions WHERE user_id = ? AND token != ?');
      expect(mockDb.bind).toHaveBeenCalledWith('admin', 'current_token');
    });
  });

  describe('handleGenerateBackupCodes', () => {
    it('generates 10 backup codes and inserts them', async () => {
      mockDb.run.mockResolvedValue({ success: true }); // delete old codes & inserts
      
      const req = new Request('http://localhost/api/auth/2fa/backup-codes', { method: 'POST' });
      const res = await handleGenerateBackupCodes(req, mockEnv);
      const json = await res.json() as any;

      expect(res.status).toBe(200);
      expect(json.data.codes.length).toBe(10);
      expect(mockDb.prepare).toHaveBeenCalledWith('INSERT INTO backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)');
      expect(mockDb.run).toHaveBeenCalledTimes(11); // 1 delete + 10 inserts
    });
  });
});

