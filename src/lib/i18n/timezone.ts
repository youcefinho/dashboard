// ── i18n / timezone — Sprint 48 M3.4 ────────────────────────
// Helpers pour afficher dates / heures dans le timezone de l'utilisateur.
// Backend Workers stocke en UTC (Unix timestamps). Display = TZ user.
//
// Usage :
//   formatDateInTimezone(Date.now(), 'America/Montreal', 'fr-CA')
//     → "14 mai 2026, 14:30"
//   getDetectedTimezone()  → "America/Montreal" (browser default)
//   getStoredTimezone()    → la TZ persistée user (localStorage)
//   setStoredTimezone(tz)  → persiste choix user
//   listTimezones()        → liste pour <Select> Settings

const STORAGE_KEY = 'intralys_timezone';

/**
 * Format une date dans un timezone donné selon la locale.
 */
export function formatDateInTimezone(
  date: Date | number | string,
  timezone: string,
  locale: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
      ...options,
    }).format(d);
  } catch {
    return d.toLocaleString(locale);
  }
}

/**
 * TZ détectée du navigateur (fallback safe).
 */
export function getDetectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * TZ persistée user (localStorage). Fallback = TZ détectée.
 */
export function getStoredTimezone(): string {
  if (typeof window === 'undefined') return getDetectedTimezone();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {
    /* noop */
  }
  return getDetectedTimezone();
}

/**
 * Persiste choix TZ user.
 */
export function setStoredTimezone(timezone: string): void {
  if (typeof window === 'undefined') return;
  try {
    // Validation : on vérifie que la TZ est acceptée par Intl
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    window.localStorage.setItem(STORAGE_KEY, timezone);
  } catch {
    /* TZ invalide — silence */
  }
}

/**
 * Liste des timezones supportées. Utilise Intl.supportedValuesOf si dispo
 * (Chrome 99+, Safari 15.4+, Firefox 93+), sinon fallback liste courte
 * focalisée QC/CA/France/Espagne.
 */
export function listTimezones(): string[] {
  try {
    // @ts-ignore — supportedValuesOf existe à runtime mais pas tjs en TS
    if (typeof Intl.supportedValuesOf === 'function') {
      // @ts-ignore
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {
    /* noop */
  }
  // Fallback minimaliste (QC/CA + Europe)
  return [
    'America/Montreal',
    'America/Toronto',
    'America/Halifax',
    'America/Winnipeg',
    'America/Edmonton',
    'America/Vancouver',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'Europe/Paris',
    'Europe/London',
    'Europe/Madrid',
    'UTC',
  ];
}

/**
 * Liste regroupée par région (utile pour <Select> groupé).
 */
export function listTimezonesByRegion(): Record<string, string[]> {
  const all = listTimezones();
  const grouped: Record<string, string[]> = {};
  for (const tz of all) {
    const region = tz.split('/')[0] || 'Other';
    if (!grouped[region]) grouped[region] = [];
    grouped[region].push(tz);
  }
  return grouped;
}
