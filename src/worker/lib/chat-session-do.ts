// ── Sprint 36 — chat-session-do.ts — Helpers persist/notify session webchat ──
// Phase B implementation : INSERT webchat_sessions + best-effort notify.
//
// ZÉRO modification du Durable Object WebchatRoom (src/worker/webchat.ts) :
// ce module agit en parallèle, lit/écrit les tables webchat_widgets /
// webchat_sessions / webchat_agent_presence ajoutées par seq131 (ALTER ADD
// COLUMN) sans toucher au DO existant. WebchatRoom pourra consommer ces
// helpers ultérieurement (lookup conversation_id pour DO id, etc.).

import type { Env } from '../types';
import type { ChatSession } from '../../lib/api';
import { audit } from '../helpers';

export interface VisitorContext {
  ip?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
  referrer?: string | null;
  visitorName?: string | null;
  visitorEmail?: string | null;
  clientId: string;
}

// ── Helper interne : SHA-256 hex d'une string (Loi 25 / RGPD — jamais IP brute)
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Persiste une nouvelle session webchat dans `webchat_sessions` (seq25 +
 * colonnes seq131). Retourne { sessionId, conversationId } pour que
 * handlePublicChatStart puisse renvoyer ces ids au visiteur + les binder au
 * Durable Object WebchatRoom (DO id from conversation_id).
 *
 * Throws `widget_not_found` si le widget n'existe pas (seul cas où on throw).
 */
export async function persistSessionStart(
  env: Env,
  widgetId: string,
  visitorData: VisitorContext,
): Promise<{ sessionId: string; conversationId: string }> {
  // 1. Lookup widget pour récupérer client_id (+ agency_id pour audit éventuel).
  const widget = await env.DB.prepare(
    'SELECT client_id, agency_id FROM webchat_widgets WHERE id = ?'
  ).bind(widgetId).first() as { client_id: string; agency_id: string | null } | null;

  if (!widget) {
    throw new Error('widget_not_found');
  }

  const clientId = widget.client_id || visitorData.clientId || '';

  // 2. Créer la conversation côté CRM (channel=webchat, status=open).
  //    On n'utilise PAS findOrCreateConversation de conversations.ts car celle-ci
  //    requiert un lead_id et lookup par lead. Ici, la session précède le lead :
  //    le visiteur peut être anonyme jusqu'au prechat (cf. webchat.ts §128).
  //    Le lead sera lié plus tard via UPDATE conversations.lead_id lorsqu'on
  //    aura un email (cf. handleWebchatPrechat). En attendant on stocke un
  //    external_id traçable dans le subject pour debug + persiste lead_id=''.
  const conversationId = crypto.randomUUID();
  const externalId = 'webchat_' + crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO conversations (id, lead_id, client_id, channel, status, subject, last_message_at, unread_count)
       VALUES (?, '', ?, 'webchat', 'open', ?, datetime('now'), 0)`
    ).bind(conversationId, clientId, externalId).run();
  } catch (err) {
    // Best-effort : si la création échoue (ex : contrainte FK lead_id en mode
    // strict), on rethrow car sans conversation_id le visiteur ne peut pas se
    // connecter au DO downstream. C'est un échec dur côté handler.
    throw new Error('conversation_create_failed: ' + String(err));
  }

  // 3. Hash IP best-effort (jamais IP brute en DB — Loi 25 / RGPD).
  let ipHash: string | null = null;
  if (visitorData.ip) {
    try {
      ipHash = await sha256Hex(visitorData.ip);
    } catch {
      ipHash = null;
    }
  }

  // 4. INSERT webchat_sessions (colonnes seq25 + seq131).
  const sessionId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO webchat_sessions (
         id, widget_id, conversation_id, visitor_name, visitor_email,
         page_url, referrer, user_agent, ip_hash,
         status, started_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`
    ).bind(
      sessionId,
      widgetId,
      conversationId,
      visitorData.visitorName || null,
      visitorData.visitorEmail || null,
      visitorData.pageUrl || null,
      visitorData.referrer || null,
      visitorData.userAgent || null,
      ipHash,
    ).run();
  } catch (err) {
    throw new Error('session_insert_failed: ' + String(err));
  }

  // 5. Audit best-effort (ne bloque jamais).
  try {
    await audit(env, 'system', 'chat.session.start', 'webchat_session', sessionId, {
      widget_id: widgetId,
      conversation_id: conversationId,
      client_id: clientId,
      agency_id: widget.agency_id,
      has_email: Boolean(visitorData.visitorEmail),
    });
  } catch { /* non critique */ }

  return { sessionId, conversationId };
}

/**
 * Marque une session comme fermée (`ended_at`, `status='closed'`).
 * Best-effort : pas de throw si la session n'existe pas ou est déjà fermée.
 */
export async function markSessionEnd(
  env: Env,
  sessionId: string,
): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE webchat_sessions
         SET ended_at = datetime('now'), status = 'closed'
       WHERE id = ? AND ended_at IS NULL`
    ).bind(sessionId).run();
  } catch {
    // best-effort — cleanup ou alarm path, on n'interrompt jamais.
  }
}

/**
 * Récupère la session active pour une conversation donnée (matching côté
 * inbox agent). Retourne null si aucune session active n'existe.
 */
export async function getActiveSessionForConversation(
  env: Env,
  convId: string,
): Promise<ChatSession | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT id, widget_id, conversation_id, visitor_name, visitor_email,
              page_url, referrer, user_agent, ip_hash,
              started_at, ended_at, last_seen_at, status,
              unread_agent_count, agent_user_id
         FROM webchat_sessions
        WHERE conversation_id = ? AND status = 'active'
        LIMIT 1`
    ).bind(convId).first() as ChatSession | null;
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Met à jour le statut de présence d'un agent + propage aux widgets actifs du
 * tenant. Phase actuelle : audit log seulement (best-effort).
 * TODO future : broadcast WS aux iframes via DO (Sprint suivant).
 */
export async function notifyAgentPresence(
  env: Env,
  widgetId: string,
  status: 'online' | 'away' | 'offline',
): Promise<void> {
  try {
    await audit(env, 'system', 'chat.presence.update', 'widget', widgetId, { status });
  } catch { /* best-effort */ }
  // TODO Sprint suivant : broadcast WS aux iframes via env.WEBCHAT_ROOMS DO.
}

/**
 * Broadcast un évènement "typing" via le Durable Object WebchatRoom
 * (room id = conversation_id, déjà géré par src/worker/webchat.ts). Phase
 * actuelle : audit log seulement (best-effort).
 * TODO future : POST interne au DO (/typing) pour propager aux WS connectés.
 */
export async function broadcastTyping(
  env: Env,
  conversationId: string,
  sender: 'visitor' | 'agent',
): Promise<void> {
  try {
    await audit(env, 'system', 'chat.typing.broadcast', 'conversation', conversationId, { sender });
  } catch { /* best-effort */ }
  // TODO Sprint suivant : forward au DO via env.WEBCHAT_ROOMS.get(idFromName(conversationId)).
}
