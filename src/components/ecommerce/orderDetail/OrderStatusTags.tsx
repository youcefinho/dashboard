// ── OrderDetailPanel split S9 (Manager B) — bloc statut courant ──────────────
// Extraction ISO-RENDU STRICT depuis OrderDetailPanel.tsx (lignes 442-452).
// Pur déplacement de JSX : aucune logique, aucun changement de DOM.
import { Tag } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { Order } from '@/lib/types';
import {
  orderStatusVariant, orderStatusLabel, financialLabel, fulfillmentLabel,
} from './orderStatusHelpers';

export function OrderStatusTags({ order }: { order: Order }) {
  return (
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
  );
}
