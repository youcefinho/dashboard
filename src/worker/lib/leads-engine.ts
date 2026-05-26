// ── lib/leads-engine.ts — Core CRM Sprint 1 (renforcement leads.ts) ──────
//
// Helpers PURS (zéro I/O, zéro D1, zéro fetch) extraits de leads.ts pour
// rendre la validation/normalisation des leads testable indépendamment du
// runtime Worker. Tout est additif : leads.ts continue à fonctionner avec
// son comportement actuel, ces helpers peuvent être adoptés progressivement
// pour renforcer la validation au choke-point (handleCreateLead, ingestLead,
// bulk operations).
//
// CONTENU :
//   - LEAD_ERROR_CODES                  (codes erreur stables : 10 codes)
//   - LEAD_VALID_STATUSES / SOURCES     (frozen arrays — alignés sur types.ts)
//   - LEAD_MAX_*                        (caps tags/name/score/segment cond)
//   - validateEmail()                   (RFC 5322 simplifié, max 254 chars)
//   - validatePhone()                   (E.164 normalize, multi-pays)
//   - validateLeadInput()               (orchestre validation pré-INSERT)
//   - normalizeTags()                   (dedupe + lowercase + trim + caps)
//   - computeInitialScore()             (score basé source + email + phone)
//   - isValidStatus() / isValidSource() (guards rapides)
//   - dedupeKey()                       (clé canonique anti-doublon)
//   - parseSegmentConditions()          (saved-search JSON validator)
//
// AUCUNE dépendance Worker (Env, D1, fetch) → 100 % unit-testable.
// Pas d'import externe (calque pattern calendar-engine.ts).

// ════════════════════════════════════════════════════════════
//  CODES ERREUR STABLES
// ════════════════════════════════════════════════════════════

/**
 * Codes erreur stables exposés à l'API (`{ ok:false, error_code:'…' }`) et
 * aux logs. Permet aux UI / dashboards / automations / tests de matcher sur
 * des chaînes stables au lieu de messages variables (souvent localisés FR).
 */
export const LEAD_ERROR_CODES = {
  LEAD_NOT_FOUND: 'lead_not_found',
  INVALID_EMAIL: 'invalid_email',
  INVALID_PHONE: 'invalid_phone',
  INVALID_STATUS: 'invalid_status',
  INVALID_SOURCE: 'invalid_source',
  INVALID_NAME: 'invalid_name',
  INVALID_SCORE: 'invalid_score',
  INVALID_TAGS: 'invalid_tags',
  DUPLICATE_LEAD: 'duplicate_lead',
  INVALID_SEGMENT: 'invalid_segment',
} as const;

export type LeadErrorCode =
  (typeof LEAD_ERROR_CODES)[keyof typeof LEAD_ERROR_CODES];

// ════════════════════════════════════════════════════════════
//  ENUMS — FROZEN (alignés sur src/lib/types.ts mais autonome)
// ════════════════════════════════════════════════════════════

/**
 * Statuts pipeline acceptés (calque LEAD_STATUSES dans `src/lib/types.ts`).
 * Dupliqué INTENTIONNELLEMENT pour garder ce fichier sans dépendance front.
 * Si types.ts évolue, mettre à jour ICI aussi (le test compare 1:1).
 */
export const LEAD_VALID_STATUSES = Object.freeze([
  'new', 'contacted', 'qualified', 'won', 'closed', 'lost',
] as const);
export type LeadValidStatus = (typeof LEAD_VALID_STATUSES)[number];

/**
 * Sources de leads acceptées. Calque LEAD_SOURCES de `src/lib/types.ts` +
 * sources serveur courantes (manual, webhook, api, import). Toute autre
 * source est rejetée par validateLeadInput unless `allowUnknownSource`.
 */
export const LEAD_VALID_SOURCES = Object.freeze([
  'website', 'facebook', 'google', 'referral', 'phone', 'walkin',
  'ghl_import', 'other', 'manual', 'webhook', 'api', 'import',
] as const);
export type LeadValidSource = (typeof LEAD_VALID_SOURCES)[number];

// ════════════════════════════════════════════════════════════
//  CAPS / LIMITES
// ════════════════════════════════════════════════════════════

export const LEAD_MAX_TAG_LENGTH = 50 as const;
export const LEAD_MAX_TAGS = 20 as const;
export const LEAD_MAX_NAME_LENGTH = 200 as const;
export const LEAD_MAX_EMAIL_LENGTH = 254 as const; // RFC 5321 §4.5.3.1.3
export const LEAD_MIN_SCORE = 0 as const;
export const LEAD_MAX_SCORE = 100 as const;
export const LEAD_MAX_SEGMENT_CONDITIONS = 20 as const;

// ════════════════════════════════════════════════════════════
//  EMAIL — RFC 5322 simplifié
// ════════════════════════════════════════════════════════════

/**
 * Regex email RFC 5322 simplifié (la regex complète fait 6 KB et personne ne
 * l'utilise en prod). Couvre 99 % des cas réels :
 *   - local-part : alphanum + `.-_+'` (pas de dot leading/trailing/double)
 *   - `@`
 *   - domain : labels alphanum + `-` (pas de leading/trailing dash)
 *   - TLD : 2-63 chars alphanum
 *
 * Rejette explicitement : espaces, `<>`, `()`, `,`, `;`, `:`, `"`, double dot,
 * leading/trailing dot dans local-part, dash en début/fin de label.
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

export interface ValidateResult {
  ok: boolean;
  error?: LeadErrorCode;
  message?: string;
}

export interface ValidateEmailResult extends ValidateResult {
  normalized?: string;
}

/**
 * Valide un email selon RFC 5322 simplifié + cap RFC 5321 (254 chars).
 * Retourne `normalized` (trim + lowercase) en cas de succès.
 *
 * Cas rejetés :
 *   - vide / non-string
 *   - > 254 chars
 *   - pas de `@`, pas de TLD, espaces, caractères spéciaux interdits
 *   - leading/trailing/double dot dans local-part
 */
export function validateEmail(email: unknown): ValidateEmailResult {
  if (typeof email !== 'string') {
    return { ok: false, error: LEAD_ERROR_CODES.INVALID_EMAIL, message: 'email must be a string' };
  }
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false, error: LEAD_ERROR_CODES.INVALID_EMAIL, message: 'email is empty' };
  }
  if (trimmed.length > LEAD_MAX_EMAIL_LENGTH) {
    return {
      ok: false,
      error: LEAD_ERROR_CODES.INVALID_EMAIL,
      message: `email exceeds ${LEAD_MAX_EMAIL_LENGTH} chars`,
    };
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return { ok: false, error: LEAD_ERROR_CODES.INVALID_EMAIL, message: 'email format invalid' };
  }
  // Rejet explicite double-dot / leading-dot / trailing-dot dans local-part
  const localPart = trimmed.split('@')[0]!;
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return { ok: false, error: LEAD_ERROR_CODES.INVALID_EMAIL, message: 'invalid local-part dots' };
  }
  return { ok: true, normalized: trimmed.toLowerCase() };
}

// ════════════════════════════════════════════════════════════
//  PHONE — E.164 normalize
// ════════════════════════════════════════════════════════════

/**
 * Indicatifs téléphoniques par pays par défaut. Couvre les principaux marchés
 * Intralys (CA, US, FR, DZ, MA, TN, BE, CH). Étendre selon besoins.
 */
const DEFAULT_COUNTRY_CODES: Record<string, string> = {
  CA: '1', US: '1', FR: '33', DZ: '213', MA: '212', TN: '216',
  BE: '32', CH: '41', GB: '44', DE: '49', IT: '39', ES: '34', PT: '351',
};

export interface ValidatePhoneResult extends ValidateResult {
  normalized?: string; // E.164 format : +<country><number>
}

/**
 * Valide et normalise un numéro de téléphone vers le format E.164 (`+<cc><nn>`).
 *
 * Accepte :
 *   - déjà au format E.164 (`+33612345678`)
 *   - format local (`514-555-1234`, `(514) 555 1234`) → ajoute indicatif `defaultCountry`
 *   - format international avec `00` prefix (`0033612345678`) → convertit en `+`
 *   - séparateurs `.`, `-`, ` `, `(`, `)` retirés
 *
 * Règles :
 *   - longueur finale (sans `+`) : 7 à 15 chiffres (ITU-T E.164)
 *   - rejette les chaînes contenant des lettres ou caractères spéciaux non-télé
 *
 * @param phone — string brut à valider
 * @param defaultCountry — ISO 3166-1 alpha-2 (défaut 'CA')
 */
export function validatePhone(
  phone: unknown,
  defaultCountry = 'CA',
): ValidatePhoneResult {
  if (typeof phone !== 'string') {
    return { ok: false, error: LEAD_ERROR_CODES.INVALID_PHONE, message: 'phone must be a string' };
  }
  const trimmed = phone.trim();
  if (!trimmed) {
    return { ok: false, error: LEAD_ERROR_CODES.INVALID_PHONE, message: 'phone is empty' };
  }
  // Rejette tout caractère qui n'est ni chiffre, ni `+`, ni séparateur courant
  if (!/^[+\d\s().\-]+$/.test(trimmed)) {
    return { ok: false, error: LEAD_ERROR_CODES.INVALID_PHONE, message: 'phone contains invalid characters' };
  }

  // Strip tous les séparateurs
  let digits = trimmed.replace(/[\s().\-]/g, '');

  // `00xxx…` → `+xxx…` (ITU prefix international)
  if (digits.startsWith('00')) {
    digits = '+' + digits.slice(2);
  }

  // Pas de `+` → ajouter indicatif du pays par défaut
  if (!digits.startsWith('+')) {
    if (!/^\d+$/.test(digits)) {
      return { ok: false, error: LEAD_ERROR_CODES.INVALID_PHONE, message: 'phone must be numeric after stripping' };
    }
    const cc = DEFAULT_COUNTRY_CODES[defaultCountry.toUpperCase()];
    if (!cc) {
      return {
        ok: false,
        error: LEAD_ERROR_CODES.INVALID_PHONE,
        message: `unknown default country '${defaultCountry}'`,
      };
    }
    digits = '+' + cc + digits;
  } else {
    // Vérifie que tout ce qui suit `+` est numérique
    if (!/^\+\d+$/.test(digits)) {
      return { ok: false, error: LEAD_ERROR_CODES.INVALID_PHONE, message: 'phone format invalid after +' };
    }
  }

  const numericLen = digits.length - 1; // sans le `+`
  if (numericLen < 7 || numericLen > 15) {
    return {
      ok: false,
      error: LEAD_ERROR_CODES.INVALID_PHONE,
      message: `phone length ${numericLen} not in [7,15] (E.164)`,
    };
  }

  return { ok: true, normalized: digits };
}

// ════════════════════════════════════════════════════════════
//  TAGS — normalize (lowercase + trim + dedupe + cap)
// ════════════════════════════════════════════════════════════

/**
 * Normalise un input de tags vers `string[]` propre :
 *   - accepte `string[]` OU `string` (CSV)
 *   - lowercase + trim chaque tag
 *   - retire les tags vides
 *   - tronque les tags > LEAD_MAX_TAG_LENGTH (sans rejeter)
 *   - dedupe (Set)
 *   - cap LEAD_MAX_TAGS (silencieux, slice)
 *
 * Tout input non-string/non-array → retourne `[]` (jamais throw).
 */
export function normalizeTags(tags: unknown): string[] {
  let raw: unknown[];
  if (typeof tags === 'string') {
    raw = tags.split(',');
  } else if (Array.isArray(tags)) {
    raw = tags;
  } else {
    return [];
  }
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().toLowerCase().slice(0, LEAD_MAX_TAG_LENGTH);
    if (!tag) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    cleaned.push(tag);
    if (cleaned.length >= LEAD_MAX_TAGS) break;
  }
  return cleaned;
}

// ════════════════════════════════════════════════════════════
//  GUARDS rapides — enums
// ════════════════════════════════════════════════════════════

export function isValidStatus(status: unknown): status is LeadValidStatus {
  return typeof status === 'string'
    && (LEAD_VALID_STATUSES as readonly string[]).includes(status);
}

export function isValidSource(source: unknown): source is LeadValidSource {
  return typeof source === 'string'
    && (LEAD_VALID_SOURCES as readonly string[]).includes(source);
}

// ════════════════════════════════════════════════════════════
//  LEAD INPUT — validation orchestrée
// ════════════════════════════════════════════════════════════

export interface LeadInput {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  status?: unknown;
  source?: unknown;
  score?: unknown;
  tags?: unknown;
}

export interface ValidateLeadInputResult extends ValidateResult {
  field?: 'name' | 'email' | 'phone' | 'status' | 'source' | 'score' | 'tags';
  /** Valeurs normalisées prêtes à l'INSERT (email lowercased, phone E.164, tags clean). */
  normalized?: {
    name: string;
    email: string;
    phone: string | null;
    status: LeadValidStatus | null;
    source: string | null;
    score: number | null;
    tags: string[];
  };
}

/**
 * Validation orchestrée d'un payload lead complet. Email + name OBLIGATOIRES.
 * Phone, status, source, score, tags OPTIONNELS — si fournis, validés.
 *
 * Options :
 *   - `defaultCountry` — pour normalize phone (défaut 'CA')
 *   - `allowUnknownSource` — accepte une source hors `LEAD_VALID_SOURCES`
 *     (défaut false). Utile pour ingestion webhook tiers avec source custom.
 */
export function validateLeadInput(
  input: LeadInput,
  options?: { defaultCountry?: string; allowUnknownSource?: boolean },
): ValidateLeadInputResult {
  const defaultCountry = options?.defaultCountry || 'CA';
  const allowUnknownSource = options?.allowUnknownSource === true;

  // name — required, string, non-empty after trim, cap LEAD_MAX_NAME_LENGTH
  if (typeof input.name !== 'string') {
    return {
      ok: false, field: 'name', error: LEAD_ERROR_CODES.INVALID_NAME,
      message: 'name must be a string',
    };
  }
  const name = input.name.trim();
  if (!name) {
    return {
      ok: false, field: 'name', error: LEAD_ERROR_CODES.INVALID_NAME,
      message: 'name is empty',
    };
  }
  if (name.length > LEAD_MAX_NAME_LENGTH) {
    return {
      ok: false, field: 'name', error: LEAD_ERROR_CODES.INVALID_NAME,
      message: `name exceeds ${LEAD_MAX_NAME_LENGTH} chars`,
    };
  }

  // email — required
  const emailRes = validateEmail(input.email);
  if (!emailRes.ok) {
    return { ok: false, field: 'email', error: emailRes.error, message: emailRes.message };
  }

  // phone — optional ; if provided, must validate
  let phoneNormalized: string | null = null;
  if (input.phone !== undefined && input.phone !== null && input.phone !== '') {
    const phoneRes = validatePhone(input.phone, defaultCountry);
    if (!phoneRes.ok) {
      return { ok: false, field: 'phone', error: phoneRes.error, message: phoneRes.message };
    }
    phoneNormalized = phoneRes.normalized!;
  }

  // status — optional
  let status: LeadValidStatus | null = null;
  if (input.status !== undefined && input.status !== null && input.status !== '') {
    if (!isValidStatus(input.status)) {
      return {
        ok: false, field: 'status', error: LEAD_ERROR_CODES.INVALID_STATUS,
        message: `status must be one of ${LEAD_VALID_STATUSES.join(',')}`,
      };
    }
    status = input.status;
  }

  // source — optional
  let source: string | null = null;
  if (input.source !== undefined && input.source !== null && input.source !== '') {
    if (typeof input.source !== 'string') {
      return {
        ok: false, field: 'source', error: LEAD_ERROR_CODES.INVALID_SOURCE,
        message: 'source must be a string',
      };
    }
    if (!allowUnknownSource && !isValidSource(input.source)) {
      return {
        ok: false, field: 'source', error: LEAD_ERROR_CODES.INVALID_SOURCE,
        message: `source '${input.source}' not in whitelist`,
      };
    }
    source = input.source;
  }

  // score — optional, 0-100
  let score: number | null = null;
  if (input.score !== undefined && input.score !== null && input.score !== '') {
    const s = Number(input.score);
    if (!Number.isFinite(s) || s < LEAD_MIN_SCORE || s > LEAD_MAX_SCORE) {
      return {
        ok: false, field: 'score', error: LEAD_ERROR_CODES.INVALID_SCORE,
        message: `score must be a number in [${LEAD_MIN_SCORE},${LEAD_MAX_SCORE}]`,
      };
    }
    score = s;
  }

  // tags — optional, normalize (jamais d'erreur, juste cap)
  const tags = input.tags !== undefined ? normalizeTags(input.tags) : [];

  return {
    ok: true,
    normalized: {
      name,
      email: emailRes.normalized!,
      phone: phoneNormalized,
      status,
      source,
      score,
      tags,
    },
  };
}

// ════════════════════════════════════════════════════════════
//  SCORING — initial score pour nouveaux leads
// ════════════════════════════════════════════════════════════

/**
 * Map source → score initial. Sources "haute intention" (referral, walk-in,
 * téléphone, demandes manuelles) scorent plus haut. Sources froides
 * (webhook tiers, import en masse) plus bas. Inconnu = 5 (signal faible).
 */
const SOURCE_BASE_SCORE: Record<string, number> = {
  referral: 25,
  walkin: 25,
  phone: 25,
  manual: 20,
  website: 15,
  google: 15,
  facebook: 12,
  ghl_import: 8,
  webhook: 8,
  api: 8,
  import: 5,
  other: 5,
};

/**
 * Calcule le score initial d'un lead à la création.
 *
 * Formule :
 *   score = base(source) + (email ? 20 : 0) + (phone ? 20 : 0)
 *
 * Cas type :
 *   - email + phone + source 'referral' → 25 + 20 + 20 = 65
 *   - email + phone + source 'website'  → 15 + 20 + 20 = 55
 *   - email only + source 'manual'      → 20 + 20 = 40
 *   - juste source 'manual' (no email)  → 20
 *   - email only (no source)            → 0 + 20 = 20
 *   - rien (edge)                       → 0
 *
 * Output bornée [0, 100].
 */
export function computeInitialScore(input: {
  email?: string | null;
  phone?: string | null;
  source?: string | null;
}): number {
  let score = 0;
  if (input.source) {
    score += SOURCE_BASE_SCORE[input.source] ?? 5;
  }
  if (input.email && input.email.trim()) score += 20;
  if (input.phone && input.phone.trim()) score += 20;
  return Math.max(LEAD_MIN_SCORE, Math.min(LEAD_MAX_SCORE, score));
}

// ════════════════════════════════════════════════════════════
//  DEDUPE KEY — clé canonique anti-doublon
// ════════════════════════════════════════════════════════════

/**
 * Calcule la clé canonique d'un lead pour dédoublonnage.
 * Format : `<tenantId>:<emailLowercased>` — tenant-scoped (multi-tenant safe).
 *
 * Si `tenantId` absent ou vide → clé `:<email>` (legacy mono-tenant ; ne PAS
 * mélanger avec le format multi-tenant à l'usage).
 *
 * Si `email` absent ou invalide → fallback sur phone : `<tenantId>:phone:<E164>`.
 * Si rien → chaîne vide (le caller doit traiter ce cas).
 */
export function dedupeKey(lead: {
  tenantId?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  const tenant = lead.tenantId ? lead.tenantId.trim() : '';
  const emailRes = validateEmail(lead.email);
  if (emailRes.ok) {
    return `${tenant}:${emailRes.normalized}`;
  }
  const phoneRes = validatePhone(lead.phone, 'CA');
  if (phoneRes.ok) {
    return `${tenant}:phone:${phoneRes.normalized}`;
  }
  return '';
}

// ════════════════════════════════════════════════════════════
//  SEGMENT CONDITIONS — saved-search JSON validator
// ════════════════════════════════════════════════════════════

/**
 * Opérateurs supportés par les segments (saved searches). Tout opérateur hors
 * de cette liste fait échouer parseSegmentConditions.
 */
export const SEGMENT_VALID_OPERATORS = Object.freeze([
  'eq', 'neq', 'in', 'nin', 'contains', 'starts_with', 'ends_with',
  'gt', 'gte', 'lt', 'lte', 'exists', 'not_exists',
] as const);
export type SegmentOperator = (typeof SEGMENT_VALID_OPERATORS)[number];

/**
 * Logique combinatoire entre conditions ('AND' = toutes ; 'OR' = au moins une).
 */
export const SEGMENT_VALID_LOGIC = Object.freeze(['AND', 'OR'] as const);
export type SegmentLogic = (typeof SEGMENT_VALID_LOGIC)[number];

export interface SegmentCondition {
  field: string;
  operator: SegmentOperator;
  value?: unknown;
}

export interface SegmentDefinition {
  logic: SegmentLogic;
  conditions: SegmentCondition[];
}

export interface ParseSegmentResult extends ValidateResult {
  conditions?: SegmentDefinition;
}

/**
 * Parse + valide un JSON de saved search.
 *
 * Format attendu :
 * ```json
 * {
 *   "logic": "AND",
 *   "conditions": [
 *     { "field": "status", "operator": "eq", "value": "qualified" },
 *     { "field": "score", "operator": "gte", "value": 50 }
 *   ]
 * }
 * ```
 *
 * Règles :
 *   - JSON parseable (sinon `INVALID_SEGMENT`)
 *   - `logic` ∈ SEGMENT_VALID_LOGIC
 *   - `conditions` : array non-vide, ≤ LEAD_MAX_SEGMENT_CONDITIONS
 *   - chaque condition : `field` string non-vide, `operator` whitelisted
 *   - `value` requis sauf pour `exists` / `not_exists`
 */
export function parseSegmentConditions(jsonOrObj: unknown): ParseSegmentResult {
  let raw: unknown;
  if (typeof jsonOrObj === 'string') {
    try {
      raw = JSON.parse(jsonOrObj);
    } catch {
      return {
        ok: false, error: LEAD_ERROR_CODES.INVALID_SEGMENT,
        message: 'segment JSON malformed',
      };
    }
  } else {
    raw = jsonOrObj;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false, error: LEAD_ERROR_CODES.INVALID_SEGMENT,
      message: 'segment must be an object',
    };
  }
  const obj = raw as Record<string, unknown>;

  // logic
  const logic = obj.logic;
  if (!logic || !(SEGMENT_VALID_LOGIC as readonly string[]).includes(logic as string)) {
    return {
      ok: false, error: LEAD_ERROR_CODES.INVALID_SEGMENT,
      message: `logic must be one of ${SEGMENT_VALID_LOGIC.join(',')}`,
    };
  }

  // conditions
  const conditions = obj.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return {
      ok: false, error: LEAD_ERROR_CODES.INVALID_SEGMENT,
      message: 'conditions must be a non-empty array',
    };
  }
  if (conditions.length > LEAD_MAX_SEGMENT_CONDITIONS) {
    return {
      ok: false, error: LEAD_ERROR_CODES.INVALID_SEGMENT,
      message: `conditions exceed cap (${LEAD_MAX_SEGMENT_CONDITIONS})`,
    };
  }

  const cleaned: SegmentCondition[] = [];
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return {
        ok: false, error: LEAD_ERROR_CODES.INVALID_SEGMENT,
        message: `condition[${i}] must be an object`,
      };
    }
    const cond = c as Record<string, unknown>;
    if (typeof cond.field !== 'string' || !cond.field.trim()) {
      return {
        ok: false, error: LEAD_ERROR_CODES.INVALID_SEGMENT,
        message: `condition[${i}].field missing or empty`,
      };
    }
    if (typeof cond.operator !== 'string'
      || !(SEGMENT_VALID_OPERATORS as readonly string[]).includes(cond.operator)) {
      return {
        ok: false, error: LEAD_ERROR_CODES.INVALID_SEGMENT,
        message: `condition[${i}].operator invalid`,
      };
    }
    const op = cond.operator as SegmentOperator;
    // value requis sauf exists/not_exists
    if (op !== 'exists' && op !== 'not_exists' && cond.value === undefined) {
      return {
        ok: false, error: LEAD_ERROR_CODES.INVALID_SEGMENT,
        message: `condition[${i}].value required for operator '${op}'`,
      };
    }
    cleaned.push({
      field: cond.field.trim(),
      operator: op,
      value: cond.value,
    });
  }

  return {
    ok: true,
    conditions: {
      logic: logic as SegmentLogic,
      conditions: cleaned,
    },
  };
}
