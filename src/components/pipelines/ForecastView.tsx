import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Card, KpiStrip, Sparkline } from '@/components/ui';
import type { KpiItem } from '@/components/ui';
// Sprint 48 M3.3 — Intl currency formatter
import { formatMoneyCAD } from '@/lib/i18n/number';
import { getLocale } from '@/lib/i18n';

type ForecastData = {
  month: string;
  weighted_revenue: number;
  deal_count: number;
};

export function ForecastView({ pipelineId }: { pipelineId: string }) {
  const [data, setData] = useState<ForecastData[]>([]);
  const [totals, setTotals] = useState({ pipeline: 0, weighted: 0 });
  const [period, setPeriod] = useState<'30d' | '90d' | '12m'>('90d');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchForecast = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/pipelines/${pipelineId}/forecast?period=${period}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const result = await res.json() as any;
        if (active && result.data) {
          setData(result.data);
          setTotals({ pipeline: result.total_pipeline_value || 0, weighted: result.weighted_total || 0 });
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    if (pipelineId) void fetchForecast();
    return () => { active = false; };
  }, [pipelineId, period]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">
        Chargement des prévisions...
      </div>
    );
  }

  const bestMonth = [...data].sort((a, b) => b.weighted_revenue - a.weighted_revenue)[0];
  const worstMonth = [...data].sort((a, b) => a.weighted_revenue - b.weighted_revenue)[0];

  // Sparkline series (revenu pondéré par mois)
  const sparkSeries = useMemo(() => data.map(d => d.weighted_revenue), [data]);

  // KPIs en haut (4 cols KpiStrip)
  const kpis: KpiItem[] = useMemo(() => [
    {
      label: 'Total Pipeline',
      value: formatMoneyCAD(totals.pipeline, getLocale()),
      color: 'neutral',
      sparkData: sparkSeries,
    },
    {
      label: 'Total Pondéré',
      value: formatMoneyCAD(totals.weighted, getLocale()),
      color: 'brand',
      sparkData: sparkSeries,
    },
    {
      label: 'Meilleur Mois',
      value: bestMonth ? formatMoneyCAD(bestMonth.weighted_revenue, getLocale()) : formatMoneyCAD(0, getLocale()),
      color: 'success',
    },
    {
      label: 'Mois le plus bas',
      value: worstMonth ? formatMoneyCAD(worstMonth.weighted_revenue, getLocale()) : formatMoneyCAD(0, getLocale()),
      color: 'danger',
    },
  ], [totals.pipeline, totals.weighted, bestMonth, worstMonth, sparkSeries]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Prévisions de revenus</h2>
          {sparkSeries.length > 1 && (
            <Sparkline data={sparkSeries} color="brand" height={28} width={96} showMinMax />
          )}
        </div>
        {/* Segmented-control period selector */}
        <div className="segmented-control">
          {(['30d', '90d', '12m'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={period === p ? 'is-active' : ''}
            >
              {p === '30d' ? '30 jours' : p === '90d' ? '90 jours' : '12 mois'}
            </button>
          ))}
        </div>
      </div>

      <KpiStrip items={kpis} />

      <Card className="p-5 h-[400px]">
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">Aucune donnée prévisionnelle</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <defs>
                <linearGradient id="forecast-bar-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00B5F5" stopOpacity={0.95} />
                  <stop offset="55%" stopColor="#009DDB" stopOpacity={0.85} />
                  <stop offset="100%" stopColor="#D96E27" stopOpacity={0.55} />
                </linearGradient>
                <linearGradient id="forecast-deals-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8A93A4" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#8A93A4" stopOpacity={0.18} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
              <YAxis
                yAxisId="left"
                orientation="left"
                tickFormatter={(val) => `${(val / 1000)}k$`}
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                tickLine={false} axisLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                tickLine={false} axisLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(0,157,219,0.06)' }}
                contentStyle={{ backgroundColor: 'var(--bg-surface)', borderColor: 'rgba(0,157,219,0.30)', borderRadius: '10px', fontSize: '12px', boxShadow: '0 8px 24px -6px rgba(0,157,219,0.25)' }}
                formatter={(value: any, name: any) => [
                  name === 'Revenu Pondéré' ? formatMoneyCAD(value, getLocale()) : value,
                  name
                ]}
                labelStyle={{ fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '4px' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
              <Bar yAxisId="left" dataKey="weighted_revenue" name="Revenu Pondéré" fill="url(#forecast-bar-grad)" radius={[6, 6, 0, 0]} maxBarSize={60} />
              <Bar yAxisId="right" dataKey="deal_count" name="Nb Opportunités" fill="url(#forecast-deals-grad)" radius={[6, 6, 0, 0]} maxBarSize={60} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}
