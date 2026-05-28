// ── ServerAnalyticsPanel — Onglet « Analytics serveur » de Reports.tsx ───────
// Surface les rapports backend jusqu'ici invisibles côté UI :
//   • getReportsOverview      → KPIs + leads quotidiens (agrégat serveur)
//   • getReportsConversion    → funnel de conversion + temps moyens par étape
//   • getReportsSources       → performance par source (taux de conversion)
//   • getConversionBaselines  → baselines de conversion calibrées (won/lost réel)
// 100% ADDITIF — aucune modification d'api.ts / i18n / autres pages.
// Réutilise les primitives existantes (Card / Skeleton / EmptyState / Icon /
// Tag) + recharts, et respecte la période sélectionnée (prop `days`).
// ApiResponse GELÉ → succès { data }, erreur { error } (jamais `code`).

import { useState, useEffect, useCallback } from 'react';
import {
  Card, Skeleton, EmptyState, EmptyStateIllustration, Icon, Tag, Button,
} from '@/components/ui';
import {
  getReportsOverview, getReportsConversion, getReportsSources, getConversionBaselines,
  type ReportsOverview, type ConversionFunnel, type SourceReport,
} from '@/lib/api';
import { SOURCE_LABELS, type ConversionBaseline } from '@/lib/types';
import { t, getLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area,
} from 'recharts';
import { BarChart3, Users, Percent, Target, TrendingUp, Activity } from 'lucide-react';

interface ServerAnalyticsPanelProps {
  /** Fenêtre en jours dérivée du sélecteur de période de la page (respecte la date-range). */
  days: number;
}

const CHART_TOOLTIP_STYLE = {
  background: 'var(--surface, #fff)',
  border: '1px solid var(--border, rgba(0,0,0,0.08))',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 500,
  boxShadow: '0 6px 24px -8px rgba(0,0,0,0.18)',
} as const;

const BAR_COLORS = [
  'var(--primary)',
  'var(--success)',
  'var(--warning)',
  'var(--info, var(--primary))',
  'var(--accent, var(--warning))',
  'var(--danger)',
];

export function ServerAnalyticsPanel({ days }: ServerAnalyticsPanelProps) {
  const [overview, setOverview] = useState<ReportsOverview | null>(null);
  const [conversion, setConversion] = useState<ConversionFunnel | null>(null);
  const [sources, setSources] = useState<SourceReport[]>([]);
  const [baselines, setBaselines] = useState<ConversionBaseline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Les 4 rapports en parallèle. getConversionBaselines ne prend pas de
      // période (agrégat historique tenant) — les 3 autres respectent `days`.
      const [ovRes, convRes, srcRes, blRes] = await Promise.all([
        getReportsOverview(days),
        getReportsConversion(days),
        getReportsSources(days),
        getConversionBaselines(),
      ]);
      setOverview(ovRes.data ?? null);
      setConversion(convRes.data ?? null);
      setSources(srcRes.data?.sources ?? []);
      setBaselines(blRes.data?.baselines ?? []);
      // Erreur seulement si TOUT échoue (dégradation gracieuse sinon).
      if (!ovRes.data && !convRes.data && !srcRes.data && !blRes.data) {
        setError(ovRes.error || convRes.error || srcRes.error || blRes.error || t('reportsx.error.load'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reportsx.error.load'));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <div className="flex gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 flex-1 rounded-2xl" />)}
        </div>
        <Skeleton className="h-[280px] w-full rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-[260px] w-full rounded-2xl" />
          <Skeleton className="h-[260px] w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6 border border-[var(--danger)]/30" role="alert" aria-live="assertive">
        <p className="text-sm font-semibold text-[var(--danger)] mb-1">{t('reportsx.error.load')}</p>
        <p className="text-xs text-[var(--text-muted)] mb-3 break-all">{error}</p>
        <Button variant="secondary" onClick={() => void load()}>{t('action.retry')}</Button>
      </Card>
    );
  }

  const hasAny =
    !!overview ||
    (conversion?.funnel?.length ?? 0) > 0 ||
    sources.length > 0 ||
    baselines.length > 0;

  if (!hasAny) {
    return (
      <Card className="p-0">
        <EmptyState
          illustration={<EmptyStateIllustration kind="reports" size={160} />}
          title={t('reportsx.empty.title')}
          description={t('reportsx.empty.description')}
        />
      </Card>
    );
  }

  const dailyData = (overview?.charts.daily_leads ?? []).map(d => ({
    date: formatDate(new Date(d.date), getLocale(), { month: 'short', day: 'numeric' }),
    count: d.count,
  }));

  const funnelData = (conversion?.funnel ?? []).map(f => ({
    name: f.label || f.stage,
    count: f.count,
    percentage: f.percentage,
  }));

  const sortedSources = sources.slice().sort((a, b) => b.total_leads - a.total_leads);
  const sortedBaselines = baselines
    .slice()
    .sort((a, b) => b.sample_size - a.sample_size);

  return (
    <div className="space-y-4">
      {/* ── Overview KPIs (getReportsOverview) ──────────────────────── */}
      {overview && (
        <section aria-label={t('reportsx.overview.title')} className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Icon as={BarChart3} size={15} className="text-[var(--primary)]" />
            {t('reportsx.overview.title')}
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="flex items-center gap-2 text-[var(--text-muted)] text-[11px] font-medium mb-1">
                <Icon as={Users} size={12} /> {t('reportsx.overview.total_leads')}
              </div>
              <div className="text-xl font-bold t-mono-num">{overview.kpis.total_leads}</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-[var(--text-muted)] text-[11px] font-medium mb-1">
                <Icon as={Activity} size={12} /> {t('reportsx.overview.converted')}
              </div>
              <div className="text-xl font-bold t-mono-num text-[var(--success)]">{overview.kpis.converted_leads}</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-[var(--text-muted)] text-[11px] font-medium mb-1">
                <Icon as={Percent} size={12} /> {t('reportsx.overview.conversion_rate')}
              </div>
              <div className="text-xl font-bold t-mono-num">{Math.round((overview.kpis.conversion_rate ?? 0) * 100) / 100}%</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-[var(--text-muted)] text-[11px] font-medium mb-1">
                <Icon as={TrendingUp} size={12} /> {t('reportsx.overview.avg_days')}
              </div>
              <div className="text-xl font-bold t-mono-num">
                {overview.kpis.avg_conversion_days != null ? Math.round(overview.kpis.avg_conversion_days * 10) / 10 : '—'}
              </div>
            </Card>
          </div>
          {dailyData.length > 0 && (
            <Card className="p-5">
              <h4 className="text-xs font-semibold mb-3 text-[var(--text-secondary)]">{t('reportsx.overview.daily_leads')}</h4>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={dailyData}>
                  <defs>
                    <linearGradient id="grad-server-daily" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Area type="monotone" dataKey="count" name={t('reportsx.overview.total_leads')} stroke="var(--primary)" fill="url(#grad-server-daily)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          )}
        </section>
      )}

      {/* ── Conversion funnel (getReportsConversion) ────────────────── */}
      {funnelData.length > 0 && (
        <section aria-label={t('reportsx.funnel.title')} className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Icon as={BarChart3} size={15} className="text-[var(--primary)]" />
            {t('reportsx.funnel.title')}
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <ResponsiveContainer width="100%" height={Math.max(220, funnelData.length * 48 + 40)}>
                <BarChart data={funnelData} layout="vertical" margin={{ left: 20, right: 16 }}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={110} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    formatter={((val: number, _n: string, item: any) => [`${val} (${item?.payload?.percentage ?? 0}%)`, t('reportsx.funnel.count')]) as any}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={28}>
                    {funnelData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-5">
              <h4 className="text-xs font-semibold mb-3 text-[var(--text-secondary)]">{t('reportsx.funnel.avg_times')}</h4>
              {(conversion?.avg_stage_times?.length ?? 0) > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                        <th className="py-2 font-medium">{t('reportsx.funnel.stage')}</th>
                        <th className="py-2 font-medium text-right">{t('reportsx.funnel.avg_days')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversion!.avg_stage_times.map(s => (
                        <tr key={s.action} className="border-b border-[var(--border)] last:border-0">
                          <td className="py-2 capitalize">{s.action}</td>
                          <td className="py-2 text-right t-mono-num">{Math.round(s.avg_days_from_creation * 10) / 10}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)] italic">{t('reportsx.funnel.no_times')}</p>
              )}
            </Card>
          </div>
        </section>
      )}

      {/* ── Sources / attribution (getReportsSources) ───────────────── */}
      {sortedSources.length > 0 && (
        <section aria-label={t('reportsx.sources.title')} className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Icon as={Target} size={15} className="text-[var(--primary)]" />
            {t('reportsx.sources.title')}
          </h3>
          <Card className="p-5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-2 font-medium">{t('reportsx.sources.col_source')}</th>
                    <th className="py-2 font-medium text-right">{t('reportsx.sources.col_total')}</th>
                    <th className="py-2 font-medium text-right">{t('reportsx.sources.col_converted')}</th>
                    <th className="py-2 font-medium text-right">{t('reportsx.sources.col_lost')}</th>
                    <th className="py-2 font-medium text-right">{t('reportsx.sources.col_rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSources.map(s => (
                    <tr key={s.source} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2">{SOURCE_LABELS[s.source] || s.source}</td>
                      <td className="py-2 text-right t-mono-num">{s.total_leads}</td>
                      <td className="py-2 text-right t-mono-num text-[var(--success)]">{s.converted}</td>
                      <td className="py-2 text-right t-mono-num text-[var(--text-muted)]">{s.lost}</td>
                      <td className="py-2 text-right">
                        <Tag dot size="sm" variant={s.conversion_rate >= 20 ? 'success' : 'warning'}>
                          {Math.round(s.conversion_rate * 100) / 100}%
                        </Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}

      {/* ── Conversion baselines (getConversionBaselines) ───────────── */}
      {sortedBaselines.length > 0 && (
        <section aria-label={t('reportsx.baselines.title')} className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Icon as={Percent} size={15} className="text-[var(--primary)]" />
            {t('reportsx.baselines.title')}
          </h3>
          <Card className="p-5">
            <p className="text-xs text-[var(--text-muted)] mb-3">{t('reportsx.baselines.desc')}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-2 font-medium">{t('reportsx.baselines.col_dimension')}</th>
                    <th className="py-2 font-medium">{t('reportsx.baselines.col_value')}</th>
                    <th className="py-2 font-medium text-right">{t('reportsx.baselines.col_won')}</th>
                    <th className="py-2 font-medium text-right">{t('reportsx.baselines.col_lost')}</th>
                    <th className="py-2 font-medium text-right">{t('reportsx.baselines.col_rate')}</th>
                    <th className="py-2 font-medium text-right">{t('reportsx.baselines.col_sample')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedBaselines.map(b => (
                    <tr key={b.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 capitalize">{b.dimension}</td>
                      <td className="py-2">{SOURCE_LABELS[b.dimension_value] || b.dimension_value}</td>
                      <td className="py-2 text-right t-mono-num text-[var(--success)]">{b.won_count}</td>
                      <td className="py-2 text-right t-mono-num text-[var(--text-muted)]">{b.lost_count}</td>
                      <td className="py-2 text-right t-mono-num">{Math.round(b.conversion_rate * 1000) / 10}%</td>
                      <td className="py-2 text-right t-mono-num">
                        {b.sample_size < 10 ? (
                          <span title={t('reportsx.baselines.low_sample')}>
                            <Tag size="sm" variant="warning">{b.sample_size}</Tag>
                          </span>
                        ) : (
                          <span>{b.sample_size}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}
