// ── Inventory strategy engine — Sprint P0-6 (2026-05-26) ─────────────────────
//
// Helpers PURS d'allocation de stock par BATCH (FIFO / LIFO / FEFO) pour
// `ecommerce-inventory-strategy.ts`. 100 % additif : aucune signature
// existante modifiée — ces helpers servent à RENFORCER les nouvelles
// stratégies batch (multi-warehouse + perishables) sans toucher les
// stratégies `intralys_master / partitioned / shared_pool` existantes.
//
// Conventions :
//   - Quantités INTEGER pures.
//   - PAS de throw — retours discriminés.
//   - PAS d'I/O : les batches sont injectés (le caller lit depuis D1).
//   - Imports relatifs.

// ── Codes / enum figés ──────────────────────────────────────────────────────

export const STRATEGY_ERROR_CODES = {
  STRATEGY_INVALID: 'strategy_invalid',
  BATCH_INVALID: 'batch_invalid',
  BATCH_VARIANT_MISSING: 'batch_variant_missing',
  BATCH_QTY_INVALID: 'batch_qty_invalid',
  BATCH_DATE_INVALID: 'batch_date_invalid',
  BATCH_EXPIRY_BEFORE_RECEIPT: 'batch_expiry_before_receipt',
  QTY_INVALID: 'qty_invalid',
  QTY_NEGATIVE: 'qty_negative',
} as const;

export const VALID_STRATEGIES = ['fifo', 'lifo', 'fefo'] as const;
export type BatchStrategy = (typeof VALID_STRATEGIES)[number];

// ── Types ────────────────────────────────────────────────────────────────────

export interface InventoryBatch {
  id?: string;
  variant_id: string;
  qty: number;
  /** ISO date (received from supplier) — requis pour FIFO/LIFO. */
  received_at?: string | null;
  /** ISO date d'expiration — requis pour FEFO (perishables). */
  expiry?: string | null;
}

export interface AllocationItem {
  batchId?: string;
  variant_id: string;
  takenQty: number;
  /** Reste dispo sur le batch après prélèvement. */
  remainingInBatch: number;
}

export interface AllocationResult {
  allocated: AllocationItem[];
  /** Quantité non couverte (insufficient stock si > 0). */
  remaining: number;
  totalAllocated: number;
}

// ── Helpers internes ─────────────────────────────────────────────────────────

function isValidIsoDate(s: unknown): boolean {
  if (s == null) return false;
  if (typeof s !== 'string' || !s) return false;
  return Number.isFinite(Date.parse(s));
}

function isPositiveInt(n: unknown): boolean {
  if (!Number.isFinite(Number(n))) return false;
  const v = Number(n);
  return v > 0 && Number.isInteger(v);
}

function allocate(
  sortedBatches: InventoryBatch[],
  qty: number,
): AllocationResult {
  const target = Math.max(0, Math.round(Number(qty) || 0));
  let remaining = target;
  const allocated: AllocationItem[] = [];

  for (const b of sortedBatches) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.round(Number(b.qty) || 0));
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    allocated.push({
      batchId: b.id,
      variant_id: b.variant_id,
      takenQty: take,
      remainingInBatch: available - take,
    });
    remaining -= take;
  }

  return { allocated, remaining, totalAllocated: target - remaining };
}

// ── Helpers exportés ─────────────────────────────────────────────────────────

/**
 * FIFO : First In First Out. Trie par `received_at` ASC (les batches sans date
 * passent en queue, stables).
 */
export function allocateFifo(
  batches: InventoryBatch[],
  qty: number,
): AllocationResult {
  const sorted = [...batches].sort((a, b) => {
    const da = a.received_at ? Date.parse(a.received_at) : Number.POSITIVE_INFINITY;
    const db = b.received_at ? Date.parse(b.received_at) : Number.POSITIVE_INFINITY;
    return da - db;
  });
  return allocate(sorted, qty);
}

/**
 * LIFO : Last In First Out. Trie par `received_at` DESC (récents d'abord ;
 * batches sans date passent en queue, stables).
 */
export function allocateLifo(
  batches: InventoryBatch[],
  qty: number,
): AllocationResult {
  const sorted = [...batches].sort((a, b) => {
    const da = a.received_at ? Date.parse(a.received_at) : Number.NEGATIVE_INFINITY;
    const db = b.received_at ? Date.parse(b.received_at) : Number.NEGATIVE_INFINITY;
    return db - da;
  });
  return allocate(sorted, qty);
}

/**
 * FEFO : First Expiry First Out. Trie par `expiry` ASC (échéance la plus
 * proche d'abord — typique perishables). Batches sans expiry passent en queue.
 */
export function allocateFefo(
  batches: InventoryBatch[],
  qty: number,
): AllocationResult {
  const sorted = [...batches].sort((a, b) => {
    const da = a.expiry ? Date.parse(a.expiry) : Number.POSITIVE_INFINITY;
    const db = b.expiry ? Date.parse(b.expiry) : Number.POSITIVE_INFINITY;
    return da - db;
  });
  return allocate(sorted, qty);
}

/**
 * Dispatcher générique : choisit la stratégie via enum string. Retourne une
 * erreur si la stratégie est inconnue (no throw — discriminé via .strategy?).
 */
export function allocateByStrategy(
  strategy: string,
  batches: InventoryBatch[],
  qty: number,
): AllocationResult & { strategy?: BatchStrategy; error?: string } {
  const s = (strategy || '').toString().toLowerCase().trim();
  if (!(VALID_STRATEGIES as readonly string[]).includes(s)) {
    return {
      allocated: [],
      remaining: Math.max(0, Math.round(Number(qty) || 0)),
      totalAllocated: 0,
      error: STRATEGY_ERROR_CODES.STRATEGY_INVALID,
    };
  }
  const kind = s as BatchStrategy;
  if (kind === 'fifo') return { ...allocateFifo(batches, qty), strategy: kind };
  if (kind === 'lifo') return { ...allocateLifo(batches, qty), strategy: kind };
  return { ...allocateFefo(batches, qty), strategy: kind };
}

export interface BatchInput {
  variant_id?: string;
  qty?: number;
  received_at?: string | null;
  expiry?: string | null;
}

/**
 * Valide un batch (insertion / update). PUR.
 */
export function validateBatch(input: BatchInput): { ok: boolean; error?: string; field?: string } {
  const vid = (input.variant_id || '').toString().trim();
  if (!vid) {
    return {
      ok: false,
      error: STRATEGY_ERROR_CODES.BATCH_VARIANT_MISSING,
      field: 'variant_id',
    };
  }
  if (!isPositiveInt(input.qty)) {
    return {
      ok: false,
      error: STRATEGY_ERROR_CODES.BATCH_QTY_INVALID,
      field: 'qty',
    };
  }
  if (input.received_at != null && input.received_at !== '') {
    if (!isValidIsoDate(input.received_at)) {
      return {
        ok: false,
        error: STRATEGY_ERROR_CODES.BATCH_DATE_INVALID,
        field: 'received_at',
      };
    }
  }
  if (input.expiry != null && input.expiry !== '') {
    if (!isValidIsoDate(input.expiry)) {
      return {
        ok: false,
        error: STRATEGY_ERROR_CODES.BATCH_DATE_INVALID,
        field: 'expiry',
      };
    }
  }
  if (input.received_at && input.expiry) {
    const rec = Date.parse(String(input.received_at));
    const exp = Date.parse(String(input.expiry));
    if (Number.isFinite(rec) && Number.isFinite(exp) && exp < rec) {
      return {
        ok: false,
        error: STRATEGY_ERROR_CODES.BATCH_EXPIRY_BEFORE_RECEIPT,
        field: 'expiry',
      };
    }
  }
  return { ok: true };
}
