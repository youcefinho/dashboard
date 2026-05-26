// ── Sprint 36 — chat-session.ts — Handlers PUBLIC visiteur ────────────────
// 3 handlers production : start / message (POST fallback no-WS) / poll (long-poll).
// Signatures conformes au contrat figé docs/LOT-CHAT-WIDGET-S36.md §6.
//
// Pipeline :
//   1) start  : honeypot + rate-limit IP-hash + lookup widget actif +
//      validateChatOrigin + verifyTurnstile (si activé) + persistSessionStart
//      (lib/chat-session-do.ts) → renvoie { session_id, conversation_id }.
//   2) message: POST fallback pour clients qui n'ouvrent pas le WS (sandboxé,
//      réseau bridé). Insère directement dans `messages` + bump
//      `webchat_sessions.last_seen_at`. NE TOUCHE PAS au DO WebchatRoom
//      existant (src/worker/webchat.ts).
//   3) poll   : long-poll fallback pour récupérer les nouveaux messages depuis
//      `since` ISO timestamp (limit 50).
//
// Contrats : json({ data }) succès / json({ error }, status) erreur. Pas de
// champ `code` dans les erreurs (calque idiome conversations.ts / webchat.ts).

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { validateChatOrigin, sha256Ip, verifyTurnstile } from './lib/chat-origin-check';
import { persistSessionStart } from './lib/chat-session-do';
import { checkRateLimit } from './lib/rate-limit';

// ── POST /api/chat-session/start ───────────────────────────────────────────
// Wrapper anti-bot enrichi : honeypot → rate-limit → widget lookup → origin
// validation → Turnstile → persistSessionStart. Tous les fail-paths renvoient
// 200 fake-success pour le honeypot (silent_drop) ou un code d'erreur pour
// les autres rejets (rate_limited / widget_not_found / origin_rejected /
// turnstile_failed).
export async function handlePublicChatStart(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const body = await request.json() as {
      client_id?: string;
      visitor_name?: string;
      visitor_email?: string;
      _hp?: string;
      page_url?: string;
      referrer?: string;
      cf_turnstile_response?: string;
    };

    // 1) Honeypot : champ `_hp` rempli = bot. On renvoie un fake success 200
    //    pour ne pas signaler au bot qu'il a été détecté (pattern silent_drop).
    if (body._hp && String(body._hp).trim().length > 0) {
      return json({ data: { conversation_id: 'silent_drop' } });
    }

    // 2) Rate-limit par IP-hash (5 req / 600 s — calque limites prechat).
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await sha256Ip(ip);
    const rateLimit = await checkRateLimit(env, `webchat:prechat:${ipHash}`, 5, 600);
    if (!rateLimit.allowed) {
      return json({ error: 'rate_limited' }, 429);
    }

    // 3) Lookup widget actif par client_id.
    const clientId = sanitizeInput(body.client_id, 200);
    if (!clientId) {
      return json({ error: 'widget_not_found' }, 404);
    }
    const widget = await env.DB.prepare(
      `SELECT id, client_id, allowed_origins, turnstile_enabled
         FROM webchat_widgets
        WHERE client_id = ? AND is_active = 1
        LIMIT 1`,
    ).bind(clientId).first() as {
      id: string;
      client_id: string;
      allowed_origins: string | null;
      turnstile_enabled: number | null;
    } | null;

    if (!widget) {
      return json({ error: 'widget_not_found' }, 404);
    }

    // 4) Origin validation contre l'allowlist du widget (JSON array).
    let allowedOrigins: string[] | null = null;
    if (widget.allowed_origins) {
      try {
        const parsed = JSON.parse(widget.allowed_origins);
        if (Array.isArray(parsed)) {
          allowedOrigins = parsed.filter((o): o is string => typeof o === 'string');
        }
      } catch {
        allowedOrigins = null;
      }
    }
    const origin = request.headers.get('Origin');
    if (!validateChatOrigin(allowedOrigins, origin)) {
      return json({ error: 'origin_rejected' }, 403);
    }

    // 5) Turnstile (si activé sur le widget).
    if (widget.turnstile_enabled === 1) {
      const turnstileOk = await verifyTurnstile(
        env,
        body.cf_turnstile_response || null,
        ip,
      );
      if (!turnstileOk) {
        return json({ error: 'turnstile_failed' }, 403);
      }
    }

    // 6) Persist session (conversation + webchat_sessions + audit).
    const sessionData = {
      ip,
      userAgent: request.headers.get('User-Agent'),
      pageUrl: body.page_url ? sanitizeInput(body.page_url, 500) : null,
      referrer: body.referrer ? sanitizeInput(body.referrer, 500) : null,
      visitorName: body.visitor_name ? sanitizeInput(body.visitor_name, 200) : null,
      visitorEmail: body.visitor_email
        ? sanitizeInput(body.visitor_email, 200).toLowerCase()
        : null,
      clientId: widget.client_id,
    };

    const { sessionId, conversationId } = await persistSessionStart(
      env,
      widget.id,
      sessionData,
    );

    return json({
      data: { session_id: sessionId, conversation_id: conversationId },
    });
  } catch {
    // Fallback 500 — pas de leak d'info interne au visiteur.
    return json({ error: 'internal_error' }, 500);
  }
}

// ── POST /api/chat-session/:id/message ─────────────────────────────────────
// Fallback HTTP no-WS : insère directement dans `messages` + bump
// `webchat_sessions.last_seen_at`. Réservé aux iframes / sandboxes qui ne
// peuvent pas tenir un WS ouvert.
export async function handlePublicChatMessage(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  try {
    const body = await request.json() as {
      body?: string;
      sender_name?: string;
    };

    // 1) Validation : body non-vide, longueur ≤ 4000.
    const rawBody = (body.body || '').trim();
    if (!rawBody) {
      return json({ error: 'body_required' }, 400);
    }
    if (rawBody.length > 4000) {
      return json({ error: 'body_too_long' }, 400);
    }
    const cleanBody = sanitizeInput(rawBody, 4000);
    const senderName = body.sender_name
      ? sanitizeInput(body.sender_name, 200)
      : 'Visiteur';

    // 2) Lookup session.
    const session = await env.DB.prepare(
      `SELECT conversation_id, status
         FROM webchat_sessions
        WHERE id = ?
        LIMIT 1`,
    ).bind(sessionId).first() as {
      conversation_id: string | null;
      status: string | null;
    } | null;

    if (!session || session.status === 'closed') {
      return json({ error: 'session_not_found' }, 404);
    }

    const conversationId = session.conversation_id;
    if (!conversationId) {
      return json({ error: 'session_not_found' }, 404);
    }

    // 3) Lookup client_id depuis la conversation (pour la colonne messages.client_id).
    //    NB : Phase A persistSessionStart insère conversations.lead_id='' (le
    //    lead n'existe pas encore tant que visitor_email manque). On suit le
    //    même pattern ici pour messages.lead_id afin de ne pas casser le FK
    //    (D1 a FOREIGN_KEYS=OFF par défaut, comme phase41 et webchat.ts).
    const conv = await env.DB.prepare(
      `SELECT client_id, lead_id FROM conversations WHERE id = ? LIMIT 1`,
    ).bind(conversationId).first() as { client_id: string; lead_id: string } | null;

    const clientId = conv?.client_id || '';
    const leadId = conv?.lead_id || '';

    // 4) INSERT message inbound.
    const messageId = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO messages
           (id, lead_id, client_id, conversation_id, direction, channel,
            body, status, sent_by, created_at)
         VALUES (?, ?, ?, ?, 'inbound', 'webchat', ?, 'received', ?, datetime('now'))`,
      ).bind(
        messageId,
        leadId,
        clientId,
        conversationId,
        cleanBody,
        senderName,
      ).run();
    } catch {
      return json({ error: 'message_insert_failed' }, 500);
    }

    // 5) Bump last_seen_at sur la session (best-effort, ne bloque pas).
    try {
      await env.DB.prepare(
        `UPDATE webchat_sessions
            SET last_seen_at = datetime('now')
          WHERE id = ?`,
      ).bind(sessionId).run();
    } catch { /* best-effort */ }

    // 6) Bump conversation last_message_at + preview + unread (best-effort).
    try {
      await env.DB.prepare(
        `UPDATE conversations
            SET last_message_at = datetime('now'),
                last_message_preview = ?,
                unread_count = unread_count + 1,
                updated_at = datetime('now')
          WHERE id = ?`,
      ).bind(cleanBody.substring(0, 120), conversationId).run();
    } catch { /* best-effort */ }

    return json({
      data: { message_id: messageId, conversation_id: conversationId },
    });
  } catch {
    return json({ error: 'internal_error' }, 500);
  }
}

// ── GET /api/chat-session/:id/poll?since=ISO ───────────────────────────────
// Long-poll fallback : retourne les messages de la conversation créés après
// `since` (ISO timestamp, default '1970'). Limit 50 messages par poll.
export async function handlePublicChatPoll(
  env: Env,
  sessionId: string,
  url: URL,
): Promise<Response> {
  try {
    const since = url.searchParams.get('since') || '1970-01-01T00:00:00Z';

    // 1) Lookup session.
    const session = await env.DB.prepare(
      `SELECT conversation_id, status
         FROM webchat_sessions
        WHERE id = ?
        LIMIT 1`,
    ).bind(sessionId).first() as {
      conversation_id: string | null;
      status: string | null;
    } | null;

    if (!session || session.status === 'closed') {
      return json({ error: 'session_not_found' }, 404);
    }

    const conversationId = session.conversation_id;
    if (!conversationId) {
      return json({ error: 'session_not_found' }, 404);
    }

    // 2) SELECT messages > since (ASC ordering pour streaming naturel côté
    //    visiteur). Limit 50 = ~25s de chat agent à débit normal.
    const { results } = await env.DB.prepare(
      `SELECT id, direction, body, sent_by AS sender_name, created_at
         FROM messages
        WHERE conversation_id = ? AND created_at > ?
        ORDER BY created_at ASC
        LIMIT 50`,
    ).bind(conversationId, since).all();

    // 3) Bump last_seen_at (best-effort) — le visiteur poll = il est encore là.
    try {
      await env.DB.prepare(
        `UPDATE webchat_sessions
            SET last_seen_at = datetime('now')
          WHERE id = ?`,
      ).bind(sessionId).run();
    } catch { /* best-effort */ }

    return json({
      data: {
        messages: results || [],
        server_time: new Date().toISOString(),
      },
    });
  } catch {
    return json({ error: 'internal_error' }, 500);
  }
}
