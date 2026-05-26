// ── capabilities.ts — LOT TEAM B (2026-05-19) ──────────────────────────────
//
// Résolveur de capabilities composables au choke-point worker.ts.
// CONTRAT §6.D figé — recopié verbatim dans docs/LOT-TEAM-BC.md.
//
// Calque EXACT du contrat best-effort de resolveTenantContext
// (tenant-context.ts) :
//   - NE THROW JAMAIS, ne renvoie JAMAIS de 500. Toute panne D1 / table ou
//     colonne absente (seq 80 non jouée) est avalée et DÉGRADE vers un set
//     dérivé du rôle TECHNIQUE, BYTE-ÉQUIVALENT au comportement actuel.
//   - Le caller (worker.ts) enrichit simplement `authCtx.capabilities` ;
//     un échec laisse l'auth fonctionnellement identique au legacy.
//
// ⚠ RÉTRO-COMPAT DURE : le code legacy n'a quasi AUCUNE garde write
//   (handlers `auth.role !== 'admin'` au plus). Donc en legacy/mono-tenant
//   (tenant absent OU agencyId == null), on NE BRIDE RIEN au-delà de
//   l'existant : on accorde un set LARGE dérivé du rôle technique, calibré
//   pour ne PAS régresser les suites lot1..4 / tenant-context / teamA-* /
//   ecommerce-multitenant. L'enforcement réel (viewer bridé) n'est ACTIF
//   qu'en mode tenant agence (agencyId != null) — par construction
//   inexistant avant le LOT 1 SaaS.

import type { Env } from './types';
import { json } from './helpers';
import type { TenantContext } from './tenant-context';

// Auth enrichi tel que produit au choke-point worker.ts (authCtx).
export interface CapAuth {
  userId: string;
  role: string;
  clientId?: string;
  tenant?: TenantContext;
}

// Liste FIGÉE des 12 capabilities (docs/LOT-TEAM-BC.md §6.C). 'domaine.action'.
export const ALL_CAPABILITIES = [
  'leads.read',
  'leads.write',
  'leads.delete',
  'export',
  'team.manage',
  'billing.view',
  'clients.manage',
  'reports.view',
  'workflows.manage',
  'invoices.write',
  'settings.manage',
  'ai.use',
] as const;

export type Capability = (typeof ALL_CAPABILITIES)[number];

// Mapping VERROUILLÉ technique → générique (inverse du mapping LOT A
// genericToLegacyRole). store_manager est ambigu (member OU viewer côté
// générique) : on retient 'member' (le plus permissif des deux) pour le
// fallback — le vrai viewer est porté par users.role_generic en base.
function legacyRoleToGeneric(role: string): string {
  switch (role) {
    case 'admin':
      return 'owner';
    case 'broker':
      return 'manager';
    case 'store_manager':
    default:
      return 'member';
  }
}

// Set LARGE dérivé du rôle TECHNIQUE — utilisé en legacy/mono-tenant ET en
// dégradation (table seq 80 absente / panne D1). NE RÉGRESSE RIEN :
//   - admin  → TOUTES (équivaut au `auth.role==='admin'` historique).
//   - broker / store_manager → set opérationnel LARGE : tout ce qu'ils
//     peuvent déjà faire aujourd'hui (aucune garde capability ne bloquait).
//     On exclut seulement les capabilities purement « owner » (settings/
//     invoices) pour broker/store_manager — sans impact legacy car aucun
//     handler legacy n'enforce ces capabilities (gardes legacy = role admin).
function legacyCapsFromRole(role: string): Set<string> {
  if (role === 'admin') return new Set<string>(ALL_CAPABILITIES);
  // broker / store_manager / tout autre rôle technique non-admin :
  // set opérationnel large (ne bride RIEN de l'existant).
  return new Set<string>([
    'leads.read',
    'leads.write',
    'leads.delete',
    'export',
    'team.manage',
    'billing.view',
    'clients.manage',
    'reports.view',
    'workflows.manage',
    'ai.use',
  ]);
}

/**
 * Résout l'ensemble des capabilities d'un utilisateur authentifié.
 *
 * Contrat (calque resolveTenantContext) : best-effort, JAMAIS de throw.
 *
 *  - Legacy/mono-tenant (`!auth.tenant || auth.tenant.agencyId == null`)
 *    OU toute erreur (table seq 80 absente, panne D1) → set LARGE dérivé du
 *    rôle technique (legacyCapsFromRole) = comportement actuel byte-équivalent.
 *  - Tenant agence (`agencyId != null`) → set issu de `role_capabilities`
 *    (clé = role_generic, résolu via users.role_generic, fallback mapping
 *    inverse depuis users.role) PUIS application des
 *    `user_capability_overrides` (granted=1 ajoute, granted=0 retire).
 *    owner/admin → TOUTES.
 *
 * Coût ≤ 3 requêtes (1 users.role_generic + 1 role_capabilities + 1 overrides).
 */
export async function resolveCapabilities(
  env: Env,
  auth: CapAuth,
): Promise<Set<string>> {
  const role = auth.role;

  // ── Legacy/mono-tenant : set large dérivé du rôle technique. AUCUNE
  //    requête, AUCUNE garde nouvelle → byte-équivalent à l'existant.
  if (!auth.tenant || auth.tenant.agencyId == null) {
    return legacyCapsFromRole(role);
  }

  // ── Tenant agence : enforcement réel via role_capabilities + overrides.
  try {
    // 1) rôle générique : users.role_generic prioritaire, sinon mapping
    //    inverse depuis le rôle technique.
    let generic: string | null = null;
    try {
      const u = (await env.DB.prepare(
        'SELECT role_generic FROM users WHERE id = ?',
      )
        .bind(auth.userId)
        .first()) as { role_generic: string | null } | null;
      generic = u?.role_generic || null;
    } catch {
      generic = null;
    }
    if (!generic) generic = legacyRoleToGeneric(role);

    // owner / admin court-circuitent : toutes les capabilities.
    if (generic === 'owner' || role === 'admin') {
      return new Set<string>(ALL_CAPABILITIES);
    }

    // 2) capabilities du rôle générique (seed seq 80).
    const caps = new Set<string>();
    try {
      const { results } = await env.DB.prepare(
        'SELECT capability FROM role_capabilities WHERE role_generic = ?',
      )
        .bind(generic)
        .all();
      for (const r of results || []) {
        const c = (r as { capability: string | null }).capability;
        if (typeof c === 'string' && c.length > 0) caps.add(c);
      }
    } catch {
      // Table seq 80 absente : DÉGRADE legacy (ne bride rien de l'existant).
      return legacyCapsFromRole(role);
    }

    // Si le rôle générique n'a aucune ligne (seed non joué) → dégrade legacy
    // plutôt que de bloquer (rétro-compat : pas de régression d'accès).
    if (caps.size === 0) return legacyCapsFromRole(role);

    // 3) overrides par user (granted=1 ajoute, granted=0 retire).
    try {
      const { results } = await env.DB.prepare(
        'SELECT capability, granted FROM user_capability_overrides WHERE user_id = ?',
      )
        .bind(auth.userId)
        .all();
      for (const r of results || []) {
        const row = r as { capability: string | null; granted: number | null };
        if (typeof row.capability !== 'string' || !row.capability) continue;
        if (row.granted === 0) caps.delete(row.capability);
        else caps.add(row.capability);
      }
    } catch {
      // Table overrides absente : on garde les caps du rôle (best-effort).
    }

    return caps;
  } catch {
    // Filet ultime : aucune régression — set large dérivé du rôle technique.
    return legacyCapsFromRole(role);
  }
}

/**
 * Garde d'enforcement. Retourne une Response 403 si la capability manque,
 * sinon `undefined` (pattern assertTargetInTenant de team.ts).
 *
 * Réponse normalisée `{ error }` (PAS de champ `code` requis côté front —
 * apiFetch GELÉ, discrimination string-match, docs/LOT-TEAM-BC.md §6.A).
 */
export function requireCapability(
  caps: Set<string> | undefined,
  cap: Capability,
): Response | undefined {
  if (caps && caps.has(cap)) return undefined;
  return json({ error: 'Accès refusé' }, 403);
}

// ── GET /api/team/capabilities/me ───────────────────────────────────────────
// Capabilities effectives de l'utilisateur courant (rôle générique + overrides
// déjà résolus au choke-point dans auth.capabilities). Implémentation RÉELLE
// Phase A (fichier owned Phase A) — réponse normalisée { data: string[] }.
export async function handleGetMyCapabilities(
  _request: Request,
  env: Env,
  auth: CapAuth & { capabilities?: Set<string> },
): Promise<Response> {
  // auth.capabilities est injecté au choke-point ; fallback résolution directe
  // si appelé hors choke-point (best-effort, jamais de throw).
  const caps =
    auth.capabilities instanceof Set
      ? auth.capabilities
      : await resolveCapabilities(env, auth);
  return json({ data: [...caps].sort() });
}
