// ── ReportsPage — Refonte Sprint 8 (Phase B) ──────────

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Badge, Skeleton, Button } from '@/components/ui';
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

type ReportTab = 'sales' | 'funnel' | 'sources' | 'performance' | 'trends' | 'activity' | 'workflow' | 'email' | 'sms' | 'calendar' | 'forms' | 'reviews';

const TABS: { id: ReportTab; icon: typeof BarChart3; label: string; group: string }[] = [
  { id: 'sales', icon: DollarSign, label: 'Ventes & ROI', group: 'BUSINESS' },
  { id: 'funnel', icon: BarChart3, label: 'Funnel', group: 'BUSINESS' },
  { id: 'sources', icon: Target, label: 'Sources', group: 'BUSINESS' },
  { id: 'trends', icon: TrendingUp, label: 'Tendances', group: 'BUSINESS' },
  { id: 'performance', icon: Trophy, label: 'Sous-comptes', group: 'AGENCE' },
  { id: 'activity', icon: Activity, label: 'Activité', group: 'ÉQUIPE' },
  { id: 'calendar', icon: CalendarIcon, label: 'Rendez-vous', group: 'ÉQUIPE' },
  { id: 'workflow', icon: Workflow, label: 'Workflows', group: 'MARKETING' },
  { id: 'email', icon: Mail, label: 'Emails', group: 'MARKETING' },
  { id: 'sms', icon: MessageSquare, label: 'SMS', group: 'MARKETING' },
  { id: 'forms', icon: CheckSquare, label: 'Formulaires', group: 'MARKETING' },
  { id: 'reviews', icon: Star, label: 'Réputation', group: 'MARKETING' },
];

export function ReportsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ReportTab>('funnel');
  
  // Customization & Filters
  const [period, setPeriod] = useState<'30d' | '90d' | '12m'>('30d');
  const [isExporting, setIsExporting] = useState(false);
  const [comparePeriod, setComparePeriod] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [leadsRes, clientsRes] = await Promise.all([getLeads(), getClients()]);
    if (leadsRes.data) setLeads(leadsRes.data);
    if (clientsRes.data) setClients(clientsRes.data);
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Actions Customization ───────────────────────────────
  const handleExportPDF = () => {
    setIsExporting(true);
    setTimeout(() => {
      window.print();
      setIsExporting(false);
    }, 500);
  };

  const handleSaveReport = async () => {
    try {
      const res = await fetch('/api/reports/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Rapport ${activeTab}`, type: activeTab, config_json: { period, comparePeriod } })
      });
      if (res.ok) alert('Rapport sauvegardé avec succès !');
    } catch (e) {
      console.error(e);
    }
  };

  // ── Calculs ──────────────────────────────────────────────
  const totalLeads = leads.length;
  const statusCounts: Record<string, number> = {};
  leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });

  const sourceCounts: Record<string, number> = {};
  leads.forEach(l => { sourceCounts[l.source || 'direct'] = (sourceCounts[l.source || 'direct'] || 0) + 1; });

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
    const weekLabel = weekStart.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
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
      <AppLayout title="Rapports d'Analyse">
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </AppLayout>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
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
          return { name: SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] || source, cac, spend, wonLeads };
        });

        return (
          <SalesReports>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><DollarSign size={16} className="text-[var(--success)]" /> Revenus par Source (ROI)</h3>
                {revenueData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={revenueData} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={(val) => `${val/1000}k $`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={80} />
                    <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }} formatter={(val) => `${val} $`} />
                    <Bar dataKey="revenue" fill="var(--success)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                ) : <p className="text-xs text-[var(--text-muted)] text-center py-10">Aucun revenu pour la période</p>}
              </Card>
              
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Target size={16} className="text-[var(--brand-primary)]" /> Coût d'Acquisition (CAC) estimé</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
                        <th className="pb-2 font-medium">Source</th>
                        <th className="pb-2 font-medium text-right">Dépenses</th>
                        <th className="pb-2 font-medium text-center">Gagnés</th>
                        <th className="pb-2 font-medium text-right">CAC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cacData.map(d => (
                        <tr key={d.name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td className="py-3 font-medium">{d.name}</td>
                          <td className="py-3 text-right" style={{ color: 'var(--danger)' }}>{d.spend} $</td>
                          <td className="py-3 text-center">{d.wonLeads}</td>
                          <td className="py-3 text-right font-semibold" style={{ color: 'var(--brand-primary)' }}>{d.cac} $</td>
                        </tr>
                      ))}
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
                  <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }} />
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
              <h3 className="text-sm font-semibold mb-4">📋 Répartition par type</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={[{ name: 'Entrants', value: typeCounts.inbound }, { name: 'Clients', value: typeCounts.customer }]}
                    cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, percent }: any) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    <Cell fill="var(--brand-primary)" />
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
              <h3 className="text-sm font-semibold mb-4">📊 Détail par source</h3>
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
                  <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="total" name="Total leads" fill="var(--brand-primary)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="won" name="Gagnés" fill="var(--success)" radius={[0, 4, 4, 0]} />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-5">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="text-left py-2 text-xs text-[var(--text-muted)]">Sous-compte</th>
                      <th className="text-right py-2 text-xs text-[var(--text-muted)]">Leads</th>
                      <th className="text-right py-2 text-xs text-[var(--text-muted)]">Gagnés</th>
                      <th className="text-right py-2 text-xs text-[var(--text-muted)]">Conv.</th>
                      <th className="text-right py-2 text-xs text-[var(--text-muted)]">Pipeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(clientCounts).sort((a, b) => b.total - a.total).map((data, i) => {
                        const conv = data.total > 0 ? Math.round((data.won / data.total) * 100) : 0;
                        return (
                          <tr key={i} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]">
                            <td className="py-2 font-medium">{data.name}</td>
                            <td className="py-2 text-right">{data.total}</td>
                            <td className="py-2 text-right text-[var(--success)]">{data.won}</td>
                            <td className="py-2 text-right"><Badge color={conv > 20 ? 'var(--success)' : 'var(--warning)'}>{conv}%</Badge></td>
                            <td className="py-2 text-right text-[var(--brand-primary)]">{data.value.toLocaleString('fr-CA')} $</td>
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
                      <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradient-signed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--success)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="leads" name="Leads" stroke="var(--brand-primary)" fill="url(#gradient-trend)" strokeWidth={2} />
                  <Area type="monotone" dataKey="won" name="Gagnés" stroke="var(--success)" fill="url(#gradient-signed)" strokeWidth={2} />
                  <Legend />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </TrendsReports>
      );
      case 'activity': return <ActivityReports />;
      case 'workflow': return <WorkflowReports />;
      case 'email': return <EmailReports />;
      case 'sms': return <SmsReports />;
      case 'calendar': return <CalendarReports />;
      case 'forms': return <FormsReports />;
      case 'reviews': return <ReviewsReports />;
      default: return null;
    }
  };

  return (
    <AppLayout title="Rapports d'Analyse">
      {/* Metrics Overview */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          {[
            { icon: Users, v: totalLeads, l: 'Total leads', c: 'var(--brand-primary)', bg: 'var(--brand-tint)' },
            { icon: Activity, v: leadsThisMonth, l: 'Ce mois', c: 'var(--success)', bg: 'var(--success-soft)' },
            { icon: Percent, v: `${conversionRate}%`, l: 'Conversion', c: 'var(--info)', bg: 'var(--info-soft)' },
            { icon: DollarSign, v: `${totalPipelineValue.toLocaleString('fr-CA')} $`, l: 'Pipeline', c: 'var(--warning)', bg: 'var(--warning-soft)' },
          ].map(s => (
            <div key={s.l} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: s.bg }}>
                <s.icon size={14} style={{ color: s.c }} />
              </div>
              <div>
                <p className="font-bold text-[var(--text-primary)]">{s.v}</p>
                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">{s.l}</p>
              </div>
            </div>
          ))}
        </div>
        
        {/* Customization Toolbar */}
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5 mr-2">
            {(['30d', '90d', '12m'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-[11px] rounded-md font-medium cursor-pointer transition-all
                  ${period === p ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                {p === '30d' ? '30j' : p === '90d' ? '90j' : '12 mois'}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setComparePeriod(!comparePeriod)} className={`text-xs gap-1.5 ${comparePeriod ? 'bg-[var(--brand-tint)] text-[var(--brand-primary)]' : ''}`}>
            <Presentation size={14} /> Comparer
          </Button>
          <Button variant="secondary" onClick={handleSaveReport} className="text-xs gap-1.5">
            <Save size={14} /> Sauvegarder
          </Button>
          <Button variant="primary" onClick={handleExportPDF} disabled={isExporting} className="text-xs gap-1.5">
            <Download size={14} /> {isExporting ? 'Export...' : 'Export PDF'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6 max-w-6xl">
        {/* Mobile tabs */}
        <div className="md:hidden w-full flex gap-1.5 overflow-x-auto pb-3 mb-2 -mx-1 px-1 no-scrollbar">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border whitespace-nowrap shrink-0 transition-all ${activeTab === tab.id ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)]'}`}>
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
                      ${activeTab === tab.id ? 'bg-[var(--brand-tint)] text-[var(--brand-primary)] font-medium shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'}`}>
                    <tab.icon size={16} /> {tab.label}
                  </button>
                ))}
              </div>
            ));
          })()}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 h-[calc(100vh-160px)] overflow-y-auto pb-10 pr-2">
          {renderContent()}
        </div>
      </div>
    </AppLayout>
  );
}
