// ── Returns / RMA engine — Sprint E6 M2 helpers PURS (2026-05-26) ──────────-
//
// Helpers PURS (zéro I/O, zéro D1) pour renforcer la validation RMA. Additif :
// NE remplace PAS la logique handler existante (ecommerce-returns.ts), il
// fournit des bricks réutilisables (whitelist raisons, fenêtre retour, calcul
// remboursement).
//
// ⚠️ FRONTIÈRE RÉGULÉE — politique conso Québec/Canada résumée :
//   - Loi de protection du consommateur Québec (LPC) : pas de droit légal de
//     retour générique sur tout achat ; le commerçant FIXE sa politique. Pour
//     achats en ligne (contrat conclu à distance, art. 54.1+), annulation
//     possible dans 7 jours suivants la livraison si certaines obligations
//     d'information n'ont pas été respectées.
//   - Compromis SAFE pour Intralys : RETURN_WINDOW_DAYS = 14 (couvre LPC 7d +
//     marge marchande). Configurable côté handler si politique différente.

// ── Codes erreur stables ──────────────────────────────────────────────────-

export const RETURN_ERROR_CODES = {
  WINDOW_EXPIRED: 'window_expired',
  INVALID_REASON: 'invalid_reason',
  EMPTY_ITEMS: 'empty_items',
  ITEM_NOT_IN_ORDER: 'item_not_in_order',
  ITEM_NOT_DELIVERED: 'item_not_delivered',
  QUANTITY_OVER_DELIVERED: 'quantity_over_delivered',
  INVALID_QUANTITY: 'invalid_quantity',
  INVALID_AMOUNT: 'invalid_amount',
} as const;

export type ReturnErrorCode =
  (typeof RETURN_ERROR_CODES)[keyof typeof RETURN_ERROR_CODES];

// ── Constantes politiques ──────────────────────────────────────────────────-

/**
 * Fenêtre de retour standard Intralys : 14 jours suivant la livraison.
 * Compromis SAFE entre LPC Québec (7d annulation contrat à distance) et
 * pratiques courantes e-commerce (14-30j).
 */
export const RETURN_WINDOW_DAYS = 14;

/**
 * Whitelist des raisons RMA acceptées. Le handler peut accepter une raison
 * libre (texte) mais le code RMA structuré DOIT appartenir à cette liste.
 */
export const RMA_REASON_WHITELIST = [
  'defective',
  'wrong_item',
  'not_as_described',
  'damaged_in_transit',
  'no_longer_needed',
  'size_fit',
  'duplicate',
  'arrived_late',
  'quality_issue',
  'other',
] as const;

export type RmaReason = (typeof RMA_REASON_WHITELIST)[number];

// ── Helpers ────────────────────────────────────────────────────────────────-

/**
 * Vrai si la raison RMA structurée appartient à la whitelist.
 * NOTE : texte libre OK côté handler (note/reason long-form), mais le CODE
 * structuré reste contraint à la whitelist pour analytics/policy.
 */
export function validateRmaReason(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  return (RMA_REASON_WHITELIST as readonly string[]).includes(
    reason.trim().toLowerCase(),
  );
}

/**
 * Vrai si la commande est encore dans la fenêtre de retour.
 * Calcul DETERMINISTE en ms (anti DST / timezones).
 *
 * @param orderDate  date livraison (ou commande si pas de date livraison)
 * @param now        instant de référence (default Date.now())
 * @param windowDays défaut RETURN_WINDOW_DAYS
 */
export function isWithinReturnWindow(
  orderDate: Date | string | null,
  now: Date | string = new Date(),
  windowDays: number = RETURN_WINDOW_DAYS,
): boolean {
  if (orderDate == null) return false;
  const base = orderDate instanceof Date ? orderDate : new Date(orderDate);
  const ref = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(base.getTime()) || Number.isNaN(ref.getTime())) return false;
  if (!Number.isFinite(windowDays) || windowDays < 0) return false;
  const elapsedDays = (ref.getTime() - base.getTime()) / (24 * 60 * 60 * 1000);
  if (elapsedDays < 0) return false; // commande dans le futur = pas éligible
  return elapsedDays <= windowDays;
}

// ── Return items eligibility ───────────────────────────────────────────────-

export interface ReturnItemInput {
  order_item_id: string;
  quantity: number;
  restock?: boolean | number;
}

export interface OrderItemSnapshot {
  id: string;
  quantity: number;
  unit_price_cents?: number;
  delivered_quantity?: number;
}

export interface EligibleReturnItem {
  order_item_id: string;
  quantity: number;
  restock: 0 | 1;
}

export type ValidateReturnItemsResult =
  | { ok: true; eligibleItems: EligibleReturnItem[] }
  | {
      ok: false;
      error: string;
      field: string;
      code: ReturnErrorCode;
      offendingId?: string;
    };

/**
 * Valide la liste d'items à retourner contre le snapshot des order_items.
 *
 * Garde-fous :
 *   - 400 emptyItems si liste vide.
 *   - 400 invalidQuantity si quantité ≤ 0 ou non-int.
 *   - 404 itemNotInOrder si order_item_id absent du snapshot.
 *   - 409 quantityOverDelivered si quantity > delivered_quantity (PAS sur la
 *     commandée — on ne retourne que ce qui a été reçu).
 *
 * Aucune I/O — le handler reste responsable de charger le snapshot via D1.
 */
export function validateReturnItems(
  items: ReturnItemInput[] | unknown,
  orderItems: OrderItemSnapshot[],
): ValidateReturnItemsResult {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      ok: false,
      error: 'Précise au moins un article à retourner.',
      field: 'items',
      code: RETURN_ERROR_CODES.EMPTY_ITEMS,
    };
  }
  const snapshotById = new Map<string, OrderItemSnapshot>(
    orderItems.map((oi) => [oi.id, oi]),
  );

  const eligible: EligibleReturnItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i] as ReturnItemInput;
    const oid =
      typeof raw?.order_item_id === 'string' ? raw.order_item_id.trim() : '';
    const qty = Math.round(Number(raw?.quantity) || 0);

    if (!oid || qty < 1) {
      return {
        ok: false,
        error: `Ligne ${i + 1} invalide : order_item_id + quantity ≥ 1 requis.`,
        field: `items[${i}]`,
        code: RETURN_ERROR_CODES.INVALID_QUANTITY,
      };
    }

    const oi = snapshotById.get(oid);
    if (!oi) {
      return {
        ok: false,
        error: `Article ${oid} hors commande.`,
        field: `items[${i}].order_item_id`,
        code: RETURN_ERROR_CODES.ITEM_NOT_IN_ORDER,
        offendingId: oid,
      };
    }

    const delivered = Math.max(0, Math.round(oi.delivered_quantity ?? 0));
    if (delivered <= 0) {
      return {
        ok: false,
        error: `L'article ${oid} n'a pas été livré (impossible à retourner).`,
        field: `items[${i}]`,
        code: RETURN_ERROR_CODES.ITEM_NOT_DELIVERED,
        offendingId: oid,
      };
    }
    if (qty > delivered) {
      return {
        ok: false,
        error: `Quantité demandée ${qty} > quantité livrée ${delivered} pour l'article ${oid}.`,
        field: `items[${i}].quantity`,
        code: RETURN_ERROR_CODES.QUANTITY_OVER_DELIVERED,
        offendingId: oid,
      };
    }

    eligible.push({
      order_item_id: oid,
      quantity: qty,
      restock: raw?.restock === true || raw?.restock === 1 ? 1 : 0,
    });
  }

  return { ok: true, eligibleItems: eligible };
}

// ── Compute return refund (preview only — handler reste seul à débourser) ──-

export interface ReturnRefundBreakdownLine {
  order_item_id: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface ReturnRefundResult {
  amount: number;
  breakdown: ReturnRefundBreakdownLine[];
}

/**
 * Calcule le remboursement THÉORIQUE d'un retour à partir des items éligibles
 * et du snapshot order_items (unit_price_cents).
 *
 * ⚠️ PREVIEW UNIQUEMENT — le SEUL chemin financier reste handleCreateRefund
 * (recordRefundTransition est le SEUL décideur). Ce helper sert à afficher un
 * estimé côté admin / customer service AVANT d'engager le refund réel.
 */
export function computeReturnRefund(
  items: EligibleReturnItem[],
  originalOrder: OrderItemSnapshot[],
): ReturnRefundResult {
  const priceById = new Map<string, number>(
    originalOrder.map((oi) => [
      oi.id,
      Math.max(0, Math.round(oi.unit_price_cents ?? 0)),
    ]),
  );

  let amount = 0;
  const breakdown: ReturnRefundBreakdownLine[] = [];
  for (const it of items) {
    const unit = priceById.get(it.order_item_id) ?? 0;
    const qty = Math.max(0, Math.round(it.quantity));
    const line = unit * qty;
    amount += line;
    breakdown.push({
      order_item_id: it.order_item_id,
      quantity: qty,
      unit_price_cents: unit,
      line_total_cents: line,
    });
  }
  return { amount: Math.max(0, Math.round(amount)), breakdown };
}
