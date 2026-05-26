// ── AttributionPanel — Onglet « Attribution » de Reports.tsx ───────────────
// LOT ATTRIBUTION-D Sprint D — Phase B Manager-C (front exclusif).
// Sélecteur de modèle multi-touch (first / last / linear / time_decay) +
// BarChart recharts des crédits de conversion par source + tableau récap.
// Helpers + types + clés i18n posés en Phase A (api.ts / attribution.*).
// SUBTLE Stripe-grade : réutilise Card / Select / Tag / EmptyState / Skeleton.
// ApiResponse INCHANGÉ → string-match implicite via res.data.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Select, Skeleton, EmptyState, EmptyStateIllustration, Icon,
} from '@/components/ui';
import { getReportsAttribution, type AttributionReport } from '@/lib/api';
import { SOURCE_LABELS } from '@/lib/types';
import { t } from '@/lib/i18n';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Percent } from 'lucide-react';

type AttributionModel = 'first' | 'last' | 'linear' | 'time_decay';

const MODELS: { id: AttributionModel; key: string }[] = [
  { id: 'first', key: 'attribution.model_first' },
  { id: 'last', key: 'attribution.model_last' },
  { id: 'linear', key: 'attribution.model_linear' },
  { id: 'time_decay', key: 'attribution.model_time_decay' },
];

// Palette sobre Stripe-grade — déterministe par index de source.
const BAR_COLORS = [
  'var(--primary)',
  'var(--success)',
  'var(--brand-cyan, var(--primary))',
  'var(--warning)',
  'var(--info, var(--primary))',
  'var(--accent, var(--warning))',
];

const CHART_TOOLTIP_STYLE = {
  background: 'var(--surface, #fff)',
  border: '1px solid var(--border, rgba(0,0,0,0.08))',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 500,
  boxShadow: '0 6px 24px -8px rgba(0,0,0,0.18)',
} as const;

export function AttributionPanel() {
  const [rows, setRows] = useState<AttributionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<AttributionModel>('last');

  const load = useCallback(async () => {
    setLoading(true);
    // Le backend renvoie tous les modèles par source — un seul appel suffit,
    // on bascule de modèle côté client sans refetch.
    const res = await getReportsAttribution();
    if (res.data?.by_source) setRows(res.data.by_source);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Données triées décroissant selon le crédit du modèle actif.
  const chartData = useMemo(() => {
    return rows
      .map(r => ({
        source: SOURCE_LABELS[r.source] || r.source,
        value: r[model],
      }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [rows, model]);

  if (loading) {
    return (
      <Card className="p-5 space-y-4">
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-[300px] w-full rounded-2xl" />
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className="p-0">
        <EmptyState
          illustration={<EmptyStateIllustration kind="reports" size={160} />}
          title={t('attribution.title')}
          description={t('attribution.empty')}
        />
      </Card>
    );
  }

  const chartHeight = Math.max(220, chartData.length * 44 + 40);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Icon as={Percent} size={15} className="text-[var(--primary)]" />
          {t('attribution.title')}
        </h3>
        <div className="w-52">
          <Select
            value={model}
            onChange={e => setModel(e.target.value as AttributionModel)}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{t(m.key as any)}</option>
            ))}
          </Select>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 16 }}>
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="source"
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            width={120}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            formatter={((val: number) => [val, t('attribution.col_conversions')]) as any}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="py-2 font-medium">{t('attribution.col_source')}</th>
              <th className="py-2 font-medium text-right">{t('attribution.model_first')}</th>
              <th className="py-2 font-medium text-right">{t('attribution.model_last')}</th>
              <th className="py-2 font-medium text-right">{t('attribution.model_linear')}</th>
              <th className="py-2 font-medium text-right">{t('attribution.model_time_decay')}</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice()
              .sort((a, b) => b[model] - a[model])
              .map(r => (
                <tr key={r.source} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2">{SOURCE_LABELS[r.source] || r.source}</td>
                  <td className={`py-2 text-right t-mono-num ${model === 'first' ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{r.first}</td>
                  <td className={`py-2 text-right t-mono-num ${model === 'last' ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{r.last}</td>
                  <td className={`py-2 text-right t-mono-num ${model === 'linear' ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{Math.round(r.linear * 100) / 100}</td>
                  <td className={`py-2 text-right t-mono-num ${model === 'time_decay' ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{Math.round(r.time_decay * 100) / 100}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)]">{t('attribution.empty')}</p>
    </Card>
  );
}
