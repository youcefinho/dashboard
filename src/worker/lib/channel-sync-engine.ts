// ── channel-sync-engine.ts ─────────────────────────────────────────────────
// Helpers PURS pour `ecommerce-channel-sync.ts` (P2-3) :
//   - CHANNEL_SYNC_ERROR_CODES (frozen)
//   - VALID_SYNC_STATUSES (pending|syncing|synced|error|conflict, frozen)
//   - VALID_CHANNELS_SYNC (shopify|woocommerce|amazon|ebay|other, frozen)
//   - validateStatusTransition(from, to) → Result
//   - computeRetryDelay(attemptN) → number (exp backoff ms)
//   - parseChannelWebhook(channel, payload) → { kind; data; error? }
//   - validateSyncMapping(localId, channelId, channel) → Result
//
// Conventions strictes :
//   - PURS : aucune dépendance DB / Env.
//   - Garde défensive : entrées invalides ⇒ error structuré (jamais throw).
//   - Bornage : MAX_RETRY_ATTEMPTS=10, MAX_DELAY_MS=600_000 (10min).
//   - Additif strict — NE modifie PAS ecommerce-channel-sync.ts.

/** Codes d'erreur normalisés (frozen). */
export const CHANNEL_SYNC_ERROR_CODES = Object.freeze({
  STATUS_INVALID: 'STATUS_INVALID',
  TRANSITION_INVALID: 'TRANSITION_INVALID',
  CHANNEL_INVALID: 'CHANNEL_INVALID',
  ATTEMPT_INVALID: 'ATTEMPT_INVALID',
  WEBHOOK_PAYLOAD_INVALID: 'WEBHOOK_PAYLOAD_INVALID',
  WEBHOOK_KIND_UNKNOWN: 'WEBHOOK_KIND_UNKNOWN',
  MAPPING_INVALID: 'MAPPING_INVALID',
  LOCAL_ID_INVALID: 'LOCAL_ID_INVALID',
  CHANNEL_ID_INVALID: 'CHANNEL_ID_INVALID',
} as const);

export type ChannelSyncErrorCode =
  (typeof CHANNEL_SYNC_ERROR_CODES)[keyof typeof CHANNEL_SYNC_ERROR_CODES];

/** Statuts de sync whitelistés (frozen) — state machine. */
export const VALID_SYNC_STATUSES = Object.freeze([
  'pending',
  'syncing',
  'synced',
  'error',
  'conflict',
] as const);

export type SyncStatus = (typeof VALID_SYNC_STATUSES)[number];

/** Canaux supportés whitelistés (frozen). */
export const VALID_CHANNELS_SYNC = Object.freeze([
  'shopify',
  'woocommerce',
  'amazon',
  'ebay',
  'other',
] as const);

export type ChannelKind = (typeof VALID_CHANNELS_SYNC)[number];

// Bornes défensives.
export const MAX_RETRY_ATTEMPTS = 10;
export const MAX_RETRY_DELAY_MS = 600_000; // 10 min
export const BASE_RETRY_DELAY_MS = 1000; // 1 s

// State machine : transitions autorisées.
// pending → syncing (start) ; pending → error (validation fail before push)
// syncing → synced (success) ; syncing → error (failure) ; syncing → conflict
// error → pending (retry) ; error → syncing (retry direct)
// conflict → pending (manual resolve) ; conflict → syncing (force retry)
// synced → pending (re-sync request) — terminal réversible (re-pull)
const ALLOWED_TRANSITIONS: Readonly<Record<SyncStatus, ReadonlyArray<SyncStatus>>> =
  Object.freeze({
    pending: ['syncing', 'error'],
    syncing: ['synced', 'error', 'conflict'],
    synced: ['pending'],
    error: ['pending', 'syncing'],
    conflict: ['pending', 'syncing'],
  });

// ────────────────────────────────────────────────────────────────────────────
// validateStatusTransition — vérifie qu'une transition d'état est autorisée.
// ────────────────────────────────────────────────────────────────────────────

export interface TransitionValidation {
  ok: boolean;
  error?: string;
  code?: ChannelSyncErrorCode;
  field?: string;
}

export function validateStatusTransition(from: unknown, to: unknown): TransitionValidation {
  if (typeof from !== 'string' || !VALID_SYNC_STATUSES.includes(from as SyncStatus)) {
    return {
      ok: false,
      error: `Statut from invalide (attendu: ${VALID_SYNC_STATUSES.join('|')})`,
      code: CHANNEL_SYNC_ERROR_CODES.STATUS_INVALID,
      field: 'from',
    };
  }
  if (typeof to !== 'string' || !VALID_SYNC_STATUSES.includes(to as SyncStatus)) {
    return {
      ok: false,
      error: `Statut to invalide (attendu: ${VALID_SYNC_STATUSES.join('|')})`,
      code: CHANNEL_SYNC_ERROR_CODES.STATUS_INVALID,
      field: 'to',
    };
  }
  if (from === to) {
    // Idempotence : même statut autorisé (no-op).
    return { ok: true };
  }
  const allowed = ALLOWED_TRANSITIONS[from as SyncStatus];
  if (!allowed.includes(to as SyncStatus)) {
    return {
      ok: false,
      error: `Transition interdite : ${from} → ${to}`,
      code: CHANNEL_SYNC_ERROR_CODES.TRANSITION_INVALID,
    };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// computeRetryDelay — exponential backoff borné.
//
// delay = min(BASE × 2^attempt, MAX_RETRY_DELAY_MS). attempt 0 ⇒ BASE,
// attempt 1 ⇒ 2×BASE, attempt 5 ⇒ 32×BASE, etc.
//
// Garde défensive : attempt < 0 ⇒ 0 (pas de retry) ; attempt non fini ⇒ BASE.
// ────────────────────────────────────────────────────────────────────────────

export function computeRetryDelay(attemptN: number): number {
  if (!Number.isFinite(attemptN)) return BASE_RETRY_DELAY_MS;
  if (attemptN < 0) return 0;
  if (attemptN > MAX_RETRY_ATTEMPTS) return MAX_RETRY_DELAY_MS;
  const exp = Math.pow(2, Math.round(attemptN));
  const delay = BASE_RETRY_DELAY_MS * exp;
  if (!Number.isFinite(delay)) return MAX_RETRY_DELAY_MS;
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(delay));
}

// ────────────────────────────────────────────────────────────────────────────
// parseChannelWebhook — extrait { kind, data } d'un payload externe.
//
// Détecte la nature de l'event (order/product/customer/refund/inventory) à
// partir des champs canoniques de chaque canal. Garde défensive : payload
// non-objet ⇒ error structuré.
//
// kind = 'order_created' | 'order_updated' | 'product_created' |
//        'product_updated' | 'inventory_updated' | 'refund_created' |
//        'customer_created' | 'unknown'.
// ────────────────────────────────────────────────────────────────────────────

export type WebhookKind =
  | 'order_created'
  | 'order_updated'
  | 'product_created'
  | 'product_updated'
  | 'inventory_updated'
  | 'refund_created'
  | 'customer_created'
  | 'unknown';

export interface ParsedWebhook {
  ok: boolean;
  kind?: WebhookKind;
  data?: Record<string, unknown>;
  error?: string;
  code?: ChannelSyncErrorCode;
}

export function parseChannelWebhook(
  channel: unknown,
  payload: unknown,
): ParsedWebhook {
  if (typeof channel !== 'string' || !VALID_CHANNELS_SYNC.includes(channel as ChannelKind)) {
    return {
      ok: false,
      error: `Canal invalide (attendu: ${VALID_CHANNELS_SYNC.join('|')})`,
      code: CHANNEL_SYNC_ERROR_CODES.CHANNEL_INVALID,
    };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      error: 'Payload webhook invalide (objet requis)',
      code: CHANNEL_SYNC_ERROR_CODES.WEBHOOK_PAYLOAD_INVALID,
    };
  }
  const p = payload as Record<string, unknown>;

  // Détection topic-based : Shopify expose 'topic' / Woo expose 'event'.
  const topic = String(p.topic ?? p.event ?? p.action ?? '')
    .toLowerCase()
    .trim();

  let kind: WebhookKind = 'unknown';
  if (topic) {
    if (topic.includes('orders/create') || topic === 'order.created' || topic === 'order_created') {
      kind = 'order_created';
    } else if (
      topic.includes('orders/update') ||
      topic === 'order.updated' ||
      topic === 'order_updated'
    ) {
      kind = 'order_updated';
    } else if (
      topic.includes('products/create') ||
      topic === 'product.created' ||
      topic === 'product_created'
    ) {
      kind = 'product_created';
    } else if (
      topic.includes('products/update') ||
      topic === 'product.updated' ||
      topic === 'product_updated'
    ) {
      kind = 'product_updated';
    } else if (topic.includes('inventory')) {
      kind = 'inventory_updated';
    } else if (topic.includes('refund')) {
      kind = 'refund_created';
    } else if (topic.includes('customer')) {
      kind = 'customer_created';
    }
  }

  // Heuristique fallback : si pas de topic, on devine depuis la forme.
  if (kind === 'unknown') {
    if (Array.isArray(p.line_items) || Array.isArray(p.lineItems)) {
      kind = 'order_created';
    } else if (p.variants != null || p.product_id != null) {
      kind = 'product_updated';
    } else if (p.refund_id != null || p.amount_refunded != null) {
      kind = 'refund_created';
    } else if (p.email != null && p.first_name != null) {
      kind = 'customer_created';
    }
  }

  if (kind === 'unknown') {
    return {
      ok: false,
      kind: 'unknown',
      data: p,
      error: 'Type de webhook inconnu (topic/forme non reconnu)',
      code: CHANNEL_SYNC_ERROR_CODES.WEBHOOK_KIND_UNKNOWN,
    };
  }
  return { ok: true, kind, data: p };
}

// ────────────────────────────────────────────────────────────────────────────
// validateSyncMapping — valide un mapping localId ↔ channelId pour un canal.
// ────────────────────────────────────────────────────────────────────────────

export interface MappingValidation {
  ok: boolean;
  error?: string;
  code?: ChannelSyncErrorCode;
  field?: string;
}

export function validateSyncMapping(
  localId: unknown,
  channelId: unknown,
  channel: unknown,
): MappingValidation {
  if (typeof localId !== 'string' || !localId.trim()) {
    return {
      ok: false,
      error: 'localId requis (string non vide)',
      code: CHANNEL_SYNC_ERROR_CODES.LOCAL_ID_INVALID,
      field: 'localId',
    };
  }
  if (typeof channelId !== 'string' || !channelId.trim()) {
    return {
      ok: false,
      error: 'channelId requis (string non vide)',
      code: CHANNEL_SYNC_ERROR_CODES.CHANNEL_ID_INVALID,
      field: 'channelId',
    };
  }
  if (typeof channel !== 'string' || !VALID_CHANNELS_SYNC.includes(channel as ChannelKind)) {
    return {
      ok: false,
      error: `Canal invalide (attendu: ${VALID_CHANNELS_SYNC.join('|')})`,
      code: CHANNEL_SYNC_ERROR_CODES.CHANNEL_INVALID,
      field: 'channel',
    };
  }
  // Anti-injection basique : limiter longueur.
  if (localId.length > 200 || channelId.length > 200) {
    return {
      ok: false,
      error: 'localId/channelId trop longs (max 200 chars)',
      code: CHANNEL_SYNC_ERROR_CODES.MAPPING_INVALID,
    };
  }
  return { ok: true };
}
