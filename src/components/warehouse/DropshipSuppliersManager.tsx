// ── DropshipSuppliersManager — Sprint 47 (Agent B1) ──────────────────────────
// Liste cards suppliers dropshipping + modal CRUD + modal import CSV catalog.
//
// API back FIGÉE (Phase A) :
//   listDropshipSuppliers()                   → ApiResponse<DropshipSupplier[]>
//   createDropshipSupplier(body)              → ApiResponse<DropshipSupplier>
//   updateDropshipSupplier(id, body)          → ApiResponse<DropshipSupplier>
//   deleteDropshipSupplier(id)                → ApiResponse<{ ok: true }>
//   importSupplierCatalogCsv(id, csvText)     → ApiResponse<{ imported, skipped }>
//
// Style : Stripe-clean cards, badges actif/inactif. api_key masquée after save
// (api_key_set === '***' renvoyé par le back). csv_format_json éditable en
// JSON brut (validation léger). aria-labels i18n.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Upload,
  Truck,
  Key,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t, getLocale } from '../../lib/i18n';
import {
  listDropshipSuppliers,
  createDropshipSupplier,
  updateDropshipSupplier,
  deleteDropshipSupplier,
  importSupplierCatalogCsv,
  type DropshipSupplier,
  type DropshipSupplierInput,
} from '../../lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number, locale: string): string {
  if (!Number.isFinite(cents)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'CAD',
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} $`;
  }
}

/** Validation JSON safe (renvoie message d'erreur ou null). */
function validateJson(s: string): string | null {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  try {
    JSON.parse(trimmed);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'JSON invalide';
  }
}

interface FormState {
  name: string;
  api_endpoint: string;
  api_key: string;
  csv_format_json: string;
  contact_email: string;
  default_shipping_cost: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  api_endpoint: '',
  api_key: '',
  csv_format_json: '',
  contact_email: '',
  default_shipping_cost: '0',
  is_active: true,
};

function supplierToForm(s: DropshipSupplier): FormState {
  return {
    name: s.name ?? '',
    api_endpoint: s.api_endpoint ?? '',
    api_key: '', // masquée after save — laisser vide pour ne pas écraser
    csv_format_json: s.csv_format_json ?? '',
    contact_email: s.contact_email ?? '',
    default_shipping_cost: ((s.default_shipping_cost_cents ?? 0) / 100).toFixed(
      2,
    ),
    is_active: s.is_active === 1,
  };
}

function formToInput(f: FormState, isEdit: boolean): DropshipSupplierInput {
  const cents = Math.round(Number(f.default_shipping_cost) * 100);
  const body: DropshipSupplierInput = {
    name: f.name.trim(),
    api_endpoint: f.api_endpoint.trim() || null,
    csv_format_json: f.csv_format_json.trim() || null,
    contact_email: f.contact_email.trim() || null,
    default_shipping_cost_cents: Number.isFinite(cents) ? cents : 0,
    is_active: f.is_active ? 1 : 0,
  };
  // api_key : envoyer uniquement si l'utilisateur a tapé une nouvelle valeur.
  // En mode edit, vide ⇒ ne pas overrider la clé existante chiffrée.
  if (!isEdit) {
    body.api_key = f.api_key.trim() || null;
  } else if (f.api_key.trim()) {
    body.api_key = f.api_key.trim();
  }
  return body;
}

export function DropshipSuppliersManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [suppliers, setSuppliers] = useState<DropshipSupplier[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<DropshipSupplier | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Import CSV modal state
  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [importTarget, setImportTarget] = useState<DropshipSupplier | null>(
    null,
  );
  const [importing, setImporting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const locale = useMemo(() => getLocale(), []);

  const jsonError = useMemo(
    () => validateJson(form.csv_format_json),
    [form.csv_format_json],
  );

  // ── Chargement ──────────────────────────────────────────────────────────
  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listDropshipSuppliers();
    if (res.error) {
      setLoadError(res.error);
      toastError(res.error);
      setSuppliers([]);
    } else if (res.data) {
      setSuppliers(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  // ── CRUD ────────────────────────────────────────────────────────────────
  const handleOpenCreate = useCallback(() => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((s: DropshipSupplier) => {
    setEditing(s);
    setForm(supplierToForm(s));
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = form.name.trim();
      if (!name) return;
      if (jsonError) {
        toastError(jsonError);
        return;
      }
      setSubmitting(true);
      const body = formToInput(form, editing !== null);
      const res = editing
        ? await updateDropshipSupplier(editing.id, body)
        : await createDropshipSupplier(body);
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setModalOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      void loadSuppliers();
    },
    [editing, form, jsonError, success, toastError, loadSuppliers],
  );

  const handleDelete = useCallback(
    async (s: DropshipSupplier) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('dropship.suppliers.delete.confirm')} — ${s.name}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(s.id);
      const res = await deleteDropshipSupplier(s.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadSuppliers();
    },
    [confirm, toastError, loadSuppliers],
  );

  // ── Import CSV ──────────────────────────────────────────────────────────
  const handleOpenImport = useCallback((s: DropshipSupplier) => {
    setImportTarget(s);
    setImportResult(null);
    setImportOpen(true);
  }, []);

  const handleCloseImport = useCallback((open: boolean) => {
    setImportOpen(open);
    if (!open) {
      setImportTarget(null);
      setImportResult(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !importTarget) return;
      setImporting(true);
      setImportResult(null);
      try {
        const text = await file.text();
        const res = await importSupplierCatalogCsv(importTarget.id, text);
        if (res.error) {
          toastError(res.error);
        } else if (res.data) {
          setImportResult(res.data);
          success(t('dropship.suppliers.import_csv'));
        }
      } catch {
        toastError(t('dropship.suppliers.import.file_read_error'));
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [importTarget, success, toastError],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6" data-testid="dropship-suppliers-manager">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('dropship.suppliers.title')}</h2>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('dropship.suppliers.create')}
        >
          {t('dropship.suppliers.create')}
        </Button>
      </header>

      {loading ? (
        <div
          className="space-y-3"
          data-testid="dropship-suppliers-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('dropship.suppliers.title')}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
          role="alert"
          data-testid="dropship-suppliers-error"
        >
          <p className="font-medium mb-1">{t('dropship.suppliers.errors.load_failed')}</p>
          <p className="text-xs opacity-80">{loadError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadSuppliers()}
            className="mt-2"
            aria-label={t('action.retry')}
          >
            {t('action.retry')}
          </Button>
        </div>
      ) : suppliers.length === 0 ? (
        <EmptyState
          icon={<Icon as={Truck} size={40} />}
          title={t('dropship.suppliers.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('dropship.suppliers.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="dropship-suppliers-list"
          aria-label={t('dropship.suppliers.title')}
        >
          {suppliers.map((s) => {
            const isBusy = busyId === s.id;
            const isActive = s.is_active === 1;
            const hasKey = s.api_key_set === '***';
            return (
              <li
                key={s.id}
                data-testid={`supplier-row-${s.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {s.name}
                    </h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                        isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]'
                      }`}
                    >
                      {isActive
                        ? t('dropship.suppliers.badge.active')
                        : t('dropship.suppliers.badge.inactive')}
                    </span>
                    {hasKey ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]"
                        title={t('dropship.suppliers.badge.api_configured')}
                      >
                        <Icon as={Key} size="xs" />
                        API
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
                    {s.contact_email ? (
                      <span className="font-mono">{s.contact_email}</span>
                    ) : null}
                    {s.contact_email && s.default_shipping_cost_cents > 0 ? (
                      <span aria-hidden="true">•</span>
                    ) : null}
                    <span>
                      {t('dropship.suppliers.shipping_label')}{' '}
                      <span className="tabular-nums font-medium text-[var(--text-secondary)]">
                        {formatCents(s.default_shipping_cost_cents, locale)}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Upload} size="sm" />}
                    onClick={() => handleOpenImport(s)}
                    disabled={isBusy}
                    aria-label={`${t('dropship.suppliers.import_csv')} — ${s.name}`}
                  >
                    {t('dropship.suppliers.import_csv')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => handleOpenEdit(s)}
                    disabled={isBusy}
                    aria-label={`${t('action.edit')} — ${s.name}`}
                  >
                    {t('action.edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(s)}
                    disabled={isBusy}
                    aria-label={`${t('action.delete')} — ${s.name}`}
                  >
                    {t('action.delete')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal CRUD */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? t('action.edit') : t('dropship.suppliers.create')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('dropship.suppliers.form.name')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            autoFocus
            required
            aria-label={t('dropship.suppliers.form.name')}
          />
          <Input
            type="url"
            label={t('dropship.suppliers.form.api_endpoint')}
            value={form.api_endpoint}
            onChange={(e) =>
              setForm((f) => ({ ...f, api_endpoint: e.target.value }))
            }
            placeholder="https://api.fournisseur.com/v1"
            aria-label={t('dropship.suppliers.form.api_endpoint')}
          />
          <Input
            type="password"
            label={
              editing && form.api_key === ''
                ? t('dropship.suppliers.form.api_key_masked')
                : t('dropship.suppliers.form.api_key')
            }
            value={form.api_key}
            onChange={(e) =>
              setForm((f) => ({ ...f, api_key: e.target.value }))
            }
            placeholder={editing ? '••••••••' : 'sk_live_…'}
            autoComplete="new-password"
            aria-label={t('dropship.suppliers.form.api_key')}
          />
          <Textarea
            label={t('dropship.suppliers.form.csv_format_json')}
            value={form.csv_format_json}
            onChange={(e) =>
              setForm((f) => ({ ...f, csv_format_json: e.target.value }))
            }
            rows={5}
            placeholder={'{\n  "sku": "SKU",\n  "name": "Title",\n  "price": "Price"\n}'}
            error={jsonError ?? undefined}
            helper={t('dropship.suppliers.form.csv_format_json.helper')}
            className="font-mono text-xs"
            aria-label={t('dropship.suppliers.form.csv_format_json')}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="email"
              label={t('dropship.suppliers.form.contact_email')}
              value={form.contact_email}
              onChange={(e) =>
                setForm((f) => ({ ...f, contact_email: e.target.value }))
              }
              aria-label={t('dropship.suppliers.form.contact_email')}
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              label={t('dropship.suppliers.form.default_shipping_cost')}
              value={form.default_shipping_cost}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  default_shipping_cost: e.target.value,
                }))
              }
              aria-label={t('dropship.suppliers.form.default_shipping_cost')}
            />
          </div>
          <Switch
            checked={form.is_active}
            onCheckedChange={(next) =>
              setForm((f) => ({ ...f, is_active: next }))
            }
            label={t('dropship.suppliers.form.active')}
            aria-label={t('dropship.suppliers.form.active')}
          />
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
              disabled={submitting || !form.name.trim() || jsonError !== null}
              aria-label={t('action.save')}
            >
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Import CSV */}
      <Modal
        open={importOpen}
        onOpenChange={handleCloseImport}
        title={t('dropship.suppliers.import_csv')}
        description={importTarget?.name}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            {t('dropship.suppliers.import.intro')}
          </p>
          <label
            htmlFor="dropship-csv-file"
            className="block t-label-form"
          >
            {t('dropship.suppliers.import.file_label')}
          </label>
          <input
            ref={fileInputRef}
            id="dropship-csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            disabled={importing}
            aria-label={t('dropship.suppliers.import.file_label')}
            aria-busy={importing}
            className="block w-full text-sm text-[var(--text-secondary)] file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--gray-50)] file:text-[var(--text-primary)] file:text-sm hover:file:bg-[var(--gray-100)] file:cursor-pointer"
          />

          {importing ? (
            <div
              className="text-sm text-[var(--text-muted)]"
              role="status"
              aria-live="polite"
            >
              {t('dropship.suppliers.import.progress')}
            </div>
          ) : null}

          {importResult ? (
            <div
              data-testid="import-result"
              role="status"
              aria-live="polite"
              className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 space-y-1"
            >
              <div>
                {t('dropship.suppliers.import.imported')} :{' '}
                <span className="font-semibold tabular-nums">
                  {importResult.imported}
                </span>
              </div>
              <div>
                {t('dropship.suppliers.import.skipped')} :{' '}
                <span className="font-semibold tabular-nums">
                  {importResult.skipped}
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleCloseImport(false)}
              disabled={importing}
            >
              {t('action.cancel')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
