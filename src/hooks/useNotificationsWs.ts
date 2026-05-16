// ── useNotificationsWs — Real-time notifications via WebSocket (Sprint 46 M3.4) ──
// Pattern Sprint 27 `useConversationWs` étendu :
//   - connect `/api/notifications/ws` avec token Bearer (query param)
//   - on message → push dans store local + Toast inline + announceSR polite
//   - reconnect exponential backoff (1s, 2s, 4s, 8s, max 15s)
//   - cleanup propre au unmount
//
// Le hook NE remplace PAS le polling REST 30s d'AppLayout (`getNotifications`).
// Les deux coexistent : REST pour boot/refresh manuel, WS pour push live.
// Côté worker, broadcast quand createNotification s'exécute (lead created /
// task assigned / message received / etc.) — voir M3.4 worker.ts.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { NotificationItem } from '@/lib/api';
import { announceSR } from '@/lib/announce';

export type NotifWsStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed';

interface UseNotificationsWsOptions {
  /** Token Bearer (forwarded en query param car WS n'autorise pas headers custom) */
  token: string | null;
  /** Callback à chaque nouvelle notif reçue (AppLayout push dans son store) */
  onNotification?: (notif: NotificationItem) => void;
  /** Active/désactive la connexion (ex: false si user pas loggé) */
  enabled?: boolean;
}

interface UseNotificationsWsResult {
  status: NotifWsStatus;
  /** Dernière notif reçue (utile pour wirer Toast sans callback) */
  lastNotification: NotificationItem | null;
  /** Force reconnexion (utile au retour online) */
  reconnect: () => void;
}

const MAX_RECONNECT_DELAY_MS = 15_000;
const BASE_RECONNECT_DELAY_MS = 1_000;

export function useNotificationsWs(
  options: UseNotificationsWsOptions,
): UseNotificationsWsResult {
  const { token, onNotification, enabled = true } = options;
  const [status, setStatus] = useState<NotifWsStatus>('idle');
  const [lastNotification, setLastNotification] =
    useState<NotificationItem | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const isUnmountingRef = useRef(false);
  // Bind callback latest sans déclencher reconnexion à chaque render
  const onNotificationRef = useRef(onNotification);
  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  const cleanupWs = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !token) {
      setStatus('idle');
      return;
    }

    // Si déjà connecté/connecting, skip
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const baseUrl = import.meta.env.DEV
      ? `ws://localhost:5174`
      : `${protocol}//${window.location.host}`;
    const url = `${baseUrl}/api/notifications/ws?token=${encodeURIComponent(token)}`;

    setStatus(reconnectAttemptsRef.current === 0 ? 'connecting' : 'reconnecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // Erreur immédiate → reschedule
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as
          | { type: 'notification'; notification: NotificationItem }
          | { type: 'ping' }
          | { type: 'hello'; user_id: string };

        if (data.type === 'notification' && data.notification) {
          const notif = data.notification;
          setLastNotification(notif);
          onNotificationRef.current?.(notif);
          // Annonce SR polite (non-bloquante)
          announceSR(
            `Nouvelle notification : ${notif.title}`,
            'polite',
          );
        }
        // Type 'ping' et 'hello' ignorés silencieusement (keep-alive)
      } catch {
        /* malformed message, swallow */
      }
    };

    ws.onclose = () => {
      if (isUnmountingRef.current) return;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose sera appelé juste après → reconnect schedule là
      setStatus('closed');
    };
  }, [enabled, token]);

  const scheduleReconnect = useCallback(() => {
    if (isUnmountingRef.current || !enabled || !token) {
      setStatus('closed');
      return;
    }
    reconnectAttemptsRef.current += 1;
    // Exponential backoff : 1s, 2s, 4s, 8s, max 15s
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** (reconnectAttemptsRef.current - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    setStatus('reconnecting');
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [connect, enabled, token]);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    cleanupWs();
    connect();
  }, [cleanupWs, connect]);

  useEffect(() => {
    isUnmountingRef.current = false;
    if (enabled && token) {
      connect();
    }
    return () => {
      isUnmountingRef.current = true;
      cleanupWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token]);

  return { status, lastNotification, reconnect };
}
