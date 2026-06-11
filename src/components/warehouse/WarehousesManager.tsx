// ── WarehousesManager — Sprint 47 (Agent B1) ─────────────────────────────────
// Multi-warehouse CRUD UI : liste cards + modal create/edit + set default +
// toggle is_active + delete (soft).
//
// API back FIGÉE (Phase A) :
//   listWarehouses()                       → ApiResponse<Warehouse[]>
//   createWarehouse(body)                  → ApiResponse<Warehouse>
//   updateWarehouse(id, body)              → ApiResponse<Warehouse>
//   deleteWarehouse(id)                    → ApiResponse<{ ok: true }>
//   setDefaultWarehouse(id)                → ApiResponse<Warehouse>
//
// Style : Stripe-clean cards + flat border, focus ring purple, badges
// gris/vert. Toutes les chaînes via t(). Aucun console.log (CLAUDE.md).
// aria-labels i18n sur chaque action.

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  Warehouse as WarehouseIcon,
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
import { t } from '../../lib/i18n';
import {
  listWarehouses,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  setDefaultWarehouse,
  type Warehouse,
  type WarehouseInput,
} from '../../lib/api';

interface FormState {
  name: string;
  address: string;
  country: string;
  country_subdiv: string;
  contact_email: string;
  contact_phone: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  address: '',
  country: '',
  country_subdiv: '',
  contact_email: '',
  contact_phone: '',
  is_active: true,
};

function warehouseToForm(w: Warehouse): FormState {
  return {
    name: w.name ?? '',
    address: w.address ?? '',
    country: w.country ?? '',
    country_subdiv: w.country_subdiv ?? '',
    contact_email: w.contact_email ?? '',
    contact_phone: w.contact_phone ?? '',
    is_active: w.is_active === 1,
  };
}

function formToInput(f: FormState): WarehouseInput {
  return {
    name: f.name.trim(),
    address: f.address.trim() || null,
    country: f.country.trim() || null,
    country_subdiv: f.country_subdiv.trim() || null,
    contact_email: f.contact_email.trim() || null,
    contact_phone: f.contact_phone.trim() || null,
    is_active: f.is_active ? 1 : 0,
  };
}

export function WarehousesManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Chargement ───────────────────────────────────────────────────────────
  const loadWarehouses = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listWarehouses();
    if (res.error) {
      setLoadError(res.error);
      toastError(res.error);
      setWarehouses([]);
    } else if (res.data) {
      setWarehouses(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadWarehouses();
  }, [loadWarehouses]);

  // ── CRUD modal ──────────────────────────────────────────────────────────
  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((w: Warehouse) => {
    setEditingId(w.id);
    setForm(warehouseToForm(w));
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = form.name.trim();
      if (!name) return;
      setSubmitting(true);
      const body = formToInput(form);
      const res = editingId
        ? await updateWarehouse(editingId, body)
        : await createWarehouse(body);
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setModalOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      void loadWarehouses();
    },
    [editingId, form, success, toastError, loadWarehouses],
  );

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleToggleActive = useCallback(
    async (w: Warehouse, next: boolean) => {
      setBusyId(w.id);
      const res = await updateWarehouse(w.id, { is_active: next ? 1 : 0 });
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadWarehouses();
    },
    [toastError, loadWarehouses],
  );

  const handleSetDefault = useCallback(
    async (w: Warehouse) => {
      setBusyId(w.id);
      const res = await setDefaultWarehouse(w.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('warehouse.default'));
      void loadWarehouses();
    },
    [success, toastError, loadWarehouses],
  );

  const handleDelete = useCallback(
    async (w: Warehouse) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('warehouse.delete.confirm')} — ${w.name}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(w.id);
      const res = await deleteWarehouse(w.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadWarehouses();
    },
    [confirm, toastError, loadWarehouses],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6" data-testid="warehouses-manager">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('warehouse.title')}</h2>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('warehouse.create')}
        >
          {t('warehouse.create')}
        </Button>
      </header>

      {loading ? (
        <div
          className="space-y-3"
          data-testid="warehouses-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('warehouse.title')}
        >
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
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
          role="alert"
          data-testid="warehouses-error"
        >
          <p className="font-medium mb-1">{t('warehouse.errors.load_failed')}</p>
          <p className="text-xs opacity-80">{loadError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadWarehouses()}
            className="mt-2"
            aria-label={t('action.retry')}
          >
            {t('action.retry')}
          </Button>
        </div>
      ) : warehouses.length === 0 ? (
        <EmptyState
          icon={<Icon as={WarehouseIcon} size={40} />}
          title={t('warehouse.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('warehouse.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="warehouses-list"
          aria-label={t('warehouse.title')}
        >
          {warehouses.map((w) => {
            const isBusy = busyId === w.id;
            const isDefault = w.is_default === 1;
            const isActive = w.is_active === 1;
            return (
              <li
                key={w.id}
                data-testid={`warehouse-row-${w.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {w.name}
                    </h3>
                    {isDefault ? (
                      <span
                        data-testid={`warehouse-default-${w.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200"
                      >
                        <Icon as={Star} size="xs" />
                        {t('warehouse.default')}
                      </span>
                    ) : null}
                    {!isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]">
                        {t('warehouse.activate')}
                      </span>
                    ) : null}
                  </div>
                  {w.address ? (
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                      {w.address}
                    </p>
                  ) : null}
                  <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
                    {w.country ? (
                      <span>
                        {w.country}
                        {w.country_subdiv ? ` · ${w.country_subdiv}` : ''}
                      </span>
                    ) : null}
                    {w.contact_email ? (
                      <>
                        <span aria-hidden="true">•</span>
                        <span className="font-mono">{w.contact_email}</span>
                      </>
                    ) : null}
                    {w.contact_phone ? (
                      <>
                        <span aria-hidden="true">•</span>
                        <span className="font-mono">{w.contact_phone}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(next) => void handleToggleActive(w, next)}
                    disabled={isBusy}
                    size="sm"
                    aria-label={`${t('warehouse.activate')} — ${w.name}`}
                  />
                  {!isDefault ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Icon as={Star} size="sm" />}
                      onClick={() => void handleSetDefault(w)}
                      disabled={isBusy}
                      aria-label={`${t('warehouse.default')} — ${w.name}`}
                    >
                      {t('warehouse.default')}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => handleOpenEdit(w)}
                    disabled={isBusy}
                    aria-label={`${t('action.edit')} — ${w.name}`}
                  >
                    {t('action.edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(w)}
                    disabled={isBusy}
                    aria-label={`${t('action.delete')} — ${w.name}`}
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
        title={editingId ? t('action.edit') : t('warehouse.create')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('warehouse.title')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            autoFocus
            required
            aria-label={t('warehouse.title')}
          />
          <Textarea
            label={t('warehouse.form.address')}
            value={form.address}
            onChange={(e) =>
              setForm((f) => ({ ...f, address: e.target.value }))
            }
            rows={3}
            aria-label={t('warehouse.form.address')}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('warehouse.form.country')}
              value={form.country}
              onChange={(e) =>
                setForm((f) => ({ ...f, country: e.target.value }))
              }
              placeholder="CA"
              aria-label={t('warehouse.form.country')}
            />
            <Input
              label={t('warehouse.form.country_subdiv')}
              value={form.country_subdiv}
              onChange={(e) =>
                setForm((f) => ({ ...f, country_subdiv: e.target.value }))
              }
              placeholder="QC"
              aria-label={t('warehouse.form.country_subdiv')}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="email"
              label={t('warehouse.form.contact_email')}
              value={form.contact_email}
              onChange={(e) =>
                setForm((f) => ({ ...f, contact_email: e.target.value }))
              }
              aria-label={t('warehouse.form.contact_email')}
            />
            <Input
              type="tel"
              label={t('warehouse.form.contact_phone')}
              value={form.contact_phone}
              onChange={(e) =>
                setForm((f) => ({ ...f, contact_phone: e.target.value }))
              }
              aria-label={t('warehouse.form.contact_phone')}
            />
          </div>
          <Switch
            checked={form.is_active}
            onCheckedChange={(next) =>
              setForm((f) => ({ ...f, is_active: next }))
            }
            label={t('warehouse.activate')}
            aria-label={t('warehouse.activate')}
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
              disabled={submitting || !form.name.trim()}
              aria-label={t('action.save')}
            >
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
