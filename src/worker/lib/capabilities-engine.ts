// ── capabilities-engine.ts — Helpers PURS RBAC (RENFORCEMENT P0) ───────────
//
// Contrat ADDITIF — 100% : aucune modification du résolveur best-effort
// capabilities.ts. Ces helpers PURS opèrent sur Set<string> déjà résolus.
// Ne réimporte PAS ALL_CAPABILITIES depuis capabilities.ts pour éviter
// cycles + permettre tests headless du module isolé.
//
// 12 capabilities FIGÉES seq80 — STRICTEMENT identiques à capabilities.ts
// (ALL_CAPABILITIES). Source de vérité partagée via re-export type-safe.

// ════════════════════════════════════════════════════════════════════════════
// CAPABILITY_LIST — frozen 12 caps seq80
// ════════════════════════════════════════════════════════════════════════════

export const CAPABILITY_LIST = Object.freeze([
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
] as const);

export type CapabilityName = (typeof CAPABILITY_LIST)[number];

/** Set immuable des capabilities autorisées (lookup O(1)). */
export const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITY_LIST);

export function isCapability(s: unknown): s is CapabilityName {
  return typeof s === 'string' && CAPABILITY_SET.has(s);
}

// ════════════════════════════════════════════════════════════════════════════
// Roles génériques — calque seq80 (owner/admin/manager/member/viewer)
// ════════════════════════════════════════════════════════════════════════════

export const GENERIC_ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const;
export type GenericRole = (typeof GENERIC_ROLES)[number];

/**
 * ROLE_CAPABILITIES — mapping role_generic → set de capabilities.
 * Calque par défaut compatible seed seq80 :
 *   - owner  → toutes (12/12)
 *   - admin  → toutes sauf settings.manage (priv = owner only)
 *   - manager → opérationnel (leads + export + team + reports + workflows + ai)
 *   - member → leads.read/write + reports.view + ai.use
 *   - viewer → reports.view uniquement
 */
export const ROLE_CAPABILITIES: Readonly<Record<GenericRole, ReadonlySet<CapabilityName>>> = Object.freeze({
  owner: new Set<CapabilityName>(CAPABILITY_LIST),
  admin: new Set<CapabilityName>([
    'leads.read', 'leads.write', 'leads.delete',
    'export', 'team.manage', 'billing.view',
    'clients.manage', 'reports.view',
    'workflows.manage', 'invoices.write', 'ai.use',
  ]),
  manager: new Set<CapabilityName>([
    'leads.read', 'leads.write', 'leads.delete',
    'export', 'team.manage',
    'reports.view', 'workflows.manage', 'ai.use',
  ]),
  member: new Set<CapabilityName>([
    'leads.read', 'leads.write',
    'reports.view', 'ai.use',
  ]),
  viewer: new Set<CapabilityName>([
    'reports.view',
  ]),
});

export function isGenericRole(s: unknown): s is GenericRole {
  return typeof s === 'string' && (GENERIC_ROLES as readonly string[]).includes(s);
}

/** Capabilities par défaut pour un role_generic donné. Set vide si rôle inconnu. */
export function capabilitiesForRole(role: string | null | undefined): Set<string> {
  if (!role || !isGenericRole(role)) return new Set();
  return new Set(ROLE_CAPABILITIES[role]);
}

// ════════════════════════════════════════════════════════════════════════════
// hasCapability — lookup pur sur Set<string>
// ════════════════════════════════════════════════════════════════════════════

/**
 * Retourne true ssi `userCaps` contient `required`.
 * Accepte :
 *   - Set<string> | string[] | undefined/null pour userCaps
 *   - string unique OR string[] pour required (AND-logic sur array)
 */
export function hasCapability(
  userCaps: Set<string> | readonly string[] | null | undefined,
  required: string | readonly string[],
): boolean {
  if (!userCaps) return false;
  const caps = userCaps instanceof Set ? userCaps : new Set(userCaps);
  if (typeof required === 'string') return caps.has(required);
  if (!Array.isArray(required) || required.length === 0) return false;
  for (const cap of required) {
    if (!caps.has(cap)) return false;
  }
  return true;
}

/** OR-logic : true si AU MOINS UNE capability matche. */
export function hasAnyCapability(
  userCaps: Set<string> | readonly string[] | null | undefined,
  required: readonly string[],
): boolean {
  if (!userCaps || !Array.isArray(required) || required.length === 0) return false;
  const caps = userCaps instanceof Set ? userCaps : new Set(userCaps);
  for (const cap of required) {
    if (caps.has(cap)) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// canAccessTenant — guard cross-tenant
// ════════════════════════════════════════════════════════════════════════════

/**
 * Autorise l'accès si :
 *   - userTenant manquant (legacy/mono-tenant) → toujours OK (rétro-compat)
 *   - targetClient manquant → OK (ressource non-tenant)
 *   - userTenant.clientId === targetClient
 *   - OR userTenant.role === 'owner' ET userTenant.agencyId est défini
 *     (owner d'une agence accède aux clients de SON agence — caller doit
 *     vérifier l'appartenance du target à l'agence via DB)
 */
export interface TenantLike {
  agencyId?: string | null;
  clientId?: string | null;
  role?: string;
}

export function canAccessTenant(
  userTenant: TenantLike | null | undefined,
  targetClient: string | null | undefined,
): boolean {
  if (!userTenant) return true; // legacy/mono-tenant
  if (!targetClient) return true; // ressource non scopée client
  if (userTenant.clientId === targetClient) return true;
  // owner d'une agence : permis tant que clientId target appartient à l'agence.
  // Cette vérification d'appartenance reste au caller (DB lookup) — ici on
  // signale juste que l'owner a le DROIT théorique.
  if (userTenant.role === 'owner' && userTenant.agencyId) return true;
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// assertCapability — strict throw (utiliser dans helpers internes)
// ════════════════════════════════════════════════════════════════════════════

export class CapabilityError extends Error {
  readonly code = 'CAPABILITY_DENIED';
  readonly missing: string | readonly string[];
  constructor(missing: string | readonly string[]) {
    super(`Capability manquante : ${Array.isArray(missing) ? missing.join(', ') : missing}`);
    this.name = 'CapabilityError';
    this.missing = missing;
  }
}

/**
 * Variante strict-throw de hasCapability — pour helpers internes qui ne
 * retournent pas une Response. Les handlers HTTP doivent continuer d'utiliser
 * `requireCapability` de capabilities.ts (qui retourne Response 403).
 */
export function assertCapability(
  auth: { capabilities?: Set<string> | readonly string[] } | null | undefined,
  cap: string | readonly string[],
): void {
  const caps = auth?.capabilities;
  if (!hasCapability(caps, cap)) {
    throw new CapabilityError(cap);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers utilitaires
// ════════════════════════════════════════════════════════════════════════════

/** Set intersection : caps user ∩ caps requises (utile pour audit/log). */
export function intersectCapabilities(
  userCaps: Set<string> | readonly string[] | null | undefined,
  requested: readonly string[],
): string[] {
  if (!userCaps) return [];
  const caps = userCaps instanceof Set ? userCaps : new Set(userCaps);
  return requested.filter(c => caps.has(c));
}

/**
 * Filtre un array de strings pour ne garder que les capabilities valides
 * (élimine typos / capabilities non-seq80). Utile au load des overrides DB.
 */
export function filterValidCapabilities(input: readonly string[] | null | undefined): CapabilityName[] {
  if (!input) return [];
  return input.filter(isCapability);
}

/**
 * Applique des overrides (granted=1 ajoute, granted=0 retire) sur un set base.
 * Retourne un nouveau Set (immutabilité). Override sur capability invalide ignoré.
 */
export interface CapOverride {
  capability: string;
  granted: 0 | 1;
}

export function applyCapabilityOverrides(
  base: Set<string> | readonly string[],
  overrides: readonly CapOverride[],
): Set<string> {
  const out = new Set<string>(base instanceof Set ? base : new Set(base));
  for (const ov of overrides) {
    if (!isCapability(ov.capability)) continue;
    if (ov.granted === 1) out.add(ov.capability);
    else if (ov.granted === 0) out.delete(ov.capability);
  }
  return out;
}
