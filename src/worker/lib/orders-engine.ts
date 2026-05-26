// ── Orders engine — Sprint P0-4 renforcement (2026-05-26) ──────────────────
//
// Helpers PURS (zéro D1, zéro réseau) extraits/complémentaires à
// `ecommerce-orders.ts` pour :
//   - centraliser le calcul des totaux commande (subtotal, tax, shipping,
//     discount → total) SANS dupliquer la machine fiscale (déléguée à
//     `ecommerce-tax-engine.computeTax` côté handler).
//   - exposer la machine à états (`OrderStatus`) sous forme PURE testable.
//   - garde-fous d'annulation (canCancelOrder) — basée sur statut + âge.
//   - formattage numéro de commande (INV-YYYY-NNNNNN).
//
// Politique :
//   - Aucun helper ne throw — résultats `{ ok, error?, reason? }` (calque
//     engines existants : product-reviews-engine, loyalty-engine).
//   - 100% additif : `ecommerce-orders.ts` garde son STATUS_TRANSITIONS local
//     (ligne 462) — celui-ci en est une RÉPLIQUE PURE exposée pour tests +
//     futur ré-emploi. Les deux doivent rester synchronisés.
//   - Money TOUJOURS en cents INTEGER. Pas de FX (le moteur fiscal le gère).
//   - Codes d'erreur stables `ORDER_ERROR_CODES`.

// ── Types contrat figés (réplique partielle `worker/types`) ─────────────────

/**
 * Statuts commande — RÉPLIQUE EXACTE de `worker/lib/types.OrderStatus`.
 * À garder en sync si jamais on étend la machine côté handler.
 */
export const VALID_ORDER_STATUSES = Object.freeze([
  'pending',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const);

export type OrderStatus = typeof VALID_ORDER_STATUSES[number];

/**
 * Machine à états — RÉPLIQUE EXACTE de `ecommerce-orders.STATUS_TRANSITIONS`
 * (ligne 462). Si modifiée là-bas → modifier ici aussi (tests garderont la
 * sync via cross-check).
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = Object.freeze({
  pending: Object.freeze(['paid', 'cancelled'] as const),
  paid: Object.freeze(['preparing', 'cancelled', 'refunded'] as const),
  preparing: Object.freeze(['shipped', 'cancelled'] as const),
  shipped: Object.freeze(['delivered'] as const),
  delivered: Object.freeze(['refunded'] as const),
  cancelled: Object.freeze([] as const),
  refunded: Object.freeze([] as const),
});

/** Fenêtre par défaut d'annulation après création (heures). 0 = pas de fenêtre. */
export const CANCEL_WINDOW_HOURS = 0; // 0 = règle basée uniquement sur statut

/** Codes d'erreur stables (logs + audit + assertions tests). */
export const ORDER_ERROR_CODES = {
  EMPTY_ORDER: 'EMPTY_ORDER',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CANCEL_NOT_ALLOWED: 'CANCEL_NOT_ALLOWED',
  CANCEL_WINDOW_EXPIRED: 'CANCEL_WINDOW_EXPIRED',
  TOTAL_OVERFLOW: 'TOTAL_OVERFLOW',
  NEGATIVE_AMOUNT: 'NEGATIVE_AMOUNT',
  INVALID_ITEM: 'INVALID_ITEM',
} as const;

export type OrderErrorCode = typeof ORDER_ERROR_CODES[keyof typeof ORDER_ERROR_CODES];

// ── Totals computation ──────────────────────────────────────────────────────

export interface OrderItemInput {
  /** Prix unitaire en cents INTEGER. */
  unit_price_cents: number;
  /** Quantité ≥ 1. */
  quantity: number;
}

export interface OrderTotalsInput {
  items: OrderItemInput[];
  tax_cents?: number;
  shipping_cents?: number;
  discount_cents?: number;
  /** Si true, le tax_cents est déjà INCLUS dans le subtotal (UE) — pas ajouté. */
  tax_inclusive?: boolean;
}

export interface OrderTotalsResult {
  ok: boolean;
  code?: OrderErrorCode;
  data?: {
    subtotal_cents: number;
    tax_cents: number;
    shipping_cents: number;
    discount_cents: number;
    total_cents: number;
    breakdown: {
      items_subtotal: number;
      after_discount: number;
      with_tax: number;
      with_shipping: number;
    };
  };
}

/**
 * Cap garde-fou sur le total final (≤ MAX_PRICE_CENTS).
 * Aligné avec `lib/products-engine.MAX_PRICE_CENTS` (anti-overflow JS Number).
 */
const MAX_TOTAL_CENTS = 9_999_999_999_99;

/**
 * Calcule les totaux d'une commande de façon PURE et déterministe.
 *
 *   subtotal = Σ (item.unit_price × item.quantity)
 *   total_excl  = subtotal − discount + tax + shipping
 *   total_incl  = subtotal − discount + shipping   (tax déjà inclus subtotal)
 *
 * Toutes les valeurs en cents INTEGER. Garde-fous :
 *   - rejette commande vide ;
 *   - rejette montants négatifs (sauf discount qui DOIT être positif → soustrait) ;
 *   - rejette overflow (anti corruption Number ≥ 2^53).
 *
 * NB : la *machine fiscale* (TPS/TVQ/UE) est dans `ecommerce-tax-engine`.
 * Ce helper attend le `tax_cents` DÉJÀ calculé par ce moteur — il ne fait
 * QUE l'addition finale + breakdown traçable pour audit / facture.
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotalsResult {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, code: ORDER_ERROR_CODES.EMPTY_ORDER };
  }

  let subtotal = 0;
  for (const it of input.items) {
    const price = Number(it?.unit_price_cents);
    const qty = Number(it?.quantity);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) {
      return { ok: false, code: ORDER_ERROR_CODES.INVALID_ITEM };
    }
    if (price < 0) return { ok: false, code: ORDER_ERROR_CODES.NEGATIVE_AMOUNT };
    if (qty < 1) return { ok: false, code: ORDER_ERROR_CODES.INVALID_ITEM };
    if (!Number.isInteger(price) || !Number.isInteger(qty)) {
      return { ok: false, code: ORDER_ERROR_CODES.INVALID_ITEM };
    }
    subtotal += price * qty;
    if (subtotal > MAX_TOTAL_CENTS) {
      return { ok: false, code: ORDER_ERROR_CODES.TOTAL_OVERFLOW };
    }
  }

  const taxCents = Math.max(0, Math.round(Number(input.tax_cents) || 0));
  const shippingCents = Math.max(0, Math.round(Number(input.shipping_cents) || 0));
  const discountCents = Math.max(0, Math.round(Number(input.discount_cents) || 0));

  if ((Number(input.tax_cents) || 0) < 0) return { ok: false, code: ORDER_ERROR_CODES.NEGATIVE_AMOUNT };
  if ((Number(input.shipping_cents) || 0) < 0) return { ok: false, code: ORDER_ERROR_CODES.NEGATIVE_AMOUNT };
  if ((Number(input.discount_cents) || 0) < 0) return { ok: false, code: ORDER_ERROR_CODES.NEGATIVE_AMOUNT };

  // Discount ne peut pas dépasser le subtotal (sinon total négatif).
  const cappedDiscount = Math.min(discountCents, subtotal);
  const afterDiscount = subtotal - cappedDiscount;

  // tax-inclusive (UE) : taxe déjà dans subtotal → ne pas l'ajouter.
  const withTax = input.tax_inclusive ? afterDiscount : afterDiscount + taxCents;
  const withShipping = withTax + shippingCents;
  const total = Math.max(0, withShipping);

  if (total > MAX_TOTAL_CENTS) {
    return { ok: false, code: ORDER_ERROR_CODES.TOTAL_OVERFLOW };
  }

  return {
    ok: true,
    data: {
      subtotal_cents: subtotal,
      tax_cents: taxCents,
      shipping_cents: shippingCents,
      discount_cents: cappedDiscount,
      total_cents: total,
      breakdown: {
        items_subtotal: subtotal,
        after_discount: afterDiscount,
        with_tax: withTax,
        with_shipping: withShipping,
      },
    },
  };
}

// ── Status transition validation ────────────────────────────────────────────

/**
 * Indique si `to` est une transition légale depuis `from`. PUR — pas de DB.
 * Refuse les statuts inconnus + transitions absentes de la machine.
 */
export function validateOrderTransition(from: unknown, to: unknown): boolean {
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  if (!(VALID_ORDER_STATUSES as readonly string[]).includes(from)) return false;
  if (!(VALID_ORDER_STATUSES as readonly string[]).includes(to)) return false;
  if (from === to) return false; // pas de transition vers soi-même
  const allowed = ORDER_TRANSITIONS[from as OrderStatus] || [];
  return (allowed as readonly string[]).includes(to);
}

// ── Cancellation rules ──────────────────────────────────────────────────────

export interface CancelOrderInput {
  status: OrderStatus | string;
  /** ISO datetime ou ms timestamp ; null = pas de garde temporelle. */
  created_at?: string | number | null;
  /** Override fenêtre annulation (heures). Default = CANCEL_WINDOW_HOURS. */
  cancel_window_hours?: number;
  /** Now injectable pour tests déterministes. Default = Date.now(). */
  now_ms?: number;
}

/**
 * Détermine si une commande peut être annulée maintenant.
 * Règles :
 *   - statut terminal (cancelled / refunded) ⇒ refus ;
 *   - statut delivered ⇒ refus (utiliser refund) ;
 *   - shipped ⇒ refus (utiliser refund/return) ;
 *   - pending / paid / preparing ⇒ OK (sous réserve fenêtre temporelle si > 0) ;
 *   - autres / inconnus ⇒ refus.
 */
export function canCancelOrder(input: CancelOrderInput): {
  ok: boolean;
  reason?: OrderErrorCode;
} {
  const status = input.status;
  if (typeof status !== 'string' || !(VALID_ORDER_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, reason: ORDER_ERROR_CODES.INVALID_STATUS };
  }
  const cancellable: OrderStatus[] = ['pending', 'paid', 'preparing'];
  if (!cancellable.includes(status as OrderStatus)) {
    return { ok: false, reason: ORDER_ERROR_CODES.CANCEL_NOT_ALLOWED };
  }

  const windowHours = input.cancel_window_hours ?? CANCEL_WINDOW_HOURS;
  if (windowHours > 0 && input.created_at != null) {
    const createdMs = typeof input.created_at === 'number'
      ? input.created_at
      : Date.parse(String(input.created_at));
    if (Number.isFinite(createdMs)) {
      const now = input.now_ms ?? Date.now();
      const ageHours = (now - createdMs) / (1000 * 60 * 60);
      if (ageHours > windowHours) {
        return { ok: false, reason: ORDER_ERROR_CODES.CANCEL_WINDOW_EXPIRED };
      }
    }
  }
  return { ok: true };
}

// ── Order number formatting ─────────────────────────────────────────────────

/**
 * Formate un numéro de commande déterministe : `INV-YYYY-NNNNNN`.
 *   - year : 4 chiffres, fallback année courante si invalide ;
 *   - seq : entier ≥ 0, padded sur 6 chiffres (`000001` … `999999`) ;
 *   - séquence > 999999 ⇒ pas tronquée (rare, garde la valeur brute).
 *
 * NB : le handler legacy `ecommerce-orders.nextOrderNumber` utilise le format
 * `#NNNN` historique avec compteur D1 (atomique). Ce helper sert plutôt :
 *   - factures `ecommerce-invoice.ts` (format INV-YYYY-NNNNNN) ;
 *   - exports CSV ;
 *   - assertions tests / mocks.
 */
export function formatOrderNumber(seqId: unknown, year?: unknown): string {
  // Garde-fou : seq invalide ⇒ fallback complet (year 0000 + seq 000000).
  // null/undefined/string non numérique/négatif/float ⇒ tout 0.
  if (seqId == null) return 'INV-0000-000000';
  const seqNum = Number(seqId);
  if (!Number.isFinite(seqNum) || seqNum < 0 || !Number.isInteger(seqNum)) {
    return 'INV-0000-000000';
  }
  let y: number;
  if (typeof year === 'number' && Number.isFinite(year) && year >= 1000 && year <= 9999) {
    y = Math.floor(year);
  } else if (typeof year === 'string' && /^\d{4}$/.test(year)) {
    y = parseInt(year, 10);
  } else {
    y = new Date().getUTCFullYear();
  }
  const padded = String(seqNum).padStart(6, '0');
  return `INV-${y}-${padded}`;
}
