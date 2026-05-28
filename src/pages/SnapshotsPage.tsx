// ── SnapshotsPage — Sprint 35 (Agent B4) ────────────────────────────────────
// Page standalone routée `/snapshots` — wrap le SnapshotManager (B1) et
// expose un bouton "Importer un snapshot" qui ouvre le SnapshotImportWizard
// (B2). Le tenant de destination est résolu via getActiveSubAccount() (avec
// fallback sur user.id si aucun sous-compte actif).
//
// Sprint 35+ — Surface du détail "invisible" : le SnapshotManager liste les
// snapshots mais tronque tables_summary au top 3 et n'appelle jamais
// getSnapshot(id). On ajoute ici un sélecteur d'inspection (additif, sous le
// manager) qui ouvre <SnapshotDetail> : décompte COMPLET du manifest +
// actions apply(publish)/archive. La liste existante n'est pas touchée.
//
// Style : Stripe-clean, cohérent avec les autres pages (AppLayout + PageHero).
// Toutes les chaînes via t(). Aucun console.log (CLAUDE.md).
// aria-labels i18n.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, Eye } from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { PageHero } from '../components/ui/PageHero';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Skeleton } from '../components/ui/Skeleton';
import { SnapshotManager } from '../components/snapshots/SnapshotManager';
import { SnapshotImportWizard } from '../components/snapshots/SnapshotImportWizard';
import { SnapshotDetail } from '../components/snapshots/SnapshotDetail';
import { useAuth } from '../lib/auth';
import { getActiveSubAccount, getSnapshots, type SnapshotMeta } from '../lib/api';
import { t } from '../lib/i18n';

export function SnapshotsPage() {
  const { user } = useAuth();
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);

  // ── Inspection détail (additif) ───────────────────────────────────────────
  const [detailId, setDetailId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    const res = await getSnapshots();
    if (res.error) {
      setErrorMsg(res.error);
      setSnapshots([]);
    } else if (res.data) {
      setSnapshots(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

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

  const handleCloseDetail = useCallback(() => {
    setDetailId(null);
  }, []);

  const handleDetailMutated = useCallback(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

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

      {/* ── Inspection détail (additif, n'altère pas la liste du manager) ──── */}
      <section className="mt-8 space-y-3" data-testid="snapshot-inspect">
        <div className="min-w-0">
          <h2 className="t-h2">{t('snapx.inspect_title')}</h2>
          <p className="t-caption text-[var(--gray-500)] mt-1">
            {t('snapx.inspect_description')}
          </p>
        </div>

        {loading ? (
          <div
            className="flex flex-wrap gap-2"
            data-testid="snapshot-inspect-loading"
            aria-busy="true"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-40 rounded-lg" />
            ))}
          </div>
        ) : errorMsg ? (
          <div
            role="alert"
            data-testid="snapshot-inspect-error"
            className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {errorMsg}
          </div>
        ) : snapshots.length === 0 ? (
          <p
            className="text-sm text-[var(--text-muted)] italic"
            data-testid="snapshot-inspect-empty"
          >
            {t('snapshots.list.empty')}
          </p>
        ) : (
          <ul
            className="flex flex-wrap gap-2 list-none p-0 m-0"
            data-testid="snapshot-inspect-list"
            aria-label={t('snapx.inspect_title')}
          >
            {snapshots.map((snap) => (
              <li key={snap.id}>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Icon as={Eye} size="sm" />}
                  onClick={() => setDetailId(snap.id)}
                  aria-label={`${t('snapx.view_detail')} — ${snap.name}`}
                >
                  {snap.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SnapshotDetail
        snapshotId={detailId}
        onClose={handleCloseDetail}
        onMutated={handleDetailMutated}
      />

      <SnapshotImportWizard
        open={wizardOpen}
        onClose={handleCloseWizard}
        targetClientId={targetClientId}
      />
    </AppLayout>
  );
}

export default SnapshotsPage;
