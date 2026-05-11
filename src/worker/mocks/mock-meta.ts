// ── Module Mock Meta — Intralys CRM ─────────────────────────
import type { Env } from '../types';
import { findOrCreateConversation } from '../conversations';

export async function mockMetaSendMessage(env: Env, leadId: string, clientId: string, message: string, platform: 'facebook' | 'instagram', authUserId: string) {
  console.log(`[MOCK META] Envoi message via ${platform} au lead ${leadId} : "${message}"`);
  
  // Créer ou trouver la conversation
  const convId = await findOrCreateConversation(env, leadId, clientId, platform);
  
  // Insérer le message en statut mock-sent
  await env.DB.prepare(
    `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, body, status, sent_by, external_id)
     VALUES (?, ?, ?, ?, 'outbound', ?, ?, 'mock-sent', ?, ?)`
  ).bind(
    crypto.randomUUID(), leadId, clientId, convId, platform, message, authUserId, 'mock-meta-' + Date.now()
  ).run();
  
  // Mettre à jour la conversation
  await env.DB.prepare(
    `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(message.substring(0, 120), convId).run();
  
  return { success: true, message_id: 'mock-msg-' + Date.now() };
}

export async function mockMetaWebhookInbound(env: Env, clientId: string, platform: 'facebook' | 'instagram', senderPsid: string, messageText: string, senderName: string = 'User') {
  console.log(`[MOCK META WEBHOOK] Message reçu de ${senderName} (${senderPsid}) via ${platform} : "${messageText}"`);
  
  // Pour le mock, on crée un lead s'il n'existe pas ou on prend un existant
  const existing = await env.DB.prepare(`SELECT id FROM leads WHERE client_id = ? AND source = ? AND external_id = ?`)
    .bind(clientId, platform, senderPsid).first();
    
  let leadId = existing?.id as string;
  if (!leadId) {
    leadId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO leads (id, client_id, name, source, type, status, external_id)
       VALUES (?, ?, ?, ?, 'buy', 'new', ?)`
    ).bind(leadId, clientId, senderName, platform, senderPsid).run();
  }
  
  const convId = await findOrCreateConversation(env, leadId, clientId, platform);
  
  await env.DB.prepare(
    `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, body, status, external_id)
     VALUES (?, ?, ?, ?, 'inbound', ?, ?, 'delivered', ?)`
  ).bind(
    crypto.randomUUID(), leadId, clientId, convId, platform, messageText, 'mock-inbound-' + Date.now()
  ).run();
  
  await env.DB.prepare(
    `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, unread_count = unread_count + 1, updated_at = datetime('now') WHERE id = ?`
  ).bind(messageText.substring(0, 120), convId).run();
  
  return { success: true };
}
