import React from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui';
import type { Conversation, ConversationStatus, MessageChannel } from '@/lib/types';
import { CONVERSATION_STATUS_LABELS } from '@/lib/types';
import { Search, Inbox, X, Star, Mail, Phone, Globe, MessageSquare, StickyNote } from 'lucide-react';

export const CHANNEL_ICON_MAP: Record<string, typeof Mail> = {
  email: Mail, sms: Phone, webchat: Globe,
  facebook: MessageSquare, instagram: MessageSquare, facebook_messenger: MessageSquare, instagram_dm: MessageSquare,
  internal_note: StickyNote,
};

interface Props {
  conversations: Conversation[];
  isLoading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  statusFilter: ConversationStatus | 'all';
  setStatusFilter: (s: ConversationStatus | 'all') => void;
  channelFilter: MessageChannel | '';
  setChannelFilter: (c: MessageChannel | '') => void;
  statusCounts: Record<string, number>;
  selectedConvId: string | null;
  setSelectedConvId: (id: string) => void;
  toggleStar: (conv: Conversation, e: React.MouseEvent) => void;
  onNew?: () => void;
}

export function ConversationsList({
  conversations, isLoading, searchQuery, setSearchQuery,
  statusFilter, setStatusFilter, channelFilter, setChannelFilter,
  statusCounts, selectedConvId, setSelectedConvId, toggleStar, onNew
}: Props) {

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

  return (
    <div className="w-80 shrink-0 border-r border-[var(--border-subtle)] flex flex-col bg-[var(--bg-canvas)]">
      {/* Header + search */}
      <div className="p-3 border-b border-[var(--border-subtle)] space-y-2">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold">Boîte de réception</h2>
          <button onClick={onNew} className="p-1.5 rounded-lg bg-[var(--brand-tint)] text-[var(--brand-primary)] hover:bg-[var(--brand-primary)] hover:text-white transition-colors cursor-pointer" title="Nouvelle conversation">
            <Mail size={14} />
          </button>
        </div>
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
      <div className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto border-b border-[var(--border-subtle)] no-scrollbar">
        {[{ v: '' as MessageChannel | '', l: 'Tous' }, { v: 'email' as MessageChannel, l: 'Email' }, { v: 'sms' as MessageChannel, l: 'SMS' }, { v: 'webchat' as MessageChannel, l: 'Chat' }, { v: 'facebook' as MessageChannel, l: 'Meta' }].map(f => (
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
  );
}
