/**
 * DashboardActivity — Widget activité récente
 * Extrait de Dashboard.tsx (partie activité dans DashboardChartWidget, lignes 418-458)
 * Utilise les classes CSS premium au lieu de styles inline
 */
import { ArrowRight } from 'lucide-react';
import { t } from '@/lib/i18n';
import { ACTIVITY_LABELS, type ActivityLogEntry, type ActivityType } from '@/lib/types';
import { AVATAR_GRADIENTS } from '@/lib/avatarColors';

// ── Helpers locaux ───────────────────────────────────────────

/** Retourne les initiales (max 2 lettres) d'un nom */
function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

/** Retourne un libellé relatif ("il y a X min", etc.) */
function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 60) return t('dashboard.time.min_ago', { n: diffMin });
  if (diffH < 24) return t('dashboard.time.hours_ago', { n: diffH });
  if (diffD === 1) return t('dashboard.time.1d_ago');
  return t('dashboard.time.days_ago', { n: diffD });
}

interface DashboardActivityProps {
  isLoading: boolean;
  activities: Array<ActivityLogEntry>;
  onViewAll: () => void;
}

// ── Composant ────────────────────────────────────────────────
export function DashboardActivity({ isLoading, activities, onViewAll }: DashboardActivityProps) {
  return (
    <div className="surface-card p-6 animate-fade-in-up stagger-4">
      {/* En-tête */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-section-title tracking-tight">{t('dashboard.activity.title')}</h3>
      </div>

      {/* Liste d'activités */}
      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-12 w-full rounded-[var(--radius-md)]" />
          ))
        ) : activities.length > 0 ? (
          activities.slice(0, 5).map((activity, i) => {
            let details: Record<string, string> = {};
            try { details = JSON.parse(activity.details); } catch { /* json invalide */ }
            return (
              <div key={activity.id} className="activity-row flex gap-3 cursor-pointer rounded-lg px-3 py-2 -mx-3">
                {/* Timeline dot */}
                <div className={`timeline-dot ${i === 0 ? 'timeline-dot--active' : ''}`}
                  style={{ background: i === 0 ? 'var(--primary)' : 'var(--border-strong)', marginTop: '6px' }} />

                {/* Avatar gradient */}
                <div
                  className="avatar-gradient avatar-sm flex items-center justify-center text-[10px] font-semibold shrink-0"
                  style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], color: 'white' }}
                >
                  {getInitials(activity.user_name || 'Sys')}
                </div>

                {/* Contenu */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs leading-relaxed">
                    <span className="font-semibold">{activity.user_name || 'Système'}</span>{' '}
                    <span className="text-subtitle">
                      {ACTIVITY_LABELS[activity.action as ActivityType] || activity.action}
                    </span>
                  </div>
                  <div className="text-meta-label mt-0.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {timeAgo(activity.created_at)} · {details.name || details.email || details.to || ''}
                  </div>
                </div>

                {/* Flèche slide-in au hover */}
                <ArrowRight size={14} className="activity-arrow" />
              </div>
            );
          })
        ) : (
          <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>
            {t('dashboard.activity.empty')}
          </p>
        )}
      </div>

      {/* Bouton voir tout */}
      <button
        onClick={onViewAll}
        className="w-full mt-5 text-xs font-semibold py-2.5 rounded-lg transition-all duration-200 cursor-pointer text-[var(--primary)] border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] hover:shadow-sm press-scale"
      >
        {t('dashboard.activity.view_all')}
      </button>
    </div>
  );
}
