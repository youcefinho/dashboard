// ── internal-chat.ts — Sprint 57 Canaux Internes de Discussion Équipe (Slack-like) ──
//
// Gère le clavardage interne entre les collaborateurs du tenant :
//   - GET /api/internal/channels : récupérer la liste des canaux du tenant.
//   - POST /api/internal/channels : créer un nouveau canal.
//   - GET /api/internal/channels/:id/messages : historique d'un canal (limité à 200).
//   - POST /api/internal/channels/:id/messages : poster un message + diffusion WebSocket.
//
// Tenant Isolation et protection IDOR via resolveClientId.
// Pas de FOREIGN KEY D1 réelle (jointures applicatives).

import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';
import { broadcastChatMessageToUser } from './notifications-ws';

async function resolveClientId(env: Env, auth: { userId: string; role: string; clientId?: string }): Promise<string | null> {
  if (auth.role === 'admin') return null;
  if (auth.clientId) return auth.clientId;
  const user = (await env.DB.prepare('SELECT client_id FROM users WHERE id = ?')
    .bind(auth.userId)
    .first()) as { client_id: string } | null;
  return user?.client_id ?? null;
}

export async function handleGetInternalChannels(
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client ID requis' }, 400);
    }

    const { results } = await env.DB.prepare(
      "SELECT * FROM internal_channels WHERE client_id = ? ORDER BY created_at ASC"
    )
      .bind(clientId)
      .all();

    return json({ data: results || [] });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function handleCreateInternalChannel(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client ID requis' }, 400);
    }

    const body = (await request.json()) as { name?: string; description?: string; is_private?: number };
    const name = sanitizeInput(body.name || '', 100).trim();
    const description = sanitizeInput(body.description || '', 250).trim();
    const isPrivate = body.is_private === 1 ? 1 : 0;

    if (!name) {
      return json({ error: 'Nom du canal requis' }, 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO internal_channels (id, client_id, name, description, is_private) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(id, clientId, name, description, isPrivate)
      .run();

    await audit(env, auth.userId, 'internal_channel.create', 'internal_channels', id, { name, isPrivate });

    return json({
      data: {
        id,
        client_id: clientId,
        name,
        description,
        is_private: isPrivate,
        success: true
      }
    }, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function handleGetInternalChannelMessages(
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  channelId: string
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client ID requis' }, 400);
    }

    // Vérifier l'isolation du tenant (IDOR)
    const channel = (await env.DB.prepare(
      "SELECT id FROM internal_channels WHERE id = ? AND client_id = ? LIMIT 1"
    )
      .bind(channelId, clientId)
      .first()) as { id: string } | null;

    if (!channel) {
      return json({ error: 'Canal introuvable' }, 404);
    }

    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name as user_name, u.avatar_url
         FROM internal_messages m
         JOIN users u ON m.user_id = u.id
        WHERE m.channel_id = ?
        ORDER BY m.created_at ASC
        LIMIT 200`
    )
      .bind(channelId)
      .all();

    return json({ data: results || [] });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function handleSendInternalMessage(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  channelId: string
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client ID requis' }, 400);
    }

    const body = (await request.json()) as { content?: string };
    const content = sanitizeInput(body.content || '', 5000).trim();

    if (!content) {
      return json({ error: 'Contenu requis' }, 400);
    }

    // Vérifier l'isolation du tenant (IDOR)
    const channel = (await env.DB.prepare(
      "SELECT id, name FROM internal_channels WHERE id = ? AND client_id = ? LIMIT 1"
    )
      .bind(channelId, clientId)
      .first()) as { id: string; name: string } | null;

    if (!channel) {
      return json({ error: 'Canal introuvable' }, 404);
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await env.DB.prepare(
      "INSERT INTO internal_messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(id, channelId, auth.userId, content, createdAt)
      .run();

    // Récupérer le profil de l'expéditeur
    const sender = (await env.DB.prepare(
      "SELECT name, avatar_url FROM users WHERE id = ? LIMIT 1"
    )
      .bind(auth.userId)
      .first()) as { name: string; avatar_url: string | null } | null;

    const liveMessage = {
      id,
      channel_id: channelId,
      user_id: auth.userId,
      user_name: sender?.name || 'Collaborateur',
      avatar_url: sender?.avatar_url || null,
      content,
      created_at: createdAt
    };

    // Récupérer tous les collaborateurs actifs du même tenant
    const { results: users } = await env.DB.prepare(
      "SELECT id FROM users WHERE client_id = ? AND is_active = 1"
    )
      .bind(clientId)
      .all();

    // Diffuser à tous via WebSocket
    for (const u of (users || []) as { id: string }[]) {
      await broadcastChatMessageToUser(env, u.id, liveMessage);
    }

    return json({
      data: {
        id,
        channel_id: channelId,
        user_id: auth.userId,
        content,
        success: true
      }
    }, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
