// ── FunnelStatsPanel — surface les analytics funnel-level (getFunnelStats) ───
//
// Consomme le helper FIGÉ `getFunnelStats(funnelId)` (interface FunnelStats :
// total_views / total_submissions / total_conversions / conversion_rate /
// views_by_day[]). Ce helper était jusqu'ici INVISIBLE — non consommé par
// aucune page. On le rend visible via un funnel stage-by-stage :
//   Views → Submissions → Conversions, avec drop-off entre chaque étape.
//
// Style Stripe-clean. Imports RELATIFS (calque FunnelAnalytics.tsx). a11y :
// loading aria-busy, erreur role=alert + retry, sparkline aria-hidden. i18n :
// clés NEUVES sous 'funnelx.*' uniquement ; réutilise 'funnel.analytics.*' +
// 'common.*' existantes. Aucun console.log. 100% additif.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, BarChart3, Eye, Send, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { Sparkline } from '../ui/Sparkline';
import { getFunnelStats, type FunnelStats } from '../../lib/api';
import { t, getLocale } from '../../lib/i18n';

// ── Props ────────────────────────────────────────────────────────────────────

export interface FunnelStatsPanelProps {
  funnelId: string;
  /** Nom du funnel (header contextuel). */
  funnelName?: string;
}

// ── Helpers de formatage (locale-aware) ──────────────────────────────────────

function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '0';
  try {
    return new Intl.NumberFormat(getLocale()).format(v);
  } catch {
    return new Intl.NumberFormat('fr-CA').format(v);
  }
}

/** Fraction 0..1 → '12,3 %' (locale-aware, 1 décimale). */
function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  try {
    return new Intl.NumberFormat(getLocale(), {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(v);
  } catch {
    return `${(v * 100).toFixed(1)} %`;
  }
}

/**
 * `conversion_rate` arrive en string depuis l'API (ex '12.3' ou '12.3%').
 * On le normalise en fraction 0..1 pour fmtPct. Tolère null/NaN.
 */
function parseRate(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(String(raw).replace('%', '').replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return n / 100;
}

/** Drop-off entre deux étapes (fraction 0..1 du trafic perdu). */
function dropoff(from: number, to: number): number {
  if (from <= 0) return 0;
  return Math.max(0, 1 - to / from);
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function FunnelStatsPanel({ funnelId, funnelName }: FunnelStatsPanelProps) {
  const [stats, setStats] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!funnelId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getFunnelStats(funnelId);
      if (res.error || !res.data) {
        setStats(null);
        setLoadError(res.error || t('common.error.load_failed'));
      } else {
        setStats(res.data);
      }
    } catch {
      // CLAUDE.md « Aucun console.log » — swallow + état erreur (retry dispo).
      setStats(null);
      setLoadError(t('common.error.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [funnelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const views = stats?.total_views ?? 0;
  const submissions = stats?.total_submissions ?? 0;
  const conversions = stats?.total_conversions ?? 0;
  const isEmpty =
    !loading &&
    !loadError &&
    views === 0 &&
    submissions === 0 &&
    conversions === 0;

  // Les 3 étapes du funnel funnel-level (vues → soumissions → conversions).
  const stages = [
    {
      key: 'views',
      label: t('funnel.analytics.views'),
      icon: Eye,
      value: views,
      // Drop-off mesuré par rapport à l'étape précédente (la 1re = base 0).
      drop: null as number | null,
    },
    {
      key: 'submissions',
      label: t('funnel.analytics.submissions'),
      icon: Send,
      value: submissions,
      drop: dropoff(views, submissions),
    },
    {
      key: 'conversions',
      label: t('funnel.analytics.conversions'),
      icon: CheckCircle2,
      value: conversions,
      drop: dropoff(submissions, conversions),
    },
  ];

  const maxStage = Math.max(views, submissions, conversions, 1);
  const rate = parseRate(stats?.conversion_rate);
  const byDay = stats?.views_by_day ?? [];

  return (
    <div className="space-y-5" aria-busy={loading || undefined}>
      {/* Header — contexte funnel + refresh */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {funnelName
              ? t('funnelx.stats.title_named', { name: funnelName })
              : t('funnelx.stats.title')}
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            {t('funnelx.stats.subtitle')}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Icon as={RefreshCw} size="sm" aria-hidden="true" />}
          onClick={() => void load()}
          aria-label={t('funnelx.stats.refresh')}
          isLoading={loading}
        >
          {t('funnelx.stats.refresh')}
        </Button>
      </div>

      {/* Erreur (role=alert + retry) */}
      {loadError && !loading ? (
        <div
          role="alert"
          data-testid="funnel-stats-error"
          className="p-4 rounded-lg border border-[var(--danger-soft,var(--border-subtle))] bg-[var(--danger-soft,var(--bg-subtle))] flex items-start justify-between gap-3 flex-wrap"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--danger,var(--text-primary))]">
              {t('common.error.title')}
            </p>
            <p className="text-xs text-[var(--text-secondary)] break-words">
              {loadError}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Icon as={RefreshCw} size="sm" aria-hidden="true" />}
            onClick={() => void load()}
            aria-label={t('common.retry')}
            data-testid="funnel-stats-retry"
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {/* Loading skeletons */}
      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-3">
                <Skeleton className="h-3 w-16 mb-2" />
                <Skeleton className="h-6 w-12" />
              </Card>
            ))}
          </div>
          <Skeleton className="h-32 w-full" />
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon={<Icon as={BarChart3} size={32} aria-hidden="true" />}
          title={t('funnelx.stats.empty')}
          description={t('funnelx.stats.empty_desc')}
        />
      ) : loadError ? null : (
        <>
          {/* Funnel stage-by-stage : views → submissions → conversions */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('funnelx.stats.stages')}
              </h4>
              <span className="text-xs text-[var(--text-muted)]">
                {t('funnel.analytics.rate')}:{' '}
                <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                  {fmtPct(rate)}
                </span>
              </span>
            </div>
            <ol className="space-y-3" aria-label={t('funnelx.stats.stages')}>
              {stages.map((stage) => {
                const widthPct = Math.round((stage.value / maxStage) * 100);
                return (
                  <li key={stage.key}>
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <Icon
                          as={stage.icon}
                          size="sm"
                          aria-hidden="true"
                        />
                        {stage.label}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                          {fmtInt(stage.value)}
                        </span>
                        {stage.drop != null ? (
                          <span
                            className="text-xs tabular-nums text-[var(--text-muted)]"
                            title={t('funnelx.stats.dropoff')}
                          >
                            ↓ {fmtPct(stage.drop)}{' '}
                            <span className="sr-only">
                              {t('funnelx.stats.dropoff')}
                            </span>
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div
                      className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-soft,var(--bg-subtle))]"
                      role="meter"
                      aria-label={stage.label}
                      aria-valuenow={stage.value}
                      aria-valuemin={0}
                      aria-valuemax={maxStage}
                    >
                      <div
                        className="h-full rounded-full bg-[var(--brand,var(--text-primary))] transition-[width]"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          {/* Views by day — sparkline */}
          <Card className="p-4">
            <h4 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
              {t('funnel.analytics.by_day')}
            </h4>
            {byDay.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                {t('funnelx.stats.no_daily')}
              </p>
            ) : (
              <div>
                <div aria-hidden="true">
                  <Sparkline
                    data={byDay.map((d) => d.count)}
                    width={320}
                    height={56}
                    className="w-full"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-muted)] tabular-nums">
                  <span>{byDay[0]?.day}</span>
                  <span>{byDay[byDay.length - 1]?.day}</span>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export default FunnelStatsPanel;
