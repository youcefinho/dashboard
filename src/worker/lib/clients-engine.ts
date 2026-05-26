// ── clients-engine.ts — Helpers PURS multi-tenant clients admin (P0-7) ─────
//
// Contrat ADDITIF — 100% : aucun import depuis clients-admin.ts existant,
// aucun remplacement de logique vivante. Helpers PURS (zéro I/O) pour :
//   - Validation client input (name, slug, country, modules)
//   - Validation slug kebab-case 3-50 chars
//   - Préparation provisioning client (clientRow + settings + pipeline)
//   - Validation activation/désactivation module (dépendances)

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const CLIENT_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_NAME: 'MISSING_NAME',
  NAME_TOO_LONG: 'NAME_TOO_LONG',
  MISSING_SLUG: 'MISSING_SLUG',
  INVALID_SLUG: 'INVALID_SLUG',
  SLUG_TAKEN: 'SLUG_TAKEN',
  INVALID_COUNTRY: 'INVALID_COUNTRY',
  INVALID_MODULE: 'INVALID_MODULE',
  MODULE_ALREADY_ACTIVE: 'MODULE_ALREADY_ACTIVE',
  MODULE_NOT_ACTIVE: 'MODULE_NOT_ACTIVE',
  MODULE_DEPENDENCY: 'MODULE_DEPENDENCY',
  MODULE_CONFLICT: 'MODULE_CONFLICT',
  CLIENT_NOT_FOUND: 'CLIENT_NOT_FOUND',
  CLIENT_INACTIVE: 'CLIENT_INACTIVE',
  TENANT_FORBIDDEN: 'TENANT_FORBIDDEN',
  INVALID_HOSTNAME: 'INVALID_HOSTNAME',
} as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Modules + pays valides
// ════════════════════════════════════════════════════════════════════════════

/** Modules frozen list — calque src/lib/modules.ts SaaS contrat. */
export const VALID_MODULES = [
  'crm',
  'leads',
  'pipeline',
  'invoicing',
  'ecommerce',
  'lms',
  'community',
  'booking',
  'calendar',
  'forms',
  'workflows',
  'reports',
  'team',
  'integrations',
] as const;
export type Module = (typeof VALID_MODULES)[number];

/** Modules core (toujours actifs, non désactivables). */
export const CORE_MODULES: ReadonlySet<Module> = new Set(['crm', 'leads', 'pipeline']);

/**
 * Dépendances entre modules :
 *   - ecommerce  → requiert invoicing
 *   - lms        → requiert community (optionnel mais cohérent)
 *   - workflows  → requiert leads (déjà core)
 */
export const MODULE_DEPENDENCIES: Readonly<Record<string, readonly Module[]>> = Object.freeze({
  ecommerce: ['invoicing'],
  // Pas de hard dep pour lms/community — laissés indépendants pour permettre
  // les setups community-only sans LMS.
});

/** Pays ISO-3166-1 alpha-2 supportés (étendre selon besoin). */
export const VALID_COUNTRIES = [
  'CA', 'US', 'FR', 'GB', 'DE', 'ES', 'IT', 'BE', 'CH', 'LU', 'MA', 'TN', 'DZ', 'SN', 'CI',
] as const;
export type Country = (typeof VALID_COUNTRIES)[number];

// ════════════════════════════════════════════════════════════════════════════
// Validation slug kebab-case
// ════════════════════════════════════════════════════════════════════════════

const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 50;
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** True si slug match kebab-case 3-50 chars (lowercase alphanum + tirets internes). */
export function validateSlug(slug: unknown): boolean {
  if (typeof slug !== 'string') return false;
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) return false;
  return SLUG_REGEX.test(slug);
}

/** Génère un slug kebab-case depuis un nom libre. */
export function generateSlugFromName(name: string): string {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH);
}

// ════════════════════════════════════════════════════════════════════════════
// Validation hostname (calque clients-admin.ts:isValidHostname)
// ════════════════════════════════════════════════════════════════════════════

export function validateHostname(hostname: unknown): boolean {
  if (typeof hostname !== 'string') return false;
  const h = hostname.trim().toLowerCase();
  if (!h || h.length > 253) return false;
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(h);
}

// ════════════════════════════════════════════════════════════════════════════
// Validation input client (POST /api/clients)
// ════════════════════════════════════════════════════════════════════════════

export interface ClientInputDraft {
  name?: unknown;
  slug?: unknown;
  email?: unknown;
  phone?: unknown;
  site_url?: unknown;
  city?: unknown;
  country?: unknown;
  modules?: unknown;
  agency_id?: unknown;
  primary_color?: unknown;
  accent_color?: unknown;
}

export interface ClientValidationResult {
  ok: boolean;
  error?: string;
  code?: ClientErrorCode;
  field?: string;
}

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 120;
const EMAIL_MAX_LENGTH = 254;

/** Valide un payload de création/édition client. */
export function validateClientInput(
  input: ClientInputDraft,
): ClientValidationResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Input invalide', code: 'INVALID_INPUT' };
  }
  // name requis
  if (input.name == null || typeof input.name !== 'string' || !input.name.trim()) {
    return {
      ok: false,
      error: 'Nom requis',
      code: 'MISSING_NAME',
      field: 'name',
    };
  }
  const name = input.name.trim();
  if (name.length < NAME_MIN_LENGTH) {
    return { ok: false, error: 'Nom trop court', code: 'MISSING_NAME', field: 'name' };
  }
  if (name.length > NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: 'Nom trop long',
      code: 'NAME_TOO_LONG',
      field: 'name',
    };
  }
  // slug optional (auto-generated si absent), mais si fourni doit être valide
  if (input.slug != null && input.slug !== '') {
    if (!validateSlug(input.slug)) {
      return {
        ok: false,
        error: 'Slug invalide (3-50 chars, kebab-case)',
        code: 'INVALID_SLUG',
        field: 'slug',
      };
    }
  }
  // country optional, si fourni doit être ISO-3166-1 alpha-2 supporté
  if (input.country != null && input.country !== '') {
    if (
      typeof input.country !== 'string' ||
      !(VALID_COUNTRIES as readonly string[]).includes(input.country.toUpperCase())
    ) {
      return {
        ok: false,
        error: 'Pays non supporté',
        code: 'INVALID_COUNTRY',
        field: 'country',
      };
    }
  }
  // email optional, si fourni doit être RFC simplifié
  if (input.email != null && input.email !== '') {
    if (typeof input.email !== 'string' || input.email.length > EMAIL_MAX_LENGTH) {
      return { ok: false, error: 'Email invalide', code: 'INVALID_INPUT', field: 'email' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      return { ok: false, error: 'Email invalide', code: 'INVALID_INPUT', field: 'email' };
    }
  }
  // site_url optional, si fourni doit ressembler à un hostname/URL
  if (input.site_url != null && input.site_url !== '') {
    if (typeof input.site_url !== 'string') {
      return { ok: false, error: 'URL invalide', code: 'INVALID_INPUT', field: 'site_url' };
    }
    // Permissif : on accepte http(s)://… ou hostname brut.
    const u = input.site_url.trim().toLowerCase();
    const isUrl = u.startsWith('http://') || u.startsWith('https://') || validateHostname(u);
    if (!isUrl) {
      return { ok: false, error: 'URL invalide', code: 'INVALID_INPUT', field: 'site_url' };
    }
  }
  // modules optional, si fourni array de Module valides
  if (input.modules != null) {
    if (!Array.isArray(input.modules)) {
      return {
        ok: false,
        error: 'Modules doit être un array',
        code: 'INVALID_MODULE',
        field: 'modules',
      };
    }
    for (const m of input.modules) {
      if (typeof m !== 'string' || !(VALID_MODULES as readonly string[]).includes(m)) {
        return {
          ok: false,
          error: `Module inconnu: ${m}`,
          code: 'INVALID_MODULE',
          field: 'modules',
        };
      }
    }
  }
  // Couleurs branding optional, hex 6 chars
  for (const colorField of ['primary_color', 'accent_color'] as const) {
    const val = (input as Record<string, unknown>)[colorField];
    if (val != null && val !== '') {
      if (typeof val !== 'string' || !/^#?[0-9a-f]{6}$/i.test(val)) {
        return {
          ok: false,
          error: 'Couleur invalide (hex 6 chars)',
          code: 'INVALID_INPUT',
          field: colorField,
        };
      }
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Provisioning payload — prépare les inserts D1 sans I/O
// ════════════════════════════════════════════════════════════════════════════

export interface ClientRowPayload {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  site_url: string | null;
  city: string | null;
  country: string | null;
  agency_id: string | null;
  primary_color: string | null;
  accent_color: string | null;
  is_active: number;
}

export interface ClientSettingsPayload {
  client_id: string;
  language: string;
  timezone: string;
  currency: string;
}

export interface ClientPipelinePayload {
  client_id: string;
  stages: ReadonlyArray<{ key: string; label: string; order: number }>;
}

export interface ClientProvisionPayload {
  clientRow: ClientRowPayload;
  defaultSettings: ClientSettingsPayload;
  defaultPipeline: ClientPipelinePayload;
  defaultModules: ReadonlyArray<Module>;
}

const DEFAULT_PIPELINE_STAGES = [
  { key: 'new', label: 'Nouveau', order: 0 },
  { key: 'qualified', label: 'Qualifié', order: 1 },
  { key: 'proposal', label: 'Proposition', order: 2 },
  { key: 'won', label: 'Gagné', order: 3 },
  { key: 'lost', label: 'Perdu', order: 4 },
] as const;

/** Normalise et nettoie une valeur string (trim + null si vide). */
function s(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

/** Normalise couleur hex avec # prefix obligatoire. */
function normalizeColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t.toLowerCase()}`;
  return null;
}

/**
 * Prépare le payload d'INSERT D1 pour un nouveau client (multi-tenant).
 * PURE : aucun I/O — le caller fait les 10 INSERT dans l'ordre.
 *
 * @param input Input validé (par validateClientInput).
 * @param id ID assigné (UUID, fourni par caller — pure-friendly).
 * @param agencyId Tenant agency_id (null en mode legacy/standalone).
 */
export function provisionClientPayload(
  input: ClientInputDraft,
  id: string,
  agencyId: string | null = null,
): ClientProvisionPayload {
  const nameStr = typeof input.name === 'string' ? input.name.trim() : '';
  const slugRaw = typeof input.slug === 'string' && input.slug.trim() ? input.slug.trim() : '';
  const slug = slugRaw || generateSlugFromName(nameStr);
  const country = typeof input.country === 'string' ? input.country.toUpperCase() : null;

  const modulesRaw = Array.isArray(input.modules)
    ? (input.modules.filter(
        (m): m is Module =>
          typeof m === 'string' && (VALID_MODULES as readonly string[]).includes(m),
      ) as Module[])
    : [];
  // Toujours inclure les core modules
  const modules: Module[] = Array.from(new Set([...CORE_MODULES, ...modulesRaw]));

  return {
    clientRow: {
      id,
      name: nameStr,
      slug,
      email: s(input.email),
      phone: s(input.phone),
      site_url: s(input.site_url),
      city: s(input.city),
      country: country && (VALID_COUNTRIES as readonly string[]).includes(country) ? country : null,
      agency_id: agencyId,
      primary_color: normalizeColor(input.primary_color),
      accent_color: normalizeColor(input.accent_color),
      is_active: 1,
    },
    defaultSettings: {
      client_id: id,
      language: country === 'CA' || country === 'FR' || country === 'BE' || country === 'LU' || country === 'CH'
        ? 'fr-CA'
        : 'en-US',
      timezone:
        country === 'CA'
          ? 'America/Toronto'
          : country === 'FR' || country === 'BE' || country === 'LU' || country === 'CH'
            ? 'Europe/Paris'
            : 'UTC',
      currency: country === 'CA' ? 'CAD' : country === 'US' ? 'USD' : 'EUR',
    },
    defaultPipeline: {
      client_id: id,
      stages: DEFAULT_PIPELINE_STAGES,
    },
    defaultModules: modules,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Activation module — vérifie deps + conflicts
// ════════════════════════════════════════════════════════════════════════════

export interface ModuleActivationResult {
  ok: boolean;
  reason?: string;
  /** Modules supplémentaires à activer pour satisfaire les deps. */
  alsoActivate?: ReadonlyArray<Module>;
}

/**
 * Valide l'activation d'un module sur un client donné ses modules actuels.
 *
 * Rules :
 *   - newModule doit être ∈ VALID_MODULES
 *   - Si déjà actif → reject (already_active)
 *   - Si dépendance non satisfaite → alsoActivate hint (caller décide d'activer en cascade ou pas)
 *   - Core modules (crm/leads/pipeline) toujours OK (idempotent activate).
 */
export function validateModuleActivation(
  currentModules: ReadonlyArray<string>,
  newModule: string,
): ModuleActivationResult {
  if (!(VALID_MODULES as readonly string[]).includes(newModule)) {
    return { ok: false, reason: 'invalid_module' };
  }
  if (currentModules.includes(newModule)) {
    if (CORE_MODULES.has(newModule as Module)) {
      // Idempotent pour core.
      return { ok: true };
    }
    return { ok: false, reason: 'already_active' };
  }
  const deps = MODULE_DEPENDENCIES[newModule] || [];
  const missingDeps = deps.filter((d) => !currentModules.includes(d));
  if (missingDeps.length > 0) {
    return { ok: false, reason: 'missing_dependency', alsoActivate: missingDeps };
  }
  return { ok: true };
}

/**
 * Valide la désactivation d'un module.
 *   - Core module → reject.
 *   - Module pas actif → reject (not_active).
 *   - Module dont d'autres modules dépendent encore → reject (dependency_in_use).
 */
export function validateModuleDeactivation(
  currentModules: ReadonlyArray<string>,
  moduleToRemove: string,
): ModuleActivationResult {
  if (!(VALID_MODULES as readonly string[]).includes(moduleToRemove)) {
    return { ok: false, reason: 'invalid_module' };
  }
  if (CORE_MODULES.has(moduleToRemove as Module)) {
    return { ok: false, reason: 'core_module' };
  }
  if (!currentModules.includes(moduleToRemove)) {
    return { ok: false, reason: 'not_active' };
  }
  // Check reverse deps
  for (const [mod, deps] of Object.entries(MODULE_DEPENDENCIES)) {
    if (currentModules.includes(mod) && (deps as readonly string[]).includes(moduleToRemove)) {
      return { ok: false, reason: 'dependency_in_use' };
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Tenant scope helper (calque assertClientInTenant clients-admin.ts)
// ════════════════════════════════════════════════════════════════════════════

export interface TenantScopeAuth {
  tenant?: { agencyId?: string | null; accessibleClientIds?: ReadonlyArray<string> };
}

/**
 * True si l'auth est en mode legacy/mono-tenant.
 * Calque exact isLegacy clients-admin.ts.
 */
export function isLegacyTenant(auth?: TenantScopeAuth): boolean {
  return !auth?.tenant || auth.tenant.agencyId == null;
}

/**
 * True si le clientId est dans le scope tenant de auth.
 * En mode legacy → toujours true (pas de scope).
 * En mode agence → clientId doit être ∈ accessibleClientIds.
 *
 * NB : ne vérifie pas clients.agency_id en DB (helper pur). Le caller
 * doit appeler en complément la requête `SELECT agency_id FROM clients`
 * via assertClientInTenant pour le double-check post-DB.
 */
export function isClientInTenantScope(
  auth: TenantScopeAuth | undefined,
  clientId: string,
): boolean {
  if (isLegacyTenant(auth)) return true;
  const accessible = auth?.tenant?.accessibleClientIds || [];
  return accessible.includes(clientId);
}
