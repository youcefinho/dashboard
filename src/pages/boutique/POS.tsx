// ── POS — Page wrapper /boutique/pos (Sprint 37 Agent B1) ───────────────────
// Wrap le POSTerminal dans AppLayout + ModuleGuard("ecommerce") + PageHero.
// Calque exact des autres pages /boutique/* (BoutiqueDashboard, Produits, etc.).
// Aucun console.log (CLAUDE.md). Toutes chaînes via t().
//
// ── Renforcement (additif, 0 refactor) ──────────────────────────────────────
// Ajoute :
//   - <ErrorBoundary> autour du POSTerminal (capture render-error caisse).
//   - Landmark sémantique <section aria-label> + data-testid pour tests E2E.
//   - aria-live polite côté wrapper (annonces toast caisse).
//   - Confirm avant navigation hors page si une session caisse semble ouverte
//     (heuristique via storage flag `pos.session.active`, posée par POSTerminal
//     si présent ; non-bloquant sinon).
// Aucun key i18n ajouté (parité 4 catalogues préservée STRICT).

import { useEffect } from 'react';
import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import { ModuleGuard } from '../../components/ecommerce/ModuleGuard';
import { POSTerminal } from '../../components/pos/POSTerminal';
import { ErrorBoundary } from '../ErrorBoundary';
import { t } from '../../lib/i18n';

export function POSPage() {
  // Confirm avant unload si une session caisse est ouverte. Heuristique :
  // POSTerminal peut poser `pos.session.active=1` dans sessionStorage ; si la
  // clé est absente, aucun prompt n'est déclenché (silencieux).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      try {
        if (typeof sessionStorage === 'undefined') return;
        if (sessionStorage.getItem('pos.session.active') === '1') {
          // Texte ignoré par les navigateurs modernes, mais déclenche le prompt natif.
          e.preventDefault();
          e.returnValue = t('pos.confirm_close');
        }
      } catch {
        /* sessionStorage indisponible (SSR / privacy mode) — silent */
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <AppLayout title={t('pos.title')}>
      <ModuleGuard module="ecommerce">
        <PageHero
          meta="Boutique · Retail"
          title={t('pos.title')}
          description={t('pos.scan_barcode')}
        />
        <section
          aria-label={t('pos.title')}
          aria-live="polite"
          data-testid="pos-page-root"
        >
          <ErrorBoundary>
            <POSTerminal />
          </ErrorBoundary>
        </section>
      </ModuleGuard>
    </AppLayout>
  );
}

export default POSPage;
