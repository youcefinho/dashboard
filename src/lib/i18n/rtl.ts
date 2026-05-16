// ── RTL detection stub — Sprint 48 M2.4 ────────────────────────────────────
// Préparation pour langues RTL (Arabic, Hebrew, Farsi, Urdu) — futur.
// Le hook `applyRtlDirection` synchronise <html dir="rtl|ltr"> avec la locale.
// Visuellement pas encore implémenté (CSS logical properties à venir),
// mais l'API est prête. À activer quand catalogues AR/HE seront ajoutés.

/** Locales RTL prises en charge dans le futur. */
const RTL_LOCALES = new Set<string>([
  'ar',     // Arabic
  'ar-SA',  // Arabic (Saudi Arabia)
  'ar-EG',  // Arabic (Egypt)
  'he',     // Hebrew
  'he-IL',  // Hebrew (Israel)
  'fa',     // Persian / Farsi
  'fa-IR',  // Persian (Iran)
  'ur',     // Urdu
  'ur-PK',  // Urdu (Pakistan)
]);

/**
 * Retourne 'rtl' si la locale est RTL, sinon 'ltr'.
 * Supporte les variantes (ex. ar-SA → 'rtl' via fallback sur préfixe).
 */
export function getDirection(locale: string): 'ltr' | 'rtl' {
  if (RTL_LOCALES.has(locale)) return 'rtl';
  // Fallback : si le préfixe matche (ex. 'ar-XX' → 'ar')
  const prefix = locale.split('-')[0];
  if (RTL_LOCALES.has(prefix)) return 'rtl';
  return 'ltr';
}

/**
 * Indique si la locale est RTL.
 */
export function isRtl(locale: string): boolean {
  return getDirection(locale) === 'rtl';
}

/**
 * Applique la direction sur <html> et l'attribut dir.
 * Appelé par setLocale() dans i18n.ts au changement de langue.
 */
export function applyRtlDirection(locale: string): void {
  if (typeof document === 'undefined') return;
  const dir = getDirection(locale);
  try {
    document.documentElement.dir = dir;
    document.documentElement.setAttribute('lang', locale);
  } catch {
    /* SSR ou DOM indispo — noop */
  }
}

/**
 * Liste des locales RTL (pour debug ou UI selector futur).
 */
export function getRtlLocales(): string[] {
  return Array.from(RTL_LOCALES);
}
