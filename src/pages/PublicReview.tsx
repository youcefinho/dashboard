// ── PublicReview — page PUBLIQUE de dépôt d'avis (LOT REPUTATION, Sprint 8) ──
//
// Corps réel Phase C Manager-C. L'export nommé `PublicReviewPage` est FIGÉ
// (App.tsx GELÉ le lazy-importe — route publique `/r/$token`, hors auth).
//
// Calque EXACT le pattern src/pages/PublicBooking.tsx / PublicFunnel.tsx : pas
// d'auth, fetch brut via helpers api FIGÉS (getPublicReviewPage /
// submitPublicReview), spinner loading, écran succès, discrimination erreur =
// absence `data` / champ `error` (§6.A — JAMAIS de `code`). i18n 100%
// t('pubreview.*') (clés FIGÉES Phase A — AUCUNE création Phase C).
//
// Routing intelligent côté UX (§6.F) : le front ne DÉCIDE JAMAIS du routing.
// Au submit, le worker renvoie `routed` ('public'|'private') et éventuellement
// `redirect_url`. Si routed === 'public' && redirect_url → message + redirection
// vers Google/FB (window.location.href). Sinon → écran de remerciement privé,
// AUCUNE redirection. Le SEUIL reste serveur (jamais exposé au front).

import { useCallback, useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  getPublicReviewPage,
  submitPublicReview,
} from '@/lib/api';
import type { PublicReviewPage as PublicReviewPageData } from '@/lib/types';
import { t } from '@/lib/i18n';

export function PublicReviewPage() {
  const { token } = useParams({ strict: false }) as { token: string };

  const [page, setPage] = useState<PublicReviewPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Écran de fin : routing intelligent renvoyé par le worker. `redirectUrl`
  // présent uniquement quand routed === 'public' (avis satisfait → Google/FB).
  const [done, setDone] = useState<{ redirectUrl?: string | null } | null>(null);

  // ── Chargement de la page publique (nom business + invite) ────────────────
  // Sans auth, discrimination res.error/!res.data (§6.A — jamais de `code`).
  useEffect(() => {
    if (!token) {
      setLoading(false);
      setLoadError(t('pubreview.error'));
      return;
    }
    let alive = true;
    getPublicReviewPage(token)
      .then((res) => {
        if (!alive) return;
        if (res.error || !res.data) {
          setLoadError(res.error || t('pubreview.error'));
          return;
        }
        setPage(res.data);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  // ── Dépôt de l'avis ───────────────────────────────────────────────────────
  // Le worker applique le routing intelligent et renvoie routed + redirect_url.
  const handleSubmit = useCallback(async () => {
    if (submitting || rating < 1) return;
    setSubmitting(true);
    setError('');
    const res = await submitPublicReview(token, {
      rating,
      comment: comment.trim() || undefined,
    });
    setSubmitting(false);
    if (res.error || !res.data) {
      setError(res.error || t('pubreview.error'));
      return;
    }
    // routed === 'public' + redirect_url ⇒ écran public (lien Google/FB).
    // Tout autre cas (private, ou public sans URL) ⇒ remerciement, sans redirect.
    const isPublic = res.data.routed === 'public' && !!res.data.redirect_url;
    setDone({ redirectUrl: isPublic ? res.data.redirect_url : null });
  }, [submitting, rating, comment, token]);

  // Honore redirect_url côté public (calque PublicBooking.tsx:229-236).
  useEffect(() => {
    if (done?.redirectUrl) {
      const url = done.redirectUrl;
      const timer = setTimeout(() => {
        window.location.href = url as string;
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [done]);

  // ── Spinner de chargement (calque PublicBooking.tsx:394-406) ──────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid rgba(0,157,219,0.2)',
            borderTopColor: '#009DDB',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    );
  }

  // ── Erreur de chargement = absence data / token inconnu (§6.A) ────────────
  if (loadError || !page) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center bg-white">
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            {t('pubreview.title')}
          </h1>
          <p style={{ color: '#6b7280' }}>{loadError || t('pubreview.error')}</p>
        </div>
      </div>
    );
  }

  // ── Invitation déjà soumise (status ≠ 'sent') — anti-rejeu côté UX ────────
  const alreadySubmitted = !!page.status && page.status !== 'sent';

  // ── Écran de fin (calque PublicBooking.tsx:242-279) ───────────────────────
  if (done || alreadySubmitted) {
    const isPublicRedirect = !!done?.redirectUrl;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center bg-white">
        <div style={{ maxWidth: 480 }}>
          <div
            style={{
              width: 64,
              height: 64,
              background: '#ecfdf5',
              color: '#10b981',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: 28,
            }}
          >
            ✓
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            {t('pubreview.thanks_title')}
          </h1>
          {alreadySubmitted && !done ? (
            <p style={{ color: '#6b7280' }}>{t('pubreview.already_submitted')}</p>
          ) : isPublicRedirect ? (
            <>
              {/* Avis satisfait → invitation à publier sur Google/FB + lien. */}
              <p style={{ color: '#6b7280', marginBottom: 16 }}>
                {t('pubreview.redirect_message')}
              </p>
              <a
                href={done!.redirectUrl as string}
                className="inline-block rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white"
              >
                {t('pubreview.submit')}
              </a>
            </>
          ) : (
            // Feedback privé (note < seuil) — remerciement, AUCUNE redirection.
            <p style={{ color: '#6b7280' }}>{t('pubreview.thanks_message')}</p>
          )}
        </div>
      </div>
    );
  }

  const labelClasses =
    'mb-1 block text-sm font-medium text-[var(--text-secondary)]';
  const inputClasses =
    'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]';

  // Sélecteur d'étoiles 1-5 (note affichée = survol > sélection).
  const shown = hover || rating;

  return (
    <div className="min-h-screen bg-white p-4 flex justify-center items-start">
      <div className="w-full max-w-lg p-6">
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          {page.business_name}
        </h1>
        <p
          className="text-sm"
          style={{ color: '#6b7280', marginBottom: 20 }}
          data-review-token={token}
        >
          {page.message || t('pubreview.subtitle')}
        </p>

        <div className="space-y-5">
          {/* Sélecteur d'étoiles 1-5 */}
          <div>
            <label className={labelClasses}>{t('pubreview.rating_label')}</label>
            <div className="flex gap-1" role="radiogroup" aria-label={t('pubreview.rating_label')}>
              {[1, 2, 3, 4, 5].map((n) => {
                const filled = n <= shown;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={n === rating}
                    aria-label={String(n)}
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(0)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      lineHeight: 1,
                      fontSize: 34,
                      color: filled ? 'var(--warning)' : 'var(--border)',
                    }}
                  >
                    ★
                  </button>
                );
              })}
            </div>
          </div>

          {/* Commentaire optionnel */}
          <div>
            <label className={labelClasses} htmlFor="pr-comment">
              {t('pubreview.comment_label')}
            </label>
            <textarea
              id="pr-comment"
              className={inputClasses}
              rows={4}
              value={comment}
              placeholder={t('pubreview.comment_placeholder')}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || rating < 1}
            className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t('pubreview.submit')}
          </button>

          <p
            className="text-center pt-2"
            style={{ fontSize: 10, color: '#6b7280' }}
          >
            Propulsé par <strong>Intralys</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
