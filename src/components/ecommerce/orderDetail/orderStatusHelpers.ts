// ── OrderDetailPanel split S9 (Manager B) — helpers statut (inline) ─────────
// Extraction ISO-RENDU STRICT depuis OrderDetailPanel.tsx (lignes 40-127).
// Pur déplacement de code : signatures et corps IDENTIQUES à l'original.
// Les 4 helpers publics (orderStatusLabel/orderStatusVariant/financialLabel/
// fulfillmentLabel) restent re-exportés tels quels par OrderDetailPanel.tsx
// pour préserver les imports externes (BoutiqueDashboard / Commandes).
import { t } from '@/lib/i18n';
import type { OrderStatus } from '@/lib/types';
import { Package, CheckCircle2, Truck, XCircle, RotateCcw } from 'lucide-react';

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
export function allowedTransitions(s: OrderStatus): Array<{
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

export function parseAddress(json: string | null): string | null {
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
