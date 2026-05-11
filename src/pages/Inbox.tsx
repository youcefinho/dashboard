// ── Page Conversations — Sprint 3 Vertical Conversations ────
// Architecture 3 panneaux : liste conversations | fil messages | info lead

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';

import { getConversations, getConversation, sendConversationMessage, updateConversation, getSnippets, getTemplates, markConversationRead } from '@/lib/api';
import type { Conversation, Message, ConversationStatus, MessageChannel, Snippet, EmailTemplate } from '@/lib/types';
import { CHANNEL_LABELS, CONVERSATION_STATUS_LABELS, CONVERSATION_STATUS_COLORS } from '@/lib/types';
import { MessageSquare, CheckCircle2, Pause, Star, StarOff, PanelRightClose, PanelRightOpen, Inbox } from 'lucide-react';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // WebSocket pour Webchat
  const { wsMessages, sendWsMessage } = useConversationWs(
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

  // Envoyer un message
  const handleSend = async () => {
    if (!composerText.trim() || !selectedConvId || !activeConv) return;
    setIsSending(true);
    
    // Si Webchat, on envoie via WS
    if (activeConv.channel === 'webchat') {
      const sent = sendWsMessage(composerText);
      if (sent) {
        setComposerText('');
      } else {
        // Fallback REST si WS déconnecté (le backend gèrera la room)
        await sendConversationMessage(selectedConvId, { body: composerText });
        setComposerText('');
      }
    } else {
      // API REST classique
      const res = await sendConversationMessage(selectedConvId, { body: composerText });
      if (res.data?.success) {
        setComposerText('');
        // Recharger la conversation
        const updated = await getConversation(selectedConvId);
        if (updated.data) setActiveConv(updated.data);
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
          <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-canvas)]">
          {!activeConv ? (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
              <div className="text-center">
                <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Sélectionnez une conversation</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header conversation */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <div className="flex items-center gap-2.5">
                  <Avatar name={activeConv.lead_name || '?'} size="sm" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-semibold">{activeConv.lead_name || 'Inconnu'}</h3>
                      <Badge color={CONVERSATION_STATUS_COLORS[activeConv.status as ConversationStatus] || 'var(--text-muted)'} className="text-[9px]">
                        {CONVERSATION_STATUS_LABELS[activeConv.status as ConversationStatus] || activeConv.status}
                      </Badge>
                      <span className="text-[9px] text-[var(--text-muted)]">via {CHANNEL_LABELS[activeConv.channel as MessageChannel] || activeConv.channel}</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">{activeConv.lead_email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
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

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <MessageThread messages={combinedMessages} ref={messagesEndRef} />
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
          <InboxPanel activeConv={activeConv} changeStatus={changeStatus} />
        )}
      </div>
    </AppLayout>
  );
}
