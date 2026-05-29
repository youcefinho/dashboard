import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Skeleton } from '@/components/ui/Skeleton';
import { getDashboardStats, getLeads, getClients, exportLeadsCsv, getWeeklyInsight, generateWeeklyInsight } from '@/lib/api';
import { t } from '@/lib/i18n';
import { usePanelStack, AnimatedNumber } from '@/components/ui';
import {
  STATUS_LABELS, STATUS_COLORS, ACTIVITY_LABELS,
  type DashboardStats, type Lead, type Client, type WeeklyAiInsight,
} from '@/lib/types';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import {
  TrendingUp, TrendingDown, Users, Target, DollarSign, Zap,
  Download, ArrowRight, Settings2,
  ChevronUp, ChevronDown, Eye, EyeOff, Sparkles, RefreshCw, AlertCircle
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ProactiveAlertsWidget } from '@/components/ProactiveAlertsWidget';
import { DashboardLayoutManager } from '@/components/dashboard/DashboardLayoutManager';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

function saveWidgetConfig(config: WidgetConfig[]) {
  localStorage.setItem('intralys_dashboard_widgets', JSON.stringify(config));
}

// ── Couleurs avatars gradient (multi-couleurs maquette) ──────
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #009DDB 0%, #188BF6 100%)',
  'linear-gradient(135deg, #D96E27 0%, #FF9A00 100%)',
  'linear-gradient(135deg, #757BBD 0%, #D6BCFA 100%)',
  'linear-gradient(135deg, #37CA37 0%, #81E6D9 100%)',
  'linear-gradient(135deg, #E93D3D 0%, #FBB6CE 100%)',
  'linear-gradient(135deg, #F6AD55 0%, #FAF089 100%)',
];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
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
  const { user } = useAuth();

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

  // Applique une config widgets issue d'un layout serveur (forme tolérante :
  // on ne garde que les WidgetId connus et on complète avec les defaults manquants).
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
    // Compléter avec les widgets par défaut absents du layout enregistré.
    for (const def of DEFAULT_WIDGETS) {
      if (!seen.has(def.id)) sanitized.push({ ...def, order: sanitized.length });
    }
    const next = sanitized.sort((a, b) => a.order - b.order).map((w, i) => ({ ...w, order: i }));
    updateWidgets(() => next);
  }, [updateWidgets]);

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

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 60) return t('dashboard.time.min_ago', { n: diffMin });
    if (diffH < 24) return t('dashboard.time.hours_ago', { n: diffH });
    if (diffD === 1) return t('dashboard.time.1d_ago');
    return t('dashboard.time.days_ago', { n: diffD });
  };

  if (error) {
    return (
      <AppLayout title={t('dashboard.page.title')}>
        <div className="flex items-center justify-center h-64" role="alert" aria-live="assertive">
          <div className="text-center">
            <p className="text-[var(--danger)] mb-2">{error}</p>
        <button onClick={() => window.location.reload()} className="text-sm text-[var(--brand-primary)] hover:underline cursor-pointer">{t('dashboard.error.retry')}</button>
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
  const greeting = hour < 12 ? t('dashboard.greeting.morning') : hour < 18 ? t('dashboard.greeting.afternoon') : t('dashboard.greeting.evening');

  // Sparkline pour stat cards
  const sparkPts = (stats?.leads_by_day || []).map(d => d.count);

  return (
    <AppLayout title={t('dashboard.page.title')}>
      <>

        {/* ═══ Hero greeting Sprint 23 — orbs dramatiques + gradient title ═══ */}
        <div className="relative mb-6 p-8 rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 40%, #F0FAFE 100%)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 40px -12px rgba(0,157,219,0.15)',
          }}>
          {/* Orbs décoratifs animés DRAMATIQUES (Sprint 23 — opacités fortes) */}
          <div className="hero-stat-orb absolute rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.35) 0%, rgba(0,157,219,0.10) 50%, transparent 80%)', width: 320, height: 320, top: -120, right: -80, filter: 'blur(48px)' }} />
          <div className="hero-stat-orb absolute rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.28) 0%, rgba(217,110,39,0.08) 50%, transparent 80%)', width: 220, height: 220, bottom: -80, left: '25%', filter: 'blur(48px)', animationDelay: '4s' }} />
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="heading-premium mb-1.5">{t('dashboard.period.days', { days: periodDays })}</p>
              <h2 className="text-3xl font-bold tracking-tight leading-tight">
                {greeting} <span className="text-gradient-brand">{user?.name || 'Rochdi'}</span> 👋
              </h2>
              <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                {t('dashboard.subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Sélecteur de période (segmented) */}
              <div className="inline-flex p-0.5 rounded-lg" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                {(['7d', '30d', '90d'] as const).map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className="px-3 h-7 text-xs font-medium rounded-md cursor-pointer transition-all"
                    style={period === p ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', fontWeight: 600 } : { color: 'var(--text-secondary)' }}>
                    {p === '7d' ? t('dashboard.period.7d') : p === '30d' ? t('dashboard.period.30d') : t('dashboard.period.90d')}
                  </button>
                ))}
              </div>
              <button onClick={() => void exportLeadsCsv()}
                className="h-9 px-3 rounded-lg text-sm font-medium flex items-center gap-2 transition hover:bg-[var(--bg-subtle)] cursor-pointer"
                style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                <Download size={16} /> {t('dashboard.action.export')}
              </button>
              <button onClick={() => setShowConfig(!showConfig)}
                className={`h-9 w-9 rounded-lg flex items-center justify-center transition cursor-pointer ${showConfig ? 'bg-[var(--brand-primary)] text-white' : 'hover:bg-[var(--bg-subtle)]'}`}
                style={!showConfig ? { border: '1px solid var(--border-default)', color: 'var(--text-secondary)' } : {}}
                title={t('dashboard.page.config_title')}
                aria-label={t('dashboard.page.config_aria')}
                aria-expanded={showConfig}>
                <Settings2 size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ═══ Sprint C — Widget IA proactive (self-gated capability ai.use + self-hide si vide) ═══ */}
        <ProactiveAlertsWidget />

        {/* ═══ Gestionnaire de layouts personnalisés (Sprint 6 D4) ═══ */}
        {showConfig && (
          <DashboardLayoutManager currentWidgets={widgets} onApplyLayout={applyLayout} />
        )}

        {/* ═══ Panneau de configuration des widgets ═══ */}
        {showConfig && (
          <div className="mb-4 p-4 rounded-xl animate-fade-in" style={{ background: 'var(--bg-surface)', border: '1px solid var(--brand-primary)', borderStyle: 'dashed' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Settings2 size={14} className="text-[var(--brand-primary)]" /> {t('dashboard.config.title')}</h3>
              <button onClick={() => updateWidgets(() => DEFAULT_WIDGETS)} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--brand-primary)] cursor-pointer">{t('dashboard.config.reset')}</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {widgets.map((w, idx) => (
                <div key={w.id} className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                  w.visible ? 'border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/5' : 'border-[var(--border-subtle)] opacity-50'
                }`}>
                  <button onClick={() => toggleWidget(w.id)} className="cursor-pointer shrink-0"
                    title={w.visible ? t('dashboard.page.config_hide') : t('dashboard.page.config_show')}
                    aria-label={w.visible ? t('dashboard.page.config_hide') : t('dashboard.page.config_show')}
                    aria-pressed={w.visible}>
                    {w.visible ? <Eye size={14} className="text-[var(--brand-primary)]" /> : <EyeOff size={14} className="text-[var(--text-muted)]" />}
                  </button>
                  <span className="text-xs flex-1 truncate">{w.icon} {t(WIDGET_LABEL_KEYS[w.id])}</span>
                  <div className="flex flex-col">
                    <button onClick={() => moveWidget(w.id, -1)} disabled={idx === 0} aria-label={t('dashboard.page.widget_move_up')} className="text-[var(--text-muted)] hover:text-[var(--brand-primary)] cursor-pointer disabled:opacity-20"><ChevronUp size={12} /></button>
                    <button onClick={() => moveWidget(w.id, 1)} disabled={idx === widgets.length - 1} aria-label={t('dashboard.page.widget_move_down')} className="text-[var(--text-muted)] hover:text-[var(--brand-primary)] cursor-pointer disabled:opacity-20"><ChevronDown size={12} /></button>
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
            case 'weekly_insight': return <DashboardWeeklyInsightWidget key={w.id} />
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
    </AppLayout>
  );

  // ── Sous-composants widgets inlines ──────────────────────────

  function DashboardStatsWidgets() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-5 rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <Skeleton className="h-24 w-full" />
              </div>
            ))
          ) : (
            <>
              <StatCardMockup label={t('dashboard.stat.contacts')} value={stats?.total_leads ?? 0}
                icon={<Users size={20} />} iconBg="var(--brand-tint)" iconColor="var(--brand-primary)"
                sparkColor="#009DDB" sparkData={sparkPts} />
              <StatCardMockup label={t('dashboard.stat.pipeline_value')} value={`${((stats?.total_deal_value ?? 0) / 1000).toFixed(1)}K $`}
                icon={<DollarSign size={20} />} iconBg="var(--success-soft)" iconColor="var(--success)"
                sparkColor="#37CA37" sparkData={sparkPts.slice(-7)} />
              <StatCardMockup label={t('dashboard.stat.conversion')} value={`${stats?.conversion_rate ?? 0}%`}
                icon={<Target size={20} />} iconBg="var(--accent-orange-soft)" iconColor="var(--accent-orange)"
                sparkColor="#D96E27" />
              <StatCardMockup label={t('dashboard.stat.revenue')} value={`${((stats?.revenue_value ?? 0) / 1000).toFixed(1)}K $`}
                icon={<Zap size={20} />} iconBg="var(--info-soft)" iconColor="var(--info)"
                sparkColor="#188BF6" />
            </>
          )}
        </div>
    );
  }

  function DashboardClientsWidget() {
    if (isLoading || clients.length === 0) return null;
    return (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {clients.slice(0, 5).map((client, i) => {
              const leadCount = stats?.leads_by_client?.find(c => c.client_name === client.name)?.count ?? 0;
              return (
                <div key={client.id} className="card-lift p-4 rounded-xl flex items-center gap-3 cursor-pointer"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                  onClick={() => void navigate({ to: `/clients/${client.id}/leads` })}>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], color: 'white' }}>
                    {client.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{client.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{leadCount} leads</div>
                  </div>
                </div>
              );
            })}
            <div className="card-lift p-4 rounded-xl flex items-center justify-center cursor-pointer"
              style={{ background: 'var(--bg-canvas)', border: '1px dashed var(--border-default)', color: 'var(--text-muted)' }}
              onClick={() => void navigate({ to: '/clients' })}>
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="text-lg">+</span> {t('dashboard.client.add')}
              </div>
            </div>
          </div>
    );
  }

  function DashboardChartWidget() {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Chart stacked bar — Sprint 23 premium framing */}
          <div className="lg:col-span-2 relative overflow-hidden p-6 rounded-2xl transition-all hover:shadow-[0_24px_48px_-12px_rgba(0,157,219,0.18)]"
            style={{
              background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F5FBFE 100%)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.06)',
            }}>
            <div aria-hidden className="absolute -top-12 -right-12 w-44 h-44 rounded-full pointer-events-none opacity-50"
              style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.18) 0%, transparent 70%)', filter: 'blur(40px)' }} />
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">{t('dashboard.chart.title')}</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t('dashboard.chart.subtitle', { days: periodDays })}</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--brand-primary)' }} /><span style={{ color: 'var(--text-secondary)' }}>{t('dashboard.chart.website')}</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-orange)' }} /><span style={{ color: 'var(--text-secondary)' }}>{t('dashboard.chart.facebook')}</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--success)' }} /><span style={{ color: 'var(--text-secondary)' }}>{t('dashboard.chart.referral')}</span></span>
              </div>
            </div>
            {isLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats?.leads_by_day || []}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={25} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.97) 0%, rgba(240,250,254,0.97) 100%)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(0,157,219,0.25)',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    boxShadow: '0 8px 32px -8px rgba(0,157,219,0.25), 0 0 0 1px rgba(0,157,219,0.08)',
                  }}
                  cursor={{ fill: 'rgba(0,157,219,0.08)' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#009DDB" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Activité récente — Sprint 23 premium framing */}
          <div className="relative overflow-hidden p-6 rounded-2xl transition-all hover:shadow-[0_24px_48px_-12px_rgba(217,110,39,0.18)]"
            style={{
              background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #FFFAF5 100%)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.06)',
            }}>
            <div aria-hidden className="absolute -bottom-12 -right-12 w-40 h-40 rounded-full pointer-events-none opacity-50"
              style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.16) 0%, transparent 70%)', filter: 'blur(40px)' }} />
            <div className="relative flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold tracking-tight">{t('dashboard.activity.title')}</h3>
            </div>
            <div className="space-y-4">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
              ) : stats?.activity_feed && stats.activity_feed.length > 0 ? (
                stats.activity_feed.slice(0, 5).map((activity, i) => {
                  let details = {} as Record<string, string>;
                  try { details = JSON.parse(activity.details); } catch {}
                  return (
                  <div key={activity.id} className="flex gap-3 cursor-pointer">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
                      style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], color: 'white' }}>
                      {getInitials(activity.user_name || 'Sys')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs leading-relaxed">
                        <span className="font-semibold">{activity.user_name || 'Système'}</span>{' '}
                        <span style={{ color: 'var(--text-secondary)' }}>
                           {ACTIVITY_LABELS[activity.action] || activity.action}
                        </span>
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {timeAgo(activity.created_at)} · {details.name || details.email || details.to || ''}
                      </div>
                    </div>
                  </div>
                )})
              ) : (
                <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>{t('dashboard.activity.empty')}</p>
              )}
            </div>
            <button onClick={() => void navigate({ to: '/leads' })}
              className="w-full mt-5 text-xs font-semibold py-2 rounded-lg transition cursor-pointer hover:bg-[var(--brand-tint)]"
              style={{ color: 'var(--brand-primary)' }}>
              {t('dashboard.activity.view_all')}
            </button>
          </div>
        </div>
    );
  }

  function DashboardPipelineDonut() {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Donut pipeline — Sprint 23 premium framing */}
          <div className="lg:col-span-2 relative overflow-hidden p-6 rounded-2xl transition-all hover:shadow-[0_24px_48px_-12px_rgba(55,202,55,0.18)]"
            style={{
              background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F5FBF5 100%)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.06)',
            }}>
            <div aria-hidden className="absolute -top-12 -left-12 w-40 h-40 rounded-full pointer-events-none opacity-50"
              style={{ background: 'radial-gradient(circle, rgba(55,202,55,0.15) 0%, transparent 70%)', filter: 'blur(40px)' }} />
            <h3 className="relative text-base font-semibold mb-4 tracking-tight">{t('dashboard.pipeline.title')}</h3>
            {isLoading ? <Skeleton className="h-48 w-full" /> : pipelineData.length > 0 ? (
              <div className="flex items-center gap-8">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie data={pipelineData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" paddingAngle={3} strokeWidth={0}>
                      {pipelineData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.97) 0%, rgba(240,250,254,0.97) 100%)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(0,157,219,0.25)',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    boxShadow: '0 8px 32px -8px rgba(0,157,219,0.25), 0 0 0 1px rgba(0,157,219,0.08)',
                  }}
                  cursor={{ fill: 'rgba(0,157,219,0.08)' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {pipelineData.map(d => (
                    <div key={d.name} className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: d.color }} />
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                      <span className="text-xs font-semibold ml-auto" style={{ fontVariantNumeric: 'tabular-nums' }}>{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="text-sm text-[var(--text-muted)]">{t('dashboard.pipeline.empty')}</p>}
          </div>

          {/* Top sources */}
          {isVisible('top_sources') && (
          <div className="relative overflow-hidden p-6 rounded-2xl transition-all hover:shadow-[0_24px_48px_-12px_rgba(0,157,219,0.18)]"
            style={{
              background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.06)',
            }}>
            <div aria-hidden className="absolute -bottom-10 -right-10 w-36 h-36 rounded-full pointer-events-none opacity-50"
              style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.16) 0%, transparent 70%)', filter: 'blur(40px)' }} />
            <h3 className="relative text-base font-semibold mb-4 tracking-tight">{t('dashboard.sources.title')}</h3>
            <div className="space-y-3">
              {sourceData.map(({ source, count, value }) => {
                const pct = sourceTotal > 0 ? Math.round((count / sourceTotal) * 100) : 0;
                const labels: Record<string, string> = { website: t('dashboard.sources.website'), facebook: t('dashboard.sources.facebook'), google: t('dashboard.sources.google'), referral: t('dashboard.sources.referral'), direct: t('dashboard.sources.direct'), instagram: t('dashboard.sources.instagram') };
                return (
                  <div key={source}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{labels[source] || source}</span>
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{count} ({pct}%)</span>
                        <span className="text-[10px]" style={{ color: 'var(--success)' }}>{(value / 1000).toFixed(1)}K $</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--brand-primary)' }} />
                    </div>
                  </div>
                );
              })}
              {sourceData.length === 0 && <p className="text-xs text-[var(--text-muted)]">{t('dashboard.sources.empty')}</p>}
            </div>
          </div>
          )}
        </div>
    );
  }

  function DashboardContactsWidget() {
    return (
        <div className="rounded-xl card-lift" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <div className="px-4 sm:px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <h3 className="text-base font-semibold">{t('dashboard.contacts.title')}</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t('dashboard.contacts.subtitle', { count: recentLeads.length })}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void navigate({ to: '/leads' })}
                className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer hover:bg-[var(--brand-tint)]"
                style={{ color: 'var(--brand-primary)' }}>
                {t('dashboard.contacts.view_all')} <ArrowRight size={14} />
              </button>
            </div>
          </div>
          {/* ── Mobile : card list (≤md) ── */}
          <div className="md:hidden divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-4 py-3"><Skeleton className="h-12 w-full" /></div>
              ))
            ) : recentLeads.map((lead, i) => {
              const score = lead.score ?? 0;
              const scoreColor = score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
              const statusColor = STATUS_COLORS[lead.status] || 'var(--text-muted)';
              const statusBg = `color-mix(in srgb, ${statusColor} 12%, transparent)`;
              return (
                <div key={lead.id} className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-[var(--bg-subtle)] transition"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}
                  onClick={() => openPanel({ type: 'lead', id: lead.id })}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                    style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], color: 'white' }}>
                    {getInitials(lead.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium truncate">{lead.name}</span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
                        style={{ background: statusBg, color: statusColor }}>
                        {STATUS_LABELS[lead.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      <span className="truncate">{lead.source === 'website' ? t('dashboard.source.website') : lead.source === 'facebook' ? t('dashboard.source.facebook') : lead.source || t('dashboard.source.direct')}</span>
                      <span>·</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{lead.deal_value ? `${(lead.deal_value / 1000).toFixed(0)}k$` : '—'}</span>
                      <span>·</span>
                      <span style={{ color: scoreColor, fontVariantNumeric: 'tabular-nums' }}>Score {score}</span>
                    </div>
                  </div>
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{timeAgo(lead.created_at)}</span>
                </div>
              );
            })}
          </div>
          {/* ── Desktop : table (≥md) ── */}
          <table className="hidden md:table w-full">
            <thead>
              <tr style={{ background: 'var(--bg-subtle)' }}>
                <th className="text-left px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{t('dashboard.contacts.col_contact')}</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{t('dashboard.contacts.col_status')}</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{t('dashboard.contacts.col_source')}</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{t('dashboard.contacts.col_value')}</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{t('dashboard.contacts.col_score')}</th>
                <th className="text-right px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{t('dashboard.contacts.col_activity')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-6 py-3"><Skeleton className="h-8 w-full" /></td></tr>
                ))
              ) : recentLeads.map((lead, i) => {
                const score = lead.score ?? 0;
                const scoreColor = score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
                const statusColor = STATUS_COLORS[lead.status] || 'var(--text-muted)';
                const statusBg = `color-mix(in srgb, ${statusColor} 12%, transparent)`;
                return (
                  <tr key={lead.id} className="hover:bg-[var(--bg-subtle)] transition cursor-pointer"
                    style={{ borderTop: '1px solid var(--border-subtle)' }}
                    onClick={() => openPanel({ type: 'lead', id: lead.id })}>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold"
                          style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], color: 'white' }}>
                          {getInitials(lead.name)}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{lead.name}</div>
                          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{lead.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold"
                        style={{ background: statusBg, color: statusColor }}>
                        ● {STATUS_LABELS[lead.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {lead.source === 'website' ? t('dashboard.source.website') : lead.source === 'facebook' ? t('dashboard.source.facebook_ads') : lead.source || t('dashboard.source.direct')}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {lead.deal_value ? `${(lead.deal_value / 1000).toFixed(0)}k$` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                          <div className="h-full rounded-full" style={{ background: scoreColor, width: `${score}%` }} />
                        </div>
                        <span className="text-xs font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>{score}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                      {timeAgo(lead.created_at)}
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

// ── StatCard style maquette (icône carrée + sparkline SVG + delta badge) ──

function StatCardMockup({ label, value, icon, iconBg, iconColor, delta, deltaUp, sparkColor, sparkData }: {
  label: string; value: number | string; icon: React.ReactNode;
  iconBg: string; iconColor: string;
  delta?: string; deltaUp?: boolean; sparkColor: string; sparkData?: number[];
}) {
  // Générer le SVG sparkline path
  const sparkPath = (sparkData && sparkData.length > 1) ? (() => {
    const max = Math.max(...sparkData, 1);
    const min = Math.min(...sparkData, 0);
    const range = max - min || 1;
    const pts = sparkData.map((v, i) => {
      const x = (i / (sparkData.length - 1)) * 100;
      const y = 30 - ((v - min) / range) * 25;
      return `${x},${y}`;
    });
    return `M${pts.join(' L')}`;
  })() : null;

  const areaPath = sparkPath ? `${sparkPath} L100,30 L0,30 Z` : null;

  return (
    <div className="group relative overflow-hidden rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:scale-[1.02]"
      style={{
        // Sprint 23 — Pattern 3 dramatique : gradient diagonal + orb décoratif
        background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.08)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 4px 8px ${iconColor === 'var(--brand-primary)' ? 'rgba(0,157,219,0.10)' : 'rgba(217,110,39,0.10)'}, 0 24px 48px -12px ${iconColor === 'var(--brand-primary)' ? 'rgba(0,157,219,0.25)' : 'rgba(217,110,39,0.25)'}`; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.08)'; }}>

      {/* Orb décoratif animé en top-right */}
      <div
        aria-hidden
        className="hero-stat-orb absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none transition-opacity duration-500 opacity-60 group-hover:opacity-90"
        style={{
          background: 'radial-gradient(circle, rgba(217,110,39,0.32) 0%, rgba(0,157,219,0.18) 50%, transparent 75%)',
          filter: 'blur(40px)',
        }}
      />

      <div className="relative z-10">
        {/* Label uppercase wide */}
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] mb-3">
          {label}
        </div>

        {/* Value 64px gradient + delta pill — Sprint 23 wave 8 : count-up */}
        <div className="flex items-end gap-3 mb-3">
          <span className="text-[56px] sm:text-[64px] leading-none font-bold tabular-nums text-gradient-brand"
            style={{ letterSpacing: '-0.03em' }}>
            <AnimatedNumber value={value} />
          </span>
          {delta && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold mb-2"
              style={{
                background: deltaUp !== false ? 'rgba(55, 202, 55, 0.12)' : 'rgba(233, 61, 61, 0.12)',
                color: deltaUp !== false ? '#1f8f1f' : '#c92424',
                border: deltaUp !== false ? '1px solid rgba(55, 202, 55, 0.3)' : '1px solid rgba(233, 61, 61, 0.3)',
                boxShadow: deltaUp !== false ? '0 0 12px rgba(55, 202, 55, 0.25)' : '0 0 12px rgba(233, 61, 61, 0.25)',
              }}>
              {deltaUp !== false ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {delta}
            </span>
          )}
        </div>

        {/* Sparkline avec gradient fill */}
        {sparkPath && (
          <svg className="w-full h-10" viewBox="0 0 100 30" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`sg-${label.replace(/\s/g, '')}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={sparkColor} stopOpacity={0.35} />
                <stop offset="1" stopColor={sparkColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={areaPath!} fill={`url(#sg-${label.replace(/\s/g, '')})`} />
            <path d={sparkPath} fill="none" stroke={sparkColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}

        {/* Icon en bas-droite, plus discret (la stat est la star) */}
        <div className="absolute top-0 right-0 w-9 h-9 rounded-xl flex items-center justify-center opacity-50 group-hover:opacity-100 transition-opacity"
          style={{ background: iconBg }}>
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
      </div>
    </div>
  );
}

function DashboardWeeklyInsightWidget() {
  const [insight, setInsight] = useState<WeeklyAiInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsight = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getWeeklyInsight();
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setInsight(res.data);
      }
    } catch (err) {
      setError(t('dashboard.error.generic') || 'Une erreur est survenue lors du chargement.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateWeeklyInsight();
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setInsight(res.data);
      }
    } catch (err) {
      setError(t('dashboard.error.generic') || 'Une erreur est survenue lors de la génération.');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    void fetchInsight();
  }, [fetchInsight]);

  if (loading) {
    return (
      <div className="relative overflow-hidden p-6 rounded-2xl mb-6"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
        }}>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // Parse les métriques si présentes
  let metrics: any = null;
  if (insight?.metric_changes_json) {
    try {
      metrics = JSON.parse(insight.metric_changes_json);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="relative overflow-hidden p-6 rounded-2xl mb-6 transition-all duration-300 hover:shadow-[0_20px_40px_-10px_rgba(0,157,219,0.1)]"
      style={{
        background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 1px 3px rgba(15,23,42,0.03), 0 10px 30px -10px rgba(0,157,219,0.08)',
      }}>
      
      {/* Orb décoratif de fond */}
      <div aria-hidden className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none opacity-40"
        style={{
          background: 'radial-gradient(circle, rgba(0,157,219,0.2) 0%, transparent 70%)',
          filter: 'blur(30px)'
        }} />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--brand-primary)]" />
            {t('dashboard.page.widget_weekly_insight')}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {insight ? `${t('dashboard.weekly_insight.generated_on')} ${new Date(insight.created_at).toLocaleDateString('fr-CA', { dateStyle: 'long' })}` : t('dashboard.weekly_insight.no_data')}
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className={`h-9 px-4 rounded-lg text-xs font-semibold flex items-center gap-2 transition duration-200 cursor-pointer ${
            generating ? 'opacity-50 cursor-not-allowed bg-[var(--bg-subtle)] text-[var(--text-muted)]' : 'bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary)]/90 shadow-sm hover:shadow'
          }`}
        >
          <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
          {generating ? t('dashboard.weekly_insight.generating') : t('dashboard.weekly_insight.generate')}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg mb-4 flex items-center gap-2 text-xs" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)/20', color: 'var(--danger)' }}>
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {/* Métrique Leads */}
          <div className="p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] mb-1">
              {t('dashboard.weekly_insight.leads')}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[var(--text-primary)]">{metrics.leads_this_week}</span>
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                metrics.leads_delta_pct >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {metrics.leads_delta_pct >= 0 ? '+' : ''}{metrics.leads_delta_pct}%
              </span>
            </div>
          </div>

          {/* Métrique Deals Conclus */}
          <div className="p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] mb-1">
              {t('dashboard.weekly_insight.deals')}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[var(--text-primary)]">{metrics.deals_won_this_week}</span>
              {metrics.deals_won_delta !== 0 && (
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  metrics.deals_won_delta >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {metrics.deals_won_delta >= 0 ? '+' : ''}{metrics.deals_won_delta}
                </span>
              )}
            </div>
          </div>

          {/* Valeur du Pipeline */}
          <div className="p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] mb-1">
              {t('dashboard.weekly_insight.pipeline_val')}
            </div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {(metrics.pipeline_value / 1000).toFixed(1)}K $
            </div>
          </div>

          {/* Messages échangés */}
          <div className="p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] mb-1">
              {t('dashboard.weekly_insight.messages')}
            </div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {metrics.messages_count}
            </div>
          </div>
        </div>
      )}

      {insight ? (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-bold prose-headings:text-[var(--text-primary)] text-sm leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {insight.content}
          </ReactMarkdown>
        </div>
      ) : (
        !loading && !generating && (
          <div className="text-center py-8">
            <Sparkles size={24} className="mx-auto text-[var(--text-muted)] mb-2" />
            <p className="text-xs text-[var(--text-muted)] mb-4">
              {t('dashboard.weekly_insight.click_generate')}
            </p>
            <button
              onClick={handleGenerate}
              className="h-8 px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition duration-200 cursor-pointer bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary)]/90"
            >
              <Sparkles size={12} />
              {t('dashboard.weekly_insight.generate_first')}
            </button>
          </div>
        )
      )}
    </div>
  );
}
