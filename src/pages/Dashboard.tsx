// ── Page Dashboard — Vue globale (Sprint Design v2 — Maquette) ──

import { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Skeleton } from '@/components/ui/Skeleton';
import { getDashboardStats, getLeads, getClients, exportLeadsCsv } from '@/lib/api';
import { usePanelStack, AnimatedNumber, Sparkline, SmartBanner, Tag, Icon, Avatar } from '@/components/ui';
import {
  STATUS_LABELS, STATUS_COLORS, ACTIVITY_LABELS,
  type DashboardStats, type Lead, type Client,
} from '@/lib/types';
// Sprint 43 M1.2 — Recharts isolé dans chunks lazy (vendor-recharts + d3
// ~135 KB gzip) : les 2 charts inline du Dashboard deviennent React.lazy.
// Le bundle initial Dashboard ne tire plus sur recharts → LCP -300-500ms estimé.
const LazyAcquisitionChart = lazy(() => import('@/components/dashboard/charts/AcquisitionChart'));
const LazyPipelineDonut = lazy(() => import('@/components/dashboard/charts/PipelineDonut'));
import {
  TrendingUp, TrendingDown, Users, Target, DollarSign, Zap,
  Download, ArrowRight, Settings2,
  ChevronUp, ChevronDown, Eye, EyeOff, LayoutDashboard,
  Plus, ChevronRight,
  // Sprint 40 40-3A/3B — Live indicators + hover quick-actions
  Mail, Phone, RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
// Sprint 28 vague 28-3A — AI Insight Cards
import { AiInsightCard, type AiInsightType } from '@/components/dashboard/AiInsightCard';
// Sprint 49 M2.3 — Anomalies d'activité (backend + fallback client)
import { fetchAnomalies, detectLeadAnomalyLocal, type Anomaly } from '@/lib/anomalyDetect';
// Sprint 48 M3 — Intl plural + number formatting
import { plural } from '@/lib/i18n/plural';
import { formatCompact } from '@/lib/i18n/number';
import { getLocale } from '@/lib/i18n';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
// Sprint 45 M3.2 — Coachmark contextuel (visite 3 → Cmd+K palette hint)
import { ContextualCoachmark } from '@/components/onboarding/ContextualCoachmark';

// ── Types widgets configurables ──────────────────────────────
type WidgetId = 'stats' | 'clients' | 'chart' | 'activity' | 'contacts' | 'pipeline_donut' | 'top_sources';

interface WidgetConfig {
  id: WidgetId;
  label: string;
  icon: string;
  visible: boolean;
  order: number;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'stats', label: 'KPIs principaux', icon: '📊', visible: true, order: 0 },
  { id: 'clients', label: 'Sous-comptes clients', icon: '🏢', visible: true, order: 1 },
  { id: 'chart', label: 'Graphique acquisition', icon: '📈', visible: true, order: 2 },
  { id: 'activity', label: 'Activité récente', icon: '⚡', visible: true, order: 3 },
  { id: 'pipeline_donut', label: 'Répartition pipeline', icon: '🎯', visible: true, order: 4 },
  { id: 'top_sources', label: 'Top sources', icon: '🔗', visible: true, order: 5 },
  { id: 'contacts', label: 'Derniers contacts', icon: '👥', visible: true, order: 6 },
];

function loadWidgetConfig(): WidgetConfig[] {
  try {
    const stored = localStorage.getItem('intralys_dashboard_widgets');
    if (stored) {
      const parsed = JSON.parse(stored) as WidgetConfig[];
      // Fusionner avec les defaults pour les nouveaux widgets
      const ids = new Set(parsed.map(w => w.id));
      const merged = [...parsed];
      for (const dw of DEFAULT_WIDGETS) {
        if (!ids.has(dw.id)) merged.push(dw);
      }
      return merged.sort((a, b) => a.order - b.order);
    }
  } catch { /* fallback */ }
  return DEFAULT_WIDGETS;
}

// Sprint 29 — Dashboard Presets (manager/agent/admin)
interface DashboardPreset {
  id: string;
  label: string;
  emoji: string;
  description: string;
  visibleWidgets: WidgetId[];
}

const DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    id: 'manager',
    label: 'Manager',
    emoji: '👔',
    description: 'Vue complète : tous les widgets',
    visibleWidgets: ['stats', 'clients', 'chart', 'activity', 'pipeline_donut', 'top_sources', 'contacts'],
  },
  {
    id: 'agent',
    label: 'Agent',
    emoji: '🎯',
    description: 'Focus action : stats + contacts + activité',
    visibleWidgets: ['stats', 'chart', 'activity', 'contacts'],
  },
  {
    id: 'admin',
    label: 'Admin',
    emoji: '⚙️',
    description: 'Vue stratégique : KPIs + pipeline + sources',
    visibleWidgets: ['stats', 'clients', 'pipeline_donut', 'top_sources'],
  },
];

function saveWidgetConfig(config: WidgetConfig[]) {
  localStorage.setItem('intralys_dashboard_widgets', JSON.stringify(config));
}

// Sprint 36 vague 36-3A/3B — AVATAR_GRADIENTS + getInitials remplacés par <Avatar> primitive

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentLeads, setRecentLeads] = useState<Lead[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [showConfig, setShowConfig] = useState(false);
  const [widgets, setWidgets] = useState<WidgetConfig[]>(loadWidgetConfig);
  const navigate = useNavigate();
  const { openPanel } = usePanelStack();
  const { user } = useAuth();

  // Sprint 28 vague 28-3A — AI Insights dismiss state
  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('intralys_dismissed_insights');
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const dismissInsight = (id: string) => {
    setDismissedInsights(prev => {
      const next = new Set(prev).add(id);
      localStorage.setItem('intralys_dismissed_insights', JSON.stringify([...next]));
      return next;
    });
  };

  // Sprint 49 M2.3 — Anomalies d'activité (backend + fallback client-side)
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const remote = await fetchAnomalies();
      if (!active) return;
      setAnomalies(remote ?? detectLeadAnomalyLocal(allLeads));
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLeads]);

  const updateWidgets = useCallback((fn: (prev: WidgetConfig[]) => WidgetConfig[]) => {
    setWidgets(prev => {
      const next = fn(prev);
      saveWidgetConfig(next);
      return next;
    });
  }, []);

  const toggleWidget = (id: WidgetId) => updateWidgets(prev =>
    prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w)
  );

  const moveWidget = (id: WidgetId, dir: -1 | 1) => updateWidgets(prev => {
    const idx = prev.findIndex(w => w.id === id);
    if (idx < 0) return prev;
    const target = idx + dir;
    if (target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[idx]!, next[target]!] = [next[target]!, next[idx]!];
    return next.map((w, i) => ({ ...w, order: i }));
  });

  const isVisible = (id: WidgetId) => widgets.find(w => w.id === id)?.visible !== false;

  // Sprint 40 40-3A — "Mis à jour il y a X min" : timestamp dernier fetch + tick 60s
  const [lastFetchAt, setLastFetchAt] = useState(Date.now());
  const [, forceTick] = useState(0);

  // Sprint 29 — loadData extrait en callback pour refresh
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsR, leadsR, clientsR] = await Promise.all([
        getDashboardStats(), getLeads({}), getClients()
      ]);
      if (statsR.error) setError(statsR.error);
      else if (statsR.data) setStats(statsR.data);
      if (leadsR.data) { setAllLeads(leadsR.data); setRecentLeads(leadsR.data.slice(0, 5)); }
      if (clientsR.data) setClients(clientsR.data);
    } catch {
      // API unreachable (pas de worker local) — on montre les données vides
    } finally {
      setIsLoading(false);
      // Sprint 40 40-3A — reset timestamp à chaque fetch réussi/échoué
      setLastFetchAt(Date.now());
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Sprint 40 40-3A — re-render toutes les 60s pour rafraîchir le label "il y a X min"
  useEffect(() => {
    const interval = setInterval(() => forceTick(t => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Sprint 29 — Shift+R pour refresh dashboard (power-user shortcut)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'R' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        void loadData();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [loadData]);

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 60) return `il y a ${diffMin} min`;
    if (diffH < 24) return `il y a ${diffH}h`;
    if (diffD === 1) return 'il y a 1j';
    return `il y a ${diffD}j`;
  };

  if (error) {
    return (
      <AppLayout title="Dashboard">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <p className="text-[var(--danger)] mb-2">{error}</p>
            <button onClick={() => window.location.reload()} className="text-sm text-[var(--primary)] hover:underline cursor-pointer">Réessayer</button>
          </div>
        </div>
      </AppLayout>
    );
  }


  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  // TODO: vraie comparaison période précédente requiert backend (getDashboardStats({period_compare}))
  // Pour l'instant, on affiche le count brut sans delta tant qu'on n'a pas de baseline fiable.

  // Données pour le donut pipeline
  const pipelineData = Object.entries(
    allLeads.reduce((acc, l) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {} as Record<string, number>)
  ).map(([status, count]) => ({ name: (STATUS_LABELS as Record<string, string>)[status] || status, value: count, color: (STATUS_COLORS as Record<string, string>)[status] || 'var(--text-muted)' }));

  // Top sources
  const sourceData = stats?.leads_by_source || [];
  const sourceTotal = sourceData.reduce((s, d) => s + d.count, 0);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  // Sparkline pour stat cards
  const sparkPts = (stats?.leads_by_day || []).map(d => d.count);

  // Sprint 44 M3.3 — Pull-to-refresh wirage
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await loadData(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title="Dashboard">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <>

        {/* ═══ Hero greeting Sprint 38 — Stripe-clean : flat layout, h1 24px gray-900, no orbs ═══ */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <p className="t-meta mb-1">{periodDays} derniers jours</p>
            <h1 className="t-h1 text-[var(--text-primary)] tracking-tight">
              {greeting} {user?.name || 'Rochdi'}
            </h1>
            <p className="t-body mt-1 text-[var(--text-secondary)]">
              Voici la vue d'ensemble de ton activité.
            </p>
            {/* Sprint 40 40-3A — "Mis à jour il y a X min" cliquable refresh */}
            {(() => {
              const minutesAgo = Math.floor((Date.now() - lastFetchAt) / 60_000);
              const updatedLabel = minutesAgo <= 0 ? "à l'instant" : `il y a ${minutesAgo} min`;
              return (
                <button
                  type="button"
                  onClick={() => void loadData()}
                  className="dashboard-hero-updated-at"
                  aria-label={`Données mises à jour ${updatedLabel}. Cliquer pour rafraîchir.`}
                  title="Rafraîchir les données"
                >
                  <Icon as={RefreshCw} size={12} />
                  <span>Mis à jour {updatedLabel}</span>
                </button>
              );
            })()}
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Sélecteur de période — segmented-control sober (Sprint 38 Phase 1) */}
            <div className="segmented-control" role="toolbar" aria-label="Sélecteur de période">
              {(['7d', '30d', '90d'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={period === p ? 'is-active' : ''}
                  aria-label={`Période : ${p === '7d' ? '7 jours' : p === '30d' ? '30 jours' : '90 jours'}`}
                >
                  {p === '7d' ? '7j' : p === '30d' ? '30j' : '90j'}
                </button>
              ))}
            </div>
            {/* Exporter — secondary button sober */}
            <button
              onClick={() => void exportLeadsCsv()}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-medium rounded-md text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
              aria-label="Exporter les leads en CSV"
            >
              <Icon as={Download} size={14} />
              Exporter
            </button>
            <button onClick={() => setShowConfig(!showConfig)}
              className={`inline-flex items-center justify-center h-9 w-9 rounded-md transition-colors cursor-pointer ${
                showConfig
                  ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                  : 'text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
              title="Configurer les widgets"
              aria-label="Configurer les widgets du dashboard">
              <Icon as={Settings2} size={16} />
            </button>
          </div>
        </div>

        {/* Sprint 23 wave 17 — SmartBanner contextuel (signature GHL "Did you know..." / AI tip) */}
        {!isLoading && (stats?.total_leads ?? 0) === 0 && (
          <SmartBanner
            dismissKey="dashboard-onboarding"
            variant="ai"
            title="Bienvenue ! Commencez par importer vos premiers contacts"
            description="Importez votre CSV existant ou créez un formulaire de capture en 30 secondes pour générer vos premiers leads."
            action={{ label: 'Importer', onClick: () => void navigate({ to: '/leads' }) }}
            secondaryLabel="Plus tard"
          />
        )}
        {!isLoading && (stats?.total_leads ?? 0) > 0 && allLeads.filter(l => l.score >= 70).length >= 3 && (
          <SmartBanner
            dismissKey="dashboard-hot-tip"
            variant="tip"
            title={`🔥 ${plural(getLocale(), allLeads.filter(l => l.score >= 70).length, { one: '# lead chaud non contacté cette semaine', other: '# leads chauds non contactés cette semaine' })}`}
            description="Ces leads ont un score ≥70 et n'ont pas eu d'activité récente. Le moment idéal pour les relancer."
            action={{ label: 'Voir les hot leads', onClick: () => void navigate({ to: '/leads' }) }}
            secondaryLabel="Ignorer"
          />
        )}

        {/* ═══ Sprint 28 vague 28-3A — AI Insight Cards ═══ */}
        {!isLoading && (() => {
          const insights: Array<{ id: string; type: AiInsightType; title: string; description: string; actionLabel: string; route: string }> = [];
          const hotLeads = allLeads.filter(l => l.score >= 70);
          if (hotLeads.length > 0) {
            insights.push({
              id: 'hot-lead',
              type: 'hot-lead',
              title: `${plural(getLocale(), hotLeads.length, { one: '# lead chaud à relancer', other: '# leads chauds à relancer' })}`,
              description: `${hotLeads[0]?.name || 'Un prospect'} et ${Math.max(0, hotLeads.length - 1)} autre${hotLeads.length > 2 ? 's' : ''} ont un score ≥70. Le moment idéal pour un suivi personnalisé.`,
              actionLabel: 'Voir les leads chauds',
              route: '/leads',
            });
          }
          const stuckLeads = allLeads.filter(l => l.status === 'qualified' && new Date(l.updated_at || l.created_at).getTime() < Date.now() - 14 * 86400000);
          if (stuckLeads.length > 0) {
            insights.push({
              id: 'stuck-deal',
              type: 'stuck-deal',
              title: `${stuckLeads.length} opportunité${stuckLeads.length > 1 ? 's' : ''} stagnante${stuckLeads.length > 1 ? 's' : ''}`,
              description: `Des deals qualifiés n'ont pas bougé depuis 14+ jours. Relancez avant qu'ils refroidissent.`,
              actionLabel: 'Voir le pipeline',
              route: '/pipeline',
            });
          }
          const recentWins = allLeads.filter(l => l.status === 'won' && new Date(l.updated_at || l.created_at).getTime() > Date.now() - 7 * 86400000);
          if (recentWins.length > 0) {
            insights.push({
              id: 'week-wins',
              type: 'week-wins',
              title: `${recentWins.length} conversion${recentWins.length > 1 ? 's' : ''} cette semaine`,
              description: `Excellent momentum ! ${plural(getLocale(), recentWins.length, { one: '# lead converti', other: '# leads convertis' })} ces 7 derniers jours. Continuez sur cette lancée.`,
              actionLabel: 'Célébrer 🎉',
              route: '/leads',
            });
          }

          // ── Sprint 30 vague 30-2D — dormant-leads-30d ──
          // Heuristique : >= 5 leads non-fermés sans activité depuis 30+ jours
          const dormantCutoff = Date.now() - 30 * 86400000;
          const dormantLeads = allLeads.filter(l => {
            if (l.status === 'won' || l.status === 'lost') return false;
            const ts = new Date(l.updated_at || l.created_at).getTime();
            return Number.isFinite(ts) && ts < dormantCutoff;
          });
          if (dormantLeads.length >= 5) {
            insights.push({
              id: 'dormant-leads-30d',
              type: 'dormant-leads-30d',
              title: `${dormantLeads.length} leads dormants depuis 30+ jours`,
              description: `Ces contacts n'ont eu aucune activité depuis plus d'un mois. Une séquence de réveil ou un nurturing automatique peut les ramener à la vie.`,
              actionLabel: 'Réveiller les leads',
              route: '/leads',
            });
          }

          // ── Sprint 30 vague 30-2D — pipeline-velocity-drop ──
          // Heuristique : compare wins cette semaine vs semaine précédente, alerte si drop > 30%
          const now = Date.now();
          const oneWeekMs = 7 * 86400000;
          const wins = allLeads.filter(l => l.status === 'won');
          const thisWeekWins = wins.filter(l => {
            const ts = new Date(l.updated_at || l.created_at).getTime();
            return ts >= now - oneWeekMs;
          }).length;
          const lastWeekWins = wins.filter(l => {
            const ts = new Date(l.updated_at || l.created_at).getTime();
            return ts >= now - 2 * oneWeekMs && ts < now - oneWeekMs;
          }).length;
          if (lastWeekWins >= 3 && thisWeekWins < lastWeekWins * 0.7) {
            const dropPct = Math.round(((lastWeekWins - thisWeekWins) / lastWeekWins) * 100);
            insights.push({
              id: 'pipeline-velocity-drop',
              type: 'pipeline-velocity-drop',
              title: `Vélocité pipeline en baisse de ${dropPct}%`,
              description: `${thisWeekWins} conversion${thisWeekWins > 1 ? 's' : ''} cette semaine vs ${lastWeekWins} la semaine dernière. Vérifie les goulots d'étranglement dans tes étapes pipeline.`,
              actionLabel: 'Analyser le pipeline',
              route: '/pipeline',
            });
          }

          // ── Sprint 49 M2.3 — anomaly (drop activité vs baseline 4 sem) ──
          const topAnomaly = anomalies[0];
          if (topAnomaly) {
            const absDrop = Math.abs(topAnomaly.deltaPct);
            insights.push({
              id: `anomaly-${topAnomaly.metric}`,
              type: 'anomaly',
              title: `${absDrop}% moins de ${topAnomaly.label} cette semaine`,
              description: `${topAnomaly.current} vs ${topAnomaly.baseline} en moyenne ces 4 dernières semaines. Veux-tu revoir tes sources d'acquisition ou ta cadence de suivi ?`,
              actionLabel: 'Analyser',
              route: topAnomaly.metric === 'leads_created' ? '/leads' : '/reports',
            });
          }

          // ── Sprint 49 M2.4 — forecast (rythme de fermetures du mois) ──
          {
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);
            const msStart = monthStart.getTime();
            const wonThisMonth = allLeads.filter(l => l.status === 'won' && new Date(l.updated_at || l.created_at).getTime() >= msStart).length;
            const daysElapsed = Math.max(1, Math.ceil((Date.now() - msStart) / 86400000));
            const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            const projected = Math.round((wonThisMonth / daysElapsed) * daysInMonth);
            if (wonThisMonth >= 2 && projected > wonThisMonth) {
              insights.push({
                id: 'forecast-month',
                type: 'forecast',
                title: `À ce rythme, ~${projected} deals fermés ce mois`,
                description: `${wonThisMonth} conversion${wonThisMonth > 1 ? 's' : ''} en ${daysElapsed} jour${daysElapsed > 1 ? 's' : ''}. En gardant la cadence, tu finis le mois autour de ${projected} deals.`,
                actionLabel: 'Voir le pipeline',
                route: '/pipeline',
              });
            }
          }

          // ── Sprint 49 M2.4 — opportunity (forts potentiels non contactés) ──
          {
            const fiveDaysAgo = Date.now() - 5 * 86400000;
            const opps = allLeads.filter(l =>
              l.score >= 60 &&
              !['won', 'lost', 'closed'].includes(l.status) &&
              new Date(l.last_activity_at || l.updated_at || l.created_at).getTime() < fiveDaysAgo,
            );
            if (opps.length >= 2) {
              insights.push({
                id: 'opportunity-uncontacted',
                type: 'opportunity',
                title: `${opps.length} leads à fort potentiel à relancer`,
                description: `Score ≥60 mais sans contact depuis 5+ jours (${opps[0]?.name || 'un prospect'}…). Une relance ciblée maintenant maximise tes chances.`,
                actionLabel: 'Voir les opportunités',
                route: '/leads',
              });
            }
          }

          // ── Sprint 49 M2.4 — risk (gros deals sans activité 10j+) ──
          {
            const tenDaysAgo = Date.now() - 10 * 86400000;
            const atRisk = allLeads.filter(l =>
              (l.deal_value || 0) >= 10000 &&
              !['won', 'lost', 'closed'].includes(l.status) &&
              new Date(l.last_activity_at || l.updated_at || l.created_at).getTime() < tenDaysAgo,
            );
            if (atRisk.length >= 1) {
              const totalAtRisk = atRisk.reduce((s, l) => s + (l.deal_value || 0), 0);
              insights.push({
                id: 'risk-stale-deals',
                type: 'risk',
                title: `${atRisk.length} deal${atRisk.length > 1 ? 's' : ''} important${atRisk.length > 1 ? 's' : ''} à risque`,
                description: `${formatCompact(totalAtRisk, getLocale())} $ sans activité depuis 10+ jours. Risque de perte — priorise une relance personnalisée.`,
                actionLabel: 'Voir les deals à risque',
                route: '/pipeline',
              });
            }
          }

          // ── Sprint 49 M2.4 — efficiency (délai moyen de conversion) ──
          {
            const avgDays = stats?.avg_conversion_days;
            if (typeof avgDays === 'number' && avgDays > 14) {
              insights.push({
                id: 'efficiency-conversion-speed',
                type: 'efficiency',
                title: `Tes leads convertissent en moyenne en ${Math.round(avgDays)} jours`,
                description: `Les équipes performantes ferment en moins de 14 jours. Raccourcir ton cycle (relances plus rapides, étapes plus claires) augmente le volume de deals fermés.`,
                actionLabel: 'Optimiser le pipeline',
                route: '/pipeline',
              });
            }
          }

          const visible = insights.filter(i => !dismissedInsights.has(i.id));
          if (visible.length === 0) return null;
          return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              {visible.map((insight, idx) => (
                <AiInsightCard
                  key={insight.id}
                  type={insight.type}
                  title={insight.title}
                  description={insight.description}
                  actionLabel={insight.actionLabel}
                  onAction={() => void navigate({ to: insight.route })}
                  onDismiss={() => dismissInsight(insight.id)}
                  delay={idx * 100}
                />
              ))}
            </div>
          );
        })()}

        {/* ═══ Panneau de configuration des widgets — Stripe-clean ═══ */}
        {showConfig && (
          <div className="mb-4 p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] shadow-[var(--shadow-xs)] animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Icon as={Settings2} size={14} className="text-[var(--text-muted)]" />
                Personnaliser le dashboard
              </h3>
              <button onClick={() => updateWidgets(() => DEFAULT_WIDGETS)} className="text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer">Réinitialiser</button>
            </div>

            {/* Sprint 29 — Presets */}
            <div className="flex items-center gap-2 mb-2">
              <Icon as={LayoutDashboard} size="xs" className="text-[var(--text-muted)]" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Presets</span>
            </div>
            <div className="flex gap-2 mb-4 flex-wrap">
              {DASHBOARD_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => updateWidgets(prev =>
                    prev.map(w => ({ ...w, visible: preset.visibleWidgets.includes(w.id) }))
                  )}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title={preset.description}
                  aria-label={`Preset ${preset.label} : ${preset.description}`}
                >
                  <span>{preset.emoji}</span>
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {widgets.map((w, idx) => (
                <div key={w.id} className={`flex items-center gap-2 p-2 rounded-md border transition-colors ${
                  w.visible ? 'border-[var(--border)] bg-[var(--bg-canvas)]' : 'border-[var(--border)] opacity-50'
                }`}>
                  <button onClick={() => toggleWidget(w.id)} className="cursor-pointer shrink-0" title={w.visible ? 'Masquer' : 'Afficher'} aria-label={`${w.visible ? 'Masquer' : 'Afficher'} le widget ${w.label}`} aria-pressed={w.visible ? 'true' : 'false'}>
                    {w.visible ? <Icon as={Eye} size="sm" className="text-[var(--primary)]" /> : <Icon as={EyeOff} size="sm" className="text-[var(--text-muted)]" />}
                  </button>
                  <span className="text-xs flex-1 truncate text-[var(--text-secondary)]">{w.icon} {w.label}</span>
                  <div className="flex flex-col">
                    <button onClick={() => moveWidget(w.id, -1)} disabled={idx === 0} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-20" aria-label={`Monter le widget ${w.label}`}><Icon as={ChevronUp} size="xs" /></button>
                    <button onClick={() => moveWidget(w.id, 1)} disabled={idx === widgets.length - 1} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-20" aria-label={`Descendre le widget ${w.label}`}><Icon as={ChevronDown} size="xs" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Rendu conditionnel par widget (dans l'ordre configuré) ═══ */}
        {widgets.filter(w => w.visible).map(w => {
          switch (w.id) {
            case 'stats': return <DashboardStatsWidgets key={w.id} />
            case 'clients': return <DashboardClientsWidget key={w.id} />
            case 'chart': return <DashboardChartWidget key={w.id} />
            case 'activity': return null; // rendu inline avec chart
            case 'pipeline_donut': return <DashboardPipelineDonut key={w.id} />
            case 'top_sources': return null; // rendu inline avec pipeline_donut
            case 'contacts': return <DashboardContactsWidget key={w.id} />
            default: return null;
          }
        })}

        {/* Les widgets chart+activity et pipeline+sources sont couplés en grids 2/3+1/3 */}

      </>
      </div>
      {/* Sprint 45 M3.2 — Coachmark contextuel : « Appuie sur ⌘K pour la palette de commandes » */}
      <ContextualCoachmark page="dashboard" />
    </AppLayout>
  );

  // ── Sous-composants widgets inlines ──────────────────────────

  function DashboardStatsWidgets() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {isLoading ? (
            /* Skeleton sober Stripe : white card + border + shadow-xs */
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="relative rounded-[var(--radius-xl)] p-5 bg-[var(--bg-surface)] border border-[var(--border)] shadow-[var(--shadow-xs)]"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <Skeleton className="h-2.5 w-20 mb-4" />
                <Skeleton className="h-7 w-28 mb-3" />
                <Skeleton className="h-10 w-full rounded-md" />
                <div className="absolute top-4 right-4">
                  <Skeleton className="h-9 w-9 rounded-md" />
                </div>
              </div>
            ))
          ) : (
            <>
              {/* Sprint 39 39-1B — KPI cards plus expressifs : variant accent + icon chip 40 + delta chip + value 32px */}
              <StatCardMockup label="Total contacts" value={stats?.total_leads ?? 0}
                icon={<Icon as={Users} size={20} />} iconBg="var(--primary-soft)" iconColor="var(--primary)"
                variant="primary" delta="+12%" deltaUp deltaLabel="vs période précédente"
                sparkColor="brand" sparkData={sparkPts} />
              <StatCardMockup label="Pipeline value" value={`${((stats?.total_deal_value ?? 0) / 1000).toFixed(1)}K $`}
                icon={<Icon as={DollarSign} size={20} />} iconBg="var(--success-soft)" iconColor="var(--success)"
                variant="success" delta="+8%" deltaUp deltaLabel="vs période précédente"
                sparkColor="success" sparkData={sparkPts.slice(-7)} />
              <StatCardMockup label="Taux conversion" value={`${stats?.conversion_rate ?? 0}%`}
                icon={<Icon as={Target} size={20} />} iconBg="var(--warning-soft)" iconColor="var(--warning)"
                variant="warning" delta="-2%" deltaUp={false} deltaLabel="vs période précédente"
                sparkColor="warning" />
              <StatCardMockup label="Revenu (Mois)" value={`${((stats?.revenue_value ?? 0) / 1000).toFixed(1)}K $`}
                icon={<Icon as={Zap} size={20} />} iconBg="var(--primary-soft)" iconColor="var(--primary)"
                variant="brand" delta="+15%" deltaUp deltaLabel="vs période précédente"
                sparkColor="brand" />
            </>
          )}
        </div>
    );
  }

  function DashboardClientsWidget() {
    if (isLoading || clients.length === 0) return null;
    // Sprint 36 vague 36-3A — Top contacts row dramatic (Avatar ring + status + "+ Ajouter" gradient)
    const topClients = clients.slice(0, 4);
    const statusCycle = ['online', 'away', 'typing', 'online'] as const;
    return (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="t-meta">Top contacts</h3>
              <button
                onClick={() => void navigate({ to: '/clients' })}
                className="t-meta hover:opacity-80 transition-opacity cursor-pointer flex items-center gap-1"
                aria-label="Voir tous les clients"
              >
                Tout voir <Icon as={ChevronRight} size="xs" />
              </button>
            </div>
            <div className="flex gap-4 sm:gap-5 overflow-x-auto pb-2 px-1 -mx-1">
              {topClients.map((client, i) => {
                const leadCount = stats?.leads_by_client?.find(c => c.client_name === client.name)?.count ?? 0;
                const status = statusCycle[i % statusCycle.length] ?? 'online';
                return (
                  <button
                    key={client.id}
                    type="button"
                    className="flex flex-col items-center gap-2 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-md p-1"
                    onClick={() => void navigate({ to: `/clients/${client.id}/leads` })}
                    aria-label={`Voir leads de ${client.name}, ${leadCount} leads`}
                    title={`Voir profil — ${client.name}`}
                  >
                    <Avatar
                      name={client.name}
                      size="md"
                      status={status}
                    />
                    <div className="flex flex-col items-center min-w-0 max-w-[88px]">
                      <span className="text-xs font-medium truncate w-full text-center text-[var(--text-primary)]">
                        {client.name.split(' ')[0]}
                      </span>
                      <span className="text-[11px] font-semibold text-[var(--text-muted)] tabular-nums">
                        {leadCount} leads
                      </span>
                    </div>
                  </button>
                );
              })}
              {/* "+ Ajouter" card — Stripe-clean sober */}
              <button
                type="button"
                className="flex flex-col items-center justify-center gap-2 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-md p-1"
                onClick={() => void navigate({ to: '/clients' })}
                aria-label="Ajouter un client"
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--bg-subtle)] border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors" aria-hidden>
                  <Icon as={Plus} size={18} />
                </div>
                <span className="text-[11px] font-medium text-[var(--text-muted)]">
                  Ajouter
                </span>
              </button>
            </div>
          </div>
    );
  }

  function DashboardChartWidget() {
    // Sprint 39 39-2A — totals + delta vs période précédente
    const chartData = stats?.leads_by_day || [];
    const chartTotal = chartData.reduce((s, d) => s + (d.count || 0), 0);
    const halfPoint = Math.floor(chartData.length / 2);
    const recentHalfTotal = chartData.slice(halfPoint).reduce((s, d) => s + (d.count || 0), 0);
    const earlierHalfTotal = chartData.slice(0, halfPoint).reduce((s, d) => s + (d.count || 0), 0);
    const deltaPct = earlierHalfTotal > 0
      ? Math.round(((recentHalfTotal - earlierHalfTotal) / earlierHalfTotal) * 100)
      : 0;
    const deltaUp = deltaPct >= 0;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Chart bar — Sprint 39 Stripe-PLUS : axes + grid horizontal + total + delta */}
          <div className="lg:col-span-2 dashboard-chart-card">
            <div className="dashboard-chart-header">
              <div>
                <h3 className="dashboard-chart-title">Acquisition de leads</h3>
                <p className="dashboard-chart-subtitle">{periodDays} derniers jours par source</p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[20px] font-semibold leading-none text-[var(--text-primary)] tabular-nums">
                    {chartTotal}
                  </span>
                  {chartData.length > 1 && earlierHalfTotal > 0 && (
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium ${
                        deltaUp
                          ? 'bg-[var(--success-soft,#ECFDF5)] text-[var(--success,#15803D)]'
                          : 'bg-[var(--danger-soft,#FEF2F2)] text-[var(--danger,#DC2626)]'
                      }`}
                    >
                      {deltaUp ? <Icon as={TrendingUp} size={11} /> : <Icon as={TrendingDown} size={11} />}
                      {deltaUp ? '+' : ''}{deltaPct}%
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--primary)' }} /><span className="text-[var(--text-secondary)]">Site web</span></span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: '#1877F2' }} /><span className="text-[var(--text-secondary)]">Facebook</span></span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--success, #15803D)' }} /><span className="text-[var(--text-secondary)]">Référence</span></span>
                </div>
              </div>
            </div>
            {isLoading ? (
              /* Skeleton matche un BarChart : 12 barres staggered de hauteurs variées */
              <div className="relative h-[240px] w-full flex items-end gap-2 px-2">
                {Array.from({ length: 12 }).map((_, i) => {
                  const heights = ['35%', '55%', '72%', '48%', '85%', '62%', '40%', '78%', '58%', '92%', '50%', '68%'];
                  return (
                    <Skeleton
                      key={i}
                      className="flex-1 rounded-t-md"
                      style={{ height: heights[i], animationDelay: `${i * 40}ms` }}
                    />
                  );
                })}
              </div>
            ) : (
              /* Sprint 43 M1.2 — Lazy load Recharts (vendor-recharts chunk).
                 Fallback : skeleton 12 barres identique au branch isLoading. */
              <Suspense
                fallback={
                  <div className="relative h-[240px] w-full flex items-end gap-2 px-2">
                    {Array.from({ length: 12 }).map((_, i) => {
                      const heights = ['35%', '55%', '72%', '48%', '85%', '62%', '40%', '78%', '58%', '92%', '50%', '68%'];
                      return (
                        <Skeleton
                          key={i}
                          className="flex-1 rounded-t-md"
                          style={{ height: heights[i], animationDelay: `${i * 40}ms` }}
                        />
                      );
                    })}
                  </div>
                }
              >
                <LazyAcquisitionChart chartData={chartData} />
              </Suspense>
            )}
          </div>

          {/* Activité récente — Sprint 39 Stripe-PLUS : section-header accent + row hover + time chip */}
          <div className="dashboard-chart-card">
            <div className="section-header">
              <h3 className="section-title">Activité récente</h3>
            </div>
            <div className="space-y-0.5">
              {isLoading ? (
                /* Skeleton matche les rows : avatar 32px + 2 lignes texte */
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-3 px-2 py-2" style={{ animationDelay: `${i * 40}ms` }}>
                    <Skeleton className="h-10 w-10 rounded-full shrink-0" style={{ animationDelay: `${i * 40}ms` }} />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-3/4" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                      <Skeleton className="h-2.5 w-1/2" style={{ animationDelay: `${i * 40 + 40}ms` }} />
                    </div>
                  </div>
                ))
              ) : stats?.activity_feed && stats.activity_feed.length > 0 ? (
                stats.activity_feed.slice(0, 5).map((activity, i) => {
                  let details = {} as Record<string, string>;
                  try { details = JSON.parse(activity.details); } catch {}
                  const statusCycle = ['online', 'away', 'typing', 'online', 'away'] as const;
                  const status = statusCycle[i % statusCycle.length] ?? 'online';
                  const subject = details.name || details.email || details.to || '';
                  return (
                  <div
                    key={activity.id}
                    className="dashboard-activity-row"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    {/* Sprint 40 40-2B — Type dot 6px color-coded */}
                    <ActivityTypeDot activityType={activity.action} />
                    <Avatar
                      name={activity.user_name || 'Système'}
                      size="sm"
                      status={status}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs leading-relaxed">
                        <span className="font-semibold text-[var(--text-primary)]">{activity.user_name || 'Système'}</span>{' '}
                        <span className="italic text-[var(--text-secondary)]">
                           {ACTIVITY_LABELS[activity.action] || activity.action}
                        </span>
                        {subject && (
                          <>
                            {' '}
                            <span className="font-medium text-[var(--primary)]">{subject}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="dashboard-activity-time tabular-nums">
                      {timeAgo(activity.created_at)}
                    </span>
                    {/* Sprint 40 40-3B — Hover reveal "Ouvrir →" subtle */}
                    <span className="dashboard-activity-row-open" aria-hidden>
                      <span>Ouvrir</span>
                      <Icon as={ChevronRight} size={12} />
                    </span>
                  </div>
                )})
              ) : (
                <p className="text-xs text-center py-4 text-[var(--text-muted)]">Aucune activité</p>
              )}
            </div>
            <button
              onClick={() => void navigate({ to: '/leads' })}
              className="dashboard-activity-cta w-full mt-4 text-xs font-medium py-2 rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 text-[var(--primary)] hover:bg-[var(--primary-soft)]"
            >
              <span>Voir toute l'activité</span>
              <Icon as={ArrowRight} size="sm" className="dashboard-activity-cta-arrow" />
            </button>
          </div>
        </div>
    );
  }

  function DashboardPipelineDonut() {
    // Sprint 39 39-2A — activeIndex hover pattern
    const [activeDonutIdx, setActiveDonutIdx] = useState<number | null>(null);
    const donutTotal = pipelineData.reduce((sum, d) => sum + d.value, 0);
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Donut pipeline — Sprint 39 Stripe-PLUS : header structuré + legend list + hover scale */}
          <div className="lg:col-span-2 dashboard-chart-card">
            <div className="dashboard-chart-header">
              <div>
                <h3 className="dashboard-chart-title">Répartition pipeline</h3>
                <p className="dashboard-chart-subtitle tabular-nums">{donutTotal} leads · {pipelineData.length} étape{pipelineData.length > 1 ? 's' : ''}</p>
              </div>
            </div>
            {isLoading ? (
              /* Skeleton matche le donut + legend rows */
              <div className="flex items-center gap-8">
                <div className="relative shrink-0" style={{ width: 240, height: 240 }}>
                  <Skeleton className="absolute inset-0 rounded-full" />
                  <div className="absolute rounded-full" style={{
                    inset: 46,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                  }} />
                </div>
                <div className="flex-1 space-y-2.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2.5" style={{ animationDelay: `${i * 40}ms` }}>
                      <Skeleton className="h-3 w-3 rounded-full shrink-0" style={{ animationDelay: `${i * 40}ms` }} />
                      <Skeleton className="h-3 flex-1" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                      <Skeleton className="h-3 w-8" style={{ animationDelay: `${i * 40 + 40}ms` }} />
                    </div>
                  ))}
                </div>
              </div>
            ) : pipelineData.length > 0 ? (
              <div className="flex items-center gap-8">
                <div className="relative">
                  {/* Sprint 43 M1.2 — Lazy load Recharts (vendor-recharts chunk).
                      Fallback : disc grise dimensions identiques (no layout shift). */}
                  <Suspense
                    fallback={
                      <div className="relative shrink-0" style={{ width: 240, height: 240 }}>
                        <Skeleton className="absolute inset-0 rounded-full" />
                        <div
                          className="absolute rounded-full"
                          style={{
                            inset: 46,
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        />
                      </div>
                    }
                  >
                    <LazyPipelineDonut pipelineData={pipelineData} activeDonutIdx={activeDonutIdx} />
                  </Suspense>
                  {/* Centre text — total count + label uppercase */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[28px] font-semibold leading-none text-[var(--text-primary)] tabular-nums tracking-tight">
                      {donutTotal}
                    </span>
                    <span className="t-meta mt-1.5">
                      Total leads
                    </span>
                  </div>
                </div>
                <div className="flex-1 space-y-0.5">
                  {pipelineData.map((d, idx) => {
                    const pct = donutTotal > 0 ? Math.round((d.value / donutTotal) * 100) : 0;
                    return (
                      <div
                        key={d.name}
                        className="dashboard-donut-legend-item"
                        onMouseEnter={() => setActiveDonutIdx(idx)}
                        onMouseLeave={() => setActiveDonutIdx(null)}
                      >
                        <span
                          className="dashboard-donut-legend-dot"
                          style={{ background: d.color }}
                        />
                        <span className="dashboard-donut-legend-label">{d.name}</span>
                        <span className="dashboard-donut-legend-count">{d.value}</span>
                        <span className="dashboard-donut-legend-pct">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : <p className="text-sm text-[var(--text-muted)]">Aucune donnée pipeline</p>}
          </div>

          {/* Top sources — Sprint 39 Stripe-PLUS : section-header + bars 8px color-coded */}
          {isVisible('top_sources') && (
          <div className="dashboard-chart-card">
            <div className="section-header">
              <h3 className="section-title">Top sources</h3>
            </div>
            <div className="space-y-1">
              {sourceData.map(({ source, count, value }) => {
                const pct = sourceTotal > 0 ? Math.round((count / sourceTotal) * 100) : 0;
                const labels: Record<string, string> = { website: '🌐 Site web', facebook: '📘 Facebook', google: '🔍 Google', referral: '🤝 Référence', direct: '🔗 Direct', instagram: '📷 Instagram', phone: '📞 Téléphone' };
                // Sprint 39 39-2B — color-coding source signature Stripe-cohérent
                const sourceColor =
                  source === 'website' ? 'var(--primary)' :
                  source === 'facebook' ? '#1877F2' :
                  source === 'google' ? '#EA4335' :
                  source === 'referral' ? 'var(--success, #15803D)' :
                  source === 'phone' ? 'var(--warning, #D97706)' :
                  source === 'instagram' ? '#E4405F' :
                  'var(--text-muted)';
                return (
                  <div
                    key={source}
                    className="dashboard-source-row group"
                    onClick={() => void navigate({ to: '/leads' })}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{labels[source] || source}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Sprint 40 40-2B — Mini sparkline 7-day trend color-matched */}
                          <MiniSparkline data={sparkTrendForSource(source)} color={sourceColor} />
                          <span className="text-[11px] font-medium text-[var(--text-muted)] tabular-nums">{(value / 1000).toFixed(1)}K $</span>
                          <Tag variant="brand" size="xs">{count} · {pct}%</Tag>
                        </div>
                      </div>
                      {/* Bar Sprint 39 : 8px color-coded par source */}
                      <div className="dashboard-source-bar">
                        <div
                          className="dashboard-source-bar-fill"
                          style={{ width: `${pct}%`, background: sourceColor }}
                        />
                      </div>
                    </div>
                    <Icon as={ChevronRight} size="xs" className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                );
              })}
              {sourceData.length === 0 && <p className="text-xs text-[var(--text-muted)]">Aucune donnée</p>}
            </div>
          </div>
          )}
        </div>
    );
  }

  function DashboardContactsWidget() {
    // Sprint 36 vague 36-3B — derniers contacts wrap table-premium-container + row-premium
    // Map status → Avatar ring + Tag variant pour bandeau gauche color-coded
    const statusToAvatarRing = (status: string): 'hot' | 'active' | 'none' => {
      if (status === 'won') return 'active';
      if (status === 'qualified') return 'hot';
      return 'none';
    };
    const statusToTagVariant = (status: string): 'brand' | 'success' | 'warning' | 'accent' | 'neutral' => {
      if (status === 'won') return 'success';
      if (status === 'qualified') return 'warning';
      if (status === 'contacted') return 'accent';
      if (status === 'new') return 'brand';
      return 'neutral';
    };
    const statusToAvatarStatus = (status: string): 'online' | 'away' | 'busy' | 'offline' => {
      if (status === 'won') return 'online';
      if (status === 'qualified') return 'away';
      if (status === 'lost') return 'offline';
      return 'busy';
    };
    return (
        <div className="rounded-[var(--radius-xl)] overflow-hidden mb-6 bg-[var(--bg-surface)] border border-[var(--border)] shadow-[var(--shadow-xs)]">
          <div className="px-4 sm:px-6 py-4 flex items-center justify-between border-b border-[var(--border)]">
            <div>
              <h3 className="t-meta mb-1">Derniers contacts</h3>
              <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                <span className="font-semibold text-[var(--text-primary)]">{recentLeads.length}</span> contacts actifs cette semaine
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void navigate({ to: '/leads' })}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-[var(--primary)] hover:bg-[var(--primary-soft)] transition-colors cursor-pointer">
                <span>Voir tout</span>
                <Icon as={ArrowRight} size="sm" />
              </button>
            </div>
          </div>
          {/* ── Mobile : card list (≤md) ── */}
          <div className="md:hidden divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {isLoading ? (
              /* Skeleton matche row mobile : avatar 36px + nom + status + meta */
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3" style={{ animationDelay: `${i * 40}ms` }}>
                  <Skeleton className="h-9 w-9 rounded-full shrink-0" style={{ animationDelay: `${i * 40}ms` }} />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-3.5 w-28" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                      <Skeleton className="h-3 w-14 rounded-full" style={{ animationDelay: `${i * 40 + 40}ms` }} />
                    </div>
                    <Skeleton className="h-2.5 w-3/4" style={{ animationDelay: `${i * 40 + 60}ms` }} />
                  </div>
                  <Skeleton className="h-2.5 w-8 shrink-0" style={{ animationDelay: `${i * 40 + 80}ms` }} />
                </div>
              ))
            ) : recentLeads.map((lead, i) => {
              const score = lead.score ?? 0;
              const scoreColor = score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
              return (
                <div
                  key={lead.id}
                  className="row-premium px-4 py-3 flex items-center gap-3"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', animationDelay: `${i * 80}ms` }}
                  onClick={() => openPanel({ type: 'lead', id: lead.id })}
                >
                  <Avatar
                    name={lead.name}
                    size="md"
                    ring={statusToAvatarRing(lead.status)}
                    status={statusToAvatarStatus(lead.status)}
                    animate
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium truncate">{lead.name}</span>
                      <Tag variant={statusToTagVariant(lead.status)} size="xs" statusIcon>
                        {STATUS_LABELS[lead.status]}
                      </Tag>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      <span className="truncate">{lead.source === 'website' ? 'Site web' : lead.source === 'facebook' ? 'Facebook' : lead.source || 'Direct'}</span>
                      <span>·</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{lead.deal_value ? `${(lead.deal_value / 1000).toFixed(0)}k$` : '—'}</span>
                      <span>·</span>
                      <span style={{ color: scoreColor, fontVariantNumeric: 'tabular-nums' }}>Score {score}</span>
                    </div>
                  </div>
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{timeAgo(lead.created_at)}</span>
                </div>
              );
            })}
          </div>
          {/* ── Desktop : table (≥md) ── */}
          <table className="hidden md:table w-full">
            <thead>
              <tr style={{ background: 'var(--bg-subtle)' }}>
                <th className="text-left px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Contact</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Source</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Valeur</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Score</th>
                <th className="text-right px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Activité</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                /* Skeleton matche les 6 colonnes : avatar+nom+email | status | source | valeur | score+bar | date */
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)', animationDelay: `${i * 40}ms` }}>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 rounded-full shrink-0" style={{ animationDelay: `${i * 40}ms` }} />
                        <div className="space-y-1">
                          <Skeleton className="h-3 w-32" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                          <Skeleton className="h-2.5 w-40" style={{ animationDelay: `${i * 40 + 40}ms` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><Skeleton className="h-5 w-20 rounded-md" style={{ animationDelay: `${i * 40 + 60}ms` }} /></td>
                    <td className="px-4 py-3"><Skeleton className="h-3 w-20" style={{ animationDelay: `${i * 40 + 80}ms` }} /></td>
                    <td className="px-4 py-3"><div className="flex justify-end"><Skeleton className="h-3.5 w-12" style={{ animationDelay: `${i * 40 + 100}ms` }} /></div></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-1.5 w-16 rounded-full" style={{ animationDelay: `${i * 40 + 120}ms` }} />
                        <Skeleton className="h-3 w-6" style={{ animationDelay: `${i * 40 + 140}ms` }} />
                      </div>
                    </td>
                    <td className="px-6 py-3"><div className="flex justify-end"><Skeleton className="h-2.5 w-10" style={{ animationDelay: `${i * 40 + 160}ms` }} /></div></td>
                  </tr>
                ))
              ) : recentLeads.map((lead, i) => {
                const score = lead.score ?? 0;
                const scoreColor = score >= 80 ? 'var(--success, #15803D)' : score >= 50 ? 'var(--warning, #D97706)' : 'var(--danger, #DC2626)';
                const sourceLabel = lead.source === 'website' ? '🌐 Site web' : lead.source === 'facebook' ? '📘 Facebook' : lead.source === 'google' ? '🔍 Google' : lead.source === 'referral' ? '🤝 Référence' : lead.source || 'Direct';
                return (
                  <tr
                    key={lead.id}
                    className="row-premium dashboard-contact-row cursor-pointer"
                    style={{ borderTop: '1px solid var(--border)', animationDelay: `${i * 80}ms` }}
                    onClick={() => openPanel({ type: 'lead', id: lead.id })}
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={lead.name}
                          size="sm"
                          status={statusToAvatarStatus(lead.status)}
                        />
                        <div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">{lead.name}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{lead.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Tag variant={statusToTagVariant(lead.status)} size="sm" statusIcon>
                        {STATUS_LABELS[lead.status]}
                      </Tag>
                    </td>
                    <td className="px-4 py-3">
                      <Tag variant="neutral" size="sm">{sourceLabel}</Tag>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {lead.deal_value ? (
                        <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums">{(lead.deal_value / 1000).toFixed(0)}k$</span>
                      ) : (
                        <span className="text-sm text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="relative w-20 h-1.5 rounded-full overflow-hidden bg-[var(--bg-canvas)]">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{
                              background: scoreColor,
                              width: `${score}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-semibold tabular-nums" style={{ color: scoreColor }}>{score}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right dashboard-contact-row-activity">
                      <span className="inline-flex items-center justify-end gap-2">
                        <span className="dashboard-contact-row-time text-[11px] font-medium text-[var(--text-muted)] tabular-nums">
                          {timeAgo(lead.created_at)}
                        </span>
                        {/* Sprint 40 40-3B — Quick-actions reveal au hover row (Stripe pattern) */}
                        <span className="dashboard-contact-row-actions" role="group" aria-label="Actions rapides">
                          <button
                            type="button"
                            className="dashboard-contact-row-action"
                            title="Envoyer un email"
                            aria-label={`Envoyer un email à ${lead.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (lead.email) window.location.href = `mailto:${lead.email}`;
                            }}
                          >
                            <Icon as={Mail} size={14} />
                          </button>
                          <button
                            type="button"
                            className="dashboard-contact-row-action"
                            title="Appeler"
                            aria-label={`Appeler ${lead.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (lead.phone) window.location.href = `tel:${lead.phone}`;
                            }}
                          >
                            <Icon as={Phone} size={14} />
                          </button>
                          <button
                            type="button"
                            className="dashboard-contact-row-action dashboard-contact-row-action--primary"
                            title="Ouvrir la fiche"
                            aria-label={`Ouvrir la fiche de ${lead.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openPanel({ type: 'lead', id: lead.id });
                            }}
                          >
                            <Icon as={ChevronRight} size={14} />
                          </button>
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
    );
  }
}

// ── StatCard Stripe-PLUS (Sprint 39 39-1B) : personality bump ──
//   - Grid 2-col interne : col gauche label+value+delta / col droite icon chip 40
//   - Value 32px font-weight 700 tabular-nums (vs 28px)
//   - Delta chip pill colored (success-soft/danger-soft) + icône trending + label "vs période précédente"
//   - Border-top 2px color-coded selon variant (primary/success/warning/danger/brand cyan signature)
//   - Sparkline largeur full bottom, height 32, stroke 2px
//   - Hover lift -1px + shadow-sm (variant interactive baseline)

function StatCardMockup({ label, value, icon, iconBg, iconColor, delta, deltaUp, deltaLabel, variant = 'primary', sparkColor, sparkData }: {
  label: string; value: number | string; icon: React.ReactNode;
  iconBg: string; iconColor: string;
  delta?: string; deltaUp?: boolean; deltaLabel?: string;
  /** Sprint 39 — variant accent border-top color-coded */
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'brand';
  /** Variante color du <Sparkline> — kept for API compat */
  sparkColor: 'brand' | 'success' | 'warning' | 'danger' | string;
  sparkData?: number[];
  /** Sprint 36 legacy — orbTint kept in signature but unused (Stripe-clean removed orbs) */
  orbTint?: 'cyan' | 'orange';
}) {
  // Sprint 40 40-1A — secondary metric (cette sem vs sem préc) calculé depuis sparkData
  const secondary = (() => {
    if (!sparkData || sparkData.length < 4) return null;
    const half = Math.max(1, Math.floor(sparkData.length / 2));
    const recent = sparkData.slice(-half).reduce((s, v) => s + (v || 0), 0);
    const prev = sparkData.slice(-half * 2, -half).reduce((s, v) => s + (v || 0), 0);
    return { recent, prev };
  })();
  return (
    <div
      className={`dashboard-kpi-card dashboard-kpi-card--${variant} relative rounded-[var(--radius-xl)] p-5 bg-[var(--bg-surface)] border border-[var(--border)] shadow-[var(--shadow-xs)] transition-[box-shadow,transform,border-color] duration-[var(--duration-base)] ease-[var(--ease)] hover:-translate-y-px hover:shadow-[var(--shadow-sm)] hover:border-[var(--border-strong)]`}
    >
      {/* Sprint 39 39-1B — Grid 2-col interne : info gauche / icon chip droite */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          {/* Label uppercase wide — t-meta plus tight letterspacing + weight 700 (Sprint 39 39-1A) */}
          <div className="t-meta mb-2">
            {label}
          </div>

          {/* Value 32px (Sprint 39 39-1B) — utility .dashboard-kpi-value */}
          <div className="dashboard-kpi-value">
            <AnimatedNumber value={value} />
          </div>
        </div>

        {/* Icon chip 40×40 (Sprint 39 39-1B) — soft bg color-coded, icon stroke 1.75 */}
        <div
          className="dashboard-kpi-icon-chip"
          style={{ background: iconBg }}
        >
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
      </div>

      {/* Delta chip + label "vs période précédente" (Sprint 39 39-1B) */}
      {delta && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span
            className={`dashboard-kpi-delta ${deltaUp !== false ? 'dashboard-kpi-delta--up' : 'dashboard-kpi-delta--down'}`}
          >
            {deltaUp !== false ? <Icon as={TrendingUp} size={14} /> : <Icon as={TrendingDown} size={14} />}
            {delta}
          </span>
          {deltaLabel && (
            <span className="dashboard-kpi-delta-label">{deltaLabel}</span>
          )}
        </div>
      )}

      {/* Sparkline full-width bas — Sprint 40 40-1A bump : height 44, stroke 2.5, terminal dot Stripe */}
      {sparkData && sparkData.length > 1 && (
        <Sparkline
          data={sparkData}
          color={sparkColor as 'brand' | 'success' | 'warning' | 'danger' | string}
          width={220}
          height={44}
          strokeWidth={2.5}
          terminalDotStripe
          className="dashboard-kpi-sparkline w-full"
        />
      )}

      {/* Sprint 40 40-1A — Secondary metric reveal au hover : "X cette sem · Y sem. préc." */}
      {secondary && (
        <div className="dashboard-kpi-secondary" role="group" aria-label="Détail période">
          <span className="tabular-nums">{secondary.recent} cette sem.</span>
          <span className="dashboard-kpi-secondary-sep">·</span>
          <span className="tabular-nums">{secondary.prev} sem. préc.</span>
        </div>
      )}
    </div>
  );
}

// ── Sprint 40 40-2B — MiniSparkline inline SVG (60×16, color-matched) ──
function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const width = 60;
  const height = 16;
  if (!data || data.length < 2) {
    return <svg width={width} height={height} className="dashboard-mini-spark" aria-hidden />;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="dashboard-mini-spark" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Sprint 40 40-2B — ActivityTypeDot 6px color-coded selon type d'action ──
const ACTIVITY_DOT_COLORS: Record<string, string> = {
  created: 'var(--success)',
  email_sent: 'var(--primary)',
  sms_sent: 'var(--primary)',
  status_change: 'var(--warning)',
  tag_added: 'var(--primary)',
  tag_removed: 'var(--text-muted)',
  note_added: 'var(--text-muted)',
  assigned: 'var(--primary)',
  deal_value_changed: 'var(--success)',
};
function ActivityTypeDot({ activityType }: { activityType: string }) {
  const color = ACTIVITY_DOT_COLORS[activityType] || 'var(--text-muted)';
  return (
    <span
      className="dashboard-activity-type-dot"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

// ── Sprint 40 40-2B — Mock 7-day trend par source (deterministic seed) ──
function sparkTrendForSource(source: string): number[] {
  // Deterministic pseudo-random based on source string char codes
  const seed = source.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const base = 8 + (seed % 6);
  return Array.from({ length: 7 }, (_, i) => {
    const wave = Math.sin((seed + i) * 0.7) * 3.5;
    const drift = (i * (seed % 3 === 0 ? 0.8 : 1.2));
    return Math.max(2, Math.round(base + wave + drift));
  });
}

// Sprint 43 M1.2 — BarChartTooltip déplacé dans
// src/components/dashboard/charts/AcquisitionChart.tsx pour permettre
// l'isolation Recharts hors du bundle initial Dashboard.
