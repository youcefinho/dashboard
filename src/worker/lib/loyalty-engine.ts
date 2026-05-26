// ── Loyalty engine — Sprint 38 Phase B (2026-05-24) ──────────────────────────
//
// Helpers PURS + helpers DB-touching pour le module fidélité.
// Phase A a figé les signatures publiques (contrat docs/LOT-GIFTCARDS-LOYALTY-S38.md §6).
// Phase B (ce fichier) remplit la logique réelle SANS toucher aux signatures.
//
// Points TOUJOURS en INTEGER signé (positif=earn, négatif=redeem/expire).
// Money TOUJOURS en cents (INTEGER). Pas de FX.
// Idempotence stricte via SELECT-before-INSERT sur idempotency_key.
//
// ⚠️ FIGÉ contrat Phase A. Toute modification de signature publique = nouvelle
// migration + nouveau §6.

import type { Env } from '../types';
// D1Database is a Cloudflare Workers global type.

// ── Types contrat figés ──────────────────────────────────────────────────────

export type LoyaltyLedgerType =
  | 'earn'
  | 'redeem'
  | 'adjust'
  | 'expire'
  | 'tier_bonus';

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | string;

export interface LoyaltyProgramRow {
  id: string;
  client_id: string;
  agency_id: string | null;
  name: string;
  currency: string;
  earn_rate_per_dollar: number;
  redeem_rate_cents_per_point: number;
  min_redeem_points: number;
  points_expiry_days: number | null;
  tier_thresholds_json: string | null;
  tier_benefits_json: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface LoyaltyStateRow {
  id: string;
  program_id: string;
  client_id: string;
  customer_id: string;
  current_balance: number;
  lifetime_earned: number;
  current_tier: string;
  tier_updated_at: string | null;
  last_earn_at: string | null;
  last_redeem_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface RecordLedgerInput {
  programId: string;
  clientId: string;
  customerId: string;
  points: number;
  type: LoyaltyLedgerType;
  sourceOrderId?: string | null;
  idempotencyKey?: string | null;
  tierSnapshot?: string;
  expiresAt?: string | null;
  createdByUserId?: string | null;
}

// ── Helpers PURS (no I/O) ───────────────────────────────────────────────────

/**
 * Calcule les points gagnés pour un sous-total donné, modulé par le multiplier tier.
 * Pur. dollars = subtotalCents / 100 ; base = dollars * earnRatePerDollar ;
 * earned = Math.floor(base * tierMultiplier). Toujours >= 0.
 */
export function computeEarnedPoints(
  subtotalCents: number,
  earnRatePerDollar: number,
  tierMultiplier: number,
): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  if (!Number.isFinite(earnRatePerDollar) || earnRatePerDollar <= 0) return 0;
  const multiplier =
    Number.isFinite(tierMultiplier) && tierMultiplier > 0 ? tierMultiplier : 1;
  const dollars = subtotalCents / 100;
  const base = dollars * earnRatePerDollar;
  const earned = Math.floor(base * multiplier);
  return earned > 0 ? earned : 0;
}

/**
 * Calcule la valeur en cents d'un nombre de points au taux de redemption.
 * Pur. Math.floor pour arrondi inférieur (sécurité tenant).
 */
export function computeRedeemValueCents(
  points: number,
  redeemRateCentsPerPoint: number,
): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  if (!Number.isFinite(redeemRateCentsPerPoint) || redeemRateCentsPerPoint <= 0)
    return 0;
  const cents = Math.floor(points * redeemRateCentsPerPoint);
  return cents > 0 ? cents : 0;
}

const DEFAULT_TIER_THRESHOLDS: Record<string, number> = {
  bronze: 0,
  silver: 500,
  gold: 2000,
};

/**
 * Dérive le tier d'un client depuis son lifetime_earned et les thresholds.
 * Pur. Tri descendant des thresholds, retourne le plus haut atteint.
 * Default 'bronze' si rien ne match ou thresholds invalides.
 */
export function deriveTier(
  lifetimeEarned: number,
  thresholds: Record<string, number> | null | undefined,
): string {
  const lifetime = Number.isFinite(lifetimeEarned) && lifetimeEarned > 0
    ? lifetimeEarned
    : 0;
  const source =
    thresholds && typeof thresholds === 'object' && Object.keys(thresholds).length > 0
      ? thresholds
      : DEFAULT_TIER_THRESHOLDS;

  // Tri descendant par seuil ; on garde uniquement les seuils numériques valides.
  const entries: Array<[string, number]> = [];
  for (const [tier, value] of Object.entries(source)) {
    const numValue = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numValue) && numValue >= 0 && typeof tier === 'string' && tier.length > 0) {
      entries.push([tier, numValue]);
    }
  }
  entries.sort((a, b) => b[1] - a[1]);

  for (const [tier, threshold] of entries) {
    if (lifetime >= threshold) return tier;
  }
  return 'bronze';
}

/**
 * Retourne le multiplier earn associé à un tier depuis le benefits JSON.
 * Pur. Format attendu : { gold: { earn_multiplier: 2.0 }, silver: { earn_multiplier: 1.5 } }.
 * Default 1.0 si parse fail ou multiplier invalide.
 */
export function pickTierMultiplier(
  tier: string,
  benefitsJson: string | null | undefined,
): number {
  if (!benefitsJson || typeof benefitsJson !== 'string') return 1;
  if (!tier || typeof tier !== 'string') return 1;
  try {
    const parsed = JSON.parse(benefitsJson) as unknown;
    if (!parsed || typeof parsed !== 'object') return 1;
    const tierEntry = (parsed as Record<string, unknown>)[tier];
    if (!tierEntry || typeof tierEntry !== 'object') return 1;
    const raw = (tierEntry as Record<string, unknown>).earn_multiplier;
    const multiplier = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(multiplier) && multiplier > 0) return multiplier;
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Calcule la date d'expiration des points (ISO datetime) ou null si pas d'expiration.
 * Pur. expiryDays null/0/négatif → null.
 */
export function computeExpiryDate(
  now: string,
  expiryDays: number | null | undefined,
): string | null {
  if (expiryDays == null) return null;
  if (!Number.isFinite(expiryDays) || expiryDays <= 0) return null;
  const base = new Date(now);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + expiryDays * 86400000).toISOString();
}

/**
 * Compose la clé d'idempotence canonique pour un mouvement loyalty.
 * Convention : `lp:${programId}|${customerId}|${orderId ?? '-'}|${type}`. JAMAIS de PII.
 */
export function pickIdempotencyKey(
  programId: string,
  customerId: string,
  orderId: string | null | undefined,
  type: LoyaltyLedgerType,
): string {
  return `lp:${programId}|${customerId}|${orderId ?? '-'}|${type}`;
}

// ── Utils internes ──────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function safeParseThresholds(
  json: string | null | undefined,
): Record<string, number> | null {
  if (!json || typeof json !== 'string') return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const num = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(num) && num >= 0) out[k] = num;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function genId(): string {
  // randomUUID est dispo dans le runtime Workers (crypto global).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback simple (rare en Workers) : hex 32 chars.
  const buf = new Uint8Array(16);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Helpers DB-touching ────────────────────────────────────────────────────

/**
 * Récupère ou crée la ligne loyalty_customer_state pour (program, customer).
 * Bornage tenant : client_id passé en argument (calque convention multi-tenant).
 * Retourne null UNIQUEMENT en cas d'erreur DB inattendue.
 */
export async function getOrCreateState(
  db: D1Database,
  programId: string,
  clientId: string,
  customerId: string,
): Promise<LoyaltyStateRow | null> {
  if (!db || !programId || !clientId || !customerId) return null;
  try {
    const existing = await db
      .prepare(
        `SELECT id, program_id, client_id, customer_id, current_balance, lifetime_earned,
                current_tier, tier_updated_at, last_earn_at, last_redeem_at, created_at, updated_at
           FROM loyalty_customer_state
          WHERE program_id = ? AND customer_id = ?
          LIMIT 1`,
      )
      .bind(programId, customerId)
      .first<LoyaltyStateRow>();
    if (existing) return existing;

    const id = genId();
    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO loyalty_customer_state
           (id, program_id, client_id, customer_id, current_balance, lifetime_earned,
            current_tier, tier_updated_at, last_earn_at, last_redeem_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, 'bronze', NULL, NULL, NULL, ?, ?)`,
      )
      .bind(id, programId, clientId, customerId, now, now)
      .run();

    return {
      id,
      program_id: programId,
      client_id: clientId,
      customer_id: customerId,
      current_balance: 0,
      lifetime_earned: 0,
      current_tier: 'bronze',
      tier_updated_at: null,
      last_earn_at: null,
      last_redeem_at: null,
      created_at: now,
      updated_at: now,
    };
  } catch {
    return null;
  }
}

/**
 * Écrit une entrée dans loyalty_ledger + met à jour loyalty_customer_state.
 * Idempotent via idempotencyKey (SELECT-before-INSERT sur clé canonique).
 *
 * Retours :
 *   { ok: true, entryId, newBalance } sur succès (ou idempotent hit).
 *   { ok: false, error: 'insufficient_points' | 'state_unavailable' | 'program_not_found' | 'db_error' }
 */
export async function recordLedgerEntry(
  db: D1Database,
  input: RecordLedgerInput,
): Promise<{ ok: boolean; entryId?: string; newBalance?: number; error?: string }> {
  if (!db || !input || !input.programId || !input.clientId || !input.customerId) {
    return { ok: false, error: 'invalid_input' };
  }
  const points = Number.isFinite(input.points) ? Math.trunc(input.points) : 0;
  const type = input.type;
  const idempotencyKey =
    input.idempotencyKey ??
    pickIdempotencyKey(input.programId, input.customerId, input.sourceOrderId ?? null, type);

  try {
    // 1. Idempotence : si une entrée existe déjà pour cette clé → renvoyer son état.
    const existingEntry = await db
      .prepare(
        `SELECT id, balance_after
           FROM loyalty_ledger
          WHERE program_id = ? AND customer_id = ? AND idempotency_key = ?
          LIMIT 1`,
      )
      .bind(input.programId, input.customerId, idempotencyKey)
      .first<{ id: string; balance_after: number }>();
    if (existingEntry) {
      return {
        ok: true,
        entryId: existingEntry.id,
        newBalance: existingEntry.balance_after,
      };
    }

    // 2. Charge / crée le state.
    const state = await getOrCreateState(db, input.programId, input.clientId, input.customerId);
    if (!state) return { ok: false, error: 'state_unavailable' };

    // 3. Charge le programme (thresholds + benefits).
    const program = await db
      .prepare(
        `SELECT id, tier_thresholds_json, tier_benefits_json
           FROM loyalty_programs
          WHERE id = ?
          LIMIT 1`,
      )
      .bind(input.programId)
      .first<{
        id: string;
        tier_thresholds_json: string | null;
        tier_benefits_json: string | null;
      }>();
    if (!program) return { ok: false, error: 'program_not_found' };

    const thresholds = safeParseThresholds(program.tier_thresholds_json);

    // 4. Calcul nouveau balance + lifetime + tier.
    const newBalance = state.current_balance + points;
    if (type === 'redeem' && newBalance < 0) {
      return { ok: false, error: 'insufficient_points' };
    }
    if (newBalance < 0 && type !== 'expire' && type !== 'adjust') {
      // Garde-fou : seuls expire/adjust peuvent produire balance négatif au-delà de redeem.
      return { ok: false, error: 'insufficient_points' };
    }

    const newLifetime =
      type === 'earn' || type === 'tier_bonus'
        ? state.lifetime_earned + Math.max(0, points)
        : state.lifetime_earned;

    const newTier = deriveTier(newLifetime, thresholds);
    const tierChanged = newTier !== state.current_tier;
    const tierSnapshot = input.tierSnapshot ?? newTier;

    const entryId = genId();
    const now = nowIso();

    // 5. INSERT ledger.
    await db
      .prepare(
        `INSERT INTO loyalty_ledger
           (id, program_id, client_id, customer_id, points, type, source_order_id,
            idempotency_key, tier_snapshot, balance_after, expires_at,
            created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entryId,
        input.programId,
        input.clientId,
        input.customerId,
        points,
        type,
        input.sourceOrderId ?? null,
        idempotencyKey,
        tierSnapshot,
        newBalance,
        input.expiresAt ?? null,
        input.createdByUserId ?? null,
        now,
      )
      .run();

    // 6. UPDATE state.
    const setLastEarn = type === 'earn' || type === 'tier_bonus';
    const setLastRedeem = type === 'redeem';

    await db
      .prepare(
        `UPDATE loyalty_customer_state
            SET current_balance = ?,
                lifetime_earned = ?,
                current_tier = ?,
                tier_updated_at = CASE WHEN ? = 1 THEN ? ELSE tier_updated_at END,
                last_earn_at = CASE WHEN ? = 1 THEN ? ELSE last_earn_at END,
                last_redeem_at = CASE WHEN ? = 1 THEN ? ELSE last_redeem_at END,
                updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        newBalance,
        newLifetime,
        newTier,
        tierChanged ? 1 : 0,
        now,
        setLastEarn ? 1 : 0,
        now,
        setLastRedeem ? 1 : 0,
        now,
        now,
        state.id,
      )
      .run();

    return { ok: true, entryId, newBalance };
  } catch {
    return { ok: false, error: 'db_error' };
  }
}

/**
 * CRON : expire les points dont expires_at <= asOf. Insère 'expire' négatif
 * dans le ledger (append-only, pas de conflit idempotency_key) + recompute state
 * pour chaque (program, customer) impacté.
 */
export async function expirePendingPoints(
  db: D1Database,
  programId: string,
  asOf: string,
): Promise<{ ok: boolean; expiredEntries?: number; error?: string }> {
  if (!db || !programId || !asOf) {
    return { ok: false, error: 'invalid_input' };
  }
  try {
    const rows = await db
      .prepare(
        `SELECT id, client_id, customer_id, points
           FROM loyalty_ledger
          WHERE program_id = ?
            AND type = 'earn'
            AND expires_at IS NOT NULL
            AND expires_at <= ?
            AND id NOT IN (
              SELECT source_order_id
                FROM loyalty_ledger
               WHERE program_id = ? AND type = 'expire' AND source_order_id IS NOT NULL
            )`,
      )
      .bind(programId, asOf, programId)
      .all<{ id: string; client_id: string; customer_id: string; points: number }>();

    const list = rows.results ?? [];
    if (list.length === 0) return { ok: true, expiredEntries: 0 };

    const touchedCustomers = new Set<string>();
    let expiredCount = 0;

    for (const entry of list) {
      const expirePoints = -Math.abs(entry.points);
      if (expirePoints >= 0) continue;
      const entryId = genId();
      const now = nowIso();
      // Append-only : pas d'idempotency_key (les rerun useront le NOT IN filtre).
      // source_order_id stocke l'id du earn original pour traçabilité + filtre re-run.
      await db
        .prepare(
          `INSERT INTO loyalty_ledger
             (id, program_id, client_id, customer_id, points, type, source_order_id,
              idempotency_key, tier_snapshot, balance_after, expires_at,
              created_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'expire', ?, NULL, 'bronze', 0, NULL, NULL, ?)`,
        )
        .bind(
          entryId,
          programId,
          entry.client_id,
          entry.customer_id,
          expirePoints,
          entry.id,
          now,
        )
        .run();
      touchedCustomers.add(entry.customer_id);
      expiredCount++;
    }

    // Recompute state pour chaque customer impacté (balance + lifetime + tier).
    for (const customerId of touchedCustomers) {
      await recomputeState(db, programId, customerId);
    }

    return { ok: true, expiredEntries: expiredCount };
  } catch {
    return { ok: false, error: 'db_error' };
  }
}

/**
 * Recalcule la balance + lifetime + tier d'un (program, customer) depuis le ledger.
 * Rebuild safe : agrège SUM(points) + SUM(points WHERE type='earn') puis dérive tier.
 */
export async function recomputeState(
  db: D1Database,
  programId: string,
  customerId: string,
): Promise<{ ok: boolean; balance?: number; tier?: string; error?: string }> {
  if (!db || !programId || !customerId) {
    return { ok: false, error: 'invalid_input' };
  }
  try {
    const balanceRow = await db
      .prepare(
        `SELECT COALESCE(SUM(points), 0) AS balance
           FROM loyalty_ledger
          WHERE program_id = ? AND customer_id = ?`,
      )
      .bind(programId, customerId)
      .first<{ balance: number }>();
    const lifetimeRow = await db
      .prepare(
        `SELECT COALESCE(SUM(points), 0) AS lifetime
           FROM loyalty_ledger
          WHERE program_id = ? AND customer_id = ? AND type IN ('earn','tier_bonus')`,
      )
      .bind(programId, customerId)
      .first<{ lifetime: number }>();

    const balance = balanceRow?.balance ?? 0;
    const lifetime = Math.max(0, lifetimeRow?.lifetime ?? 0);

    const program = await db
      .prepare(
        `SELECT tier_thresholds_json
           FROM loyalty_programs
          WHERE id = ?
          LIMIT 1`,
      )
      .bind(programId)
      .first<{ tier_thresholds_json: string | null }>();
    const thresholds = safeParseThresholds(program?.tier_thresholds_json ?? null);
    const tier = deriveTier(lifetime, thresholds);

    // S'assure que la ligne state existe (avant UPDATE).
    const stateRow = await db
      .prepare(
        `SELECT id, client_id, current_tier
           FROM loyalty_customer_state
          WHERE program_id = ? AND customer_id = ?
          LIMIT 1`,
      )
      .bind(programId, customerId)
      .first<{ id: string; client_id: string; current_tier: string }>();

    const now = nowIso();
    if (stateRow) {
      const tierChanged = stateRow.current_tier !== tier;
      await db
        .prepare(
          `UPDATE loyalty_customer_state
              SET current_balance = ?,
                  lifetime_earned = ?,
                  current_tier = ?,
                  tier_updated_at = CASE WHEN ? = 1 THEN ? ELSE tier_updated_at END,
                  updated_at = ?
            WHERE id = ?`,
        )
        .bind(balance, lifetime, tier, tierChanged ? 1 : 0, now, now, stateRow.id)
        .run();
    }
    // Si pas de state : on ne crée pas ici (pas de client_id disponible de manière fiable
    // sans lookup supplémentaire ; le recompute n'a de sens qu'après au moins un ledger).

    return { ok: true, balance, tier };
  } catch {
    return { ok: false, error: 'db_error' };
  }
}

// Note : `Env` import préservé pour Phase B (lectures binding éventuelles).
void (null as unknown as Env);

// ════════════════════════════════════════════════════════════════════════════
// ── Sprint 38 Hardening (2026-05-26) — additive helpers, NO breaking change ─
// ════════════════════════════════════════════════════════════════════════════
//
// Helpers PURS supplémentaires avec defaults câblés (tier thresholds en cents
// de lifetime spend, points expiry 365j, redemption rate 20pts=100c).
// Coexistent avec les helpers Phase A/B ci-dessus — n'affectent NI les
// signatures ni le contrat figé docs/LOT-GIFTCARDS-LOYALTY-S38.md §6.
//
// Use case : code-paths qui veulent une politique loyalty "out-of-the-box"
// sans charger un loyalty_programs DB row (ex: pré-checkout estimate,
// admin preview, default tenant onboarding).

/**
 * Tier 4-rangs avec defaults sur lifetime spend (cents).
 *   bronze   : 0 +
 *   silver   : 500$ +     (50 000 cents)
 *   gold     : 2 000$ +   (200 000 cents)
 *   platinum : 10 000$ +  (1 000 000 cents)
 */
export const TIER_THRESHOLDS_CENTS = {
  bronze: 0,
  silver: 50_000,
  gold: 200_000,
  platinum: 1_000_000,
} as const;

export type LoyaltyTier4 = keyof typeof TIER_THRESHOLDS_CENTS;

/** Expiration par défaut des points : 365 jours après earn. */
export const POINTS_EXPIRY_DAYS = 365;

/**
 * Earn rate par tier (points gagnés par dollar dépensé).
 *   bronze   : 1   pt / $
 *   silver   : 1.5 pt / $
 *   gold     : 2   pt / $
 *   platinum : 3   pt / $
 */
export const TIER_EARN_RATE: Record<LoyaltyTier4, number> = {
  bronze: 1,
  silver: 1.5,
  gold: 2,
  platinum: 3,
};

/**
 * Codes d'erreur normalisés (loyalty). Strings stables — consommés par
 * les handlers HTTP pour mapper sur i18n + status codes.
 */
export const LOYALTY_ERROR_CODES = {
  INVALID_INPUT: 'invalid_input',
  INSUFFICIENT_POINTS: 'insufficient_points',
  POINTS_EXPIRED: 'points_expired',
  REDEMPTION_OVER_MAX: 'redemption_over_max',
  REDEMPTION_BELOW_MIN: 'redemption_below_min',
  CUSTOMER_MISMATCH: 'customer_mismatch',
  PROGRAM_INACTIVE: 'program_inactive',
} as const;

export type LoyaltyErrorCode =
  (typeof LOYALTY_ERROR_CODES)[keyof typeof LOYALTY_ERROR_CODES];

/**
 * Dérive le tier 4-rangs depuis le lifetime spend EN CENTS.
 * Pur. Tri descendant par threshold, retourne le tier le plus haut atteint.
 * Default 'bronze' si lifetimeSpendCents invalide ou < 0.
 *
 * NOTE : différent de `deriveTier()` ci-dessus qui prend lifetime_earned
 * (points) + thresholds dynamiques par programme. Ici defaults câblés
 * + base = lifetime spend cents (rev-based, pas point-based).
 */
export function computeTier(lifetimeSpendCents: number): LoyaltyTier4 {
  const spend =
    Number.isFinite(lifetimeSpendCents) && lifetimeSpendCents > 0
      ? Math.floor(lifetimeSpendCents)
      : 0;
  if (spend >= TIER_THRESHOLDS_CENTS.platinum) return 'platinum';
  if (spend >= TIER_THRESHOLDS_CENTS.gold) return 'gold';
  if (spend >= TIER_THRESHOLDS_CENTS.silver) return 'silver';
  return 'bronze';
}

/**
 * Calcule les points gagnés pour un total commande, modulé par tier.
 * Pur. Rate variable par tier (cf. `TIER_EARN_RATE`).
 *   dollars = orderTotalCents / 100
 *   points  = floor(dollars * TIER_EARN_RATE[tier])
 * Retourne 0 si input invalide. Toujours >= 0.
 */
export function computePointsEarned(
  orderTotalCents: number,
  tier: LoyaltyTier4 | string,
): number {
  if (!Number.isFinite(orderTotalCents) || orderTotalCents <= 0) return 0;
  const safeTier: LoyaltyTier4 = (
    tier in TIER_EARN_RATE ? tier : 'bronze'
  ) as LoyaltyTier4;
  const rate = TIER_EARN_RATE[safeTier] ?? 1;
  const dollars = orderTotalCents / 100;
  const earned = Math.floor(dollars * rate);
  return earned > 0 ? earned : 0;
}

/**
 * Convertit un montant de points en remise (cents).
 * Pur. Default conversionRate = 20 → 20 points = 100 cents (= 1$).
 *   discountCents = floor(points * 100 / conversionRate)
 *   ex: 100 points / 20 = 500 cents (= 5$)
 *
 * Retourne 0 si input invalide (points <= 0, conversionRate <= 0).
 */
export function computeRedemptionDiscount(
  points: number,
  conversionRate: number = 20,
): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  if (!Number.isFinite(conversionRate) || conversionRate <= 0) return 0;
  const cents = Math.floor((points * 100) / conversionRate);
  return cents > 0 ? cents : 0;
}

/**
 * Vérifie si des points ont expiré (>= POINTS_EXPIRY_DAYS depuis earnedAt).
 * Pur. Retourne false si dates invalides (best-effort, ne crash JAMAIS).
 */
export function isPointsExpired(
  earnedAt: string | Date,
  nowDate: string | Date = new Date(),
): boolean {
  const earned =
    earnedAt instanceof Date ? earnedAt : new Date(earnedAt);
  const now = nowDate instanceof Date ? nowDate : new Date(nowDate);
  if (Number.isNaN(earned.getTime()) || Number.isNaN(now.getTime())) {
    return false;
  }
  const diffMs = now.getTime() - earned.getTime();
  const diffDays = diffMs / 86_400_000;
  return diffDays >= POINTS_EXPIRY_DAYS;
}

/**
 * Validation d'une demande de redemption (anti-fraud + business rules).
 *
 * Inputs :
 *   - customerId       : owner du balance (calque ledger.customer_id)
 *   - ledgerCustomerId : customer_id du balance interrogé (anti-cross-account)
 *   - points           : montant demandé (entier > 0)
 *   - balance          : solde courant (entier >= 0)
 *   - maxPerOrder      : plafond redemption sur 1 commande (default Infinity)
 *   - minRedeem        : seuil minimum (default 100)
 *
 * Retours :
 *   { ok: true }
 *   { ok: false, error: 'message', code: LoyaltyErrorCode }
 *
 * Pur. Aucune I/O — caller doit charger balance + customerId avant.
 */
export function validateRedemption(args: {
  customerId: string;
  ledgerCustomerId?: string;
  points: number;
  balance: number;
  maxPerOrder?: number;
  minRedeem?: number;
}): { ok: true } | { ok: false; error: string; code: LoyaltyErrorCode } {
  const {
    customerId,
    ledgerCustomerId,
    points,
    balance,
    maxPerOrder = Number.POSITIVE_INFINITY,
    minRedeem = 100,
  } = args ?? ({} as never);

  if (!customerId || typeof customerId !== 'string') {
    return {
      ok: false,
      error: 'customerId required',
      code: LOYALTY_ERROR_CODES.INVALID_INPUT,
    };
  }
  if (!Number.isFinite(points) || points <= 0 || !Number.isInteger(points)) {
    return {
      ok: false,
      error: 'points must be positive integer',
      code: LOYALTY_ERROR_CODES.INVALID_INPUT,
    };
  }
  if (!Number.isFinite(balance) || balance < 0) {
    return {
      ok: false,
      error: 'balance invalid',
      code: LOYALTY_ERROR_CODES.INVALID_INPUT,
    };
  }
  if (ledgerCustomerId && ledgerCustomerId !== customerId) {
    return {
      ok: false,
      error: 'customer mismatch — cannot redeem on foreign account',
      code: LOYALTY_ERROR_CODES.CUSTOMER_MISMATCH,
    };
  }
  if (points < minRedeem) {
    return {
      ok: false,
      error: `redemption below minimum (${minRedeem})`,
      code: LOYALTY_ERROR_CODES.REDEMPTION_BELOW_MIN,
    };
  }
  if (points > maxPerOrder) {
    return {
      ok: false,
      error: `redemption above per-order max (${maxPerOrder})`,
      code: LOYALTY_ERROR_CODES.REDEMPTION_OVER_MAX,
    };
  }
  if (points > balance) {
    return {
      ok: false,
      error: 'insufficient points',
      code: LOYALTY_ERROR_CODES.INSUFFICIENT_POINTS,
    };
  }
  return { ok: true };
}
