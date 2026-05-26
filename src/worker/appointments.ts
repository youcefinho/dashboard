// ── Module Appointments — Intralys CRM ──────────────────────
import type { Env } from './types';
import { sanitizeInput, json } from './helpers';
import { autoEnrollForTrigger } from './workflows';
// S4 M2 — validation d'entrée (schémas additifs, import only).
import { validate, createAppointmentSchemaS4, updateAppointmentSchemaS4 } from '../lib/schemas';
import { validationError } from './lib/validate-response';
// Sprint P0-2 — helpers PURS partagés (validateSlot pre-INSERT additif).
import { validateSlot, BOOKING_ERROR_CODES } from './lib/booking-engine';

export async function handleGetAppointments(
  env: Env,
  _auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const clientId = url.searchParams.get('client_id');

  let query = `SELECT a.*, l.name as lead_name, c.name as client_name
    FROM appointments a
    LEFT JOIN leads l ON a.lead_id = l.id
    LEFT JOIN clients c ON a.client_id = c.id
    WHERE 1=1`;
  const params: string[] = [];

  if (start) { query += ' AND a.start_time >= ?'; params.push(start); }
  if (end) { query += ' AND a.start_time <= ?'; params.push(end); }
  if (clientId) { query += ' AND a.client_id = ?'; params.push(clientId); }

  query += ' ORDER BY a.start_time ASC LIMIT 200';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return json({ data: results || [] });
}

export async function handleCreateAppointment(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  // S4 M2 — validation d'entrée AVANT la logique (early-return additif).
  const parsed = await request.json().catch(() => null);
  const va = validate(createAppointmentSchemaS4, parsed);
  if (!va.success) return validationError(va.error);
  const body = va.data as Record<string, unknown>;
  const title = sanitizeInput(body.title as string, 200);
  const description = sanitizeInput(body.description as string, 1000) || '';
  const startTime = sanitizeInput(body.start_time as string, 30);
  const endTime = sanitizeInput(body.end_time as string, 30);
  const location = sanitizeInput(body.location as string, 300) || '';
  const type = sanitizeInput(body.type as string, 20) || 'meeting';
  const clientId = sanitizeInput(body.client_id as string, 100);

  const calendarId = body.calendar_id ? String(body.calendar_id) : null;
  const assigneeUserId = body.assignee_user_id ? String(body.assignee_user_id) : null;
  const attendeesJson = body.attendees ? JSON.stringify(body.attendees) : '[]';
  const conferenceLink = body.conference_link ? sanitizeInput(String(body.conference_link), 300) : null;
  const recurringRule = body.recurring_rule ? sanitizeInput(String(body.recurring_rule), 100) : null;
  const reminderMinutes = body.reminder_minutes !== undefined ? Number(body.reminder_minutes) : 60;
  const bufferBefore = body.buffer_before_min !== undefined ? Number(body.buffer_before_min) : 0;
  const bufferAfter = body.buffer_after_min !== undefined ? Number(body.buffer_after_min) : 0;

  if (!title || !startTime || !endTime) {
    return json({ error: 'Titre, heure de début et de fin requis' }, 400);
  }

  const VALID_TYPES = ['meeting', 'call', 'visit', 'signing', 'other'];
  if (!VALID_TYPES.includes(type)) {
    return json({ error: 'Type de RDV invalide' }, 400);
  }

  // Sprint P0-2 — validation slot canonique (start<end + durée 15..480min).
  // Additif : si invalide on rejette AVANT INSERT. Ne casse PAS les payloads
  // existants qui étaient déjà valides (toute durée >= 15min reste OK).
  const slotCheck = validateSlot({ startAt: startTime, endAt: endTime });
  if (!slotCheck.ok) {
    return json({ error: `Créneau invalide (${slotCheck.error || BOOKING_ERROR_CODES.SLOT_INVALID})` }, 400);
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO appointments (id, lead_id, client_id, title, description, start_time, end_time, location, type, calendar_id, assignee_user_id, attendees_json, conference_link, recurring_rule, reminder_minutes, buffer_before_min, buffer_after_min)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, body.lead_id as string || null, clientId || '', title, description, startTime, endTime, location, type,
    calendarId, assigneeUserId, attendeesJson, conferenceLink, recurringRule, reminderMinutes, bufferBefore, bufferAfter
  ).run();

  // Log d'activité si lié à un lead
  if (body.lead_id) {
    await env.DB.prepare(
      `INSERT INTO activity_log (lead_id, client_id, user_id, action, details)
       VALUES (?, ?, ?, 'appointment_created', ?)`
    ).bind(body.lead_id as string, clientId || '', auth.userId, JSON.stringify({ appointment_id: id, title })).run();
    
    // Workflow Trigger
    await autoEnrollForTrigger(env, 'appointment_booked', body.lead_id as string);
  }

  // Webhook event
  if (clientId) {
    try {
      const { publishEvent } = await import('./webhooks-dispatch');
      const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(id).first();
      if (appt) {
        publishEvent(env, clientId, 'appointment.created', appt);
      }
    } catch (e) {
      console.error('Webhook error:', e);
    }
  }

  // ── Sprint 33 — Calendar sync push (best-effort, fire-and-forget) ─────────
  // Push CRM → externes connectés (GCal/Outlook). NE THROW JAMAIS. Aucun ctx
  // dispo dans cette signature → fire-and-forget standard. L'engine gère
  // l'anti-loop (last_synced_at > now-30s) et les erreurs par provider.
  try {
    const { pushAppointmentToExternal } = await import('./calendar-sync');
    void pushAppointmentToExternal(env, { clientId } as any, id, 'create').catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }

  return json({ data: { id } }, 201);
}

export async function handleUpdateAppointment(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  appointmentId: string
): Promise<Response> {
  // S4 M2 — validation d'entrée AVANT la logique (early-return additif).
  const parsed = await request.json().catch(() => null);
  const va = validate(updateAppointmentSchemaS4, parsed);
  if (!va.success) return validationError(va.error);
  const body = va.data as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | null)[] = [];

  if (body.title) { updates.push('title = ?'); params.push(sanitizeInput(body.title as string, 200)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description as string, 1000)); }
  if (body.start_time) { updates.push('start_time = ?'); params.push(sanitizeInput(body.start_time as string, 30)); }
  if (body.end_time) { updates.push('end_time = ?'); params.push(sanitizeInput(body.end_time as string, 30)); }
  if (body.location !== undefined) { updates.push('location = ?'); params.push(sanitizeInput(body.location as string, 300)); }
  if (body.type) { updates.push('type = ?'); params.push(sanitizeInput(body.type as string, 20)); }
  if (body.status) {
    const VALID_STATUSES = ['scheduled', 'confirmed', 'cancelled', 'completed', 'no_show'];
    const status = sanitizeInput(body.status as string, 20);
    if (status && VALID_STATUSES.includes(status)) {
      updates.push('status = ?');
      params.push(status);
    }
  }
  if (body.notes !== undefined) { updates.push('notes = ?'); params.push(sanitizeInput(body.notes as string, 2000)); }
  if (body.calendar_id !== undefined) { updates.push('calendar_id = ?'); params.push(body.calendar_id ? String(body.calendar_id) : null); }
  if (body.assignee_user_id !== undefined) { updates.push('assignee_user_id = ?'); params.push(body.assignee_user_id ? String(body.assignee_user_id) : null); }
  if (body.attendees !== undefined) { updates.push('attendees_json = ?'); params.push(JSON.stringify(body.attendees)); }
  if (body.conference_link !== undefined) { updates.push('conference_link = ?'); params.push(body.conference_link ? sanitizeInput(String(body.conference_link), 300) : null); }
  if (body.recurring_rule !== undefined) { updates.push('recurring_rule = ?'); params.push(body.recurring_rule ? sanitizeInput(String(body.recurring_rule), 100) : null); }
  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(appointmentId);

  await env.DB.prepare(
    `UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  // ── Sprint 33 — Calendar sync push (best-effort, fire-and-forget) ─────────
  // Push CRM → externes. action='cancel' si nouveau status=cancelled, sinon
  // 'update'. clientId résolu via SELECT (l'auth ici n'a pas clientId direct).
  try {
    const apptForSync = await env.DB.prepare('SELECT client_id FROM appointments WHERE id = ?').bind(appointmentId).first() as { client_id: string | null } | null;
    const syncClientId = apptForSync?.client_id || '';
    if (syncClientId) {
      const isCancel = body.status === 'cancelled';
      const { pushAppointmentToExternal } = await import('./calendar-sync');
      void pushAppointmentToExternal(env, { clientId: syncClientId } as any, appointmentId, isCancel ? 'cancel' : 'update').catch(() => { /* best-effort */ });
    }
  } catch { /* best-effort */ }

  // Log si changement de statut
  if (body.status) {
    const appt = await env.DB.prepare('SELECT lead_id, client_id, title FROM appointments WHERE id = ?').bind(appointmentId).first() as { lead_id: string | null; client_id: string; title: string } | null;
    if (appt?.lead_id) {
      await env.DB.prepare(
        `INSERT INTO activity_log (lead_id, client_id, user_id, action, details)
         VALUES (?, ?, ?, 'appointment_updated', ?)`
      ).bind(appt.lead_id, appt.client_id, auth.userId, JSON.stringify({ appointment_id: appointmentId, status: body.status, title: appt.title })).run();
      
      if (body.status === 'cancelled') {
        await autoEnrollForTrigger(env, 'appointment_cancelled', appt.lead_id);
        // Webhook event
        try {
          const { publishEvent } = await import('./webhooks-dispatch');
          const fullAppt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(appointmentId).first();
          if (fullAppt) {
            publishEvent(env, appt.client_id, 'appointment.cancelled', fullAppt);
          }
        } catch (e) {
          console.error('Webhook error:', e);
        }
      }
      if (body.status === 'no_show') await autoEnrollForTrigger(env, 'appointment_no_show', appt.lead_id);
    }
  }

  return json({ data: { success: true } });
}

export async function handleDeleteAppointment(
  env: Env,
  auth: { userId: string; role: string },
  appointmentId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  await env.DB.prepare('DELETE FROM appointments WHERE id = ?').bind(appointmentId).run();

  return json({ data: { success: true } });
}

export async function handleRescheduleAppointment(
  request: Request, env: Env, auth: { userId: string }, appointmentId: string
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  if (!body.start_time || !body.end_time) return json({ error: 'start_time et end_time requis' }, 400);

  await env.DB.prepare(
    "UPDATE appointments SET start_time = ?, end_time = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(String(body.start_time), String(body.end_time), appointmentId).run();

  const appt = await env.DB.prepare('SELECT lead_id, client_id, title FROM appointments WHERE id = ?').bind(appointmentId).first() as { lead_id: string | null; client_id: string; title: string } | null;
  if (appt?.lead_id) {
    await env.DB.prepare(
      `INSERT INTO activity_log (lead_id, client_id, user_id, action, details) VALUES (?, ?, ?, 'appointment_rescheduled', ?)`
    ).bind(appt.lead_id, appt.client_id, auth.userId, JSON.stringify({ appointment_id: appointmentId, title: appt.title })).run();
  }

  // ── Sprint 33 — Calendar sync push (best-effort, fire-and-forget) ─────────
  // action='reschedule' → PATCH event externe avec nouveaux start/end.
  try {
    const syncClientId = appt?.client_id || '';
    if (syncClientId) {
      const { pushAppointmentToExternal } = await import('./calendar-sync');
      void pushAppointmentToExternal(env, { clientId: syncClientId } as any, appointmentId, 'reschedule').catch(() => { /* best-effort */ });
    }
  } catch { /* best-effort */ }

  return json({ data: { success: true } });
}

export async function handleSendReminderNow(env: Env, _auth: { userId: string }, appointmentId: string): Promise<Response> {
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(appointmentId).first() as Record<string, unknown>;
  if (!appt) return json({ error: 'Introuvable' }, 404);
  
  // Simulation d'envoi de rappel manuel (Email/SMS). A implémenter plus tard dans Phase C / D.
  if (appt.lead_id) {
    await env.DB.prepare(
      `INSERT INTO activity_log (lead_id, client_id, user_id, action, details) VALUES (?, ?, ?, 'appointment_reminder_sent', ?)`
    ).bind(appt.lead_id as string, appt.client_id as string, _auth.userId, JSON.stringify({ appointment_id: appointmentId })).run();
  }
  return json({ data: { success: true } });
}
