// ── NotificationsPanel — SlidePanel droite Stripe-clean (Sprint 46 M3.2) ──
// Remplace progressivement le dropdown notif d'AppLayout par un vrai SlidePanel
// (md ~540px) : header + tabs filtres + chip "non lues" + liste virtualizée si
// >50 items + EmptyState (variant filtered si filtre actif, first-time sinon).
//
// Data source : `notifications` + `unreadCount` injectés par AppLayout
// (loadNotifications + WebSocket). Actions : onMarkAllRead / onMarkRead /
// onDismiss / onItemClick (navigate link).
//
// Stripe sober : no orb, no gradient brand massif, tabs sober Stripe underline.

import { useMemo, useState } from 'react';
import {
  SlidePanel,
  EmptyState,
  Illustration,
  Badge,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Icon,
} from '@/components/ui';
import { CheckCheck, Bell } from 'lucide-react';
import { NotificationItem, type NotificationItemType } from '@/components/ui/NotificationItem';
import type { NotificationItem as ApiNotification } from '@/lib/api';
// Sprint 48 M3.2 — Intl.RelativeTimeFormat locale-aware
import { formatRelativeTime as i18nFormatRelativeTime } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';

export type NotifPanelTab = 'all' | 'mentions' | 'system';

interface NotificationsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Liste brute API (filtrage local) */
  notifications: ApiNotification[];
  /** Compteur unread (sync depuis AppLayout) */
  unreadCount: number;
  /** Mark all as read */
  onMarkAllRead: () => void;
  /** Mark single as read */
  onMarkRead: (id: string) => void;
  /** Dismiss single */
  onDismiss: (id: string) => void;
  /** Click item → navigate link */
  onItemClick: (notif: ApiNotification) => void;
}

// ── Helpers — détection type depuis title/description/link ─────────────────
// On mappe les notifs API (icon string + free text) vers un NotificationItemType
// déterministe pour bénéficier du badge color-coded primitive Stripe.
function detectType(n: ApiNotification): NotificationItemType {
  const haystack = `${n.title} ${n.description}`.toLowerCase();
  const link = (n.link || '').toLowerCase();
  if (haystack.includes('conformit') || haystack.includes('loi 25') || haystack.includes('casl') || haystack.includes('rgpd')) {
    return 'compliance';
  }
  if (haystack.includes('@') || haystack.includes('mention') || haystack.includes('mentionn')) {
    return 'mention';
  }
  if (link.startsWith('/conversations') || link.startsWith('/inbox') || haystack.includes('message') || haystack.includes('webchat')) {
    return 'message';
  }
  if (haystack.includes('échéance') || haystack.includes('échue') || haystack.includes('retard') || haystack.includes('tâche')) {
    return 'task_due';
  }
  if (haystack.includes('assigné') || haystack.includes('attribué')) {
    return 'lead_assigned';
  }
  if (haystack.includes('nouveau lead') || haystack.includes('prospect') || link.startsWith('/leads')) {
    return 'lead_new';
  }
  return 'system';
}

function formatRelativeTime(dateStr: string): string {
  // Sprint 48 M3.2 — délégué à Intl.RelativeTimeFormat (locale-aware)
  return i18nFormatRelativeTime(dateStr, getLocale());
}

const VIRTUAL_THRESHOLD = 50;

export function NotificationsPanel({
  open,
  onOpenChange,
  notifications,
  unreadCount,
  onMarkAllRead,
  onMarkRead,
  onDismiss,
  onItemClick,
}: NotificationsPanelProps) {
  const [tab, setTab] = useState<NotifPanelTab>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // ── Enrich + filter ────────────────────────────────────────────────────────
  const enriched = useMemo(
    () =>
      notifications.map((n) => ({
        raw: n,
        type: detectType(n),
        relativeTime: formatRelativeTime(n.created_at),
      })),
    [notifications],
  );

  const filtered = useMemo(() => {
    return enriched.filter((e) => {
      if (unreadOnly && e.raw.is_read) return false;
      if (tab === 'mentions') return e.type === 'mention';
      if (tab === 'system') return e.type === 'system' || e.type === 'compliance';
      return true;
    });
  }, [enriched, tab, unreadOnly]);

  const isVirtual = filtered.length > VIRTUAL_THRESHOLD;
  // Virtualization simple : on slice à 100 initialement + bouton "Charger plus"
  // (UX Stripe : pas de scroll virtuel agressif, suffisant pour 100-200 notifs).
  const [visibleCount, setVisibleCount] = useState(VIRTUAL_THRESHOLD);
  const visibleItems = isVirtual ? filtered.slice(0, visibleCount) : filtered;

  // ── Header actions slot ────────────────────────────────────────────────────
  const headerActions =
    unreadCount > 0 ? (
      <button
        type="button"
        onClick={onMarkAllRead}
        className="notif-panel__mark-all"
        aria-label={`Tout marquer comme lu (${unreadCount} non lue${unreadCount > 1 ? 's' : ''})`}
        title="Tout marquer comme lu"
      >
        <Icon as={CheckCheck} size={14} />
        <span>Tout marquer lu</span>
      </button>
    ) : null;

  // ── Empty state ────────────────────────────────────────────────────────────
  const isFiltered = tab !== 'all' || unreadOnly;
  const empty = (
    <div className="notif-panel__empty">
      <EmptyState
        illustration={<Illustration name="inbox" size={120} />}
        variant={isFiltered ? 'filtered' : 'first-time'}
        title={
          isFiltered
            ? 'Aucune notification ne correspond'
            : 'Tu es à jour'
        }
        description={
          isFiltered
            ? 'Essaie un autre filtre ou désactive "Non lues uniquement" pour voir l\'historique complet.'
            : 'Aucune notification pour l\'instant. On t\'avertit dès qu\'un lead bouge ou qu\'une tâche arrive à échéance.'
        }
      />
    </div>
  );

  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title="Notifications"
      description={
        unreadCount > 0
          ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}`
          : 'Tout est lu'
      }
      size="md"
      headerActions={headerActions}
      bodyClassName="notif-panel__body"
    >
      {/* Tabs sober Stripe — All / Mentions / System */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as NotifPanelTab)}>
        <TabsList className="notif-panel__tabs">
          <TabsTrigger value="all">
            Toutes
            {unreadCount > 0 && (
              <Badge
                intent="brand"
                size="sm"
                className="notif-panel__tab-badge ml-1.5"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="mentions">Mentions</TabsTrigger>
          <TabsTrigger value="system">Système</TabsTrigger>
        </TabsList>

        {/* Filter chip "Non lues uniquement" */}
        <div className="notif-panel__filter-bar">
          <Switch
            size="sm"
            variant="brand"
            checked={unreadOnly}
            onCheckedChange={setUnreadOnly}
            label="Non lues uniquement"
          />
        </div>

      </Tabs>

      {/* Content : rendu hors Tabs Radix pour éviter mount-by-value (UX cleaner) */}
      <div className="notif-panel__content">
        {visibleItems.length === 0 ? (
          empty
        ) : (
          <div className="notif-panel__list" role="list">
            {visibleItems.map((e, idx) => (
              <NotificationItem
                key={e.raw.id}
                id={e.raw.id}
                type={e.type}
                title={e.raw.title}
                description={e.raw.description}
                time={e.relativeTime}
                isRead={!!e.raw.is_read}
                onClick={() => onItemClick(e.raw)}
                onMarkRead={onMarkRead}
                onDismiss={onDismiss}
                staggerIndex={idx}
              />
            ))}
            {isVirtual && visibleCount < filtered.length && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + VIRTUAL_THRESHOLD)}
                className="notif-panel__load-more"
                aria-label={`Charger ${Math.min(
                  VIRTUAL_THRESHOLD,
                  filtered.length - visibleCount,
                )} notifications supplémentaires`}
              >
                <Icon as={Bell} size={12} />
                Charger plus ({filtered.length - visibleCount} restantes)
              </button>
            )}
          </div>
        )}
      </div>
    </SlidePanel>
  );
}
