// ── i18n utilities barrel — Sprint 48 M3 ────────────────────
// Export consolidé des wrappers Intl natifs (plural / datetime / number / TZ).
// ⚠️ Pour éviter ambiguïté avec lib/i18n.ts (qui exporte t()), importer
// explicitement depuis sous-chemin :
//   import { plural, formatDate } from '@/lib/i18n/plural'; etc.
//   import { t } from '@/lib/i18n'; (back-compat Sprint 35)
// Ce fichier sert de barrel interne pour bundlers compatibles.

export { plural, pluralSimple } from './plural';
export type { PluralForms } from './plural';

export {
  formatDate,
  formatDateTime,
  formatTime,
  formatRelativeTime,
  formatDateShort,
} from './datetime';

export {
  formatCurrency,
  formatPercent,
  formatPercentFromInt,
  formatNumber,
  formatCompact,
  formatMoneyCAD,
  formatMoneyCents,
} from './number';

export {
  formatDateInTimezone,
  getDetectedTimezone,
  getStoredTimezone,
  setStoredTimezone,
  listTimezones,
  listTimezonesByRegion,
} from './timezone';
