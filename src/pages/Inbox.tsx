// ── Page Conversations — Inbox 3 panneaux refondu Sprint Design 2 (D2.2) ──

import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Skeleton, EmptyState, Button } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { getInboxMessages } from '@/lib/api';
import type { Message, MessageChannel } from '@/lib/types';
import { CHANNEL_LABELS, MESSAGE_STATUS_LABELS } from '@/lib/types';
import { Search, Mail, MessageSquare, StickyNote, Star, User, Clock, ChevronRight, Send, Paperclip, FileText, CalendarClock, PanelRightClose, PanelRightOpen, Inbox, StarOff } from 'lucide-react';

type QuickFilter = 'all' | 'unread' | 'starred' | 'mine';

export function InboxPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<MessageChannel | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [composerTab, setComposerTab] = useState<'email' | 'sms' | 'note'>('email');
  const [composerText, setComposerText] = useState('');
  const [starredThreads, setStarredThreads] = useState<Set<string>>(new Set());

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    const result = await getInboxMessages({ channel: channelFilter || undefined, limit: 100 });
    if (result.data) {
      setMessages(result.data);
      if (!selectedThreadId && result.data.length > 0) {
        setSelectedThreadId(result.data[0]!.lead_id);
      }
    }
    setIsLoading(false);
  }, [channelFilter, selectedThreadId]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  // Grouper par lead → threads
  const grouped: Record<string, Message[]> = {};
  messages.forEach(msg => {
    const key = msg.lead_id;
    if (!grouped[key]) grouped[key] = [];
    grouped[key]!.push(msg);
  });

  const threads = Object.entries(grouped)
    .map(([leadId, msgs]) => {
      const sorted = msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const last = sorted[sorted.length - 1]!;
      return {
        leadId, leadName: sorted[0]?.lead_name || 'Inconnu', messages: sorted,
        lastMessage: last, unread: msgs.filter(m => m.status === 'sent' && m.direction === 'inbound').length,
        isStarred: starredThreads.has(leadId),
      };
    })
    .sort((a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime());

  // Filtrage
  const filtered = threads.filter(t => {
    if (quickFilter === 'unread' && t.unread === 0) return false;
    if (quickFilter === 'starred' && !t.isStarred) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return t.leadName.toLowerCase().includes(q) || t.messages.some(m => m.body.toLowerCase().includes(q));
  });

  const selectedThread = filtered.find(t => t.leadId === selectedThreadId) || filtered[0] || null;

  const toggleStar = (leadId: string) => {
    setStarredThreads(prev => { const n = new Set(prev); if (n.has(leadId)) n.delete(leadId); else n.add(leadId); return n; });
  };

  const timeAgo = (d: string): string => {
    const ms = Date.now() - new Date(d + 'Z').getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'maintenant';
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const dd = Math.floor(h / 24);
    if (dd < 7) return `${dd}j`;
    return new Date(d + 'Z').toLocaleDateString('fr-CA');
  };

  const fullDate = (d: string) => {
    const dt = new Date(d + 'Z');
    return dt.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' }) + ' à ' + dt.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  };

  const channelIcon = (ch: MessageChannel) => {
    if (ch === 'email') return <Mail size={12} />;
    if (ch === 'sms') return <MessageSquare size={12} />;
    return <StickyNote size={12} />;
  };

  const totalUnread = threads.reduce((s, t) => s + t.unread, 0);

  return (
    <AppLayout title="Conversations">
      {isLoading ? (
        <div className="flex gap-0 h-[calc(100vh-8rem)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
          <div className="w-80 border-r border-[var(--border-subtle)] p-3 space-y-3"><Skeleton className="h-10" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          <div className="flex-1 p-6"><Skeleton className="h-full" /></div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Inbox size={48} />} title="Aucune conversation" description="Les messages envoyés et reçus apparaîtront ici." />
      ) : (
        <div className="flex h-[calc(100vh-8rem)] border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-surface)]">

          {/* ── Panneau gauche : Threads ── */}
          <div className="w-80 flex-shrink-0 border-r border-[var(--border-subtle)] flex flex-col">
            {/* Header threads */}
            <div className="p-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">Messages</h2>
                  {totalUnread > 0 && (
                    <span className="w-5 h-5 rounded-full bg-[var(--brand-primary)] text-white text-[10px] flex items-center justify-center font-bold">{totalUnread}</span>
                  )}
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">{threads.length} fils</span>
              </div>
              <Input placeholder="Rechercher..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                leftIcon={<Search size={14} />} className="text-xs" />
            </div>

            {/* Quick filters */}
            <div className="flex gap-1 px-3 py-2 border-b border-[var(--border-subtle)]">
              {([['all', 'Tout'], ['unread', 'Non lus'], ['starred', '★'], ['mine', 'Moi']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setQuickFilter(key as QuickFilter)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition-all
                    ${quickFilter === key ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Channel tabs */}
            <div className="flex border-b border-[var(--border-subtle)]">
              {([['', 'Tout'], ['email', '📧'], ['sms', '💬'], ['internal_note', '📝']] as const).map(([ch, icon]) => (
                <button key={ch || 'all'} onClick={() => setChannelFilter(ch as MessageChannel | '')}
                  className={`flex-1 py-2 text-[11px] font-medium cursor-pointer transition-all border-b-2
                    ${channelFilter === ch ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                  {icon}
                </button>
              ))}
            </div>

            {/* Thread list */}
            <div className="flex-1 overflow-y-auto">
              {filtered.map(thread => {
                const isActive = selectedThread?.leadId === thread.leadId;
                const last = thread.lastMessage;
                return (
                  <button key={thread.leadId} onClick={() => setSelectedThreadId(thread.leadId)}
                    className={`w-full text-left px-3 py-3 border-b border-[var(--border-subtle)] transition-all cursor-pointer
                      ${isActive ? 'bg-[var(--brand-tint)] border-l-[3px] border-l-[var(--brand-primary)]' : 'hover:bg-[var(--bg-subtle)]'}`}>
                    <div className="flex items-start gap-2.5">
                      <div className="relative flex-shrink-0">
                        <Avatar name={thread.leadName} size="sm" />
                        {thread.unread > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[var(--brand-primary)] border-2 border-[var(--bg-surface)]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={`text-[13px] truncate ${thread.unread > 0 ? 'font-bold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>
                            {thread.leadName}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 ml-2">{timeAgo(last.created_at)}</span>
                        </div>
                        {last.subject && <p className="text-[11px] font-medium text-[var(--text-secondary)] truncate mb-0.5">{last.subject}</p>}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[var(--text-muted)]">{channelIcon(last.channel)}</span>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">
                            {last.direction === 'outbound' ? 'Vous : ' : ''}
                            {last.body.replace(/<[^>]+>/g, '').slice(0, 50)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Panneau centre : Messages ── */}
          <div className="flex-1 flex flex-col min-w-0">
            {selectedThread ? (
              <>
                {/* Header conversation */}
                <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface)]">
                  <div className="flex items-center gap-3">
                    <Avatar name={selectedThread.leadName} size="md" />
                    <div>
                      <Link to={`/leads/${selectedThread.leadId}`}
                        className="text-sm font-bold text-[var(--text-primary)] hover:text-[var(--brand-primary)] transition-colors flex items-center gap-1">
                        {selectedThread.leadName} <ChevronRight size={14} className="text-[var(--text-muted)]" />
                      </Link>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {selectedThread.messages.length} messages · {CHANNEL_LABELS[selectedThread.lastMessage.channel]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => toggleStar(selectedThread.leadId)}
                      className={`p-2 rounded-lg cursor-pointer transition-all ${selectedThread.isStarred ? 'text-[var(--warning)]' : 'text-[var(--text-muted)] hover:text-[var(--warning)]'}`}>
                      {selectedThread.isStarred ? <Star size={16} fill="currentColor" /> : <StarOff size={16} />}
                    </button>
                    <button onClick={() => setShowRightPanel(!showRightPanel)}
                      className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-all">
                      {showRightPanel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                    </button>
                  </div>
                </div>

                {/* Messages list */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-[var(--bg-canvas)]">
                  {selectedThread.messages.map((msg, i) => {
                    const isOut = msg.direction === 'outbound';
                    const isNote = msg.channel === 'internal_note';
                    const prev = i > 0 ? selectedThread.messages[i - 1] : null;
                    const showDate = !prev || new Date(msg.created_at + 'Z').toDateString() !== new Date(prev.created_at + 'Z').toDateString();

                    return (
                      <div key={msg.id}>
                        {showDate && (
                          <div className="flex items-center gap-3 my-4">
                            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">
                              {new Date(msg.created_at + 'Z').toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}
                            </span>
                            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                          </div>
                        )}
                        {isNote ? (
                          /* Note interne — post-it jaune */
                          <div className="max-w-[85%] mx-auto bg-[var(--warning-soft)] border border-[var(--warning)]/20 rounded-xl p-3">
                            <div className="flex items-center gap-1.5 mb-1">
                              <StickyNote size={12} className="text-[var(--warning)]" />
                              <span className="text-[10px] font-semibold text-[var(--warning)]">Note interne</span>
                            </div>
                            <p className="text-sm text-[var(--text-primary)]">{msg.body.replace(/<[^>]+>/g, '')}</p>
                            <p className="text-[10px] text-[var(--text-muted)] mt-1.5">{fullDate(msg.created_at)}</p>
                          </div>
                        ) : (
                          <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[70%] rounded-2xl p-3.5 ${isOut
                              ? 'bg-[var(--brand-tint)] border border-[var(--brand-primary)]/15 rounded-br-md'
                              : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-bl-md'
                            }`}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-[var(--text-muted)]">{channelIcon(msg.channel)}</span>
                                {msg.subject && <span className="text-[11px] font-semibold text-[var(--text-secondary)]">{msg.subject}</span>}
                              </div>
                              <p className="text-[13px] text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed">
                                {msg.body.replace(/<[^>]+>/g, '')}
                              </p>
                              <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--text-muted)]">
                                <span>{fullDate(msg.created_at)}</span>
                                <Badge color={msg.status === 'delivered' || msg.status === 'read' ? 'var(--success)' : undefined}>
                                  {MESSAGE_STATUS_LABELS[msg.status]}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Composer */}
                <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                  {/* Tab selector */}
                  <div className="flex border-b border-[var(--border-subtle)]">
                    {([['email', Mail, 'Email'], ['sms', MessageSquare, 'SMS'], ['note', StickyNote, 'Note']] as const).map(([tab, Icon, label]) => (
                      <button key={tab} onClick={() => setComposerTab(tab as typeof composerTab)}
                        className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium cursor-pointer transition-all border-b-2
                          ${composerTab === tab ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                        <Icon size={13} /> {label}
                      </button>
                    ))}
                  </div>
                  <div className="p-3">
                    <textarea value={composerText} onChange={e => setComposerText(e.target.value)}
                      rows={3} placeholder={composerTab === 'note' ? 'Ajouter une note interne...' : `Écrire un ${composerTab === 'email' ? 'email' : 'SMS'}...`}
                      className="w-full px-3 py-2.5 text-sm bg-[var(--bg-canvas)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-xl placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1">
                        <button className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-all" title="Template">
                          <FileText size={15} />
                        </button>
                        <button className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-all" title="Pièce jointe">
                          <Paperclip size={15} />
                        </button>
                        <button className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-all" title="Programmer">
                          <CalendarClock size={15} />
                        </button>
                        {composerTab === 'sms' && (
                          <span className="text-[10px] text-[var(--text-muted)] ml-2">{composerText.length}/160</span>
                        )}
                      </div>
                      <Button size="sm" leftIcon={<Send size={13} />}
                        className="!rounded-lg" style={{ background: composerTab === 'note' ? 'var(--warning)' : undefined }}>
                        {composerTab === 'note' ? 'Ajouter note' : 'Envoyer'}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
                <div className="text-center">
                  <Inbox size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Sélectionnez une conversation</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Panneau droit : Contact info (collapsible) ── */}
          {showRightPanel && selectedThread && (
            <div className="w-80 flex-shrink-0 border-l border-[var(--border-subtle)] overflow-y-auto bg-[var(--bg-surface)]">
              {/* Contact card */}
              <div className="p-5 text-center border-b border-[var(--border-subtle)]">
                <Avatar name={selectedThread.leadName} size="lg" />
                <h3 className="text-sm font-bold text-[var(--text-primary)] mt-3">{selectedThread.leadName}</h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{selectedThread.messages[0]?.lead_name || 'Lead'}</p>
                <Link to={`/leads/${selectedThread.leadId}`}
                  className="inline-flex items-center gap-1 text-xs text-[var(--brand-primary)] hover:underline mt-2">
                  <User size={12} /> Voir la fiche complète
                </Link>
              </div>

              {/* Quick info */}
              <div className="p-4 border-b border-[var(--border-subtle)]">
                <h4 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Infos rapides</h4>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Messages</span>
                    <span className="font-medium text-[var(--text-primary)]">{selectedThread.messages.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Non lus</span>
                    <span className="font-medium text-[var(--brand-primary)]">{selectedThread.unread}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Dernier canal</span>
                    <span className="font-medium">{CHANNEL_LABELS[selectedThread.lastMessage.channel]}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Dernier message</span>
                    <span className="font-medium flex items-center gap-1"><Clock size={11} /> {timeAgo(selectedThread.lastMessage.created_at)}</span>
                  </div>
                </div>
              </div>

              {/* Deals placeholder */}
              <div className="p-4 border-b border-[var(--border-subtle)]">
                <h4 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Deals</h4>
                <p className="text-xs text-[var(--text-muted)] italic">Aucun deal lié</p>
              </div>

              {/* Tasks placeholder */}
              <div className="p-4 border-b border-[var(--border-subtle)]">
                <h4 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Tâches</h4>
                <p className="text-xs text-[var(--text-muted)] italic">Aucune tâche</p>
              </div>

              {/* Tags placeholder */}
              <div className="p-4">
                <h4 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Tags</h4>
                <p className="text-xs text-[var(--text-muted)] italic">Aucun tag</p>
              </div>
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
}
