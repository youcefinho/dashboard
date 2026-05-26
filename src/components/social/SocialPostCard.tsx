// ── SocialPostCard — carte d'un post existant (statut + actions) ────────────
// LOT SOCIAL PLANNER (Sprint 9) — Manager-C (front). Affiche un post du planner
// avec son statut (draft|queued|processing|published|failed), ses réseaux
// ciblés, l'échéance de planification + actions éditer/supprimer/planifier.
// AUCUN CSS global. Libellés via t('social.*').

import { Button, Tag } from '@/components/ui';
import { Pencil, Trash2, CalendarClock } from 'lucide-react';
import type { SocialPost } from '@/lib/types';
import { NetworkIcon } from './NetworkPreview';
import { t } from '@/lib/i18n';

/** statut applicatif → variante de Tag (sobre) + libellé i18n. */
const STATUS_META: Record<string, { variant: 'neutral' | 'info' | 'warning' | 'success' | 'danger'; key: string }> = {
  draft: { variant: 'neutral', key: 'social.status.draft' },
  queued: { variant: 'info', key: 'social.status.queued' },
  processing: { variant: 'warning', key: 'social.status.processing' },
  published: { variant: 'success', key: 'social.status.published' },
  failed: { variant: 'danger', key: 'social.status.failed' },
};

interface SocialPostCardProps {
  post: SocialPost;
  onEdit: (post: SocialPost) => void;
  onDelete: (post: SocialPost) => void;
  onSchedule: (post: SocialPost) => void;
}

export function SocialPostCard({ post, onEdit, onDelete, onSchedule }: SocialPostCardProps) {
  const meta = STATUS_META[post.status] ?? { variant: 'neutral' as const, key: 'social.status.draft' };
  const networks = post.networks ?? [];
  const media = post.media ?? [];

  return (
    <div className="px-4 py-3.5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Tag dot size="xs" variant={meta.variant}>{t(meta.key)}</Tag>
            {networks.map((n) => (
              <span key={n} className="inline-flex items-center" title={t(`social.network.${n}`)}>
                <NetworkIcon provider={n} />
              </span>
            ))}
            {post.scheduled_at && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <CalendarClock size={11} />
                {new Date(post.scheduled_at).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words line-clamp-3">
            {post.content?.trim() ? post.content : <span className="text-[var(--text-muted)] italic">—</span>}
          </p>
          {media.length > 0 && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1">{media.length} {t('social.media_label').toLowerCase()}</p>
          )}
          {post.status === 'failed' && post.error && (
            <p className="text-[11px] text-[var(--danger)] mt-1 truncate">{post.error}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" leftIcon={<CalendarClock size={13} />} onClick={() => onSchedule(post)}>
            {t('social.schedule')}
          </Button>
          {/* Édition : icône seule (pas de clé social.edit figée — on ne crée pas de clé). */}
          <Button size="sm" variant="ghost" aria-label={t('social.composer')} onClick={() => onEdit(post)}>
            <Pencil size={13} />
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<Trash2 size={13} />} onClick={() => onDelete(post)}>
            {t('social.delete')}
          </Button>
        </div>
      </div>
    </div>
  );
}
