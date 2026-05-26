// ── TierPricesEditor — Sprint 48 (Agent B1) ─────────────────────────────────
// Gestion des tier_prices (variant × group × min_quantity) + outil Resolver
// qui interroge HANDLER /api/tier-prices/resolve pour (variant, customer, qty).
// Cap clients.manage (FIGÉE).
//
// Props :
//   variantId? : string → filtre la liste sur un variant donné (page produit).
//
// API back FIGÉE (seq143 §6) :
//   listTierPrices(variantId?)              → ApiResponse<TierPrice[]>
//   createTierPrice({...})                  → ApiResponse<TierPrice>
//   updateTierPrice(id, {...})              → ApiResponse<TierPrice>
//   deleteTierPrice(id)                     → ApiResponse<{ ok: true }>
//   listCustomerGroups()                    → ApiResponse<CustomerGroup[]>  (lookup name)
//   resolvePriceForCustomer(v, c, qty)      → ApiResponse<ResolvePriceResult>
//
// Style : Stripe-clean (calque SnapshotManager). Tableau plat, focus ring
// purple, aria-labels i18n. Aucun console.log (CLAUDE.md règle d'or #6).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Calculator,
  Layers,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t, getLocale } from '../../lib/i18n';
import { formatMoneyCents } from '../../lib/i18n/number';
import {
  listTierPrices,
  createTierPrice,
  updateTierPrice,
  deleteTierPrice,
  listCustomerGroups,
  resolvePriceForCustomer,
  type TierPrice,
  type TierPriceInput,
  type CustomerGroup,
  type ResolvePriceResult,
} from '../../lib/api';

// ── Props ──────────────────────────────────────────────────────────────────

export interface TierPricesEditorProps {
  /** Si fourni → list filtrée + variant_id pré-rempli + lecture seule du champ. */
  variantId?: string;
}

// ── État form modal ───────────────────────────────────────────────────────

type FormState = {
  variantId: string;
  groupId: string;
  priceCents: number;
  minQuantity: number;
};

const buildEmptyForm = (defaultVariantId?: string): FormState => ({
  variantId: defaultVariantId ?? '',
  groupId: '',
  priceCents: 0,
  minQuantity: 1,
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convertit string user → integer ≥ 0 (cents ou qty). NaN → 0. */
function parseNonNegInt(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Convertit string dollars (ex "12,34" ou "12.34") → cents. NaN → 0. */
function parseDollarsToCents(v: string): number {
  const normalized = v.replace(',', '.').trim();
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** Affiche cents en dollars éditables (12345 → "123.45"). */
function centsToDollarsString(cents: number): string {
  if (!Number.isFinite(cents)) return '0.00';
  return (cents / 100).toFixed(2);
}

// ── Composant ──────────────────────────────────────────────────────────────

export function TierPricesEditor({ variantId }: TierPricesEditorProps = {}) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [tierPrices, setTierPrices] = useState<TierPrice[]>([]);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modal CRUD
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(buildEmptyForm(variantId));
  const [priceInput, setPriceInput] = useState<string>('0.00');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Resolver tool
  const [resolverVariant, setResolverVariant] = useState<string>(
    variantId ?? '',
  );
  const [resolverCustomer, setResolverCustomer] = useState<string>('');
  const [resolverQty, setResolverQty] = useState<number>(1);
  const [resolverBusy, setResolverBusy] = useState<boolean>(false);
  const [resolverResult, setResolverResult] =
    useState<ResolvePriceResult | null>(null);
  const [resolverError, setResolverError] = useState<string | null>(null);

  const locale = useMemo(() => getLocale(), []);

  // ── Lookup map id → group name ─────────────────────────────────────────
  const groupNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) m.set(g.id, g.name);
    return m;
  }, [groups]);

  // ── Chargement (parallèle) ─────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [tiersRes, groupsRes] = await Promise.all([
      listTierPrices(variantId),
      listCustomerGroups(),
    ]);
    if (tiersRes.error) {
      toastError(tiersRes.error);
      setLoadError(tiersRes.error);
      setTierPrices([]);
    } else if (tiersRes.data) {
      setTierPrices(tiersRes.data);
    }
    if (groupsRes.error) {
      // groups load fail = silent (la liste continue, juste sans lookup name)
      setGroups([]);
    } else if (groupsRes.data) {
      setGroups(groupsRes.data);
    }
    setLoading(false);
  }, [variantId, toastError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── CRUD ───────────────────────────────────────────────────────────────

  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    const empty = buildEmptyForm(variantId);
    setForm(empty);
    setPriceInput('0.00');
    setModalOpen(true);
  }, [variantId]);

  const handleOpenEdit = useCallback((tp: TierPrice) => {
    setEditingId(tp.id);
    setForm({
      variantId: tp.product_variant_id,
      groupId: tp.group_id,
      priceCents: tp.price_cents,
      minQuantity: tp.min_quantity,
    });
    setPriceInput(centsToDollarsString(tp.price_cents));
    setModalOpen(true);
  }, []);

  const handlePriceInputChange = useCallback((v: string) => {
    setPriceInput(v);
    setForm((p) => ({ ...p, priceCents: parseDollarsToCents(v) }));
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const vId = form.variantId.trim();
      const gId = form.groupId.trim();
      if (!vId || !gId) return;
      const payload: TierPriceInput = {
        product_variant_id: vId,
        group_id: gId,
        price_cents: form.priceCents,
        min_quantity: form.minQuantity < 1 ? 1 : form.minQuantity,
      };
      setSubmitting(true);
      const res = editingId
        ? await updateTierPrice(editingId, payload)
        : await createTierPrice(payload);
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setModalOpen(false);
      setEditingId(null);
      void loadAll();
    },
    [form, editingId, success, toastError, loadAll],
  );

  const handleDelete = useCallback(
    async (tp: TierPrice) => {
      const ok = await confirm({
        title: t('action.delete'),
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(tp.id);
      const res = await deleteTierPrice(tp.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadAll();
    },
    [confirm, toastError, loadAll],
  );

  // ── Resolver tool ──────────────────────────────────────────────────────

  const handleResolve = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const v = resolverVariant.trim();
      const c = resolverCustomer.trim();
      const q = resolverQty < 1 ? 1 : resolverQty;
      if (!v || !c) return;
      setResolverBusy(true);
      setResolverResult(null);
      setResolverError(null);
      const res = await resolvePriceForCustomer(v, c, q);
      setResolverBusy(false);
      if (res.error) {
        setResolverError(res.error);
        return;
      }
      if (res.data) {
        setResolverResult(res.data);
      }
    },
    [resolverVariant, resolverCustomer, resolverQty],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="tier-prices-editor">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('tier_prices.title')}</h2>
          {variantId ? (
            <p className="t-caption text-[var(--gray-500)] mt-1 font-mono">
              {variantId}
            </p>
          ) : null}
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('tier_prices.create')}
        >
          {t('tier_prices.create')}
        </Button>
      </header>

      {/* Table */}
      {loading ? (
        <div
          className="space-y-2"
          data-testid="tier-prices-loading"
          role="status"
          aria-busy="true"
          aria-live="polite"
          aria-label={t('state.loading')}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)] flex items-start justify-between gap-3 flex-wrap"
          role="alert"
          data-testid="tier-prices-error"
        >
          <div className="min-w-0">
            <p className="font-medium mb-0.5">{t('common.error.title')}</p>
            <p className="text-xs opacity-80 break-words">{loadError}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadAll()}
            aria-label={t('common.retry')}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : tierPrices.length === 0 ? (
        <EmptyState
          icon={<Icon as={Layers} size={40} />}
          title={t('tier_prices.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('tier_prices.create')}
            </Button>
          }
        />
      ) : (
        <div
          className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-white"
          data-testid="tier-prices-table-wrap"
        >
          <table
            className="w-full text-sm"
            aria-label={t('tier_prices.title')}
          >
            <thead className="bg-[var(--gray-50)] text-[var(--text-secondary)]">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-medium">
                  {t('field.variant_id')}
                </th>
                <th className="px-4 py-2.5 font-medium">
                  {t('customer_groups.title')}
                </th>
                <th className="px-4 py-2.5 font-medium text-right">
                  {t('tier_prices.price')}
                </th>
                <th className="px-4 py-2.5 font-medium text-right">
                  {t('tier_prices.min_quantity')}
                </th>
                <th className="px-4 py-2.5 font-medium text-right">
                  <span className="sr-only">{t('field.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tierPrices.map((tp) => {
                const isBusy = busyId === tp.id;
                const groupName =
                  groupNameById.get(tp.group_id) ?? tp.group_id;
                return (
                  <tr
                    key={tp.id}
                    data-testid={`tier-price-row-${tp.id}`}
                    className="border-t border-[var(--border-subtle)]"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)] truncate max-w-[12rem]">
                      {tp.product_variant_id}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-primary)]">
                      {groupName}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)]">
                      {formatMoneyCents(tp.price_cents, locale)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">
                      {tp.min_quantity}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Icon as={Pencil} size="sm" />}
                          onClick={() => handleOpenEdit(tp)}
                          disabled={isBusy}
                          aria-label={`${t('action.edit')} — ${tp.id}`}
                        >
                          {t('action.edit')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          leftIcon={<Icon as={Trash2} size="sm" />}
                          onClick={() => void handleDelete(tp)}
                          disabled={isBusy}
                          aria-label={`${t('action.delete')} — ${tp.id}`}
                        >
                          {t('action.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Resolver tool */}
      <section
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--gray-50)] p-4 space-y-3"
        data-testid="tier-prices-resolver"
        aria-label={t('tier_prices.resolver_title')}
      >
        <div className="flex items-center gap-2">
          <Icon
            as={Calculator}
            size="sm"
            className="text-[var(--text-secondary)]"
          />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('tier_prices.resolver_title')}
          </h3>
        </div>
        <form
          onSubmit={handleResolve}
          className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label
              htmlFor="resolver-variant"
              className="text-xs font-medium text-[var(--text-secondary)] block mb-1"
            >
              {t('field.variant_id')}
            </label>
            <Input
              id="resolver-variant"
              value={resolverVariant}
              onChange={(e) => setResolverVariant(e.target.value)}
              aria-label={t('field.variant_id')}
              placeholder="var_..."
            />
          </div>
          <div>
            <label
              htmlFor="resolver-customer"
              className="text-xs font-medium text-[var(--text-secondary)] block mb-1"
            >
              {t('field.customer_id')}
            </label>
            <Input
              id="resolver-customer"
              value={resolverCustomer}
              onChange={(e) => setResolverCustomer(e.target.value)}
              aria-label={t('field.customer_id')}
              placeholder="cust_..."
            />
          </div>
          <div>
            <label
              htmlFor="resolver-qty"
              className="text-xs font-medium text-[var(--text-secondary)] block mb-1"
            >
              {t('field.quantity')}
            </label>
            <Input
              id="resolver-qty"
              type="number"
              min={1}
              step={1}
              value={String(resolverQty)}
              onChange={(e) =>
                setResolverQty(Math.max(1, parseNonNegInt(e.target.value)))
              }
              aria-label={t('field.quantity')}
            />
          </div>
          <div>
            <Button
              type="submit"
              size="sm"
              isLoading={resolverBusy}
              disabled={
                resolverBusy ||
                !resolverVariant.trim() ||
                !resolverCustomer.trim()
              }
              aria-label={t('tier_prices.resolver_submit')}
              className="w-full"
            >
              {t('tier_prices.resolver_submit')}
            </Button>
          </div>
        </form>

        {resolverError ? (
          <p
            className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2"
            role="alert"
            data-testid="resolver-error"
          >
            {resolverError}
          </p>
        ) : null}

        {resolverResult ? (
          <div
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white border border-[var(--border-subtle)] rounded-md p-3"
            data-testid="resolver-result"
          >
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-0.5">
                {t('tier_prices.price')}
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)]">
                {formatMoneyCents(resolverResult.price_cents, locale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-0.5">
                {t('tier_prices.group_applied')}
              </div>
              <div className="text-sm text-[var(--text-primary)]">
                {resolverResult.group_applied
                  ? (groupNameById.get(resolverResult.group_applied) ??
                    resolverResult.group_applied)
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-0.5">
                {t('customer_groups.discount_pct')}
              </div>
              <div className="text-sm text-[var(--text-primary)]">
                −{resolverResult.discount_pct}%
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* Modal CRUD */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingId ? t('action.edit') : t('tier_prices.create')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="tp-variant"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('field.variant_id')}
            </label>
            <Input
              id="tp-variant"
              value={form.variantId}
              onChange={(e) =>
                setForm((p) => ({ ...p, variantId: e.target.value }))
              }
              required
              disabled={Boolean(variantId)}
              aria-label={t('field.variant_id')}
              placeholder="var_..."
              autoFocus={!variantId}
            />
          </div>
          <div>
            <label
              htmlFor="tp-group"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('customer_groups.title')}
            </label>
            <Select
              id="tp-group"
              value={form.groupId}
              onChange={(e) =>
                setForm((p) => ({ ...p, groupId: e.target.value }))
              }
              required
              aria-label={t('customer_groups.title')}
            >
              <option value="">{t('action.select')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="tp-price"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('tier_prices.price')}
              </label>
              <Input
                id="tp-price"
                type="text"
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => handlePriceInputChange(e.target.value)}
                aria-label={t('tier_prices.price')}
                placeholder="0.00"
              />
            </div>
            <div>
              <label
                htmlFor="tp-min-qty"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('tier_prices.min_quantity')}
              </label>
              <Input
                id="tp-min-qty"
                type="number"
                min={1}
                step={1}
                value={String(form.minQuantity)}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    minQuantity: Math.max(1, parseNonNegInt(e.target.value)),
                  }))
                }
                aria-label={t('tier_prices.min_quantity')}
              />
            </div>
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
              disabled={
                submitting ||
                !form.variantId.trim() ||
                !form.groupId.trim()
              }
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
