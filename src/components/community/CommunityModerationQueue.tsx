// ── CommunityModerationQueue — Sprint 45 (Agent B2) ─────────────────────────
//
// File de modération du forum communautaire interne (LOT COMMUNITY S45,
// seq140). Liste les actions modération journalisées (`c45_moderation_actions`)
// avec filtres + form manuel pour modérer une cible (thread|comment) en mode
// hide|delete|warn|ban.
//
// Helpers FIGÉS consommés (cf src/lib/api.ts §9963-9984) :
//   - listModerationActions(filters?) → ApiResponse<CommunityModerationAction[]>
//   - moderateTarget(input)           → ApiResponse<CommunityModerationAction>
//
// i18n : namespace `community_forum.moderation.*` (clés FIGÉES, cf
// src/lib/i18n/fr-CA.ts §5972-5977). Parité 4 catalogues garantie côté B1.
//
// Style : Stripe-clean (Card/Badge/Button/Input/Select/Textarea du DS).
// Imports RELATIFS (consigne agent B2 sprint 45).

import { useEffect, useMemo, useState } from 'react';
import {
  listModerationActions,
  moderateTarget,
  type CommunityModerationAction,
  type CommunityModerationActionType,
  type CommunityTargetType,
} from '../../lib/api';
import { t } from '../../lib/i18n';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useConfirm } from '../ui/ConfirmDialog';
import { Shield } from 'lucide-react';

// ── Helpers presentation ────────────────────────────────────────────────────

/** Couleur de la badge par action (hide=jaune, delete=rouge, warn=orange, ban=noir). */
function actionBadgeColor(action: CommunityModerationActionType): string {
  switch (action) {
    case 'hide':
      return '#EAB308'; // jaune (warning)
    case 'delete':
      return '#DC2626'; // rouge (danger)
    case 'warn':
      return '#F97316'; // orange
    case 'ban':
      return '#0B0B0B'; // noir
    default:
      return '#6B7280';
  }
}

/** Libellé i18n d'une action de modération. */
function actionLabel(action: CommunityModerationActionType): string {
  return t(`community_forum.moderation.${action}`);
}

/** Formatage date FR-CA court (YYYY-MM-DD HH:mm). */
function formatCreatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

/** Construit l'URL vers la cible (thread route = `/community#thread-:id`). */
function targetHref(targetType: CommunityTargetType, targetId: string): string {
  if (targetType === 'thread') return `/community?thread=${encodeURIComponent(targetId)}`;
  return `/community?comment=${encodeURIComponent(targetId)}`;
}

// ── Composant ────────────────────────────────────────────────────────────────

export function CommunityModerationQueue() {
  const confirm = useConfirm();
  const [actions, setActions] = useState<CommunityModerationAction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtres
  const [filterTargetType, setFilterTargetType] = useState<'' | CommunityTargetType>('');
  const [filterAction, setFilterAction] = useState<'' | CommunityModerationActionType>('');

  // Form modération manuelle
  const [formTargetType, setFormTargetType] = useState<CommunityTargetType>('thread');
  const [formTargetId, setFormTargetId] = useState<string>('');
  const [formAction, setFormAction] = useState<CommunityModerationActionType>('hide');
  const [formReason, setFormReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState(false);

  // ── Chargement initial + re-fetch sur changement de filtre ────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const filters: { target_type?: CommunityTargetType; action?: CommunityModerationActionType } = {};
    if (filterTargetType) filters.target_type = filterTargetType;
    if (filterAction) filters.action = filterAction;
    listModerationActions(filters)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
        } else if (res.data) {
          setActions(res.data);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('community_forum.moderation.network_error'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterTargetType, filterAction]);

  // ── Submit du form manuel ────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formTargetId.trim()) return;
    // Confirm sur actions destructives (delete = irréversible côté contenu,
    // ban = sanction utilisateur). hide/warn restent sans confirm (réversibles).
    if (formAction === 'delete' || formAction === 'ban') {
      const ok = await confirm({
        title: actionLabel(formAction),
        description: `${actionLabel(formAction)} — ${formTargetId.trim()}`,
        confirmLabel: actionLabel(formAction),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitOk(false);
    try {
      const res = await moderateTarget({
        target_type: formTargetType,
        target_id: formTargetId.trim(),
        action: formAction,
        reason: formReason.trim() || undefined,
      });
      if (res.error) {
        setSubmitError(res.error);
      } else if (res.data) {
        setSubmitOk(true);
        // Optimistic prepend dans la liste (re-trie par created_at desc côté serveur)
        setActions((prev) => [res.data!, ...prev]);
        setFormTargetId('');
        setFormReason('');
      }
    } catch {
      setSubmitError(t('community_forum.moderation.network_error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  const actionOptions: ReadonlyArray<CommunityModerationActionType> = useMemo(
    () => ['hide', 'delete', 'warn', 'ban'] as const,
    [],
  );

  return (
    <section
      aria-label={t('community_forum.moderation.queue')}
      className="flex flex-col gap-6"
    >
      {/* ── En-tête + filtres ──────────────────────────────────────────── */}
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-5 h-5 text-[var(--text-secondary)] shrink-0" aria-hidden="true" />
            <h2 className="t-h3 text-[var(--text-primary)] truncate">
              {t('community_forum.moderation.queue')}
            </h2>
          </div>
          <Badge intent="neutral" fill="soft">
            {actions.length}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label={t('community_forum.moderation.target')}
            value={filterTargetType}
            onChange={(e) => setFilterTargetType(e.target.value as '' | CommunityTargetType)}
            aria-label={t('community_forum.moderation.target_type')}
          >
            <option value="">{t('community_forum.moderation.all_targets')}</option>
            <option value="thread">{t('community_forum.moderation.target.threads_plural')}</option>
            <option value="comment">{t('community_forum.moderation.target.comments_plural')}</option>
          </Select>
          <Select
            label={t('community_forum.moderation.action')}
            value={filterAction}
            onChange={(e) =>
              setFilterAction(e.target.value as '' | CommunityModerationActionType)
            }
            aria-label={t('community_forum.moderation.action')}
          >
            <option value="">{t('community_forum.moderation.all_actions')}</option>
            {actionOptions.map((act) => (
              <option key={act} value={act}>
                {actionLabel(act)}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {/* ── Form modération manuelle ────────────────────────────────────── */}
      <Card>
        <h3 className="t-h4 text-[var(--text-primary)] mb-3">
          {t('community_forum.moderation.manual_title')}
        </h3>
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          aria-label={t('community_forum.moderation.manual_title')}
        >
          <Select
            label={t('community_forum.moderation.target_type')}
            value={formTargetType}
            onChange={(e) => setFormTargetType(e.target.value as CommunityTargetType)}
            aria-label={t('community_forum.moderation.target_type')}
            required
          >
            <option value="thread">{t('community_forum.moderation.target.thread')}</option>
            <option value="comment">{t('community_forum.moderation.target.comment')}</option>
          </Select>
          <Input
            label={t('community_forum.moderation.target_id')}
            value={formTargetId}
            onChange={(e) => setFormTargetId(e.target.value)}
            placeholder={t('community_forum.moderation.target_id_placeholder')}
            aria-label={t('community_forum.moderation.target_id')}
            required
          />
          <Select
            label={t('community_forum.moderation.action')}
            value={formAction}
            onChange={(e) => setFormAction(e.target.value as CommunityModerationActionType)}
            aria-label={t('community_forum.moderation.action')}
            required
          >
            {actionOptions.map((act) => (
              <option key={act} value={act}>
                {actionLabel(act)}
              </option>
            ))}
          </Select>
          <div className="sm:col-span-2">
            <Textarea
              value={formReason}
              onChange={(e) => setFormReason(e.target.value)}
              placeholder={t('community_forum.moderation.reason')}
              aria-label={t('community_forum.moderation.reason')}
              rows={3}
            />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs min-h-[1.25rem]" role="status" aria-live="polite">
              {submitError && (
                <span className="text-[var(--danger-text)]" role="alert">
                  {submitError}
                </span>
              )}
              {submitOk && (
                <span className="text-[var(--success-text)]">
                  {t('community_forum.moderation.action_saved')}
                </span>
              )}
            </div>
            <Button
              type="submit"
              disabled={isSubmitting || !formTargetId.trim()}
              isLoading={isSubmitting}
              aria-label={t('community_forum.moderation.apply')}
            >
              {isSubmitting
                ? t('community_forum.moderation.applying')
                : t('community_forum.moderation.apply')}
            </Button>
          </div>
        </form>
      </Card>

      {/* ── Liste des actions ───────────────────────────────────────────── */}
      <Card>
        <h3 className="t-h4 text-[var(--text-primary)] mb-3">
          {t('community_forum.moderation.history')}
        </h3>
        {isLoading ? (
          <div
            className="flex flex-col gap-2"
            role="status"
            aria-live="polite"
            aria-busy="true"
            aria-label={t('community_forum.moderation.history')}
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <div
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
            role="alert"
          >
            <p className="font-medium mb-1">
              {t('community_forum.moderation.error_load')}
            </p>
            <p className="text-xs opacity-80">{error}</p>
          </div>
        ) : actions.length === 0 ? (
          <EmptyState
            title={t('community_forum.moderation.no_actions')}
            description={t('community_forum.moderation.no_actions_filtered')}
            variant={filterTargetType || filterAction ? 'filtered' : 'first-time'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm border-collapse"
              aria-label={t('community_forum.moderation.history')}
            >
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('community_forum.moderation.target')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('community_forum.moderation.target_id')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('community_forum.moderation.action')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('community_forum.moderation.moderator')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('community_forum.moderation.reason')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('common.date')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] transition-colors"
                  >
                    <td className="py-2 pr-3 capitalize text-[var(--text-secondary)]">
                      {a.target_type === 'thread'
                        ? t('community_forum.moderation.target.thread')
                        : t('community_forum.moderation.target.comment')}
                    </td>
                    <td className="py-2 pr-3">
                      <a
                        href={targetHref(a.target_type, a.target_id)}
                        className="text-[var(--primary)] hover:underline font-mono text-xs"
                        aria-label={t('community_forum.moderation.open_target', { id: a.target_id })}
                      >
                        {a.target_id}
                      </a>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge color={actionBadgeColor(a.action)} fill="soft">
                        {actionLabel(a.action)}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)] text-xs font-mono">
                      {a.moderator_user_id ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)] max-w-xs truncate">
                      {a.reason ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-muted)] whitespace-nowrap text-xs">
                      {formatCreatedAt(a.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
