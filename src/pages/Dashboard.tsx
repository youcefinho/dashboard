// ── Page Dashboard — Vue globale (Sprint Design v2 — Maquette) ──

import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Skeleton } from '@/components/ui/Skeleton';
import { getDashboardStats, getLeads, getClients } from '@/lib/api';
import {
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS,
  type DashboardStats, type Lead, type Client,
} from '@/lib/types';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import {
  TrendingUp, TrendingDown, Users, Target, DollarSign, Zap,
  Download, ArrowRight, Filter,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

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
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const [statsR, leadsR, clientsR] = await Promise.all([
        getDashboardStats(), getLeads({}), getClients(),
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

  const totalPipelineValue = allLeads.reduce((s, l) => s + (l.deal_value || 0), 0);
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const periodLeads = allLeads.filter(l => (Date.now() - new Date(l.created_at).getTime()) / 86400000 <= periodDays);
  const prevCount = Math.max(1, Math.round(periodLeads.length * 0.8));
  const growthPct = Math.round(((periodLeads.length - prevCount) / prevCount) * 100);

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
              <button className="h-9 px-3 rounded-lg text-sm font-medium flex items-center gap-2 transition hover:bg-[var(--bg-subtle)] cursor-pointer"
                style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                <Download size={16} /> Exporter
              </button>
            </div>
          </div>
        </div>

        {/* ═══ 4 Stat cards (maquette : icône carrée + sparkline + delta badge) ═══ */}
        <div className="grid grid-cols-4 gap-4 mb-6">
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
                delta={`+${growthPct}%`} deltaUp sparkColor="#009DDB" sparkData={sparkPts} />
              <StatCardMockup label="Pipeline value" value={`${(totalPipelineValue / 1000).toFixed(0)}K $`}
                icon={<DollarSign size={20} />} iconBg="var(--success-soft)" iconColor="var(--success)"
                delta="+28.3%" deltaUp sparkColor="#37CA37" sparkData={sparkPts.slice(-7)} />
              <StatCardMockup label="Taux conversion" value={`${stats?.conversion_rate ?? 0}%`}
                icon={<Target size={20} />} iconBg="var(--accent-orange-soft)" iconColor="var(--accent-orange)"
                delta="-2.1%" deltaUp={false} sparkColor="#D96E27" sparkData={[8,10,7,12,9,15,12,18]} />
              <StatCardMockup label="Workflows actifs" value={periodLeads.length}
                icon={<Zap size={20} />} iconBg="var(--info-soft)" iconColor="var(--info)"
                delta="+18.0%" deltaUp sparkColor="#188BF6" sparkData={[20,18,15,16,10,12,7,5]} />
            </>
          )}
        </div>

        {/* ═══ Sub-accounts row (mini-cartes clients maquette) ═══ */}
        {!isLoading && clients.length > 0 && (
          <div className="grid grid-cols-6 gap-3 mb-6">
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
        )}

        {/* ═══ Grid 2/3 chart + 1/3 activité (maquette) ═══ */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* Chart stacked bar */}
          <div className="col-span-2 p-6 rounded-xl card-lift" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
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

          {/* Activité récente (maquette : Live badge) */}
          <div className="p-6 rounded-xl card-lift" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Activité récente</h3>
              <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                <span className="w-1.5 h-1.5 rounded-full pulse-live" style={{ background: 'var(--success)' }} />
                Live
              </span>
            </div>
            <div className="space-y-4">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
              ) : recentLeads.length > 0 ? (
                recentLeads.slice(0, 5).map((lead, i) => (
                  <div key={lead.id} className="flex gap-3 cursor-pointer" onClick={() => void navigate({ to: `/leads/${lead.id}` })}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
                      style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], color: 'white' }}>
                      {getInitials(lead.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs leading-relaxed">
                        <span className="font-semibold">{lead.name}</span>{' '}
                        <span style={{ color: 'var(--text-secondary)' }}>a soumis un formulaire</span>
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {timeAgo(lead.created_at)} · {TYPE_LABELS[lead.type]}
                      </div>
                    </div>
                  </div>
                ))
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

        {/* ═══ Contacts table (maquette : avatars gradient, Source/Valeur/Score) ═══ */}
        <div className="rounded-xl overflow-hidden card-lift" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <h3 className="text-base font-semibold">Derniers contacts</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{recentLeads.length} contacts actifs cette semaine</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer hover:bg-[var(--bg-subtle)]"
                style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                <Filter size={14} /> Filtrer
              </button>
              <button onClick={() => void navigate({ to: '/leads' })}
                className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer hover:bg-[var(--brand-tint)]"
                style={{ color: 'var(--brand-primary)' }}>
                Voir tout <ArrowRight size={14} />
              </button>
            </div>
          </div>
          <table className="w-full">
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
                const score = lead.score || Math.floor(Math.random() * 60 + 20);
                const scoreColor = score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
                const statusColor = STATUS_COLORS[lead.status] || 'var(--text-muted)';
                const statusBg = `color-mix(in srgb, ${statusColor} 12%, transparent)`;
                return (
                  <tr key={lead.id} className="hover:bg-[var(--bg-subtle)] transition cursor-pointer"
                    style={{ borderTop: '1px solid var(--border-subtle)' }}
                    onClick={() => void navigate({ to: `/leads/${lead.id}` })}>
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

      </>
    </AppLayout>
  );
}

// ── StatCard style maquette (icône carrée + sparkline SVG + delta badge) ──

function StatCardMockup({ label, value, icon, iconBg, iconColor, delta, deltaUp, sparkColor, sparkData }: {
  label: string; value: number | string; icon: React.ReactNode;
  iconBg: string; iconColor: string;
  delta: string; deltaUp?: boolean; sparkColor: string; sparkData?: number[];
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
        <span className={`text-xs font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-md`}
          style={{
            background: deltaUp !== false ? 'var(--success-soft)' : 'var(--danger-soft)',
            color: deltaUp !== false ? 'var(--success)' : 'var(--danger)',
            fontVariantNumeric: 'tabular-nums',
          }}>
          {deltaUp !== false ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {delta}
        </span>
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
