// ── GettingStarted — /getting-started (Sprint 21 — Onboarding durci) ────────
//
// Page dédiée regroupant la checklist enrichie côté serveur. Sert d'ancrage
// SEO/UX pour la nouvelle expérience d'onboarding (vs le chip sidebar qui est
// auto-hide). Calque le pattern des pages CRM standard : <AppLayout> + <PageHero>
// + contenu (ici, <OnboardingChecklistPanel variant="page">).

import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHero } from '@/components/ui/PageHero';
import { OnboardingChecklistPanel } from '@/components/onboarding/OnboardingChecklistPanel';
import { ErrorBoundary } from '@/pages/ErrorBoundary';
import { t } from '@/lib/i18n';

export function GettingStartedPage() {
  const navigate = useNavigate();

  return (
    <AppLayout title={t('onboarding.getting_started.title')}>
      <PageHero
        meta={t('onboarding.getting_started.title')}
        title={t('onboarding.getting_started.title')}
        description={t('onboarding.getting_started.subtitle')}
      />

      {/* a11y: region role + aria-label so screen readers announce
          this as the "Getting started checklist" landmark. */}
      <section
        className="max-w-3xl"
        role="region"
        aria-label={t('onboarding.getting_started.region_label')}
        data-testid="getting-started-region"
      >
        {/* ErrorBoundary: protège la page si OnboardingChecklistPanel
            crash (fetch checklist, render erreur). UX fallback déjà fournie
            par ErrorBoundary partagée — pas de spinner ici car le panel
            gère son propre Loading/Empty/Error en interne. */}
        <ErrorBoundary>
          <OnboardingChecklistPanel
            variant="page"
            onItemNavigate={(to) => {
              void navigate({ to });
            }}
          />
        </ErrorBoundary>
      </section>
    </AppLayout>
  );
}
