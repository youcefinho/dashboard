// ── Page Dashboard — Vue globale ────────────────────────────

import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Badge, Skeleton } from '@/components/ui';
import { getDashboardStats, getLeads, getAppointments, getTasks } from '@/lib/api';
import {
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS,
  APPOINTMENT_TYPE_ICONS, APPOINTMENT_TYPE_LABELS, APPOINTMENT_STATUS_LABELS,
  type DashboardStats, type Lead, type LeadStatus, type Appointment,
} from '@/lib/types';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

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

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const [statsResult, leadsResult, apptsResult] = await Promise.all([
        getDashboardStats(),
        getLeads({}),
        getAppointments(),
      ]);
      if (statsResult.error) {
        setError(statsResult.error);
      } else if (statsResult.data) {
        setStats(statsResult.data);
      }
      if (leadsResult.data) {
        setAllLeads(leadsResult.data);
        setRecentLeads(leadsResult.data.slice(0, 8));
      }
      if (apptsResult.data) {
        // Filtrer les RDV d'aujourd'hui et à venir
        const today = new Date().toISOString().slice(0, 10);
        const upcoming = apptsResult.data
          .filter(a => a.start_time.slice(0, 10) >= today && a.status !== 'cancelled')
          .slice(0, 5);
        setTodayAppointments(upcoming);
      }
      // Tâches en retard
      getTasks().then(r => {
        if (r.data) setOverdueTasks(r.data.filter(t => t.status !== 'done' && new Date(t.due_date) < new Date()).length);
      }).catch(() => { /* ignoré */ });
      setIsLoading(false);
    }
    void load();
  }, []);

  // Temps relatif
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
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffH = Math.round(diffMs / 3600000);
    if (diffH < 0) return 'passé';
    if (diffH < 1) return 'bientôt';
    if (diffH < 24) return `dans ${diffH}h`;
    const diffD = Math.round(diffH / 24);
    return `dans ${diffD}j`;
  };

  if (error) {
    return (
      <AppLayout title="Dashboard">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <p className="text-[var(--color-danger)] mb-2">{error}</p>
            <button onClick={() => window.location.reload()} className="text-sm text-[var(--color-accent)] hover:underline cursor-pointer">
              Réessayer
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Calculs pipeline
  const totalPipelineValue = allLeads.reduce((s, l) => s + (l.deal_value || 0), 0);
  const hotLeads = allLeads.filter(l => l.score >= 70 && l.status !== 'closed' && l.status !== 'lost').length;
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const periodLeads = allLeads.filter(l => {
    const age = (Date.now() - new Date(l.created_at).getTime()) / 86400000;
    return age <= periodDays;
  });

  return (
    <AppLayout title="Dashboard">
      {/* Sélecteur de période */}
      <div className="flex items-center justify-between mb-4">
        <div />
        <div className="flex gap-1">
          {(['7d', '30d', '90d'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs rounded-full cursor-pointer transition-colors ${period === p ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}>
              {p === '7d' ? '7 jours' : p === '30d' ? '30 jours' : '90 jours'}
            </button>
          ))}
        </div>
      </div>
      {/* Cartes de stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><Skeleton className="h-20 w-full" /></Card>
          ))
        ) : (
          <>
            <StatCard label="Total Leads" value={stats?.total_leads ?? 0} color="var(--color-accent)" icon="📊" />
            <StatCard label="Nouveaux (7j)" value={stats?.new_leads_7d ?? 0} color="var(--color-info)" icon="🆕" />
            <StatCard label="En attente" value={stats?.pending_leads ?? 0} color="var(--color-warning)" icon="⏳" />
            <StatCard label="Conversion" value={`${stats?.conversion_rate ?? 0}%`} color="var(--color-danger)" icon="🎯" />
          </>
        )}
      </div>

      {/* Widgets secondaires */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card className="p-3 text-center cursor-pointer hover:border-[var(--color-accent)] transition-colors" onClick={() => void navigate({ to: '/pipeline' })}>
          <p className="text-lg font-bold text-[var(--color-accent)]">{totalPipelineValue.toLocaleString('fr-CA')} $</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">💰 Pipeline</p>
        </Card>
        <Card className="p-3 text-center cursor-pointer hover:border-[var(--color-accent)] transition-colors" onClick={() => void navigate({ to: '/leads' })}>
          <p className="text-lg font-bold text-[var(--color-danger)]">{hotLeads}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">🔥 Leads chauds</p>
        </Card>
        <Card className="p-3 text-center cursor-pointer hover:border-[var(--color-accent)] transition-colors" onClick={() => void navigate({ to: '/tasks' })}>
          <p className="text-lg font-bold text-[var(--color-warning)]">{overdueTasks}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">⚠️ Tâches retard</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-lg font-bold text-[var(--color-info)]">{periodLeads.length}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">📈 Période {period}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Graphique leads par jour — prend 2 colonnes */}
        <Card className="p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-4 text-[var(--color-text-secondary)]">Leads — 30 derniers jours</h3>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={stats?.leads_by_day || []}>
                <defs>
                  <linearGradient id="gradient-leads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'oklch(0.45 0 0)' }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: 'oklch(0.45 0 0)' }} width={30} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'oklch(0.19 0.015 260)', border: '1px solid oklch(0.28 0.015 260)', borderRadius: '8px', fontSize: '12px', color: 'oklch(0.95 0 0)' }}
                  labelFormatter={(v) => `Date : ${String(v)}`}
                />
                <Area type="monotone" dataKey="count" stroke="oklch(0.72 0.19 160)" fill="url(#gradient-leads)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Répartition par statut — 1 colonne */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-4 text-[var(--color-text-secondary)]">Par statut</h3>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={(stats?.leads_by_status || []).map(s => ({ ...s, label: STATUS_LABELS[s.status as LeadStatus] || s.status }))}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'oklch(0.45 0 0)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'oklch(0.45 0 0)' }} width={25} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'oklch(0.19 0.015 260)', border: '1px solid oklch(0.28 0.015 260)', borderRadius: '8px', fontSize: '12px', color: 'oklch(0.95 0 0)' }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {(stats?.leads_by_status || []).map((_, i) => (
                    <Cell key={i} fill={['oklch(0.72 0.19 160)', 'oklch(0.70 0.15 240)', 'oklch(0.78 0.15 80)', 'oklch(0.72 0.19 160)', 'oklch(0.50 0.02 260)', 'oklch(0.65 0.22 25)'][i % 6] as string} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Derniers leads — 2 colonnes */}
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Derniers leads</h3>
            <button
              onClick={() => void navigate({ to: '/leads' })}
              className="text-xs text-[var(--color-accent)] hover:underline cursor-pointer"
            >
              Voir tout →
            </button>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : recentLeads.length > 0 ? (
            <div className="space-y-1">
              {recentLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer group"
                  onClick={() => void navigate({ to: `/leads/${lead.id}` })}
                >
                  {/* Avatar initiale */}
                  <div className="w-8 h-8 rounded-full bg-[var(--color-bg-hover)] group-hover:bg-[var(--color-bg-card)] flex items-center justify-center text-xs font-bold text-[var(--color-accent)] shrink-0">
                    {lead.name.charAt(0).toUpperCase()}
                  </div>
                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{lead.name}</p>
                      <Badge color={STATUS_COLORS[lead.status]}>
                        {STATUS_LABELS[lead.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] truncate">
                      {lead.client_name || lead.client_id} · {TYPE_LABELS[lead.type]}
                    </p>
                  </div>
                  {/* Temps */}
                  <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap shrink-0">
                    {timeAgo(lead.created_at)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-8">Aucun lead pour le moment</p>
          )}
        </Card>

        {/* RDV à venir — 1 colonne */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">📅 RDV à venir</h3>
            <button
              onClick={() => void navigate({ to: '/calendar' })}
              className="text-xs text-[var(--color-accent)] hover:underline cursor-pointer"
            >
              Calendrier →
            </button>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : todayAppointments.length > 0 ? (
            <div className="space-y-2">
              {todayAppointments.map((appt) => (
                <div key={appt.id} className="p-3 bg-[var(--color-bg-tertiary)] rounded-[var(--radius-md)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
                  onClick={() => void navigate({ to: '/calendar' })}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{APPOINTMENT_TYPE_ICONS[appt.type]}</span>
                    <p className="text-xs font-semibold truncate flex-1">{appt.title}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {APPOINTMENT_TYPE_LABELS[appt.type]} · {formatTime(appt.start_time)}
                    </p>
                    <Badge color={
                      appt.status === 'confirmed' ? 'var(--color-success)' :
                      appt.status === 'cancelled' ? 'var(--color-danger)' : 'var(--color-muted)'
                    }>
                      {APPOINTMENT_STATUS_LABELS[appt.status]}
                    </Badge>
                  </div>
                  {appt.lead_name && (
                    <p className="text-[10px] text-[var(--color-accent)] mt-1">👤 {appt.lead_name} · {timeUntil(appt.start_time)}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-2xl mb-2">📅</p>
              <p className="text-xs text-[var(--color-text-muted)]">Aucun RDV prévu</p>
            </div>
          )}
        </Card>
      </div>

      {/* Leads par client */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Leads par client</h3>
          <button
            onClick={() => void navigate({ to: '/clients' })}
            className="text-xs text-[var(--color-accent)] hover:underline cursor-pointer"
          >
            Voir clients →
          </button>
        </div>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : stats?.leads_by_client && stats.leads_by_client.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {stats.leads_by_client.map((c, i) => {
              const max = Math.max(...stats.leads_by_client.map(x => x.count), 1);
              const pct = (c.count / max) * 100;
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center text-xs font-bold text-[var(--color-accent)] shrink-0">
                    {c.client_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate mb-1">{c.client_name}</p>
                    <div className="h-2 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: 'var(--color-accent)' }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-bold w-8 text-right">{c.count}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">Aucun client ajouté pour le moment</p>
        )}
      </Card>
    </AppLayout>
  );
}

// ── Composant StatCard ──────────────────────────────────────

function StatCard({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: string }) {
  return (
    <Card className="p-4 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
      {/* Ligne décorative en bas */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: color, opacity: 0.3 }} />
    </Card>
  );
}
