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
  type OrderInvoiceData, type RefundRecord,
  type DisputeRecord,
} from '@/lib/api';
import type { ConsumerPolicy, ReturnRequest } from '@/lib/types';
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
  FileText, CheckCircle2, Truck, RotateCcw,
  CreditCard, Undo2, ShieldAlert, ScrollText,
} from 'lucide-react';

// ── Sprint S9 (Manager B) — split iso-rendu : helpers + sous-composants ──────
// Helpers statut déplacés vers orderDetail/orderStatusHelpers (corps IDENTIQUE)
// puis RE-EXPORTÉS ici pour préserver les imports externes existants
// (BoutiqueDashboard / Commandes importent ces 4 helpers depuis ce module).
import {
  orderStatusLabel, orderStatusVariant, financialLabel, fulfillmentLabel,
  allowedTransitions, parseAddress,
} from './orderDetail/orderStatusHelpers';
import { OrderStatusTags } from './orderDetail/OrderStatusTags';
import { OrderItemsSection } from './orderDetail/OrderItemsSection';
import { OrderTotalsSection } from './orderDetail/OrderTotalsSection';
import { OrderCustomerSection } from './orderDetail/OrderCustomerSection';
import { OrderTimelineSection } from './orderDetail/OrderTimelineSection';
import { OrderInvoicePrint } from './orderDetail/OrderInvoicePrint';
import { OrderDeliverySlipPrint } from './orderDetail/OrderDeliverySlipPrint';
import { OrderCreditNotePrint } from './orderDetail/OrderCreditNotePrint';

export {
  orderStatusLabel, orderStatusVariant, financialLabel, fulfillmentLabel,
};

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
          {/* Statut courant — split S9 (iso-rendu) */}
          <OrderStatusTags order={order} />

          {/* Articles — split S9 (iso-rendu) */}
          <OrderItemsSection order={order} locale={locale} cur={cur} />

          {/* Récap totaux — breakdown TPS + TVQ 14,975 % QC — split S9 */}
          <OrderTotalsSection order={order} locale={locale} cur={cur} />

          {/* Client + adresses — split S9 (iso-rendu) */}
          <OrderCustomerSection order={order} shipAddr={shipAddr} billAddr={billAddr} />

          {/* Timeline — split S9 (iso-rendu) */}
          <OrderTimelineSection order={order} locale={locale} />

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
          {invoice && invoice !== (false as unknown as OrderInvoiceData) && pdfDoc === 'invoice' && (
            <OrderInvoicePrint invoice={invoice} order={order} locale={locale} cur={cur} />
          )}

          {/* Bon de livraison imprimable — Sprint E5 M3.3. Bloc DISTINCT du
              bloc facture (classe .delivery-slip-print). Rendu uniquement
              quand pdfDoc==='delivery' → réutilise body.pdf-mode-invoice
              (mode figé, AUCUNE extension PdfMode). SANS prix ni montants. */}
          {pdfDoc === 'delivery' && (
            <OrderDeliverySlipPrint order={order} shipAddr={shipAddr} locale={locale} />
          )}

          {/* Note de crédit imprimable — Sprint E6 M3.4. Bloc DISTINCT
              (.credit-note-print) du bloc facture E3 / BL E5. Rendu
              UNIQUEMENT quand pdfDoc==='credit' → réutilise
              body.pdf-mode-invoice (mode figé, AUCUNE extension PdfMode).
              Montants NÉGATIFS (remboursement), taxes au prorata. */}
          {pdfDoc === 'credit' && refunds.length > 0 && (
            <OrderCreditNotePrint
              order={order}
              refunds={refunds}
              refundedCents={refundedCents}
              invoice={invoice}
              policy={policy}
              locale={locale}
              cur={cur}
            />
          )}
        </div>
      )}
    </SlidePanel>
  );
}
