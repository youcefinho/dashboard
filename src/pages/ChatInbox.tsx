// ── ChatInbox — Sprint 36 (Agent B2) ─────────────────────────────────────────
// Page STANDALONE routée `/chat-inbox` — boîte de réception live chat.
// Layout 3 colonnes desktop / pile mobile :
//   • Gauche  : liste sessions actives (agrégées sur tous les widgets actifs).
//   • Centre  : transcript de la session sélectionnée + composer agent.
//   • Droite  : meta visiteur (email, page_url, referrer, user_agent, ip_hash).
//
// Realtime :
//   • WebSocket par session (wss://${origin}/api/webchat/ws?conversation_id=…
//     &role=agent&token=${auth_token}) ; fallback POST si WS fermé.
//   • Heartbeat presence agent : setInterval 30s → postChatPresenceHeartbeat.
//     Au mount → 'online'. Au unmount → 'offline' + clear interval.
//   • Typing indicator : message {type:'typing'} → bulle "écrit…" pendant 3s.
//
// Style Stripe-clean, toutes les chaînes via t(), aria-labels i18n.
// N'intègre PAS dans Inbox.tsx (sépare-toi : page autonome).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { MessageCircle, Send, Wifi, WifiOff } from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { PageHero } from '../components/ui/PageHero';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Icon } from '../components/ui/Icon';
import {
  getChatWidgets,
  getChatWidgetSessions,
  getChatSessionDetail,
  postChatPresenceHeartbeat,
  type ChatWidget,
  type ChatSession,
  type ChatSessionDetail,
  type ChatAgentPresenceStatus,
} from '../lib/api';
import { t } from '../lib/i18n';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Temps relatif compact ("il y a 5 min", "il y a 2 h", "hier").
 * Local-only (Intl.RelativeTimeFormat) — pas d'i18n.
 */
function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = Date.now();
  const diffSec = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  try {
    const rtf = new Intl.RelativeTimeFormat('fr-CA', { numeric: 'auto' });
    if (abs < 60) return rtf.format(diffSec, 'second');
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    return rtf.format(Math.round(diffSec / 86400), 'day');
  } catch {
    return date.toLocaleString('fr-CA');
  }
}

/**
 * Lit le token JWT depuis localStorage. Aligné sur le reste du dashboard
 * (cf. Inbox.tsx, MagicLinkVerify.tsx). Renvoie '' si absent — le worker
 * rejettera proprement le handshake WS.
 */
function readAuthToken(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem('intralys_token') ?? '';
}

/**
 * Construit l'URL WS pour une session donnée.
 *   • https → wss, http → ws.
 *   • origin = window.location.host (worker Cloudflare derrière même domaine).
 */
function buildWsUrl(conversationId: string, token: string): string {
  const protocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? 'wss:'
      : 'ws:';
  const host =
    typeof window !== 'undefined' ? window.location.host : 'localhost';
  const qs = new URLSearchParams({
    conversation_id: conversationId,
    role: 'agent',
    token,
  });
  return `${protocol}//${host}/api/webchat/ws?${qs.toString()}`;
}

// ── Types internes ──────────────────────────────────────────────────────────

interface TranscriptMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  sent_by: string | null;
  created_at: string;
}

interface SessionRow {
  session: ChatSession;
  widget: ChatWidget;
}

// ── Composant ───────────────────────────────────────────────────────────────

export function ChatInbox() {
  // ── État principal ────────────────────────────────────────────────────────
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [detail, setDetail] = useState<ChatSessionDetail | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);

  const [composer, setComposer] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);

  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [agentStatus, setAgentStatus] =
    useState<ChatAgentPresenceStatus>('online');
  const [visitorTyping, setVisitorTyping] = useState<boolean>(false);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // ── Heartbeat presence (mount → online / 30s / unmount → offline) ─────────
  useEffect(() => {
    // tir initial immédiat
    void postChatPresenceHeartbeat('online');
    heartbeatRef.current = setInterval(() => {
      void postChatPresenceHeartbeat(agentStatus);
    }, 30_000);
    return () => {
      if (heartbeatRef.current !== null) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      void postChatPresenceHeartbeat('offline');
    };
    // dépend uniquement de la valeur courante d'agentStatus à chaque
    // re-render — l'effet recrée l'interval pour propager le statut.
  }, [agentStatus]);

  // ── Charge la liste des sessions actives (toutes widgets is_active=1) ────
  const loadSessions = useCallback(async (): Promise<void> => {
    setIsLoadingList(true);
    setListError(null);
    const widgetsRes = await getChatWidgets();
    if (widgetsRes.error || !widgetsRes.data) {
      setListError(widgetsRes.error ?? t('chat_inbox.error.load_failed'));
      setIsLoadingList(false);
      return;
    }
    const activeWidgets = widgetsRes.data.filter(
      (w) => w.is_active === 1,
    );
    const all: SessionRow[] = [];
    for (const widget of activeWidgets) {
      const sessionsRes = await getChatWidgetSessions(widget.id, {
        status: 'active',
        limit: 50,
      });
      if (sessionsRes.data) {
        for (const session of sessionsRes.data) {
          all.push({ session, widget });
        }
      }
    }
    // tri : non-lus d'abord, puis plus récent
    all.sort((a, b) => {
      const unreadA = a.session.unread_agent_count > 0 ? 1 : 0;
      const unreadB = b.session.unread_agent_count > 0 ? 1 : 0;
      if (unreadA !== unreadB) return unreadB - unreadA;
      return (
        new Date(b.session.started_at).getTime() -
        new Date(a.session.started_at).getTime()
      );
    });
    setRows(all);
    setIsLoadingList(false);
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // ── Charge le détail + ouvre WS quand une session est sélectionnée ────────
  useEffect(() => {
    // cleanup WS précédent
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
    setVisitorTyping(false);

    if (!selected) {
      setDetail(null);
      setMessages([]);
      return;
    }

    // 1. fetch transcript REST
    setIsLoadingDetail(true);
    void (async () => {
      const res = await getChatSessionDetail(
        selected.widget.id,
        selected.session.id,
      );
      if (res.data) {
        setDetail(res.data);
        setMessages(res.data.messages ?? []);
      }
      setIsLoadingDetail(false);
    })();

    // 2. ouvre WS si on a un conversation_id
    const convId = selected.session.conversation_id;
    if (!convId) return;

    const token = readAuthToken();
    const url = buildWsUrl(convId, token);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      // navigateur peut throw si URL invalide — silencieux, fallback REST.
      return;
    }
    wsRef.current = socket;

    socket.onopen = () => {
      setWsConnected(true);
    };
    socket.onclose = () => {
      setWsConnected(false);
    };
    socket.onerror = () => {
      setWsConnected(false);
    };
    socket.onmessage = (event: MessageEvent) => {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!payload || typeof payload !== 'object') return;
      const type = String(payload.type ?? 'message');
      if (type === 'typing') {
        setVisitorTyping(true);
        if (typingTimeoutRef.current !== null) {
          clearTimeout(typingTimeoutRef.current);
        }
        typingTimeoutRef.current = setTimeout(() => {
          setVisitorTyping(false);
          typingTimeoutRef.current = null;
        }, 3_000);
        return;
      }
      if (type === 'message' || type === 'system') {
        const body = String(payload.body ?? '');
        if (!body) return;
        const sender = String(payload.sender ?? 'visitor');
        const direction: TranscriptMessage['direction'] =
          sender === 'agent' ? 'outbound' : 'inbound';
        const msg: TranscriptMessage = {
          id:
            typeof payload.id === 'string'
              ? payload.id
              : `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          direction,
          body,
          sent_by: sender === 'agent' ? 'agent' : null,
          created_at:
            typeof payload.timestamp === 'string'
              ? payload.timestamp
              : new Date().toISOString(),
        };
        setMessages((prev) => [...prev, msg]);
        if (direction === 'inbound') setVisitorTyping(false);
      }
    };

    return () => {
      if (typingTimeoutRef.current !== null) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      socket.close();
      wsRef.current = null;
    };
  }, [selected]);

  // ── Auto-scroll bas du transcript à chaque nouveau message ────────────────
  useEffect(() => {
    const node = transcriptEndRef.current;
    // jsdom n'implémente pas scrollIntoView — guard pour tests.
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // ── Envoi d'un message agent ──────────────────────────────────────────────
  const handleSend = useCallback(
    async (e?: FormEvent<HTMLFormElement>): Promise<void> => {
      if (e) e.preventDefault();
      const body = composer.trim();
      if (!body || !selected) return;
      setIsSending(true);

      // optimistic local
      const optimistic: TranscriptMessage = {
        id: `local-${Date.now()}`,
        direction: 'outbound',
        body,
        sent_by: 'agent',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setComposer('');

      // 1. tente WS
      const socket = wsRef.current;
      let sent = false;
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: 'message', body }));
          sent = true;
        } catch {
          sent = false;
        }
      }

      // 2. fallback REST
      if (!sent) {
        try {
          const token = readAuthToken();
          const res = await fetch(
            `/api/chat-session/${encodeURIComponent(selected.session.id)}/message`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ body }),
            },
          );
          if (!res.ok) {
            // marque le message local comme failed (best-effort)
            setMessages((prev) =>
              prev.map((m) =>
                m.id === optimistic.id
                  ? { ...m, body: `${m.body}  (échec d'envoi)` }
                  : m,
              ),
            );
          }
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === optimistic.id
                ? { ...m, body: `${m.body}  (échec d'envoi)` }
                : m,
            ),
          );
        }
      }

      setIsSending(false);
    },
    [composer, selected],
  );

  // ── Statut presence (toggle online/away/offline) ──────────────────────────
  const cycleStatus = useCallback(() => {
    setAgentStatus((prev) => {
      if (prev === 'online') return 'away';
      if (prev === 'away') return 'offline';
      return 'online';
    });
  }, []);

  const statusLabel = useMemo(() => {
    if (agentStatus === 'online') return t('chat_inbox.online');
    if (agentStatus === 'away') return t('chat_inbox.away');
    return t('chat_inbox.offline');
  }, [agentStatus]);

  const statusIntent: 'success' | 'warning' | 'neutral' =
    agentStatus === 'online'
      ? 'success'
      : agentStatus === 'away'
        ? 'warning'
        : 'neutral';

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout title={t('chat_inbox.title')}>
      <PageHero
        meta="Workspace · Live chat"
        title={t('chat_inbox.title')}
        highlight={t('chat_inbox.title')}
        description={t('chat_inbox.no_session')}
        actions={
          <div className="flex items-center gap-2">
            <Badge
              intent={statusIntent}
              fill="soft"
              dot
              pulse={agentStatus === 'online'}
              aria-label={statusLabel}
            >
              {statusLabel}
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={cycleStatus}
              aria-label={statusLabel}
            >
              {statusLabel}
            </Button>
          </div>
        }
      />

      <div
        className="grid gap-4 lg:grid-cols-[320px_1fr_280px]"
        role="region"
        aria-label={t('chat_inbox.title')}
      >
        {/* ── Colonne gauche : liste sessions ─────────────────────────────── */}
        <Card
          className="flex min-h-[480px] flex-col overflow-hidden p-0"
          aria-label="Sessions actives"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Sessions
            </h2>
            <Badge intent="neutral" fill="soft" size="sm">
              {rows.length}
            </Badge>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoadingList ? (
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-14 w-full rounded-md" />
                <Skeleton className="h-14 w-full rounded-md" />
                <Skeleton className="h-14 w-full rounded-md" />
              </div>
            ) : listError ? (
              <div
                className="p-4 text-sm text-[var(--danger-text)] flex flex-col gap-2 items-start"
                aria-live="polite"
                data-testid="chat-inbox-list-error"
              >
                <span>{listError}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadSessions()}
                  aria-label={t('action.retry')}
                  data-testid="chat-inbox-list-retry"
                >
                  {t('action.retry')}
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                variant="compact"
                icon={<Icon as={MessageCircle} size="sm" />}
                title={t('chat_inbox.no_session')}
              />
            ) : (
              <ul className="divide-y divide-[var(--border-default)]">
                {rows.map((row) => {
                  const s = row.session;
                  const isActive = selected?.session.id === s.id;
                  const visitorLabel =
                    s.visitor_name ||
                    s.visitor_email ||
                    s.ip_hash?.slice(0, 8) ||
                    'Visiteur';
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        aria-pressed={isActive}
                        aria-label={`Conversation ${visitorLabel}`}
                        className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors ${
                          isActive
                            ? 'bg-[var(--primary-soft)]'
                            : 'hover:bg-[var(--bg-muted)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                            {visitorLabel}
                          </span>
                          {s.unread_agent_count > 0 ? (
                            <Badge intent="brand" fill="solid" size="sm">
                              Non lu
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                          <span className="truncate">
                            {row.widget.name ?? 'Widget'}
                          </span>
                          <span className="shrink-0">
                            {formatRelative(s.started_at)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge
                            intent={s.status === 'active' ? 'success' : 'neutral'}
                            fill="soft"
                            size="sm"
                          >
                            {s.status}
                          </Badge>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* ── Colonne centre : transcript + composer ───────────────────────── */}
        <Card
          className="flex min-h-[480px] flex-col overflow-hidden p-0"
          aria-label="Transcript"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {selected
                  ? selected.session.visitor_name ||
                    selected.session.visitor_email ||
                    'Visiteur'
                  : t('chat_inbox.no_session')}
              </span>
              {selected ? (
                <span className="truncate text-[11px] text-[var(--text-secondary)]">
                  {selected.widget.name ?? 'Widget'}
                </span>
              ) : null}
            </div>
            {selected ? (
              <span
                className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]"
                aria-live="polite"
                aria-label={wsConnected ? 'WebSocket connecté' : 'WebSocket fermé'}
              >
                {wsConnected ? (
                  <Icon as={Wifi} size="sm" />
                ) : (
                  <Icon as={WifiOff} size="sm" />
                )}
                {wsConnected ? 'live' : 'REST'}
              </span>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {!selected ? (
              <EmptyState
                icon={<Icon as={MessageCircle} size="md" />}
                title={t('chat_inbox.no_session')}
              />
            ) : isLoadingDetail ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-10 w-2/3 rounded-md" />
                <Skeleton className="h-10 w-1/2 self-end rounded-md" />
                <Skeleton className="h-10 w-3/4 rounded-md" />
              </div>
            ) : messages.length === 0 ? (
              <EmptyState
                variant="compact"
                icon={<Icon as={MessageCircle} size="sm" />}
                title="Aucun message"
              />
            ) : (
              <ol className="flex flex-col gap-2" aria-label="Messages">
                {messages.map((m) => {
                  const isOut = m.direction === 'outbound';
                  return (
                    <li
                      key={m.id}
                      className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-md px-3 py-2 text-sm ${
                          isOut
                            ? 'bg-[var(--primary)] text-white'
                            : 'bg-[var(--bg-muted)] text-[var(--text-primary)]'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {m.body}
                        </div>
                        <div
                          className={`mt-1 text-[10px] ${
                            isOut
                              ? 'text-white/70'
                              : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          {formatRelative(m.created_at)}
                        </div>
                      </div>
                    </li>
                  );
                })}
                {visitorTyping ? (
                  <li
                    className="flex justify-start"
                    aria-live="polite"
                    aria-label={t('chat_inbox.typing')}
                    data-testid="typing-indicator"
                  >
                    <div className="flex items-center gap-1 rounded-md bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                      <span className="inline-flex gap-0.5" aria-hidden="true">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)] [animation-delay:-200ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)] [animation-delay:-100ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" />
                      </span>
                      <span>{t('chat_inbox.typing')}</span>
                    </div>
                  </li>
                ) : null}
                <div ref={transcriptEndRef} />
              </ol>
            )}
          </div>

          {selected ? (
            <form
              onSubmit={handleSend}
              className="flex items-center gap-2 border-t border-[var(--border-default)] px-4 py-3"
              aria-label="Envoyer un message"
            >
              <Input
                value={composer}
                onChange={(e) => setComposer(e.currentTarget.value)}
                placeholder="Tape ton message…"
                aria-label="Message"
                disabled={isSending}
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isSending}
                disabled={isSending || composer.trim().length === 0}
                leftIcon={<Icon as={Send} size="sm" />}
                aria-label="Envoyer"
              >
                Envoyer
              </Button>
            </form>
          ) : null}
        </Card>

        {/* ── Colonne droite : info visiteur ───────────────────────────────── */}
        <Card
          className="flex min-h-[480px] flex-col overflow-hidden p-0"
          aria-label="Informations visiteur"
        >
          <div className="border-b border-[var(--border-default)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Visiteur
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!selected ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Sélectionne une conversation pour voir les détails.
              </p>
            ) : (
              <dl className="flex flex-col gap-3 text-sm">
                <VisitorField
                  label="Nom"
                  value={selected.session.visitor_name}
                />
                <VisitorField
                  label="Email"
                  value={selected.session.visitor_email}
                />
                <VisitorField
                  label="Page"
                  value={detail?.page_url ?? selected.session.page_url}
                  mono
                />
                <VisitorField
                  label="Référent"
                  value={detail?.referrer ?? selected.session.referrer}
                  mono
                />
                <VisitorField
                  label="User agent"
                  value={detail?.user_agent ?? selected.session.user_agent}
                  mono
                />
                <VisitorField
                  label="IP (hash)"
                  value={detail?.ip_hash ?? selected.session.ip_hash}
                  mono
                />
                <VisitorField
                  label="Vu pour la dernière fois"
                  value={formatRelative(selected.session.last_seen_at)}
                />
              </dl>
            )}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

// ── Sous-composant : ligne meta visiteur ────────────────────────────────────

interface VisitorFieldProps {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}

function VisitorField({ label, value, mono }: VisitorFieldProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </dt>
      <dd
        className={`break-words text-[var(--text-primary)] ${
          mono ? 'font-mono text-[12px]' : 'text-sm'
        }`}
      >
        {value && value.length > 0 ? value : '—'}
      </dd>
    </div>
  );
}

export default ChatInbox;
