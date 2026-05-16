// ── Modules (feature-flag par tenant) — Sprint E1 M2.1 (2026-05-16) ──────────
//
// Le module "crm" est TOUJOURS actif (non désactivable). Le module "ecommerce"
// (module B2 / Boutique) est optionnel, activé par tenant via clients.modules_json.
//
// Convention DB : clients.modules_json TEXT DEFAULT '["crm"]' (migration M2).
// Tous les clients pré-existants ⇒ '["crm"]' ⇒ comportement CRM identique,
// e-commerce OFF par défaut, zéro régression.

import type { Env } from './types';
import { json } from './helpers';

export type ModuleId = 'crm' | 'ecommerce';

/** Modules toujours présents quel que soit le tenant (socle non désactivable). */
const ALWAYS_ON: ModuleId[] = ['crm'];

/** Tous les modules connus du système (référentiel UI Settings). */
export const KNOWN_MODULES: ModuleId[] = ['crm', 'ecommerce'];

/**
 * Parse safe de la liste des modules d'un client.
 * Tolère : null/undefined, JSON invalide, valeurs inconnues, doublons.
 * Garantit toujours la présence des modules socle (ALWAYS_ON).
 */
export function parseModules(modulesJson: string | null | undefined): ModuleId[] {
  let raw: unknown = null;
  try {
    raw = modulesJson ? JSON.parse(modulesJson) : null;
  } catch {
    raw = null;
  }
  const list = Array.isArray(raw) ? raw : [];
  const valid = list.filter(
    (m): m is ModuleId => typeof m === 'string' && (KNOWN_MODULES as string[]).includes(m),
  );
  // Dédoublonne + force les modules socle
  const set = new Set<ModuleId>([...ALWAYS_ON, ...valid]);
  return Array.from(set);
}

/**
 * Vérifie si un client (objet avec `modules_json`) a un module activé.
 * `client` peut être null → seul le socle CRM est considéré actif.
 */
export function hasModule(
  client: { modules_json?: string | null } | null | undefined,
  moduleId: ModuleId,
): boolean {
  if (ALWAYS_ON.includes(moduleId)) return true;
  if (!client) return false;
  return parseModules(client.modules_json).includes(moduleId);
}

/**
 * Résout les modules du client courant à partir de l'utilisateur authentifié.
 * Lit users.client_id → clients.modules_json (pattern projet, cf. dashboard.ts).
 * Retourne ['crm'] en fallback si client introuvable (jamais d'erreur).
 */
export async function getClientModules(
  env: Env,
  userId: string,
): Promise<{ clientId: string | null; modules: ModuleId[] }> {
  const user = await env.DB.prepare('SELECT client_id FROM users WHERE id = ?')
    .bind(userId)
    .first() as { client_id: string | null } | null;
  const clientId = user?.client_id || null;
  if (!clientId) return { clientId: null, modules: [...ALWAYS_ON] };

  const client = await env.DB.prepare('SELECT modules_json FROM clients WHERE id = ?')
    .bind(clientId)
    .first() as { modules_json: string | null } | null;
  return { clientId, modules: parseModules(client?.modules_json) };
}

/**
 * Garde réutilisable pour les futures routes /api/ecommerce/*.
 * Renvoie une Response 403 (JSON, FR québécois) si le module est absent,
 * sinon `null` (= autorisé, continuer).
 *
 * Usage :
 *   const guard = await requireModule(env, auth.userId, 'ecommerce');
 *   if (guard) return guard;
 */
export async function requireModule(
  env: Env,
  userId: string,
  moduleId: ModuleId,
): Promise<Response | null> {
  if (ALWAYS_ON.includes(moduleId)) return null;
  const { modules } = await getClientModules(env, userId);
  if (modules.includes(moduleId)) return null;
  return json(
    {
      error: 'Module non activé',
      message:
        moduleId === 'ecommerce'
          ? "Le module Boutique n'est pas activé pour ton compte. Active-le dans Paramètres → Modules."
          : `Le module « ${moduleId} » n'est pas activé pour ton compte.`,
      module: moduleId,
    },
    403,
  );
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /api/modules — liste les modules du client courant + le référentiel
 * complet (pour que l'UI Settings affiche les modules disponibles + leur état).
 */
export async function handleGetModules(
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  const { clientId, modules } = await getClientModules(env, auth.userId);
  return json({
    data: {
      clientId,
      active: modules,
      available: KNOWN_MODULES,
      // crm verrouillé (socle) : l'UI désactive le toggle correspondant
      locked: ALWAYS_ON,
    },
  });
}

/**
 * PATCH /api/modules — active/désactive un module pour le client courant.
 * Admin uniquement. Body : { module: 'ecommerce', enabled: boolean }.
 * "crm" ne peut jamais être désactivé (socle).
 */
export async function handlePatchModules(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Non autorisé', message: 'Action réservée aux administrateurs.' }, 403);
  }

  let body: { module?: string; enabled?: boolean };
  try {
    body = (await request.json()) as { module?: string; enabled?: boolean };
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const moduleId = body.module as ModuleId | undefined;
  if (!moduleId || !(KNOWN_MODULES as string[]).includes(moduleId)) {
    return json({ error: 'Module inconnu', message: 'Ce module n’existe pas.' }, 400);
  }
  if (ALWAYS_ON.includes(moduleId) && body.enabled === false) {
    return json(
      { error: 'Module socle', message: 'Le module CRM ne peut pas être désactivé.' },
      400,
    );
  }

  const { clientId, modules } = await getClientModules(env, auth.userId);
  if (!clientId) {
    return json({ error: 'Client introuvable', message: 'Aucun compte tenant associé.' }, 400);
  }

  const set = new Set<ModuleId>(modules);
  if (body.enabled === false) set.delete(moduleId);
  else set.add(moduleId);
  // Ré-injecte toujours le socle
  ALWAYS_ON.forEach((m) => set.add(m));

  const next = Array.from(set);
  await env.DB.prepare(
    "UPDATE clients SET modules_json = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(JSON.stringify(next), clientId)
    .run();

  return json({ data: { clientId, active: next } });
}
