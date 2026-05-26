// ── Loyalty — Sprint 38 (2026-05-24, Agent A4) ─────────────────────────────
//
// Handlers REST programmes fidélité. 11 endpoints :
//   - 5 CRUD programmes (list/get/create/update/disable)         → settings.manage
//   - 1 GET balance customer                                      → clients.manage|reports.view
//   - 1 POST earn (crédit lié order)                              → invoices.write
//   - 1 POST redeem (débit lié order)                             → invoices.write
//   - 1 POST adjust (ajustement manuel admin, signed)             → clients.manage
//   - 1 GET ledger (historique)                                   → reports.view
//   - 1 POST cron expire-points                                   → settings.manage
//
// Capabilities FIGÉES seq80 (docs/LOT-GIFTCARDS-LOYALTY-S38.md §6).
//
// Réponses normalisées :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)        ← JAMAIS de champ `code`
//
// Bornage tenant strict : `WHERE client_id = ?` partout (calque gift-cards.ts).
// resolveClientId() = calque gift-cards.ts:53 / snapshots.ts:33.
// lookupAgencyId()  = calque gift-cards.ts:59 / snapshots.ts:42.
// Idempotence : pickIdempotencyKey() lib A2 + body.idempotency_key client override.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { getClientModules } from './modules';
import {
  computeEarnedPoints,
  computeRedeemValueCents,
  deriveTier,
  pickTierMultiplier,
  computeExpiryDate,
  getOrCreateState,
  recordLedgerEntry,
  expirePendingPoints,
} from './lib/loyalty-engine';
import type { LoyaltyProgramRow, LoyaltyStateRow } from './lib/loyalty-engine';

type Auth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

/** Résout capabilities (préférer celles injectées au choke-point). */
async function getCaps(env: Env, auth: Auth): Promise<Set<string>> {
  return auth.capabilities instanceof Set
    ? auth.capabilities
    : await resolveCapabilities(env, auth);
}

/** Résout le client_id du tenant courant. */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Lookup agency_id depuis clients (best-effort). */
async function lookupAgencyId(env: Env, clientId: string): Promise<string | null> {
  try {
    const row = (await env.DB.prepare('SELECT agency_id FROM clients WHERE id = ?')
      .bind(clientId)
      .first()) as { agency_id: string | null } | null;
    return row?.agency_id ?? null;
  } catch {
    return null;
  }
}

/** Charge un programme par id+tenant (bornage strict). Retourne null si introuvable. */
async function loadProgramForTenant(
  env: Env,
  clientId: string,
  id: string,
): Promise<LoyaltyProgramRow | null> {
  try {
    const row = (await env.DB.prepare(
      'SELECT * FROM loyalty_programs WHERE id = ? AND client_id = ? LIMIT 1',
    )
      .bind(id, clientId)
      .first()) as LoyaltyProgramRow | null;
    return row ?? null;
  } catch {
    return null;
  }
}

/** Parse safe d'un JSON string en objet (retourne null si parse fail). */
function safeJsonParse(json: string | null | undefined): unknown {
  if (!json || typeof json !== 'string') return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Lit la balance courante (program, customer). Best-effort, 0 si rien. */
async function readCurrentBalance(
  env: Env,
  programId: string,
  customerId: string,
): Promise<{ balance: number; tier: string }> {
  try {
    const row = (await env.DB.prepare(
      `SELECT current_balance, current_tier
         FROM loyalty_customer_state
        WHERE program_id = ? AND customer_id = ?
        LIMIT 1`,
    )
      .bind(programId, customerId)
      .first()) as { current_balance: number | null; current_tier: string | null } | null;
    if (!row) return { balance: 0, tier: 'bronze' };
    return {
      balance: Number(row.current_balance ?? 0),
      tier: row.current_tier ?? 'bronze',
    };
  } catch {
    return { balance: 0, tier: 'bronze' };
  }
}

// ── GET /api/loyalty/programs — liste ───────────────────────────────────────
export async function handleListPrograms(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  void url;
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'settings.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const { results } = await env.DB.prepare(
      'SELECT * FROM loyalty_programs WHERE client_id = ? ORDER BY name',
    )
      .bind(clientId)
      .all();

    return json({ data: results ?? [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/loyalty/programs/:id — détail ──────────────────────────────────
export async function handleGetProgram(
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'settings.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const row = await loadProgramForTenant(env, clientId, id);
    if (!row) return json({ error: 'Programme introuvable' }, 404);

    // Parse JSON pour exposer en objet (UI-friendly).
    const data = {
      ...row,
      tier_thresholds: safeJsonParse(row.tier_thresholds_json),
      tier_benefits: safeJsonParse(row.tier_benefits_json),
    };

    return json({ data });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/loyalty/programs — créer un programme ────────────────────────
export async function handleCreateProgram(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'settings.manage');
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    // ── validation name ─────────────────────────────────────────────────────
    const name =
      typeof body.name === 'string' && body.name.trim().length > 0
        ? body.name.trim().slice(0, 200)
        : '';
    if (!name) {
      return json({ error: 'name requis' }, 400);
    }

    // ── validation earn_rate_per_dollar (entier >= 0) ───────────────────────
    const earnRateRaw = body.earn_rate_per_dollar;
    const earnRate =
      typeof earnRateRaw === 'number' ? Math.round(earnRateRaw) : NaN;
    if (!Number.isFinite(earnRate) || earnRate < 0) {
      return json({ error: 'earn_rate_per_dollar invalide (entier >= 0 requis)' }, 400);
    }

    // ── validation redeem_rate_cents_per_point (entier >= 0) ────────────────
    const redeemRateRaw = body.redeem_rate_cents_per_point;
    const redeemRate =
      typeof redeemRateRaw === 'number' ? Math.round(redeemRateRaw) : NaN;
    if (!Number.isFinite(redeemRate) || redeemRate < 0) {
      return json(
        { error: 'redeem_rate_cents_per_point invalide (entier >= 0 requis)' },
        400,
      );
    }

    // ── validation min_redeem_points (entier >= 0) ──────────────────────────
    const minRedeemRaw = body.min_redeem_points;
    const minRedeem =
      typeof minRedeemRaw === 'number' ? Math.round(minRedeemRaw) : NaN;
    if (!Number.isFinite(minRedeem) || minRedeem < 0) {
      return json({ error: 'min_redeem_points invalide (entier >= 0 requis)' }, 400);
    }

    // ── points_expiry_days (optionnel — null si absent ou <=0) ──────────────
    let expiryDays: number | null = null;
    if (body.points_expiry_days != null) {
      const raw = body.points_expiry_days;
      const parsed = typeof raw === 'number' ? Math.round(raw) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        expiryDays = parsed;
      }
    }

    // ── tier_thresholds_json / tier_benefits_json (sérialisés JSON string) ──
    let thresholdsJson = '{}';
    if (body.tier_thresholds_json !== undefined && body.tier_thresholds_json !== null) {
      const raw = body.tier_thresholds_json;
      if (typeof raw === 'string') {
        try {
          JSON.parse(raw);
          thresholdsJson = raw.slice(0, 8000);
        } catch {
          return json({ error: 'tier_thresholds_json invalide (JSON requis)' }, 400);
        }
      } else if (typeof raw === 'object') {
        thresholdsJson = JSON.stringify(raw).slice(0, 8000);
      }
    }

    let benefitsJson = '{}';
    if (body.tier_benefits_json !== undefined && body.tier_benefits_json !== null) {
      const raw = body.tier_benefits_json;
      if (typeof raw === 'string') {
        try {
          JSON.parse(raw);
          benefitsJson = raw.slice(0, 8000);
        } catch {
          return json({ error: 'tier_benefits_json invalide (JSON requis)' }, 400);
        }
      } else if (typeof raw === 'object') {
        benefitsJson = JSON.stringify(raw).slice(0, 8000);
      }
    }

    // ── bornage tenant + lookup agency ──────────────────────────────────────
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }
    const agencyId = await lookupAgencyId(env, clientId);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO loyalty_programs
         (id, client_id, agency_id, name, currency, earn_rate_per_dollar,
          redeem_rate_cents_per_point, min_redeem_points, points_expiry_days,
          tier_thresholds_json, tier_benefits_json, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'CAD', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        id,
        clientId,
        agencyId,
        name,
        earnRate,
        redeemRate,
        minRedeem,
        expiryDays,
        thresholdsJson,
        benefitsJson,
        now,
        now,
      )
      .run();

    await audit(env, auth.userId, 'loyalty_program_created', 'loyalty_program', id, {
      name,
      earn_rate_per_dollar: earnRate,
      redeem_rate_cents_per_point: redeemRate,
      min_redeem_points: minRedeem,
      has_expiry: expiryDays !== null,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        agency_id: agencyId,
        name,
        currency: 'CAD',
        earn_rate_per_dollar: earnRate,
        redeem_rate_cents_per_point: redeemRate,
        min_redeem_points: minRedeem,
        points_expiry_days: expiryDays,
        tier_thresholds_json: thresholdsJson,
        tier_benefits_json: benefitsJson,
        is_active: 1,
        created_at: now,
        updated_at: now,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── PATCH /api/loyalty/programs/:id — modifier ─────────────────────────────
export async function handleUpdateProgram(
  request: Request,
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'settings.manage');
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // ── bornage tenant strict avant UPDATE ──────────────────────────────────
    const existing = await loadProgramForTenant(env, clientId, id);
    if (!existing) return json({ error: 'Programme introuvable' }, 404);

    const sets: string[] = [];
    const bindings: unknown[] = [];
    const applied: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return json({ error: 'name invalide' }, 400);
      }
      const v = body.name.trim().slice(0, 200);
      sets.push('name = ?');
      bindings.push(v);
      applied.name = v;
    }

    if (body.earn_rate_per_dollar !== undefined) {
      const raw = body.earn_rate_per_dollar;
      const v = typeof raw === 'number' ? Math.round(raw) : NaN;
      if (!Number.isFinite(v) || v < 0) {
        return json({ error: 'earn_rate_per_dollar invalide (entier >= 0 requis)' }, 400);
      }
      sets.push('earn_rate_per_dollar = ?');
      bindings.push(v);
      applied.earn_rate_per_dollar = v;
    }

    if (body.redeem_rate_cents_per_point !== undefined) {
      const raw = body.redeem_rate_cents_per_point;
      const v = typeof raw === 'number' ? Math.round(raw) : NaN;
      if (!Number.isFinite(v) || v < 0) {
        return json(
          { error: 'redeem_rate_cents_per_point invalide (entier >= 0 requis)' },
          400,
        );
      }
      sets.push('redeem_rate_cents_per_point = ?');
      bindings.push(v);
      applied.redeem_rate_cents_per_point = v;
    }

    if (body.min_redeem_points !== undefined) {
      const raw = body.min_redeem_points;
      const v = typeof raw === 'number' ? Math.round(raw) : NaN;
      if (!Number.isFinite(v) || v < 0) {
        return json({ error: 'min_redeem_points invalide (entier >= 0 requis)' }, 400);
      }
      sets.push('min_redeem_points = ?');
      bindings.push(v);
      applied.min_redeem_points = v;
    }

    if (body.points_expiry_days !== undefined) {
      const raw = body.points_expiry_days;
      if (raw === null) {
        sets.push('points_expiry_days = NULL');
        applied.points_expiry_days = null;
      } else {
        const v = typeof raw === 'number' ? Math.round(raw) : NaN;
        if (!Number.isFinite(v) || v <= 0) {
          return json({ error: 'points_expiry_days invalide (entier > 0 ou null)' }, 400);
        }
        sets.push('points_expiry_days = ?');
        bindings.push(v);
        applied.points_expiry_days = v;
      }
    }

    if (body.tier_thresholds_json !== undefined) {
      const raw = body.tier_thresholds_json;
      let serialized: string;
      if (raw === null) {
        serialized = '{}';
      } else if (typeof raw === 'string') {
        try {
          JSON.parse(raw);
          serialized = raw.slice(0, 8000);
        } catch {
          return json({ error: 'tier_thresholds_json invalide (JSON requis)' }, 400);
        }
      } else if (typeof raw === 'object') {
        serialized = JSON.stringify(raw).slice(0, 8000);
      } else {
        return json({ error: 'tier_thresholds_json invalide' }, 400);
      }
      sets.push('tier_thresholds_json = ?');
      bindings.push(serialized);
      applied.tier_thresholds_json = serialized;
    }

    if (body.tier_benefits_json !== undefined) {
      const raw = body.tier_benefits_json;
      let serialized: string;
      if (raw === null) {
        serialized = '{}';
      } else if (typeof raw === 'string') {
        try {
          JSON.parse(raw);
          serialized = raw.slice(0, 8000);
        } catch {
          return json({ error: 'tier_benefits_json invalide (JSON requis)' }, 400);
        }
      } else if (typeof raw === 'object') {
        serialized = JSON.stringify(raw).slice(0, 8000);
      } else {
        return json({ error: 'tier_benefits_json invalide' }, 400);
      }
      sets.push('tier_benefits_json = ?');
      bindings.push(serialized);
      applied.tier_benefits_json = serialized;
    }

    if (body.is_active !== undefined) {
      const raw = body.is_active;
      const v = raw === true || raw === 1 ? 1 : raw === false || raw === 0 ? 0 : null;
      if (v === null) {
        return json({ error: 'is_active invalide (0 ou 1 requis)' }, 400);
      }
      sets.push('is_active = ?');
      bindings.push(v);
      applied.is_active = v;
    }

    if (sets.length === 0) {
      return json({ error: 'Aucun champ à modifier' }, 400);
    }

    const now = new Date().toISOString();
    sets.push('updated_at = ?');
    bindings.push(now);
    bindings.push(id);
    bindings.push(clientId);

    await env.DB.prepare(
      `UPDATE loyalty_programs SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
    )
      .bind(...bindings)
      .run();

    await audit(env, auth.userId, 'loyalty_program_updated', 'loyalty_program', id, {
      fields: Object.keys(applied),
    });

    return json({ data: { id, ...applied, updated_at: now } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── DELETE /api/loyalty/programs/:id — soft-disable ─────────────────────────
export async function handleDeleteProgram(
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'settings.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const existing = await loadProgramForTenant(env, clientId, id);
    if (!existing) return json({ error: 'Programme introuvable' }, 404);

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE loyalty_programs
          SET is_active = 0, updated_at = ?
        WHERE id = ? AND client_id = ?`,
    )
      .bind(now, id, clientId)
      .run();

    await audit(env, auth.userId, 'loyalty_program_disabled', 'loyalty_program', id, {});

    return json({ data: { id, deleted: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/loyalty/customers/:id/balance — balance customer ──────────────
// Accepte `clients.manage` OU `reports.view` (lecture cross-rôle).
export async function handleGetCustomerBalance(
  env: Env,
  auth: Auth,
  customerId: string,
  url: URL,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  // Cap OR : on accepte si l'un OU l'autre est présent.
  const hasClientsManage = caps.has('clients.manage');
  const hasReportsView = caps.has('reports.view');
  if (!hasClientsManage && !hasReportsView) {
    return json({ error: 'Accès refusé' }, 403);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    if (!customerId || customerId.length === 0) {
      return json({ error: 'customer_id requis' }, 400);
    }

    const programId = url.searchParams.get('program_id');

    if (programId && programId.length > 0) {
      // ── Bornage tenant via JOIN implicite : le program DOIT appartenir au tenant.
      const program = await loadProgramForTenant(env, clientId, programId);
      if (!program) return json({ error: 'Programme introuvable' }, 404);

      const row = (await env.DB.prepare(
        `SELECT * FROM loyalty_customer_state
          WHERE program_id = ? AND customer_id = ?
          LIMIT 1`,
      )
        .bind(programId, customerId)
        .first()) as LoyaltyStateRow | null;

      if (!row) {
        // État inexistant = balance 0 (pas d'erreur, customer n'a juste rien gagné).
        return json({
          data: {
            program_id: programId,
            client_id: clientId,
            customer_id: customerId,
            current_balance: 0,
            lifetime_earned: 0,
            current_tier: 'bronze',
            tier_updated_at: null,
            last_earn_at: null,
            last_redeem_at: null,
          },
        });
      }

      return json({ data: row });
    }

    // ── Tous programs du tenant : bornage par client_id.
    const { results } = await env.DB.prepare(
      `SELECT * FROM loyalty_customer_state
        WHERE client_id = ? AND customer_id = ?
        ORDER BY current_balance DESC`,
    )
      .bind(clientId, customerId)
      .all();

    return json({ data: results ?? [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/loyalty/earn — créditer points ───────────────────────────────
export async function handleEarnPoints(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'invoices.write');
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const programId =
      typeof body.program_id === 'string' && body.program_id.length > 0
        ? body.program_id.slice(0, 200)
        : '';
    if (!programId) return json({ error: 'program_id requis' }, 400);

    const customerId =
      typeof body.customer_id === 'string' && body.customer_id.length > 0
        ? body.customer_id.slice(0, 200)
        : '';
    if (!customerId) return json({ error: 'customer_id requis' }, 400);

    const orderId =
      typeof body.order_id === 'string' && body.order_id.length > 0
        ? body.order_id.slice(0, 200)
        : null;

    const subtotalRaw = body.subtotal_cents;
    const subtotalCents =
      typeof subtotalRaw === 'number' ? Math.round(subtotalRaw) : NaN;
    if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) {
      return json({ error: 'subtotal_cents invalide (entier > 0 requis)' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // ── bornage tenant + programme actif ────────────────────────────────────
    const program = await loadProgramForTenant(env, clientId, programId);
    if (!program) return json({ error: 'Programme introuvable' }, 404);
    if (!program.is_active) {
      return json({ error: 'Programme inactif' }, 400);
    }

    // ── state + multiplier tier ─────────────────────────────────────────────
    const state = await getOrCreateState(env.DB, programId, clientId, customerId);
    if (!state) {
      return json({ error: 'État customer indisponible' }, 500);
    }

    const multiplier = pickTierMultiplier(state.current_tier, program.tier_benefits_json);
    const points = computeEarnedPoints(subtotalCents, program.earn_rate_per_dollar, multiplier);

    if (points <= 0) {
      // Pas d'erreur — juste rien à créditer (sous-total trop faible).
      return json({
        data: {
          earned: 0,
          new_balance: state.current_balance,
          new_tier: state.current_tier,
          tier_changed: false,
        },
      });
    }

    const expiresAt = computeExpiryDate(new Date().toISOString(), program.points_expiry_days);

    const idempKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
        ? body.idempotency_key.slice(0, 200)
        : undefined;

    const result = await recordLedgerEntry(env.DB, {
      programId,
      clientId,
      customerId,
      points,
      type: 'earn',
      sourceOrderId: orderId,
      idempotencyKey: idempKey,
      expiresAt,
      createdByUserId: auth.userId,
    });

    if (!result.ok) {
      return json({ error: result.error || 'Crédit impossible' }, 400);
    }

    // ── tier après application (state vient d'être UPDATE par recordLedgerEntry) ──
    const after = await readCurrentBalance(env, programId, customerId);
    const tierChanged = after.tier !== state.current_tier;

    await audit(env, auth.userId, 'loyalty_points_earned', 'loyalty_program', programId, {
      customer_id: customerId,
      order_id: orderId,
      subtotal_cents: subtotalCents,
      points,
      multiplier,
      new_balance: result.newBalance,
      tier_changed: tierChanged,
    });

    return json({
      data: {
        earned: points,
        new_balance: result.newBalance ?? after.balance,
        new_tier: after.tier,
        tier_changed: tierChanged,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/loyalty/redeem — débiter points (ordre lié) ───────────────────
export async function handleRedeemPoints(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'invoices.write');
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const programId =
      typeof body.program_id === 'string' && body.program_id.length > 0
        ? body.program_id.slice(0, 200)
        : '';
    if (!programId) return json({ error: 'program_id requis' }, 400);

    const customerId =
      typeof body.customer_id === 'string' && body.customer_id.length > 0
        ? body.customer_id.slice(0, 200)
        : '';
    if (!customerId) return json({ error: 'customer_id requis' }, 400);

    const pointsRaw = body.points;
    const points = typeof pointsRaw === 'number' ? Math.round(pointsRaw) : NaN;
    if (!Number.isFinite(points) || points <= 0) {
      return json({ error: 'points invalide (entier > 0 requis)' }, 400);
    }

    const orderId =
      typeof body.order_id === 'string' && body.order_id.length > 0
        ? body.order_id.slice(0, 200)
        : null;

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const program = await loadProgramForTenant(env, clientId, programId);
    if (!program) return json({ error: 'Programme introuvable' }, 404);
    if (!program.is_active) {
      return json({ error: 'Programme inactif' }, 400);
    }

    if (points < program.min_redeem_points) {
      return json({ error: 'below_min_redeem' }, 400);
    }

    const state = await getOrCreateState(env.DB, programId, clientId, customerId);
    if (!state) {
      return json({ error: 'État customer indisponible' }, 500);
    }

    if (state.current_balance < points) {
      return json({ error: 'insufficient_points' }, 400);
    }

    const idempKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
        ? body.idempotency_key.slice(0, 200)
        : undefined;

    const result = await recordLedgerEntry(env.DB, {
      programId,
      clientId,
      customerId,
      points: -points,
      type: 'redeem',
      sourceOrderId: orderId,
      idempotencyKey: idempKey,
      createdByUserId: auth.userId,
    });

    if (!result.ok) {
      return json({ error: result.error || 'Débit impossible' }, 400);
    }

    const redeemValueCents = computeRedeemValueCents(
      points,
      program.redeem_rate_cents_per_point,
    );

    await audit(env, auth.userId, 'loyalty_points_redeemed', 'loyalty_program', programId, {
      customer_id: customerId,
      order_id: orderId,
      points,
      redeem_value_cents: redeemValueCents,
      new_balance: result.newBalance,
    });

    return json({
      data: {
        redeemed_value_cents: redeemValueCents,
        new_balance: result.newBalance ?? state.current_balance - points,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/loyalty/adjust — ajustement manuel (admin) ───────────────────
// Garde `clients.manage` — opération admin sensible (override balance).
export async function handleAdjustPoints(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const programId =
      typeof body.program_id === 'string' && body.program_id.length > 0
        ? body.program_id.slice(0, 200)
        : '';
    if (!programId) return json({ error: 'program_id requis' }, 400);

    const customerId =
      typeof body.customer_id === 'string' && body.customer_id.length > 0
        ? body.customer_id.slice(0, 200)
        : '';
    if (!customerId) return json({ error: 'customer_id requis' }, 400);

    const pointsRaw = body.points;
    const pointsSigned = typeof pointsRaw === 'number' ? Math.round(pointsRaw) : NaN;
    if (!Number.isFinite(pointsSigned) || pointsSigned === 0) {
      return json({ error: 'points invalide (entier signé != 0 requis)' }, 400);
    }

    const reason =
      typeof body.reason === 'string' && body.reason.trim().length > 0
        ? body.reason.trim().slice(0, 500)
        : '';
    if (!reason) {
      return json({ error: 'reason requis pour un ajustement manuel' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const program = await loadProgramForTenant(env, clientId, programId);
    if (!program) return json({ error: 'Programme introuvable' }, 404);

    const state = await getOrCreateState(env.DB, programId, clientId, customerId);
    if (!state) {
      return json({ error: 'État customer indisponible' }, 500);
    }

    // ── garde-fou : ajustement négatif ne doit pas créer balance < 0 ────────
    if (pointsSigned < 0 && state.current_balance + pointsSigned < 0) {
      return json({ error: 'insufficient_points' }, 400);
    }

    const idempKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
        ? body.idempotency_key.slice(0, 200)
        : undefined;

    const result = await recordLedgerEntry(env.DB, {
      programId,
      clientId,
      customerId,
      points: pointsSigned,
      type: 'adjust',
      sourceOrderId: null,
      idempotencyKey: idempKey,
      createdByUserId: auth.userId,
    });

    if (!result.ok) {
      return json({ error: result.error || 'Ajustement impossible' }, 400);
    }

    await audit(env, auth.userId, 'loyalty_points_adjusted', 'loyalty_program', programId, {
      customer_id: customerId,
      points: pointsSigned,
      reason,
      new_balance: result.newBalance,
    });

    return json({
      data: {
        new_balance: result.newBalance ?? state.current_balance + pointsSigned,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/loyalty/customers/:id/ledger — historique ─────────────────────
export async function handleListLedger(
  env: Env,
  auth: Auth,
  customerId: string,
  url: URL,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'reports.view');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    if (!customerId || customerId.length === 0) {
      return json({ error: 'customer_id requis' }, 400);
    }

    const programId = url.searchParams.get('program_id');

    // ── bornage tenant : client_id sur ledger (dénormalisé seq133 ligne 102).
    const where: string[] = ['client_id = ?', 'customer_id = ?'];
    const bindings: unknown[] = [clientId, customerId];

    if (programId && programId.length > 0) {
      // Vérifie que le program appartient au tenant (anti-leak cross-tenant).
      const program = await loadProgramForTenant(env, clientId, programId);
      if (!program) return json({ error: 'Programme introuvable' }, 404);
      where.push('program_id = ?');
      bindings.push(programId);
    }

    const sql =
      `SELECT * FROM loyalty_ledger WHERE ${where.join(' AND ')} ` +
      `ORDER BY created_at DESC LIMIT 100`;
    const { results } = await env.DB.prepare(sql).bind(...bindings).all();

    return json({ data: results ?? [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/loyalty/cron/expire-points — CRON expire points échus ─────────
// Garde `settings.manage` — opération admin/cron sensible (mutation cross-tenant
// au sein du client courant).
export async function handleRunExpiryCron(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  void request;
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'settings.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // ── sélectionne tous les programmes du tenant (actifs ET inactifs : on
    //    veut quand même expirer les points des programmes désactivés).
    const { results } = await env.DB.prepare(
      'SELECT id FROM loyalty_programs WHERE client_id = ?',
    )
      .bind(clientId)
      .all();

    const programs = (results ?? []) as Array<{ id: string }>;
    const asOf = new Date().toISOString();

    let totalExpired = 0;
    let programsProcessed = 0;

    for (const p of programs) {
      try {
        const r = await expirePendingPoints(env.DB, p.id, asOf);
        if (r.ok) {
          totalExpired += r.expiredEntries ?? 0;
          programsProcessed++;
        }
      } catch {
        // Best-effort : on continue même si un programme échoue.
      }
    }

    await audit(env, auth.userId, 'loyalty_expiry_cron', 'loyalty_program', 'cron', {
      expired_count: totalExpired,
      programs_processed: programsProcessed,
      programs_scanned: programs.length,
    });

    // ── tier recompute : recordLedgerEntry / expirePendingPoints le font déjà.
    // Garde-fou explicite via deriveTier ici inutile (l'engine gère).
    void deriveTier;

    return json({
      data: {
        expired_count: totalExpired,
        programs_processed: programsProcessed,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
