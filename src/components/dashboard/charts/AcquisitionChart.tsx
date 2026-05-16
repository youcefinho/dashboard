// ── Sprint 43 M1.2 — Lazy chart Dashboard Acquisition ─────────
// Extracté de pages/Dashboard.tsx pour permettre React.lazy() autour de
// l'import Recharts (vendor-recharts ~85 KB gzip + d3 ~50 KB gzip déjà
// dans chunk dédié). Tire 0 KB sur le bundle initial Dashboard.

import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LabelList,
} from 'recharts';

// ── Types alignés API getDashboardStats().leads_by_day ──────
export interface AcquisitionDataPoint {
  date: string;
  count: number;
}

// ── Tooltip custom (Stripe-PLUS) ────────────────────────────
function BarChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { date?: string; count?: number } }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const count = payload[0]?.value ?? 0;
  const rawDate =
    (payload[0]?.payload?.date as string | undefined) ??
    (typeof label === 'string' ? label : '');
  let dateLabel = rawDate;
  try {
    if (rawDate && rawDate.length >= 10) {
      const d = new Date(rawDate);
      if (!Number.isNaN(d.getTime())) {
        dateLabel = d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' });
      }
    }
  } catch { /* fallback raw */ }
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 12px',
        boxShadow: 'var(--shadow-md, 0 8px 24px rgba(50,50,93,0.15))',
        minWidth: 120,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-muted)',
          marginBottom: 4,
        }}
      >
        {dateLabel}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--primary)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count} lead{count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

// ── Composant lazy-loadable ─────────────────────────────────
export default function AcquisitionChart({
  chartData,
}: {
  chartData: AcquisitionDataPoint[];
}) {
  // Sprint 40 40-2A — Peak labels + trend line overlay
  const maxCount =
    chartData.length > 0 ? Math.max(...chartData.map((d) => d.count || 0)) : 0;
  const peakThreshold = maxCount * 0.8;
  const PeakLabel = (props: {
    x?: number;
    y?: number;
    width?: number;
    value?: number;
  }) => {
    const { x = 0, y = 0, width = 0, value = 0 } = props;
    if (!value || value < peakThreshold) return null;
    return (
      <text
        x={x + width / 2}
        y={y - 8}
        textAnchor="middle"
        fill="var(--text-muted)"
        fontSize={11}
        fontWeight={600}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </text>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={chartData} barCategoryGap="20%">
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          horizontal
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'var(--gray-500, #8898AA)' }}
          tickFormatter={(v: string) => v.slice(5)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--gray-500, #8898AA)' }}
          width={28}
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<BarChartTooltip />} cursor={{ fill: 'var(--bg-hover)' }} />
        <Bar
          dataKey="count"
          radius={[4, 4, 0, 0]}
          fill="var(--primary)"
          animationDuration={600}
          animationEasing="ease-out"
        >
          <LabelList dataKey="count" content={PeakLabel} />
        </Bar>
        <Line
          type="monotone"
          dataKey="count"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeOpacity={0.35}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
