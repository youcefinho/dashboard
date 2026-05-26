// ── Gift card engine — Sprint 38 Phase B (2026-05-24) ──────────────────────
//
// Helpers PURS + helpers DB-touching pour le module cartes-cadeaux.
// Phase B (Agent A1) : corps réel implémenté. Signatures publiques INVARIANTES
// vs Phase A (contrat docs/LOT-GIFTCARDS-LOYALTY-S38.md §6).
//
// Money TOUJOURS en cents (INTEGER). Pas de FX, pas de conversion.
// Code generation : alphabet ambigu-safe (sans 0/O/1/I/L) — calque ecommerce-coupons.
// crypto.getRandomValues : Workers-compatible (pas de Node `crypto.randomBytes`).
// Idempotence STRICTE : (gift_card_id|order_id|type|amount) avant INSERT tx.
//
// ⚠️ FIGÉ contrat Phase A. Toute modification de signature publique = nouvelle
// migration + nouveau §6.

import type { Env } from '../types';
// D1Database is a Cloudflare Workers global type.

// ── Types contrat figés ──────────────────────────────────────────────────────

export type GiftCardTransactionType =
  | 'issue'
  | 'credit'
  | 'debit'
  | 'refund'
  | 'expire'
  | 'void';

export type GiftCardStatus = 'active' | 'redeemed' | 'expired' | 'voided';

export interface GiftCardRow {
  id: string;
  client_id: string;
  agency_id: string | null;
  code: string;
  initial_value_cents: number;
  current_balance_cents: number;
  currency: string;
  expires_at: string | null;
  issued_to_customer_id: string | null;
  issued_to_email: string | null;
  issued_by_user_id: string | null;
  issued_at: string | null;
  last_used_at: string | null;
  status: GiftCardStatus;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NewBalanceResult {
  newBalance: number;
  ok: boolean;
  error?: string;
}

export interface IssueGiftCardOpts {
  code?: string;
  expiresAt?: string | null;
  issuedToCustomerId?: string | null;
  issuedToEmail?: string | null;
  issuedByUserId?: string | null;
  notes?: string;
}

export interface ApplyTransactionResult {
  ok: boolean;
  transactionId?: string;
  newBalance?: number;
  error?: string;
}

// ── Constantes internes ────────────────────────────────────────────────────-

/**
 * Alphabet ambigu-safe (sans 0/O/1/I/L) pour génération de code.
 * 31 caractères : 22 lettres (A-Z sans I, L, O) + 9 chiffres (2-9).
 * ~5 bits/char × 16 chars = ~80 bits d'entropie.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 16;
const CODE_BLOCK_SIZE = 4;

/**
 * Regex validation : exactement 4 blocs de 4 caractères ambigu-safe séparés
 * par `-`. Reflète CODE_ALPHABET (sans I, L, O, 0, 1).
 */
const CODE_FORMAT_REGEX =
  /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

/** Types qui CRÉDITENT le solde (amount positif). */
const CREDIT_TYPES: ReadonlySet<GiftCardTransactionType> = new Set([
  'issue',
  'credit',
  'refund',
]);

/** Types qui DÉBITENT le solde (amount positif soustrait). */
const DEBIT_TYPES: ReadonlySet<GiftCardTransactionType> = new Set([
  'debit',
  'expire',
  'void',
]);

const MAX_CODE_GENERATION_RETRIES = 5;

// ── Helpers PURS (no I/O) ───────────────────────────────────────────────────

/**
 * Génère un code de carte-cadeau aléatoire cryptographiquement sûr.
 * Format : XXXX-XXXX-XXXX-XXXX (4 blocs de 4 caractères séparés par `-`).
 * Alphabet ambigu-safe (lisible à voix haute, sans confusion 0/O/1/I/L).
 * Source d'entropie : `crypto.getRandomValues` (Workers-compatible).
 *
 * Note : 16 chars × log2(31) ≈ 79.2 bits d'entropie. La collision probability
 * sur 1M de codes émis est ~1.7e-12 — retry collision géré côté `issueGiftCard`.
 */
export function generateGiftCardCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  const chars: string[] = [];
  for (let i = 0; i < CODE_LENGTH; i++) {
    const idx = bytes[i]! % CODE_ALPHABET.length;
    chars.push(CODE_ALPHABET[idx]!);
    if (i % CODE_BLOCK_SIZE === CODE_BLOCK_SIZE - 1 && i < CODE_LENGTH - 1) {
      chars.push('-');
    }
  }
  return chars.join('');
}

/**
 * Normalise un code utilisateur. Étapes :
 *   1. uppercase
 *   2. strip de tous les caractères non alphanumériques (espaces, tirets, etc.)
 *   3. si exactement 16 caractères → re-format XXXX-XXXX-XXXX-XXXX
 *   4. sinon retourne juste la version nettoyée (validation séparée via
 *      `validateCodeFormat`).
 *
 * Pur : aucun I/O. Aucune vérification d'appartenance à l'alphabet ici.
 */
export function normalizeCode(input: string): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === CODE_LENGTH) {
    return (
      cleaned.slice(0, 4) +
      '-' +
      cleaned.slice(4, 8) +
      '-' +
      cleaned.slice(8, 12) +
      '-' +
      cleaned.slice(12, 16)
    );
  }
  return cleaned;
}

/**
 * Vérifie qu'un code respecte le format XXXX-XXXX-XXXX-XXXX avec uniquement
 * des caractères de l'alphabet ambigu-safe (A-Z sans I/L/O, 2-9).
 * Pur : aucun I/O. À utiliser APRÈS `normalizeCode`.
 */
export function validateCodeFormat(code: string): boolean {
  if (typeof code !== 'string') return false;
  return CODE_FORMAT_REGEX.test(code);
}

/**
 * Calcule le nouveau solde après application d'une transaction.
 *
 * Règles :
 *   - amount DOIT être un entier strictement positif (les types portent
 *     déjà le signe — un débit s'exprime par `type: 'debit', amount: 500`).
 *   - issue/credit/refund → newBalance = current + amount
 *   - debit/expire/void   → newBalance = current - amount (refusé si < 0)
 *   - type inconnu        → ok: false, error 'invalid_type'
 *
 * Pur : aucun I/O.
 */
export function computeNewBalance(
  current: number,
  txType: GiftCardTransactionType,
  amount: number,
): NewBalanceResult {
  const cur = Math.max(0, Math.round(current || 0));
  const amt = Math.round(amount || 0);

  if (!Number.isFinite(amt) || amt <= 0) {
    return { newBalance: cur, ok: false, error: 'invalid_amount' };
  }

  if (CREDIT_TYPES.has(txType)) {
    return { newBalance: cur + amt, ok: true };
  }

  if (DEBIT_TYPES.has(txType)) {
    const next = cur - amt;
    if (next < 0) {
      return { newBalance: cur, ok: false, error: 'insufficient_balance' };
    }
    return { newBalance: next, ok: true };
  }

  return { newBalance: cur, ok: false, error: 'invalid_type' };
}

/**
 * Vérifie si une carte est expirée.
 *   - status === 'expired' → true
 *   - expires_at présent et < now → true
 *   - sinon false
 *
 * Pur : aucun I/O. Compare datetime ISO via `new Date()`.
 */
export function isExpired(card: {
  status?: GiftCardStatus | string | null;
  expires_at?: string | null;
}): boolean {
  if (!card) return false;
  if (card.status === 'expired') return true;
  if (!card.expires_at) return false;
  const exp = new Date(card.expires_at);
  if (Number.isNaN(exp.getTime())) return false;
  return exp < new Date();
}

/**
 * Compose la clé d'idempotence canonique pour une transaction carte-cadeau.
 * Convention : `${giftCardId}:${orderId ?? 'null'}:${type}`. JAMAIS de PII.
 *
 * Note : la signature historique du stub utilisait `gc:${id}|${order}|${type}`.
 * On adopte ici la convention demandée Phase B (`:` séparateur, `'null'` litéral
 * quand order absent) — appelée UNIQUEMENT par les nouveaux call-sites Phase B.
 */
export function pickIdempotencyKey(
  giftCardId: string,
  orderId: string | null | undefined,
  type: GiftCardTransactionType,
): string {
  return `${giftCardId}:${orderId ?? 'null'}:${type}`;
}

// ── Helpers DB-touching (Phase B) ──────────────────────────────────────────

const GIFT_CARD_COLS =
  'id, client_id, agency_id, code, initial_value_cents, current_balance_cents, ' +
  'currency, expires_at, issued_to_customer_id, issued_to_email, ' +
  'issued_by_user_id, issued_at, last_used_at, status, notes, ' +
  'created_at, updated_at';

/**
 * Lookup d'une carte par code, borné tenant. Le code reçu est normalisé
 * (uppercase + reformat XXXX-XXXX-XXXX-XXXX si applicable) AVANT lookup.
 * Retourne null si introuvable ou erreur DB (best-effort).
 */
export async function findCardByCode(
  db: D1Database,
  clientId: string,
  code: string,
): Promise<GiftCardRow | null> {
  if (!db || !clientId || !code) return null;
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  try {
    const row = (await db
      .prepare(
        `SELECT ${GIFT_CARD_COLS} FROM gift_cards
          WHERE client_id = ? AND code = ?
          LIMIT 1`,
      )
      .bind(clientId, normalized)
      .first()) as GiftCardRow | null;
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Émission d'une nouvelle carte-cadeau.
 *
 * Procédure :
 *   1. Génère un code unique (retry collision max 5 fois — proba ~1e-12/essai).
 *   2. INSERT gift_cards (id UUID, status='active', balance=initial).
 *   3. INSERT gift_card_transactions (type='issue', amount=initial,
 *      balance_after=initial, idempotency_key=`${cardId}:null:issue`).
 *
 * Validation amont :
 *   - initialValueCents > 0 (sinon error 'invalid_initial_value').
 *   - currency string non vide (default 'CAD' côté caller).
 *
 * Retourne `{ ok, cardId, code }` ou `{ ok:false, error }`. JAMAIS de throw.
 */
export async function issueGiftCard(
  db: D1Database,
  clientId: string,
  agencyId: string | null,
  initialValueCents: number,
  currency: string,
  opts: IssueGiftCardOpts,
): Promise<{ ok: boolean; cardId?: string; code?: string; error?: string }> {
  if (!db || !clientId) {
    return { ok: false, error: 'missing_tenant' };
  }
  const initial = Math.round(initialValueCents || 0);
  if (!Number.isFinite(initial) || initial <= 0) {
    return { ok: false, error: 'invalid_initial_value' };
  }
  const cur = (currency || 'CAD').toString().toUpperCase().trim() || 'CAD';

  // 1) Génère un code unique (retry collision borné).
  let code: string | null = null;
  if (opts?.code) {
    // Code fourni explicitement — on le normalise et vérifie format + unicité.
    const candidate = normalizeCode(opts.code);
    if (!validateCodeFormat(candidate)) {
      return { ok: false, error: 'invalid_code_format' };
    }
    const existing = await findCardByCode(db, clientId, candidate);
    if (existing) {
      return { ok: false, error: 'code_already_exists' };
    }
    code = candidate;
  } else {
    for (let i = 0; i < MAX_CODE_GENERATION_RETRIES; i++) {
      const candidate = generateGiftCardCode();
      try {
        const clash = (await db
          .prepare(
            `SELECT id FROM gift_cards WHERE client_id = ? AND code = ? LIMIT 1`,
          )
          .bind(clientId, candidate)
          .first()) as { id: string } | null;
        if (!clash) {
          code = candidate;
          break;
        }
      } catch {
        return { ok: false, error: 'db_unavailable' };
      }
    }
    if (!code) {
      return { ok: false, error: 'code_generation_failed' };
    }
  }

  const cardId = crypto.randomUUID();
  const txId = crypto.randomUUID();
  const idempKey = pickIdempotencyKey(cardId, null, 'issue');

  try {
    await db
      .prepare(
        `INSERT INTO gift_cards
           (id, client_id, agency_id, code, initial_value_cents,
            current_balance_cents, currency, expires_at,
            issued_to_customer_id, issued_to_email, issued_by_user_id,
            issued_at, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 datetime('now'), 'active', ?, datetime('now'), datetime('now'))`,
      )
      .bind(
        cardId,
        clientId,
        agencyId,
        code,
        initial,
        initial,
        cur,
        opts?.expiresAt ?? null,
        opts?.issuedToCustomerId ?? null,
        opts?.issuedToEmail ?? null,
        opts?.issuedByUserId ?? null,
        opts?.notes ?? '',
      )
      .run();

    await db
      .prepare(
        `INSERT INTO gift_card_transactions
           (id, gift_card_id, client_id, order_id, amount_cents, type,
            balance_after_cents, idempotency_key, created_by_user_id, created_at)
         VALUES (?, ?, ?, NULL, ?, 'issue', ?, ?, ?, datetime('now'))`,
      )
      .bind(
        txId,
        cardId,
        clientId,
        initial,
        initial,
        idempKey,
        opts?.issuedByUserId ?? null,
      )
      .run();

    return { ok: true, cardId, code };
  } catch {
    return { ok: false, error: 'insert_failed' };
  }
}

/**
 * Application d'une transaction sur une carte-cadeau, idempotente.
 *
 * Procédure :
 *   1. Idempotence : SELECT tx existante par (card_id, order_id, type,
 *      amount_cents). Si trouvée → no-op, return solde courant.
 *   2. Load carte → current_balance + status.
 *   3. Garde : carte introuvable / expirée / voidée → erreur.
 *   4. computeNewBalance(current, type, amount). Si !ok → erreur.
 *   5. INSERT tx (avec idempotency_key) + UPDATE gift_cards.current_balance
 *      + last_used_at + updated_at.
 *
 * JAMAIS de throw — toute erreur DB → `{ ok:false, error:'db_unavailable' }`.
 */
export async function applyTransaction(
  db: D1Database,
  cardId: string,
  type: GiftCardTransactionType,
  amountCents: number,
  orderId: string | null,
  userId: string | null,
  idempKey: string,
): Promise<ApplyTransactionResult> {
  if (!db || !cardId || !type) {
    return { ok: false, error: 'missing_args' };
  }
  const amt = Math.round(amountCents || 0);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error: 'invalid_amount' };
  }

  // 1) Idempotence : tx déjà appliquée pour ce (card, order, type, amount) ?
  try {
    const existing = (await db
      .prepare(
        `SELECT id, balance_after_cents FROM gift_card_transactions
          WHERE gift_card_id = ?
            AND COALESCE(order_id, '') = COALESCE(?, '')
            AND type = ?
            AND amount_cents = ?
          LIMIT 1`,
      )
      .bind(cardId, orderId, type, amt)
      .first()) as { id: string; balance_after_cents: number } | null;
    if (existing) {
      return {
        ok: true,
        transactionId: existing.id,
        newBalance: existing.balance_after_cents,
      };
    }
  } catch {
    return { ok: false, error: 'db_unavailable' };
  }

  // 2) Load carte (status + balance).
  let card: GiftCardRow | null = null;
  try {
    card = (await db
      .prepare(
        `SELECT ${GIFT_CARD_COLS} FROM gift_cards WHERE id = ? LIMIT 1`,
      )
      .bind(cardId)
      .first()) as GiftCardRow | null;
  } catch {
    return { ok: false, error: 'db_unavailable' };
  }
  if (!card) {
    return { ok: false, error: 'card_not_found' };
  }

  // 3) Gardes statut.
  if (card.status === 'voided') {
    return { ok: false, error: 'card_voided' };
  }
  // Pour les opérations de DÉBIT, refuser carte expirée. Les opérations de
  // crédit (refund/credit) restent permises pour réajuster un solde après
  // expiration éventuelle — caller décide via le `type`.
  if (DEBIT_TYPES.has(type) && isExpired(card)) {
    return { ok: false, error: 'card_expired' };
  }

  // 4) Compute new balance.
  const current = Math.max(0, Math.round(card.current_balance_cents || 0));
  const res = computeNewBalance(current, type, amt);
  if (!res.ok) {
    return { ok: false, error: res.error || 'invalid_transition' };
  }

  // 5) INSERT tx + UPDATE carte.
  const txId = crypto.randomUUID();
  // Détermine le nouveau statut si débit consomme tout le solde.
  const newStatus: GiftCardStatus =
    res.newBalance === 0 && DEBIT_TYPES.has(type) && type !== 'void'
      ? 'redeemed'
      : type === 'void'
        ? 'voided'
        : card.status;

  try {
    await db
      .prepare(
        `INSERT INTO gift_card_transactions
           (id, gift_card_id, client_id, order_id, amount_cents, type,
            balance_after_cents, idempotency_key, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .bind(
        txId,
        cardId,
        card.client_id,
        orderId,
        amt,
        type,
        res.newBalance,
        idempKey,
        userId,
      )
      .run();

    await db
      .prepare(
        `UPDATE gift_cards
            SET current_balance_cents = ?,
                status = ?,
                last_used_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(res.newBalance, newStatus, cardId)
      .run();

    return { ok: true, transactionId: txId, newBalance: res.newBalance };
  } catch {
    return { ok: false, error: 'db_unavailable' };
  }
}

/**
 * Recalcule le solde courant d'une carte depuis le ledger (rebuild safe).
 * Replay des transactions : credits (issue/credit/refund) − débits
 * (debit/expire/void). Aucun UPDATE — purement diagnostic / audit.
 *
 * Retourne `{ ok:true, balanceCents }` ou `{ ok:false, error }`.
 */
export async function recomputeBalance(
  db: D1Database,
  cardId: string,
): Promise<{ ok: boolean; balanceCents?: number; error?: string }> {
  if (!db || !cardId) {
    return { ok: false, error: 'missing_args' };
  }
  try {
    const row = (await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN type IN ('issue','credit','refund')
                              THEN amount_cents ELSE 0 END), 0) AS credits,
           COALESCE(SUM(CASE WHEN type IN ('debit','expire','void')
                              THEN amount_cents ELSE 0 END), 0) AS debits
           FROM gift_card_transactions
          WHERE gift_card_id = ?`,
      )
      .bind(cardId)
      .first()) as { credits: number; debits: number } | null;
    if (!row) {
      return { ok: true, balanceCents: 0 };
    }
    const balance = Math.max(
      0,
      Math.round(Number(row.credits || 0) - Number(row.debits || 0)),
    );
    return { ok: true, balanceCents: balance };
  } catch {
    return { ok: false, error: 'db_unavailable' };
  }
}

// Note : `Env` import préservé pour Phase B (lectures binding R2/KV/secrets éventuelles).
void (null as unknown as Env);

// ════════════════════════════════════════════════════════════════════════════
// ── Sprint 38 Hardening (2026-05-26) — additive helpers, NO breaking change ─
// ════════════════════════════════════════════════════════════════════════════
//
// Helpers PURS supplémentaires : validation format simple (`GC-XXXX-XXXX-XXXX-XXXX`),
// charge application sans nécessiter de transaction DB, expiry pure check,
// codes d'erreur stables.
//
// Coexistent avec `normalizeCode` / `validateCodeFormat` / `computeNewBalance` /
// `isExpired` ci-dessus — signatures différentes (préfixe `GC-` requis ici,
// charge en montant amount unique vs computeNewBalance qui prend un type).
//
// Use-cases :
//   - Pré-checkout : `validateGiftCardCode()` + `applyGiftCardCharge()` pour
//     un dry-run de paiement partiel sans toucher la DB.
//   - Admin tool : `generateGiftCardCode()` réutilisable, version préfixée `GC-`
//     pour différencier visuellement des coupons (`CP-`) et codes affiliés (`AF-`).

/** Codes d'erreur normalisés (gift cards). Strings stables pour i18n + status. */
export const GIFTCARD_ERROR_CODES = {
  INVALID_FORMAT: 'invalid_format',
  CARD_NOT_FOUND: 'card_not_found',
  CARD_EXPIRED: 'card_expired',
  CARD_VOIDED: 'card_voided',
  CARD_REDEEMED: 'card_redeemed',
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  INVALID_AMOUNT: 'invalid_amount',
  AMOUNT_OVER_BALANCE: 'amount_over_balance',
} as const;

export type GiftCardErrorCode =
  (typeof GIFTCARD_ERROR_CODES)[keyof typeof GIFTCARD_ERROR_CODES];

/**
 * Format prefix-tagged GC : `GC-XXXX-XXXX-XXXX-XXXX` (16 chars + 3 tirets,
 * préfixe `GC-`). Hex uppercase strict pour différencier visuellement des
 * codes coupons/affiliés et faciliter le support client (lecture à voix haute).
 *
 * Note : ce format diffère de `generateGiftCardCode()` ci-dessus (alphabet
 * ambigu-safe, sans préfixe). À utiliser pour les NOUVELLES émissions admin/UI
 * — `generateGiftCardCode()` reste l'option canonique côté `issueGiftCard()`.
 */
const GC_PREFIX = 'GC';
const GC_HEX_BLOCK = 4;
const GC_HEX_BLOCKS_COUNT = 4;
const GC_PREFIXED_FORMAT_REGEX = /^GC-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

/**
 * Génère un code carte-cadeau préfixé `GC-XXXX-XXXX-XXXX-XXXX` (hex uppercase).
 * Source d'entropie : `crypto.getRandomValues` (Workers-compatible).
 * 16 chars hex × 4 bits = 64 bits d'entropie.
 *
 * Distinct de `generateGiftCardCode()` (alphabet ambigu-safe, non-préfixé).
 */
export function generateGiftCardCodePrefixed(): string {
  const bytes = new Uint8Array(GC_HEX_BLOCK * GC_HEX_BLOCKS_COUNT / 2);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const blocks: string[] = [];
  for (let i = 0; i < GC_HEX_BLOCKS_COUNT; i++) {
    blocks.push(hex.slice(i * GC_HEX_BLOCK, (i + 1) * GC_HEX_BLOCK));
  }
  return `${GC_PREFIX}-${blocks.join('-')}`;
}

/**
 * Validate format préfixé `GC-XXXX-XXXX-XXXX-XXXX` (hex uppercase strict).
 *
 * Retourne `{ ok: true }` si valide, `{ ok: false, error, code }` sinon.
 * Pur. Aucune lookup DB — code uniqueness se vérifie côté `issueGiftCard()`.
 */
export function validateGiftCardCode(
  code: string,
): { ok: true } | { ok: false; error: string; code: GiftCardErrorCode } {
  if (typeof code !== 'string' || code.length === 0) {
    return {
      ok: false,
      error: 'code required (string)',
      code: GIFTCARD_ERROR_CODES.INVALID_FORMAT,
    };
  }
  // Accepte aussi le format non-préfixé canonique (CODE_FORMAT_REGEX) si applicable —
  // on prend le plus permissif pour rétro-compat avec les codes émis avant
  // l'introduction du préfixe `GC-`.
  if (GC_PREFIXED_FORMAT_REGEX.test(code) || CODE_FORMAT_REGEX.test(code)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: 'code does not match GC-XXXX-XXXX-XXXX-XXXX format',
    code: GIFTCARD_ERROR_CODES.INVALID_FORMAT,
  };
}

/**
 * Applique une charge (debit) sur un solde de carte-cadeau, SANS toucher la DB.
 *
 * Inputs :
 *   - balance      : solde courant cents (entier >= 0)
 *   - chargeAmount : montant à débiter cents (entier > 0)
 *
 * Comportement :
 *   - Refuse les inputs invalides → `{ ok:false, error, code }`.
 *   - Refuse over-balance : on ne PARTIALISE PAS automatiquement.
 *     Caller doit explicitement demander un partial via `min(balance, charge)`.
 *
 * Use case : dry-run de paiement partiel avant tx réelle, ou flow checkout
 * multi-cartes (split payment) où chaque carte se débite sans I/O entre les
 * étapes de calcul.
 *
 * Retours :
 *   { ok:true, newBalance, charged }
 *   { ok:false, error, code }
 */
export function applyGiftCardCharge(
  balance: number,
  chargeAmount: number,
):
  | { ok: true; newBalance: number; charged: number }
  | { ok: false; error: string; code: GiftCardErrorCode } {
  const bal = Math.round(balance);
  const amt = Math.round(chargeAmount);

  if (!Number.isFinite(bal) || bal < 0) {
    return {
      ok: false,
      error: 'balance must be non-negative integer',
      code: GIFTCARD_ERROR_CODES.INVALID_AMOUNT,
    };
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    return {
      ok: false,
      error: 'chargeAmount must be positive integer',
      code: GIFTCARD_ERROR_CODES.INVALID_AMOUNT,
    };
  }
  if (amt > bal) {
    return {
      ok: false,
      error: `charge ${amt} exceeds balance ${bal}`,
      code: GIFTCARD_ERROR_CODES.AMOUNT_OVER_BALANCE,
    };
  }
  return { ok: true, newBalance: bal - amt, charged: amt };
}

/**
 * Vérifie si une carte est expirée à `nowDate`.
 *
 * Différences vs `isExpired()` ci-dessus :
 *   - Prend `nowDate` explicitement (testable, deterministic).
 *   - Ignore `status` (regarde UNIQUEMENT `expires_at`) — permet de check
 *     l'expiry « pure date » sans interférence du statut applicatif.
 *
 * Pur. Retourne false si `expires_at` absent ou invalide.
 */
export function isGiftCardExpired(
  card: { expires_at?: string | null },
  nowDate: string | Date = new Date(),
): boolean {
  if (!card || !card.expires_at) return false;
  const exp = new Date(card.expires_at);
  if (Number.isNaN(exp.getTime())) return false;
  const now = nowDate instanceof Date ? nowDate : new Date(nowDate);
  if (Number.isNaN(now.getTime())) return false;
  return exp.getTime() <= now.getTime();
}
