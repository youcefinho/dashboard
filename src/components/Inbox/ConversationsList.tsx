import React from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton, Icon } from '@/components/ui';
import type { Conversation, ConversationStatus, MessageChannel } from '@/lib/types';
import { CONVERSATION_STATUS_LABELS } from '@/lib/types';
import { Search, X, Star, Mail, Phone, Globe, MessageSquare, StickyNote, Archive, Trash2 } from 'lucide-react';
// Sprint 25 vague 5A — Hover preview hook (desktop only, 320ms)
import { useConversationHoverPreview } from '@/components/panels/ConversationHoverPreview';
// Sprint 31 vague 31-1B — Pull-to-refresh sur liste (incompatible layout 3-panneaux global)
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
// Sprint 35 vague 35-2C — Swipe-to-delete sur rows conversations (mobile)
import { SwipeAction } from '@/components/ui/SwipeAction';

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
  className?: string;
  // ── Sprint 24 vague 1B — Bulk-select (Gmail pattern) ────────────
  selectedConvIds?: Set<string>;
  onToggleConvSelect?: (convId: string, e: React.MouseEvent) => void;
  // ── Sprint 31 vague 31-1B — Pull-to-refresh sur la liste (layout 3-panneaux Inbox
  // incompatible PtR page-level → on délègue ici sur container scroll de la liste).
  // Desktop : no-op grâce au pointer detect interne du hook.
  onRefresh?: () => Promise<void>;
  // ── Sprint 35 vague 35-2C — Swipe-to-delete (mobile uniquement, touch events)
  // Si callbacks absents → stubs console.warn (cohérent avec le pattern Tasks).
  onArchive?: (conversationId: string) => void;
  onDelete?: (conversationId: string) => void;
}

export function ConversationsList({
  conversations, isLoading, searchQuery, setSearchQuery,
  statusFilter, setStatusFilter, channelFilter, setChannelFilter,
  statusCounts, selectedConvId, setSelectedConvId, toggleStar, onNew, className = '',
  selectedConvIds, onToggleConvSelect, onRefresh,
  onArchive, onDelete,
}: Props) {
  const bulkActive = (selectedConvIds?.size ?? 0) > 0;

  // ── Sprint 31 vague 31-1B — Pull-to-refresh wiré sur le container scroll de la liste ──
  // Le hook `usePullToRefresh` retourne containerRef à attacher au scrollHost.
  // Le container est lui-même le scroll (pas de scrollParent séparé).
  // Si onRefresh non fourni → disabled (no-op). Desktop : touch events ne fire pas → no-op.
  const ptr = usePullToRefresh(
    async () => { if (onRefresh) await onRefresh(); },
    { disabled: !onRefresh }
  );

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
    <div className={`border-r border-[var(--border-subtle)] flex flex-col bg-[var(--bg-canvas)] min-h-0 ${className}`}>
      {/* Sprint 41 M1.4 — Header + search Stripe-clean */}
      <div className="inbox-list-header">
        <div className="inbox-list-header-row">
          <h2 className="inbox-list-title">Boîte de réception</h2>
          <button
            onClick={onNew}
            className="inbox-list-new-btn"
            title="Nouvelle conversation"
            aria-label="Nouvelle conversation"
          >
            <Icon as={Mail} size="sm" />
          </button>
        </div>
        <div className="inbox-list-search">
          <Icon as={Search} size="sm" className="inbox-list-search-icon" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Rechercher..."
            className="inbox-list-search-input"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="inbox-list-search-clear"
              aria-label="Effacer la recherche"
            >
              <Icon as={X} size="xs" />
            </button>
          )}
        </div>
      </div>

      {/* Sprint 41 M1.4 — Status tabs Stripe-clean (no cyan/orange gradient) */}
      <div className="inbox-list-tabs">
        <div className="segmented-control inbox-list-segmented">
          {(['all', 'open', 'closed', 'snoozed'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`flex-1 ${statusFilter === s ? 'is-active' : ''}`}
            >
              <span className="truncate">{s === 'all' ? 'Toutes' : CONVERSATION_STATUS_LABELS[s]}</span>
              {s !== 'all' && statusCounts[s] ? (
                <span className={`inbox-list-count-chip ${statusFilter === s ? 'is-active' : ''}`}>
                  {statusCounts[s]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Sprint 41 M1.4 — Channel filter chips Stripe-clean */}
      <div className="inbox-list-channels no-scrollbar">
        {[{ v: '' as MessageChannel | '', l: 'Tous' }, { v: 'email' as MessageChannel, l: 'Email' }, { v: 'sms' as MessageChannel, l: 'SMS' }, { v: 'webchat' as MessageChannel, l: 'Chat' }, { v: 'facebook' as MessageChannel, l: 'Meta' }].map(f => {
          const isActive = channelFilter === f.v;
          return (
            <button
              key={f.v}
              onClick={() => setChannelFilter(f.v)}
              className={`inbox-list-channel-chip ${isActive ? 'is-active' : ''}`}
            >
              {f.l}
            </button>
          );
        })}
      </div>

      {/* Conversation list */}
      {/* Sprint 31 vague 31-1B — containerRef + PtR indicator (desktop no-op : touch events ne fire pas) */}
      <div ref={ptr.containerRef} className="flex-1 overflow-y-auto density-list relative">
        <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
        {isLoading ? (
          /* Skeleton matche row réel : avatar + nom/preview + timeago + badge unread */
          <div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 px-3 py-2.5 border-b border-[var(--border-subtle)]"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <Skeleton className="h-9 w-9 rounded-full shrink-0" style={{ animationDelay: `${i * 40}ms` }} />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-3 w-24" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                    <Skeleton className="h-2.5 w-8 shrink-0" style={{ animationDelay: `${i * 40 + 40}ms` }} />
                  </div>
                  <Skeleton className="h-2.5 w-4/5" style={{ animationDelay: `${i * 40 + 60}ms` }} />
                  {i % 3 === 0 && (
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Skeleton className="h-4 w-5 rounded-full" style={{ animationDelay: `${i * 40 + 80}ms` }} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="inbox-list-empty">
            <div className="inbox-list-empty-icon" aria-hidden>
              <Icon as={MessageSquare} size="lg" />
            </div>
            <p className="inbox-list-empty-title">Aucune conversation</p>
            <p className="inbox-list-empty-body">Connecte un canal pour recevoir tes premiers messages.</p>
            {onNew && (
              <button type="button" onClick={onNew} className="inbox-list-empty-cta">
                <Mail size={13} strokeWidth={2} />
                <span>Nouvelle conversation</span>
              </button>
            )}
          </div>
        ) : (
          conversations.map((conv, idx) => {
            const isActive = conv.id === selectedConvId;
            const ChannelIcon = CHANNEL_ICON_MAP[conv.channel] || Mail;
            const hasUnread = conv.unread_count > 0;
            const isBulkSelected = selectedConvIds?.has(conv.id) ?? false;
            // Sprint 25 vague 5A — Hover preview (désactivé pendant bulk-select pour ne pas gêner)
            const hoverPreview = useConversationHoverPreview({
              conversation: conv,
              disabled: bulkActive,
            });
            // ── Sprint 35 vague 35-2C — Actions swipe droite (mobile)
            // rightThreshold 80px cohérent avec Tasks. Stub console.warn si callback absent.
            const handleArchive = () => {
              if (onArchive) onArchive(conv.id);
              else console.warn('[Sprint35-2C] onArchive callback absent pour conv', conv.id);
            };
            const handleDelete = () => {
              if (onDelete) onDelete(conv.id);
              else console.warn('[Sprint35-2C] onDelete callback absent pour conv', conv.id);
            };
            const swipeRightActions = (
              <div className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleArchive(); }}
                  className="inline-flex items-center justify-center w-10 h-10 rounded-full text-white"
                  style={{
                    background: 'linear-gradient(135deg, var(--text-secondary) 0%, var(--text-muted) 100%)',
                    boxShadow: '0 2px 8px rgba(15,23,42,0.20)',
                  }}
                  aria-label="Archiver la conversation"
                  title="Archiver"
                >
                  <Archive size={16} strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                  className="inline-flex items-center justify-center w-10 h-10 rounded-full text-white"
                  style={{
                    background: 'linear-gradient(135deg, #E5484D 0%, #C9303A 100%)',
                    boxShadow: '0 2px 10px rgba(229,72,77,0.45)',
                  }}
                  aria-label="Supprimer la conversation"
                  title="Supprimer"
                >
                  <Trash2 size={16} strokeWidth={2.2} />
                </button>
              </div>
            );
            return (
              <React.Fragment key={conv.id}>
              {hoverPreview.preview}
              <SwipeAction
                rightActions={swipeRightActions}
                rightThreshold={80}
                rightBg="rgba(229,72,77,0.85)"
              >
              <button
                onMouseEnter={hoverPreview.onMouseEnter}
                onMouseLeave={hoverPreview.onMouseLeave}
                onClick={(e) => {
                  // Sprint 24 vague 1B — Gmail pattern : shift+click enters bulk mode
                  if (e.shiftKey && onToggleConvSelect) {
                    e.preventDefault();
                    onToggleConvSelect(conv.id, e);
                    return;
                  }
                  // Si bulk-select déjà actif : clic = toggle select (pas ouvrir conv)
                  if (bulkActive && onToggleConvSelect) {
                    e.preventDefault();
                    onToggleConvSelect(conv.id, e);
                    return;
                  }
                  setSelectedConvId(conv.id);
                }}
                className={`group inbox-list-row list-item-enter ${isActive && !isBulkSelected ? 'is-active' : ''} ${isBulkSelected ? 'bulk-selected-row' : ''}`}
                style={{ animationDelay: `${Math.min(idx, 15) * 25}ms` }}
              >
                {/* Sprint 41 M1.4 — Unread dot Stripe-clean primary solid */}
                {hasUnread && !isActive && !isBulkSelected && (
                  <span className="inbox-list-row-unread-dot" aria-hidden />
                )}
                {/* Sprint 24 vague 1B — Hover-checkbox Gmail-style */}
                {onToggleConvSelect && (
                  <span
                    role="presentation"
                    onClick={(e) => { e.stopPropagation(); onToggleConvSelect(conv.id, e); }}
                    className={`shrink-0 mt-1 flex items-center justify-center w-5 h-5 rounded transition-opacity ${isBulkSelected || bulkActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}
                  >
                    <input
                      type="checkbox"
                      checked={isBulkSelected}
                      onChange={() => { /* noop */ }}
                      className="rounded cursor-pointer accent-[var(--primary)] w-4 h-4"
                      aria-label={`Sélectionner la conversation avec ${conv.lead_name || 'Inconnu'}`}
                      tabIndex={-1}
                    />
                  </span>
                )}
                <Avatar name={conv.lead_name || '?'} size="sm" />
                <div className="inbox-list-row-body">
                  <div className="inbox-list-row-line1">
                    <span className={`inbox-list-row-name ${hasUnread ? 'is-unread' : ''}`}>
                      {conv.lead_name || 'Inconnu'}
                    </span>
                    <span className={`inbox-list-row-time ${hasUnread ? 'is-unread' : ''}`}>
                      {timeAgo(conv.last_message_at)}
                    </span>
                  </div>
                  <div className="inbox-list-row-preview">
                    <ChannelIcon size={10} className="inbox-list-row-channel-icon" />
                    <p className={`inbox-list-row-preview-text ${hasUnread ? 'is-unread' : ''}`}>
                      {conv.last_message_preview || '—'}
                    </p>
                  </div>
                  <div className="inbox-list-row-meta">
                    {hasUnread && (
                      <span className="inbox-list-row-unread-badge">
                        {conv.unread_count}
                      </span>
                    )}
                    {conv.is_starred ? (
                      <button onClick={(e) => void toggleStar(conv, e)} className="inbox-list-row-star" aria-label="Retirer le marquage étoilé" aria-pressed="true">
                        <Star size={10} className="text-[var(--warning)] fill-[var(--warning)]" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </button>
              </SwipeAction>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
