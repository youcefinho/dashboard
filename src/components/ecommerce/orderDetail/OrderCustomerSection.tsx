// ── OrderDetailPanel split S9 (Manager B) — client + adresses ───────────────
// Extraction ISO-RENDU STRICT depuis OrderDetailPanel.tsx (lignes 516-561).
// shipAddr/billAddr calculés dans le parent puis passés en props (inchangé).
import { t } from '@/lib/i18n';
import type { Order } from '@/lib/types';

export function OrderCustomerSection(
  { order, shipAddr, billAddr }: {
    order: Order;
    shipAddr: string | null;
    billAddr: string | null;
  },
) {
  return (
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
  );
}
