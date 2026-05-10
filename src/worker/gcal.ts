// ── Module Google Calendar — Intralys CRM ───────────────────
import type { Env } from './types';
import { json, audit } from './helpers';

async function getGcalAccessToken(env: Env, userId: string): Promise<string | null> {
  const user = await env.DB.prepare('SELECT permissions FROM users WHERE id = ?').bind(userId).first() as { permissions: string } | null;
  if (!user) return null;
  let perms: Record<string, unknown> = {};
  try { perms = JSON.parse(user.permissions); } catch { return null; }
  const tokensStr = perms.gcal_tokens as string;
  if (!tokensStr) return null;
  let tokens: { access_token: string; refresh_token: string; expires_at: string };
  try { tokens = JSON.parse(tokensStr); } catch { return null; }
  if (new Date(tokens.expires_at) > new Date()) return tokens.access_token;
  if (!tokens.refresh_token) return null;
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: tokens.refresh_token, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }),
  });
  const newTokens = await refreshRes.json() as { access_token?: string; expires_in?: number };
  if (!newTokens.access_token) return null;
  const updated = JSON.stringify({ access_token: newTokens.access_token, refresh_token: tokens.refresh_token, expires_at: new Date(Date.now() + (newTokens.expires_in || 3600) * 1000).toISOString() });
  await env.DB.prepare("UPDATE users SET permissions = json_set(COALESCE(permissions, '{}'), '$.gcal_tokens', ?) WHERE id = ?").bind(updated, userId).run();
  return newTokens.access_token;
}

export async function handleGcalAuthUrl(env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: 'GOOGLE_CLIENT_ID non configuré' }, 500);
  const scopes = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(env.GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(env.GOOGLE_REDIRECT_URI || '')}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;
  return json({ data: { auth_url: authUrl } });
}

export async function handleGcalCallback(env: Env, auth: { userId: string; role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const code = url.searchParams.get('code');
  if (!code) return json({ error: 'Code d\'autorisation manquant' }, 400);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.GOOGLE_REDIRECT_URI || '', grant_type: 'authorization_code' }),
  });
  const tokens = await tokenRes.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (tokens.error || !tokens.access_token) return json({ error: `Erreur Google: ${tokens.error || 'token manquant'}` }, 400);
  const tokenData = JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token || '', expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString() });
  await env.DB.prepare("UPDATE users SET permissions = json_set(COALESCE(permissions, '{}'), '$.gcal_tokens', ?) WHERE id = ?").bind(tokenData, auth.userId).run();
  await audit(env, auth.userId, 'gcal.connect', 'user', auth.userId);
  return json({ data: { connected: true } });
}

export async function handleGcalEvents(env: Env, auth: { userId: string; role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const token = await getGcalAccessToken(env, auth.userId);
  if (!token) return json({ error: 'Google Calendar non connecté' }, 401);
  const timeMin = url.searchParams.get('time_min') || new Date().toISOString();
  const timeMax = url.searchParams.get('time_max') || new Date(Date.now() + 30 * 86400000).toISOString();
  const maxResults = url.searchParams.get('max_results') || '50';
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json() as { items?: Array<Record<string, unknown>>; error?: unknown };
  if (data.error) return json({ error: 'Erreur Google Calendar', details: data.error }, 502);
  return json({ data: { events: data.items || [] } });
}

export async function handleGcalSync(env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const token = await getGcalAccessToken(env, auth.userId);
  if (!token) return json({ error: 'Google Calendar non connecté' }, 401);
  const { results: bookings } = await env.DB.prepare("SELECT b.*, bp.title as page_title FROM bookings b JOIN booking_pages bp ON b.booking_page_id = bp.id WHERE b.status = 'confirmed' AND b.start_time > datetime('now') ORDER BY b.start_time ASC LIMIT 50").all();
  let synced = 0;
  for (const booking of (bookings || []) as Array<Record<string, unknown>>) {
    const event = { summary: `RDV — ${booking.guest_name} (${booking.page_title})`, description: `Lead: ${booking.guest_email}\nTél: ${booking.guest_phone || 'N/A'}`, start: { dateTime: booking.start_time as string, timeZone: 'America/Toronto' }, end: { dateTime: booking.end_time as string, timeZone: 'America/Toronto' }, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] } };
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
    if (res.ok) synced++;
  }
  await audit(env, auth.userId, 'gcal.sync', 'booking', '', { synced, total: (bookings || []).length });
  return json({ data: { synced, total: (bookings || []).length } });
}
