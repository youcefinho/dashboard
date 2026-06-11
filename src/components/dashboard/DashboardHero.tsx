// ── DashboardHero — Greeting + période + actions (Giga Sprint Design) ───
// Extrait de Dashboard.tsx. Utilise les nouvelles classes CSS au lieu de
// styles inline. Animation d'entrée fadeInUp.

import { Download, Settings2 } from 'lucide-react';
import { exportLeadsCsv } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';

type Period = '7d' | '30d' | '90d';

interface DashboardHeroProps {
  period: Period;
  onPeriodChange: (p: Period) => void;
  showConfig: boolean;
  onToggleConfig: () => void;
}

export function DashboardHero({
  period,
  onPeriodChange,
  showConfig,
  onToggleConfig,
}: DashboardHeroProps) {
  const { user } = useAuth();

  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const hour = new Date().getHours();
  const greeting = hour < 12
    ? t('dashboard.greeting.morning')
    : hour < 18
      ? t('dashboard.greeting.afternoon')
      : t('dashboard.greeting.evening');

  return (
    <div className="surface-card p-6 mb-8 animate-fade-in-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-meta-label mb-1">
            {t('dashboard.period.days', { days: periodDays })}
          </p>
          <h2 className="text-page-title">
            {greeting}{' '}
            <span className="text-[var(--primary)]">
              {user?.name || 'Rochdi'}
            </span>{' '}
            👋
          </h2>
          <p className="text-subtitle mt-1.5">
            {t('dashboard.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Sélecteur de période — segmented control premium */}
          <div className="segmented-premium">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button
                key={p}
                onClick={() => onPeriodChange(p)}
                className={`segmented-premium-item ${period === p ? 'active' : ''}`}
                aria-selected={period === p}
              >
                {p === '7d' ? t('dashboard.period.7d') : p === '30d' ? t('dashboard.period.30d') : t('dashboard.period.90d')}
              </button>
            ))}
          </div>

          {/* Export CSV */}
          <button
            onClick={() => void exportLeadsCsv()}
            className="h-9 px-3 rounded-[var(--radius-md)] text-sm font-medium flex items-center gap-2 transition hover:bg-[var(--bg-hover)] cursor-pointer border border-[var(--border)] text-[var(--text-secondary)] press-scale"
          >
            <Download size={16} />
            {t('dashboard.action.export')}
          </button>

          {/* Config toggle */}
          <button
            onClick={onToggleConfig}
            className={`h-9 w-9 rounded-[var(--radius-md)] flex items-center justify-center transition cursor-pointer press-scale ${
              showConfig
                ? 'bg-[var(--primary)] text-white'
                : 'hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-secondary)]'
            }`}
            title={t('dashboard.page.config_title')}
            aria-label={t('dashboard.page.config_aria')}
            aria-expanded={showConfig}
          >
            <Settings2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
