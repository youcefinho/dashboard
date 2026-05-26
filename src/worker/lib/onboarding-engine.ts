// ── onboarding-engine.ts — Helpers PURS checklist onboarding (P0-7) ────────
//
// Contrat ADDITIF — 100% : aucun import depuis onboarding.ts existant,
// aucun remplacement de logique vivante. Helpers PURS (zéro I/O) pour :
//   - Item keys frozen (CRM + ECOM)
//   - Skip reasons whitelist
//   - Compute progress (total, completed, skipped, pct, lastActiveAt)
//   - Validate itemKey + skipReason
//   - Merge checklist items (preserve done over update)

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const ONBOARDING_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_ITEM_KEY: 'INVALID_ITEM_KEY',
  INVALID_SKIP_REASON: 'INVALID_SKIP_REASON',
  SKIP_REASON_TOO_LONG: 'SKIP_REASON_TOO_LONG',
  ITEM_ALREADY_DONE: 'ITEM_ALREADY_DONE',
  ITEM_ALREADY_SKIPPED: 'ITEM_ALREADY_SKIPPED',
  ITEM_NOT_IN_SCOPE: 'ITEM_NOT_IN_SCOPE',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  STATE_PERSIST_FAILED: 'STATE_PERSIST_FAILED',
  CHECKLIST_DISABLED: 'CHECKLIST_DISABLED',
} as const;

export type OnboardingErrorCode =
  (typeof ONBOARDING_ERROR_CODES)[keyof typeof ONBOARDING_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Item keys frozen list
// ════════════════════════════════════════════════════════════════════════════

/** 6 items CRM toujours présents (socle non désactivable). */
export const CRM_ITEM_KEYS = [
  'profile_completed',
  'leads_imported',
  'pipeline_configured',
  'team_invited',
  'integration_connected',
  'docs_visited',
] as const;
export type CrmItemKey = (typeof CRM_ITEM_KEYS)[number];

/** 3 items e-commerce additifs (présents seulement si module 'ecommerce' actif). */
export const ECOM_ITEM_KEYS = [
  'ecommerce_catalog',
  'ecommerce_first_product',
  'ecommerce_channel',
] as const;
export type EcomItemKey = (typeof ECOM_ITEM_KEYS)[number];

/** Union complète des item keys. */
export const ALL_ITEM_KEYS = [...CRM_ITEM_KEYS, ...ECOM_ITEM_KEYS] as const;
export type OnboardingItemKey = (typeof ALL_ITEM_KEYS)[number];

const ALL_ITEM_KEYS_SET: ReadonlySet<string> = new Set(ALL_ITEM_KEYS);
const CRM_ITEM_KEYS_SET: ReadonlySet<string> = new Set(CRM_ITEM_KEYS);
const ECOM_ITEM_KEYS_SET: ReadonlySet<string> = new Set(ECOM_ITEM_KEYS);

/** True si la key match un item connu. */
export function validateItemKey(key: unknown): boolean {
  return typeof key === 'string' && ALL_ITEM_KEYS_SET.has(key);
}

/** True si la key appartient au socle CRM. */
export function isCrmItem(key: unknown): boolean {
  return typeof key === 'string' && CRM_ITEM_KEYS_SET.has(key);
}

/** True si la key appartient à la branche ecom. */
export function isEcomItem(key: unknown): boolean {
  return typeof key === 'string' && ECOM_ITEM_KEYS_SET.has(key);
}

// ════════════════════════════════════════════════════════════════════════════
// Skip reasons whitelist
// ════════════════════════════════════════════════════════════════════════════

/**
 * Whitelist des raisons skip — analytics + i18n côté UI.
 * 'other' permet une raison libre (validée length-only).
 */
export const VALID_SKIP_REASONS = [
  'not_needed',
  'will_do_later',
  'not_my_role',
  'unclear',
  'too_complex',
  'already_done_elsewhere',
  'no_data_yet',
  'other',
] as const;
export type SkipReason = (typeof VALID_SKIP_REASONS)[number];

const VALID_SKIP_REASONS_SET: ReadonlySet<string> = new Set(VALID_SKIP_REASONS);
const SKIP_REASON_MAX_LENGTH = 280;

/** True si reason est dans la whitelist OU si reason custom dans la limite length. */
export function validateSkipReason(reason: unknown): boolean {
  if (reason == null || reason === '') return true; // optionnel
  if (typeof reason !== 'string') return false;
  if (reason.length > SKIP_REASON_MAX_LENGTH) return false;
  // Acceptable : token whitelist OR free text (analytics-friendly).
  return VALID_SKIP_REASONS_SET.has(reason) || reason.trim().length > 0;
}

/** True si reason est un token whitelist (vs free-text). */
export function isWhitelistedSkipReason(reason: unknown): boolean {
  return typeof reason === 'string' && VALID_SKIP_REASONS_SET.has(reason);
}

// ════════════════════════════════════════════════════════════════════════════
// Checklist item state shape
// ════════════════════════════════════════════════════════════════════════════

export interface ChecklistItemState {
  done: boolean;
  skipped: boolean;
  completedAt: string | null;
  skippedAt: string | null;
  skipReason?: string;
}

export type ChecklistItems = Partial<Record<OnboardingItemKey, ChecklistItemState>>;

// ════════════════════════════════════════════════════════════════════════════
// computeProgress — total/completed/skipped/pct
// ════════════════════════════════════════════════════════════════════════════

export interface ProgressInput {
  items: ChecklistItems;
  /** Modules actifs (pour décider si la branche ecom est incluse). */
  modules: ReadonlyArray<string>;
  /** Dernier timestamp d'activité (ISO). */
  lastActiveAt?: string | null;
}

export interface ProgressResult {
  total: number;
  completed: number;
  skipped: number;
  pct: number;
  lastActiveAt: string | null;
  /** Item keys en scope (CRM + ECOM si modules.ecommerce actif). */
  inScopeKeys: ReadonlyArray<OnboardingItemKey>;
}

/**
 * Calcule la progression d'une checklist onboarding.
 *
 *   - total = 6 (CRM socle) + 3 si module 'ecommerce' actif.
 *   - completed = items done === true && !skipped.
 *   - skipped = items skipped === true && !done.
 *   - pct = round((completed + skipped) / total * 100), capé 0..100.
 *
 * Items hors scope (ex: ecommerce_catalog mais module désactivé) sont ignorés
 * pour le total mais peuvent rester dans items (calque onboarding.ts:484-488).
 */
export function computeProgress(
  input: ProgressInput,
): ProgressResult {
  const modules = Array.isArray(input?.modules) ? input.modules : [];
  const hasEcom = modules.includes('ecommerce');
  const inScopeKeys: OnboardingItemKey[] = [
    ...CRM_ITEM_KEYS,
    ...(hasEcom ? ECOM_ITEM_KEYS : []),
  ];
  const total = inScopeKeys.length;

  const items = (input?.items && typeof input.items === 'object') ? input.items : {};

  let completed = 0;
  let skipped = 0;
  for (const key of inScopeKeys) {
    const state = items[key];
    if (!state) continue;
    if (state.done && !state.skipped) completed += 1;
    else if (state.skipped && !state.done) skipped += 1;
  }

  const denom = total > 0 ? total : 1;
  let pct = Math.round(((completed + skipped) / denom) * 100);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;

  return {
    total,
    completed,
    skipped,
    pct,
    lastActiveAt: input?.lastActiveAt ?? null,
    inScopeKeys,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// mergeChecklistItems — preserve done over update
// ════════════════════════════════════════════════════════════════════════════

/**
 * Merge intelligent existing + updates.
 *
 * Règles de précédence (anti-régression user effort) :
 *   - Si existing.done === true ET update.done !== true → on PRÉSERVE existing
 *     (jamais "uncomplete" un done sauf reset explicite).
 *   - Sinon update gagne (skip après done = OK, skip overrides ; done écrase skip).
 *   - completedAt : préservé si déjà done (idempotence), nouveau sinon.
 *
 * @param existing Items actuels (DB).
 * @param updates Patch partiel (peut être vide).
 * @param now ISO timestamp (default: now).
 */
export function mergeChecklistItems(
  existing: ChecklistItems,
  updates: ChecklistItems,
  now: string = new Date().toISOString(),
): ChecklistItems {
  const safeExisting: ChecklistItems =
    existing && typeof existing === 'object' ? existing : {};
  const safeUpdates: ChecklistItems =
    updates && typeof updates === 'object' ? updates : {};

  const merged: ChecklistItems = { ...safeExisting };

  for (const [keyRaw, updateState] of Object.entries(safeUpdates)) {
    if (!validateItemKey(keyRaw)) continue;
    const key = keyRaw as OnboardingItemKey;
    if (!updateState || typeof updateState !== 'object') continue;

    const prev = safeExisting[key];

    // Préservation done (anti-régression effort)
    if (prev && prev.done && !updateState.done && !updateState.skipped) {
      // Update vide ou no-op : on garde prev.
      continue;
    }

    if (updateState.done === true) {
      merged[key] = {
        done: true,
        skipped: false,
        completedAt:
          prev && prev.done && prev.completedAt ? prev.completedAt : now,
        skippedAt: null,
      };
    } else if (updateState.skipped === true) {
      merged[key] = {
        done: false,
        skipped: true,
        completedAt: null,
        skippedAt: now,
        skipReason: updateState.skipReason,
      };
    } else {
      // Reset partiel d'un item (rare — pas done, pas skipped) : on accepte.
      merged[key] = {
        done: false,
        skipped: false,
        completedAt: null,
        skippedAt: null,
      };
    }
  }

  return merged;
}

// ════════════════════════════════════════════════════════════════════════════
// Reset complet checklist (UPDATE en mémoire — caller persiste)
// ════════════════════════════════════════════════════════════════════════════

/** Renvoie un objet items vide (pour reset). */
export function emptyChecklist(): ChecklistItems {
  return {};
}

// ════════════════════════════════════════════════════════════════════════════
// Sanitize items (defensive parse from D1 JSON)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Nettoie un objet items après parse JSON D1.
 *   - Filtre keys hors VALID_ITEM_KEYS.
 *   - Garantit la forme ChecklistItemState (booleens stricts, dates string|null).
 */
export function sanitizeChecklistItems(raw: unknown): ChecklistItems {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ChecklistItems = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validateItemKey(k)) continue;
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    out[k as OnboardingItemKey] = {
      done: r.done === true,
      skipped: r.skipped === true,
      completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
      skippedAt: typeof r.skippedAt === 'string' ? r.skippedAt : null,
      skipReason: typeof r.skipReason === 'string' ? r.skipReason : undefined,
    };
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// Empty response shape (calque EMPTY_CHECKLIST onboarding.ts)
// ════════════════════════════════════════════════════════════════════════════

export interface ChecklistResponseShape {
  items: ChecklistItems;
  total: number;
  completed: number;
  skipped: number;
  pct: number;
  lastActiveAt: string | null;
}

export const EMPTY_CHECKLIST_SHAPE: ChecklistResponseShape = Object.freeze({
  items: {},
  total: 0,
  completed: 0,
  skipped: 0,
  pct: 0,
  lastActiveAt: null,
});
