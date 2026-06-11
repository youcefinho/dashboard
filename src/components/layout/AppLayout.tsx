// ── AppLayout — Layout principal (Sprint Design) ────────────

import { useState, useEffect, useRef, useCallback, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { Sidebar } from './Sidebar';
import { useNavigate, Link, useRouterState } from '@tanstack/react-router';
import { CommandPalette } from '@/components/CommandPalette';
// LOT G8 — Assistant IA conversationnel global (panel slide-over, ouvert Cmd+/)
import { AiAssistantPanel } from '@/components/assistant/AiAssistantPanel';
// SPRINT 11 (Copilot v2) — contexte de page courante transmis à l'assistant
import type { AiPageContext } from '@/lib/types';
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcutsModal';
import { QuickAddFab } from '@/components/QuickAddFab';
import { ActivityFeedPanel } from '@/components/ActivityFeedPanel';
import { Activity as ActivityIcon } from 'lucide-react';
import { useTheme } from '@/lib/useTheme';
import { getNotifications, markNotificationRead, markAllNotificationsRead, getClientBranding, getActiveSubAccount, type NotificationItem } from '@/lib/api';
// LOT WHITE-LABEL APPLY (Sprint 20) — propagation front du branding tenant.
// applyTenantBranding/resetTenantBranding FIGÉS Phase A (on les APPELLE, jamais
// on ne les modifie). Manager-C — owned AppLayout.tsx.
import { applyTenantBranding, resetTenantBranding } from '@/lib/applyBranding';
import type { TenantBranding, ClientBrandingMeta } from '@/lib/types';
import { Search, Bell, Moon, Sun, Menu, Plus, Rows3, Rows2, Rows4, Check, X as XIcon, ExternalLink, BellOff, WifiOff, PhoneCall } from 'lucide-react';
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
// Sprint S8 — getOnboardingState/putOnboardingState : reprise multi-appareil
// de l'onboarding (best-effort, additif — fallback localStorage conservé).
import { getLeads, getOnboardingState, putOnboardingState, type OnboardingState } from '@/lib/api';
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
import { t } from '@/lib/i18n';
import { FloatingDialerPanel } from '@/components/dialer/FloatingDialerPanel';

interface AppLayoutProps {
  children: ReactNode;
  title: string;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t('time.now');
  if (mins < 60) return t('time.min').replace('{n}', String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('time.hours').replace('{n}', String(hours));
  const days = Math.floor(hours / 24);
  if (days === 1) return t('time.yesterday');
  return t('time.days').replace('{n}', String(days));
}

// Sprint 24 vague 3A — notification grouping chronologique (Gmail-style)
type NotifGroupKey = 'today' | 'yesterday' | 'week' | 'older';
const NOTIF_GROUP_LABELS: Record<NotifGroupKey, string> = {
  today: t('notif.today'),
  yesterday: t('notif.yesterday'),
  week: t('notif.this_week'),
  older: t('notif.older'),
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
  all: t('notif.all'),
  unread: t('notif.unread'),
  mentions: t('notif.mentions'),
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

// ── SPRINT 11 (Copilot v2) — contexte de page courante pour l'assistant ──────
// Best-effort, optionnel : dérive { route, entity_type?, entity_id? } depuis le
// pathname courant. RE-VALIDÉ + RE-BORNÉ tenant worker-side (aucune confiance
// accordée à ces valeurs ; le front n'envoie JAMAIS de client_id). On ne mappe
// que les entités sûres dont l'id figure directement dans l'URL.
function derivePageContext(pathname: string): AiPageContext {
  const ctx: AiPageContext = { route: pathname };
  // Détecte /<segment>/<id> pour les entités CRM connues (id = segment non vide
  // qui n'est pas un sous-onglet réservé comme 'new'/'import'). Best-effort.
  const ENTITY_BY_SEGMENT: Record<string, string> = {
    leads: 'lead',
    tasks: 'task',
    pipeline: 'lead',
    conversations: 'conversation',
    calendar: 'appointment',
  };
  const reserved = new Set(['new', 'import', 'export', 'create']);
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const seg = parts[0]!;
    const id = parts[1]!;
    const entity = ENTITY_BY_SEGMENT[seg];
    if (entity && id && !reserved.has(id)) {
      ctx.entity_type = entity;
      ctx.entity_id = id;
    }
  }
  return ctx;
}

// ── LOT WHITE-LABEL APPLY (Sprint 20) — propagation du branding tenant ────────
// Évènement window diffusant le branding résolu du sous-compte actif, écouté par
// la Sidebar (logo/nom conditionnels) sans état partagé (api.ts/types.ts FIGÉS).
const WL_BRANDING_EVENT = 'intralys:branding';

// Désérialise la colonne `branding` JSON (best-effort) en métadonnées tolérantes
// aux deux graphies (company_name canonique | companyName historique).
function parseBrandingMeta(raw: string | null | undefined): ClientBrandingMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ClientBrandingMeta;
  } catch {
    return {}; // branding non-JSON (legacy) ⇒ pas de méta, défaut Intralys
  }
}

// Pilote le footer PDF (index.css `body::after`) via la var --wl-powered-by :
// remove_powered_by ⇒ '' (masqué, non destructif) ; sinon on retire l'override
// (var absente ⇒ défaut Intralys du fallback CSS). Best-effort, SSR-safe.
function applyPoweredByVar(removePoweredBy: boolean): void {
  if (typeof document === 'undefined') return;
  try {
    const root = document.documentElement;
    if (removePoweredBy) {
      root.style.setProperty('--wl-powered-by', "''");
    } else {
      root.style.removeProperty('--wl-powered-by');
    }
  } catch {
    /* best-effort */
  }
}

// Résout + applique le branding du sous-compte actif (best-effort, jamais throw).
// Reset complet si aucun branding (rétro-compat byte : couleurs/footer Intralys).
async function resolveAndApplyBranding(): Promise<void> {
  try {
    const clientId = getActiveSubAccount();
    if (!clientId) {
      // Legacy/mono-tenant : aucun sous-compte ⇒ défaut Intralys.
      resetTenantBranding();
      applyPoweredByVar(false);
      try { window.dispatchEvent(new CustomEvent(WL_BRANDING_EVENT, { detail: null })); } catch { /* ignore */ }
      return;
    }
    const res = await getClientBranding(clientId);
    const d = res.data;
    if (!d) {
      resetTenantBranding();
      applyPoweredByVar(false);
      try { window.dispatchEvent(new CustomEvent(WL_BRANDING_EVENT, { detail: null })); } catch { /* ignore */ }
      return;
    }
    const meta = parseBrandingMeta(d.branding);
    const branding: TenantBranding = {
      primary_color: d.primary_color,
      accent_color: d.accent_color,
      logo_url: d.logo_url,
      company_name: meta.company_name || meta.companyName,
      favicon: meta.favicon,
      remove_powered_by: meta.remove_powered_by === true,
    };
    // Reset d'abord (au changement de sous-compte, on repart d'un état propre)
    // puis applique le branding du tenant courant.
    resetTenantBranding();
    applyTenantBranding(branding);
    applyPoweredByVar(branding.remove_powered_by === true);
    try { window.dispatchEvent(new CustomEvent(WL_BRANDING_EVENT, { detail: branding })); } catch { /* ignore */ }
  } catch {
    /* propagation best-effort : ne bloque jamais le boot */
  }
}

export function AppLayout({ children, title }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  // Sprint 46 M3.2 — SlidePanel notifications (alternative au dropdown legacy)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  // Sprint 54 — Power Dialer
  const [dialerOpen, setDialerOpen] = useState(false);
  const toast = useToast();
  const [cmdOpen, setCmdOpen] = useState(false);
  // LOT G8 — état d'ouverture du panel assistant IA (raccourci Cmd+/)
  const [assistantOpen, setAssistantOpen] = useState(false);
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

  // ── Sprint S8 — Hydratation reprise multi-appareil de l'onboarding ─────────
  // GET /onboarding/state au montage : si l'user a un état serveur non terminé
  // (currentStep>0 && !completedAt), on passe initialState au WelcomeWizard
  // pour reprendre là où il en était. Best-effort : GET ne faille jamais
  // (défaut neutre), et le localStorage reste le fallback Sprint 45.
  const [onbInitialState, setOnbInitialState] = useState<OnboardingState | undefined>(undefined);
  const [onbStateLoaded, setOnbStateLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // On n'hydrate que si le WelcomeWizard est susceptible de s'afficher.
    if (!showWelcome) { setOnbStateLoaded(true); return; }
    (async () => {
      try {
        const res = await getOnboardingState();
        if (cancelled) return;
        const st = res.data;
        if (st && !st.completedAt && st.currentStep > 0) {
          setOnbInitialState(st);
        }
      } catch {
        /* best-effort — fallback localStorage Sprint 45 conservé */
      } finally {
        if (!cancelled) setOnbStateLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sprint S8 — persistance serveur best-effort des transitions (PUT). Ne
  // bloque jamais l'avancement : le WelcomeWizard appelle ça en fire-and-forget.
  const persistOnboardingState = useCallback((patch: Partial<OnboardingState>) => {
    void putOnboardingState(patch).catch(() => { /* best-effort */ });
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

  // ── LOT WHITE-LABEL APPLY (Sprint 20) — applique le branding du sous-compte
  //    actif au boot, puis ré-applique à chaque changement de sous-compte.
  //    Borné tenant (getActiveSubAccount). Best-effort : jamais de throw, jamais
  //    de blocage du boot. Sans branding ⇒ reset (couleurs/footer Intralys).
  useEffect(() => {
    void resolveAndApplyBranding();
    // Le sous-compte actif est stocké en localStorage (clé X-Sub-Account) :
    // un changement déclenche un `storage` event (autres onglets) et, dans
    // l'onglet courant, un `focus` (retour sur l'app après switch) — on
    // ré-applique dans les deux cas (best-effort, idempotent).
    const reapply = () => { void resolveAndApplyBranding(); };
    window.addEventListener('storage', reapply);
    window.addEventListener('focus', reapply);
    return () => {
      window.removeEventListener('storage', reapply);
      window.removeEventListener('focus', reapply);
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
      toast.info(notif.description || notif.title || t('notif.new'), {
        title: notif.description ? notif.title : undefined,
        action: notif.link
          ? {
              label: t('notif.view'),
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
    // LOT G8 — Cmd+/ (Meta+Slash / Ctrl+Slash) toggle l'assistant IA.
    // Calque exact la détection cmd+K ci-dessus. Ne casse PAS cmd+K.
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault();
      setAssistantOpen(prev => !prev);
    }
    // Sprint 54 — Alt+D toggle le Dialer
    if (e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      setDialerOpen(prev => !prev);
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
          {t('layout.skip_content')}
        </a>
        {/* Header — Stripe-clean : 56px, white bg, border-bottom 1px */}
        {/* Sprint 44 M1.2 : `cap-aware` ajoute safe-area-inset-top sur natif */}
        <header className="cap-aware h-14 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-between px-4 lg:px-6 shrink-0 sticky top-0 z-30">
          {/* Gauche : hamburger + titre */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="inline-flex lg:hidden items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              aria-label={t('layout.open_menu')}
            >
              <Icon as={Menu} size={18} />
            </button>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)] truncate">{title}</h2>
            {offline && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--warning-soft)] text-[var(--warning)] text-[11px] font-medium">
                <Icon as={WifiOff} size={12} /> {t('layout.offline')}
              </span>
            )}
            {!offline && pendingSync > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--info-soft)] text-[var(--info)] text-[11px] font-medium">
                {t('layout.pending').replace('{n}', String(pendingSync))}
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
            <span>{t('layout.search')}</span>
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
              aria-label={t('layout.search_label')}
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
              {t('layout.new')}
            </button>

            {/* Activity feed (Sprint 22) — ghost icon button Stripe */}
            <Tooltip title={t('layout.activity_title')} description={t('layout.activity_desc')}>
              <button
                onClick={() => setActivityOpen(true)}
                className="hidden sm:inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                aria-label={t('layout.activity_label')}
              >
                <Icon as={ActivityIcon} size={16} />
              </button>
            </Tooltip>

            {/* Density toggle (Sprint 21) */}
            <Tooltip
              title={t('layout.density_title')}
              description={`${t('layout.density_current')} : ${density === 'compact' ? t('layout.density_compact') : density === 'spacious' ? t('layout.density_spacious') : t('layout.density_comfort')}. Clic pour cycler.`}
            >
              <button
                data-tour-id="header-density"
                onClick={cycleDensity}
                className="hidden sm:inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                aria-label={t('layout.density_label')}
              >
                {density === 'compact' ? <Icon as={Rows4} size={16} /> : density === 'spacious' ? <Icon as={Rows2} size={16} /> : <Icon as={Rows3} size={16} />}
              </button>
            </Tooltip>

            {/* Theme toggle */}
            <Tooltip title={theme === 'dark' ? t('layout.theme_light') : t('layout.theme_dark')}>
              <button
                onClick={toggleTheme}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                aria-label={t('layout.theme_label')}
              >
                {theme === 'dark' ? <Icon as={Sun} size={16} /> : <Icon as={Moon} size={16} />}
              </button>
            </Tooltip>

            {/* Power Dialer (Sprint 54) */}
            <Tooltip title="Power Dialer" description="Ouvrir le composeur d'appels en rafale">
              <button
                onClick={() => setDialerOpen(prev => !prev)}
                className={`inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors cursor-pointer ${dialerOpen ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
                aria-label="Power Dialer"
              >
                <Icon as={PhoneCall} size={16} />
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
                aria-label={`${t('notif.title')}${unreadCount > 0 ? ` (${t('notif.unread_count').replace('{n}', String(unreadCount))})` : ''}`}
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
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('notif.title')}</h3>
                      {unreadCount > 0 && (
                        <button onClick={() => void markAllRead()} className="text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer">
                          {t('notif.mark_all')}
                        </button>
                      )}
                    </div>
                    {/* Filter chips (segmented-control sober) */}
                    <div className="px-3 py-2 border-b border-[var(--border)]">
                      <div className="segmented-control w-full" role="tablist" aria-label={t('notif.filter_label')}>
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
                            {notifFilter === 'all' ? t('notif.up_to_date') : notifFilter === 'unread' ? t('notif.no_unread') : t('notif.no_mention')}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] max-w-[240px] leading-relaxed">
                            {notifFilter === 'all'
                              ? t('notif.empty_all')
                              : t('notif.empty_filter')}
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
                                        aria-label={high ? t('notif.priority_high') : t('notif.priority_normal')}
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
                                            aria-label={t('notif.open')}
                                            title={t('notif.open')}
                                          >
                                            <Icon as={ExternalLink} size={12} />
                                          </button>
                                        )}
                                        {!notif.is_read && (
                                          <button
                                            type="button"
                                            onClick={(e) => markNotifReadOnly(e, notif)}
                                            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                                            aria-label={t('notif.mark_read')}
                                            title={t('notif.mark_read')}
                                          >
                                            <Icon as={Check} size={12} />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={(e) => dismissNotif(e, notif)}
                                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                                          aria-label={t('notif.dismiss')}
                                          title={t('notif.dismiss')}
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
              🔐 {t('banner.temp_password')}
              <Link to="/change-password" className="ml-1 font-semibold text-[var(--primary)] hover:underline">{t('banner.change_now')}</Link>
            </span>
            <button
              onClick={() => { setShowPwBanner(false); localStorage.removeItem('must_change_password'); }}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >✕</button>
          </div>
        )}

        {/* Contenu de la page — Sprint 38 Stripe-clean : canvas bg + consistent padding */}
        <div id="main-content" tabIndex={-1} className="flex-1 overflow-auto p-4 lg:p-8 focus:outline-none">
          <div className="animate-fade-in max-w-[1400px] mx-auto">
            {children}
          </div>
        </div>
      </main>

      {/* Sprint 34 vague 34-2A — Banner premium online/offline (sous header, z-50) */}
      <NetworkStatusBanner />

      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />
      {/* LOT G8 — Assistant IA conversationnel (panel slide-over droit, Cmd+/) */}
      {/* SPRINT 11 — contexte de page courante (route + entité) dérivé du pathname */}
      <AiAssistantPanel
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        pageContext={derivePageContext(routerLocation.pathname)}
      />
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
      {/* Sprint 45 M1.1 — Welcome wizard personnalisé (Stripe-clean).
          Sprint S8 — DOUBLE-ONBOARDING NEUTRALISÉ (additif, legacy intact) :
          (1) `!showOnboarding` ⇒ WelcomeWizard ne monte JAMAIS pendant que le
              legacy <OnboardingWizard> (Sprint 23/24) est affiché ;
          (2) l'initialiseur `showWelcome` (plus haut) backfill silencieusement
              `onboarding_completed=1` si le legacy a été dismissé OU si le
              backend dit l'onboarding déjà fait (`onboarding_step !== 0`),
              ⇒ un compte existant ne revoit pas l'onboarding.
          Le fichier legacy OnboardingWizard.tsx N'EST PAS supprimé/modifié.
          Sprint S8 — on attend la résolution du GET /onboarding/state
          (`onbStateLoaded`) avant de monter, pour pouvoir hydrater la reprise
          multi-appareil sans flash de l'étape 1. */}
      {showWelcome && !showOnboarding && onbStateLoaded && (
        <WelcomeWizard
          open
          initialName={user?.name || ''}
          initialEmail={user?.email || ''}
          initialState={onbInitialState}
          onPersist={persistOnboardingState}
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
      {/* Sprint 54 — Power Dialer flottant */}
      {dialerOpen && (
        <FloatingDialerPanel onClose={() => setDialerOpen(false)} />
      )}

      {/* Sprint 34 vague 34-3B — Live regions invisibles pour annonces SR */}
      <LiveRegionPortal />
    </div>
  );
}
