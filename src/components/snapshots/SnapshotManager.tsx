// ── SnapshotManager — Sprint 35 (Agent B1) ──────────────────────────────────
// Liste + création + actions (download/publish/archive/delete) des snapshots
// GHL-style sur le tenant courant.
//
// API back FIGÉE (Phase A) :
//   getSnapshots()                          → ApiResponse<SnapshotMeta[]>
//   createSnapshot({ name, description? })  → ApiResponse<SnapshotMeta>
//   downloadSnapshot(id)                    → { data: Blob } | { error }
//   publishSnapshot(id)                     → ApiResponse<SnapshotMeta>
//   archiveSnapshot(id)                     → ApiResponse<SnapshotMeta>
//   deleteSnapshot(id)                      → ApiResponse<{ ok: true }>
//
// Style : Stripe-clean, flat surfaces, focus ring purple, status badges
// gris/vert/rouge. Toutes les chaînes via t(). Aucun console.log (CLAUDE.md).
// aria-labels i18n sur chaque action.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  Download,
  Send,
  Archive,
  Trash2,
  Camera,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import { getLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import {
  getSnapshots,
  createSnapshot,
  downloadSnapshot,
  publishSnapshot,
  archiveSnapshot,
  deleteSnapshot,
  type SnapshotMeta,
  type SnapshotStatus,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Format bytes → "12 Kio" / "3,4 Mio". Pas d'arrondi brutal sous 1 Kio. */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} o`;
  const kio = bytes / 1024;
  if (kio < 1024) return `${kio.toFixed(kio < 10 ? 1 : 0)} Kio`;
  const mio = kio / 1024;
  return `${mio.toFixed(mio < 10 ? 1 : 0)} Mio`;
}

/** Résumé tables : "workflows: 12 • forms: 4 • templates: 7" (top 3 entités). */
function formatTablesSummary(
  summary: SnapshotMeta['tables_summary'],
): string {
  if (!summary) return '';
  const entries = Object.entries(summary)
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 3);
  if (entries.length === 0) return '';
  return entries.map(([k, n]) => `${k}: ${n}`).join(' • ');
}

/** Nom de fichier safe pour download (slugifié + .json). */
function safeFileName(name: string, id: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const base = slug || id;
  return `snapshot-${base}.json`;
}

const STATUS_CLASS: Record<SnapshotStatus, string> = {
  draft:
    'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]',
  published:
    'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived:
    'bg-rose-50 text-rose-700 border-rose-200',
};

function statusLabel(s: SnapshotStatus): string {
  if (s === 'published') return t('snapshots.list.status_published');
  if (s === 'archived') return t('snapshots.list.status_archived');
  return t('snapshots.list.status_draft');
}

// ── Composant ──────────────────────────────────────────────────────────────

export function SnapshotManager() {
  const { success, error: toastError } = useToast();

  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [formName, setFormName] = useState<string>('');
  const [formDesc, setFormDesc] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const locale = useMemo(() => getLocale(), []);

  // ── Chargement initial ──────────────────────────────────────────────────
  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    const res = await getSnapshots();
    if (res.error) {
      toastError(res.error);
      setSnapshots([]);
    } else if (res.data) {
      setSnapshots(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  // ── Création ────────────────────────────────────────────────────────────
  const handleOpenCreate = useCallback(() => {
    setFormName('');
    setFormDesc('');
    setModalOpen(true);
  }, []);

  const handleSubmitCreate = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = formName.trim();
      if (!name) return;
      setSubmitting(true);
      const res = await createSnapshot({
        name,
        description: formDesc.trim() || undefined,
      });
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('snapshots.toast.created'));
      setModalOpen(false);
      setFormName('');
      setFormDesc('');
      void loadSnapshots();
    },
    [formName, formDesc, success, toastError, loadSnapshots],
  );

  // ── Actions par snapshot ────────────────────────────────────────────────

  const handleDownload = useCallback(
    async (snap: SnapshotMeta) => {
      setBusyId(snap.id);
      const res = await downloadSnapshot(snap.id);
      setBusyId(null);
      if ('error' in res) {
        toastError(res.error);
        return;
      }
      // Trigger blob download via <a download> éphémère.
      try {
        const url = URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = safeFileName(snap.name, snap.id);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch {
        toastError(t('snapshots.error.invalid_schema'));
      }
    },
    [toastError],
  );

  const handlePublish = useCallback(
    async (snap: SnapshotMeta) => {
      setBusyId(snap.id);
      const res = await publishSnapshot(snap.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadSnapshots();
    },
    [toastError, loadSnapshots],
  );

  const handleArchive = useCallback(
    async (snap: SnapshotMeta) => {
      setBusyId(snap.id);
      const res = await archiveSnapshot(snap.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadSnapshots();
    },
    [toastError, loadSnapshots],
  );

  const handleDelete = useCallback(
    async (snap: SnapshotMeta) => {
      // Confirmation native (léger, cohérent avec AlertRulesPanel).
      const ok =
        typeof window === 'undefined'
          ? true
          : window.confirm(`${t('snapshots.action.delete')} — ${snap.name}`);
      if (!ok) return;
      setBusyId(snap.id);
      const res = await deleteSnapshot(snap.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadSnapshots();
    },
    [toastError, loadSnapshots],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="snapshot-manager">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('snapshots.page.title')}</h2>
          <p className="t-caption text-[var(--gray-500)] mt-1">
            {t('snapshots.page.description')}
          </p>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('snapshots.action.create')}
        >
          {t('snapshots.action.create')}
        </Button>
      </header>

      {/* Liste / loading / empty */}
      {loading ? (
        <div className="space-y-3" data-testid="snapshot-loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : snapshots.length === 0 ? (
        <EmptyState
          icon={<Icon as={Camera} size={40} />}
          title={t('snapshots.list.empty')}
          description={t('snapshots.page.description')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('snapshots.action.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="snapshot-list"
          aria-label={t('snapshots.page.title')}
        >
          {snapshots.map((snap) => {
            const isBusy = busyId === snap.id;
            const tablesSummary = formatTablesSummary(snap.tables_summary);
            const sizeStr = formatSize(snap.payload_size_bytes);
            const createdRel = formatRelativeTime(snap.created_at, locale);
            const labelDownload = t('snapshots.action.download');
            const labelPublish = t('snapshots.action.publish');
            const labelArchive = t('snapshots.action.archive');
            const labelDelete = t('snapshots.action.delete');
            return (
              <li
                key={snap.id}
                data-testid={`snapshot-row-${snap.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {snap.name}
                    </h3>
                    <span
                      data-testid={`snapshot-status-${snap.id}`}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASS[snap.status]}`}
                    >
                      {statusLabel(snap.status)}
                    </span>
                  </div>
                  {snap.description ? (
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                      {snap.description}
                    </p>
                  ) : null}
                  <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      {t('snapshots.list.created_at')} {createdRel}
                    </span>
                    <span aria-hidden="true">•</span>
                    <span>
                      {t('snapshots.list.size')} {sizeStr}
                    </span>
                    {tablesSummary ? (
                      <>
                        <span aria-hidden="true">•</span>
                        <span className="font-mono">{tablesSummary}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Download} size="sm" />}
                    onClick={() => void handleDownload(snap)}
                    disabled={isBusy}
                    aria-label={`${labelDownload} — ${snap.name}`}
                  >
                    {labelDownload}
                  </Button>
                  {snap.status === 'draft' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Icon as={Send} size="sm" />}
                      onClick={() => void handlePublish(snap)}
                      disabled={isBusy}
                      aria-label={`${labelPublish} — ${snap.name}`}
                    >
                      {labelPublish}
                    </Button>
                  ) : null}
                  {snap.status !== 'archived' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Icon as={Archive} size="sm" />}
                      onClick={() => void handleArchive(snap)}
                      disabled={isBusy}
                      aria-label={`${labelArchive} — ${snap.name}`}
                    >
                      {labelArchive}
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(snap)}
                    disabled={isBusy}
                    aria-label={`${labelDelete} — ${snap.name}`}
                  >
                    {labelDelete}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal création */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={t('snapshots.create.modal_title')}
        size="md"
      >
        <form onSubmit={handleSubmitCreate} className="space-y-4">
          <div>
            <label
              htmlFor="snapshot-name"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('snapshots.create.name_label')}
            </label>
            <Input
              id="snapshot-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              autoFocus
              required
              aria-label={t('snapshots.create.name_label')}
            />
          </div>
          <div>
            <label
              htmlFor="snapshot-desc"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('snapshots.create.description_label')}
            </label>
            <Textarea
              id="snapshot-desc"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              rows={4}
              maxLength={500}
              showCounter
              aria-label={t('snapshots.create.description_label')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setModalOpen(false)}
              disabled={submitting}
            >
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              isLoading={submitting}
              disabled={submitting || !formName.trim()}
              aria-label={t('snapshots.create.submit')}
            >
              {t('snapshots.create.submit')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
