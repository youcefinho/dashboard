// ── Sprint 36 — chat-widgets.ts — Handlers REST Live chat widget (PHASE B) ──
// 9 handlers : 5 widgets CRUD + 2 sessions (list+detail) + 2 presence agent.
// Routes câblées dans worker.ts dans le bloc protected AUTHED (après snapshots,
// ligne ~2710), ordre anti-shadowing strict.
//
// Contrats GELÉS (docs/LOT-TEAM-BC.md §6.A) :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)   ← JAMAIS de champ `code`
//
// Bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR).
// Garde capability `settings.manage` (FIGÉE seq80) au top de chaque handler.
// resolveClientId() = calque snapshots.ts:33 / catalog.ts:57 (getClientModules).
// lookupAgencyId() = calque snapshots.ts:42.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { getClientModules } from './modules';

type ChatWidgetsAuth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

/** Résout le client_id du tenant courant (calque snapshots.ts:33). */
async function resolveClientId(
  env: Env,
  auth: ChatWidgetsAuth,
): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Lookup agency_id depuis clients (best-effort, calque snapshots.ts:42). */
async function lookupAgencyId(env: Env, clientId: string): Promise<string | null> {
  try {
    const row = (await env.DB.prepare('SELECT agency_id FROM clients WHERE id = ?')
      .bind(clientId)
      .first()) as { agency_id: string | null } | null;
    return row?.agency_id ?? null;
  } catch {
    return null;
  }
}

// Enums validés side-handler (migration seq131 §22-23 — pas de CHECK SQL).
const VALID_POSITIONS = new Set(['bottom-right', 'bottom-left', 'top-right', 'top-left']);
const VALID_PRESENCE_STATUSES = new Set(['online', 'away', 'offline']);
const VALID_SESSION_STATUSES = new Set(['active', 'closed', 'offline_form']);

/** Parse une colonne JSON best-effort (string → array|object|null). */
function safeJsonParse<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Valide `allowed_origins` (doit être un array de strings ou null).
 * Retourne { ok: true, value } ou { ok: false, error }.
 */
function validateAllowedOrigins(
  raw: unknown,
): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'allowed_origins doit être un tableau de chaînes' };
  }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 500) {
      return { ok: false, error: 'allowed_origins contient une entrée invalide' };
    }
    out.push(v.trim());
  }
  return { ok: true, value: out };
}

/**
 * Valide `business_hours_json` (string JSON object ou null).
 * Retourne la string sérialisée à stocker (ou null).
 */
function validateBusinessHours(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'string') {
    if (raw.length === 0) return { ok: true, value: null };
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, error: 'business_hours_json doit être un objet JSON' };
      }
      return { ok: true, value: JSON.stringify(parsed) };
    } catch {
      return { ok: false, error: 'business_hours_json invalide (JSON malformé)' };
    }
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return { ok: true, value: JSON.stringify(raw) };
  }
  return { ok: false, error: 'business_hours_json doit être un objet JSON' };
}

/** Normalise une row widget (parse allowed_origins, business_hours_json). */
function mapWidgetRow(row: Record<string, unknown>): Record<string, unknown> {
  const { allowed_origins, business_hours_json, ...rest } = row;
  return {
    ...rest,
    allowed_origins: safeJsonParse<string[]>(allowed_origins),
    business_hours_json:
      typeof business_hours_json === 'string' && business_hours_json.length > 0
        ? business_hours_json
        : null,
  };
}

// Colonnes SELECT communes pour les widgets (calque énoncé Agent A3 §1).
const WIDGET_SELECT_COLS =
  `id, client_id, agency_id, name, primary_color, welcome_message, offline_message,
   position, allowed_origins, avatar_url, show_powered_by, business_hours_json,
   turnstile_enabled, is_active, created_at, updated_at`;

// ── 5 widgets CRUD ──────────────────────────────────────────────────────────

/** GET /api/chat-widgets — liste des widgets du tenant courant. */
export async function handleListChatWidgets(
  env: Env,
  auth: ChatWidgetsAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const { results } = await env.DB.prepare(
      `SELECT ${WIDGET_SELECT_COLS}
       FROM webchat_widgets
       WHERE client_id = ?
       ORDER BY created_at DESC`,
    )
      .bind(clientId)
      .all();

    const rows = ((results || []) as Array<Record<string, unknown>>).map(mapWidgetRow);
    return json({ data: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/chat-widgets — créer un widget. */
export async function handleCreateChatWidget(
  request: Request,
  env: Env,
  auth: ChatWidgetsAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    // ── validation name (requis non-vide) ─────────────────────────────────
    const name = sanitizeInput(typeof body.name === 'string' ? body.name : '', 200);
    if (!name) {
      return json({ error: 'Le nom du widget est requis' }, 400);
    }

    // ── validation position (enum, défaut bottom-right) ───────────────────
    const positionRaw =
      typeof body.position === 'string' && body.position.length > 0
        ? body.position
        : 'bottom-right';
    if (!VALID_POSITIONS.has(positionRaw)) {
      return json({ error: 'position invalide (valeurs : bottom-right|bottom-left|top-right|top-left)' }, 400);
    }

    // ── validation allowed_origins (array de strings ou null) ─────────────
    const ao = validateAllowedOrigins(body.allowed_origins);
    if (!ao.ok) return json({ error: ao.error }, 400);
    const allowedOriginsSerialized = ao.value === null ? null : JSON.stringify(ao.value);

    // ── validation business_hours_json (objet JSON ou null) ───────────────
    const bh = validateBusinessHours(body.business_hours_json);
    if (!bh.ok) return json({ error: bh.error }, 400);

    // ── champs string optionnels ──────────────────────────────────────────
    const primaryColor =
      typeof body.primary_color === 'string'
        ? sanitizeInput(body.primary_color, 32) || null
        : null;
    const welcomeMessage =
      typeof body.welcome_message === 'string'
        ? sanitizeInput(body.welcome_message, 2000) || null
        : null;
    const offlineMessage =
      typeof body.offline_message === 'string'
        ? sanitizeInput(body.offline_message, 2000) || null
        : null;
    const avatarUrl =
      typeof body.avatar_url === 'string'
        ? sanitizeInput(body.avatar_url, 1000) || null
        : null;

    // ── booléens (0|1) ────────────────────────────────────────────────────
    const showPoweredBy = body.show_powered_by === false || body.show_powered_by === 0 ? 0 : 1;
    const turnstileEnabled =
      body.turnstile_enabled === true || body.turnstile_enabled === 1 ? 1 : 0;

    // ── bornage tenant + lookup agency ────────────────────────────────────
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }
    const agencyId = await lookupAgencyId(env, clientId);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO webchat_widgets (
         id, client_id, agency_id, name, primary_color, welcome_message,
         offline_message, position, allowed_origins, avatar_url, show_powered_by,
         business_hours_json, turnstile_enabled, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        clientId,
        agencyId,
        name,
        primaryColor,
        welcomeMessage,
        offlineMessage,
        positionRaw,
        allowedOriginsSerialized,
        avatarUrl,
        showPoweredBy,
        bh.value,
        turnstileEnabled,
      )
      .run();

    await audit(env, auth.userId, 'chat_widget_created', 'chat_widget', id, {
      name,
      position: positionRaw,
      turnstile_enabled: turnstileEnabled,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        agency_id: agencyId,
        name,
        primary_color: primaryColor,
        welcome_message: welcomeMessage,
        offline_message: offlineMessage,
        position: positionRaw,
        allowed_origins: ao.value,
        avatar_url: avatarUrl,
        show_powered_by: showPoweredBy,
        business_hours_json: bh.value,
        turnstile_enabled: turnstileEnabled,
        is_active: 1,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** GET /api/chat-widgets/:id — détail widget (bornage tenant). */
export async function handleGetChatWidget(
  env: Env,
  auth: ChatWidgetsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const row = (await env.DB.prepare(
      `SELECT ${WIDGET_SELECT_COLS}
       FROM webchat_widgets
       WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .first()) as Record<string, unknown> | null;

    if (!row) {
      return json({ error: 'Widget introuvable' }, 404);
    }

    return json({ data: mapWidgetRow(row) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** PATCH /api/chat-widgets/:id — update widget (allowlist origins, theme, etc.). */
export async function handleUpdateChatWidget(
  request: Request,
  env: Env,
  auth: ChatWidgetsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Construit l'UPDATE conditionnel sur les champs présents dans body.
    const sets: string[] = [];
    const bindings: unknown[] = [];
    const echo: Record<string, unknown> = {};

    if (typeof body.name === 'string') {
      const v = sanitizeInput(body.name, 200);
      if (!v) return json({ error: 'Le nom du widget ne peut pas être vide' }, 400);
      sets.push('name = ?');
      bindings.push(v);
      echo.name = v;
    }

    if (body.position !== undefined) {
      if (typeof body.position !== 'string' || !VALID_POSITIONS.has(body.position)) {
        return json({ error: 'position invalide (valeurs : bottom-right|bottom-left|top-right|top-left)' }, 400);
      }
      sets.push('position = ?');
      bindings.push(body.position);
      echo.position = body.position;
    }

    if (body.allowed_origins !== undefined) {
      const ao = validateAllowedOrigins(body.allowed_origins);
      if (!ao.ok) return json({ error: ao.error }, 400);
      const serialized = ao.value === null ? null : JSON.stringify(ao.value);
      sets.push('allowed_origins = ?');
      bindings.push(serialized);
      echo.allowed_origins = ao.value;
    }

    if (body.business_hours_json !== undefined) {
      const bh = validateBusinessHours(body.business_hours_json);
      if (!bh.ok) return json({ error: bh.error }, 400);
      sets.push('business_hours_json = ?');
      bindings.push(bh.value);
      echo.business_hours_json = bh.value;
    }

    if (typeof body.primary_color === 'string') {
      const v = sanitizeInput(body.primary_color, 32) || null;
      sets.push('primary_color = ?');
      bindings.push(v);
      echo.primary_color = v;
    }

    if (typeof body.welcome_message === 'string') {
      const v = sanitizeInput(body.welcome_message, 2000) || null;
      sets.push('welcome_message = ?');
      bindings.push(v);
      echo.welcome_message = v;
    }

    if (typeof body.offline_message === 'string') {
      const v = sanitizeInput(body.offline_message, 2000) || null;
      sets.push('offline_message = ?');
      bindings.push(v);
      echo.offline_message = v;
    }

    if (typeof body.avatar_url === 'string') {
      const v = sanitizeInput(body.avatar_url, 1000) || null;
      sets.push('avatar_url = ?');
      bindings.push(v);
      echo.avatar_url = v;
    }

    if (body.show_powered_by !== undefined) {
      const v = body.show_powered_by === false || body.show_powered_by === 0 ? 0 : 1;
      sets.push('show_powered_by = ?');
      bindings.push(v);
      echo.show_powered_by = v;
    }

    if (body.turnstile_enabled !== undefined) {
      const v = body.turnstile_enabled === true || body.turnstile_enabled === 1 ? 1 : 0;
      sets.push('turnstile_enabled = ?');
      bindings.push(v);
      echo.turnstile_enabled = v;
    }

    if (body.is_active !== undefined) {
      const v = body.is_active === false || body.is_active === 0 ? 0 : 1;
      sets.push('is_active = ?');
      bindings.push(v);
      echo.is_active = v;
    }

    if (sets.length === 0) {
      return json({ error: 'Aucun champ à mettre à jour' }, 400);
    }

    sets.push("updated_at = datetime('now')");
    bindings.push(id, clientId);

    const res = await env.DB.prepare(
      `UPDATE webchat_widgets SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
    )
      .bind(...bindings)
      .run();

    const changes = (res?.meta?.changes ?? 0) as number;
    if (changes === 0) {
      return json({ error: 'Widget introuvable' }, 404);
    }

    await audit(env, auth.userId, 'chat_widget_updated', 'chat_widget', id, echo);

    return json({ data: { id, ...echo } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** DELETE /api/chat-widgets/:id — soft-disable (is_active=0). */
export async function handleDeleteChatWidget(
  env: Env,
  auth: ChatWidgetsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const res = await env.DB.prepare(
      `UPDATE webchat_widgets
         SET is_active = 0, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .run();

    const changes = (res?.meta?.changes ?? 0) as number;
    if (changes === 0) {
      return json({ error: 'Widget introuvable' }, 404);
    }

    await audit(env, auth.userId, 'chat_widget_disabled', 'chat_widget', id, {});

    return json({ data: { id, deleted: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 2 sessions (list + detail) ──────────────────────────────────────────────

/** GET /api/chat-widgets/:widgetId/sessions — historique des sessions visiteurs. */
export async function handleListChatSessions(
  env: Env,
  auth: ChatWidgetsAuth,
  widgetId: string,
  url: URL,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Bornage tenant : le widget DOIT appartenir au client courant.
    const widget = (await env.DB.prepare(
      'SELECT 1 AS ok FROM webchat_widgets WHERE id = ? AND client_id = ?',
    )
      .bind(widgetId, clientId)
      .first()) as { ok: number } | null;
    if (!widget) {
      return json({ error: 'Widget introuvable' }, 404);
    }

    // Filtres : status, limit (max 100, défaut 50), offset (défaut 0).
    const statusFilter = sanitizeInput(url.searchParams.get('status') || '', 40);
    const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
    const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    let query =
      `SELECT id, widget_id, conversation_id, visitor_name, visitor_email, page_url,
              started_at, ended_at, status, unread_agent_count, agent_user_id
       FROM webchat_sessions
       WHERE widget_id = ?`;
    const bindings: unknown[] = [widgetId];
    if (statusFilter) {
      if (!VALID_SESSION_STATUSES.has(statusFilter)) {
        return json({ error: 'status invalide (valeurs : active|closed|offline_form)' }, 400);
      }
      query += ' AND status = ?';
      bindings.push(statusFilter);
    }
    query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    bindings.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...bindings).all();
    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** GET /api/chat-widgets/:widgetId/sessions/:sessionId — détail session + messages. */
export async function handleGetChatSessionDetail(
  env: Env,
  auth: ChatWidgetsAuth,
  widgetId: string,
  sessionId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Bornage tenant + cohérence widget/session.
    const widget = (await env.DB.prepare(
      'SELECT 1 AS ok FROM webchat_widgets WHERE id = ? AND client_id = ?',
    )
      .bind(widgetId, clientId)
      .first()) as { ok: number } | null;
    if (!widget) {
      return json({ error: 'Widget introuvable' }, 404);
    }

    const session = (await env.DB.prepare(
      `SELECT id, widget_id, conversation_id, visitor_name, visitor_email, page_url,
              referrer, user_agent, ip_hash, started_at, ended_at, last_seen_at,
              status, unread_agent_count, agent_user_id
       FROM webchat_sessions
       WHERE id = ? AND widget_id = ?`,
    )
      .bind(sessionId, widgetId)
      .first()) as Record<string, unknown> | null;
    if (!session) {
      return json({ error: 'Session introuvable' }, 404);
    }

    // Transcript : messages liés via conversation_id (table `messages` seq25 +
    // colonne conversation_id ajoutée Phase 2). Si conversation_id absent (legacy
    // session pré-seq131) → liste vide.
    let messages: Array<Record<string, unknown>> = [];
    const convId = (session as { conversation_id: string | null }).conversation_id;
    if (convId) {
      try {
        const { results } = await env.DB.prepare(
          `SELECT id, direction, body, sent_by, created_at
           FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at ASC
           LIMIT 500`,
        )
          .bind(convId)
          .all();
        messages = (results || []) as Array<Record<string, unknown>>;
      } catch {
        // Si la colonne conversation_id n'existe pas (DB hors-séquence) → []
        // sans casser le détail session (best-effort).
        messages = [];
      }
    }

    return json({ data: { session, messages } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 2 presence agent (heartbeat + active) ───────────────────────────────────

/** POST /api/chat-presence/heartbeat — agent envoie son statut (online|away|offline). */
export async function handleChatPresenceHeartbeat(
  request: Request,
  env: Env,
  auth: ChatWidgetsAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const status =
      typeof body.status === 'string' && VALID_PRESENCE_STATUSES.has(body.status)
        ? body.status
        : null;
    if (!status) {
      return json({ error: 'status invalide (valeurs : online|away|offline)' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Upsert via UNIQUE INDEX idx_webchat_presence_user_client (seq131:60).
    await env.DB.prepare(
      `INSERT OR REPLACE INTO webchat_agent_presence
         (user_id, client_id, status, last_heartbeat_at)
       VALUES (?, ?, ?, datetime('now'))`,
    )
      .bind(auth.userId, clientId, status)
      .run();

    return json({ data: { ok: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** GET /api/chat-presence/active — liste des agents actifs du tenant (online récent). */
export async function handleGetActivePresence(
  env: Env,
  auth: ChatWidgetsAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const { results } = await env.DB.prepare(
      `SELECT user_id, status, last_heartbeat_at
       FROM webchat_agent_presence
       WHERE client_id = ?
         AND status = 'online'
         AND last_heartbeat_at > datetime('now', '-5 minutes')
       ORDER BY last_heartbeat_at DESC`,
    )
      .bind(clientId)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
