import { ArrowRight, Phone, Mail, ExternalLink } from 'lucide-react';
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
    <div className="stripe-card mb-8 animate-stagger stagger-7" style={{ borderTop: '3px solid var(--primary)', padding: 0 }}>
      {/* En-tête */}
      <div className="widget-header-s1 px-4 sm:px-6 py-4 border-b border-[var(--border)]">
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
            className="widget-action-btn"
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
                  className="contact-row-s1"
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
                      <span className="t-mono-num">
                        {lead.deal_value
                          ? `${(lead.deal_value / 1000).toFixed(0)}k$`
                          : '—'}
                      </span>
                      <span>·</span>
                      <span
                        className="t-mono-num"
                        style={{
                          color: scoreColor,
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
                    className="row-hover-reveal transition cursor-pointer hover:bg-[var(--bg-subtle)] group"
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
                      className="px-4 py-3 text-right text-sm font-semibold t-mono-num"
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
                        <div className="score-bar-s1">
                          <div
                            className="score-fill"
                            style={{
                              background: scoreColor,
                              width: `${score}%`,
                            }}
                          />
                        </div>
                        <span
                          className="text-xs font-medium t-mono-num"
                          style={{ color: scoreColor }}
                        >
                          {score}
                        </span>
                      </div>
                    </td>
                    {/* Activité + Actions hover — Vague 1B */}
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span
                          className="text-xs t-mono-num"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {timeAgo(lead.created_at)}
                        </span>
                        {/* Boutons d'action — apparaissent au hover */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <button
                            type="button"
                            className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                            onClick={(e) => { e.stopPropagation(); }}
                            aria-label="Téléphoner"
                            title="Téléphoner"
                          >
                            <Phone size={14} />
                          </button>
                          <button
                            type="button"
                            className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                            onClick={(e) => { e.stopPropagation(); }}
                            aria-label="Envoyer un email"
                            title="Envoyer un email"
                          >
                            <Mail size={14} />
                          </button>
                          <button
                            type="button"
                            className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                            onClick={(e) => { e.stopPropagation(); }}
                            aria-label="Voir la fiche"
                            title="Voir la fiche"
                          >
                            <ExternalLink size={14} />
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
