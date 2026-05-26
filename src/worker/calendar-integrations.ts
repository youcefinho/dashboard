// ════════════════════════════════════════════════════════════
// Sprint 33 — Calendar integrations CRUD handlers
// ════════════════════════════════════════════════════════════
//
// ── OBJECTIF ────────────────────────────────────────────────
//
// 6 handlers AUTHED câblés depuis worker.ts pour gérer les connexions
// calendrier externe (Google Calendar + Outlook) d'un tenant :
//
//   - handleListConnections : SELECT calendar_connections WHERE client_id
//   - handleDisconnect : DELETE + revoke webhook externe best-effort
//   - handleListExternalCalendars : liste les calendriers Google/Outlook
//   - handleSyncNow : trigger pullExternalToAppointments inline
//   - handleListConflicts : SELECT appointment_sync WHERE sync_status='conflict'
//   - handleResolveConflict : applique résolution (keep_intralys | keep_external)
//
// ── ISOLATION TENANT ───────────────────────────────────────
//
// Toutes les requêtes sont bornées par auth.clientId (jamais body). Les
// IDs de connexion / sync passés en path-param sont matchés AVEC le
// client_id (defense-in-depth contre IDOR cross-tenant).
//
// ── CAPABILITIES ───────────────────────────────────────────
//
// Mutations (disconnect, sync-now, resolve-conflict) : 'settings.manage'.
// Reads (list, conflicts, external-calendars) : pas de cap requise (auth
// suffit — les lectures sont déjà bornées tenant).
//
// ── HELPERS A1 (lazy imports) ──────────────────────────────
//
// outlook-client (A1) peut ne pas être dispo au déploiement. On lazy-
// import + typeof check pour ne pas casser le bundle si absent.

import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { getGcalAccessToken, gcalStopChannel } from './lib/gcal-client';
import { pullExternalToAppointments } from './calendar-sync';

// ════════════════════════════════════════════════════════════
//  TYPES
// ════════════════════════════════════════════════════════════

export type CalendarAuth = CapAuth & { capabilities?: Set<string> };

interface CalendarConnectionRow {
  id: string;
  client_id: string;
  provider: string;
  external_account_email: string | null;
  external_calendar_id: string | null;
  external_calendar_name: string | null;
  webhook_channel_id: string | null;
  webhook_resource_id: string | null;
  webhook_expires_at: string | null;
  sync_direction: string | null;
  status: string | null;
  last_pull_at: string | null;
  last_push_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface AppointmentSyncConflictRow {
  id: string;
  client_id: string;
  appointment_id: string | null;
  calendar_connection_id: string | null;
  external_event_id: string | null;
  external_etag: string | null;
  sync_status: string | null;
  last_synced_at: string | null;
  intralys_updated_at: string | null;
  appt_title?: string | null;
  provider?: string | null;
}

// ════════════════════════════════════════════════════════════
//  HELPERS INTERNES
// ════════════════════════════════════════════════════════════

function tenantOf(auth: CalendarAuth): { clientId: string | null } {
  return { clientId: auth.tenant?.clientId ?? auth.clientId ?? null };
}

function capGuard(auth: CalendarAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

// Try-import outlook-client (peut ne pas exister). Calque calendar-sync.ts.
type OutlookHelpers = {
  getOutlookAccessToken?: (env: Env, auth: { clientId?: string; tenant?: { clientId?: string | null } }) => Promise<string | null>;
  outlookListCalendars?: (token: string) => Promise<any[]>;
  outlookDeleteSubscription?: (token: string, subscriptionId: string) => Promise<void>;
};
async function loadOutlookHelpers(): Promise<OutlookHelpers | null> {
  try {
    const mod = (await import('./lib/outlook-client' as any)) as OutlookHelpers;
    return mod ?? null;
  } catch {
    return null;
  }
}

// Try-import gcalListCalendars (peut ne pas être exporté selon version A1).
type GcalListCalendars = (token: string) => Promise<any[]>;
async function loadGcalListCalendars(): Promise<GcalListCalendars | null> {
  try {
    const mod = (await import('./lib/gcal-client')) as { gcalListCalendars?: GcalListCalendars };
    return typeof mod.gcalListCalendars === 'function' ? mod.gcalListCalendars : null;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════
//  HANDLERS
// ════════════════════════════════════════════════════════════

// ── GET /api/calendar-connections ───────────────────────────
// Liste les connexions calendrier du tenant courant.
export async function handleListConnections(env: Env, auth: CalendarAuth): Promise<Response> {
  const { clientId } = tenantOf(auth);
  if (!clientId) return json({ data: [] });

  const res = await env.DB.prepare(
    `SELECT id, client_id, provider, external_account_email, external_calendar_id,
            external_calendar_name, webhook_channel_id, webhook_resource_id,
            webhook_expires_at, sync_direction, status, last_pull_at, last_push_at,
            last_error, created_at, updated_at
       FROM calendar_connections
      WHERE client_id = ?
      ORDER BY created_at DESC`,
  )
    .bind(clientId)
    .all<CalendarConnectionRow>();

  return json({ data: res.results ?? [] });
}

// ── DELETE /api/calendar-connections/:id ───────────────────
// Disconnect : DELETE calendar_connections + oauth_connections, et best-
// effort revoke channel externe (GCal stopChannel / Outlook DELETE sub).
export async function handleDisconnect(
  _request: Request,
  env: Env,
  auth: CalendarAuth,
  connectionId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const { clientId } = tenantOf(auth);
  if (!clientId) return json({ error: 'Tenant non résolu' }, 400);

  // SELECT borné tenant (defense-in-depth IDOR).
  const conn = (await env.DB.prepare(
    `SELECT id, client_id, provider, webhook_channel_id, webhook_resource_id,
            oauth_connection_id
       FROM calendar_connections
      WHERE id = ? AND client_id = ? LIMIT 1`,
  )
    .bind(connectionId, clientId)
    .first()) as
    | {
        id: string;
        client_id: string;
        provider: string;
        webhook_channel_id: string | null;
        webhook_resource_id: string | null;
        oauth_connection_id: string | null;
      }
    | null;

  if (!conn) return json({ error: 'Connexion introuvable' }, 404);

  // Best-effort revoke externe AVANT delete local (si ça foire, on continue).
  try {
    if (conn.provider === 'google_calendar' && conn.webhook_channel_id && conn.webhook_resource_id) {
      const token = await getGcalAccessToken(env, { clientId });
      if (token) {
        await gcalStopChannel(token, conn.webhook_channel_id, conn.webhook_resource_id).catch(() => null);
      }
    } else if (conn.provider === 'outlook' && conn.webhook_channel_id) {
      const outlook = await loadOutlookHelpers();
      if (outlook?.getOutlookAccessToken && outlook?.outlookDeleteSubscription) {
        const token = await outlook.getOutlookAccessToken(env, { clientId });
        if (token) {
          await outlook.outlookDeleteSubscription(token, conn.webhook_channel_id).catch(() => null);
        }
      }
    }
  } catch {
    /* best-effort revoke external — jamais bloquant */
  }

  // DELETE local (borné tenant).
  await env.DB.prepare('DELETE FROM calendar_connections WHERE id = ? AND client_id = ?')
    .bind(connectionId, clientId)
    .run();

  // DELETE oauth_connections associé si encore présent (borné tenant).
  if (conn.oauth_connection_id) {
    await env.DB.prepare('DELETE FROM oauth_connections WHERE id = ? AND client_id = ?')
      .bind(conn.oauth_connection_id, clientId)
      .run();
  }

  return json({ data: { success: true } });
}

// ── GET /api/calendar-connections/:id/external-calendars ───
// Liste les calendriers externes via le provider de la connexion.
export async function handleListExternalCalendars(
  _request: Request,
  env: Env,
  auth: CalendarAuth,
  connectionId: string,
): Promise<Response> {
  const { clientId } = tenantOf(auth);
  if (!clientId) return json({ data: [] });

  const conn = (await env.DB.prepare(
    `SELECT id, provider FROM calendar_connections
      WHERE id = ? AND client_id = ? LIMIT 1`,
  )
    .bind(connectionId, clientId)
    .first()) as { id: string; provider: string } | null;
  if (!conn) return json({ error: 'Connexion introuvable' }, 404);

  try {
    if (conn.provider === 'google_calendar') {
      const token = await getGcalAccessToken(env, { clientId });
      if (!token) return json({ error: 'Token Google indisponible' }, 503);
      const lister = await loadGcalListCalendars();
      if (!lister) return json({ data: [] }); // A1 partiel — silent
      const items = await lister(token);
      return json({ data: items });
    } else if (conn.provider === 'outlook') {
      const outlook = await loadOutlookHelpers();
      if (!outlook?.getOutlookAccessToken || !outlook?.outlookListCalendars) {
        return json({ data: [] }); // module A1 outlook pas dispo
      }
      const token = await outlook.getOutlookAccessToken(env, { clientId });
      if (!token) return json({ error: 'Token Outlook indisponible' }, 503);
      const items = await outlook.outlookListCalendars(token);
      return json({ data: items });
    }
    return json({ data: [] });
  } catch (e: any) {
    return json({ error: e?.message || 'Erreur liste calendriers' }, 502);
  }
}

// ── POST /api/calendar-connections/:id/sync-now ─────────────
// Trigger pullExternalToAppointments inline (ctx.waitUntil non dispo ici).
export async function handleSyncNow(
  _request: Request,
  env: Env,
  auth: CalendarAuth,
  connectionId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const { clientId } = tenantOf(auth);
  if (!clientId) return json({ error: 'Tenant non résolu' }, 400);

  // Defense-in-depth : vérifier que la connexion appartient au tenant.
  const conn = (await env.DB.prepare(
    'SELECT id FROM calendar_connections WHERE id = ? AND client_id = ? LIMIT 1',
  )
    .bind(connectionId, clientId)
    .first()) as { id: string } | null;
  if (!conn) return json({ error: 'Connexion introuvable' }, 404);

  try {
    const result = await pullExternalToAppointments(env, connectionId);
    return json({ data: result });
  } catch (e: any) {
    return json({ error: e?.message || 'Erreur sync' }, 502);
  }
}

// ── GET /api/calendar-connections/conflicts ────────────────
// Liste les appointment_sync en statut 'conflict' pour le tenant.
export async function handleListConflicts(env: Env, auth: CalendarAuth): Promise<Response> {
  const { clientId } = tenantOf(auth);
  if (!clientId) return json({ data: [] });

  const res = await env.DB.prepare(
    `SELECT s.id, s.client_id, s.appointment_id, s.calendar_connection_id,
            s.external_event_id, s.external_etag, s.sync_status, s.last_synced_at,
            s.intralys_updated_at,
            a.title as appt_title, c.provider as provider
       FROM appointment_sync s
       LEFT JOIN appointments a ON a.id = s.appointment_id
       LEFT JOIN calendar_connections c ON c.id = s.calendar_connection_id
      WHERE s.client_id = ? AND s.sync_status = 'conflict'
      ORDER BY s.updated_at DESC
      LIMIT 200`,
  )
    .bind(clientId)
    .all<AppointmentSyncConflictRow>();

  return json({ data: res.results ?? [] });
}

// ── POST /api/calendar-connections/conflicts/:syncId/resolve ─
// body { resolution: 'keep_intralys' | 'keep_external' }
// keep_intralys → push CRM → externe (re-PATCH event externe avec données Intralys)
// keep_external → pull externe → CRM (UPDATE appointment avec données externes)
export async function handleResolveConflict(
  request: Request,
  env: Env,
  auth: CalendarAuth,
  syncId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const { clientId } = tenantOf(auth);
  if (!clientId) return json({ error: 'Tenant non résolu' }, 400);

  const body = (await request.json().catch(() => null)) as { resolution?: string } | null;
  const resolution = body?.resolution;
  if (resolution !== 'keep_intralys' && resolution !== 'keep_external') {
    return json({ error: 'resolution doit être keep_intralys ou keep_external' }, 400);
  }

  // SELECT borné tenant.
  const sync = (await env.DB.prepare(
    `SELECT id, client_id, appointment_id, calendar_connection_id, external_event_id, sync_status
       FROM appointment_sync
      WHERE id = ? AND client_id = ? LIMIT 1`,
  )
    .bind(syncId, clientId)
    .first()) as
    | {
        id: string;
        client_id: string;
        appointment_id: string | null;
        calendar_connection_id: string | null;
        external_event_id: string | null;
        sync_status: string | null;
      }
    | null;
  if (!sync) return json({ error: 'Conflit introuvable' }, 404);

  try {
    if (resolution === 'keep_intralys' && sync.appointment_id) {
      // Re-push CRM → externe.
      const { pushAppointmentToExternal } = await import('./calendar-sync');
      await pushAppointmentToExternal(env, { clientId }, sync.appointment_id, 'update');
    } else if (resolution === 'keep_external' && sync.calendar_connection_id) {
      // Re-pull externe → CRM (force resync de cette connexion).
      await pullExternalToAppointments(env, sync.calendar_connection_id);
    }

    // Mark résolu côté sync row.
    await env.DB.prepare(
      `UPDATE appointment_sync
          SET sync_status = 'synced', conflict_resolution = ?, conflict_resolved_at = datetime('now'),
              conflict_resolved_by = ?, updated_at = datetime('now')
        WHERE id = ? AND client_id = ?`,
    )
      .bind(resolution, auth.userId ?? '', syncId, clientId)
      .run();

    return json({ data: { success: true, resolution } });
  } catch (e: any) {
    return json({ error: e?.message || 'Erreur résolution conflit' }, 502);
  }
}
