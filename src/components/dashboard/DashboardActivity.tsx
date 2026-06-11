/**
 * DashboardActivity — Widget activité récente
 * Extrait de Dashboard.tsx (partie activité dans DashboardChartWidget, lignes 418-458)
 * Utilise les classes CSS premium au lieu de styles inline
 */
import { t } from '@/lib/i18n';
import { ACTIVITY_LABELS } from '@/lib/types';

// ── Couleurs avatars gradient (copie locale — même array que Dashboard.tsx) ──
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #009DDB 0%, #188BF6 100%)',
  'linear-gradient(135deg, #D96E27 0%, #FF9A00 100%)',
  'linear-gradient(135deg, #757BBD 0%, #D6BCFA 100%)',
  'linear-gradient(135deg, #37CA37 0%, #81E6D9 100%)',
  'linear-gradient(135deg, #E93D3D 0%, #FBB6CE 100%)',
  'linear-gradient(135deg, #F6AD55 0%, #FAF089 100%)',
];

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

// ── Types ────────────────────────────────────────────────────
interface ActivityItem {
  id: string;
  user_name: string;
  action: string;
  details: string;
  created_at: string;
}

interface DashboardActivityProps {
  isLoading: boolean;
  activities: Array<ActivityItem>;
  onViewAll: () => void;
}

// ── Composant ────────────────────────────────────────────────
export function DashboardActivity({ isLoading, activities, onViewAll }: DashboardActivityProps) {
  return (
    <div className="surface-card p-5 animate-fade-in-up stagger-4">
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
              <div key={activity.id} className="flex gap-3 cursor-pointer row-hover-reveal">
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
                      {ACTIVITY_LABELS[activity.action] || activity.action}
                    </span>
                  </div>
                  <div className="text-meta-label mt-0.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {timeAgo(activity.created_at)} · {details.name || details.email || details.to || ''}
                  </div>
                </div>
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
        className="w-full mt-5 text-xs font-semibold py-2 rounded-lg transition cursor-pointer hover:bg-[var(--brand-tint)]"
        style={{ color: 'var(--primary)' }}
      >
        {t('dashboard.activity.view_all')}
      </button>
    </div>
  );
}
