import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';
import { resolveTenantContext, type TenantContext } from './tenant-context';
import { requireQuota, resolvePlan } from './plans';

export async function handleGetAgencies(
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Non autorisé' }, 403);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM agencies ORDER BY created_at DESC'
  ).all();

  return json({ data: results || [] });
}

export async function handleCreateAgency(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Non autorisé' }, 403);
  }

  const body = await request.json() as { name: string; custom_domain?: string };
  const name = sanitizeInput(body.name, 100);
  const customDomain = sanitizeInput(body.custom_domain || '', 100);

  if (!name) {
    return json({ error: 'Nom requis' }, 400);
  }

  const agencyId = `ag_${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT INTO agencies (id, name, owner_id, custom_domain) VALUES (?, ?, ?, ?)`
  ).bind(agencyId, name, auth.userId, customDomain || null).run();

  return json({ data: { id: agencyId } }, 201);
}

// ── LOT 2 SaaS M1 (2026-05-18) — switch sous-compte + vue agence ─────────────
// CONTRAT §6.8 / §6.9 / §6.10 (figé dans docs/LOT1-SAAS.md « ## §6 LOT 2 »).
//
// Invariants durs :
//   - §6.8 STATELESS : aucune écriture admin_sessions. L'appartenance est
//     DÉLÉGUÉE à resolveTenantContext (Lot 1) — jamais réimplémentée ici.
//     403 STRICT si le résolveur n'a pas honoré le switch (pas de fallback).
//     Pas de double-audit : la trace Loi 25 est émise par le résolveur Lot 1.
//   - §6.9/§6.10 vue agence : toute requête métier est BORNÉE par
//     `client_id IN (<ids de CETTE agence>)`. JAMAIS un SELECT leads/tasks
//     sans clause client_id (anti-bypass d'isolation).

/**
 * §6.8 — POST /api/account/switch
 * Garde : requireAuth (tout user authentifié). Body `{ subAccountId }`.
 * Délègue l'appartenance à resolveTenantContext ; 403 STRICT si écart.
 */
export async function handleAccountSwitch(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string; tenant?: TenantContext }
): Promise<Response> {
  let body: { subAccountId?: unknown };
  try {
    body = (await request.json()) as { subAccountId?: unknown };
  } catch {
    body = {};
  }

  const subAccountId =
    typeof body.subAccountId === 'string' ? body.subAccountId.trim() : '';
  if (!subAccountId) {
    return json({ error: 'subAccountId requis', code: 'INVALID_INPUT' }, 400);
  }

  // Appartenance DÉLÉGUÉE au résolveur Lot 1 (pas de réimplémentation) :
  // le switch n'est honoré que si subAccountId ∈ accessibleClientIds.
  // Le résolveur émet déjà la trace Loi 25 'agency.subaccount.access'
  // (best-effort) — NE PAS double-auditer ici.
  const ctx = await resolveTenantContext(
    env,
    auth.userId,
    auth.role,
    subAccountId
  );

  if (ctx.clientId !== subAccountId) {
    // Le résolveur a IGNORÉ le switch (sous-compte non accessible) ⇒ 403 STRICT.
    return json(
      { error: 'Sous-compte non autorisé', code: 'SUBACCOUNT_FORBIDDEN' },
      403
    );
  }

  // STATELESS : aucune écriture session. Le front persistera localStorage
  // puis renverra X-Sub-Account sur les requêtes suivantes (§6.11, M2).
  return json({
    data: {
      activeSubAccount: subAccountId,
      agencyId: ctx.agencyId,
      accessibleClientIds: ctx.accessibleClientIds,
    },
  });
}

/**
 * §6.9 — GET /api/agency/sub-accounts
 * Garde : auth.tenant.accountLevel === 'agency' && auth.tenant.agencyId != null.
 * Liste les sous-comptes de l'agence + métriques RÉELLES bornées client_id.
 */
export async function handleGetAgencySubAccounts(
  env: Env,
  auth: { userId: string; role: string; clientId?: string; tenant?: TenantContext }
): Promise<Response> {
  const tenant = auth.tenant;
  if (!tenant || tenant.accountLevel !== 'agency' || !tenant.agencyId) {
    return json({ error: 'Réservé aux agences', code: 'AGENCY_ONLY' }, 403);
  }
  const agencyId = tenant.agencyId;

  // Sous-comptes de CETTE agence uniquement (filtre agency_id strict).
  const { results } = await env.DB.prepare(
    'SELECT id, name, email, created_at FROM clients WHERE agency_id = ? ORDER BY created_at DESC'
  )
    .bind(agencyId)
    .all();

  const subs = (results || []) as Array<{
    id: string;
    name: string;
    email: string | null;
    created_at: string;
  }>;

  // Anti-bypass : métriques RÉELLES bornées aux ids de l'agence. JAMAIS un
  // SELECT leads/tasks sans clause client_id. Si aucun sous-compte ⇒ on
  // n'émet AUCUNE requête métier (placeholders vides interdits dans IN()).
  const ids = subs.map((s) => s.id);
  const leadsByClient = new Map<string, number>();
  const tasksByClient = new Map<string, number>();

  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');

    const { results: leadRows } = await env.DB.prepare(
      `SELECT client_id, COUNT(*) AS c FROM leads WHERE client_id IN (${placeholders}) GROUP BY client_id`
    )
      .bind(...ids)
      .all();
    for (const r of (leadRows || []) as Array<{ client_id: string; c: number }>) {
      leadsByClient.set(r.client_id, Number(r.c) || 0);
    }

    const { results: taskRows } = await env.DB.prepare(
      `SELECT client_id, COUNT(*) AS c FROM tasks WHERE client_id IN (${placeholders}) GROUP BY client_id`
    )
      .bind(...ids)
      .all();
    for (const r of (taskRows || []) as Array<{ client_id: string; c: number }>) {
      tasksByClient.set(r.client_id, Number(r.c) || 0);
    }
  }

  return json({
    data: subs.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      created_at: s.created_at,
      leadsCount: leadsByClient.get(s.id) ?? 0,
      tasksCount: tasksByClient.get(s.id) ?? 0,
    })),
  });
}

/**
 * §6.10 — POST /api/agency/sub-accounts
 * Garde : idem §6.9. Crée un sous-compte (clients) + jonction
 * (user_sub_accounts) atomiquement, puis audit Loi 25.
 */
export async function handleCreateAgencySubAccount(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string; tenant?: TenantContext }
): Promise<Response> {
  const tenant = auth.tenant;
  if (!tenant || tenant.accountLevel !== 'agency' || !tenant.agencyId) {
    return json({ error: 'Réservé aux agences', code: 'AGENCY_ONLY' }, 403);
  }
  const agencyId = tenant.agencyId;

  let body: { name?: unknown; email?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; email?: unknown };
  } catch {
    body = {};
  }

  const name = sanitizeInput(typeof body.name === 'string' ? body.name : '', 100);
  const email = sanitizeInput(typeof body.email === 'string' ? body.email : '', 200);
  if (!name) {
    return json({ error: 'Nom requis', code: 'INVALID_INPUT' }, 400);
  }

  // LOT3-QUOTA-GUARD : enforcement quota sous-comptes (§6.16(a)). La garde
  // §6.10 ci-dessus garantit `agency` + `agencyId` non null ⇒ requireQuota
  // évalue toujours le quota pour une agence (garde-fou #1 jamais déclenché
  // ici). Inséré APRÈS la validation `name` (:206-208), AVANT le randomUUID.
  const q = await requireQuota(env, auth.tenant?.agencyId, 'subAccounts');
  if (q) return q;

  const newClientId = crypto.randomUUID();
  const junctionId = crypto.randomUUID();

  // Atomique : création du sous-compte + jonction user→client en un batch.
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO clients (id, name, email, agency_id) VALUES (?, ?, ?, ?)'
    ).bind(newClientId, name, email || null, agencyId),
    env.DB.prepare(
      'INSERT INTO user_sub_accounts (id, user_id, client_id) VALUES (?, ?, ?)'
    ).bind(junctionId, auth.userId, newClientId),
  ]);

  await audit(env, auth.userId, 'agency.subaccount.create', 'client', newClientId, {
    agencyId,
  });

  return json({ data: { id: newClientId } }, 201);
}

// ── LOT 3 SaaS M2 (2026-05-18) — vue plan / quota agence ────────────────────
// CONTRAT §6.15 (figé docs/LOT1-SAAS.md « ## §6 LOT 3 »).
//
// Invariants durs :
//   - Garde IDENTIQUE §6.9/§6.10 (`agency` + `agencyId` non null sinon 403
//     AGENCY_ONLY) — réutilise le même pattern, jamais réimplémenté autrement.
//   - Lecture SEULE (aucun write, aucun audit). Plan lu via le MÊME SELECT que
//     §6.14 étape 2 ; 3 COUNT bornés agence = MÊMES SQL que §6.14 étape 4.
//   - Best-effort : toute panne D1 ⇒ usage à 0 (jamais 500). `Infinity` n'est
//     PAS JSON-valide ⇒ mappé vers `null` (l'UI M3 interprète null = illimité).

/**
 * §6.15 — GET /api/agency/plan
 * Garde : auth.tenant.accountLevel === 'agency' && auth.tenant.agencyId != null.
 * Retourne { data: { plan, limits, usage } }. Lecture seule, best-effort.
 */
export async function handleGetAgencyPlan(
  env: Env,
  auth: { userId: string; role: string; clientId?: string; tenant?: TenantContext }
): Promise<Response> {
  const tenant = auth.tenant;
  if (!tenant || tenant.accountLevel !== 'agency' || !tenant.agencyId) {
    return json({ error: 'Réservé aux agences', code: 'AGENCY_ONLY' }, 403);
  }
  const agencyId = tenant.agencyId;

  // Plan actif de l'agence — MÊME SELECT que §6.14 étape 2 (best-effort).
  let planName: string | null = null;
  try {
    const row = (await env.DB.prepare(
      "SELECT plan_name FROM subscriptions WHERE agency_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
    )
      .bind(agencyId)
      .first()) as { plan_name: string | null } | null;
    planName = row?.plan_name ?? null;
  } catch {
    planName = null;
  }

  const limits = resolvePlan(planName); // abonnement absent ⇒ `free`

  // 3 COUNT bornés agence — MÊMES SQL que §6.14 étape 4 (best-effort : panne
  // ⇒ usage 0 plutôt que 500).
  async function countAgency(sql: string): Promise<number> {
    try {
      const r = (await env.DB.prepare(sql).bind(agencyId).first()) as
        | { n: number | null }
        | null;
      const n = Number(r?.n ?? 0);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  const subAccounts = await countAgency(
    'SELECT COUNT(*) AS n FROM clients WHERE agency_id = ?'
  );
  const leads = await countAgency(
    'SELECT COUNT(*) AS n FROM leads WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ?)'
  );
  const users = await countAgency(
    'SELECT COUNT(*) AS n FROM user_sub_accounts WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ?)'
  );

  // Sérialisation : `Infinity` n'est PAS JSON-valide ⇒ `null` (UI M3 = illimité).
  const jsonLimit = (v: number): number | null => (Number.isFinite(v) ? v : null);

  return json({
    data: {
      plan: planName || 'free',
      limits: {
        maxSubAccounts: jsonLimit(limits.maxSubAccounts),
        maxLeads: jsonLimit(limits.maxLeads),
        maxUsers: jsonLimit(limits.maxUsers),
      },
      usage: { subAccounts, leads, users },
    },
  });
}
