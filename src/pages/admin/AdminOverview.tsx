// ── AdminOverview — Sprint 46 M2.2 ───────────────────────────
// Dashboard org-wide pour admins/owners : 5 KPIs + period selector + 2 charts.
//
// KPIs :
//   1. Total users (count)
//   2. Active monthly (DAU/MAU ratio)
//   3. Leads créés ce mois
//   4. Conversion rate %
//   5. Revenue MRR
//
// Charts (lazy recharts via composant dédié) :
//   - LineChart users growth (UsersGrowthChart)
//   - BarChart leads / conversions (LeadsConversionsChart)
//
// + UserActivityHeatmap (M2.3) + FeatureUsageTable (M2.4).
//
// Endpoint : GET /api/admin/overview?period=30d (stub)

import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { t } from '@/lib/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHero, KpiStrip, type KpiItem, Card, Skeleton, Icon, Tag, Button } from '@/components/ui';
import { UserActivityHeatmap } from '@/components/admin/UserActivityHeatmap';
import { FeatureUsageTable } from '@/components/admin/FeatureUsageTable';
import {
  Users, Activity, TrendingUp, Target, DollarSign,
  BarChart3, RefreshCw,
} from 'lucide-react';

// Lazy chart pour ne pas tirer recharts sur le bundle initial admin.
// [§6.C.4] UsersGrowthChart retiré : la série usersGrowth était 100%
// Math.random côté worker (aucune source réelle d'« active » historique).
const LazyLeadsConversionsChart = lazy(() => import('@/components/admin/charts/LeadsConversionsChart'));

type OverviewPeriod = '7d' | '30d' | '90d' | '1y';

function periodLabel(p: OverviewPeriod): string {
  switch (p) {
    case '7d': return t('admin.period_7d');
    case '30d': return t('admin.period_30d');
    case '90d': return t('admin.period_90d');
    case '1y': return t('admin.period_1y');
  }
}


// [LOT RÉEL §6.C.4] Les champs honnêtes peuvent être `null` quand aucune
// source réelle n'existe (mrr, deltas, activeMonthly si feature_events absente,
// conversionRate si aucun lead). Le front affiche un état honnête, JAMAIS un
// chiffre fabriqué (generateMockOverview supprimé).
interface OverviewData {
  totalUsers: number;
  activeMonthly: number | null;
  leadsThisMonth: number;
  conversionRate: number | null; // 0-1 | null si aucun lead ce mois
  mrr: number | null;            // null tant qu'aucune facturation réelle
  // Deltas vs période précédente (en %) — null si non calculables
  deltaTotalUsers: number | null;
  deltaActiveMonthly: number | null;
  deltaLeads: number | null;
  deltaConversion: number | null;
  deltaMrr: number | null;
  // Charts data — série réelle (GROUP BY date côté worker)
  leadsConversions: { label: string; leads: number; conversions: number }[];
}

// [LOT RÉEL §6.C.4] Plus de fallback silencieux fabriqué : si l'API échoue ou
// renvoie une forme invalide ⇒ `null` (état honnête "pas encore de données"),
// jamais des chiffres inventés.
// [Sprint reinforcement] Discrimination : `error` distingue panne réseau / 5xx
// d'un état "pas encore de données" honnête (200 OK + payload vide).
type FetchOverviewResult =
  | { ok: true; data: OverviewData | null }
  | { ok: false; error: true };

async function fetchOverview(
  period: OverviewPeriod,
  token: string | null,
): Promise<FetchOverviewResult> {
  try {
    const res = await fetch(`/api/admin/overview?period=${period}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { ok: false, error: true };
    const data = await res.json() as { data?: Partial<OverviewData> } & Partial<OverviewData>;
    const payload = (data.data ?? data) as Partial<OverviewData>;
    if (payload && typeof payload.totalUsers === 'number') {
      return {
        ok: true,
        data: {
          totalUsers: payload.totalUsers,
          activeMonthly: payload.activeMonthly ?? null,
          leadsThisMonth: typeof payload.leadsThisMonth === 'number' ? payload.leadsThisMonth : 0,
          conversionRate: payload.conversionRate ?? null,
          mrr: payload.mrr ?? null,
          deltaTotalUsers: payload.deltaTotalUsers ?? null,
          deltaActiveMonthly: payload.deltaActiveMonthly ?? null,
          deltaLeads: payload.deltaLeads ?? null,
          deltaConversion: payload.deltaConversion ?? null,
          deltaMrr: payload.deltaMrr ?? null,
          leadsConversions: Array.isArray(payload.leadsConversions) ? payload.leadsConversions : [],
        },
      };
    }
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: true };
  }
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);
}

function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <Skeleton className="h-full w-full" />
    </div>
  );
}

export function AdminOverviewPage() {
  const [period, setPeriod] = useState<OverviewPeriod>('30d');
  const [data, setData] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // [Sprint reinforcement] État erreur distinct de "no data" (200 OK + vide).
  const [hasError, setHasError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setHasError(false);
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    fetchOverview(period, token).then(r => {
      if (cancelled) return;
      if (!r.ok) {
        setData(null);
        setHasError(true);
      } else {
        setData(r.data);
        setHasError(false);
      }
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [period, reloadKey]);

  // delta affiché UNIQUEMENT s'il est réellement calculé (number). null ⇒ pas
  // de delta (on n'invente pas de % de croissance).
  const deltaProps = (d: number | null) =>
    typeof d === 'number'
      ? { delta: `${d > 0 ? '+' : ''}${d}%`, deltaUp: d >= 0 }
      : {};

  const kpiItems: KpiItem[] = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: t('admin.kpi_users'),
        value: data.totalUsers,
        icon: <Icon as={Users} size={14} />,
        color: 'brand',
        ...deltaProps(data.deltaTotalUsers),
      },
      {
        label: t('admin.kpi_active_monthly'),
        // activeMonthly null ⇒ état honnête, pas un proxy inventé.
        value: data.activeMonthly === null ? t('admin.no_data_yet') : data.activeMonthly,
        icon: <Icon as={Activity} size={14} />,
        color: 'success',
        ...deltaProps(data.deltaActiveMonthly),
      },
      {
        label: t('admin.kpi_leads_month'),
        value: data.leadsThisMonth,
        icon: <Icon as={TrendingUp} size={14} />,
        color: 'info',
        ...deltaProps(data.deltaLeads),
      },
      {
        label: t('admin.kpi_conversion'),
        value: data.conversionRate === null ? t('admin.no_data_yet') : `${Math.round(data.conversionRate * 100)}%`,
        icon: <Icon as={Target} size={14} />,
        color: 'warning',
        ...deltaProps(data.deltaConversion),
      },
      {
        label: t('admin.kpi_mrr'),
        // §6.C : mrr reste null tant qu'aucune facturation réelle.
        value: data.mrr === null ? t('admin.mrr_unavailable') : formatCurrency(data.mrr),
        icon: <Icon as={DollarSign} size={14} />,
        color: 'accent',
        ...deltaProps(data.deltaMrr),
      },
    ];
  }, [data]);

  return (
    <AppLayout title={t('admin.layout_title')}>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <PageHero
          meta={t('admin.hero_meta')}
          title={t('admin.hero_title')}
          description={t('admin.hero_desc')}
          compact
          actions={
            <div role="tablist" aria-label={t('admin.period_aria')} className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-[12px] bg-[var(--bg-surface)]">
              {(['7d', '30d', '90d', '1y'] as OverviewPeriod[]).map(p => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={period === p}
                  onClick={() => setPeriod(p)}
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

        {isLoading ? (
          <Skeleton className="h-24 w-full" aria-busy="true" data-testid="admin-overview-loading" />
        ) : hasError ? (
          // [Sprint reinforcement] État erreur explicite : panne réseau / 5xx
          // distinct de "no data" (200 OK + payload vide). Bouton retry.
          <Card
            className="p-8 text-center border-dashed"
            aria-live="polite"
            data-testid="admin-overview-error"
          >
            <p className="t-h3 text-[var(--danger-text)] mb-2">{t('admin.error.load_failed')}</p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icon as={RefreshCw} size={14} />}
              onClick={reload}
              aria-label={t('action.retry')}
              data-testid="admin-overview-retry"
            >
              {t('action.retry')}
            </Button>
          </Card>
        ) : !data ? (
          // [§6.C.4] État honnête : aucune donnée réelle dispo (API OK + vide).
          // Plus de chiffres fabriqués.
          <Card className="p-8 text-center text-[var(--text-muted)] border-dashed" data-testid="admin-overview-empty">
            <p className="t-h3 text-[var(--text-primary)] mb-1">{t('admin.no_data_yet')}</p>
          </Card>
        ) : (
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <Tag variant="success" size="sm">{t('admin.data_real_badge')}</Tag>
            </div>
            <KpiStrip items={kpiItems} />
          </Card>
        )}

        {/* Série conversions RÉELLE (GROUP BY date côté worker). Le chart
            "users growth" a été retiré : il était 100% Math.random sans source
            réelle (§6.C.4 — ne plus afficher de chiffre inventé). */}
        {!isLoading && data && (
          <div className="grid gap-4 grid-cols-1">
            <Card className="p-5">
              <header className="flex items-center gap-2 mb-3">
                <Icon as={BarChart3} size={14} className="text-[var(--primary)]" />
                <h3 className="t-h3">{t('admin.chart_leads_conversions')}</h3>
              </header>
              {data.leadsConversions.length === 0 ? (
                <div className="py-8 text-center text-[var(--text-muted)] text-[13px]">
                  {t('admin.no_data_yet')}
                </div>
              ) : (
                <Suspense fallback={<ChartSkeleton />}>
                  <LazyLeadsConversionsChart data={data.leadsConversions} />
                </Suspense>
              )}
            </Card>
          </div>
        )}

        {/* Heatmap activité — M2.3 */}
        <UserActivityHeatmap defaultPeriod="7d" />

        {/* Feature usage table — M2.4 */}
        <FeatureUsageTable />
      </div>
    </AppLayout>
  );
}
