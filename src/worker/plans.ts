// ── plans.ts — LOT 3 SaaS M1 (2026-05-18) ───────────────────────────────────
//
// Plans EN DUR (zéro Stripe / paiement / webhook). Quotas appliqués au niveau
// AGENCE (`subscriptions.plan_name` WHERE agency_id). E4/E6 paiement
// (billing.ts / payments_live_enabled) INTOUCHÉ. Lot 3 = 0 migration : la table
// `subscriptions` existe déjà (migration_p3_9.sql:12-21 — colonnes réelles
// id,client_id,agency_id,plan_name SANS CHECK,status,stripe_subscription_id,
// current_period_end,created_at). Provisioning pose plan_name='free'
// status='active' au niveau agence (provisioning.ts / saas.ts §6.4).
//
// `requireQuota` est un calque EXACT de `requireModule` (modules.ts:132-151) :
//   - Signature `Promise<Response | null>`.
//   - `return null`            ⇒ autorisé, le caller continue.
//   - `return json(..., 403)`  ⇒ quota dépassé, le caller `return guard`.
//
// Invariant DUR de rétro-compatibilité (garde-fou #1, absolu) :
//   - `agencyId` falsy ⇒ `return null` IMMÉDIAT, AVANT toute requête D1. Un flux
//     legacy non-agence (mono-tenant, agency_id NULL) n'est JAMAIS bloqué et
//     n'émet AUCUNE requête (byte-identique au comportement actuel).
//   - Best-effort : toute panne D1 / colonne absente est avalée (try/catch) et
//     dégrade vers `return null` (autorisé). JAMAIS de throw / 500.
//
// Usage (calque requireModule) :
//   const guard = await requireQuota(env, auth.tenant?.agencyId, 'subAccounts');
//   if (guard) return guard;

import type { Env } from './types';
import { json } from './helpers';

export type QuotaKind = 'subAccounts' | 'leads' | 'users';

export interface PlanLimits {
  maxSubAccounts: number;
  maxLeads: number;
  maxUsers: number;
}

/** Plans EN DUR — décision verrouillée Rochdi (zéro Stripe). */
export const PLANS: Record<string, PlanLimits> = {
  free: { maxSubAccounts: 2, maxLeads: 500, maxUsers: 3 },
  pro: { maxSubAccounts: 10, maxLeads: 10000, maxUsers: 25 },
  unlimited: { maxSubAccounts: Infinity, maxLeads: Infinity, maxUsers: Infinity },
};

const DEFAULT_PLAN = 'free';

/**
 * Résout les limites d'un nom de plan. Plan inconnu / absent / null ⇒ `free`
 * (fallback sûr, jamais d'erreur). `subscriptions.plan_name` n'a PAS de CHECK
 * en base réelle (migration_p3_9) : tout doit être toléré.
 */
export function resolvePlan(planName?: string | null): PlanLimits {
  return PLANS[(planName || DEFAULT_PLAN).toLowerCase()] ?? PLANS[DEFAULT_PLAN]!;
}

/** Map kind → limite du plan résolu. */
function limitFor(kind: QuotaKind, limits: PlanLimits): number {
  switch (kind) {
    case 'subAccounts':
      return limits.maxSubAccounts;
    case 'leads':
      return limits.maxLeads;
    case 'users':
      return limits.maxUsers;
  }
}

/**
 * Garde réutilisable AVANT toute création soumise à quota (sous-comptes,
 * leads, users). Calque EXACT de `requireModule` (modules.ts:132).
 *
 * Comportement (étapes verrouillées) :
 *   1. `agencyId` falsy ⇒ `return null` IMMÉDIAT (garde-fou #1, AUCUNE requête).
 *   2. Lecture du plan actif de l'agence (try/catch ⇒ null si panne).
 *   3. Limite Infinity ⇒ `return null` SANS COUNT (plan unlimited).
 *   4. COUNT borné à l'agence (try/catch ⇒ null si panne).
 *   5. `count >= limit` ⇒ 403 QUOTA_EXCEEDED, sinon `return null`.
 *      (`>=` car la garde s'exécute AVANT l'INSERT : à limite atteinte on
 *      refuse la N+1ᵉ création.)
 *
 * Le message 403 est en FR québécois EN DUR (PAS via t() côté worker — il n'y
 * a pas de système i18n côté Worker ; cf. modules.ts:142-148 même convention).
 */
export async function requireQuota(
  env: Env,
  agencyId: string | null | undefined,
  kind: QuotaKind,
): Promise<Response | null> {
  // ── 1) Garde-fou #1 ABSOLU : pas d'agence ⇒ flux legacy non-agence, JAMAIS
  //       bloqué, AUCUNE requête D1 émise (rétro-compat dure byte-identique).
  if (!agencyId) return null;

  // ── 2) Plan actif de l'agence (best-effort : panne / colonne absente ⇒ on
  //       autorise plutôt que de casser un flux métier — jamais throw/500).
  let planName: string | null = null;
  try {
    const row = (await env.DB.prepare(
      "SELECT plan_name FROM subscriptions WHERE agency_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    )
      .bind(agencyId)
      .first()) as { plan_name: string | null } | null;
    planName = row?.plan_name ?? null;
  } catch {
    return null;
  }

  // Abonnement absent ⇒ resolvePlan retombe sur `free` (fallback sûr).
  const limits = resolvePlan(planName);
  const limit = limitFor(kind, limits);

  // ── 3) Plan unlimited (Infinity) ⇒ autorisé SANS émettre de COUNT.
  if (!Number.isFinite(limit)) return null;

  // ── 4) COUNT borné à l'agence (best-effort : panne ⇒ autorisé).
  let count = 0;
  try {
    let countSql: string;
    if (kind === 'subAccounts') {
      countSql = 'SELECT COUNT(*) AS n FROM clients WHERE agency_id = ?';
    } else if (kind === 'leads') {
      countSql =
        'SELECT COUNT(*) AS n FROM leads WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ?)';
    } else {
      // users
      countSql =
        'SELECT COUNT(*) AS n FROM user_sub_accounts WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ?)';
    }
    const r = (await env.DB.prepare(countSql).bind(agencyId).first()) as
      | { n: number | null }
      | null;
    count = Number(r?.n ?? 0);
    if (!Number.isFinite(count)) count = 0;
  } catch {
    return null;
  }

  // ── 5) Limite atteinte ⇒ 403. `>=` car garde AVANT INSERT.
  if (count >= limit) {
    const kindFr =
      kind === 'subAccounts' ? 'sous-comptes' : kind === 'leads' ? 'prospects' : 'utilisateurs';
    const planFr = (planName || DEFAULT_PLAN).toLowerCase();
    return json(
      {
        error: `Quota atteint pour le plan « ${planFr} » (${kindFr} : ${limit} max).`,
        code: 'QUOTA_EXCEEDED',
        kind,
        limit,
        current: count,
      },
      403,
    );
  }

  return null;
}
