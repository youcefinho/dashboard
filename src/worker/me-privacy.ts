// ── Sprint 23 — Sécurité / conformité — handlers Loi 25 "Mes données" ───
// 4 handlers : export complet JSON, lookup deletion request en cours,
// demande de suppression (soft 30j), annulation. Codes erreur :
// DELETION_ALREADY_REQUESTED (409), DELETION_NOT_FOUND (404),
// RATE_LIMITED (429), INVALID_INPUT (400).

import type { Env } from './types';
import { json, audit, getRequestContext } from './helpers';
import { accountDeletionRequestSchema } from '../lib/schemas';
import { checkRateLimit } from './lib/rate-limit';
import type { MyDataExport, AccountDeletionRequest } from '../lib/types';

interface MeAuth {
  userId: string;
  // Sprint 32 — clientId (tenant) résolu best-effort pour cascade GBP /
  // export GBP. Aligné sur tenantOf() dans oauth.ts (auth.tenant.clientId
  // prioritaire, fallback auth.clientId direct). Optionnel : si absent,
  // les blocs GBP s'auto-skippent (cascade no-op, export tableaux vides).
  clientId?: string | null;
  tenant?: { agencyId?: string | null; clientId?: string | null };
}

// ── helper SELECT best-effort : retourne [] si la table n'existe pas ─────
async function safeAll(env: Env, sql: string, ...binds: unknown[]): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return (res.results as Array<Record<string, unknown>>) ?? [];
  } catch {
    return [];
  }
}
async function safeFirst<T extends Record<string, unknown>>(env: Env, sql: string, ...binds: unknown[]): Promise<T | null> {
  try {
    const row = await env.DB.prepare(sql).bind(...binds).first();
    return (row as T | null) ?? null;
  } catch {
    return null;
  }
}

// ── GET /api/me/export-data ──────────────────────────────────────────────
// Loi 25 art. 27 — droit d'accès. Rate-limit 5/heure/user.
export async function handleGetMyDataExport(
  env: Env,
  auth: MeAuth,
): Promise<Response> {
  try {
    // 1) Rate-limit 5 / heure / user.
    const rl = await checkRateLimit(env, `export-data:user:${auth.userId}`, 5, 3600);
    if (!rl.allowed) {
      return json(
        { error: 'Trop d\'exports — réessayez plus tard', code: 'RATE_LIMITED' },
        429,
      );
    }

    // 2) Profil user (JAMAIS de password_hash — Loi 25 art. 27 + sécurité).
    const user = await safeFirst<Record<string, unknown>>(
      env,
      `SELECT id, email, name, role, created_at FROM users WHERE id = ?`,
      auth.userId,
    );

    // 3) Sessions actives historiques. La table peut s'appeler admin_sessions
    //    (cf. helpers.ts validateSession) → on tente, swallow si absente.
    const sessions = await safeAll(
      env,
      `SELECT token, ip, user_agent, created_at, last_active_at, expires_at
       FROM admin_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      auth.userId,
    );
    // Masque le token (PII sensible) — on garde un préfixe pour debug.
    const sessionsRedacted = sessions.map((s) => ({
      ...s,
      token: typeof s.token === 'string' ? `${s.token.slice(0, 6)}…` : null,
    }));

    // 4) Audit log DE ce user (jamais des autres → user_id = ?).
    const auditRows = await safeAll(
      env,
      `SELECT id, action, resource_type, resource_id, details, ip, user_agent, created_at
       FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`,
      auth.userId,
    );

    // 5) Consentements généraux (consent_log existe depuis seq8).
    const consents = await safeAll(
      env,
      `SELECT * FROM consent_log WHERE user_id = ? ORDER BY created_at DESC`,
      auth.userId,
    );

    // 6) Cookie consents (seq121).
    const cookieConsents = await safeAll(
      env,
      `SELECT id, anonymous_id, user_id, categories, policy_version, ip, user_agent, url, granted_at
       FROM cookie_consent_log WHERE user_id = ? ORDER BY granted_at DESC`,
      auth.userId,
    );

    // 6.5) Sprint 32 — GBP data (Google Business Profile) bornée au tenant.
    //      Best-effort : si clientId absent ou tables non jouées → tableaux vides.
    //      Tokens OAuth chiffrés EXCLUS de l'export (secrets non-exportables).
    const gbpClientId = auth.tenant?.clientId ?? auth.clientId ?? null;
    const gbpConnections = gbpClientId
      ? await safeAll(
          env,
          `SELECT id, gbp_account_id, gbp_account_name, status, last_sync_at, created_at
           FROM gbp_connections WHERE client_id = ?`,
          gbpClientId,
        )
      : [];
    const gbpLocations = gbpClientId
      ? await safeAll(
          env,
          `SELECT id, gbp_location_id, location_title, primary_phone, primary_category
           FROM gbp_locations WHERE client_id = ?`,
          gbpClientId,
        )
      : [];

    // 6.6) Sprint 33 — Calendar Sync data (Google Calendar + Outlook) bornée
    //      au tenant. Best-effort : si clientId absent ou tables non jouées →
    //      tableaux vides. Tokens OAuth chiffrés EXCLUS (secrets). Champs PII
    //      tiers (description/location/attendees) EXCLUS pour borner la
    //      volumétrie et éviter ré-exfiltration d'événements clients.
    const calClientId = auth.tenant?.clientId ?? auth.clientId ?? null;
    const calConnections = calClientId
      ? await safeAll(
          env,
          `SELECT id, provider, external_account_email, external_calendar_name, status, last_pull_at, created_at
           FROM calendar_connections WHERE client_id = ?`,
          calClientId,
        )
      : [];
    const calExternalEvents = calClientId
      ? await safeAll(
          env,
          `SELECT id, summary, start_time, end_time, status
           FROM calendar_external_events WHERE client_id = ?
           ORDER BY start_time DESC LIMIT 200`,
          calClientId,
        )
      : [];
    const appointmentSyncs = calClientId
      ? await safeAll(
          env,
          `SELECT id, appointment_id, sync_status, last_synced_at
           FROM appointment_sync WHERE client_id = ?`,
          calClientId,
        )
      : [];

    // 7) Trace de l'export (best-effort, NE PAS bloquer l'export si KO).
    const { request } = getRequestContext();
    const ip = request?.headers.get('CF-Connecting-IP') || 'unknown';
    const ua = request?.headers.get('User-Agent') || '';
    const totalEntries =
      sessionsRedacted.length + auditRows.length + consents.length + cookieConsents.length
      + gbpConnections.length + gbpLocations.length
      + calConnections.length + calExternalEvents.length + appointmentSyncs.length;
    try {
      await env.DB.prepare(
        `INSERT INTO data_export_requests (user_id, ip, user_agent, bytes) VALUES (?, ?, ?, ?)`,
      ).bind(auth.userId, ip, ua, totalEntries).run();
    } catch { /* swallow — seq121 pas jouée */ }

    // 8) Audit (best-effort).
    await audit(env, auth.userId, 'me.data.export', 'user', auth.userId, {
      entries: totalEntries,
    });

    const payload: MyDataExport & {
      gbp_connections?: Array<Record<string, unknown>>;
      gbp_locations?: Array<Record<string, unknown>>;
      calendar_connections?: Array<Record<string, unknown>>;
      calendar_external_events?: Array<Record<string, unknown>>;
      appointment_sync?: Array<Record<string, unknown>>;
    } = {
      user: (user as Record<string, unknown> | null) ?? { id: auth.userId },
      sessions: sessionsRedacted,
      audit_log: auditRows,
      consents_given: consents,
      cookie_consents: cookieConsents,
      // Sprint 32 — GBP snapshot user-data (Loi 25 art. 27 portabilité).
      gbp_connections: gbpConnections,
      gbp_locations: gbpLocations,
      // Sprint 33 — Calendar Sync snapshot user-data (Google Calendar +
      // Outlook). Loi 25 art. 27 portabilité. Events tronqués 200 max,
      // PII tiers (description/location/attendees) exclus.
      calendar_connections: calConnections,
      calendar_external_events: calExternalEvents,
      appointment_sync: appointmentSyncs,
      exported_at: new Date().toISOString(),
      purpose: 'Loi 25 art. 27 — droit d\'accès',
    };

    return json({ data: payload });
  } catch {
    // Best-effort dégradé : export partiel plutôt que 500.
    return json({
      data: {
        user: { id: auth.userId },
        sessions: [],
        audit_log: [],
        consents_given: [],
        cookie_consents: [],
        exported_at: new Date().toISOString(),
        purpose: 'Loi 25 art. 27 — droit d\'accès',
      } satisfies MyDataExport,
    });
  }
}

// ── GET /api/me/delete-account ───────────────────────────────────────────
// Retourne la demande pending si elle existe, sinon null.
export async function handleGetMyDeletionRequest(
  env: Env,
  auth: MeAuth,
): Promise<Response> {
  try {
    const row = await safeFirst<Record<string, unknown>>(
      env,
      `SELECT id, user_id, reason, status, requested_at, scheduled_for, executed_at
       FROM account_deletion_requests
       WHERE user_id = ? AND status = 'pending'
       ORDER BY requested_at DESC LIMIT 1`,
      auth.userId,
    );

    if (!row) return json({ data: null });

    const result: AccountDeletionRequest = {
      id: String(row.id ?? ''),
      user_id: String(row.user_id ?? auth.userId),
      reason: String(row.reason ?? ''),
      status: (row.status as 'pending' | 'canceled' | 'executed') ?? 'pending',
      requested_at: String(row.requested_at ?? ''),
      scheduled_for: String(row.scheduled_for ?? ''),
      executed_at: (row.executed_at as string | null) ?? null,
    };
    return json({ data: result });
  } catch {
    return json({ data: null });
  }
}

// ── POST /api/me/delete-account ──────────────────────────────────────────
// Crée demande soft-delete avec scheduled_for = +30j. Rate-limit 3/jour/user.
// Conflict 409 si demande pending existe déjà.
export async function handleRequestAccountDeletion(
  request: Request,
  env: Env,
  auth: MeAuth,
): Promise<Response> {
  try {
    // 1) Body validation.
    const body = await request.json().catch(() => ({}));
    const parsed = accountDeletionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Confirmation invalide', code: 'INVALID_INPUT' }, 400);
    }

    // 2) Rate-limit 3 / jour / user.
    const rl = await checkRateLimit(env, `delete-account:user:${auth.userId}`, 3, 86400);
    if (!rl.allowed) {
      return json(
        { error: 'Trop de tentatives — réessayez plus tard', code: 'RATE_LIMITED' },
        429,
      );
    }

    // 3) Vérifie que confirm_email === user.email (anti-fat-finger).
    const userRow = await safeFirst<{ email: string }>(
      env,
      `SELECT email FROM users WHERE id = ?`,
      auth.userId,
    );
    const userEmail = (userRow?.email ?? '').toString().trim().toLowerCase();
    const confirmEmail = parsed.data.confirm_email.trim().toLowerCase();
    if (!userEmail || userEmail !== confirmEmail) {
      return json({ error: 'Confirmation email incorrecte', code: 'INVALID_INPUT' }, 400);
    }

    // 4) Conflict si une demande pending existe déjà.
    const existing = await safeFirst<{ id: string }>(
      env,
      `SELECT id FROM account_deletion_requests
       WHERE user_id = ? AND status = 'pending' LIMIT 1`,
      auth.userId,
    );
    if (existing && existing.id) {
      return json(
        { error: 'Demande de suppression déjà en cours', code: 'DELETION_ALREADY_REQUESTED' },
        409,
      );
    }

    // 5) INSERT soft-delete avec scheduled_for = +30 jours.
    const { request: ctxReq } = getRequestContext();
    const ip = ctxReq?.headers.get('CF-Connecting-IP') || 'unknown';
    const reason = parsed.data.reason ?? '';
    try {
      await env.DB.prepare(
        `INSERT INTO account_deletion_requests
           (id, user_id, reason, status, scheduled_for, ip)
         VALUES (lower(hex(randomblob(16))), ?, ?, 'pending', datetime('now', '+30 days'), ?)`,
      ).bind(auth.userId, reason, ip).run();
    } catch {
      // Si la table seq121 n'existe pas, on ne peut pas créer la demande →
      // 500. Mais ne pas fuiter le message brut.
      return json({ error: 'Service indisponible', code: 'INTERNAL' }, 500);
    }

    // 5.5) Sprint 32 — Cascade GBP cleanup (Loi 25 art. 28.1 RTBF).
    //      Purge tokens OAuth + fiches GBP + sync history bornés au tenant.
    //      Best-effort : swallow erreurs (tables non-jouées / clientId absent
    //      / D1 transient). NE PAS bloquer la création de la demande
    //      soft-delete 30j si la cascade GBP échoue. La cascade fire ici
    //      (tokens sensibles = early revocation préférable) ; les données
    //      user core sont anonymisées à J+30 par le cron séparé.
    const cascadeClientId = auth.tenant?.clientId ?? auth.clientId ?? null;
    if (cascadeClientId) {
      try {
        await env.DB.prepare('DELETE FROM gbp_reviews_sync WHERE client_id = ?').bind(cascadeClientId).run();
      } catch { /* best-effort */ }
      try {
        await env.DB.prepare('DELETE FROM gbp_posts_sync WHERE client_id = ?').bind(cascadeClientId).run();
      } catch { /* best-effort */ }
      try {
        await env.DB.prepare('DELETE FROM gbp_locations WHERE client_id = ?').bind(cascadeClientId).run();
      } catch { /* best-effort */ }
      try {
        await env.DB.prepare('DELETE FROM gbp_connections WHERE client_id = ?').bind(cascadeClientId).run();
      } catch { /* best-effort */ }
      try {
        await env.DB.prepare('DELETE FROM oauth_connections WHERE client_id = ? AND provider = ?')
          .bind(cascadeClientId, 'google_business').run();
      } catch { /* best-effort */ }
      // Best-effort revoke Google OAuth — désactivé par défaut (exige
      // access_token déchiffré). Si réactivé, ne pas await (fire-and-forget) :
      // fetch('https://oauth2.googleapis.com/revoke?token=' + accessToken).catch(() => {});

      // Sprint 33 — Calendar sync cascade cleanup (Loi 25 art. 28.1 RTBF).
      //      Purge mapping appointments ↔ events + cache événements externes
      //      + connexions calendar + tokens OAuth Google Calendar + Outlook.
      //      Best-effort : swallow erreurs (tables non-jouées / D1 transient).
      //      Tokens sensibles purgés tôt (early revocation) — l'anonymisation
      //      user core reste exécutée à J+30 par le cron séparé.
      try {
        await env.DB.prepare('DELETE FROM appointment_sync WHERE client_id = ?').bind(cascadeClientId).run();
      } catch { /* best-effort */ }
      try {
        await env.DB.prepare('DELETE FROM calendar_external_events WHERE client_id = ?').bind(cascadeClientId).run();
      } catch { /* best-effort */ }
      try {
        await env.DB.prepare('DELETE FROM calendar_connections WHERE client_id = ?').bind(cascadeClientId).run();
      } catch { /* best-effort */ }
      try {
        await env.DB.prepare('DELETE FROM oauth_connections WHERE client_id = ? AND provider IN (?, ?)')
          .bind(cascadeClientId, 'google_calendar', 'outlook').run();
      } catch { /* best-effort */ }
      // Best-effort revoke externes (Google Calendar + Microsoft Graph) —
      // désactivé par défaut (exige access_token déchiffré). Si réactivé,
      // fire-and-forget : fetch('https://oauth2.googleapis.com/revoke?token=...').catch(() => {});
      // et fetch('https://login.microsoftonline.com/common/oauth2/v2.0/logout', { ... }).catch(() => {});
    }

    // 6) SELECT le row inséré pour réponse.
    const row = await safeFirst<Record<string, unknown>>(
      env,
      `SELECT id, user_id, reason, status, requested_at, scheduled_for, executed_at
       FROM account_deletion_requests
       WHERE user_id = ? AND status = 'pending'
       ORDER BY requested_at DESC LIMIT 1`,
      auth.userId,
    );

    // 7) Audit (best-effort).
    await audit(env, auth.userId, 'me.account.delete_requested', 'user', auth.userId, {
      reason,
      scheduled_for: row?.scheduled_for ?? null,
      gbp_cascade: Boolean(cascadeClientId),
      calendar_cascade: Boolean(cascadeClientId),
    });

    const result: AccountDeletionRequest = {
      id: String(row?.id ?? ''),
      user_id: String(row?.user_id ?? auth.userId),
      reason: String(row?.reason ?? reason),
      status: (row?.status as 'pending' | 'canceled' | 'executed') ?? 'pending',
      requested_at: String(row?.requested_at ?? new Date().toISOString()),
      scheduled_for: String(
        row?.scheduled_for ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      ),
      executed_at: (row?.executed_at as string | null) ?? null,
    };

    return json({ data: result });
  } catch {
    return json({ error: 'Internal', code: 'INTERNAL' }, 500);
  }
}

// ── POST /api/me/delete-account/cancel ───────────────────────────────────
// Annule la demande pending (404 DELETION_NOT_FOUND si aucune).
export async function handleCancelAccountDeletion(
  env: Env,
  auth: MeAuth,
): Promise<Response> {
  try {
    let changes = 0;
    try {
      const res = await env.DB.prepare(
        `UPDATE account_deletion_requests SET status = 'canceled'
         WHERE user_id = ? AND status = 'pending'`,
      ).bind(auth.userId).run();
      // D1 expose `meta.changes` (= rows affected).
      const meta = (res as unknown as { meta?: { changes?: number } }).meta;
      changes = Number(meta?.changes ?? 0);
    } catch {
      // Table absente (seq121 pas jouée) → équivalent à 0 changes.
      changes = 0;
    }

    if (changes === 0) {
      return json(
        { error: 'Aucune demande de suppression à annuler', code: 'DELETION_NOT_FOUND' },
        404,
      );
    }

    await audit(env, auth.userId, 'me.account.delete_canceled', 'user', auth.userId, {});

    return json({ data: { ok: true as const } });
  } catch {
    return json({ error: 'Internal', code: 'INTERNAL' }, 500);
  }
}
