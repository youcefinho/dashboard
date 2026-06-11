// ── NpsAnalytics — Sprint 50 (Agent B1) ─────────────────────────────────────
// Dashboard NPS pour un survey : score (-100..+100, color gradient),
// promoters/passives/detractors % + distribution bar visuelle + total.
//
// API back FIGÉE (Phase A) :
//   getNpsAggregate(surveyId, 30|60|90) → ApiResponse<NpsAggregate | null>
//
// Style : Stripe-clean. Imports RELATIFS. aria-labels i18n.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, BarChart3, Users, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import { getNpsAggregate, type NpsAggregate } from '../../lib/api';

interface NpsAnalyticsProps {
  surveyId: string;
  /** 30 | 60 | 90 jours (default 30). */
  periodDays?: 30 | 60 | 90;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Maps NPS score ∈ [-100, +100] → couleur sémantique :
 *   < 0     → danger (rouge)
 *   0..30   → warning (jaune)
 *   30..50  → info (bleu)
 *   ≥ 50    → success (vert)
 */
function scoreColor(score: number): string {
  if (!Number.isFinite(score)) return 'var(--text-muted)';
  if (score < 0) return 'var(--danger)';
  if (score < 30) return 'var(--warning)';
  if (score < 50) return 'var(--info)';
  return 'var(--success)';
}

function scoreGradient(score: number): string {
  if (!Number.isFinite(score)) return 'var(--gray-100)';
  if (score < 0) {
    return 'linear-gradient(135deg, #FCA5A5 0%, #E93D3D 100%)';
  }
  if (score < 30) {
    return 'linear-gradient(135deg, #FCD34D 0%, #D97706 100%)';
  }
  if (score < 50) {
    return 'linear-gradient(135deg, #60A5FA 0%, #1D4ED8 100%)';
  }
  return 'linear-gradient(135deg, #34D399 0%, #059669 100%)';
}

function formatPct(numerator: number, denominator: number): string {
  if (!denominator) return '0 %';
  return `${Math.round((numerator / denominator) * 100)} %`;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function NpsAnalytics({ surveyId, periodDays = 30 }: NpsAnalyticsProps) {
  const { error: toastError } = useToast();
  const [aggregate, setAggregate] = useState<NpsAggregate | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await getNpsAggregate(surveyId, periodDays);
    if (res.error) {
      toastError(res.error);
      setAggregate(null);
      setLoadError(res.error);
    } else {
      setAggregate(res.data ?? null);
    }
    setLoading(false);
  }, [surveyId, periodDays, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodLabel = useMemo(() => {
    if (periodDays === 30) return t('surveys.nps.period_30');
    if (periodDays === 90) return t('surveys.nps.period_90');
    // 60 jours (et autres) — clé paramétrée locale-aware (Sprint S52 audit/renfort).
    return t('surveys.nps.period_days').replace('{n}', String(periodDays));
  }, [periodDays]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="space-y-4"
        data-testid="nps-analytics-loading"
        aria-busy="true"
        aria-live="polite"
      >
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        data-testid="nps-analytics-error"
        className="p-5 rounded-xl border border-[var(--danger-soft,var(--border-subtle))] bg-[var(--danger-soft,var(--bg-subtle))] flex flex-col items-center gap-3 text-center"
      >
        <p className="text-sm font-medium text-[var(--danger,var(--text-primary))]">
          {t('common.error.title')}
        </p>
        <p className="text-xs text-[var(--text-secondary)] max-w-md break-words">
          {loadError}
        </p>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Icon as={RefreshCw} size="sm" aria-hidden="true" />}
          onClick={() => void load()}
          aria-label={t('common.retry')}
          data-testid="nps-analytics-retry"
        >
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  const total = aggregate?.total_responses ?? 0;

  if (!aggregate || total === 0) {
    return (
      <div data-testid="nps-analytics-empty">
        <EmptyState
          icon={<Icon as={BarChart3} size={32} />}
          title={t('surveys.responses.title')}
          description={periodLabel}
        />
      </div>
    );
  }

  const promoters = aggregate.promoters_count ?? 0;
  const passives = aggregate.passives_count ?? 0;
  const detractors = aggregate.detractors_count ?? 0;
  const score = aggregate.nps_score ?? 0;

  const promotersPct = total > 0 ? (promoters / total) * 100 : 0;
  const passivesPct = total > 0 ? (passives / total) * 100 : 0;
  const detractorsPct = total > 0 ? (detractors / total) * 100 : 0;

  return (
    <section
      className="space-y-5"
      data-testid="nps-analytics"
      aria-labelledby="nps-analytics-title"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3
            id="nps-analytics-title"
            className="t-h3 text-[var(--text-primary)] flex items-center gap-2"
          >
            <Icon as={TrendingUp} size={20} />
            {t('surveys.nps.score')}
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">{periodLabel}</p>
        </div>
      </header>

      {/* ── Score hero card ───────────────────────────────────────────────── */}
      <div
        className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        data-testid="nps-score-card"
      >
        <div className="flex items-center gap-6 flex-wrap">
          <div
            className="shrink-0 w-32 h-32 rounded-2xl flex items-center justify-center text-white font-bold"
            style={{
              background: scoreGradient(score),
              fontSize: '40px',
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}
            role="img"
            aria-label={`${t('surveys.nps.score')}: ${score}`}
          >
            {score > 0 ? `+${score}` : `${score}`}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-medium"
              style={{ color: scoreColor(score) }}
            >
              {t('surveys.nps.score')}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
              {t('surveys.nps.formula_hint')}
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Icon as={Users} size={14} />
              <span>
                {total} {t('surveys.responses.title').toLowerCase()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI cards par segment ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label={t('surveys.nps.promoters')}
          sub={t('surveys.nps.promoters_range')}
          value={promoters}
          pct={formatPct(promoters, total)}
          color="var(--success)"
          background="rgba(16,185,129,0.08)"
          testId="kpi-promoters"
        />
        <KpiCard
          label={t('surveys.nps.passives')}
          sub={t('surveys.nps.passives_range')}
          value={passives}
          pct={formatPct(passives, total)}
          color="var(--gray-500)"
          background="var(--gray-100)"
          testId="kpi-passives"
        />
        <KpiCard
          label={t('surveys.nps.detractors')}
          sub={t('surveys.nps.detractors_range')}
          value={detractors}
          pct={formatPct(detractors, total)}
          color="var(--danger)"
          background="rgba(233,61,61,0.08)"
          testId="kpi-detractors"
        />
      </div>

      {/* ── Distribution bar ──────────────────────────────────────────────── */}
      <div
        className="space-y-2"
        data-testid="nps-distribution"
        aria-label={`${t('surveys.nps.distribution_aria')}: ${promoters} ${t('surveys.nps.promoters').toLowerCase()}, ${passives} ${t('surveys.nps.passives').toLowerCase()}, ${detractors} ${t('surveys.nps.detractors').toLowerCase()}`}
      >
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>{t('surveys.nps.distribution')}</span>
          <span>
            {total} {t('surveys.responses.title').toLowerCase()}
          </span>
        </div>
        <div
          className="h-3 w-full rounded-full overflow-hidden flex bg-[var(--gray-100)]"
          role="img"
          aria-label={t('surveys.nps.distribution_aria')}
        >
          {detractorsPct > 0 ? (
            <div
              style={{
                width: `${detractorsPct}%`,
                background: 'var(--danger)',
              }}
              title={`${t('surveys.nps.detractors')}: ${detractors} (${detractorsPct.toFixed(0)} %)`}
              data-testid="bar-detractors"
            />
          ) : null}
          {passivesPct > 0 ? (
            <div
              style={{
                width: `${passivesPct}%`,
                background: 'var(--gray-400)',
              }}
              title={`${t('surveys.nps.passives')}: ${passives} (${passivesPct.toFixed(0)} %)`}
              data-testid="bar-passives"
            />
          ) : null}
          {promotersPct > 0 ? (
            <div
              style={{
                width: `${promotersPct}%`,
                background: 'var(--success)',
              }}
              title={`${t('surveys.nps.promoters')}: ${promoters} (${promotersPct.toFixed(0)} %)`}
              data-testid="bar-promoters"
            />
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-[11px] text-[var(--text-muted)] mt-1">
          <Legend color="var(--danger)" label={t('surveys.nps.detractors')} />
          <Legend color="var(--gray-400)" label={t('surveys.nps.passives')} />
          <Legend color="var(--success)" label={t('surveys.nps.promoters')} />
        </div>
      </div>
    </section>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  sub?: string;
  value: number;
  pct: string;
  color: string;
  background: string;
  testId?: string;
}

function KpiCard({
  label,
  sub,
  value,
  pct,
  color,
  background,
  testId,
}: KpiCardProps) {
  return (
    <div
      className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ background: color }}
          aria-hidden="true"
        />
        <p className="text-xs font-medium text-[var(--text-secondary)]">
          {label}
          {sub ? (
            <span className="text-[var(--text-muted)] font-normal ml-1">
              {sub}
            </span>
          ) : null}
        </p>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className="text-2xl font-semibold"
          style={{ color }}
        >
          {value}
        </span>
        <span
          className="text-sm font-medium px-1.5 py-0.5 rounded"
          style={{ background, color }}
        >
          {pct}
        </span>
      </div>
    </div>
  );
}

interface LegendProps {
  color: string;
  label: string;
}

function Legend({ color, label }: LegendProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
