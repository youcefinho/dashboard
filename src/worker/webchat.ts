// ── Module Webchat — Intralys CRM ───────────────────────────
// Durable Object WebSocket pour chat bidirectionnel en temps réel
import type { Env } from './types';
import { sanitizeInput, json, createNotification } from './helpers';
import { findOrCreateConversation } from './conversations';

// ── Types webchat ───────────────────────────────────────────

interface ChatMessage {
  type: 'message' | 'system' | 'typing';
  sender: 'visitor' | 'agent';
  name: string;
  body: string;
  timestamp: string;
}

interface PrechatData {
  name: string;
  email: string;
  clientId: string;
}

// ── WebchatRoom Durable Object ──────────────────────────────

export class WebchatRoom {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Map<WebSocket, { role: 'visitor' | 'agent'; name: string }> = new Map();
  private prechat: PrechatData | null = null;
  private messages: ChatMessage[] = [];

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // Charger les données persistées
    this.state.blockConcurrencyWhile(async () => {
      this.prechat = await this.state.storage.get<PrechatData>('prechat') || null;
      this.messages = await this.state.storage.get<ChatMessage[]>('messages') || [];
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Upgrade WebSocket
    if (request.headers.get('Upgrade') === 'websocket') {
      const role = url.searchParams.get('role') as 'visitor' | 'agent' || 'visitor';
      const name = url.searchParams.get('name') || (role === 'agent' ? 'Agent' : 'Visiteur');

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      this.state.acceptWebSocket(server);
      this.sessions.set(server, { role, name });

      // Envoyer l'historique au nouveau connecté
      server.send(JSON.stringify({ type: 'history', messages: this.messages.slice(-50) }));

      // Notifier les autres
      this.broadcast({
        type: 'system',
        sender: role,
        name,
        body: `${name} a rejoint le chat`,
        timestamp: new Date().toISOString(),
      }, server);

      return new Response(null, { status: 101, webSocket: client });
    }

    // REST API — obtenir info sur la room
    if (url.pathname.endsWith('/info')) {
      return new Response(JSON.stringify({
        prechat: this.prechat,
        messageCount: this.messages.length,
        activeSessions: this.sessions.size,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // REST API — set prechat data
    if (request.method === 'POST' && url.pathname.endsWith('/prechat')) {
      const data = await request.json() as PrechatData;
      this.prechat = data;
      await this.state.storage.put('prechat', data);
      return new Response(JSON.stringify({ ok: true }));
    }

    return new Response('Not Found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const session = this.sessions.get(ws);
    if (!session) return;

    const data = JSON.parse(typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage)) as { body?: string; type?: string };

    if (data.type === 'typing') {
      this.broadcast({
        type: 'typing',
        sender: session.role,
        name: session.name,
        body: '',
        timestamp: new Date().toISOString(),
      }, ws);
      return;
    }

    if (!data.body) return;

    const msg: ChatMessage = {
      type: 'message',
      sender: session.role,
      name: session.name,
      body: sanitizeInput(data.body, 2000),
      timestamp: new Date().toISOString(),
    };

    this.messages.push(msg);
    await this.state.storage.put('messages', this.messages);

    // Broadcast à tous (y compris l'émetteur pour confirmation)
    for (const [client] of this.sessions) {
      try { client.send(JSON.stringify(msg)); } catch { /* connexion fermée */ }
    }

    // Persister le message dans D1 si on a le prechat
    if (this.prechat) {
      try {
        // Trouver le lead par email
        const lead = await this.env.DB.prepare(
          'SELECT id, client_id FROM leads WHERE LOWER(email) = ?'
        ).bind(this.prechat.email.toLowerCase()).first() as { id: string; client_id: string } | null;

        if (lead) {
          // Trouver ou créer la conversation webchat
          const convId = await findOrCreateConversation(this.env, lead.id, lead.client_id, 'webchat');

          await this.env.DB.prepare(
            `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, body, status, sent_by)
             VALUES (?, ?, ?, ?, ?, 'webchat', ?, 'delivered', ?)`
          ).bind(
            crypto.randomUUID(), lead.id, lead.client_id, convId,
            session.role === 'visitor' ? 'inbound' : 'outbound',
            msg.body, session.name
          ).run();

          // Mettre à jour la conversation
          await this.env.DB.prepare(
            `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, unread_count = unread_count + ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(msg.body.substring(0, 120), session.role === 'visitor' ? 1 : 0, convId).run();

          // Notifier les agents si message du visiteur
          if (session.role === 'visitor') {
            const { results: admins } = await this.env.DB.prepare(
              "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
            ).all();
            for (const admin of (admins || []) as Array<{ id: string }>) {
              await createNotification(
                this.env, admin.id, '💬 Webchat',
                `${session.name}: "${msg.body.substring(0, 80)}"`,
                '💬', `/conversations`, lead.client_id
              );
            }
          }
        }
      } catch (err) {
        console.error('Erreur persistance webchat message:', err);
      }
    }

    // Mettre un alarm pour cleanup après 24h
    await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const session = this.sessions.get(ws);
    if (session) {
      this.broadcast({
        type: 'system',
        sender: session.role,
        name: session.name,
        body: `${session.name} a quitté le chat`,
        timestamp: new Date().toISOString(),
      }, ws);
    }
    this.sessions.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  async alarm(): Promise<void> {
    // Cleanup si aucune session active et pas de message récent
    if (this.sessions.size === 0 && this.messages.length > 0) {
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg) {
        const lastTime = new Date(lastMsg.timestamp).getTime();
        if (Date.now() - lastTime > 24 * 60 * 60 * 1000) {
          // Archiver et nettoyer
          await this.state.storage.deleteAll();
          this.messages = [];
          this.prechat = null;
        }
      }
    }
  }

  private broadcast(msg: ChatMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(msg);
    for (const [ws] of this.sessions) {
      if (ws !== exclude) {
        try { ws.send(data); } catch { /* connexion fermée */ }
      }
    }
  }
}

// ── API Routes (appelées depuis worker.ts) ──────────────────

export async function handleWebchatConnect(
  request: Request, env: Env, url: URL
): Promise<Response> {
  // Créer ou rejoindre une room par conversation_id
  const conversationId = url.searchParams.get('conversation_id') || crypto.randomUUID();
  const roomId = env.WEBCHAT_ROOMS.idFromName(conversationId);
  const room = env.WEBCHAT_ROOMS.get(roomId);
  return room.fetch(request);
}

export async function handleWebchatPrechat(
  request: Request, env: Env
): Promise<Response> {
  const body = await request.json() as { conversation_id: string; name: string; email: string; client_id: string };
  if (!body.name || !body.email) return json({ error: 'Nom et email requis' }, 400);

  const conversationId = body.conversation_id || crypto.randomUUID();
  const roomId = env.WEBCHAT_ROOMS.idFromName(conversationId);
  const room = env.WEBCHAT_ROOMS.get(roomId);

  // Envoyer les données prechat au DO
  await room.fetch(new Request(`https://internal/prechat`, {
    method: 'POST',
    body: JSON.stringify({ name: body.name, email: body.email, clientId: body.client_id }),
  }));

  // Auto-créer le lead s'il n'existe pas
  const existing = await env.DB.prepare(
    'SELECT id FROM leads WHERE LOWER(email) = ?'
  ).bind(body.email.toLowerCase()).first();

  let leadId = existing?.id as string;
  if (!leadId) {
    leadId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO leads (id, client_id, name, email, source, type, status)
       VALUES (?, ?, ?, ?, 'webchat', 'inbound', 'new')`
    ).bind(leadId, body.client_id || '', sanitizeInput(body.name, 200), body.email.toLowerCase()).run();
  }

  return json({ data: { conversation_id: conversationId, lead_id: leadId } });
}

// ── Widget JS embeddable ────────────────────────────────────

export function handleWebchatWidget(_env: Env, url: URL): Response {
  const clientId = url.searchParams.get('client_id') || '';
  const origin = url.origin;

  // Script JS auto-exécutable qui injecte le widget webchat
  const script = `
(function() {
  if (window.__intralys_webchat) return;
  window.__intralys_webchat = true;

  var clientId = '${clientId}';
  var apiBase = '${origin}';
  var convId = localStorage.getItem('intralys_conv_' + clientId) || '';
  var wsUrl = apiBase.replace('https://', 'wss://').replace('http://', 'ws://') + '/api/webchat/ws?conversation_id=' + convId;

  // Styles
  var style = document.createElement('style');
  style.textContent = \`
    #intralys-chat-bubble { position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; cursor: pointer; font-size: 24px; box-shadow: 0 4px 20px rgba(99,102,241,0.4); z-index: 99999; transition: transform 0.2s; display: flex; align-items: center; justify-content: center; }
    #intralys-chat-bubble:hover { transform: scale(1.1); }
    #intralys-chat-window { position: fixed; bottom: 90px; right: 20px; width: 380px; max-height: 520px; background: #1a1a2e; border-radius: 16px; box-shadow: 0 8px 40px rgba(0,0,0,0.3); z-index: 99999; display: none; flex-direction: column; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #intralys-chat-header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 16px; color: white; display: flex; justify-content: space-between; align-items: center; }
    #intralys-chat-messages { flex: 1; overflow-y: auto; padding: 12px; min-height: 300px; max-height: 350px; }
    .intralys-msg { margin: 6px 0; padding: 8px 12px; border-radius: 12px; max-width: 80%; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
    .intralys-msg-visitor { background: #6366f1; color: white; margin-left: auto; border-bottom-right-radius: 4px; }
    .intralys-msg-agent { background: #2a2a4a; color: #e0e0e0; border-bottom-left-radius: 4px; }
    #intralys-chat-input-area { padding: 12px; border-top: 1px solid #2a2a4a; display: flex; gap: 8px; }
    #intralys-chat-input { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #3a3a5a; background: #2a2a4a; color: white; font-size: 14px; outline: none; }
    #intralys-chat-send { background: #6366f1; color: white; border: none; border-radius: 8px; padding: 10px 16px; cursor: pointer; font-size: 14px; }
    #intralys-prechat { padding: 20px; }
    #intralys-prechat input { width: 100%; padding: 10px; margin: 6px 0; border-radius: 8px; border: 1px solid #3a3a5a; background: #2a2a4a; color: white; font-size: 14px; box-sizing: border-box; }
    #intralys-prechat button { width: 100%; padding: 12px; margin-top: 10px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  \`;
  document.head.appendChild(style);

  // Bubble
  var bubble = document.createElement('button');
  bubble.id = 'intralys-chat-bubble';
  bubble.innerHTML = '💬';
  document.body.appendChild(bubble);

  // Window
  var win = document.createElement('div');
  win.id = 'intralys-chat-window';
  win.innerHTML = '<div id="intralys-chat-header"><span>💬 Chat en direct</span><button onclick="document.getElementById(\\'intralys-chat-window\\').style.display=\\'none\\'" style="background:none;border:none;color:white;font-size:18px;cursor:pointer">✕</button></div><div id="intralys-prechat"><p style="color:#ccc;margin-bottom:12px">Avant de commencer, dites-nous qui vous êtes :</p><input id="intralys-name" placeholder="Votre nom" /><input id="intralys-email" type="email" placeholder="Votre email" /><button id="intralys-start">Démarrer le chat</button></div>';
  document.body.appendChild(win);

  bubble.onclick = function() {
    win.style.display = win.style.display === 'flex' ? 'none' : 'flex';
  };

  document.getElementById('intralys-start').onclick = function() {
    var name = document.getElementById('intralys-name').value.trim();
    var email = document.getElementById('intralys-email').value.trim();
    if (!name || !email) return;

    fetch(apiBase + '/api/webchat/prechat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, client_id: clientId, conversation_id: convId })
    }).then(function(r) { return r.json(); }).then(function(data) {
      convId = data.data.conversation_id;
      localStorage.setItem('intralys_conv_' + clientId, convId);

      // Remplacer prechat par chat
      document.getElementById('intralys-prechat').outerHTML = '<div id="intralys-chat-messages"></div><div id="intralys-chat-input-area"><input id="intralys-chat-input" placeholder="Écrivez un message..." /><button id="intralys-chat-send">→</button></div>';

      // Connecter WebSocket
      var ws = new WebSocket(apiBase.replace('https://', 'wss://').replace('http://', 'ws://') + '/api/webchat/ws?conversation_id=' + convId + '&role=visitor&name=' + encodeURIComponent(name));
      var msgs = document.getElementById('intralys-chat-messages');

      ws.onmessage = function(e) {
        var data = JSON.parse(e.data);
        if (data.type === 'history') {
          data.messages.forEach(function(m) { addMsg(m); });
        } else if (data.type === 'message') {
          addMsg(data);
        }
      };

      function addMsg(m) {
        var div = document.createElement('div');
        div.className = 'intralys-msg intralys-msg-' + m.sender;
        div.textContent = m.body;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
      }

      function send() {
        var input = document.getElementById('intralys-chat-input');
        if (input.value.trim()) {
          ws.send(JSON.stringify({ body: input.value.trim() }));
          input.value = '';
        }
      }

      document.getElementById('intralys-chat-send').onclick = send;
      document.getElementById('intralys-chat-input').onkeydown = function(e) { if (e.key === 'Enter') send(); };
    });
  };
})();
`;

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
