// ── Storefront — ReviewsList (Sprint 40 Agent B2, seq135) ────────────────────
//
// Liste publique des avis approuvés pour un produit + filtres + tri + bouton
// "Utile". Composant léger style storefront (calque ProductCard.tsx) — pas de
// dépendance dashboard admin. Lightbox photos = modal full-size simple inline.
//
// API publique :
//   <ReviewsList productId="prod_xxx" />
//
// Données : getProductReviews(productId, { rating_min?, verified_only? })
// Tri front : recent (default) / helpful (desc helpful_count) / rating (desc).
//
// Imports RELATIFS (consigne Sprint 40 — pas d'alias `@/`).
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ProductReview } from '../../lib/types';
import {
  getProductReviews,
  voteReviewHelpful,
  type ProductReviewFilters,
} from '../../lib/api';
import { t } from '../../lib/i18n';

export interface ReviewsListProps {
  productId: string;
}

type SortKey = 'recent' | 'helpful' | 'rating';
type RatingFilter = 0 | 1 | 2 | 3 | 4 | 5; // 0 = tous

export function ReviewsList({ productId }: ReviewsListProps) {
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('recent');
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>(0);
  const [verifiedOnly, setVerifiedOnly] = useState<boolean>(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [voting, setVoting] = useState<Record<string, boolean>>({});
  const reactId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const filters: ProductReviewFilters = {};
    if (ratingFilter > 0) {
      filters.rating_min = ratingFilter;
      filters.rating_max = ratingFilter;
    }
    if (verifiedOnly) filters.verified_only = true;
    const res = await getProductReviews(productId, filters);
    if (res.error) {
      setError(res.error);
      setReviews([]);
    } else {
      setReviews(res.data ?? []);
    }
    setLoading(false);
  }, [productId, ratingFilter, verifiedOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const copy = [...reviews];
    if (sort === 'helpful') {
      copy.sort((a, b) => b.helpful_count - a.helpful_count);
    } else if (sort === 'rating') {
      copy.sort((a, b) => b.rating - a.rating);
    } else {
      copy.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    return copy;
  }, [reviews, sort]);

  const onHelpfulClick = useCallback(async (id: string) => {
    setVoting((v) => ({ ...v, [id]: true }));
    const res = await voteReviewHelpful(id);
    setVoting((v) => ({ ...v, [id]: false }));
    if (!res.error && res.data) {
      const next = res.data.helpful_count;
      setReviews((prev) =>
        prev.map((r) => (r.id === id ? { ...r, helpful_count: next } : r)),
      );
    }
  }, []);

  const sortLabelId = `${reactId}-sort-label`;
  const ratingLabelId = `${reactId}-rating-label`;

  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-white p-4"
      aria-label={t('products.reviews.title')}
      data-testid="reviews-list"
    >
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {t('products.reviews.title')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label id={sortLabelId} className="text-xs" style={{ color: '#6b7280' }}>
            {t('products.reviews.rating')}:
          </label>
          <select
            aria-labelledby={ratingLabelId}
            data-testid="reviews-filter-rating"
            value={ratingFilter}
            onChange={(e) =>
              setRatingFilter(Number(e.target.value) as RatingFilter)
            }
            className="rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm"
          >
            <option value={0}>{t('products.reviews.title')}</option>
            <option value={5}>5★</option>
            <option value={4}>4★</option>
            <option value={3}>3★</option>
            <option value={2}>2★</option>
            <option value={1}>1★</option>
          </select>
          <label className="flex items-center gap-1 text-xs" style={{ color: '#6b7280' }}>
            <input
              type="checkbox"
              data-testid="reviews-filter-verified"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
            />
            {t('products.reviews.verified')}
          </label>
          <span id={ratingLabelId} className="sr-only">
            {t('products.reviews.rating')}
          </span>
          <select
            aria-labelledby={sortLabelId}
            data-testid="reviews-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm"
          >
            <option value="recent">recent</option>
            <option value="helpful">helpful</option>
            <option value="rating">rating</option>
          </select>
        </div>
      </header>

      {loading ? (
        <p className="text-sm" style={{ color: '#6b7280' }} data-testid="reviews-loading">
          …
        </p>
      ) : error ? (
        <p className="text-sm" style={{ color: '#b91c1c' }} data-testid="reviews-error">
          {error}
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-sm" style={{ color: '#6b7280' }} data-testid="reviews-empty">
          {t('products.reviews.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="reviews-items">
          {sorted.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-[var(--border)] bg-white p-3"
              data-testid="review-card"
              data-review-id={r.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Stars value={r.rating} />
                {r.verified_buyer ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: '#ecfdf5', color: '#047857' }}
                    data-testid="review-verified-badge"
                  >
                    {t('products.reviews.verified')}
                  </span>
                ) : null}
                <time
                  dateTime={r.created_at}
                  className="ml-auto text-xs"
                  style={{ color: '#9ca3af' }}
                >
                  {new Date(r.created_at).toLocaleDateString('fr-CA')}
                </time>
              </div>

              {r.title ? (
                <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                  {r.title}
                </p>
              ) : null}
              <p className="mt-1 whitespace-pre-line text-sm" style={{ color: '#374151' }}>
                {r.body}
              </p>

              {r.photos && r.photos.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2" data-testid="review-photos">
                  {r.photos.map((url, i) => (
                    <button
                      key={url + i}
                      type="button"
                      onClick={() => setLightbox(url)}
                      className="overflow-hidden rounded-md border border-[var(--border)]"
                      aria-label={t('products.reviews.title')}
                      style={{ width: 64, height: 64, padding: 0, background: '#f6f8fa' }}
                    >
                      <img
                        src={url}
                        alt=""
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onHelpfulClick(r.id)}
                  disabled={voting[r.id]}
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--bg-subtle)] disabled:opacity-60"
                  aria-label={t('products.reviews.helpful')}
                  data-testid="review-helpful-btn"
                >
                  {t('products.reviews.helpful')}{' '}
                  <span data-testid="review-helpful-count">{r.helpful_count}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('products.reviews.title')}
          data-testid="review-lightbox"
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <img
            src={lightbox}
            alt=""
            style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain' }}
          />
        </div>
      ) : null}
    </section>
  );
}

// ── Stars (lecture seule) ────────────────────────────────────────────────────

function Stars({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span
      aria-label={`${clamped}/5`}
      role="img"
      style={{ color: '#f59e0b', letterSpacing: 1 }}
    >
      {'★'.repeat(clamped)}
      <span style={{ color: '#e5e7eb' }}>{'★'.repeat(5 - clamped)}</span>
    </span>
  );
}
