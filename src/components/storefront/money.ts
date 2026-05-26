// ── Storefront — formatage monétaire (LOT STOREFRONT CHECKOUT, Sprint 7) ─────
//
// Helper local Manager-C (composants storefront NEUFS). Money TOUJOURS en cents
// (INTEGER) — §6.B. Le front N'INVENTE jamais de montant : il se contente de
// re-formater les cents renvoyés par le backend. Devise = celle fournie par le
// backend (StoreSettings.currency / PublicCart.currency / quote.currency),
// fallback honnête 'CAD' (régime QC par défaut côté worker — §6.C).

export function fmtMoney(cents: number | null | undefined, currency?: string | null): string {
  const value = (typeof cents === 'number' ? cents : 0) / 100;
  const cur = (currency || 'CAD').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur,
    }).format(value);
  } catch {
    // Devise inconnue d'Intl → repli lisible (montant + code).
    return `${value.toFixed(2)} ${cur}`;
  }
}
