// ── Page Conversations — Sprint 3 Vertical Conversations ────
// Architecture 3 panneaux : liste conversations | fil messages | info lead

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';

import { getConversations, getConversation, sendConversationMessage, updateConversation, getSnippets, getTemplates, markConversationRead, aiSummarizeConversation } from '@/lib/api';
import type { Conversation, Message, ConversationStatus, MessageChannel, Snippet, EmailTemplate } from '@/lib/types';
import { CHANNEL_LABELS, CONVERSATION_STATUS_LABELS, CONVERSATION_STATUS_COLORS } from '@/lib/types';
import { MessageSquare, CheckCircle2, Pause, Star, StarOff, PanelRightClose, PanelRightOpen, Inbox, ArrowLeft, Sparkles, Loader2, X as XIcon } from 'lucide-react';

import { ConversationsList } from '@/components/Inbox/ConversationsList';
import { MessageThread } from '@/components/Inbox/MessageThread';
import { MessageComposer } from '@/components/Inbox/MessageComposer';
import { InboxPanel } from '@/components/Inbox/InboxPanel';
import { NewConversationPane } from '@/components/Inbox/NewConversationPane';
import { useConversationWs } from '@/hooks/useConversationWs';

export function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<MessageChannel | ''>('');
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | 'all'>('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<(Conversation & { messages: Message[] }) | null>(null);
  const [isComposingNew, setIsComposingNew] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  // Sprint 20 : AI summarize
  const [aiSummary, setAiSummary] = useState<string[] | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Reset le résumé quand on change de conversation
  useEffect(() => { setAiSummary(null); }, [selectedConvId]);

  const handleSummarize = async () => {
    if (!selectedConvId || isSummarizing) return;
    setIsSummarizing(true);
    const res = await aiSummarizeConversation(selectedConvId);
    setIsSummarizing(false);
    if (res.data?.summary) setAiSummary(res.data.summary);
  };

  // Sprint 20 — Retry d'un message failed : retire le failed du fil + renvoie
  const handleRetry = (failedId: string, body: string) => {
    setActiveConv(prev => prev ? {
      ...prev,
      messages: (prev.messages || []).filter(m => m.id !== failedId)
    } : prev);
    void handleSend(body);
  };

  // WebSocket pour Webchat
  const { wsMessages, sendWsMessage, wsStatus } = useConversationWs(
    selectedConvId,
    activeConv?.channel || null
  );

  // Combiner les messages REST et WS
  const combinedMessages = [...(activeConv?.messages || []), ...wsMessages].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);

  // Charger la liste
  const loadConversations = useCallback(async () => {
    setIsLoading(true);
    const res = await getConversations({
      channel: channelFilter || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      search: searchQuery || undefined,
      limit: 100,
    });
    if (res.data) {
      setConversations(res.data);
      if (!selectedConvId && res.data.length > 0) setSelectedConvId(res.data[0]!.id);
    }
    const meta = (res as Record<string, unknown>).meta as { counts?: Array<{ status: string; count: number }> } | undefined;
    if (meta?.counts) {
      const c: Record<string, number> = {};
      meta.counts.forEach(s => { c[s.status] = s.count; });
      setStatusCounts(c);
    }
    setIsLoading(false);
  }, [channelFilter, statusFilter, searchQuery, selectedConvId]);

  useEffect(() => { 
    void loadConversations(); 
    void (async () => {
      const snip = await getSnippets();
      if (snip.data) setSnippets(snip.data);
      const temp = await getTemplates();
      if (temp.data) setTemplates(temp.data);
    })();
  }, [loadConversations]);

  // Charger le détail
  useEffect(() => {
    if (!selectedConvId) { setActiveConv(null); return; }
    void (async () => {
      const res = await getConversation(selectedConvId);
      if (res.data) {
        setActiveConv(res.data);
        if (res.data.unread_count && res.data.unread_count > 0) {
          await markConversationRead(selectedConvId);
          setConversations(prev => prev.map(c => c.id === selectedConvId ? { ...c, unread_count: 0 } : c));
        }
      }
    })();
  }, [selectedConvId]);

  // Scroll auto
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [combinedMessages]);

  // Envoyer un message — Optimistic UI : le message apparaît instantanément
  // dans le fil avec status="sending", puis transitionne à "sent" au retour
  // serveur, ou "failed" si erreur (avec retry possible).
  // Sprint 20 : `bodyOverride` permet le retry depuis un message failed
  const handleSend = async (bodyOverride?: string) => {
    const text = (bodyOverride ?? composerText).trim();
    if (!text || !selectedConvId || !activeConv) return;
    const tmpId = `tmp-${crypto.randomUUID()}`;
    const optimisticMsg: Message = {
      id: tmpId,
      lead_id: activeConv.lead_id || '',
      client_id: activeConv.client_id || '',
      conversation_id: selectedConvId,
      direction: 'outbound',
      channel: activeConv.channel,
      subject: '',
      body: text,
      status: 'sending' as Message['status'],
      sent_by: 'me',
      external_id: '',
      metadata: '',
      created_at: new Date().toISOString(),
      sender_name: 'Vous',
    };
    // Affichage instantané + clear composer (uniquement si saisi par user, pas en retry)
    setActiveConv(prev => prev ? { ...prev, messages: [...(prev.messages || []), optimisticMsg] } : prev);
    if (bodyOverride === undefined) setComposerText('');
    setIsSending(true);

    // Si Webchat, on envoie via WS (déjà optimistic via le backend WS pour le serveur)
    if (activeConv.channel === 'webchat') {
      const sent = sendWsMessage(text);
      if (!sent) {
        // Fallback REST si WS déconnecté
        const res = await sendConversationMessage(selectedConvId, { body: text });
        if (res.error) {
          setActiveConv(prev => prev ? {
            ...prev,
            messages: (prev.messages || []).map(m => m.id === tmpId ? { ...m, status: 'failed' as Message['status'] } : m)
          } : prev);
        } else {
          setActiveConv(prev => prev ? {
            ...prev,
            messages: (prev.messages || []).map(m => m.id === tmpId ? { ...m, status: 'sent' as Message['status'] } : m)
          } : prev);
        }
      } else {
        // WS envoyé : marquer "sent" après un petit délai (le serveur va echo via WS)
        setTimeout(() => {
          setActiveConv(prev => prev ? {
            ...prev,
            messages: (prev.messages || []).map(m => m.id === tmpId ? { ...m, status: 'sent' as Message['status'] } : m)
          } : prev);
        }, 300);
      }
    } else {
      // API REST classique
      const res = await sendConversationMessage(selectedConvId, { body: text });
      if (res.error || !res.data?.success) {
        // Marquer le message optimistic comme "failed" pour retry
        setActiveConv(prev => prev ? {
          ...prev,
          messages: (prev.messages || []).map(m => m.id === tmpId ? { ...m, status: 'failed' as Message['status'] } : m)
        } : prev);
      } else {
        // Recharger la conversation pour récupérer l'ID réel du message et le statut serveur
        const updated = await getConversation(selectedConvId);
        if (updated.data) {
          // Remplacer le tmp par les vrais messages du serveur
          setActiveConv(updated.data);
        }
        void loadConversations();
      }
    }

    setIsSending(false);
  };

  // Toggle star
  const toggleStar = async (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    await updateConversation(conv.id, { is_starred: conv.is_starred ? 0 : 1 });
    void loadConversations();
  };

  // Changer statut
  const changeStatus = async (status: ConversationStatus) => {
    if (!selectedConvId) return;
    await updateConversation(selectedConvId, { status });
    void loadConversations();
    const updated = await getConversation(selectedConvId);
    if (updated.data) setActiveConv(updated.data);
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <AppLayout title="Conversations">
      <div className="flex h-[calc(100vh-64px)] -m-6 overflow-hidden">
        <ConversationsList 
          className={selectedConvId || isComposingNew ? 'hidden md:flex' : 'flex-1 md:w-80 md:flex-none'}
          conversations={conversations}
          isLoading={isLoading}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          channelFilter={channelFilter}
          setChannelFilter={setChannelFilter}
          statusCounts={statusCounts}
          selectedConvId={selectedConvId}
          setSelectedConvId={(id) => { setSelectedConvId(id); setIsComposingNew(false); }}
          toggleStar={toggleStar}
          onNew={() => { setSelectedConvId(null); setIsComposingNew(true); }}
        />

        {/* ══ PANNEAU CENTRAL — Fil de messages ════════════ */}
        {isComposingNew ? (
          <NewConversationPane 
            className={selectedConvId || isComposingNew ? 'flex' : 'hidden md:flex'}
            snippets={snippets} 
            templates={templates}
            onCancel={() => { setIsComposingNew(false); if (conversations[0]) setSelectedConvId(conversations[0].id); }}
            onSent={(id) => { 
              setIsComposingNew(false); 
              setSelectedConvId(id); 
              void loadConversations(); 
            }}
          />
        ) : (
          <div className={`flex-1 flex-col min-w-0 bg-[var(--bg-canvas)] ${selectedConvId ? 'flex' : 'hidden md:flex'}`}>
          {!activeConv ? (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] p-6">
              <div className="text-center max-w-xs">
                <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
                {conversations.length === 0 ? (
                  <>
                    <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">Aucune conversation pour l'instant</p>
                    <p className="text-xs">Connectez Facebook Messenger ou installez le WebChat pour commencer à recevoir des messages.</p>
                  </>
                ) : (
                  <p className="text-sm">Sélectionnez une conversation à gauche pour commencer.</p>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Header conversation */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button className="md:hidden p-1.5 -ml-2 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] rounded-lg transition-colors cursor-pointer shrink-0" onClick={() => setSelectedConvId(null)}>
                    <ArrowLeft size={18} />
                  </button>
                  <Avatar name={activeConv.lead_name || '?'} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-semibold truncate max-w-[120px] sm:max-w-xs">{activeConv.lead_name || 'Inconnu'}</h3>
                      <Badge color={CONVERSATION_STATUS_COLORS[activeConv.status as ConversationStatus] || 'var(--text-muted)'} className="text-[9px] shrink-0">
                        {CONVERSATION_STATUS_LABELS[activeConv.status as ConversationStatus] || activeConv.status}
                      </Badge>
                      <span className="text-[9px] text-[var(--text-muted)]">via {CHANNEL_LABELS[activeConv.channel as MessageChannel] || activeConv.channel}</span>
                      {activeConv.channel === 'webchat' && wsStatus !== 'idle' && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                          style={{
                            background: wsStatus === 'connected' ? 'var(--success-soft)' : wsStatus === 'closed' ? 'var(--danger-soft)' : 'var(--warning-soft)',
                            color: wsStatus === 'connected' ? 'var(--success)' : wsStatus === 'closed' ? 'var(--danger)' : 'var(--warning)',
                          }}
                          title={`WebSocket: ${wsStatus}`}>
                          <span className="w-1 h-1 rounded-full" style={{
                            background: 'currentColor',
                            animation: wsStatus === 'reconnecting' || wsStatus === 'connecting' ? 'pulse 1.5s ease-in-out infinite' : undefined,
                          }} />
                          {wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connexion...' : wsStatus === 'reconnecting' ? 'Reconnexion...' : 'Déconnecté'}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">{activeConv.lead_email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => void handleSummarize()} disabled={isSummarizing}
                    className="inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-medium text-white transition-all cursor-pointer disabled:cursor-not-allowed"
                    style={{ background: 'linear-gradient(135deg, var(--brand-primary), var(--accent-orange))' }}
                    title="Résumer la conversation avec l'AI">
                    {isSummarizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    <span className="hidden sm:inline">{isSummarizing ? 'Résumé…' : 'Résumer'}</span>
                  </button>
                  {activeConv.status !== 'closed' && (
                    <button onClick={() => void changeStatus('closed')} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer" title="Fermer">
                      <CheckCircle2 size={15} />
                    </button>
                  )}
                  {activeConv.status === 'closed' && (
                    <button onClick={() => void changeStatus('open')} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer" title="Rouvrir">
                      <Inbox size={15} />
                    </button>
                  )}
                  {activeConv.status === 'open' && (
                    <button onClick={() => void changeStatus('snoozed')} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer" title="Mettre en pause">
                      <Pause size={15} />
                    </button>
                  )}
                  <button onClick={(e) => void toggleStar(activeConv, e)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer">
                    {activeConv.is_starred ? <Star size={15} className="text-[var(--warning)] fill-[var(--warning)]" /> : <StarOff size={15} />}
                  </button>
                  <button onClick={() => setShowRightPanel(!showRightPanel)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer">
                    {showRightPanel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                  </button>
                </div>
              </div>

              {/* Carte résumé AI (Sprint 20) — dismissable */}
              {aiSummary && (
                <div className="mx-4 mt-3 mb-1 p-3 rounded-[var(--radius-md)] border border-[var(--brand-primary)]/30 bg-gradient-to-br from-[var(--brand-primary)]/5 to-[var(--accent-orange)]/5 animate-in fade-in-0 slide-in-from-top-2">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={12} className="text-[var(--brand-primary)]" />
                      <span className="text-[10px] font-semibold text-[var(--brand-primary)] uppercase tracking-wider">Résumé AI</span>
                    </div>
                    <button onClick={() => setAiSummary(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer" aria-label="Fermer le résumé">
                      <XIcon size={12} />
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {aiSummary.map((line, i) => (
                      <li key={i} className="text-xs text-[var(--text-secondary)] leading-relaxed flex gap-1.5">
                        <span className="text-[var(--brand-primary)] shrink-0">▸</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[9px] text-[var(--text-muted)] mt-2">Généré par Claude Haiku 4.5</p>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <MessageThread messages={combinedMessages} ref={messagesEndRef} onRetry={handleRetry} />
              </div>

              {/* Composer */}
              <MessageComposer 
                composerText={composerText} 
                setComposerText={setComposerText} 
                handleSend={handleSend} 
                isSending={isSending} 
                channel={activeConv.channel as MessageChannel} 
                snippets={snippets}
                templates={templates}
                leadId={activeConv.lead_id}
              />
            </>
          )}
        </div>
        )}
        
        {/* ══ PANNEAU DROIT — Info lead (collapsible) ══════ */}
        {showRightPanel && activeConv && !isComposingNew && (
          <div className="hidden lg:flex">
            <InboxPanel activeConv={activeConv} changeStatus={changeStatus} />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
