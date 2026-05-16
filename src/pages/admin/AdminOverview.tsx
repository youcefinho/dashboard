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

import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHero, KpiStrip, type KpiItem, Card, Skeleton, Icon } from '@/components/ui';
import { UserActivityHeatmap } from '@/components/admin/UserActivityHeatmap';
import { FeatureUsageTable } from '@/components/admin/FeatureUsageTable';
import {
  Users, Activity, TrendingUp, Target, DollarSign,
  BarChart3, LineChart as LineChartIcon,
} from 'lucide-react';

// Lazy charts pour ne pas tirer recharts sur le bundle initial admin
const LazyUsersGrowthChart = lazy(() => import('@/components/admin/charts/UsersGrowthChart'));
const LazyLeadsConversionsChart = lazy(() => import('@/components/admin/charts/LeadsConversionsChart'));

type OverviewPeriod = '7d' | '30d' | '90d' | '1y';

const PERIOD_LABELS: Record<OverviewPeriod, string> = {
  '7d': '7 jours',
  '30d': '30 jours',
  '90d': '90 jours',
  '1y': '1 an',
};

const PERIOD_POINTS: Record<OverviewPeriod, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 12,   // 12 buckets de ~7j
  '1y': 12,    // 12 mois
};

interface OverviewData {
  totalUsers: number;
  activeMonthly: number;
  leadsThisMonth: number;
  conversionRate: number; // 0-1
  mrr: number;            // CAD
  // Deltas vs période précédente (en %)
  deltaTotalUsers: number;
  deltaActiveMonthly: number;
  deltaLeads: number;
  deltaConversion: number;
  deltaMrr: number;
  // Charts data
  usersGrowth: { label: string; users: number; active: number }[];
  leadsConversions: { label: string; leads: number; conversions: number }[];
}

function generateMockOverview(period: OverviewPeriod): OverviewData {
  const points = PERIOD_POINTS[period];
  const usersGrowth: { label: string; users: number; active: number }[] = [];
  const leadsConversions: { label: string; leads: number; conversions: number }[] = [];
  let users = 142;
  for (let i = 0; i < points; i++) {
    users += Math.floor(Math.random() * 6 + 1);
    const active = Math.floor(users * (0.62 + Math.random() * 0.12));
    const leads = Math.floor(50 + Math.random() * 80 + i * 4);
    const conversions = Math.floor(leads * (0.18 + Math.random() * 0.10));
    const label = period === '1y'
      ? ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'][i % 12]!
      : period === '90d'
      ? `S${i + 1}`
      : `J${i + 1}`;
    usersGrowth.push({ label, users, active });
    leadsConversions.push({ label, leads, conversions });
  }
  return {
    totalUsers: users,
    activeMonthly: Math.floor(users * 0.68),
    leadsThisMonth: leadsConversions.reduce((a, b) => a + b.leads, 0),
    conversionRate: 0.22,
    mrr: 8420,
    deltaTotalUsers: 12,
    deltaActiveMonthly: 8,
    deltaLeads: 18,
    deltaConversion: -3,
    deltaMrr: 14,
    usersGrowth,
    leadsConversions,
  };
}

async function fetchOverview(period: OverviewPeriod, token: string | null): Promise<OverviewData> {
  try {
    const res = await fetch(`/api/admin/overview?period=${period}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json() as { data?: OverviewData } & OverviewData;
    const payload = (data.data ?? data) as Partial<OverviewData>;
    if (payload && typeof payload.totalUsers === 'number') {
      return payload as OverviewData;
    }
    throw new Error('invalid shape');
  } catch {
    return generateMockOverview(period);
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

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    fetchOverview(period, token).then(d => {
      if (!cancelled) {
        setData(d);
        setIsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [period]);

  const kpiItems: KpiItem[] = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: 'Utilisateurs',
        value: data.totalUsers,
        icon: <Icon as={Users} size={14} />,
        color: 'brand',
        delta: `${data.deltaTotalUsers > 0 ? '+' : ''}${data.deltaTotalUsers}%`,
        deltaUp: data.deltaTotalUsers >= 0,
      },
      {
        label: 'Actifs / mois',
        value: data.activeMonthly,
        icon: <Icon as={Activity} size={14} />,
        color: 'success',
        delta: `${data.deltaActiveMonthly > 0 ? '+' : ''}${data.deltaActiveMonthly}%`,
        deltaUp: data.deltaActiveMonthly >= 0,
      },
      {
        label: 'Leads ce mois',
        value: data.leadsThisMonth,
        icon: <Icon as={TrendingUp} size={14} />,
        color: 'info',
        delta: `${data.deltaLeads > 0 ? '+' : ''}${data.deltaLeads}%`,
        deltaUp: data.deltaLeads >= 0,
      },
      {
        label: 'Conversion',
        value: `${Math.round(data.conversionRate * 100)}%`,
        icon: <Icon as={Target} size={14} />,
        color: 'warning',
        delta: `${data.deltaConversion > 0 ? '+' : ''}${data.deltaConversion}%`,
        deltaUp: data.deltaConversion >= 0,
      },
      {
        label: 'MRR',
        value: formatCurrency(data.mrr),
        icon: <Icon as={DollarSign} size={14} />,
        color: 'accent',
        delta: `${data.deltaMrr > 0 ? '+' : ''}${data.deltaMrr}%`,
        deltaUp: data.deltaMrr >= 0,
      },
    ];
  }, [data]);

  return (
    <AppLayout title="Administration">
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <PageHero
          meta="Administration"
          title="Vue d'ensemble"
          description="Pilotage organisationnel : adoption, croissance, et activité utilisateurs."
          compact
          actions={
            <div role="tablist" aria-label="Période overview" className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-[12px] bg-[var(--bg-surface)]">
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
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          }
        />

        {isLoading || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <Card className="p-5">
            <KpiStrip items={kpiItems} />
            <p className="t-caption text-[var(--text-muted)] mt-2">
              Comparaison vs période précédente ({PERIOD_LABELS[period]}).
            </p>
          </Card>
        )}

        {/* 2 charts en grille responsive */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          <Card className="p-5">
            <header className="flex items-center gap-2 mb-3">
              <Icon as={LineChartIcon} size={14} className="text-[var(--primary)]" />
              <h3 className="t-h3">Croissance utilisateurs</h3>
            </header>
            {isLoading || !data ? (
              <ChartSkeleton />
            ) : (
              <Suspense fallback={<ChartSkeleton />}>
                <LazyUsersGrowthChart data={data.usersGrowth} />
              </Suspense>
            )}
          </Card>

          <Card className="p-5">
            <header className="flex items-center gap-2 mb-3">
              <Icon as={BarChart3} size={14} className="text-[var(--primary)]" />
              <h3 className="t-h3">Leads & conversions</h3>
            </header>
            {isLoading || !data ? (
              <ChartSkeleton />
            ) : (
              <Suspense fallback={<ChartSkeleton />}>
                <LazyLeadsConversionsChart data={data.leadsConversions} />
              </Suspense>
            )}
          </Card>
        </div>

        {/* Heatmap activité — M2.3 */}
        <UserActivityHeatmap defaultPeriod="7d" />

        {/* Feature usage table — M2.4 */}
        <FeatureUsageTable />
      </div>
    </AppLayout>
  );
}
