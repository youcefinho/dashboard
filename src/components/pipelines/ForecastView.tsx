import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { Card, KpiStrip, Sparkline } from '@/components/ui';
import type { KpiItem } from '@/components/ui';
// Sprint 48 M3.3 — Intl currency formatter
import { formatMoneyCAD } from '@/lib/i18n/number';
import { getLocale, t } from '@/lib/i18n';
// Sprint 14 — Forecasting enrichi : migration vers apiFetch/helpers FIGÉS (§6.A/§6.H).
import { getForecast, getForecastTargets } from '@/lib/api';
import type { ForecastResponse, ForecastPoint, ForecastGroup, ForecastTarget } from '@/lib/types';

type GroupBy = 'month' | 'rep' | 'source';
type ScenarioKey = 'best' | 'likely' | 'worst';

const EMPTY_FORECAST: ForecastResponse = {
  points: [],
  scenarios: { best: 0, likely: 0, worst: 0 },
};

export function ForecastView({ pipelineId }: { pipelineId: string }) {
  const [forecast, setForecast] = useState<ForecastResponse>(EMPTY_FORECAST);
  const [targets, setTargets] = useState<ForecastTarget[]>([]);
  const [period, setPeriod] = useState<'30d' | '90d' | '12m'>('90d');
  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const [scenario, setScenario] = useState<ScenarioKey>('likely');
  const [isLoading, setIsLoading] = useState(true);

  const fetchForecast = useCallback(async () => {
    setIsLoading(true);
    // Helpers FIGÉS Phase A — plus de fetch brut / localStorage token / `as any`.
    // apiFetch injecte l'auth ; discrimination d'erreur sur `error || !data`.
    const [fRes, tRes] = await Promise.all([
      getForecast({ pipeline_id: pipelineId, group_by: groupBy, period }),
      getForecastTargets({ pipeline_id: pipelineId }),
    ]);
    if (!fRes.error && fRes.data) {
      setForecast(fRes.data);
    } else {
      setForecast(EMPTY_FORECAST);
    }
    setTargets(!tRes.error && tRes.data ? tRes.data.targets : []);
    setIsLoading(false);
  }, [pipelineId, groupBy, period]);

  useEffect(() => {
    let active = true;
    if (pipelineId) {
      void fetchForecast().catch(() => { if (active) setIsLoading(false); });
    } else {
      setIsLoading(false);
    }
    return () => { active = false; };
  }, [pipelineId, fetchForecast]);

  const points: ForecastPoint[] = forecast.points || [];

  // Best/worst mois sur le revenu pondéré.
  const bestMonth = useMemo(
    () => [...points].sort((a, b) => b.weighted - a.weighted)[0],
    [points],
  );
  const worstMonth = useMemo(
    () => [...points].sort((a, b) => a.weighted - b.weighted)[0],
    [points],
  );

  // Total pondéré (somme des points). Le nouvel endpoint /forecast n'expose pas
  // de total_pipeline_value (forme différente de l'ancien endpoint par pipeline) :
  // on dérive un total pondéré déterministe depuis points[].weighted.
  const weightedTotal = useMemo(
    () => points.reduce((s, p) => s + (p.weighted || 0), 0),
    [points],
  );

  // Sparkline du revenu pondéré par mois (réutilise la primitive existante).
  const sparkSeries = useMemo(() => points.map(p => p.weighted), [points]);

  // Série pour le group-by (rep / source) — barres `weighted` par clé.
  const groups: ForecastGroup[] = useMemo(() => {
    if (groupBy === 'rep') return forecast.by_rep || [];
    if (groupBy === 'source') return forecast.by_source || [];
    return [];
  }, [groupBy, forecast.by_rep, forecast.by_source]);

  // Merge points (objectif/réalisé) + trend (projection) sur period_month, pour
  // un ComposedChart unique : barres pondéré + lignes objectif/réalisé/tendance.
  const chartData = useMemo(() => {
    const byMonth = new Map<string, {
      period_month: string;
      weighted: number;
      target: number | null;
      actual: number | null;
      trend: number | null;
    }>();
    for (const p of points) {
      byMonth.set(p.period_month, {
        period_month: p.period_month,
        weighted: p.weighted ?? 0,
        target: p.target ?? null,
        actual: p.actual ?? null,
        trend: null,
      });
    }
    for (const tp of forecast.trend || []) {
      const existing = byMonth.get(tp.period_month);
      if (existing) {
        existing.trend = tp.weighted ?? null;
      } else {
        byMonth.set(tp.period_month, {
          period_month: tp.period_month,
          weighted: 0,
          target: tp.target ?? null,
          actual: tp.actual ?? null,
          trend: tp.weighted ?? null,
        });
      }
    }
    return Array.from(byMonth.values());
  }, [points, forecast.trend]);

  const hasTarget = chartData.some(d => d.target != null);
  const hasActual = chartData.some(d => d.actual != null);
  const hasTrend = chartData.some(d => d.trend != null);

  const scenarios = forecast.scenarios || EMPTY_FORECAST.scenarios;
  const scenarioValue = scenarios[scenario] ?? 0;

  const moneyFmt = useCallback(
    (v: number | null | undefined) => formatMoneyCAD(v ?? 0, getLocale()),
    [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">
        {t('pipeline.loading')}
      </div>
    );
  }

  // KPIs en haut (4 cols KpiStrip) — libellés via clés i18n forecast.* de A.
  const kpis: KpiItem[] = [
    {
      label: t('forecast.total_pipeline'),
      value: moneyFmt(weightedTotal),
      color: 'neutral',
      sparkData: sparkSeries,
    },
    {
      label: t('forecast.weighted_revenue'),
      value: moneyFmt(weightedTotal),
      color: 'brand',
      sparkData: sparkSeries,
    },
    {
      label: t('forecast.best_month'),
      value: moneyFmt(bestMonth?.weighted),
      color: 'success',
    },
    {
      label: t('forecast.worst_month'),
      value: moneyFmt(worstMonth?.weighted),
      color: 'danger',
    },
  ];

  const groupByOptions: Array<{ key: GroupBy; label: string }> = [
    { key: 'month', label: t('forecast.period') },
    { key: 'rep', label: t('forecast.by_rep') },
    { key: 'source', label: t('forecast.by_source') },
  ];

  const scenarioOptions: Array<{ key: ScenarioKey; label: string }> = [
    { key: 'best', label: t('forecast.scenario_best') },
    { key: 'likely', label: t('forecast.scenario_likely') },
    { key: 'worst', label: t('forecast.scenario_worst') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t('forecast.title')}</h2>
          {sparkSeries.length > 1 && (
            <Sparkline data={sparkSeries} color="brand" height={28} width={96} showMinMax />
          )}
        </div>
        {/* Sélecteur de période (passe-plat vers le helper FIGÉ) */}
        <div className="segmented-control">
          {(['30d', '90d', '12m'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={period === p ? 'is-active' : ''}
            >
              {p === '30d' ? '30 j' : p === '90d' ? '90 j' : '12 m'}
            </button>
          ))}
        </div>
      </div>

      <KpiStrip items={kpis} />

      {/* Scénarios best/likely/worst + group-by commercial/source */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
            {t('forecast.scenario')}
          </span>
          <div className="segmented-control">
            {scenarioOptions.map(o => (
              <button
                key={o.key}
                onClick={() => setScenario(o.key)}
                className={scenario === o.key ? 'is-active' : ''}
              >
                {o.label}
              </button>
            ))}
          </div>
          <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
            {moneyFmt(scenarioValue)}
          </span>
        </div>
        <div className="segmented-control">
          {groupByOptions.map(o => (
            <button
              key={o.key}
              onClick={() => setGroupBy(o.key)}
              className={groupBy === o.key ? 'is-active' : ''}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Graphe principal : pondéré + objectif/réalisé + projection de tendance */}
      <Card className="p-5 h-[400px]">
        {groupBy === 'month' ? (
          chartData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
              {t('forecast.no_data')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <defs>
                  <linearGradient id="forecast-bar-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00B5F5" stopOpacity={0.95} />
                    <stop offset="55%" stopColor="#009DDB" stopOpacity={0.85} />
                    <stop offset="100%" stopColor="#D96E27" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="period_month" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(val) => `${(val / 1000)}k$`}
                  tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                  tickLine={false} axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,157,219,0.06)' }}
                  contentStyle={{ backgroundColor: 'var(--bg-surface)', borderColor: 'rgba(0,157,219,0.30)', borderRadius: '10px', fontSize: '12px', boxShadow: '0 8px 24px -6px rgba(0,157,219,0.25)' }}
                  formatter={(value, name) => [moneyFmt(Number(value ?? 0)), String(name ?? '')]}
                  labelStyle={{ fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '4px' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                <Bar dataKey="weighted" name={t('forecast.weighted_revenue')} fill="url(#forecast-bar-grad)" radius={[6, 6, 0, 0]} maxBarSize={60} />
                {hasTrend && (
                  <Line type="monotone" dataKey="trend" name={t('forecast.projection')} stroke="var(--primary)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
                )}
                {hasTarget && (
                  <Line type="monotone" dataKey="target" name={t('forecast.target')} stroke="var(--accent-orange)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                )}
                {hasActual && (
                  <Line type="monotone" dataKey="actual" name={t('forecast.actual')} stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )
        ) : (
          groups.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
              {t('forecast.no_data')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={groups} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <defs>
                  <linearGradient id="forecast-group-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00B5F5" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#009DDB" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(val) => `${(val / 1000)}k$`}
                  tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                  tickLine={false} axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,157,219,0.06)' }}
                  contentStyle={{ backgroundColor: 'var(--bg-surface)', borderColor: 'rgba(0,157,219,0.30)', borderRadius: '10px', fontSize: '12px', boxShadow: '0 8px 24px -6px rgba(0,157,219,0.25)' }}
                  formatter={(value) => [moneyFmt(Number(value ?? 0)), groupBy === 'rep' ? t('forecast.by_rep') : t('forecast.by_source')]}
                  labelStyle={{ fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '4px' }}
                />
                <Bar dataKey="weighted" name={t('forecast.weighted_revenue')} fill="url(#forecast-group-grad)" radius={[6, 6, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          )
        )}
      </Card>

      {/* Objectifs définis (lecture). Affiché sobrement si présents. */}
      {targets.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-[var(--text-primary)]">{t('forecast.target')}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {targets.map(tg => (
              <div key={tg.id} className="flex flex-col rounded-lg border border-[var(--border-subtle)] p-3">
                <span className="text-xs text-[var(--text-muted)]">{tg.period_month}</span>
                <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                  {moneyFmt(tg.target_amount)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
