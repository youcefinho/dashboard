// ── LeadsConversionsChart — Sprint 46 M2.2 lazy chart ────────
// BarChart : leads créés vs conversions (2 séries comparables).

import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid,
  XAxis, YAxis, Tooltip, Legend,
} from 'recharts';

export interface LeadsConversionsPoint {
  label: string;
  leads: number;
  conversions: number;
}

function BarTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; dataKey?: string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 12px',
        boxShadow: 'var(--shadow-md, 0 8px 24px rgba(50,50,93,0.15))',
        minWidth: 140,
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 6,
      }}>
        {label}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: i > 0 ? 4 : 0 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 2,
            background: p.color || 'var(--primary)', flexShrink: 0,
          }} />
          <span style={{
            fontSize: 12, color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {p.dataKey === 'leads' ? 'Leads' : 'Conversions'} : <strong style={{ color: 'var(--text-primary)' }}>{p.value}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function LeadsConversionsChart({ data }: { data: LeadsConversionsPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          width={32}
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<BarTooltip />} cursor={{ fill: 'var(--bg-hover)' }} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)', paddingTop: 8 }}
          iconType="square"
          iconSize={8}
        />
        <Bar
          dataKey="leads"
          name="Leads"
          fill="var(--primary)"
          radius={[4, 4, 0, 0]}
          animationDuration={600}
        />
        <Bar
          dataKey="conversions"
          name="Conversions"
          fill="var(--success, #15803D)"
          radius={[4, 4, 0, 0]}
          animationDuration={600}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
