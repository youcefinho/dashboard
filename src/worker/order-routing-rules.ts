// ── Order Routing Rules CRUD — Sprint 66 (2026-05-29) ─────────────────────────
//
// CRUD administratif des règles de routage de commandes pour le module Boutique.
// Multi-tenant strict : filtré par client_id résolu.
// Rôles : mutations restreintes par capability `clients.manage`.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit } from './helpers';
import { getClientModules } from './modules';

export type Auth = CapAuth & { capabilities?: Set<string>; role?: string };

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

function clientsCapGuard(auth: Auth): Response | undefined {
  return requireCapability(auth.capabilities, 'clients.manage');
}

interface OrderRoutingRuleRow {
  id: string;
  client_id: string;
  name: string;
  priority: number;
  conditions_json: string;
  action_warehouse_id: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const ROUTING_COLS =
  'id, client_id, name, priority, conditions_json, action_warehouse_id, is_active, created_at, updated_at';

/**
 * GET /api/ecommerce/order-routing-rules — liste des règles de routage du tenant.
 */
export async function handleListOrderRoutingRules(
  env: Env, auth: Auth, url: URL,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
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
      `SELECT ${ROUTING_COLS} FROM order_routing_rules
        WHERE client_id = ?
        ORDER BY priority DESC, created_at DESC
        LIMIT ? OFFSET ?`,
    ).bind(clientId, limit, offset).all();

    const totalRow = (await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM order_routing_rules WHERE client_id = ?',
    ).bind(clientId).first()) as { c: number } | null;

    return json({ data: results || [], total: totalRow?.c ?? (results || []).length });
  } catch {
    return json({ data: [], total: 0 });
  }
}

/** Normalise et valide le payload d'écriture d'une règle. */
function normalizeRuleInput(body: Record<string, unknown>): {
  name: string;
  priority: number;
  conditions_json: string;
  action_warehouse_id: string;
  is_active: number;
} {
  const name = (body.name as string || '').toString().trim().slice(0, 200);
  const rawPriority = Number(body.priority);
  const priority = Number.isFinite(rawPriority) ? Math.max(0, Math.round(rawPriority)) : 0;

  const action_warehouse_id = (body.action_warehouse_id as string || '').toString().trim();
  const is_active = body.is_active === false || body.is_active === 0 ? 0 : 1;

  let conditions_json = '[]';
  if (body.conditions_json) {
    if (typeof body.conditions_json === 'string') {
      conditions_json = body.conditions_json;
    } else {
      try {
        conditions_json = JSON.stringify(body.conditions_json);
      } catch {
        conditions_json = '[]';
      }
    }
  }

  return {
    name,
    priority,
    conditions_json,
    action_warehouse_id,
    is_active,
  };
}

/**
 * POST /api/ecommerce/order-routing-rules — création d'une règle de routage.
 */
export async function handleCreateOrderRoutingRule(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const r = normalizeRuleInput(body);
  if (!r.name) {
    return json({ error: 'Nom requis', message: 'Le nom de la règle est obligatoire.' }, 400);
  }
  if (!r.action_warehouse_id) {
    return json({ error: 'Entrepôt cible requis', message: 'L’entrepôt de destination est obligatoire.' }, 400);
  }

  // Vérifier que l'entrepôt cible existe pour ce client
  try {
    const wh = await env.DB.prepare(
      'SELECT id FROM warehouses WHERE id = ? AND client_id = ? LIMIT 1'
    ).bind(r.action_warehouse_id, clientId).first();
    if (!wh) {
      return json({ error: 'Entrepôt introuvable', message: 'L’entrepôt sélectionné n’existe pas pour ce client.' }, 400);
    }
  } catch {
    // Best-effort
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO order_routing_rules
         (id, client_id, name, priority, conditions_json, action_warehouse_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(
      id, clientId, r.name, r.priority, r.conditions_json, r.action_warehouse_id, r.is_active
    ).run();

    await audit(env, auth.userId, 'create', 'order_routing_rule', id, {
      name: r.name,
      priority: r.priority,
    });

    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Impossible d’enregistrer la règle de routage' }, 500);
  }
}

/**
 * GET /api/ecommerce/order-routing-rules/:id — détail d'une règle de routage.
 */
export async function handleGetOrderRoutingRule(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const row = (await env.DB.prepare(
      `SELECT ${ROUTING_COLS} FROM order_routing_rules WHERE id = ? AND client_id = ?`,
    ).bind(id, clientId).first()) as OrderRoutingRuleRow | null;
    if (!row) return json({ error: 'Règle de routage introuvable' }, 404);
    return json({ data: row });
  } catch {
    return json({ error: 'Règle de routage introuvable' }, 404);
  }
}

/**
 * PUT /api/ecommerce/order-routing-rules/:id — modification d'une règle de routage.
 */
export async function handleUpdateOrderRoutingRule(
  request: Request, env: Env, auth: Auth, id: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  let existing: OrderRoutingRuleRow | null = null;
  try {
    existing = (await env.DB.prepare(
      `SELECT ${ROUTING_COLS} FROM order_routing_rules WHERE id = ? AND client_id = ?`,
    ).bind(id, clientId).first()) as OrderRoutingRuleRow | null;
  } catch {
    return json({ error: 'Règle de routage introuvable' }, 404);
  }
  if (!existing) return json({ error: 'Règle de routage introuvable' }, 404);

  const merged = {
    name: 'name' in body ? body.name : existing.name,
    priority: 'priority' in body ? body.priority : existing.priority,
    conditions_json: 'conditions_json' in body ? body.conditions_json : existing.conditions_json,
    action_warehouse_id: 'action_warehouse_id' in body ? body.action_warehouse_id : existing.action_warehouse_id,
    is_active: 'is_active' in body ? body.is_active : existing.is_active,
  };

  const r = normalizeRuleInput(merged);
  if (!r.name) {
    return json({ error: 'Nom requis', message: 'Le nom de la règle est obligatoire.' }, 400);
  }
  if (!r.action_warehouse_id) {
    return json({ error: 'Entrepôt cible requis', message: 'L’entrepôt de destination est obligatoire.' }, 400);
  }

  // Vérifier que l'entrepôt cible existe pour ce client
  try {
    const wh = await env.DB.prepare(
      'SELECT id FROM warehouses WHERE id = ? AND client_id = ? LIMIT 1'
    ).bind(r.action_warehouse_id, clientId).first();
    if (!wh) {
      return json({ error: 'Entrepôt introuvable', message: 'L’entrepôt sélectionné n’existe pas pour ce client.' }, 400);
    }
  } catch {
    //
  }

  try {
    await env.DB.prepare(
      `UPDATE order_routing_rules SET
         name = ?, priority = ?, conditions_json = ?, action_warehouse_id = ?, is_active = ?, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
    ).bind(
      r.name, r.priority, r.conditions_json, r.action_warehouse_id, r.is_active, id, clientId,
    ).run();

    await audit(env, auth.userId, 'update', 'order_routing_rule', id, {
      name: r.name,
      priority: r.priority,
    });

    return json({ data: { id } });
  } catch {
    return json({ error: 'Impossible de mettre à jour la règle de routage' }, 500);
  }
}

/**
 * DELETE /api/ecommerce/order-routing-rules/:id — suppression d'une règle de routage.
 */
export async function handleDeleteOrderRoutingRule(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const row = await env.DB.prepare(
      'SELECT id FROM order_routing_rules WHERE id = ? AND client_id = ?',
    ).bind(id, clientId).first();
    if (!row) return json({ error: 'Règle de routage introuvable' }, 404);

    await env.DB.prepare(
      'DELETE FROM order_routing_rules WHERE id = ? AND client_id = ?',
    ).bind(id, clientId).run();

    await audit(env, auth.userId, 'delete', 'order_routing_rule', id, {});

    return json({ data: { id } });
  } catch {
    return json({ error: 'Impossible de supprimer la règle de routage' }, 500);
  }
}
