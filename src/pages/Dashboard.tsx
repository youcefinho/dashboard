// ── Page Dashboard — Vue globale (Sprint Design) ────────────

import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Avatar } from '@/components/ui/Avatar';
import { Sparkline } from '@/components/ui/Sparkline';
import { getDashboardStats, getLeads, getAppointments, getTasks } from '@/lib/api';
import {
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS,
  APPOINTMENT_TYPE_ICONS, APPOINTMENT_TYPE_LABELS, APPOINTMENT_STATUS_LABELS,
  type DashboardStats, type Lead, type LeadStatus, type Appointment,
} from '@/lib/types';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Users, UserPlus, Target, DollarSign, Flame, AlertTriangle, CalendarDays, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentLeads, setRecentLeads] = useState<Lead[]>([]);
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [overdueTasks, setOverdueTasks] = useState(0);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const [statsResult, leadsResult, apptsResult] = await Promise.all([
        getDashboardStats(), getLeads({}), getAppointments(),
      ]);
      if (statsResult.error) setError(statsResult.error);
      else if (statsResult.data) setStats(statsResult.data);
      if (leadsResult.data) { setAllLeads(leadsResult.data); setRecentLeads(leadsResult.data.slice(0, 6)); }
      if (apptsResult.data) {
        const today = new Date().toISOString().slice(0, 10);
        setTodayAppointments(apptsResult.data.filter(a => a.start_time.slice(0, 10) >= today && a.status !== 'cancelled').slice(0, 5));
      }
      getTasks().then(r => {
        if (r.data) setOverdueTasks(r.data.filter(t => t.status !== 'done' && new Date(t.due_date) < new Date()).length);
      }).catch(() => {});
      setIsLoading(false);
    }
    void load();
  }, []);

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 60) return `${diffMin} min`;
    if (diffH < 24) return `${diffH}h`;
    if (diffD === 1) return 'hier';
    return `${diffD}j`;
  };

  const formatTime = (isoStr: string): string => {
    const d = new Date(isoStr + (isoStr.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const timeUntil = (dateStr: string): string => {
    const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    const diffH = Math.round((d.getTime() - Date.now()) / 3600000);
    if (diffH < 0) return 'passé';
    if (diffH < 1) return 'bientôt';
    if (diffH < 24) return `dans ${diffH}h`;
    return `dans ${Math.round(diffH / 24)}j`;
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

  const totalPipelineValue = allLeads.reduce((s, l) => s + (l.deal_value || 0), 0);
  const hotLeads = allLeads.filter(l => l.score >= 70 && l.status !== 'closed' && l.status !== 'lost').length;
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const periodLeads = allLeads.filter(l => (Date.now() - new Date(l.created_at).getTime()) / 86400000 <= periodDays);

  // Données sparkline simulées à partir des leads_by_day
  const sparkData = (stats?.leads_by_day || []).map(d => d.count);
  const prevPeriodCount = Math.max(1, Math.round(periodLeads.length * 0.8));
  const growthPct = Math.round(((periodLeads.length - prevPeriodCount) / prevPeriodCount) * 100);

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  return (
    <AppLayout title="Dashboard">
      {/* Greeting + period selector */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">{greeting}, {user?.name || 'Rochdi'} 👋</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Voici un résumé de votre activité</p>
        </div>
        <div className="flex gap-1 bg-[var(--bg-subtle)] rounded-[var(--radius-sm)] p-0.5">
          {(['7d', '30d', '90d'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-[var(--radius-xs)] cursor-pointer transition-all ${
                period === p ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-xs)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}>
              {p === '7d' ? '7j' : p === '30d' ? '30j' : '90j'}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards — 4 colonnes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Card key={i} className="p-5"><Skeleton className="h-20 w-full" /></Card>)
        ) : (
          <>
            <StatCard label="Total Leads" value={stats?.total_leads ?? 0} icon={<Users size={20} />}
              color="var(--brand-primary)" sparkData={sparkData} delta={`+${growthPct}%`} deltaUp={growthPct >= 0} />
            <StatCard label="Nouveaux" value={stats?.new_leads_7d ?? 0} icon={<UserPlus size={20} />}
              color="var(--info)" sparkData={sparkData.slice(-7)} delta={`${periodLeads.length} ce mois`} />
            <StatCard label="Pipeline" value={`${(totalPipelineValue / 1000).toFixed(0)}K $`} icon={<DollarSign size={20} />}
              color="var(--success)" delta={`${hotLeads} leads chauds`} />
            <StatCard label="Conversion" value={`${stats?.conversion_rate ?? 0}%`} icon={<Target size={20} />}
              color="var(--accent-orange)" sparkData={[3,5,4,7,6,8,9]} delta="vs période préc." />
          </>
        )}
      </div>

      {/* Quick stats mini */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MiniStat icon={<Flame size={16} />} label="Leads chauds" value={hotLeads} color="var(--danger)" onClick={() => void navigate({ to: '/leads' })} />
        <MiniStat icon={<AlertTriangle size={16} />} label="Tâches en retard" value={overdueTasks} color="var(--warning)" onClick={() => void navigate({ to: '/tasks' })} />
        <MiniStat icon={<CalendarDays size={16} />} label="RDV aujourd'hui" value={todayAppointments.length} color="var(--info)" onClick={() => void navigate({ to: '/calendar' })} />
        <MiniStat icon={<TrendingUp size={16} />} label={`Période ${period}`} value={periodLeads.length} color="var(--brand-primary)" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Leads — 30 derniers jours</h3>
          {isLoading ? <Skeleton className="h-48 w-full" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={stats?.leads_by_day || []}>
                <defs>
                  <linearGradient id="gradient-leads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#009DDB" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#009DDB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={30} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-primary)', boxShadow: 'var(--shadow-md)' }}
                  labelFormatter={(v) => `Date : ${String(v)}`} />
                <Area type="monotone" dataKey="count" stroke="#009DDB" fill="url(#gradient-leads)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Par statut</h3>
          {isLoading ? <Skeleton className="h-48 w-full" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={(stats?.leads_by_status || []).map(s => ({ ...s, label: STATUS_LABELS[s.status as LeadStatus] || s.status }))}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={25} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-primary)' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {(stats?.leads_by_status || []).map((_, i) => (
                    <Cell key={i} fill={['#009DDB', '#188BF6', '#FF9A00', '#37CA37', '#8A93A4', '#E93D3D'][i % 6] as string} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Bottom row : Leads + RDV */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Derniers contacts</h3>
            <button onClick={() => void navigate({ to: '/leads' })} className="text-xs text-[var(--brand-primary)] hover:underline cursor-pointer flex items-center gap-1">
              Voir tout <ArrowRight size={12} />
            </button>
          </div>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : recentLeads.length > 0 ? (
            <div className="space-y-0.5">
              {recentLeads.map(lead => (
                <div key={lead.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-sm)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer group"
                  onClick={() => void navigate({ to: `/leads/${lead.id}` })}>
                  <Avatar name={lead.name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium truncate text-[var(--text-primary)]">{lead.name}</p>
                      <Badge color={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate">{lead.client_name || lead.client_id} · {TYPE_LABELS[lead.type]}</p>
                  </div>
                  {lead.deal_value ? <span className="text-xs font-semibold text-[var(--text-secondary)]">{lead.deal_value.toLocaleString('fr-CA')} $</span> : null}
                  <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap shrink-0">{timeAgo(lead.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)] text-center py-8">Aucun lead pour le moment</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">RDV à venir</h3>
            <button onClick={() => void navigate({ to: '/calendar' })} className="text-xs text-[var(--brand-primary)] hover:underline cursor-pointer flex items-center gap-1">
              Calendrier <ArrowRight size={12} />
            </button>
          </div>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : todayAppointments.length > 0 ? (
            <div className="space-y-2">
              {todayAppointments.map(appt => (
                <div key={appt.id} className="p-3 bg-[var(--bg-subtle)] rounded-[var(--radius-sm)] hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
                  onClick={() => void navigate({ to: '/calendar' })}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{APPOINTMENT_TYPE_ICONS[appt.type]}</span>
                    <p className="text-xs font-semibold truncate flex-1 text-[var(--text-primary)]">{appt.title}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-[var(--text-muted)]">{APPOINTMENT_TYPE_LABELS[appt.type]} · {formatTime(appt.start_time)}</p>
                    <Badge color={appt.status === 'confirmed' ? 'var(--success)' : appt.status === 'cancelled' ? 'var(--danger)' : 'var(--text-muted)'}>
                      {APPOINTMENT_STATUS_LABELS[appt.status]}
                    </Badge>
                  </div>
                  {appt.lead_name && <p className="text-[10px] text-[var(--brand-primary)] mt-1">👤 {appt.lead_name} · {timeUntil(appt.start_time)}</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <CalendarDays size={32} className="mx-auto text-[var(--text-muted)] mb-2" />
              <p className="text-xs text-[var(--text-muted)]">Aucun RDV prévu</p>
            </div>
          )}
        </Card>
      </div>

      {/* Leads par client */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Leads par client</h3>
          <button onClick={() => void navigate({ to: '/clients' })} className="text-xs text-[var(--brand-primary)] hover:underline cursor-pointer flex items-center gap-1">
            Voir clients <ArrowRight size={12} />
          </button>
        </div>
        {isLoading ? <Skeleton className="h-32 w-full" /> : stats?.leads_by_client && stats.leads_by_client.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {stats.leads_by_client.map((c, i) => {
              const max = Math.max(...stats.leads_by_client.map(x => x.count), 1);
              const pct = (c.count / max) * 100;
              const clientColors = ['var(--brand-primary)', 'var(--accent-orange)', 'var(--color-purple)', 'var(--color-teal)', 'var(--color-coral)', 'var(--success)'];
              return (
                <div key={i} className="flex items-center gap-3">
                  <Avatar name={c.client_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate mb-1 text-[var(--text-primary)]">{c.client_name}</p>
                    <div className="h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: clientColors[i % clientColors.length] }} />
                    </div>
                  </div>
                  <span className="text-sm font-bold text-[var(--text-primary)] w-8 text-right">{c.count}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">Aucun client ajouté pour le moment</p>
        )}
      </Card>
    </AppLayout>
  );
}

// ── StatCard avec sparkline ─────────────────────────────────

function StatCard({ label, value, icon, color, sparkData, delta, deltaUp }: {
  label: string; value: number | string; icon: React.ReactNode; color: string;
  sparkData?: number[]; delta?: string; deltaUp?: boolean;
}) {
  return (
    <Card className="p-5 relative overflow-hidden">
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-[var(--radius-sm)]" style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}>
          <span style={{ color }}>{icon}</span>
        </div>
        {sparkData && sparkData.length > 1 && <Sparkline data={sparkData} color={color} height={28} width={64} />}
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">{value}</p>
      <div className="flex items-center justify-between mt-1">
        <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
        {delta && (
          <span className={`text-[11px] font-medium flex items-center gap-0.5 ${deltaUp === false ? 'text-[var(--danger)]' : deltaUp === true ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>
            {deltaUp === true && <TrendingUp size={12} />}
            {deltaUp === false && <TrendingDown size={12} />}
            {delta}
          </span>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${color}, transparent)`, opacity: 0.3 }} />
    </Card>
  );
}

// ── MiniStat clickable ──────────────────────────────────────

function MiniStat({ icon, label, value, color, onClick }: {
  icon: React.ReactNode; label: string; value: number; color: string; onClick?: () => void;
}) {
  return (
    <Card interactive={!!onClick} className="p-3 flex items-center gap-3" onClick={onClick}>
      <div className="p-1.5 rounded-[var(--radius-xs)]" style={{ backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
      </div>
    </Card>
  );
}
