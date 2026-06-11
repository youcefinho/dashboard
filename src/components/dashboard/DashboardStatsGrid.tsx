// ── DashboardStatsGrid — Grille de 4 KPIs (Giga Sprint Design) ──────────
// Extrait de Dashboard.tsx. Orchestre les 4 StatCards avec skeleton loading.

import { Users, Target, DollarSign, Zap } from 'lucide-react';
import { StatCard } from './StatCard';
import { t } from '@/lib/i18n';
import type { DashboardStats } from '@/lib/types';

interface DashboardStatsGridProps {
  stats: DashboardStats | null;
  isLoading: boolean;
}

export function DashboardStatsGrid({ stats, isLoading }: DashboardStatsGridProps) {
  // Sparkline data pour les stat cards
  const sparkPts = (stats?.leads_by_day || []).map(d => d.count);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat-card">
            <div className="skeleton-shimmer h-24 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <StatCard
        label={t('dashboard.stat.contacts')}
        value={stats?.total_leads ?? 0}
        icon={<Users size={20} />}
        iconBg="var(--brand-tint)"
        iconColor="var(--primary)"
        sparkColor="#009DDB"
        sparkData={sparkPts}
        className="stagger-1"
      />
      <StatCard
        label={t('dashboard.stat.pipeline_value')}
        value={`${((stats?.total_deal_value ?? 0) / 1000).toFixed(1)}K $`}
        icon={<DollarSign size={20} />}
        iconBg="var(--success-soft)"
        iconColor="var(--success)"
        sparkColor="#37CA37"
        sparkData={sparkPts.slice(-7)}
        className="stagger-2"
      />
      <StatCard
        label={t('dashboard.stat.conversion')}
        value={`${stats?.conversion_rate ?? 0}%`}
        icon={<Target size={20} />}
        iconBg="var(--accent-orange-soft)"
        iconColor="var(--accent-orange)"
        sparkColor="#D96E27"
        className="stagger-3"
      />
      <StatCard
        label={t('dashboard.stat.revenue')}
        value={`${((stats?.revenue_value ?? 0) / 1000).toFixed(1)}K $`}
        icon={<Zap size={20} />}
        iconBg="var(--info-soft)"
        iconColor="var(--info)"
        sparkColor="#188BF6"
        className="stagger-4"
      />
    </div>
  );
}
