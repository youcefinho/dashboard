// ── i18n maison léger — Sprint 35 + extension Sprint 48 M2 ────────────────────
// Helper minimal sans dépendance externe (pas i18next).
// API : t(key, vars?) avec fallback chain : locale active → 'en' → raw key.
// Stockage : localStorage.intralys_locale. Default : 'fr-CA'.
//
// Sprint 48 — extension :
//   - 4 langues : fr-CA (default), fr-FR, en, es
//   - Auto-detect navigator.language au first visit
//   - Direction RTL prep (ar/he/fa/ur stub via lib/i18n/rtl)
//   - <html lang="..."> + dir="..." sync auto au setLocale()
//   - 100% back-compat avec API Sprint 35 (getLocale/setLocale/t/availableLocales)
//
// Pourquoi maison plutôt qu'i18next :
//   - Bundle économisé (~15kb gzipped)
//   - Pas de provider React requis
//   - Live-reactive optionnel via custom event 'intralys:locale-change'

import { frCA } from './i18n/fr-CA';
import { frFR } from './i18n/fr-FR';
import { en } from './i18n/en';
import { es } from './i18n/es';
import { applyRtlDirection } from './i18n/rtl';

type LocaleDict = Record<string, string>;

export type Locale = 'fr-CA' | 'fr-FR' | 'en' | 'es';

const DICTIONARIES: Record<Locale, LocaleDict> = {
  'fr-CA': frCA,
  'fr-FR': frFR,
  en,
  es,
};

const STORAGE_KEY = 'intralys_locale';
const DEFAULT_LOCALE: Locale = 'fr-CA';
const FALLBACK_LOCALE: Locale = 'en';
const LOCALE_CHANGE_EVENT = 'intralys:locale-change';

/**
 * Détecte la locale préférée du navigateur et map vers une locale supportée.
 * Fallback : fr-CA si rien ne matche.
 */
function detectNavigatorLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const langs = navigator.languages || [navigator.language || ''];
  for (const raw of langs) {
    if (!raw) continue;
    const norm = raw.trim();
    // Match exact (fr-CA / fr-FR / en / es)
    if (norm in DICTIONARIES) return norm as Locale;
    // Match préfixe
    const prefix = norm.split('-')[0].toLowerCase();
    if (prefix === 'fr') {
      // fr-XX (France etc.) → fr-FR ; fr-CA expressément → fr-CA via exact match au-dessus
      return 'fr-FR';
    }
    if (prefix === 'en') return 'en';
    if (prefix === 'es') return 'es';
  }
  return DEFAULT_LOCALE;
}

let _currentLocale: Locale = DEFAULT_LOCALE;

// Init au chargement du module — lit localStorage si dispo, sinon auto-detect
if (typeof window !== 'undefined') {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && stored in DICTIONARIES) {
      _currentLocale = stored as Locale;
    } else {
      // First visit → auto-detect
      _currentLocale = detectNavigatorLocale();
      // Persist tout de suite pour stabilité multi-onglets
      try {
        window.localStorage.setItem(STORAGE_KEY, _currentLocale);
      } catch {
        /* noop */
      }
    }
  } catch {
    /* localStorage indispo (SSR, mode privé) — on garde default */
  }

  // Sync <html lang> + dir au boot
  try {
    applyRtlDirection(_currentLocale);
  } catch {
    /* noop */
  }
}

/**
 * Retourne la locale courante.
 */
export function getLocale(): Locale {
  return _currentLocale;
}

/**
 * Change la locale active. Persiste dans localStorage, sync <html lang/dir>,
 * et dispatch un custom event 'intralys:locale-change' pour les composants
 * qui souhaitent ré-render sans full reload.
 *
 * MVP : pour la plupart des composants utilisant `t()` directement,
 * un window.location.reload() est plus simple pour repaint complet.
 * On l'expose via `reloadAfterChange` (true par défaut).
 */
export function setLocale(locale: Locale, options?: { reloadAfterChange?: boolean }): void {
  if (!(locale in DICTIONARIES)) return;
  if (locale === _currentLocale) return;
  _currentLocale = locale;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* noop */
    }
    try {
      applyRtlDirection(locale);
    } catch {
      /* noop */
    }
    // Dispatch event pour subscribers React (useLocale hook futur)
    try {
      window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: locale }));
    } catch {
      /* noop */
    }
    // Reload par défaut (simple, garantit que tous les t() repassent)
    if (options?.reloadAfterChange !== false) {
      window.location.reload();
    }
  }
}

/**
 * Traduit une clé avec fallback chain : locale courante → 'en' → raw key.
 * Supporte interpolation {{var}}.
 *
 * @example
 *   t('share.copied')                  // → "Lien copié" (fr-CA)
 *   t('auth.welcome', { name: 'Joe' }) // → "Bienvenue Joe" si dict contient "Bienvenue {{name}}"
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const primary = DICTIONARIES[_currentLocale];
  const fallback = DICTIONARIES[FALLBACK_LOCALE];
  let str = primary?.[key] ?? fallback?.[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v));
    }
  }
  return str;
}

/**
 * Liste des locales disponibles (pour UI selector).
 */
export function availableLocales(): Locale[] {
  return Object.keys(DICTIONARIES) as Locale[];
}

/**
 * Liste des locales avec leur label affichable (pour Settings selector).
 */
export function availableLocaleOptions(): Array<{ value: Locale; label: string; native: string }> {
  return [
    { value: 'fr-CA', label: 'French (Quebec)', native: 'Français (Québec)' },
    { value: 'fr-FR', label: 'French (France)', native: 'Français (France)' },
    { value: 'en', label: 'English', native: 'English' },
    { value: 'es', label: 'Spanish', native: 'Español' },
  ];
}

/**
 * S'abonne aux changements de locale. Utile pour un hook React useLocale().
 * Retourne une fonction unsubscribe.
 */
export function onLocaleChange(handler: (locale: Locale) => void): () => void {
  if (typeof window === 'undefined') return () => { /* noop */ };
  const listener = (e: Event) => {
    const ce = e as CustomEvent<Locale>;
    handler(ce.detail);
  };
  window.addEventListener(LOCALE_CHANGE_EVENT, listener);
  return () => window.removeEventListener(LOCALE_CHANGE_EVENT, listener);
}
