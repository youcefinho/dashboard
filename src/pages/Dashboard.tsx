// ── Page Dashboard — Vue globale (Sprint Design v2 — Maquette) ──

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Skeleton } from '@/components/ui/Skeleton';
import { getDashboardStats, getLeads, getClients, exportLeadsCsv } from '@/lib/api';
import { usePanelStack } from '@/components/ui';
import {
  STATUS_LABELS, STATUS_COLORS, ACTIVITY_LABELS,
  type DashboardStats, type Lead, type Client,
} from '@/lib/types';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import {
  TrendingUp, TrendingDown, Users, Target, DollarSign, Zap,
  Download, ArrowRight, Settings2,
  ChevronUp, ChevronDown, Eye, EyeOff,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

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
            <button onClick={() => window.location.reload()} className="text-sm text-[var(--brand-primary)] hover:underline cursor-pointer">Réessayer</button>
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

  return (
    <AppLayout title="Dashboard">
      <>

        {/* ═══ Hero greeting avec shimmer (maquette) ═══ */}
        <div className="relative mb-6 p-6 rounded-2xl overflow-hidden shimmer-bg"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          {/* Blobs décoratifs */}
          <div className="absolute rounded-full pointer-events-none" style={{ background: 'var(--brand-primary)', width: 200, height: 200, top: -80, right: -50, opacity: 0.12, filter: 'blur(40px)' }} />
          <div className="absolute rounded-full pointer-events-none" style={{ background: 'var(--accent-orange)', width: 140, height: 140, bottom: -60, left: '30%', opacity: 0.08, filter: 'blur(40px)' }} />
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">{greeting} {user?.name || 'Rochdi'} 👋</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Voici la vue d'ensemble — {periodDays} derniers jours.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Sélecteur de période (segmented) */}
              <div className="inline-flex p-0.5 rounded-lg" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                {(['7d', '30d', '90d'] as const).map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className="px-3 h-7 text-xs font-medium rounded-md cursor-pointer transition-all"
                    style={period === p ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', fontWeight: 600 } : { color: 'var(--text-secondary)' }}>
                    {p === '7d' ? '7j' : p === '30d' ? '30j' : '90j'}
                  </button>
                ))}
              </div>
              <button onClick={() => void exportLeadsCsv()}
                className="h-9 px-3 rounded-lg text-sm font-medium flex items-center gap-2 transition hover:bg-[var(--bg-subtle)] cursor-pointer"
                style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                <Download size={16} /> Exporter
              </button>
              <button onClick={() => setShowConfig(!showConfig)}
                className={`h-9 w-9 rounded-lg flex items-center justify-center transition cursor-pointer ${showConfig ? 'bg-[var(--brand-primary)] text-white' : 'hover:bg-[var(--bg-subtle)]'}`}
                style={!showConfig ? { border: '1px solid var(--border-default)', color: 'var(--text-secondary)' } : {}}
                title="Configurer les widgets">
                <Settings2 size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ═══ Panneau de configuration des widgets ═══ */}
        {showConfig && (
          <div className="mb-4 p-4 rounded-xl animate-fade-in" style={{ background: 'var(--bg-surface)', border: '1px solid var(--brand-primary)', borderStyle: 'dashed' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Settings2 size={14} className="text-[var(--brand-primary)]" /> Personnaliser le dashboard</h3>
              <button onClick={() => updateWidgets(() => DEFAULT_WIDGETS)} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--brand-primary)] cursor-pointer">Réinitialiser</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {widgets.map((w, idx) => (
                <div key={w.id} className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                  w.visible ? 'border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/5' : 'border-[var(--border-subtle)] opacity-50'
                }`}>
                  <button onClick={() => toggleWidget(w.id)} className="cursor-pointer shrink-0" title={w.visible ? 'Masquer' : 'Afficher'}>
                    {w.visible ? <Eye size={14} className="text-[var(--brand-primary)]" /> : <EyeOff size={14} className="text-[var(--text-muted)]" />}
                  </button>
                  <span className="text-xs flex-1 truncate">{w.icon} {w.label}</span>
                  <div className="flex flex-col">
                    <button onClick={() => moveWidget(w.id, -1)} disabled={idx === 0} className="text-[var(--text-muted)] hover:text-[var(--brand-primary)] cursor-pointer disabled:opacity-20"><ChevronUp size={12} /></button>
                    <button onClick={() => moveWidget(w.id, 1)} disabled={idx === widgets.length - 1} className="text-[var(--text-muted)] hover:text-[var(--brand-primary)] cursor-pointer disabled:opacity-20"><ChevronDown size={12} /></button>
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
              <StatCardMockup label="Total contacts" value={stats?.total_leads ?? 0}
                icon={<Users size={20} />} iconBg="var(--brand-tint)" iconColor="var(--brand-primary)"
                sparkColor="#009DDB" sparkData={sparkPts} />
              <StatCardMockup label="Pipeline value" value={`${((stats?.total_deal_value ?? 0) / 1000).toFixed(1)}K $`}
                icon={<DollarSign size={20} />} iconBg="var(--success-soft)" iconColor="var(--success)"
                sparkColor="#37CA37" sparkData={sparkPts.slice(-7)} />
              <StatCardMockup label="Taux conversion" value={`${stats?.conversion_rate ?? 0}%`}
                icon={<Target size={20} />} iconBg="var(--accent-orange-soft)" iconColor="var(--accent-orange)"
                sparkColor="#D96E27" />
              <StatCardMockup label="Revenu (Mois)" value={`${((stats?.revenue_value ?? 0) / 1000).toFixed(1)}K $`}
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
                <span className="text-lg">+</span> Ajouter
              </div>
            </div>
          </div>
    );
  }

  function DashboardChartWidget() {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Chart stacked bar */}
          <div className="lg:col-span-2 p-6 rounded-xl card-lift" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">Acquisition de leads</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{periodDays} derniers jours par source</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--brand-primary)' }} /><span style={{ color: 'var(--text-secondary)' }}>Site web</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-orange)' }} /><span style={{ color: 'var(--text-secondary)' }}>Facebook</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--success)' }} /><span style={{ color: 'var(--text-secondary)' }}>Référence</span></span>
              </div>
            </div>
            {isLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats?.leads_by_day || []}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={25} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#009DDB" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Activité récente */}
          <div className="p-6 rounded-xl card-lift" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Activité récente</h3>
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
                <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucune activité</p>
              )}
            </div>
            <button onClick={() => void navigate({ to: '/leads' })}
              className="w-full mt-5 text-xs font-semibold py-2 rounded-lg transition cursor-pointer hover:bg-[var(--brand-tint)]"
              style={{ color: 'var(--brand-primary)' }}>
              Voir toute l'activité →
            </button>
          </div>
        </div>
    );
  }

  function DashboardPipelineDonut() {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Donut pipeline */}
          <div className="lg:col-span-2 p-6 rounded-xl card-lift" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-base font-semibold mb-4">Répartition pipeline</h3>
            {isLoading ? <Skeleton className="h-48 w-full" /> : pipelineData.length > 0 ? (
              <div className="flex items-center gap-8">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie data={pipelineData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" paddingAngle={3} strokeWidth={0}>
                      {pipelineData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px' }} />
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
            ) : <p className="text-sm text-[var(--text-muted)]">Aucune donnée pipeline</p>}
          </div>

          {/* Top sources */}
          {isVisible('top_sources') && (
          <div className="p-6 rounded-xl card-lift" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-base font-semibold mb-4">🔗 Top sources</h3>
            <div className="space-y-3">
              {sourceData.map(({ source, count, value }) => {
                const pct = sourceTotal > 0 ? Math.round((count / sourceTotal) * 100) : 0;
                const labels: Record<string, string> = { website: '🌐 Site web', facebook: '📘 Facebook', google: '🔍 Google', referral: '🤝 Référence', direct: '🔗 Direct', instagram: '📷 Instagram' };
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
              {sourceData.length === 0 && <p className="text-xs text-[var(--text-muted)]">Aucune donnée</p>}
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
              <h3 className="text-base font-semibold">Derniers contacts</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{recentLeads.length} contacts actifs cette semaine</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void navigate({ to: '/leads' })}
                className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer hover:bg-[var(--brand-tint)]"
                style={{ color: 'var(--brand-primary)' }}>
                Voir tout <ArrowRight size={14} />
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
                      <span className="truncate">{lead.source === 'website' ? 'Site web' : lead.source === 'facebook' ? 'Facebook' : lead.source || 'Direct'}</span>
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
                      {lead.source === 'website' ? 'Site web' : lead.source === 'facebook' ? 'Facebook Ads' : lead.source || 'Direct'}
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
    <div className="p-5 rounded-xl card-lift" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: iconBg }}>
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
        {delta && (
          <span className={`text-xs font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-md`}
            style={{
              background: deltaUp !== false ? 'var(--success-soft)' : 'var(--danger-soft)',
              color: deltaUp !== false ? 'var(--success)' : 'var(--danger)',
              fontVariantNumeric: 'tabular-nums',
            }}>
            {deltaUp !== false ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {delta}
          </span>
        )}
      </div>
      <div className="text-3xl font-bold tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      {sparkPath && (
        <svg className="w-full h-8 mt-3" viewBox="0 0 100 30" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`sg-${label.replace(/\s/g, '')}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={sparkColor} />
              <stop offset="1" stopColor={sparkColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath!} fill={`url(#sg-${label.replace(/\s/g, '')})`} opacity={0.2} />
          <path d={sparkPath} fill="none" stroke={sparkColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}
