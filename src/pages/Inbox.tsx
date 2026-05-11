// ── Page Conversations — Sprint 3 Vertical Conversations ────
// Architecture 3 panneaux : liste conversations | fil messages | info lead

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Skeleton, Button } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';

import { getConversations, getConversation, sendConversationMessage, updateConversation } from '@/lib/api';
import type { Conversation, Message, ConversationStatus, MessageChannel } from '@/lib/types';
import { CHANNEL_LABELS, CONVERSATION_STATUS_LABELS, CONVERSATION_STATUS_COLORS } from '@/lib/types';
import {
  Search, Mail, MessageSquare, Globe, Send, Star, StarOff,
  PanelRightClose, PanelRightOpen, Inbox, Phone, StickyNote,
  CheckCircle2, Pause, ExternalLink, X,
} from 'lucide-react';

type ChannelFilter = MessageChannel | '';
type StatusFilter = ConversationStatus | 'all';

// Icône Lucide par canal
const CHANNEL_ICON_MAP: Record<string, typeof Mail> = {
  email: Mail, sms: Phone, webchat: Globe,
  facebook_messenger: MessageSquare, instagram_dm: MessageSquare,
  internal_note: StickyNote,
};

export function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<(Conversation & { messages: Message[] }) | null>(null);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  // Charger le détail
  useEffect(() => {
    if (!selectedConvId) { setActiveConv(null); return; }
    void (async () => {
      const res = await getConversation(selectedConvId);
      if (res.data) setActiveConv(res.data);
    })();
  }, [selectedConvId]);

  // Scroll auto
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages]);

  // Envoyer un message
  const handleSend = async () => {
    if (!composerText.trim() || !selectedConvId) return;
    setIsSending(true);
    const res = await sendConversationMessage(selectedConvId, { body: composerText });
    if (res.data?.success) {
      setComposerText('');
      // Recharger la conversation
      const updated = await getConversation(selectedConvId);
      if (updated.data) setActiveConv(updated.data);
      void loadConversations();
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

  // Helpers
  const timeAgo = (d: string) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'maintenant';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}j`;
  };

  const formatTime = (d: string) => new Date(d).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  const formatDate = (d: string) => new Date(d).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });

  // Grouper messages par jour
  const groupMessagesByDay = (messages: Message[]) => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';
    for (const msg of messages) {
      const d = formatDate(msg.created_at);
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ date: d, messages: [msg] });
      } else {
        groups[groups.length - 1]!.messages.push(msg);
      }
    }
    return groups;
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <AppLayout title="Conversations">
      <div className="flex h-[calc(100vh-64px)] -m-6 overflow-hidden">

        {/* ══ PANNEAU GAUCHE — Liste conversations ══════════ */}
        <div className="w-80 shrink-0 border-r border-[var(--border-subtle)] flex flex-col bg-[var(--bg-canvas)]">

          {/* Header + search */}
          <div className="p-3 border-b border-[var(--border-subtle)]">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--brand-primary)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Status tabs */}
          <div className="flex items-center gap-0.5 px-3 py-2 border-b border-[var(--border-subtle)]">
            {(['all', 'open', 'closed', 'snoozed'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md font-medium cursor-pointer transition-all
                  ${statusFilter === s ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'}`}>
                {s === 'all' ? 'Toutes' : CONVERSATION_STATUS_LABELS[s]}
                {s !== 'all' && statusCounts[s] ? (
                  <span className={`text-[9px] px-1 rounded-full ${statusFilter === s ? 'bg-white/20' : 'bg-[var(--bg-subtle)]'}`}>
                    {statusCounts[s]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Channel filter pills */}
          <div className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto border-b border-[var(--border-subtle)]">
            {[{ v: '' as ChannelFilter, l: 'Tous' }, { v: 'email' as ChannelFilter, l: 'Email' }, { v: 'sms' as ChannelFilter, l: 'SMS' }, { v: 'webchat' as ChannelFilter, l: 'Chat' }].map(f => (
              <button key={f.v} onClick={() => setChannelFilter(f.v)}
                className={`px-2 py-0.5 text-[9px] rounded font-medium cursor-pointer transition-all whitespace-nowrap
                  ${channelFilter === f.v ? 'bg-[var(--brand-tint)] text-[var(--brand-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'}`}>
                {f.l}
              </button>
            ))}
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
                <Inbox size={32} className="mb-2 opacity-40" />
                <p className="text-xs">Aucune conversation</p>
              </div>
            ) : (
              conversations.map(conv => {
                const isActive = conv.id === selectedConvId;
                const ChannelIcon = CHANNEL_ICON_MAP[conv.channel] || Mail;
                return (
                  <button key={conv.id} onClick={() => setSelectedConvId(conv.id)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left cursor-pointer transition-all border-b border-[var(--border-subtle)]
                      ${isActive ? 'bg-[var(--brand-tint)]' : 'hover:bg-[var(--bg-subtle)]'}`}>
                    <Avatar name={conv.lead_name || '?'} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-xs font-semibold truncate ${conv.unread_count > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {conv.lead_name || 'Inconnu'}
                        </span>
                        <span className="text-[9px] text-[var(--text-muted)] shrink-0 ml-1">{timeAgo(conv.last_message_at)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <ChannelIcon size={10} className="text-[var(--text-muted)] shrink-0" />
                        <p className="text-[10px] text-[var(--text-muted)] truncate">{conv.last_message_preview || '—'}</p>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {conv.unread_count > 0 && (
                          <span className="text-[8px] bg-[var(--brand-primary)] text-white px-1.5 py-0.5 rounded-full font-bold">{conv.unread_count}</span>
                        )}
                        {conv.is_starred ? (
                          <button onClick={(e) => void toggleStar(conv, e)} className="cursor-pointer"><Star size={10} className="text-[var(--warning)] fill-[var(--warning)]" /></button>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ══ PANNEAU CENTRAL — Fil de messages ════════════ */}
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
                  <button onClick={() => void toggleStar(activeConv, { stopPropagation: () => {} } as React.MouseEvent)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer">
                    {activeConv.is_starred ? <Star size={15} className="text-[var(--warning)] fill-[var(--warning)]" /> : <StarOff size={15} />}
                  </button>
                  <button onClick={() => setShowRightPanel(!showRightPanel)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer">
                    {showRightPanel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {activeConv.messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
                    <p className="text-xs">Aucun message dans cette conversation</p>
                  </div>
                ) : (
                  groupMessagesByDay(activeConv.messages).map(group => (
                    <div key={group.date}>
                      <div className="flex items-center gap-2 my-3">
                        <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                        <span className="text-[9px] text-[var(--text-muted)] uppercase font-medium">{group.date}</span>
                        <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                      </div>
                      {group.messages.map(msg => {
                        const isOut = msg.direction === 'outbound';
                        const isNote = msg.channel === 'internal_note';
                        return (
                          <div key={msg.id} className={`flex mb-2 ${isOut ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[70%] rounded-xl px-3 py-2 ${
                              isNote ? 'bg-[#FFF9C4] border border-[#FFE082] text-[#5D4037]' :
                              isOut ? 'bg-[var(--brand-primary)] text-white' :
                              'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]'
                            }`}>
                              {isNote && <p className="text-[9px] font-bold mb-0.5 opacity-70">📝 Note interne</p>}
                              {msg.subject && <p className={`text-[10px] font-semibold mb-0.5 ${isOut && !isNote ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>{msg.subject}</p>}
                              <p className="text-xs whitespace-pre-wrap break-words">{msg.body}</p>
                              <div className={`flex items-center justify-end gap-1 mt-1 ${isOut && !isNote ? 'text-white/60' : 'text-[var(--text-muted)]'}`}>
                                <span className="text-[9px]">{formatTime(msg.created_at)}</span>
                                {msg.sender_name && <span className="text-[9px]">· {msg.sender_name}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Composer */}
              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1 relative">
                    <textarea
                      value={composerText}
                      onChange={e => setComposerText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                      placeholder={`Répondre via ${CHANNEL_LABELS[activeConv.channel as MessageChannel] || activeConv.channel}...`}
                      rows={2}
                      className="w-full px-3 py-2 text-xs bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--brand-primary)] resize-none"
                    />
                  </div>
                  <Button size="sm" onClick={() => void handleSend()} isLoading={isSending} leftIcon={<Send size={14} />}>
                    Envoyer
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ══ PANNEAU DROIT — Info lead (collapsible) ══════ */}
        {showRightPanel && activeConv && (
          <div className="w-72 shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-y-auto">
            <div className="p-4">
              {/* Avatar + nom */}
              <div className="text-center mb-4">
                <Avatar name={activeConv.lead_name || '?'} size="lg" className="mx-auto mb-2" />
                <h3 className="text-sm font-semibold">{activeConv.lead_name || 'Inconnu'}</h3>
                <p className="text-[10px] text-[var(--text-muted)]">{activeConv.lead_email}</p>
                {activeConv.lead_phone && (
                  <p className="text-[10px] text-[var(--text-muted)]">{activeConv.lead_phone}</p>
                )}
              </div>

              {/* Actions rapides */}
              <div className="flex gap-2 mb-4">
                <Link to={`/leads/${activeConv.lead_id}`} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium bg-[var(--brand-tint)] text-[var(--brand-primary)] rounded-lg hover:opacity-80 transition-opacity">
                  <ExternalLink size={12} /> Voir le lead
                </Link>
              </div>

              {/* Infos conversation */}
              <div className="space-y-3">
                <div>
                  <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Conversation</p>
                  <div className="space-y-1.5">
                    {[
                      ['Canal', CHANNEL_LABELS[activeConv.channel as MessageChannel] || activeConv.channel],
                      ['Statut', CONVERSATION_STATUS_LABELS[activeConv.status as ConversationStatus] || activeConv.status],
                      ['Assigné à', activeConv.assigned_name || '—'],
                      ['Créée', new Date(activeConv.created_at).toLocaleDateString('fr-CA')],
                      ['Messages', String(activeConv.messages?.length || 0)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between text-[10px]">
                        <span className="text-[var(--text-muted)]">{label}</span>
                        <span className="text-[var(--text-primary)] font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Changer statut */}
                <div>
                  <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Actions</p>
                  <div className="space-y-1">
                    {(['open', 'closed', 'snoozed'] as const).filter(s => s !== activeConv.status).map(s => (
                      <button key={s} onClick={() => void changeStatus(s)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-lg hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors text-left">
                        <div className="w-2 h-2 rounded-full" style={{ background: CONVERSATION_STATUS_COLORS[s] }} />
                        Marquer comme {CONVERSATION_STATUS_LABELS[s].toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
