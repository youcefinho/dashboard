// ── Page Reviews — Avis & Réputation ────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Card, Badge, EmptyState } from '@/components/ui';
import { apiFetch } from '@/lib/api';

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

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < rating ? 'text-yellow-400' : 'text-[var(--color-border)]'}>★</span>
    ));
  };

  const ratingBar = (count: number, total: number, stars: number) => {
    const pct = total > 0 ? (count / total) * 100 : 0;
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-8 text-right text-[var(--color-text-muted)]">{stars}★</span>
        <div className="flex-1 h-2 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
          <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-8 text-[var(--color-text-muted)]">{count}</span>
      </div>
    );
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Vue d\'ensemble' },
    { key: 'reviews', label: `Avis (${reviews.length})` },
    { key: 'requests', label: `Demandes (${requests.length})` },
  ];

  return (
    <AppLayout title="Avis & Réputation">
      {/* Onglets */}
      <div className="flex gap-1 bg-[var(--color-bg-tertiary)] p-1 rounded-[var(--radius-lg)] w-fit mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-all cursor-pointer ${
              tab === t.key
                ? 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-[var(--shadow-xs)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t.label}
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
              {/* KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Note moyenne</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold">{stats.average_rating || '—'}</span>
                    <span className="text-lg">⭐</span>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">{stats.total_reviews} avis au total</p>
                </Card>
                <Card>
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">5 étoiles</p>
                  <span className="text-3xl font-bold text-[var(--color-success)]">{stats.five_star}</span>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    {stats.total_reviews > 0 ? `${((stats.five_star / stats.total_reviews) * 100).toFixed(0)}%` : '—'} du total
                  </p>
                </Card>
                <Card>
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Réponses</p>
                  <span className="text-3xl font-bold">{stats.replied_count}</span>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">sur {stats.total_reviews} avis</p>
                </Card>
                <Card>
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Demandes envoyées</p>
                  <span className="text-3xl font-bold">{stats.total_requests}</span>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">{stats.pending_requests} en attente</p>
                </Card>
              </div>

              {/* Distribution des notes */}
              <Card>
                <h3 className="text-sm font-semibold mb-4">Distribution des notes</h3>
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

          {/* Liste des avis */}
          {tab === 'reviews' && (
            reviews.length === 0 ? (
              <EmptyState
                icon={<span className="text-4xl">⭐</span>}
                title="Aucun avis"
                description="Les avis Google seront synchronisés automatiquement."
              />
            ) : (
              <div className="space-y-4">
                {reviews.map(review => (
                  <Card key={review.id}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold">{review.author_name}</span>
                          <Badge color={review.source === 'google' ? 'var(--color-info)' : 'var(--color-accent)'}>
                            {review.source === 'google' ? '🔍 Google' : review.source}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 text-lg mb-2">
                          {renderStars(review.rating)}
                        </div>
                        {review.comment && (
                          <p className="text-sm text-[var(--color-text-secondary)] mb-2">« {review.comment} »</p>
                        )}
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {review.review_date ? new Date(review.review_date).toLocaleDateString('fr-CA') : ''}
                        </p>

                        {/* Réponse existante */}
                        {review.reply && (
                          <div className="mt-3 pl-4 border-l-2 border-[var(--color-accent)]">
                            <p className="text-xs font-medium text-[var(--color-accent)] mb-1">Votre réponse</p>
                            <p className="text-sm text-[var(--color-text-secondary)]">{review.reply}</p>
                          </div>
                        )}

                        {/* Zone de réponse */}
                        {replyingId === review.id && (
                          <div className="mt-3 space-y-2">
                            <textarea
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                              rows={3}
                              className="w-full px-3 py-2 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--color-accent)] focus:outline-none"
                              placeholder="Écrivez votre réponse..."
                            />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => void submitReply(review.id)}>Envoyer</Button>
                              <Button size="sm" variant="ghost" onClick={() => { setReplyingId(null); setReplyText(''); }}>Annuler</Button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      {!review.reply && replyingId !== review.id && (
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => { setReplyingId(review.id); setReplyText(''); }}
                          >
                            💬 Répondre
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void suggestReply(review.id)}
                            disabled={suggestingId === review.id}
                          >
                            {suggestingId === review.id ? '⏳ IA...' : '🤖 Suggestion IA'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )
          )}

          {/* Demandes d'avis */}
          {tab === 'requests' && (
            requests.length === 0 ? (
              <EmptyState
                icon={<span className="text-4xl">📨</span>}
                title="Aucune demande"
                description="Envoyez des demandes d'avis à vos clients satisfaits."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)]">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Lead</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Canal</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Status</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Envoyé le</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(req => (
                      <tr key={req.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-medium">{req.lead_name}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{req.lead_email}</p>
                        </td>
                        <td className="py-3 px-4">
                          <Badge color={req.channel === 'email' ? 'var(--color-info)' : 'var(--color-success)'}>
                            {req.channel === 'email' ? '📧 Email' : '📱 SMS'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge color={
                            req.status === 'sent' ? 'var(--color-info)' :
                            req.status === 'clicked' ? 'var(--color-warning)' :
                            req.status === 'reviewed' ? 'var(--color-success)' :
                            'var(--color-muted)'
                          }>
                            {req.status === 'sent' ? 'Envoyé' :
                             req.status === 'clicked' ? 'Cliqué' :
                             req.status === 'reviewed' ? 'Avis laissé' :
                             req.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-[var(--color-text-muted)]">
                          {req.sent_at ? new Date(req.sent_at).toLocaleDateString('fr-CA') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </AppLayout>
  );
}
