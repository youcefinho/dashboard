/**
 * DashboardChart — Widget graphique barres des leads par jour
 * Extrait de Dashboard.tsx (DashboardChartWidget lignes 382-416)
 * Utilise les classes CSS premium au lieu de styles inline
 */
import { Skeleton } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar,
} from 'recharts';

// ── Types ────────────────────────────────────────────────────
interface LeadsByDay {
  date: string;
  count: number;
}

interface DashboardChartProps {
  isLoading: boolean;
  leadsData: Array<LeadsByDay>;
  periodDays: number;
}

// ── Composant ────────────────────────────────────────────────
export function DashboardChart({ isLoading, leadsData, periodDays }: DashboardChartProps) {
  return (
    <div className="chart-container animate-fade-in-up stagger-3">
      {/* En-tête du graphique */}
      <div className="chart-header">
        <div>
          <h3 className="text-section-title">{t('dashboard.chart.title')}</h3>
          <p className="text-subtitle">{t('dashboard.chart.subtitle', { days: periodDays })}</p>
        </div>
        <div className="chart-legend">
          <span className="flex items-center gap-1.5">
            <span className="chart-legend-dot" style={{ background: 'var(--primary)' }} />
            <span className="text-subtitle">{t('dashboard.chart.website')}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="chart-legend-dot" style={{ background: 'var(--accent-orange)' }} />
            <span className="text-subtitle">{t('dashboard.chart.facebook')}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="chart-legend-dot" style={{ background: 'var(--success)' }} />
            <span className="text-subtitle">{t('dashboard.chart.referral')}</span>
          </span>
        </div>
      </div>

      {/* Contenu : skeleton ou graphique */}
      {isLoading ? (
        <div className="skeleton-shimmer h-48 w-full rounded-[var(--radius-md)]" />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={leadsData}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickFormatter={(v: string) => v.slice(5)}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              width={25}
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
            />
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
            <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#009DDB" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
