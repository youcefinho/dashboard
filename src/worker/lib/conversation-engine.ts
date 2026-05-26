// ── lib/conversation-engine.ts — Core CRM P0-3 (renforcement conversations.ts) ─
//
// Helpers PURS (zéro I/O, zéro D1, zéro fetch) extraits/dérivés de
// conversations.ts pour rendre la validation des threads, des statuts, du
// unread-count et de la pagination par curseur testable indépendamment du
// runtime Worker. Tout est additif : conversations.ts continue à fonctionner
// avec son comportement actuel.
//
// CONTENU :
//   - CONVERSATION_ERROR_CODES        codes erreur stables
//   - CONVERSATION_VALID_STATUSES     enum frozen ('open' | 'closed' | 'snoozed')
//   - CONVERSATION_VALID_CHANNELS     enum frozen (email, sms, webchat, …)
//   - CONVERSATION_PAGINATION_MAX     200 (cap dur LIMIT D1)
//   - CONVERSATION_PREVIEW_MAX_LEN    120 (preview last_message_preview)
//   - isValidStatus / isValidChannel  guards rapides
//   - validateThreadStatus            validation d'une transition de statut
//   - validateSnoozeUntil             ISO + futur strict (snoozed_until)
//   - computeUnreadCount              math pur (inbound new vs read_at)
//   - getNextCursor                   pagination opaque (created_at ISO)
//   - parseCursor                     décodage + validation cursor
//   - computeThreadKey                clé canonique (lead_id|channel) pour
//                                     anti-doublon thread ouvert
//   - clampPreview                    helper preview last_message_preview
//
// AUCUNE dépendance Worker (Env, D1, fetch) → 100 % unit-testable.

// ════════════════════════════════════════════════════════════
//  CODES ERREUR STABLES
// ════════════════════════════════════════════════════════════

export const CONVERSATION_ERROR_CODES = {
  CONVERSATION_NOT_FOUND: 'conversation_not_found',
  INVALID_STATUS: 'invalid_status',
  INVALID_CHANNEL: 'invalid_channel',
  INVALID_CURSOR: 'invalid_cursor',
  INVALID_SNOOZE: 'invalid_snooze',
  INVALID_THREAD_KEY: 'invalid_thread_key',
  INVALID_TRANSITION: 'invalid_transition',
  INVALID_LIMIT: 'invalid_limit',
} as const;

export type ConversationErrorCode =
  (typeof CONVERSATION_ERROR_CODES)[keyof typeof CONVERSATION_ERROR_CODES];

// ════════════════════════════════════════════════════════════
//  ENUMS FROZEN
// ════════════════════════════════════════════════════════════

export const CONVERSATION_VALID_STATUSES = Object.freeze([
  'open',
  'closed',
  'snoozed',
] as const);
export type ConversationStatus =
  (typeof CONVERSATION_VALID_STATUSES)[number];

/**
 * Canaux acceptés — calque conversations.ts handleCreateConversation +
 * findOrCreateConversation. 'facebook' / 'instagram' (sans suffixe) sont
 * acceptés pour rétro-compat avec handleSendConversationMessage qui les
 * route vers Meta.
 */
export const CONVERSATION_VALID_CHANNELS = Object.freeze([
  'email',
  'sms',
  'webchat',
  'facebook_messenger',
  'instagram_dm',
  'facebook',
  'instagram',
  'whatsapp',
  'internal_note',
] as const);
export type ConversationChannel =
  (typeof CONVERSATION_VALID_CHANNELS)[number];

// ════════════════════════════════════════════════════════════
//  CAPS / LIMITES
// ════════════════════════════════════════════════════════════

export const CONVERSATION_PAGINATION_MAX = 200 as const;
export const CONVERSATION_PAGINATION_DEFAULT = 50 as const;
export const CONVERSATION_PREVIEW_MAX_LEN = 120 as const;
export const CONVERSATION_SUBJECT_MAX_LEN = 500 as const;

// ════════════════════════════════════════════════════════════
//  GUARDS RAPIDES
// ════════════════════════════════════════════════════════════

export function isValidStatus(s: unknown): s is ConversationStatus {
  return (
    typeof s === 'string' &&
    (CONVERSATION_VALID_STATUSES as readonly string[]).includes(s)
  );
}

export function isValidChannel(c: unknown): c is ConversationChannel {
  return (
    typeof c === 'string' &&
    (CONVERSATION_VALID_CHANNELS as readonly string[]).includes(c)
  );
}

// ════════════════════════════════════════════════════════════
//  VALIDATE THREAD STATUS
// ════════════════════════════════════════════════════════════

export interface ValidateResult {
  ok: boolean;
  error?: ConversationErrorCode;
  message?: string;
}

/**
 * Valide qu'un statut cible est acceptable, et optionnellement qu'une
 * transition depuis `current` est légitime. Transitions interdites :
 *   - closed → snoozed  (un thread clos doit d'abord être rouvert)
 *
 * Toutes les autres transitions sont acceptées (un admin peut rouvrir
 * un thread, snoozer un thread ouvert, fermer n'importe quel statut).
 */
export function validateThreadStatus(
  target: unknown,
  current?: unknown,
): ValidateResult {
  if (!isValidStatus(target)) {
    return {
      ok: false,
      error: CONVERSATION_ERROR_CODES.INVALID_STATUS,
      message: `status must be one of: ${CONVERSATION_VALID_STATUSES.join(', ')}`,
    };
  }
  if (current !== undefined && current !== null) {
    if (!isValidStatus(current)) {
      return {
        ok: false,
        error: CONVERSATION_ERROR_CODES.INVALID_STATUS,
        message: 'current status invalid',
      };
    }
    if (current === 'closed' && target === 'snoozed') {
      return {
        ok: false,
        error: CONVERSATION_ERROR_CODES.INVALID_TRANSITION,
        message: 'cannot snooze a closed thread — reopen first',
      };
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════
//  VALIDATE SNOOZE UNTIL
// ════════════════════════════════════════════════════════════

/**
 * Valide une date ISO de snooze : doit parser, et être strictement dans le
 * futur par rapport à `now` (défaut Date.now()). Cap soft à 1 an pour éviter
 * les saisies aberrantes.
 */
export function validateSnoozeUntil(
  value: unknown,
  now: number = Date.now(),
): ValidateResult {
  if (typeof value !== 'string' || !value) {
    return {
      ok: false,
      error: CONVERSATION_ERROR_CODES.INVALID_SNOOZE,
      message: 'snoozed_until must be ISO string',
    };
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return {
      ok: false,
      error: CONVERSATION_ERROR_CODES.INVALID_SNOOZE,
      message: 'snoozed_until is not a valid date',
    };
  }
  if (ts <= now) {
    return {
      ok: false,
      error: CONVERSATION_ERROR_CODES.INVALID_SNOOZE,
      message: 'snoozed_until must be in the future',
    };
  }
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  if (ts - now > ONE_YEAR_MS) {
    return {
      ok: false,
      error: CONVERSATION_ERROR_CODES.INVALID_SNOOZE,
      message: 'snoozed_until exceeds 1 year cap',
    };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════
//  UNREAD COUNT
// ════════════════════════════════════════════════════════════

export interface MessageForUnread {
  direction: 'inbound' | 'outbound' | string;
  created_at: string;
}

/**
 * Calcule le nombre de messages INBOUND non-lus en comparant `created_at` à
 * la date de dernière lecture `lastReadAt`. Si `lastReadAt` absent, tous
 * les inbound comptent. Outbound n'incrémente jamais l'unread count.
 */
export function computeUnreadCount(
  messages: readonly MessageForUnread[],
  lastReadAt?: string | null,
): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  const readTs = lastReadAt ? Date.parse(lastReadAt) : 0;
  let count = 0;
  for (const m of messages) {
    if (m.direction !== 'inbound') continue;
    const mTs = Date.parse(m.created_at);
    if (Number.isNaN(mTs)) continue;
    if (mTs > readTs) count++;
  }
  return count;
}

// ════════════════════════════════════════════════════════════
//  PAGINATION CURSOR (opaque, basé sur created_at ISO)
// ════════════════════════════════════════════════════════════

export interface CursorResult {
  ok: boolean;
  cursor?: string;
  error?: ConversationErrorCode;
}

/**
 * Renvoie un cursor opaque pour la page suivante : le `created_at` du
 * dernier message servi (D1 fait DESC + created_at < cursor). Si le batch
 * est vide ou contient moins que `limit`, retourne `cursor: undefined`
 * (= fin de liste).
 */
export function getNextCursor(
  batch: readonly { created_at: string }[],
  limit: number,
): CursorResult {
  if (!Array.isArray(batch) || batch.length === 0) return { ok: true };
  if (batch.length < limit) return { ok: true };
  const last = batch[batch.length - 1]!;
  if (!last.created_at) return { ok: true };
  return { ok: true, cursor: last.created_at };
}

/**
 * Décode + valide un cursor reçu en query string. Doit être une date ISO
 * parsable. Retourne `{ ok: true }` avec `cursor: undefined` si l'input est
 * vide / null (= début de liste).
 */
export function parseCursor(raw: unknown): CursorResult {
  if (raw === null || raw === undefined || raw === '') return { ok: true };
  if (typeof raw !== 'string') {
    return { ok: false, error: CONVERSATION_ERROR_CODES.INVALID_CURSOR };
  }
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    return { ok: false, error: CONVERSATION_ERROR_CODES.INVALID_CURSOR };
  }
  return { ok: true, cursor: raw };
}

/**
 * Validation + clamping du `limit` paginé. Cap dur à
 * CONVERSATION_PAGINATION_MAX, défaut CONVERSATION_PAGINATION_DEFAULT.
 * Refuse strictement les valeurs négatives ou non-numériques (≠ NaN
 * silencieux qui passait à 50 avant).
 */
export function clampLimit(raw: unknown): {
  ok: boolean;
  limit: number;
  error?: ConversationErrorCode;
} {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, limit: CONVERSATION_PAGINATION_DEFAULT };
  }
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    return {
      ok: false,
      limit: CONVERSATION_PAGINATION_DEFAULT,
      error: CONVERSATION_ERROR_CODES.INVALID_LIMIT,
    };
  }
  if (n <= 0) {
    return {
      ok: false,
      limit: CONVERSATION_PAGINATION_DEFAULT,
      error: CONVERSATION_ERROR_CODES.INVALID_LIMIT,
    };
  }
  return { ok: true, limit: Math.min(Math.floor(n), CONVERSATION_PAGINATION_MAX) };
}

// ════════════════════════════════════════════════════════════
//  THREAD KEY (anti-doublon thread ouvert)
// ════════════════════════════════════════════════════════════

/**
 * Calcule une clé canonique `lead_id|channel` pour matcher un thread
 * existant. Channels sont normalisés (lowercase + trim). Utilisé par
 * findOrCreateConversation pour éviter les doublons de threads ouverts.
 */
export function computeThreadKey(
  leadId: unknown,
  channel: unknown,
): { ok: boolean; key?: string; error?: ConversationErrorCode } {
  if (typeof leadId !== 'string' || !leadId.trim()) {
    return { ok: false, error: CONVERSATION_ERROR_CODES.INVALID_THREAD_KEY };
  }
  if (!isValidChannel(channel)) {
    return { ok: false, error: CONVERSATION_ERROR_CODES.INVALID_CHANNEL };
  }
  return { ok: true, key: `${leadId.trim()}|${(channel as string).toLowerCase()}` };
}

// ════════════════════════════════════════════════════════════
//  PREVIEW CLAMP
// ════════════════════════════════════════════════════════════

/**
 * Tronque proprement un body pour `last_message_preview`. Strip newlines
 * en remplacement par espace pour éviter les previews multi-ligne dans
 * l'inbox UI.
 */
export function clampPreview(
  body: unknown,
  maxLen: number = CONVERSATION_PREVIEW_MAX_LEN,
): string {
  if (typeof body !== 'string') return '';
  return body
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, maxLen);
}
