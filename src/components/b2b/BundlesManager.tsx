// ── BundlesManager — Sprint 48 (Agent B2) ────────────────────────────────────
// Product Bundles CRUD + items inline. Liste cards bundle + modal CRUD bundle
// + modal items per bundle (add/remove BundleItem variant_id + quantity).
//
// API back FIGÉE (api.ts §Sprint 48 — Product Bundles) :
//   listProductBundles()                          → ApiResponse<ProductBundle[]>
//   createBundle(body)                            → ApiResponse<ProductBundle>
//   updateBundle(id, body)                        → ApiResponse<ProductBundle>
//   deleteBundle(id)                              → ApiResponse<{ ok: true }>
//   getBundleItems(id)                            → ApiResponse<BundleItem[]>
//   addBundleItem(id, body)                       → ApiResponse<BundleItem>
//   removeBundleItem(itemId)                      → ApiResponse<{ ok: true }>
//
// Style : Stripe-clean cards + flat border, focus ring purple, badges
// gris/vert. Toutes les chaînes via t(). Aucun console.log (CLAUDE.md).
// aria-labels i18n sur chaque action. Imports RELATIFS.

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
  Package,
  Layers,
  X,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  listProductBundles,
  createBundle,
  updateBundle,
  deleteBundle,
  getBundleItems,
  addBundleItem,
  removeBundleItem,
  type ProductBundle,
  type ProductBundleInput,
  type BundleItem,
} from '../../lib/api';

// ── Form state bundle CRUD ───────────────────────────────────────────────────

interface BundleFormState {
  name: string;
  description: string;
  total_price_cents: string;
  discount_pct: string;
}

const EMPTY_BUNDLE_FORM: BundleFormState = {
  name: '',
  description: '',
  total_price_cents: '',
  discount_pct: '0',
};

function bundleToForm(b: ProductBundle): BundleFormState {
  return {
    name: b.name ?? '',
    description: b.description ?? '',
    total_price_cents:
      b.total_price_cents !== null && b.total_price_cents !== undefined
        ? String(b.total_price_cents)
        : '',
    discount_pct: String(b.discount_pct ?? 0),
  };
}

function bundleFormToInput(f: BundleFormState): ProductBundleInput {
  const totalRaw = f.total_price_cents.trim();
  const discRaw = f.discount_pct.trim();
  const totalNum = totalRaw === '' ? null : Number.parseInt(totalRaw, 10);
  const discNum = discRaw === '' ? 0 : Number.parseFloat(discRaw);
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    total_price_cents:
      totalNum === null || Number.isNaN(totalNum) ? null : totalNum,
    discount_pct: Number.isNaN(discNum) ? 0 : discNum,
  };
}

// ── Form state add bundle item ───────────────────────────────────────────────

interface ItemFormState {
  product_variant_id: string;
  quantity: string;
}

const EMPTY_ITEM_FORM: ItemFormState = {
  product_variant_id: '',
  quantity: '1',
};

// ── Helpers format ───────────────────────────────────────────────────────────

function fmtCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  try {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} $`;
  }
}

// ── Composant ────────────────────────────────────────────────────────────────

export function BundlesManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [bundles, setBundles] = useState<ProductBundle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modal CRUD bundle
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BundleFormState>(EMPTY_BUNDLE_FORM);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Modal items per bundle
  const [itemsModalOpen, setItemsModalOpen] = useState<boolean>(false);
  const [itemsBundle, setItemsBundle] = useState<ProductBundle | null>(null);
  const [items, setItems] = useState<BundleItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState<boolean>(false);
  const [itemForm, setItemForm] = useState<ItemFormState>(EMPTY_ITEM_FORM);
  const [itemSubmitting, setItemSubmitting] = useState<boolean>(false);
  const [itemBusyId, setItemBusyId] = useState<string | null>(null);

  // Cache items count per bundle (affichage liste cards)
  const [itemsCountById, setItemsCountById] = useState<Record<string, number>>({});

  // ── Chargement bundles ──────────────────────────────────────────────────
  const loadBundles = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listProductBundles();
    if (res.error) {
      toastError(res.error);
      setLoadError(res.error || t('bundles.errors.load_failed'));
      setBundles([]);
    } else if (res.data) {
      setBundles(res.data);
      // Refresh items count en parallèle (best-effort, silencieux si erreur)
      void Promise.all(
        res.data.map(async (b) => {
          const r = await getBundleItems(b.id);
          return [b.id, r.data?.length ?? 0] as const;
        }),
      ).then((pairs) => {
        const next: Record<string, number> = {};
        for (const [id, count] of pairs) next[id] = count;
        setItemsCountById(next);
      });
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadBundles();
  }, [loadBundles]);

  // ── CRUD modal bundle ───────────────────────────────────────────────────
  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_BUNDLE_FORM);
    setModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((b: ProductBundle) => {
    setEditingId(b.id);
    setForm(bundleToForm(b));
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = form.name.trim();
      if (!name) return;
      setSubmitting(true);
      const body = bundleFormToInput(form);
      const res = editingId
        ? await updateBundle(editingId, body)
        : await createBundle(body);
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setModalOpen(false);
      setEditingId(null);
      setForm(EMPTY_BUNDLE_FORM);
      void loadBundles();
    },
    [editingId, form, success, toastError, loadBundles],
  );

  const handleDelete = useCallback(
    async (b: ProductBundle) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('bundles.delete.confirm')}\n\n${b.name}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(b.id);
      const res = await deleteBundle(b.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.delete'));
      void loadBundles();
    },
    [confirm, toastError, success, loadBundles],
  );

  // ── Modal items ─────────────────────────────────────────────────────────
  const loadItems = useCallback(
    async (bundleId: string) => {
      setItemsLoading(true);
      const res = await getBundleItems(bundleId);
      if (res.error) {
        toastError(res.error);
        setItems([]);
      } else if (res.data) {
        setItems(res.data);
        setItemsCountById((prev) => ({ ...prev, [bundleId]: res.data!.length }));
      }
      setItemsLoading(false);
    },
    [toastError],
  );

  const handleOpenItems = useCallback(
    (b: ProductBundle) => {
      setItemsBundle(b);
      setItemForm(EMPTY_ITEM_FORM);
      setItems([]);
      setItemsModalOpen(true);
      void loadItems(b.id);
    },
    [loadItems],
  );

  const handleAddItem = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!itemsBundle) return;
      const variantId = itemForm.product_variant_id.trim();
      if (!variantId) return;
      const qtyRaw = itemForm.quantity.trim();
      const qtyNum = qtyRaw === '' ? 1 : Number.parseInt(qtyRaw, 10);
      const qty = Number.isNaN(qtyNum) || qtyNum < 1 ? 1 : qtyNum;
      setItemSubmitting(true);
      const res = await addBundleItem(itemsBundle.id, {
        product_variant_id: variantId,
        quantity: qty,
      });
      setItemSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.add'));
      setItemForm(EMPTY_ITEM_FORM);
      void loadItems(itemsBundle.id);
    },
    [itemsBundle, itemForm, success, toastError, loadItems],
  );

  const handleRemoveItem = useCallback(
    async (item: BundleItem) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('bundles.item.delete.confirm')}\n\n${item.product_variant_id}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setItemBusyId(item.id);
      const res = await removeBundleItem(item.id);
      setItemBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.delete'));
      if (itemsBundle) void loadItems(itemsBundle.id);
    },
    [confirm, itemsBundle, success, toastError, loadItems],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6" data-testid="bundles-manager">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('bundles.title')}</h2>
          <p
            className="text-sm mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('bundles.help_subtitle')}
          </p>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('bundles.create')}
          data-testid="bundles-create-btn"
        >
          {t('bundles.create')}
        </Button>
      </header>

      {/* Error state (inline + retry) */}
      {!loading && loadError ? (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="bundles-error"
          className="p-4 rounded-xl border border-rose-200 bg-rose-50 flex items-start justify-between gap-3 flex-wrap"
        >
          <p className="text-sm text-rose-800 min-w-0">
            {t('bundles.errors.load_failed')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadBundles()}
            aria-label={t('common.retry')}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div
          className="space-y-3"
          data-testid="bundles-loading"
          aria-busy="true"
          aria-live="polite"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white"
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
      ) : bundles.length === 0 ? (
        <EmptyState
          icon={<Icon as={Package} size={40} />}
          title={t('bundles.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('bundles.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="bundles-list"
          aria-label={t('bundles.title')}
        >
          {bundles.map((b) => {
            const isBusy = busyId === b.id;
            const isActive = b.is_active === 1;
            const count = itemsCountById[b.id] ?? 0;
            return (
              <li
                key={b.id}
                data-testid={`bundle-row-${b.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {b.name}
                    </h3>
                    {b.discount_pct > 0 ? (
                      <span
                        data-testid={`bundle-discount-${b.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200"
                      >
                        −{b.discount_pct}%
                      </span>
                    ) : null}
                    {!isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]">
                        {t('common.inactive')}
                      </span>
                    ) : null}
                  </div>
                  {b.description ? (
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                      {b.description}
                    </p>
                  ) : null}
                  <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {fmtCents(b.total_price_cents)}
                      </span>{' '}
                      · {t('bundles.total_price')}
                    </span>
                    <span aria-hidden="true">•</span>
                    <span data-testid={`bundle-items-count-${b.id}`}>
                      {count} {t('bundles.items').toLowerCase()}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Layers} size="sm" />}
                    onClick={() => handleOpenItems(b)}
                    disabled={isBusy}
                    aria-label={`${t('bundles.items')} — ${b.name}`}
                    data-testid={`bundle-items-btn-${b.id}`}
                  >
                    {t('bundles.items')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => handleOpenEdit(b)}
                    disabled={isBusy}
                    aria-label={`${t('action.edit')} — ${b.name}`}
                    data-testid={`bundle-edit-btn-${b.id}`}
                  >
                    {t('action.edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(b)}
                    disabled={isBusy}
                    aria-label={`${t('action.delete')} — ${b.name}`}
                    data-testid={`bundle-delete-btn-${b.id}`}
                  >
                    {t('action.delete')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Modal CRUD bundle ──────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingId ? t('action.edit') : t('bundles.create')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('bundles.title')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            autoFocus
            required
            aria-label={t('bundles.title')}
            data-testid="bundle-form-name"
          />
          <Textarea
            label={t('common.description')}
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            rows={3}
            aria-label={t('common.description')}
            data-testid="bundle-form-description"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="number"
              min={0}
              step={1}
              label={`${t('bundles.total_price')} (cents)`}
              value={form.total_price_cents}
              onChange={(e) =>
                setForm((f) => ({ ...f, total_price_cents: e.target.value }))
              }
              placeholder="0"
              aria-label={t('bundles.total_price')}
              data-testid="bundle-form-total-price"
            />
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              label={`${t('bundles.discount')} (%)`}
              value={form.discount_pct}
              onChange={(e) =>
                setForm((f) => ({ ...f, discount_pct: e.target.value }))
              }
              placeholder="0"
              aria-label={t('bundles.discount')}
              data-testid="bundle-form-discount"
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
              disabled={submitting || !form.name.trim()}
              aria-label={t('action.save')}
              data-testid="bundle-form-submit"
            >
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Modal items per bundle ─────────────────────────────────────── */}
      <Modal
        open={itemsModalOpen}
        onOpenChange={setItemsModalOpen}
        title={
          itemsBundle
            ? `${t('bundles.items')} — ${itemsBundle.name}`
            : t('bundles.items')
        }
        size="md"
      >
        <div className="space-y-4">
          {/* Add item form */}
          <form
            onSubmit={handleAddItem}
            className="flex items-end gap-2 flex-wrap p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]"
            data-testid="bundle-item-add-form"
          >
            <div className="flex-1 min-w-[180px]">
              <Input
                label={t('bundles.variant_id')}
                value={itemForm.product_variant_id}
                onChange={(e) =>
                  setItemForm((f) => ({
                    ...f,
                    product_variant_id: e.target.value,
                  }))
                }
                placeholder="var_xxxxxxxxxxxx"
                required
                aria-label={t('bundles.variant_id')}
                data-testid="bundle-item-form-variant"
              />
            </div>
            <div className="w-24">
              <Input
                type="number"
                min={1}
                step={1}
                label={t('bundles.quantity_short')}
                value={itemForm.quantity}
                onChange={(e) =>
                  setItemForm((f) => ({ ...f, quantity: e.target.value }))
                }
                aria-label={t('common.quantity')}
                data-testid="bundle-item-form-quantity"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              isLoading={itemSubmitting}
              disabled={
                itemSubmitting || !itemForm.product_variant_id.trim()
              }
              leftIcon={<Icon as={Plus} size="sm" />}
              aria-label={t('bundles.add_item')}
              data-testid="bundle-item-add-submit"
            >
              {t('bundles.add_item')}
            </Button>
          </form>

          {/* Items list */}
          {itemsLoading ? (
            <div
              className="space-y-2"
              data-testid="bundle-items-loading"
              aria-busy="true"
              aria-live="polite"
            >
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p
              className="text-sm text-center py-6"
              style={{ color: 'var(--text-muted)' }}
              data-testid="bundle-items-empty"
              role="status"
            >
              {t('bundles.no_items')}
            </p>
          ) : (
            <ul
              className="space-y-1.5 list-none p-0 m-0"
              data-testid="bundle-items-list"
            >
              {items.map((item) => {
                const isBusy = itemBusyId === item.id;
                return (
                  <li
                    key={item.id}
                    data-testid={`bundle-item-row-${item.id}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-white"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-3 flex-wrap">
                      <span
                        className="font-mono text-xs"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {item.product_variant_id}
                      </span>
                      <span
                        className="text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        × {item.quantity}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRemoveItem(item)}
                      disabled={isBusy}
                      aria-label={`${t('action.delete')} — ${item.product_variant_id}`}
                      data-testid={`bundle-item-remove-${item.id}`}
                    >
                      <Icon as={X} size="sm" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setItemsModalOpen(false)}
            >
              {t('action.cancel')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default BundlesManager;
