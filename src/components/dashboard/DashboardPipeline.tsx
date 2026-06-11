import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { t } from '@/lib/i18n';

// ── Types pour les données pipeline et sources ──

interface PipelineDataItem {
  name: string;
  value: number;
  color: string;
}

interface SourceDataItem {
  source: string;
  count: number;
  value: number;
}

interface DashboardPipelineProps {
  isLoading: boolean;
  pipelineData: PipelineDataItem[];
  sourceData: SourceDataItem[];
  sourceTotal: number;
  showSources: boolean;
}

/**
 * Widget Pipeline donut + Top Sources
 * Affiche la répartition du pipeline en donut et les sources d'acquisition.
 */
export function DashboardPipeline({
  isLoading,
  pipelineData,
  sourceData,
  sourceTotal,
  showSources,
}: DashboardPipelineProps) {
  return (
    <div className="page-grid-2-1 mb-6 animate-fade-in-up stagger-5">
      {/* Donut pipeline */}
      <div className="chart-container">
        <h3 className="text-section-title mb-4">{t('dashboard.pipeline.title')}</h3>
        {isLoading ? (
          <div className="skeleton-shimmer h-48 w-full rounded-lg" />
        ) : pipelineData.length > 0 ? (
          <div className="flex items-center gap-8">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  data={pipelineData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="value"
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {pipelineData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '12px',
                    fontWeight: 500,
                    boxShadow: 'var(--shadow-md)',
                  }}
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Légende du donut */}
            <div className="chart-legend space-y-2">
              {pipelineData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ background: d.color }}
                  />
                  <span className="text-subtitle">{d.name}</span>
                  <span
                    className="text-xs font-semibold ml-auto"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {d.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            {t('dashboard.pipeline.empty')}
          </p>
        )}
      </div>

      {/* Top sources */}
      {showSources && (
        <div className="chart-container">
          <h3 className="text-section-title mb-4">
            {t('dashboard.sources.title')}
          </h3>
          <div className="space-y-3">
            {sourceData.map(({ source, count, value }) => {
              const pct =
                sourceTotal > 0
                  ? Math.round((count / sourceTotal) * 100)
                  : 0;
              const labels: Record<string, string> = {
                website: t('dashboard.sources.website'),
                facebook: t('dashboard.sources.facebook'),
                google: t('dashboard.sources.google'),
                referral: t('dashboard.sources.referral'),
                direct: t('dashboard.sources.direct'),
                instagram: t('dashboard.sources.instagram'),
              };
              return (
                <div key={source}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-subtitle">
                      {labels[source] || source}
                    </span>
                    <div className="flex flex-col items-end">
                      <span
                        className="text-xs font-semibold"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {count} ({pct}%)
                      </span>
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--success)' }}
                      >
                        {(value / 1000).toFixed(1)}K $
                      </span>
                    </div>
                  </div>
                  <div
                    className="w-full h-1.5 rounded-full overflow-hidden"
                    style={{ background: 'var(--bg-muted)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: 'var(--primary)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {sourceData.length === 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                {t('dashboard.sources.empty')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
