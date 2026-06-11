// ── DashboardHero — Greeting + période + actions (Sprint S1) ───────────
// Utilise les nouvelles classes CSS S1. Logique métier inchangée.

import { Download, Settings2, Sun, Moon, CloudSun } from 'lucide-react';
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

  const hour = new Date().getHours();
  const greeting = hour < 12
    ? t('dashboard.greeting.morning')
    : hour < 18
      ? t('dashboard.greeting.afternoon')
      : t('dashboard.greeting.evening');

  // Date longue formatée (ex: "mercredi 11 juin 2026")
  const longDate = new Date().toLocaleDateString('fr-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="dashboard-hero-s1">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="hero-date">{longDate}</p>
          <h2 className="hero-greeting greeting-animate">
            <span className="inline-flex items-center align-middle mr-1.5">
              {hour < 12
                ? <Sun size={22} className="text-amber-400 inline-block animate-pulse" />
                : hour < 18
                  ? <CloudSun size={22} className="text-orange-400 inline-block" />
                  : <Moon size={22} className="text-indigo-400 inline-block" />
              }
            </span>
            {greeting}{' '}
            <span className="text-[var(--primary)] greeting-name">
              {user?.name || 'Rochdi'}
            </span>{' '}
            👋
          </h2>
          <p className="hero-subtitle">
            {t('dashboard.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Sélecteur de période — segmented control S1 */}
          <div className="segmented-s1">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button
                key={p}
                onClick={() => onPeriodChange(p)}
                className={period === p ? 'active' : ''}
                aria-selected={period === p}
              >
                {p === '7d' ? t('dashboard.period.7d') : p === '30d' ? t('dashboard.period.30d') : t('dashboard.period.90d')}
              </button>
            ))}
          </div>

          {/* Export CSV */}
          <button
            onClick={() => void exportLeadsCsv()}
            className="btn-action-ghost-s1"
          >
            <Download size={16} />
            {t('dashboard.action.export')}
          </button>

          {/* Config toggle */}
          <button
            onClick={onToggleConfig}
            className={showConfig
              ? 'h-9 w-9 rounded-[var(--radius-md)] flex items-center justify-center transition-all duration-200 cursor-pointer bg-[var(--primary)] text-white hover:shadow-sm'
              : 'btn-action-ghost-s1 h-9 w-9 !px-0 justify-center'
            }
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
