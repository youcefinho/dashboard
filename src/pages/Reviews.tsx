// ── Page Reviews — Avis & Réputation ────────────────────────

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Card, EmptyState, PageHero, KpiStrip, type KpiItem, Tag } from '@/components/ui';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { apiFetch } from '@/lib/api';
import { Star, MessageCircle, Inbox, Send, ChevronRight } from 'lucide-react';
import { t } from '@/lib/i18n';

interface ReviewStats {
  total_reviews: number;
  average_rating: number;
  five_star: number;
  four_star: number;
  three_star: number;
  two_star: number;
  one_star: number;
  replied_count: number;
  total_requests: number;
  pending_requests: number;
}

interface Review {
  id: string;
  source: string;
  author_name: string;
  rating: number;
  comment: string;
  review_date: string;
  reply: string;
  reply_date: string;
}

interface ReviewRequest {
  id: string;
  lead_name: string;
  lead_email: string;
  channel: string;
  status: string;
  sent_at: string;
  created_at: string;
}

type Tab = 'overview' | 'reviews' | 'requests';

export function ReviewsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  // Sprint 32 vague 32-3A — Expand inline (texte complet + source + lead linked)
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  // Sprint 42 M2 — Filtres reviews (rating + source)
  const [ratingFilter, setRatingFilter] = useState<0 | 5 | 4 | 3 | 2 | 1>(0);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'google' | 'facebook'>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, reviewsRes, reqRes] = await Promise.all([
        apiFetch('/api/reviews/stats'),
        apiFetch('/api/reviews'),
        apiFetch('/api/reviews/requests'),
      ]);
      if (statsRes.data) setStats(statsRes.data as ReviewStats);
      if (reviewsRes.data) setReviews(reviewsRes.data as Review[]);
      if (reqRes.data) setRequests(reqRes.data as ReviewRequest[]);
    } catch { /* silencieux */ }
    setLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const suggestReply = async (reviewId: string) => {
    setSuggestingId(reviewId);
    try {
      const res = await apiFetch('/api/reviews/suggest-reply', {
        method: 'POST',
        body: JSON.stringify({ review_id: reviewId }),
      });
      const data = res.data as { suggestion: string };
      if (data?.suggestion) {
        setReplyText(data.suggestion);
        setReplyingId(reviewId);
      }
    } catch { /* silencieux */ }
    setSuggestingId(null);
  };

  const submitReply = async (reviewId: string) => {
    if (!replyText.trim()) return;
    await apiFetch(`/api/reviews/${reviewId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply: replyText }),
    });
    setReplyingId(null);
    setReplyText('');
    void loadData();
  };

  // Sprint 42 M2 — Stripe-clean : étoiles warning subtle (plus de gradient brand + drop-shadow)
  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => {
      const filled = i < rating;
      return (
        <span
          key={i}
          aria-hidden
          className="reviews-star"
          style={{ color: filled ? 'var(--warning)' : 'var(--border-default)' }}
        >
          ★
        </span>
      );
    });
  };

  const ratingBar = (count: number, total: number, stars: number) => {
    const pct = total > 0 ? (count / total) * 100 : 0;
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-8 text-right text-[var(--text-muted)]">{stars}★</span>
        <div className="flex-1 h-2 bg-[var(--bg-subtle)] rounded-full overflow-hidden">
          <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-8 text-[var(--text-muted)]">{count}</span>
      </div>
    );
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: t('reviews.tab.overview') },
    { key: 'reviews', label: `${t('reviews.tab.reviews')} (${reviews.length})` },
    { key: 'requests', label: `${t('reviews.tab.requests')} (${requests.length})` },
  ];

  // Sprint 44 M3.3 — Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await loadData(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title={t('reviews.page.title')}>
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <PageHero
        meta="Insights"
        title={t('reviews.page.title')}
        highlight={t('reviews.tab.reviews')}
        description={t('reviews.hero.description')}
      />

      {stats && (
        <KpiStrip
          items={[
            { label: t('reviews.kpi.total'), value: stats.total_reviews, icon: <MessageCircle size={11} />, color: 'brand' },
            { label: t('reviews.kpi.avg'), value: stats.average_rating ? `${Number(stats.average_rating).toFixed(1)} ★` : '—', icon: <Star size={11} />, color: 'accent' },
            { label: t('reviews.kpi.five_star'), value: stats.five_star, icon: <Star size={11} />, color: 'success' },
            { label: t('reviews.kpi.to_reply'), value: Math.max(0, stats.total_reviews - stats.replied_count), icon: <Inbox size={11} />, color: 'warning' },
          ] as KpiItem[]}
        />
      )}

      {/* Onglets */}
      <div className="flex gap-1 bg-[var(--bg-subtle)] p-1 rounded-[var(--radius-lg)] w-fit mb-6">
        {tabs.map(tb => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-all cursor-pointer ${
              tab === tb.key
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-xs)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="skeleton h-32 rounded-[var(--radius-lg)]" />)}
        </div>
      ) : (
        <>
          {/* Vue d'ensemble */}
          {tab === 'overview' && stats && (
            <div className="space-y-6">
              {/* KPIs — Sprint 23 wave 47B2 : migré vers .card-premium (gradient brand + glow) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card-premium p-5">
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">{t('reviews.overview.avg_rating')}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold">{stats.average_rating || '—'}</span>
                    <span className="text-lg">⭐</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{stats.total_reviews} avis au total</p>
                </div>
                <div className="card-premium p-5">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">{t('reviews.overview.five_star')}</p>
                  <span className="text-3xl font-bold text-[var(--success)]">{stats.five_star}</span>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {stats.total_reviews > 0 ? `${((stats.five_star / stats.total_reviews) * 100).toFixed(0)}%` : '—'} du total
                  </p>
                </div>
                <div className="card-premium p-5">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">{t('reviews.overview.replies')}</p>
                  <span className="text-3xl font-bold">{stats.replied_count}</span>
                  <p className="text-xs text-[var(--text-muted)] mt-1">sur {stats.total_reviews} avis</p>
                </div>
                <div className="card-premium p-5">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">{t('reviews.overview.requests_sent')}</p>
                  <span className="text-3xl font-bold">{stats.total_requests}</span>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{stats.pending_requests} en attente</p>
                </div>
              </div>

              {/* Distribution des notes */}
              <Card>
                <h3 className="text-sm font-semibold mb-4">{t('reviews.overview.distribution')}</h3>
                <div className="space-y-2 max-w-md">
                  {ratingBar(stats.five_star, stats.total_reviews, 5)}
                  {ratingBar(stats.four_star, stats.total_reviews, 4)}
                  {ratingBar(stats.three_star, stats.total_reviews, 3)}
                  {ratingBar(stats.two_star, stats.total_reviews, 2)}
                  {ratingBar(stats.one_star, stats.total_reviews, 1)}
                </div>
              </Card>
            </div>
          )}

          {/* Liste des avis — Sprint 32 vague 32-3A : table-premium + frozen col + expand inline */}
          {tab === 'reviews' && (
            reviews.length === 0 ? (
              <EmptyState
                variant="first-time"
                icon={<span className="text-4xl">⭐</span>}
                title={t('reviews.empty.reviews')}
                description={t('reviews.empty.reviews_desc')}
              />
            ) : (() => {
              const filteredReviews = reviews.filter(r => {
                if (ratingFilter !== 0 && r.rating !== ratingFilter) return false;
                if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
                return true;
              });
              return (<>
              {/* Sprint 42 M2 — Filtres rating + source (action-chip Stripe-clean) */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mr-1">{t('reviews.filter.rating')}</span>
                {([0, 5, 4, 3, 2, 1] as const).map(r => (
                  <button key={r} type="button" onClick={() => setRatingFilter(r)} className={`action-chip ${ratingFilter === r ? 'action-chip--accent' : ''}`}>
                    {r === 0 ? t('reviews.filter.all') : `${r} ★`}
                    <span className="text-[10px] font-bold opacity-70">{r === 0 ? reviews.length : reviews.filter(rev => rev.rating === r).length}</span>
                  </button>
                ))}
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] ml-3 mr-1">{t('reviews.filter.source')}</span>
                {(['all', 'google', 'facebook'] as const).map(s => (
                  <button key={s} type="button" onClick={() => setSourceFilter(s)} className={`action-chip ${sourceFilter === s ? 'action-chip--accent' : ''}`}>
                    {s === 'all' ? t('reviews.filter.all') : s === 'google' ? 'Google' : 'Facebook'}
                  </button>
                ))}
              </div>
              <Card className="p-0 overflow-hidden">
                <div className="table-premium-container overflow-x-auto">
                  <table className="table-premium w-full text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="col-frozen" style={{ minWidth: 240 }}>{t('reviews.table.author')}</th>
                        <th style={{ minWidth: 120 }}>{t('reviews.table.source')}</th>
                        <th style={{ minWidth: 280 }}>{t('reviews.table.comment')}</th>
                        <th style={{ minWidth: 120 }}>{t('reviews.table.date')}</th>
                        <th className="text-right" style={{ minWidth: 160 }}>{t('reviews.table.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReviews.map((review, idx) => {
                        const isExpanded = expandedReviewId === review.id;
                        const leadLinked = (review as unknown as { lead_name?: string; lead_id?: string }).lead_name;
                        return (
                          <React.Fragment key={review.id}>
                            <tr className="row-premium list-item-enter" style={{ animationDelay: `${idx * 30}ms` }}>
                              <td className="col-frozen">
                                <div className="flex items-center gap-2.5">
                                  <button
                                    type="button"
                                    className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
                                    onClick={() => setExpandedReviewId(isExpanded ? null : review.id)}
                                    aria-label={isExpanded ? 'Réduire' : 'Afficher les détails'}
                                    aria-expanded={isExpanded}
                                  >
                                    <ChevronRight size={14} />
                                  </button>
                                  <div className="min-w-0">
                                    <p className="font-medium text-[13px] text-[var(--text-primary)] truncate">{review.author_name}</p>
                                    <div className="flex items-center gap-0.5 text-[14px] leading-none">{renderStars(review.rating)}</div>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <Tag dot variant={review.source === 'google' ? 'info' : 'brand'} size="xs">
                                  {review.source === 'google' ? 'Google' : review.source}
                                </Tag>
                              </td>
                              <td className="text-xs text-[var(--text-secondary)]">
                                <p className="truncate max-w-[320px]">{review.comment ? `« ${review.comment} »` : '—'}</p>
                              </td>
                              <td className="text-xs text-[var(--text-muted)]">
                                {review.review_date ? new Date(review.review_date).toLocaleDateString('fr-CA') : '—'}
                              </td>
                              <td className="text-right">
                                {!review.reply && replyingId !== review.id ? (
                                  <div className="flex gap-1 justify-end">
                                    <Button size="sm" variant="secondary" onClick={() => { setReplyingId(review.id); setReplyText(''); }}>{t('reviews.action.reply')}</Button>
                                    <Button size="sm" variant="ghost" onClick={() => void suggestReply(review.id)} disabled={suggestingId === review.id}>
                                      {suggestingId === review.id ? 'IA...' : 'IA'}
                                    </Button>
                                  </div>
                                ) : review.reply ? (
                                  <Tag size="xs" variant="success">{t('reviews.status.replied')}</Tag>
                                ) : null}
                              </td>
                            </tr>
                            <tr>
                              <td colSpan={5} style={{ padding: 0, border: 'none' }}>
                                <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                                  <div className="table-expand-inner">
                                    <div className="table-expand-detail">
                                      <div className="table-expand-detail-section" style={{ flex: '1 1 360px' }}>
                                        <span className="table-expand-detail-label">Commentaire complet</span>
                                        <span className="table-expand-detail-value text-[12px] leading-relaxed text-[var(--text-secondary)]">{review.comment ? `« ${review.comment} »` : 'Pas de commentaire textuel.'}</span>
                                      </div>
                                      <div className="table-expand-detail-section">
                                        <span className="table-expand-detail-label">Source</span>
                                        <span className="table-expand-detail-value text-[12px]">{review.source === 'google' ? 'Google My Business' : review.source}</span>
                                      </div>
                                      <div className="table-expand-detail-section">
                                        <span className="table-expand-detail-label">Lead lié</span>
                                        <span className="table-expand-detail-value text-[12px]">{leadLinked || '—'}</span>
                                      </div>
                                      {review.reply && (
                                        <div className="table-expand-detail-section" style={{ flex: '1 1 100%' }}>
                                          <span className="table-expand-detail-label">Votre réponse</span>
                                          <span className="table-expand-detail-value text-[12px] leading-relaxed reviews-reply-quote">{review.reply}</span>
                                        </div>
                                      )}
                                      {replyingId === review.id && (
                                        <div className="table-expand-detail-section" style={{ flex: '1 1 100%' }}>
                                          <span className="table-expand-detail-label">Rédiger une réponse</span>
                                          <textarea
                                            value={replyText}
                                            onChange={e => setReplyText(e.target.value)}
                                            rows={3}
                                            className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--primary)] focus:outline-none"
                                            placeholder="Écrivez votre réponse..."
                                          />
                                          <div className="flex gap-2 mt-2">
                                            <Button size="sm" onClick={() => void submitReply(review.id)}>{t('reviews.action.send')}</Button>
                                            <Button size="sm" variant="ghost" onClick={() => { setReplyingId(null); setReplyText(''); }}>{t('reviews.action.cancel')}</Button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              </>);
            })()
          )}

          {/* Demandes d'avis */}
          {tab === 'requests' && (
            requests.length === 0 ? (
              <EmptyState
                variant="first-time"
                icon={<span className="text-4xl">📨</span>}
                title={t('reviews.empty.requests')}
                description={t('reviews.empty.requests_desc')}
              />
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('reviews.req.lead')}</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('reviews.req.channel')}</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('reviews.req.status')}</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('reviews.req.sent_at')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((req, idx) => (
                      <tr key={req.id} className="row-premium list-item-enter border-b border-[var(--border-subtle)]" style={{ animationDelay: `${idx * 30}ms` }}>
                        <td className="py-3 px-4">
                          <p className="font-medium">{req.lead_name}</p>
                          <p className="text-xs text-[var(--text-muted)]">{req.lead_email}</p>
                        </td>
                        <td className="py-3 px-4">
                          <Tag dot variant={req.channel === 'email' ? 'info' : 'success'} size="xs" leftIcon={req.channel === 'email' ? <Send size={10} /> : undefined}>
                            {req.channel === 'email' ? 'Email' : 'SMS'}
                          </Tag>
                        </td>
                        <td className="py-3 px-4">
                          <Tag dot size="xs" variant={
                            req.status === 'sent' ? 'info' :
                            req.status === 'clicked' ? 'warning' :
                            req.status === 'reviewed' ? 'success' :
                            'neutral'
                          }>
                            {req.status === 'sent' ? t('reviews.req.status_sent') :
                             req.status === 'clicked' ? t('reviews.req.status_clicked') :
                             req.status === 'reviewed' ? t('reviews.req.status_reviewed') :
                             req.status}
                          </Tag>
                        </td>
                        <td className="py-3 px-4 text-[var(--text-muted)]">
                          {req.sent_at ? new Date(req.sent_at).toLocaleDateString('fr-CA') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )
          )}
        </>
      )}
      </div>
    </AppLayout>
  );
}
