// ── i18n / datetime — Sprint 48 M3.2 ────────────────────────
// Wrapper sur Intl.DateTimeFormat + Intl.RelativeTimeFormat.
// Zero-dep, opt-in, back-compat 100%.
//
// Usage :
//   formatDate(Date.now(), 'fr-CA')                   → "14 mai 2026"
//   formatDate(Date.now(), 'en-CA')                   → "May 14, 2026"
//   formatDate(Date.now(), 'es')                      → "14 de mayo de 2026"
//   formatRelativeTime(Date.now() - 120_000, 'fr-CA') → "il y a 2 minutes"
//   formatRelativeTime(Date.now() - 120_000, 'en-CA') → "2 minutes ago"
//
// Pour les options custom (timestyle, dateStyle, weekday, etc.), passer
// le 3e paramètre options selon l'API Intl native.

export function formatDate(
  date: Date | number | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d =
    typeof date === 'string'
      ? new Date(date.endsWith('Z') ? date : date + 'Z')
      : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(
      locale,
      options ?? { year: 'numeric', month: 'long', day: 'numeric' }
    ).format(d);
  } catch {
    return d.toLocaleDateString(locale);
  }
}

export function formatDateTime(
  date: Date | number | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions
): string {
  return formatDate(
    date,
    locale,
    options ?? {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  );
}

export function formatTime(
  date: Date | number | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions
): string {
  return formatDate(
    date,
    locale,
    options ?? { hour: '2-digit', minute: '2-digit' }
  );
}

export function formatRelativeTime(
  date: Date | number | string,
  locale: string
): string {
  const ts = typeof date === 'string' ? new Date(date).getTime() : new Date(date).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = (Date.now() - ts) / 1000; // en secondes
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  } catch {
    // Fallback ultra-simple si runtime trop vieux
    return formatDate(ts, locale);
  }
  if (Math.abs(diff) < 60) return rtf.format(-Math.floor(diff), 'second');
  if (Math.abs(diff) < 3600) return rtf.format(-Math.floor(diff / 60), 'minute');
  if (Math.abs(diff) < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour');
  if (Math.abs(diff) < 2592000) return rtf.format(-Math.floor(diff / 86400), 'day');
  if (Math.abs(diff) < 31536000)
    return rtf.format(-Math.floor(diff / 2592000), 'month');
  return rtf.format(-Math.floor(diff / 31536000), 'year');
}

/**
 * Format raccourci "short" : "14 mai" / "May 14" / "14 may".
 */
export function formatDateShort(
  date: Date | number | string,
  locale: string
): string {
  return formatDate(date, locale, { day: 'numeric', month: 'short' });
}
