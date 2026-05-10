// ── Module Custom Fields + Smart Lists — Intralys CRM ───────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';

// ── Custom Fields : définitions ─────────────────────────────

export async function handleGetCustomFields(
  env: Env, _auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  const clientId = url.searchParams.get('client_id') || '';
  let query = 'SELECT * FROM custom_field_defs';
  const params: string[] = [];

  if (clientId) {
    query += ' WHERE client_id = ?';
    params.push(clientId);
  }
  query += ' ORDER BY sort_order ASC, created_at ASC';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

export async function handleCreateCustomField(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as {
    client_id: string; name: string; field_type: string;
    options?: string[]; is_required?: boolean; sort_order?: number;
  };

  if (!body.client_id || !body.name || !body.field_type) {
    return json({ error: 'client_id, name et field_type requis' }, 400);
  }

  const allowedTypes = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'url', 'phone', 'email'];
  if (!allowedTypes.includes(body.field_type)) {
    return json({ error: `field_type invalide. Valeurs : ${allowedTypes.join(', ')}` }, 400);
  }

  const id = crypto.randomUUID();
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');

  await env.DB.prepare(
    'INSERT INTO custom_field_defs (id, client_id, name, slug, field_type, options, is_required, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, body.client_id, sanitizeInput(body.name, 100), slug, body.field_type,
    JSON.stringify(body.options || []), body.is_required ? 1 : 0, body.sort_order || 0
  ).run();

  await audit(env, auth.userId, 'custom_field.create', 'custom_field', id, { name: body.name });
  return json({ data: { id, slug } }, 201);
}

export async function handleUpdateCustomField(
  request: Request, env: Env, auth: { userId: string; role: string }, fieldId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as {
    name?: string; options?: string[]; is_required?: boolean; sort_order?: number;
  };

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name !== undefined) { updates.push('name = ?'); params.push(sanitizeInput(body.name, 100)); }
  if (body.options !== undefined) { updates.push('options = ?'); params.push(JSON.stringify(body.options)); }
  if (body.is_required !== undefined) { updates.push('is_required = ?'); params.push(body.is_required ? 1 : 0); }
  if (body.sort_order !== undefined) { updates.push('sort_order = ?'); params.push(body.sort_order); }

  if (updates.length === 0) return json({ error: 'Aucun champ à modifier' }, 400);

  params.push(fieldId);
  await env.DB.prepare(`UPDATE custom_field_defs SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  return json({ data: { success: true } });
}

export async function handleDeleteCustomField(
  env: Env, auth: { userId: string; role: string }, fieldId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  await env.DB.prepare('DELETE FROM custom_field_values WHERE field_id = ?').bind(fieldId).run();
  await env.DB.prepare('DELETE FROM custom_field_defs WHERE id = ?').bind(fieldId).run();

  await audit(env, auth.userId, 'custom_field.delete', 'custom_field', fieldId);
  return json({ data: { success: true } });
}

// ── Custom Fields : valeurs par lead ────────────────────────

export async function handleGetLeadCustomFields(
  env: Env, _auth: { userId: string; role: string }, leadId: string
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT cfv.field_id, cfv.value, cfd.name, cfd.slug, cfd.field_type, cfd.options
     FROM custom_field_values cfv
     JOIN custom_field_defs cfd ON cfd.id = cfv.field_id
     WHERE cfv.lead_id = ?
     ORDER BY cfd.sort_order ASC`
  ).bind(leadId).all();

  return json({ data: results || [] });
}

export async function handleSetLeadCustomFields(
  request: Request, env: Env, auth: { userId: string; role: string }, leadId: string
): Promise<Response> {
  const body = await request.json() as { fields: Array<{ field_id: string; value: string }> };

  if (!body.fields || !Array.isArray(body.fields)) {
    return json({ error: 'fields (array de {field_id, value}) requis' }, 400);
  }

  for (const field of body.fields) {
    await env.DB.prepare(
      'INSERT INTO custom_field_values (lead_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(lead_id, field_id) DO UPDATE SET value = ?'
    ).bind(leadId, field.field_id, sanitizeInput(field.value, 1000), sanitizeInput(field.value, 1000)).run();
  }

  await audit(env, auth.userId, 'lead.custom_fields.update', 'lead', leadId, {
    count: body.fields.length,
  });
  return json({ data: { success: true, updated: body.fields.length } });
}

// ── Smart Lists ─────────────────────────────────────────────

export async function handleGetSmartLists(
  env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM smart_lists WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(auth.userId).all();

  return json({ data: results || [] });
}

export async function handleCreateSmartList(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  const body = await request.json() as {
    name: string; client_id?: string; filters: Record<string, unknown>;
  };

  if (!body.name || !body.filters) {
    return json({ error: 'name et filters requis' }, 400);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO smart_lists (id, user_id, client_id, name, filters) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, auth.userId, body.client_id || '', sanitizeInput(body.name, 100), JSON.stringify(body.filters)).run();

  return json({ data: { id } }, 201);
}

export async function handleDeleteSmartList(
  env: Env, auth: { userId: string; role: string }, listId: string
): Promise<Response> {
  await env.DB.prepare(
    'DELETE FROM smart_lists WHERE id = ? AND user_id = ?'
  ).bind(listId, auth.userId).run();

  return json({ data: { success: true } });
}

export async function handleExecuteSmartList(
  env: Env, auth: { userId: string; role: string }, listId: string, url: URL
): Promise<Response> {
  const list = await env.DB.prepare(
    'SELECT filters, client_id FROM smart_lists WHERE id = ? AND user_id = ?'
  ).bind(listId, auth.userId).first() as { filters: string; client_id: string } | null;

  if (!list) return json({ error: 'Smart list non trouvée' }, 404);

  const filters = JSON.parse(list.filters) as Record<string, unknown>;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = 'SELECT * FROM leads WHERE 1=1';
  const params: (string | number)[] = [];

  if (list.client_id) {
    query += ' AND client_id = ?';
    params.push(list.client_id);
  }

  const allowedStringFields = ['status', 'type', 'source', 'client_id'];
  for (const field of allowedStringFields) {
    const val = filters[field];
    if (typeof val === 'string' && val) {
      query += ` AND ${field} = ?`;
      params.push(val);
    }
    if (Array.isArray(val) && val.length > 0) {
      const placeholders = val.map(() => '?').join(',');
      query += ` AND ${field} IN (${placeholders})`;
      params.push(...(val as string[]));
    }
  }

  if (typeof filters.score_min === 'number') {
    query += ' AND CAST(score AS INTEGER) >= ?';
    params.push(filters.score_min as number);
  }
  if (typeof filters.score_max === 'number') {
    query += ' AND CAST(score AS INTEGER) <= ?';
    params.push(filters.score_max as number);
  }
  if (typeof filters.created_after === 'string') {
    query += ' AND created_at >= ?';
    params.push(filters.created_after as string);
  }
  if (typeof filters.created_before === 'string') {
    query += ' AND created_at <= ?';
    params.push(filters.created_before as string);
  }

  if (typeof filters.tag === 'string' && filters.tag) {
    query += ' AND tags LIKE ?';
    params.push(`%${filters.tag}%`);
  }

  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const countStmt = env.DB.prepare(countQuery);
  const countResult = params.length > 0
    ? await countStmt.bind(...params).first() as { total: number }
    : await countStmt.first() as { total: number };

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return json({
    data: results || [],
    total: countResult?.total || 0,
    filters,
  });
}
