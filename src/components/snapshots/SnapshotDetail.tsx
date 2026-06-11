// ── SnapshotDetail — surface du détail "invisible" d'un snapshot ─────────────
// Le SnapshotManager (B1) liste les snapshots mais n'expose JAMAIS le contenu
// complet du manifest (tables_summary tronqué au top 3) ni un appel à
// getSnapshot(id). Ce composant rend ce détail visible : il charge la méta
// fraîche via getSnapshot(id) et affiche le décompte COMPLET des 27 entités
// snapshottables (pas de JSON brut), la métadonnée (statut/taille/date) plus
// les actions existantes apply(publish)/archive du contrat Phase A.
//
// API back FIGÉE (Phase A — lib/api.ts, NON modifié) :
//   getSnapshot(id)        → ApiResponse<SnapshotMeta>
//   publishSnapshot(id)    → ApiResponse<SnapshotMeta>   (= "apply"/mise en prod)
//   archiveSnapshot(id)    → ApiResponse<SnapshotMeta>
//
// Style : Stripe-clean cohérent avec SnapshotManager. Toutes chaînes via t().
// Aucun console.log (CLAUDE.md). a11y : aria-busy au chargement, role=alert sur
// erreur, confirm() avant publish, aria-labels i18n.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, Archive, RefreshCw } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { t, getLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import {
  getSnapshot,
  publishSnapshot,
  archiveSnapshot,
  type SnapshotMeta,
  type SnapshotStatus,
  type SnapshotEntityName,
} from '../../lib/api';

// Ordre d'affichage figé des 27 entités snapshottables (contrat §6).
const ENTITY_ORDER: readonly SnapshotEntityName[] = [
  'pipelines',
  'pipeline_stages',
  'lost_reasons',
  'custom_field_defs',
  'smart_lists',
  'workflow_folders',
  'workflows',
  'workflow_steps',
  'trigger_links',
  'template_folders',
  'email_templates',
  'sms_templates',
  'snippets',
  'forms',
  'form_field_options',
  'lead_segments',
  'task_templates',
  'booking_event_types',
  'calendars',
  'availability_rules',
  'catalog_items',
  'ai_brand_voices',
  'ivr_menus',
  'quick_replies',
  'saved_replies',
  'report_templates',
  'reputation_settings',
];

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} o`;
  const kio = bytes / 1024;
  if (kio < 1024) return `${kio.toFixed(kio < 10 ? 1 : 0)} Kio`;
  const mio = kio / 1024;
  return `${mio.toFixed(mio < 10 ? 1 : 0)} Mio`;
}

const STATUS_CLASS: Record<SnapshotStatus, string> = {
  draft: 'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]',
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-rose-50 text-rose-700 border-rose-200',
};

function statusLabel(s: SnapshotStatus): string {
  if (s === 'published') return t('snapshots.list.status_published');
  if (s === 'archived') return t('snapshots.list.status_archived');
  return t('snapshots.list.status_draft');
}

export interface SnapshotDetailProps {
  /** id du snapshot à inspecter ; null = panneau fermé. */
  snapshotId: string | null;
  /** Fermeture du panneau. */
  onClose: () => void;
  /** Optionnel : notifié après publish/archive réussi (rafraîchir la liste). */
  onMutated?: () => void;
}

export function SnapshotDetail({ snapshotId, onClose, onMutated }: SnapshotDetailProps) {
  const { success, error: toastError } = useToast();
  const locale = useMemo(() => getLocale(), []);

  const [snap, setSnap] = useState<SnapshotMeta | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const open = snapshotId !== null;

  const load = useCallback(async () => {
    if (!snapshotId) return;
    setLoading(true);
    setErrorMsg(null);
    const res = await getSnapshot(snapshotId);
    if (res.error) {
      setErrorMsg(res.error);
      setSnap(null);
    } else if (res.data) {
      setSnap(res.data);
    }
    setLoading(false);
  }, [snapshotId]);

  useEffect(() => {
    if (snapshotId) {
      void load();
    } else {
      setSnap(null);
      setErrorMsg(null);
    }
  }, [snapshotId, load]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );

  const handlePublish = useCallback(async () => {
    if (!snap) return;
    const ok =
      typeof window === 'undefined'
        ? true
        : window.confirm(`${t('snapshots.action.publish')} — ${snap.name}`);
    if (!ok) return;
    setBusy(true);
    const res = await publishSnapshot(snap.id);
    setBusy(false);
    if (res.error) {
      toastError(res.error);
      return;
    }
    if (res.data) setSnap(res.data);
    success(t('snapx.published'));
    onMutated?.();
  }, [snap, success, toastError, onMutated]);

  const handleArchive = useCallback(async () => {
    if (!snap) return;
    const ok =
      typeof window === 'undefined'
        ? true
        : window.confirm(`${t('snapshots.action.archive')} — ${snap.name}`);
    if (!ok) return;
    setBusy(true);
    const res = await archiveSnapshot(snap.id);
    setBusy(false);
    if (res.error) {
      toastError(res.error);
      return;
    }
    if (res.data) setSnap(res.data);
    success(t('snapx.archived'));
    onMutated?.();
  }, [snap, success, toastError, onMutated]);

  // Lignes d'entités : on conserve l'ordre figé, on marque 0 / absent comme vide.
  const entityRows = useMemo(() => {
    const summary = snap?.tables_summary ?? null;
    return ENTITY_ORDER.map((entity) => {
      const raw = summary ? summary[entity] : undefined;
      const count = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      return { entity, count };
    });
  }, [snap?.tables_summary]);

  const totalEntities = useMemo(
    () => entityRows.reduce((acc, r) => acc + r.count, 0),
    [entityRows],
  );

  const hasAnyContent = totalEntities > 0;

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={snap ? snap.name : t('snapx.title')}
      size="lg"
      closeLabel={t('action.cancel')}
    >
      <div
        className="space-y-5"
        data-testid="snapshot-detail"
        aria-busy={loading}
      >
        {loading ? (
          <div className="space-y-3" data-testid="snapshot-detail-loading">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ) : errorMsg ? (
          <div
            role="alert"
            data-testid="snapshot-detail-error"
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 space-y-3"
          >
            <p>{errorMsg}</p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icon as={RefreshCw} size="sm" />}
              onClick={() => void load()}
              aria-label={t('snapx.retry')}
            >
              {t('snapx.retry')}
            </Button>
          </div>
        ) : snap ? (
          <>
            {/* Métadonnée résumée */}
            <section className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  data-testid="snapshot-detail-status"
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASS[snap.status]}`}
                >
                  {statusLabel(snap.status)}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {t('snapshots.list.created_at')}{' '}
                  {formatRelativeTime(snap.created_at, locale)}
                </span>
                <span className="text-xs text-[var(--text-muted)]" aria-hidden="true">
                  •
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {t('snapshots.list.size')} {formatSize(snap.payload_size_bytes)}
                </span>
              </div>
              {snap.description ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  {snap.description}
                </p>
              ) : null}
            </section>

            {/* Manifest : décompte complet des entités (jamais de JSON brut) */}
            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="t-h3 text-[var(--text-primary)]">
                  {t('snapx.contents_title')}
                </h3>
                <span className="text-xs text-[var(--text-muted)]">
                  {t('snapx.total_records', { count: totalEntities })}
                </span>
              </div>

              {snap.tables_summary === null ? (
                <p
                  className="text-sm text-[var(--text-muted)] italic"
                  data-testid="snapshot-detail-manifest-missing"
                >
                  {t('snapx.manifest_pending')}
                </p>
              ) : !hasAnyContent ? (
                <p
                  className="text-sm text-[var(--text-muted)] italic"
                  data-testid="snapshot-detail-empty"
                >
                  {t('snapx.contents_empty')}
                </p>
              ) : (
                <ul
                  className="grid grid-cols-2 sm:grid-cols-3 gap-2 list-none p-0 m-0"
                  data-testid="snapshot-detail-manifest"
                  aria-label={t('snapx.contents_title')}
                >
                  {entityRows.map(({ entity, count }) => (
                    <li
                      key={entity}
                      data-testid={`snapshot-entity-${entity}`}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                        count > 0
                          ? 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                          : 'border-[var(--border-subtle)] bg-[var(--gray-50)] text-[var(--text-muted)]'
                      }`}
                    >
                      <span className="truncate font-mono text-xs">{entity}</span>
                      <span className="font-semibold tabular-nums">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Actions existantes (apply = publish, archive) */}
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              {snap.status === 'draft' ? (
                <Button
                  variant="premium"
                  size="sm"
                  leftIcon={<Icon as={Send} size="sm" />}
                  onClick={() => void handlePublish()}
                  isLoading={busy}
                  disabled={busy}
                  aria-label={`${t('snapshots.action.publish')} — ${snap.name}`}
                >
                  {t('snapshots.action.publish')}
                </Button>
              ) : null}
              {snap.status !== 'archived' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Icon as={Archive} size="sm" />}
                  onClick={() => void handleArchive()}
                  disabled={busy}
                  aria-label={`${t('snapshots.action.archive')} — ${snap.name}`}
                >
                  {t('snapshots.action.archive')}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

export default SnapshotDetail;
