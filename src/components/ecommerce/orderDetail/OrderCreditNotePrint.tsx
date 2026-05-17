// ── OrderDetailPanel split S9 (Manager B) — note de crédit imprimable ───────
// Extraction ISO-RENDU STRICT depuis OrderDetailPanel.tsx (lignes 1185-1266).
// Bloc DISTINCT (.credit-note-print). Montants NÉGATIFS, taxes au prorata.
// Le parent garde le guard (pdfDoc==='credit' && refunds.length>0).
import { t, type Locale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { refundStatusKey, type OrderInvoiceData, type RefundRecord } from '@/lib/api';
import type { ConsumerPolicy } from '@/lib/types';
import type { Order } from '@/lib/types';

export function OrderCreditNotePrint(
  { order, refunds, refundedCents, invoice, policy, locale, cur }: {
    order: Order;
    refunds: RefundRecord[];
    refundedCents: number;
    invoice: OrderInvoiceData | null | false;
    policy: ConsumerPolicy | null;
    locale: Locale;
    cur: string;
  },
) {
  return (
    <div className="credit-note-print" aria-hidden="true">
      <div className="pdf-cover-accent-bar" />
      <div className="pdf-cover-logo">Intralys</div>
      <h1 className="pdf-cover-title">
        {t('shop.creditnote.title')} —{' '}
        {order.order_number || `#${order.id.slice(0, 8)}`}
      </h1>
      <p className="pdf-cover-subtitle">
        {order.placed_at ? formatDate(order.placed_at, locale) : ''}
        {invoice && invoice !== (false as unknown as OrderInvoiceData) && invoice.client.tax_note
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
  );
}
