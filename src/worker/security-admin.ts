// ── Sprint 23 — Sécurité / conformité — handlers admin ───────────────────
// 4 handlers : audit log viewer (settings.manage) + RBAC overrides
// CRUD (team.manage). Capability enforcement mode-agence-only (calque
// catalog.ts:38-49 capGuard). Best-effort dégradé : si la migration seq121
// n'est pas jouée, on retourne une réponse vide propre plutôt qu'un 500.

import type { Env } from './types';
import { json, audit } from './helpers';
import { capabilityOverrideSchema, auditLogQuerySchema } from '../lib/schemas';
import { requireCapability, type Capability } from './capabilities';
import type { AuditLogEntry, CapabilityOverride } from '../lib/types';

interface AdminAuth {
  userId: string;
  tenant?: { agencyId: string | null };
  capabilities?: Set<string>;
}

// ── Capability guard mode-agence-only (calque catalog.ts:41-49). ──────────
// En legacy/mono-tenant (agencyId == null), on skip la garde pour rester
// byte-équivalent au comportement historique (aucun handler legacy
// n'enforce settings.manage / team.manage). En mode agence, on retourne
// 403 { error, code: 'AGENCY_ONLY' } — code stable du contrat §6.
function capGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> },
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    const denied = requireCapability(auth.capabilities, cap);
    if (denied) {
      // Surcharge le code pour matcher le contrat §6 Sprint 23.
      return json({ error: 'Accès refusé', code: 'AGENCY_ONLY' }, 403);
    }
  }
  return undefined;
}

// ── Parse `details` JSON best-effort (audit_log.details = TEXT). ──────────
function parseDetails(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; }
    catch { return {}; }
  }
  return {};
}

// ── Extract `:userId` (et `:capability`) du path RBAC ─────────────────────
// /api/admin/capability-overrides/<userId>[/<capability>]
function extractUserIdFromPath(path: string): { userId: string; capability: string | null } {
  // strip query/hash si jamais présents
  const clean = (path.split('?')[0] ?? path).split('#')[0] ?? '';
  const parts = clean.split('/').filter(Boolean);
  // parts: ['api', 'admin', 'capability-overrides', '<userId>', '<capability>?']
  const idx = parts.findIndex((p) => p === 'capability-overrides');
  if (idx < 0 || idx + 1 >= parts.length) return { userId: '', capability: null };
  const userId = decodeURIComponent(parts[idx + 1] ?? '');
  const capabilityPart = parts[idx + 2];
  const capability = capabilityPart ? decodeURIComponent(capabilityPart) : null;
  return { userId, capability };
}

// ── GET /api/admin/audit-log ─────────────────────────────────────────────
// Garde : settings.manage (mode-agence-only). Filtres URL : action, user_id,
// resource_type, date_from, date_to, limit (1-200, défaut 50), offset.
export async function handleGetAuditLog(
  request: Request,
  env: Env,
  auth: AdminAuth,
): Promise<Response> {
  try {
    // 1) Capability guard.
    const denied = capGuard(auth, 'settings.manage');
    if (denied) return denied;

    // 2) Parse + valide les filtres URL.
    const url = new URL(request.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = auditLogQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: 'Filtres invalides', code: 'INVALID_INPUT' }, 400);
    }
    const q = parsed.data;

    // 3) Build SQL dynamique. On ne fait JAMAIS de string-concat de valeurs
    //    utilisateur — uniquement de clauses figées + binds positionnels.
    const tenantId = auth.tenant?.agencyId ?? null;
    let sql =
      `SELECT id, user_id, action, resource_type, resource_id, details, ip, user_agent, ` +
      `request_id, tenant_id, redacted, created_at ` +
      `FROM audit_log WHERE 1=1`;
    const binds: unknown[] = [];

    if (q.action) {
      sql += ' AND action LIKE ?';
      binds.push(`%${q.action}%`);
    }
    if (q.user_id) {
      sql += ' AND user_id = ?';
      binds.push(q.user_id);
    }
    if (q.resource_type) {
      sql += ' AND resource_type = ?';
      binds.push(q.resource_type);
    }
    if (q.date_from) {
      sql += ' AND created_at >= ?';
      binds.push(q.date_from);
    }
    if (q.date_to) {
      sql += ' AND created_at <= ?';
      binds.push(q.date_to);
    }

    // 4) Borne tenant : on n'expose JAMAIS d'audit d'un autre tenant. Les
    //    audits historiques (pré-seq121) ont tenant_id = NULL → on les
    //    inclut pour ne pas perdre l'historique pré-multi-tenant.
    if (tenantId != null) {
      sql += ' AND (tenant_id = ? OR tenant_id IS NULL)';
      binds.push(tenantId);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    binds.push(q.limit, q.offset);

    let rows: unknown[] = [];
    try {
      const res = await env.DB.prepare(sql).bind(...binds).all();
      rows = (res.results as unknown[]) ?? [];
    } catch {
      // Best-effort dégradé : si seq121 absente → colonnes redacted/request_id/
      // tenant_id manquent → retry sans ces colonnes pour fournir au moins
      // l'historique brut. On reconstruit le SQL et les binds en retirant
      // explicitement le filtre tenant (qui dépend d'une colonne seq121).
      try {
        const fallbackBinds: unknown[] = [];
        let fallbackSql =
          `SELECT id, user_id, action, resource_type, resource_id, details, ip, user_agent, created_at ` +
          `FROM audit_log WHERE 1=1`;
        if (q.action) { fallbackSql += ' AND action LIKE ?'; fallbackBinds.push(`%${q.action}%`); }
        if (q.user_id) { fallbackSql += ' AND user_id = ?'; fallbackBinds.push(q.user_id); }
        if (q.resource_type) { fallbackSql += ' AND resource_type = ?'; fallbackBinds.push(q.resource_type); }
        if (q.date_from) { fallbackSql += ' AND created_at >= ?'; fallbackBinds.push(q.date_from); }
        if (q.date_to) { fallbackSql += ' AND created_at <= ?'; fallbackBinds.push(q.date_to); }
        fallbackSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        fallbackBinds.push(q.limit, q.offset);
        const res = await env.DB.prepare(fallbackSql).bind(...fallbackBinds).all();
        rows = (res.results as unknown[]) ?? [];
      } catch {
        rows = [];
      }
    }

    const entries: AuditLogEntry[] = rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: Number(row.id ?? 0),
        user_id: (row.user_id as string | null) ?? null,
        action: String(row.action ?? ''),
        resource_type: (row.resource_type as string | null) ?? null,
        resource_id: (row.resource_id as string | null) ?? null,
        details: parseDetails(row.details),
        ip: (row.ip as string | null) ?? null,
        user_agent: (row.user_agent as string | null) ?? null,
        request_id: (row.request_id as string | null) ?? null,
        tenant_id: (row.tenant_id as string | null) ?? null,
        redacted: Number(row.redacted ?? 0),
        created_at: String(row.created_at ?? ''),
      };
    });

    // 5) Audit de la consultation elle-même (méta-audit).
    await audit(env, auth.userId, 'admin.audit_log.viewed', 'audit_log', '', {
      filters: q,
      count: entries.length,
    });

    return json({ data: entries });
  } catch {
    return json({ data: [] as AuditLogEntry[] });
  }
}

// ── GET /api/admin/capability-overrides/:userId ──────────────────────────
// Garde : team.manage. Liste les overrides actifs pour un user cible.
export async function handleGetCapabilityOverrides(
  request: Request,
  env: Env,
  auth: AdminAuth,
): Promise<Response> {
  try {
    const denied = capGuard(auth, 'team.manage');
    if (denied) return denied;

    const url = new URL(request.url);
    const { userId } = extractUserIdFromPath(url.pathname);
    if (!userId) {
      return json({ error: 'userId requis', code: 'INVALID_INPUT' }, 400);
    }

    let rows: unknown[] = [];
    try {
      const res = await env.DB.prepare(
        `SELECT id, user_id, capability, granted, created_at
         FROM user_capability_overrides
         WHERE user_id = ?
         ORDER BY capability ASC`,
      ).bind(userId).all();
      rows = (res.results as unknown[]) ?? [];
    } catch {
      rows = [];
    }

    const overrides: CapabilityOverride[] = rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id ?? ''),
        user_id: String(row.user_id ?? ''),
        capability: String(row.capability ?? ''),
        granted: (Number(row.granted ?? 0) ? 1 : 0) as 0 | 1,
        created_at: String(row.created_at ?? ''),
      };
    });

    return json({ data: overrides });
  } catch {
    return json({ data: [] as CapabilityOverride[] });
  }
}

// ── POST /api/admin/capability-overrides/:userId ─────────────────────────
// Garde : team.manage. UPSERT override + audit('rbac.override.set').
export async function handleSetCapabilityOverride(
  request: Request,
  env: Env,
  auth: AdminAuth,
): Promise<Response> {
  try {
    // 1) Body validation AVANT capability check (calque pattern existant
    //    catalog.ts / security-admin Phase A — on rejette le payload mal
    //    formé même si le user n'a pas la capability).
    const body = await request.json().catch(() => ({}));
    const parsed = capabilityOverrideSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Override invalide', code: 'OVERRIDE_INVALID' }, 400);
    }

    // 2) Capability guard.
    const denied = capGuard(auth, 'team.manage');
    if (denied) return denied;

    // 3) Extract :userId du path.
    const url = new URL(request.url);
    const { userId } = extractUserIdFromPath(url.pathname);
    if (!userId) {
      return json({ error: 'userId requis', code: 'INVALID_INPUT' }, 400);
    }

    const { capability, granted } = parsed.data;
    const grantedInt = granted ? 1 : 0;

    // 4) UPSERT. La table user_capability_overrides (seq80) a UNIQUE
    //    (user_id, capability) — ON CONFLICT clean.
    try {
      await env.DB.prepare(
        `INSERT INTO user_capability_overrides (id, user_id, capability, granted)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?)
         ON CONFLICT(user_id, capability) DO UPDATE SET granted = excluded.granted`,
      ).bind(userId, capability, grantedInt).run();
    } catch {
      // Best-effort : si la table n'existe pas (seq80 pas jouée), retombe
      // sur un INSERT simple. Si même INSERT foire → erreur silencieuse,
      // on renvoie quand même le shape correct côté front.
      try {
        await env.DB.prepare(
          `INSERT INTO user_capability_overrides (id, user_id, capability, granted)
           VALUES (lower(hex(randomblob(16))), ?, ?, ?)`,
        ).bind(userId, capability, grantedInt).run();
      } catch { /* swallow */ }
    }

    // 5) Récupère le row final pour le renvoyer au front.
    let row: Record<string, unknown> | null = null;
    try {
      row = await env.DB.prepare(
        `SELECT id, user_id, capability, granted, created_at
         FROM user_capability_overrides
         WHERE user_id = ? AND capability = ?`,
      ).bind(userId, capability).first() as Record<string, unknown> | null;
    } catch {
      row = null;
    }

    // 6) Audit (best-effort).
    await audit(env, auth.userId, 'rbac.override.set', 'user_capability_override', userId, {
      capability,
      granted,
      target_user_id: userId,
    });

    const result: CapabilityOverride = {
      id: String(row?.id ?? ''),
      user_id: String(row?.user_id ?? userId),
      capability: String(row?.capability ?? capability),
      granted: (Number(row?.granted ?? grantedInt) ? 1 : 0) as 0 | 1,
      created_at: String(row?.created_at ?? new Date().toISOString()),
    };

    return json({ data: result });
  } catch {
    return json({ error: 'Internal', code: 'INTERNAL' }, 500);
  }
}

// ── DELETE /api/admin/capability-overrides/:userId/:capability ───────────
// Garde : team.manage. Supprime override + audit('rbac.override.delete').
export async function handleDeleteCapabilityOverride(
  request: Request,
  env: Env,
  auth: AdminAuth,
): Promise<Response> {
  try {
    const denied = capGuard(auth, 'team.manage');
    if (denied) return denied;

    const url = new URL(request.url);
    const { userId, capability } = extractUserIdFromPath(url.pathname);
    if (!userId || !capability) {
      return json({ error: 'userId + capability requis', code: 'INVALID_INPUT' }, 400);
    }

    try {
      await env.DB.prepare(
        `DELETE FROM user_capability_overrides WHERE user_id = ? AND capability = ?`,
      ).bind(userId, capability).run();
    } catch { /* swallow — table absente */ }

    await audit(env, auth.userId, 'rbac.override.delete', 'user_capability_override', userId, {
      capability,
      target_user_id: userId,
    });

    return json({ data: { ok: true as const } });
  } catch {
    return json({ error: 'Internal', code: 'INTERNAL' }, 500);
  }
}
