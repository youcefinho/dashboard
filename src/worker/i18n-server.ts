// ── i18n résolveur WORKER — Sprint MULTILANG-B Phase A ───────────────────────
// Résolveur de traduction PUR pour le runtime Cloudflare Worker (sortant).
//
// ⚠ POURQUOI ce fichier (et pas src/lib/i18n.ts) :
//   src/lib/i18n.ts → `t()` est NAVIGATEUR-COUPLÉ (window / localStorage /
//   navigator). L'importer dans le worker casserait (window indéfini) et
//   introduirait un état global de locale. Ici on écrit un résolveur PUR,
//   sans état, sans window : la locale est passée EXPLICITEMENT à chaque appel.
//   On RÉUTILISE les MÊMES catalogues plats (frCA/frFR/en/es) — zéro mini-dico
//   dupliqué.
//
// API : tLead(locale, key, vars?) — fallback chain : DICTS[locale] → en → key.
//   `locale` peut être null/undefined/invalide → on retombe sur le défaut
//   tenant fr-CA (= comportement "langue non renseignée").
//
// Usage v1 (honnête) : LIBELLÉS SYSTÈME-TRANSACTIONNELS sortants uniquement
//   (footer CASL, désabonnement, signatures, confirmations). PAS de traduction
//   auto du contenu marketing libre (v2). Branchements broadcast/documents/
//   reviews = Phase B (Manager-B).

import { frCA } from '../lib/i18n/fr-CA';
import { frFR } from '../lib/i18n/fr-FR';
import { en } from '../lib/i18n/en';
import { es } from '../lib/i18n/es';

export type LeadLocale = 'fr-CA' | 'fr-FR' | 'en' | 'es';

/** Locales supportées (whitelist partagée capture/usage). */
export const SUPPORTED_LEAD_LOCALES: LeadLocale[] = ['fr-CA', 'fr-FR', 'en', 'es'];

/** Défaut tenant quand la langue du contact n'est pas renseignée (NULL en base). */
export const DEFAULT_LEAD_LOCALE: LeadLocale = 'fr-CA';

/** Locale de fallback de traduction (chaîne fallback : locale → en → key). */
const FALLBACK_LOCALE: LeadLocale = 'en';

type LocaleDict = Record<string, string>;

const DICTS: Record<LeadLocale, LocaleDict> = {
  'fr-CA': frCA,
  'fr-FR': frFR,
  en,
  es,
};

/**
 * Normalise une valeur de langue arbitraire vers une locale supportée, sinon null.
 * - Match exact ('fr-CA' | 'fr-FR' | 'en' | 'es').
 * - Match préfixe : 'fr*' (hors fr-CA exact) → 'fr-FR' ; 'en*' → 'en' ; 'es*' → 'es'.
 * - Sinon (vide / hors-liste) → null (= repasser au défaut tenant).
 * Pur, sans état. Réutilisable par la capture ingestion ET le PATCH handler.
 */
export function normalizeLeadLocale(raw: unknown): LeadLocale | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Match exact (insensible casse sur la région courante des supportées).
  for (const loc of SUPPORTED_LEAD_LOCALES) {
    if (s.toLowerCase() === loc.toLowerCase()) return loc;
  }
  // Match préfixe.
  const prefix = s.split(/[-_]/)[0]!.toLowerCase();
  if (prefix === 'fr') return 'fr-FR'; // fr-CA déjà capté par le match exact ci-dessus
  if (prefix === 'en') return 'en';
  if (prefix === 'es') return 'es';
  return null;
}

/**
 * Résolveur de traduction pur pour le worker (sortant).
 * @param locale  langue cible (null/invalide → défaut tenant fr-CA).
 * @param key     clé i18n plate (ex: 'system.unsubscribe').
 * @param vars    interpolation {{var}} optionnelle.
 * @returns       chaîne traduite (fallback chain : locale → en → key brute).
 */
export function tLead(
  locale: LeadLocale | string | null | undefined,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const resolved = normalizeLeadLocale(locale) ?? DEFAULT_LEAD_LOCALE;
  const primary = DICTS[resolved];
  const fallback = DICTS[FALLBACK_LOCALE];
  let str = primary?.[key] ?? fallback?.[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v));
    }
  }
  return str;
}
