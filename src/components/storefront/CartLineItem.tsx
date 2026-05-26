// ── Storefront — CartLineItem (LOT STOREFRONT CHECKOUT, Sprint 7, NEUF) ──────
//
// Ligne de panier sobre — owned Manager-C. Quantité modifiable (update/remove
// câblés par le parent via les helpers FIGÉS updateStoreCartItem /
// removeStoreCartItem). AUCUN nouveau CSS global. i18n clés FIGÉES Phase A.
// Le front n'invente JAMAIS de prix : price_cents vient du backend (§6.B).

import type { PublicCart } from '@/lib/types';
import { t } from '@/lib/i18n';
import { fmtMoney } from './money';

type CartItem = PublicCart['items'][number];

export function CartLineItem({
  item,
  currency,
  disabled,
  onQtyChange,
  onRemove,
}: {
  item: CartItem;
  currency?: string | null;
  disabled?: boolean;
  // qty<=0 ⇒ le parent appelle remove ; sinon update (calque ecommerce-cart).
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
}) {
  const lineTotal = item.price_cents * item.qty;
  return (
    <div
      className="flex items-center gap-3 py-3 border-b border-[var(--border)]"
      data-cart-item-id={item.id || ''}
    >
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{item.name}</p>
        <p className="text-xs" style={{ color: '#6b7280' }}>
          {fmtMoney(item.price_cents, currency)}
        </p>
      </div>

      {/* Stepper quantité — borné à 1 par les boutons ; remove explicite. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onQtyChange(item.qty - 1)}
          className="h-7 w-7 rounded-md border border-[var(--border)] text-sm disabled:opacity-50"
          aria-label="-"
        >
          −
        </button>
        <span className="w-7 text-center text-sm tabular-nums">{item.qty}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onQtyChange(item.qty + 1)}
          className="h-7 w-7 rounded-md border border-[var(--border)] text-sm disabled:opacity-50"
          aria-label="+"
        >
          +
        </button>
      </div>

      <div className="w-20 text-right text-sm font-semibold tabular-nums">
        {fmtMoney(lineTotal, currency)}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        className="text-xs disabled:opacity-50"
        style={{ color: '#dc2626' }}
        aria-label={t('store.cart')}
      >
        ✕
      </button>
    </div>
  );
}
