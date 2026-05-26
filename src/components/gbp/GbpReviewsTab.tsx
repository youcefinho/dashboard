// ── GbpReviewsTab — Sprint 32 C2 ───────────────────────────────────────────
// Onglet "Google Business Profile" pour la page Reviews.
//
// Pattern :
//   1. Si aucune location sélectionnée → affiche GbpLocationsList pour pick.
//   2. Sinon → charge getGbpReviews(locId), affiche la liste, permet reply inline.
//   3. Bouton "Synchroniser" → syncGbpReviews() puis reload de la location active.
//   4. Reply : textarea local par review (replyDraft map) + replyGbpReview().
//   5. Tag de statut (sent / pending / failed / none) via i18n gbp.reviews.reply_*.
//
// Honnêteté UI : skeleton pendant load, EmptyState si pas de reviews, jamais
// d'état silencieux. Le worker tronc/sanitize le contenu côté serveur.

import { useState, useCallback } from 'react';
import { t } from '@/lib/i18n';
import { getGbpReviews, replyGbpReview, syncGbpReviews } from '@/lib/api';
import { GbpLocationsList } from './GbpLocationsList';
import { Card, Button, Tag, EmptyState } from '@/components/ui';

export function GbpReviewsTab() {
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});

  const loadReviews = useCallback(async (locId: string) => {
    setLoading(true);
    const res = await getGbpReviews(locId);
    setLoading(false);
    if (res.data) setReviews(res.data);
  }, []);

  async function handleSelect(locId: string) {
    setSelectedLocId(locId);
    await loadReviews(locId);
  }

  async function handleSync() {
    setSyncing(true);
    await syncGbpReviews();
    setSyncing(false);
    if (selectedLocId) await loadReviews(selectedLocId);
  }

  async function handleReply(reviewName: string) {
    const comment = replyDraft[reviewName];
    if (!comment?.trim()) return;
    await replyGbpReview(reviewName, comment);
    setReplyDraft((d) => ({ ...d, [reviewName]: '' }));
    if (selectedLocId) await loadReviews(selectedLocId);
  }

  return (
    <div data-component="GbpReviewsTab" className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold">{t('gbp.reviews.title')}</h2>
        <Button onClick={() => void handleSync()} disabled={syncing}>
          {syncing ? '…' : t('gbp.reviews.sync_now')}
        </Button>
      </div>

      {!selectedLocId ? (
        <GbpLocationsList onLocationSelect={(id) => void handleSelect(id)} />
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={() => setSelectedLocId(null)}>
            ← {t('gbp.locations.title')}
          </Button>

          {loading && (
            <div className="text-xs text-[var(--text-muted)]">…</div>
          )}

          {!loading && reviews.length === 0 && (
            <EmptyState
              variant="first-time"
              title={t('gbp.reviews.empty')}
            />
          )}

          {!loading &&
            reviews.map((r) => {
              const review = r as {
                id?: string;
                external_id?: string;
                author_name?: string;
                rating?: number;
                content?: string;
                reply_status?: 'none' | 'pending' | 'sent' | 'failed';
              };
              const key = (review.id ?? review.external_id ?? Math.random().toString(36)) as string;
              const replyKey = (review.external_id ?? review.id ?? '') as string;
              const draft = replyDraft[replyKey] ?? '';
              return (
                <Card key={key}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[13px] text-[var(--text-primary)]">
                        {review.author_name || t('gbp.reviews.anonymous') || 'Anonyme'} — ★{review.rating ?? '—'}
                      </div>
                      <p className="text-sm text-[var(--text-secondary)] mt-1">
                        {review.content || '—'}
                      </p>
                    </div>
                    {review.reply_status && (
                      <Tag
                        size="xs"
                        variant={
                          review.reply_status === 'sent'
                            ? 'success'
                            : review.reply_status === 'failed'
                              ? 'danger'
                              : review.reply_status === 'pending'
                                ? 'warning'
                                : 'neutral'
                        }
                      >
                        {t(`gbp.reviews.reply_${review.reply_status}`)}
                      </Tag>
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={draft}
                      onChange={(e) =>
                        setReplyDraft((d) => ({ ...d, [replyKey]: e.target.value }))
                      }
                      placeholder={t('gbp.reviews.reply')}
                      rows={2}
                      className="w-full p-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--primary)] focus:outline-none"
                    />
                    <Button
                      size="sm"
                      onClick={() => void handleReply(replyKey)}
                      disabled={!draft.trim()}
                    >
                      {t('gbp.reviews.reply')}
                    </Button>
                  </div>
                </Card>
              );
            })}
        </>
      )}
    </div>
  );
}
