// ── VariantInventoryOps — Sprint (Agent) ────────────────────────────────────
// Surface des opérations variantes + inventaire restées non câblées dans l'UI :
//   - Liste des variantes d'un produit (getEcommerceVariants).
//   - Création / édition / suppression de variante (create/update/deleteEcommerceVariant).
//   - Vue + ajustement du stock par variante (getVariantInventory / setVariantInventory).
// Pattern calqué sur GiftLoyaltyOps / le reste du dashboard :
//   imports relatifs, i18n via t('variants.*'), états loading(aria-busy)/empty/
//   error(role=alert), confirm sur actions destructives, a11y, zéro console.log.
// 100% additif — n'altère pas le CRUD produit existant.

import { useCallback, useEffect, useState } from 'react';
import {
  Layers, Plus, Pencil, Trash2, Boxes, Save, X, RefreshCw,
} from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Tag } from '../ui/Tag';
import { Switch } from '../ui/Switch';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import {
  getEcommerceVariants,
  createEcommerceVariant,
  updateEcommerceVariant,
  deleteEcommerceVariant,
  getVariantInventory,
  setVariantInventory,
} from '../../lib/api';
import type { ProductVariant, InventoryRecord } from '../../lib/types';
import { t, getLocale } from '../../lib/i18n';
import { formatMoneyCents, formatNumber } from '../../lib/i18n/number';

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseDollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

function parseNonNegInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 0) return null;
  return num;
}

// ── Form state pour create/edit ──────────────────────────────────────────────

interface VariantFormState {
  title: string;
  sku: string;
  price: string; // dollars (vide = hérite base_price)
}

const EMPTY_FORM: VariantFormState = { title: '', sku: '', price: '' };

// ── Props ──────────────────────────────────────────────────────────────────

interface VariantInventoryOpsProps {
  productId: string;
  /** Devise du produit (formatage prix). Défaut CAD. */
  currency?: string;
  /** base_price (cents) — affiché quand price_override est null. */
  basePrice?: number;
}

// ── Composant principal ──────────────────────────────────────────────────────

export function VariantInventoryOps({
  productId,
  currency = 'CAD',
  basePrice = 0,
}: VariantInventoryOpsProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();
  const locale = getLocale();

  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Édition inline d'une variante (id en cours) + création.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<VariantFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Panneau inventaire ouvert (variant id).
  const [invVariantId, setInvVariantId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getEcommerceVariants(productId);
    if (res.error) {
      setError(res.error);
      setVariants([]);
    } else {
      setVariants(res.data || []);
    }
    setLoading(false);
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const startEdit = (v: ProductVariant) => {
    setEditingId(v.id);
    setCreating(false);
    setForm({
      title: v.title || '',
      sku: v.sku || '',
      price: v.price_override != null ? (v.price_override / 100).toFixed(2) : '',
    });
  };

  const cancelForm = () => {
    setEditingId(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  };

  const submitForm = useCallback(async () => {
    const title = form.title.trim();
    if (!title) {
      toastError(t('variants.form.titleRequired'));
      return;
    }
    // Prix : vide = hérite (null), sinon parse en cents (>= 0).
    let priceOverride: number | null = null;
    if (form.price.trim() !== '') {
      const cents = parseDollarsToCents(form.price);
      if (cents === null) {
        toastError(t('variants.form.priceInvalid'));
        return;
      }
      priceOverride = cents;
    }
    const body: Partial<ProductVariant> = {
      title,
      sku: form.sku.trim() || null,
      price_override: priceOverride,
    };

    setSaving(true);
    if (editingId) {
      const res = await updateEcommerceVariant(productId, editingId, body);
      if (res.error) {
        toastError(res.error);
        setSaving(false);
        return;
      }
      toastSuccess(t('variants.form.updated'));
    } else {
      const res = await createEcommerceVariant(productId, body);
      if (res.error) {
        toastError(res.error);
        setSaving(false);
        return;
      }
      toastSuccess(t('variants.form.created'));
    }
    setSaving(false);
    cancelForm();
    void load();
  }, [form, editingId, productId, toastSuccess, toastError, load]);

  const handleDelete = useCallback(async (v: ProductVariant) => {
    const ok = await confirm({
      title: t('variants.delete.confirmTitle'),
      description: t('variants.delete.confirmBody', { title: v.title }),
      confirmLabel: t('variants.delete.confirm'),
      cancelLabel: t('variants.cancel'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteEcommerceVariant(productId, v.id);
    if (res && res.error) {
      toastError(res.error);
      return;
    }
    toastSuccess(t('variants.delete.success'));
    if (invVariantId === v.id) setInvVariantId(null);
    if (editingId === v.id) cancelForm();
    void load();
  }, [confirm, productId, invVariantId, editingId, toastSuccess, toastError, load]);

  const priceLabel = (v: ProductVariant) =>
    v.price_override != null
      ? formatMoneyCents(v.price_override, locale, currency)
      : `${formatMoneyCents(basePrice, locale, currency)} · ${t('variants.priceInherited')}`;

  return (
    <section className="space-y-4" data-testid="variant-inventory-ops">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--gray-100)] text-[var(--primary)] shrink-0">
            <Icon as={Layers} size="sm" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('variants.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('variants.description')}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Icon as={Plus} size="sm" />}
          onClick={startCreate}
          disabled={creating}
          data-testid="variants-add"
        >
          {t('variants.add')}
        </Button>
      </header>

      {/* Formulaire create (en haut, quand actif) */}
      {creating && (
        <VariantForm
          mode="create"
          form={form}
          setForm={setForm}
          saving={saving}
          onSubmit={submitForm}
          onCancel={cancelForm}
        />
      )}

      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]" data-testid="variants-loading">
            {t('variants.loading')}
          </p>
        ) : error ? (
          <div role="alert" className="flex items-center gap-3" data-testid="variants-error">
            <p className="text-sm text-[var(--danger)]">{error}</p>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Icon as={RefreshCw} size="sm" />}
              onClick={() => void load()}
              aria-label={t('variants.retry')}
            >
              {t('variants.retry')}
            </Button>
          </div>
        ) : variants.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]" data-testid="variants-empty">
            {t('variants.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="variants-list">
            {variants.map((v) => (
              <li
                key={v.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-white"
              >
                {editingId === v.id ? (
                  <div className="p-3">
                    <VariantForm
                      mode="edit"
                      form={form}
                      setForm={setForm}
                      saving={saving}
                      onSubmit={submitForm}
                      onCancel={cancelForm}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 flex-wrap">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-medium text-[13px] truncate" title={v.title}>
                        {v.title}
                      </span>
                      {v.sku && (
                        <span className="font-mono text-[11px] text-[var(--text-muted)] truncate">
                          {v.sku}
                        </span>
                      )}
                    </div>
                    <span className="t-mono-num text-[12px] text-[var(--text-secondary)]">
                      {priceLabel(v)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Icon as={Boxes} size="sm" />}
                      onClick={() =>
                        setInvVariantId((cur) => (cur === v.id ? null : v.id))
                      }
                      aria-expanded={invVariantId === v.id}
                      aria-label={t('variants.inventory.toggle')}
                      data-testid={`variants-inv-toggle-${v.id}`}
                    >
                      {t('variants.inventory.stock')}
                    </Button>
                    <button
                      type="button"
                      onClick={() => startEdit(v)}
                      className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--gray-100)] transition-colors"
                      aria-label={`${t('variants.edit')} — ${v.title}`}
                      title={t('variants.edit')}
                      data-testid={`variants-edit-${v.id}`}
                    >
                      <Icon as={Pencil} size="sm" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(v)}
                      className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                      aria-label={`${t('variants.delete.action')} — ${v.title}`}
                      title={t('variants.delete.action')}
                      data-testid={`variants-delete-${v.id}`}
                    >
                      <Icon as={Trash2} size="sm" />
                    </button>
                  </div>
                )}

                {invVariantId === v.id && editingId !== v.id && (
                  <div className="border-t border-[var(--border-subtle)] p-3 bg-[var(--gray-50)]">
                    <InventorySection
                      variantId={v.id}
                      currency={currency}
                      onChanged={load}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Sous-composant : formulaire create/edit variante ─────────────────────────

interface VariantFormProps {
  mode: 'create' | 'edit';
  form: VariantFormState;
  setForm: (f: VariantFormState) => void;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

function VariantForm({ mode, form, setForm, saving, onSubmit, onCancel }: VariantFormProps) {
  return (
    <form
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--gray-50)] p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      data-testid={`variants-form-${mode}`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          label={t('variants.form.titleLabel')}
          placeholder={t('variants.form.titlePlaceholder')}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          autoComplete="off"
          data-testid="variants-form-title"
        />
        <Input
          label={t('variants.form.skuLabel')}
          placeholder={t('variants.form.skuPlaceholder')}
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
          autoComplete="off"
          data-testid="variants-form-sku"
        />
        <Input
          label={t('variants.form.priceLabel')}
          placeholder="0.00"
          inputMode="decimal"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          helper={t('variants.form.priceHelper')}
          autoComplete="off"
          data-testid="variants-form-price"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          leftIcon={<Icon as={Save} size="sm" />}
          isLoading={saving}
          disabled={saving || form.title.trim().length === 0}
          data-testid="variants-form-save"
        >
          {mode === 'create' ? t('variants.form.create') : t('variants.form.save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          leftIcon={<Icon as={X} size="sm" />}
          onClick={onCancel}
          disabled={saving}
          data-testid="variants-form-cancel"
        >
          {t('variants.cancel')}
        </Button>
      </div>
    </form>
  );
}

// ── Sous-composant : vue + ajustement inventaire d'une variante ──────────────

interface InventorySectionProps {
  variantId: string;
  currency: string;
  onChanged: () => void;
}

function InventorySection({ variantId, currency: _currency, onChanged }: InventorySectionProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const locale = getLocale();

  const [record, setRecord] = useState<InventoryRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Champs éditables.
  const [quantity, setQuantity] = useState('');
  const [threshold, setThreshold] = useState('');
  const [track, setTrack] = useState(true);
  const [backorder, setBackorder] = useState(false);
  const [saving, setSaving] = useState(false);

  const hydrate = useCallback((r: InventoryRecord) => {
    setRecord(r);
    setQuantity(String(r.quantity ?? 0));
    setThreshold(String(r.low_stock_threshold ?? 0));
    setTrack(Boolean(r.track_inventory));
    setBackorder(Boolean(r.allow_backorder));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getVariantInventory(variantId);
    if (res.error) {
      setError(res.error);
      setRecord(null);
    } else if (res.data) {
      hydrate(res.data);
    }
    setLoading(false);
  }, [variantId, hydrate]);

  useEffect(() => { void load(); }, [load]);

  const onSave = useCallback(async () => {
    const qty = parseNonNegInt(quantity);
    const thr = parseNonNegInt(threshold);
    if (qty === null || thr === null) {
      setError(t('variants.inventory.invalid'));
      return;
    }
    setSaving(true);
    setError(null);
    const res = await setVariantInventory(variantId, {
      quantity: qty,
      low_stock_threshold: thr,
      track_inventory: track ? 1 : 0,
      allow_backorder: backorder ? 1 : 0,
    });
    if (res.error) {
      setError(res.error);
      toastError(res.error);
    } else if (res.data) {
      hydrate(res.data);
      toastSuccess(t('variants.inventory.saved'));
      onChanged();
    }
    setSaving(false);
  }, [quantity, threshold, track, backorder, variantId, hydrate, toastSuccess, toastError, onChanged]);

  const available =
    record != null ? (record.quantity ?? 0) - (record.reserved ?? 0) : null;
  const low =
    record != null && (record.quantity ?? 0) <= (record.low_stock_threshold ?? 0);

  return (
    <div aria-live="polite" aria-busy={loading} data-testid={`variants-inventory-${variantId}`}>
      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">{t('variants.inventory.loading')}</p>
      ) : error && !record ? (
        <div role="alert" className="flex items-center gap-3">
          <p className="text-sm text-[var(--danger)]">{error}</p>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Icon as={RefreshCw} size="sm" />}
            onClick={() => void load()}
            aria-label={t('variants.retry')}
          >
            {t('variants.retry')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Résumé courant */}
          {record && (
            <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-[12px]">
              <div>
                <dt className="text-[var(--text-muted)]">{t('variants.inventory.onHand')}</dt>
                <dd className="font-semibold t-mono-num">
                  {formatNumber(record.quantity ?? 0, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">{t('variants.inventory.reserved')}</dt>
                <dd className="t-mono-num">{formatNumber(record.reserved ?? 0, locale)}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">{t('variants.inventory.available')}</dt>
                <dd className="t-mono-num">
                  {formatNumber(available ?? 0, locale)}
                  {low && (
                    <Tag size="sm" variant="warning" className="ml-2">
                      {t('variants.inventory.lowStock')}
                    </Tag>
                  )}
                </dd>
              </div>
            </dl>
          )}

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label={t('variants.inventory.quantityLabel')}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                autoComplete="off"
                data-testid={`variants-inv-qty-${variantId}`}
              />
              <Input
                label={t('variants.inventory.thresholdLabel')}
                inputMode="numeric"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                helper={t('variants.inventory.thresholdHelper')}
                autoComplete="off"
                data-testid={`variants-inv-threshold-${variantId}`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <Switch checked={track} onCheckedChange={setTrack} />
                {t('variants.inventory.trackLabel')}
              </label>
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <Switch checked={backorder} onCheckedChange={setBackorder} />
                {t('variants.inventory.backorderLabel')}
              </label>
            </div>

            <div aria-live="assertive">
              {error && record ? (
                <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>
              ) : null}
            </div>

            <Button
              type="submit"
              size="sm"
              leftIcon={<Icon as={Save} size="sm" />}
              isLoading={saving}
              disabled={saving}
              data-testid={`variants-inv-save-${variantId}`}
            >
              {t('variants.inventory.save')}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
