// ── Module Notifications WebSocket — Intralys CRM (Sprint 46 M3.4) ─────────
// Durable Object par user_id qui broadcast les notifications en temps réel.
// Pattern adapté de webchat.ts (WebchatRoom) :
//   - Une room = un user (id Durable Object = user_id)
//   - Un user peut avoir N onglets / devices connectés simultanément
//   - createNotification() broadcast à TOUTES les sessions de l'user concerné
//   - Cleanup auto via alarm si aucune session active depuis 1h
//
// Endpoints :
//   - GET /api/notifications/ws?token=...  → upgrade WebSocket
//   - POST internal /broadcast (depuis le worker principal via DO stub)
//
// Auth : token Bearer en query param (WS ne supporte pas headers custom).
// Validation côté worker.ts AVANT de forwarder au DO.

import type { Env } from './types';
import { json } from './helpers';

interface BroadcastPayload {
  notification: {
    id: string;
    icon: string;
    title: string;
    description: string;
    link: string;
    is_read: number;
    created_at: string;
  };
}

// ── NotificationsRoom Durable Object ────────────────────────────────────────

export class NotificationsRoom {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Set<WebSocket> = new Set();
  private userId: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── Upgrade WebSocket ────────────────────────────────────────────────────
    if (request.headers.get('Upgrade') === 'websocket') {
      const userId = url.searchParams.get('user_id') || '';
      if (!userId) {
        return new Response('Missing user_id', { status: 400 });
      }
      this.userId = userId;

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      this.state.acceptWebSocket(server);
      this.sessions.add(server);

      // Hello message — confirme la connexion + user_id
      try {
        server.send(
          JSON.stringify({ type: 'hello', user_id: userId, ts: Date.now() }),
        );
      } catch {
        /* ignore */
      }

      // Setup alarm de cleanup 1h après dernière activité
      await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── Broadcast interne (depuis worker.ts via DO stub) ─────────────────────
    if (request.method === 'POST' && url.pathname.endsWith('/broadcast')) {
      try {
        const payload = (await request.json()) as BroadcastPayload;
        const message = JSON.stringify({
          type: 'notification',
          notification: payload.notification,
        });
        let delivered = 0;
        for (const ws of this.sessions) {
          try {
            ws.send(message);
            delivered++;
          } catch {
            // session dead → cleanup
            this.sessions.delete(ws);
          }
        }
        return json({ ok: true, delivered });
      } catch {
        return json({ error: 'Invalid payload' }, 400);
      }
    }

    // ── Info debug ───────────────────────────────────────────────────────────
    if (url.pathname.endsWith('/info')) {
      return json({
        user_id: this.userId,
        active_sessions: this.sessions.size,
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    // Le client peut envoyer des pings keep-alive — on répond ping
    try {
      const data = JSON.parse(
        typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage),
      ) as { type?: string };
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      }
    } catch {
      /* malformed, swallow */
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  async alarm(): Promise<void> {
    // Cleanup si plus de sessions actives
    if (this.sessions.size === 0) {
      // Rien à faire — DO sera collecté automatiquement par CF
      return;
    }
    // Sinon, re-arm pour 1h
    await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
  }
}

// ── Helper broadcast (utilisé par createNotification dans helpers.ts) ───────
// Garde simple : si le binding n'existe pas, no-op silencieux.
export async function broadcastNotificationToUser(
  env: Env,
  userId: string,
  notification: BroadcastPayload['notification'],
): Promise<void> {
  if (!env.NOTIFICATION_ROOMS || !userId) return;
  try {
    const id = env.NOTIFICATION_ROOMS.idFromName(userId);
    const stub = env.NOTIFICATION_ROOMS.get(id);
    // URL fictive — le DO route via pathname
    await stub.fetch('https://do/broadcast', {
      method: 'POST',
      body: JSON.stringify({ notification }),
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    /* best-effort — broadcast non critique */
  }
}

// ── Connect handler (route /api/notifications/ws) ───────────────────────────
// Auth déjà validée côté worker.ts (token → userId). On forwarde au DO room.
export async function handleNotificationsWsConnect(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return json({ error: 'WebSocket upgrade required' }, 426);
  }
  if (!env.NOTIFICATION_ROOMS) {
    return json({ error: 'Notifications WebSocket non disponible' }, 503);
  }
  const id = env.NOTIFICATION_ROOMS.idFromName(userId);
  const stub = env.NOTIFICATION_ROOMS.get(id);
  // Forward avec user_id query param pour que le DO sache à qui broadcaster
  const url = new URL(request.url);
  url.searchParams.set('user_id', userId);
  return stub.fetch(url.toString(), request);
}

// ── PUT /api/notifications/preferences (matrix bulk save) ───────────────────
// Sprint 46 M3.3 — full replace de la matrice channels × events pour l'user.
// Utile pour reset / import / export presets en un seul RTT.
interface MatrixPayload {
  preferences: Array<{
    channel: string;
    event_type: string;
    enabled: boolean;
  }>;
}

const ALLOWED_CHANNELS = new Set(['email', 'sms', 'push', 'in_app', 'slack']);

export async function handleSetNotificationPreferencesMatrix(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  let body: MatrixPayload;
  try {
    body = (await request.json()) as MatrixPayload;
  } catch {
    return json({ error: 'Body JSON invalide' }, 400);
  }
  if (!body || !Array.isArray(body.preferences)) {
    return json({ error: 'preferences[] requis' }, 400);
  }

  // Validation entries
  const cleaned = body.preferences.filter(
    (p) =>
      p &&
      typeof p.channel === 'string' &&
      ALLOWED_CHANNELS.has(p.channel) &&
      typeof p.event_type === 'string' &&
      p.event_type.length > 0 &&
      p.event_type.length <= 64,
  );

  // Transaction batch : DELETE all + INSERT cleaned
  const stmts = [
    env.DB.prepare('DELETE FROM notification_preferences WHERE user_id = ?').bind(auth.userId),
    ...cleaned.map((p) =>
      env.DB.prepare(
        `INSERT INTO notification_preferences (user_id, channel, event_type, enabled)
         VALUES (?, ?, ?, ?)`,
      ).bind(auth.userId, p.channel, p.event_type, p.enabled ? 1 : 0),
    ),
  ];

  try {
    await env.DB.batch(stmts);
    return json({ data: { success: true, count: cleaned.length } });
  } catch (err) {
    console.error('Erreur set notification preferences matrix:', err);
    return json({ error: 'Erreur D1' }, 500);
  }
}
