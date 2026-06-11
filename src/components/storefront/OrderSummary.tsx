// ── Storefront — OrderSummary (LOT STOREFRONT CHECKOUT, Sprint 7, NEUF) ──────
//
// Récap monétaire sobre — owned Manager-C. Affiche sous-total / taxes / frais
// de livraison / total. Le front N'INVENTE JAMAIS de montant : tout (sous-total,
// taxes, frais, total) vient du backend (PublicCart + getStoreShippingQuote —
// §6.C/§6.F). Les lignes optionnelles (taxes/frais) ne s'affichent que si une
// valeur a été fournie. i18n clés FIGÉES Phase A (checkout.*). AUCUN CSS global.

import { t } from '@/lib/i18n';
import { fmtMoney } from './money';

export function OrderSummary({
  subtotalCents,
  taxCents,
  shippingCents,
  totalCents,
  currency,
}: {
  subtotalCents: number;
  // null/undefined ⇒ pas encore connu (étape avant le quote) ⇒ ligne masquée.
  taxCents?: number | null;
  shippingCents?: number | null;
  shippingName?: string | null;
  totalCents?: number | null;
  currency?: string | null;
}) {
  // Total : valeur backend si fournie, sinon repli = sous-total + frais + taxes
  // connus (jamais inventé — simple somme des montants déjà renvoyés).
  const computedTotal =
    typeof totalCents === 'number'
      ? totalCents
      : subtotalCents + (shippingCents || 0) + (taxCents || 0);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm">
      <Row label={t('checkout.subtotal')} value={fmtMoney(subtotalCents, currency)} />
      {typeof taxCents === 'number' && (
        <Row label={t('checkout.taxes')} value={fmtMoney(taxCents, currency)} />
      )}
      {typeof shippingCents === 'number' && (
        <Row label={t('checkout.shipping_fees')} value={fmtMoney(shippingCents, currency)} />
      )}
      <div className="mt-2 border-t border-[var(--border)] pt-2">
        <Row
          label={t('checkout.total')}
          value={fmtMoney(computedTotal, currency)}
          strong
        />
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span style={{ color: strong ? 'var(--text-primary)' : 'var(--text-muted, #6b7280)', fontWeight: strong ? 700 : 400 }}>
        {label}
      </span>
      <span className="tabular-nums" style={{ fontWeight: strong ? 700 : 500 }}>
        {value}
      </span>
    </div>
  );
}
