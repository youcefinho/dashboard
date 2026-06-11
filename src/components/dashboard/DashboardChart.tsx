/**
 * DashboardChart — Widget graphique barres des leads par jour (Sprint S1)
 * Utilise les classes CSS S1 (widget-header-s1, animate-stagger).
 * Logique métier inchangée.
 * Vague 1B : hover dimming barres + légende pills toggle.
 */
import { useState } from 'react';
import { t } from '@/lib/i18n';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
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

// ── Définitions légende ──────────────────────────────────────
const LEGEND_ITEMS = [
  { key: 'website', color: 'var(--primary)', labelKey: 'dashboard.chart.website' },
  { key: 'facebook', color: 'var(--accent-orange)', labelKey: 'dashboard.chart.facebook' },
  { key: 'referral', color: 'var(--success)', labelKey: 'dashboard.chart.referral' },
] as const;

// ── Composant ────────────────────────────────────────────────
export function DashboardChart({ isLoading, leadsData, periodDays }: DashboardChartProps) {
  // État pour le hover dimming des barres
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // État pour la visibilité des séries (légende toggle)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  /** Toggle la visibilité d'une série dans la légende */
  const toggleSeries = (key: string) => {
    setHiddenSeries(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="stripe-card animate-stagger stagger-3" style={{ borderTop: '3px solid var(--primary)' }}>
      {/* En-tête du graphique — widget-header S1 */}
      <div className="widget-header-s1">
        <div>
          <h3 className="text-section-title">{t('dashboard.chart.title')}</h3>
          <p className="text-subtitle">{t('dashboard.chart.subtitle', { days: periodDays })}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Badge période */}
          <span className="trend-badge trend-badge--neutral">
            {t('dashboard.chart.last_days', { days: periodDays }) || `Derniers ${periodDays} jours`}
          </span>
        </div>
      </div>

      {/* Contenu : skeleton ou graphique */}
      {isLoading ? (
        <div className="skeleton-shimmer h-48 w-full rounded-[var(--radius-md)]" />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={leadsData}
            onMouseMove={(state) => {
              if (state && state.activeTooltipIndex !== undefined) {
                setActiveIndex(Number(state.activeTooltipIndex));
              }
            }}
            onMouseLeave={() => setActiveIndex(null)}
          >
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
                borderRadius: 'var(--radius-lg)',
                fontSize: '12px',
                fontWeight: 500,
                boxShadow: 'var(--shadow-md)',
                borderColor: 'var(--border)',
                padding: '8px 12px',
              }}
              cursor={{ fill: 'rgba(99, 91, 255, 0.06)' }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
              {leadsData.map((_, i) => (
                <Cell
                  key={i}
                  fill="var(--primary)"
                  fillOpacity={activeIndex === null || activeIndex === i ? 1 : 0.4}
                  style={{ transition: 'fill-opacity 0.2s ease' }}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Légende pills cliquables — toggle visibilité */}
      <div className="flex items-center justify-center gap-2 pt-4 pb-1">
        {LEGEND_ITEMS.map(({ key, color, labelKey }) => {
          const isHidden = hiddenSeries.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleSeries(key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
              style={{
                background: isHidden ? 'var(--bg-subtle)' : `color-mix(in srgb, ${color} 12%, transparent)`,
                color: isHidden ? 'var(--text-muted)' : color,
                border: `1px solid ${isHidden ? 'var(--border)' : `color-mix(in srgb, ${color} 25%, transparent)`}`,
                opacity: isHidden ? 0.6 : 1,
                cursor: 'pointer',
              }}
              aria-label={`Toggle ${t(labelKey)}`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0 transition-opacity duration-200"
                style={{
                  background: color,
                  opacity: isHidden ? 0.3 : 1,
                }}
              />
              {t(labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
