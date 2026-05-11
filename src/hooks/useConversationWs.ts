import { useEffect, useRef, useState, useCallback } from 'react';
import type { Message } from '@/lib/types';

export function useConversationWs(conversationId: string | null, channel: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const ws = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (!conversationId || channel !== 'webchat') return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Le port 5174 est le port dev. En prod c'est le domaine courant.
    const baseUrl = import.meta.env.DEV ? `ws://localhost:5174` : `${protocol}//${window.location.host}`;
    
    // Auth user name pour l'agent
    const authDataStr = localStorage.getItem('intralys_auth');
    let agentName = 'Agent Intralys';
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        if (authData.user && authData.user.name) agentName = authData.user.name;
      } catch { /* */ }
    }

    const url = `${baseUrl}/api/webchat/ws?conversation_id=${conversationId}&role=agent&name=${encodeURIComponent(agentName)}`;
    ws.current = new WebSocket(url);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'history') {
        // Optionnel : ne pas écraser si l'API REST a déjà chargé l'historique
        // setMessages(data.messages);
      } else if (data.type === 'message' || data.type === 'system') {
        // Transformer au format Message
        const newMsg: Message = {
          id: crypto.randomUUID(),
          lead_id: '',
          client_id: '',
          conversation_id: conversationId || '',
          direction: data.sender === 'visitor' ? 'inbound' : 'outbound',
          channel: 'webchat',
          subject: '',
          body: data.body,
          status: 'delivered',
          sent_by: data.sender === 'agent' ? 'me' : '',
          external_id: '',
          metadata: '',
          created_at: data.timestamp,
          sender_name: data.name
        };
        setMessages((prev) => [...prev, newMsg]);
      }
    };

    ws.current.onclose = () => {
      // Reconnexion auto si la conversation est toujours active
      setTimeout(() => {
        if (ws.current?.readyState === WebSocket.CLOSED) {
          connect();
        }
      }, 3000);
    };

  }, [conversationId, channel]);

  useEffect(() => {
    setMessages([]);
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    
    if (channel === 'webchat') {
      connect();
    }

    return () => {
      if (ws.current) {
        ws.current.close();
        ws.current = null;
      }
    };
  }, [conversationId, channel, connect]);

  const sendMessage = useCallback((text: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ body: text }));
      return true;
    }
    return false;
  }, []);

  return { wsMessages: messages, sendWsMessage: sendMessage };
}
