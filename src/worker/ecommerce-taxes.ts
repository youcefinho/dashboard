// ── Handlers CRUD tax_rates — Sprint 70 (Calculateur de Taxes) ───────────────────
//
// Gère le référentiel plat des taux de taxes simplifiés par pays/province.
// 4 endpoints d'administration :
//   - GET    /api/tax-rates                 → liste les taux du tenant
//   - POST   /api/tax-rates                 → crée un taux de taxe
//   - PUT    /api/tax-rates/:id             → met à jour un taux de taxe
//   - DELETE /api/tax-rates/:id             → supprime un taux de taxe (hard delete)
//
// Capability `settings.manage` requise sur toutes les routes.
// Bornage tenant strict : client_id résolu via getClientModules.
// Réponses normalisées : json({ data }) ou json({ error }, status).

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { getClientModules } from './modules';

type Auth = CapAuth & { capabilities?: Set<string> };

/** Résout les capabilities du connecté. */
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

/** Vérifie la capability settings.manage. */
async function requireSettingsManage(env: Env, auth: Auth): Promise<Response | null> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'settings.manage');
  return denied || null;
}

function noClient(): Response {
  return json({ error: 'Client introuvable' }, 400);
}

/**
 * GET /api/tax-rates
 * Liste les taux de taxes du tenant.
 */
export async function handleListTaxRates(
  env: Env,
  auth: Auth,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const { results } = await env.DB.prepare(
      `SELECT id, client_id, country, state_province, rate_tps, rate_tvq, rate_tva, is_active, created_at, updated_at
       FROM tax_rates
       WHERE client_id = ?
       ORDER BY country, state_province`,
    )
      .bind(clientId)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/tax-rates
 * Crée un nouveau taux de taxe.
 * Body : { country, state_province?, rate_tps?, rate_tvq?, rate_tva?, is_active? }
 */
export async function handleCreateTaxRate(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const country = sanitizeInput(typeof body.country === 'string' ? body.country : '', 2).toUpperCase();
    if (!country || country.length !== 2) {
      return json({ error: 'Le code pays (country) de 2 lettres est requis' }, 400);
    }

    const stateProvince =
      typeof body.state_province === 'string' && body.state_province.length > 0
        ? sanitizeInput(body.state_province, 50).toUpperCase()
        : null;

    const rateTps = typeof body.rate_tps === 'number' ? Math.max(0, body.rate_tps) : 0;
    const rateTvq = typeof body.rate_tvq === 'number' ? Math.max(0, body.rate_tvq) : 0;
    const rateTva = typeof body.rate_tva === 'number' ? Math.max(0, body.rate_tva) : 0;
    const isActive = body.is_active === 0 ? 0 : 1;

    // Éviter les doublons exacts pays/province pour le même tenant
    const clash = await env.DB.prepare(
      `SELECT id FROM tax_rates 
       WHERE client_id = ? AND country = ? AND (state_province = ? OR (state_province IS NULL AND ? IS NULL))`,
    )
      .bind(clientId, country, stateProvince, stateProvince)
      .first();

    if (clash) {
      return json({ error: 'Un taux de taxe existe déjà pour ce pays/province' }, 409);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tax_rates (id, client_id, country, state_province, rate_tps, rate_tvq, rate_tva, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(id, clientId, country, stateProvince, rateTps, rateTvq, rateTva, isActive)
      .run();

    await audit(env, auth.userId, 'tax_rate_created', 'tax_rate', id, {
      country,
      state_province: stateProvince,
      rate_tps: rateTps,
      rate_tvq: rateTvq,
      rate_tva: rateTva,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        country,
        state_province: stateProvince,
        rate_tps: rateTps,
        rate_tvq: rateTvq,
        rate_tva: rateTva,
        is_active: isActive,
      },
    }, 201);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * PUT /api/tax-rates/:id
 * Met à jour un taux de taxe existant.
 */
export async function handleUpdateTaxRate(
  request: Request,
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    // Vérifier l'appartenance de la ligne au tenant (anti-IDOR)
    const existing = await env.DB.prepare(
      'SELECT id FROM tax_rates WHERE id = ? AND client_id = ?',
    )
      .bind(id, clientId)
      .first();

    if (!existing) {
      return json({ error: 'Taux de taxe introuvable' }, 404);
    }

    const sets: string[] = [];
    const bindings: unknown[] = [];
    const echo: Record<string, unknown> = {};

    if (typeof body.country === 'string') {
      const country = sanitizeInput(body.country, 2).toUpperCase();
      if (country.length !== 2) {
        return json({ error: 'Code pays (country) de 2 lettres invalide' }, 400);
      }
      sets.push('country = ?');
      bindings.push(country);
      echo.country = country;
    }

    if (body.state_province !== undefined) {
      const stateProvince =
        typeof body.state_province === 'string' && body.state_province.length > 0
          ? sanitizeInput(body.state_province, 50).toUpperCase()
          : null;
      sets.push('state_province = ?');
      bindings.push(stateProvince);
      echo.state_province = stateProvince;
    }

    if (typeof body.rate_tps === 'number') {
      const v = Math.max(0, body.rate_tps);
      sets.push('rate_tps = ?');
      bindings.push(v);
      echo.rate_tps = v;
    }

    if (typeof body.rate_tvq === 'number') {
      const v = Math.max(0, body.rate_tvq);
      sets.push('rate_tvq = ?');
      bindings.push(v);
      echo.rate_tvq = v;
    }

    if (typeof body.rate_tva === 'number') {
      const v = Math.max(0, body.rate_tva);
      sets.push('rate_tva = ?');
      bindings.push(v);
      echo.rate_tva = v;
    }

    if (body.is_active !== undefined) {
      const v = body.is_active === 0 || body.is_active === false ? 0 : 1;
      sets.push('is_active = ?');
      bindings.push(v);
      echo.is_active = v;
    }

    if (sets.length === 0) {
      return json({ error: 'Aucun champ à mettre à jour' }, 400);
    }

    sets.push("updated_at = datetime('now')");
    bindings.push(id, clientId);

    await env.DB.prepare(
      `UPDATE tax_rates SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
    )
      .bind(...bindings)
      .run();

    await audit(env, auth.userId, 'tax_rate_updated', 'tax_rate', id, echo);

    return json({ data: { id, ...echo } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * DELETE /api/tax-rates/:id
 * Supprime définitivement un taux de taxe (hard delete).
 */
export async function handleDeleteTaxRate(
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    // Vérifier l'appartenance de la ligne au tenant (anti-IDOR)
    const existing = await env.DB.prepare(
      'SELECT id FROM tax_rates WHERE id = ? AND client_id = ?',
    )
      .bind(id, clientId)
      .first();

    if (!existing) {
      return json({ error: 'Taux de taxe introuvable' }, 404);
    }

    await env.DB.prepare('DELETE FROM tax_rates WHERE id = ? AND client_id = ?')
      .bind(id, clientId)
      .run();

    await audit(env, auth.userId, 'tax_rate_deleted', 'tax_rate', id, {});

    return json({ data: { id, deleted: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
