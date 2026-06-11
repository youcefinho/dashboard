// ── Page Conversations — Sprint 3 Vertical Conversations ────
// Architecture 3 panneaux : liste conversations | fil messages | info lead

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tag, Skeleton, BulkActionBar, AppliedFiltersBar, type FilterDescriptor, Icon, useToast, EmptyStateIllustration, EmptyState } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';

import { getConversations, getConversation, sendConversationMessage, updateConversation, getSnippets, getTemplates, markConversationRead, aiSummarizeConversation, addTag } from '@/lib/api';
import type { Conversation, Message, ConversationStatus, MessageChannel, Snippet, EmailTemplate } from '@/lib/types';
import { CHANNEL_LABELS, CONVERSATION_STATUS_LABELS, CONVERSATION_STATUS_COLORS } from '@/lib/types';
import { MessageSquare, CheckCircle2, Pause, Star, StarOff, PanelRightClose, PanelRightOpen, Inbox, ArrowLeft, Sparkles, Loader2, X as XIcon, Archive, MailOpen, Ban, Trash2, CheckCheck, Clock, Plus } from 'lucide-react';

import { ConversationsList } from '@/components/Inbox/ConversationsList';
import { MessageThread } from '@/components/Inbox/MessageThread';
import { MessageComposer } from '@/components/Inbox/MessageComposer';
import { InboxPanel } from '@/components/Inbox/InboxPanel';
import { NewConversationPane } from '@/components/Inbox/NewConversationPane';
import { useConversationWs } from '@/hooks/useConversationWs';
import { useShortcuts } from '@/hooks/useShortcuts';
import { triggerHaptic, playSound } from '@/lib/sensorial';
import { announceSR } from '@/lib/announce';
// Sprint 44 M2.3 — Outbox messages offline-first
import { enqueueOutbound, subscribeOutbox, retryOutboxItem } from '@/lib/messageQueue';
import type { OutboxMessage } from '@/lib/offline/db';
// Sprint 48 M3.1 — Intl.PluralRules locale-aware
import { plural } from '@/lib/i18n/plural';
import { getLocale, t } from '@/lib/i18n';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu';
// Sprint 45 M3.2 — Coachmark contextuel (1ère ouverture composer → slash-vars hint)
import { ContextualCoachmark } from '@/components/onboarding/ContextualCoachmark';
// Sprint 49 M3.1 — Auto-tagging conversations (suggestion only, Loi 25 friendly)
import { classifyConversation, CONVERSATION_TAG_LABELS, type ConversationTag } from '@/lib/autoTag';

export function InboxPage() {
  const toast = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<MessageChannel | ''>('');
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | 'all'>('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<(Conversation & { messages: Message[] }) | null>(null);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isComposingNew, setIsComposingNew] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  // Sprint 20 : AI summarize
  const [aiSummary, setAiSummary] = useState<string[] | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  // Sprint 49 M3.1 — Tags suggérés par IA (suggestion only — l'utilisateur
  // confirme pour appliquer ; dismissible. Aucun auto-apply : Loi 25).
  const [suggestedConvTags, setSuggestedConvTags] = useState<ConversationTag[]>([]);
  const [isClassifyingConv, setIsClassifyingConv] = useState(false);
  const [dismissedConvTags, setDismissedConvTags] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sprint 44 M3.1 — Swipe-to-reply state (mobile gesture sur MessageBubble)
  const [replyTo, setReplyTo] = useState<{ messageId: string; name: string; preview: string } | null>(null);

  // Auto-clear le reply mode si on change de conversation
  useEffect(() => { setReplyTo(null); }, [selectedConvId]);

  // Sprint 44 M2.3 — Outbox messages pour conversation courante (offline send queue)
  const [outboxMessages, setOutboxMessages] = useState<OutboxMessage[]>([]);
  useEffect(() => {
    if (!selectedConvId) {
      setOutboxMessages([]);
      return;
    }
    const unsub = subscribeOutbox(selectedConvId, setOutboxMessages, 1500);
    return unsub;
  }, [selectedConvId]);

  // Handler retry manuel d'un message en outbox 'failed'
  const handleRetryOutbox = useCallback(async (outboxId: string) => {
    await retryOutboxItem(outboxId);
    toast.info(t('inbox.toast.requeued'));
  }, [toast]);

  // ── Sprint 41 M3.3 — Track previous count for new-message announce SR ──
  const prevUnreadTotalRef = useRef<number>(0);
  // Sprint 41 M3.3 — track previous message count par conv pour announce arrivee
  const prevMessagesLenRef = useRef<number>(0);

  // ── Sprint 24 vague 1B — Bulk-select conversations (Gmail pattern) ─────────
  const [selectedConvIds, setSelectedConvIds] = useState<Set<string>>(new Set());
  const [lastSelectedConvId, setLastSelectedConvId] = useState<string | null>(null);

  const toggleConvSelect = useCallback((convId: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastSelectedConvId) {
      // Range select dans la liste actuelle
      const ids = conversations.map(c => c.id);
      const i1 = ids.indexOf(lastSelectedConvId);
      const i2 = ids.indexOf(convId);
      if (i1 >= 0 && i2 >= 0) {
        const [from, to] = i1 < i2 ? [i1, i2] : [i2, i1];
        setSelectedConvIds(prev => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(ids[i]!);
          return next;
        });
        return;
      }
    }
    setSelectedConvIds(prev => {
      const next = new Set(prev);
      if (next.has(convId)) next.delete(convId);
      else next.add(convId);
      return next;
    });
    setLastSelectedConvId(convId);
  }, [conversations, lastSelectedConvId]);

  const clearConvSelection = useCallback(() => {
    setSelectedConvIds(new Set());
    setLastSelectedConvId(null);
  }, []);

  // (Esc clear bulk : géré dans useShortcuts plus bas — refactor Sprint 41 M3.1)

  // Préserver la sélection lors d'un filter change : on retire seulement les IDs
  // qui ne sont plus présents dans la liste filtrée (Gmail behavior).
  useEffect(() => {
    if (selectedConvIds.size === 0) return;
    const visibleIds = new Set(conversations.map(c => c.id));
    setSelectedConvIds(prev => {
      const next = new Set<string>();
      for (const id of prev) if (visibleIds.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [conversations]); // eslint-disable-line react-hooks/exhaustive-deps

  const bulkMarkRead = async () => {
    const ids = Array.from(selectedConvIds);
    const n = ids.length;
    setConversations(prev => prev.map(c => ids.includes(c.id) ? { ...c, unread_count: 0 } : c));
    for (const id of ids) await markConversationRead(id);
    clearConvSelection();
    toast.success(plural(getLocale(), n, { one: t('inbox.bulk.read_one'), other: t('inbox.bulk.read_other') }));
  };
  const bulkArchive = async () => {
    const ids = Array.from(selectedConvIds);
    const n = ids.length;
    for (const id of ids) await updateConversation(id, { status: 'closed' });
    clearConvSelection();
    void loadConversations();
    toast.info(plural(getLocale(), n, { one: t('inbox.bulk.archived_one'), other: t('inbox.bulk.archived_other') }));
  };
  const bulkSnooze = async () => {
    const ids = Array.from(selectedConvIds);
    const n = ids.length;
    for (const id of ids) await updateConversation(id, { status: 'snoozed' });
    clearConvSelection();
    void loadConversations();
    toast.info(plural(getLocale(), n, { one: t('inbox.bulk.snoozed_one'), other: t('inbox.bulk.snoozed_other') }));
  };
  const bulkDelete = async () => {
    const ids = Array.from(selectedConvIds);
    const n = ids.length;
    setConversations(prev => prev.filter(c => !ids.includes(c.id)));
    if (selectedConvId && ids.includes(selectedConvId)) setSelectedConvId(null);
    for (const id of ids) await updateConversation(id, { status: 'closed' });
    clearConvSelection();
    void loadConversations();
    toast.warning(plural(getLocale(), n, { one: t('inbox.bulk.deleted_one'), other: t('inbox.bulk.deleted_other') }));
  };

  // Reset le résumé quand on change de conversation
  useEffect(() => { setAiSummary(null); }, [selectedConvId]);
  // Sprint 49 M3.1 — Reset les suggestions de tags au changement de conv
  useEffect(() => {
    setSuggestedConvTags([]);
    setDismissedConvTags(new Set());
  }, [selectedConvId]);

  // ── Sprint 23 wave 43 — Long-press contextual menu (mobile uniquement) ──
  // Event-delegation sur le wrapper de la liste : on détecte la row touchée,
  // démarre un timer 550ms, et ouvre un DropdownMenu positionné au touch point.
  // Désactivé si pointer != coarse (desktop).
  const [ctxMenu, setCtxMenu] = useState<{ convId: string; x: number; y: number } | null>(null);
  const listWrapperRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  useEffect(() => {
    const wrapper = listWrapperRef.current;
    if (!wrapper) return;
    const isCoarse =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarse) return; // desktop : on désactive complètement

    const cancel = () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      touchStartPos.current = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Trouver le bouton row le plus proche dans la liste des convs
      const row = target.closest('.density-list > button') as HTMLButtonElement | null;
      if (!row) return;
      const list = row.parentElement;
      if (!list) return;
      const rowButtons = Array.from(list.querySelectorAll<HTMLButtonElement>(':scope > button'));
      const idx = rowButtons.indexOf(row);
      const conv = conversationsRef.current[idx];
      if (!conv) return;
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      longPressTimer.current = setTimeout(() => {
        // Sprint 25 vague 4B — centralisé via triggerHaptic (respecte settings + reduced-motion)
        triggerHaptic('light');
        setCtxMenu({ convId: conv.id, x: touch.clientX, y: touch.clientY });
      }, 550);
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || !touchStartPos.current) return;
      const dx = touch.clientX - touchStartPos.current.x;
      const dy = touch.clientY - touchStartPos.current.y;
      if (Math.hypot(dx, dy) > 10) cancel();
    };

    wrapper.addEventListener('touchstart', onTouchStart, { passive: true });
    wrapper.addEventListener('touchmove', onTouchMove, { passive: true });
    wrapper.addEventListener('touchend', cancel, { passive: true });
    wrapper.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      wrapper.removeEventListener('touchstart', onTouchStart);
      wrapper.removeEventListener('touchmove', onTouchMove);
      wrapper.removeEventListener('touchend', cancel);
      wrapper.removeEventListener('touchcancel', cancel);
      cancel();
    };
  }, []);

  const handleCtxArchive = async () => {
    if (!ctxMenu) return;
    const id = ctxMenu.convId;
    setCtxMenu(null);
    await updateConversation(id, { status: 'closed' });
    void loadConversations();
  };
  const handleCtxMarkUnread = async () => {
    if (!ctxMenu) return;
    const id = ctxMenu.convId;
    setCtxMenu(null);
    // Approche optimiste : on incrémente unread_count local; le backend ne supporte
    // pas un "mark-unread" explicite, donc on met à jour le state visuellement
    // et on bascule le status pour "open" si fermé.
    setConversations(prev => prev.map(c => c.id === id ? { ...c, unread_count: Math.max(c.unread_count || 0, 1) } : c));
    await updateConversation(id, { status: 'open' });
    void loadConversations();
  };
  const handleCtxMarkSpam = async () => {
    if (!ctxMenu) return;
    const id = ctxMenu.convId;
    setCtxMenu(null);
    // Pas de status "spam" canonique → on snooze pour sortir de l'inbox
    await updateConversation(id, { status: 'snoozed' });
    void loadConversations();
  };
  const handleCtxDelete = async () => {
    if (!ctxMenu) return;
    const id = ctxMenu.convId;
    setCtxMenu(null);
    // Pas d'endpoint delete — fallback : close + retire localement
    setConversations(prev => prev.filter(c => c.id !== id));
    if (selectedConvId === id) setSelectedConvId(null);
    await updateConversation(id, { status: 'closed' });
    void loadConversations();
  };

  const handleSummarize = async () => {
    if (!selectedConvId || isSummarizing) return;
    setIsSummarizing(true);
    const res = await aiSummarizeConversation(selectedConvId);
    setIsSummarizing(false);
    if (res.data?.summary) setAiSummary(res.data.summary);
  };

  // ── Sprint 49 M3.1 — Classifier la conversation (tags suggérés) ─────
  // Suggestion uniquement : on n'écrit JAMAIS le tag sans action user
  // explicite (transparence IA — Loi 25). Fallback keyword local si API down.
  const handleClassifyConv = useCallback(async () => {
    if (!selectedConvId || isClassifyingConv || !activeConv) return;
    setIsClassifyingConv(true);
    const lastMessages = (activeConv.messages || [])
      .slice(-12)
      .map(m => `${m.direction === 'outbound' ? 'Nous' : (m.sender_name || 'Client')}: ${m.body}`);
    const res = await classifyConversation(selectedConvId, lastMessages);
    setIsClassifyingConv(false);
    setSuggestedConvTags(res.tags.filter(t => !dismissedConvTags.has(t)));
  }, [selectedConvId, isClassifyingConv, activeConv, dismissedConvTags]);

  // Applique un tag suggéré au lead lié (action user explicite = confirmation)
  const applySuggestedConvTag = useCallback(async (tag: ConversationTag) => {
    const leadId = activeConv?.lead_id;
    if (!leadId) {
      toast.warning(t('inbox.tag.no_lead'));
      return;
    }
    setSuggestedConvTags(prev => prev.filter(t => t !== tag));
    const res = await addTag(leadId, tag);
    if (res.error) toast.error(t('inbox.tag.apply_error', { err: res.error }));
    else toast.success(t('inbox.tag.applied', { tag: CONVERSATION_TAG_LABELS[tag] }));
  }, [activeConv?.lead_id, toast]);

  const dismissSuggestedConvTag = useCallback((tag: ConversationTag) => {
    setSuggestedConvTags(prev => prev.filter(t => t !== tag));
    setDismissedConvTags(prev => new Set(prev).add(tag));
  }, []);

  // Auto-classification : déclenchée quand la conv chargée a un dernier
  // message ENTRANT (inbound) — pattern "sur nouveau message inbound".
  useEffect(() => {
    if (!activeConv || !selectedConvId) return;
    const msgs = activeConv.messages || [];
    const last = msgs[msgs.length - 1];
    if (last && last.direction === 'inbound' && suggestedConvTags.length === 0 && !isClassifyingConv) {
      void handleClassifyConv();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.id, activeConv?.messages?.length]);

  // Sprint 20 — Retry d'un message failed : retire le failed du fil + renvoie
  // Sprint 44 M2.3 — Si l'id correspond à un message outbox (préfixe 'outbox-'),
  // on retry via retryOutboxItem (status 'failed' → 'queued' → flush) sans
  // re-créer un optimistic dans le thread (déjà visible via subscribeOutbox).
  const handleRetry = (failedId: string, body: string) => {
    if (failedId.startsWith('outbox-')) {
      const outboxId = failedId.slice('outbox-'.length);
      void handleRetryOutbox(outboxId);
      // Si online, déclenche un flush immédiat
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const token = localStorage.getItem('intralys_token');
        if (token) {
          // best effort — le hook listener 'online' couvre déjà la majorité des cas
          void import('@/lib/messageQueue').then(({ flushOutbox }) => {
            void flushOutbox('/api', token);
          });
        }
      }
      return;
    }
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
  const combinedMessages = useMemo(() => {
    const base = [...(activeConv?.messages || []), ...wsMessages].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);

    // Sprint 44 M2.3 — Injecte les outbox messages restants (queued/failed) qui
    // ne sont pas déjà mappés à un tmp message visible. Si un outbox a un
    // tmp_message_id qui matche un message existant, on met juste à jour son
    // status — sinon on ajoute un message "virtuel" en fin de thread.
    const tmpIds = new Set(base.map(m => m.id));
    const augmented = base.map(m => {
      const outbox = outboxMessages.find(o => o.tmp_message_id === m.id);
      if (!outbox) return m;
      // Map outbox status → Message status pour affichage MessageThread
      const msgStatus: Message['status'] =
        outbox.status === 'failed' ? 'failed' : 'sending';
      return { ...m, status: msgStatus };
    });
    // Outbox sans tmp encore associé (ex. : crashed before optimistic added) →
    // synthétiser un message virtuel pour ne rien perdre côté UI.
    const orphanOutbox: Message[] = outboxMessages
      .filter(o => !o.tmp_message_id || !tmpIds.has(o.tmp_message_id))
      .map(o => ({
        id: `outbox-${o.id}`,
        lead_id: activeConv?.lead_id || '',
        client_id: activeConv?.client_id || '',
        conversation_id: o.conversationId,
        direction: 'outbound' as Message['direction'],
        channel: o.channel as Message['channel'],
        subject: '',
        body: o.body,
        status: (o.status === 'failed' ? 'failed' : 'sending') as Message['status'],
        sent_by: 'me',
        external_id: '',
        metadata: '',
        created_at: new Date(o.created_at).toISOString(),
        sender_name: t('inbox.you'),
      }));
    return [...augmented, ...orphanOutbox];
  }, [activeConv, wsMessages, outboxMessages]);

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
    if (!selectedConvId) { setActiveConv(null); setIsLoadingThread(false); return; }
    setIsLoadingThread(true);
    void (async () => {
      const res = await getConversation(selectedConvId);
      if (res.data) {
        setActiveConv(res.data);
        if (res.data.unread_count && res.data.unread_count > 0) {
          await markConversationRead(selectedConvId);
          setConversations(prev => prev.map(c => c.id === selectedConvId ? { ...c, unread_count: 0 } : c));
        }
      }
      setIsLoadingThread(false);
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
  const handleSend = async (bodyOverride?: string, isNoteOverride?: boolean, scheduledAtOverride?: string) => {
    const text = (bodyOverride ?? composerText).trim();
    if (!text || !selectedConvId || !activeConv) return;
    const tmpId = `tmp-${crypto.randomUUID()}`;
    const optimisticMsg: Message = {
      id: tmpId,
      lead_id: activeConv.lead_id || '',
      client_id: activeConv.client_id || '',
      conversation_id: selectedConvId,
      direction: 'outbound',
      channel: isNoteOverride ? 'internal_note' : activeConv.channel,
      subject: '',
      body: text,
      status: scheduledAtOverride ? 'scheduled' as Message['status'] : 'sending' as Message['status'],
      sent_by: 'me',
      external_id: '',
      metadata: '',
      created_at: new Date().toISOString(),
      sender_name: t('inbox.you'),
    };
    // Affichage instantané + clear composer (uniquement si saisi par user, pas en retry)
    setActiveConv(prev => prev ? { ...prev, messages: [...(prev.messages || []), optimisticMsg] } : prev);
    if (bodyOverride === undefined) {
      setComposerText('');
      // Sprint 44 M3.1 — clear reply mode après envoi user (pas en retry)
      setReplyTo(null);
    }
    setIsSending(true);

    // Si Webchat, on envoie via WS (déjà optimistic via le backend WS pour le serveur)
    if (activeConv.channel === 'webchat' && !isNoteOverride && !scheduledAtOverride) {
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
      // Sprint 44 M2.3 — Offline-first : si pas de réseau, enqueue dans outbox.
      if (!navigator.onLine && !scheduledAtOverride) {
        try {
          await enqueueOutbound({
            conversationId: selectedConvId,
            channel: isNoteOverride ? 'internal_note' : activeConv.channel,
            body: text,
            tmpMessageId: tmpId,
          });
          // On laisse le message optimistic visible avec status 'sending' → mapping
          // visuel "En attente d'envoi" via outboxMessages state (rendu plus bas).
          toast.info(t('inbox.toast.queued_title'), {
            message: t('inbox.toast.queued_body'),
          });
        } catch {
          // Si IndexedDB casse → fail explicite
          setActiveConv(prev => prev ? {
            ...prev,
            messages: (prev.messages || []).map(m => m.id === tmpId ? { ...m, status: 'failed' as Message['status'] } : m)
          } : prev);
          toast.error(t('inbox.toast.storage_error'), {
            action: { label: t('inbox.toast.retry'), onClick: () => void handleSend(text, isNoteOverride, scheduledAtOverride) },
          });
        }
        setIsSending(false);
        return;
      }

      // API REST classique
      const res = await sendConversationMessage(selectedConvId, {
        body: text,
        channel: isNoteOverride ? 'internal_note' : undefined,
        scheduledAt: scheduledAtOverride,
      });
      if (res.error || !res.data?.success) {
        // Sprint 44 M2.3 — Si erreur réseau (TypeError/network), enqueue plutôt
        if (!navigator.onLine && !scheduledAtOverride) {
          try {
            await enqueueOutbound({
              conversationId: selectedConvId,
              channel: isNoteOverride ? 'internal_note' : activeConv.channel,
              body: text,
              tmpMessageId: tmpId,
            });
            toast.info(t('inbox.toast.queued_title'), {
              message: t('inbox.toast.queued_body'),
            });
            setIsSending(false);
            return;
          } catch { /* fall through au failed */ }
        }
        // Marquer le message optimistic comme "failed" pour retry
        setActiveConv(prev => prev ? {
          ...prev,
          messages: (prev.messages || []).map(m => m.id === tmpId ? { ...m, status: 'failed' as Message['status'] } : m)
        } : prev);
        // Sprint 41 M3.3 — Toast échec + CTA Réessayer
        toast.error(t('inbox.toast.send_error'), {
          action: { label: t('inbox.toast.retry'), onClick: () => void handleSend(text, isNoteOverride, scheduledAtOverride) },
        });
      } else {
        // Recharger la conversation pour récupérer l'ID réel du message et le statut serveur
        const updated = await getConversation(selectedConvId);
        if (updated.data) {
          // Remplacer le tmp par les vrais messages du serveur
          setActiveConv(updated.data);
        }
        void loadConversations();
        
        if (scheduledAtOverride) {
          toast.success(t('inbox.toast.scheduled'));
        } else {
          toast.success(t('inbox.toast.sent'));
        }
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

  // ── Sprint 41 M3.1 — Keyboard shortcuts (Gmail-style) ────────────────────
  // j/k : nav conv suivante/précédente · r : focus composer · e : archive
  // Escape : clear bulk-select OU deselect conv · Cmd+Enter : send (textarea OK)
  const selectedIndex = useMemo(() => {
    if (!selectedConvId) return -1;
    return conversations.findIndex(c => c.id === selectedConvId);
  }, [conversations, selectedConvId]);

  const focusComposer = useCallback(() => {
    // Target le textarea du MessageComposer (data via .composer-wrap structure)
    const ta = document.querySelector<HTMLTextAreaElement>('.composer-wrap textarea');
    if (ta) {
      ta.focus();
      // Curseur en fin pour reprendre l'écriture
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }, []);

  const archiveCurrentConv = useCallback(async () => {
    if (!selectedConvId) return;
    const id = selectedConvId;
    await updateConversation(id, { status: 'closed' });
    setConversations(prev => prev.filter(c => c.id !== id));
    setSelectedConvId(null);
    toast.info(t('inbox.bulk.archived_one'), {
      action: {
        label: t('inbox.action.undo'),
        onClick: () => {
          void updateConversation(id, { status: 'open' });
          void loadConversations();
        },
      },
      duration: 5000,
    });
    void loadConversations();
  }, [selectedConvId, toast, loadConversations]);

  useShortcuts({
    'j': () => {
      if (conversations.length === 0 || isComposingNew) return;
      const next = Math.min(selectedIndex + 1, conversations.length - 1);
      const nextConv = conversations[next];
      if (nextConv) setSelectedConvId(nextConv.id);
    },
    'k': () => {
      if (conversations.length === 0 || isComposingNew) return;
      const prev = Math.max(selectedIndex - 1, 0);
      const prevConv = conversations[prev];
      if (prevConv) setSelectedConvId(prevConv.id);
    },
    'r': () => {
      if (!activeConv || isComposingNew) return;
      focusComposer();
    },
    'e': () => {
      if (!activeConv || isComposingNew) return;
      void archiveCurrentConv();
    },
    'Escape': () => {
      if (selectedConvIds.size > 0) {
        clearConvSelection();
        return;
      }
      if (isComposingNew) {
        setIsComposingNew(false);
        return;
      }
      if (selectedConvId) {
        setSelectedConvId(null);
      }
    },
    'Cmd+Enter': () => {
      // Marche dans textarea grâce au modifier (cf. useShortcuts)
      if (!activeConv || isSending) return;
      if (composerText.trim().length === 0) return;
      void handleSend();
    },
  });

  // ── Sprint 41 M3.3 + M3.4 — announce SR nouveau message arrivé ──
  // Quand le nombre de messages augmente sur conv active, annoncer le dernier
  // inbound (si direction = inbound — pas un envoi user).
  useEffect(() => {
    const len = combinedMessages.length;
    if (len > prevMessagesLenRef.current && prevMessagesLenRef.current > 0) {
      const last = combinedMessages[len - 1];
      if (last && last.direction === 'inbound') {
        const sender = last.sender_name || activeConv?.lead_name || t('inbox.sender_fallback');
        announceSR(t('inbox.sr.new_message', { sender }), 'polite');
      }
    }
    prevMessagesLenRef.current = len;
  }, [combinedMessages, activeConv?.lead_name]);

  // Sprint 41 M3.4 — announce changement de conv (SR feedback)
  useEffect(() => {
    if (activeConv?.lead_name) {
      announceSR(t('inbox.sr.conv_opened', { name: activeConv.lead_name }), 'polite');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.id]);

  // Track total unread count for SR badge changes
  useEffect(() => {
    const total = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    if (total > prevUnreadTotalRef.current && prevUnreadTotalRef.current > 0) {
      announceSR(plural(getLocale(), total, { one: t('inbox.sr.unread_one', { n: total }), other: t('inbox.sr.unread_other', { n: total }) }), 'polite');
    }
    prevUnreadTotalRef.current = total;
  }, [conversations]);

  // ── Render ────────────────────────────────────────────────
  return (
    <AppLayout title={t('inbox.page.title')}>
      <div className="flex h-[calc(100vh-64px)] -m-6 overflow-hidden animate-stagger stagger-1">
        <div ref={listWrapperRef} className={`flex flex-col shrink-0 ${selectedConvId || isComposingNew ? 'hidden md:flex md:w-80' : 'flex-1 md:w-80 md:flex-none'}`}>
          {/* Sprint 24 vague 1B — BulkActionBar conversations (Gmail) */}
          {selectedConvIds.size > 0 && (
            <BulkActionBar
              selectedCount={selectedConvIds.size}
              onClear={clearConvSelection}
              actions={[
                { id: 'read', label: t('inbox.bulk.mark_read'), icon: <CheckCheck size={13} />, onClick: () => void bulkMarkRead() },
                { id: 'archive', label: t('inbox.bulk.archive'), icon: <Icon as={Archive} size={13} />, onClick: () => void bulkArchive() },
                { id: 'snooze', label: t('inbox.bulk.snooze'), icon: <Clock size={13} />, onClick: () => void bulkSnooze() },
                { id: 'delete', label: t('inbox.bulk.delete'), icon: <Trash2 size={13} />, variant: 'danger', onClick: () => void bulkDelete() },
              ]}
            />
          )}
          {/* Sprint 24 vague 2 — Filtres actifs en chips (status + channel) */}
          {(statusFilter !== 'open' || channelFilter !== '') && (
            <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
              <AppliedFiltersBar
                filters={[
                  ...(statusFilter !== 'open' ? [{
                    id: 'status',
                    label: t('inbox.filter.status'),
                    value: statusFilter === 'all' ? t('inbox.filter.all') : CONVERSATION_STATUS_LABELS[statusFilter as ConversationStatus] || statusFilter,
                    onRemove: () => setStatusFilter('open'),
                  } as FilterDescriptor] : []),
                  ...(channelFilter !== '' ? [{
                    id: 'channel',
                    label: t('inbox.filter.channel'),
                    value: CHANNEL_LABELS[channelFilter as MessageChannel] || channelFilter,
                    onRemove: () => setChannelFilter(''),
                  } as FilterDescriptor] : []),
                ]}
                onClearAll={() => { setStatusFilter('open'); setChannelFilter(''); }}
              />
            </div>
          )}
          <ConversationsList
            className="flex-1 w-full"
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
            selectedConvIds={selectedConvIds}
            onToggleConvSelect={toggleConvSelect}
            // ── Sprint 31 vague 31-1B — PtR sur liste (mobile) + haptic/sound ──
            onRefresh={async () => {
              triggerHaptic('medium');
              await loadConversations();
              playSound('success');
            }}
          />
        </div>

        {/* Long-press contextual menu (mobile) */}
        {ctxMenu && (
          <DropdownMenuRoot open={true} onOpenChange={(o) => { if (!o) setCtxMenu(null); }}>
            <DropdownMenuTrigger asChild>
              <span
                aria-hidden
                style={{
                  position: 'fixed',
                  left: ctxMenu.x,
                  top: ctxMenu.y,
                  width: 1,
                  height: 1,
                  pointerEvents: 'none',
                }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" sideOffset={4}>
              <DropdownMenuLabel>{t('inbox.ctx.conversation')}</DropdownMenuLabel>
              <DropdownMenuItem leftIcon={<Archive size={14} />} onSelect={() => void handleCtxArchive()}>
                {t('inbox.ctx.archive')}
              </DropdownMenuItem>
              <DropdownMenuItem leftIcon={<MailOpen size={14} />} onSelect={() => void handleCtxMarkUnread()}>
                {t('inbox.ctx.mark_unread')}
              </DropdownMenuItem>
              <DropdownMenuItem leftIcon={<Ban size={14} />} onSelect={() => void handleCtxMarkSpam()}>
                {t('inbox.ctx.mark_spam')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" leftIcon={<Trash2 size={14} />} onSelect={() => void handleCtxDelete()}>
                {t('inbox.ctx.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>
        )}

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
          {isLoadingThread && !activeConv ? (
            /* Skeleton matche le layout thread : header + bulles alternées + composer */
            <div aria-busy="true" aria-live="polite" className="contents">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-32" style={{ animationDelay: '40ms' }} />
                    <Skeleton className="h-2.5 w-40" style={{ animationDelay: '80ms' }} />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Skeleton className="h-7 w-20 rounded-lg" style={{ animationDelay: '120ms' }} />
                  <Skeleton className="h-7 w-7 rounded-lg" style={{ animationDelay: '160ms' }} />
                  <Skeleton className="h-7 w-7 rounded-lg" style={{ animationDelay: '200ms' }} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {[
                  { side: 'left', width: '60%' },
                  { side: 'right', width: '50%' },
                  { side: 'left', width: '72%' },
                  { side: 'right', width: '45%' },
                  { side: 'left', width: '38%' },
                ].map((b, i) => (
                  <div
                    key={i}
                    className={`flex ${b.side === 'right' ? 'justify-end' : 'justify-start'}`}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="flex items-end gap-2 max-w-[70%]" style={{ flexDirection: b.side === 'right' ? 'row-reverse' : 'row' }}>
                      {b.side === 'left' && <Skeleton className="h-6 w-6 rounded-full shrink-0" style={{ animationDelay: `${i * 60}ms` }} />}
                      <Skeleton
                        className={b.side === 'right' ? 'h-12 rounded-2xl rounded-br-sm' : 'h-12 rounded-2xl rounded-bl-sm'}
                        style={{ width: b.width, animationDelay: `${i * 60 + 30}ms` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
                <Skeleton className="h-10 w-full rounded-lg" style={{ animationDelay: '320ms' }} />
              </div>
            </div>
          ) : !activeConv ? (
            <div className="inbox-empty-center">
              {conversations.length === 0 ? (
                <EmptyState
                  className="inbox-empty-card"
                  illustration={<EmptyStateIllustration kind="inbox" size={160} />}
                  title={t('inbox.empty.none_title')}
                  description={t('inbox.empty.none_body')}
                  action={
                    <button
                      type="button"
                      onClick={() => { setSelectedConvId(null); setIsComposingNew(true); }}
                      className="inbox-empty-cta"
                    >
                      <Plus size={14} strokeWidth={2} />
                      <span>{t('inbox.empty.new_message')}</span>
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  className="inbox-empty-card"
                  icon={<MessageSquare size={48} strokeWidth={1.5} />}
                  title={t('inbox.empty.select_title')}
                  description={t('inbox.empty.select_body')}
                />
              )}
            </div>
          ) : (
            <>
              {/* Header conversation */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    className="md:hidden p-1.5 -ml-2 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] rounded-lg transition-colors cursor-pointer shrink-0"
                    onClick={() => setSelectedConvId(null)}
                    aria-label={t('inbox.aria.back_to_list')}
                  >
                    <Icon as={ArrowLeft} size={18} />
                  </button>
                  <Avatar name={activeConv.lead_name || '?'} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-semibold truncate max-w-[120px] sm:max-w-xs">{activeConv.lead_name || t('inbox.unknown')}</h3>
                      <Tag dot size="xs" color={CONVERSATION_STATUS_COLORS[activeConv.status as ConversationStatus] || 'var(--text-muted)'} className="shrink-0">
                        {CONVERSATION_STATUS_LABELS[activeConv.status as ConversationStatus] || activeConv.status}
                      </Tag>
                      <span className="text-[9px] text-[var(--text-muted)]">{t('inbox.via', { channel: CHANNEL_LABELS[activeConv.channel as MessageChannel] || activeConv.channel })}</span>
                      {activeConv.channel === 'webchat' && wsStatus !== 'idle' && (() => {
                        const wsColor = wsStatus === 'connected'
                          ? 'var(--success)'
                          : wsStatus === 'closed'
                            ? 'var(--danger)'
                            : 'var(--warning)';
                        const wsLabel = wsStatus === 'connected' ? t('inbox.ws.live') : wsStatus === 'connecting' ? t('inbox.ws.connecting') : wsStatus === 'reconnecting' ? t('inbox.ws.reconnecting') : t('inbox.ws.disconnected');
                        return (
                          <Tag size="xs" color={wsColor} dot className="shrink-0">
                            {wsLabel}
                          </Tag>
                        );
                      })()}
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">{activeConv.lead_email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {/* Sprint 41 M1.4 — Summarize button Stripe-clean (primary solid, no gradient brand) */}
                  <button onClick={() => void handleSummarize()} disabled={isSummarizing}
                    className="inbox-summarize-btn"
                    title={t('inbox.summarize.tooltip')}
                    aria-label={isSummarizing ? t('inbox.summarize.in_progress') : t('inbox.summarize.tooltip')}>
                    {isSummarizing ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />}
                    <span className="hidden sm:inline">{isSummarizing ? t('inbox.summarize.summarizing') : t('inbox.summarize.label')}</span>
                  </button>
                  {/* Sprint 49 M3.1 — Classifier (tags suggérés, suggestion only) */}
                  <button onClick={() => void handleClassifyConv()} disabled={isClassifyingConv}
                    className="inbox-summarize-btn"
                    title={t('inbox.classify.tooltip')}
                    aria-label={isClassifyingConv ? t('inbox.classify.in_progress') : t('inbox.classify.aria')}>
                    {isClassifyingConv ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />}
                    <span className="hidden sm:inline">{isClassifyingConv ? t('inbox.classify.classifying') : t('inbox.classify.label')}</span>
                  </button>
                  {activeConv.status !== 'closed' && (
                    <button onClick={() => void changeStatus('closed')} className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-1" title={t('inbox.close')} aria-label={t('inbox.aria.close_conv')}>
                      <CheckCircle2 size={15} />
                    </button>
                  )}
                  {activeConv.status === 'closed' && (
                    <button onClick={() => void changeStatus('open')} className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-1" title={t('inbox.reopen')} aria-label={t('inbox.aria.reopen_conv')}>
                      <Icon as={Inbox} size={15} />
                    </button>
                  )}
                  {activeConv.status === 'open' && (
                    <button onClick={() => void changeStatus('snoozed')} className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-1" title={t('inbox.snooze')} aria-label={t('inbox.aria.snooze_conv')}>
                      <Pause size={15} />
                    </button>
                  )}
                  <button
                    onClick={(e) => void toggleStar(activeConv, e)}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-1"
                    aria-label={activeConv.is_starred ? t('inbox.aria.unstar') : t('inbox.aria.star')}
                    aria-pressed={activeConv.is_starred ? 'true' : 'false'}
                  >
                    {activeConv.is_starred ? <Star size={15} className="text-[var(--warning)] fill-[var(--warning)]" /> : <StarOff size={15} />}
                  </button>
                  <button
                    onClick={() => setShowRightPanel(!showRightPanel)}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-1"
                    aria-label={showRightPanel ? t('inbox.aria.close_panel') : t('inbox.aria.open_panel')}
                    aria-expanded={showRightPanel ? 'true' : 'false'}
                  >
                    {showRightPanel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                  </button>
                </div>
              </div>

              {/* Sprint 41 M1.4 — Carte résumé AI Stripe-clean (primary-soft, no orange gradient) */}
              {aiSummary && (
                <div className="inbox-ai-summary animate-in fade-in-0 slide-in-from-top-2">
                  <div className="inbox-ai-summary-head">
                    <div className="inbox-ai-summary-title">
                      <Sparkles size={12} />
                      <span>{t('inbox.ai_summary.title')}</span>
                    </div>
                    <button onClick={() => setAiSummary(null)} className="inbox-ai-summary-close" aria-label={t('inbox.ai_summary.close')}>
                      <XIcon size={12} />
                    </button>
                  </div>
                  <ul className="inbox-ai-summary-list">
                    {aiSummary.map((line, i) => (
                      <li key={i}>
                        <span className="inbox-ai-summary-bullet" aria-hidden>▸</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="inbox-ai-summary-footer">{t('inbox.ai_summary.footer')}</p>
                </div>
              )}

              {/* Sprint 49 M3.1 — Tags suggérés par IA (suggestion only — Loi 25 :
                  l'IA propose, l'utilisateur confirme ; chips dismissibles) */}
              {suggestedConvTags.length > 0 && (
                <div className="conv-ai-tags animate-in fade-in-0 slide-in-from-top-1" role="group" aria-label={t('inbox.ai_tags.group')}>
                  <span className="conv-ai-tags-label">
                    <Sparkles size={11} aria-hidden="true" />
                    {t('inbox.ai_tags.label')}
                  </span>
                  {suggestedConvTags.map(tag => (
                    <span key={tag} className="conv-ai-tag-chip">
                      <button
                        type="button"
                        className="conv-ai-tag-apply"
                        onClick={() => void applySuggestedConvTag(tag)}
                        title={t('inbox.ai_tags.apply_title')}
                        aria-label={t('inbox.ai_tags.apply_aria', { tag: CONVERSATION_TAG_LABELS[tag] })}
                      >
                        + {CONVERSATION_TAG_LABELS[tag]}
                      </button>
                      <button
                        type="button"
                        className="conv-ai-tag-dismiss"
                        onClick={() => dismissSuggestedConvTag(tag)}
                        title={t('inbox.ai_tags.dismiss_title')}
                        aria-label={t('inbox.ai_tags.dismiss_aria', { tag: CONVERSATION_TAG_LABELS[tag] })}
                      >
                        <XIcon size={10} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <MessageThread
                  messages={combinedMessages}
                  ref={messagesEndRef}
                  onRetry={handleRetry}
                  // Sprint 44 M3.1 — swipe-to-reply : active le reply mode du composer
                  onReply={(msg) => {
                    const name = msg.sender_name || activeConv.lead_name || t('inbox.reply_fallback');
                    const preview = (msg.body || '').slice(0, 120);
                    setReplyTo({ messageId: msg.id, name, preview });
                    triggerHaptic('light');
                    void playSound('toggle');
                  }}
                />
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
                conversationId={activeConv.id}
                lead={activeConv.lead_id ? {
                  name: activeConv.lead_name || '',
                  email: activeConv.lead_email || '',
                  phone: '',
                  deal_value: 0,
                  client_name: undefined,
                  score: 0,
                } : null}
                lastInboundMessage={(() => {
                  // Sprint 32 vague 32-2A — dernier message reçu pour générer drafts AI
                  for (let i = combinedMessages.length - 1; i >= 0; i--) {
                    const m = combinedMessages[i];
                    if (m && m.direction === 'inbound') return m.body || '';
                  }
                  return '';
                })()}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
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
      {/* Sprint 45 M3.2 — Coachmark contextuel : « Tape / pour insérer des variables » */}
      <ContextualCoachmark page="inbox" />
    </AppLayout>
  );
}
