// ── Module Appointments — Intralys CRM ──────────────────────
import type { Env } from './types';
import { sanitizeInput, json } from './helpers';

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
  const body = await request.json() as Record<string, unknown>;
  const title = sanitizeInput(body.title as string, 200);
  const description = sanitizeInput(body.description as string, 1000) || '';
  const startTime = sanitizeInput(body.start_time as string, 30);
  const endTime = sanitizeInput(body.end_time as string, 30);
  const location = sanitizeInput(body.location as string, 300) || '';
  const type = sanitizeInput(body.type as string, 20) || 'meeting';
  const clientId = sanitizeInput(body.client_id as string, 100);

  if (!title || !startTime || !endTime) {
    return json({ error: 'Titre, heure de début et de fin requis' }, 400);
  }

  const VALID_TYPES = ['meeting', 'call', 'visit', 'signing', 'other'];
  if (!VALID_TYPES.includes(type)) {
    return json({ error: 'Type de RDV invalide' }, 400);
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO appointments (id, lead_id, client_id, title, description, start_time, end_time, location, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.lead_id as string || null, clientId || '', title, description, startTime, endTime, location, type).run();

  // Log d'activité si lié à un lead
  if (body.lead_id) {
    await env.DB.prepare(
      `INSERT INTO activity_log (lead_id, client_id, user_id, action, details)
       VALUES (?, ?, ?, 'appointment_created', ?)`
    ).bind(body.lead_id as string, clientId || '', auth.userId, JSON.stringify({ appointment_id: id, title })).run();
  }

  return json({ data: { id } }, 201);
}

export async function handleUpdateAppointment(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  appointmentId: string
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
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

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(appointmentId);

  await env.DB.prepare(
    `UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  // Log si changement de statut
  if (body.status) {
    const appt = await env.DB.prepare('SELECT lead_id, client_id, title FROM appointments WHERE id = ?').bind(appointmentId).first() as { lead_id: string | null; client_id: string; title: string } | null;
    if (appt?.lead_id) {
      await env.DB.prepare(
        `INSERT INTO activity_log (lead_id, client_id, user_id, action, details)
         VALUES (?, ?, ?, 'appointment_updated', ?)`
      ).bind(appt.lead_id, appt.client_id, auth.userId, JSON.stringify({ appointment_id: appointmentId, status: body.status, title: appt.title })).run();
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
