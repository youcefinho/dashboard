// ── ReviewModerationQueue — Sprint 40 (Agent B1) ────────────────────────────
// File de modération des avis produits (seq135).
//
// API back FIGÉE (Sprint 40 / lib/api.ts) :
//   getModerationQueue(filters?: { status?, product_id?, limit? })
//     → ApiResponse<ProductReview[]>
//   moderateReview(id, { action: 'approve'|'reject'|'flag', notes? })
//     → ApiResponse<ProductReview>
//   deleteReview(id) → ApiResponse<{ ok: true }>
//
// Layout : table premium calque SnapshotManager — rows en cards Stripe-clean.
//   Colonnes : product thumb · rating stars 1-5 · body preview 80c (+ tooltip
//   full) · spam_score badge (vert <20, jaune <50, rouge ≥50) · verified_buyer
//   Tag · status badge · actions (Approve / Reject / Flag / Détail).
//   Filtre status inline (all / pending / flagged) — refetch.
//
// Drawer (SlidePanel) : full body + photos + customer info + même boutons
// modération en footer sticky.
//
// Style : Stripe-clean, focus ring purple, badges soft tint. Toutes chaînes
// via t(). Aucun console.log. aria-labels i18n sur chaque action.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Check,
  Flag,
  X,
  Eye,
  Star,
  Image as ImageIcon,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Tag } from '../ui/Tag';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { SlidePanel } from '../ui/SlidePanel';
import { Tooltip } from '../ui/Tooltip';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import { getLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import {
  getModerationQueue,
  moderateReview,
  type ModerateReviewInput,
} from '../../lib/api';
import type { ProductReview, ProductReviewStatus } from '../../lib/types';

// ── Helpers ────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'pending' | 'flagged';

/** Tronque le body à `max` chars avec ellipse — préserve UTF-8 simple. */
function truncate(s: string, max = 80): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}…`;
}

/** Renvoie classes Tailwind pour badge spam selon score (0..100). */
function spamScoreVariant(
  score: number,
): { variant: 'success' | 'warning' | 'danger'; label: string } {
  if (score < 20) {
    return { variant: 'success', label: `${score}` };
  }
  if (score < 50) {
    return { variant: 'warning', label: `${score}` };
  }
  return { variant: 'danger', label: `${score}` };
}

const STATUS_TAG_VARIANT: Record<
  ProductReviewStatus,
  'neutral' | 'success' | 'danger' | 'warning'
> = {
  pending: 'neutral',
  approved: 'success',
  rejected: 'danger',
  flagged: 'warning',
};

function statusLabel(s: ProductReviewStatus): string {
  return t(`products.reviews.status.${s}`);
}

/** Affiche une ligne d'étoiles 1-5, accessible (aria-label + role). */
function RatingStars({ rating }: { rating: number }) {
  const safe = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      role="img"
      aria-label={`${t('products.reviews.rating')}: ${safe}/5`}
      className="inline-flex items-center gap-0.5"
      data-testid="rating-stars"
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= safe;
        return (
          <Star
            key={i}
            size={14}
            strokeWidth={1.75}
            className={
              filled
                ? 'fill-amber-400 text-amber-400'
                : 'text-[var(--gray-300)]'
            }
            aria-hidden="true"
          />
        );
      })}
    </span>
  );
}

/** Thumb produit — image si fournie, sinon placeholder gris. */
function ProductThumb({ photos }: { photos: string[] | null }) {
  const first = photos && photos.length > 0 ? photos[0] : null;
  if (first) {
    return (
      <img
        src={first}
        alt=""
        className="w-10 h-10 rounded-md object-cover border border-[var(--border-subtle)] shrink-0"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="w-10 h-10 rounded-md bg-[var(--gray-100)] border border-[var(--border-subtle)] inline-flex items-center justify-center shrink-0 text-[var(--gray-400)]"
    >
      <Icon as={ImageIcon} size={18} />
    </span>
  );
}

// ── Composant ──────────────────────────────────────────────────────────────

export function ReviewModerationQueue() {
  const { success, error: toastError } = useToast();

  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const locale = useMemo(() => getLocale(), []);

  // ── Chargement (mount + sur changement de filtre) ──────────────────────
  const loadQueue = useCallback(
    async (filter: StatusFilter) => {
      setLoading(true);
      const res = await getModerationQueue(
        filter === 'all' ? undefined : { status: filter },
      );
      if (res.error) {
        toastError(res.error);
        setReviews([]);
      } else if (res.data) {
        setReviews(res.data);
      }
      setLoading(false);
    },
    [toastError],
  );

  useEffect(() => {
    void loadQueue(statusFilter);
  }, [loadQueue, statusFilter]);

  // ── Actions modération ────────────────────────────────────────────────
  const runModeration = useCallback(
    async (
      review: ProductReview,
      action: ModerateReviewInput['action'],
      closeDrawer = false,
    ) => {
      setBusyId(review.id);
      const res = await moderateReview(review.id, { action });
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t(`products.reviews.moderation.${action}`));
      if (closeDrawer) {
        setDrawerOpen(false);
        setSelectedId(null);
      }
      void loadQueue(statusFilter);
    },
    [toastError, success, loadQueue, statusFilter],
  );

  const handleApprove = useCallback(
    (review: ProductReview) => void runModeration(review, 'approve'),
    [runModeration],
  );
  const handleReject = useCallback(
    (review: ProductReview) => void runModeration(review, 'reject'),
    [runModeration],
  );
  const handleFlag = useCallback(
    (review: ProductReview) => void runModeration(review, 'flag'),
    [runModeration],
  );

  const handleOpenDetail = useCallback((review: ProductReview) => {
    setSelectedId(review.id);
    setDrawerOpen(true);
  }, []);

  const handleCloseDetail = useCallback((open: boolean) => {
    setDrawerOpen(open);
    if (!open) setSelectedId(null);
  }, []);

  const selected = useMemo(
    () => reviews.find((r) => r.id === selectedId) ?? null,
    [reviews, selectedId],
  );

  // ── Labels mémoïsés (perf + DRY) ───────────────────────────────────────
  const labelApprove = t('products.reviews.moderation.approve');
  const labelReject = t('products.reviews.moderation.reject');
  const labelFlag = t('products.reviews.moderation.flag');
  const labelDetail = t('action.view') || 'Détail';
  const labelVerified = t('products.reviews.verified');

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="review-moderation-queue">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('products.reviews.moderation.queue')}</h2>
          <p className="t-caption text-[var(--gray-500)] mt-1">
            {t('products.reviews.title')}
          </p>
        </div>

        {/* Filter status inline */}
        <div className="flex items-center gap-2 shrink-0">
          <label
            htmlFor="review-status-filter"
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            {t('reviews.req.status') || 'Status'}
          </label>
          <select
            id="review-status-filter"
            data-testid="status-filter"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as StatusFilter)
            }
            aria-label={t('reviews.req.status') || 'Status'}
            className="h-8 px-2 text-xs rounded-md border border-[var(--border-subtle)] bg-white text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-[var(--primary)] transition-colors"
          >
            <option value="all">{t('reviews.filter.all')}</option>
            <option value="pending">{statusLabel('pending')}</option>
            <option value="flagged">{statusLabel('flagged')}</option>
          </select>
        </div>
      </header>

      {/* Liste / loading / empty */}
      {loading ? (
        <div className="space-y-3" data-testid="review-loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white"
            >
              <div className="flex items-start gap-4">
                <Skeleton className="h-10 w-10 rounded-md shrink-0" />
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <EmptyState
          icon={<Icon as={ShieldAlert} size={40} />}
          title={t('reviews.empty.reviews')}
          description={t('reviews.empty.reviews_desc')}
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="review-list"
          aria-label={t('products.reviews.moderation.queue')}
        >
          {reviews.map((review) => {
            const isBusy = busyId === review.id;
            const spam = spamScoreVariant(review.spam_score);
            const preview = truncate(review.body, 80);
            const createdRel = formatRelativeTime(review.created_at, locale);
            const statusVariant = STATUS_TAG_VARIANT[review.status];
            return (
              <li
                key={review.id}
                data-testid={`review-row-${review.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <ProductThumb photos={review.photos} />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <RatingStars rating={review.rating} />
                      {review.title ? (
                        <h3 className="font-semibold text-sm text-[var(--text-primary)] truncate">
                          {review.title}
                        </h3>
                      ) : null}
                      <Tag
                        variant={statusVariant}
                        size="xs"
                        data-testid={`review-status-${review.id}`}
                      >
                        {statusLabel(review.status)}
                      </Tag>
                      {review.verified_buyer ? (
                        <Tag variant="success" size="xs">
                          {labelVerified}
                        </Tag>
                      ) : null}
                    </div>
                    <Tooltip content={review.body} side="top">
                      <p
                        className="text-sm text-[var(--text-secondary)] line-clamp-2 cursor-help"
                        data-testid={`review-body-${review.id}`}
                      >
                        {preview}
                      </p>
                    </Tooltip>
                    <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1 items-center">
                      <span>{createdRel}</span>
                      <span aria-hidden="true">•</span>
                      <span className="flex items-center gap-1">
                        <Tag variant={spam.variant} size="xs">
                          spam {spam.label}
                        </Tag>
                      </span>
                      <span aria-hidden="true">•</span>
                      <span className="font-mono">
                        #{review.product_id.slice(0, 8)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Check} size="sm" />}
                    onClick={() => handleApprove(review)}
                    disabled={isBusy}
                    aria-label={`${labelApprove} — ${review.title || review.id}`}
                    data-testid={`approve-${review.id}`}
                  >
                    {labelApprove}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={X} size="sm" />}
                    onClick={() => handleReject(review)}
                    disabled={isBusy}
                    aria-label={`${labelReject} — ${review.title || review.id}`}
                    data-testid={`reject-${review.id}`}
                  >
                    {labelReject}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={Flag} size="sm" />}
                    onClick={() => handleFlag(review)}
                    disabled={isBusy}
                    aria-label={`${labelFlag} — ${review.title || review.id}`}
                    data-testid={`flag-${review.id}`}
                  >
                    {labelFlag}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={Eye} size="sm" />}
                    onClick={() => handleOpenDetail(review)}
                    disabled={isBusy}
                    aria-label={`${labelDetail} — ${review.title || review.id}`}
                    data-testid={`detail-${review.id}`}
                  >
                    {labelDetail}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Drawer détail */}
      <SlidePanel
        open={drawerOpen}
        onOpenChange={handleCloseDetail}
        title={selected?.title || t('products.reviews.moderation.queue')}
        size="md"
        closeLabel={t('action.cancel') || 'Fermer'}
        footer={
          selected ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Icon as={Flag} size="sm" />}
                onClick={() => void runModeration(selected, 'flag', true)}
                disabled={busyId === selected.id}
                aria-label={`${labelFlag} — ${selected.title || selected.id}`}
              >
                {labelFlag}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Icon as={X} size="sm" />}
                onClick={() => void runModeration(selected, 'reject', true)}
                disabled={busyId === selected.id}
                aria-label={`${labelReject} — ${selected.title || selected.id}`}
              >
                {labelReject}
              </Button>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Icon as={Check} size="sm" />}
                onClick={() => void runModeration(selected, 'approve', true)}
                disabled={busyId === selected.id}
                aria-label={`${labelApprove} — ${selected.title || selected.id}`}
              >
                {labelApprove}
              </Button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-5" data-testid="review-detail">
            {/* Meta */}
            <div className="flex items-center gap-3 flex-wrap">
              <RatingStars rating={selected.rating} />
              <Tag variant={STATUS_TAG_VARIANT[selected.status]} size="sm">
                {statusLabel(selected.status)}
              </Tag>
              {selected.verified_buyer ? (
                <Tag variant="success" size="sm">
                  {labelVerified}
                </Tag>
              ) : null}
              <Tag
                variant={spamScoreVariant(selected.spam_score).variant}
                size="sm"
              >
                spam {selected.spam_score}
              </Tag>
            </div>

            {/* Body full */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                {t('products.reviews.body')}
              </h4>
              <p
                className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed"
                data-testid="detail-body"
              >
                {selected.body}
              </p>
            </section>

            {/* Photos */}
            {selected.photos && selected.photos.length > 0 ? (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                  Photos
                </h4>
                <div
                  className="grid grid-cols-3 gap-2"
                  data-testid="detail-photos"
                >
                  {selected.photos.map((src, idx) => (
                    <img
                      key={`${src}-${idx}`}
                      src={src}
                      alt=""
                      className="aspect-square w-full rounded-md object-cover border border-[var(--border-subtle)]"
                      loading="lazy"
                      decoding="async"
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {/* Customer info */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                Customer
              </h4>
              <dl className="text-sm grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-[var(--text-muted)]">Customer ID</dt>
                <dd className="font-mono text-[var(--text-primary)] break-all">
                  {selected.customer_id ?? '—'}
                </dd>
                <dt className="text-[var(--text-muted)]">Order ID</dt>
                <dd className="font-mono text-[var(--text-primary)] break-all">
                  {selected.order_id ?? '—'}
                </dd>
                <dt className="text-[var(--text-muted)]">Product ID</dt>
                <dd className="font-mono text-[var(--text-primary)] break-all">
                  {selected.product_id}
                </dd>
                <dt className="text-[var(--text-muted)]">
                  {t('products.reviews.helpful')}
                </dt>
                <dd className="text-[var(--text-primary)]">
                  {selected.helpful_count}
                </dd>
                <dt className="text-[var(--text-muted)]">
                  {t('reviews.table.date')}
                </dt>
                <dd className="text-[var(--text-primary)]">
                  {formatRelativeTime(selected.created_at, locale)}
                </dd>
              </dl>
            </section>

            {/* Moderation notes (read-only) */}
            {selected.moderation_notes ? (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                  Notes
                </h4>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                  {selected.moderation_notes}
                </p>
              </section>
            ) : null}
          </div>
        ) : null}
      </SlidePanel>
    </div>
  );
}
