// ── Dashboard — Page principale (Giga Sprint Design) ────────────────────
// Fichier orchestrateur pur : data fetching + état + assemblage des widgets.
// Tous les sous-composants visuels sont dans components/dashboard/.
// 916L → ~240L 🎉

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { getDashboardStats, getLeads, getClients } from '@/lib/api';
import { t } from '@/lib/i18n';
import { usePanelStack } from '@/components/ui';
import {
  STATUS_LABELS, STATUS_COLORS,
  type DashboardStats, type Lead, type Client,
} from '@/lib/types';
import { Eye, EyeOff, ChevronUp, ChevronDown, Settings2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ProactiveAlertsWidget } from '@/components/ProactiveAlertsWidget';
import { DashboardLayoutManager } from '@/components/dashboard/DashboardLayoutManager';

// ── Composants extraits (Giga Sprint Design Phase 2) ──
import { DashboardHero } from '@/components/dashboard/DashboardHero';
import { DashboardStatsGrid } from '@/components/dashboard/DashboardStatsGrid';
import { DashboardWeeklyInsight } from '@/components/dashboard/DashboardWeeklyInsight';
import { DashboardClients } from '@/components/dashboard/DashboardClients';
import { DashboardChart } from '@/components/dashboard/DashboardChart';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { DashboardPipeline } from '@/components/dashboard/DashboardPipeline';
import { DashboardContacts } from '@/components/dashboard/DashboardContacts';

// ── Types widgets configurables ──────────────────────────────
type WidgetId = 'stats' | 'clients' | 'chart' | 'activity' | 'contacts' | 'pipeline_donut' | 'top_sources' | 'weekly_insight';

interface WidgetConfig {
  id: WidgetId;
  label: string;
  icon: string;
  visible: boolean;
  order: number;
}

// Sprint LOT 1-3 — Labels lus via t() au render (clés i18n, parité 4 catalogues)
const WIDGET_LABEL_KEYS: Record<WidgetId, string> = {
  stats: 'dashboard.page.widget_stats',
  clients: 'dashboard.page.widget_clients',
  chart: 'dashboard.page.widget_chart',
  activity: 'dashboard.page.widget_activity',
  pipeline_donut: 'dashboard.page.widget_pipeline_donut',
  top_sources: 'dashboard.page.widget_top_sources',
  contacts: 'dashboard.page.widget_contacts',
  weekly_insight: 'dashboard.page.widget_weekly_insight',
};

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'stats', label: 'KPIs principaux', icon: '📊', visible: true, order: 0 },
  { id: 'weekly_insight', label: 'Analyse Hebdomadaire IA', icon: '✨', visible: true, order: 1 },
  { id: 'clients', label: 'Sous-comptes clients', icon: '🏢', visible: true, order: 2 },
  { id: 'chart', label: 'Graphique acquisition', icon: '📈', visible: true, order: 3 },
  { id: 'activity', label: 'Activité récente', icon: '⚡', visible: true, order: 4 },
  { id: 'pipeline_donut', label: 'Répartition pipeline', icon: '🎯', visible: true, order: 5 },
  { id: 'top_sources', label: 'Top sources', icon: '🔗', visible: true, order: 6 },
  { id: 'contacts', label: 'Derniers contacts', icon: '👥', visible: true, order: 7 },
];

function loadWidgetConfig(): WidgetConfig[] {
  try {
    const stored = localStorage.getItem('intralys_dashboard_widgets');
    if (stored) {
      const parsed = JSON.parse(stored) as WidgetConfig[];
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

function saveWidgetConfig(config: WidgetConfig[]) {
  localStorage.setItem('intralys_dashboard_widgets', JSON.stringify(config));
}

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
  useAuth();

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

  const applyLayout = useCallback((incoming: unknown) => {
    if (!Array.isArray(incoming)) return;
    const known = new Set<WidgetId>(DEFAULT_WIDGETS.map(w => w.id));
    const sanitized: WidgetConfig[] = [];
    const seen = new Set<WidgetId>();
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Partial<WidgetConfig>;
      if (typeof r.id !== 'string' || !known.has(r.id as WidgetId) || seen.has(r.id as WidgetId)) continue;
      const def = DEFAULT_WIDGETS.find(d => d.id === r.id)!;
      seen.add(r.id as WidgetId);
      sanitized.push({
        id: r.id as WidgetId,
        label: def.label,
        icon: def.icon,
        visible: typeof r.visible === 'boolean' ? r.visible : true,
        order: typeof r.order === 'number' ? r.order : sanitized.length,
      });
    }
    for (const def of DEFAULT_WIDGETS) {
      if (!seen.has(def.id)) sanitized.push({ ...def, order: sanitized.length });
    }
    const next = sanitized.sort((a, b) => a.order - b.order).map((w, i) => ({ ...w, order: i }));
    updateWidgets(() => next);
  }, [updateWidgets]);

  // ── Data fetching ──────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const [statsR, leadsR, clientsR] = await Promise.all([
        getDashboardStats(), getLeads({}), getClients()
      ]);
      if (statsR.error) setError(statsR.error);
      else if (statsR.data) setStats(statsR.data);
      if (leadsR.data) { setAllLeads(leadsR.data); setRecentLeads(leadsR.data.slice(0, 5)); }
      if (clientsR.data) setClients(clientsR.data);
      setIsLoading(false);
    }
    void load();
  }, []);

  // ── Données dérivées ──────────────────────────────────────
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;

  const pipelineData = Object.entries(
    allLeads.reduce((acc, l) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {} as Record<string, number>)
  ).map(([status, count]) => ({
    name: (STATUS_LABELS as Record<string, string>)[status] || status,
    value: count,
    color: (STATUS_COLORS as Record<string, string>)[status] || 'var(--text-muted)',
  }));

  const sourceData = stats?.leads_by_source || [];
  const sourceTotal = sourceData.reduce((s, d) => s + d.count, 0);

  // ── Error state ──────────────────────────────────────────
  if (error) {
    return (
      <AppLayout title={t('dashboard.page.title')}>
        <div className="flex items-center justify-center h-64" role="alert" aria-live="assertive">
          <div className="text-center">
            <p className="text-[var(--danger)] mb-2">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm text-[var(--primary)] hover:underline cursor-pointer"
            >
              {t('dashboard.error.retry')}
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ── Rendu conditionnel des widgets ──────────────────────────
  function renderWidget(w: WidgetConfig) {
    switch (w.id) {
      case 'stats':
        return <DashboardStatsGrid key={w.id} stats={stats} isLoading={isLoading} />;
      case 'weekly_insight':
        return <DashboardWeeklyInsight key={w.id} />;
      case 'clients':
        return (
          <DashboardClients
            key={w.id}
            clients={clients}
            stats={stats}
            onClientClick={(id) => void navigate({ to: `/clients/${id}/leads` })}
            onAddClient={() => void navigate({ to: '/clients' })}
          />
        );
      case 'chart':
        return (
          <div key={w.id} className="page-grid-2-1 mb-6">
            <DashboardChart
              isLoading={isLoading}
              leadsData={stats?.leads_by_day || []}
              periodDays={periodDays}
            />
            {isVisible('activity') && (
              <DashboardActivity
                isLoading={isLoading}
                activities={stats?.activity_feed || []}
                onViewAll={() => void navigate({ to: '/leads' })}
              />
            )}
          </div>
        );
      case 'activity':
        return null; // Rendu couplé avec chart (dans le grid 2/3 + 1/3)
      case 'pipeline_donut':
        return (
          <DashboardPipeline
            key={w.id}
            isLoading={isLoading}
            pipelineData={pipelineData}
            sourceData={sourceData}
            sourceTotal={sourceTotal}
            showSources={isVisible('top_sources')}
          />
        );
      case 'top_sources':
        return null; // Rendu couplé avec pipeline_donut
      case 'contacts':
        return (
          <DashboardContacts
            key={w.id}
            isLoading={isLoading}
            recentLeads={recentLeads}
            onViewAll={() => void navigate({ to: '/leads' })}
            onLeadClick={(id) => openPanel({ type: 'lead', id })}
          />
        );
      default:
        return null;
    }
  }

  return (
    <AppLayout title={t('dashboard.page.title')}>
      <>
        {/* ── Hero greeting ── */}
        <DashboardHero
          period={period}
          onPeriodChange={setPeriod}
          showConfig={showConfig}
          onToggleConfig={() => setShowConfig(!showConfig)}
        />

        {/* ── Alertes proactives IA ── */}
        <ProactiveAlertsWidget />

        {/* ── Gestionnaire de layouts ── */}
        {showConfig && (
          <DashboardLayoutManager currentWidgets={widgets} onApplyLayout={applyLayout} />
        )}

        {/* ── Panneau de configuration des widgets ── */}
        {showConfig && (
          <div className="surface-card p-4 mb-4 animate-fade-in-scale" style={{ borderStyle: 'dashed', borderColor: 'var(--primary)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-card-title flex items-center gap-2">
                <Settings2 size={14} className="text-[var(--primary)]" />
                {t('dashboard.config.title')}
              </h3>
              <button
                onClick={() => updateWidgets(() => DEFAULT_WIDGETS)}
                className="text-meta-label hover:text-[var(--primary)] cursor-pointer"
              >
                {t('dashboard.config.reset')}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {widgets.map((w, idx) => (
                <div
                  key={w.id}
                  className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                    w.visible
                      ? 'border-[var(--primary)]/30 bg-[var(--primary-soft)]'
                      : 'border-[var(--border)] opacity-50'
                  }`}
                >
                  <button
                    onClick={() => toggleWidget(w.id)}
                    className="cursor-pointer shrink-0"
                    title={w.visible ? t('dashboard.page.config_hide') : t('dashboard.page.config_show')}
                    aria-label={w.visible ? t('dashboard.page.config_hide') : t('dashboard.page.config_show')}
                    aria-pressed={w.visible}
                  >
                    {w.visible
                      ? <Eye size={14} className="text-[var(--primary)]" />
                      : <EyeOff size={14} className="text-[var(--text-muted)]" />
                    }
                  </button>
                  <span className="text-xs flex-1 truncate">{w.icon} {t(WIDGET_LABEL_KEYS[w.id])}</span>
                  <div className="flex flex-col">
                    <button
                      onClick={() => moveWidget(w.id, -1)}
                      disabled={idx === 0}
                      aria-label={t('dashboard.page.widget_move_up')}
                      className="text-[var(--text-muted)] hover:text-[var(--primary)] cursor-pointer disabled:opacity-20"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      onClick={() => moveWidget(w.id, 1)}
                      disabled={idx === widgets.length - 1}
                      aria-label={t('dashboard.page.widget_move_down')}
                      className="text-[var(--text-muted)] hover:text-[var(--primary)] cursor-pointer disabled:opacity-20"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Widgets (ordre configurable) ── */}
        {widgets.filter(w => w.visible).map(renderWidget)}
      </>
    </AppLayout>
  );
}
