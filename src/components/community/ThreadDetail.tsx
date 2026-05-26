// ── ThreadDetail — Sprint 45 (Agent B1) ────────────────────────────────────
// Détail d'un thread + arbre commentaires (1 niveau de nesting via
// parent_comment_id) + composer + boutons vote/modération.
//
// Props : { threadId, onMutated? }. Quand un comment/vote change quelque chose
// côté server (count/last_activity), on appelle onMutated() pour que le parent
// (ThreadsList) re-fetch sa liste.
//
// API back FIGÉE (Sprint 45 — paritaire worker seq140) :
//   getThread(id)                              → ApiResponse<CommunityThread>
//   listComments(threadId)                     → ApiResponse<CommunityComment[]>
//   createComment(threadId, { body, parent? }) → ApiResponse<CommunityComment>
//   deleteComment(id)                          → ApiResponse<{ success }>
//   voteThread(id, 'up' | 'none')              → ApiResponse<{ ok, newCount }>
//   voteComment(id, 'up' | 'none')             → ApiResponse<{ ok, newCount }>
//
// Style : Stripe-clean, flat surfaces, focus ring purple, hairline borders.
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
  ArrowUp,
  Pin,
  Lock,
  MessageCircle,
  Reply,
  Trash2,
  EyeOff,
  Send,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t, getLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import { useAuth } from '../../lib/auth';
import {
  getThread,
  listComments,
  createComment,
  deleteComment,
  voteThread,
  voteComment,
  type CommunityThread,
  type CommunityComment,
} from '../../lib/api';

interface ThreadDetailProps {
  threadId: string;
  /** Callback opt-in pour signaler au parent qu'une mutation a eu lieu. */
  onMutated?: () => void;
}

/** Détermine si le user courant a un rôle modérateur/admin. */
function isModerator(role: string | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r === 'moderator' || r === 'admin' || r === 'owner';
}

interface CommentTreeNode {
  comment: CommunityComment;
  replies: CommunityComment[];
}

/**
 * Construit l'arbre 2 niveaux (root + 1 niveau replies).
 * Comme worker garantit nesting flat=1 (parent_comment_id pointe toujours sur
 * un comment racine), on regroupe simplement par parent_comment_id.
 */
function buildCommentTree(comments: CommunityComment[]): CommentTreeNode[] {
  const roots = comments.filter((c) => c.parent_comment_id == null);
  const byParent = new Map<string, CommunityComment[]>();
  for (const c of comments) {
    if (c.parent_comment_id) {
      const arr = byParent.get(c.parent_comment_id) ?? [];
      arr.push(c);
      byParent.set(c.parent_comment_id, arr);
    }
  }
  // Tri replies par created_at asc (ordre chronologique de discussion).
  for (const [k, v] of byParent) {
    byParent.set(
      k,
      [...v].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      ),
    );
  }
  return roots
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
    .map((c) => ({ comment: c, replies: byParent.get(c.id) ?? [] }));
}

export function ThreadDetail({ threadId, onMutated }: ThreadDetailProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const userIsModerator = isModerator(user?.role);

  const [thread, setThread] = useState<CommunityThread | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Vote tracking côté client (anti double-vote optimiste — la source de
  // vérité reste le worker, qui renvoie 409 community_forum.errors.duplicate_vote).
  const [voted, setVoted] = useState<Set<string>>(new Set());

  // Composer racine + reply
  const [commentDraft, setCommentDraft] = useState<string>('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const locale = getLocale();

  // ── Chargement ────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [tRes, cRes] = await Promise.all([
      getThread(threadId),
      listComments(threadId),
    ]);
    if (tRes.error) {
      toastError(tRes.error);
      setLoadError(tRes.error || t('community_forum.errors.load_failed'));
      setThread(null);
    } else if (tRes.data) {
      setThread(tRes.data);
    }
    if (cRes.error) {
      toastError(cRes.error);
      // On garde le thread visible si seulement les comments ont raté ; on
      // expose un error sépareré pour le retry inline.
      if (!tRes.error) {
        setLoadError(cRes.error || t('community_forum.comments.load_failed'));
      }
      setComments([]);
    } else if (cRes.data) {
      setComments(cRes.data);
    }
    setLoading(false);
  }, [threadId, toastError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── Arbre commentaires ────────────────────────────────────────────────
  const tree = useMemo(() => buildCommentTree(comments), [comments]);

  // ── Vote thread ───────────────────────────────────────────────────────
  const handleVoteThread = useCallback(async () => {
    if (!thread) return;
    const key = `thread:${thread.id}`;
    const already = voted.has(key);
    const direction: 'up' | 'none' = already ? 'none' : 'up';
    setBusyId(thread.id);
    const res = await voteThread(thread.id, direction);
    setBusyId(null);
    if (res.error) {
      toastError(res.error);
      return;
    }
    const newCount = res.data?.newCount ?? thread.upvotes_count;
    setThread({ ...thread, upvotes_count: newCount });
    setVoted((prev) => {
      const next = new Set(prev);
      if (already) next.delete(key);
      else next.add(key);
      return next;
    });
    if (already) success(t('community_forum.vote.removed'));
    onMutated?.();
  }, [thread, voted, success, toastError, onMutated]);

  // ── Vote comment ──────────────────────────────────────────────────────
  const handleVoteComment = useCallback(
    async (c: CommunityComment) => {
      const key = `comment:${c.id}`;
      const already = voted.has(key);
      const direction: 'up' | 'none' = already ? 'none' : 'up';
      setBusyId(c.id);
      const res = await voteComment(c.id, direction);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      const newCount = res.data?.newCount ?? c.upvotes_count;
      setComments((prev) =>
        prev.map((x) =>
          x.id === c.id ? { ...x, upvotes_count: newCount } : x,
        ),
      );
      setVoted((prev) => {
        const next = new Set(prev);
        if (already) next.delete(key);
        else next.add(key);
        return next;
      });
      if (already) success(t('community_forum.vote.removed'));
      onMutated?.();
    },
    [voted, success, toastError, onMutated],
  );

  // ── Create root comment ───────────────────────────────────────────────
  const handleSubmitComment = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const body = commentDraft.trim();
      if (!body) return;
      if (thread?.is_locked) {
        toastError(t('community_forum.errors.locked'));
        return;
      }
      setSubmitting(true);
      const res = await createComment(threadId, { body });
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setCommentDraft('');
      void loadAll();
      onMutated?.();
    },
    [commentDraft, thread, threadId, success, toastError, loadAll, onMutated],
  );

  // ── Create reply (1-level nested) ─────────────────────────────────────
  const handleSubmitReply = useCallback(
    async (parentCommentId: string) => {
      const body = replyDraft.trim();
      if (!body) return;
      if (thread?.is_locked) {
        toastError(t('community_forum.errors.locked'));
        return;
      }
      setSubmitting(true);
      const res = await createComment(threadId, {
        body,
        parent_comment_id: parentCommentId,
      });
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setReplyDraft('');
      setReplyTo(null);
      void loadAll();
      onMutated?.();
    },
    [replyDraft, thread, threadId, success, toastError, loadAll, onMutated],
  );

  // ── Moderation (hide=delete soft) ─────────────────────────────────────
  const handleModerateComment = useCallback(
    async (c: CommunityComment, action: 'hide' | 'delete') => {
      const label =
        action === 'hide'
          ? t('community_forum.moderation.hide')
          : t('community_forum.moderation.delete');
      const confirmKey =
        action === 'hide'
          ? 'community_forum.moderation.hide.confirm'
          : 'community_forum.moderation.delete.confirm';
      const ok = await confirm({
        title: label,
        description: t(confirmKey),
        confirmLabel: label,
        cancelLabel: t('action.cancel'),
        danger: action === 'delete',
      });
      if (!ok) return;
      setBusyId(c.id);
      // Worker API : seul deleteComment est exposé. Hide est traité comme un
      // soft-delete côté UI (le worker passe status=deleted ; le admin queue
      // gère la distinction hide/delete via /community/moderate).
      const res = await deleteComment(c.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(label);
      void loadAll();
      onMutated?.();
    },
    [confirm, success, toastError, loadAll, onMutated],
  );

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="space-y-4"
        data-testid="thread-detail-loading"
        aria-busy="true"
        aria-live="polite"
      >
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <div className="pt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="space-y-4" data-testid="thread-detail-empty-or-error">
        {loadError ? (
          <div
            role="alert"
            aria-live="assertive"
            data-testid="thread-detail-error"
            className="p-4 rounded-xl border border-rose-200 bg-rose-50 flex items-start justify-between gap-3 flex-wrap"
          >
            <p className="text-sm text-rose-800 min-w-0">
              {t('community_forum.errors.load_failed')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadAll()}
              aria-label={t('common.retry')}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <EmptyState
            title={t('community_forum.threads.empty')}
            icon={<Icon as={MessageCircle} size={40} />}
          />
        )}
      </div>
    );
  }

  const hasVotedThread = voted.has(`thread:${thread.id}`);
  // Coerce explicite : les types api.ts mergent boolean & number (deux interfaces
  // CommunityThread coexistantes dans api.ts pour back-compat seq93/seq140).
  const threadLocked: boolean = Boolean(thread.is_locked);
  const composerDisabled: boolean = threadLocked || submitting;

  return (
    <div className="space-y-6" data-testid={`thread-detail-${thread.id}`}>
      {/* ── Header thread ───────────────────────────────────────────── */}
      <article className="space-y-3">
        <div className="flex items-start gap-3">
          <Button
            variant={hasVotedThread ? 'primary' : 'secondary'}
            size="sm"
            onClick={handleVoteThread}
            disabled={busyId === thread.id}
            aria-label={t('community_forum.vote.upvote')}
            aria-pressed={hasVotedThread}
            leftIcon={<Icon as={ArrowUp} size="sm" />}
          >
            {thread.upvotes_count}
          </Button>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {thread.is_pinned ? (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200"
                  title={t('community_forum.threads.pinned')}
                >
                  <Icon as={Pin} size="xs" />
                  {t('community_forum.threads.pinned')}
                </span>
              ) : null}
              {thread.is_locked ? (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]"
                  title={t('community_forum.threads.locked')}
                >
                  <Icon as={Lock} size="xs" />
                  {t('community_forum.threads.locked')}
                </span>
              ) : null}
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-violet-50 text-violet-700 border-violet-200"
                title={t('community_forum.threads.category')}
              >
                {thread.category}
              </span>
            </div>
            <h2 className="t-h2 text-[var(--text-primary)]">{thread.title}</h2>
            <div className="text-xs text-[var(--text-muted)]">
              {thread.author_user_id ?? '—'} · {formatRelativeTime(thread.created_at ?? Date.now(), locale)}
            </div>
          </div>
        </div>
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[var(--text-primary)]">
          {thread.body}
        </div>
      </article>

      <hr className="border-t border-[var(--border-subtle)]" />

      {/* Error retry — comments failed but thread loaded */}
      {loadError && comments.length === 0 ? (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="thread-detail-comments-error"
          className="p-3 rounded-xl border border-rose-200 bg-rose-50 flex items-start justify-between gap-3 flex-wrap"
        >
          <p className="text-sm text-rose-800 min-w-0">
            {t('community_forum.comments.load_failed')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadAll()}
            aria-label={t('common.retry')}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {/* ── Section commentaires ────────────────────────────────────── */}
      <section
        className="space-y-4"
        aria-label={t('community_forum.comments.title')}
      >
        <h3 className="t-h3 flex items-center gap-2">
          <Icon as={MessageCircle} size="sm" />
          {t('community_forum.comments.title')}
          <span className="text-sm text-[var(--text-muted)] font-normal">
            ({comments.length})
          </span>
        </h3>

        {/* Composer racine */}
        {thread.is_locked ? (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            role="status"
          >
            {t('community_forum.errors.locked')}
          </div>
        ) : (
          <form
            onSubmit={handleSubmitComment}
            className="space-y-2"
            data-testid="comment-composer-root"
          >
            <Textarea
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              rows={3}
              maxLength={10000}
              placeholder={t('community_forum.comments.create')}
              aria-label={t('community_forum.comments.create')}
              disabled={composerDisabled}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                leftIcon={<Icon as={Send} size="sm" />}
                isLoading={submitting && replyTo === null}
                disabled={composerDisabled || commentDraft.trim().length === 0}
                aria-label={t('community_forum.comments.create')}
              >
                {t('community_forum.comments.create')}
              </Button>
            </div>
          </form>
        )}

        {/* Liste arborescente */}
        {tree.length === 0 ? (
          <EmptyState
            title={t('community_forum.comments.empty')}
            icon={<Icon as={MessageCircle} size={32} />}
          />
        ) : (
          <ul
            className="space-y-3 list-none p-0 m-0"
            data-testid="comments-tree"
          >
            {tree.map(({ comment, replies }) => (
              <li
                key={comment.id}
                data-testid={`comment-root-${comment.id}`}
                className="rounded-xl border border-[var(--border-subtle)] bg-white p-4 space-y-3"
              >
                <CommentBlock
                  comment={comment}
                  voted={voted.has(`comment:${comment.id}`)}
                  busy={busyId === comment.id}
                  isLocked={threadLocked}
                  userIsModerator={userIsModerator}
                  locale={locale}
                  onVote={() => handleVoteComment(comment)}
                  onReplyClick={() => {
                    setReplyTo((cur) => (cur === comment.id ? null : comment.id));
                    setReplyDraft('');
                  }}
                  onModerate={(action) => handleModerateComment(comment, action)}
                />

                {/* Reply composer (inline, sous le commentaire racine) */}
                {replyTo === comment.id && !threadLocked ? (
                  <div
                    className="pl-4 sm:pl-6 border-l-2 border-[var(--border-subtle)] space-y-2"
                    data-testid={`reply-composer-${comment.id}`}
                  >
                    <Textarea
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      rows={2}
                      maxLength={10000}
                      placeholder={t('community_forum.comments.reply')}
                      aria-label={t('community_forum.comments.reply')}
                      disabled={submitting}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReplyTo(null);
                          setReplyDraft('');
                        }}
                        disabled={submitting}
                      >
                        {t('action.cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        leftIcon={<Icon as={Send} size="sm" />}
                        onClick={() => void handleSubmitReply(comment.id)}
                        isLoading={submitting && replyTo === comment.id}
                        disabled={replyDraft.trim().length === 0}
                        aria-label={t('community_forum.comments.reply')}
                      >
                        {t('community_forum.comments.reply')}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {/* Replies (1 niveau de nesting) */}
                {replies.length > 0 ? (
                  <ul
                    className="pl-4 sm:pl-6 border-l-2 border-[var(--border-subtle)] space-y-3 list-none p-0 m-0 mt-1"
                    data-testid={`comment-replies-${comment.id}`}
                  >
                    {replies.map((rep) => (
                      <li
                        key={rep.id}
                        data-testid={`comment-reply-${rep.id}`}
                        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--gray-50)] p-3"
                      >
                        <CommentBlock
                          comment={rep}
                          voted={voted.has(`comment:${rep.id}`)}
                          busy={busyId === rep.id}
                          isLocked={threadLocked}
                          userIsModerator={userIsModerator}
                          locale={locale}
                          onVote={() => handleVoteComment(rep)}
                          // Pas de reply sur reply : nesting limité à 1 niveau (worker contraint).
                          onReplyClick={null}
                          onModerate={(action) =>
                            handleModerateComment(rep, action)
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Sub-component : CommentBlock ─────────────────────────────────────────────
// Bloc atomique pour un commentaire (root OU reply). Gère vote, reply trigger,
// actions modération. Props explicites = pas de couplage au state parent.

interface CommentBlockProps {
  comment: CommunityComment;
  voted: boolean;
  busy: boolean;
  isLocked: boolean;
  userIsModerator: boolean;
  locale: string;
  onVote: () => void;
  /** null = pas de bouton "Répondre" (cas reply pour empêcher nesting >1). */
  onReplyClick: (() => void) | null;
  onModerate: (action: 'hide' | 'delete') => void;
}

function CommentBlock({
  comment,
  voted,
  busy,
  isLocked,
  userIsModerator,
  locale,
  onVote,
  onReplyClick,
  onModerate,
}: CommentBlockProps) {
  return (
    <div className="flex items-start gap-3">
      <Button
        variant={voted ? 'primary' : 'secondary'}
        size="sm"
        onClick={onVote}
        disabled={busy}
        aria-label={t('community_forum.vote.upvote')}
        aria-pressed={voted}
        leftIcon={<Icon as={ArrowUp} size="sm" />}
      >
        {comment.upvotes_count}
      </Button>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="text-xs text-[var(--text-muted)] flex items-center gap-2 flex-wrap">
          <span>{comment.author_user_id ?? '—'}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRelativeTime(comment.created_at, locale)}</span>
        </div>
        <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">
          {comment.body}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {onReplyClick && !isLocked ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReplyClick}
              disabled={busy}
              leftIcon={<Icon as={Reply} size="sm" />}
              aria-label={t('community_forum.comments.reply')}
            >
              {t('community_forum.comments.reply')}
            </Button>
          ) : null}
          {userIsModerator ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onModerate('hide')}
                disabled={busy}
                leftIcon={<Icon as={EyeOff} size="sm" />}
                aria-label={t('community_forum.moderation.hide')}
              >
                {t('community_forum.moderation.hide')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onModerate('delete')}
                disabled={busy}
                leftIcon={<Icon as={Trash2} size="sm" />}
                aria-label={t('community_forum.moderation.delete')}
              >
                {t('community_forum.moderation.delete')}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
