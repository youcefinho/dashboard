// ── Sprint 43 M1.2 — Lazy chart Dashboard PipelineDonut ───────
// Extracté de pages/Dashboard.tsx pour permettre React.lazy() autour de
// l'import Recharts. Le composant ne contient QUE la ResponsiveContainer
// + PieChart ; le legend + center text restent dans Dashboard.tsx
// (HTML simple, pas de dep Recharts).

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

export interface PipelineDonutDatum {
  name: string;
  value: number;
  color: string;
}

export default function PipelineDonut({
  pipelineData,
  activeDonutIdx,
}: {
  pipelineData: PipelineDonutDatum[];
  activeDonutIdx: number | null;
}) {
  return (
    <ResponsiveContainer width={240} height={240}>
      <PieChart>
        <Pie
          data={pipelineData}
          cx="50%"
          cy="50%"
          innerRadius={72}
          outerRadius={112}
          dataKey="value"
          paddingAngle={2}
          strokeWidth={3}
          stroke="var(--bg-surface)"
          animationDuration={600}
          animationEasing="ease-out"
        >
          {pipelineData.map((entry, idx) => (
            <Cell
              key={idx}
              fill={entry.color}
              style={{
                transformOrigin: 'center',
                transform: activeDonutIdx === idx ? 'scale(1.04)' : 'scale(1)',
                transition:
                  'transform 180ms var(--ease, cubic-bezier(0.16, 1, 0.3, 1))',
                filter:
                  activeDonutIdx === idx
                    ? 'drop-shadow(0 4px 12px rgba(50,50,93,0.18))'
                    : 'none',
              }}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 500,
            boxShadow: 'var(--shadow-md, 0 8px 24px rgba(50,50,93,0.15))',
          }}
          cursor={{ fill: 'var(--bg-hover)' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
