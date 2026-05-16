// ── UsersGrowthChart — Sprint 46 M2.2 lazy chart ─────────────
// LineChart : utilisateurs totaux + actifs mensuels.
// Lazy-loaded depuis AdminOverview — bundle initial admin = 0 KB recharts.

import {
  ResponsiveContainer, LineChart, Line, CartesianGrid,
  XAxis, YAxis, Tooltip, Legend,
} from 'recharts';

export interface UsersGrowthPoint {
  label: string;
  users: number;
  active: number;
}

function LineTooltip({
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
            width: 8, height: 8, borderRadius: '50%',
            background: p.color || 'var(--primary)', flexShrink: 0,
          }} />
          <span style={{
            fontSize: 12, color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {p.dataKey === 'users' ? 'Total' : 'Actifs'} : <strong style={{ color: 'var(--text-primary)' }}>{p.value}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function UsersGrowthChart({ data }: { data: UsersGrowthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          width={36}
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<LineTooltip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)', paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
        <Line
          type="monotone"
          dataKey="users"
          name="Total"
          stroke="var(--primary)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--primary)' }}
          animationDuration={600}
        />
        <Line
          type="monotone"
          dataKey="active"
          name="Actifs / mois"
          stroke="var(--success, #15803D)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--success, #15803D)' }}
          animationDuration={600}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
