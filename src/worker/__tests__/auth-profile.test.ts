import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUpdateProfile, handleNotificationPreferences } from '../auth';
import type { Env } from '../types';

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ userId: 'user_1', role: 'admin' }),
    audit: vi.fn().mockResolvedValue(true)
  };
});

describe('Auth Profile & Notifications Tests - Phase E', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    all: vi.fn(),
    run: vi.fn(),
  };
  const mockEnv = { DB: mockDb, DEV_BYPASS_AUTH: 'true' } as unknown as Env;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleUpdateProfile', () => {
    it('updates email signature successfully', async () => {
      mockDb.run.mockResolvedValueOnce({ success: true });

      const req = new Request('http://localhost/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ email_signature: '<p>My signature</p>' })
      });
      
      const res = await handleUpdateProfile(req, mockEnv);
      const json = await res.json() as any;

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('email_signature = ?'));
      expect(mockDb.bind).toHaveBeenCalledWith('<p>My signature</p>', 'admin');
    });

    it('updates name and signature successfully', async () => {
      mockDb.run.mockResolvedValueOnce({ success: true });

      const req = new Request('http://localhost/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New Name', email_signature: 'sig' })
      });
      
      const res = await handleUpdateProfile(req, mockEnv);
      const json = await res.json() as any;

      expect(res.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('name = ?'));
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('email_signature = ?'));
      expect(mockDb.bind).toHaveBeenCalledWith('New Name', 'sig', 'admin');
    });
  });

  describe('handleNotificationPreferences', () => {
    it('GET returns user preferences', async () => {
      mockDb.all.mockResolvedValueOnce({
        results: [
          { channel: 'email', event_type: 'lead.created', enabled: 1 },
          { channel: 'sms', event_type: 'task.due', enabled: 0 }
        ]
      });

      const req = new Request('http://localhost/api/auth/notifications', { method: 'GET' });
      const res = await handleNotificationPreferences(req, mockEnv);
      const json = await res.json() as any;

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(2);
      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT channel, event_type, enabled FROM notification_preferences WHERE user_id = ?');
      expect(mockDb.bind).toHaveBeenCalledWith('admin');
    });

    it('PATCH upserts preference correctly', async () => {
      mockDb.run.mockResolvedValueOnce({ success: true });

      const req = new Request('http://localhost/api/auth/notifications', {
        method: 'PATCH',
        body: JSON.stringify({ channel: 'email', event_type: 'lead.created', enabled: true })
      });
      const res = await handleNotificationPreferences(req, mockEnv);
      const json = await res.json() as any;

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_preferences'));
      expect(mockDb.bind).toHaveBeenCalledWith('admin', 'email', 'lead.created', 1);
    });

    it('PATCH returns 400 if params are missing', async () => {
      const req = new Request('http://localhost/api/auth/notifications', {
        method: 'PATCH',
        body: JSON.stringify({ channel: 'email' }) // Missing event_type
      });
      const res = await handleNotificationPreferences(req, mockEnv);
      
      expect(res.status).toBe(400);
    });
  });
});
