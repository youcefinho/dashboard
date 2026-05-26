// ── Tax regions — Sprint 39 impl (2026-05-24, A3) ─────────────────────────
//
// Handlers REST référentiel admin-managed RÉGIONS FISCALES + RÈGLES par
// catégorie produit (`tax_regions` + `tax_rules` seq134). 7 endpoints :
//   - GET    /api/tax-regions                 → list régions tenant
//   - POST   /api/tax-regions                 → create région (admin)
//   - PUT    /api/tax-regions/:id             → update région (admin)
//   - DELETE /api/tax-regions/:id             → delete région (admin, soft)
//   - GET    /api/tax-regions/:id/rules       → list règles d'une région
//   - POST   /api/tax-regions/:id/rules       → create règle (admin)
//   - DELETE /api/tax-rules/:id               → delete règle isolée (admin)
//
// Capability `settings.manage` partout (FIGÉE seq80 — admin-managed).
//
// Réponses normalisées :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)        ← JAMAIS de champ `code`
//
// Bornage tenant strict : `WHERE client_id = ?` sur tax_regions (defense-in-
// depth IDOR sur `:id`). Pour tax_rules : JOIN tax_regions ON region_id WHERE
// tax_regions.client_id = ? (anti-IDOR cross-tenant via :id rule).

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { getClientModules } from './modules';

type Auth = CapAuth & { capabilities?: Set<string> };

// Enum FIGÉ type tax_regions.
const VALID_REGION_TYPES = new Set(['vat', 'gst_pst', 'sales_tax', 'tva_dz', 'exempt']);

/** Résout capabilities (préférer celles injectées au choke-point). */
async function getCaps(env: Env, auth: Auth): Promise<Set<string>> {
  return auth.capabilities instanceof Set
    ? auth.capabilities
    : await resolveCapabilities(env, auth);
}

/** Résout le client_id du tenant courant (bornage strict). */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Garde-fou commun : `settings.manage` requis pour toutes routes admin-managed. */
async function requireSettingsManage(env: Env, auth: Auth): Promise<Response | null> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'settings.manage');
  return denied || null;
}

function noClient(): Response {
  return json({ error: 'Client introuvable' }, 400);
}

/** Parse safe d'une string JSON object (sinon objet vide). */
function safeParseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    if (raw.length === 0) return {};
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Vérifie qu'une région appartient au tenant courant. Retourne la région ou
 * null. Anti-IDOR strict.
 */
async function fetchRegionForTenant(
  env: Env,
  regionId: string,
  clientId: string,
): Promise<{ id: string; client_id: string } | null> {
  const row = (await env.DB.prepare(
    'SELECT id, client_id FROM tax_regions WHERE id = ? AND client_id = ?',
  )
    .bind(regionId, clientId)
    .first()) as { id: string; client_id: string } | null;
  return row || null;
}

// ── Handlers tax_regions ───────────────────────────────────────────────────

/**
 * GET /api/tax-regions — liste des régions fiscales du tenant.
 * Filtre optionnel ?active=1 (par défaut, retourne actives + inactives).
 * `rates_json` est parsé en objet pour le front.
 */
export async function handleListTaxRegions(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const activeRaw = url.searchParams.get('active');
    const conds: string[] = ['client_id = ?'];
    const bindings: unknown[] = [clientId];
    if (activeRaw === '1' || activeRaw === '0') {
      conds.push('active = ?');
      bindings.push(activeRaw === '1' ? 1 : 0);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, client_id, code, name, country, country_subdiv, type,
              rates_json, tax_inclusive, active, created_at, updated_at
       FROM tax_regions
       WHERE ${conds.join(' AND ')}
       ORDER BY country, code`,
    )
      .bind(...bindings)
      .all();

    const rows = (results || []).map((r) => {
      const row = r as Record<string, unknown>;
      const parsed = safeParseJsonObject(row.rates_json);
      return { ...row, rates_json: parsed ?? {} };
    });

    return json({ data: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/tax-regions — crée une nouvelle région fiscale.
 * Body : { code, name, country, country_subdiv?, type, rates_json?,
 *          tax_inclusive? }.
 */
export async function handleCreateTaxRegion(
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

    const code = sanitizeInput(typeof body.code === 'string' ? body.code : '', 32);
    if (!code) return json({ error: 'code est requis' }, 400);

    const name = sanitizeInput(typeof body.name === 'string' ? body.name : '', 200);
    if (!name) return json({ error: 'name est requis' }, 400);

    const country = sanitizeInput(typeof body.country === 'string' ? body.country : '', 8);
    if (!country) return json({ error: 'country est requis' }, 400);

    const countrySubdiv =
      typeof body.country_subdiv === 'string' && body.country_subdiv.length > 0
        ? sanitizeInput(body.country_subdiv, 16)
        : null;

    const type = typeof body.type === 'string' ? body.type : '';
    if (!VALID_REGION_TYPES.has(type)) {
      return json(
        { error: 'type invalide (valeurs : vat|gst_pst|sales_tax|tva_dz|exempt)' },
        400,
      );
    }

    const parsedRates = safeParseJsonObject(body.rates_json);
    if (parsedRates === null) {
      return json({ error: 'rates_json doit être un objet JSON' }, 400);
    }
    const ratesJson = JSON.stringify(parsedRates);

    const taxInclusive =
      body.tax_inclusive === true || body.tax_inclusive === 1 ? 1 : 0;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tax_regions
         (id, client_id, code, name, country, country_subdiv, type,
          rates_json, tax_inclusive, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        clientId,
        code,
        name,
        country,
        countrySubdiv,
        type,
        ratesJson,
        taxInclusive,
      )
      .run();

    await audit(env, auth.userId, 'tax_region_created', 'tax_region', id, {
      code,
      country,
      type,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        code,
        name,
        country,
        country_subdiv: countrySubdiv,
        type,
        rates_json: parsedRates,
        tax_inclusive: taxInclusive,
        active: 1,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * PUT /api/tax-regions/:id — patch partiel d'une région.
 * Body partiel : { code?, name?, country?, country_subdiv?, type?, rates_json?,
 *                  tax_inclusive?, active? }.
 * Bornage strict WHERE id = ? AND client_id = ?.
 */
export async function handleUpdateTaxRegion(
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

    const sets: string[] = [];
    const bindings: unknown[] = [];
    const echo: Record<string, unknown> = {};

    if (typeof body.code === 'string') {
      const v = sanitizeInput(body.code, 32);
      if (!v) return json({ error: 'code ne peut pas être vide' }, 400);
      sets.push('code = ?');
      bindings.push(v);
      echo.code = v;
    }
    if (typeof body.name === 'string') {
      const v = sanitizeInput(body.name, 200);
      if (!v) return json({ error: 'name ne peut pas être vide' }, 400);
      sets.push('name = ?');
      bindings.push(v);
      echo.name = v;
    }
    if (typeof body.country === 'string') {
      const v = sanitizeInput(body.country, 8);
      if (!v) return json({ error: 'country ne peut pas être vide' }, 400);
      sets.push('country = ?');
      bindings.push(v);
      echo.country = v;
    }
    if (body.country_subdiv !== undefined) {
      if (body.country_subdiv === null) {
        sets.push('country_subdiv = ?');
        bindings.push(null);
        echo.country_subdiv = null;
      } else if (typeof body.country_subdiv === 'string') {
        const v = sanitizeInput(body.country_subdiv, 16);
        sets.push('country_subdiv = ?');
        bindings.push(v || null);
        echo.country_subdiv = v || null;
      } else {
        return json({ error: 'country_subdiv invalide' }, 400);
      }
    }
    if (body.type !== undefined) {
      if (typeof body.type !== 'string' || !VALID_REGION_TYPES.has(body.type)) {
        return json(
          { error: 'type invalide (valeurs : vat|gst_pst|sales_tax|tva_dz|exempt)' },
          400,
        );
      }
      sets.push('type = ?');
      bindings.push(body.type);
      echo.type = body.type;
    }
    if (body.rates_json !== undefined) {
      const parsed = safeParseJsonObject(body.rates_json);
      if (parsed === null) {
        return json({ error: 'rates_json doit être un objet JSON' }, 400);
      }
      sets.push('rates_json = ?');
      bindings.push(JSON.stringify(parsed));
      echo.rates_json = parsed;
    }
    if (body.tax_inclusive !== undefined) {
      const v =
        body.tax_inclusive === true || body.tax_inclusive === 1 ? 1 : 0;
      sets.push('tax_inclusive = ?');
      bindings.push(v);
      echo.tax_inclusive = v;
    }
    if (body.active !== undefined) {
      const v = body.active === false || body.active === 0 ? 0 : 1;
      sets.push('active = ?');
      bindings.push(v);
      echo.active = v;
    }

    if (sets.length === 0) {
      return json({ error: 'Aucun champ à mettre à jour' }, 400);
    }

    sets.push("updated_at = datetime('now')");
    bindings.push(id, clientId);

    const res = await env.DB.prepare(
      `UPDATE tax_regions SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
    )
      .bind(...bindings)
      .run();

    const changes = (res?.meta?.changes ?? 0) as number;
    if (changes === 0) {
      return json({ error: 'Région fiscale introuvable' }, 404);
    }

    await audit(env, auth.userId, 'tax_region_updated', 'tax_region', id, echo);

    return json({ data: { id, ...echo } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * DELETE /api/tax-regions/:id — soft-delete (active = 0) d'une région.
 * Bornage strict WHERE id = ? AND client_id = ?.
 */
export async function handleDeleteTaxRegion(
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const res = await env.DB.prepare(
      `UPDATE tax_regions
       SET active = 0, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .run();

    const changes = (res?.meta?.changes ?? 0) as number;
    if (changes === 0) {
      return json({ error: 'Région fiscale introuvable' }, 404);
    }

    await audit(env, auth.userId, 'tax_region_deleted', 'tax_region', id, {
      soft: true,
    });

    return json({ data: { id, deleted: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── Handlers tax_rules ─────────────────────────────────────────────────────

/**
 * GET /api/tax-regions/:id/rules — liste des règles d'une région.
 * Bornage : vérifier que la région appartient au tenant courant AVANT lookup.
 */
export async function handleListTaxRules(
  env: Env,
  auth: Auth,
  regionId: string,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const region = await fetchRegionForTenant(env, regionId, clientId);
    if (!region) {
      return json({ error: 'Région fiscale introuvable' }, 404);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, region_id, product_category, rate, compound, applies_from, created_at
       FROM tax_rules
       WHERE region_id = ?
       ORDER BY applies_from DESC`,
    )
      .bind(regionId)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/tax-regions/:id/rules — crée une règle dans une région.
 * Body : { product_category, rate, compound?, applies_from? }.
 * Bornage : région doit appartenir au tenant.
 */
export async function handleCreateTaxRule(
  request: Request,
  env: Env,
  auth: Auth,
  regionId: string,
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

    const region = await fetchRegionForTenant(env, regionId, clientId);
    if (!region) {
      return json({ error: 'Région fiscale introuvable' }, 404);
    }

    const productCategory = sanitizeInput(
      typeof body.product_category === 'string' ? body.product_category : '',
      64,
    );
    if (!productCategory) {
      return json({ error: 'product_category est requis' }, 400);
    }

    const rate = typeof body.rate === 'number' ? body.rate : Number.NaN;
    if (!Number.isFinite(rate) || rate < 0) {
      return json({ error: 'rate doit être un nombre >= 0' }, 400);
    }

    const compound = body.compound === true || body.compound === 1 ? 1 : 0;

    let appliesFrom: string;
    if (typeof body.applies_from === 'string' && body.applies_from.length > 0) {
      appliesFrom = sanitizeInput(body.applies_from, 64);
    } else {
      appliesFrom = new Date().toISOString();
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tax_rules
         (id, region_id, product_category, rate, compound, applies_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(id, regionId, productCategory, rate, compound, appliesFrom)
      .run();

    await audit(env, auth.userId, 'tax_rule_created', 'tax_rule', id, {
      region_id: regionId,
      product_category: productCategory,
      rate,
    });

    return json({
      data: {
        id,
        region_id: regionId,
        product_category: productCategory,
        rate,
        compound,
        applies_from: appliesFrom,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * DELETE /api/tax-rules/:id — supprime une règle isolée (hard delete).
 * Bornage anti-IDOR : JOIN tax_regions pour vérifier que la règle appartient
 * à une région appartenant au tenant courant.
 */
export async function handleDeleteTaxRule(
  env: Env,
  auth: Auth,
  ruleId: string,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    // Anti-IDOR : on confirme que la règle existe ET appartient à une région
    // du tenant courant avant DELETE.
    const owner = (await env.DB.prepare(
      `SELECT tr.id AS rule_id
       FROM tax_rules tr
       JOIN tax_regions reg ON reg.id = tr.region_id
       WHERE tr.id = ? AND reg.client_id = ?`,
    )
      .bind(ruleId, clientId)
      .first()) as { rule_id: string } | null;

    if (!owner) {
      return json({ error: 'Règle fiscale introuvable' }, 404);
    }

    await env.DB.prepare('DELETE FROM tax_rules WHERE id = ?')
      .bind(ruleId)
      .run();

    await audit(env, auth.userId, 'tax_rule_deleted', 'tax_rule', ruleId, {});

    return json({ data: { id: ruleId, deleted: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
