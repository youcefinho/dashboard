// ── cookies-consent-engine.ts — Helpers PURS cookie consent banner (P2-1) ──
//
// 100% ADDITIF — complète `cookies-consent.ts` (handlers DB). Helpers PURS
// (zéro I/O) pour :
//   - Validation des inputs banner (4 categories : necessary|preferences|analytics|marketing)
//   - Encodage compact des consentements (computeConsentString / parseConsentString)
//   - Détection du besoin de rafficher le banner (requiresBannerDisplay)
//   - Validation de version (semver)
//
// COMPATIBILITÉ : `cookies-consent.ts` disque utilise `essential` (forcé true).
// On expose `necessary` comme alias canonique IAB TCF + `essential` (legacy)
// — tous deux forcés true. Voir VALID_COOKIE_CATEGORIES.

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const COOKIES_CONSENT_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_CATEGORIES: 'INVALID_CATEGORIES',
  MISSING_CATEGORY: 'MISSING_CATEGORY',
  INVALID_CATEGORY_TYPE: 'INVALID_CATEGORY_TYPE',
  UNKNOWN_CATEGORY: 'UNKNOWN_CATEGORY',
  NECESSARY_MUST_BE_TRUE: 'NECESSARY_MUST_BE_TRUE',
  INVALID_VERSION: 'INVALID_VERSION',
  INVALID_CONSENT_STRING: 'INVALID_CONSENT_STRING',
} as const);

export type CookiesConsentErrorCode =
  (typeof COOKIES_CONSENT_ERROR_CODES)[keyof typeof COOKIES_CONSENT_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Constantes
// ════════════════════════════════════════════════════════════════════════════

// 4 catégories canoniques (alignées IAB TCF v2). `essential` est l'alias
// legacy utilisé dans `cookies-consent.ts` disque. Les 2 (`necessary`,
// `essential`) sont forcés `true` à la validation.
export const VALID_COOKIE_CATEGORIES = Object.freeze([
  'necessary',
  'essential', // alias legacy (cookies-consent.ts)
  'preferences',
  'analytics',
  'marketing',
] as const);
export type CookieCategory = (typeof VALID_COOKIE_CATEGORIES)[number];

const COOKIE_CAT_SET: ReadonlySet<string> = new Set<string>(VALID_COOKIE_CATEGORIES);

// Catégories obligatoirement true (Loi 25 / RGPD : strictly necessary).
const REQUIRED_TRUE_CATEGORIES: ReadonlySet<string> = new Set(['necessary', 'essential']);

// Catégories optionnelles (toggle libre user).
export const OPTIONAL_COOKIE_CATEGORIES = Object.freeze([
  'preferences',
  'analytics',
  'marketing',
] as const);

// Version par défaut de la policy.
export const DEFAULT_POLICY_VERSION = '1.0';
export const POLICY_VERSION_MAX_LEN = 20;
export const ANONYMOUS_ID_MAX_LEN = 100;
export const CONSENT_URL_MAX_LEN = 500;

// Délai par défaut avant de RE-demander le consentement (180 jours).
export const CONSENT_REFRESH_DAYS_DEFAULT = 180;
export const CONSENT_REFRESH_MS_DEFAULT =
  CONSENT_REFRESH_DAYS_DEFAULT * 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════════════
// Semver light (X.Y.Z ou X.Y)
// ════════════════════════════════════════════════════════════════════════════

// On accepte semver basique : MAJOR.MINOR (.PATCH optionnel). Pas de pre-release.
const SEMVER_RE = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

export function validateBannerVersion(version: unknown): boolean {
  if (typeof version !== 'string' || version.length === 0) return false;
  if (version.length > POLICY_VERSION_MAX_LEN) return false;
  return SEMVER_RE.test(version);
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): ParsedVersion | null {
  const m = SEMVER_RE.exec(version);
  if (!m) return null;
  return {
    major: parseInt(m[1] || '0', 10),
    minor: parseInt(m[2] || '0', 10),
    patch: parseInt(m[3] || '0', 10),
  };
}

/**
 * Compare 2 versions semver. Retourne :
 *   - négatif si a < b
 *   - 0 si égales
 *   - positif si a > b
 *   - NaN si une version est invalide
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return NaN;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

// ════════════════════════════════════════════════════════════════════════════
// validateConsentBannerInput
// ════════════════════════════════════════════════════════════════════════════

export interface ConsentBannerInput {
  categories?: unknown;
  policy_version?: unknown;
  anonymous_id?: unknown;
  url?: unknown;
}

export interface ConsentBannerValidation {
  ok: boolean;
  error?: CookiesConsentErrorCode;
  field?: string;
}

export function validateConsentBannerInput(
  input: ConsentBannerInput,
): ConsentBannerValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: COOKIES_CONSENT_ERROR_CODES.INVALID_INPUT };
  }
  const cats = input.categories;
  if (!cats || typeof cats !== 'object' || Array.isArray(cats)) {
    return {
      ok: false,
      error: COOKIES_CONSENT_ERROR_CODES.INVALID_CATEGORIES,
      field: 'categories',
    };
  }
  const catObj = cats as Record<string, unknown>;
  // Vérifie que chaque key est connue + type boolean.
  for (const key of Object.keys(catObj)) {
    if (!COOKIE_CAT_SET.has(key)) {
      return {
        ok: false,
        error: COOKIES_CONSENT_ERROR_CODES.UNKNOWN_CATEGORY,
        field: key,
      };
    }
    const v = catObj[key];
    if (typeof v !== 'boolean') {
      return {
        ok: false,
        error: COOKIES_CONSENT_ERROR_CODES.INVALID_CATEGORY_TYPE,
        field: key,
      };
    }
    if (REQUIRED_TRUE_CATEGORIES.has(key) && v !== true) {
      return {
        ok: false,
        error: COOKIES_CONSENT_ERROR_CODES.NECESSARY_MUST_BE_TRUE,
        field: key,
      };
    }
  }
  // Au moins UNE des catégories required doit être présente.
  const hasNecessary = 'necessary' in catObj || 'essential' in catObj;
  if (!hasNecessary) {
    return {
      ok: false,
      error: COOKIES_CONSENT_ERROR_CODES.MISSING_CATEGORY,
      field: 'necessary',
    };
  }
  // Version (optionnelle — default DEFAULT_POLICY_VERSION).
  if (input.policy_version !== undefined && input.policy_version !== null) {
    if (!validateBannerVersion(input.policy_version)) {
      return {
        ok: false,
        error: COOKIES_CONSENT_ERROR_CODES.INVALID_VERSION,
        field: 'policy_version',
      };
    }
  }
  // anonymous_id (optionnel — string non vide).
  if (input.anonymous_id !== undefined) {
    if (
      typeof input.anonymous_id !== 'string' ||
      input.anonymous_id.length === 0 ||
      input.anonymous_id.length > ANONYMOUS_ID_MAX_LEN
    ) {
      return {
        ok: false,
        error: COOKIES_CONSENT_ERROR_CODES.INVALID_INPUT,
        field: 'anonymous_id',
      };
    }
  }
  // url (optionnel).
  if (input.url !== undefined) {
    if (typeof input.url !== 'string' || input.url.length > CONSENT_URL_MAX_LEN) {
      return {
        ok: false,
        error: COOKIES_CONSENT_ERROR_CODES.INVALID_INPUT,
        field: 'url',
      };
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// computeConsentString / parseConsentString — compact representation
// ════════════════════════════════════════════════════════════════════════════
//
// Format : `v1:N1P0A0M1` (v1 = format version, suivi de paires LETTER+0/1).
//   N = necessary (toujours 1)
//   P = preferences
//   A = analytics
//   M = marketing
// Format compact (12-13 caractères), facile à logger / sérialiser cookie.

const LETTER_TO_CATEGORY: ReadonlyMap<string, string> = new Map([
  ['N', 'necessary'],
  ['P', 'preferences'],
  ['A', 'analytics'],
  ['M', 'marketing'],
]);

const CONSENT_STRING_FORMAT_VERSION = 'v1';

export function computeConsentString(
  consents: Record<string, boolean | undefined> | null | undefined,
): string {
  const safe = consents && typeof consents === 'object' ? consents : {};
  // necessary toujours true (Loi 25).
  const parts: string[] = [];
  // Ordre canonique : N, P, A, M.
  parts.push('N1');
  parts.push(`P${safe.preferences ? 1 : 0}`);
  parts.push(`A${safe.analytics ? 1 : 0}`);
  parts.push(`M${safe.marketing ? 1 : 0}`);
  return `${CONSENT_STRING_FORMAT_VERSION}:${parts.join('')}`;
}

export interface ParsedConsents {
  necessary: boolean;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
}

const ALL_FALSE_CONSENTS: ParsedConsents = Object.freeze({
  necessary: true,
  preferences: false,
  analytics: false,
  marketing: false,
});

export function parseConsentString(str: unknown): ParsedConsents {
  if (typeof str !== 'string' || str.length === 0) {
    return { ...ALL_FALSE_CONSENTS };
  }
  // Format attendu : `v1:N1P0A0M1`
  const m = /^v(\d+):([NPAM][01]){2,4}$/.exec(str);
  if (!m) return { ...ALL_FALSE_CONSENTS };
  const payload = str.slice(str.indexOf(':') + 1);
  const out: ParsedConsents = { ...ALL_FALSE_CONSENTS };
  // Scan paires LETTER+0/1.
  for (let i = 0; i < payload.length; i += 2) {
    const letter = payload[i];
    const val = payload[i + 1];
    if (!letter || (val !== '0' && val !== '1')) continue;
    const cat = LETTER_TO_CATEGORY.get(letter);
    if (!cat) continue;
    if (cat === 'necessary') {
      // Forcé true.
      out.necessary = true;
    } else if (cat === 'preferences') {
      out.preferences = val === '1';
    } else if (cat === 'analytics') {
      out.analytics = val === '1';
    } else if (cat === 'marketing') {
      out.marketing = val === '1';
    }
  }
  return out;
}

// Utility — alias retour clé→bool pour brief.
export function consentStringToMap(str: string): Record<string, boolean> {
  const p = parseConsentString(str);
  return {
    necessary: p.necessary,
    preferences: p.preferences,
    analytics: p.analytics,
    marketing: p.marketing,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// requiresBannerDisplay
// ════════════════════════════════════════════════════════════════════════════
//
// Retourne true si on doit RE-afficher le banner cookie. Critères :
//   1. Aucun consentement enregistré (lastShownAt null/undefined).
//   2. Version stockée < currentVersion (policy a changé).
//   3. Délai écoulé (180 jours par défaut, configurable).
//
// `now` injecté pour testability. `refreshMs` configurable (defaut 180j).

export interface RequiresBannerOpts {
  /** Max age before re-asking (defaults to 180 days). */
  refreshMs?: number;
  /** Now timestamp (defaults to Date.now()) — for testability. */
  now?: number;
}

export function requiresBannerDisplay(
  lastShownAt: string | number | Date | null | undefined,
  storedVersion: string | null | undefined,
  currentVersion: string,
  opts: RequiresBannerOpts = {},
): boolean {
  // Jamais affiché.
  if (lastShownAt == null) return true;
  // Parse lastShownAt → ms.
  let lastMs: number;
  if (lastShownAt instanceof Date) {
    lastMs = lastShownAt.getTime();
  } else if (typeof lastShownAt === 'number') {
    lastMs = lastShownAt < 1e12 ? lastShownAt * 1000 : lastShownAt;
  } else if (typeof lastShownAt === 'string') {
    const parsed = Date.parse(lastShownAt);
    if (!Number.isFinite(parsed)) return true;
    lastMs = parsed;
  } else {
    return true;
  }
  if (!Number.isFinite(lastMs)) return true;

  // Version : si stored < current → re-afficher.
  if (storedVersion && validateBannerVersion(currentVersion)) {
    if (validateBannerVersion(storedVersion)) {
      const cmp = compareVersions(storedVersion, currentVersion);
      if (Number.isFinite(cmp) && cmp < 0) return true;
    } else {
      // Stored version invalide → re-afficher (safety).
      return true;
    }
  }

  // Délai écoulé.
  const now = opts.now ?? Date.now();
  const refreshMs = opts.refreshMs ?? CONSENT_REFRESH_MS_DEFAULT;
  if (now - lastMs > refreshMs) return true;
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// normalizeCategoriesInput — force essential/necessary à true
// ════════════════════════════════════════════════════════════════════════════
//
// Helper de normalisation : applique les règles Loi 25 (necessary/essential
// forcés true) et remplit les 4 catégories canoniques même si input partiel.

export function normalizeCategoriesInput(
  input: Record<string, unknown> | null | undefined,
): ParsedConsents {
  const safe = input && typeof input === 'object' ? input : {};
  return {
    necessary: true,
    preferences: !!safe.preferences,
    analytics: !!safe.analytics,
    marketing: !!safe.marketing,
  };
}
