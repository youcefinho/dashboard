// ── ThreadsList — Sprint 45 (Agent B1) ─────────────────────────────────────
// Liste des threads forum (lecture + filtres + CRUD create).
// Click sur un thread → ouvre <ThreadDetail /> dans un SlidePanel droit.
//
// API back FIGÉE (Sprint 45 — paritaire worker seq140, cap leads.write / settings.manage) :
//   listThreads({ category?, status? })       → ApiResponse<CommunityThread[]>
//   createThread({ title, body, category })   → ApiResponse<CommunityThread>
//   pinThread(id, is_pinned)                  → ApiResponse<CommunityThread>
//   lockThread(id, is_locked)                 → ApiResponse<CommunityThread>
//   deleteThread(id)                          → ApiResponse<{ success }>
//   voteThread(id, 'up' | 'none')             → ApiResponse<{ ok, newCount }>
//
// Style : Stripe-clean, flat surfaces, focus ring purple, pin/lock pill discrets.
// Toutes les chaînes via t(). aria-labels i18n sur chaque action.
// Imports RELATIFS uniquement (règle Sprint 45 — pas d'alias @/).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  Pin,
  Lock,
  MessageCircle,
  ArrowUp,
  Users,
  Trash2,
  PinOff,
  LockOpen,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { SlidePanel } from '../ui/SlidePanel';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t, getLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import { useAuth } from '../../lib/auth';
import {
  listThreads,
  createThread,
  pinThread,
  lockThread,
  deleteThread,
  voteThread,
  type CommunityThread,
  type CommunityThreadStatus,
} from '../../lib/api';
import { ThreadDetail } from './ThreadDetail';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Catégories proposées par défaut côté UI. Le worker ne valide PAS une
 * whitelist côté SQL (champ libre `category` TEXT) — on garde une liste
 * cohérente pour le filtre + le formulaire. Extensible sans migration.
 */
const DEFAULT_CATEGORIES: ReadonlyArray<string> = [
  'general',
  'announcements',
  'help',
  'feedback',
  'showcase',
];

/** Statuts filtrables — whitelist HANDLER côté worker (open|hidden|deleted). */
const STATUSES: ReadonlyArray<CommunityThreadStatus> = [
  'open',
  'hidden',
  'deleted',
];

/** Tronque un body pour le preview liste (~120 chars, mot complet si possible). */
function truncatePreview(body: string, max = 120): string {
  const clean = body.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Label humain pour une catégorie (capitalise + fallback raw). */
function categoryLabel(cat: string): string {
  if (!cat) return '—';
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

/** Détermine si le user courant a un rôle modérateur/admin (whitelist user.role). */
function isModerator(role: string | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r === 'moderator' || r === 'admin' || r === 'owner';
}

// ── Composant ──────────────────────────────────────────────────────────────

export function ThreadsList() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const userIsModerator = isModerator(user?.role);

  const [threads, setThreads] = useState<CommunityThread[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [voted, setVoted] = useState<Set<string>>(new Set());

  // Filtres (envoyés au worker via query params)
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<CommunityThreadStatus | ''>(
    '',
  );

  // Modal CREATE
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [formTitle, setFormTitle] = useState<string>('');
  const [formBody, setFormBody] = useState<string>('');
  const [formCategory, setFormCategory] = useState<string>('general');
  const [submitting, setSubmitting] = useState<boolean>(false);

  // SlidePanel ThreadDetail
  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [detailThreadId, setDetailThreadId] = useState<string | null>(null);

  const locale = getLocale();

  // ── Chargement ────────────────────────────────────────────────────────
  const loadThreads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listThreads({
      category: filterCategory || undefined,
      status: filterStatus || undefined,
    });
    if (res.error) {
      toastError(res.error);
      setLoadError(res.error || t('community_forum.errors.load_failed'));
      setThreads([]);
    } else if (res.data) {
      setThreads(res.data);
    }
    setLoading(false);
  }, [filterCategory, filterStatus, toastError]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // ── Tri client : pinned d'abord, puis last_activity_at desc ───────────
  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return (
        new Date(b.last_activity_at).getTime() -
        new Date(a.last_activity_at).getTime()
      );
    });
  }, [threads]);

  // ── Modal helpers ─────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormBody('');
    setFormCategory('general');
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const title = formTitle.trim();
      const body = formBody.trim();
      const category = formCategory.trim() || 'general';
      if (!title || !body) return;
      setSubmitting(true);
      const res = await createThread({ title, body, category });
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setModalOpen(false);
      resetForm();
      void loadThreads();
    },
    [formTitle, formBody, formCategory, success, toastError, resetForm, loadThreads],
  );

  // ── Actions par thread ────────────────────────────────────────────────

  const handleVote = useCallback(
    async (thread: CommunityThread) => {
      const already = voted.has(thread.id);
      const direction: 'up' | 'none' = already ? 'none' : 'up';
      setBusyId(thread.id);
      const res = await voteThread(thread.id, direction);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      // Optimistic update du compteur depuis la réponse worker.
      const newCount = res.data?.newCount ?? thread.upvotes_count;
      setThreads((prev) =>
        prev.map((th) =>
          th.id === thread.id ? { ...th, upvotes_count: newCount } : th,
        ),
      );
      setVoted((prev) => {
        const next = new Set(prev);
        if (already) next.delete(thread.id);
        else next.add(thread.id);
        return next;
      });
      if (already) success(t('community_forum.vote.removed'));
    },
    [voted, success, toastError],
  );

  const handleTogglePin = useCallback(
    async (thread: CommunityThread) => {
      setBusyId(thread.id);
      const res = await pinThread(thread.id, !thread.is_pinned);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadThreads();
    },
    [toastError, loadThreads],
  );

  const handleToggleLock = useCallback(
    async (thread: CommunityThread) => {
      setBusyId(thread.id);
      const res = await lockThread(thread.id, !thread.is_locked);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadThreads();
    },
    [toastError, loadThreads],
  );

  const handleDelete = useCallback(
    async (thread: CommunityThread) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('community_forum.threads.delete.confirm')}\n\n${thread.title}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(thread.id);
      const res = await deleteThread(thread.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadThreads();
    },
    [confirm, toastError, loadThreads],
  );

  const handleOpenDetail = useCallback((thread: CommunityThread) => {
    setDetailThreadId(thread.id);
    setDetailOpen(true);
  }, []);

  // Notifie la liste qu'un comment/vote a bougé dans le détail → on rafraîchit
  // last_activity_at + comments_count + upvotes_count via re-fetch léger.
  const handleDetailMutated = useCallback(() => {
    void loadThreads();
  }, [loadThreads]);

  // ── Render ────────────────────────────────────────────────────────────

  const formValid = formTitle.trim().length > 0 && formBody.trim().length > 0;

  return (
    <div className="space-y-6" data-testid="threads-list">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('community_forum.threads.title')}</h2>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('community_forum.threads.create')}
        >
          {t('community_forum.threads.create')}
        </Button>
      </header>

      {/* Filtres */}
      <div
        className="flex flex-wrap gap-3 items-end"
        data-testid="threads-filters"
      >
        <Select
          containerClassName="min-w-[180px]"
          size="sm"
          label={t('community_forum.threads.category')}
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          aria-label={t('community_forum.threads.category')}
        >
          <option value="">{t('community_forum.threads.title')}</option>
          {DEFAULT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </Select>
        <Select
          containerClassName="min-w-[160px]"
          size="sm"
          label={t('community_forum.threads.status')}
          value={filterStatus}
          onChange={(e) =>
            setFilterStatus(e.target.value as CommunityThreadStatus | '')
          }
          aria-label={t('community_forum.threads.status')}
        >
          <option value="">{t('common.all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {/* Error state (inline + retry) */}
      {!loading && loadError ? (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="threads-error"
          className="p-4 rounded-xl border border-rose-200 bg-rose-50 flex items-start justify-between gap-3 flex-wrap"
        >
          <p className="text-sm text-rose-800 min-w-0">
            {t('community_forum.errors.load_failed')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadThreads()}
            aria-label={t('common.retry')}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {/* Liste / loading / empty */}
      {loading ? (
        <div
          className="space-y-3"
          data-testid="threads-loading"
          aria-busy="true"
          aria-live="polite"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-6 w-12 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : sortedThreads.length === 0 ? (
        <EmptyState
          icon={<Icon as={Users} size={40} />}
          title={t('community_forum.threads.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('community_forum.threads.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="threads-list-ul"
          aria-label={t('community_forum.threads.title')}
        >
          {sortedThreads.map((th) => {
            const isBusy = busyId === th.id;
            const hasVoted = voted.has(th.id);
            const preview = truncatePreview(th.body);
            return (
              <li
                key={th.id}
                data-testid={`thread-row-${th.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4"
              >
                {/* Vote column (vertical pill) */}
                <div className="flex sm:flex-col items-center gap-1 shrink-0">
                  <Button
                    variant={hasVoted ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => handleVote(th)}
                    disabled={isBusy}
                    aria-label={t('community_forum.vote.upvote')}
                    aria-pressed={hasVoted}
                    leftIcon={<Icon as={ArrowUp} size="sm" />}
                  >
                    {th.upvotes_count}
                  </Button>
                </div>

                {/* Main content (clickable area) */}
                <button
                  type="button"
                  onClick={() => handleOpenDetail(th)}
                  className="flex-1 min-w-0 text-left space-y-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)] rounded-md -m-1 p-1"
                  aria-label={th.title}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {th.is_pinned ? (
                      <span
                        data-testid={`thread-pinned-${th.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200"
                        title={t('community_forum.threads.pinned')}
                      >
                        <Icon as={Pin} size="xs" />
                        {t('community_forum.threads.pinned')}
                      </span>
                    ) : null}
                    {th.is_locked ? (
                      <span
                        data-testid={`thread-locked-${th.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]"
                        title={t('community_forum.threads.locked')}
                      >
                        <Icon as={Lock} size="xs" />
                        {t('community_forum.threads.locked')}
                      </span>
                    ) : null}
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {th.title}
                    </h3>
                    <span
                      data-testid={`thread-category-${th.id}`}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-violet-50 text-violet-700 border-violet-200"
                      title={t('community_forum.threads.category')}
                    >
                      {categoryLabel(th.category)}
                    </span>
                  </div>
                  {preview ? (
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                      {preview}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Icon as={Users} size="xs" />
                      {th.author_user_id ?? '—'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Icon as={MessageCircle} size="xs" />
                      {th.comments_count}
                    </span>
                    <span>{formatRelativeTime(th.last_activity_at, locale)}</span>
                  </div>
                </button>

                {/* Moderator actions */}
                {userIsModerator ? (
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTogglePin(th)}
                      disabled={isBusy}
                      aria-label={t('community_forum.threads.pinned')}
                      leftIcon={
                        <Icon as={th.is_pinned ? PinOff : Pin} size="sm" />
                      }
                    >
                      {t('community_forum.threads.pinned')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleLock(th)}
                      disabled={isBusy}
                      aria-label={t('community_forum.threads.locked')}
                      leftIcon={
                        <Icon as={th.is_locked ? LockOpen : Lock} size="sm" />
                      }
                    >
                      {t('community_forum.threads.locked')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(th)}
                      disabled={isBusy}
                      aria-label={`${t('action.delete')} — ${th.title}`}
                      leftIcon={<Icon as={Trash2} size="sm" />}
                    >
                      {t('action.delete')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal CREATE thread */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={t('community_forum.threads.create')}
        size="md"
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            label={t('community_forum.threads.title')}
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            required
            autoFocus
            maxLength={200}
            aria-label={t('community_forum.threads.title')}
          />
          <Textarea
            label={t('common.description')}
            value={formBody}
            onChange={(e) => setFormBody(e.target.value)}
            required
            rows={6}
            maxLength={10000}
            aria-label={t('common.description')}
          />
          <Select
            label={t('community_forum.threads.category')}
            value={formCategory}
            onChange={(e) => setFormCategory(e.target.value)}
            aria-label={t('community_forum.threads.category')}
          >
            {DEFAULT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={submitting}
            >
              {t('action.cancel')}
            </Button>
            <Button type="submit" isLoading={submitting} disabled={!formValid}>
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* SlidePanel ThreadDetail */}
      <SlidePanel
        open={detailOpen}
        onOpenChange={(o) => {
          setDetailOpen(o);
          if (!o) setDetailThreadId(null);
        }}
        title={t('community_forum.title')}
        size="lg"
      >
        {detailThreadId ? (
          <ThreadDetail
            threadId={detailThreadId}
            onMutated={handleDetailMutated}
          />
        ) : null}
      </SlidePanel>
    </div>
  );
}
