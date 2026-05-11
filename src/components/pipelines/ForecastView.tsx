import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Card } from '@/components/ui';

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Prévisions de revenus</h2>
        <div className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-1">
          {(['30d', '90d', '12m'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${period === p ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer'}`}
            >
              {p === '30d' ? '30 jours' : p === '90d' ? '90 jours' : '12 mois'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">Total Pipeline</p>
          <p className="text-xl font-bold text-[var(--text-primary)]">{totals.pipeline.toLocaleString('fr-CA')} $</p>
        </Card>
        <Card className="p-4 border-[var(--brand-primary)]">
          <p className="text-xs text-[var(--brand-primary)] uppercase tracking-wider mb-1 font-semibold">Total Pondéré</p>
          <p className="text-xl font-bold text-[var(--brand-primary)]">{totals.weighted.toLocaleString('fr-CA')} $</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">Meilleur Mois</p>
          <p className="text-xl font-bold text-[var(--success)]">{bestMonth ? bestMonth.weighted_revenue.toLocaleString('fr-CA') : '0'} $</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{bestMonth ? bestMonth.month : '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">Mois le plus bas</p>
          <p className="text-xl font-bold text-[var(--danger)]">{worstMonth ? worstMonth.weighted_revenue.toLocaleString('fr-CA') : '0'} $</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{worstMonth ? worstMonth.month : '—'}</p>
        </Card>
      </div>

      <Card className="p-5 h-[400px]">
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">Aucune donnée prévisionnelle</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
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
                cursor={{ fill: 'var(--bg-subtle)' }}
                contentStyle={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value: any, name: any) => [
                  name === 'Revenu Pondéré' ? `${value.toLocaleString('fr-CA')} $` : value, 
                  name
                ]}
                labelStyle={{ fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '4px' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
              <Bar yAxisId="left" dataKey="weighted_revenue" name="Revenu Pondéré" fill="var(--brand-primary)" radius={[4, 4, 0, 0]} maxBarSize={60} />
              <Bar yAxisId="right" dataKey="deal_count" name="Nb Opportunités" fill="var(--bg-muted)" radius={[4, 4, 0, 0]} maxBarSize={60} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}
