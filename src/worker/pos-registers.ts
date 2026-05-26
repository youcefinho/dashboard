// ── POS registers (caisses) — Sprint 37 IMPL (2026-05-24) ──────────────────
//
// Handlers AUTHED CRUD `pos_registers` (caisses physiques par tenant).
// Bornage tenant strict (`WHERE client_id = ?`) defense-in-depth IDOR.
// Capability seq80 FIGÉE : `clients.manage` (admin caisse).
// Réponses normalisées : json({ data }) succès / json({ error }, status) erreur.
// PAS de champ `code`.
//
// ⚠️ FIGÉ contrat (docs/LOT-POS-S37.md §6) — signatures invariantes.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { getClientModules } from './modules';

type Auth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

/** Résout le client_id du tenant courant (calque chat-widgets.ts:26). */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Résout capabilities (préférer celles injectées au choke-point). */
async function getCaps(env: Env, auth: Auth): Promise<Set<string>> {
  return auth.capabilities instanceof Set
    ? auth.capabilities
    : await resolveCapabilities(env, auth);
}

// Enum FIGÉ tax_region (verbatim ecommerce-tax-engine.ts).
const VALID_TAX_REGIONS = new Set(['qc', 'eu', 'dz', 'exempt']);

// Colonnes SELECT communes.
const REGISTER_SELECT_COLS =
  `id, client_id, name, location, currency, is_active, default_tax_region,
   printer_config_json, created_at, updated_at`;

// ── GET /api/pos/registers — liste des caisses du tenant ────────────────────
export async function handleListRegisters(
  env: Env,
  auth: Auth,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const { results } = await env.DB.prepare(
      `SELECT ${REGISTER_SELECT_COLS}
       FROM pos_registers
       WHERE client_id = ?
       ORDER BY name`,
    )
      .bind(clientId)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/pos/registers — créer une caisse ──────────────────────────────
export async function handleCreateRegister(
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

    // ── validation name (requis non-vide) ─────────────────────────────────
    const name = sanitizeInput(
      typeof body.name === 'string' ? body.name : '',
      200,
    );
    if (!name) {
      return json({ error: 'Le nom de la caisse est requis' }, 400);
    }

    // ── champs optionnels ─────────────────────────────────────────────────
    const location =
      typeof body.location === 'string'
        ? sanitizeInput(body.location, 500)
        : '';

    const currency =
      typeof body.currency === 'string' && body.currency.trim().length > 0
        ? sanitizeInput(body.currency, 8)
        : 'CAD';

    const defaultTaxRegion =
      typeof body.default_tax_region === 'string' &&
      body.default_tax_region.length > 0
        ? body.default_tax_region
        : 'qc';
    if (!VALID_TAX_REGIONS.has(defaultTaxRegion)) {
      return json(
        { error: 'default_tax_region invalide (valeurs : qc|eu|dz|exempt)' },
        400,
      );
    }

    // ── printer_config_json (objet JSON ou string, défaut '{}') ───────────
    let printerConfigJson = '{}';
    if (body.printer_config_json !== undefined && body.printer_config_json !== null) {
      if (typeof body.printer_config_json === 'string') {
        const raw = body.printer_config_json;
        if (raw.length > 0) {
          try {
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              return json({ error: 'printer_config_json doit être un objet JSON' }, 400);
            }
            printerConfigJson = JSON.stringify(parsed);
          } catch {
            return json({ error: 'printer_config_json invalide (JSON malformé)' }, 400);
          }
        }
      } else if (
        typeof body.printer_config_json === 'object' &&
        !Array.isArray(body.printer_config_json)
      ) {
        printerConfigJson = JSON.stringify(body.printer_config_json);
      } else {
        return json({ error: 'printer_config_json doit être un objet JSON' }, 400);
      }
    }

    // ── bornage tenant ────────────────────────────────────────────────────
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO pos_registers (
         id, client_id, name, location, currency, is_active, default_tax_region,
         printer_config_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        clientId,
        name,
        location,
        currency,
        defaultTaxRegion,
        printerConfigJson,
      )
      .run();

    await audit(env, auth.userId, 'pos_register_created', 'pos_register', id, {
      name,
      currency,
      default_tax_region: defaultTaxRegion,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        name,
        location,
        currency,
        is_active: 1,
        default_tax_region: defaultTaxRegion,
        printer_config_json: printerConfigJson,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── PATCH /api/pos/registers/:id — modifier une caisse ──────────────────────
export async function handleUpdateRegister(
  request: Request,
  env: Env,
  auth: Auth,
  id: string,
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

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // ── UPDATE conditionnel sur les champs présents ───────────────────────
    const sets: string[] = [];
    const bindings: unknown[] = [];
    const echo: Record<string, unknown> = {};

    if (typeof body.name === 'string') {
      const v = sanitizeInput(body.name, 200);
      if (!v) return json({ error: 'Le nom de la caisse ne peut pas être vide' }, 400);
      sets.push('name = ?');
      bindings.push(v);
      echo.name = v;
    }

    if (typeof body.location === 'string') {
      const v = sanitizeInput(body.location, 500);
      sets.push('location = ?');
      bindings.push(v);
      echo.location = v;
    }

    if (typeof body.currency === 'string') {
      const v = sanitizeInput(body.currency, 8);
      if (!v) return json({ error: 'currency ne peut pas être vide' }, 400);
      sets.push('currency = ?');
      bindings.push(v);
      echo.currency = v;
    }

    if (body.default_tax_region !== undefined) {
      if (
        typeof body.default_tax_region !== 'string' ||
        !VALID_TAX_REGIONS.has(body.default_tax_region)
      ) {
        return json(
          { error: 'default_tax_region invalide (valeurs : qc|eu|dz|exempt)' },
          400,
        );
      }
      sets.push('default_tax_region = ?');
      bindings.push(body.default_tax_region);
      echo.default_tax_region = body.default_tax_region;
    }

    if (body.printer_config_json !== undefined) {
      let serialized = '{}';
      if (body.printer_config_json === null) {
        serialized = '{}';
      } else if (typeof body.printer_config_json === 'string') {
        const raw = body.printer_config_json;
        if (raw.length === 0) {
          serialized = '{}';
        } else {
          try {
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              return json({ error: 'printer_config_json doit être un objet JSON' }, 400);
            }
            serialized = JSON.stringify(parsed);
          } catch {
            return json({ error: 'printer_config_json invalide (JSON malformé)' }, 400);
          }
        }
      } else if (
        typeof body.printer_config_json === 'object' &&
        !Array.isArray(body.printer_config_json)
      ) {
        serialized = JSON.stringify(body.printer_config_json);
      } else {
        return json({ error: 'printer_config_json doit être un objet JSON' }, 400);
      }
      sets.push('printer_config_json = ?');
      bindings.push(serialized);
      echo.printer_config_json = serialized;
    }

    if (body.is_active !== undefined) {
      const v = body.is_active === false || body.is_active === 0 ? 0 : 1;
      sets.push('is_active = ?');
      bindings.push(v);
      echo.is_active = v;
    }

    if (sets.length === 0) {
      return json({ error: 'Aucun champ à mettre à jour' }, 400);
    }

    sets.push("updated_at = datetime('now')");
    bindings.push(id, clientId);

    const res = await env.DB.prepare(
      `UPDATE pos_registers SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
    )
      .bind(...bindings)
      .run();

    const changes = (res?.meta?.changes ?? 0) as number;
    if (changes === 0) {
      return json({ error: 'Caisse introuvable' }, 404);
    }

    await audit(env, auth.userId, 'pos_register_updated', 'pos_register', id, echo);

    return json({ data: { id, ...echo } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
