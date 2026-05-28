// ── push.ts — Sprint 59 Notifications Push Mobile (FCM & APNS) ──
//
// Gère l'enregistrement des jetons de terminaux Capacitor mobiles :
//   - POST /api/user/push-token : lier un token de device FCM/APNS à l'utilisateur connecté.
//   - sendPushNotificationToUser : envoi de push mobile via FCM Legacy HTTP API (FCM_SERVER_KEY).
//
// Isolation par device_id (index unique) et userId.
// Pas de FOREIGN KEY D1 réelle (jointures applicatives).

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { handleRegisterDevice as regDevice, handleUnregisterDevice as unregDevice } from './mobile';

// Alias d'envoi requis par helpers.ts
export { sendPushNotificationToUser as sendPushToUser };

/**
 * Ré-export de l'enregistrement de device mobile (legacy table device_tokens).
 */
export async function handleRegisterDevice(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  return regDevice(request, env, auth);
}

/**
 * Ré-export et gestion de la suppression de device mobile (legacy table device_tokens).
 * Supporte la suppression par token passé dans l'URL ou dans le body.
 */
export async function handleUnregisterDevice(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  tokenFromUrl?: string
): Promise<Response> {
  if (tokenFromUrl) {
    await env.DB.prepare('DELETE FROM device_tokens WHERE token = ? AND user_id = ?')
      .bind(tokenFromUrl, auth.userId)
      .run();
    return json({ data: { success: true } });
  }
  return unregDevice(request, env, auth);
}

/**
 * Route admin d'envoi manuel de push notification.
 */
export async function handleSendPush(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as { userId?: string; title?: string; body?: string; payload?: any };
    const userId = sanitizeInput(body.userId || '', 100);
    const title = sanitizeInput(body.title || '', 200);
    const bodyText = sanitizeInput(body.body || '', 1000);
    const payload = body.payload || {};

    if (!userId || !title || !bodyText) {
      return json({ error: 'userId, title et body requis' }, 400);
    }

    const res = await sendPushNotificationToUser(env, userId, title, bodyText, payload);
    return json({ data: res });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/**
 * Enregistrement du token push Capacitor par utilisateur (nouvelle table user_push_tokens).
 */
export async function handleRegisterPushToken(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  try {
    const body = (await request.json()) as { token?: string; platform?: string; device_id?: string };
    const token = sanitizeInput(body.token || '', 512).trim();
    const platform = sanitizeInput(body.platform || '', 20).trim().toLowerCase();
    const deviceId = sanitizeInput(body.device_id || '', 100).trim();

    if (!token || !deviceId || !['ios', 'android'].includes(platform)) {
      return json({ error: 'Token, platform (ios/android) et device_id requis' }, 400);
    }

    // Upsert du token par device_id
    const existing = (await env.DB.prepare(
      "SELECT id FROM user_push_tokens WHERE device_id = ? LIMIT 1"
    )
      .bind(deviceId)
      .first()) as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        "UPDATE user_push_tokens SET user_id = ?, token = ?, platform = ?, updated_at = datetime('now') WHERE id = ?"
      )
        .bind(auth.userId, token, platform, existing.id)
        .run();
      return json({ data: { id: existing.id, success: true } });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO user_push_tokens (id, user_id, token, platform, device_id) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(id, auth.userId, token, platform, deviceId)
      .run();

    return json({ data: { id, success: true } }, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/**
 * Envoie une notification push mobile à un utilisateur sur tous ses tokens FCM/APNS actifs.
 */
export async function sendPushNotificationToUser(
  env: Env,
  userId: string,
  title: string,
  bodyText: string,
  payload?: any
): Promise<{ success: boolean; delivered: number; mock?: boolean; error?: string }> {
  try {
    // Récupérer les tokens actifs de l'utilisateur
    const { results } = await env.DB.prepare(
      "SELECT token, platform FROM user_push_tokens WHERE user_id = ?"
    )
      .bind(userId)
      .all();

    if (!results || results.length === 0) {
      return { success: false, delivered: 0, error: 'Aucun token enregistré' };
    }

    if (!env.FCM_SERVER_KEY) {
      // Mode Mock/Bypass si pas de clé FCM
      return { success: true, delivered: results.length, mock: true };
    }

    let delivered = 0;
    for (const row of results as { token: string; platform: string }[]) {
      try {
        const res = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            Authorization: `key=${env.FCM_SERVER_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: row.token,
            notification: {
              title,
              body: bodyText,
              sound: 'default',
            },
            data: payload || {},
          }),
        });

        if (res.ok) {
          delivered++;
        }
      } catch {
        // best-effort
      }
    }

    return { success: delivered > 0, delivered };
  } catch (err) {
    return { success: false, delivered: 0, error: String(err) };
  }
}
