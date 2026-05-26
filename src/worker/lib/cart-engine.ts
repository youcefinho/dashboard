// ── Cart engine — Sprint P0-4 renforcement (2026-05-26) ────────────────────
//
// Helpers PURS (zéro D1, zéro réseau) extraits/complémentaires à
// `ecommerce-cart.ts` pour :
//   - génération token panier (32 hex, anti-replay).
//   - garde-fous expiration / abandon (calque industrie : 1h expiry, 24h
//     abandoned). Pas de purge DB ici : décisions de purge restent côté
//     `ecommerce-cart-recovery.ts` (qui consomme ces predicates).
//   - validation item panier (qty 1..99).
//   - dédup et merge items (consolide doublons variant_id).
//
// Politique :
//   - Aucun helper ne throw — résultats `{ ok, error? }` ou boolean.
//   - 100% additif : `ecommerce-cart.ts` génère ses tokens via
//     `cart_${crypto.randomUUID()}` — ces helpers proposent une variante
//     `generateCartToken()` 32 hex pure crypto, à adopter si Rochdi le
//     valide (sinon legacy reste, zéro régression).
//   - Multi-tenant : ce module ne touche PAS la DB. Le tenant restera
//     filtré côté handler (WHERE client_id = ?).

// ── Constantes contrat ──────────────────────────────────────────────────────

/** Durée de vie d'un panier inactif avant expiration (heures). */
export const CART_EXPIRY_HOURS = 1;
/** Délai avant qu'un panier soit considéré "abandonné" pour relance. */
export const ABANDONED_THRESHOLD_HOURS = 24;
/** Quantité min par item (anti-ligne vide). */
export const MIN_ITEM_QUANTITY = 1;
/** Quantité max par item (anti-DoS panier 999999×). */
export const MAX_ITEM_QUANTITY = 99;
/** Nombre max d'items distincts dans un panier (anti-DoS). */
export const MAX_CART_ITEMS = 200;
/** Longueur token panier (hex chars, 32 = 128 bits d'entropie). */
export const CART_TOKEN_HEX_LENGTH = 32;

/** Codes d'erreur stables (logs + audit + tests). */
export const CART_ERROR_CODES = {
  INVALID_VARIANT: 'INVALID_VARIANT',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  QUANTITY_TOO_LOW: 'QUANTITY_TOO_LOW',
  QUANTITY_TOO_HIGH: 'QUANTITY_TOO_HIGH',
  CART_EXPIRED: 'CART_EXPIRED',
  CART_FULL: 'CART_FULL',
  INVALID_TOKEN: 'INVALID_TOKEN',
} as const;

export type CartErrorCode = typeof CART_ERROR_CODES[keyof typeof CART_ERROR_CODES];

// ── Token generation ────────────────────────────────────────────────────────

/**
 * Génère un token panier 32 hex chars (128 bits d'entropie via crypto.getRandomValues).
 * Préfixe `cart_` ABSENT — diffère délibérément du format legacy
 * `cart_${randomUUID()}` (38 chars) pour permettre un future migration sans
 * collision. Les deux formats coexistent (legacy reste valide tant que le
 * handler le génère).
 *
 * Anti-replay : 128 bits = collision improbable même à 10⁹ tokens / jour.
 */
export function generateCartToken(): string {
  const bytes = new Uint8Array(CART_TOKEN_HEX_LENGTH / 2);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback (theoretical — Workers/Node 20+/browsers ont tous crypto).
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Vérifie qu'un token panier a une forme acceptable :
 *   - format legacy `cart_<uuid>` (38 chars, 'cart_' + 36 uuid) ;
 *   - format moderne 32 hex chars (issu de `generateCartToken`).
 * PUR — pas de DB. L'unicité est garantie par UNIQUE constraint côté D1.
 */
export function isValidCartToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  // Legacy: cart_ + 36 chars UUID v4 (8-4-4-4-12)
  if (/^cart_[0-9a-f-]{36}$/i.test(trimmed)) return true;
  // Moderne: 32 hex chars
  if (new RegExp(`^[0-9a-f]{${CART_TOKEN_HEX_LENGTH}}$`, 'i').test(trimmed)) return true;
  return false;
}

// ── Expiration / abandon predicates ─────────────────────────────────────────

export interface CartTimingRow {
  /** ISO datetime (D1 datetime('now')) ou ms timestamp. */
  updated_at?: string | number | null;
  /** ISO datetime ou ms timestamp ; fallback si updated_at absent. */
  created_at?: string | number | null;
  status?: string | null;
}

/** Parse robuste ISO string OU ms number en ms epoch. Retourne NaN si KO. */
function parseTimestamp(input: string | number | null | undefined): number {
  if (input == null) return NaN;
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  if (typeof input !== 'string') return NaN;
  const trimmed = input.trim();
  if (trimmed.length === 0) return NaN;
  // D1 datetime('now') retourne 'YYYY-MM-DD HH:MM:SS' (espace, sans tz) → UTC.
  const isoish = trimmed.includes('T') || /Z|[+-]\d{2}:?\d{2}$/.test(trimmed)
    ? trimmed
    : trimmed.replace(' ', 'T') + 'Z';
  const ms = Date.parse(isoish);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * `cart` est expiré si la dernière activité dépasse CART_EXPIRY_HOURS.
 * Utilise updated_at en priorité, sinon created_at, sinon retourne false
 * (impossible de juger → ne pas expirer par défaut, fail-open).
 *
 * status='converted' ⇒ jamais expiré (commande déjà créée).
 */
export function isCartExpired(
  cart: CartTimingRow,
  now: number = Date.now(),
  expiryHours: number = CART_EXPIRY_HOURS,
): boolean {
  if (cart?.status === 'converted') return false;
  const ref = parseTimestamp(cart?.updated_at) || parseTimestamp(cart?.created_at);
  if (!Number.isFinite(ref)) return false;
  const ageHours = (now - ref) / (1000 * 60 * 60);
  return ageHours > expiryHours;
}

/**
 * Un panier est "abandonné" (déclenche relance) si :
 *   - status='active' (non converti, non purgé) ;
 *   - dernière activité ≥ ABANDONED_THRESHOLD_HOURS (24h par défaut).
 * NB : abandoned ≠ expired (abandoned déclenche email recovery, expired
 * déclenche purge stock/réservation).
 */
export function isCartAbandoned(
  cart: CartTimingRow,
  now: number = Date.now(),
  thresholdHours: number = ABANDONED_THRESHOLD_HOURS,
): boolean {
  if (cart?.status !== 'active' && cart?.status != null) return false;
  const ref = parseTimestamp(cart?.updated_at) || parseTimestamp(cart?.created_at);
  if (!Number.isFinite(ref)) return false;
  const ageHours = (now - ref) / (1000 * 60 * 60);
  return ageHours >= thresholdHours;
}

// ── Item validation ─────────────────────────────────────────────────────────

export interface CartItemInput {
  variant_id?: unknown;
  quantity?: unknown;
}

/**
 * Valide un item panier (variant_id + quantity). PUR. Retourne aussi la
 * version normalisée dans `data` (variant_id string trim, quantity int clamp).
 */
export function validateCartItem(input: CartItemInput): {
  ok: boolean;
  code?: CartErrorCode;
  data?: { variant_id: string; quantity: number };
} {
  const variantId = input?.variant_id;
  if (typeof variantId !== 'string' || variantId.trim().length === 0) {
    return { ok: false, code: CART_ERROR_CODES.INVALID_VARIANT };
  }
  const trimmedId = variantId.trim();
  if (trimmedId.length > 100) {
    // Calque sanitizeInput(_, 100) du handler.
    return { ok: false, code: CART_ERROR_CODES.INVALID_VARIANT };
  }

  const rawQty = Number(input?.quantity);
  if (!Number.isFinite(rawQty) || !Number.isInteger(rawQty)) {
    return { ok: false, code: CART_ERROR_CODES.INVALID_QUANTITY };
  }
  if (rawQty < MIN_ITEM_QUANTITY) {
    return { ok: false, code: CART_ERROR_CODES.QUANTITY_TOO_LOW };
  }
  if (rawQty > MAX_ITEM_QUANTITY) {
    return { ok: false, code: CART_ERROR_CODES.QUANTITY_TOO_HIGH };
  }

  return { ok: true, data: { variant_id: trimmedId, quantity: rawQty } };
}

// ── Merge / dedupe items ────────────────────────────────────────────────────

export interface CartItemMerged {
  variant_id: string;
  quantity: number;
}

/**
 * Dédup une liste d'items par variant_id, SOMMANT les quantités. Préserve
 * l'ordre d'apparition (premier variant_id rencontré conserve sa position).
 * Items invalides (qty < 1 / variant_id manquant) sont SKIPPÉS silencieusement
 * (calque comportement défensif `ecommerce-cart.handleAddCartItem`).
 *
 * Le total cumulé d'une même variante est CAPPÉ à MAX_ITEM_QUANTITY pour
 * rester aligné avec validateCartItem (empêche un client malicieux d'envoyer
 * 50 + 50 = 100 et bypasser le cap 99).
 */
export function mergeCartItems(items: unknown): CartItemMerged[] {
  if (!Array.isArray(items)) return [];
  const map = new Map<string, number>();
  const order: string[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as CartItemInput;
    const variantId = typeof it.variant_id === 'string' ? it.variant_id.trim() : '';
    const qty = Number(it.quantity);
    if (!variantId || !Number.isFinite(qty) || qty < 1) continue;
    const intQty = Math.floor(qty);
    if (!map.has(variantId)) order.push(variantId);
    const prev = map.get(variantId) ?? 0;
    const next = Math.min(MAX_ITEM_QUANTITY, prev + intQty);
    map.set(variantId, next);
  }
  return order.map((id) => ({ variant_id: id, quantity: map.get(id) || 0 }));
}
