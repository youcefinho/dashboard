// ── ReportsPage — Analytics avancés avec Recharts ───────────

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Badge, Skeleton } from '@/components/ui';
import { getLeads, getClients } from '@/lib/api';
import type { Lead, Client } from '@/lib/types';
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/types';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from 'recharts';

type ReportTab = 'funnel' | 'sources' | 'performance' | 'trends';

export function ReportsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ReportTab>('funnel');
  const [period, setPeriod] = useState<'30d' | '90d' | '12m'>('30d');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [leadsRes, clientsRes] = await Promise.all([getLeads(), getClients()]);
    if (leadsRes.data) setLeads(leadsRes.data);
    if (clientsRes.data) setClients(clientsRes.data);
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Calculs ──────────────────────────────────────────────
  const totalLeads = leads.length;
  const statusCounts: Record<string, number> = {};
  leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });

  const sourceCounts: Record<string, number> = {};
  leads.forEach(l => { sourceCounts[l.source || 'direct'] = (sourceCounts[l.source || 'direct'] || 0) + 1; });

  const typeCounts = { buy: 0, sell: 0 };
  leads.forEach(l => { if (l.type === 'buy') typeCounts.buy++; if (l.type === 'sell') typeCounts.sell++; });

  const clientCounts: Record<string, { total: number; signed: number; name: string; value: number }> = {};
  leads.forEach(l => {
    if (!clientCounts[l.client_id]) {
      const client = clients.find(c => c.id === l.client_id);
      clientCounts[l.client_id] = { total: 0, signed: 0, name: client?.name || l.client_id, value: 0 };
    }
    const e = clientCounts[l.client_id];
    if (e) { e.total++; if (l.status === 'signed') e.signed++; e.value += l.deal_value || 0; }
  });

  const funnelStages = ['new', 'contacted', 'meeting', 'signed'];
  const funnelData = funnelStages.map(s => ({
    name: STATUS_LABELS[s as keyof typeof STATUS_LABELS] || s,
    count: statusCounts[s] || 0,
    fill: STATUS_COLORS[s as keyof typeof STATUS_COLORS] || '#888',
  }));

  const conversionRate = totalLeads > 0 ? Math.round(((statusCounts['signed'] || 0) / totalLeads) * 100) : 0;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const leadsThisMonth = leads.filter(l => l.created_at.slice(0, 7) === thisMonth).length;
  const totalPipelineValue = leads.reduce((s, l) => s + (l.deal_value || 0), 0);
  const avgScore = totalLeads > 0 ? Math.round(leads.reduce((s, l) => s + l.score, 0) / totalLeads) : 0;

  // Source data pour PieChart
  const sourceData = Object.entries(sourceCounts).map(([source, count]) => ({
    name: source, value: count,
  }));
  const SOURCE_PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  // Tendances — leads par semaine
  const trendData: { week: string; leads: number; signed: number }[] = [];
  const periodDays = period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const now = Date.now();
  for (let i = periodDays; i >= 0; i -= 7) {
    const weekStart = new Date(now - i * 86400000);
    const weekEnd = new Date(now - (i - 7) * 86400000);
    const weekLabel = weekStart.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
    const weekLeads = leads.filter(l => {
      const t = new Date(l.created_at).getTime();
      return t >= weekStart.getTime() && t < weekEnd.getTime();
    });
    trendData.push({
      week: weekLabel,
      leads: weekLeads.length,
      signed: weekLeads.filter(l => l.status === 'signed').length,
    });
  }

  const tabs: { id: ReportTab; label: string; icon: string }[] = [
    { id: 'funnel', label: 'Funnel', icon: '📊' },
    { id: 'sources', label: 'Sources', icon: '🎯' },
    { id: 'performance', label: 'Courtiers', icon: '🏆' },
    { id: 'trends', label: 'Tendances', icon: '📈' },
  ];

  if (isLoading) {
    return (
      <AppLayout title="Rapports">
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Rapports">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">📈 Rapports</h1>
          <Badge>{totalLeads} leads</Badge>
          <Badge color="var(--color-success)">{conversionRate}% conversion</Badge>
        </div>
        <div className="flex gap-1">
          {(['30d', '90d', '12m'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs rounded-full cursor-pointer transition-colors ${period === p ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]'}`}>
              {p === '30d' ? '30j' : p === '90d' ? '90j' : '12 mois'}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-accent)]">{totalLeads}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Total leads</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-success)]">{leadsThisMonth}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Ce mois</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-info)]">{conversionRate}%</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Conversion</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-warning)]">{totalPipelineValue.toLocaleString('fr-CA')} $</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Pipeline</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-accent)]">{avgScore}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Score moyen</p>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex bg-[var(--color-bg-tertiary)] rounded-[var(--radius-md)] p-0.5 mb-6">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-4 py-2 text-sm rounded-[var(--radius-sm)] cursor-pointer transition-colors ${
              activeTab === tab.id ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Funnel avec BarChart ──────────────────── */}
      {activeTab === 'funnel' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">📊 Funnel de conversion</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={funnelData} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={80} />
                <Tooltip contentStyle={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {funnelData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-[var(--color-text-muted)] mt-2 text-center">
              Perdus : {statusCounts['lost'] || 0} · Fermés : {statusCounts['closed'] || 0}
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">📋 Répartition par type</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={[{ name: 'Acheteurs', value: typeCounts.buy }, { name: 'Vendeurs', value: typeCounts.sell }]}
                  cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  <Cell fill="var(--color-accent)" />
                  <Cell fill="var(--color-warning)" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* ── Sources avec PieChart ─────────────────── */}
      {activeTab === 'sources' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">🎯 Sources d'acquisition</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={sourceData} cx="50%" cy="50%" outerRadius={100} dataKey="value"
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  {sourceData.map((_, i) => (
                    <Cell key={i} fill={SOURCE_PIE_COLORS[i % SOURCE_PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">📊 Détail par source</h3>
            <div className="space-y-3">
              {Object.entries(sourceCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([source, count], i) => {
                  const pct = Math.round((count / totalLeads) * 100);
                  return (
                    <div key={source} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: SOURCE_PIE_COLORS[i % SOURCE_PIE_COLORS.length] }} />
                      <span className="text-xs font-medium w-20 capitalize">{source}</span>
                      <div className="flex-1 h-6 bg-[var(--color-bg-hover)] rounded overflow-hidden">
                        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: SOURCE_PIE_COLORS[i % SOURCE_PIE_COLORS.length], opacity: 0.7 }} />
                      </div>
                      <span className="text-xs font-bold w-16 text-right">{count} ({pct}%)</span>
                    </div>
                  );
                })}
            </div>
          </Card>
        </div>
      )}

      {/* ── Performance par courtier ────────────── */}
      {activeTab === 'performance' && (
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">🏆 Performance par courtier</h3>
            <ResponsiveContainer width="100%" height={Math.max(200, Object.keys(clientCounts).length * 60)}>
              <BarChart data={Object.values(clientCounts).sort((a, b) => b.total - a.total)} layout="vertical" margin={{ left: 30 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={120} />
                <Tooltip contentStyle={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="total" name="Total leads" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="signed" name="Signés" fill="var(--color-success)" radius={[0, 4, 4, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Tableau de classement */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3">📊 Classement</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left py-2 text-xs text-[var(--color-text-muted)]">#</th>
                    <th className="text-left py-2 text-xs text-[var(--color-text-muted)]">Courtier</th>
                    <th className="text-right py-2 text-xs text-[var(--color-text-muted)]">Leads</th>
                    <th className="text-right py-2 text-xs text-[var(--color-text-muted)]">Signés</th>
                    <th className="text-right py-2 text-xs text-[var(--color-text-muted)]">Conv.</th>
                    <th className="text-right py-2 text-xs text-[var(--color-text-muted)]">Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(clientCounts)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([, data], i) => {
                      const conv = data.total > 0 ? Math.round((data.signed / data.total) * 100) : 0;
                      return (
                        <tr key={i} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]">
                          <td className="py-2 text-xs">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                          <td className="py-2 font-medium">{data.name}</td>
                          <td className="py-2 text-right">{data.total}</td>
                          <td className="py-2 text-right text-[var(--color-success)]">{data.signed}</td>
                          <td className="py-2 text-right">
                            <Badge color={conv > 20 ? 'var(--color-success)' : 'var(--color-warning)'}>{conv}%</Badge>
                          </td>
                          <td className="py-2 text-right text-[var(--color-accent)]">{data.value.toLocaleString('fr-CA')} $</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── Tendances ────────────────────────────── */}
      {activeTab === 'trends' && (
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">📈 Tendance des leads ({period === '30d' ? '30 jours' : period === '90d' ? '90 jours' : '12 mois'})</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="gradient-trend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradient-signed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} width={30} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="leads" name="Leads" stroke="var(--color-accent)" fill="url(#gradient-trend)" strokeWidth={2} />
                <Area type="monotone" dataKey="signed" name="Signés" stroke="var(--color-success)" fill="url(#gradient-signed)" strokeWidth={2} />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4 text-center">
              <p className="text-xl font-bold text-[var(--color-accent)]">{clients.length}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Courtiers actifs</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-xl font-bold text-[var(--color-success)]">
                {totalLeads > 0 ? Math.round(totalLeads / Math.max(clients.length, 1)) : 0}
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">Leads / courtier</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-xl font-bold text-[var(--color-info)]">{Object.values(sourceCounts).length}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Sources actives</p>
            </Card>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
