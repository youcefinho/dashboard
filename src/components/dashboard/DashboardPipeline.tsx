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
  // Total pour la barre segmentée
  const pipelineTotal = pipelineData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="page-grid-2-1 mb-8 animate-stagger stagger-6">
      {/* Donut pipeline */}
      <div className="stripe-card" style={{ borderTop: '3px solid var(--primary)' }}>
        <div className="widget-header-s1">
          <h3 className="text-section-title">{t('dashboard.pipeline.title')}</h3>
        </div>

        {/* Barre segmentée horizontale — Vague 1B */}
        {!isLoading && pipelineData.length > 0 && pipelineTotal > 0 && (
          <div
            className="flex w-full overflow-hidden mb-5"
            style={{ height: 6, borderRadius: 'var(--radius-pill)' }}
            aria-label="Répartition pipeline"
          >
            {pipelineData.map((d, idx) => {
              const widthPct = (d.value / pipelineTotal) * 100;
              if (widthPct <= 0) return null;
              return (
                <div
                  key={d.name}
                  style={{
                    width: `${widthPct}%`,
                    background: d.color,
                    borderRadius: idx === 0
                      ? 'var(--radius-pill) 0 0 var(--radius-pill)'
                      : idx === pipelineData.length - 1
                        ? '0 var(--radius-pill) var(--radius-pill) 0'
                        : '0',
                    transition: 'width 0.6s ease',
                  }}
                />
              );
            })}
          </div>
        )}

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
                    borderRadius: 'var(--radius-lg)',
                    fontSize: '12px',
                    fontWeight: 500,
                    boxShadow: 'var(--shadow-md)',
                    padding: '8px 12px',
                  }}
                  cursor={{ fill: 'rgba(99, 91, 255, 0.06)' }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Légende du donut */}
            <div className="donut-legend-s1">
              {pipelineData.map((d) => (
                <div key={d.name} className="donut-legend-item-s1">
                  <span
                    className="donut-legend-dot-s1"
                    style={{ background: d.color }}
                  />
                  <span className="text-subtitle">{d.name}</span>
                  <span className="text-xs font-semibold ml-auto t-mono-num">
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
        <div className="stripe-card" style={{ borderTop: '3px solid var(--success)' }}>
          <div className="widget-header-s1">
            <h3 className="text-section-title">{t('dashboard.sources.title')}</h3>
          </div>
          <div className="space-y-3">
            {sourceData.map(({ source, count, value }, idx) => {
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
                <div key={source} className="source-bar-s1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-subtitle">
                      {labels[source] || source}
                    </span>
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-semibold t-mono-num">
                        {count} ({pct}%)
                      </span>
                      <span
                        className="text-[10px] t-mono-num"
                        style={{ color: 'var(--success)' }}
                      >
                        {(value / 1000).toFixed(1)}K $
                      </span>
                    </div>
                  </div>
                  <div
                    className="w-full h-2 rounded-full overflow-hidden"
                    style={{ background: 'var(--bg-muted)' }}
                  >
                    <div
                      className="source-bar-fill-s1 source-bar-fill-animate"
                      style={{
                        width: `${pct}%`,
                        animationDelay: `${idx * 0.15}s`,
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
