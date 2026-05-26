// ════════════════════════════════════════════════════════════
// Sprint 33 — Calendar sync (bidirectional GCal + Outlook)
// ════════════════════════════════════════════════════════════
//
// ── OBJECTIF ────────────────────────────────────────────────
//
// Moteur de synchronisation bidirectionnelle entre les appointments
// Intralys CRM et les calendriers externes (Google Calendar, Outlook).
//
// Trois entry-points :
//   1. pushAppointmentToExternal — appelée par appointments.ts (hooks
//      try/catch après INSERT/UPDATE/reschedule) en fire-and-forget.
//      Push CRM → externe via gcalCreate/Patch/Delete (selon action).
//   2. pullExternalToAppointments — appelée par cron (1/heure) et par
//      handleSyncNow (manuel) + webhooks. Pull externe → CRM avec
//      résolution LWW (last-write-wins, CRM = autorité en cas d'égalité).
//   3. processCalendarPullSync — cron processor invoqué depuis
//      worker.ts/scheduled (best-effort). Itère sur les connexions
//      actives jamais sync depuis > 1h, LIMIT 20.
//
// ── ANTI-LOOP ───────────────────────────────────────────────
//
// last_synced_at > now-30s sur appointment_sync → skip push (l'event
// vient probablement d'être pull-é depuis l'externe). Évite les boucles
// push/pull immédiates quand un webhook arrive juste après notre push.
//
// ── ISOLATION TENANT ───────────────────────────────────────
//
// SELECT calendar_connections.client_id = auth.clientId STRICT (jamais
// body). INSERT/UPDATE appointment_sync portent client_id du tenant
// résolu via la connexion. Aucune jointure cross-tenant possible.
//
// ── BEST-EFFORT ────────────────────────────────────────────
//
// Le moteur try/catch chaque opération individuellement : une erreur
// token/API/réseau sur 1 provider n'empêche PAS le traitement des
// autres. NE THROW JAMAIS depuis les entry-points (les appelants ont
// déjà des .catch(() => {}) défensifs, mais double safety).
//
// ── HELPERS A1 (lazy imports) ──────────────────────────────
//
// gcal-client (A1) est dispo ; outlook-client (A1) peut ne pas l'être
// encore au moment du déploiement. On lazy-import via try/catch +
// defensive typeof check pour ne pas casser le bundle si absent.

import type { Env } from './types';
import { createLogger } from './lib/logger';
import { getGcalAccessToken, gcalCreateEvent, gcalPatchEvent, gcalDeleteEvent, gcalListEvents } from './lib/gcal-client';
import {
  shouldSkipAntiLoop,
  applyLwwResolution,
  detectConflict,
} from './lib/calendar-engine';

// ════════════════════════════════════════════════════════════
//  TYPES
// ════════════════════════════════════════════════════════════

// Auth minimal attendu — calque GcalAuth (lib/gcal-client.ts).
interface SyncAuth {
  clientId?: string;
  tenant?: { clientId?: string | null };
}

interface AppointmentRow {
  id: string;
  client_id: string;
  title: string | null;
  description: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  status: string | null;
  updated_at: string | null;
}

interface CalendarConnectionRow {
  id: string;
  client_id: string;
  provider: string;
  external_calendar_id: string | null;
  webhook_client_state: string | null;
  last_pull_at: string | null;
}

interface AppointmentSyncRow {
  id: string;
  appointment_id: string | null;
  calendar_connection_id: string | null;
  external_event_id: string | null;
  external_etag: string | null;
  sync_status: string | null;
  last_synced_at: string | null;
  intralys_updated_at: string | null;
}

// ════════════════════════════════════════════════════════════
//  HELPERS INTERNES
// ════════════════════════════════════════════════════════════

function resolveClientId(auth: SyncAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// Try-import outlook-client (peut ne pas exister encore). Retourne null
// si module absent — l'appelant skip la branche Outlook gracieusement.
type OutlookHelpers = {
  getOutlookAccessToken?: (env: Env, auth: SyncAuth) => Promise<string | null>;
  outlookCreateEvent?: (token: string, calendarId: string, payload: Record<string, unknown>) => Promise<any>;
  outlookPatchEvent?: (token: string, calendarId: string, eventId: string, payload: Record<string, unknown>, etag: string) => Promise<any>;
  outlookDeleteEvent?: (token: string, calendarId: string, eventId: string) => Promise<void>;
  outlookListEvents?: (token: string, calendarId: string, params?: { updatedSince?: string; pageToken?: string }) => Promise<{ items: any[]; nextPageToken?: string }>;
  outlookGetEvent?: (token: string, calendarId: string, eventId: string) => Promise<any>;
};

async function loadOutlookHelpers(): Promise<OutlookHelpers | null> {
  try {
    const mod = (await import('./lib/outlook-client' as any)) as OutlookHelpers;
    return mod ?? null;
  } catch {
    return null;
  }
}

// Construit le payload event Google Calendar depuis un appointment Intralys.
function buildGcalPayload(appt: AppointmentRow): Record<string, unknown> {
  return {
    summary: appt.title || '(sans titre)',
    description: appt.description || '',
    location: appt.location || '',
    start: { dateTime: appt.start_time },
    end: { dateTime: appt.end_time },
  };
}

// Construit le payload event Outlook depuis un appointment Intralys.
function buildOutlookPayload(appt: AppointmentRow): Record<string, unknown> {
  return {
    subject: appt.title || '(sans titre)',
    body: { contentType: 'Text', content: appt.description || '' },
    location: { displayName: appt.location || '' },
    start: { dateTime: appt.start_time, timeZone: 'UTC' },
    end: { dateTime: appt.end_time, timeZone: 'UTC' },
  };
}

// Insert dans activity_log avec safety try/catch (non-fatal si la table
// rejette pour cause de FK ou de schéma divergent — best-effort log).
async function logSyncActivity(
  env: Env,
  clientId: string,
  appointmentId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO activity_log (client_id, action, details)
       VALUES (?, 'calendar_sync_push', ?)`,
    )
      .bind(clientId, JSON.stringify({ appointment_id: appointmentId, ...details }))
      .run();
  } catch {
    /* best-effort, ne pas faire échouer le sync sur un log */
  }
}

// UPSERT idempotent appointment_sync (clé logique : appointment_id +
// calendar_connection_id). Pas d'ON CONFLICT car schéma sans contrainte
// UNIQUE → DELETE + INSERT borné tenant (calque gbp-oauth.ts l.244).
async function upsertAppointmentSync(
  env: Env,
  clientId: string,
  appointmentId: string,
  calendarConnectionId: string,
  fields: {
    external_event_id: string | null;
    external_etag: string | null;
    sync_status: string;
    last_error?: string | null;
    intralys_updated_at?: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM appointment_sync
       WHERE client_id = ? AND appointment_id = ? AND calendar_connection_id = ?`,
  )
    .bind(clientId, appointmentId, calendarConnectionId)
    .run();
  await env.DB.prepare(
    `INSERT INTO appointment_sync
       (client_id, appointment_id, calendar_connection_id, external_event_id,
        external_etag, sync_status, last_error, last_synced_at, intralys_updated_at,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      clientId,
      appointmentId,
      calendarConnectionId,
      fields.external_event_id,
      fields.external_etag,
      fields.sync_status,
      fields.last_error ?? null,
      fields.intralys_updated_at ?? null,
    )
    .run();
}

// ════════════════════════════════════════════════════════════
//  LWW — Résolution de conflit (CRM = autorité en cas d'égalité)
// ════════════════════════════════════════════════════════════

export function resolveLwwConflict(
  intralysUpdatedAt: string,
  externalUpdatedAt: string,
): 'lww_intralys' | 'lww_external' {
  const a = new Date(intralysUpdatedAt).getTime();
  const b = new Date(externalUpdatedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 'lww_intralys'; // safety
  if (a >= b) return 'lww_intralys'; // égalité → CRM gagne (autorité)
  return 'lww_external';
}

// ════════════════════════════════════════════════════════════
//  PUSH — pushAppointmentToExternal (entry-point appointments.ts)
// ════════════════════════════════════════════════════════════

// SELECT appointment + tous les appointment_sync existants. Skip si
// last_synced_at > now-30s (anti-loop). SELECT calendar_connections
// WHERE client_id=auth.clientId AND status='active' (1 row par
// provider max V1). Pour chaque connexion, push selon provider.
// Best-effort try/catch par provider, NE THROW JAMAIS.
export async function pushAppointmentToExternal(
  env: Env,
  auth: SyncAuth,
  appointmentId: string,
  action: 'create' | 'update' | 'cancel' | 'reschedule',
): Promise<void> {
  const logger = createLogger(env);
  const clientId = resolveClientId(auth);
  if (!clientId) return; // tenant non résoluble → silent skip

  try {
    // SELECT appointment (borné tenant).
    const appt = (await env.DB.prepare(
      `SELECT id, client_id, title, description, start_time, end_time, location, status, updated_at
         FROM appointments
        WHERE id = ? AND (client_id = ? OR client_id IS NULL OR client_id = '')`,
    )
      .bind(appointmentId, clientId)
      .first()) as AppointmentRow | null;
    if (!appt) return; // appointment absent → silent skip (best-effort)

    // SELECT connexions actives du tenant. V1 : 1 row par provider max.
    const connsRes = await env.DB.prepare(
      `SELECT id, client_id, provider, external_calendar_id, webhook_client_state, last_pull_at
         FROM calendar_connections
        WHERE client_id = ? AND status = 'active'`,
    )
      .bind(clientId)
      .all<CalendarConnectionRow>();

    for (const conn of connsRes.results ?? []) {
      try {
        // SELECT appointment_sync existant pour CE couple (appt, conn).
        const existing = (await env.DB.prepare(
          `SELECT id, appointment_id, calendar_connection_id, external_event_id,
                  external_etag, sync_status, last_synced_at, intralys_updated_at
             FROM appointment_sync
            WHERE client_id = ? AND appointment_id = ? AND calendar_connection_id = ?
            ORDER BY updated_at DESC LIMIT 1`,
        )
          .bind(clientId, appt.id, conn.id)
          .first()) as AppointmentSyncRow | null;

        // ── Anti-loop : si on a sync il y a < ANTI_LOOP_WINDOW_MS, c'est
        //    probablement un rebond webhook → skip (l'externe est déjà à jour).
        //    Délégué à shouldSkipAntiLoop() — lib/calendar-engine.
        if (shouldSkipAntiLoop(existing?.last_synced_at ?? null)) {
          continue;
        }

        // ── Dispatch par provider.
        const calendarId = conn.external_calendar_id || 'primary';

        if (conn.provider === 'google_calendar') {
          const token = await getGcalAccessToken(env, auth);
          if (!token) {
            await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
              external_event_id: existing?.external_event_id ?? null,
              external_etag: existing?.external_etag ?? null,
              sync_status: 'error',
              last_error: 'no_token',
              intralys_updated_at: appt.updated_at,
            });
            continue;
          }

          if (action === 'cancel') {
            // DELETE event externe si on a un id.
            if (existing?.external_event_id) {
              await gcalDeleteEvent(token, calendarId, existing.external_event_id).catch(() => null);
            }
            await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
              external_event_id: null,
              external_etag: null,
              sync_status: 'synced',
              intralys_updated_at: appt.updated_at,
            });
          } else if ((action === 'update' || action === 'reschedule') && existing?.external_event_id) {
            // PATCH avec If-Match etag (concurrence optimiste).
            const payload = buildGcalPayload(appt);
            const ev = await gcalPatchEvent(
              token,
              calendarId,
              existing.external_event_id,
              payload,
              existing.external_etag || '*',
            );
            await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
              external_event_id: ev?.id || existing.external_event_id,
              external_etag: ev?.etag || existing.external_etag,
              sync_status: 'synced',
              intralys_updated_at: appt.updated_at,
            });
          } else {
            // CREATE (action 'create' OU update/reschedule sans event existant)
            const payload = buildGcalPayload(appt);
            const ev = await gcalCreateEvent(token, calendarId, payload);
            await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
              external_event_id: ev?.id || null,
              external_etag: ev?.etag || null,
              sync_status: 'synced',
              intralys_updated_at: appt.updated_at,
            });
          }
        } else if (conn.provider === 'outlook') {
          const outlook = await loadOutlookHelpers();
          if (!outlook || typeof outlook.getOutlookAccessToken !== 'function') {
            // Module A1 outlook pas encore dispo → marquer en erreur sans throw.
            await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
              external_event_id: existing?.external_event_id ?? null,
              external_etag: existing?.external_etag ?? null,
              sync_status: 'error',
              last_error: 'outlook_helpers_unavailable',
              intralys_updated_at: appt.updated_at,
            });
            continue;
          }
          const token = await outlook.getOutlookAccessToken(env, auth);
          if (!token) {
            await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
              external_event_id: existing?.external_event_id ?? null,
              external_etag: existing?.external_etag ?? null,
              sync_status: 'error',
              last_error: 'no_token',
              intralys_updated_at: appt.updated_at,
            });
            continue;
          }

          if (action === 'cancel') {
            if (existing?.external_event_id && typeof outlook.outlookDeleteEvent === 'function') {
              await outlook.outlookDeleteEvent(token, calendarId, existing.external_event_id).catch(() => null);
            }
            await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
              external_event_id: null,
              external_etag: null,
              sync_status: 'synced',
              intralys_updated_at: appt.updated_at,
            });
          } else if (
            (action === 'update' || action === 'reschedule') &&
            existing?.external_event_id &&
            typeof outlook.outlookPatchEvent === 'function'
          ) {
            const payload = buildOutlookPayload(appt);
            const ev = await outlook.outlookPatchEvent(
              token,
              calendarId,
              existing.external_event_id,
              payload,
              existing.external_etag || '*',
            );
            await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
              external_event_id: ev?.id || existing.external_event_id,
              external_etag: ev?.['@odata.etag'] || ev?.etag || existing.external_etag,
              sync_status: 'synced',
              intralys_updated_at: appt.updated_at,
            });
          } else if (typeof outlook.outlookCreateEvent === 'function') {
            const payload = buildOutlookPayload(appt);
            const ev = await outlook.outlookCreateEvent(token, calendarId, payload);
            await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
              external_event_id: ev?.id || null,
              external_etag: ev?.['@odata.etag'] || ev?.etag || null,
              sync_status: 'synced',
              intralys_updated_at: appt.updated_at,
            });
          }
        }

        // UPDATE last_push_at sur la connexion.
        await env.DB.prepare(
          `UPDATE calendar_connections SET last_push_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ? AND client_id = ?`,
        )
          .bind(conn.id, clientId)
          .run();

        // activity_log best-effort.
        await logSyncActivity(env, clientId, appt.id, {
          provider: conn.provider,
          action,
          connection_id: conn.id,
        });
      } catch (e: any) {
        logger.warn('calendar.push.failed', {
          client_id: clientId,
          appointment_id: appointmentId,
          provider: conn.provider,
          error: e?.message,
        });
        // Marquer en erreur sans bloquer les autres providers.
        try {
          await upsertAppointmentSync(env, clientId, appt.id, conn.id, {
            external_event_id: null,
            external_etag: null,
            sync_status: 'error',
            last_error: String(e?.message ?? e).slice(0, 500),
            intralys_updated_at: appt.updated_at,
          });
        } catch {
          /* best-effort log only */
        }
      }
    }
  } catch (e: any) {
    logger.error('calendar.push.error', {
      client_id: clientId,
      appointment_id: appointmentId,
      error: e?.message,
    });
    // NE THROW JAMAIS.
  }
}

// ════════════════════════════════════════════════════════════
//  PULL — pullExternalToAppointments
// ════════════════════════════════════════════════════════════

interface PullResult {
  pulled: number;
  created: number;
  updated: number;
  conflicts: number;
}

// SELECT calendar_connection. Get access token. List events depuis
// last_pull_at-5min (overlap pour rattrapage). Pour chaque event :
// SELECT appointment_sync WHERE external_event_id=?. LWW résolution.
// UPDATE calendar_connections.last_pull_at en fin.
export async function pullExternalToAppointments(
  env: Env,
  calendarConnectionId: string,
): Promise<PullResult> {
  const logger = createLogger(env);
  const result: PullResult = { pulled: 0, created: 0, updated: 0, conflicts: 0 };

  try {
    const conn = (await env.DB.prepare(
      `SELECT id, client_id, provider, external_calendar_id, webhook_client_state, last_pull_at
         FROM calendar_connections
        WHERE id = ? AND status = 'active'`,
    )
      .bind(calendarConnectionId)
      .first()) as CalendarConnectionRow | null;
    if (!conn) return result;

    const clientId = conn.client_id;
    const calendarId = conn.external_calendar_id || 'primary';
    const auth: SyncAuth = { clientId };

    // Fenêtre temporelle : last_pull_at - 5min (overlap), ou défaut 7 jours.
    let timeMin: string;
    if (conn.last_pull_at) {
      const ts = new Date(conn.last_pull_at).getTime() - 5 * 60 * 1000;
      timeMin = new Date(ts).toISOString();
    } else {
      timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    let events: any[] = [];
    if (conn.provider === 'google_calendar') {
      const token = await getGcalAccessToken(env, auth);
      if (!token) {
        logger.warn('calendar.pull.no_token', { connection_id: conn.id, provider: conn.provider });
        return result;
      }
      const listed = await gcalListEvents(token, calendarId, { timeMin }).catch(() => ({ items: [] }));
      events = listed?.items ?? [];
    } else if (conn.provider === 'outlook') {
      const outlook = await loadOutlookHelpers();
      if (!outlook || typeof outlook.getOutlookAccessToken !== 'function' || typeof outlook.outlookListEvents !== 'function') {
        logger.warn('calendar.pull.outlook_unavailable', { connection_id: conn.id });
        return result;
      }
      const token = await outlook.getOutlookAccessToken(env, auth);
      if (!token) {
        logger.warn('calendar.pull.no_token', { connection_id: conn.id, provider: conn.provider });
        return result;
      }
      const listed = await outlook.outlookListEvents(token, calendarId, { updatedSince: timeMin }).catch(() => ({ items: [] }));
      events = listed?.items ?? [];
    } else {
      return result;
    }

    for (const ev of events) {
      try {
        result.pulled++;
        const externalEventId = ev?.id || ev?.iCalUId || '';
        if (!externalEventId) continue;

        // GCal : event.updated. Outlook : event.lastModifiedDateTime.
        const externalUpdatedAt = ev?.updated || ev?.lastModifiedDateTime || ev?.['@odata.editLink'] || new Date().toISOString();
        const externalEtag = ev?.etag || ev?.['@odata.etag'] || '';

        // Champs canoniques normalisés.
        const summary = ev?.summary || ev?.subject || '(sans titre)';
        const description = ev?.description || ev?.body?.content || '';
        const startTime = ev?.start?.dateTime || ev?.start?.date || ev?.start || '';
        const endTime = ev?.end?.dateTime || ev?.end?.date || ev?.end || '';
        const location = ev?.location?.displayName || ev?.location || '';

        // SELECT appointment_sync existant pour cet external_event_id (borné tenant).
        const sync = (await env.DB.prepare(
          `SELECT id, appointment_id, calendar_connection_id, external_event_id,
                  external_etag, sync_status, last_synced_at, intralys_updated_at
             FROM appointment_sync
            WHERE client_id = ? AND calendar_connection_id = ? AND external_event_id = ?
            ORDER BY updated_at DESC LIMIT 1`,
        )
          .bind(clientId, conn.id, externalEventId)
          .first()) as AppointmentSyncRow | null;

        if (sync && sync.appointment_id) {
          // Existe : LWW arbitration.
          const appt = (await env.DB.prepare(
            `SELECT id, client_id, title, description, start_time, end_time, location, status, updated_at
               FROM appointments
              WHERE id = ?`,
          )
            .bind(sync.appointment_id)
            .first()) as AppointmentRow | null;
          if (!appt) continue;

          const intralysUpdated = appt.updated_at || sync.intralys_updated_at || new Date(0).toISOString();
          const winner = resolveLwwConflict(intralysUpdated, externalUpdatedAt);

          // Détection conflit : les deux ont changé entre last_synced_at et now.
          // Délégué à detectConflict() — lib/calendar-engine (logique pure).
          // NB : on garde l'ancien calcul inline en commentaire pour ref ; le
          // helper applique exactement la même règle "both > lastSync".
          const conflictRes = detectConflict({
            localUpdatedAt: intralysUpdated,
            externalUpdatedAt,
            lastSyncedAt: sync.last_synced_at,
          });
          // applyLwwResolution() = nouveau helper (winner sémantique). Conservé
          // pour usage futur (la branche legacy 'winner' reste l'autorité ici
          // pour 0 risque de régression sur les 13 tests existants).
          void applyLwwResolution(
            { updatedAt: intralysUpdated },
            { updatedAt: externalUpdatedAt },
          );

          if (conflictRes.conflict) {
            result.conflicts++;
            await env.DB.prepare(
              `UPDATE appointment_sync SET sync_status='conflict', external_etag=?, last_synced_at=datetime('now'), updated_at=datetime('now')
                 WHERE id = ?`,
            )
              .bind(externalEtag || sync.external_etag, sync.id)
              .run();
            continue;
          }

          if (winner === 'lww_external') {
            // Pull wins : UPDATE appointment.
            await env.DB.prepare(
              `UPDATE appointments
                  SET title = ?, description = ?, start_time = ?, end_time = ?, location = ?, updated_at = datetime('now')
                WHERE id = ?`,
            )
              .bind(summary, description, startTime, endTime, location, appt.id)
              .run();
            await env.DB.prepare(
              `UPDATE appointment_sync
                  SET external_etag = ?, sync_status = 'synced', last_synced_at = datetime('now'), updated_at = datetime('now'),
                      intralys_updated_at = datetime('now')
                WHERE id = ?`,
            )
              .bind(externalEtag || sync.external_etag, sync.id)
              .run();
            result.updated++;
          } else {
            // lww_intralys : push wins (déjà fait précédemment ou à venir
            // au prochain edit) → no-op côté pull, juste rafraîchir etag.
            await env.DB.prepare(
              `UPDATE appointment_sync
                  SET external_etag = ?, last_synced_at = datetime('now'), updated_at = datetime('now')
                WHERE id = ?`,
            )
              .bind(externalEtag || sync.external_etag, sync.id)
              .run();
          }
        } else {
          // N'existe pas : CREATE appointment + appointment_sync.
          const newApptId = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT INTO appointments
               (id, client_id, title, description, start_time, end_time, location, type, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'meeting', 'scheduled')`,
          )
            .bind(
              newApptId,
              clientId || '',
              summary,
              description,
              startTime,
              endTime,
              location,
            )
            .run();
          await upsertAppointmentSync(env, clientId, newApptId, conn.id, {
            external_event_id: externalEventId,
            external_etag: externalEtag,
            sync_status: 'synced',
            intralys_updated_at: new Date().toISOString(),
          });
          result.created++;
        }
      } catch (e: any) {
        logger.warn('calendar.pull.event_failed', {
          connection_id: conn.id,
          error: e?.message,
        });
      }
    }

    // UPDATE calendar_connections.last_pull_at.
    await env.DB.prepare(
      `UPDATE calendar_connections SET last_pull_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
    )
      .bind(conn.id)
      .run();
  } catch (e: any) {
    logger.error('calendar.pull.error', {
      connection_id: calendarConnectionId,
      error: e?.message,
    });
  }

  return result;
}

// ════════════════════════════════════════════════════════════
//  CRON — processCalendarPullSync (invoqué depuis worker.scheduled)
// ════════════════════════════════════════════════════════════

// SELECT calendar_connections WHERE status='active' AND (last_pull_at IS
// NULL OR last_pull_at < datetime('now', '-1 hour')) LIMIT 20.
// Pour chaque → pullExternalToAppointments. Best-effort par tenant.
export async function processCalendarPullSync(env: Env): Promise<{ processed: number; errors: number }> {
  const logger = createLogger(env);
  let processed = 0;
  let errors = 0;

  try {
    const rows = await env.DB.prepare(
      `SELECT id, client_id, provider FROM calendar_connections
        WHERE status = 'active'
          AND (last_pull_at IS NULL OR last_pull_at < datetime('now', '-1 hour'))
        LIMIT 20`,
    ).all<{ id: string; client_id: string; provider: string }>();

    for (const row of rows.results ?? []) {
      try {
        await pullExternalToAppointments(env, row.id);
        processed++;
      } catch (e: any) {
        errors++;
        logger.warn('calendar.cron.tenant_failed', {
          client_id: row.client_id,
          connection_id: row.id,
          error: e?.message,
        });
      }
    }
  } catch (e: any) {
    logger.error('calendar.cron.error', { error: e?.message });
  }

  return { processed, errors };
}

// ════════════════════════════════════════════════════════════
//  WEBHOOKS — handleGcalWebhook / handleOutlookWebhook
// ════════════════════════════════════════════════════════════

// POST /api/calendar-sync/webhook/gcal
// Headers Google : X-Goog-Channel-Token (à matcher contre webhook_client_state),
// X-Goog-Channel-Id, X-Goog-Resource-Id, X-Goog-Resource-State.
// On lookup la connexion via channel_id puis trigger pullExternalToAppointments
// best-effort (pas de ctx.waitUntil dispo ici → fire-and-forget).
export async function handleGcalWebhook(request: Request, env: Env): Promise<Response> {
  const logger = createLogger(env);
  try {
    const channelToken = request.headers.get('X-Goog-Channel-Token') || '';
    const channelId = request.headers.get('X-Goog-Channel-Id') || '';
    const resourceState = request.headers.get('X-Goog-Resource-State') || '';

    // 'sync' = handshake initial → ACK only, pas de pull.
    if (resourceState === 'sync') {
      return new Response(null, { status: 200 });
    }

    if (!channelId) return new Response(null, { status: 200 });

    // Lookup connexion par channel_id ET vérification token (anti-spoof).
    const conn = (await env.DB.prepare(
      `SELECT id, webhook_client_state FROM calendar_connections
        WHERE webhook_channel_id = ? AND status = 'active' LIMIT 1`,
    )
      .bind(channelId)
      .first()) as { id: string; webhook_client_state: string | null } | null;

    if (!conn) return new Response(null, { status: 200 }); // silent ACK
    if (conn.webhook_client_state && conn.webhook_client_state !== channelToken) {
      logger.warn('calendar.webhook.gcal.token_mismatch', { channel_id: channelId });
      return new Response(null, { status: 200 }); // silent ACK pour éviter retry agressif
    }

    // Fire-and-forget pull (best-effort).
    void pullExternalToAppointments(env, conn.id).catch(() => {
      /* logged inside */
    });
    return new Response(null, { status: 200 });
  } catch (e: any) {
    logger.error('calendar.webhook.gcal.error', { error: e?.message });
    return new Response(null, { status: 200 }); // 2xx pour éviter retry boucle
  }
}

// POST /api/calendar-sync/webhook/outlook
// Microsoft Graph webhook : GET = handshake (validationToken query → echo plain text).
// POST = body { value: [{ subscriptionId, clientState, resource, changeType, ... }] }.
// On match clientState contre webhook_client_state.
export async function handleOutlookWebhook(request: Request, env: Env): Promise<Response> {
  const logger = createLogger(env);
  try {
    const url = new URL(request.url);
    // Handshake Microsoft : GET ?validationToken=... → echo plain text.
    if (request.method === 'GET') {
      const validationToken = url.searchParams.get('validationToken');
      if (validationToken) {
        return new Response(validationToken, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      return new Response(null, { status: 400 });
    }

    // POST notification.
    const body = (await request.json().catch(() => null)) as
      | { value?: Array<{ subscriptionId?: string; clientState?: string; resource?: string }> }
      | null;
    if (!body || !Array.isArray(body.value)) {
      return new Response(null, { status: 202 });
    }

    for (const notif of body.value) {
      const subscriptionId = notif.subscriptionId || '';
      const clientState = notif.clientState || '';
      if (!subscriptionId) continue;

      const conn = (await env.DB.prepare(
        `SELECT id, webhook_client_state FROM calendar_connections
          WHERE webhook_channel_id = ? AND status = 'active' LIMIT 1`,
      )
        .bind(subscriptionId)
        .first()) as { id: string; webhook_client_state: string | null } | null;

      if (!conn) continue;
      if (conn.webhook_client_state && conn.webhook_client_state !== clientState) {
        logger.warn('calendar.webhook.outlook.client_state_mismatch', { subscription_id: subscriptionId });
        continue;
      }

      // Fire-and-forget pull.
      void pullExternalToAppointments(env, conn.id).catch(() => {
        /* logged inside */
      });
    }

    return new Response(null, { status: 202 });
  } catch (e: any) {
    logger.error('calendar.webhook.outlook.error', { error: e?.message });
    return new Response(null, { status: 202 });
  }
}
