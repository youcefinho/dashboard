// ── SnapshotsPage — Sprint 35 (Agent B4) ────────────────────────────────────
// Page standalone routée `/snapshots` — wrap le SnapshotManager (B1) et
// expose un bouton "Importer un snapshot" qui ouvre le SnapshotImportWizard
// (B2). Le tenant de destination est résolu via getActiveSubAccount() (avec
// fallback sur user.id si aucun sous-compte actif).
//
// Style : Stripe-clean, cohérent avec les autres pages (AppLayout + PageHero).
// Toutes les chaînes via t(). Aucun console.log (CLAUDE.md).
// aria-labels i18n.

import { useCallback, useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { PageHero } from '../components/ui/PageHero';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { SnapshotManager } from '../components/snapshots/SnapshotManager';
import { SnapshotImportWizard } from '../components/snapshots/SnapshotImportWizard';
import { useAuth } from '../lib/auth';
import { getActiveSubAccount } from '../lib/api';
import { t } from '../lib/i18n';

export function SnapshotsPage() {
  const { user } = useAuth();
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);

  // Résolution du tenant de destination :
  //   1. Sous-compte agence actif (multi-tenant agency) si présent.
  //   2. Sinon, l'id de l'utilisateur courant (tenant solo).
  //   3. Sinon, chaîne vide (l'API rejettera proprement et le wizard
  //      affichera l'erreur du back). Pas de placeholder bidon.
  const targetClientId = useMemo<string>(() => {
    const sub = getActiveSubAccount();
    if (sub) return sub;
    return user?.id ?? '';
  }, [user?.id]);

  const handleOpenWizard = useCallback(() => {
    setWizardOpen(true);
  }, []);

  const handleCloseWizard = useCallback(() => {
    setWizardOpen(false);
  }, []);

  return (
    <AppLayout title={t('snapshots.page.title')}>
      <PageHero
        meta={t('snapshots.page.meta')}
        title={t('snapshots.page.title')}
        highlight={t('snapshots.page.title')}
        description={t('snapshots.page.description')}
        actions={
          <Button
            variant="premium"
            onClick={handleOpenWizard}
            leftIcon={<Icon as={Upload} size="sm" />}
            aria-label={t('snapshots.action.import')}
          >
            {t('snapshots.action.import')}
          </Button>
        }
      />

      <SnapshotManager />

      <SnapshotImportWizard
        open={wizardOpen}
        onClose={handleCloseWizard}
        targetClientId={targetClientId}
      />
    </AppLayout>
  );
}

export default SnapshotsPage;
