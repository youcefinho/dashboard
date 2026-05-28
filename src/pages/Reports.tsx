// ── ReportsPage — Refonte Sprint 8 (Phase B) ──────────

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Tag, Skeleton, Button, useToast, useConfirm, PageHero, KpiStrip, type KpiItem, CellHoverInfo, Icon, EmptyState, EmptyStateIllustration } from '@/components/ui';
import { getLeads, getClients } from '@/lib/api';
import type { Lead, Client } from '@/lib/types';
import { STATUS_LABELS, STATUS_COLORS, SOURCE_LABELS } from '@/lib/types';
import { 
  BarChart3, Target, Trophy, TrendingUp, Users, DollarSign, Percent, Activity,
  Download, Mail, Calendar as CalendarIcon, Save, MessageSquare, Star, 
  Workflow, CheckSquare, Presentation
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from 'recharts';

import {
  SalesReports, FunnelReports, SourcesReports, PerformanceReports,
  TrendsReports, ActivityReports, WorkflowReports, EmailReports,
  SmsReports, CalendarReports, FormsReports, ReviewsReports
} from '@/components/reports/ReportComponents';
// Sprint 34 vague 34-1A — PDF export helper consolidé
import { triggerPdfExport } from '@/lib/pdfExport';
// Sprint 45 M3.2 — Coachmark contextuel (1ère visite Reports → filter period hint)
import { ContextualCoachmark } from '@/components/onboarding/ContextualCoachmark';
// Sprint 46 M1 — Dashboards builder (drag-drop widgets) + API
import { DashboardBuilder, createEmptyDashboard, type DashboardBuilderValue } from '@/components/reports/DashboardBuilder';
// Sprint 48 M3 — Intl currency + date
import { formatMoneyCAD } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { getLocale, t } from '@/lib/i18n';
import {
  getDashboards, createDashboard, updateDashboard, deleteDashboard,
  shareDashboard, type DashboardRecord,
} from '@/lib/api';
import { LayoutGrid as LayoutIcon, Share2, Copy as CopyIcon, Trash2 } from 'lucide-react';
// LOT SCHEDREPORT Sprint A — Phase B Manager-C : onglet « Planifiés »
import { ScheduledReportsPanel } from '@/components/reports/ScheduledReportsPanel';
// LOT REPORT-TEMPLATES (Sprint 15) — Phase B Manager-C : onglet « Modèles »
import { ReportTemplatesGallery } from '@/components/reports/ReportTemplatesGallery';
// LOT ATTRIBUTION-D Sprint D — Phase B Manager-C : attribution multi-touch + cohortes
import { AttributionPanel } from '@/components/reports/AttributionPanel';
import { CohortHeatmap } from '@/components/reports/CohortHeatmap';
// Surface invisible reports — agrégats serveur (overview/conversion/sources/baselines)
import { ServerAnalyticsPanel } from '@/components/reports/ServerAnalyticsPanel';

type ReportTab = 'sales' | 'funnel' | 'sources' | 'performance' | 'trends' | 'activity' | 'workflow' | 'email' | 'sms' | 'calendar' | 'forms' | 'reviews' | 'builder' | 'scheduled' | 'templates' | 'attribution' | 'cohorts' | 'server';

// Sprint LOT 1-3 — TABS via factory pour relire t() au runtime (i18n parité 4 catalogues)
function buildTabs(): { id: ReportTab; icon: typeof BarChart3; label: string; group: string }[] {
  const G_BUILDER = t('reports.group.builder');
  const G_BUSINESS = t('reports.group.business');
  const G_AGENCE = t('reports.group.agence');
  const G_EQUIPE = t('reports.group.equipe');
  const G_MARKETING = t('reports.group.marketing');
  return [
    // Sprint 46 M1 — Dashboards builder en tête (CTA principal nouveau)
    { id: 'builder', icon: LayoutIcon, label: t('reports.tab.builder'), group: G_BUILDER },
    // LOT SCHEDREPORT Sprint A — rapports envoyés automatiquement par courriel
    { id: 'scheduled', icon: Mail, label: t('reports.scheduled.tab'), group: G_BUILDER },
    // LOT REPORT-TEMPLATES (Sprint 15) — galerie de modèles de dashboard clonables
    { id: 'templates', icon: LayoutIcon, label: t('reports.templates.title'), group: G_BUILDER },
    { id: 'sales', icon: DollarSign, label: t('reports.tab.sales'), group: G_BUSINESS },
    { id: 'funnel', icon: BarChart3, label: t('reports.tab.funnel'), group: G_BUSINESS },
    { id: 'sources', icon: Target, label: t('reports.tab.sources'), group: G_BUSINESS },
    { id: 'trends', icon: TrendingUp, label: t('reports.tab.trends'), group: G_BUSINESS },
    // Surface invisible reports — agrégats serveur (overview/conversion/sources/baselines)
    { id: 'server', icon: Activity, label: t('reportsx.tab.server'), group: G_BUSINESS },
    // LOT ATTRIBUTION-D — cohortes de leads (rétention par mois d'acquisition)
    { id: 'cohorts', icon: Users, label: t('cohort.tab'), group: G_BUSINESS },
    { id: 'performance', icon: Trophy, label: t('reports.tab.performance'), group: G_AGENCE },
    { id: 'activity', icon: Activity, label: t('reports.tab.activity'), group: G_EQUIPE },
    { id: 'calendar', icon: CalendarIcon, label: t('reports.tab.calendar'), group: G_EQUIPE },
    { id: 'workflow', icon: Workflow, label: t('reports.tab.workflow'), group: G_MARKETING },
    { id: 'email', icon: Mail, label: t('reports.tab.email'), group: G_MARKETING },
    { id: 'sms', icon: MessageSquare, label: t('reports.tab.sms'), group: G_MARKETING },
    { id: 'forms', icon: CheckSquare, label: t('reports.tab.forms'), group: G_MARKETING },
    { id: 'reviews', icon: Star, label: t('reports.tab.reviews'), group: G_MARKETING },
    // LOT ATTRIBUTION-D — attribution multi-touch (first/last/linéaire/time-decay)
    { id: 'attribution', icon: Percent, label: t('attribution.tab'), group: G_MARKETING },
  ];
}
const TABS = buildTabs();

const VALID_TABS = new Set<ReportTab>(['sales', 'funnel', 'sources', 'performance', 'trends', 'activity', 'workflow', 'email', 'sms', 'calendar', 'forms', 'reviews', 'builder', 'scheduled', 'templates', 'attribution', 'cohorts', 'server']);
const VALID_PERIODS = new Set<'30d' | '90d' | '12m'>(['30d', '90d', '12m']);

// ── Sprint 30 vague 30-1C — Read URL params (?view=funnel&period=90d) ──
function readUrlState(): { view: ReportTab | null; period: '30d' | '90d' | '12m' | null; filters: string | null } {
  if (typeof window === 'undefined') return { view: null, period: null, filters: null };
  const params = new URLSearchParams(window.location.search);
  const rawView = params.get('view');
  const rawPeriod = params.get('period');
  const filters = params.get('filters');
  return {
    view: rawView && VALID_TABS.has(rawView as ReportTab) ? (rawView as ReportTab) : null,
    period: rawPeriod && VALID_PERIODS.has(rawPeriod as '30d' | '90d' | '12m') ? (rawPeriod as '30d' | '90d' | '12m') : null,
    filters,
  };
}

export function ReportsPage() {
  const { success, error: toastError } = useToast();
  // LOT D Phase B Manager-C — modal confirm avant partage public d'un dashboard
  const confirm = useConfirm();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Sprint LOT 1-3 — Error state inline + retry (gap audit Reports)
  const [loadError, setLoadError] = useState<string | null>(null);

  // Sprint 30 vague 30-1C — hydrate depuis URL params au mount
  const initialUrlState = useMemo(() => readUrlState(), []);
  const [activeTab, setActiveTab] = useState<ReportTab>(initialUrlState.view ?? 'funnel');

  // Customization & Filters
  const [period, setPeriod] = useState<'30d' | '90d' | '12m'>(initialUrlState.period ?? '30d');
  const [isExporting, setIsExporting] = useState(false);
  const [comparePeriod, setComparePeriod] = useState(false);

  // Sprint 46 M1 — Dashboards builder state
  const [dashboards, setDashboards] = useState<DashboardRecord[]>([]);
  const [activeDashboardId, setActiveDashboardId] = useState<number | null>(null);
  const [builderValue, setBuilderValue] = useState<DashboardBuilderValue>(createEmptyDashboard());
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [builderDirty, setBuilderDirty] = useState(false);

  // Sprint 30 vague 30-1C — Persist view/period dans URL pour deep-link partageable
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('view', activeTab);
    params.set('period', period);
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, '', newUrl);
  }, [activeTab, period]);

  // Sprint 30 vague 30-1C — Listen pour popstate (Back/Forward navigateur)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const next = readUrlState();
      if (next.view) setActiveTab(next.view);
      if (next.period) setPeriod(next.period);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Sprint 30 vague 30-1C — Sync depuis TanStack Router (CmdPalette re-nav vers
  // /reports?view=funnel met à jour location.search sans popstate). On observe
  // routerLocation.search et on resync activeTab/period.
  const routerLocation = useRouterState({ select: (s) => s.location });
  useEffect(() => {
    const next = readUrlState();
    if (next.view && next.view !== activeTab) setActiveTab(next.view);
    if (next.period && next.period !== period) setPeriod(next.period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerLocation.search]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [leadsRes, clientsRes] = await Promise.all([getLeads(), getClients()]);
      if (leadsRes.data) setLeads(leadsRes.data);
      if (clientsRes.data) setClients(clientsRes.data);
      // Si les deux endpoints renvoient une erreur, on remonte celle des leads (source principale).
      if (!leadsRes.data && !clientsRes.data) {
        setLoadError(leadsRes.error || clientsRes.error || t('reports.error.load_failed'));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('reports.error.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Actions Customization ───────────────────────────────
  // Sprint 34 vague 34-1A — Helper consolidé (body class pdf-mode-report + cover page)
  // Sprint 46 M1.4 — Mode `dashboard` quand on est dans le builder
  const handleExportPDF = () => {
    setIsExporting(true);
    if (activeTab === 'builder' && activeDashboardId !== null) {
      triggerPdfExport('dashboard', { dashboardId: activeDashboardId });
    } else {
      triggerPdfExport('report');
    }
    window.setTimeout(() => setIsExporting(false), 1600);
  };

  // Sprint 46 M1.3 — Dashboards CRUD
  const loadDashboards = useCallback(async () => {
    setDashboardsLoading(true);
    const res = await getDashboards();
    if (res.data) setDashboards(res.data);
    setDashboardsLoading(false);
  }, []);

  // Charge la liste dès qu'on entre dans le builder
  useEffect(() => {
    if (activeTab === 'builder') void loadDashboards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleCreateDashboard = async () => {
    const res = await createDashboard({
      name: `Dashboard ${formatDate(new Date(), getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}`,
      config: createEmptyDashboard(),
    });
    if (res.data) {
      success(t('reports.toast.created'));
      await loadDashboards();
      setActiveDashboardId(res.data.id);
      setBuilderValue((res.data.config as DashboardBuilderValue) || createEmptyDashboard());
      setBuilderDirty(false);
    } else {
      toastError(t('reports.toast.create_error'));
    }
  };

  const handleOpenDashboard = (d: DashboardRecord) => {
    setActiveDashboardId(d.id);
    setBuilderValue((d.config as DashboardBuilderValue) || createEmptyDashboard());
    setBuilderDirty(false);
  };

  const handleSaveDashboard = async () => {
    if (activeDashboardId === null) return;
    const res = await updateDashboard(activeDashboardId, { config: builderValue });
    if (res.data?.success) {
      success(t('reports.toast.saved'));
      setBuilderDirty(false);
      void loadDashboards();
    } else {
      toastError(t('reports.toast.save_error'));
    }
  };

  const handleDeleteDashboard = async (id: number) => {
    const res = await deleteDashboard(id);
    if (res.data?.success) {
      success(t('reports.toast.deleted'));
      if (activeDashboardId === id) {
        setActiveDashboardId(null);
        setBuilderValue(createEmptyDashboard());
      }
      void loadDashboards();
    } else {
      toastError(t('reports.toast.delete_error'));
    }
  };

  const handleShareDashboard = async (id: number) => {
    // LOT D Phase B Manager-C — modal confirm i18n avant exposition publique.
    // Avertit explicitement le user que le lien public expose les données du
    // périmètre actuel (sous-compte ou agence) — voir reports.share.scope_warning.
    const confirmed = await confirm({
      title: t('reports.share.confirm_public'),
      description: t('reports.share.scope_warning'),
      confirmLabel: t('reports.builder.share'),
      // Pas `danger` : c'est une action volontaire d'exposition, pas une destruction.
    });
    if (!confirmed) return;
    const res = await shareDashboard(id);
    if (res.data?.share_token) {
      const url = `${window.location.origin}/dashboards/shared/${res.data.share_token}`;
      try {
        await navigator.clipboard.writeText(url);
        success(t('reports.toast.link_copied'));
      } catch {
        success(`Lien : ${url}`);
      }
      void loadDashboards();
    } else {
      // Si le backend renvoie une erreur capability (mode-agence + viewer),
      // string-match sur res.error (ApiResponse jamais `code` — gelé LOT B).
      const errStr = (res.error || '').toLowerCase();
      if (errStr.includes('forbidden') || errStr.includes('capability') || errStr.includes('manage')) {
        toastError(t('reports.cap.required_manage'));
      } else if (errStr.includes('scope') || errStr.includes('tenant')) {
        toastError(t('reports.toast.scope_locked'));
      } else {
        toastError(t('reports.toast.link_error'));
      }
    }
  };

  const handleBuilderChange = (next: DashboardBuilderValue) => {
    setBuilderValue(next);
    setBuilderDirty(true);
  };

  const handleSaveReport = async () => {
    try {
      const res = await fetch('/api/reports/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Rapport ${activeTab}`, type: activeTab, config_json: { period, comparePeriod } })
      });
      if (res.ok) success(t('reports.toast.saved_report'));
      else toastError(t('reports.toast.save_report_error'));
    } catch (e) {
      console.error(e);
      toastError(t('reports.toast.connection_error'));
    }
  };

  // ── Calculs ──────────────────────────────────────────────
  const totalLeads = leads.length;
  const statusCounts: Record<string, number> = {};
  leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });

  const sourceCounts: Record<string, number> = {};
  leads.forEach(l => { sourceCounts[l.source || 'direct'] = (sourceCounts[l.source || 'direct'] || 0) + 1; });

  // Sprint 51 M3.3 — répartition par campagne (utm_campaign)
  const campaignCounts: Record<string, number> = {};
  leads.forEach(l => {
    const c = (l.utm_campaign || '').trim();
    if (c) campaignCounts[c] = (campaignCounts[c] || 0) + 1;
  });

  const typeCounts = { inbound: 0, customer: 0 };
  leads.forEach(l => { if (l.type === 'inbound') typeCounts.inbound++; if (l.type === 'customer') typeCounts.customer++; });

  const clientCounts: Record<string, { total: number; won: number; name: string; value: number }> = {};
  leads.forEach(l => {
    if (!clientCounts[l.client_id]) {
      const client = clients.find(c => c.id === l.client_id);
      clientCounts[l.client_id] = { total: 0, won: 0, name: client?.name || l.client_id, value: 0 };
    }
    const e = clientCounts[l.client_id];
    if (e) { e.total++; if (l.status === 'won') e.won++; e.value += l.deal_value || 0; }
  });

  const funnelStages = ['new', 'contacted', 'qualified', 'won'];
  const funnelData = funnelStages.map(s => ({
    name: STATUS_LABELS[s as keyof typeof STATUS_LABELS] || s,
    count: statusCounts[s] || 0,
    fill: STATUS_COLORS[s as keyof typeof STATUS_COLORS] || '#888',
  }));

  const conversionRate = totalLeads > 0 ? Math.round(((statusCounts['won'] || 0) / totalLeads) * 100) : 0;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const leadsThisMonth = leads.filter(l => l.created_at.slice(0, 7) === thisMonth).length;
  const totalPipelineValue = leads.reduce((s, l) => s + (l.deal_value || 0), 0);

  // Source data pour PieChart
  const sourceData = Object.entries(sourceCounts).map(([source, count]) => ({
    name: source, value: count,
  }));
  const SOURCE_PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  // Tendances — leads par semaine
  const trendData: { week: string; leads: number; won: number }[] = [];
  const periodDays = period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const now = Date.now();
  for (let i = periodDays; i >= 0; i -= 7) {
    const weekStart = new Date(now - i * 86400000);
    const weekEnd = new Date(now - (i - 7) * 86400000);
    const weekLabel = formatDate(weekStart, getLocale(), { month: 'short', day: 'numeric' });
    const weekLeads = leads.filter(l => {
      const t = new Date(l.created_at).getTime();
      return t >= weekStart.getTime() && t < weekEnd.getTime();
    });
    trendData.push({
      week: weekLabel,
      leads: weekLeads.length,
      won: weekLeads.filter(l => l.status === 'won').length,
    });
  }

  if (isLoading) {
    return (
      <AppLayout title={t('reports.page.title')}>
        {/* Sprint LOT 1-3 — aria-busy + aria-live pour SR pendant chargement */}
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          {/* Hero placeholder */}
          <Skeleton className="h-28 w-full rounded-2xl" />
          {/* KPI strip 4 cards */}
          <div className="flex gap-3">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 flex-1 rounded-2xl" />)}
          </div>
          {/* Tabs row */}
          <div className="flex gap-2">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-24 rounded-lg" />)}
          </div>
          {/* 2 charts placeholders */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[280px] w-full rounded-2xl" />
            <Skeleton className="h-[280px] w-full rounded-2xl" />
          </div>
        </div>
      </AppLayout>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'builder': {
        // Sprint 46 M1 — Vue Dashboards builder
        if (activeDashboardId === null) {
          // Liste de dashboards + CTA Nouveau
          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                {t('reports.builder.title')}
                </h3>
                <Button variant="primary" onClick={handleCreateDashboard} className="text-xs gap-1.5">
                  <Icon as={LayoutIcon} size={14} /> {t('reports.builder.new')}
                </Button>
              </div>
              {dashboardsLoading ? (
                <Skeleton className="h-32 w-full rounded-2xl" />
              ) : dashboards.length === 0 ? (
                <Card className="p-0">
                  <EmptyState
                    variant="first-time"
                    illustration={<EmptyStateIllustration kind="reports" size={160} />}
                    title={t('reports.builder.empty_title')}
                    description={t('reports.builder.empty_desc')}
                  />
                </Card>
              ) : (
                <div className="db-list-grid">
                  {dashboards.map(d => (
                    <Card key={d.id} className="db-list-card">
                      <div className="db-list-card__head">
                        <h4 className="db-list-card__title" title={d.name}>{d.name}</h4>
                        <Tag size="sm" variant="brand">
                          {(d.config as any)?.widgets?.length || 0} widgets
                        </Tag>
                      </div>
                      <div className="db-list-card__meta">
                        Maj : {formatDate(new Date((d.updated_at || 0) * 1000), getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                      <div className="db-list-card__actions">
                        <Button variant="secondary" onClick={() => handleOpenDashboard(d)} className="text-xs">
                          {t('reports.builder.open')}
                        </Button>
                        {/* Sprint LOT 1-3 — aria-label + title via i18n (3 actions builder) */}
                        <button
                          type="button"
                          className="db-list-card__icon-btn"
                          onClick={() => handleShareDashboard(d.id)}
                          aria-label={`${t('reports.action.share')} : ${d.name}`}
                          title={t('reports.action.share')}
                        >
                          <Icon as={Share2} size={14} aria-hidden="true" />
                        </button>
                        {d.share_token && (
                          <button
                            type="button"
                            className="db-list-card__icon-btn"
                            onClick={async () => {
                              const url = `${window.location.origin}/dashboards/shared/${d.share_token}`;
                              try { await navigator.clipboard.writeText(url); success(t('reports.toast.link_copied')); }
                              catch { success(`Lien : ${url}`); }
                            }}
                            aria-label={t('reports.action.copy_public')}
                            title={t('reports.action.copy_public')}
                          >
                            <Icon as={CopyIcon} size={14} aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="db-list-card__icon-btn db-list-card__icon-btn--danger"
                          onClick={() => handleDeleteDashboard(d.id)}
                          aria-label={`${t('reports.action.delete')} : ${d.name}`}
                          title={t('reports.action.delete')}
                        >
                          <Icon as={Trash2} size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          );
        }

        // Builder ouvert sur un dashboard
        const current = dashboards.find(d => d.id === activeDashboardId);
        return (
          <div className="space-y-3">
            <div className="db-builder-bar">
              <button
                type="button"
                onClick={() => { setActiveDashboardId(null); setBuilderDirty(false); }}
                className="db-builder-bar__back"
              >
                {t('reports.builder.back')}
              </button>
              <div className="db-builder-bar__title">
                {current?.name || 'Dashboard'}
                {builderDirty && <Tag size="sm" variant="warning">{t('reports.builder.unsaved')}</Tag>}
              </div>
              <div className="db-builder-bar__actions">
                <Button variant="secondary" onClick={() => handleShareDashboard(activeDashboardId!)} className="text-xs gap-1.5">
                  <Icon as={Share2} size={14} /> {t('reports.builder.share')}
                </Button>
                <Button variant="primary" onClick={handleSaveDashboard} disabled={!builderDirty} className="text-xs gap-1.5">
                  <Icon as={Save} size={14} /> {t('reports.builder.save')}
                </Button>
              </div>
            </div>
            <DashboardBuilder
              value={builderValue}
              onChange={handleBuilderChange}
              scope={(() => {
                // LOT D Phase B Manager-C — scope best-effort (dégradation gracieuse).
                // Le backend Manager-B peut exposer scope via getDashboard (via
                // `dashboard_scopes` compagnon seq 88). Tant que ce n'est pas
                // câblé, on regarde dans config.scope (additif) ; sinon undefined
                // → pas de badge (rétro-compat Sprint 46 préservée).
                const s = (current?.config as any)?.scope;
                if (s === 'client' || s === 'agency' || s === 'legacy') return s;
                return undefined;
              })()}
            />
          </div>
        );
      }
      case 'sales': {
        const revenueBySource: Record<string, number> = {};
        leads.forEach(l => {
          if (l.status === 'won') {
            const s = l.source || 'direct';
            revenueBySource[s] = (revenueBySource[s] || 0) + (l.deal_value || 0);
          }
        });
        const revenueData = Object.entries(revenueBySource).map(([source, revenue]) => ({
          name: SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] || source,
          revenue
        })).sort((a, b) => b.revenue - a.revenue);

        // CAC estimation (Mock spend)
        const mockSpend = { google: 500, facebook: 300, website: 50, referral: 0, direct: 0 };
        const cacData = Object.entries(sourceCounts).map(([source]) => {
          const spend = mockSpend[source as keyof typeof mockSpend] || 0;
          const wonLeads = leads.filter(l => (l.source || 'direct') === source && l.status === 'won').length;
          const cac = wonLeads > 0 ? Math.round(spend / wonLeads) : spend;
          return {
            name: SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] || source,
            sourceKey: source,
            cac,
            spend,
            wonLeads,
          };
        });

        return (
          <SalesReports>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Icon as={DollarSign} size="md" className="text-[var(--success)]" /> Revenus par Source (ROI)</h3>
                {revenueData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={revenueData} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={(val) => `${val/1000}k $`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={80} />
                    <Tooltip contentStyle={{
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.97) 0%, rgba(240,250,254,0.97) 100%)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(0,157,219,0.25)',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 500,
                      boxShadow: '0 8px 32px -8px rgba(0,157,219,0.25), 0 0 0 1px rgba(0,157,219,0.08)',
                    }}
                    cursor={{ fill: 'rgba(0,157,219,0.08)' }}
                    formatter={(val) => `${val} $`} />
                    <Bar dataKey="revenue" fill="var(--success)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                ) : <p className="text-xs text-[var(--text-muted)] text-center py-10">{t('reports.no_revenue')}</p>}
              </Card>
              
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Icon as={Target} size={16} className="text-[var(--primary)]" /> {t('reports.cac_title')}</h3>
                <div className="table-premium-container print-data-table">
                  <table className="table-premium w-full text-left">
                    <thead>
                      <tr>
                        <th>{t('reports.col_source')}</th>
                        <th className="text-right">{t('reports.col_spend')}</th>
                        <th className="text-center">{t('reports.col_won')}</th>
                        <th className="text-right">{t('reports.col_cac')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cacData.map(d => {
                        const total = sourceCounts[d.sourceKey] || 0;
                        const conv = total > 0 ? Math.round((d.wonLeads / total) * 100) : 0;
                        return (
                          <tr key={d.name}>
                            <td className="font-medium">{d.name}</td>
                            <td className="text-right" style={{ color: 'var(--danger)' }}>
                              <CellHoverInfo
                                title={`Dépenses · ${d.name}`}
                                description={`Total leads source : ${total}`}
                                breakdown={[
                                  { label: 'Investi', value: `${d.spend} $`, tone: 'danger' },
                                  { label: 'Conversion', value: `${conv}%`, tone: 'brand' },
                                ]}
                                trend={{
                                  value: conv >= 15 ? 8.4 : -4.2,
                                  direction: conv >= 15 ? 'up' : 'down',
                                  label: 'vs 30 derniers jours',
                                }}
                                sparkline={[d.spend * 0.6, d.spend * 0.75, d.spend * 0.7, d.spend * 0.85, d.spend * 0.9, d.spend, d.spend * 1.05].map(Math.round)}
                              >
                                <span className="t-mono-num cursor-help">{d.spend} $</span>
                              </CellHoverInfo>
                            </td>
                            <td className="text-center">
                              <CellHoverInfo
                                title="Gagnés"
                                description={`${d.wonLeads} deals fermés sur ${total} leads`}
                                breakdown={[
                                  { label: 'Won', value: d.wonLeads, tone: 'success' },
                                  { label: 'Total', value: total, tone: 'neutral' },
                                  { label: 'Conv.', value: `${conv}%`, tone: 'brand' },
                                ]}
                              >
                                <span className="t-mono-num cursor-help">{d.wonLeads}</span>
                              </CellHoverInfo>
                            </td>
                            <td className="text-right font-semibold" style={{ color: 'var(--primary)' }}>
                              <CellHoverInfo
                                title={`CAC · ${d.name}`}
                                description={d.wonLeads > 0 ? `Coût moyen pour acquérir un client gagné` : 'Aucun client gagné'}
                                breakdown={[
                                  { label: 'CAC', value: `${d.cac} $`, tone: 'brand' },
                                  { label: 'Dépenses', value: `${d.spend} $`, tone: 'danger' },
                                  { label: 'Gagnés', value: d.wonLeads, tone: 'success' },
                                ]}
                                trend={{
                                  value: d.cac < 200 ? 12.5 : -6.8,
                                  direction: d.cac < 200 ? 'up' : 'down',
                                  label: d.cac < 200 ? 'efficacité en hausse' : 'à surveiller',
                                }}
                              >
                                <span className="t-mono-num cursor-help">{d.cac} $</span>
                              </CellHoverInfo>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </SalesReports>
        );
      }
      case 'funnel': return (
        <FunnelReports>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">📊 Funnel de conversion</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={funnelData} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={80} />
                  <Tooltip contentStyle={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.97) 0%, rgba(240,250,254,0.97) 100%)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(0,157,219,0.25)',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 500,
                    boxShadow: '0 8px 32px -8px rgba(0,157,219,0.25), 0 0 0 1px rgba(0,157,219,0.08)',
                  }}
                  cursor={{ fill: 'rgba(0,157,219,0.08)' }} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {funnelData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
                Perdus : {statusCounts['lost'] || 0} · Fermés : {statusCounts['closed'] || 0}
              </p>
            </Card>
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">{t('reports.split_by_type')}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={[{ name: 'Entrants', value: typeCounts.inbound }, { name: 'Clients', value: typeCounts.customer }]}
                    cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, percent }: any) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    <Cell fill="var(--primary)" />
                    <Cell fill="var(--warning)" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </FunnelReports>
      );
      case 'sources': return (
        <SourcesReports>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">🎯 Sources d'acquisition</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={sourceData} cx="50%" cy="50%" outerRadius={100} dataKey="value"
                    label={({ name, percent }: any) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    {sourceData.map((_, i) => <Cell key={i} fill={SOURCE_PIE_COLORS[i % SOURCE_PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">{t('reports.detail_by_source')}</h3>
              <div className="space-y-3">
                {Object.entries(sourceCounts).sort(([, a], [, b]) => b - a).map(([source, count], i) => {
                    const pct = Math.round((count / totalLeads) * 100);
                    return (
                      <div key={source} className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: SOURCE_PIE_COLORS[i % SOURCE_PIE_COLORS.length] }} />
                        <span className="text-xs font-medium w-20 capitalize">{source}</span>
                        <div className="flex-1 h-6 bg-[var(--bg-subtle)] rounded overflow-hidden">
                          <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: SOURCE_PIE_COLORS[i % SOURCE_PIE_COLORS.length], opacity: 0.7 }} />
                        </div>
                        <span className="text-xs font-bold w-16 text-right">{count} ({pct}%)</span>
                      </div>
                    );
                })}
              </div>
            </Card>
          </div>
          {/* Sprint 51 M3.3 — Provenance par campagne (utm_campaign) */}
          <Card className="p-5 mt-4">
            <h3 className="text-sm font-semibold mb-4">📣 Leads par campagne</h3>
            {Object.keys(campaignCounts).length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] italic">
                Aucune campagne UTM détectée. Les leads entrants via formulaires, Lead Ads ou
                sources connectées afficheront ici leur campagne d'origine.
              </p>
            ) : (
              <div className="space-y-3">
                {Object.entries(campaignCounts).sort(([, a], [, b]) => b - a).slice(0, 12).map(([campaign, count], i) => {
                  const pct = totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0;
                  return (
                    <div key={campaign} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: SOURCE_PIE_COLORS[i % SOURCE_PIE_COLORS.length] }} />
                      <span className="text-xs font-medium w-40 truncate" title={campaign}>{campaign}</span>
                      <div className="flex-1 h-6 bg-[var(--bg-subtle)] rounded overflow-hidden">
                        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: SOURCE_PIE_COLORS[i % SOURCE_PIE_COLORS.length], opacity: 0.7 }} />
                      </div>
                      <span className="text-xs font-bold w-16 text-right">{count} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </SourcesReports>
      );
      case 'performance': return (
        <PerformanceReports>
          <div className="space-y-4">
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">🏆 Performance par sous-compte</h3>
              <ResponsiveContainer width="100%" height={Math.max(200, Object.keys(clientCounts).length * 60)}>
                <BarChart data={Object.values(clientCounts).sort((a, b) => b.total - a.total)} layout="vertical" margin={{ left: 30 }}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={120} />
                  <Tooltip contentStyle={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.97) 0%, rgba(240,250,254,0.97) 100%)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(0,157,219,0.25)',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 500,
                    boxShadow: '0 8px 32px -8px rgba(0,157,219,0.25), 0 0 0 1px rgba(0,157,219,0.08)',
                  }}
                  cursor={{ fill: 'rgba(0,157,219,0.08)' }} />
                  <Bar dataKey="total" name="Total leads" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="won" name="Gagnés" fill="var(--success)" radius={[0, 4, 4, 0]} />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-5">
              <div className="table-premium-container print-data-table">
                <table className="table-premium w-full">
                  <thead>
                    <tr>
                      <th className="text-left">{t('reports.col_subaccount')}</th>
                      <th className="text-right">{t('reports.col_leads')}</th>
                      <th className="text-right">{t('reports.col_won')}</th>
                      <th className="text-right">{t('reports.col_conv')}</th>
                      <th className="text-right">{t('reports.col_pipeline')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(clientCounts).sort((a, b) => b.total - a.total).map((data, i) => {
                        const conv = data.total > 0 ? Math.round((data.won / data.total) * 100) : 0;
                        const avgValue = data.won > 0 ? Math.round(data.value / data.won) : 0;
                        return (
                          <tr key={i}>
                            <td className="font-medium">{data.name}</td>
                            <td className="text-right">
                              <CellHoverInfo
                                title={`Leads · ${data.name}`}
                                description={`Total cumulé sur la période`}
                                breakdown={[
                                  { label: 'Total', value: data.total, tone: 'neutral' },
                                  { label: 'Gagnés', value: data.won, tone: 'success' },
                                  { label: 'Conv.', value: `${conv}%`, tone: 'brand' },
                                ]}
                              >
                                <span className="t-mono-num cursor-help">{data.total}</span>
                              </CellHoverInfo>
                            </td>
                            <td className="text-right text-[var(--success)]">
                              <CellHoverInfo
                                title="Gagnés"
                                description={`${data.won} deals fermés`}
                                breakdown={[
                                  { label: 'Won', value: data.won, tone: 'success' },
                                  { label: 'Pipeline $', value: `${formatMoneyCAD(data.value, getLocale())}`, tone: 'brand' },
                                  { label: 'Panier moyen', value: avgValue > 0 ? `${formatMoneyCAD(avgValue, getLocale())}` : '—', tone: 'accent' },
                                ]}
                                trend={{
                                  value: conv >= 20 ? 10.4 : -3.6,
                                  direction: conv >= 20 ? 'up' : 'down',
                                  label: 'vs période précédente',
                                }}
                              >
                                <span className="t-mono-num cursor-help">{data.won}</span>
                              </CellHoverInfo>
                            </td>
                            <td className="text-right"><Tag dot size="sm" variant={conv > 20 ? 'success' : 'warning'}>{conv}%</Tag></td>
                            <td className="text-right text-[var(--primary)]">
                              <CellHoverInfo
                                title="Pipeline"
                                description={`Valeur cumulée tous statuts confondus`}
                                breakdown={[
                                  { label: 'Pipeline $', value: `${formatMoneyCAD(data.value, getLocale())}`, tone: 'brand' },
                                  { label: 'Gagnés', value: data.won, tone: 'success' },
                                  { label: 'Panier moyen', value: avgValue > 0 ? `${formatMoneyCAD(avgValue, getLocale())}` : '—', tone: 'accent' },
                                ]}
                              >
                                <span className="t-mono-num cursor-help">{formatMoneyCAD(data.value, getLocale())}</span>
                              </CellHoverInfo>
                            </td>
                          </tr>
                        );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </PerformanceReports>
      );
      case 'trends': return (
        <TrendsReports>
          <div className="space-y-4">
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">📈 Tendance ({period})</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="gradient-trend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradient-signed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--success)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.97) 0%, rgba(240,250,254,0.97) 100%)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(0,157,219,0.25)',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 500,
                    boxShadow: '0 8px 32px -8px rgba(0,157,219,0.25), 0 0 0 1px rgba(0,157,219,0.08)',
                  }}
                  cursor={{ fill: 'rgba(0,157,219,0.08)' }} />
                  <Area type="monotone" dataKey="leads" name="Leads" stroke="var(--primary)" fill="url(#gradient-trend)" strokeWidth={2} />
                  <Area type="monotone" dataKey="won" name="Gagnés" stroke="var(--success)" fill="url(#gradient-signed)" strokeWidth={2} />
                  <Legend />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </TrendsReports>
      );
      // LOT SCHEDREPORT Sprint A — Phase B Manager-C : rapports planifiés
      case 'scheduled': return <ScheduledReportsPanel />;
      // LOT REPORT-TEMPLATES (Sprint 15) — Phase B Manager-C : galerie de modèles
      case 'templates': return <ReportTemplatesGallery />;
      case 'activity': return <ActivityReports />;
      case 'workflow': return <WorkflowReports />;
      case 'email': return <EmailReports />;
      case 'sms': return <SmsReports />;
      case 'calendar': return <CalendarReports />;
      case 'forms': return <FormsReports />;
      case 'reviews': return <ReviewsReports />;
      // LOT ATTRIBUTION-D Sprint D — Phase B Manager-C : charts recharts câblés
      // (modèles d'attribution multi-touch + heatmap cohortes). Panels
      // autonomes qui fetchent via getReportsAttribution / getLeadCohorts.
      case 'attribution': return <AttributionPanel />;
      case 'cohorts': return <CohortHeatmap />;
      // Surface invisible reports — agrégats serveur, respecte la période (days)
      case 'server': return <ServerAnalyticsPanel days={periodDays} />;
      default: return null;
    }
  };

  const periodLabel = period === '30d' ? t('reports.period.label_30d') : period === '90d' ? t('reports.period.label_90d') : t('reports.period.label_12m');
  const todayLabel = formatDate(new Date(), getLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
  const activeTabLabel = TABS.find(t => t.id === activeTab)?.label || activeTab;

  return (
    <AppLayout title={t('reports.page.title')}>
      {/* Sprint 34 wave 34-1A — PDF cover page premium */}
      <div className="pdf-cover-page" aria-hidden="true">
        <div className="pdf-cover-accent-bar" />
        <div className="pdf-cover-logo">Intralys</div>
        <div className="pdf-cover-tagline">{t('reports.pdf.tagline')}</div>
        <h1 className="pdf-cover-title">Rapport · {activeTabLabel}</h1>
        <p className="pdf-cover-subtitle">
          Synthèse analytique de vos performances commerciales et marketing sur la période sélectionnée.
        </p>
        <div className="pdf-cover-meta">
          <div className="pdf-cover-meta-item">
            <span className="label">{t('reports.pdf.generated')}</span>
            <span className="value">{todayLabel}</span>
          </div>
          <div className="pdf-cover-meta-item">
            <span className="label">{t('reports.pdf.period')}</span>
            <span className="value">{periodLabel}</span>
          </div>
          <div className="pdf-cover-meta-item">
            <span className="label">{t('reports.pdf.total_leads')}</span>
            <span className="value">{totalLeads}</span>
          </div>
          <div className="pdf-cover-meta-item">
            <span className="label">Conversion</span>
            <span className="value">{conversionRate}%</span>
          </div>
        </div>
      </div>

      <div className="print-page-header">
        <h1>Intralys CRM — Rapport</h1>
        <div className="print-meta">
          {todayLabel} · intralys.com
        </div>
      </div>
      <PageHero
        meta={t('reports.hero.meta')}
        title={t('reports.hero.title')}
        highlight={t('reports.hero.title')}
        description={t('reports.hero.description')}
      />
      {/* KPI Strip Sprint 23 wave 16 — unified GHL pattern */}
      <KpiStrip
        items={[
          { label: t('reports.kpi.total_leads'), value: totalLeads, color: 'brand', icon: <Icon as={Users} size={11} /> },
          { label: t('reports.kpi.this_month'), value: leadsThisMonth, color: 'success', icon: <Icon as={Activity} size={11} /> },
          { label: t('reports.kpi.conversion'), value: `${conversionRate}%`, color: 'info', icon: <Icon as={Percent} size={11} /> },
          { label: t('reports.kpi.pipeline'), value: `${(totalPipelineValue / 1000).toFixed(1)}K`, color: 'accent', icon: <Icon as={DollarSign} size={11} /> },
        ] satisfies KpiItem[]}
      />

      {/* Customization Toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-4 mb-6">
        <div className="flex flex-wrap gap-2">
          <div data-coachmark="reports-period" className="flex gap-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5 mr-2">
            {(['30d', '90d', '12m'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-[11px] rounded-md font-medium cursor-pointer transition-all
                  ${period === p ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                {p === '30d' ? t('reports.period.30d') : p === '90d' ? t('reports.period.90d') : t('reports.period.12m')}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setComparePeriod(!comparePeriod)} className={`text-xs gap-1.5 ${comparePeriod ? 'bg-[var(--brand-tint)] text-[var(--primary)]' : ''}`}>
            <Icon as={Presentation} size="sm" /> {t('reports.action.compare')}
          </Button>
          <Button variant="secondary" onClick={handleSaveReport} className="text-xs gap-1.5">
            <Icon as={Save} size={14} /> {t('reports.action.save')}
          </Button>
          <Button variant="primary" onClick={handleExportPDF} disabled={isExporting} className="text-xs gap-1.5" aria-label={activeTab === 'builder' ? 'Exporter le dashboard en PDF' : 'Exporter le rapport en PDF'}>
            <Icon as={Download} size={14} /> {isExporting ? t('reports.action.exporting') : (activeTab === 'builder' ? t('reports.action.export_dashboard') : t('reports.action.export_report'))}
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6 max-w-6xl">
        {/* Mobile tabs */}
        <div className="md:hidden w-full flex gap-1.5 overflow-x-auto pb-3 mb-2 -mx-1 px-1 no-scrollbar">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border whitespace-nowrap shrink-0 transition-all ${activeTab === tab.id ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)]'}`}>
              <tab.icon size={13} /> {tab.label}
            </button>
          ))}
        </div>

        {/* Sidebar Navigation */}
        <nav className="hidden md:block w-56 shrink-0 h-[calc(100vh-160px)] overflow-y-auto pr-2">
          {(() => {
            const groups = [...new Set(TABS.map(t => t.group))];
            return groups.map(group => (
              <div key={group} className="mb-6">
                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.1em] px-3 mb-2">{group}</p>
                {TABS.filter(t => t.group === group).map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left cursor-pointer transition-all mb-0.5
                      ${activeTab === tab.id ? 'bg-[var(--brand-tint)] text-[var(--primary)] font-medium shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'}`}>
                    <tab.icon size={16} /> {tab.label}
                  </button>
                ))}
              </div>
            ));
          })()}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 h-[calc(100vh-160px)] overflow-y-auto pb-10 pr-2">
          {/* Sprint LOT 1-3 — Error state inline + retry (gap audit Reports) */}
          {loadError ? (
            <Card className="p-6 border border-[var(--danger)]/30" role="alert" aria-live="assertive">
              <p className="text-sm font-semibold text-[var(--danger)] mb-1">
                {t('reports.error.load_failed')}
              </p>
              <p className="text-xs text-[var(--text-muted)] mb-3 break-all">{loadError}</p>
              <Button variant="secondary" onClick={() => void loadData()}>
                {t('action.retry')}
              </Button>
            </Card>
          ) : /* Sprint 46 M1 — Le builder reste accessible même sans leads (l'user
             peut créer un dashboard avant d'avoir de la donnée). */
          leads.length === 0 && activeTab !== 'builder' && activeTab !== 'scheduled' && activeTab !== 'templates' && activeTab !== 'server' ? (
            <Card className="p-0">
              <EmptyState
                variant="first-time"
                illustration={<EmptyStateIllustration kind="reports" size={160} />}
                title={t('reports.empty.title')}
                description={t('reports.empty.description')}
              />
            </Card>
          ) : (
            renderContent()
          )}
        </div>
      </div>
      {/* Sprint 45 M3.2 — Coachmark contextuel : « Filtre par période, comparer, etc. » */}
      <ContextualCoachmark page="reports" />
    </AppLayout>
  );
}
