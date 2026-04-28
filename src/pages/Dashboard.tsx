// ── Page Dashboard — Vue globale ────────────────────────────

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Skeleton } from '@/components/ui';
import { getDashboardStats } from '@/lib/api';
import { STATUS_LABELS, type DashboardStats, type LeadStatus } from '@/lib/types';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

const STAT_COLORS = ['var(--color-accent)', 'var(--color-info)', 'var(--color-warning)', 'var(--color-danger)'];

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const result = await getDashboardStats();
      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setStats(result.data);
      }
      setIsLoading(false);
    }
    void load();
  }, []);

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

  return (
    <AppLayout title="Dashboard">
      {/* Cartes de stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><Skeleton className="h-20 w-full" /></Card>
          ))
        ) : (
          <>
            <StatCard label="Total Leads" value={stats?.total_leads ?? 0} color={STAT_COLORS[0] as string} icon="📊" />
            <StatCard label="Nouveaux (7j)" value={stats?.new_leads_7d ?? 0} color={STAT_COLORS[1] as string} icon="🆕" />
            <StatCard label="En attente" value={stats?.pending_leads ?? 0} color={STAT_COLORS[2] as string} icon="⏳" />
            <StatCard label="Conversion" value={`${stats?.conversion_rate ?? 0}%`} color={STAT_COLORS[3] as string} icon="🎯" />
          </>
        )}
      </div>

      {/* Graphiques */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Leads par jour */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-4 text-[var(--color-text-secondary)]">Leads — 30 derniers jours</h3>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={stats?.leads_by_day || []}>
                <defs>
                  <linearGradient id="gradient-leads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'oklch(0.45 0 0)' }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: 'oklch(0.45 0 0)' }} width={30} />
                <Tooltip
                  contentStyle={{ background: 'oklch(0.19 0.015 260)', border: '1px solid oklch(0.28 0.015 260)', borderRadius: '8px', fontSize: '12px', color: 'oklch(0.95 0 0)' }}
                  labelFormatter={(v) => `Date : ${String(v)}`}
                />
                <Area type="monotone" dataKey="count" stroke="oklch(0.72 0.19 160)" fill="url(#gradient-leads)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Leads par statut */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-4 text-[var(--color-text-secondary)]">Répartition par statut</h3>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={(stats?.leads_by_status || []).map(s => ({ ...s, label: STATUS_LABELS[s.status as LeadStatus] || s.status }))}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'oklch(0.45 0 0)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'oklch(0.45 0 0)' }} width={30} />
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

      {/* Leads par client */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-4 text-[var(--color-text-secondary)]">Leads par client</h3>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : stats?.leads_by_client && stats.leads_by_client.length > 0 ? (
          <div className="space-y-3">
            {stats.leads_by_client.map((c, i) => {
              const max = Math.max(...stats.leads_by_client.map(x => x.count), 1);
              const pct = (c.count / max) * 100;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm w-32 truncate text-[var(--color-text-secondary)]">{c.client_name}</span>
                  <div className="flex-1 h-6 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: 'var(--color-accent)' }}
                    />
                  </div>
                  <span className="text-sm font-semibold w-10 text-right">{c.count}</span>
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
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </Card>
  );
}
