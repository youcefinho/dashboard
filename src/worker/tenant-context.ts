// ── tenant-context.ts — LOT 1 SaaS M1 (2026-05-18) ──────────────────────────
//
// Résolveur de contexte tenant au choke-point (worker.ts entre :569 et :572).
// CONTRAT §6.1 (figé, recopié verbatim dans docs/LOT1-SAAS.md).
//
// Invariant DUR de rétro-compatibilité :
//   - Un user mono-tenant legacy (clients.agency_id IS NULL, aucune ligne
//     user_sub_accounts) ⇒ clientId = users.client_id, agencyId = null,
//     accessibleClientIds = [client_id] (ou []), comportement byte-identique
//     à l'ancien `getClientModules` (modules.ts:68 : client_id null ⇒ tout
//     null/[]).
//   - Ce résolveur NE THROW JAMAIS et ne renvoie JAMAIS de 500 : toute panne
//     D1 / colonne absente est avalée et dégrade vers le legacy strict.
//
// ⚠ NE PAS appeler depuis un point qui suppose un throw : le contrat est
//   « best-effort, dégradation silencieuse ». Le caller (worker.ts) enrichit
//   simplement l'objet `auth` ; un échec laisse `auth` legacy intact.

import type { Env } from './types';
import { audit } from './helpers';

export interface TenantContext {
  userId: string;
  role: string;
  clientId: string | null;
  agencyId: string | null;
  accountLevel: string;
  accessibleClientIds: string[];
}

/**
 * Résout le contexte tenant d'un utilisateur authentifié.
 *
 * @param requestedSubAccountId  sous-compte (client_id) demandé par le client
 *   pour un switch ; IGNORÉ s'il n'est pas dans `accessibleClientIds`
 *   (fallback silencieux sur users.client_id — JAMAIS de throw/500).
 *
 * @param hostHeader  (LOT G9 white-label, ADDITIF Phase A — NON exploité ici)
 *   en-tête `host` de la requête. FALLBACK DERNIER RECOURS de résolution
 *   tenant : Phase B Manager-B ne l'utilisera QUE si `clientId === null` à la
 *   toute fin (lookup custom_hostnames). Pour TOUT user existant clientId est
 *   résolu par identité ⇒ le hostname n'est JAMAIS atteint ⇒ routing
 *   byte-identique. Phase A : param accepté mais ignoré (zéro changement de
 *   comportement).
 *
 * Coût ≤ 3 requêtes :
 *   1. SELECT users (client_id, account_level, agency_id) — 1 req
 *   2. SELECT user_sub_accounts (jonction) — 1 req
 *   3. SELECT clients.agency_id — conditionnel (1 req) seulement si un
 *      clientId est résolu et agencyId pas déjà connu.
 */
export async function resolveTenantContext(
  env: Env,
  userId: string,
  role: string,
  requestedSubAccountId?: string,
  hostHeader?: string,
): Promise<TenantContext> {
  // Valeurs legacy strictes par défaut (= comportement mono-tenant actuel).
  let clientId: string | null = null;
  let agencyId: string | null = null;
  let accountLevel = 'user';
  let accessibleClientIds: string[] = [];

  // ── 1) users : client_id (toujours) + account_level/agency_id (best-effort,
  //       colonnes potentiellement absentes si migration 78 pas encore jouée).
  try {
    const u = (await env.DB.prepare(
      'SELECT client_id, account_level, agency_id FROM users WHERE id = ?',
    )
      .bind(userId)
      .first()) as
      | { client_id: string | null; account_level: string | null; agency_id: string | null }
      | null;
    if (u) {
      clientId = u.client_id || null;
      // account_level absent (NULL / colonne pré-migration) ⇒ 'user'.
      accountLevel = u.account_level || 'user';
      agencyId = u.agency_id || null;
    }
  } catch {
    // Colonnes account_level/agency_id absentes (pré-migration 78) : on
    // retombe sur un SELECT minimal client_id uniquement (legacy strict).
    try {
      const u2 = (await env.DB.prepare('SELECT client_id FROM users WHERE id = ?')
        .bind(userId)
        .first()) as { client_id: string | null } | null;
      clientId = u2?.client_id || null;
    } catch {
      clientId = null;
    }
  }

  // ── 2) user_sub_accounts : sous-comptes accessibles (best-effort ; table
  //       absente pré-migration 78 ⇒ jonction vide).
  try {
    const { results } = await env.DB.prepare(
      'SELECT client_id FROM user_sub_accounts WHERE user_id = ?',
    )
      .bind(userId)
      .all();
    accessibleClientIds = (results || [])
      .map((r) => (r as { client_id: string | null }).client_id)
      .filter((c): c is string => typeof c === 'string' && c.length > 0);
  } catch {
    accessibleClientIds = [];
  }

  // Le client_id legacy de l'utilisateur est toujours accessible (même si la
  // jonction n'a pas encore été back-fillée).
  if (clientId && !accessibleClientIds.includes(clientId)) {
    accessibleClientIds = [...accessibleClientIds, clientId];
  }

  // ── Switch de sous-compte : honoré UNIQUEMENT si demandé ET accessible.
  //     Sinon : IGNORE, fallback users.client_id (jamais de throw).
  let switched = false;
  if (requestedSubAccountId && accessibleClientIds.includes(requestedSubAccountId)) {
    if (requestedSubAccountId !== clientId) switched = true;
    clientId = requestedSubAccountId;
  }

  // ── LOT G9 white-label : FALLBACK DERNIER RECOURS de résolution tenant par
  //     hostname. Atteint UNIQUEMENT si AUCUN clientId n'a été résolu par
  //     identité (clientId === null) ET un hostHeader est présent. Pour TOUT
  //     user dont l'identité résout un client_id, ce bloc N'EST JAMAIS atteint
  //     ⇒ routing BYTE-IDENTIQUE. Best-effort : table custom_hostnames absente
  //     (migration 94 non jouée) ⇒ silencieux, on retombe sur le legacy strict.
  //     JAMAIS de throw (contrat dur du résolveur).
  if (clientId === null && hostHeader) {
    const host = hostHeader.trim().toLowerCase().split(':')[0] || '';
    if (host) {
      try {
        const ch = (await env.DB.prepare(
          "SELECT client_id FROM custom_hostnames WHERE hostname = ? AND status = 'active' LIMIT 1",
        )
          .bind(host)
          .first()) as { client_id: string | null } | null;
        const resolved = ch?.client_id || null;
        if (resolved) {
          clientId = resolved;
          if (!accessibleClientIds.includes(resolved)) {
            accessibleClientIds = [...accessibleClientIds, resolved];
          }
        }
      } catch {
        // Table absente / panne D1 : dégradation silencieuse vers legacy strict.
      }
    }
  }

  // ── Legacy strict : aucun client + aucune jonction ⇒ tout null/[]
  //     (identique getClientModules:68).
  if (!clientId && accessibleClientIds.length === 0) {
    return { userId, role, clientId: null, agencyId: null, accountLevel, accessibleClientIds: [] };
  }

  // ── 3) clients.agency_id du tenant courant (conditionnel : seulement si on
  //       a un clientId et qu'on n'a pas déjà l'agency_id du user, ou si on a
  //       switché de tenant — l'agence peut différer).
  if (clientId && (agencyId === null || switched)) {
    try {
      const c = (await env.DB.prepare('SELECT agency_id FROM clients WHERE id = ?')
        .bind(clientId)
        .first()) as { agency_id: string | null } | null;
      if (c && c.agency_id) agencyId = c.agency_id;
    } catch {
      // Colonne clients.agency_id absente (pré-migration 78) : reste legacy.
    }
  }

  // ── Audit Loi 25 : accès à un sous-compte via switch effectif.
  //     UNIQUEMENT si requestedSubAccountId fourni + résolu (accessible) +
  //     agence non-nulle. Best-effort (audit() est déjà best-effort interne).
  if (requestedSubAccountId && clientId === requestedSubAccountId && agencyId !== null) {
    try {
      await audit(env, userId, 'agency.subaccount.access', 'client', clientId, {
        agencyId,
        viaSwitch: false,
      });
    } catch {
      /* best-effort, ne jamais casser le choke-point */
    }
  }

  return { userId, role, clientId, agencyId, accountLevel, accessibleClientIds };
}
