// ── Refunds engine — Sprint E6 M1 helpers PURS (2026-05-26) ────────────────-
//
// Helpers PURS (zéro I/O, zéro D1) pour renforcer la validation refund.
// Additif : NE remplace PAS handleCreateRefund (ecommerce-refunds.ts), il
// fournit des bricks pour les garde-fous montant / idempotence / raison.
//
// ⚠️ FRONTIÈRE RÉGULÉE — recordRefundTransition reste le SEUL décideur du
// financial_status. Ces helpers calculent SEULEMENT le résultat théorique
// d'une demande AVANT de l'engager (preview + validation).

// ── Codes erreur stables ──────────────────────────────────────────────────-

export const REFUND_ERROR_CODES = {
  AMOUNT_INVALID: 'amount_invalid',
  AMOUNT_OVER_PAID: 'amount_over_paid',
  CURRENCY_MISMATCH: 'currency_mismatch',
  INVALID_REASON: 'invalid_reason',
  ALREADY_FULL_REFUND: 'already_full_refund',
  NEGATIVE_REMAINING: 'negative_remaining',
} as const;

export type RefundErrorCode =
  (typeof REFUND_ERROR_CODES)[keyof typeof REFUND_ERROR_CODES];

// ── Whitelist raisons refund (analytics + policy) ──────────────────────────-

export const REFUND_REASON_WHITELIST = [
  'duplicate',
  'fraudulent',
  'requested_by_customer',
  'product_unavailable',
  'shipping_failure',
  'return_received',
  'dispute_lost',
  'goodwill',
  'other',
] as const;

export type RefundReason = (typeof REFUND_REASON_WHITELIST)[number];

// ── Helpers ────────────────────────────────────────────────────────────────-

/**
 * Vrai si la raison REFUND structurée appartient à la whitelist.
 * Le handler peut accepter une description texte libre (champ `reason` long-
 * form), mais le code structuré reste contraint pour reporting / analytics.
 */
export function validateRefundReason(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  return (REFUND_REASON_WHITELIST as readonly string[]).includes(
    reason.trim().toLowerCase(),
  );
}

// ── Amount validation ──────────────────────────────────────────────────────-

export interface ValidateRefundAmountResult {
  ok: boolean;
  remaining?: number;
  error?: string;
  code?: RefundErrorCode;
}

/**
 * Valide qu'un montant de remboursement demandé est :
 *   - entier ≥ 1 cent
 *   - + l'engagé existant ≤ orderTotal (payé)
 *
 * Retourne remaining = solde remboursable après cette opération (incl.
 * requestAmount). Money TOUJOURS en cents INTEGER.
 *
 * @param orderTotal       montant payé (cents)
 * @param alreadyRefunded  cumul refunds non-failed (pending+succeeded), cents
 * @param requestAmount    montant demandé, cents
 */
export function validateRefundAmount(
  orderTotal: number,
  alreadyRefunded: number,
  requestAmount: number,
): ValidateRefundAmountResult {
  const paid = Math.max(0, Math.round(orderTotal || 0));
  const engaged = Math.max(0, Math.round(alreadyRefunded || 0));
  const req = Math.round(requestAmount);

  if (!Number.isFinite(req) || req <= 0) {
    return {
      ok: false,
      error: 'Le montant à rembourser doit être strictement positif.',
      code: REFUND_ERROR_CODES.AMOUNT_INVALID,
    };
  }
  if (paid <= 0) {
    return {
      ok: false,
      error: 'Aucun montant payé à rembourser.',
      code: REFUND_ERROR_CODES.AMOUNT_OVER_PAID,
    };
  }
  if (engaged >= paid) {
    return {
      ok: false,
      error: `Cette commande est déjà entièrement remboursée (${engaged}/${paid} ¢).`,
      code: REFUND_ERROR_CODES.ALREADY_FULL_REFUND,
    };
  }
  if (engaged + req > paid) {
    return {
      ok: false,
      error: `Remboursement ${req} ¢ + engagé ${engaged} ¢ > payé ${paid} ¢.`,
      code: REFUND_ERROR_CODES.AMOUNT_OVER_PAID,
    };
  }

  const remaining = Math.max(0, paid - engaged - req);
  return { ok: true, remaining };
}

// ── Currency match ─────────────────────────────────────────────────────────-

/**
 * Vrai si refund.currency == payment.currency (case-insensitive, trim).
 * Money cross-currency interdit (pas de FX) — c'est une règle stricte E6.
 */
export function validateCurrencyMatch(
  paymentCurrency: unknown,
  refundCurrency: unknown,
): boolean {
  if (typeof paymentCurrency !== 'string' || typeof refundCurrency !== 'string') {
    return false;
  }
  return paymentCurrency.trim().toUpperCase() === refundCurrency.trim().toUpperCase();
}

// ── Idempotency key ────────────────────────────────────────────────────────-

/**
 * Génère une clé d'idempotence déterministe `refund:<orderId>:<attemptN>`.
 *
 * Le handler existant utilise `refund:<orderId>:<amount>:<seq>` ; cette
 * version simplifiée sert pour cas où le seq est suffisant (ex. retry HTTP
 * sur la même attempt). Compatible : 2 formats coexistent SAFE.
 *
 * @throws JAMAIS — entrée invalide produit une clé déterministe "_invalid"
 *         (à charge du handler de vérifier l'orderId avant d'appeler).
 */
export function idempotencyKey(orderId: unknown, attemptN: unknown): string {
  const oid = typeof orderId === 'string' && orderId.trim() ? orderId.trim() : '_invalid';
  const n = Math.max(0, Math.round(Number(attemptN) || 0));
  return `refund:${oid}:${n}`;
}

/**
 * Variante déterministe alignée handleCreateRefund existant :
 * `refund:<orderId>:<amount>:<seq>`. Anti double-remboursement (mêmes 3 inputs
 * → même clé → INSERT OR IGNORE no-op).
 */
export function idempotencyKeyWithAmount(
  orderId: unknown,
  requestedAmountCents: unknown,
  seq: unknown,
): string {
  const oid = typeof orderId === 'string' && orderId.trim() ? orderId.trim() : '_invalid';
  const amt = Math.max(0, Math.round(Number(requestedAmountCents) || 0));
  const s = Math.max(0, Math.round(Number(seq) || 0));
  return `refund:${oid}:${amt}:${s}`;
}
