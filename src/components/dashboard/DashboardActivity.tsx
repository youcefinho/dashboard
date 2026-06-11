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

/** Couleur du dot timeline selon le type d'activité (Vague 1B) */
function dotColorForType(action: string): string {
  if (action.includes('call') || action.includes('phone')) return '#10B981';
  if (action.includes('email') || action.includes('sms')) return 'var(--primary)';
  if (action.includes('note')) return 'var(--text-muted)';
  if (action.includes('status') || action.includes('update')) return 'var(--warning)';
  if (action.includes('task')) return '#8B5CF6';
  if (action.includes('create') || action.includes('add')) return 'var(--success)';
  if (action.includes('delete') || action.includes('remove')) return 'var(--danger)';
  return 'var(--text-muted)';
}

interface DashboardActivityProps {
  isLoading: boolean;
  activities: Array<ActivityLogEntry>;
  onViewAll: () => void;
}

// ── Composant ────────────────────────────────────────────────
export function DashboardActivity({ isLoading, activities, onViewAll }: DashboardActivityProps) {
  return (
    <div className="stripe-card animate-stagger stagger-5" style={{ borderTop: '3px solid var(--primary)' }}>
      {/* En-tête */}
      <div className="widget-header-s1">
        <h3 className="text-section-title tracking-tight">{t('dashboard.activity.title')}</h3>
        <button onClick={onViewAll} className="widget-action-btn">
          {t('dashboard.activity.view_all')} <ArrowRight size={14} />
        </button>
      </div>

      {/* Liste d'activités avec timeline */}
      <div className="activity-timeline-s1">
        <div className="timeline-line" />
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-12 w-full rounded-[var(--radius-md)]" />
          ))
        ) : activities.length > 0 ? (
          activities.slice(0, 5).map((activity, i) => {
            let details: Record<string, string> = {};
            try { details = JSON.parse(activity.details); } catch { /* json invalide */ }
            return (
              <div key={activity.id} className="activity-item-s1 group">
                {/* Timeline dot coloré par type */}
                <div
                  className={`timeline-dot-s1 ${i === 0 ? 'timeline-dot-s1--active' : ''}`}
                  style={{ '--dot-color': dotColorForType(activity.action) } as React.CSSProperties}
                />

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
                  <div className="text-meta-label mt-0.5 t-mono-num">
                    {timeAgo(activity.created_at)} · {details.name || details.email || details.to || ''}
                  </div>
                  {/* Lien hover — Vague 1B */}
                  <span
                    className="text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200 inline-block mt-0.5"
                    style={{ color: 'var(--primary)' }}
                  >
                    Voir le lead →
                  </span>
                </div>

                {/* Flèche CTA */}
                <ArrowRight size={14} className="activity-cta-arrow" />
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
        className="btn-action-ghost-s1 w-full mt-5"
      >
        {t('dashboard.activity.view_all')}
      </button>
    </div>
  );
}
