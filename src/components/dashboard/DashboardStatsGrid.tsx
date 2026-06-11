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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat-card">
            <div className="skeleton-shimmer h-24 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard
        label={t('dashboard.stat.contacts')}
        value={stats?.total_leads ?? 0}
        icon={<Users size={20} />}
        iconBg="rgba(99, 91, 255, 0.10)"
        iconColor="#635BFF"
        accentColor="#635BFF"
        sparkColor="#635BFF"
        sparkData={sparkPts}
        className="stagger-1"
      />
      <StatCard
        label={t('dashboard.stat.pipeline_value')}
        value={`${((stats?.total_deal_value ?? 0) / 1000).toFixed(1)}K $`}
        icon={<DollarSign size={20} />}
        iconBg="rgba(16, 185, 129, 0.10)"
        iconColor="#10B981"
        accentColor="#10B981"
        sparkColor="#10B981"
        sparkData={sparkPts.slice(-7)}
        className="stagger-2"
      />
      <StatCard
        label={t('dashboard.stat.conversion')}
        value={`${stats?.conversion_rate ?? 0}%`}
        icon={<Target size={20} />}
        iconBg="rgba(245, 158, 11, 0.10)"
        iconColor="#F59E0B"
        accentColor="#F59E0B"
        sparkColor="#F59E0B"
        className="stagger-3"
      />
      <StatCard
        label={t('dashboard.stat.revenue')}
        value={`${((stats?.revenue_value ?? 0) / 1000).toFixed(1)}K $`}
        icon={<Zap size={20} />}
        iconBg="rgba(59, 130, 246, 0.10)"
        iconColor="#3B82F6"
        accentColor="#3B82F6"
        sparkColor="#3B82F6"
        className="stagger-4"
      />
    </div>
  );
}
