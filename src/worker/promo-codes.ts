// ── Promo Codes CRUD — Sprint 64 (2026-05-28) ─────────────────────────────
//
// CRUD administratif des codes promotionnels pour le module Boutique.
// Multi-tenant strict : filtré par client_id résolu.
// Rôles : mutations limitées aux administrateurs.
//

import type { Env } from './types';
import { json } from './helpers';
import { getClientModules } from './modules';
import { validateCouponCode, COUPON_ERROR_CODES } from './lib/coupons-engine';

type Auth = { userId: string; role: string };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/** Résout le client_id du tenant courant. */
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

interface PromoCodeRow {
  id: string;
  client_id: string;
  code: string;
  discount_type: string;
  value: number;
  starts_at: string | null;
  expires_at: string | null;
  max_uses: number | null;
  current_uses: number;
  rules_json: string;
  created_at: string;
  updated_at: string;
}

const PROMO_COLS =
  'id, client_id, code, discount_type, value, starts_at, expires_at, max_uses, current_uses, rules_json, created_at, updated_at';

/**
 * GET /api/ecommerce/promo-codes — liste paginée des codes promos du tenant.
 */
export async function handleListPromoCodes(
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
      `SELECT ${PROMO_COLS} FROM promo_codes
        WHERE client_id = ?
        ORDER BY created_at DESC, code ASC
        LIMIT ? OFFSET ?`,
    ).bind(clientId, limit, offset).all();

    const totalRow = (await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM promo_codes WHERE client_id = ?',
    ).bind(clientId).first()) as { c: number } | null;

    return json({ data: results || [], total: totalRow?.c ?? (results || []).length });
  } catch {
    return json({ data: [], total: 0 });
  }
}

/** Normalise et borne le payload d'écriture d'un code promo. */
function normalizePromoInput(body: Record<string, unknown>): {
  code: string;
  discount_type: string;
  value: number;
  starts_at: string | null;
  expires_at: string | null;
  max_uses: number | null;
  rules_json: string;
} {
  const code = (body.code as string || '').toString().trim().toUpperCase().slice(0, 60);
  const dtRaw = (body.discount_type as string || '').toString().toLowerCase().trim();
  const discount_type = ['fixed', 'percent'].includes(dtRaw) ? dtRaw : 'percent';

  const rawVal = Number(body.value);
  let value = Number.isFinite(rawVal) ? Math.max(0, Math.round(rawVal)) : 0;
  if (discount_type === 'percent') {
    value = Math.min(value, 100);
  }

  const starts_at = body.starts_at ? String(body.starts_at).slice(0, 32) : null;
  const expires_at = body.expires_at ? String(body.expires_at).slice(0, 32) : null;

  const mu = Number(body.max_uses);
  const max_uses = body.max_uses != null && Number.isFinite(mu) && mu > 0
    ? Math.round(mu)
    : null;

  let rules_json = '{}';
  if (body.rules_json) {
    if (typeof body.rules_json === 'string') {
      rules_json = body.rules_json;
    } else {
      try {
        rules_json = JSON.stringify(body.rules_json);
      } catch {
        rules_json = '{}';
      }
    }
  }

  return {
    code,
    discount_type,
    value,
    starts_at,
    expires_at,
    max_uses,
    rules_json,
  };
}

/**
 * POST /api/ecommerce/promo-codes — création d'un code promo (admin only).
 */
export async function handleCreatePromoCode(
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

  const p = normalizePromoInput(body);
  if (!p.code) {
    return json({ error: 'Code requis', error_code: COUPON_ERROR_CODES.CODE_REQUIRED, message: 'Le code promo est obligatoire.' }, 400);
  }

  if (!validateCouponCode(p.code)) {
    return json({
      error: 'Format de code invalide',
      error_code: COUPON_ERROR_CODES.CODE_INVALID_FORMAT,
      message: 'Le code doit contenir 4 à 20 caractères alphanumériques (A-Z, 0-9) séparés par des tirets.',
    }, 400);
  }

  // Vérifier l'unicité du code promo pour ce client ou globalement si contrainte d'unicité SQL
  try {
    const existing = await env.DB.prepare(
      'SELECT id FROM promo_codes WHERE code = ? LIMIT 1'
    ).bind(p.code).first();
    if (existing) {
      return json({ error: 'Ce code promo existe déjà', message: 'Veuillez en choisir un autre.' }, 400);
    }
  } catch {
    // Best-effort si table absente
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO promo_codes
         (id, client_id, code, discount_type, value, starts_at, expires_at, max_uses, current_uses, rules_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))`,
    ).bind(
      id, clientId, p.code, p.discount_type, p.value, p.starts_at, p.expires_at, p.max_uses, p.rules_json
    ).run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Impossible d’enregistrer le code promo' }, 400);
  }
}

/**
 * GET /api/ecommerce/promo-codes/:id — détail d'un code promo.
 */
export async function handleGetPromoCode(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const row = (await env.DB.prepare(
      `SELECT ${PROMO_COLS} FROM promo_codes WHERE id = ? AND client_id = ?`,
    ).bind(id, clientId).first()) as PromoCodeRow | null;
    if (!row) return json({ error: 'Code promo introuvable' }, 404);
    return json({ data: row });
  } catch {
    return json({ error: 'Code promo introuvable' }, 404);
  }
}

/**
 * PATCH /api/ecommerce/promo-codes/:id — modification d'un code promo (admin only).
 */
export async function handleUpdatePromoCode(
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

  let existing: PromoCodeRow | null = null;
  try {
    existing = (await env.DB.prepare(
      `SELECT ${PROMO_COLS} FROM promo_codes WHERE id = ? AND client_id = ?`,
    ).bind(id, clientId).first()) as PromoCodeRow | null;
  } catch {
    return json({ error: 'Code promo introuvable' }, 404);
  }
  if (!existing) return json({ error: 'Code promo introuvable' }, 404);

  const merged: Record<string, unknown> = {
    code: 'code' in body ? body.code : existing.code,
    discount_type: 'discount_type' in body ? body.discount_type : existing.discount_type,
    value: 'value' in body ? body.value : existing.value,
    starts_at: 'starts_at' in body ? body.starts_at : existing.starts_at,
    expires_at: 'expires_at' in body ? body.expires_at : existing.expires_at,
    max_uses: 'max_uses' in body ? body.max_uses : existing.max_uses,
    rules_json: 'rules_json' in body ? body.rules_json : existing.rules_json,
  };

  const p = normalizePromoInput(merged);
  if (!p.code) {
    return json({ error: 'Code requis', message: 'Le code promo est obligatoire.' }, 400);
  }

  if (p.code !== existing.code) {
    if (!validateCouponCode(p.code)) {
      return json({
        error: 'Format de code invalide',
        message: 'Le code doit contenir 4 à 20 caractères alphanumériques (A-Z, 0-9) séparés par des tirets.',
      }, 400);
    }
    // Vérifier l'unicité
    try {
      const other = await env.DB.prepare(
        'SELECT id FROM promo_codes WHERE code = ? AND id != ? LIMIT 1'
      ).bind(p.code, id).first();
      if (other) {
        return json({ error: 'Ce code promo existe déjà', message: 'Veuillez en choisir un autre.' }, 400);
      }
    } catch {
      //
    }
  }

  try {
    await env.DB.prepare(
      `UPDATE promo_codes SET
         code = ?, discount_type = ?, value = ?, starts_at = ?, expires_at = ?, max_uses = ?, rules_json = ?, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
    ).bind(
      p.code, p.discount_type, p.value, p.starts_at, p.expires_at, p.max_uses, p.rules_json, id, clientId,
    ).run();
    return json({ data: { id } });
  } catch {
    return json({ error: 'Impossible d’enregistrer le code promo' }, 400);
  }
}

/**
 * DELETE /api/ecommerce/promo-codes/:id — suppression d'un code promo (admin only).
 */
export async function handleDeletePromoCode(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  if (auth.role !== 'admin') return notAdmin();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const row = await env.DB.prepare(
      'SELECT id FROM promo_codes WHERE id = ? AND client_id = ?',
    ).bind(id, clientId).first();
    if (!row) return json({ error: 'Code promo introuvable' }, 404);

    await env.DB.prepare(
      'DELETE FROM promo_codes WHERE id = ? AND client_id = ?',
    ).bind(id, clientId).run();
    return json({ data: { id } });
  } catch {
    return json({ error: 'Impossible de supprimer le code promo' }, 400);
  }
}
