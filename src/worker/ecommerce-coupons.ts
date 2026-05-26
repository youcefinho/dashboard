// ── Coupons / Promos — Sprint 4 LOT E-COMMERCE B2 enrichi (2026-05-19) ───────
//
// CRUD + validation de coupons pour le module Boutique B2.
//
// ⚠ PHASE B = corps réel (Manager-B, SEUL propriétaire de ce fichier en
//   Phase B). Signatures FIGÉES au contrat docs/LOT-ECOM4.md §6.D — INCHANGÉES.
//
// Conventions strictes du projet (respectées) :
//   - Multi-tenant STRICT : clientId résolu via getClientModules
//     (calque ecommerce-orders.ts:76) → WHERE client_id = ? sur table
//     `coupons` (seq 18 + ALTER additif seq 85). JAMAIS de fuite cross-tenant.
//   - Gating requireModule('ecommerce') géré AMONT par src/worker.ts (le bloc
//     /api/ecommerce/* est gated globalement — toute route hérite). Mutations
//     (create/update/delete) = role admin (calque handleUpdateRegion
//     ecommerce-region.ts:254). ZÉRO capability ALL_CAPABILITIES (figée).
//   - Réponses normalisées { data } / { error } (apiFetch GELÉ, JAMAIS de
//     champ `code` — discrimination string-match — docs/LOT-ECOM4.md §6.A).
//   - Colonnes LEGACY coupons (discount_amount / discount_percent seq 18)
//     CONSERVÉES : la résolution code→montant les lit en rétro-compat.
//   - La résolution de promo se fait EN AMONT (handler/cart) et passe
//     `discount_cents` au contrat createOrderCore EXISTANT — createOrderCore
//     reste INCHANGÉ (signature + calcul total byte-identiques, §6.C).
//   - Best-effort : table/colonnes absentes (seq 85 non jouée) ⇒ réponse
//     normalisée, JAMAIS de 500/throw.

import type { Env } from './types';
import { json } from './helpers';
import { getClientModules } from './modules';

type Auth = { userId: string; role: string };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/** Résout le client_id du tenant courant (calque ecommerce-orders.ts:76). */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  try {
    const { clientId } = await getClientModules(env, auth.userId);
    return clientId;
  } catch {
    return null;
  }
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

function notAdmin(): Response {
  return json(
    { error: 'Non autorisé', message: 'Action réservée aux administrateurs.' },
    403,
  );
}

/** Ligne `coupons` (legacy seq 18 + enrichissement seq 85). */
interface CouponRow {
  id: string;
  client_id: string;
  code: string;
  discount_amount: number | null;
  discount_percent: number | null;
  discount_type: string | null;
  min_order_cents: number | null;
  starts_at: string | null;
  expires_at: string | null;
  usage_limit: number | null;
  times_used: number | null;
  is_active: number | null;
  currency: string | null;
  agency_id: string | null;
  created_at: string | null;
}

const COUPON_COLS =
  'id, client_id, code, discount_amount, discount_percent, discount_type, ' +
  'min_order_cents, starts_at, expires_at, usage_limit, times_used, ' +
  'is_active, currency, agency_id, created_at';

/**
 * Calcule le montant de remise (cents) d'un coupon pour un sous-total donné.
 * Rétro-compat : si `discount_type` absent, on dérive du legacy
 * (`discount_percent` → percent, sinon `discount_amount` → fixed). Un montant
 * fixe legacy `discount_amount` est interprété en CENTS (money projet en
 * cents). Plafonné au sous-total (jamais négatif). Aucune conversion FX.
 */
function computeDiscountCents(c: CouponRow, subtotalCents: number): number {
  const sub = Math.max(0, Math.round(subtotalCents || 0));
  const type = (c.discount_type || '').toLowerCase().trim()
    || (c.discount_percent != null ? 'percent' : 'fixed');

  let raw = 0;
  if (type === 'percent') {
    const pct = Number(c.discount_percent ?? c.discount_amount ?? 0);
    if (Number.isFinite(pct) && pct > 0) {
      raw = Math.round(sub * (Math.min(pct, 100) / 100));
    }
  } else {
    // fixed : montant en cents. On lit discount_amount en priorité
    // (montant fixe legacy), sinon min_order_cents-style absent ⇒ 0.
    const amt = Number(c.discount_amount ?? 0);
    if (Number.isFinite(amt) && amt > 0) raw = Math.round(amt);
  }
  return Math.max(0, Math.min(raw, sub));
}

/**
 * Cœur de résolution code→montant. Lookup borné tenant + actif, vérifie
 * fenêtre (starts_at/expires_at vs datetime('now')), quota (usage_limit vs
 * times_used), plancher (min_order_cents vs subtotal), devise. Best-effort :
 * toute erreur DB (table/colonnes absentes seq 85 non jouée) ⇒
 * `{ valid:false, reason }`, JAMAIS de throw. Réutilisé par
 * handleValidateCoupon ET ecommerce-cart.ts (handleConvertCart).
 */
export async function resolveCouponDiscount(
  env: Env,
  clientId: string,
  code: string,
  subtotalCents: number,
  currency?: string | null,
): Promise<{ valid: boolean; discount_cents: number; code?: string; reason?: string; couponId?: string }> {
  const cleanCode = (code || '').toString().trim();
  if (!cleanCode) return { valid: false, discount_cents: 0, reason: 'Code requis' };

  let row: CouponRow | null = null;
  try {
    row = (await env.DB.prepare(
      `SELECT ${COUPON_COLS} FROM coupons
        WHERE client_id = ? AND code = ? AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    ).bind(clientId, cleanCode).first()) as CouponRow | null;
  } catch {
    // Table/colonnes absentes (seq 85 non jouée) — best-effort.
    return { valid: false, discount_cents: 0, reason: 'Coupon indisponible' };
  }

  if (!row) {
    return { valid: false, discount_cents: 0, reason: 'Code promo invalide ou expiré' };
  }

  // Fenêtre de validité — comparaison lexicographique ISO (datetime('now')
  // côté DB est ISO ; on borne via SQL pour éviter les soucis d'horloge JS).
  let nowIso = '';
  try {
    const nr = (await env.DB.prepare(
      "SELECT datetime('now') AS now",
    ).first()) as { now: string } | null;
    nowIso = nr?.now || '';
  } catch {
    nowIso = '';
  }
  if (nowIso) {
    if (row.starts_at && row.starts_at > nowIso) {
      return { valid: false, discount_cents: 0, reason: 'Code promo invalide ou expiré' };
    }
    if (row.expires_at && row.expires_at < nowIso) {
      return { valid: false, discount_cents: 0, reason: 'Code promo invalide ou expiré' };
    }
  }

  // Quota global d'usage.
  if (row.usage_limit != null && Number.isFinite(Number(row.usage_limit))) {
    const used = Number(row.times_used ?? 0);
    if (used >= Number(row.usage_limit)) {
      return { valid: false, discount_cents: 0, reason: 'Code promo invalide ou expiré' };
    }
  }

  // Plancher panier.
  const sub = Math.max(0, Math.round(subtotalCents || 0));
  if (row.min_order_cents != null && sub < Number(row.min_order_cents)) {
    return { valid: false, discount_cents: 0, reason: 'Commande minimum non atteinte' };
  }

  // Devise — si le coupon impose une devise, elle doit matcher la commande.
  if (row.currency) {
    const want = row.currency.toString().toUpperCase().trim();
    const got = (currency || '').toString().toUpperCase().trim();
    if (got && want !== got) {
      return { valid: false, discount_cents: 0, reason: 'Devise non applicable' };
    }
  }

  const discount = computeDiscountCents(row, sub);
  return { valid: true, discount_cents: discount, code: row.code, couponId: row.id };
}

/**
 * Incrémente `coupons.times_used` (best-effort, borné tenant). Appelé à la
 * conversion réussie d'un panier (ecommerce-cart.ts). Jamais de throw.
 */
export async function incrementCouponUsage(
  env: Env, clientId: string, couponId: string,
): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE coupons SET times_used = COALESCE(times_used, 0) + 1
        WHERE id = ? AND client_id = ?`,
    ).bind(couponId, clientId).run();
  } catch {
    /* best-effort : compteur non bloquant */
  }
}

/**
 * GET /api/ecommerce/coupons — liste paginée des coupons du tenant.
 */
export async function handleListCoupons(
  env: Env, auth: Auth, url: URL,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') || '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  try {
    const { results } = await env.DB.prepare(
      `SELECT ${COUPON_COLS} FROM coupons
        WHERE client_id = ?
        ORDER BY COALESCE(created_at, '') DESC, code ASC
        LIMIT ? OFFSET ?`,
    ).bind(clientId, limit, offset).all();
    const totalRow = (await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM coupons WHERE client_id = ?',
    ).bind(clientId).first()) as { c: number } | null;
    return json({ data: results || [], total: totalRow?.c ?? (results || []).length });
  } catch {
    // Table/colonnes absentes (seq 85 non jouée) — liste vide honnête.
    return json({ data: [], total: 0 });
  }
}

/** Normalise/borne le payload d'écriture d'un coupon. */
function normalizeCouponInput(body: Record<string, unknown>): {
  code: string;
  discount_type: string;
  discount_amount: number | null;
  discount_percent: number | null;
  min_order_cents: number;
  starts_at: string | null;
  expires_at: string | null;
  usage_limit: number | null;
  is_active: number;
  currency: string | null;
} {
  const code = (body.code as string || '').toString().trim().slice(0, 60);
  const dtRaw = (body.discount_type as string || '').toString().toLowerCase().trim();
  const discount_type = dtRaw === 'fixed' ? 'fixed' : 'percent';

  const pctNum = Number(body.discount_percent);
  const amtNum = Number(body.discount_amount);
  const discount_percent = discount_type === 'percent' && Number.isFinite(pctNum)
    ? Math.max(0, Math.min(Math.round(pctNum), 100))
    : (Number.isFinite(pctNum) ? Math.max(0, Math.round(pctNum)) : null);
  const discount_amount = discount_type === 'fixed' && Number.isFinite(amtNum)
    ? Math.max(0, Math.round(amtNum))
    : (Number.isFinite(amtNum) ? Math.max(0, Math.round(amtNum)) : null);

  const moc = Number(body.min_order_cents);
  const min_order_cents = Number.isFinite(moc) ? Math.max(0, Math.round(moc)) : 0;

  const ul = Number(body.usage_limit);
  const usage_limit = body.usage_limit != null && Number.isFinite(ul) && ul > 0
    ? Math.round(ul)
    : null;

  const starts_at = body.starts_at ? String(body.starts_at).slice(0, 32) : null;
  const expires_at = body.expires_at ? String(body.expires_at).slice(0, 32) : null;
  const is_active = Number(body.is_active) === 0 ? 0 : 1;
  const curRaw = (body.currency as string || '').toString().toUpperCase().trim();
  const currency = ['CAD', 'EUR', 'DZD'].includes(curRaw) ? curRaw : null;

  return {
    code, discount_type, discount_amount, discount_percent, min_order_cents,
    starts_at, expires_at, usage_limit, is_active, currency,
  };
}

/**
 * POST /api/ecommerce/coupons — création d'un coupon (admin only).
 */
export async function handleCreateCoupon(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  if (auth.role !== 'admin') return notAdmin();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const c = normalizeCouponInput(body);
  if (!c.code) {
    return json({ error: 'Code requis', message: 'Le code du coupon est obligatoire.' }, 400);
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO coupons
         (id, client_id, code, discount_amount, discount_percent, discount_type,
          min_order_cents, starts_at, expires_at, usage_limit, times_used,
          is_active, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'))`,
    ).bind(
      id, clientId, c.code, c.discount_amount, c.discount_percent,
      c.discount_type, c.min_order_cents, c.starts_at, c.expires_at,
      c.usage_limit, c.is_active, c.currency,
    ).run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Impossible d’enregistrer le coupon' }, 400);
  }
}

/**
 * GET /api/ecommerce/coupons/:id — détail d'un coupon du tenant.
 */
export async function handleGetCoupon(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const row = (await env.DB.prepare(
      `SELECT ${COUPON_COLS} FROM coupons WHERE id = ? AND client_id = ?`,
    ).bind(id, clientId).first()) as CouponRow | null;
    if (!row) return json({ error: 'Coupon introuvable' }, 404);
    return json({ data: row });
  } catch {
    return json({ error: 'Coupon introuvable' }, 404);
  }
}

/**
 * PATCH /api/ecommerce/coupons/:id — maj d'un coupon (admin only).
 * Patch partiel : seuls les champs présents dans le body sont modifiés.
 */
export async function handleUpdateCoupon(
  request: Request, env: Env, auth: Auth, id: string,
): Promise<Response> {
  if (auth.role !== 'admin') return notAdmin();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  let existing: CouponRow | null = null;
  try {
    existing = (await env.DB.prepare(
      `SELECT ${COUPON_COLS} FROM coupons WHERE id = ? AND client_id = ?`,
    ).bind(id, clientId).first()) as CouponRow | null;
  } catch {
    return json({ error: 'Coupon introuvable' }, 404);
  }
  if (!existing) return json({ error: 'Coupon introuvable' }, 404);

  // Fusion patch partiel : on repart de l'existant et n'écrase que les
  // champs explicitement fournis (normalisés/bornés ensemble pour cohérence).
  const merged: Record<string, unknown> = {
    code: 'code' in body ? body.code : existing.code,
    discount_type: 'discount_type' in body ? body.discount_type : existing.discount_type,
    discount_amount: 'discount_amount' in body ? body.discount_amount : existing.discount_amount,
    discount_percent: 'discount_percent' in body ? body.discount_percent : existing.discount_percent,
    min_order_cents: 'min_order_cents' in body ? body.min_order_cents : existing.min_order_cents,
    starts_at: 'starts_at' in body ? body.starts_at : existing.starts_at,
    expires_at: 'expires_at' in body ? body.expires_at : existing.expires_at,
    usage_limit: 'usage_limit' in body ? body.usage_limit : existing.usage_limit,
    is_active: 'is_active' in body ? body.is_active : existing.is_active,
    currency: 'currency' in body ? body.currency : existing.currency,
  };
  const c = normalizeCouponInput(merged);
  if (!c.code) {
    return json({ error: 'Code requis', message: 'Le code du coupon est obligatoire.' }, 400);
  }

  try {
    await env.DB.prepare(
      `UPDATE coupons SET
         code = ?, discount_amount = ?, discount_percent = ?, discount_type = ?,
         min_order_cents = ?, starts_at = ?, expires_at = ?, usage_limit = ?,
         is_active = ?, currency = ?
       WHERE id = ? AND client_id = ?`,
    ).bind(
      c.code, c.discount_amount, c.discount_percent, c.discount_type,
      c.min_order_cents, c.starts_at, c.expires_at, c.usage_limit,
      c.is_active, c.currency, id, clientId,
    ).run();
    return json({ data: { id } });
  } catch {
    return json({ error: 'Impossible d’enregistrer le coupon' }, 400);
  }
}

/**
 * DELETE /api/ecommerce/coupons/:id — suppression d'un coupon (admin only).
 */
export async function handleDeleteCoupon(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  if (auth.role !== 'admin') return notAdmin();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const row = await env.DB.prepare(
      'SELECT id FROM coupons WHERE id = ? AND client_id = ?',
    ).bind(id, clientId).first();
    if (!row) return json({ error: 'Coupon introuvable' }, 404);
    await env.DB.prepare(
      'DELETE FROM coupons WHERE id = ? AND client_id = ?',
    ).bind(id, clientId).run();
    return json({ data: { id } });
  } catch {
    return json({ error: 'Impossible de supprimer le coupon' }, 400);
  }
}

/**
 * POST /api/ecommerce/coupons/validate — résolution code → montant de remise.
 * Body { code, subtotal_cents?, currency? } → { data: { valid, discount_cents,
 * ... } }. PAS de garde role admin (calque cart, accessible aux non-admins —
 * la validation d'un code est consommée au checkout, §6.D). Best-effort :
 * jamais de 500/throw.
 */
export async function handleValidateCoupon(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const code = (body.code as string || '').toString();
  const subtotalCents = Number(body.subtotal_cents);
  const currency = body.currency ? String(body.currency) : null;

  const res = await resolveCouponDiscount(
    env,
    clientId,
    code,
    Number.isFinite(subtotalCents) ? subtotalCents : 0,
    currency,
  );

  return json({
    data: {
      valid: res.valid,
      discount_cents: res.discount_cents,
      code: res.code,
      reason: res.reason,
    },
  });
}
