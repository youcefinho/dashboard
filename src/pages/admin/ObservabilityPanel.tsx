// ── Sprint 24 — Observabilité : page admin (Manager-C remplissage) ───────────
//
// Layout : AppLayout + PageHero + tabs (Métriques | Alertes).
// Tab Métriques :
//   - Period selector (1h / 24h / 7d / 30d).
//   - KpiStrip (4 KPIs : LCP p75, error rate, p95 latency moyenne, total req).
//   - Card Health (uptime, version, db, ai_mock, last_migration).
//   - Card Web Vitals (table p75 par metric_name).
//   - Card top routes (route, count, p50, p95, p99, error rate).
//   - Card erreurs récentes (action, count, last_at).
// Tab Alertes : <AlertRulesPanel />.
//
// API : fetchObservabilityHealth / fetchRequestMetrics / fetchErrorMetrics /
// fetchWebVitalsObservability (lib/api.ts FIGÉ Phase A).
// i18n : `observability.*` (33 clés, FIGÉES Phase A).
// Best-effort : si une API échoue ou renvoie `unavailable: true` → EmptyState
// avec `observability.metrics_unavailable`, jamais de crash.
// Route /admin/observability câblée par Phase A dans App.tsx (LazyGuard +
// AdminGuard) — ce composant n'a pas à re-check les rôles.

import { useEffect, useMemo, useState } from 'react';
import { t } from '@/lib/i18n';
import {
  fetchObservabilityHealth,
  fetchRequestMetrics,
  fetchErrorMetrics,
  fetchWebVitalsObservability,
} from '@/lib/api';
import type { ObservabilityHealth, RequestMetricsBucket } from '@/lib/types';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHero,
  Card,
  KpiStrip,
  type KpiItem,
  Skeleton,
  EmptyState,
  Tag,
  Icon,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui';
import { AlertRulesPanel } from '@/components/admin/AlertRulesPanel';
import { PerfBudgetCard } from '@/components/admin/PerfBudgetCard';
import { ReleaseGatesPanel } from '@/components/admin/ReleaseGatesPanel';
import {
  Activity,
  Server,
  Zap,
  AlertOctagon,
  TrendingUp,
  Gauge,
  HeartPulse,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';

type Period = '1h' | '24h' | '7d' | '30d';
type PanelTab = 'metrics' | 'alerts' | 'release_gates';

interface ErrorRow {
  action: string;
  count: number;
  last_at: string;
}

interface VitalRow {
  metric_name: string;
  count: number;
  avg: number;
  p75: number;
}

function periodLabel(p: Period): string {
  switch (p) {
    case '1h': return t('observability.period_1h');
    case '24h': return t('observability.period_24h');
    case '7d': return t('observability.period_7d');
    case '30d': return t('observability.period_30d');
  }
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ObservabilityPanel() {
  const [tab, setTab] = useState<PanelTab>('metrics');
  const [period, setPeriod] = useState<Period>('24h');
  const [health, setHealth] = useState<ObservabilityHealth | null>(null);
  const [metrics, setMetrics] = useState<RequestMetricsBucket[]>([]);
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [vitals, setVitals] = useState<VitalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [allFailed, setAllFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAllFailed(false);
    // fetchWebVitalsObservability ne supporte pas '1h' — on retombe à 24h.
    const vitalsPeriod: '24h' | '7d' | '30d' = period === '1h' ? '24h' : period;

    Promise.all([
      fetchObservabilityHealth().catch(() => ({ error: 'fetch_failed' as const })),
      fetchRequestMetrics(period).catch(() => ({ error: 'fetch_failed' as const })),
      fetchErrorMetrics(period).catch(() => ({ error: 'fetch_failed' as const })),
      fetchWebVitalsObservability(vitalsPeriod).catch(() => ({ error: 'fetch_failed' as const })),
    ])
      .then(([h, m, e, v]) => {
        if (cancelled) return;
        const hOk = 'data' in h && !!h.data;
        const mOk = 'data' in m && !!m.data;
        const eOk = 'data' in e && !!e.data;
        const vOk = 'data' in v && !!v.data;
        setHealth(hOk ? h.data! : null);
        setMetrics(mOk ? (m.data!.metrics ?? []) : []);
        setErrors(eOk ? (e.data!.errors ?? []) : []);
        setVitals(vOk ? (v.data!.metrics ?? []) : []);
        // Show a global banner only when ALL four sources failed — otherwise
        // per-card EmptyState already communicates the partial outage.
        if (!hOk && !mOk && !eOk && !vOk) {
          setAllFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period, reloadKey]);

  // KPIs dérivés des metrics/vitals — null/— si donnée absente.
  const kpis = useMemo<KpiItem[]>(() => {
    const lcp = vitals.find((v) => v.metric_name === 'LCP')?.p75 ?? null;
    const totalReq = metrics.reduce((s, m) => s + m.count, 0);
    const totalErr = metrics.reduce((s, m) => s + m.error_count, 0);
    const errorRate = totalReq > 0 ? (totalErr / totalReq) * 100 : null;
    const p95Avg =
      metrics.length > 0
        ? Math.round(metrics.reduce((s, m) => s + m.p95_ms, 0) / metrics.length)
        : null;

    return [
      {
        label: `${t('observability.web_vitals_lcp')} ${t('observability.web_vitals_p75')}`,
        value: lcp !== null ? `${lcp.toFixed(0)} ms` : '—',
        icon: <Icon as={Gauge} size={12} />,
        color: 'brand',
      },
      {
        label: t('observability.requests_error_rate'),
        value: errorRate !== null ? `${errorRate.toFixed(1)} %` : '—',
        icon: <Icon as={AlertOctagon} size={12} />,
        color: errorRate !== null && errorRate >= 1 ? 'danger' : 'success',
      },
      {
        label: t('observability.requests_p95'),
        value: p95Avg !== null ? `${p95Avg} ms` : '—',
        icon: <Icon as={Zap} size={12} />,
        color: 'info',
      },
      {
        label: t('observability.requests_total'),
        value: totalReq.toLocaleString(),
        icon: <Icon as={TrendingUp} size={12} />,
        color: 'accent',
      },
    ];
  }, [metrics, vitals]);

  // Petite courbe SVG inline (timeseries error rate par bucket route) — bonus.
  // Pas de recharts (perf bundle admin déjà chargé).
  const errorTrendPoints = useMemo(() => {
    if (metrics.length === 0) return null;
    const sorted = [...metrics].sort((a, b) => b.count - a.count).slice(0, 10);
    const max = Math.max(...sorted.map((m) => m.error_rate_pct), 1);
    return sorted.map((m, i) => {
      const x = (i / Math.max(1, sorted.length - 1)) * 100;
      const y = 100 - (m.error_rate_pct / max) * 100;
      return { x, y, label: m.route, value: m.error_rate_pct };
    });
  }, [metrics]);

  return (
    <AppLayout title={t('observability.title')}>
      <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="observability-panel">
        <PageHero
          meta={t('observability.tab_metrics')}
          title={t('observability.title')}
          description={t('observability.subtitle')}
          compact
          actions={
            <div
              role="tablist"
              aria-label={t('observability.tab_metrics')}
              className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-[12px] bg-[var(--bg-surface)]"
            >
              {(['1h', '24h', '7d', '30d'] as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={period === p}
                  onClick={() => setPeriod(p)}
                  data-testid={`period-${p}`}
                  className={`px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer ${
                    period === p
                      ? 'bg-[var(--primary-soft)] text-[var(--primary)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {periodLabel(p)}
                </button>
              ))}
            </div>
          }
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)}>
          <TabsList>
            <TabsTrigger value="metrics" data-testid="tab-metrics">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={BarChart3} size="sm" />
                {t('observability.tab_metrics')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="alerts" data-testid="tab-alerts">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={AlertOctagon} size="sm" />
                {t('observability.tab_alerts')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="release_gates" data-testid="tab-release-gates">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={ShieldCheck} size="sm" />
                {t('release_gates.title')}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* ── Tab Métriques ──────────────────────────────────── */}
          <TabsContent value="metrics" className="space-y-6 mt-4">
            {/* Global error banner — only when all four sources failed. */}
            {!loading && allFailed && (
              <div
                role="alert"
                className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft,rgba(239,68,68,0.08))] p-4 flex items-center justify-between gap-3"
                data-testid="observability-load-error"
              >
                <p className="text-sm text-[var(--danger)] flex-1">
                  {t('observability.toast_load_error')}
                </p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  data-testid="observability-retry"
                  className="px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer transition-colors"
                >
                  {t('observability.retry_all')}
                </button>
              </div>
            )}

            {/* KPI strip */}
            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <Card className="p-5">
                <KpiStrip items={kpis} />
              </Card>
            )}

            {/* Sprint 25 — Web Vitals budgets vs web.dev/vitals thresholds */}
            {!loading && <PerfBudgetCard vitals={vitals} />}

            {/* Health card */}
            <Card className="p-5">
              <header className="flex items-center gap-2 mb-3">
                <Icon as={HeartPulse} size={14} className="text-[var(--primary)]" />
                <h3 className="t-h3">{t('observability.health_title')}</h3>
                {health && (
                  <Tag
                    variant={health.status === 'ok' ? 'success' : 'danger'}
                    dot
                    size="sm"
                  >
                    {health.status === 'ok'
                      ? t('observability.health_status_ok')
                      : t('observability.health_status_error')}
                  </Tag>
                )}
              </header>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : health ? (
                <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <dt className="t-meta">{t('observability.health_uptime')}</dt>
                    <dd className="text-[var(--text-primary)] font-medium tabular-nums">
                      {formatUptime(health.uptime_s)}
                    </dd>
                  </div>
                  <div>
                    <dt className="t-meta">{t('observability.health_version')}</dt>
                    <dd className="text-[var(--text-primary)] font-mono text-xs">
                      {health.version}
                    </dd>
                  </div>
                  <div>
                    <dt className="t-meta">{t('observability.health_db')}</dt>
                    <dd>
                      <Tag
                        variant={health.db === 'ok' ? 'success' : 'danger'}
                        size="sm"
                        dot
                      >
                        {health.db === 'ok' ? '✓' : '✗'}
                      </Tag>
                    </dd>
                  </div>
                  <div>
                    <dt className="t-meta">{t('observability.health_ai_mock')}</dt>
                    <dd className="text-[var(--text-primary)]">
                      {health.ai_mock ? '✓' : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="t-meta">{t('observability.health_last_migration')}</dt>
                    <dd className="text-[var(--text-primary)] font-mono text-xs">
                      {health.last_migration ?? '—'}
                    </dd>
                  </div>
                </dl>
              ) : (
                <EmptyState
                  variant="compact"
                  icon={<Icon as={Server} size={28} />}
                  title={t('observability.metrics_unavailable')}
                />
              )}
            </Card>

            {/* Web Vitals card */}
            <Card className="p-5">
              <header className="flex items-center gap-2 mb-3">
                <Icon as={Gauge} size={14} className="text-[var(--primary)]" />
                <h3 className="t-h3">{t('observability.web_vitals_title')}</h3>
              </header>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : vitals.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)]">
                        <th className="py-2 pr-3 font-medium">
                          {t('observability.web_vitals_title')}
                        </th>
                        <th className="py-2 pr-3 font-medium tabular-nums">
                          {t('observability.web_vitals_p75')}
                        </th>
                        <th className="py-2 pr-3 font-medium tabular-nums">
                          {t('observability.requests_total')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {vitals.map((v) => (
                        <tr
                          key={v.metric_name}
                          className="border-t border-[var(--border-subtle)]"
                        >
                          <td className="py-2 pr-3 font-medium text-[var(--text-primary)]">
                            {v.metric_name}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {v.p75.toFixed(0)} ms
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-[var(--text-secondary)]">
                            {v.count.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  variant="compact"
                  icon={<Icon as={Gauge} size={28} />}
                  title={t('observability.metrics_unavailable')}
                />
              )}
            </Card>

            {/* Top routes */}
            <Card className="p-5">
              <header className="flex items-center gap-2 mb-3">
                <Icon as={Activity} size={14} className="text-[var(--primary)]" />
                <h3 className="t-h3">{t('observability.requests_top_routes')}</h3>
              </header>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : metrics.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[var(--text-muted)]">
                          <th className="py-2 pr-3 font-medium">Route</th>
                          <th className="py-2 pr-3 font-medium tabular-nums">
                            {t('observability.requests_total')}
                          </th>
                          <th className="py-2 pr-3 font-medium tabular-nums">
                            {t('observability.requests_p50')}
                          </th>
                          <th className="py-2 pr-3 font-medium tabular-nums">
                            {t('observability.requests_p95')}
                          </th>
                          <th className="py-2 pr-3 font-medium tabular-nums">
                            {t('observability.requests_p99')}
                          </th>
                          <th className="py-2 pr-3 font-medium tabular-nums">
                            {t('observability.requests_error_rate')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.slice(0, 10).map((m) => (
                          <tr
                            key={m.route}
                            className="border-t border-[var(--border-subtle)]"
                          >
                            <td className="py-2 pr-3 font-mono text-xs text-[var(--text-primary)]">
                              {m.route}
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {m.count.toLocaleString()}
                            </td>
                            <td className="py-2 pr-3 tabular-nums">{m.p50_ms} ms</td>
                            <td className="py-2 pr-3 tabular-nums">{m.p95_ms} ms</td>
                            <td className="py-2 pr-3 tabular-nums">{m.p99_ms} ms</td>
                            <td className="py-2 pr-3 tabular-nums">
                              <span
                                className={
                                  m.error_rate_pct >= 1
                                    ? 'text-[var(--danger)]'
                                    : 'text-[var(--text-secondary)]'
                                }
                              >
                                {m.error_rate_pct.toFixed(1)} %
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* SVG sparkline inline — error_rate distribution top 10 routes */}
                  {errorTrendPoints && errorTrendPoints.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                      <p className="t-meta mb-2">
                        {t('observability.requests_error_rate')} —{' '}
                        {t('observability.requests_top_routes')}
                      </p>
                      <svg
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="w-full h-16"
                        aria-hidden="true"
                      >
                        <polyline
                          fill="none"
                          stroke="var(--danger)"
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                          points={errorTrendPoints
                            .map((p) => `${p.x},${p.y}`)
                            .join(' ')}
                        />
                        {errorTrendPoints.map((p, i) => (
                          <circle
                            key={i}
                            cx={p.x}
                            cy={p.y}
                            r="1"
                            fill="var(--danger)"
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </svg>
                    </div>
                  )}
                </>
              ) : (
                <EmptyState
                  variant="compact"
                  icon={<Icon as={AlertOctagon} size={28} />}
                  title={t('observability.metrics_unavailable')}
                />
              )}
            </Card>

            {/* Errors */}
            <Card className="p-5">
              <header className="flex items-center gap-2 mb-3">
                <Icon as={AlertOctagon} size={14} className="text-[var(--danger)]" />
                <h3 className="t-h3">{t('observability.errors_title')}</h3>
              </header>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : errors.length > 0 ? (
                <ul className="space-y-2">
                  {errors.slice(0, 10).map((e) => (
                    <li
                      key={e.action}
                      className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-subtle)] last:border-b-0"
                    >
                      <span className="font-mono text-xs text-[var(--text-primary)] truncate">
                        {e.action}
                      </span>
                      <span className="flex items-center gap-3 whitespace-nowrap">
                        <Tag variant="danger" size="sm" dot>
                          {e.count}×
                        </Tag>
                        <span className="text-xs text-[var(--text-muted)]">
                          {new Date(e.last_at).toLocaleString()}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  variant="compact"
                  icon={<Icon as={AlertOctagon} size={28} />}
                  title={t('observability.errors_empty')}
                />
              )}
            </Card>
          </TabsContent>

          {/* ── Tab Alertes ────────────────────────────────────── */}
          <TabsContent value="alerts" className="mt-4">
            <AlertRulesPanel />
          </TabsContent>

          {/* ── Tab Release Gates (Sprint 30) ───────────────────── */}
          <TabsContent value="release_gates" className="mt-4">
            <ReleaseGatesPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
