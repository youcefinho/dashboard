// ── InboxPage — Inbox unifiée 2 panneaux ────────────────────

import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Skeleton, EmptyState, Input, Button } from '@/components/ui';
import { getInboxMessages } from '@/lib/api';
import type { Message, MessageChannel } from '@/lib/types';
import { CHANNEL_ICONS, CHANNEL_LABELS, MESSAGE_STATUS_LABELS } from '@/lib/types';

export function InboxPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<MessageChannel | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    const result = await getInboxMessages({
      channel: channelFilter || undefined,
      limit: 100,
    });
    if (result.data) {
      setMessages(result.data);
      // Sélectionner le premier message si rien n'est sélectionné
      if (!selectedMessageId && result.data.length > 0) {
        setSelectedMessageId(result.data[0]!.id);
      }
    }
    setIsLoading(false);
  }, [channelFilter, selectedMessageId]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  // Grouper les messages par lead
  const groupedByLead: Record<string, Message[]> = {};
  messages.forEach(msg => {
    const key = msg.lead_id;
    if (!groupedByLead[key]) groupedByLead[key] = [];
    groupedByLead[key].push(msg);
  });

  // Threads : un par lead, triés par dernier message
  const threads = Object.entries(groupedByLead)
    .map(([leadId, msgs]) => {
      const sorted = msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const last = sorted[sorted.length - 1]!;
      return {
        leadId,
        leadName: sorted[0]?.lead_name || 'Lead inconnu',
        messages: sorted,
        lastMessage: last,
        unread: msgs.filter(m => m.status === 'sent' && m.direction === 'inbound').length,
      };
    })
    .sort((a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime());

  // Filtrage
  const filteredThreads = threads.filter(t => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return t.leadName.toLowerCase().includes(q) ||
      t.messages.some(m => m.body.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q));
  });

  // Thread sélectionné
  const selectedThread = filteredThreads.find(t =>
    t.messages.some(m => m.id === selectedMessageId)
  ) || filteredThreads[0] || null;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'Z');
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'À l\'instant';
    if (mins < 60) return `${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}j`;
    return d.toLocaleDateString('fr-CA');
  };

  const formatFullDate = (dateStr: string) => {
    const d = new Date(dateStr + 'Z');
    return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }) +
      ' à ' + d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <AppLayout title="Conversations">
      {/* En-tête */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Conversations</h1>
          <Badge color="var(--info)">{messages.length} messages</Badge>
          <Badge color="var(--warning)">{threads.length} fils</Badge>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4 h-[calc(100vh-12rem)]">
          <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          <div className="col-span-2"><Skeleton className="h-full" /></div>
        </div>
      ) : filteredThreads.length === 0 ? (
        <EmptyState icon="💬" title="Aucune conversation" description="Les messages envoyés et reçus apparaîtront ici." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 h-[calc(100vh-12rem)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden">

          {/* Panneau gauche — Liste des threads */}
          <div className="border-r border-[var(--border-subtle)] flex flex-col bg-[var(--bg-surface)]">
            {/* Recherche + filtres */}
            <div className="p-3 border-b border-[var(--border-subtle)] space-y-2">
              <Input
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs"
              />
              <div className="flex gap-1">
                {(['', 'email', 'sms', 'internal_note'] as const).map((ch) => (
                  <button key={ch || 'all'}
                    onClick={() => setChannelFilter(ch as MessageChannel | '')}
                    className={`flex-1 px-2 py-1 rounded text-[10px] font-medium cursor-pointer transition-colors ${
                      channelFilter === ch
                        ? 'bg-[var(--brand-primary)] text-white'
                        : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'
                    }`}>
                    {ch === '' ? 'Tout' : CHANNEL_ICONS[ch]}
                  </button>
                ))}
              </div>
            </div>

            {/* Liste des threads */}
            <div className="flex-1 overflow-y-auto">
              {filteredThreads.map(thread => {
                const isSelected = selectedThread?.leadId === thread.leadId;
                const lastMsg = thread.lastMessage;
                return (
                  <button key={thread.leadId}
                    onClick={() => setSelectedMessageId(thread.messages[0]?.id ?? null)}
                    className={`w-full text-left p-3 border-b border-[var(--border-subtle)] transition-colors cursor-pointer ${
                      isSelected ? 'bg-[var(--brand-primary)]/10 border-l-2 border-l-[var(--brand-primary)]' : 'hover:bg-[var(--bg-subtle)]'
                    }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{CHANNEL_ICONS[lastMsg.channel]}</span>
                        <span className={`text-sm font-medium truncate ${thread.unread > 0 ? 'font-bold' : ''}`}>
                          {thread.leadName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {thread.unread > 0 && (
                          <span className="w-4 h-4 rounded-full bg-[var(--brand-primary)] text-white text-[9px] flex items-center justify-center font-bold">
                            {thread.unread}
                          </span>
                        )}
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{formatDate(lastMsg.created_at)}</span>
                      </div>
                    </div>
                    {lastMsg.subject && (
                      <p className="text-xs font-medium text-[var(--text-secondary)] truncate">{lastMsg.subject}</p>
                    )}
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {lastMsg.direction === 'outbound' ? '→ ' : '← '}
                      {lastMsg.body.replace(/<[^>]+>/g, '').slice(0, 60)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Panneau droit — Fil de conversation */}
          <div className="lg:col-span-2 flex flex-col bg-[var(--bg-canvas)]">
            {selectedThread ? (
              <>
                {/* En-tête conversation */}
                <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--brand-primary)] flex items-center justify-center text-white font-bold text-sm">
                      {selectedThread.leadName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <Link to={`/leads/${selectedThread.leadId}`}
                        className="text-sm font-bold hover:text-[var(--brand-primary)] transition-colors">
                        {selectedThread.leadName}
                      </Link>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {selectedThread.messages.length} message{selectedThread.messages.length > 1 ? 's' : ''} · {CHANNEL_LABELS[selectedThread.lastMessage.channel]}
                      </p>
                    </div>
                  </div>
                  <Link to={`/leads/${selectedThread.leadId}`}
                    className="text-xs text-[var(--brand-primary)] hover:underline">
                    Voir fiche →
                  </Link>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {selectedThread.messages.map((msg, i) => {
                    const isOutbound = msg.direction === 'outbound';
                    // Afficher la date si différente du message précédent
                    const prevMsg = i > 0 ? selectedThread.messages[i - 1] : null;
                    const showDateSeparator = !prevMsg ||
                      new Date(msg.created_at + 'Z').toDateString() !== new Date(prevMsg.created_at + 'Z').toDateString();

                    return (
                      <div key={msg.id}>
                        {showDateSeparator && (
                          <div className="flex items-center gap-3 my-4">
                            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                              {new Date(msg.created_at + 'Z').toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}
                            </span>
                            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                          </div>
                        )}
                        <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] rounded-[var(--radius-lg)] p-3 ${
                            isOutbound
                              ? 'bg-[var(--brand-primary)] text-white rounded-br-sm'
                              : 'bg-[var(--bg-surface)] text-[var(--text-primary)] rounded-bl-sm'
                          }`}>
                            {/* Canal + sujet */}
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] opacity-70">{CHANNEL_ICONS[msg.channel]}</span>
                              {msg.subject && (
                                <span className="text-xs font-semibold opacity-90">{msg.subject}</span>
                              )}
                            </div>
                            {/* Corps */}
                            <p className="text-sm whitespace-pre-wrap break-words">
                              {msg.body.replace(/<[^>]+>/g, '')}
                            </p>
                            {/* Méta */}
                            <div className={`flex items-center justify-between mt-2 text-[10px] ${isOutbound ? 'opacity-70' : 'text-[var(--text-muted)]'}`}>
                              <span>{formatFullDate(msg.created_at)}</span>
                              <Badge color={msg.status === 'delivered' || msg.status === 'read' ? (isOutbound ? 'rgba(255,255,255,0.3)' : 'var(--success)') : undefined}>
                                {MESSAGE_STATUS_LABELS[msg.status]}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Zone de composition */}
                <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Écrire un message..."
                      className="flex-1 px-3 py-2.5 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
                    />
                    <Button size="sm">Envoyer</Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
                <p className="text-sm">Sélectionnez une conversation</p>
              </div>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
