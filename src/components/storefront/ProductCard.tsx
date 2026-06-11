// ── Storefront — ProductCard (LOT STOREFRONT CHECKOUT, Sprint 7, NEUF) ───────
//
// Composant sobre (style Stripe Dashboard) — owned Manager-C. AUCUN nouveau CSS
// global (index.css INTERDIT) : classes Tailwind/primitives existantes + styles
// inline locaux légers (calque PublicBooking.tsx). i18n via clés FIGÉES Phase A
// (store.*) — AUCUNE création de clé côté Manager-C. Le front n'invente JAMAIS
// de prix : tout vient de StorefrontProduct (cents, §6.B).

import type { StorefrontProduct } from '@/lib/types';
import { t } from '@/lib/i18n';
import { fmtMoney } from './money';

export function ProductCard({
  product,
  currency,
  onView,
  onAdd,
}: {
  product: StorefrontProduct;
  currency?: string | null;
  onView: () => void;
  onAdd: () => void;
}) {
  const cur = product.currency || currency;
  return (
    <div
      className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden transition-shadow hover:shadow-md"
      data-product-id={product.id}
    >
      <button
        type="button"
        onClick={onView}
        className="block w-full text-left"
        style={{ aspectRatio: '4 / 3', background: 'var(--bg-subtle, #f6f8fa)' }}
        aria-label={t('store.view_product')}
      >
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted, #9ca3af)',
              fontSize: 12,
            }}
          >
            {product.name}
          </div>
        )}
      </button>

      <div className="flex flex-1 flex-col p-4">
        <button
          type="button"
          onClick={onView}
          className="text-left text-sm font-semibold text-[var(--text-primary)] hover:underline"
        >
          {product.name}
        </button>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted, #6b7280)' }}>
          {fmtMoney(product.price_cents, cur)}
        </p>

        <div className="mt-auto pt-3">
          {product.in_stock ? (
            <button
              type="button"
              onClick={onAdd}
              className="w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {t('store.add_to_cart')}
            </button>
          ) : (
            <span
              className="block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-center text-sm"
              style={{ color: 'var(--text-muted, #9ca3af)' }}
            >
              {t('store.out_of_stock')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
