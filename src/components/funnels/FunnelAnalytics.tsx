// ── FunnelAnalytics — Sprint 44 LOT FUNNEL-S44 (Agent B2) ────────────────
// Dashboard analytics agrégées d'un funnel : KPIs globaux + breakdown étapes
// (views / conversions / rate / drop-off) + top variantes.
//
// Consomme helper FIGÉ Phase A : getFunnelAnalytics + interface
// FunnelStepAnalytics (steps_breakdown[] + conversion_rate + top_variants[]).
//
// Style Stripe-clean. Imports RELATIFS. aria-labels via t(). Aucun console.log.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  BarChart3,
  TrendingUp,
  Eye,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import {
  getFunnelAnalytics,
  type FunnelStepAnalytics,
} from '../../lib/api';
import { t, getLocale } from '../../lib/i18n';

// ── Props ────────────────────────────────────────────────────────────────────

export interface FunnelAnalyticsProps {
  funnelId: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** 0..1 → '12.3 %' (1 décimale). */
function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1).replace('.', ',')} %`;
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '0';
  // Locale-aware (was hardcoded 'fr-CA' — fixed Sprint S52 audit/renfort).
  try {
    return new Intl.NumberFormat(getLocale()).format(v);
  } catch {
    return new Intl.NumberFormat('fr-CA').format(v);
  }
}

// ── Composant ───────────────────────────────────────────────────────────────

export function FunnelAnalytics({ funnelId }: FunnelAnalyticsProps) {
  const { error: toastError } = useToast();
  const [analytics, setAnalytics] = useState<FunnelStepAnalytics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!funnelId) return;
    setLoading(true);
    setLoadError(null);
    const res = await getFunnelAnalytics(funnelId);
    if (res.error) {
      toastError(res.error);
      setAnalytics(null);
      setLoadError(res.error);
    } else if (res.data) {
      setAnalytics(res.data);
    }
    setLoading(false);
  }, [funnelId, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Totals dérivés ──────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const steps = analytics?.steps_breakdown ?? [];
    const totalViews = steps.reduce((acc, s) => acc + (s.views ?? 0), 0);
    const totalConversions = steps.reduce(
      (acc, s) => acc + (s.conversions ?? 0),
      0,
    );
    return { totalViews, totalConversions };
  }, [analytics]);

  const isEmpty =
    !loading &&
    (!analytics ||
      ((analytics.steps_breakdown?.length ?? 0) === 0 &&
        (analytics.top_variants?.length ?? 0) === 0));

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header — titre + refresh */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            {t('funnels.analytics.title')}
          </h2>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Icon as={RefreshCw} size="sm" aria-hidden="true" />}
          onClick={() => void load()}
          aria-label={t('funnels.analytics.refresh')}
          isLoading={loading}
        >
          {t('funnels.analytics.refresh')}
        </Button>
      </div>

      {/* Inline error (Sprint S52 audit/renfort — additif) */}
      {loadError && !loading ? (
        <div
          role="alert"
          data-testid="funnel-analytics-error"
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
            data-testid="funnel-analytics-retry"
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {/* Empty state */}
      {isEmpty && !loadError ? (
        <EmptyState
          icon={<Icon as={BarChart3} size={32} aria-hidden="true" />}
          title={t('funnels.analytics.empty')}
        />
      ) : (
        <>
          {/* KPIs — 3 cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label={t('funnels.analytics.conversion_rate')}
              value={fmtPct(analytics?.conversion_rate)}
              icon={TrendingUp}
              loading={loading}
            />
            <KpiCard
              label={t('funnels.analytics.total_views')}
              value={fmtInt(totals.totalViews)}
              icon={Eye}
              loading={loading}
            />
            <KpiCard
              label={t('funnels.analytics.total_conversions')}
              value={fmtInt(totals.totalConversions)}
              icon={CheckCircle2}
              loading={loading}
            />
          </div>

          {/* Steps breakdown */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
              {t('funnels.analytics.steps_breakdown')}
            </h3>
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase text-[var(--text-muted)]">
                      <th className="py-2 pr-3 font-medium">
                        {t('funnels.analytics.step_name')}
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        {t('funnels.analytics.views')}
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        {t('funnels.analytics.conversions')}
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        {t('funnels.analytics.conversion_rate')}
                      </th>
                      <th className="py-2 text-right font-medium">
                        {t('funnels.analytics.dropoff')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analytics?.steps_breakdown ?? []).map((s) => {
                      const dropoff =
                        s.views > 0
                          ? 1 - (s.conversions ?? 0) / s.views
                          : 0;
                      return (
                        <tr
                          key={s.step_id}
                          className="border-b border-[var(--border-subtle)] last:border-0"
                        >
                          <td className="py-2 pr-3 text-[var(--text-primary)]">
                            <span className="mr-2 inline-block w-6 rounded bg-[var(--bg-soft)] px-1.5 text-center text-xs tabular-nums text-[var(--text-muted)]">
                              {s.order_index + 1}
                            </span>
                            {s.step_name}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-[var(--text-primary)]">
                            {fmtInt(s.views)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-[var(--text-primary)]">
                            {fmtInt(s.conversions)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums font-semibold text-[var(--text-primary)]">
                            {fmtPct(s.conversion_rate)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-[var(--text-muted)]">
                            {fmtPct(dropoff)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Top variants */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
              {t('funnels.analytics.top_variants')}
            </h3>
            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : (analytics?.top_variants?.length ?? 0) === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                {t('funnels.analytics.empty')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase text-[var(--text-muted)]">
                      <th className="py-2 pr-3 font-medium">
                        {t('funnels.analytics.variant_name')}
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        {t('funnels.analytics.conversion_rate')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analytics?.top_variants ?? []).map((v) => (
                      <tr
                        key={v.variant_id}
                        className="border-b border-[var(--border-subtle)] last:border-0"
                      >
                        <td className="py-2 pr-3 text-[var(--text-primary)]">
                          {v.variant_name}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-semibold text-[var(--text-primary)]">
                          {fmtPct(v.conversion_rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ── KpiCard interne (3 KPIs en header) ──────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  loading,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  loading: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
        <Icon as={icon} size="sm" aria-hidden="true" />
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <div className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
          {value}
        </div>
      )}
    </Card>
  );
}

export default FunnelAnalytics;
