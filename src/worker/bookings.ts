// ── Module Bookings — Intralys CRM ──────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit, createNotification } from './helpers';

export async function handlePublicBookingPage(env: Env, url: URL): Promise<Response> {
  const slug = url.pathname.replace('/api/book/', '');
  if (!slug) return json({ error: 'Slug requis' }, 400);
  const page = await env.DB.prepare(
    'SELECT * FROM booking_pages WHERE slug = ? AND is_active = 1'
  ).bind(slug).first() as Record<string, unknown> | null;
  if (!page) return json({ error: 'Page non trouvée' }, 404);
  const today = new Date().toISOString().split('T')[0];
  const { results: booked } = await env.DB.prepare(
    "SELECT start_time, end_time FROM bookings WHERE booking_page_id = ? AND status = 'confirmed' AND start_time >= ?"
  ).bind(page.id as string, today).all();
  return json({ data: { page, booked_slots: booked || [] } });
}

export async function handlePublicCreateBooking(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    booking_page_id?: string; guest_name?: string; guest_email?: string;
    guest_phone?: string; start_time?: string; notes?: string;
  };
  if (!body.booking_page_id || !body.guest_name || !body.guest_email || !body.start_time) {
    return json({ error: 'booking_page_id, guest_name, guest_email et start_time requis' }, 400);
  }
  const page = await env.DB.prepare(
    'SELECT * FROM booking_pages WHERE id = ? AND is_active = 1'
  ).bind(body.booking_page_id).first() as Record<string, unknown> | null;
  if (!page) return json({ error: 'Page non trouvée' }, 404);

  const duration = (page.duration_minutes as number) || 30;
  const startTime = new Date(body.start_time);
  const endTime = new Date(startTime.getTime() + duration * 60000);

  const conflict = await env.DB.prepare(
    "SELECT id FROM bookings WHERE booking_page_id = ? AND status = 'confirmed' AND start_time < ? AND end_time > ?"
  ).bind(body.booking_page_id, endTime.toISOString(), startTime.toISOString()).first();
  if (conflict) return json({ error: 'Ce créneau est déjà réservé' }, 409);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO bookings (id, booking_page_id, client_id, guest_name, guest_email, guest_phone, start_time, end_time, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.booking_page_id, page.client_id as string,
    sanitizeInput(body.guest_name, 100), sanitizeInput(body.guest_email, 200).toLowerCase(),
    sanitizeInput(body.guest_phone || '', 30), startTime.toISOString(), endTime.toISOString(),
    sanitizeInput(body.notes || '', 500)).run();

  const leadId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, source, status, pipeline_id, stage_id)
     VALUES (?, ?, ?, ?, ?, 'booking', 'qualified', 'pipeline-default', 'stage-qualified')`
  ).bind(leadId, page.client_id as string, sanitizeInput(body.guest_name, 100),
    sanitizeInput(body.guest_email, 200).toLowerCase(), sanitizeInput(body.guest_phone || '', 30)).run();

  const { results: admins } = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all();
  for (const admin of (admins || []) as Array<{ id: string }>) {
    await createNotification(env, admin.id, '📅 Nouveau RDV', `${body.guest_name} — ${startTime.toLocaleDateString('fr-CA')}`, '📅', '', page.client_id as string);
  }

  return json({ data: { id, start_time: startTime.toISOString(), end_time: endTime.toISOString(), confirmation: page.confirmation_message } }, 201);
}

export async function handleGetBookingPages(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const { results } = await env.DB.prepare('SELECT * FROM booking_pages ORDER BY created_at DESC').all();
  return json({ data: results || [] });
}

export async function handleCreateBookingPage(request: Request, env: Env, auth: { role: string; userId: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;
  if (!body.client_id || !body.title || !body.slug) return json({ error: 'client_id, title et slug requis' }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO booking_pages (id, client_id, slug, title, description, duration_minutes, color) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.client_id as string, sanitizeInput(body.slug as string, 50), sanitizeInput(body.title as string, 200),
    sanitizeInput((body.description || '') as string, 500), (body.duration_minutes as number) || 30, (body.color || '#6366f1') as string).run();
  await audit(env, auth.userId, 'booking_page.create', 'booking_page', id);
  return json({ data: { id } }, 201);
}

export async function handleUpdateBookingPage(request: Request, env: Env, auth: { role: string; userId: string }, pageId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;
  const u: string[] = []; const p: (string | number)[] = [];
  if (body.title) { u.push('title = ?'); p.push(sanitizeInput(body.title as string, 200)); }
  if (body.description !== undefined) { u.push('description = ?'); p.push(sanitizeInput(body.description as string, 500)); }
  if (body.duration_minutes) { u.push('duration_minutes = ?'); p.push(body.duration_minutes as number); }
  if (body.is_active !== undefined) { u.push('is_active = ?'); p.push(body.is_active as number); }
  if (body.available_days) { u.push('available_days = ?'); p.push(JSON.stringify(body.available_days)); }
  if (body.available_hours) { u.push('available_hours = ?'); p.push(JSON.stringify(body.available_hours)); }
  if (u.length === 0) return json({ error: 'Aucune modification' }, 400);
  u.push("updated_at = datetime('now')"); p.push(pageId);
  await env.DB.prepare(`UPDATE booking_pages SET ${u.join(', ')} WHERE id = ?`).bind(...p).run();
  await audit(env, auth.userId, 'booking_page.update', 'booking_page', pageId);
  return json({ data: { success: true } });
}

export async function handleDeleteBookingPage(env: Env, auth: { role: string; userId: string }, pageId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  await env.DB.prepare('DELETE FROM bookings WHERE booking_page_id = ?').bind(pageId).run();
  await env.DB.prepare('DELETE FROM booking_pages WHERE id = ?').bind(pageId).run();
  await audit(env, auth.userId, 'booking_page.delete', 'booking_page', pageId);
  return json({ data: { success: true } });
}

export async function handleGetBookings(env: Env, auth: { role: string }, pageId: string, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const status = url.searchParams.get('status');
  let q = 'SELECT * FROM bookings WHERE booking_page_id = ?';
  const p: string[] = [pageId];
  if (status) { q += ' AND status = ?'; p.push(status); }
  q += ' ORDER BY start_time DESC LIMIT 100';
  const { results } = await env.DB.prepare(q).bind(...p).all();
  return json({ data: results || [] });
}
