// ── i18n / number — Sprint 48 M3.3 ──────────────────────────
// Wrappers sur Intl.NumberFormat (currency, percent, decimal, compact).
// Zero-dep, opt-in, back-compat 100%.
//
// ⚠️ IMPORTANT TPS/TVQ : ces helpers formattent UNIQUEMENT l'affichage.
// Toute logique de calcul taxes (14.975%, TPS 5%, TVQ 9.975%) demeure
// inchangée — voir Invoices.tsx. On ne touche pas aux math.
//
// Usage :
//   formatCurrency(1234.56, 'fr-CA')        → "1 234,56 $"
//   formatCurrency(1234.56, 'en-CA')        → "$1,234.56"
//   formatCurrency(1234.56, 'fr-FR', 'EUR') → "1 234,56 €"
//   formatPercent(0.123, 'fr-CA')           → "12,3 %"
//   formatNumber(1234567, 'fr-CA')          → "1 234 567"
//   formatCompact(1234567, 'fr-CA')         → "1,2 M"

export function formatCurrency(
  amount: number,
  locale: string,
  currency: string = 'CAD'
): string {
  if (!Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${amount} $`;
  }
}

/**
 * `value` doit être un ratio (0.123 = 12.3 %). Si tu as déjà un entier 12.3,
 * divise par 100 avant d'appeler ou utilise formatPercentFromInt.
 */
export function formatPercent(
  value: number,
  locale: string,
  fractionDigits: number = 1
): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${(value * 100).toFixed(fractionDigits)} %`;
  }
}

/** Helper si tu reçois déjà un entier (12.3) au lieu d'un ratio (0.123). */
export function formatPercentFromInt(
  value: number,
  locale: string,
  fractionDigits: number = 1
): string {
  return formatPercent(value / 100, locale, fractionDigits);
}

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions
): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Format compact : "1,2 M" / "1.2M" / "1,2 mil." selon locale.
 */
export function formatCompact(
  value: number,
  locale: string,
  fractionDigits: number = 1
): string {
  return formatNumber(value, locale, {
    notation: 'compact',
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Format "1 234,56 $" pattern utilisé partout dans le projet (fr-CA).
 * Helper conv pour migrer rapidement `.toLocaleString('fr-CA') + ' $'`.
 */
export function formatMoneyCAD(amount: number, locale: string = 'fr-CA'): string {
  return formatCurrency(amount, locale, 'CAD');
}

// ── Sprint E-R M3.1 — montants en cents multi-devise ────────────────────────
// Centralise le `/100` partout dans la boutique (commande/produit portent
// désormais une `currency` réelle : CAD / EUR / DZD). On NE touche PAS
// formatCurrency / formatMoneyCAD (back-compat CRM Invoices, Pipeline, etc.).
// `cents` non-fini → '—' (formatCurrency le gère déjà après /100).
/**
 * Formate un montant exprimé en cents (entier worker) dans la devise donnée.
 *   formatMoneyCents(123456, 'fr-CA')         → "1 234,56 $"
 *   formatMoneyCents(123456, 'fr-FR', 'EUR')  → "1 234,56 €"
 *   formatMoneyCents(123456, 'ar', 'DZD')     → format DZD localisé
 */
export function formatMoneyCents(
  cents: number,
  locale: string,
  currency: string = 'CAD'
): string {
  if (!Number.isFinite(cents)) return '—';
  return formatCurrency(cents / 100, locale, currency);
}
