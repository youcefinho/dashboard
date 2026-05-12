import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Env } from '../types';
import { handleForgotPassword, handleResetPassword } from '../auth';
import { hashPassword } from '../crypto';

const mockEnv = {
  DB: {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true }),
    first: vi.fn(),
    all: vi.fn(),
  },
  RESEND_API_KEY: 'test-resend-key',
} as unknown as Env;

describe('Sprint 12 - Phase A.2 - Password Reset', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'resend-id' }), text: async () => 'OK' });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('POST /api/auth/forgot-password', () => {
    it('renvoie un succès anti-énumération même si email inconnu', async () => {
      // @ts-expect-error mock
      mockEnv.DB.first.mockResolvedValueOnce(null); // pas de user

      const req = new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'inconnu@test.com' }),
      });

      const res = await handleForgotPassword(req, mockEnv);
      const json = await res.json() as any;

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled(); // pas d'email envoyé
    });

    it('insère un token et envoie un email si user trouvé', async () => {
      // @ts-expect-error mock
      mockEnv.DB.first.mockResolvedValueOnce({ id: 'user-1', name: 'Rochdi' });

      const req = new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'rochdi@test.com' }),
      });

      const res = await handleForgotPassword(req, mockEnv);
      const json = await res.json() as any;

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO password_reset_tokens'));
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchArgs = vi.mocked(global.fetch).mock.calls[0];
      expect(fetchArgs?.[0]).toBe('https://api.resend.com/emails');
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('rejette un token invalide', async () => {
      // @ts-expect-error mock
      mockEnv.DB.first.mockResolvedValueOnce(null);

      const req = new Request('http://localhost/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: 'bad-token', password: 'newpassword123' }),
      });

      const res = await handleResetPassword(req, mockEnv);
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('Lien invalide');
    });

    it('réinitialise le mot de passe avec un token valide', async () => {
      // @ts-expect-error mock
      mockEnv.DB.first.mockResolvedValueOnce({
        id: 'token-1',
        user_id: 'user-1',
        used: 0,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });

      const req = new Request('http://localhost/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: 'good-token', password: 'newpassword123' }),
      });

      const res = await handleResetPassword(req, mockEnv);
      expect(res.status).toBe(200);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET password_hash = ?'));
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE password_reset_tokens SET used = 1'));
    });
  });
});
