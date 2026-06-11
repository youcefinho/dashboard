// ── MrrDashboard — Sprint 46 (Agent B1) ─────────────────────────────────────
// Dashboard métriques MRR/ARR/churn/growth + tableau new_subs / churned_subs
// par snapshot + sparkline texte (top-N mois) sur l'évolution MRR.
//
// API back FIGÉE (Phase A) — `src/lib/api.ts` LOT-SUBSCRIPTIONS-ADV-S46 :
//   getMrrMetrics({ period_days })  → ApiResponse<MrrMetrics>
//     MrrMetrics = { mrr_cents, arr_cents, churn_rate, growth_rate,
//                    currency, snapshots: MrrSnapshot[] }
//
// Style : Stripe-clean, 4 KPI cards en grid, tableau snapshots sobre. Aucune
// dep graph lourde — sparkline pure HTML/CSS (barres ▁▂▃▄▅▆▇█) sur l'évolution
// MRR. Toutes chaînes via t(). aria-labels i18n. Imports RELATIFS.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCcw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  CalendarDays,
  Activity,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t, getLocale } from '../../lib/i18n';
import { formatMoneyCents } from '../../lib/i18n/number';
import { formatDate } from '../../lib/i18n/datetime';
import {
  getMrrMetrics,
  type MrrMetrics,
  type MrrSnapshot,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Formate un ratio (0..1, peut être négatif) en pourcentage à 1 décimale. */
function formatRate(rate: number, locale: string): string {
  if (!Number.isFinite(rate)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    }).format(rate);
  } catch {
    return `${(rate * 100).toFixed(1)} %`;
  }
}

/** Sparkline pure unicode : 8 niveaux (▁▂▃▄▅▆▇█) sur la série MRR. */
const SPARK_LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function renderSparkline(snapshots: readonly MrrSnapshot[]): string {
  if (snapshots.length === 0) return '';
  const values = snapshots.map((s) => s.mrr_cents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return SPARK_LEVELS[3]!.repeat(values.length);
  return values
    .map((v) => {
      const idx = Math.min(
        SPARK_LEVELS.length - 1,
        Math.max(0, Math.round(((v - min) / range) * (SPARK_LEVELS.length - 1))),
      );
      return SPARK_LEVELS[idx];
    })
    .join('');
}

interface KpiCardProps {
  icon: typeof DollarSign;
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
  testId: string;
}

function KpiCard({ icon, label, value, trend, testId }: KpiCardProps) {
  const trendIcon =
    trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : null;
  const trendColor =
    trend === 'up'
      ? 'text-emerald-600'
      : trend === 'down'
        ? 'text-rose-600'
        : 'text-[var(--text-muted)]';

  return (
    <div
      data-testid={testId}
      className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          {label}
        </span>
        <Icon as={icon} size="sm" className="text-[var(--text-muted)]" />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-[var(--text-primary)] font-mono">
          {value}
        </span>
        {trendIcon ? (
          <Icon as={trendIcon} size="sm" className={trendColor} />
        ) : null}
      </div>
    </div>
  );
}

// ── Composant ──────────────────────────────────────────────────────────────

export interface MrrDashboardProps {
  /** Fenêtre d'analyse en jours (défaut 30). */
  periodDays?: number;
}

export function MrrDashboard({ periodDays = 30 }: MrrDashboardProps = {}) {
  const { error: toastError } = useToast();
  const locale = useMemo(() => getLocale(), []);

  const [metrics, setMetrics] = useState<MrrMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    const res = await getMrrMetrics({ period_days: periodDays });
    if (res.error) {
      toastError(res.error);
      setMetrics(null);
    } else if (res.data) {
      setMetrics(res.data);
    }
    setLoading(false);
  }, [periodDays, toastError]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  // ── Dérivés ─────────────────────────────────────────────────────────────
  const currency = metrics?.currency ?? 'CAD';
  const snapshots = metrics?.snapshots ?? [];
  const hasData = metrics !== null && snapshots.length > 0;
  const sparkline = useMemo(() => renderSparkline(snapshots), [snapshots]);

  const growthTrend: 'up' | 'down' | 'neutral' =
    metrics == null
      ? 'neutral'
      : metrics.growth_rate > 0
        ? 'up'
        : metrics.growth_rate < 0
          ? 'down'
          : 'neutral';

  const churnTrend: 'up' | 'down' | 'neutral' =
    metrics == null
      ? 'neutral'
      : metrics.churn_rate > 0
        ? 'down' // churn positif = mauvais → flèche down rouge
        : 'neutral';

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="mrr-dashboard">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('subscriptions_adv.metrics.title')}</h2>
          <p className="t-caption text-[var(--gray-500)] mt-1 font-mono">
            {periodDays} j
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadMetrics()}
          disabled={loading}
          isLoading={loading}
          leftIcon={<Icon as={RefreshCcw} size="sm" />}
          aria-label={t('action.refresh')}
        >
          {t('action.refresh')}
        </Button>
      </header>

      {/* KPI cards */}
      {loading && metrics === null ? (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
          data-testid="mrr-kpi-loading"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            >
              <Skeleton className="h-3 w-24 mb-3" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>
      ) : metrics === null ? (
        <EmptyState
          icon={<Icon as={Activity} size={40} />}
          title={t('subscriptions_adv.history.empty')}
          action={
            <Button
              onClick={() => void loadMetrics()}
              leftIcon={<Icon as={RefreshCcw} size="sm" />}
            >
              {t('action.refresh')}
            </Button>
          }
        />
      ) : (
        <>
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
            data-testid="mrr-kpi-grid"
          >
            <KpiCard
              testId="kpi-mrr"
              icon={DollarSign}
              label={t('subscriptions_adv.metrics.mrr')}
              value={formatMoneyCents(metrics.mrr_cents, locale, currency)}
            />
            <KpiCard
              testId="kpi-arr"
              icon={CalendarDays}
              label={t('subscriptions_adv.metrics.arr')}
              value={formatMoneyCents(metrics.arr_cents, locale, currency)}
            />
            <KpiCard
              testId="kpi-churn"
              icon={TrendingDown}
              label={t('subscriptions_adv.metrics.churn_rate')}
              value={formatRate(metrics.churn_rate, locale)}
              trend={churnTrend}
            />
            <KpiCard
              testId="kpi-growth"
              icon={TrendingUp}
              label={t('subscriptions_adv.metrics.growth_rate')}
              value={formatRate(metrics.growth_rate, locale)}
              trend={growthTrend}
            />
          </div>

          {/* Sparkline + tableau snapshots */}
          {hasData ? (
            <section
              aria-labelledby="mrr-snapshots-heading"
              className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-3"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3
                  id="mrr-snapshots-heading"
                  className="font-semibold text-[var(--text-primary)]"
                >
                  {t('subscriptions_adv.metrics.new_subs')} /{' '}
                  {t('subscriptions_adv.metrics.churned_subs')}
                </h3>
                {sparkline ? (
                  <span
                    data-testid="mrr-sparkline"
                    aria-label={t('subscriptions_adv.metrics.mrr')}
                    className="font-mono text-base text-[var(--text-secondary)] tracking-tighter"
                  >
                    {sparkline}
                  </span>
                ) : null}
              </div>

              <div className="overflow-x-auto">
                <table
                  className="w-full text-sm"
                  aria-label={t('subscriptions_adv.metrics.title')}
                >
                  <thead>
                    <tr className="text-left text-xs text-[var(--text-muted)] uppercase tracking-wide border-b border-[var(--border-subtle)]">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium text-right">
                        {t('subscriptions_adv.metrics.mrr')}
                      </th>
                      <th className="py-2 pr-3 font-medium text-right">
                        {t('subscriptions_adv.metrics.new_subs')}
                      </th>
                      <th className="py-2 pr-3 font-medium text-right">
                        {t('subscriptions_adv.metrics.churned_subs')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr
                        key={s.id}
                        data-testid={`mrr-snapshot-row-${s.id}`}
                        className="border-b border-[var(--border-subtle)] last:border-b-0"
                      >
                        <td className="py-2 pr-3 text-[var(--text-muted)] whitespace-nowrap">
                          {formatDate(s.snapshot_date, locale)}
                        </td>
                        <td className="py-2 pr-3 font-mono text-right whitespace-nowrap">
                          {formatMoneyCents(s.mrr_cents, locale, s.currency)}
                        </td>
                        <td className="py-2 pr-3 font-mono text-right text-emerald-700">
                          +{s.new_subscriptions}
                        </td>
                        <td className="py-2 pr-3 font-mono text-right text-rose-700">
                          −{s.churned_subscriptions}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <EmptyState
              icon={<Icon as={Activity} size={32} />}
              title={t('subscriptions_adv.history.empty')}
            />
          )}
        </>
      )}
    </div>
  );
}
