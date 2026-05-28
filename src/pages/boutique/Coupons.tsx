// ── Boutique — Coupons / Promos — Sprint 4 LOT E-COMMERCE B2 enrichi ────────
// ⚠ NE PAS confondre avec un coupon CRM : namespace boutique/ distinct.
//
// ⚠ PHASE B = corps réel (Manager-B, SEUL propriétaire). Table premium +
//   EmptyState + SlidePanel création/édition, wirée getEcommerceCoupons /
//   createEcommerceCoupon / updateEcommerceCoupon / deleteEcommerceCoupon
//   (helpers + types FIGÉS Phase A, docs/LOT-ECOM4.md §6.A). i18n 100%
//   `ecommerce.coupons.*` (clés FIGÉES Phase A — aucune clé créée).
//   Discrimination d'erreur = absence de `data` (apiFetch GELÉ, jamais
//   `result.code`). <ModuleGuard module="ecommerce"> appliqué côté route.

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHero, Card, EmptyState, Skeleton, SlidePanel, Button, Tag, Input,
  Select, useToast, useConfirm,
} from '@/components/ui';
import {
  getEcommerceCoupons, createEcommerceCoupon, updateEcommerceCoupon,
  deleteEcommerceCoupon,
} from '@/lib/api';
import type { Coupon, CouponInput } from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import { Ticket, Plus, Trash2, Pencil, RefreshCw } from 'lucide-react';
import { CouponValidateTester } from '@/components/boutique/CouponValidateTester';

type FormState = {
  code: string;
  discount_type: string;
  discount_percent: string;
  discount_amount: string;
  min_order_cents: string;
  starts_at: string;
  expires_at: string;
  usage_limit: string;
  currency: string;
  is_active: number;
};

const EMPTY_FORM: FormState = {
  code: '',
  discount_type: 'percent',
  discount_percent: '',
  discount_amount: '',
  min_order_cents: '',
  starts_at: '',
  expires_at: '',
  usage_limit: '',
  currency: '',
  is_active: 1,
};

function couponToForm(c: Coupon): FormState {
  const type = (c.discount_type || (c.discount_percent != null ? 'percent' : 'fixed')) as string;
  return {
    code: c.code || '',
    discount_type: type === 'fixed' ? 'fixed' : 'percent',
    discount_percent: c.discount_percent != null ? String(c.discount_percent) : '',
    discount_amount: c.discount_amount != null ? String(c.discount_amount) : '',
    min_order_cents: c.min_order_cents != null ? String(c.min_order_cents) : '',
    starts_at: c.starts_at || '',
    expires_at: c.expires_at || '',
    usage_limit: c.usage_limit != null ? String(c.usage_limit) : '',
    currency: c.currency || '',
    is_active: c.is_active === 0 ? 0 : 1,
  };
}

function formToInput(f: FormState): CouponInput {
  return {
    code: f.code.trim(),
    discount_type: f.discount_type,
    discount_percent: f.discount_type === 'percent' && f.discount_percent
      ? Number(f.discount_percent) : null,
    discount_amount: f.discount_type === 'fixed' && f.discount_amount
      ? Number(f.discount_amount) : null,
    min_order_cents: f.min_order_cents ? Number(f.min_order_cents) : 0,
    starts_at: f.starts_at || null,
    expires_at: f.expires_at || null,
    usage_limit: f.usage_limit ? Number(f.usage_limit) : null,
    is_active: f.is_active,
    currency: f.currency || null,
  };
}

function discountLabel(c: Coupon): string {
  const type = c.discount_type || (c.discount_percent != null ? 'percent' : 'fixed');
  if (type === 'fixed') {
    const amt = c.discount_amount ?? 0;
    return formatMoneyCents(amt, getLocale(), c.currency || 'CAD');
  }
  const pct = c.discount_percent ?? c.discount_amount ?? 0;
  return `${pct} %`;
}

export function CouponsPage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await getEcommerceCoupons();
      if (res.data) setCoupons(res.data);
      else { setCoupons([]); setLoadError(true); }
    } catch {
      setCoupons([]);
      setLoadError(true);
    }
    setIsLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setPanelOpen(true);
  };

  const openEdit = (c: Coupon) => {
    setEditId(c.id);
    setForm(couponToForm(c));
    setFormError(null);
    setPanelOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) {
      setFormError(t('ecommerce.coupons.error_save'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = formToInput(form);
      const res = editId
        ? await updateEcommerceCoupon(editId, payload)
        : await createEcommerceCoupon(payload);
      // Discrimination d'erreur = absence de `data` (apiFetch GELÉ, §6.A).
      if (!res.data) {
        setFormError(t('ecommerce.coupons.error_save'));
        setSaving(false);
        return;
      }
      success(t('ecommerce.coupons.save'));
      setPanelOpen(false);
      await load();
    } catch {
      setFormError(t('ecommerce.coupons.error_save'));
    }
    setSaving(false);
  };

  const handleDelete = async (c: Coupon) => {
    const ok = await confirm({
      title: t('ecommerce.coupons.delete'),
      description: c.code,
      confirmLabel: t('ecommerce.coupons.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await deleteEcommerceCoupon(c.id);
      // Discrimination d'erreur : absence de `data` OU champ `error` rempli.
      if (res && (res.error || res.data === undefined)) {
        toastError(res.error || t('ecommerce.coupons.error_save'));
        return;
      }
      setCoupons((prev) => prev.filter((x) => x.id !== c.id));
      success(t('ecommerce.coupons.delete'));
    } catch {
      toastError(t('ecommerce.coupons.error_save'));
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  return (
    <AppLayout title={t('ecommerce.coupons.title')}>
      <PageHero
        meta={t('shop.nav')}
        title={t('ecommerce.coupons.title')}
        description={t('ecommerce.coupons.subtitle')}
        actions={
          <Button variant="primary" size="sm" leftIcon={<Plus size={15} />} onClick={openCreate}>
            {t('ecommerce.coupons.new')}
          </Button>
        }
      />

      {isLoading ? (
        <Card className="p-0 overflow-hidden" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">{t('common.loading')}</span>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-1/4 rounded" />
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="h-3 w-16 rounded ml-auto" />
              </div>
            ))}
          </div>
        </Card>
      ) : coupons.length === 0 ? (
        <Card className="p-0 overflow-hidden">
          <EmptyState
            variant={loadError ? 'compact' : 'first-time'}
            icon={loadError ? <RefreshCw size={32} strokeWidth={1.8} /> : <Ticket size={32} strokeWidth={1.8} />}
            meta={t('shop.nav')}
            title={loadError ? t('ecommerce.coupons.error_load') : t('ecommerce.coupons.empty_title')}
            description={loadError ? t('ecommerce.coupons.subtitle') : t('ecommerce.coupons.empty_desc')}
            action={
              loadError ? (
                <Button variant="primary" size="sm" leftIcon={<RefreshCw size={15} />} onClick={() => void load()}>
                  {t('action.retry')}
                </Button>
              ) : (
                <Button variant="primary" size="sm" leftIcon={<Plus size={15} />} onClick={openCreate}>
                  {t('ecommerce.coupons.new')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium">
              <thead>
                <tr>
                  <th className="col-frozen text-left" style={{ minWidth: 180 }}>{t('ecommerce.coupons.code')}</th>
                  <th className="text-left">{t('ecommerce.coupons.discount_type')}</th>
                  <th className="text-left">{t('ecommerce.coupons.min_order')}</th>
                  <th className="text-left">{t('ecommerce.coupons.expires_at')}</th>
                  <th className="text-left">{t('ecommerce.coupons.times_used')}</th>
                  <th className="text-left">{t('ecommerce.coupons.active')}</th>
                  <th data-print-hide style={{ width: 96 }}></th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c, idx) => (
                  <tr
                    key={c.id}
                    className="list-item-enter"
                    style={{ animationDelay: `${idx * 28}ms` }}
                  >
                    <td className="col-frozen font-medium font-mono text-[13px]">{c.code}</td>
                    <td>
                      <span className="text-[var(--text-secondary)]">
                        {discountLabel(c)}
                        <span className="text-[var(--text-muted)] text-[12px]">
                          {' · '}
                          {(c.discount_type || (c.discount_percent != null ? 'percent' : 'fixed')) === 'fixed'
                            ? t('ecommerce.coupons.discount_fixed')
                            : t('ecommerce.coupons.discount_percent')}
                        </span>
                      </span>
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {c.min_order_cents
                        ? formatMoneyCents(c.min_order_cents, getLocale(), c.currency || 'CAD')
                        : '—'}
                    </td>
                    <td className="text-[var(--text-muted)]">{c.expires_at || '—'}</td>
                    <td className="text-[var(--text-muted)] t-mono-num">
                      {c.times_used ?? 0}
                      {c.usage_limit != null ? ` / ${c.usage_limit}` : ''}
                    </td>
                    <td>
                      <Tag size="sm" dot variant={c.is_active === 0 ? 'neutral' : 'success'}>
                        {c.is_active === 0
                          ? t('ecommerce.coupons.inactive')
                          : t('ecommerce.coupons.active')}
                      </Tag>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={t('ecommerce.coupons.save')}
                          onClick={() => openEdit(c)}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={t('ecommerce.coupons.delete')}
                          onClick={() => void handleDelete(c)}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Tester / valider un code (validateCoupon) ── */}
      {!isLoading && !loadError && (
        <CouponValidateTester defaultCurrency={coupons[0]?.currency || undefined} />
      )}

      {/* ── Création / édition ── */}
      <SlidePanel
        open={panelOpen}
        onOpenChange={(o) => { if (!o) setPanelOpen(false); }}
        title={editId ? t('ecommerce.coupons.save') : t('ecommerce.coupons.new')}
        description={t('ecommerce.coupons.subtitle')}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
              {t('ecommerce.coupons.code')}
            </label>
            <Input
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
              placeholder="PROMO10"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
              {t('ecommerce.coupons.discount_type')}
            </label>
            <Select
              value={form.discount_type}
              onChange={(e) => set('discount_type', e.target.value)}
            >
              <option value="percent">{t('ecommerce.coupons.discount_percent')}</option>
              <option value="fixed">{t('ecommerce.coupons.discount_fixed')}</option>
            </Select>
          </div>

          {form.discount_type === 'percent' ? (
            <div>
              <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
                {t('ecommerce.coupons.discount_percent')}
              </label>
              <Input
                type="number"
                value={form.discount_percent}
                onChange={(e) => set('discount_percent', e.target.value)}
                placeholder="10"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
                {t('ecommerce.coupons.discount_fixed')}
              </label>
              <Input
                type="number"
                value={form.discount_amount}
                onChange={(e) => set('discount_amount', e.target.value)}
                placeholder="500"
              />
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
              {t('ecommerce.coupons.min_order')}
            </label>
            <Input
              type="number"
              value={form.min_order_cents}
              onChange={(e) => set('min_order_cents', e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
                {t('ecommerce.coupons.starts_at')}
              </label>
              <Input
                type="date"
                value={form.starts_at}
                onChange={(e) => set('starts_at', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
                {t('ecommerce.coupons.expires_at')}
              </label>
              <Input
                type="date"
                value={form.expires_at}
                onChange={(e) => set('expires_at', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
              {t('ecommerce.coupons.usage_limit')}
            </label>
            <Input
              type="number"
              value={form.usage_limit}
              onChange={(e) => set('usage_limit', e.target.value)}
              placeholder="—"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              id="coupon-active"
              type="checkbox"
              checked={form.is_active === 1}
              onChange={(e) => set('is_active', e.target.checked ? 1 : 0)}
            />
            <label htmlFor="coupon-active" className="text-[13px] text-[var(--text-secondary)]">
              {t('ecommerce.coupons.active')}
            </label>
          </div>

          {formError && (
            <p className="text-[13px] text-[var(--danger)]">{formError}</p>
          )}

          <div className="flex items-center gap-2 pt-4 border-t border-[var(--border-subtle)]">
            <Button
              variant="primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {t('ecommerce.coupons.save')}
            </Button>
            <Button variant="secondary" onClick={() => setPanelOpen(false)} disabled={saving}>
              {t('action.cancel')}
            </Button>
          </div>
        </div>
      </SlidePanel>
    </AppLayout>
  );
}
