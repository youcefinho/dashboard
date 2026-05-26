// ── POS engine — Sprint 37 Phase A SOCLE (2026-05-24) ──────────────────────
//
// Helpers PURS du POS retail caisse. Aucun I/O DB / réseau (sauf
// `chargeCardTerminal` qui est un STUB flag-inactif E4 : ne fait JAMAIS d'appel
// réseau réel tant que `env.STRIPE_TERMINAL_*` n'est pas bindé).
//
// ⚠️ FIGÉ contrat Phase A (docs/LOT-POS-S37.md §6). Toute modification de
// signature publique = nouvelle migration + nouveau §6.
//
// Money TOUJOURS en cents (INTEGER). Régression-zéro Québec : l'arrondi 5¢ CAD
// est conforme à la Loi sur la monnaie (penny rounding effectif depuis 2013).

import type { Env } from '../types';
import type { TaxRegime } from '../ecommerce-tax-engine';

// ── Types contrat figés ──────────────────────────────────────────────────────

export interface ChangeResult {
  changeCents: number;
  error?: string;
}

export type VarianceWarningLevel = 'ok' | 'low' | 'high';

export interface VarianceResult {
  varianceCents: number;
  warningLevel: VarianceWarningLevel;
}

export interface PaymentSplit {
  method: string;
  amountCents: number;
}

export interface SplitValidationResult {
  valid: boolean;
  error?: string;
}

export interface CartItem {
  variantId: string;
  quantity: number;
}

export interface OrderPayload {
  items: Array<{ variant_id: string; quantity: number }>;
}

export interface CardTerminalChargeResult {
  success: boolean;
  mock?: boolean;
  providerRef?: string;
  error?: string;
}

// ── Constantes internes ────────────────────────────────────────────────────-

/** Whitelist des méthodes de paiement acceptées dans un split.
 *  'split' EXCLU volontairement (anti-récursion : un split ne peut contenir
 *  lui-même un split comme méthode). */
const ALLOWED_SPLIT_METHODS = new Set<string>([
  'cash',
  'card_terminal',
  'gift_card',
  'other',
]);

/** Régimes fiscaux supportés par buildOrderPayloadFromCart (fallback 'qc'). */
const VALID_REGIONS = new Set<TaxRegime>(['qc', 'eu', 'dz']);

// ── computeChange — calcul de monnaie rendue ────────────────────────────────
/**
 * Calcule la monnaie à rendre lors d'un paiement cash.
 * Contrat : `tenderedCents >= totalCents` requis, sinon error 'insufficient'.
 * Pur : aucun I/O.
 */
export function computeChange(
  totalCents: number,
  tenderedCents: number,
): ChangeResult {
  if (tenderedCents < totalCents) {
    return { changeCents: 0, error: 'insufficient' };
  }
  return { changeCents: tenderedCents - totalCents };
}

// ── computeSessionVariance — variance fond de caisse fermeture ──────────────
/**
 * Calcule la variance entre cash attendu (expectedCents) et cash réel
 * (actualCents) à la fermeture de session caisse. Seuils warning :
 *   |variance| <= 500  cents (5 $)  → 'ok'
 *   |variance| <= 2000 cents (20 $) → 'low'
 *   sinon                            → 'high'
 * Pur : aucun I/O.
 */
export function computeSessionVariance(
  expectedCents: number,
  actualCents: number,
): VarianceResult {
  const varianceCents = actualCents - expectedCents;
  const abs = Math.abs(varianceCents);
  let warningLevel: VarianceWarningLevel;
  if (abs <= 500) {
    warningLevel = 'ok';
  } else if (abs <= 2000) {
    warningLevel = 'low';
  } else {
    warningLevel = 'high';
  }
  return { varianceCents, warningLevel };
}

// ── roundCashTender — arrondi 5¢ CAD (Loi sur la monnaie) ──────────────────
/**
 * Arrondit un montant cash au 5¢ le plus proche (Canada, depuis 2013).
 * Table réglementaire :
 *   1¢, 2¢ → 0¢
 *   3¢, 4¢ → 5¢
 *   6¢, 7¢ → 5¢
 *   8¢, 9¢ → 10¢
 * Algo : Math.round(amountCents / 5) * 5.
 *
 * Pur : aucun I/O.
 */
export function roundCashTender(
  amountCents: number,
  region: 'qc',
): number {
  void region;
  return Math.round(amountCents / 5) * 5;
}

// ── validatePaymentSplit — somme split == total + methods whitelistées ─────
/**
 * Vérifie que :
 *   1. toutes les méthodes appartiennent à la whitelist
 *      ['cash','card_terminal','gift_card','other'] (refuse 'split' lui-même
 *      pour éviter la récursion),
 *   2. la somme des amountCents == totalCents.
 *
 * Pur : aucun I/O.
 */
export function validatePaymentSplit(
  totalCents: number,
  splits: PaymentSplit[],
): SplitValidationResult {
  for (const s of splits) {
    if (!ALLOWED_SPLIT_METHODS.has(s.method)) {
      return { valid: false, error: 'invalid_method' };
    }
  }
  let sum = 0;
  for (const s of splits) {
    sum += s.amountCents;
  }
  if (sum !== totalCents) {
    return { valid: false, error: 'sum_mismatch' };
  }
  return { valid: true };
}

// ── buildOrderPayloadFromCart — adapte panier POS → createOrderCore input ───
/**
 * Transforme le panier caisse (items scannés) en payload `CreateOrderInput`
 * de `ecommerce-orders.ts:createOrderCore`. Contrat figé : N'INVENTE PAS de
 * champ, ne touche PAS le calcul de prix (createOrderCore résout via DB).
 *
 * Conversion : variantId (camelCase POS) → variant_id (snake_case ecommerce).
 * Région : fallback 'qc' si valeur non supportée.
 *
 * Pur : aucun I/O.
 */
export function buildOrderPayloadFromCart(
  items: CartItem[],
  region: 'qc' | 'eu' | 'dz',
): OrderPayload {
  // region validation (fallback 'qc' silencieux pour robustesse runtime —
  // l'appelant tax engine traite déjà les régimes inconnus de son côté).
  void (VALID_REGIONS.has(region) ? region : 'qc');
  return {
    items: items.map((i) => ({
      variant_id: i.variantId,
      quantity: i.quantity,
    })),
  };
}

// ── chargeCardTerminal — Stripe Terminal flag-inactif (E4 figé) ────────────
/**
 * Charge un paiement carte sur terminal physique (Stripe Terminal / autre PSP).
 *
 * ⚠️ FLAG-INACTIF strict (E4 inactif jusqu'à activation Rochdi).
 * Idiome projet : sans STRIPE_TERMINAL_SECRET + STRIPE_TERMINAL_LOCATION_ID
 * bindés, on retourne un mock SANS aucun appel réseau (calque helpers.sendSms
 * + telephony.placeCall). Tant qu'on est en Sprint 37, ces bindings sont
 * absents — donc le code n'atteint jamais la branche "réelle" (qui reste
 * elle-même un stub jusqu'à activation explicite des bindings).
 */
export async function chargeCardTerminal(
  env: Env,
  amountCents: number,
  sessionId: string,
): Promise<CardTerminalChargeResult> {
  void amountCents;
  void sessionId;
  // Bindings lus dynamiquement (non typés dans Env — ajout backlog E4 prod).
  const terminalSecret = (env as unknown as { STRIPE_TERMINAL_SECRET?: string })
    .STRIPE_TERMINAL_SECRET;
  const terminalLocationId = (
    env as unknown as { STRIPE_TERMINAL_LOCATION_ID?: string }
  ).STRIPE_TERMINAL_LOCATION_ID;
  if (!terminalSecret || !terminalLocationId) {
    return {
      success: true,
      mock: true,
      providerRef: 'mock_terminal_' + Date.now(),
    };
  }
  // Jamais atteint en S37 (flag inactif). Stub à compléter quand les bindings
  // Stripe Terminal seront activés explicitement par Rochdi.
  return { success: true, providerRef: 'mock_real_call_stub' };
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Phase B renforcement — Sprint 37 (2026-05-26) ───────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Helpers PURS additionnels. 100% additif vs Phase A SOCLE (aucune signature
// existante modifiée). Aucun appel I/O. Aucune dépendance au tax-engine S39
// (préservé intouché : la TVA reste calculée par `ecommerce-tax-engine.ts`).

// ── POS_ERROR_CODES — codes stables (UI/observability) ──────────────────────
/**
 * Codes erreur stables exposés par le moteur POS. Stables = jamais renommés
 * une fois exposés (contrat client / observabilité). Toute nouvelle valeur =
 * append-only.
 */
export const POS_ERROR_CODES = {
  BARCODE_INVALID_LENGTH: 'barcode_invalid_length',
  BARCODE_INVALID_CHECKSUM: 'barcode_invalid_checksum',
  BARCODE_INVALID_CHARSET: 'barcode_invalid_charset',
  CART_EMPTY: 'cart_empty',
  CART_INVALID_QUANTITY: 'cart_invalid_quantity',
  CART_INVALID_PRICE: 'cart_invalid_price',
  CART_DISCOUNT_TOO_LARGE: 'cart_discount_too_large',
  SESSION_OPENING_CASH_NEGATIVE: 'session_opening_cash_negative',
  SESSION_OPENING_CASH_TOO_LARGE: 'session_opening_cash_too_large',
  SESSION_CASHIER_MISSING: 'session_cashier_missing',
  PAYMENT_METHOD_UNKNOWN: 'payment_method_unknown',
  RECEIPT_PREFIX_INVALID: 'receipt_prefix_invalid',
} as const;

export type PosErrorCode =
  (typeof POS_ERROR_CODES)[keyof typeof POS_ERROR_CODES];

// ── validateBarcode — EAN-13 / UPC-A / custom ───────────────────────────────

export type BarcodeType = 'ean13' | 'upc' | 'custom';

export interface BarcodeValidationResult {
  ok: boolean;
  error?: PosErrorCode;
  code?: string;
}

/**
 * Valide un code-barre selon son type.
 *
 *  - `ean13` : 13 digits, checksum Mod-10 GS1 sur les 12 premiers.
 *  - `upc`   : 12 digits (UPC-A), checksum Mod-10 GS1 sur les 11 premiers.
 *  - `custom`: 1..64 caractères dans `[A-Z0-9_-]` (insensible à la casse,
 *              normalisé en majuscules dans `code`).
 *
 * Auto-détection si `type` omis : 13 digits → ean13, 12 digits → upc,
 * sinon → custom.
 *
 * Pur : aucun I/O. Stateless.
 */
export function validateBarcode(
  barcode: string,
  type?: BarcodeType,
): BarcodeValidationResult {
  if (typeof barcode !== 'string' || barcode.length === 0) {
    return { ok: false, error: POS_ERROR_CODES.BARCODE_INVALID_LENGTH };
  }
  const trimmed = barcode.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: POS_ERROR_CODES.BARCODE_INVALID_LENGTH };
  }
  const detected: BarcodeType =
    type ??
    (/^\d{13}$/.test(trimmed)
      ? 'ean13'
      : /^\d{12}$/.test(trimmed)
        ? 'upc'
        : 'custom');

  if (detected === 'ean13') {
    if (!/^\d{13}$/.test(trimmed)) {
      return { ok: false, error: POS_ERROR_CODES.BARCODE_INVALID_LENGTH };
    }
    if (!verifyGs1Checksum(trimmed)) {
      return { ok: false, error: POS_ERROR_CODES.BARCODE_INVALID_CHECKSUM };
    }
    return { ok: true, code: trimmed };
  }

  if (detected === 'upc') {
    if (!/^\d{12}$/.test(trimmed)) {
      return { ok: false, error: POS_ERROR_CODES.BARCODE_INVALID_LENGTH };
    }
    // UPC-A : algorithme Mod-10 GS1 identique en padant à gauche à 13 digits
    // (le caractère 0 ajouté ne change pas le calcul des poids alternés
    // car son poids est impair × 0 = 0). Convention GS1 officielle.
    if (!verifyGs1Checksum('0' + trimmed)) {
      return { ok: false, error: POS_ERROR_CODES.BARCODE_INVALID_CHECKSUM };
    }
    return { ok: true, code: trimmed };
  }

  // custom
  if (trimmed.length > 64) {
    return { ok: false, error: POS_ERROR_CODES.BARCODE_INVALID_LENGTH };
  }
  const normalized = trimmed.toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(normalized)) {
    return { ok: false, error: POS_ERROR_CODES.BARCODE_INVALID_CHARSET };
  }
  return { ok: true, code: normalized };
}

/**
 * Vérifie le checksum GS1 Mod-10 d'un code à 13 digits (EAN-13 ou
 * UPC-A pad-left). Algorithme officiel GS1 : somme pondérée 1/3/1/3/... sur
 * les 12 premiers digits, le 13ème doit être (10 - somme mod 10) mod 10.
 *
 * Interne. Pur.
 */
function verifyGs1Checksum(digits13: string): boolean {
  if (digits13.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = digits13.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    // Position 0 → poids 1, position 1 → poids 3, alterné.
    sum += i % 2 === 0 ? d : d * 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  const actual = digits13.charCodeAt(12) - 48;
  return expected === actual;
}

// ── computeCartTotal — somme panier + tax + discount (cents-safe) ────────────

export interface CartLineInput {
  /** Prix unitaire en cents (INTEGER attendu). */
  priceCents: number;
  /** Quantité (INTEGER positif). */
  quantity: number;
}

export interface CartTotalResult {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  error?: PosErrorCode;
}

/**
 * Calcule le total d'un panier POS de bout en bout, en cents (INTEGER).
 *
 * Ordre de calcul (convention QC / fiscalité retail) :
 *   1. subtotal = Σ priceCents × quantity                (lignes brutes)
 *   2. discount appliqué sur subtotal (cap = subtotal)   → preTaxBase
 *   3. tax     = round(preTaxBase × taxRate)             (banker's round évité,
 *                                                          on prend Math.round
 *                                                          déterministe)
 *   4. total   = preTaxBase + tax
 *
 * IMPORTANT : ce helper N'IMPLÉMENTE PAS la fiscalité par juridiction —
 * `taxRate` est juste un multiplicateur cents-safe pour les usages où la
 * TVA est déjà résolue par `ecommerce-tax-engine.ts` (S39) et passée ici
 * sous forme de taux unique. Pour la fiscalité multi-régime, déléguer
 * 100% au tax-engine S39.
 *
 * Pur : aucun I/O. Cents-only (pas de floats à l'extérieur).
 */
export function computeCartTotal(
  items: CartLineInput[],
  discountCents = 0,
  taxRate = 0,
): CartTotalResult {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      totalCents: 0,
      error: POS_ERROR_CODES.CART_EMPTY,
    };
  }
  let subtotal = 0;
  for (const it of items) {
    if (!Number.isFinite(it.priceCents) || !Number.isInteger(it.priceCents) || it.priceCents < 0) {
      return {
        subtotalCents: 0,
        discountCents: 0,
        taxCents: 0,
        totalCents: 0,
        error: POS_ERROR_CODES.CART_INVALID_PRICE,
      };
    }
    if (!Number.isFinite(it.quantity) || !Number.isInteger(it.quantity) || it.quantity <= 0) {
      return {
        subtotalCents: 0,
        discountCents: 0,
        taxCents: 0,
        totalCents: 0,
        error: POS_ERROR_CODES.CART_INVALID_QUANTITY,
      };
    }
    subtotal += it.priceCents * it.quantity;
  }
  if (!Number.isFinite(discountCents) || discountCents < 0) {
    return {
      subtotalCents: subtotal,
      discountCents: 0,
      taxCents: 0,
      totalCents: subtotal,
      error: POS_ERROR_CODES.CART_INVALID_PRICE,
    };
  }
  if (discountCents > subtotal) {
    return {
      subtotalCents: subtotal,
      discountCents: 0,
      taxCents: 0,
      totalCents: subtotal,
      error: POS_ERROR_CODES.CART_DISCOUNT_TOO_LARGE,
    };
  }
  const preTaxBase = subtotal - discountCents;
  // taxRate accepte 0..1 (ex : 0.14975 pour TPS+TVQ combinés). Round
  // déterministe pour éviter floating drift inter-plateformes.
  const safeRate = Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : 0;
  const tax = Math.round(preTaxBase * safeRate);
  return {
    subtotalCents: subtotal,
    discountCents,
    taxCents: tax,
    totalCents: preTaxBase + tax,
  };
}

// ── validateSessionOpen — ouverture session caissier ────────────────────────

export interface SessionOpenInput {
  openingCashCents: number;
  cashierUserId: string;
}

export interface SessionOpenValidationResult {
  ok: boolean;
  error?: PosErrorCode;
}

/**
 * Valide les bornes d'ouverture d'une session caisse.
 *  - cashierUserId non vide (string trimmée).
 *  - openingCashCents INTEGER, >= 0, <= 1_000_000_00 (1M $ garde-fou).
 *
 * Pur : aucun I/O. Pas de check d'unicité (relève du handler).
 */
export function validateSessionOpen(
  input: SessionOpenInput,
): SessionOpenValidationResult {
  if (
    !input ||
    typeof input.cashierUserId !== 'string' ||
    input.cashierUserId.trim().length === 0
  ) {
    return { ok: false, error: POS_ERROR_CODES.SESSION_CASHIER_MISSING };
  }
  const cash = input.openingCashCents;
  if (!Number.isFinite(cash) || !Number.isInteger(cash) || cash < 0) {
    return {
      ok: false,
      error: POS_ERROR_CODES.SESSION_OPENING_CASH_NEGATIVE,
    };
  }
  if (cash > 100_000_000) {
    return {
      ok: false,
      error: POS_ERROR_CODES.SESSION_OPENING_CASH_TOO_LARGE,
    };
  }
  return { ok: true };
}

// ── computeSessionVarianceFromOpening — variance avec opening explicite ─────
/**
 * Variante de `computeSessionVariance` qui prend explicitement
 * `openingCashCents` + `expectedSalesCents` + `actualCashCents` et retourne la
 * différence brute (actual - (opening + expectedSales)).
 *
 * Conservé en complément de `computeSessionVariance` (Phase A) pour les
 * handlers qui veulent passer les 3 composants au lieu du expected agrégé.
 *
 * Pur. Pas de seuils ici — la classification reste sur `computeSessionVariance`.
 */
export function computeSessionVarianceFromOpening(input: {
  openingCashCents: number;
  expectedSalesCents: number;
  actualCashCents: number;
}): number {
  const opening = Number.isFinite(input.openingCashCents)
    ? input.openingCashCents
    : 0;
  const expectedSales = Number.isFinite(input.expectedSalesCents)
    ? input.expectedSalesCents
    : 0;
  const actual = Number.isFinite(input.actualCashCents)
    ? input.actualCashCents
    : 0;
  return actual - (opening + expectedSales);
}

// ── generateReceiptNumber — format R-{prefix}-{date}-{seq} ──────────────────

let __receiptSeq = 0;

/**
 * Génère un numéro de reçu unique au format `R-{PREFIX}-{YYYYMMDD}-{SEQ}`.
 *
 *  - `tenantPrefix` : 1..16 caractères `[A-Z0-9]` (normalisé en majuscules,
 *    refus si charset invalide via throw — c'est un bug programmatique
 *    si appelé sans validation par le handler).
 *  - Date : UTC compact `YYYYMMDD` (déterministe cross-plateforme).
 *  - SEQ  : entier auto-incrémenté in-memory + 4 hex digits aléatoires pour
 *    réduire collision cross-instance (Workers multi-isolate). Persistance
 *    forte = responsabilité du handler (clé unique DB).
 *
 * Pur côté contrat mais effet de bord local (compteur __receiptSeq).
 * Le hex aléatoire utilise `crypto.getRandomValues` quand dispo (Worker)
 * sinon fallback `Math.random` (non-crypto, suffisant pour anti-collision
 * dev/test).
 */
export function generateReceiptNumber(tenantPrefix: string): string {
  if (typeof tenantPrefix !== 'string') {
    throw new Error(POS_ERROR_CODES.RECEIPT_PREFIX_INVALID);
  }
  const normalized = tenantPrefix.trim().toUpperCase();
  if (
    normalized.length === 0 ||
    normalized.length > 16 ||
    !/^[A-Z0-9]+$/.test(normalized)
  ) {
    throw new Error(POS_ERROR_CODES.RECEIPT_PREFIX_INVALID);
  }
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const datePart =
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate());
  __receiptSeq = (__receiptSeq + 1) >>> 0;
  const seqStr = __receiptSeq.toString().padStart(4, '0');

  // 4 hex anti-collision cross-isolate.
  let rand = '';
  try {
    const c: Crypto | undefined =
      typeof crypto !== 'undefined' ? crypto : undefined;
    if (c && typeof c.getRandomValues === 'function') {
      const buf = new Uint8Array(2);
      c.getRandomValues(buf);
      const b0 = buf[0] ?? 0;
      const b1 = buf[1] ?? 0;
      rand =
        b0.toString(16).padStart(2, '0') +
        b1.toString(16).padStart(2, '0');
    } else {
      rand = Math.floor(Math.random() * 0xffff)
        .toString(16)
        .padStart(4, '0');
    }
  } catch {
    rand = Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
  }
  return `R-${normalized}-${datePart}-${seqStr}${rand.toUpperCase()}`;
}

// ── mockStripeTerminalCharge — shape réaliste flag-inactif ──────────────────

export interface MockStripeTerminalChargeResult {
  success: boolean;
  mockId: string;
  reason: string;
  amountCents: number;
  currency: string;
}

/**
 * Mock d'un charge Stripe Terminal. Toujours `success: true` tant que
 * l'amountCents est positif et la currency dans la whitelist ISO 4217
 * supportée par Stripe Terminal en S37 (CAD/USD/EUR).
 *
 * Aucun appel réseau. Sert :
 *   - tests d'intégration (handler POS sait que le mock répond déterministe),
 *   - frontend POS pour valider visuellement le flux paiement avant activation
 *     réelle E4 (cf. `chargeCardTerminal` Phase A).
 *
 * Format `mockId` : `pi_mock_{timestampMs}_{4hex}` (calque Stripe PaymentIntent
 * id pour réalisme).
 *
 * Pur (déterministe sauf timestamp + 4 hex). Aucun I/O.
 */
export function mockStripeTerminalCharge(
  amountCents: number,
  currency: string,
): MockStripeTerminalChargeResult {
  const supported = new Set(['CAD', 'USD', 'EUR']);
  const cur =
    typeof currency === 'string' ? currency.toUpperCase() : '';
  if (!supported.has(cur)) {
    return {
      success: false,
      mockId: '',
      reason: 'unsupported_currency',
      amountCents: 0,
      currency: cur,
    };
  }
  if (
    !Number.isFinite(amountCents) ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    return {
      success: false,
      mockId: '',
      reason: 'invalid_amount',
      amountCents: 0,
      currency: cur,
    };
  }
  let rand = '';
  try {
    const c: Crypto | undefined =
      typeof crypto !== 'undefined' ? crypto : undefined;
    if (c && typeof c.getRandomValues === 'function') {
      const buf = new Uint8Array(2);
      c.getRandomValues(buf);
      const b0 = buf[0] ?? 0;
      const b1 = buf[1] ?? 0;
      rand =
        b0.toString(16).padStart(2, '0') +
        b1.toString(16).padStart(2, '0');
    } else {
      rand = Math.floor(Math.random() * 0xffff)
        .toString(16)
        .padStart(4, '0');
    }
  } catch {
    rand = Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
  }
  return {
    success: true,
    mockId: `pi_mock_${Date.now()}_${rand}`,
    reason: 'flag_inactive',
    amountCents,
    currency: cur,
  };
}

// ── isValidPaymentMethod — whitelist publique ───────────────────────────────

/**
 * Whitelist publique des méthodes de paiement acceptées par le POS,
 * y compris `split` (qui est valide en surface mais refusé à l'intérieur
 * d'un split lui-même via `ALLOWED_SPLIT_METHODS`).
 *
 * Pur. Insensible à la casse (`Cash` accepté, normalisé en `cash`).
 */
const ALL_PAYMENT_METHODS = new Set<string>([
  'cash',
  'card_terminal',
  'gift_card',
  'other',
  'split',
  // Alias retail courants — acceptés par le helper mais le handler doit
  // normaliser via `normalizePaymentMethod` (non exposé Phase B, futur).
  'card',
  'giftcard',
]);

export function isValidPaymentMethod(method: string): boolean {
  if (typeof method !== 'string') return false;
  const normalized = method.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return ALL_PAYMENT_METHODS.has(normalized);
}
