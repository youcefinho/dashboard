// ── OrderDetailPanel split S9 (Manager B) — bon de livraison imprimable ─────
// Extraction ISO-RENDU STRICT depuis OrderDetailPanel.tsx (lignes 1099-1178).
// Bloc DISTINCT (.delivery-slip-print) SANS prix. Rendu gardé par le parent
// (pdfDoc==='delivery') ; ce composant ne rend que le contenu.
import { t, type Locale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';
import type { Order } from '@/lib/types';

export function OrderDeliverySlipPrint(
  { order, shipAddr, locale }: {
    order: Order;
    shipAddr: string | null;
    locale: Locale;
  },
) {
  return (
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
  );
}
