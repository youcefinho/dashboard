import { ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import { STATUS_LABELS, STATUS_COLORS, type Lead } from '@/lib/types';
import { AVATAR_GRADIENTS } from '@/lib/avatarColors';

/** Extrait les initiales d'un nom (max 2 caractères) */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Affiche le temps écoulé depuis une date ISO en format lisible */
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

// ── Props ──

interface DashboardContactsProps {
  isLoading: boolean;
  recentLeads: Lead[];
  onViewAll: () => void;
  onLeadClick: (leadId: string) => void;
}

/**
 * Widget Derniers contacts
 * Affiche les leads récents en liste mobile et en table desktop.
 */
export function DashboardContacts({
  isLoading,
  recentLeads,
  onViewAll,
  onLeadClick,
}: DashboardContactsProps) {
  return (
    <div className="surface-card mb-8 animate-fade-in-up stagger-6" style={{ borderTop: '3px solid var(--primary)' }}>
      {/* En-tête */}
      <div className="surface-section px-4 sm:px-6 py-4 flex items-center justify-between border-b border-[var(--border)]">
        <div>
          <h3 className="text-section-title">
            {t('dashboard.contacts.title')}
          </h3>
          <p className="text-subtitle mt-0.5">
            {t('dashboard.contacts.subtitle', { count: recentLeads.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onViewAll}
            className="h-8 px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-200 cursor-pointer border border-[var(--border)] text-[var(--primary)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] hover:shadow-sm press-scale"
          >
            {t('dashboard.contacts.view_all')} <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* ── Mobile : card list (≤md) ── */}
      <div
        className="md:hidden divide-y"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-12 w-full" />
              </div>
            ))
          : recentLeads.map((lead, i) => {
              const score = lead.score ?? 0;
              const scoreColor =
                score >= 80
                  ? 'var(--success)'
                  : score >= 50
                    ? 'var(--warning)'
                    : 'var(--danger)';
              const statusColor =
                STATUS_COLORS[lead.status] || 'var(--text-muted)';
              const statusBg = `color-mix(in srgb, ${statusColor} 12%, transparent)`;
              return (
                <div
                  key={lead.id}
                  className="row-hover-reveal px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-[var(--bg-subtle)] transition"
                  style={{
                    borderTop:
                      i === 0 ? 'none' : '1px solid var(--border-subtle)',
                    borderLeft: `3px solid ${scoreColor}`,
                  }}
                  onClick={() => onLeadClick(lead.id)}
                >
                  {/* Avatar */}
                  <div
                    className="avatar-gradient avatar-sm"
                    style={{
                      background:
                        AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length],
                    }}
                  >
                    {getInitials(lead.name)}
                  </div>
                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium truncate">
                        {lead.name}
                      </span>
                      <span
                        className="status-badge shrink-0"
                        style={{ background: statusBg, color: statusColor }}
                      >
                        {STATUS_LABELS[lead.status]}
                      </span>
                    </div>
                    <div
                      className="flex items-center gap-2 text-[11px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span className="truncate">
                        {lead.source === 'website'
                          ? t('dashboard.source.website')
                          : lead.source === 'facebook'
                            ? t('dashboard.source.facebook')
                            : lead.source || t('dashboard.source.direct')}
                      </span>
                      <span>·</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {lead.deal_value
                          ? `${(lead.deal_value / 1000).toFixed(0)}k$`
                          : '—'}
                      </span>
                      <span>·</span>
                      <span
                        style={{
                          color: scoreColor,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        Score {score}
                      </span>
                    </div>
                  </div>
                  {/* Temps écoulé */}
                  <span
                    className="text-[10px] shrink-0"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {timeAgo(lead.created_at)}
                  </span>
                </div>
              );
            })}
      </div>

      {/* ── Desktop : table (≥md) ── */}
      <table className="hidden md:table w-full">
        <thead>
          <tr style={{ background: 'var(--bg-subtle)' }}>
            <th className="table-header-cell text-left px-6 py-2.5">
              {t('dashboard.contacts.col_contact')}
            </th>
            <th className="table-header-cell text-left px-4 py-2.5">
              {t('dashboard.contacts.col_status')}
            </th>
            <th className="table-header-cell text-left px-4 py-2.5">
              {t('dashboard.contacts.col_source')}
            </th>
            <th className="table-header-cell text-right px-4 py-2.5">
              {t('dashboard.contacts.col_value')}
            </th>
            <th className="table-header-cell text-left px-4 py-2.5">
              {t('dashboard.contacts.col_score')}
            </th>
            <th className="table-header-cell text-right px-6 py-2.5">
              {t('dashboard.contacts.col_activity')}
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-6 py-3">
                    <Skeleton className="h-8 w-full" />
                  </td>
                </tr>
              ))
            : recentLeads.map((lead, i) => {
                const score = lead.score ?? 0;
                const scoreColor =
                  score >= 80
                    ? 'var(--success)'
                    : score >= 50
                      ? 'var(--warning)'
                      : 'var(--danger)';
                const statusColor =
                  STATUS_COLORS[lead.status] || 'var(--text-muted)';
                const statusBg = `color-mix(in srgb, ${statusColor} 12%, transparent)`;
                return (
                  <tr
                    key={lead.id}
                    className="row-hover-reveal transition cursor-pointer hover:bg-[var(--bg-subtle)]"
                    style={{ borderTop: '1px solid var(--border-subtle)' }}
                    onClick={() => onLeadClick(lead.id)}
                  >
                    {/* Contact */}
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="avatar-gradient avatar-sm"
                          style={{
                            background:
                              AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length],
                          }}
                        >
                          {getInitials(lead.name)}
                        </div>
                        <div>
                          <div className="text-sm font-medium">
                            {lead.name}
                          </div>
                          <div
                            className="text-[11px]"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {lead.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        className="status-badge"
                        style={{
                          background: statusBg,
                          color: statusColor,
                        }}
                      >
                        ● {STATUS_LABELS[lead.status]}
                      </span>
                    </td>
                    {/* Source */}
                    <td
                      className="px-4 py-3 text-xs"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {lead.source === 'website'
                        ? t('dashboard.source.website')
                        : lead.source === 'facebook'
                          ? t('dashboard.source.facebook_ads')
                          : lead.source || t('dashboard.source.direct')}
                    </td>
                    {/* Valeur */}
                    <td
                      className="px-4 py-3 text-right text-sm font-semibold"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {lead.deal_value ? (
                        `${(lead.deal_value / 1000).toFixed(0)}k$`
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    {/* Score */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-16 h-2 rounded-full overflow-hidden"
                          style={{ background: 'var(--bg-muted)' }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              background: scoreColor,
                              width: `${score}%`,
                            }}
                          />
                        </div>
                        <span
                          className="text-xs font-medium"
                          style={{ fontVariantNumeric: 'tabular-nums', color: scoreColor }}
                        >
                          {score}
                        </span>
                      </div>
                    </td>
                    {/* Activité */}
                    <td
                      className="px-6 py-3 text-right text-xs"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {timeAgo(lead.created_at)}
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
