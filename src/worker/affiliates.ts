// ── affiliates.ts — LOT G2 Programme d'affiliation natif (Sprint G2) ─────────
//
// Handlers backend du module affiliation : affiliés dédiés + programme (1 par
// tenant) + tracking clics (route publique /r/:code) + jonction lead↔affilié +
// commissions calculées SERVEUR à la CONVERSION (lead→won). Payout MANUEL v1
// (admin approved→paid + export CSV). ZÉRO Stripe, E4 payments_live_enabled=0
// JAMAIS touché (FLAG sécurité).
//
// ⚠ CORPS RÉELS PHASE B (Manager-B backend exclusif) — signatures FIGÉES Phase A
//   (Manager-A SOLO). Les signatures (ordre/typage des params, forme de la
//   Response) NE CHANGENT PAS : worker.ts (gelé Phase A) câble déjà ces
//   handlers, api.ts (gelé Phase A) appelle déjà ces routes. leads.ts (gelé
//   Phase A) appelle déjà attributeReferral / onLeadWon (hooks best-effort).
//   Contrat §6 verbatim dans docs/LOT-AFFILIATE-G2.md.
//
// Conventions imposées (docs/LOT-AFFILIATE-G2.md §6.C/§6.D/§6.I) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.D).
//   - Garde capability : affiliateCapGuard(auth) = mode-agence-only (calque
//     funnels.ts:capGuard / tickets.ts:helpdeskCapGuard / LOT B-bis). Réutilise
//     'workflows.manage' (déjà dans ALL_CAPABILITIES — AUCUN ajout). Legacy/
//     mono-tenant ⇒ set LARGE ⇒ zéro régression ; bridage viewer ACTIF seulement
//     en mode agence.
//   - Bornage tenant : loadAffiliateInTenant (calque tickets.ts:loadTicketInTenant
//     / funnels.ts:loadFunnelInTenant — legacy → row ; mode agence → client_id ∈
//     accessibleClientIds OU agency_id == tenant.agencyId, sinon 404).
//   - Attribution : `?aff=CODE` (PAS `?ref=` — 'ref' déjà avalé par
//     ATTRIBUTION_ALIASES.referrer, lead-mapping.ts:47). Liaison via table de
//     jonction affiliate_referrals (PAS de colonne leads.affiliate_id).
//   - Code affilié : unicité APPLICATIVE (slugify + collision, PAS de UNIQUE SQL).
//   - Statuts validés HANDLER (PAS de CHECK SQL) : affiliates.status
//     ('active'|'inactive') / commission_type ('fixed'|'percent') /
//     commission.status ('pending'|'approved'|'paid'|'rejected').
//   - best-effort : table/colonne absente (seq 92 non jouée) → réponse propre
//     (404 / {data:[]}), JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';

// Auth enrichi au choke-point (worker.ts) — calque tickets.ts:TicketAuth /
// funnels.ts:FunnelAuth (userId/role/clientId/tenant/capabilities).
export type AffiliateAuth = CapAuth & { capabilities?: Set<string> };

// Statuts v1 validés HANDLER (PAS de CHECK SQL — §6.A).
export const AFFILIATE_STATUSES = ['active', 'inactive'] as const;
export const COMMISSION_TYPES = ['fixed', 'percent'] as const;
export const COMMISSION_STATUSES = [
  'pending',
  'approved',
  'paid',
  'rejected',
] as const;

// ── Garde capability mode-agence-only (calque funnels.ts:capGuard /
//    tickets.ts:helpdeskCapGuard / LOT B-bis) ─────────────────────────────────
// Legacy/mono-tenant (!tenant || agencyId == null) → undefined : aucun bridage
// nouveau (le set legacy `legacyCapsFromRole` est LARGE ⇒ pas de régression
// historique). Mode agence (agencyId != null) → enforcement réel via
// requireCapability ('workflows.manage') ; viewer bridé.
export function affiliateCapGuard(auth: AffiliateAuth): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// ── Bornage tenant sur un affilié (calque tickets.ts:loadTicketInTenant) ─────
//   - Legacy/mono-tenant (!tenant || agencyId == null) → row : endpoint NEUF,
//     rétro-compat byte-équivalente à l'absence historique de borne.
//   - Mode agence (agencyId != null) → l'affilié doit avoir
//     client_id ∈ accessibleClientIds OU agency_id == auth.tenant.agencyId,
//     sinon json({error:'Affilié introuvable'},404).
// Renvoie la row affiliate (best-effort) ou une Response 404.
export async function loadAffiliateInTenant(
  env: Env,
  affiliateId: string,
  auth: AffiliateAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM affiliates WHERE id = ?')
      .bind(affiliateId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Affilié introuvable' }, 404);
  }
  if (!row) return json({ error: 'Affilié introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;

  const inTenant =
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId);
  if (!inTenant) return json({ error: 'Affilié introuvable' }, 404);
  return row;
}

// ── Bornage tenant sur une commission (calque loadAffiliateInTenant) ─────────
async function loadCommissionInTenant(
  env: Env,
  commissionId: string,
  auth: AffiliateAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM affiliate_commissions WHERE id = ?')
      .bind(commissionId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Commission introuvable' }, 404);
  }
  if (!row) return json({ error: 'Commission introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  if (rowClient == null || !accessible.includes(rowClient)) {
    return json({ error: 'Commission introuvable' }, 404);
  }
  return row;
}

// ── Slug applicatif (calque funnels.ts:slugify — unicité côté HANDLER) ───────
function slugify(input: string): string {
  const base = (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'aff';
}

// ── Construit le filtre tenant SQL (SELECT borné) calque funnels.ts:115-127.
//    Legacy/mono-tenant → pas de borne (byte-équivalent à l'absence historique).
//    Mode agence → agency_id = ? OR client_id IN (...accessibleClientIds).
function tenantFilter(auth: AffiliateAuth): { clause: string; params: string[] } {
  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return { clause: '', params: [] };
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const conds: string[] = ['agency_id = ?'];
  const params: string[] = [agencyId];
  if (accessible.length > 0) {
    conds.push(`client_id IN (${accessible.map(() => '?').join(',')})`);
    params.push(...accessible);
  }
  return { clause: `(${conds.join(' OR ')})`, params };
}

// CSV : échappe une cellule (quote + doublage des guillemets internes).
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// ════════════════════════════════════════════════════════════════════════════
// État : IMPLÉMENTÉ — corps réels présents. Signatures FIGÉES (worker.ts
// les câble déjà, api.ts les appelle déjà). Réponses best-effort neutres pour
// que l'app reste robuste si une table additive est absente.
// ════════════════════════════════════════════════════════════════════════════

// ── PUBLIC (pré-requireAuth) : redirect /r/:code ────────────────────────────
// Phase B : résout code → programme borné client_id du code, set cookie
// aff_attr=<code> (Max-Age=cookie_window_days×86400), log affiliate_clicks,
// 302 vers target_url du programme (calque trigger-links.ts:handleTriggerLinkClick).
// Anonyme, ZÉRO donnée tenant exposée. Fallback dur : redirect '/' propre.
export async function handleAffiliateRedirect(
  request: Request,
  env: Env,
  code: string,
): Promise<Response> {
  // Fallback dur : JAMAIS de 500/throw, on retombe sur '/'.
  const fallback = (): Response =>
    new Response(null, { status: 302, headers: { Location: '/' } });
  try {
    const cleanCode = (code || '').trim();
    if (!cleanCode) return fallback();

    // Résout l'affilié actif par son code public.
    const aff = (await env.DB.prepare(
      "SELECT id, client_id FROM affiliates WHERE code = ? AND status = 'active' LIMIT 1",
    )
      .bind(cleanCode)
      .first()) as { id: string; client_id: string | null } | null;
    if (!aff) return fallback();

    // Programme du tenant de l'affilié (cookie window + destination).
    let program: {
      cookie_window_days: number | null;
      target_url: string | null;
    } | null = null;
    try {
      program = (await env.DB.prepare(
        'SELECT cookie_window_days, target_url FROM affiliate_programs WHERE client_id IS ? LIMIT 1',
      )
        .bind(aff.client_id ?? null)
        .first()) as {
        cookie_window_days: number | null;
        target_url: string | null;
      } | null;
    } catch {
      program = null;
    }

    // Log clic best-effort (anonyme — ip/user_agent).
    try {
      const ip = request.headers.get('CF-Connecting-IP') || '';
      const ua = request.headers.get('User-Agent') || '';
      await env.DB.prepare(
        'INSERT INTO affiliate_clicks (id, client_id, affiliate_id, code, ip, user_agent) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)',
      )
        .bind(aff.client_id ?? null, aff.id, cleanCode, ip, sanitizeInput(ua, 300))
        .run();
    } catch {
      /* best-effort : le clic non loggé ne casse jamais le redirect */
    }

    const windowDays =
      program?.cookie_window_days != null && program.cookie_window_days > 0
        ? program.cookie_window_days
        : 30;
    const maxAge = windowDays * 86400;
    const target =
      program?.target_url && program.target_url.trim()
        ? program.target_url.trim()
        : '/';

    return new Response(null, {
      status: 302,
      headers: {
        Location: target,
        'Set-Cookie': `aff_attr=${encodeURIComponent(cleanCode)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax`,
      },
    });
  } catch {
    return fallback();
  }
}

// ── PROTÉGÉ : liste des affiliés du tenant ──────────────────────────────────
// Phase B : SELECT affiliates borné tenant (calque funnels.ts:handleGetFunnels).
export async function handleGetAffiliates(
  env: Env,
  auth: AffiliateAuth,
  _url: URL,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;
  try {
    const { clause, params } = tenantFilter(auth);
    let query = 'SELECT * FROM affiliates';
    if (clause) query += ` WHERE ${clause}`;
    query += ' ORDER BY created_at DESC';
    const stmt = env.DB.prepare(query);
    const { results } =
      params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
    return json({ data: results || [] });
  } catch {
    // Table seq 92 absente : best-effort liste vide (jamais de 500).
    return json({ data: [] });
  }
}

// ── PROTÉGÉ : création d'un affilié ─────────────────────────────────────────
// Phase B : INSERT affiliates (code unicité applicative slugify+collision,
// client_id/agency_id depuis tenant).
export async function handleCreateAffiliate(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Corps invalide' }, 400);
  }

  const name = sanitizeInput((body.name as string) || '', 120);
  const email = sanitizeInput((body.email as string) || '', 160);
  if (!name && !email) return json({ error: 'Nom ou email requis' }, 400);

  const status =
    AFFILIATE_STATUSES.includes(body.status as (typeof AFFILIATE_STATUSES)[number])
      ? (body.status as string)
      : 'active';

  // client_id / agency_id POSÉS depuis le tenant à la création (calque
  // funnels.ts:handleCreateFunnel — cross-tenant borné).
  const clientId = auth.tenant?.clientId ?? auth.clientId ?? null;
  const agencyId = auth.tenant?.agencyId ?? null;

  try {
    // Code public : slugify(name/email/custom) + suffixe court si collision.
    //    Unicité APPLICATIVE bornée tenant (un autre tenant peut réutiliser).
    let code = slugify(
      (body.code as string) || name || (email ? email.split('@')[0]! : '') || '',
    );
    const { clause, params } = tenantFilter(auth);
    const collides = async (c: string): Promise<boolean> => {
      let q = 'SELECT 1 AS x FROM affiliates WHERE code = ?';
      const p: string[] = [c];
      if (clause) {
        q += ` AND ${clause}`;
        p.push(...params);
      }
      q += ' LIMIT 1';
      const hit = (await env.DB.prepare(q).bind(...p).first()) as { x: number } | null;
      return !!hit;
    };
    if (await collides(code)) {
      let tries = 0;
      let candidate = code;
      while ((await collides(candidate)) && tries < 6) {
        candidate = `${code}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 56);
        tries++;
      }
      code = candidate;
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO affiliates (id, client_id, agency_id, name, email, code, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, clientId, agencyId, name, email, code, status)
      .run();

    return json({ data: { id, code } }, 201);
  } catch {
    return json({ error: 'Création impossible' }, 400);
  }
}

// ── PROTÉGÉ : détail d'un affilié (+ stats clics/commissions Phase B) ────────
export async function handleGetAffiliate(
  env: Env,
  auth: AffiliateAuth,
  affiliateId: string,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;
  const aff = await loadAffiliateInTenant(env, affiliateId, auth);
  if (aff instanceof Response) return aff;

  // Stats best-effort (clics + referrals + commissions) — jointures applicatives.
  let clicks = 0;
  let referrals = 0;
  let commissionsTotal = 0;
  try {
    const c = (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM affiliate_clicks WHERE affiliate_id = ?',
    )
      .bind(affiliateId)
      .first()) as { n: number } | null;
    clicks = c?.n ?? 0;
  } catch { /* best-effort */ }
  try {
    const r = (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM affiliate_referrals WHERE affiliate_id = ?',
    )
      .bind(affiliateId)
      .first()) as { n: number } | null;
    referrals = r?.n ?? 0;
  } catch { /* best-effort */ }
  try {
    const cm = (await env.DB.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM affiliate_commissions WHERE affiliate_id = ? AND status != 'rejected'",
    )
      .bind(affiliateId)
      .first()) as { total: number } | null;
    commissionsTotal = cm?.total ?? 0;
  } catch { /* best-effort */ }

  return json({ data: { ...aff, stats: { clicks, referrals, commissionsTotal } } });
}

// ── PROTÉGÉ : mise à jour d'un affilié (name/email/status) ──────────────────
export async function handleUpdateAffiliate(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
  affiliateId: string,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;
  const aff = await loadAffiliateInTenant(env, affiliateId, auth);
  if (aff instanceof Response) return aff;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Corps invalide' }, 400);
  }

  const updates: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.name === 'string') {
    updates.push('name = ?');
    binds.push(sanitizeInput(body.name, 120));
  }
  if (typeof body.email === 'string') {
    updates.push('email = ?');
    binds.push(sanitizeInput(body.email, 160));
  }
  if (
    typeof body.status === 'string' &&
    AFFILIATE_STATUSES.includes(body.status as (typeof AFFILIATE_STATUSES)[number])
  ) {
    updates.push('status = ?');
    binds.push(body.status);
  }
  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);

  updates.push("updated_at = datetime('now')");
  binds.push(affiliateId);
  try {
    await env.DB.prepare(`UPDATE affiliates SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
    return json({ data: { id: affiliateId } });
  } catch {
    return json({ error: 'Mise à jour impossible' }, 400);
  }
}

// ── PROTÉGÉ : suppression d'un affilié ──────────────────────────────────────
export async function handleDeleteAffiliate(
  env: Env,
  auth: AffiliateAuth,
  affiliateId: string,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;
  const aff = await loadAffiliateInTenant(env, affiliateId, auth);
  if (aff instanceof Response) return aff;
  try {
    // Nettoyage des données liées (jointures applicatives — pas de FK/cascade).
    await env.DB.prepare('DELETE FROM affiliate_clicks WHERE affiliate_id = ?')
      .bind(affiliateId)
      .run();
    await env.DB.prepare('DELETE FROM affiliate_referrals WHERE affiliate_id = ?')
      .bind(affiliateId)
      .run();
    await env.DB.prepare('DELETE FROM affiliate_commissions WHERE affiliate_id = ?')
      .bind(affiliateId)
      .run();
    await env.DB.prepare('DELETE FROM affiliates WHERE id = ?')
      .bind(affiliateId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Suppression impossible' }, 400);
  }
}

// ── PROTÉGÉ : programme d'affiliation du tenant (singleton GET) ─────────────
// Phase B : SELECT affiliate_programs borné tenant (1 par tenant), crée un
// défaut si absent.
export async function handleGetAffiliateProgram(
  env: Env,
  auth: AffiliateAuth,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;

  const clientId = auth.tenant?.clientId ?? auth.clientId ?? null;
  const defaults = {
    client_id: clientId,
    commission_type: 'fixed',
    commission_value: 0,
    cookie_window_days: 30,
    target_url: '',
    status: 'active',
  };
  try {
    const row = (await env.DB.prepare(
      'SELECT * FROM affiliate_programs WHERE client_id IS ? LIMIT 1',
    )
      .bind(clientId)
      .first()) as Record<string, unknown> | null;
    return json({ data: row ?? defaults });
  } catch {
    // Table seq 92 absente : retourne les défauts (jamais de 500).
    return json({ data: defaults });
  }
}

// ── PROTÉGÉ : mise à jour du programme (singleton PUT) ──────────────────────
// Phase B : UPSERT affiliate_programs (commission_type/value, cookie_window_days,
// target_url, status) borné tenant.
export async function handleUpdateAffiliateProgram(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Corps invalide' }, 400);
  }

  const clientId = auth.tenant?.clientId ?? auth.clientId ?? null;
  const agencyId = auth.tenant?.agencyId ?? null;

  const commissionType = COMMISSION_TYPES.includes(
    body.commission_type as (typeof COMMISSION_TYPES)[number],
  )
    ? (body.commission_type as string)
    : 'fixed';
  const commissionValueRaw = Number(body.commission_value);
  const commissionValue =
    Number.isFinite(commissionValueRaw) && commissionValueRaw >= 0
      ? commissionValueRaw
      : 0;

  // ── Sprint 49 Bis — validateCommissionConfig (helper engine V2)
  //    Map les valeurs HANDLER S92 (fixed/percent + value) vers CommissionRule
  //    et refuse 400 si invalide (ex : pct > 1 = 150% impossible). On ne valide
  //    QUE quand value > 0 (rétro-compat : commission_value=0 reste accepté
  //    comme "désactivé" — l'historique S92 le permet déjà).
  if (commissionValue > 0) {
    const rule: CommissionRule =
      commissionType === 'percent'
        ? { kind: 'pct', pct: commissionValue / 100 }
        : { kind: 'flat', cents: Math.round(commissionValue) };
    const validation = validateCommissionConfig(rule);
    if (!validation.ok) {
      return json(
        {
          error: `Configuration commission invalide: ${validation.error || 'inconnu'}`,
          error_code: 'INVALID_CONFIG',
        },
        400,
      );
    }
  }

  const cookieDaysRaw = Number(body.cookie_window_days);
  const cookieDays =
    Number.isFinite(cookieDaysRaw) && cookieDaysRaw > 0
      ? Math.floor(cookieDaysRaw)
      : 30;
  const targetUrl = sanitizeInput((body.target_url as string) || '', 2000);
  const status =
    AFFILIATE_STATUSES.includes(body.status as (typeof AFFILIATE_STATUSES)[number])
      ? (body.status as string)
      : 'active';

  try {
    // UPSERT applicatif (PAS de contrainte UNIQUE — singleton par client_id).
    const existing = (await env.DB.prepare(
      'SELECT id FROM affiliate_programs WHERE client_id IS ? LIMIT 1',
    )
      .bind(clientId)
      .first()) as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        `UPDATE affiliate_programs SET commission_type = ?, commission_value = ?,
           cookie_window_days = ?, target_url = ?, status = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(commissionType, commissionValue, cookieDays, targetUrl, status, existing.id)
        .run();
      return json({ data: { id: existing.id } });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO affiliate_programs
         (id, client_id, agency_id, commission_type, commission_value, cookie_window_days, target_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, clientId, agencyId, commissionType, commissionValue, cookieDays, targetUrl, status)
      .run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Mise à jour impossible' }, 400);
  }
}

// ── PROTÉGÉ : liste des commissions du tenant ───────────────────────────────
// Phase B : SELECT affiliate_commissions borné tenant + filtres optionnels
// (status, affiliate_id).
export async function handleGetAffiliateCommissions(
  env: Env,
  auth: AffiliateAuth,
  url: URL,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;
  try {
    const { clause, params } = tenantFilter(auth);
    const conds: string[] = [];
    const binds: string[] = [];
    if (clause) {
      conds.push(clause);
      binds.push(...params);
    }
    const statusFilter = url.searchParams.get('status');
    if (
      statusFilter &&
      COMMISSION_STATUSES.includes(statusFilter as (typeof COMMISSION_STATUSES)[number])
    ) {
      conds.push('status = ?');
      binds.push(statusFilter);
    }
    const affFilter = url.searchParams.get('affiliate_id');
    if (affFilter) {
      conds.push('affiliate_id = ?');
      binds.push(affFilter);
    }
    let query = 'SELECT * FROM affiliate_commissions';
    if (conds.length > 0) query += ` WHERE ${conds.join(' AND ')}`;
    query += ' ORDER BY created_at DESC';
    const stmt = env.DB.prepare(query);
    const { results } =
      binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
    const rows = (results || []) as Record<string, unknown>[];

    // Jointure applicative : nom/email de l'affilié (1 SELECT par id distinct).
    const affIds = [
      ...new Set(rows.map((r) => r.affiliate_id as string).filter(Boolean)),
    ];
    const affMap = new Map<string, { name: string; email: string }>();
    for (const aid of affIds) {
      try {
        const a = (await env.DB.prepare(
          'SELECT name, email FROM affiliates WHERE id = ?',
        )
          .bind(aid)
          .first()) as { name: string | null; email: string | null } | null;
        if (a) affMap.set(aid, { name: a.name || '', email: a.email || '' });
      } catch { /* best-effort */ }
    }
    const data = rows.map((r) => {
      const a = affMap.get(r.affiliate_id as string);
      return { ...r, affiliate_name: a?.name ?? '', affiliate_email: a?.email ?? '' };
    });
    return json({ data });
  } catch {
    return json({ data: [] });
  }
}

// ── PROTÉGÉ : export CSV des commissions (AVANT /:id — anti-shadowing) ───────
// Phase B : génère un CSV des commissions bornées tenant (payout manuel).
export async function handleExportAffiliateCommissions(
  env: Env,
  auth: AffiliateAuth,
  url: URL,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;

  const header =
    'affilie,email,lead_id,montant,devise,statut,date\n';
  try {
    const { clause, params } = tenantFilter(auth);
    const conds: string[] = [];
    const binds: string[] = [];
    if (clause) {
      conds.push(clause);
      binds.push(...params);
    }
    const statusFilter = url.searchParams.get('status');
    if (
      statusFilter &&
      COMMISSION_STATUSES.includes(statusFilter as (typeof COMMISSION_STATUSES)[number])
    ) {
      conds.push('status = ?');
      binds.push(statusFilter);
    }
    let query = 'SELECT * FROM affiliate_commissions';
    if (conds.length > 0) query += ` WHERE ${conds.join(' AND ')}`;
    query += ' ORDER BY created_at DESC';
    const stmt = env.DB.prepare(query);
    const { results } =
      binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
    const rows = (results || []) as Record<string, unknown>[];

    // Jointure applicative nom/email affilié.
    const affMap = new Map<string, { name: string; email: string }>();
    for (const aid of [
      ...new Set(rows.map((r) => r.affiliate_id as string).filter(Boolean)),
    ]) {
      try {
        const a = (await env.DB.prepare(
          'SELECT name, email FROM affiliates WHERE id = ?',
        )
          .bind(aid)
          .first()) as { name: string | null; email: string | null } | null;
        if (a) affMap.set(aid, { name: a.name || '', email: a.email || '' });
      } catch { /* best-effort */ }
    }

    const lines = rows.map((r) => {
      const a = affMap.get(r.affiliate_id as string);
      return [
        csvCell(a?.name ?? ''),
        csvCell(a?.email ?? ''),
        csvCell(r.lead_id),
        csvCell(r.amount),
        csvCell(r.currency),
        csvCell(r.status),
        csvCell(r.created_at),
      ].join(',');
    });

    const csv = header + (lines.length ? lines.join('\n') + '\n' : '');
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="commissions.csv"',
      },
    });
  } catch {
    // Table seq 92 absente : CSV en-têtes seules (jamais de 500).
    return new Response(header, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="commissions.csv"',
      },
    });
  }
}

// ── PROTÉGÉ : mise à jour du statut d'une commission (approved/paid/rejected) ─
// Phase B : loadAffiliateInTenant via la commission → UPDATE status (payout
// manuel : admin marque approved→paid). Statut validé HANDLER.
export async function handleUpdateCommissionStatus(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
  commissionId: string,
): Promise<Response> {
  const g = affiliateCapGuard(auth);
  if (g) return g;

  const commission = await loadCommissionInTenant(env, commissionId, auth);
  if (commission instanceof Response) return commission;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Corps invalide' }, 400);
  }

  const status = body.status as string;
  if (
    typeof status !== 'string' ||
    !COMMISSION_STATUSES.includes(status as (typeof COMMISSION_STATUSES)[number])
  ) {
    return json({ error: 'Statut invalide' }, 400);
  }

  try {
    await env.DB.prepare(
      "UPDATE affiliate_commissions SET status = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(status, commissionId)
      .run();
    return json({ data: { id: commissionId, status } });
  } catch {
    return json({ error: 'Mise à jour impossible' }, 400);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HOOKS CRM — appelés best-effort depuis leads.ts (hooks posés Phase A). Corps
// réels Phase B (Manager-B). Ces fonctions NE THROW JAMAIS (le caller les
// enveloppe déjà dans un try/catch avalant, mais on garde la double protection).
// ════════════════════════════════════════════════════════════════════════════

// ── attributeReferral — posé dans ingestLead (leads.ts) APRÈS l'INSERT du lead.
//    Si le payload porte un code affilié (data.aff), résout code → affiliate_id
//    (borné clientId) et INSERT la jonction affiliate_referrals. Best-effort
//    total : un échec n'altère JAMAIS la création du lead.
// Phase B (Manager-B) : SELECT affiliates WHERE code=? AND client_id borné →
//    INSERT affiliate_referrals (id, client_id, affiliate_id, lead_id, code).
export async function attributeReferral(
  env: Env,
  leadId: string,
  affCode: string | null | undefined,
  clientId: string | null,
): Promise<void> {
  try {
    const code = (affCode || '').trim();
    if (!code || !leadId) return;

    // ── FLAG cross-tenant : l'affilié DOIT appartenir au même tenant que le
    //    lead (client_id de l'appelant ingestLead, JAMAIS arbitraire). Un
    //    affilié d'un autre tenant ne peut pas s'attribuer ce lead.
    let aff: { id: string } | null = null;
    if (clientId == null) {
      // Legacy/mono-tenant : leads non bornés client_id → on résout sur les
      // affiliés eux-mêmes non bornés (client_id IS NULL), byte-équivalent.
      aff = (await env.DB.prepare(
        "SELECT id FROM affiliates WHERE code = ? AND client_id IS NULL AND status = 'active' LIMIT 1",
      )
        .bind(code)
        .first()) as { id: string } | null;
    } else {
      aff = (await env.DB.prepare(
        "SELECT id FROM affiliates WHERE code = ? AND client_id = ? AND status = 'active' LIMIT 1",
      )
        .bind(code, clientId)
        .first()) as { id: string } | null;
    }
    if (!aff) return;

    // Idempotence : pas de doublon de jonction pour ce lead.
    const existing = (await env.DB.prepare(
      'SELECT 1 AS x FROM affiliate_referrals WHERE lead_id = ? LIMIT 1',
    )
      .bind(leadId)
      .first()) as { x: number } | null;
    if (existing) return;

    await env.DB.prepare(
      'INSERT INTO affiliate_referrals (id, client_id, affiliate_id, lead_id, code) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)',
    )
      .bind(clientId, aff.id, leadId, code)
      .run();
  } catch {
    // best-effort total : l'attribution n'échoue JAMAIS l'ingestion du lead.
  }
}

// ── onLeadWon — posé dans handlePatchLead (leads.ts) quand status passe à 'won'.
//    Si le lead a une jonction affiliate_referrals, calcule la commission
//    SERVEUR d'après affiliate_programs (fixed=value ; percent=value% de
//    leads.deal_value) et INSERT affiliate_commissions (status 'pending').
//    Idempotent best-effort (pas de double commission sur re-won). Ne throw jamais.
// Phase B (Manager-B) : SELECT affiliate_referrals WHERE lead_id=? → SELECT
//    affiliate_programs borné → calcul amount → INSERT affiliate_commissions.
export async function onLeadWon(env: Env, leadId: string): Promise<void> {
  try {
    if (!leadId) return;

    // 1) Jonction affiliate_referrals pour ce lead (sinon : rien à commissionner).
    const referral = (await env.DB.prepare(
      'SELECT id, affiliate_id, client_id FROM affiliate_referrals WHERE lead_id = ? LIMIT 1',
    )
      .bind(leadId)
      .first()) as
      | { id: string; affiliate_id: string | null; client_id: string | null }
      | null;
    if (!referral || !referral.affiliate_id) return;

    // 2) Idempotence : pas de double commission sur re-won pour ce referral.
    const already = (await env.DB.prepare(
      'SELECT 1 AS x FROM affiliate_commissions WHERE referral_id = ? LIMIT 1',
    )
      .bind(referral.id)
      .first()) as { x: number } | null;
    if (already) return;

    // 3) Lead : deal_value pour le calcul percent (client_id confirme le tenant).
    //    FLAG cross-tenant : on calcule sur le lead réel, dont le client_id est
    //    intrinsèque (jamais arbitraire).
    const lead = (await env.DB.prepare(
      'SELECT deal_value FROM leads WHERE id = ? LIMIT 1',
    )
      .bind(leadId)
      .first()) as { deal_value: number | null } | null;
    const dealValue =
      lead?.deal_value != null && Number.isFinite(Number(lead.deal_value))
        ? Number(lead.deal_value)
        : 0;

    // 4) Programme du tenant de l'affilié/referral (commission_type/value).
    const program = (await env.DB.prepare(
      'SELECT commission_type, commission_value FROM affiliate_programs WHERE client_id IS ? LIMIT 1',
    )
      .bind(referral.client_id ?? null)
      .first()) as
      | { commission_type: string | null; commission_value: number | null }
      | null;

    const cType = program?.commission_type === 'percent' ? 'percent' : 'fixed';
    const cValue =
      program?.commission_value != null && Number.isFinite(Number(program.commission_value))
        ? Number(program.commission_value)
        : 0;

    // 5) Calcul SERVEUR de la commission. fixed = montant ; percent = % du deal.
    //    ZÉRO paiement réel (E4 intouché) — on n'enregistre QUE le montant + le
    //    statut 'pending' (payout manuel admin).
    const amount =
      cType === 'percent' ? Math.round((dealValue * cValue) / 100 * 100) / 100 : cValue;

    await env.DB.prepare(
      `INSERT INTO affiliate_commissions
         (id, client_id, affiliate_id, referral_id, lead_id, amount, currency, status)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, 'CAD', 'pending')`,
    )
      .bind(referral.client_id, referral.affiliate_id, referral.id, leadId, amount)
      .run();
  } catch {
    // best-effort total : la commission n'échoue JAMAIS le patch du lead.
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 49 — AFFILIATES / REFERRALS (seq144)
//
// 14 handlers (3 PUBLIC + 11 AUTHED) — extension du module affiliation S(G2)
// vers un modèle order-based avec tiers, referrals confirmés/réversibles,
// payouts mensuels en batch, link click tracking.
//
// Capabilities FIGÉES :
//   - clients.manage : affiliates CRUD + metrics, referrals confirm/reverse,
//                      referrals list, click list.
//   - settings.manage : payouts list + createBatch + markPaid (action sensible).
//   - PUBLIC (pré-requireAuth) : signup + track-click.
//
// Phase A : tous handlers fonctionnels (signup public + PATCH affiliate S49 +
// track-click + payouts + referrals + metrics). Câblage engine pour metrics +
// confirm + reverse + track-click + signup. Anti-bot strict (rate-limit
// hashé Loi 25 + honeypot _hp + audit best-effort).
//
// Contrats GELÉS (docs/LOT-AFFILIATES-S49.md §6) :
//   - succès : json({ data })
//   - erreur : json({ error }, status)   ← JAMAIS de champ `code`
//   - imports RELATIFS uniquement
//   - best-effort total — JAMAIS de throw / 500 non maîtrisé
//
// ⚠ DISTINCT du bloc S92 ci-dessus — handlers NEUFS qui ÉTENDENT sans toucher
//   aux handlers S92 (handleGetAffiliates, handleCreateAffiliate, etc.). Le
//   câblage worker.ts garde les routes S92 puis ajoute les nouvelles S49.
// ════════════════════════════════════════════════════════════════════════════

import {
  computeAffiliateMetrics,
  attributeOrderToAffiliate,
  createPayoutBatch as engineCreatePayoutBatch,
  generateAffiliateCode,
  AFFILIATE_TIERS_S49,
  REFERRAL_STATUSES,
  PAYOUT_STATUSES,
  PAYOUT_METHODS,
  TIER_COMMISSION_PCT,
  // ── Sprint 49 Bis — helpers V2 additifs (renforcement edge cases) ────────
  AFFILIATE_ERROR_CODES,
  DEFAULT_PAYOUT_DELAY_DAYS,
  computeCommission,
  isSelfReferral,
  detectFraudPattern,
  isPayoutEligible,
  computeReversal,
  getTierForVolume,
  validateCommissionConfig,
  type AffiliateTier as EngineAffiliateTier,
  type CommissionRule,
  type ClickEvent,
  type TierThreshold,
} from './lib/affiliate-engine';
import { checkRateLimit } from './lib/rate-limit';

// ── Whitelists Sprint 49 (validation HANDLER — PAS de CHECK SQL) ────────────

const AFFILIATE_STATUSES_S49 = ['active', 'paused', 'disabled'] as const;

// ── Garde capability Sprint 49 — `clients.manage` (vs `workflows.manage` S92)
// Le Sprint 49 escalade la cap à `clients.manage` pour les nouvelles routes
// (CRUD admin tier, metrics, referrals confirm/reverse). Reste compatible
// avec la legacy S92 (qui utilise affiliateCapGuard / workflows.manage).
function clientsManageCapGuard(
  auth: AffiliateAuth,
): Response | undefined {
  return requireCapability(auth.capabilities, 'clients.manage');
}

/** Cap `settings.manage` pour payouts (action sensible). */
function settingsManageCapGuard(
  auth: AffiliateAuth,
): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

/** Parse JSON body best-effort (empty/invalid ⇒ {}). */
async function readJsonBodyS49(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** UUID hex 32 (calque b2b-bundles-preorders.newId). */
function newIdS49(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Hash SHA256 hex (PII Loi 25 — ip/UA). Best-effort, fallback ''. */
async function sha256Hex(input: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(input || '');
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

/** Resolve client_id côté handler (auth context). */
function clientIdOfS49(auth: AffiliateAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// ── Bornage tenant Sprint 49 — calque loadAffiliateInTenant mais strict
// client_id only (vs legacy NULL S92). Phase B affinera. ──────────────────
async function loadAffiliateStrictTenant(
  env: Env,
  affiliateId: string,
  auth: AffiliateAuth,
): Promise<Record<string, unknown> | Response> {
  return loadAffiliateInTenant(env, affiliateId, auth);
}

/** Load referral borné tenant (par client_id sur affiliate_referrals). */
async function loadReferralInTenant(
  env: Env,
  referralId: string,
  auth: AffiliateAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM affiliate_referrals WHERE id = ?')
      .bind(referralId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Referral introuvable' }, 404);
  }
  if (!row) return json({ error: 'Referral introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  if (rowClient == null || !accessible.includes(rowClient)) {
    return json({ error: 'Referral introuvable' }, 404);
  }
  return row;
}

/** Load payout borné tenant. */
async function loadPayoutInTenant(
  env: Env,
  payoutId: string,
  auth: AffiliateAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM affiliate_payouts WHERE id = ?')
      .bind(payoutId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Payout introuvable' }, 404);
  }
  if (!row) return json({ error: 'Payout introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  if (rowClient == null || !accessible.includes(rowClient)) {
    return json({ error: 'Payout introuvable' }, 404);
  }
  return row;
}

// ── PUBLIC — Affiliate signup (visitor opt-in) ────────────────────────────
//
// POST /api/public/affiliates/signup
// Anti-bot strict :
//   - honeypot champ `_hp` (alias historique `website` toléré) → silent 200
//     fake-success (ne RÉVÈLE PAS que le bot a été détecté).
//   - rate-limit `affiliate:signup:<sha256Ip>` 3/3600s → 429 si rejected
//     (IP hashée Loi 25 — pas d'IP brute dans le bucket-key).
//   - validation email + name (au moins l'un des deux, email format @).
//   - client_id obligatoire (?client= en query OU body.client_id), sinon 400.
//   - generateAffiliateCode si pas fourni, retry 5x sur collision UNIQUE.
//   - INSERT affiliates (tier='starter', commission_pct=0.05, status='active').
//   - audit('affiliate_signup_public') best-effort.
// PAS de cap (pré-requireAuth). PAS de champ `code` dans les erreurs.
export async function handlePublicAffiliateSignup(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Rate-limit IP hashée (3 signups / heure / IP). Bucket-key = SHA256(ip)
    // pour ne JAMAIS stocker l'IP brute dans rate_limit_buckets (Loi 25).
    const ip =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const sha256Ip = await sha256Hex(ip);
    const rl = await checkRateLimit(
      env,
      `affiliate:signup:${sha256Ip}`,
      3,
      3600,
    );
    if (!rl.allowed) {
      return json({ error: 'Trop de requêtes, réessayez plus tard' }, 429);
    }

    const body = await readJsonBodyS49(request);

    // Honeypot — visiteur humain ne le remplit pas. Anti-fingerprint :
    // 200 fake-success (id/code 'bot') pour ne pas signaler la détection.
    // Supporte `_hp` (spec S49) ET `website` (legacy compat).
    const honeypotHp = typeof body._hp === 'string' ? body._hp.trim() : '';
    const honeypotWebsite =
      typeof body.website === 'string' ? body.website.trim() : '';
    if (honeypotHp.length > 0 || honeypotWebsite.length > 0) {
      return json({ data: { id: 'bot', code: 'bot', status: 'active' } });
    }

    const name = sanitizeInput((body.name as string) || '', 120);
    const email = sanitizeInput((body.email as string) || '', 200);
    if (!name && !email) return json({ error: 'Nom ou email requis' }, 400);
    if (email && !email.includes('@')) {
      return json({ error: 'Email invalide' }, 400);
    }

    // Résolution client_id : query ?client=... ou body.client_id. Si absent,
    // 400 propre (pas de leak — l'agence-default n'est pas inférable côté
    // PUBLIC sans contexte). Phase B : referer/origin → tenant resolver.
    let clientId: string | null = null;
    try {
      const url = new URL(request.url);
      const qClient = url.searchParams.get('client');
      if (qClient && qClient.trim()) clientId = qClient.trim();
    } catch {
      /* best-effort */
    }
    if (!clientId && typeof body.client_id === 'string' && body.client_id.trim()) {
      clientId = body.client_id.trim();
    }
    if (!clientId) {
      return json(
        { error: 'Tenant requis (?client= ou body.client_id)' },
        400,
      );
    }

    // Code applicatif : généré sinon fourni, retry 5x si collision sur UNIQUE
    // INDEX (client_id, code).
    const requestedCode =
      typeof body.code === 'string' && body.code.trim()
        ? body.code.trim().slice(0, 64)
        : null;
    let code = requestedCode || generateAffiliateCode(name || email);
    let tries = 0;
    while (tries < 5) {
      try {
        const exists = (await env.DB.prepare(
          'SELECT 1 AS x FROM affiliates WHERE client_id IS ? AND code = ? LIMIT 1',
        )
          .bind(clientId, code)
          .first()) as { x: number } | null;
        if (!exists) break;
      } catch {
        // Best-effort : si la vérif échoue (D1 panne), on tente l'INSERT
        // (UNIQUE INDEX bloquera côté SQL).
        break;
      }
      code = generateAffiliateCode(name || email);
      tries += 1;
    }

    const id = newIdS49();
    try {
      await env.DB.prepare(
        `INSERT INTO affiliates
           (id, client_id, name, email, code, status, tier, commission_pct, payout_method)
         VALUES (?, ?, ?, ?, ?, 'active', 'starter', 0.05, 'manual')`,
      )
        .bind(id, clientId, name, email, code)
        .run();
    } catch {
      // INSERT échoué (collision UNIQUE après retries ou table absente).
      return json({ error: 'Inscription impossible' }, 400);
    }

    // Audit best-effort (userId='public' — pré-requireAuth, pas d'identité).
    try {
      await audit(env, 'public', 'affiliate_signup_public', 'affiliate', id, {
        client_id: clientId,
        code,
        has_name: !!name,
        has_email: !!email,
      });
    } catch {
      /* best-effort */
    }

    return json({ data: { id, code, status: 'active' } });
  } catch {
    return json({ error: 'Erreur inscription affilié' }, 500);
  }
}

// ── PUBLIC — Track click ──────────────────────────────────────────────────
//
// POST /api/public/affiliates/track-click
// Script tracking du site marchand log un clic sur un lien d'affiliation.
// Anti-bot strict :
//   - rate-limit `affiliate:click:<sha256Ip>` 30/60s → 429 si rejected
//     (IP hashée Loi 25 — pas d'IP brute dans le bucket-key).
//   - body { code, source_url, landing_page, visitor_id }.
//   - lookup affiliate par code (cross-tenant : code public par design).
//     Si introuvable → 200 silent (anti-fingerprint).
//   - INSERT affiliate_clicks (PII Loi 25 : ip_hash + ua_hash, jamais brut).
//   - Set-Cookie `_ref=<code>` Max-Age=30d SameSite=Lax (attribution future
//     au checkout via affiliate-engine.attributeOrderToAffiliate).
export async function handlePublicTrackClick(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const ip =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const userAgent = request.headers.get('user-agent') || '';
    const country = request.headers.get('cf-ipcountry') || '';

    // PII Loi 25 — hash IP + UA AVANT bucket-key (pas d'IP brute stockée).
    const [ipHash, uaHash] = await Promise.all([
      sha256Hex(ip),
      sha256Hex(userAgent),
    ]);

    const rl = await checkRateLimit(
      env,
      `affiliate:click:${ipHash}`,
      30,
      60,
    );
    if (!rl.allowed) {
      return json({ error: 'Trop de requêtes' }, 429);
    }

    const body = await readJsonBodyS49(request);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code) return json({ error: 'code requis' }, 400);

    const sourceUrl = sanitizeInput((body.source_url as string) || '', 2000);
    const landingPage = sanitizeInput((body.landing_page as string) || '', 2000);

    // Visitor cookie (1st-party). V1 : génère un visitor_id si non transmis.
    const visitorId =
      typeof body.visitor_id === 'string' && body.visitor_id.trim()
        ? body.visitor_id.trim().slice(0, 64)
        : newIdS49();

    // Lookup affiliate par code (cross-tenant via UNIQUE INDEX par code
    // global ? Non — par client_id+code, donc on cherche dans toutes les rows
    // actives, LIMIT 1). PAS de bornage tenant ici — le code est public par
    // design ; la sécurité de l'attribution se fait au moment du checkout via
    // affiliate-engine.attributeOrderToAffiliate (bornage order.client_id).
    let affiliate: { id: string; client_id: string | null } | null = null;
    try {
      affiliate = (await env.DB.prepare(
        "SELECT id, client_id FROM affiliates WHERE code = ? AND status = 'active' LIMIT 1",
      )
        .bind(code)
        .first()) as { id: string; client_id: string | null } | null;
    } catch {
      /* best-effort */
    }
    if (!affiliate) {
      // Anti-fingerprint : 200 silent (ne révèle pas si le code existe).
      return json({ data: { tracked: false, visitor_id: visitorId } });
    }

    const id = newIdS49();
    try {
      await env.DB.prepare(
        `INSERT INTO affiliate_clicks
           (id, client_id, affiliate_id, code, visitor_id, source_url,
            landing_page, ip_hash, user_agent_hash, country, clicked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
        .bind(
          id,
          affiliate.client_id,
          affiliate.id,
          code,
          visitorId,
          sourceUrl,
          landingPage,
          ipHash,
          uaHash,
          country,
        )
        .run();
    } catch {
      // best-effort — le clic non loggé ne casse pas la réponse.
    }

    // Cookie `_ref=<code>` 30 jours (attribution future au checkout). Helper
    // json() ne supporte pas les headers custom → on construit la Response
    // directement (calque handleAffiliateRedirect:239-245).
    const refCookieMaxAge = 30 * 86400;
    const payload = JSON.stringify({
      data: { tracked: true, id, visitor_id: visitorId },
    });
    return new Response(payload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `_ref=${encodeURIComponent(code)}; Max-Age=${refCookieMaxAge}; Path=/; SameSite=Lax`,
      },
    });
  } catch {
    return json({ error: 'Erreur tracking' }, 500);
  }
}

// ── PROTÉGÉ — GET /api/affiliates/:id/metrics ─────────────────────────────
//
// Métriques agrégées d'un affilié (clicks + conversions + total commission +
// conversion rate). Cap `clients.manage`.
export async function handleGetAffiliateMetrics(
  env: Env,
  auth: AffiliateAuth,
  affiliateId: string,
): Promise<Response> {
  const cap = clientsManageCapGuard(auth);
  if (cap) return cap;
  const aff = await loadAffiliateStrictTenant(env, affiliateId, auth);
  if (aff instanceof Response) return aff;

  try {
    const metrics = await computeAffiliateMetrics(env, affiliateId);
    return json({ data: { affiliate_id: affiliateId, ...metrics } });
  } catch {
    return json(
      {
        data: {
          affiliate_id: affiliateId,
          clicks: 0,
          conversions: 0,
          total_commission_cents: 0,
          conversion_rate: 0,
          total_referrals: 0,
        },
      },
    );
  }
}

// ── PROTÉGÉ — POST /api/affiliates (admin créer affilié avec tier S49) ────
//
// Câblage admin S49 qui accepte tier + commission_pct + payout_method +
// payout_account_ref + customer_id. La route S92 GET/POST /api/affiliates
// reste FONCTIONNELLE (handleCreateAffiliate ci-dessus) pour la legacy.
export async function handleCreateAffiliateAdmin(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
): Promise<Response> {
  const cap = clientsManageCapGuard(auth);
  if (cap) return cap;

  const body = await readJsonBodyS49(request);
  const name = sanitizeInput((body.name as string) || '', 120);
  const email = sanitizeInput((body.email as string) || '', 200);
  if (!name && !email) return json({ error: 'Nom ou email requis' }, 400);

  const tier: EngineAffiliateTier = AFFILIATE_TIERS_S49.includes(
    body.tier as EngineAffiliateTier,
  )
    ? (body.tier as EngineAffiliateTier)
    : 'starter';
  const commissionPctRaw = Number(body.commission_pct);
  const commissionPct =
    Number.isFinite(commissionPctRaw) && commissionPctRaw >= 0 && commissionPctRaw <= 1
      ? commissionPctRaw
      : TIER_COMMISSION_PCT[tier];

  const payoutMethod = PAYOUT_METHODS.includes(
    body.payout_method as (typeof PAYOUT_METHODS)[number],
  )
    ? (body.payout_method as string)
    : 'manual';

  const customerId =
    typeof body.customer_id === 'string' ? body.customer_id.trim() : null;
  const payoutAccountRef =
    typeof body.payout_account_ref === 'string'
      ? sanitizeInput(body.payout_account_ref, 200)
      : null;

  const clientId = clientIdOfS49(auth);
  const agencyId = auth.tenant?.agencyId ?? null;

  try {
    // Code unicité — engine génère slug+suffix random ; collision check via
    // UNIQUE INDEX uniq_affiliates_client_code (re-tente max 6 fois).
    let code =
      typeof body.code === 'string' && body.code.trim()
        ? body.code.trim().slice(0, 64)
        : generateAffiliateCode(name || email);
    let tries = 0;
    while (tries < 6) {
      try {
        const exists = (await env.DB.prepare(
          'SELECT 1 AS x FROM affiliates WHERE client_id IS ? AND code = ? LIMIT 1',
        )
          .bind(clientId, code)
          .first()) as { x: number } | null;
        if (!exists) break;
        code = generateAffiliateCode(name || email);
        tries += 1;
      } catch {
        break;
      }
    }

    const id = newIdS49();
    await env.DB.prepare(
      `INSERT INTO affiliates
         (id, client_id, agency_id, name, email, code, status, customer_id,
          tier, commission_pct, payout_method, payout_account_ref)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        clientId,
        agencyId,
        name,
        email,
        code,
        customerId,
        tier,
        commissionPct,
        payoutMethod,
        payoutAccountRef,
      )
      .run();

    return json({ data: { id, code } }, 201);
  } catch {
    return json({ error: 'Création impossible' }, 400);
  }
}

// ── PROTÉGÉ — PATCH /api/affiliates/:id (S49 update tier/commission/status) ─
//
// Cap `clients.manage`. Update partiel (tier, commission_pct, status, name,
// email, payout_method, payout_account_ref). UPDATE bornée tenant via
// loadAffiliateStrictTenant (404 si cross-tenant). Statuts validés HANDLER.
// audit('affiliate_update_s49') best-effort.
export async function handleUpdateAffiliateS49(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
  affiliateId: string,
): Promise<Response> {
  const cap = clientsManageCapGuard(auth);
  if (cap) return cap;
  const aff = await loadAffiliateStrictTenant(env, affiliateId, auth);
  if (aff instanceof Response) return aff;

  const body = await readJsonBodyS49(request);

  const updates: string[] = [];
  const binds: unknown[] = [];

  // tier — whitelist HANDLER (AFFILIATE_TIERS_S49).
  if (typeof body.tier === 'string') {
    const tier = body.tier as EngineAffiliateTier;
    if (AFFILIATE_TIERS_S49.includes(tier)) {
      updates.push('tier = ?');
      binds.push(tier);
    } else {
      return json({ error: 'Tier invalide' }, 400);
    }
  }

  // commission_pct ∈ [0..1] (override tier default).
  if (body.commission_pct !== undefined) {
    const pct = Number(body.commission_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
      return json({ error: 'commission_pct invalide (∈ [0..1])' }, 400);
    }
    updates.push('commission_pct = ?');
    binds.push(pct);
  }

  // status — whitelist HANDLER S49 (active|paused|disabled).
  if (typeof body.status === 'string') {
    const status = body.status;
    if (
      !AFFILIATE_STATUSES_S49.includes(
        status as (typeof AFFILIATE_STATUSES_S49)[number],
      )
    ) {
      return json({ error: 'Statut invalide' }, 400);
    }
    updates.push('status = ?');
    binds.push(status);
  }

  // name / email — sanitize.
  if (typeof body.name === 'string') {
    updates.push('name = ?');
    binds.push(sanitizeInput(body.name, 120));
  }
  if (typeof body.email === 'string') {
    const email = sanitizeInput(body.email, 200);
    if (email && !email.includes('@')) {
      return json({ error: 'Email invalide' }, 400);
    }
    updates.push('email = ?');
    binds.push(email);
  }

  // payout_method — whitelist HANDLER (manual|stripe_connect).
  if (typeof body.payout_method === 'string') {
    const pm = body.payout_method;
    if (!PAYOUT_METHODS.includes(pm as (typeof PAYOUT_METHODS)[number])) {
      return json({ error: 'payout_method invalide' }, 400);
    }
    updates.push('payout_method = ?');
    binds.push(pm);
  }

  // payout_account_ref — sanitize (token Stripe Connect futur, opaque V1).
  if (typeof body.payout_account_ref === 'string') {
    updates.push('payout_account_ref = ?');
    binds.push(sanitizeInput(body.payout_account_ref, 200));
  }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  binds.push(affiliateId);

  try {
    await env.DB.prepare(
      `UPDATE affiliates SET ${updates.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
  } catch {
    return json({ error: 'Mise à jour impossible' }, 400);
  }

  // Audit best-effort (champs modifiés — pas les valeurs sensibles brutes).
  try {
    await audit(
      env,
      auth.userId || 'unknown',
      'affiliate_update_s49',
      'affiliate',
      affiliateId,
      {
        fields: updates
          .filter((u) => u !== "updated_at = datetime('now')")
          .map((u) => u.split(' = ')[0]),
      },
    );
  } catch {
    /* best-effort */
  }

  // Lecture row à jour.
  let updated: Record<string, unknown> | null = null;
  try {
    updated = (await env.DB.prepare('SELECT * FROM affiliates WHERE id = ?')
      .bind(affiliateId)
      .first()) as Record<string, unknown> | null;
  } catch {
    /* best-effort */
  }

  return json({ data: updated ?? { id: affiliateId } });
}

// ── PROTÉGÉ — GET /api/affiliate-referrals (list filtres) ────────────────
export async function handleListReferrals(
  env: Env,
  auth: AffiliateAuth,
  url: URL,
): Promise<Response> {
  const cap = clientsManageCapGuard(auth);
  if (cap) return cap;

  try {
    const { clause, params } = tenantFilter(auth);
    const conds: string[] = [];
    const binds: string[] = [];
    if (clause) {
      conds.push(clause);
      binds.push(...params);
    }
    const affId = url.searchParams.get('affiliate_id');
    if (affId) {
      conds.push('affiliate_id = ?');
      binds.push(affId);
    }
    const status = url.searchParams.get('status');
    if (
      status &&
      REFERRAL_STATUSES.includes(status as (typeof REFERRAL_STATUSES)[number])
    ) {
      conds.push('status = ?');
      binds.push(status);
    }
    const orderId = url.searchParams.get('order_id');
    if (orderId) {
      conds.push('order_id = ?');
      binds.push(orderId);
    }
    let query = 'SELECT * FROM affiliate_referrals';
    if (conds.length > 0) query += ` WHERE ${conds.join(' AND ')}`;
    query += ' ORDER BY created_at DESC LIMIT 500';
    const stmt = env.DB.prepare(query);
    const { results } =
      binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// ── PROTÉGÉ — POST /api/affiliate-referrals/:id/confirm ──────────────────
//
// Passe referral pending → confirmed. Idempotent (re-confirm = no-op).
// Phase A fonctionnel : UPDATE status + confirmed_at + update affiliates.
// total_commissions_cents agrégat (best-effort).
export async function handleConfirmReferral(
  env: Env,
  auth: AffiliateAuth,
  referralId: string,
): Promise<Response> {
  const cap = clientsManageCapGuard(auth);
  if (cap) return cap;
  const ref = await loadReferralInTenant(env, referralId, auth);
  if (ref instanceof Response) return ref;

  const currentStatus = (ref as Record<string, unknown>).status as string | null;
  if (currentStatus === 'confirmed' || currentStatus === 'paid') {
    return json({ data: ref });
  }
  if (currentStatus === 'reversed') {
    return json({ error: 'Referral réversé — confirmation impossible' }, 400);
  }
  // ── Sprint 49 Bis — refuser confirmation si referral flagged par fraud
  //    detection à l'attribution. Admin doit unflag (status='pending') avant.
  if (currentStatus === 'flagged') {
    return json(
      {
        error: 'Referral flagged — fraud review requis',
        error_code: AFFILIATE_ERROR_CODES.FRAUD_DETECTED,
      },
      409,
    );
  }

  try {
    await env.DB.prepare(
      `UPDATE affiliate_referrals
          SET status = 'confirmed', confirmed_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(referralId)
      .run();

    // Best-effort agrégat (cache UI) — total_commissions_cents +=
    // commission_cents du referral confirmé.
    const commission =
      Number((ref as Record<string, unknown>).commission_cents ?? 0) || 0;
    const affId = (ref as Record<string, unknown>).affiliate_id as string | null;
    if (affId && commission > 0) {
      try {
        await env.DB.prepare(
          `UPDATE affiliates
              SET total_commissions_cents = COALESCE(total_commissions_cents, 0) + ?,
                  total_referrals_count = COALESCE(total_referrals_count, 0) + 1,
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
          .bind(commission, affId)
          .run();
      } catch {
        /* best-effort */
      }
    }

    const updated = await env.DB.prepare(
      'SELECT * FROM affiliate_referrals WHERE id = ?',
    )
      .bind(referralId)
      .first();
    return json({ data: updated });
  } catch {
    return json({ error: 'Confirmation impossible' }, 400);
  }
}

// ── PROTÉGÉ — POST /api/affiliate-referrals/:id/reverse ──────────────────
//
// Annule referral (refund / fraude). Idempotent. Ajuste l'agrégat
// total_commissions_cents en conséquence (best-effort).
export async function handleReverseReferral(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
  referralId: string,
): Promise<Response> {
  const cap = clientsManageCapGuard(auth);
  if (cap) return cap;
  const ref = await loadReferralInTenant(env, referralId, auth);
  if (ref instanceof Response) return ref;

  const currentStatus = (ref as Record<string, unknown>).status as string | null;
  // ── Sprint 49 Bis — engine computeReversal centralise la logique
  //    ALREADY_REVERSED + montant à retirer (full ou partial via refundRatio).
  if (currentStatus === 'reversed') {
    // Idempotent : on conserve 200 mais on remonte le code d'erreur engine
    //    dans le body pour traçabilité côté UI (ALREADY_REVERSED).
    const rev = computeReversal(
      ref as Record<string, unknown> as Parameters<typeof computeReversal>[0],
      1,
    );
    return json({
      data: ref,
      already_reversed: true,
      error_code: rev.reason, // ALREADY_REVERSED
    });
  }
  if (currentStatus === 'paid') {
    return json(
      { error: 'Referral déjà payé — réversion impossible (créer refund)' },
      400,
    );
  }

  // Body parsé pour refund_ratio optionnel (partial refund) + reason (audit).
  const body = await readJsonBodyS49(request);
  const refundRatioRaw = Number(body.refund_ratio);
  const refundRatio =
    Number.isFinite(refundRatioRaw) && refundRatioRaw >= 0 && refundRatioRaw <= 1
      ? refundRatioRaw
      : 1;

  // computeReversal : montant à retirer (cents). Empêche aussi tout double
  // reverse (code ALREADY_REVERSED renvoyé si status===reversed).
  const reversal = computeReversal(
    ref as Record<string, unknown> as Parameters<typeof computeReversal>[0],
    refundRatio,
  );

  try {
    await env.DB.prepare(
      `UPDATE affiliate_referrals SET status = 'reversed' WHERE id = ?`,
    )
      .bind(referralId)
      .run();

    // Ajustement agrégat (si confirmed → reversed, on retire la commission
    // au prorata calculé par computeReversal).
    if (currentStatus === 'confirmed') {
      const commission = reversal.reverseAmount;
      const affId = (ref as Record<string, unknown>).affiliate_id as
        | string
        | null;
      if (affId && commission > 0) {
        try {
          await env.DB.prepare(
            `UPDATE affiliates
                SET total_commissions_cents = MAX(0, COALESCE(total_commissions_cents, 0) - ?),
                    total_referrals_count = MAX(0, COALESCE(total_referrals_count, 0) - 1),
                    updated_at = datetime('now')
              WHERE id = ?`,
          )
            .bind(commission, affId)
            .run();
        } catch {
          /* best-effort */
        }
      }
    }

    const updated = await env.DB.prepare(
      'SELECT * FROM affiliate_referrals WHERE id = ?',
    )
      .bind(referralId)
      .first();
    return json({ data: updated });
  } catch {
    return json({ error: 'Réversion impossible' }, 400);
  }
}

// ── PROTÉGÉ — GET /api/affiliate-payouts (cap settings.manage) ───────────
export async function handleListPayouts(
  env: Env,
  auth: AffiliateAuth,
  url: URL,
): Promise<Response> {
  const cap = settingsManageCapGuard(auth);
  if (cap) return cap;

  try {
    const { clause, params } = tenantFilter(auth);
    const conds: string[] = [];
    const binds: string[] = [];
    if (clause) {
      conds.push(clause);
      binds.push(...params);
    }
    const affId = url.searchParams.get('affiliate_id');
    if (affId) {
      conds.push('affiliate_id = ?');
      binds.push(affId);
    }
    const status = url.searchParams.get('status');
    if (
      status &&
      PAYOUT_STATUSES.includes(status as (typeof PAYOUT_STATUSES)[number])
    ) {
      conds.push('status = ?');
      binds.push(status);
    }
    const periodAfter = url.searchParams.get('period_end_after');
    if (periodAfter) {
      conds.push('period_end >= ?');
      binds.push(periodAfter);
    }
    let query = 'SELECT * FROM affiliate_payouts';
    if (conds.length > 0) query += ` WHERE ${conds.join(' AND ')}`;
    query += ' ORDER BY created_at DESC LIMIT 500';
    const stmt = env.DB.prepare(query);
    const { results } =
      binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// ── PROTÉGÉ — POST /api/affiliate-payouts (créer batch mensuel) ──────────
//
// Cap `settings.manage`. Phase A fonctionnel : appelle
// affiliate-engine.createPayoutBatch qui sélectionne les referrals confirmés
// dans la fenêtre et insère N affiliate_payouts.
export async function handleCreatePayoutBatch(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
): Promise<Response> {
  const cap = settingsManageCapGuard(auth);
  if (cap) return cap;

  const body = await readJsonBodyS49(request);
  const periodStart =
    typeof body.period_start === 'string' ? body.period_start.trim() : '';
  const periodEnd =
    typeof body.period_end === 'string' ? body.period_end.trim() : '';
  if (!periodStart || !periodEnd) {
    return json({ error: 'period_start et period_end requis' }, 400);
  }

  const clientId = clientIdOfS49(auth);
  if (!clientId) {
    return json({ error: 'Tenant introuvable' }, 400);
  }

  try {
    const res = await engineCreatePayoutBatch(
      env,
      clientId,
      periodStart,
      periodEnd,
    );
    return json({
      data: {
        payouts_created: res.payouts_created,
        total_cents: res.total_cents,
        referrals_count: res.referrals_count,
      },
    });
  } catch {
    return json({ error: 'Création batch impossible' }, 500);
  }
}

// ── PROTÉGÉ — POST /api/affiliate-payouts/:id/mark-paid ─────────────────
//
// V1 payout MANUEL — admin marque paid + (optionnel) stripe_transfer_id +
// notes. Phase B câblera Stripe Connect transfer.create.
export async function handleMarkPayoutPaid(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
  payoutId: string,
): Promise<Response> {
  const cap = settingsManageCapGuard(auth);
  if (cap) return cap;
  const payout = await loadPayoutInTenant(env, payoutId, auth);
  if (payout instanceof Response) return payout;

  const currentStatus = (payout as Record<string, unknown>).status as
    | string
    | null;
  if (currentStatus === 'paid') {
    return json({ data: payout });
  }

  const body = await readJsonBodyS49(request);
  const stripeTransferId =
    typeof body.stripe_transfer_id === 'string'
      ? sanitizeInput(body.stripe_transfer_id, 200)
      : null;
  const notes =
    typeof body.notes === 'string' ? sanitizeInput(body.notes, 1000) : null;

  try {
    await env.DB.prepare(
      `UPDATE affiliate_payouts
          SET status = 'paid', paid_at = datetime('now'),
              stripe_transfer_id = COALESCE(?, stripe_transfer_id),
              notes = COALESCE(?, notes)
        WHERE id = ?`,
    )
      .bind(stripeTransferId, notes, payoutId)
      .run();

    // Update referrals associés au payout (status confirmed → paid).
    try {
      await env.DB.prepare(
        `UPDATE affiliate_referrals
            SET status = 'paid', paid_at = datetime('now')
          WHERE payout_id = ? AND status = 'confirmed'`,
      )
        .bind(payoutId)
        .run();
    } catch {
      /* best-effort */
    }

    const updated = await env.DB.prepare(
      'SELECT * FROM affiliate_payouts WHERE id = ?',
    )
      .bind(payoutId)
      .first();
    return json({ data: updated });
  } catch {
    return json({ error: 'Marquage payout paid impossible' }, 400);
  }
}

// ── Hook order completed (appelé depuis ecommerce-checkout.ts Phase B) ───
//
// Wrapper non-throw qui ré-exporte attributeOrderToAffiliate de l'engine
// (pour permettre le tree-shaking côté handler — pas d'import direct
// engine dans ecommerce-checkout.ts).
export async function onOrderCompletedAttribution(
  env: Env,
  orderId: string,
  referralCode: string | null | undefined,
): Promise<void> {
  try {
    if (!referralCode) return;
    await attributeOrderToAffiliate(env, orderId, referralCode);
  } catch {
    // best-effort total — la complétion d'order n'échoue JAMAIS pour ça.
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 49 Bis — handlers HTTP câblage des helpers engine V2 (renforcement)
//
// Tout est ADDITIF — 0 régression sur les 62/62 tests existants. Wrappers
// pour exposer côté worker.ts les nouveaux flux : attribution avec
// self-referral + fraud detection, payout référence unique (eligibility),
// reverse référence (computeReversal centralisé déjà câblé ci-dessus).
//
// Caps :
//   - handleAttributeOrderToAffiliate : interne (appelé par checkout) ⇒ pas
//     de cap (best-effort wrapper) MAIS retourne 4xx pour fraud/self-referral.
//   - handlePayoutReferral : cap 'settings.manage' (action sensible).
//   - handleCreateAffiliateProgram : alias de handleUpdateAffiliateProgram
//     (UPSERT singleton — pas de POST séparé en V1) + validation engine.
//   - handleUpdateAffiliateConfig : alias de handleUpdateAffiliateS49 (config
//     tier + commission_pct d'un affilié) + validation engine.
// ════════════════════════════════════════════════════════════════════════════

/** Forme minimale d'un ordre pour attribution (lookup buyer email + total). */
export interface AttributeOrderContext {
  orderId: string;
  referralCode: string;
  /** Email du buyer (case-insensitive comparé à affiliate.email). */
  buyerEmail?: string | null;
  /** Clicks récents pré-fetchés (pour detectFraudPattern). */
  recentClicks?: ClickEvent[];
  /** Tier thresholds (volume cents → tier) — résolution dynamique. */
  tierThresholds?: TierThreshold[];
}

/**
 * Attribue un order à un affilié avec garde-fous engine V2 :
 *   1. isSelfReferral(buyerEmail, affiliate.email) → 403 SELF_REFERRAL.
 *   2. detectFraudPattern(recentClicks) → si suspicious, status='flagged' au
 *      lieu de 'pending' (le referral est créé mais nécessite review admin
 *      avant confirm — handleConfirmReferral le bloque).
 *   3. Sinon → attributeOrderToAffiliate engine standard (status='pending').
 *
 * Retourne json({ data: AttributeOrderResult }) ou json({ error, error_code }).
 * Best-effort total — toute exception non maîtrisée retourne 500 propre.
 */
export async function handleAttributeOrderToAffiliate(
  env: Env,
  ctx: AttributeOrderContext,
): Promise<Response> {
  try {
    const orderId = (ctx.orderId || '').trim();
    const code = (ctx.referralCode || '').trim();
    if (!orderId || !code) {
      return json(
        {
          error: 'orderId et referralCode requis',
          error_code: AFFILIATE_ERROR_CODES.REFERRAL_INVALID,
        },
        400,
      );
    }

    // 1) Self-referral check (l'affilié essaye de toucher commission sur sa
    //    propre commande). On lookup l'email de l'affilié par code (1 SELECT).
    if (ctx.buyerEmail) {
      let affEmail: string | null = null;
      try {
        const row = (await env.DB.prepare(
          "SELECT email FROM affiliates WHERE code = ? AND status = 'active' LIMIT 1",
        )
          .bind(code)
          .first()) as { email: string | null } | null;
        affEmail = row?.email ?? null;
      } catch {
        /* best-effort — si lookup échoue, on laisse l'engine traiter en aval */
      }
      if (affEmail && isSelfReferral(ctx.buyerEmail, affEmail)) {
        return json(
          {
            error: 'Self-referral détecté — affilié ne peut pas toucher sur sa propre commande',
            error_code: AFFILIATE_ERROR_CODES.SELF_REFERRAL,
          },
          403,
        );
      }
    }

    // 2) Fraud detection sur les clicks récents pré-fetchés. Si suspicious,
    //    on procède à l'attribution MAIS marque le referral 'flagged' (review
    //    admin avant confirm — handleConfirmReferral refuse les flagged).
    const fraud =
      ctx.recentClicks && ctx.recentClicks.length > 0
        ? detectFraudPattern(ctx.recentClicks, 5)
        : { suspicious: false, reasons: [] };

    // 3) Attribution engine standard (status='pending').
    const result = await attributeOrderToAffiliate(env, orderId, code);

    // Si engine a attribué + fraud suspicious, on bascule le referral en
    // 'flagged' (best-effort — si l'UPDATE échoue, on conserve 'pending').
    if (result.matched && result.referral_id && fraud.suspicious) {
      try {
        await env.DB.prepare(
          `UPDATE affiliate_referrals SET status = 'flagged' WHERE id = ?`,
        )
          .bind(result.referral_id)
          .run();
      } catch {
        /* best-effort */
      }
    }

    return json({
      data: {
        ...result,
        status: result.matched
          ? fraud.suspicious
            ? 'flagged'
            : 'pending'
          : null,
        fraud_reasons: fraud.suspicious ? fraud.reasons : undefined,
      },
    });
  } catch {
    return json({ error: 'Erreur attribution order' }, 500);
  }
}

/**
 * Vérifie l'éligibilité au payout d'un referral unique (action admin manuelle
 * vs createPayoutBatch en batch). Cap 'settings.manage'. Refuse 409
 * PAYOUT_INELIGIBLE si engine `isPayoutEligible` rejette (status, age, déjà
 * en payout, etc.).
 */
export async function handlePayoutReferral(
  env: Env,
  auth: AffiliateAuth,
  referralId: string,
): Promise<Response> {
  const cap = settingsManageCapGuard(auth);
  if (cap) return cap;
  const ref = await loadReferralInTenant(env, referralId, auth);
  if (ref instanceof Response) return ref;

  // Engine isPayoutEligible : status confirmed + age >= DEFAULT_PAYOUT_DELAY_DAYS
  // + pas déjà en payout (payout_id IS NULL).
  const eligibility = isPayoutEligible(
    ref as Record<string, unknown> as Parameters<typeof isPayoutEligible>[0],
    DEFAULT_PAYOUT_DELAY_DAYS,
    new Date(),
  );
  if (!eligibility.eligible) {
    return json(
      {
        error: `Referral non éligible au payout: ${eligibility.reason || 'inconnu'}`,
        error_code: AFFILIATE_ERROR_CODES.PAYOUT_INELIGIBLE,
        reason: eligibility.reason,
      },
      409,
    );
  }

  return json({
    data: {
      referral_id: referralId,
      eligible: true,
    },
  });
}

/**
 * Alias câblage POST /api/affiliate-programs (création). En V1 le programme
 * est singleton par tenant (UPSERT via handleUpdateAffiliateProgram) — on
 * réutilise donc le même handler. La validation engine
 * `validateCommissionConfig` y est déjà câblée.
 */
export async function handleCreateAffiliateProgram(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
): Promise<Response> {
  return handleUpdateAffiliateProgram(request, env, auth);
}

/**
 * Alias câblage PATCH /api/affiliates/:id/config (mise à jour de la
 * configuration commission/tier d'un affilié). En V1 réutilise
 * handleUpdateAffiliateS49 (cap clients.manage, validation tier + pct ∈
 * [0..1] déjà appliquée). Sprint 49 Bis : pour homogénéiser le mapping
 * vers les error codes engine, on rejoue validateCommissionConfig sur le
 * body si commission_pct est fourni.
 */
export async function handleUpdateAffiliateConfig(
  request: Request,
  env: Env,
  auth: AffiliateAuth,
  affiliateId: string,
): Promise<Response> {
  const cap = clientsManageCapGuard(auth);
  if (cap) return cap;

  // Pré-validation engine sur le body (peek sans consommer le stream — on
  // clone la Request). Si commission_pct invalide, refuse 400 INVALID_CONFIG
  // avant délégation handleUpdateAffiliateS49.
  let bodyPreview: Record<string, unknown> = {};
  try {
    // Cast Request (CF host metadata) vers Request standard pour signature
    // readJsonBodyS49. Le clone() préserve le body stream (read-once safe).
    const cloned = request.clone() as unknown as Request;
    bodyPreview = await readJsonBodyS49(cloned);
  } catch {
    /* best-effort */
  }
  if (bodyPreview.commission_pct !== undefined) {
    const pct = Number(bodyPreview.commission_pct);
    const rule: CommissionRule = { kind: 'pct', pct };
    const v = validateCommissionConfig(rule);
    if (!v.ok) {
      return json(
        {
          error: `Configuration commission invalide: ${v.error || 'inconnu'}`,
          error_code: 'INVALID_CONFIG',
        },
        400,
      );
    }
  }

  return handleUpdateAffiliateS49(request, env, auth, affiliateId);
}

/**
 * Résout le tier dynamique d'un affilié selon son volume lifetime (cents) +
 * calcule la commission via `computeCommission` (rule fournie).
 *
 * Helper utilitaire — appelé par les webhooks order completed (ecommerce-
 * checkout.ts Phase B) AVANT INSERT referral, pour stocker la commission
 * snapshot du tier RÉSOLU au moment de l'order (pas du tier au moment du
 * payout).
 */
export function resolveCommissionForOrder(
  orderTotalCents: number,
  affiliateLifetimeVolumeCents: number,
  tierThresholds: TierThreshold[],
  rule: CommissionRule,
): { tier: string; commissionCents: number } {
  const tier = getTierForVolume(affiliateLifetimeVolumeCents, tierThresholds);
  const commissionCents = computeCommission(orderTotalCents, rule, tier);
  return { tier, commissionCents };
}

// NB : 11 handlers AUTHED Sprint 49 (handleGetAffiliateMetrics,
// handleCreateAffiliateAdmin, handleUpdateAffiliateS49, handleListReferrals,
// handleConfirmReferral, handleReverseReferral, handleListPayouts,
// handleCreatePayoutBatch, handleMarkPayoutPaid) + 2 PUBLIC
// (handlePublicAffiliateSignup, handlePublicTrackClick) + 1 hook
// (onOrderCompletedAttribution). Imports RELATIFS uniquement. Caps FIGÉES
// (clients.manage + settings.manage + PUBLIC). AUCUN ajout ALL_CAPABILITIES.
// Choix figés docs/LOT-AFFILIATES-S49.md §6.
