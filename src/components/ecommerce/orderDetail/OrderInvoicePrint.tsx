// ── OrderDetailPanel split S9 (Manager B) — bloc facture imprimable ─────────
// Extraction ISO-RENDU STRICT depuis OrderDetailPanel.tsx (lignes 1025-1093).
// Caché en screen, révélé en pdf-mode. Comportement facture E3 INCHANGÉ.
// Le parent garde la condition d'affichage globale : ce composant ne rend
// que le contenu (déjà gardé par `invoice && pdfDoc==='invoice'` côté parent).
import { t, type Locale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import type { OrderInvoiceData } from '@/lib/api';
import type { Order } from '@/lib/types';

export function OrderInvoicePrint(
  { invoice, order, locale, cur }: {
    invoice: OrderInvoiceData;
    order: Order;
    locale: Locale;
    cur: string;
  },
) {
  return (
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
  );
}
