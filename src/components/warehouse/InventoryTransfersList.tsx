// ── InventoryTransfersList — Sprint 47 (Agent B1) ────────────────────────────
// Liste tableau des transferts inter-warehouse + modal création + action
// "Compléter" sur transferts pending.
//
// API back FIGÉE (Phase A) :
//   listInventoryTransfers()                 → ApiResponse<InventoryTransfer[]>
//   createInventoryTransfer(body)            → ApiResponse<InventoryTransfer>
//   completeInventoryTransfer(id)            → ApiResponse<InventoryTransfer>
//   listWarehouses()                         → ApiResponse<Warehouse[]> (selects)
//
// Style : Stripe-clean tableau, status badges sémantiques (gris/bleu/vert/rouge).
// Toutes chaînes via t(). aria-labels i18n.
// TODO Phase B : DELETE option si stock pas dispo (annulation).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { Plus, CheckCircle2, ArrowRight, Truck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t, getLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import {
  listInventoryTransfers,
  createInventoryTransfer,
  completeInventoryTransfer,
  listWarehouses,
  type InventoryTransfer,
  type InventoryTransferStatus,
  type InventoryTransferInput,
  type Warehouse,
} from '../../lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CLASS: Record<InventoryTransferStatus, string> = {
  pending:
    'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]',
  in_transit: 'bg-sky-50 text-sky-700 border-sky-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

function statusLabel(s: InventoryTransferStatus): string {
  // Sprint S52 reinforcement — common.status.* keys ajoutées aux 4 catalogues.
  return t(`common.status.${s}`);
}

interface FormState {
  from_warehouse_id: string;
  to_warehouse_id: string;
  variant_id: string;
  quantity: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  from_warehouse_id: '',
  to_warehouse_id: '',
  variant_id: '',
  quantity: '1',
  notes: '',
};

export function InventoryTransfersList() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const locale = useMemo(() => getLocale(), []);

  const warehouseById = useMemo(() => {
    const m = new Map<string, Warehouse>();
    for (const w of warehouses) m.set(w.id, w);
    return m;
  }, [warehouses]);

  // ── Chargement ──────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [tRes, wRes] = await Promise.all([
      listInventoryTransfers(),
      listWarehouses(),
    ]);
    if (tRes.error) {
      setLoadError(tRes.error);
      toastError(tRes.error);
      setTransfers([]);
    } else if (tRes.data) {
      setTransfers(tRes.data);
    }
    if (!wRes.error && wRes.data) {
      setWarehouses(wRes.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── Création ────────────────────────────────────────────────────────────
  const handleOpenCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const qty = Number(form.quantity);
      if (!form.from_warehouse_id || !form.to_warehouse_id) return;
      if (form.from_warehouse_id === form.to_warehouse_id) {
        toastError(t('transfers.warehouse_same_error'));
        return;
      }
      if (!form.variant_id.trim()) return;
      if (!Number.isFinite(qty) || qty <= 0) return;

      const body: InventoryTransferInput = {
        from_warehouse_id: form.from_warehouse_id,
        to_warehouse_id: form.to_warehouse_id,
        variant_id: form.variant_id.trim(),
        quantity: qty,
        notes: form.notes.trim() || null,
      };
      setSubmitting(true);
      const res = await createInventoryTransfer(body);
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('transfers.create'));
      setModalOpen(false);
      setForm(EMPTY_FORM);
      void loadAll();
    },
    [form, success, toastError, loadAll],
  );

  // ── Complete ────────────────────────────────────────────────────────────
  const handleComplete = useCallback(
    async (transfer: InventoryTransfer) => {
      const ok = await confirm({
        title: t('transfers.complete'),
        description: t('transfers.complete.confirm'),
        confirmLabel: t('transfers.complete'),
        cancelLabel: t('action.cancel'),
      });
      if (!ok) return;
      setBusyId(transfer.id);
      const res = await completeInventoryTransfer(transfer.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('transfers.complete'));
      void loadAll();
    },
    [confirm, success, toastError, loadAll],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6" data-testid="inventory-transfers-list">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('transfers.title')}</h2>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('transfers.create')}
          disabled={warehouses.length < 2}
        >
          {t('transfers.create')}
        </Button>
      </header>

      {loading ? (
        <div
          className="space-y-2"
          data-testid="transfers-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('transfers.title')}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
          role="alert"
          data-testid="transfers-error"
        >
          <p className="font-medium mb-1">{t('common.loading_error')}</p>
          <p className="text-xs opacity-80">{loadError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadAll()}
            className="mt-2"
            aria-label={t('action.retry')}
          >
            {t('action.retry')}
          </Button>
        </div>
      ) : transfers.length === 0 ? (
        <EmptyState
          icon={<Icon as={Truck} size={40} />}
          title={t('transfers.empty')}
          action={
            warehouses.length >= 2 ? (
              <Button
                onClick={handleOpenCreate}
                leftIcon={<Icon as={Plus} size="sm" />}
              >
                {t('transfers.create')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
          data-testid="transfers-table-wrap"
        >
          <table className="w-full text-sm" aria-label={t('transfers.title')}>
            <thead className="bg-[var(--gray-50)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="text-left font-medium px-4 py-2.5">
                  {t('transfers.from')} → {t('transfers.to')}
                </th>
                <th scope="col" className="text-left font-medium px-4 py-2.5">
                  {t('common.variant')}
                </th>
                <th scope="col" className="text-right font-medium px-4 py-2.5">
                  {t('common.quantity')}
                </th>
                <th scope="col" className="text-left font-medium px-4 py-2.5">
                  {t('common.status')}
                </th>
                <th scope="col" className="text-left font-medium px-4 py-2.5">
                  {t('common.date')}
                </th>
                <th scope="col" className="text-right font-medium px-4 py-2.5">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((tr) => {
                const isBusy = busyId === tr.id;
                const fromW = warehouseById.get(tr.from_warehouse_id);
                const toW = warehouseById.get(tr.to_warehouse_id);
                const isPending = tr.status === 'pending';
                return (
                  <tr
                    key={tr.id}
                    data-testid={`transfer-row-${tr.id}`}
                    className="border-t border-[var(--border-subtle)]"
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2 flex-wrap text-[var(--text-primary)]">
                        <span className="font-medium truncate max-w-[160px]">
                          {fromW?.name ?? tr.from_warehouse_id}
                        </span>
                        <Icon
                          as={ArrowRight}
                          size="sm"
                          className="text-[var(--text-muted)]"
                        />
                        <span className="font-medium truncate max-w-[160px]">
                          {toW?.name ?? tr.to_warehouse_id}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="font-mono text-xs text-[var(--text-secondary)]">
                        {tr.variant_id}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-right tabular-nums">
                      {tr.quantity}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        data-testid={`transfer-status-${tr.id}`}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASS[tr.status]}`}
                      >
                        {statusLabel(tr.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-[var(--text-muted)] whitespace-nowrap">
                      {formatRelativeTime(tr.created_at, locale)}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      {isPending ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<Icon as={CheckCircle2} size="sm" />}
                          onClick={() => void handleComplete(tr)}
                          disabled={isBusy}
                          aria-label={t('transfers.complete')}
                        >
                          {t('transfers.complete')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal create */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={t('transfers.create')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label={t('transfers.from')}
              value={form.from_warehouse_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, from_warehouse_id: e.target.value }))
              }
              required
              aria-label={t('transfers.from')}
            >
              <option value="">—</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <Select
              label={t('transfers.to')}
              value={form.to_warehouse_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, to_warehouse_id: e.target.value }))
              }
              required
              aria-label={t('transfers.to')}
            >
              <option value="">—</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <Input
            label={t('transfers.variant.label')}
            value={form.variant_id}
            onChange={(e) =>
              setForm((f) => ({ ...f, variant_id: e.target.value }))
            }
            list="variant-suggestions"
            autoComplete="off"
            required
            aria-label={t('common.variant')}
          />
          <Input
            type="number"
            min={1}
            step={1}
            label={t('common.quantity')}
            value={form.quantity}
            onChange={(e) =>
              setForm((f) => ({ ...f, quantity: e.target.value }))
            }
            required
            aria-label={t('common.quantity')}
          />
          <Textarea
            label={t('common.notes')}
            value={form.notes}
            onChange={(e) =>
              setForm((f) => ({ ...f, notes: e.target.value }))
            }
            rows={3}
            maxLength={500}
            showCounter
            aria-label={t('common.notes')}
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
              disabled={
                submitting ||
                !form.from_warehouse_id ||
                !form.to_warehouse_id ||
                !form.variant_id.trim() ||
                Number(form.quantity) <= 0
              }
              aria-label={t('action.create')}
            >
              {t('action.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
