// ── Push Notifications — Worker routes + FCM sender ─────────
// Sprint 11 — Capacitor V1

import type { Env } from './types';
import { json } from './helpers';

// ── Register device token ───────────────────────────────────

export async function handleRegisterDevice(
  request: Request,
  env: Env,
  auth: { userId: string }
): Promise<Response> {
  try {
    const { token, platform } = await request.json() as { token: string; platform: string };

    if (!token || !platform) {
      return json({ error: 'Token et plateforme requis' }, 400);
    }

    const validPlatforms = ['ios', 'android', 'web'];
    if (!validPlatforms.includes(platform)) {
      return json({ error: 'Plateforme invalide' }, 400);
    }

    const id = crypto.randomUUID();

    // Upsert : si le token existe déjà, mettre à jour l'user_id
    await env.DB.prepare(
      `INSERT INTO device_tokens (id, user_id, token, platform) VALUES (?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id`
    ).bind(id, auth.userId, token, platform).run();

    return json({ data: { id, token, platform } }, 201);
  } catch (e) {
    console.error('Erreur register device:', e);
    return json({ error: 'Erreur interne' }, 500);
  }
}

// ── Unregister device token ─────────────────────────────────

export async function handleUnregisterDevice(
  _request: Request,
  env: Env,
  auth: { userId: string },
  token: string
): Promise<Response> {
  try {
    await env.DB.prepare(
      `DELETE FROM device_tokens WHERE token = ? AND user_id = ?`
    ).bind(token, auth.userId).run();

    return json({ data: { success: true } });
  } catch (e) {
    console.error('Erreur unregister device:', e);
    return json({ error: 'Erreur interne' }, 500);
  }
}

// ── Envoyer une push notification via FCM REST API ──────────
// Compatible Cloudflare Workers (pas de Firebase Admin SDK Node)

export async function sendPushToUser(
  env: Env,
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const { results: tokens } = await env.DB.prepare(
      `SELECT token, platform FROM device_tokens WHERE user_id = ?`
    ).bind(userId).all();

    if (!tokens || tokens.length === 0) return;

    // FCM V1 API (HTTP)
    const fcmKey = (env as unknown as Record<string, unknown>).FCM_SERVER_KEY as string | undefined;
    if (!fcmKey) {
      console.error('FCM_SERVER_KEY non configuré — push ignoré');
      return;
    }

    for (const device of tokens) {
      try {
        await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `key=${fcmKey}`,
          },
          body: JSON.stringify({
            to: device.token as string,
            notification: { title, body },
            data: data || {},
          }),
        });
      } catch (err) {
        console.error(`Erreur push vers ${device.platform}:`, err);
      }
    }
  } catch (e) {
    console.error('Erreur sendPushToUser:', e);
  }
}

// ── Admin : envoyer une push manuelle ───────────────────────

export async function handleSendPush(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const { userId, title, body, data } = await request.json() as {
      userId: string;
      title: string;
      body: string;
      data?: Record<string, string>;
    };

    if (!userId || !title || !body) {
      return json({ error: 'userId, title et body requis' }, 400);
    }

    await sendPushToUser(env, userId, title, body, data);
    return json({ data: { sent: true } });
  } catch (e) {
    console.error('Erreur handleSendPush:', e);
    return json({ error: 'Erreur interne' }, 500);
  }
}
