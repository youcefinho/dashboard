// ── Sprint 51 M2 — CRUD Sources de leads (Settings) ──────────────────────────
import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';
import { generateSourceToken } from './leads';

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'source';
}

const ALLOWED_TYPES = ['webhook', 'zapier', 'custom'];
const ALLOWED_DEDUP = ['email', 'phone', 'email_phone', 'none'];
const ALLOWED_CONSENT = ['granted', 'unknown', 'denied'];

// GET /api/lead-sources — liste + dernier reçu
export async function handleGetLeadSources(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.client_id, s.name, s.source_key, s.token, s.type,
            s.mapping_json, s.dedup_strategy, s.consent_default, s.active,
            s.created_at, s.last_received_at, c.name AS client_name,
            (SELECT COUNT(*) FROM leads l WHERE l.lead_source_id = s.id) AS lead_count
       FROM lead_sources s
       LEFT JOIN clients c ON c.id = s.client_id
      ORDER BY s.created_at DESC`
  ).all();
  return json({ data: results || [] });
}

// GET /api/lead-sources/:id/leads — N derniers leads entrants de cette source
export async function handleGetLeadSourceLeads(
  env: Env, auth: { role: string }, sourceId: string, url: URL
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '15'), 50);
  const { results } = await env.DB.prepare(
    `SELECT id, name, email, phone, status, consent_status, utm_source, created_at
       FROM leads WHERE lead_source_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT ?`
  ).bind(sourceId, limit).all();
  return json({ data: results || [] });
}

// POST /api/lead-sources — créer (génère token)
export async function handleCreateLeadSource(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;

  const clientId = sanitizeInput(body.client_id as string, 100);
  const name = sanitizeInput(body.name as string, 120);
  if (!clientId) return json({ error: 'client_id requis' }, 400);
  if (!name) return json({ error: 'Nom requis' }, 400);

  const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return json({ error: 'Client introuvable' }, 404);

  const sourceKey = body.source_key
    ? slugify(sanitizeInput(body.source_key as string, 50))
    : slugify(name);
  const type = ALLOWED_TYPES.includes(body.type as string) ? body.type as string : 'webhook';
  const dedup = ALLOWED_DEDUP.includes(body.dedup_strategy as string)
    ? body.dedup_strategy as string : 'email_phone';
  const consentDefault = ALLOWED_CONSENT.includes(body.consent_default as string)
    ? body.consent_default as string : 'unknown';

  let mappingJson: string | null = null;
  if (body.mapping_json) {
    const raw = typeof body.mapping_json === 'string'
      ? body.mapping_json : JSON.stringify(body.mapping_json);
    try { JSON.parse(raw); mappingJson = raw; }
    catch { return json({ error: 'mapping_json invalide (JSON malformé)' }, 400); }
  }

  const id = crypto.randomUUID();
  const token = generateSourceToken();
  await env.DB.prepare(
    `INSERT INTO lead_sources
       (id, client_id, name, source_key, token, type, mapping_json, dedup_strategy, consent_default, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(id, clientId, name, sourceKey, token, type, mappingJson, dedup, consentDefault).run();

  await audit(env, auth.userId, 'lead_source.create', 'lead_source', id, { name, source_key: sourceKey, type });
  return json({ data: { id, token, source_key: sourceKey } }, 201);
}

// PATCH /api/lead-sources/:id — modifier (token jamais modifié ici)
export async function handleUpdateLeadSource(
  request: Request, env: Env, auth: { role: string; userId: string }, id: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); params.push(sanitizeInput(body.name as string, 120)); }
  if (body.source_key !== undefined) { sets.push('source_key = ?'); params.push(slugify(sanitizeInput(body.source_key as string, 50))); }
  if (body.type !== undefined && ALLOWED_TYPES.includes(body.type as string)) { sets.push('type = ?'); params.push(body.type); }
  if (body.dedup_strategy !== undefined && ALLOWED_DEDUP.includes(body.dedup_strategy as string)) { sets.push('dedup_strategy = ?'); params.push(body.dedup_strategy); }
  if (body.consent_default !== undefined && ALLOWED_CONSENT.includes(body.consent_default as string)) { sets.push('consent_default = ?'); params.push(body.consent_default); }
  if (body.active !== undefined) { sets.push('active = ?'); params.push(body.active ? 1 : 0); }
  if (body.mapping_json !== undefined) {
    if (body.mapping_json === null || body.mapping_json === '') {
      sets.push('mapping_json = NULL');
    } else {
      const raw = typeof body.mapping_json === 'string'
        ? body.mapping_json : JSON.stringify(body.mapping_json);
      try { JSON.parse(raw); } catch { return json({ error: 'mapping_json invalide (JSON malformé)' }, 400); }
      sets.push('mapping_json = ?'); params.push(raw);
    }
  }
  if (sets.length === 0) return json({ error: 'Aucune modification' }, 400);

  params.push(id);
  await env.DB.prepare(`UPDATE lead_sources SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  await audit(env, auth.userId, 'lead_source.update', 'lead_source', id);
  return json({ data: { success: true } });
}

// POST /api/lead-sources/:id/rotate-token — régénère le token
export async function handleRotateLeadSourceToken(
  env: Env, auth: { role: string; userId: string }, id: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const exists = await env.DB.prepare('SELECT id FROM lead_sources WHERE id = ?').bind(id).first();
  if (!exists) return json({ error: 'Source introuvable' }, 404);
  const token = generateSourceToken();
  await env.DB.prepare('UPDATE lead_sources SET token = ? WHERE id = ?').bind(token, id).run();
  await audit(env, auth.userId, 'lead_source.rotate_token', 'lead_source', id);
  return json({ data: { token } });
}

// DELETE /api/lead-sources/:id
export async function handleDeleteLeadSource(
  env: Env, auth: { role: string; userId: string }, id: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  await env.DB.prepare('DELETE FROM lead_sources WHERE id = ?').bind(id).run();
  await audit(env, auth.userId, 'lead_source.delete', 'lead_source', id);
  return json({ data: { success: true } });
}
