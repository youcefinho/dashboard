import { useEffect, useRef, useState, useCallback } from 'react';
import type { Message } from '@/lib/types';

export type WsStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export function useConversationWs(conversationId: string | null, channel: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<WsStatus>('idle');
  const ws = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    if (!conversationId || channel !== 'webchat') {
      setStatus('idle');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const baseUrl = import.meta.env.DEV ? `ws://localhost:5174` : `${protocol}//${window.location.host}`;

    const authDataStr = localStorage.getItem('intralys_auth');
    let agentName = 'Agent Intralys';
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        if (authData.user && authData.user.name) agentName = authData.user.name;
      } catch { /* */ }
    }

    setStatus(reconnectAttempts.current === 0 ? 'connecting' : 'reconnecting');
    const url = `${baseUrl}/api/webchat/ws?conversation_id=${conversationId}&role=agent&name=${encodeURIComponent(agentName)}`;
    ws.current = new WebSocket(url);

    ws.current.onopen = () => {
      reconnectAttempts.current = 0;
      setStatus('connected');
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'history') {
        // Optionnel : ne pas écraser si l'API REST a déjà chargé l'historique
      } else if (data.type === 'message' || data.type === 'system') {
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
      setStatus('closed');
      // Reconnexion auto avec backoff si la conversation est toujours active
      reconnectAttempts.current += 1;
      const delay = Math.min(3000 * reconnectAttempts.current, 15000);
      setTimeout(() => {
        if (ws.current?.readyState === WebSocket.CLOSED) {
          connect();
        }
      }, delay);
    };

  }, [conversationId, channel]);

  useEffect(() => {
    setMessages([]);
    reconnectAttempts.current = 0;
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    if (channel === 'webchat') {
      connect();
    } else {
      setStatus('idle');
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

  return { wsMessages: messages, sendWsMessage: sendMessage, wsStatus: status };
}
