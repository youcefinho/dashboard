import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptToken, decryptToken, handleGhlOauthCallback } from '../migration-ghl-oauth';

describe('GHL OAuth Security', () => {
  // ── Token encrypt/decrypt ───────────────────────────────────

  describe('Token Chiffrement AES-GCM', () => {
    const mockEnv = { TOKEN_KEY: 'test-key-32-chars-for-aes-gcm!!' } as any;

    it('encrypt/decrypt roundtrip conserve le texte', async () => {
      const original = 'ghl_access_token_super_secret_1234';
      const encrypted = await encryptToken(original, mockEnv);
      expect(encrypted).not.toBe(original); // Doit être chiffré
      const decrypted = await decryptToken(encrypted, mockEnv);
      expect(decrypted).toBe(original);
    });

    it('deux chiffrements du même texte donnent des résultats différents (IV aléatoire)', async () => {
      const original = 'same_token_value';
      const enc1 = await encryptToken(original, mockEnv);
      const enc2 = await encryptToken(original, mockEnv);
      expect(enc1).not.toBe(enc2); // IV différent
      // Mais les deux déchiffrent vers le même texte
      expect(await decryptToken(enc1, mockEnv)).toBe(original);
      expect(await decryptToken(enc2, mockEnv)).toBe(original);
    });

    it('fallback dev : sans TOKEN_KEY, retourne le texte brut', async () => {
      const envNoKey = {} as any;
      const original = 'raw_token';
      const encrypted = await encryptToken(original, envNoKey);
      expect(encrypted).toBe(original);
      const decrypted = await decryptToken(original, envNoKey);
      expect(decrypted).toBe(original);
    });
  });

  // ── State CSRF ─────────────────────────────────────────────

  describe('State CSRF Validation', () => {
    let mockEnv: any;

    beforeEach(() => {
      const kvStore = new Map<string, string>();
      mockEnv = {
        GHL_CLIENT_ID: 'test-id',
        GHL_CLIENT_SECRET: 'test-secret',
        STATE_STORE: {
          get: vi.fn(async (key: string) => kvStore.get(key) || null),
          put: vi.fn(async (key: string, value: string) => { kvStore.set(key, value); }),
          delete: vi.fn(async (key: string) => { kvStore.delete(key); }),
        },
        DB: {
          prepare: vi.fn().mockReturnThis(),
          bind: vi.fn().mockReturnThis(),
          run: vi.fn().mockResolvedValue({ success: true }),
        },
      };
    });

    it('callback sans state KV → 403', async () => {
      // State avec un nonce qui n'existe pas dans le KV
      const fakeState = btoa(JSON.stringify({ nonce: 'non-existent-nonce' }));
      const url = new URL(`http://localhost/api/migration/ghl/oauth/callback?code=test_code&state=${encodeURIComponent(fakeState)}`);
      const request = new Request(url.toString());

      const res = await handleGhlOauthCallback(request, mockEnv, url);
      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body.error).toContain('CSRF');
    });

    it('callback avec state valide → KV consommé (one-time use)', async () => {
      const nonce = 'valid-nonce-123';
      const stateKey = `oauth_state:${nonce}`;
      const stateData = JSON.stringify({ client_id: 'c1', user_id: 'u1', nonce });

      // Simuler un state stocké
      await mockEnv.STATE_STORE.put(stateKey, stateData);
      expect(await mockEnv.STATE_STORE.get(stateKey)).toBe(stateData);

      // Le callback va essayer de fetch le token GHL, ce qui va fail en test
      // On vérifie juste que le state est bien consommé (delete appelé)
      const state = btoa(JSON.stringify({ nonce }));
      const url = new URL(`http://localhost/api/migration/ghl/oauth/callback?code=test_code&state=${encodeURIComponent(state)}`);
      const request = new Request(url.toString());

      // Le fetch GHL va échouer (pas de serveur), mais le state doit être consommé avant
      await handleGhlOauthCallback(request, mockEnv, url);

      // Vérifier que delete a bien été appelé (one-time use)
      expect(mockEnv.STATE_STORE.delete).toHaveBeenCalledWith(stateKey);
    });

    it('callback sans code → 400', async () => {
      const url = new URL('http://localhost/api/migration/ghl/oauth/callback?state=abc');
      const request = new Request(url.toString());
      const res = await handleGhlOauthCallback(request, mockEnv, url);
      expect(res.status).toBe(400);
    });

    it('callback avec state invalide (pas du base64) → 400', async () => {
      const url = new URL('http://localhost/api/migration/ghl/oauth/callback?code=test&state=!!!invalid!!!');
      const request = new Request(url.toString());
      const res = await handleGhlOauthCallback(request, mockEnv, url);
      expect(res.status).toBe(400);
    });
  });
});
