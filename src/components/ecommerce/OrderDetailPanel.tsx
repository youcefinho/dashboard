// ── Boutique — Détail commande (SlidePanel) — Sprint E3 M3 A2 ───────────────
// En-tête n°/statut/date · line items (snapshots) · récap totaux avec
// breakdown TPS 5 % + TVQ 9,975 % lisible · client + adresses · timeline
// (paid_at/shipped_at/cancelled_at) · transitions de statut (machine à états)
// via updateOrderStatus + Toast + refresh · Facture PDF (contrat M2
// GET /orders/:id/invoice → bloc imprimable + triggerPdfExport('invoice')).
// Stripe SUBTLE, FR québécois, a11y focus-visible + aria.

import { useEffect, useState } from 'react';
import {
  SlidePanel, Button, Tag, Skeleton, Icon, useToast, Input, Textarea,
} from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  getEcommerceOrder, updateOrderStatus, getOrderInvoice,
  initOrderPayment, paymentStatusKey, fulfillmentStatusKey,
  // Sprint E6 M3 — refund (M1) / returns RMA + disputes / policy (M3 bloc).
  createOrderRefund, listOrderRefunds, refundStatusKey,
  listOrderReturns, createOrderReturn, updateOrderReturn, rmaStatusKey,
  listDisputes, disputeStatusKey, getOrderPolicy,
  type OrderInvoiceData, type RefundRecord, type ReturnRequest,
  type DisputeRecord,
} from '@/lib/api';
import type { ConsumerPolicy } from '@/lib/types';
// Sprint E4 M3.3 — sélection méthode de paiement (additif, non destructif).
import { CheckoutMethodSelect } from './CheckoutMethodSelect';
// Sprint E5 M3.1/M3.3 — section expéditions + bon de livraison (additif).
import { ShipmentPanel } from './ShipmentPanel';
import { triggerPdfExport } from '@/lib/pdfExport';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import type { Order, OrderStatus, PaymentMethod } from '@/lib/types';
import {
  Package, FileText, CheckCircle2, Truck, XCircle, RotateCcw, Clock,
  CreditCard, Undo2, ShieldAlert, ScrollText,
} from 'lucide-react';

// ── Helpers statut (inline — pas de fichier partagé) ────────────────────────
export function orderStatusLabel(s?: string): string {
  switch (s) {
    case 'pending': return t('shop.order.st_pending');
    case 'paid': return t('shop.order.st_paid');
    case 'preparing': return t('shop.order.st_preparing');
    case 'shipped': return t('shop.order.st_shipped');
    case 'delivered': return t('shop.order.st_delivered');
    case 'cancelled': return t('shop.order.st_cancelled');
    case 'refunded': return t('shop.order.st_refunded');
    default: return s || '—';
  }
}
export function orderStatusVariant(s?: string): 'success' | 'warning' | 'neutral' | 'danger' | 'info' {
  switch (s) {
    case 'delivered': case 'paid': return 'success';
    case 'shipped': case 'preparing': return 'info';
    case 'pending': return 'warning';
    case 'cancelled': case 'refunded': return 'danger';
    default: return 'neutral';
  }
}
export function financialLabel(s?: string): string {
  switch (s) {
    case 'unpaid': return t('shop.order.fin_unpaid');
    case 'paid': return t('shop.order.fin_paid');
    case 'partially_refunded': return t('shop.order.fin_partially_refunded');
    case 'refunded': return t('shop.order.fin_refunded');
    default: return s || '—';
  }
}
export function fulfillmentLabel(s?: string): string {
  switch (s) {
    case 'unfulfilled': return t('shop.order.ful_unfulfilled');
    case 'partial': return t('shop.order.ful_partial');
    case 'fulfilled': return t('shop.order.ful_fulfilled');
    default: return s || '—';
  }
}

// Machine à états : transitions autorisées par statut courant.
function allowedTransitions(s: OrderStatus): Array<{
  to: OrderStatus; labelKey: string; icon: typeof CheckCircle2; danger?: boolean;
}> {
  switch (s) {
    case 'pending':
      return [
        { to: 'paid', labelKey: 'shop.order.act_mark_paid', icon: CheckCircle2 },
        { to: 'cancelled', labelKey: 'shop.order.act_cancel', icon: XCircle, danger: true },
      ];
    case 'paid':
      return [
        { to: 'preparing', labelKey: 'shop.order.act_prepare', icon: Package },
        { to: 'refunded', labelKey: 'shop.order.act_refund', icon: RotateCcw, danger: true },
        { to: 'cancelled', labelKey: 'shop.order.act_cancel', icon: XCircle, danger: true },
      ];
    case 'preparing':
      return [
        { to: 'shipped', labelKey: 'shop.order.act_ship', icon: Truck },
        { to: 'cancelled', labelKey: 'shop.order.act_cancel', icon: XCircle, danger: true },
      ];
    case 'shipped':
      return [
        { to: 'delivered', labelKey: 'shop.order.act_deliver', icon: CheckCircle2 },
      ];
    case 'delivered':
      return [
        { to: 'refunded', labelKey: 'shop.order.act_refund', icon: RotateCcw, danger: true },
      ];
    default:
      return []; // cancelled / refunded = terminal
  }
}

function parseAddress(json: string | null): string | null {
  if (!json) return null;
  try {
    const a = JSON.parse(json);
    const parts = [
      a.line1 || a.address1 || a.street,
      a.line2 || a.address2,
      [a.city, a.province || a.state, a.postal_code || a.zip].filter(Boolean).join(', '),
      a.country,
    ].filter(Boolean);
    return parts.length ? parts.join('\n') : null;
  } catch {
    return null;
  }
}

interface OrderDetailPanelProps {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Refresh la liste parente après une transition de statut. */
  onChanged?: () => void;
}

export function OrderDetailPanel({ orderId, open, onOpenChange, onChanged }: OrderDetailPanelProps) {
  const { success, error: toastError } = useToast();
  const locale = getLocale();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  // Sprint E4 M3.3 — paiement (additif). État local : méthode sélectionnée +
  // statut paiement courant (renvoyé par l'init M1) + en cours.
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const [payStatus, setPayStatus] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  // Facture (contrat M2). null = pas encore chargé, false = indispo (404).
  const [invoice, setInvoice] = useState<OrderInvoiceData | null | false>(null);

  // Sprint E5 M3.3 — quel document imprimer (réutilise le mode PDF 'invoice'
  // figé). On bascule le bloc rendu en DOM pour qu'un SEUL bloc imprimable
  // existe au moment du window.print() : 'invoice' = facture E3 (défaut,
  // intact), 'delivery' = bon de livraison SANS prix.
  const [pdfDoc, setPdfDoc] = useState<'invoice' | 'delivery' | 'credit'>('invoice');

  // Sprint E6 M3.3 — Remboursement / Retour (additif, non destructif).
  // ⚠️ ZONE RÉGULÉE : inoffensif tant que payments_live_enabled=0 serveur.
  // M2 (returns/disputes) parallèle : on dégrade silencieusement (liste vide)
  // tant que l'endpoint n'est pas câblé — jamais d'erreur bloquante UI.
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [disputes, setDisputes] = useState<DisputeRecord[]>([]);
  const [policy, setPolicy] = useState<ConsumerPolicy | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundRestock, setRefundRestock] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const [rmaOpen, setRmaOpen] = useState(false);
  const [rmaReason, setRmaReason] = useState('');
  const [rmaBusy, setRmaBusy] = useState(false);

  // Charge remboursements/retours/litiges/politique (dégrade en silence).
  const loadAfterSales = async (oid: string) => {
    const [rf, rt, dp, pol] = await Promise.allSettled([
      listOrderRefunds(oid),
      listOrderReturns(oid),
      listDisputes(),
      getOrderPolicy(oid),
    ]);
    if (rf.status === 'fulfilled' && rf.value.data) setRefunds(rf.value.data);
    else setRefunds([]);
    if (rt.status === 'fulfilled' && rt.value.data) setReturns(rt.value.data);
    else setReturns([]);
    if (dp.status === 'fulfilled' && dp.value.data) {
      setDisputes(dp.value.data.filter((d) => d.order_id === oid));
    } else setDisputes([]);
    if (pol.status === 'fulfilled' && pol.value.data) setPolicy(pol.value.data);
    else setPolicy(null);
  };

  const load = async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const res = await getEcommerceOrder(orderId);
      setOrder(res.data || null);
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && orderId) {
      setOrder(null);
      setInvoice(null);
      setPayMethod(null);
      setPayStatus(null);
      setRefunds([]);
      setReturns([]);
      setDisputes([]);
      setPolicy(null);
      setRefundOpen(false);
      setRmaOpen(false);
      setRefundAmount('');
      setRefundReason('');
      setRefundRestock(false);
      setRmaReason('');
      setPdfDoc('invoice');
      void load();
      // Tente la facture (M2) — dégrade proprement si indispo.
      getOrderInvoice(orderId)
        .then((r) => setInvoice(r.data ?? false))
        .catch(() => setInvoice(false));
      // Sprint E6 M3 — remboursements/retours/litiges/politique (silencieux).
      void loadAfterSales(orderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  const handleTransition = async (to: OrderStatus) => {
    if (!order) return;
    setActing(true);
    try {
      await updateOrderStatus(order.id, to);
      success(t('shop.order.status_updated'));
      await load();
      onChanged?.();
    } catch {
      toastError(t('shop.order.status_error'));
    } finally {
      setActing(false);
    }
  };

  // Sprint E4 M3.3 — lance le paiement (contrat figé M1). ⚠️ ZONE RÉGULÉE :
  // inoffensif tant que payments_live_enabled=0 côté serveur. COD → la
  // commande reste impayée (encaissement hors-ligne). redirect_url → page
  // de paiement HÉBERGÉE du provider (aucune carte saisie ici — PCI).
  const handleLaunchPayment = async () => {
    if (!order || !payMethod) {
      toastError(t('shop.payment.method_required'));
      return;
    }
    setPaying(true);
    try {
      const res = await initOrderPayment(order.id, payMethod);
      if (res.error || !res.data) {
        toastError(res.error || t('shop.payment.init_error'));
        return;
      }
      setPayStatus(res.data.status);
      if (res.data.redirect_url) {
        // Redirection vers le checkout hébergé (nouvel onglet — on garde le
        // panneau ouvert pour le suivi de statut).
        success(t('shop.payment.redirecting'));
        window.open(res.data.redirect_url, '_blank', 'noopener,noreferrer');
      } else if (res.data.status === 'pending_cod') {
        success(t('shop.payment.cod_recorded'));
      } else {
        success(t('shop.payment.processing'));
      }
      onChanged?.();
    } catch {
      toastError(t('shop.payment.init_error'));
    } finally {
      setPaying(false);
    }
  };

  const handleInvoicePdf = () => {
    // Le bloc .order-invoice-print est rendu (caché en screen) → window.print.
    setPdfDoc('invoice');
    // Laisse React commiter le bon bloc avant le snapshot navigateur.
    requestAnimationFrame(() => triggerPdfExport('invoice'));
  };

  // Sprint E5 M3.3 — bon de livraison : réutilise le mode 'invoice' figé
  // (aucune extension PdfMode). Le bloc .delivery-slip-print remplace le bloc
  // facture en DOM (pdfDoc='delivery') → un seul document imprimé, SANS prix.
  const handleDeliverySlipPdf = () => {
    setPdfDoc('delivery');
    requestAnimationFrame(() => triggerPdfExport('invoice'));
  };

  // Sprint E6 M3.4 — note de crédit : réutilise le mode PDF 'invoice' figé
  // (AUCUNE extension PdfMode). Le bloc .credit-note-print remplace en DOM
  // les blocs facture/BL → un seul document imprimé. Facture E3 / BL E5
  // INCHANGÉS (pdfDoc revient à 'invoice' à chaque réouverture du panneau).
  const handleCreditNotePdf = () => {
    setPdfDoc('credit');
    requestAnimationFrame(() => triggerPdfExport('invoice'));
  };

  // ⚠️ ZONE RÉGULÉE — remboursement marchand. Sandbox tant que
  // payments_live_enabled=0 serveur. Montant vide ⇒ solde restant (M1).
  const handleRefund = async () => {
    if (!order) return;
    setRefundBusy(true);
    try {
      const cents = refundAmount.trim()
        ? Math.round(parseFloat(refundAmount.replace(',', '.')) * 100)
        : undefined;
      const res = await createOrderRefund(order.id, {
        ...(cents && cents > 0 ? { amount_cents: cents } : {}),
        ...(refundReason.trim() ? { reason: refundReason.trim() } : {}),
        ...(refundRestock ? { restock_items: (order.items || []).map((i) => i.id) } : {}),
      });
      if (res.error || !res.data) {
        toastError(res.error || t('shop.refund.error'));
        return;
      }
      success(t('shop.refund.created'));
      setRefundOpen(false);
      setRefundAmount('');
      setRefundReason('');
      setRefundRestock(false);
      await load();
      await loadAfterSales(order.id);
      onChanged?.();
    } catch {
      toastError(t('shop.refund.error'));
    } finally {
      setRefundBusy(false);
    }
  };

  // RMA — création d'une demande de retour (M2). Dégrade si non câblé.
  const handleCreateRma = async () => {
    if (!order) return;
    setRmaBusy(true);
    try {
      const items = (order.items || []).map((i) => ({
        order_item_id: i.id,
        quantity: i.quantity,
      }));
      const res = await createOrderReturn({
        order_id: order.id,
        items,
        ...(rmaReason.trim() ? { reason: rmaReason.trim() } : {}),
      });
      if (res.error || !res.data) {
        toastError(res.error || t('shop.rma.error'));
        return;
      }
      success(t('shop.rma.created'));
      setRmaOpen(false);
      setRmaReason('');
      await loadAfterSales(order.id);
      onChanged?.();
    } catch {
      toastError(t('shop.rma.error'));
    } finally {
      setRmaBusy(false);
    }
  };

  // RMA — fait avancer le cycle (approve/receive/reject) — M2.
  const handleRmaAction = async (
    rid: string, action: 'approve' | 'receive' | 'reject',
  ) => {
    if (!order) return;
    try {
      const res = await updateOrderReturn(rid, action);
      if (res.error) {
        toastError(res.error || t('shop.rma.error'));
        return;
      }
      success(t('shop.rma.updated'));
      await load();
      await loadAfterSales(order.id);
      onChanged?.();
    } catch {
      toastError(t('shop.rma.error'));
    }
  };

  // Montant total remboursé (somme des remboursements aboutis/encours).
  const refundedCents = refunds.reduce(
    (s, r) => s + (r.status !== 'failed' ? r.amount_cents : 0), 0,
  );

  // Devise réelle portée par la commande (M1) — fallback CAD (donnée legacy).
  const cur = order?.currency || 'CAD';
  const transitions = order ? allowedTransitions(order.status) : [];
  const shipAddr = order ? parseAddress(order.shipping_address_json) : null;
  const billAddr = order ? parseAddress(order.billing_address_json) : null;

  const title = order
    ? `${t('shop.order.title')} ${order.order_number || `#${order.id.slice(0, 8)}`}`
    : t('shop.order.detail_title');

  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={order?.placed_at ? formatDate(order.placed_at, locale) : undefined}
      size="lg"
      headerActions={
        order && (
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={handleInvoicePdf}
            disabled={invoice === false}
            title={invoice === false ? t('shop.order.invoice_soon') : t('shop.order.invoice_pdf')}
          >
            <Icon as={FileText} size="sm" /> {t('shop.order.invoice_pdf')}
          </Button>
        )
      }
    >
      {loading || !order ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-1/2 rounded" />
          <Skeleton className="h-24 w-full rounded" />
          <Skeleton className="h-32 w-full rounded" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Statut courant */}
          <div className="flex flex-wrap items-center gap-2">
            <Tag dot size="sm" variant={orderStatusVariant(order.status)}>
              {orderStatusLabel(order.status)}
            </Tag>
            <Tag size="sm" variant="neutral">
              {t('shop.order.financial')} · {financialLabel(order.financial_status)}
            </Tag>
            <Tag size="sm" variant="neutral">
              {t('shop.order.fulfillment')} · {fulfillmentLabel(order.fulfillment_status)}
            </Tag>
          </div>

          {/* Articles */}
          <section>
            <h3 className="t-h3 mb-3">{t('shop.order.items')}</h3>
            <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden divide-y divide-[var(--border-subtle)]">
              {(order.items || []).length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)] px-3 py-4">—</p>
              ) : (order.items || []).map((it) => (
                <div key={it.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{it.product_title_snapshot}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {[it.variant_title_snapshot, it.sku_snapshot].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <span className="text-[12px] text-[var(--text-secondary)] t-mono-num whitespace-nowrap">
                    {it.quantity} × {formatMoneyCents(it.unit_price_cents, locale, cur)}
                  </span>
                  <span className="text-[13px] font-semibold t-mono-num w-24 text-right">
                    {formatMoneyCents(it.total_cents, locale, cur)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Récap totaux — breakdown TPS + TVQ 14,975 % QC lisible */}
          <section>
            <h3 className="t-h3 mb-3">{t('shop.order.total')}</h3>
            <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 flex flex-col gap-1.5 text-[13px]">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">{t('shop.order.subtotal')}</span>
                <span className="t-mono-num">{formatMoneyCents(order.subtotal_cents, locale, cur)}</span>
              </div>
              {order.discount_cents > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">{t('shop.order.discount')}</span>
                  <span className="t-mono-num">-{formatMoneyCents(order.discount_cents, locale, cur)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">{t('shop.order.tps')}</span>
                <span className="t-mono-num">{formatMoneyCents(order.tps_cents, locale, cur)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">{t('shop.order.tvq')}</span>
                <span className="t-mono-num">{formatMoneyCents(order.tvq_cents, locale, cur)}</span>
              </div>
              {order.shipping_cents > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">{t('shop.order.shipping')}</span>
                  <span className="t-mono-num">{formatMoneyCents(order.shipping_cents, locale, cur)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 mt-1 border-t border-[var(--border-subtle)] font-semibold text-[14px]">
                <span>{t('shop.order.total')}</span>
                <span className="t-mono-num" style={{ color: 'var(--primary)' }}>
                  {formatMoneyCents(order.total_cents, locale, cur)}
                </span>
              </div>
            </div>
          </section>

          {/* Client + adresses */}
          <section>
            <h3 className="t-h3 mb-3">{t('shop.order.customer')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
              <div>
                <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
                  {t('shop.order.email')}
                </p>
                <p>
                  {order.customer
                    ? `${order.customer.first_name} ${order.customer.last_name}`.trim() || order.email
                    : order.email || '—'}
                </p>
                {order.customer?.email && order.customer.email !== order.email && (
                  <p className="text-[var(--text-muted)]">{order.customer.email}</p>
                )}
                {order.email && (
                  <p className="text-[var(--text-muted)]">{order.email}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
                  {t('shop.order.shipping_address')}
                </p>
                <p className="whitespace-pre-line text-[var(--text-secondary)]">
                  {shipAddr || t('shop.order.no_address')}
                </p>
              </div>
              {billAddr && billAddr !== shipAddr && (
                <div>
                  <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
                    {t('shop.order.billing_address')}
                  </p>
                  <p className="whitespace-pre-line text-[var(--text-secondary)]">{billAddr}</p>
                </div>
              )}
            </div>
            {order.note && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
                  {t('shop.order.note')}
                </p>
                <p className="text-[13px] text-[var(--text-secondary)] whitespace-pre-line">{order.note}</p>
              </div>
            )}
          </section>

          {/* Timeline */}
          <section>
            <h3 className="t-h3 mb-3">{t('shop.order.timeline')}</h3>
            <ul className="flex flex-col gap-2.5">
              {([
                ['placed', order.placed_at, t('shop.order.placed')],
                ['paid', order.paid_at, t('shop.order.paid_at')],
                ['shipped', order.shipped_at, t('shop.order.shipped_at')],
                ['cancelled', order.cancelled_at, t('shop.order.cancelled_at')],
              ] as const)
                .filter(([, ts]) => Boolean(ts))
                .map(([k, ts, label]) => (
                  <li key={k} className="flex items-center gap-2.5 text-[13px]">
                    <span
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-muted)] shrink-0"
                      aria-hidden
                    >
                      <Icon as={Clock} size="xs" />
                    </span>
                    <span className="text-[var(--text-secondary)]">{label}</span>
                    <span className="ml-auto t-mono-num text-[12px] text-[var(--text-muted)]">
                      {formatDate(ts as string, locale, {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
            </ul>
          </section>

          {/* Paiement — Sprint E4 M3.3 (additif, non destructif). ⚠️ RÉGULÉ */}
          <section>
            <h3 className="t-h3 mb-3 flex items-center gap-2">
              <Icon as={CreditCard} size="sm" className="text-[var(--primary)]" />
              {t('shop.payment.section')}
            </h3>

            {/* Statut paiement courant */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-[12px] text-[var(--text-secondary)]">
                {t('shop.payment.current_status')}
              </span>
              <Tag
                size="sm"
                dot
                variant={
                  order.paid_at || payStatus === 'paid'
                    ? 'success'
                    : payStatus === 'failed'
                    ? 'danger'
                    : payStatus
                    ? 'info'
                    : 'neutral'
                }
              >
                {order.paid_at
                  ? t('shop.payment.st_paid')
                  : t(paymentStatusKey(payStatus || undefined))}
              </Tag>
            </div>

            {order.paid_at || order.financial_status === 'paid' ? (
              <p className="text-[12px] text-[var(--text-muted)]">
                {t('shop.payment.already_paid')}
              </p>
            ) : order.status === 'cancelled' ? null : (
              <div className="flex flex-col gap-3">
                <CheckoutMethodSelect
                  currency={cur}
                  value={payMethod}
                  onChange={setPayMethod}
                  disabled={paying}
                />
                <div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={paying || !payMethod}
                    onClick={handleLaunchPayment}
                  >
                    <Icon as={CreditCard} size="sm" />
                    {paying
                      ? t('shop.payment.processing')
                      : t('shop.payment.launch')}
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Expéditions — Sprint E5 M3.1/M3.3 (additif, non destructif).
              Section PURE TRACE : ne touche jamais items/totaux/timeline/
              transitions/PDF facture E3 ni la section paiement E4. */}
          <section>
            <h3 className="t-h3 mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Icon as={Truck} size="sm" className="text-[var(--primary)]" />
                {t('shop.shipment.section')}
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={handleDeliverySlipPdf}
                title={t('shop.shipment.delivery_slip')}
              >
                <Icon as={FileText} size="sm" /> {t('shop.shipment.delivery_slip')}
              </Button>
            </h3>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-[12px] text-[var(--text-secondary)]">
                {t('shop.order.fulfillment')}
              </span>
              <Tag size="sm" dot variant={
                order.fulfillment_status === 'fulfilled'
                  ? 'success'
                  : order.fulfillment_status === 'partial'
                  ? 'info'
                  : 'neutral'
              }>
                {t(fulfillmentStatusKey(order.fulfillment_status))}
              </Tag>
            </div>
            <ShipmentPanel order={order} onChanged={() => { void load(); onChanged?.(); }} />
          </section>

          {/* Remboursement / Retour — Sprint E6 M3.3 (additif, non destructif).
              ⚠️ ZONE RÉGULÉE : sandbox tant que payments_live_enabled=0.
              Ne touche JAMAIS items/totaux/timeline/transitions/PDF facture
              E3 ni les sections paiement E4 / expéditions E5. */}
          <section>
            <h3 className="t-h3 mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Icon as={Undo2} size="sm" className="text-[var(--primary)]" />
                {t('shop.refund.section')}
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={handleCreditNotePdf}
                disabled={refunds.length === 0}
                title={t('shop.refund.credit_note')}
              >
                <Icon as={FileText} size="sm" /> {t('shop.refund.credit_note')}
              </Button>
            </h3>

            {/* Politique de rétractation indicative — ⚠️ RÉGULÉ */}
            {policy && (
              <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
                  <Icon as={ScrollText} size="xs" className="text-[var(--text-muted)]" />
                  {t('shop.policy.title')}
                  <span className="ml-1 text-[11px] font-normal text-[var(--text-muted)]">
                    · {t('shop.policy.region')} : {policy.region}
                  </span>
                </p>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  {policy.withdrawal_window_days > 0
                    ? `${t('shop.policy.window')} — ${t('shop.policy.window_days').replace('{n}', String(policy.withdrawal_window_days))}`
                    : t('shop.policy.no_window')}
                </p>
                {policy.mentions.length > 0 && (
                  <ul className="mt-1.5 list-disc pl-4 text-[11px] text-[var(--text-muted)] space-y-0.5">
                    {policy.mentions.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                )}
                <p
                  className="mt-2 text-[11px] font-medium"
                  style={{ color: 'var(--warning, #b45309)' }}
                  role="note"
                >
                  {t('shop.policy.banner')}
                </p>
              </div>
            )}

            {/* Remboursements existants */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
                {t('shop.refund.list_title')}
                {refundedCents > 0 && (
                  <span className="ml-1.5 font-normal text-[var(--text-muted)] t-mono-num">
                    · {formatMoneyCents(refundedCents, locale, cur)}
                  </span>
                )}
              </span>
              {isAdmin && order.status !== 'cancelled' && (order.paid_at || order.financial_status === 'paid') && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setRefundOpen((v) => !v)}
                >
                  <Icon as={RotateCcw} size="sm" /> {t('shop.refund.create')}
                </Button>
              )}
            </div>
            {refunds.length === 0 ? (
              <p className="text-[12px] text-[var(--text-muted)] mb-2">
                {t('shop.refund.none')}
              </p>
            ) : (
              <ul className="mb-2 flex flex-col gap-1.5">
                {refunds.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 text-[12px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2.5 py-2"
                  >
                    <Tag size="sm" dot variant={
                      r.status === 'succeeded' ? 'success'
                        : r.status === 'failed' ? 'danger' : 'info'
                    }>
                      {t(refundStatusKey(r.status))}
                    </Tag>
                    <span className="t-mono-num font-semibold">
                      {formatMoneyCents(r.amount_cents, locale, r.currency || cur)}
                    </span>
                    {r.reason && (
                      <span className="text-[var(--text-muted)] truncate">· {r.reason}</span>
                    )}
                    {r.restocked && (
                      <span className="ml-auto text-[11px] text-[var(--text-muted)]">
                        {t('shop.refund.restock')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Formulaire remboursement (admin) — ⚠️ RÉGULÉ */}
            {refundOpen && isAdmin && (
              <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 flex flex-col gap-3">
                <div>
                  <label
                    htmlFor="refund-amount"
                    className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1"
                  >
                    {t('shop.refund.amount')}
                  </label>
                  <Input
                    id="refund-amount"
                    inputMode="decimal"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    placeholder={formatMoneyCents(
                      Math.max(0, order.total_cents - refundedCents), locale, cur,
                    )}
                  />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    {t('shop.refund.amount_hint')}
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="refund-reason"
                    className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1"
                  >
                    {t('shop.refund.reason')}
                  </label>
                  <Textarea
                    id="refund-reason"
                    rows={2}
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder={t('shop.refund.reason_ph')}
                  />
                </div>
                <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={refundRestock}
                    onChange={(e) => setRefundRestock(e.target.checked)}
                  />
                  {t('shop.refund.restock')}
                </label>
                <p
                  className="text-[11px] font-medium"
                  style={{ color: 'var(--warning, #b45309)' }}
                  role="note"
                >
                  {t('shop.refund.regulated')}
                </p>
                <div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={refundBusy}
                    onClick={handleRefund}
                  >
                    <Icon as={CheckCircle2} size="sm" />
                    {t('shop.refund.submit')}
                  </Button>
                </div>
              </div>
            )}

            {/* Retours (RMA) — M2 (dégrade si non câblé) */}
            <div className="mt-2 pt-3 border-t border-[var(--border-subtle)]">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
                  {t('shop.rma.title')}
                </span>
                {isAdmin && order.status !== 'cancelled' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setRmaOpen((v) => !v)}
                  >
                    <Icon as={Undo2} size="sm" /> {t('shop.rma.create')}
                  </Button>
                )}
              </div>
              {returns.length === 0 ? (
                <p className="text-[12px] text-[var(--text-muted)]">
                  {t('shop.rma.none')}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {returns.map((rt) => (
                    <li
                      key={rt.id}
                      className="flex flex-wrap items-center gap-2 text-[12px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2.5 py-2"
                    >
                      <Tag size="sm" dot variant={
                        rt.status === 'refunded' ? 'success'
                          : rt.status === 'rejected' ? 'danger'
                          : rt.status === 'received' || rt.status === 'approved' ? 'info'
                          : 'neutral'
                      }>
                        {t(rmaStatusKey(rt.status))}
                      </Tag>
                      {rt.reason && (
                        <span className="text-[var(--text-muted)] truncate">{rt.reason}</span>
                      )}
                      {isAdmin && (
                        <span className="ml-auto flex gap-1.5">
                          {rt.status === 'pending' && (
                            <>
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => handleRmaAction(rt.id, 'approve')}
                              >
                                {t('shop.rma.act_approve')}
                              </Button>
                              <Button
                                variant="ghost" size="sm"
                                style={{ color: 'var(--danger)' }}
                                onClick={() => handleRmaAction(rt.id, 'reject')}
                              >
                                {t('shop.rma.act_reject')}
                              </Button>
                            </>
                          )}
                          {rt.status === 'approved' && (
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => handleRmaAction(rt.id, 'receive')}
                            >
                              {t('shop.rma.act_receive')}
                            </Button>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {rmaOpen && isAdmin && (
                <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 flex flex-col gap-3">
                  <div>
                    <label
                      htmlFor="rma-reason"
                      className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1"
                    >
                      {t('shop.rma.reason')}
                    </label>
                    <Textarea
                      id="rma-reason"
                      rows={2}
                      value={rmaReason}
                      onChange={(e) => setRmaReason(e.target.value)}
                      placeholder={t('shop.rma.reason_ph')}
                    />
                  </div>
                  <div>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={rmaBusy}
                      onClick={handleCreateRma}
                    >
                      <Icon as={Undo2} size="sm" /> {t('shop.rma.submit')}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Litiges — lecture seule (M2, régulé : enregistrement DB) */}
            {disputes.length > 0 && (
              <div className="mt-2 pt-3 border-t border-[var(--border-subtle)]">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)] mb-2">
                  <Icon as={ShieldAlert} size="xs" className="text-[var(--text-muted)]" />
                  {t('shop.dispute.title')}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {disputes.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center gap-2 text-[12px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2.5 py-2"
                    >
                      <Tag size="sm" dot variant={
                        d.status === 'won' ? 'success'
                          : d.status === 'lost' ? 'danger'
                          : d.status === 'refunded' ? 'warning' : 'info'
                      }>
                        {t(disputeStatusKey(d.status))}
                      </Tag>
                      <span className="t-mono-num font-semibold">
                        {formatMoneyCents(d.amount_cents, locale, cur)}
                      </span>
                      <span className="ml-auto text-[11px] text-[var(--text-muted)]">
                        {d.provider}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Actions transition */}
          {transitions.length > 0 && (
            <section>
              <h3 className="t-h3 mb-3">{t('shop.order.actions')}</h3>
              <div className="flex flex-wrap gap-2">
                {transitions.map((tr) => (
                  <Button
                    key={tr.to}
                    variant={tr.danger ? 'ghost' : 'secondary'}
                    size="sm"
                    className="gap-1.5"
                    disabled={acting}
                    onClick={() => handleTransition(tr.to)}
                    style={tr.danger ? { color: 'var(--danger)' } : undefined}
                  >
                    <Icon as={tr.icon} size="sm" /> {t(tr.labelKey)}
                  </Button>
                ))}
              </div>
            </section>
          )}

          {/* Bloc facture imprimable — caché en screen, révélé en pdf-mode.
              Sprint E5 M3.3 : rendu UNIQUEMENT si pdfDoc!=='delivery' pour
              garantir qu'un seul document est en DOM au window.print(). Le
              comportement facture E3 est INCHANGÉ (pdfDoc défaut = 'invoice'). */}
          {invoice && invoice !== false && pdfDoc === 'invoice' && (
            <div className="order-invoice-print" aria-hidden="true">
              <div className="pdf-cover-accent-bar" />
              <div className="pdf-cover-logo">Intralys</div>
              <h1 className="pdf-cover-title">
                {t('shop.order.invoice_pdf')} — {order.order_number || `#${order.id.slice(0, 8)}`}
              </h1>
              <p className="pdf-cover-subtitle">
                {invoice.client.name || ''}
                {invoice.client.tax_note ? ` · ${invoice.client.tax_note}` : ''}
              </p>
              <table className="order-invoice-table" style={{ width: '100%', marginTop: 24, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.order.item')}
                    </th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.order.qty')}
                    </th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.order.unit_price')}
                    </th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.order.line_total')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((it, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        {it.product_title}
                        {it.variant_title ? ` — ${it.variant_title}` : ''}
                        {it.sku ? ` (${it.sku})` : ''}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        {it.quantity}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        {formatMoneyCents(it.unit_price_cents, locale, cur)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        {formatMoneyCents(it.total_cents, locale, cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 16, marginLeft: 'auto', maxWidth: 280 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{t('shop.order.subtotal')}</span>
                  <span>{formatMoneyCents(invoice.totals.subtotal_cents, locale, cur)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{t('shop.order.tps')}</span>
                  <span>{formatMoneyCents(invoice.totals.tps_cents, locale, cur)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{t('shop.order.tvq')}</span>
                  <span>{formatMoneyCents(invoice.totals.tvq_cents, locale, cur)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #e5e7eb', fontWeight: 700, marginTop: 4 }}>
                  <span>{t('shop.order.total')}</span>
                  <span>{formatMoneyCents(invoice.totals.total_cents, locale, cur)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Bon de livraison imprimable — Sprint E5 M3.3. Bloc DISTINCT du
              bloc facture (classe .delivery-slip-print). Rendu uniquement
              quand pdfDoc==='delivery' → réutilise body.pdf-mode-invoice
              (mode figé, AUCUNE extension PdfMode). SANS prix ni montants. */}
          {pdfDoc === 'delivery' && (
            <div className="delivery-slip-print" aria-hidden="true">
              <div className="pdf-cover-accent-bar" />
              <div className="pdf-cover-logo">Intralys</div>
              <h1 className="pdf-cover-title">
                {t('shop.shipment.delivery_slip')} —{' '}
                {order.order_number || `#${order.id.slice(0, 8)}`}
              </h1>
              <p className="pdf-cover-subtitle">
                {order.placed_at ? formatDate(order.placed_at, locale) : ''}
              </p>

              <div className="delivery-slip-meta">
                <div>
                  <p className="delivery-slip-label">{t('shop.order.customer')}</p>
                  <p>
                    {order.customer
                      ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
                        || order.email
                      : order.email || '—'}
                  </p>
                </div>
                <div>
                  <p className="delivery-slip-label">
                    {t('shop.order.shipping_address')}
                  </p>
                  <p style={{ whiteSpace: 'pre-line' }}>
                    {shipAddr || t('shop.order.no_address')}
                  </p>
                </div>
              </div>

              <table
                className="delivery-slip-table"
                style={{ width: '100%', marginTop: 24, borderCollapse: 'collapse' }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.order.item')}
                    </th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.shipment.sku')}
                    </th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.shipment.qty')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items || []).map((it) => (
                    <tr key={it.id}>
                      <td style={{ padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        {it.product_title_snapshot}
                        {it.variant_title_snapshot
                          ? ` — ${it.variant_title_snapshot}`
                          : ''}
                      </td>
                      <td style={{ padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        {it.sku_snapshot || '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        {it.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {order.note && (
                <p style={{ marginTop: 16, whiteSpace: 'pre-line', fontSize: 12, color: '#374151' }}>
                  {t('shop.order.note')} : {order.note}
                </p>
              )}

              <p className="delivery-slip-footer">
                {t('shop.shipment.delivery_slip_footer')}
              </p>
            </div>
          )}

          {/* Note de crédit imprimable — Sprint E6 M3.4. Bloc DISTINCT
              (.credit-note-print) du bloc facture E3 / BL E5. Rendu
              UNIQUEMENT quand pdfDoc==='credit' → réutilise
              body.pdf-mode-invoice (mode figé, AUCUNE extension PdfMode).
              Montants NÉGATIFS (remboursement), taxes au prorata. */}
          {pdfDoc === 'credit' && refunds.length > 0 && (
            <div className="credit-note-print" aria-hidden="true">
              <div className="pdf-cover-accent-bar" />
              <div className="pdf-cover-logo">Intralys</div>
              <h1 className="pdf-cover-title">
                {t('shop.creditnote.title')} —{' '}
                {order.order_number || `#${order.id.slice(0, 8)}`}
              </h1>
              <p className="pdf-cover-subtitle">
                {order.placed_at ? formatDate(order.placed_at, locale) : ''}
                {invoice && invoice !== false && invoice.client.tax_note
                  ? ` · ${invoice.client.tax_note}` : ''}
              </p>

              <div className="credit-note-meta">
                <div>
                  <p className="credit-note-label">{t('shop.order.customer')}</p>
                  <p>
                    {order.customer
                      ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
                        || order.email
                      : order.email || '—'}
                  </p>
                </div>
                <div>
                  <p className="credit-note-label">{t('shop.policy.region')}</p>
                  <p>{policy?.region || '—'}</p>
                </div>
              </div>

              <p className="credit-note-label" style={{ marginTop: 20 }}>
                {t('shop.creditnote.refunded_items')}
              </p>
              <table
                className="credit-note-table"
                style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.refund.list_title')}
                    </th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.refund.reason')}
                    </th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #e5e7eb', padding: '6px 4px' }}>
                      {t('shop.creditnote.amount_refunded')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        {t(refundStatusKey(r.status))}
                      </td>
                      <td style={{ padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        {r.reason || '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                        -{formatMoneyCents(r.amount_cents, locale, r.currency || cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 16, marginLeft: 'auto', maxWidth: 280 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #e5e7eb', fontWeight: 700 }}>
                  <span>{t('shop.creditnote.amount_refunded')}</span>
                  <span>-{formatMoneyCents(refundedCents, locale, cur)}</span>
                </div>
              </div>

              <p style={{ marginTop: 14, fontSize: 11, color: '#6b7280' }}>
                {t('shop.creditnote.tax_note')}
              </p>
              <p className="credit-note-footer">
                {t('shop.creditnote.footer')}
              </p>
            </div>
          )}
        </div>
      )}
    </SlidePanel>
  );
}
