// ── AiAssistantChat — Assistant IA conversationnel (chat) ───────────────────
// Composant enfant ADDITIF de la page AiContent (onglet « Assistant »).
// Surface les fonctions IA invisibles côté front : historique des
// conversations (getAiConversations), ouverture d'une conversation
// (getAiConversation) et envoi de message (aiChat). 100 % additif — n'impacte
// PAS l'atelier de contenu existant.
//
// Helpers FIGÉS consommés tels quels (AUCUN client_id envoyé — bornage tenant
// worker-side). Discrimination res.error / !res.data (JAMAIS de champ `code`).
// Mock-safe : si l'IA n'est pas configurée, le worker renvoie un contenu mock
// déterministe → affiché normalement. Libellés via t('aiassist.*').
//
// Les conversations renvoyées par l'API sont des Record<string, unknown> non
// typés → lecture DÉFENSIVE des champs (id / title / messages / reply).

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Send, MessageSquare, RefreshCw, Plus } from 'lucide-react';
import {
  Button, Card, Textarea, EmptyState,
} from '@/components/ui';
import { aiChat, getAiConversations, getAiConversation } from '@/lib/api';
import { t } from '@/lib/i18n';

// ── Lecture défensive de champs non typés (Record<string, unknown>) ──────────
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// Identifiant d'une conversation listée (plusieurs schémas possibles côté worker).
function convId(c: Record<string, unknown>): string {
  return str(c.id) || str(c.conversation_id) || str(c.uuid);
}

// Libellé d'une conversation dans la liste (titre, sinon dérivé, sinon id court).
function convLabel(c: Record<string, unknown>): string {
  const title = str(c.title) || str(c.subject) || str(c.last_message) || str(c.preview);
  if (title.trim()) return title.trim().slice(0, 80);
  const id = convId(c);
  return id ? `${t('aiassist.conversation')} ${id.slice(0, 8)}` : t('aiassist.conversation');
}

// Un message normalisé pour l'affichage du fil.
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// Extrait une liste de messages d'une conversation chargée (schéma souple).
function extractMessages(conv: Record<string, unknown> | null): ChatMessage[] {
  if (!conv) return [];
  const raw = conv.messages;
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i] as Record<string, unknown>;
    if (!m || typeof m !== 'object') continue;
    const content = str(m.content) || str(m.body) || str(m.text) || str(m.message);
    if (!content.trim()) continue;
    const roleRaw = str(m.role) || str(m.direction) || str(m.sender);
    const role: ChatMessage['role'] =
      roleRaw === 'assistant' || roleRaw === 'bot' || roleRaw === 'outbound' || roleRaw === 'ai'
        ? 'assistant'
        : 'user';
    out.push({ id: str(m.id) || `m-${i}`, role, content });
  }
  return out;
}

export function AiAssistantChat() {
  // ── Liste des conversations passées ───────────────────────────────────────
  const [conversations, setConversations] = useState<Array<Record<string, unknown>>>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // ── Conversation active ───────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  // ── Composer ──────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement | null>(null);

  // ── Chargement de la liste ────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    const res = await getAiConversations(50);
    if (res.data) setConversations(res.data);
    else if (res.error) setListError(res.error);
    setLoadingList(false);
  }, []);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  // ── Auto-scroll du fil vers le bas à chaque nouveau message ───────────────
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // ── Ouvrir une conversation existante ─────────────────────────────────────
  const handleOpen = useCallback(async (id: string) => {
    if (!id) return;
    setActiveId(id);
    setMessages([]);
    setSendError(null);
    setLoadingThread(true);
    setThreadError(null);
    const res = await getAiConversation(id);
    if (res.data) setMessages(extractMessages(res.data));
    else if (res.error) setThreadError(res.error);
    setLoadingThread(false);
  }, []);

  // ── Nouvelle conversation (réinitialise le fil, sans appel réseau) ─────────
  const handleNew = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setThreadError(null);
    setSendError(null);
    setDraft('');
  }, []);

  // ── Envoi d'un message (aiChat) ───────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (sending || !text) return;
    setSending(true);
    setSendError(null);
    // Optimiste : on affiche immédiatement le message user.
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setDraft('');
    try {
      const res = await aiChat({
        message: text,
        conversation_id: activeId ?? undefined,
      });
      if (res.data) {
        const reply = str(res.data.reply);
        const newConvId = str(res.data.conversation_id);
        if (newConvId && newConvId !== activeId) {
          setActiveId(newConvId);
          // Nouvelle conversation créée → rafraîchir la liste pour la voir.
          if (!activeId) void loadConversations();
        }
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: 'assistant', content: reply || t('aiassist.empty_reply') },
        ]);
      } else {
        setSendError(res.error ?? t('aiassist.error'));
      }
    } catch {
      setSendError(t('aiassist.error'));
    } finally {
      setSending(false);
    }
  }, [draft, sending, activeId, loadConversations]);

  // Entrée envoie ; Maj+Entrée = nouvelle ligne.
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* ── Colonne : historique des conversations ── */}
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-0">
            {t('aiassist.conversations')}
          </h2>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={handleNew}
          >
            {t('aiassist.new_conversation')}
          </Button>
        </div>

        {listError && !loadingList ? (
          <Card
            role="alert"
            aria-live="polite"
            className="p-3 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-2"
          >
            <span className="text-xs">{listError}</span>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw size={13} />}
              onClick={() => void loadConversations()}
            >
              {t('aiassist.retry')}
            </Button>
          </Card>
        ) : null}

        {loadingList ? (
          <div className="space-y-3" aria-busy="true" aria-live="polite">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-14 rounded-[var(--radius-lg)]" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            variant="first-time"
            icon={<MessageSquare size={24} />}
            title={t('aiassist.conversations_empty')}
            description={t('aiassist.conversations_empty_hint')}
          />
        ) : (
          <div className="space-y-2">
            {conversations.map((c, idx) => {
              const id = convId(c);
              const isActive = id !== '' && id === activeId;
              return (
                <Card
                  key={id || `conv-${idx}`}
                  className={`p-3 cursor-pointer transition-colors ${
                    isActive ? 'border-[var(--primary)]' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="w-full text-left min-w-0"
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => void handleOpen(id)}
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare size={14} className="text-[var(--text-muted)] shrink-0" />
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {convLabel(c)}
                      </span>
                    </div>
                  </button>
                </Card>
              );
            })}
          </div>
        )}
      </aside>

      {/* ── Colonne principale : fil de discussion ── */}
      <div className="lg:col-span-2">
        <Card className="p-0 flex flex-col" style={{ minHeight: '28rem' }}>
          {/* Fil des messages (log a11y) */}
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-busy={loadingThread || sending}
            aria-label={t('aiassist.message_list')}
            className="flex-1 overflow-y-auto p-4 space-y-3"
            style={{ maxHeight: '24rem' }}
          >
            {threadError ? (
              <Card
                role="alert"
                aria-live="assertive"
                className="p-3 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-2"
              >
                <span className="text-sm">{threadError}</span>
                {activeId && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<RefreshCw size={13} />}
                    onClick={() => void handleOpen(activeId)}
                  >
                    {t('aiassist.retry')}
                  </Button>
                )}
              </Card>
            ) : loadingThread ? (
              <div className="space-y-3" aria-busy="true">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-12 rounded-[var(--radius-lg)]" />
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <EmptyState
                  variant="first-time"
                  icon={<Sparkles size={26} />}
                  title={t('aiassist.empty_title')}
                  description={t('aiassist.empty_hint')}
                />
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className="max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words"
                    style={
                      m.role === 'user'
                        ? { background: 'var(--primary)', color: '#fff' }
                        : { background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }
                    }
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}

            {/* Indicateur « l'assistant rédige… » pendant l'envoi */}
            {sending && (
              <div className="flex justify-start" aria-live="polite">
                <div
                  className="max-w-[80%] rounded-2xl px-3.5 py-2 text-sm flex items-center gap-2"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                >
                  <Sparkles size={14} className="animate-pulse text-[var(--primary)]" />
                  {t('aiassist.thinking')}
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-[var(--border)] p-3 space-y-2">
            {sendError && (
              <div
                role="alert"
                aria-live="assertive"
                className="text-xs text-[var(--danger)]"
              >
                {sendError}
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Textarea
                  aria-label={t('aiassist.composer_label')}
                  placeholder={t('aiassist.composer_placeholder')}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onComposerKeyDown}
                  rows={2}
                  disabled={sending}
                />
              </div>
              <Button
                variant="primary"
                leftIcon={<Send size={14} />}
                isLoading={sending}
                disabled={sending || !draft.trim()}
                onClick={() => void handleSend()}
              >
                {t('aiassist.send')}
              </Button>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">{t('aiassist.send_hint')}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
