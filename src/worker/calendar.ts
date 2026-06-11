// ── Module Calendar — Intralys CRM ──────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';

// ── CRUD Calendars ──────────────────────────────────────────

export async function handleGetCalendars(env: Env, auth: { userId: string }): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM calendars WHERE user_id = ? ORDER BY created_at ASC'
  ).bind(auth.userId).all();
  return json({ data: results || [] });
}

export async function handleCreateCalendar(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  if (!name) return json({ error: 'Nom requis' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO calendars (id, user_id, client_id, name, color, is_default, is_visible) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, auth.userId, body.client_id ? String(body.client_id) : null, name,
    sanitizeInput((body.color as string) || '#635BFF', 20),
    body.is_default ? 1 : 0, body.is_visible !== false ? 1 : 0
  ).run();

  await audit(env, auth.userId, 'calendar.create', 'calendar', id);
  return json({ data: { id } }, 201);
}

export async function handleUpdateCalendar(request: Request, env: Env, auth: { userId: string }, calendarId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name as string, 100)); }
  if (body.color) { updates.push('color = ?'); params.push(sanitizeInput(body.color as string, 20)); }
  if (body.is_default !== undefined) { updates.push('is_default = ?'); params.push(body.is_default ? 1 : 0); }
  if (body.is_visible !== undefined) { updates.push('is_visible = ?'); params.push(body.is_visible ? 1 : 0); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
  params.push(calendarId, auth.userId);

  await env.DB.prepare(`UPDATE calendars SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  return json({ data: { success: true } });
}

export async function handleDeleteCalendar(env: Env, auth: { userId: string }, calendarId: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM calendars WHERE id = ? AND user_id = ?').bind(calendarId, auth.userId).run();
  return json({ data: { success: true } });
}

// ── CRUD Availability Rules ─────────────────────────────────

export async function handleGetAvailabilityRules(env: Env, auth: { userId: string }): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM availability_rules WHERE user_id = ? ORDER BY day_of_week ASC').bind(auth.userId).all();
  return json({ data: results || [] });
}

export async function handleCreateAvailabilityRule(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  if (body.day_of_week === undefined || !body.start_time || !body.end_time) {
    return json({ error: 'day_of_week, start_time et end_time requis' }, 400);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO availability_rules (id, user_id, day_of_week, start_time, end_time, is_active) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    id, auth.userId, Number(body.day_of_week), String(body.start_time), String(body.end_time), body.is_active !== false ? 1 : 0
  ).run();
  return json({ data: { id } }, 201);
}

export async function handleDeleteAvailabilityRule(env: Env, auth: { userId: string }, ruleId: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM availability_rules WHERE id = ? AND user_id = ?').bind(ruleId, auth.userId).run();
  return json({ data: { success: true } });
}

// ── CRUD Date Overrides ─────────────────────────────────────

export async function handleGetDateOverrides(env: Env, auth: { userId: string }): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM date_overrides WHERE user_id = ? ORDER BY date ASC').bind(auth.userId).all();
  return json({ data: results || [] });
}

export async function handleCreateDateOverride(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  if (!body.date) return json({ error: 'date requise' }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO date_overrides (id, user_id, date, is_available, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, auth.userId, String(body.date), body.is_available ? 1 : 0, sanitizeInput(String(body.reason || ''), 200)).run();
  return json({ data: { id } }, 201);
}

export async function handleDeleteDateOverride(env: Env, auth: { userId: string }, overrideId: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM date_overrides WHERE id = ? AND user_id = ?').bind(overrideId, auth.userId).run();
  return json({ data: { success: true } });
}

// ── Availability Engine ─────────────────────────────────────

export async function handleGetAvailability(env: Env, url: URL): Promise<Response> {
  const userId = url.searchParams.get('user_id');
  const dateStr = url.searchParams.get('date'); // YYYY-MM-DD
  if (!userId || !dateStr) return json({ error: 'user_id et date requis' }, 400);

  const d = new Date(dateStr);
  const dayOfWeek = d.getDay(); // 0 = Sun, 1 = Mon

  // 1. Vérifier override
  const override = await env.DB.prepare('SELECT * FROM date_overrides WHERE user_id = ? AND date = ?').bind(userId, dateStr).first() as { is_available: number } | null;
  if (override && override.is_available === 0) return json({ data: { slots: [] } });

  // 2. Récupérer rules
  const { results: rules } = await env.DB.prepare(
    'SELECT start_time, end_time FROM availability_rules WHERE user_id = ? AND day_of_week = ? AND is_active = 1'
  ).bind(userId, dayOfWeek).all();
  if (!rules || rules.length === 0) return json({ data: { slots: [] } });

  // 3. Récupérer appointments existants pour calculer la dispo
  const { results: appts } = await env.DB.prepare(
    "SELECT start_time, end_time FROM appointments WHERE assignee_user_id = ? AND status IN ('confirmed', 'scheduled') AND start_time LIKE ?"
  ).bind(userId, `${dateStr}%`).all();

  // On va simplifier: on renvoie juste les slots disponibles (par pas de 30min).
  // Dans un cas réel, on soustrait appts des rules.
  // Stub complet à faire en frontend ou ici
  const slots: string[] = [];
  for (const rule of (rules as Array<{ start_time: string; end_time: string }>)) {
    let current = new Date(`${dateStr}T${rule.start_time}:00Z`);
    const end = new Date(`${dateStr}T${rule.end_time}:00Z`);
    while (current < end) {
      const slotTime = current.toISOString();
      const conflict = (appts as Array<{ start_time: string; end_time: string }>).some(a => {
        const aStart = new Date(a.start_time + 'Z');
        const aEnd = new Date(a.end_time + 'Z');
        return current >= aStart && current < aEnd;
      });
      if (!conflict) slots.push(slotTime);
      current = new Date(current.getTime() + 30 * 60000);
    }
  }

  return json({ data: { slots } });
}

// ── iCal Feed ───────────────────────────────────────────────

export async function handleGetICalFeed(env: Env, userId: string): Promise<Response> {
  const { results: appts } = await env.DB.prepare(
    "SELECT title, description, start_time, end_time, location FROM appointments WHERE assignee_user_id = ? AND status IN ('scheduled', 'confirmed')"
  ).bind(userId).all();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Intralys//CRM//FR'
  ];

  for (const appt of (appts as any[]) || []) {
    lines.push('BEGIN:VEVENT');
    lines.push(`SUMMARY:${appt.title}`);
    lines.push(`DESCRIPTION:${(appt.description || '').replace(/\n/g, '\\n')}`);
    lines.push(`DTSTART:${new Date(appt.start_time + 'Z').toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
    lines.push(`DTEND:${new Date(appt.end_time + 'Z').toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
    if (appt.location) lines.push(`LOCATION:${appt.location}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="calendar-${userId}.ics"`,
    }
  });
}
