import type { Env } from './types';
import { clampPreview } from './lib/conversation-engine';

export async function processScheduledMessages(env: Env): Promise<void> {
  const now = new Date().toISOString();
  
  // 1. Récupérer les messages planifiés échus
  const { results } = await env.DB.prepare(
    `SELECT * FROM scheduled_messages 
     WHERE status = 'pending' AND scheduled_at <= ? 
     LIMIT 50`
  ).bind(now).all();
  
  if (!results || results.length === 0) return;
  
  for (const row of results as any[]) {
    // Passer le statut à 'processing' pour éviter les doubles envois
    await env.DB.prepare(
      `UPDATE scheduled_messages SET status = 'processing' WHERE id = ?`
    ).bind(row.id).run();
    
    try {
      const messageId = crypto.randomUUID();
      let status = 'sent';
      
      if (row.channel === 'internal_note') {
        status = 'delivered';
      }
      
      // Ici, on insère dans la table `messages`
      await env.DB.prepare(
        `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, subject, body, status, sent_by)
         VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?)`
      ).bind(
        messageId, row.lead_id, row.client_id,
        row.conversation_id, row.channel, row.subject || '', row.body, status, row.sent_by
      ).run();
      
      // Mettre à jour la conversation
      const preview = clampPreview(row.body);
      await env.DB.prepare(
        `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(preview, row.conversation_id).run();
      
      // Mettre à jour le statut du message programmé à 'sent'
      await env.DB.prepare(
        `UPDATE scheduled_messages SET status = 'sent' WHERE id = ?`
      ).bind(row.id).run();
      
      // Log d'activité
      const actionType = row.channel === 'email' ? 'email_sent' : row.channel === 'sms' ? 'sms_sent' : 'note_added';
      await env.DB.prepare(
        'INSERT INTO activity_log (lead_id, client_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)'
      ).bind(
        row.lead_id, row.client_id, row.sent_by, actionType,
        JSON.stringify({ channel: row.channel, conversation_id: row.conversation_id, message_id: messageId })
      ).run();
      
    } catch (err) {
      console.error(`Failed to process scheduled message ${row.id}:`, err);
      await env.DB.prepare(
        `UPDATE scheduled_messages SET status = 'failed' WHERE id = ?`
      ).bind(row.id).run();
    }
  }
}
