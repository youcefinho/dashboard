// ── AppLayout — Layout principal (Sprint Design) ────────────

import { useState, useEffect, useRef, useCallback, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { Sidebar } from './Sidebar';
import { useNavigate, Link, useRouterState } from '@tanstack/react-router';
import { CommandPalette } from '@/components/CommandPalette';
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcutsModal';
import { QuickAddFab } from '@/components/QuickAddFab';
import { ActivityFeedPanel } from '@/components/ActivityFeedPanel';
import { Activity as ActivityIcon } from 'lucide-react';
import { useTheme } from '@/lib/useTheme';
import { getNotifications, markNotificationRead, markAllNotificationsRead, type NotificationItem } from '@/lib/api';
import { Search, Bell, Moon, Sun, Menu, Plus, Rows3, Rows2, Rows4, Check, X as XIcon, ExternalLink, BellOff, WifiOff } from 'lucide-react';
import { Icon } from '@/components/ui';
import { useDensity } from '@/lib/useDensity';
import { MobileBottomNav } from './MobileBottomNav';
// Sprint 44 M2.1 — InstallPrompt refondu (modal Stripe-clean + hook usePwaInstall)
import { InstallPrompt } from '../pwa/InstallPrompt';
// Sprint 44 M2.4 — Service worker update prompt
import { SwUpdatePrompt } from '../pwa/SwUpdatePrompt';
import { OnboardingWizard } from '../onboarding/OnboardingWizard';
// Sprint 45 M1.1 — Welcome wizard personnalisé 4 steps (Stripe-clean)
import { WelcomeWizard } from '../onboarding/WelcomeWizard';
// Sprint 45 M1.3 — First lead tour (coachmark 3 steps)
import { FirstLeadTour, shouldShowFirstLeadTour } from '../onboarding/FirstLeadTour';
import { getLeads } from '@/lib/api';
import { FeedbackWidget } from '../feedback/FeedbackWidget';
import { NpsModal } from '../feedback/NpsModal';
// Sprint 50 M3.3/M3.4 — Beta onboarding orchestration + feedback widget
import { DiscoverAppTour } from '../onboarding/DiscoverAppTour';
import { BetaFeedbackWidget } from '../feedback/BetaFeedbackWidget';
import { useAuth } from '@/lib/auth';
import { Capacitor } from '@capacitor/core';
import { Tooltip } from '@/components/ui/Tooltip';
// Sprint 34 vague 34-2A — Network status banner global (sous header)
import { NetworkStatusBanner } from '@/components/ui/NetworkStatusBanner';
import { initPushNotifications } from '@/lib/push';
// Sprint 44 M1.3 — Push routing typé (lead/message/task/etc.) via TanStack
import { setupPushRouting, resetPushBadge } from '@/lib/pushNotifications';
// Sprint 44 M1.4 — Deep links consumer (drain buffer + route via TanStack)
import { consumeDeepLink } from '@/lib/deepLinks';
import { syncAllToCache, isOnline, onConnectivityChange } from '@/lib/offline/sync';
import { setupAutoReplay } from '@/lib/offline/queue';
import { getPendingMutationCount, getOutboxCount } from '@/lib/offline/db';
// Sprint 44 M2.3 — Auto-flush outbox messages au retour online
import { setupOutboxAutoFlush, flushOutbox } from '@/lib/messageQueue';
import { useEdgeSwipe } from '@/hooks/useEdgeSwipe';
// Sprint 44 M3.4 — Back handler stack (SlidePanel/Modal/Wizard consument avant history.back)
import { consumeTopBackHandler } from '@/hooks/useBackHandler';
// Sprint 34 vague 34-3B — Live region portal pour annonces SR globales
import { LiveRegionPortal } from '@/lib/announce';
// Sprint 46 M3 — NotificationsPanel SlidePanel + WebSocket realtime
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel';
import { useNotificationsWs } from '@/hooks/useNotificationsWs';
import { useToast } from '@/components/ui';

interface AppLayoutProps {
  children: ReactNode;
  title: string;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  return `il y a ${days}j`;
}

// Sprint 24 vague 3A — notification grouping chronologique (Gmail-style)
type NotifGroupKey = 'today' | 'yesterday' | 'week' | 'older';
const NOTIF_GROUP_LABELS: Record<NotifGroupKey, string> = {
  today: "Aujourd'hui",
  yesterday: 'Hier',
  week: 'Cette semaine',
  older: 'Plus ancien',
};

function getNotifGroup(dateStr: string): NotifGroupKey {
  const d = new Date(dateStr);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const startWeek = startToday - 6 * 86_400_000;
  const t = d.getTime();
  if (t >= startToday) return 'today';
  if (t >= startYesterday) return 'yesterday';
  if (t >= startWeek) return 'week';
  return 'older';
}

type NotifFilter = 'all' | 'unread' | 'mentions';
const NOTIF_FILTER_KEY = 'intralys_notif_filter';
const NOTIF_FILTER_LABELS: Record<NotifFilter, string> = {
  all: 'Toutes',
  unread: 'Non lues',
  mentions: 'Mentions',
};

function isMention(n: NotificationItem): boolean {
  const s = `${n.title} ${n.description}`.toLowerCase();
  return s.includes('@') || s.includes('mention') || s.includes('mentionn');
}

function isHighPriority(n: NotificationItem): boolean {
  const s = `${n.title} ${n.description}`.toLowerCase();
  return s.includes('urgent') || s.includes('important') || s.includes('chaud') || s.includes('hot') || s.includes('alerte') || s.includes('alert');
}

// Sprint 25 vague 6A — catégoriser routes pour view transitions enrichies
function routeCategoryFor(pathname: string): 'workspace' | 'inbox' | 'settings' | 'builder' | 'default' {
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/conversations') || pathname.startsWith('/inbox')) return 'inbox';
  if (
    pathname.startsWith('/workflows') ||
    pathname.startsWith('/forms') ||
    pathname.startsWith('/email-builder') ||
    pathname.startsWith('/documents/templates')
  ) return 'builder';
  if (
    pathname.startsWith('/leads') ||
    pathname.startsWith('/pipeline') ||
    pathname.startsWith('/tasks') ||
    pathname.startsWith('/calendar') ||
    pathname.startsWith('/dashboard')
  ) return 'workspace';
  return 'default';
}

export function AppLayout({ children, title }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  // Sprint 46 M3.2 — SlidePanel notifications (alternative au dropdown legacy)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const toast = useToast();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // Sprint 24 vague 3A — filter persisted in sessionStorage
  const [notifFilter, setNotifFilter] = useState<NotifFilter>(() => {
    try {
      const v = sessionStorage.getItem(NOTIF_FILTER_KEY);
      if (v === 'all' || v === 'unread' || v === 'mentions') return v;
    } catch { /* ignore */ }
    return 'all';
  });
  // Local "dismissed" IDs (session only — pas d'endpoint API existant)
  const [dismissedNotifIds, setDismissedNotifIds] = useState<Set<string>>(new Set());
  const [showPwBanner, setShowPwBanner] = useState(() => localStorage.getItem('must_change_password') === '1');
  const notifRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { density, cycle: cycleDensity } = useDensity();
  // Sprint 22 : Activity feed panel
  const [activityOpen, setActivityOpen] = useState(false);
  const { user } = useAuth();
  
  // Sprint 23 wave 14 — persistance localStorage de la dismissal pour éviter que le wizard
  // réapparaisse à chaque refresh quand le backend ne persiste pas encore onboarding_skipped
  // (mock dev) ou quand la réponse API n'a pas encore propagé.
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (localStorage.getItem('intralys_onboarding_dismissed') === '1') return false;
    return user?.onboarding_step === 0 && !user?.onboarding_skipped;
  });
  // Sprint 45 M1.1 — WelcomeWizard (parallel à l'ancien OnboardingWizard) :
  // déclenché par `onboarding_completed !== '1'`. On NE le montre PAS si
  // l'ancien wizard est déjà en cours OU si l'user a déjà passé l'ancien
  // onboarding (legacy dismiss = backfill onboarding_completed pour éviter
  // un double-onboarding sur comptes existants).
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      if (localStorage.getItem('onboarding_completed') === '1') return false;
      if (localStorage.getItem('intralys_onboarding_dismissed') === '1') {
        // Backfill silencieux pour les users qui ont déjà fait l'ancien wizard.
        localStorage.setItem('onboarding_completed', '1');
        return false;
      }
      // User dont le backend dit onboarding déjà fini → backfill flag local.
      if (user && user.onboarding_step !== 0) {
        localStorage.setItem('onboarding_completed', '1');
        return false;
      }
    } catch { /* ignore */ }
    return true;
  });
  // ── Sprint 50 M3.3 — Beta onboarding flow ──────────────────────────────
  // Au premier login beta (?welcome=1), on orchestre : WelcomeWizard (Sprint 45)
  // → DiscoverAppTour (Sprint 45) → BetaFeedbackWidget actif. On NE recrée pas
  // ces composants, on les enchaîne. Flag beta_onboarding_completed (localStorage
  // + backend via /api/onboarding qui set onboarding_completed_at).
  const isBetaWelcome = (() => {
    try {
      if (new URLSearchParams(window.location.search).get('welcome') === '1') {
        return localStorage.getItem('beta_onboarding_completed') !== '1';
      }
    } catch { /* ignore */ }
    return false;
  })();
  const [showDiscoverTour, setShowDiscoverTour] = useState(false);
  // Si ?welcome=1 et beta pas terminé → on force le WelcomeWizard même si un
  // backfill local l'avait masqué (parcours magic link = nouveau device possible).
  useEffect(() => {
    if (isBetaWelcome) {
      try { localStorage.removeItem('onboarding_completed'); } catch { /* ignore */ }
      setShowWelcome(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sprint 45 M1.3 — FirstLeadTour : déclenché quand 0 leads ET pas encore montré.
  // Vérifié au mount + après tout WelcomeWizard onComplete.
  const [showFirstLeadTour, setShowFirstLeadTour] = useState(false);
  const checkFirstLeadTour = useCallback(async () => {
    try {
      const res = await getLeads({});
      const count = res.data?.length ?? 0;
      if (shouldShowFirstLeadTour(count)) {
        setShowFirstLeadTour(true);
      }
    } catch { /* silent */ }
  }, []);
  useEffect(() => {
    // Délaye 1.5s post-mount pour laisser le DOM se peindre + sidebar charger
    // → les selectors data-tour-id sont alors résolvables.
    if (showWelcome || showOnboarding) return;
    const id = window.setTimeout(() => { void checkFirstLeadTour(); }, 1500);
    return () => window.clearTimeout(id);
  }, [showWelcome, showOnboarding, checkFirstLeadTour]);
  const [offline, setOffline] = useState(!isOnline());
  const [pendingSync, setPendingSync] = useState(0);

  // Sprint 30 vague 30-3A — Edge swipe back gesture (mobile only)
  // Sprint 44 M3.4 — Consume top back handler (SlidePanel/Modal/Wizard) avant
  // de tomber sur window.history.back(). LIFO : si plusieurs panels stack,
  // le top est fermé en premier (iOS-like).
  const edgeSwipe = useEdgeSwipe({
    onSwipeBack: () => {
      try {
        if (consumeTopBackHandler()) return;
        if (window.history.length > 1) window.history.back();
      } catch { /* ignore */ }
    },
  });

  // Init push + offline sync au boot
  useEffect(() => {
    const token = localStorage.getItem('intralys_token');
    if (!token) return;

    const apiBase = Capacitor.isNativePlatform()
      ? (import.meta.env.VITE_API_URL || 'https://crm.intralys.com') + '/api'
      : '/api';

    // Push notifications (natif uniquement)
    void initPushNotifications(apiBase, token);

    // Sprint 44 M1.3 — wire routing TanStack pour pushNotificationReceived
    // + pushNotificationActionPerformed (typé par data.type). Idempotent.
    void setupPushRouting((opts) => navigate(opts as Parameters<typeof navigate>[0]));
    // Reset badge iOS quand l'app reprend le focus (user a vu les notifs)
    void resetPushBadge();

    // Sprint 44 M1.4 — drain le buffer deep links (cold start via intralys://)
    // + s'enregistrer comme consumer pour les URLs futures (appUrlOpen).
    consumeDeepLink((opts) => navigate(opts as Parameters<typeof navigate>[0]));

    // Sync offline cache
    void syncAllToCache(apiBase, token);

    // Auto-replay mutations offline au retour online
    setupAutoReplay(apiBase, () => localStorage.getItem('intralys_token'));

    // Sprint 44 M2.3 — Auto-flush outbox messages au retour online
    const unsubOutbox = setupOutboxAutoFlush(
      apiBase,
      () => localStorage.getItem('intralys_token'),
    );

    // Écouter les changements de connectivité
    const unsub = onConnectivityChange((online) => {
      setOffline(!online);
      if (online) {
        void syncAllToCache(apiBase, token);
        void getPendingMutationCount().then(setPendingSync);
        // Sprint 44 M2.3 — flush outbox au retour online (en complement du listener
        // 'online' déjà setup via setupOutboxAutoFlush — couvre les pages chargées
        // sans event 'online' déclenché, ex. boot avec network restoré).
        void flushOutbox(apiBase, token);
      }
    });

    // Compter les mutations en attente (mutations + outbox messages)
    void Promise.all([
      getPendingMutationCount(),
      getOutboxCount(),
    ]).then(([m, o]) => setPendingSync(m + o));

    return () => {
      unsub();
      unsubOutbox();
    };
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await getNotifications({ limit: 20 });
      if (res.data) setNotifications(res.data);
      const raw = res as Record<string, unknown>;
      if (typeof raw.unread_count === 'number') setUnreadCount(raw.unread_count);
      else if (res.data) setUnreadCount(res.data.filter(n => !n.is_read).length);
    } catch { /* silencieux */ }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const interval = setInterval(() => { void loadNotifications(); }, 30_000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Sprint 46 M3.4 — Real-time WebSocket notifications
  // Push direct dans le store local + Toast inline + announceSR.
  // Coexiste avec le polling 30s (fallback si WS coupé).
  const wsToken = typeof window !== 'undefined' ? localStorage.getItem('intralys_token') : null;
  useNotificationsWs({
    token: wsToken,
    enabled: !!user,
    onNotification: (notif) => {
      setNotifications((prev) => {
        // Dédup par id (le polling REST peut déjà avoir inséré)
        if (prev.some((n) => n.id === notif.id)) return prev;
        return [notif, ...prev].slice(0, 50);
      });
      if (!notif.is_read) {
        setUnreadCount((c) => c + 1);
      }
      // Toast inline (info) — l'user voit l'arrivée même si panel fermé
      toast.info(notif.description || notif.title || 'Nouvelle notification', {
        title: notif.description ? notif.title : undefined,
        action: notif.link
          ? {
              label: 'Voir',
              onClick: () => {
                void navigate({ to: notif.link });
              },
            }
          : undefined,
      });
      // announceSR déjà géré dans useNotificationsWs (polite)
    },
  });

  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setCmdOpen(prev => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // Sprint 25 vague 6A — set body[data-route-category] selon pathname pour
  // permettre aux view transitions (CSS) de varier l'animation par catégorie.
  const routerLocation = useRouterState({ select: (s) => s.location });
  useEffect(() => {
    const cat = routeCategoryFor(routerLocation.pathname);
    if (cat === 'default') {
      delete document.body.dataset.routeCategory;
    } else {
      document.body.dataset.routeCategory = cat;
    }
    return () => {
      delete document.body.dataset.routeCategory;
    };
  }, [routerLocation.pathname]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
    await markAllNotificationsRead();
  };

  const handleNotifClick = async (notif: NotificationItem) => {
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: 1 } : n));
    setUnreadCount(prev => Math.max(0, prev - (notif.is_read ? 0 : 1)));
    setNotifOpen(false);
    void markNotificationRead(notif.id);
    if (notif.link) void navigate({ to: notif.link });
  };

  // Sprint 24 vague 3A — actions inline notifs
  const markNotifReadOnly = (e: ReactMouseEvent, notif: NotificationItem) => {
    e.stopPropagation();
    if (notif.is_read) return;
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: 1 } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    void markNotificationRead(notif.id);
  };

  const dismissNotif = (e: ReactMouseEvent, notif: NotificationItem) => {
    e.stopPropagation();
    setDismissedNotifIds(prev => {
      const next = new Set(prev);
      next.add(notif.id);
      return next;
    });
    if (!notif.is_read) {
      setUnreadCount(prev => Math.max(0, prev - 1));
      void markNotificationRead(notif.id);
    }
  };

  const setFilter = (f: NotifFilter) => {
    setNotifFilter(f);
    try { sessionStorage.setItem(NOTIF_FILTER_KEY, f); } catch { /* ignore */ }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sprint 30 vague 30-3A — Edge swipe back overlay (Stripe-clean : indicator sober) */}
      {edgeSwipe.isSwiping && (
        <div
          className="edge-swipe-indicator"
          aria-hidden
          style={{
            opacity: edgeSwipe.progress,
            width: `${24 + edgeSwipe.progress * 36}px`,
          }}
        />
      )}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-canvas)]">
        {/* Skip-to-content link — visible uniquement au focus clavier (a11y WCAG 2.4.1) */}
        <a href="#main-content" className="skip-link">
          Aller au contenu principal
        </a>
        {/* Header — Stripe-clean : 56px, white bg, border-bottom 1px */}
        {/* Sprint 44 M1.2 : `cap-aware` ajoute safe-area-inset-top sur natif */}
        <header className="cap-aware h-14 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-between px-4 lg:px-6 shrink-0 sticky top-0 z-30">
          {/* Gauche : hamburger + titre */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="inline-flex lg:hidden items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              aria-label="Ouvrir le menu"
            >
              <Icon as={Menu} size={18} />
            </button>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)] truncate">{title}</h2>
            {offline && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--warning-soft)] text-[var(--warning)] text-[11px] font-medium">
                <Icon as={WifiOff} size={12} /> Hors ligne
              </span>
            )}
            {!offline && pendingSync > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--info-soft)] text-[var(--info)] text-[11px] font-medium">
                {pendingSync} en attente
              </span>
            )}
          </div>

          {/* Centre : search global — input sober Stripe-style */}
          <button
            data-tour-id="header-search"
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex items-center gap-2 px-3 h-9 rounded-md text-xs text-[var(--text-muted)] w-48 lg:w-80 cursor-pointer transition-colors bg-[var(--bg-canvas)] border border-[var(--border)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]"
          >
            <Icon as={Search} size={14} />
            <span>Rechercher...</span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-semibold tracking-wider bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)]">
              {'⌘'}K
            </span>
          </button>

          {/* Droite : actions */}
          <div className="flex items-center gap-1">
            {/* Search mobile */}
            <button
              onClick={() => setCmdOpen(true)}
              className="inline-flex sm:hidden items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              aria-label="Rechercher"
            >
              <Icon as={Search} size={16} />
            </button>

            {/* Bouton + Nouveau — primary CTA sober Stripe (primary purple solid) */}
            <button
              data-tour-id="header-new-lead"
              onClick={() => void navigate({ to: '/leads' })}
              className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium rounded-md text-white bg-[var(--primary)] hover:bg-[var(--primary-hover,#5851DB)] active:scale-[0.98] transition-colors cursor-pointer"
            >
              <Icon as={Plus} size={14} strokeWidth={2.25} />
              Nouveau
            </button>

            {/* Activity feed (Sprint 22) — ghost icon button Stripe */}
            <Tooltip title="Activité de l'équipe" description="Voir le flux des actions récentes de tous les collaborateurs">
              <button
                onClick={() => setActivityOpen(true)}
                className="hidden sm:inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                aria-label="Voir l'activité d'équipe"
              >
                <Icon as={ActivityIcon} size={16} />
              </button>
            </Tooltip>

            {/* Density toggle (Sprint 21) */}
            <Tooltip
              title="Densité d'affichage"
              description={`Actuelle : ${density === 'compact' ? 'Compacte (plus dense)' : density === 'spacious' ? 'Spacieuse (plus aérée)' : 'Confortable (par défaut)'}. Clic pour cycler.`}
            >
              <button
                data-tour-id="header-density"
                onClick={cycleDensity}
                className="hidden sm:inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                aria-label="Changer la densité de l'interface"
              >
                {density === 'compact' ? <Icon as={Rows4} size={16} /> : density === 'spacious' ? <Icon as={Rows2} size={16} /> : <Icon as={Rows3} size={16} />}
              </button>
            </Tooltip>

            {/* Theme toggle */}
            <Tooltip title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}>
              <button
                onClick={toggleTheme}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                aria-label="Changer le thème"
              >
                {theme === 'dark' ? <Icon as={Sun} size={16} /> : <Icon as={Moon} size={16} />}
              </button>
            </Tooltip>

            {/* Notifications — Sprint 46 M3.2 : Bell ouvre SlidePanel (legacy dropdown
                conservé en fallback caché pour back-compat data-tour-id). */}
            <div ref={notifRef} className="relative">
              <button
                data-tour-id="header-notifs"
                onClick={() => {
                  setNotifPanelOpen(true);
                  setNotifOpen(false);
                }}
                className={`relative inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors cursor-pointer ${notifPanelOpen || notifOpen ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
              >
                <Icon as={Bell} size={16} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--primary)] text-white text-[9px] font-bold inline-flex items-center justify-center tabular-nums">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Dropdown notifications — Sprint 24 vague 3A : grouping + filtres + inline actions */}
              {notifOpen && (() => {
                const visibleNotifs = notifications.filter(n => !dismissedNotifIds.has(n.id));
                const filtered = visibleNotifs.filter(n => {
                  if (notifFilter === 'unread') return !n.is_read;
                  if (notifFilter === 'mentions') return isMention(n);
                  return true;
                });
                // Group chronologiquement
                const groups: Record<NotifGroupKey, NotificationItem[]> = { today: [], yesterday: [], week: [], older: [] };
                filtered.forEach(n => { groups[getNotifGroup(n.created_at)]!.push(n); });
                const groupOrder: NotifGroupKey[] = ['today', 'yesterday', 'week', 'older'];
                const totalFiltered = filtered.length;

                return (
                  <div className="absolute right-0 top-11 w-96 max-w-[calc(100vw-2rem)] rounded-lg z-50 overflow-hidden bg-[var(--bg-surface)] border border-[var(--border)] shadow-[var(--shadow-md,0_8px_24px_rgba(50,50,93,0.15))] animate-slide-down">
                    {/* Header : titre + mark all */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)]">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Notifications</h3>
                      {unreadCount > 0 && (
                        <button onClick={() => void markAllRead()} className="text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer">
                          Tout marquer lu
                        </button>
                      )}
                    </div>
                    {/* Filter chips (segmented-control sober) */}
                    <div className="px-3 py-2 border-b border-[var(--border)]">
                      <div className="segmented-control w-full" role="tablist" aria-label="Filtrer les notifications">
                        {(['all', 'unread', 'mentions'] as NotifFilter[]).map(f => (
                          <button
                            key={f}
                            role="tab"
                            aria-selected={notifFilter === f}
                            onClick={() => setFilter(f)}
                            className={`flex-1 ${notifFilter === f ? 'is-active' : ''}`}
                          >
                            {NOTIF_FILTER_LABELS[f]}
                            {f === 'unread' && unreadCount > 0 && (
                              <span className="ml-1 text-[9px] font-bold px-1.5 py-px rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Liste scrollable */}
                    <div className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
                      {totalFiltered === 0 ? (
                        <div className="flex flex-col items-center justify-center px-6 py-10 text-center gap-3">
                          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--bg-subtle)] text-[var(--text-muted)]">
                            <Icon as={BellOff} size={20} />
                          </div>
                          <div className="text-sm font-semibold text-[var(--text-primary)]">
                            {notifFilter === 'all' ? 'Tu es à jour' : notifFilter === 'unread' ? 'Aucune notif non lue' : 'Aucune mention'}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] max-w-[240px] leading-relaxed">
                            {notifFilter === 'all'
                              ? 'Aucune notification pour l\'instant. Reviens plus tard.'
                              : 'Essaie un autre filtre pour voir d\'autres notifications.'}
                          </div>
                        </div>
                      ) : (
                        (() => {
                          let staggerIndex = 0;
                          return groupOrder.map(gk => {
                            const items = groups[gk];
                            if (!items || items.length === 0) return null;
                            return (
                              <div key={gk}>
                                <div className="notif-group-header sticky top-0 z-10">
                                  <span>{NOTIF_GROUP_LABELS[gk]}</span>
                                  <span className="notif-group-header-count">{items.length}</span>
                                </div>
                                {items.map(notif => {
                                  const high = isHighPriority(notif);
                                  const idx = staggerIndex++;
                                  return (
                                    <div
                                      key={notif.id}
                                      onClick={() => void handleNotifClick(notif)}
                                      className={`notif-item group relative flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)] ${
                                        !notif.is_read ? 'bg-[var(--primary-soft)]' : ''
                                      }`}
                                      style={{ animationDelay: `${Math.min(idx * 40, 400)}ms` }}
                                    >
                                      {/* Priority dot — Stripe sober */}
                                      <span
                                        className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full"
                                        aria-label={high ? 'Priorité haute' : 'Priorité normale'}
                                        style={{ background: high ? 'var(--warning, #D97706)' : 'var(--primary)' }}
                                      />
                                      <span className="text-sm mt-0.5">{notif.icon}</span>
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-xs ${!notif.is_read ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>{notif.title}</p>
                                        <p className="text-[10px] text-[var(--text-muted)] truncate">{notif.description}</p>
                                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{formatRelativeTime(notif.created_at)}</p>
                                      </div>
                                      {/* Hover actions */}
                                      <div className="notif-action-hover flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {notif.link && (
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); void handleNotifClick(notif); }}
                                            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                                            aria-label="Ouvrir"
                                            title="Ouvrir"
                                          >
                                            <Icon as={ExternalLink} size={12} />
                                          </button>
                                        )}
                                        {!notif.is_read && (
                                          <button
                                            type="button"
                                            onClick={(e) => markNotifReadOnly(e, notif)}
                                            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                                            aria-label="Marquer comme lu"
                                            title="Marquer lu"
                                          >
                                            <Icon as={Check} size={12} />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={(e) => dismissNotif(e, notif)}
                                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                                          aria-label="Ignorer"
                                          title="Ignorer"
                                        >
                                          <Icon as={XIcon} size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          });
                        })()
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </header>

        {/* Banner changement mot de passe */}
        {showPwBanner && (
          <div className="bg-[var(--warning-soft)] border-b border-[var(--warning)]/30 px-4 py-2 flex items-center justify-between text-xs shrink-0 animate-slide-down">
            <span className="text-[var(--text-primary)]">
              🔐 Votre mot de passe est temporaire.
              <Link to="/change-password" className="ml-1 font-semibold text-[var(--primary)] hover:underline">Changez-le maintenant →</Link>
            </span>
            <button
              onClick={() => { setShowPwBanner(false); localStorage.removeItem('must_change_password'); }}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >✕</button>
          </div>
        )}

        {/* Contenu de la page — Sprint 38 Stripe-clean : canvas bg + consistent padding */}
        <div id="main-content" tabIndex={-1} className="flex-1 overflow-auto p-4 lg:p-6 focus:outline-none">
          <div className="animate-fade-in max-w-[1400px]">
            {children}
          </div>
        </div>
      </main>

      {/* Sprint 34 vague 34-2A — Banner premium online/offline (sous header, z-50) */}
      <NetworkStatusBanner />

      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />
      <KeyboardShortcutsModal />
      <QuickAddFab />
      <ActivityFeedPanel open={activityOpen} onOpenChange={setActivityOpen} />
      <MobileBottomNav />
      <InstallPrompt />
      {/* Sprint 44 M2.4 — Toast persistant "Mise à jour disponible" */}
      <SwUpdatePrompt />
      {showOnboarding && <OnboardingWizard onComplete={() => {
        localStorage.setItem('intralys_onboarding_dismissed', '1');
        setShowOnboarding(false);
      }} />}
      {/* Sprint 45 M1.1 — Welcome wizard 4 steps personnalisé (Stripe-clean) */}
      {showWelcome && !showOnboarding && (
        <WelcomeWizard
          open
          initialName={user?.name || ''}
          initialEmail={user?.email || ''}
          onComplete={() => {
            setShowWelcome(false);
            // Sprint 50 M3.3 — parcours beta : enchaîne DiscoverAppTour après
            // le wizard, puis marque l'onboarding beta terminé.
            if (isBetaWelcome) {
              try { localStorage.setItem('beta_onboarding_completed', '1'); } catch { /* ignore */ }
              window.setTimeout(() => setShowDiscoverTour(true), 600);
            }
            // Re-check first lead tour après onboarding (data peut être seedée)
            window.setTimeout(() => { void checkFirstLeadTour(); }, 800);
          }}
        />
      )}
      {/* Sprint 50 M3.3 — Tour découverte enchaîné après le WelcomeWizard beta */}
      {showDiscoverTour && (
        <DiscoverAppTour
          open={showDiscoverTour}
          onClose={() => setShowDiscoverTour(false)}
        />
      )}
      {/* Sprint 45 M1.3 — Tour guidé première création de lead */}
      {showFirstLeadTour && (
        <FirstLeadTour
          open={showFirstLeadTour}
          onClose={() => setShowFirstLeadTour(false)}
        />
      )}
      <FeedbackWidget />
      {/* Sprint 50 M3.4 — Feedback widget beta (FAB, authenticated only) */}
      <BetaFeedbackWidget />
      <NpsModal />
      {/* Sprint 46 M3.2 — SlidePanel notifications (alternative au dropdown legacy) */}
      <NotificationsPanel
        open={notifPanelOpen}
        onOpenChange={setNotifPanelOpen}
        notifications={notifications.filter((n) => !dismissedNotifIds.has(n.id))}
        unreadCount={unreadCount}
        onMarkAllRead={() => void markAllRead()}
        onMarkRead={(id) => {
          const n = notifications.find((x) => x.id === id);
          if (!n || n.is_read) return;
          setNotifications((prev) =>
            prev.map((x) => (x.id === id ? { ...x, is_read: 1 } : x)),
          );
          setUnreadCount((c) => Math.max(0, c - 1));
          void markNotificationRead(id);
        }}
        onDismiss={(id) => {
          setDismissedNotifIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
          const n = notifications.find((x) => x.id === id);
          if (n && !n.is_read) {
            setUnreadCount((c) => Math.max(0, c - 1));
            void markNotificationRead(id);
          }
        }}
        onItemClick={(notif) => void handleNotifClick(notif)}
      />
      {/* Sprint 34 vague 34-3B — Live regions invisibles pour annonces SR */}
      <LiveRegionPortal />
    </div>
  );
}
