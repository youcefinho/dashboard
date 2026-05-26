// ── Inventory engine — Sprint P0-6 (2026-05-26) ──────────────────────────────
//
// Helpers PURS de validation/calcul stock pour le module Inventory
// (ecommerce-inventory.ts). 100 % additif : ne touche aux signatures
// ni au comportement existant. Renforce les gaps :
//   - calcul `available = on_hand - reserved` (jamais négatif)
//   - seuil low-stock (alerte)
//   - validation de delta d'ajustement (sign + reason whitelist)
//   - validation de mouvement de stock (type + qty + warehouses transfer)
//
// Conventions du projet :
//   - Quantités INTEGER pures (pas de cents ici).
//   - PAS de throw — retours discriminés `{ ok, error? }`.
//   - Imports relatifs.

// ── Codes d'erreur figés ────────────────────────────────────────────────────

export const INVENTORY_ERROR_CODES = {
  DELTA_INVALID: 'delta_invalid',
  DELTA_ZERO: 'delta_zero',
  DELTA_NEGATIVE_UNALLOWED: 'delta_negative_unallowed',
  REASON_INVALID: 'reason_invalid',
  QTY_INVALID: 'qty_invalid',
  QTY_NEGATIVE: 'qty_negative',
  MOVEMENT_TYPE_INVALID: 'movement_type_invalid',
  TRANSFER_SAME_WAREHOUSE: 'transfer_same_warehouse',
  TRANSFER_MISSING_WAREHOUSE: 'transfer_missing_warehouse',
} as const;

export const VALID_ADJUSTMENT_REASONS = [
  'sale',
  'restock',
  'adjustment',
  'return',
  'reservation',
  'damage',
  'theft',
  'count_correction',
  'transfer_in',
  'transfer_out',
] as const;

export const VALID_MOVEMENT_TYPES = [
  'inbound', // arrivée fournisseur / restock
  'outbound', // vente / sortie
  'transfer', // déplacement inter-warehouse
  'adjustment', // correction manuelle
  'return', // retour client
] as const;

export type AdjustmentReason = (typeof VALID_ADJUSTMENT_REASONS)[number];
export type MovementType = (typeof VALID_MOVEMENT_TYPES)[number];

// ── Helpers exportés ────────────────────────────────────────────────────────

/**
 * Calcule la quantité réellement disponible (= on_hand - reserved).
 * PUR. Toujours >= 0 (un sur-réservé ne crée pas un négatif visible côté UX).
 */
export function computeAvailable(onHand: number, reserved: number): number {
  const h = Math.max(0, Math.round(Number(onHand) || 0));
  const r = Math.max(0, Math.round(Number(reserved) || 0));
  return Math.max(0, h - r);
}

/**
 * Vrai si `available <= threshold` (alerte stock faible).
 * PUR. threshold <= 0 désactive l'alerte (jamais "low").
 */
export function isLowStock(available: number, threshold: number): boolean {
  const a = Math.max(0, Math.round(Number(available) || 0));
  const t = Math.round(Number(threshold) || 0);
  if (t <= 0) return false;
  return a <= t;
}

/**
 * Valide un ajustement de stock (delta + reason). PUR.
 * - delta DOIT être un entier non nul.
 * - reason DOIT être dans la whitelist.
 * - si `current + delta < 0` ET `allowNegative === false` → refus.
 */
export function validateStockAdjustment(
  current: number,
  delta: number,
  reason: string,
  options?: { allowNegative?: boolean },
): { ok: boolean; error?: string } {
  if (!Number.isFinite(Number(delta))) {
    return { ok: false, error: INVENTORY_ERROR_CODES.DELTA_INVALID };
  }
  const d = Math.round(Number(delta));
  if (d === 0) {
    return { ok: false, error: INVENTORY_ERROR_CODES.DELTA_ZERO };
  }
  const r = (reason || '').toString().toLowerCase().trim();
  if (!(VALID_ADJUSTMENT_REASONS as readonly string[]).includes(r)) {
    return { ok: false, error: INVENTORY_ERROR_CODES.REASON_INVALID };
  }
  const allowNegative = options?.allowNegative === true;
  const newQty = (Math.round(Number(current) || 0)) + d;
  if (newQty < 0 && !allowNegative) {
    return { ok: false, error: INVENTORY_ERROR_CODES.DELTA_NEGATIVE_UNALLOWED };
  }
  return { ok: true };
}

export interface StockMovementInput {
  type?: string;
  qty?: number;
  fromWarehouse?: string | null;
  toWarehouse?: string | null;
}

/**
 * Valide un mouvement de stock multi-warehouse. PUR.
 *  - inbound  → toWarehouse requis
 *  - outbound → fromWarehouse requis
 *  - transfer → from + to requis, from !== to
 *  - adjustment / return → from OU to acceptés
 */
export function validateStockMovement(
  input: StockMovementInput,
): { ok: boolean; error?: string } {
  const type = (input.type || '').toString().toLowerCase().trim();
  if (!(VALID_MOVEMENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: INVENTORY_ERROR_CODES.MOVEMENT_TYPE_INVALID };
  }

  const qty = Number(input.qty);
  if (!Number.isFinite(qty)) {
    return { ok: false, error: INVENTORY_ERROR_CODES.QTY_INVALID };
  }
  if (qty <= 0) {
    return { ok: false, error: INVENTORY_ERROR_CODES.QTY_NEGATIVE };
  }

  const from = (input.fromWarehouse || '').toString().trim() || null;
  const to = (input.toWarehouse || '').toString().trim() || null;

  if (type === 'inbound' && !to) {
    return { ok: false, error: INVENTORY_ERROR_CODES.TRANSFER_MISSING_WAREHOUSE };
  }
  if (type === 'outbound' && !from) {
    return { ok: false, error: INVENTORY_ERROR_CODES.TRANSFER_MISSING_WAREHOUSE };
  }
  if (type === 'transfer') {
    if (!from || !to) {
      return { ok: false, error: INVENTORY_ERROR_CODES.TRANSFER_MISSING_WAREHOUSE };
    }
    if (from === to) {
      return { ok: false, error: INVENTORY_ERROR_CODES.TRANSFER_SAME_WAREHOUSE };
    }
  }

  return { ok: true };
}
