import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import { handleRegisterPushToken, sendPushNotificationToUser } from '../push';

function makeEnv(fcmServerKey?: string): Env {
  const db = createMockD1();
  return {
    DB: db as unknown as D1Database,
    FCM_SERVER_KEY: fcmServerKey,
  } as unknown as Env;
}

describe('Notifications Push Mobile - Tests Unitaires (Sprint 59)', () => {
  const auth = { userId: 'user_dev_999', role: 'user', clientId: 'client_intralys_59' };

  describe('handleRegisterPushToken', () => {
    it('doit inserer un nouveau token si le device_id n existe pas', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      // Seed pour dire que le device n'existe pas
      db.seed("SELECT id FROM user_push_tokens WHERE device_id = ? LIMIT 1", []);

      const req = new Request('https://localhost/api/user/push-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'fcm_token_xyz_123',
          platform: 'ios',
          device_id: 'iphone_15_pro_max_id'
        })
      });

      const res = await handleRegisterPushToken(req, env, auth);
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.data.success).toBe(true);
      expect(body.data.id).toBeDefined();

      const insertCall = db.calls.find(c => /insert into user_push_tokens/i.test(c.sql));
      expect(insertCall).toBeDefined();
      expect(insertCall!.args).toContain('fcm_token_xyz_123');
      expect(insertCall!.args).toContain('ios');
      expect(insertCall!.args).toContain('iphone_15_pro_max_id');
      expect(insertCall!.args).toContain(auth.userId);
    });

    it('doit mettre a jour le token si le device_id existe deja (upsert)', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      // Seed pour dire que le device existe deja avec l'ID 'token_id_777'
      db.seed("SELECT id FROM user_push_tokens WHERE device_id = ? LIMIT 1", [{ id: 'token_id_777' }]);

      const req = new Request('https://localhost/api/user/push-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'new_fcm_token_abc_789',
          platform: 'android',
          device_id: 'pixel_8_pro_id'
        })
      });

      const res = await handleRegisterPushToken(req, env, auth);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.success).toBe(true);
      expect(body.data.id).toBe('token_id_777');

      const updateCall = db.calls.find(c => /update user_push_tokens/i.test(c.sql));
      expect(updateCall).toBeDefined();
      expect(updateCall!.args).toContain('new_fcm_token_abc_789');
      expect(updateCall!.args).toContain('android');
      expect(updateCall!.args).toContain(auth.userId);
      expect(updateCall!.args).toContain('token_id_777');
    });

    it('doit renvoyer une erreur 400 si des champs obligatoires sont manquants', async () => {
      const env = makeEnv();

      const req = new Request('https://localhost/api/user/push-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'some_token',
          // platform manquante
          device_id: 'some_device'
        })
      });

      const res = await handleRegisterPushToken(req, env, auth);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('Token, platform (ios/android) et device_id requis');
    });

    it('doit renvoyer une erreur 400 si la plateforme est invalide', async () => {
      const env = makeEnv();

      const req = new Request('https://localhost/api/user/push-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'some_token',
          platform: 'windows', // Plateforme invalide
          device_id: 'some_device'
        })
      });

      const res = await handleRegisterPushToken(req, env, auth);
      expect(res.status).toBe(400);
    });
  });

  describe('sendPushNotificationToUser', () => {
    it('doit retourner une erreur si l utilisateur n a aucun token enregistre', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      db.seed("SELECT token, platform FROM user_push_tokens WHERE user_id = ?", []);

      const result = await sendPushNotificationToUser(env, 'user_without_tokens', 'Titre', 'Texte');
      expect(result.success).toBe(false);
      expect(result.delivered).toBe(0);
      expect(result.error).toBe('Aucun token enregistré');
    });

    it('doit utiliser le mode mock si FCM_SERVER_KEY n est pas configure', async () => {
      const env = makeEnv(undefined); // Pas de clé FCM
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      db.seed("SELECT token, platform FROM user_push_tokens WHERE user_id = ?", [
        { token: 'token_1', platform: 'ios' },
        { token: 'token_2', platform: 'android' }
      ]);

      const result = await sendPushNotificationToUser(env, 'user_with_tokens', 'Titre', 'Texte');
      expect(result.success).toBe(true);
      expect(result.delivered).toBe(2);
      expect(result.mock).toBe(true);
    });

    it('doit appeler l API Google FCM pour chaque token si FCM_SERVER_KEY est presente', async () => {
      const env = makeEnv('FCM_SECRET_SERVER_KEY');
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      db.seed("SELECT token, platform FROM user_push_tokens WHERE user_id = ?", [
        { token: 'token_fcm_1', platform: 'ios' },
        { token: 'token_fcm_2', platform: 'android' }
      ]);

      // Mocker le fetch global
      const fetchMock = vi.fn().mockImplementation(async (url, init) => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message_id: '12345' })
        } as Response;
      });
      global.fetch = fetchMock;

      const result = await sendPushNotificationToUser(
        env,
        'user_with_tokens',
        'Nouveau lead!',
        'Vous avez recu un nouveau lead de Mathis Guimont.',
        { leadId: 'lead_abc_123' }
      );

      expect(result.success).toBe(true);
      expect(result.delivered).toBe(2);
      expect(result.mock).toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://fcm.googleapis.com/fcm/send', expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'key=FCM_SECRET_SERVER_KEY',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: 'token_fcm_1',
          notification: {
            title: 'Nouveau lead!',
            body: 'Vous avez recu un nouveau lead de Mathis Guimont.',
            sound: 'default'
          },
          data: { leadId: 'lead_abc_123' }
        })
      }));
    });
  });
});
