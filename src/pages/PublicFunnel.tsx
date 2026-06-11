// ── PublicFunnel — page funnel publiée (LOT FUNNEL, Sprint 1) ──────────────
//
// Manager-C Phase C. SPA hydraté public — PAS de SSR React (crawler =
// maybeServeFunnelSsr méta-only côté worker). CALQUE le pattern
// src/pages/PublicForm.tsx : pas d'auth, fetch brut via helpers api FIGÉS
// (getPublicFunnel / submitPublicFunnel), spinner loading, écran succès.
// Le HTML des blocs est compilé par compileBlocksToHtml (DÉJÀ sanitisé/échappé
// côté funnel-blocks.ts via esc/safeUrl) → dangerouslySetInnerHTML sûr.
// Navigation multi-étapes opt-in → … → thankyou. Track view au mount via
// /api/p/:slug/track (fetch brut, sans auth, best-effort). i18n
// t('funnel.public.*') (clés figées Phase A — AUCUNE création).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  getPublicFunnel,
  submitPublicFunnel,
  type Funnel,
  type FunnelStep,
} from '@/lib/api';
import { compileBlocksToHtml } from '@/worker/funnel-blocks';
import { t } from '@/lib/i18n';

export function PublicFunnelPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };

  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ message: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const trackedRef = useRef(false);

  // Chargement public (calque PublicForm.tsx:46-57 — fetch helper sans auth).
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    getPublicFunnel(slug)
      .then((res) => {
        if (!alive) return;
        if (res.error || !res.data) {
          setError(res.error || t('funnel.public.not_found'));
          return;
        }
        setFunnel(res.data.funnel);
        setSteps(
          (res.data.steps || []).sort((a, b) => a.position - b.position),
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  // Track view au mount (best-effort, sans auth, ne bloque jamais le rendu).
  useEffect(() => {
    if (!slug || trackedRef.current) return;
    trackedRef.current = true;
    try {
      void fetch(`/api/p/${slug}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {});
    } catch {
      /* best-effort */
    }
  }, [slug]);

  const currentStep = steps[stepIdx] ?? null;

  const html = currentStep
    ? compileBlocksToHtml(currentStep.page?.blocks || [], {
        slug,
        title: funnel?.name,
      })
    : '';

  // Le HTML compilé contient un <form data-fb-form>. On intercepte son submit
  // pour appeler submitPublicFunnel (réutilise le pipeline forms.ts côté
  // worker → lead CRM, source='funnel' — §6.F).
  const handleFormSubmit = useCallback(
    async (form: HTMLFormElement) => {
      if (submitting) return;
      setSubmitting(true);
      const fd = new FormData(form);
      const data: Record<string, unknown> = {};
      fd.forEach((v, k) => {
        data[k] = v;
      });
      const successMsg = form.getAttribute('data-fb-success') || '';
      const redirect = form.getAttribute('data-fb-redirect') || '';
      const res = await submitPublicFunnel(slug, {
        step_id: currentStep?.id,
        data,
      });
      setSubmitting(false);
      if (res.error || !res.data) {
        setError(res.error || t('funnel.error.submit'));
        return;
      }
      const url = res.data.redirect_url || redirect;
      if (url) {
        window.location.href = url;
        return;
      }
      // Étape suivante si elle existe (multi-étapes), sinon écran de succès.
      if (stepIdx < steps.length - 1) {
        setStepIdx((i) => i + 1);
        window.scrollTo({ top: 0 });
      } else {
        setDone({
          message:
            res.data.success_message ||
            successMsg ||
            t('funnel.public.thank_you'),
        });
      }
    },
    [slug, currentStep, stepIdx, steps.length, submitting],
  );

  // Délégation submit sur le contenu hydraté (le HTML est injecté via
  // dangerouslySetInnerHTML, donc on capture l'évènement au niveau du wrapper).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (form && form.matches?.('form[data-fb-form]')) {
        e.preventDefault();
        void handleFormSubmit(form);
      }
    };
    el.addEventListener('submit', onSubmit, true);
    return () => el.removeEventListener('submit', onSubmit, true);
  }, [handleFormSubmit, html]);

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-[var(--bg-surface)]"
        role="status"
        aria-busy="true"
        aria-label={t('state.loading')}
        data-testid="funnel-loading"
      >
        <div
          style={{
            width: 36,
            height: 36,
            border: '3px solid rgba(0,157,219,0.2)',
            borderTopColor: '#009DDB',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    );
  }

  if (error && !done) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6 text-center"
        role="alert"
        aria-live="polite"
        data-testid="funnel-error"
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            {t('funnel.public.not_found')}
          </h1>
          <p style={{ color: '#6b7280' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6 text-center bg-[var(--bg-surface)]"
        role="status"
        aria-live="polite"
        data-testid="funnel-done"
      >
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
            {t('funnel.public.thank_you')}
          </h1>
          <p style={{ color: '#6b7280', whiteSpace: 'pre-wrap' }}>
            {done.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      aria-busy={submitting || undefined}
      data-testid="funnel-page"
      data-funnel-slug={slug}
      data-step-idx={stepIdx}
      // HTML déjà sanitisé/échappé par compileBlocksToHtml (esc/safeUrl) —
      // sécurité XSS assurée à la compilation, pas ici.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
