// ── Boutique — Commande manuelle (Modal) — Sprint E3 M3 A3 ──────────────────
// Cas appel téléphonique / B2B : créer une commande sans passage en caisse.
// Sélection client existant (Combobox customers) OU courriel libre, lignes
// (recherche produit → variante + quantité), livraison/rabais, note.
// Aperçu live des totaux TPS 5 % / TVQ 9,975 % (preview indicatif — la vérité
// reste le backend qui recalcule via createManualOrder).
// Stripe SUBTLE, FR québécois. Aucune donnée fictive.

import { useEffect, useMemo, useState } from 'react';
import {
  Modal, Button, Input, Textarea, Combobox, Icon, useToast,
  type ComboboxOption,
} from '@/components/ui';
import {
  getEcommerceProducts, getEcommerceCustomers, createManualOrder,
  getEcommerceRegion,
  type CreateOrderPayload,
} from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import type { Product, Customer } from '@/lib/types';
import { Plus, Trash2, ShoppingCart } from 'lucide-react';

// Taux QC pour l'aperçu indicatif uniquement (le serveur fait foi).
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

interface LineDraft {
  key: string;
  variant_id: string;
  label: string;
  unit_price_cents: number;
  quantity: number;
}

interface ManualOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Appelé avec l'id de la commande créée pour ouvrir son détail. */
  onCreated: (orderId: string) => void;
}

function centsFromInput(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function ManualOrderModal({ open, onOpenChange, onCreated }: ManualOrderModalProps) {
  const { success, error: toastError } = useToast();
  const locale = getLocale();

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(false);
  // Devise de la boutique (config région) — fallback CAD si indispo.
  const [cur, setCur] = useState('CAD');

  const [customerId, setCustomerId] = useState('');
  const [email, setEmail] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [variantPick, setVariantPick] = useState('');
  const [shipping, setShipping] = useState('');
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Charge produits + clients à l'ouverture (une seule fois par ouverture).
  useEffect(() => {
    if (!open) return;
    setLoadingRefs(true);
    Promise.all([
      getEcommerceProducts({ status: 'active', limit: 200 }).then((r) => r.data || []).catch(() => []),
      getEcommerceCustomers().then((r) => r.data || []).catch(() => []),
    ])
      .then(([prods, custs]) => {
        setProducts(prods as Product[]);
        setCustomers(custs as Customer[]);
      })
      .finally(() => setLoadingRefs(false));
    // Devise contextuelle de la boutique (config région M2).
    getEcommerceRegion()
      .then((r) => { if (r.data?.currency) setCur(r.data.currency); })
      .catch(() => { /* fallback CAD */ });
  }, [open]);

  // Reset à la fermeture.
  useEffect(() => {
    if (open) return;
    setCustomerId(''); setEmail(''); setLines([]); setVariantPick('');
    setShipping(''); setDiscount(''); setNote(''); setSubmitting(false);
  }, [open]);

  // Options variantes (toutes les variantes des produits actifs).
  const variantOptions: ComboboxOption[] = useMemo(() => {
    const opts: ComboboxOption[] = [];
    for (const p of products) {
      for (const v of p.variants || []) {
        const price = v.price_override != null ? v.price_override : (p.base_price || 0);
        opts.push({
          value: v.id,
          label: `${p.title} — ${v.title}`,
          description: `${v.sku ? v.sku + ' · ' : ''}${formatMoneyCents(price, locale, cur)}`,
        });
      }
    }
    return opts;
  }, [products, locale, cur]);

  const customerOptions: ComboboxOption[] = useMemo(
    () => customers.map((c) => ({
      value: c.id,
      label: `${c.first_name} ${c.last_name}`.trim() || c.email,
      description: c.email,
    })),
    [customers],
  );

  const addLine = (variantId: string) => {
    if (!variantId) return;
    let found: { label: string; price: number } | null = null;
    for (const p of products) {
      const v = (p.variants || []).find((x) => x.id === variantId);
      if (v) {
        found = {
          label: `${p.title} — ${v.title}`,
          price: v.price_override != null ? v.price_override : (p.base_price || 0),
        };
        break;
      }
    }
    if (!found) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.variant_id === variantId);
      if (existing) {
        return prev.map((l) => l.variant_id === variantId ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, {
        key: `${variantId}-${Date.now()}`,
        variant_id: variantId,
        label: found!.label,
        unit_price_cents: found!.price,
        quantity: 1,
      }];
    });
    setVariantPick('');
  };

  const setQty = (key: string, qty: number) => {
    setLines((prev) => prev.map((l) => l.key === key ? { ...l, quantity: Math.max(1, qty) } : l));
  };
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  // Aperçu indicatif (le backend recalcule).
  const subtotalCents = lines.reduce((s, l) => s + l.unit_price_cents * l.quantity, 0);
  const shippingCents = centsFromInput(shipping);
  const discountCents = centsFromInput(discount);
  const taxableBase = Math.max(0, subtotalCents - discountCents);
  const tpsCents = Math.round(taxableBase * TPS_RATE);
  const tvqCents = Math.round(taxableBase * TVQ_RATE);
  const totalCents = taxableBase + tpsCents + tvqCents + shippingCents;

  const resolvedEmail = customerId
    ? (customers.find((c) => c.id === customerId)?.email || email.trim())
    : email.trim();

  const canSubmit = lines.length > 0 && Boolean(resolvedEmail) && !submitting;

  const handleSubmit = async () => {
    if (lines.length === 0) { toastError(t('shop.order.no_items')); return; }
    if (!resolvedEmail) { toastError(t('shop.order.need_email')); return; }
    setSubmitting(true);
    try {
      const payload: CreateOrderPayload = {
        customer_id: customerId || null,
        email: resolvedEmail,
        items: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })),
        shipping_cents: shippingCents || undefined,
        discount_cents: discountCents || undefined,
        note: note.trim() || undefined,
        source: 'manual',
      };
      const res = await createManualOrder(payload);
      const newId = res.data?.id;
      success(t('shop.order.created'));
      onOpenChange(false);
      if (newId) onCreated(newId);
    } catch {
      toastError(t('shop.order.create_error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('shop.order.manual_title')}
      description={t('shop.order.manual_desc')}
      size="lg"
    >
      <div className="flex flex-col gap-5">
        {/* Client */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              {t('shop.order.pick_customer')}
            </label>
            <Combobox
              options={customerOptions}
              value={customerId}
              onChange={setCustomerId}
              loading={loadingRefs}
              placeholder={t('shop.order.pick_customer')}
              ariaLabel={t('shop.order.customer')}
              emptyLabel="—"
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              {t('shop.order.or_email')}
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e: any) => setEmail(e.target.value)}
              placeholder="client@exemple.com"
              disabled={Boolean(customerId)}
              aria-label={t('shop.order.email')}
            />
          </div>
        </div>

        {/* Lignes */}
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
            {t('shop.order.items')}
          </label>
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <Combobox
                options={variantOptions}
                value={variantPick}
                onChange={(v) => addLine(v)}
                loading={loadingRefs}
                placeholder={t('shop.order.pick_product')}
                ariaLabel={t('shop.order.add_line')}
                emptyLabel="—"
              />
            </div>
          </div>

          {lines.length === 0 ? (
            <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)] py-6 justify-center border border-dashed border-[var(--border-subtle)] rounded-[var(--radius-md)]">
              <Icon as={ShoppingCart} size="sm" />
              {t('shop.order.no_items')}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden">
              {lines.map((l) => (
                <div key={l.key} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium truncate">{l.label}</p>
                    <p className="text-[11px] text-[var(--text-muted)] t-mono-num">
                      {formatMoneyCents(l.unit_price_cents, locale, cur)}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    value={String(l.quantity)}
                    onChange={(e: any) => setQty(l.key, parseInt(e.target.value, 10) || 1)}
                    className="w-20 text-center"
                    aria-label={t('shop.order.qty')}
                  />
                  <span className="text-[13px] font-semibold t-mono-num w-24 text-right">
                    {formatMoneyCents(l.unit_price_cents * l.quantity, locale, cur)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    aria-label={t('shop.order.cancel')}
                  >
                    <Icon as={Trash2} size="sm" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Livraison / rabais / note */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              {t('shop.order.shipping')} ($)
            </label>
            <Input
              type="text" inputMode="decimal"
              value={shipping}
              onChange={(e: any) => setShipping(e.target.value)}
              placeholder="0,00"
              aria-label={t('shop.order.shipping')}
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              {t('shop.order.discount')} ($)
            </label>
            <Input
              type="text" inputMode="decimal"
              value={discount}
              onChange={(e: any) => setDiscount(e.target.value)}
              placeholder="0,00"
              aria-label={t('shop.order.discount')}
            />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
            {t('shop.order.note')}
          </label>
          <Textarea
            value={note}
            onChange={(e: any) => setNote(e.target.value)}
            rows={2}
            placeholder="—"
            aria-label={t('shop.order.note')}
          />
        </div>

        {/* Aperçu totaux */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4">
          <p className="text-[12px] font-semibold text-[var(--text-secondary)] mb-3">
            {t('shop.order.preview_totals')}
          </p>
          <div className="flex flex-col gap-1.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">{t('shop.order.subtotal')}</span>
              <span className="t-mono-num">{formatMoneyCents(subtotalCents, locale, cur)}</span>
            </div>
            {discountCents > 0 && (
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">{t('shop.order.discount')}</span>
                <span className="t-mono-num">-{formatMoneyCents(discountCents, locale, cur)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">{t('shop.order.tps')}</span>
              <span className="t-mono-num">{formatMoneyCents(tpsCents, locale, cur)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">{t('shop.order.tvq')}</span>
              <span className="t-mono-num">{formatMoneyCents(tvqCents, locale, cur)}</span>
            </div>
            {shippingCents > 0 && (
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">{t('shop.order.shipping')}</span>
                <span className="t-mono-num">{formatMoneyCents(shippingCents, locale, cur)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 mt-1 border-t border-[var(--border-subtle)] font-semibold text-[14px]">
              <span>{t('shop.order.total')}</span>
              <span className="t-mono-num" style={{ color: 'var(--primary)' }}>
                {formatMoneyCents(totalCents, locale, cur)}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-3">
            {t('shop.order.preview_note')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('shop.order.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            leftIcon={<Plus size={14} />}
          >
            {t('shop.order.submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
