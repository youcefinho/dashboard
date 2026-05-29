import type { Env } from '../types';
import { searchKbRag } from './kb-rag-engine';
import { runBotInference } from './chat-bot-engine';
import { createNotification } from '../helpers';

/**
 * Traite le message d'un visiteur avec le chatbot IA.
 * Si le bot répond, il persiste la réponse et la diffuse.
 * Si le bot doit escalader, il bascule la session en mode humain et notifie les administrateurs.
 */
export async function processBotReply(
  env: Env,
  clientId: string,
  sessionId: string,
  messageBody: string,
  sendMessage?: (msg: { body: string; sender: 'agent'; name: string }) => void
): Promise<void> {
  try {
    // 1. Charger la config chatbot du client
    const botConfig = await env.DB.prepare(
      `SELECT enabled, system_prompt, confidence_threshold, escalation_message, max_messages_per_session
       FROM chat_bot_config
       WHERE client_id = ?
       LIMIT 1`
    ).bind(clientId).first() as {
      enabled: number;
      system_prompt: string;
      confidence_threshold: number;
      escalation_message: string;
      max_messages_per_session: number;
    } | null;

    // Si le bot n'est pas activé ou n'existe pas, on sort silencieusement
    if (!botConfig || botConfig.enabled !== 1) {
      return;
    }

    // 2. Charger la session de chat
    const webchatSession = await env.DB.prepare(
      `SELECT id, conversation_id, bot_handled, bot_messages_count
       FROM webchat_sessions
       WHERE id = ?
       LIMIT 1`
    ).bind(sessionId).first() as {
      id: string;
      conversation_id: string;
      bot_handled: number;
      bot_messages_count: number;
    } | null;

    // Si pas de session, ou si elle n'est plus gérée par le bot (bot_handled = 0), on s'arrête
    if (!webchatSession || webchatSession.bot_handled !== 1) {
      return;
    }

    const conversationId = webchatSession.conversation_id;

    // 3. Charger l'historique récent de la conversation
    const maxMsgs = botConfig.max_messages_per_session || 20;
    const recentMessages = await env.DB.prepare(
      `SELECT direction, body, sent_by
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(conversationId, maxMsgs).all();

    const messagesList = (recentMessages.results || []).reverse() as Array<{
      direction: 'inbound' | 'outbound';
      body: string;
      sent_by: string;
    }>;

    // Vérifier si le cap de messages max par session a été dépassé
    if (webchatSession.bot_messages_count >= maxMsgs) {
      // Escalade forcée automatique
      await forceEscaladeSession(
        env,
        clientId,
        sessionId,
        conversationId,
        botConfig.escalation_message,
        'max_messages_reached',
        0,
        sendMessage
      );
      return;
    }

    // 4. Détecter si on doit forcer une escalade par mot-clé
    const lastUserMessage = messageBody.trim().toLowerCase();
    const ESCALATION_KEYWORDS = [
      'humain', 'agent', 'personne réelle', "parler à quelqu'un", 'vrai conseiller', 'pas un robot', 'support',
      'human', 'real person', 'speak to', 'live agent', 'not a robot', 'humano', 'persona', 'agente', 'hablar con'
    ];
    const containsEscalationKeyword = ESCALATION_KEYWORDS.some(kw => lastUserMessage.includes(kw));

    if (containsEscalationKeyword) {
      await forceEscaladeSession(
        env,
        clientId,
        sessionId,
        conversationId,
        botConfig.escalation_message,
        'escalation_keyword',
        1.0,
        sendMessage
      );
      return;
    }

    // 5. Interroger la base vectorielle via RAG
    const hits = await searchKbRag(env, clientId, messageBody, 3);
    const ragContext = hits.map(h => `[Source: ${h.source_title}] ${h.text_chunk}`).join('\n\n');

    // 6. Construire le prompt système et contextuel
    const systemPrompt = botConfig.system_prompt || 'You are a helpful assistant.';
    const formattedPrompt = `${systemPrompt}\n\nContexte de la base de connaissances :\n${ragContext || 'Aucune information disponible.'}\n\nHistorique récent :\n${
      messagesList.map(m => `${m.direction === 'inbound' ? 'Visiteur' : 'Agent'}: ${m.body}`).join('\n')
    }\n\nVisiteur: ${messageBody}\nAssistant:`;

    // 7. Lancer l'inférence
    let botResponse = '';
    let confidence = 0;
    try {
      const inference = await runBotInference(env, formattedPrompt);
      botResponse = inference.response || '';
      confidence = inference.confidence || 0;
    } catch (err) {
      console.error('[Chatbot Bridge] Erreur lors de l\'inférence du robot:', err);
      await forceEscaladeSession(
        env,
        clientId,
        sessionId,
        conversationId,
        botConfig.escalation_message,
        'inference_error',
        0,
        sendMessage
      );
      return;
    }

    // Vérifier si la confiance est insuffisante
    const threshold = botConfig.confidence_threshold ?? 0.5;
    if (confidence < threshold) {
      await forceEscaladeSession(
        env,
        clientId,
        sessionId,
        conversationId,
        botConfig.escalation_message,
        'low_confidence',
        confidence,
        sendMessage
      );
      return;
    }

    // 8. Répondre avec succès
    const botMsgId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, body, status, sent_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(botMsgId, '', clientId, conversationId, 'outbound', 'webchat', botResponse, 'delivered', 'Chatbot').run();

    // Incrémenter bot_messages_count et mettre à jour last_seen_at
    await env.DB.prepare(
      `UPDATE webchat_sessions
       SET bot_messages_count = bot_messages_count + 1,
           started_at = COALESCE(started_at, datetime('now'))
       WHERE id = ?`
    ).bind(sessionId).run();

    // Mettre à jour la conversation
    await env.DB.prepare(
      `UPDATE conversations
       SET last_message_at = datetime('now'),
           last_message_preview = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).bind(botResponse.substring(0, 120), conversationId).run();

    // Diffuser la réponse
    if (sendMessage) {
      sendMessage({
        body: botResponse,
        sender: 'agent',
        name: 'Chatbot'
      });
    }

    // Mettre à jour ou créer la session chatbot (active)
    await upsertChatbotSession(env, clientId, sessionId, 1, confidence);

  } catch (err) {
    console.error('[Chatbot Bridge] Erreur générale dans processBotReply:', err);
  }
}

/** Helper pour forcer l'escalade d'une session */
async function forceEscaladeSession(
  env: Env,
  clientId: string,
  sessionId: string,
  conversationId: string,
  configEscMessage: string,
  reason: string,
  confidence: number,
  sendMessage?: (msg: { body: string; sender: 'agent'; name: string }) => void
): Promise<void> {
  // Mode escalade : bot_handled = 0
  await env.DB.prepare(
    `UPDATE webchat_sessions
     SET bot_handled = 0
     WHERE id = ?`
  ).bind(sessionId).run();

  // Insérer le message d'escalation
  const escMsgId = crypto.randomUUID();
  const escMsg = configEscMessage || 'Un conseiller va vous répondre sous peu.';
  
  await env.DB.prepare(
    `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, body, status, sent_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(escMsgId, '', clientId, conversationId, 'outbound', 'webchat', escMsg, 'delivered', 'Système').run();

  // Mettre à jour la conversation
  await env.DB.prepare(
    `UPDATE conversations
     SET last_message_at = datetime('now'),
         last_message_preview = ?,
         unread_count = unread_count + 1,
         updated_at = datetime('now')
     WHERE id = ?`
  ).bind(escMsg.substring(0, 120), conversationId).run();

  // Notifier les administrateurs
  try {
    const { results: admins } = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
    ).all();
    for (const admin of (admins || []) as Array<{ id: string }>) {
      await createNotification(
        env,
        admin.id,
        '🚨 Escalade Chatbot',
        `La conversation avec le visiteur a été escaladée (Raison: ${reason}).`,
        '🚨',
        `/conversations`,
        clientId
      );
    }
  } catch (err) {
    console.error('[Chatbot Bridge] Erreur lors de la notification aux administrateurs:', err);
  }

  // Diffuser le message d'escalade
  if (sendMessage) {
    sendMessage({
      body: escMsg,
      sender: 'agent',
      name: 'Système'
    });
  }

  // Mettre à jour ou créer la session chatbot (inactive)
  await upsertChatbotSession(env, clientId, sessionId, 0, confidence);
}

/** Helper pour créer ou mettre à jour une chatbot_session */
async function upsertChatbotSession(
  env: Env,
  clientId: string,
  sessionId: string,
  isActive: number,
  confidence: number
): Promise<void> {
  try {
    const existing = await env.DB.prepare(
      `SELECT id, confidence_avg FROM chatbot_sessions WHERE session_token = ? LIMIT 1`
    ).bind(sessionId).first() as { id: string; confidence_avg: number } | null;

    if (existing) {
      const newAvg = existing.confidence_avg > 0
        ? (existing.confidence_avg + confidence) / 2
        : confidence;

      await env.DB.prepare(
        `UPDATE chatbot_sessions
         SET is_active = ?, confidence_avg = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(isActive, newAvg, existing.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO chatbot_sessions (session_token, is_active, confidence_avg, client_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(sessionId, isActive, confidence, clientId).run();
    }
  } catch (err) {
    console.error('[Chatbot Bridge] Erreur lors de l\'upsert de la session chatbot:', err);
  }
}
