// ── OrderDetailPanel split S9 (Manager B) — récap totaux + taxes QC ─────────
// Extraction ISO-RENDU STRICT depuis OrderDetailPanel.tsx (lignes 479-514).
// Breakdown TPS 5 % + TVQ 9,975 % INCHANGÉ (zéro logique fiscale modifiée).
import { t, type Locale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import type { Order } from '@/lib/types';

export function OrderTotalsSection(
  { order, locale, cur }: { order: Order; locale: Locale; cur: string },
) {
  return (
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
  );
}
