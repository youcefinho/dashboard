// ── OrderDetailPanel split S9 (Manager B) — section articles ────────────────
// Extraction ISO-RENDU STRICT depuis OrderDetailPanel.tsx (lignes 454-477).
// Pur déplacement de JSX : DOM identique, aucune logique métier modifiée.
import { t, type Locale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import type { Order } from '@/lib/types';

export function OrderItemsSection(
  { order, locale, cur }: { order: Order; locale: Locale; cur: string },
) {
  return (
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
  );
}
