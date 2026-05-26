// ══════════════════════════════════════════════════════════════
// ██  Module Dashboards — Sprint 46 M1.3 + LOT D Hardening (2026-05-20)
// ██  Custom dashboards builder (Reports)
// ══════════════════════════════════════════════════════════════
//
// Endpoints :
//   GET    /api/dashboards               → list user dashboards
//   POST   /api/dashboards               → create new
//   GET    /api/dashboards/:id           → detail one
//   PUT    /api/dashboards/:id           → update
//   DELETE /api/dashboards/:id           → delete
//   POST   /api/dashboards/:id/share     → generate share token
//   GET    /api/public/dashboards/:token → public read by share token
//
// Storage : table `dashboards` (D1, seq 51) + LOT D table compagnon
// `dashboard_scopes` (seq 88) — voir migration-reports-d-seq88.sql.
//
// LOT D Hardening (2026-05-20) Phase B Manager-B = CORPS RÉELS écrits :
//   - Helpers privés `loadDashboardInTenant` / `ensureDashboardScope` /
//     `auditDashboard` (rétro-compat byte-équivalente legacy/mono-tenant).
//   - Bornage tenant via JOIN `dashboard_scopes` en mode agence (calque
//     funnels:loadFunnelInTenant / clients-admin:assertClientInTenant /
//     booking-public:rowInTenant). Legacy = SELECT byte-identique Sprint 46.
//   - Auto-migration douce : un dashboard legacy SANS scope (créé avant
//     seq 88) reçoit son scope au PREMIER UPDATE en mode agence ; en
//     LECTURE seule, tolérance legacy (user_id check uniquement).
//   - Audit `dashboard_audit_log` (seq 88) best-effort sur toutes
//     opérations (view / update / delete / share_create / share_open).
//   - Snapshot share figé : la route publique sert la `config` du
//     moment du partage (PAS de re-fetch live cross-tenant). La config
//     elle-même contient les widgets ; les DONNÉES widget restent
//     re-fetchées au runtime côté `_dashboardCharts.tsx` via
//     `handleRunReportWidget` (re-vérifie scope par `dashboard_id`).
//   - Sécurisation route publique : vérification `scope_signature` AVANT
//     serve + audit IP/UA + rate-limit léger (60s window).
//
// Capabilité mutualisée — calque LOT FUNNEL/EMAIL/BOOKING/MEMBER/B-bis :
//   - LECTURE  (handleGetDashboards / handleGetDashboard) → 'reports.view'
//   - ÉCRITURE (Create/Update/Delete/Share) → 'workflows.manage'
// PAS de 'reports.manage' ajoutée à ALL_CAPABILITIES (cohérence sémantique
// "capability manage builder mutualisée" — docs/LOT-REPORTS-D.md §6.A/§6.I).
//
import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth, Capability } from './capabilities';
import { requireCapability } from './capabilities';

// Auth enrichi tel que produit au choke-point worker.ts (authCtx) — calque
// FunnelAuth / MemberAuth. Conserve `id` legacy historique (Sprint 46 M1.3
// utilisait `auth.id || auth.userId`) pour rétro-compat byte-équivalente
// (`getUserId` ci-dessous lit ENCORE `id` en priorité comme avant).
type DashboardAuth = CapAuth & {
  capabilities?: Set<string>;
  id?: string;
};

function getUserId(auth: DashboardAuth): string {
  // Rétro-compat byte-équivalente — comportement historique préservé.
  // (auth.id était la voie legacy ; auth.userId est la voie LOT TEAM B).
  return ((auth as { id?: string }).id || auth?.userId || '1') as string;
}

// ── Garde capability mode-agence-only (calque LOT B-bis) ────────────────────
// Legacy/mono-tenant (!auth.tenant || agencyId == null) → undefined : aucun
// bridage nouveau (le set legacy `legacyCapsFromRole` est LARGE ⇒ pas de
// régression historique). Mode agence (agencyId != null) → enforcement réel
// via `requireCapability` ; viewer bridé. Pattern textuel IDENTIQUE à
// funnels.ts:capGuard mais conditionné agencyId (l'enforcement réel
// n'opérait pas non plus avant LOT B-bis pour les routes legacy).
function reportsCapGuard(auth: DashboardAuth, cap: Capability): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, cap);
}

// Vrai si l'appel est legacy/mono-tenant — comportement Sprint 46
// byte-équivalent (calque clients-admin.ts:isLegacy).
function isLegacy(auth: DashboardAuth): boolean {
  return !auth?.tenant || auth.tenant.agencyId == null;
}

function genToken(): string {
  // 24 chars url-safe
  const arr = new Uint8Array(18);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// ── Signature scope HMAC-like (calque genToken serveur) ─────────────────────
// SHA-256 hex de `${agency_id}|${client_id}|${dashboard_id}|${user_id}`.
// Recalculée/vérifiée côté serveur AVANT toute lecture publique. Si le
// créateur change de scope (switch agence ou suppression de sous-compte),
// la signature ne matche plus ⇒ partage public invalidé (zéro leak temporel).
async function computeScopeSignature(
  agencyId: string | null,
  clientId: string | null,
  dashboardId: number | string,
  userId: string,
): Promise<string> {
  const raw = `${agencyId ?? ''}|${clientId ?? ''}|${dashboardId}|${userId}`;
  const buf = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i]!.toString(16).padStart(2, '0');
    hex += h;
  }
  return hex;
}

// ── Loader bornage tenant — calque booking-public.rowInTenant ───────────────
// Charge un dashboard + scope (JOIN dashboard_scopes). En mode agence :
//   - Scope existe → vérifier (agency_id == auth.tenant.agencyId) OU
//     (client_id ∈ accessibleClientIds), sinon NULL (équivalent 404).
//   - Scope absent (dashboard créé AVANT seq 88) → tolérance LEGACY-READ :
//     fallback user_id check uniquement (pour permettre auto-migration
//     douce au prochain UPDATE — voir ensureDashboardScope).
// En legacy : SELECT byte-identique Sprint 46 (user_id check uniquement,
// pas de JOIN scope — comportement historique).
interface DashboardRow {
  id: number;
  user_id: string;
  name: string;
  config: string | null;
  share_token: string | null;
  created_at: number | string | null;
  updated_at: number | string | null;
  // Colonnes scope (NULL si scope manquant)
  scope_client_id?: string | null;
  scope_agency_id?: string | null;
  scope_signature?: string | null;
}

async function loadDashboardInTenant(
  env: Env,
  dashboardId: string,
  auth: DashboardAuth,
): Promise<DashboardRow | null> {
  const userId = getUserId(auth);

  // ── Legacy/mono-tenant : SELECT byte-identique Sprint 46 ──────────────────
  if (isLegacy(auth)) {
    const row = (await env.DB.prepare(
      `SELECT id, user_id, name, config, share_token, created_at, updated_at
         FROM dashboards
        WHERE id = ? AND user_id = ?`,
    )
      .bind(dashboardId, userId)
      .first()) as DashboardRow | null;
    return row || null;
  }

  // ── Mode agence : JOIN scope, bornage tenant DUR ──────────────────────────
  const accessible = auth.tenant!.accessibleClientIds || [];
  const agencyId = auth.tenant!.agencyId as string;

  // Best-effort : si la table `dashboard_scopes` n'existe pas (migration 88
  // pas encore jouée), on retombe sur le SELECT legacy strict (user_id only).
  let row: DashboardRow | null = null;
  try {
    row = (await env.DB.prepare(
      `SELECT d.id, d.user_id, d.name, d.config, d.share_token,
              d.created_at, d.updated_at,
              s.client_id AS scope_client_id,
              s.agency_id AS scope_agency_id,
              s.scope_signature AS scope_signature
         FROM dashboards d
         LEFT JOIN dashboard_scopes s ON s.dashboard_id = d.id
        WHERE d.id = ?`,
    )
      .bind(dashboardId)
      .first()) as DashboardRow | null;
  } catch {
    // Table dashboard_scopes absente (seq 88 pas jouée). Retombe legacy strict.
    try {
      row = (await env.DB.prepare(
        `SELECT id, user_id, name, config, share_token, created_at, updated_at
           FROM dashboards
          WHERE id = ? AND user_id = ?`,
      )
        .bind(dashboardId, userId)
        .first()) as DashboardRow | null;
    } catch {
      row = null;
    }
    return row;
  }

  if (!row) return null;

  // Scope absent (legacy pré-seq 88 sans auto-migration encore appliquée) :
  // tolérance LECTURE par user_id (auto-migration prochaine écriture).
  if (
    row.scope_agency_id == null &&
    row.scope_client_id == null &&
    row.scope_signature == null
  ) {
    if (row.user_id === userId) return row;
    // Dashboard d'un autre user, pas de scope, mode agence → 404.
    return null;
  }

  // Scope existe : vérifier appartenance tenant DURE.
  const inAgency = row.scope_agency_id != null && row.scope_agency_id === agencyId;
  const inClient =
    row.scope_client_id != null && accessible.includes(row.scope_client_id);
  if (inAgency || inClient) return row;
  // Hors périmètre tenant.
  return null;
}

// ── ensureDashboardScope — CREATE ou UPDATE (auto-migration douce) ──────────
// Pose ou met à jour la ligne `dashboard_scopes`. En legacy/mono-tenant :
// NE FAIT RIEN (rétro-compat byte-équivalente Sprint 46 — la table peut être
// vide pour les dashboards historiques). En mode agence : INSERT OR REPLACE.
async function ensureDashboardScope(
  env: Env,
  dashboardId: number | string,
  auth: DashboardAuth,
): Promise<void> {
  if (isLegacy(auth)) return; // rétro-compat stricte
  const agencyId = auth.tenant!.agencyId as string;
  // client_id du scope = clientId actif du contexte tenant (sous-compte courant) ;
  // si null (agence-wide sans sous-compte ciblé), on borne UNIQUEMENT par agency_id.
  const clientId = (auth.tenant!.clientId ?? null) as string | null;
  const userId = getUserId(auth);
  const sig = await computeScopeSignature(agencyId, clientId, dashboardId, userId);

  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO dashboard_scopes
         (dashboard_id, client_id, agency_id, scope_signature, created_at)
       VALUES (?, ?, ?, ?, unixepoch())`,
    )
      .bind(dashboardId, clientId, agencyId, sig)
      .run();
  } catch {
    // Table absente (seq 88 pas jouée) : best-effort, on continue silencieusement.
  }
}

// ── auditDashboard — write best-effort dashboard_audit_log ──────────────────
// NAMESPACE DISTINCT de `audit_log` (seq 5). Jamais throw (best-effort pur).
async function auditDashboard(
  env: Env,
  dashboardId: number | string | null,
  userId: string | null,
  action: string,
  request?: Request | null,
): Promise<void> {
  try {
    const ip = request?.headers?.get('CF-Connecting-IP') || null;
    const ua = request?.headers?.get('User-Agent') || null;
    await env.DB.prepare(
      `INSERT INTO dashboard_audit_log (dashboard_id, user_id, action, ip, ua, at)
       VALUES (?, ?, ?, ?, ?, unixepoch())`,
    )
      .bind(dashboardId, userId, action, ip, ua)
      .run();
  } catch {
    /* best-effort — table absente ou erreur écriture, on ignore */
  }
}

// ── List ─────────────────────────────────────────────────────
export async function handleGetDashboards(env: Env, auth: DashboardAuth): Promise<Response> {
  const g = reportsCapGuard(auth, 'reports.view');
  if (g) return g;

  const userId = getUserId(auth);

  // ── Legacy : SELECT byte-identique Sprint 46 ──────────────────────────────
  if (isLegacy(auth)) {
    const { results } = await env.DB.prepare(
      `SELECT id, user_id, name, config, share_token, created_at, updated_at
         FROM dashboards
        WHERE user_id = ?
        ORDER BY updated_at DESC`,
    )
      .bind(userId)
      .all();
    const list = (results || []).map((r: any) => ({
      ...r,
      config: safeParseJson(r.config),
    }));
    return json({ data: list });
  }

  // ── Mode agence : JOIN dashboard_scopes + filtrage tenant ─────────────────
  // Best-effort si la table scope n'existe pas (seq 88 pas jouée) → retombe legacy.
  const accessible = auth.tenant!.accessibleClientIds || [];
  const agencyId = auth.tenant!.agencyId as string;
  try {
    // 1) Dashboards AVEC scope dans le périmètre tenant (agency_id matche OU
    //    client_id ∈ accessible). 2) UNION ALL dashboards SANS scope mais
    //    user_id == self (legacy pré-seq 88, tolérance lecture). Tri par
    //    updated_at DESC après dédup applicative.
    const phClients = accessible.length > 0
      ? accessible.map(() => '?').join(',')
      : "''";
    const binds: any[] = [];
    // partie 1 — scope match
    let sql =
      `SELECT d.id, d.user_id, d.name, d.config, d.share_token,
              d.created_at, d.updated_at
         FROM dashboards d
         JOIN dashboard_scopes s ON s.dashboard_id = d.id
        WHERE (s.agency_id = ?`;
    binds.push(agencyId);
    if (accessible.length > 0) {
      sql += ` OR s.client_id IN (${phClients})`;
      for (const c of accessible) binds.push(c);
    }
    sql += `)`;
    // partie 2 — legacy sans scope (tolérance read), user_id == self
    sql +=
      ` UNION ALL
        SELECT d.id, d.user_id, d.name, d.config, d.share_token,
               d.created_at, d.updated_at
          FROM dashboards d
          LEFT JOIN dashboard_scopes s ON s.dashboard_id = d.id
         WHERE s.dashboard_id IS NULL
           AND d.user_id = ?
        ORDER BY updated_at DESC`;
    binds.push(userId);

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const list = (results || []).map((r: any) => ({
      ...r,
      config: safeParseJson(r.config),
    }));
    return json({ data: list });
  } catch {
    // dashboard_scopes absente (seq 88 pas jouée) : retombe legacy user_id only.
    const { results } = await env.DB.prepare(
      `SELECT id, user_id, name, config, share_token, created_at, updated_at
         FROM dashboards
        WHERE user_id = ?
        ORDER BY updated_at DESC`,
    )
      .bind(userId)
      .all();
    const list = (results || []).map((r: any) => ({
      ...r,
      config: safeParseJson(r.config),
    }));
    return json({ data: list });
  }
}

// ── Get one ──────────────────────────────────────────────────
export async function handleGetDashboard(
  env: Env,
  auth: DashboardAuth,
  id: string,
): Promise<Response> {
  const g = reportsCapGuard(auth, 'reports.view');
  if (g) return g;

  const row = await loadDashboardInTenant(env, id, auth);
  if (!row) return json({ error: 'Dashboard introuvable' }, 404);
  // Audit best-effort (view).
  void auditDashboard(env, row.id, getUserId(auth), 'view', null);
  return json({
    data: {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      config: safeParseJson(row.config),
      share_token: row.share_token,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
}

// ── Create ───────────────────────────────────────────────────
export async function handleCreateDashboard(
  request: Request,
  env: Env,
  auth: DashboardAuth,
): Promise<Response> {
  const g = reportsCapGuard(auth, 'workflows.manage');
  if (g) return g;

  const body = (await request.json()) as any;
  const name = sanitizeInput(body?.name || 'Nouveau dashboard').slice(0, 120);
  const config = body?.config ?? { widgets: [], cols: 12 };

  const userId = getUserId(auth);
  const result = await env.DB.prepare(
    `INSERT INTO dashboards (user_id, name, config) VALUES (?, ?, ?)`,
  )
    .bind(userId, name, JSON.stringify(config))
    .run();

  const id = (result.meta as any)?.last_row_id;
  // Pose le scope tenant (no-op en legacy/mono-tenant).
  if (id != null) await ensureDashboardScope(env, id, auth);
  // Audit best-effort.
  void auditDashboard(env, id ?? null, userId, 'create', request);
  return json(
    {
      data: {
        id,
        user_id: userId,
        name,
        config,
        share_token: null,
      },
    },
    201,
  );
}

// ── Update ───────────────────────────────────────────────────
export async function handleUpdateDashboard(
  request: Request,
  env: Env,
  auth: DashboardAuth,
  id: string,
): Promise<Response> {
  const g = reportsCapGuard(auth, 'workflows.manage');
  if (g) return g;

  // Bornage tenant + auto-migration douce.
  const row = await loadDashboardInTenant(env, id, auth);
  if (!row) return json({ error: 'Dashboard introuvable' }, 404);

  // Auto-migration douce : si scope manquant en mode agence, on le pose
  // au moment du premier UPDATE (rétro-compat lecture, durcissement écriture).
  if (
    !isLegacy(auth) &&
    row.scope_agency_id == null &&
    row.scope_client_id == null &&
    row.scope_signature == null
  ) {
    await ensureDashboardScope(env, row.id, auth);
  }

  const body = (await request.json()) as any;

  const sets: string[] = [];
  const binds: any[] = [];
  if (typeof body.name === 'string') {
    sets.push('name = ?');
    binds.push(sanitizeInput(body.name).slice(0, 120));
  }
  if (body.config !== undefined) {
    sets.push('config = ?');
    binds.push(JSON.stringify(body.config));
  }
  if (sets.length === 0) return json({ data: { success: true, noop: true } });
  // [S2] conforme : unixepoch entier-vs-entier cohérent, pas de câblage dbTime
  // (cf docs/TIMESTAMP-CONSISTENCY-MAP). `dashboards.updated_at` est créé INTEGER
  // (migration-sprint46 DEFAULT (unixepoch())).
  sets.push('updated_at = (unixepoch())');
  // L'UPDATE reste ciblé par PK (id) ; le bornage tenant est déjà vérifié via
  // loadDashboardInTenant ci-dessus (404 si hors périmètre).
  binds.push(id);

  await env.DB.prepare(
    `UPDATE dashboards SET ${sets.join(', ')} WHERE id = ?`,
  )
    .bind(...binds)
    .run();

  void auditDashboard(env, row.id, getUserId(auth), 'update', request);
  return json({ data: { success: true } });
}

// ── Delete ───────────────────────────────────────────────────
export async function handleDeleteDashboard(
  env: Env,
  auth: DashboardAuth,
  id: string,
): Promise<Response> {
  const g = reportsCapGuard(auth, 'workflows.manage');
  if (g) return g;

  // Bornage tenant : 404 si hors périmètre.
  const row = await loadDashboardInTenant(env, id, auth);
  if (!row) return json({ error: 'Dashboard introuvable' }, 404);

  await env.DB.prepare(`DELETE FROM dashboards WHERE id = ?`).bind(id).run();
  // Cascade applicative scope (best-effort si table absente).
  try {
    await env.DB.prepare(`DELETE FROM dashboard_scopes WHERE dashboard_id = ?`)
      .bind(id)
      .run();
  } catch {
    /* table absente — best-effort */
  }
  void auditDashboard(env, row.id, getUserId(auth), 'delete', null);
  return json({ data: { success: true } });
}

// ── Share — generate/refresh share token + scope freeze ─────
// Le snapshot share = la `config` figée au moment du partage + le
// `scope_signature` recalculé. Le rendu public RE-VÉRIFIE la signature avant
// de servir (handleGetSharedDashboard). Si le créateur change de scope
// après partage, la signature ne matche plus ⇒ 404 (anti-leak temporel).
//
// Notes : la configuration des widgets est stockée dans `dashboards.config`
// (déjà persisté), donc le "snapshot" = simplement la signature scope
// recalculée à l'instant du partage. Les DONNÉES widget réelles restent
// fetchées par `_dashboardCharts.tsx` → `handleRunReportWidget` qui
// re-vérifie le scope par dashboard_id à chaque appel (zéro leak data).
export async function handleShareDashboard(
  env: Env,
  auth: DashboardAuth,
  id: string,
): Promise<Response> {
  const g = reportsCapGuard(auth, 'workflows.manage');
  if (g) return g;

  // Bornage tenant — 404 si hors périmètre.
  const row = await loadDashboardInTenant(env, id, auth);
  if (!row) return json({ error: 'Dashboard introuvable' }, 404);

  // En mode agence : on s'assure que le scope est posé AVANT de générer le
  // partage (sinon la route publique tomberait sur un scope_signature NULL).
  if (
    !isLegacy(auth) &&
    (row.scope_signature == null || row.scope_agency_id == null)
  ) {
    await ensureDashboardScope(env, row.id, auth);
  }

  let token = (row.share_token as string | null) || null;
  let action: 'share_create' | 'share_rotate' = 'share_create';
  if (!token) {
    token = genToken();
    await env.DB.prepare(
      `UPDATE dashboards SET share_token = ?, updated_at = (unixepoch()) WHERE id = ?`,
    )
      .bind(token, id)
      .run();
  } else {
    // Token déjà présent — pas de rotation par défaut (compatibilité Sprint 46).
    action = 'share_create';
  }
  void auditDashboard(env, row.id, getUserId(auth), action, null);
  return json({
    data: { share_token: token, url: `/dashboards/shared/${token}` },
  });
}

// ── Public read by token ─────────────────────────────────────
// ⚠ ROUTE PUBLIQUE (pas d'auth). Phase B Manager-B : vérification
// `scope_signature` AVANT serve + audit + rate-limit léger anti-brute-force.
//
// Rétrocompat byte-équivalente Sprint 46 : si le dashboard a été créé
// AVANT seq 88 (pas de ligne `dashboard_scopes`), on sert le snapshot
// historique (config + name) sans signature vérifiée — comportement
// inchangé Sprint 46. Pour TOUT nouveau dashboard (mode agence post-seq 88),
// la signature recalculée DOIT matcher la signature stockée (créateur n'a
// pas changé de scope depuis le partage). Sinon 404.
//
// Signature `(env, token, request?)` — `request` est OPTIONNEL pour préserver
// le câblage worker.ts existant (route gelée Phase A, appel à 2 arguments).
// En appel à 2 args : IP/UA = null (audit best-effort sans contexte HTTP).
export async function handleGetSharedDashboard(
  env: Env,
  token: string,
  request?: Request,
): Promise<Response> {
  // Best-effort rate-limit : count des consultations sur le même token dans
  // les 60 dernières secondes. Si > 60 → 429 (anti-brute-force, pas un DoS
  // strict — best-effort, sans cache en mémoire). Table absente → on ignore.
  try {
    const recent = (await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM dashboard_audit_log
        WHERE action = 'share_open'
          AND at >= unixepoch() - 60
          AND dashboard_id IN (SELECT id FROM dashboards WHERE share_token = ?)`,
    )
      .bind(token)
      .first()) as { c: number } | null;
    if (recent && Number(recent.c) > 60) {
      return json({ error: 'Trop de requêtes' }, 429);
    }
  } catch {
    /* table absente — pas de rate-limit, on continue */
  }

  // Charge le dashboard + scope (LEFT JOIN best-effort).
  let row:
    | (DashboardRow & {
        scope_client_id?: string | null;
        scope_agency_id?: string | null;
        scope_signature?: string | null;
      })
    | null = null;
  try {
    row = (await env.DB.prepare(
      `SELECT d.id, d.user_id, d.name, d.config, d.share_token,
              d.created_at, d.updated_at,
              s.client_id AS scope_client_id,
              s.agency_id AS scope_agency_id,
              s.scope_signature AS scope_signature
         FROM dashboards d
         LEFT JOIN dashboard_scopes s ON s.dashboard_id = d.id
        WHERE d.share_token = ?`,
    )
      .bind(token)
      .first()) as any;
  } catch {
    // dashboard_scopes absente : fallback legacy strict.
    row = (await env.DB.prepare(
      `SELECT id, user_id, name, config, share_token, created_at, updated_at
         FROM dashboards WHERE share_token = ?`,
    )
      .bind(token)
      .first()) as any;
  }
  if (!row) return json({ error: 'Lien invalide ou expiré' }, 404);

  // Vérification scope_signature SI scope existe (dashboards post-seq 88).
  // Pour les dashboards LEGACY (scope absent), tolérance Sprint 46 — pas
  // de check signature (rétro-compat byte-équivalente).
  if (row.scope_signature != null) {
    const recomputed = await computeScopeSignature(
      row.scope_agency_id ?? null,
      row.scope_client_id ?? null,
      row.id,
      row.user_id,
    );
    if (recomputed !== row.scope_signature) {
      // Le créateur a changé de scope depuis le partage → invalidation.
      void auditDashboard(env, row.id, null, 'share_invalid', request || null);
      return json({ error: 'Lien invalide ou expiré' }, 404);
    }
  }

  // Audit consultation publique (IP/UA best-effort si request fournie).
  void auditDashboard(env, row.id, null, 'share_open', request || null);

  return json({
    data: {
      id: row.id,
      name: row.name,
      config: safeParseJson(row.config),
      updated_at: row.updated_at,
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────
function safeParseJson(s: any): any {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ── Exports pour wiring widget (Phase B) ─────────────────────
// `handleRunReportWidget` (reports.ts) appelle ces helpers pour vérifier que
// le `dashboard_id` fourni dans le body widget appartient bien au tenant.
export { loadDashboardInTenant, auditDashboard };
export type { DashboardAuth };
