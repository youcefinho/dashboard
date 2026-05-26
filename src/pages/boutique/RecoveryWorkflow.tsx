// ── Recovery Workflow — Page wrapper /boutique/recovery-workflow ────────────
// Sprint 40 Agent B4 (seq135). Wrap le RecoveryWorkflowEditor dans
// AppLayout + ModuleGuard("ecommerce") + PageHero. Calque exact des autres
// pages /boutique/* (BoutiqueDashboard, POS, etc.).
// Aucun console.log (CLAUDE.md). Toutes chaînes via t().
//
// Imports RELATIFS (consigne sprint).

import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import { ModuleGuard } from '../../components/ecommerce/ModuleGuard';
import { RecoveryWorkflowEditor } from '../../components/ecommerce/RecoveryWorkflowEditor';
import { ErrorBoundary } from '../ErrorBoundary';
import { t } from '../../lib/i18n';

export function RecoveryWorkflowPage() {
  const title = t('ecommerce.recovery.workflow.title');
  return (
    <AppLayout title={title}>
      <ModuleGuard module="ecommerce">
        <PageHero
          meta={t('page.meta.boutique_abandoned')}
          title={title}
          description={t('ecommerce.recovery.workflow.description')}
        />
        {/* a11y: region role + aria-label pour landmark explicite.
            ErrorBoundary protège l'éditeur (fetch templates, save errors). */}
        <section
          role="region"
          aria-label={title}
          data-testid="recovery-workflow-region"
        >
          <ErrorBoundary>
            <RecoveryWorkflowEditor />
          </ErrorBoundary>
        </section>
      </ModuleGuard>
    </AppLayout>
  );
}

export default RecoveryWorkflowPage;
