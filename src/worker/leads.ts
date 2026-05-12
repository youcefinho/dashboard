// ── Module Leads — Intralys CRM ─────────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit, corsHeaders, createNotification } from './helpers';

// Référence externe (injectée par le routeur principal)
let autoEnrollFn: ((env: Env, workflowId: string, leadId: string) => Promise<void>) | null = null;
export function setAutoEnroll(fn: (env: Env, workflowId: string, leadId: string) => Promise<void>): void {
  autoEnrollFn = fn;
}

export async function handleGetClients(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const { results } = await env.DB.prepare(
    `SELECT c.*, COUNT(l.id) as lead_count,
     SUM(CASE WHEN l.status = 'new' THEN 1 ELSE 0 END) as new_lead_count
     FROM clients c LEFT JOIN leads l ON c.id = l.client_id
     GROUP BY c.id ORDER BY c.created_at DESC`
  ).all();

  return json({ data: results || [] });
}

export async function handleCreateClient(request: Request, env: Env, auth: { role: string; userId: string }): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const email = sanitizeInput(body.email as string, 200);
  const phone = sanitizeInput(body.phone as string, 30);
  const siteUrl = sanitizeInput(body.site_url as string, 300);
  const city = sanitizeInput(body.city as string, 100);
  const banner = sanitizeInput(body.banner as string, 100);

  if (!name || !email) {
    return json({ error: 'Nom et email requis' }, 400);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO clients (id, name, email, phone, site_url, city, banner)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, email, phone, siteUrl, city, banner).run();

  await audit(env, auth.userId, 'client.create', 'client', id, { name, email });
  return json({ success: true, id }, 201);
}

export async function handleGetClientLeads(
  env: Env, auth: { role: string; userId: string }, clientId: string, url: URL
): Promise<Response> {
  if (auth.role === 'broker') {
    const { results: userCheck } = await env.DB.prepare(
      'SELECT client_id FROM users WHERE id = ?'
    ).bind(auth.userId).all();
    const userClientId = (userCheck?.[0] as { client_id: string } | undefined)?.client_id;
    if (userClientId !== clientId) {
      return json({ error: 'Accès non autorisé' }, 403);
    }
  }

  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');
  const search = url.searchParams.get('search');

  let query = 'SELECT * FROM leads WHERE client_id = ?';
  const params: string[] = [clientId];

  if (status && ['new', 'contacted', 'qualified', 'won', 'closed', 'lost'].includes(status)) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (type && ['inbound', 'qualified', 'customer'].includes(type)) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (search) {
    const cleanSearch = sanitizeInput(search, 100);
    query += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
    params.push(`%${cleanSearch}%`, `%${cleanSearch}%`, `%${cleanSearch}%`);
  }

  query += ' ORDER BY created_at DESC LIMIT 200';

  const stmt = env.DB.prepare(query);
  const { results } = await stmt.bind(...params).all();

  return json({ data: results || [] });
}

export async function handleGetLeads(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search');
  const source = url.searchParams.get('source');
  const clientId = url.searchParams.get('client_id');
  const sort = url.searchParams.get('sort') || 'newest';
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let query = `SELECT l.*, c.name as client_name FROM leads l
               LEFT JOIN clients c ON l.client_id = c.id WHERE 1=1`;
  const params: (string | number)[] = [];

  if (status && ['new', 'contacted', 'qualified', 'won', 'closed', 'lost'].includes(status)) {
    query += ' AND l.status = ?';
    params.push(status);
  }
  if (source) {
    query += ' AND l.source = ?';
    params.push(sanitizeInput(source, 50));
  }
  if (clientId) {
    query += ' AND l.client_id = ?';
    params.push(sanitizeInput(clientId, 100));
  }
  if (search) {
    const cleanSearch = sanitizeInput(search, 100);
    query += ' AND (l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)';
    params.push(`%${cleanSearch}%`, `%${cleanSearch}%`, `%${cleanSearch}%`);
  }

  // Cursor-based pagination
  if (cursor) {
    if (sort === 'oldest') {
      query += ' AND l.created_at > ?';
    } else {
      query += ' AND l.created_at < ?';
    }
    params.push(cursor);
  }

  if (sort === 'oldest') {
    query += ' ORDER BY l.created_at ASC';
  } else if (sort === 'name') {
    query += ' ORDER BY l.name ASC';
  } else {
    query += ' ORDER BY l.created_at DESC';
  }
  query += ' LIMIT ?';
  params.push(limit + 1);

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  const items = (results || []) as Array<Record<string, unknown>>;

  let nextCursor: string | null = null;
  if (items.length > limit) {
    items.pop();
    const lastItem = items[items.length - 1];
    if (lastItem) nextCursor = lastItem.created_at as string;
  }

  return json({ data: items, next_cursor: nextCursor });
}

export async function handlePatchLead(
  request: Request, env: Env, auth: { role: string; userId: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const oldLead = await env.DB.prepare('SELECT pipeline_id, stage_id FROM leads WHERE id = ?').bind(leadId).first() as { pipeline_id: string | null; stage_id: string | null } | null;
  if (!oldLead) return json({ error: 'Lead introuvable' }, 404);
  const updates: string[] = [];
  const params: (string | number)[] = [];
  const activities: Array<{ action: string; details: string }> = [];

  if (body.status !== undefined) {
    const status = body.status as string;
    if (!['new', 'contacted', 'qualified', 'won', 'closed', 'lost'].includes(status)) {
      return json({ error: 'Statut invalide' }, 400);
    }
    updates.push('status = ?');
    params.push(status);
    activities.push({ action: 'status_change', details: JSON.stringify({ to: status }) });
  }

  if (body.notes !== undefined) {
    updates.push('notes = ?');
    params.push(sanitizeInput(body.notes as string, 2000));
    activities.push({ action: 'note_added', details: '' });
  }

  if (body.deal_value !== undefined) {
    const dv = Number(body.deal_value);
    if (!isNaN(dv) && dv >= 0) {
      updates.push('deal_value = ?');
      params.push(dv);
      activities.push({ action: 'deal_value_changed', details: JSON.stringify({ value: dv }) });
    }
  }

  if (body.assigned_to !== undefined) {
    updates.push('assigned_to = ?');
    params.push(sanitizeInput(body.assigned_to as string, 100));
    activities.push({ action: 'assigned', details: JSON.stringify({ to: body.assigned_to }) });
  }

  if (body.score !== undefined) {
    const s = Number(body.score);
    if (!isNaN(s) && s >= 0 && s <= 100) {
      updates.push('score = ?');
      params.push(s);
    }
  }

  // Phase C — Multi-Pipelines
  if (body.pipeline_id !== undefined) {
    updates.push('pipeline_id = ?');
    params.push(sanitizeInput(body.pipeline_id as string, 100));
    activities.push({ action: 'pipeline_changed', details: JSON.stringify({ pipeline_id: body.pipeline_id }) });
  }
  if (body.stage_id !== undefined) {
    updates.push('stage_id = ?');
    params.push(sanitizeInput(body.stage_id as string, 100));
    activities.push({ action: 'stage_changed', details: JSON.stringify({ stage_id: body.stage_id }) });
  }

  // Q.1 — DND (Do Not Disturb)
  if (body.dnd !== undefined) {
    updates.push('dnd = ?');
    params.push(body.dnd ? 1 : 0);
    activities.push({ action: 'dnd_changed', details: JSON.stringify({ dnd: body.dnd }) });
  }
  if (body.dnd_settings !== undefined) {
    const dndStr = typeof body.dnd_settings === 'string' ? body.dnd_settings : JSON.stringify(body.dnd_settings);
    updates.push('dnd_settings = ?');
    params.push(sanitizeInput(dndStr, 500));
  }

  // Q.5 — Champs contact étendus
  if (body.additional_emails !== undefined) {
    const emailsStr = typeof body.additional_emails === 'string' ? body.additional_emails : JSON.stringify(body.additional_emails);
    updates.push('additional_emails = ?');
    params.push(sanitizeInput(emailsStr, 2000));
  }
  if (body.date_of_birth !== undefined) {
    updates.push('date_of_birth = ?');
    params.push(sanitizeInput(body.date_of_birth as string, 20));
  }
  if (body.country !== undefined) {
    updates.push('country = ?');
    params.push(sanitizeInput(body.country as string, 10));
  }
  if (body.timezone !== undefined) {
    updates.push('timezone = ?');
    params.push(sanitizeInput(body.timezone as string, 50));
  }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(leadId);

  await env.DB.prepare(
    `UPDATE leads SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  // Logger les activités (best-effort)
  for (const act of activities) {
    try {
      await env.DB.prepare(
        "INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, ?, ?)"
      ).bind(leadId, auth.userId, act.action, act.details).run();
    } catch { /* non-critique */ }
  }

  // Trigger workflows sur changement de statut
  if (body.status !== undefined && autoEnrollFn) {
    try {
      const { results: wfs } = await env.DB.prepare(
        "SELECT id, trigger_config FROM workflows WHERE is_active = 1 AND trigger_type = 'status_changed'"
      ).all();
      for (const wf of (wfs || []) as Array<{ id: string; trigger_config: string }>) {
        let cfg: { to_status?: string } = {};
        try { cfg = JSON.parse(wf.trigger_config); } catch { /* */ }
        if (!cfg.to_status || cfg.to_status === body.status) {
          await autoEnrollFn(env, wf.id, leadId);
        }
      }
    } catch { /* non critique */ }
    
    // Trigger deal_won si le statut passe à won
    if (body.status === 'won' && autoEnrollFn) {
      try {
        const { results: wonWfs } = await env.DB.prepare(
          "SELECT id FROM workflows WHERE is_active = 1 AND trigger_type = 'deal_won'"
        ).all();
        for (const wf of (wonWfs || []) as Array<{ id: string }>) {
          await autoEnrollFn(env, wf.id, leadId);
        }
      } catch { /* non critique */ }
    }
  }

  // Trigger workflows sur changement de stage pipeline
  if ((body.pipeline_id !== undefined || body.stage_id !== undefined) && autoEnrollFn) {
    try {
      const { results: wfs } = await env.DB.prepare(
        "SELECT id, trigger_config FROM workflows WHERE is_active = 1 AND trigger_type = 'pipeline_stage_changed'"
      ).all();
      
      const newPipelineId = body.pipeline_id || oldLead.pipeline_id;
      const newStageId = body.stage_id || oldLead.stage_id;
      
      // On ne déclenche que si ça a réellement changé
      if (newPipelineId !== oldLead.pipeline_id || newStageId !== oldLead.stage_id) {
        for (const wf of (wfs || []) as Array<{ id: string; trigger_config: string }>) {
          let cfg: { pipeline_id?: string; stage_id?: string } = {};
          try { cfg = JSON.parse(wf.trigger_config); } catch { /* */ }
          
          if (!cfg.pipeline_id || (cfg.pipeline_id === newPipelineId && (!cfg.stage_id || cfg.stage_id === newStageId))) {
            await autoEnrollFn(env, wf.id, leadId);
          }
        }
        
        // Trigger opportunity_status_changed (nouveau trigger Phase C)
        const { results: oppWfs } = await env.DB.prepare(
          "SELECT id FROM workflows WHERE is_active = 1 AND trigger_type = 'opportunity_status_changed'"
        ).all();
        for (const wf of (oppWfs || []) as Array<{ id: string }>) {
          await autoEnrollFn(env, wf.id, leadId);
        }
      }
    } catch { /* non critique */ }
  }



  // Notification pour les admins si statut important
  if (body.status !== undefined) {
    const importantStatuses = ['won', 'closed'];
    if (importantStatuses.includes(body.status as string)) {
      try {
        const lead = await env.DB.prepare('SELECT name, client_id FROM leads WHERE id = ?').bind(leadId).first() as { name: string; client_id: string } | null;
        if (lead) {
          const { results: admins } = await env.DB.prepare(
            "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
          ).all();
          const statusLabel = body.status === 'won' ? '🏆 Gagné' : '🏁 Fermé';
          for (const admin of (admins || []) as Array<{ id: string }>) {
            await createNotification(env, admin.id, `Lead ${statusLabel}`, `${lead.name} est passé à "${body.status}"`, body.status === 'won' ? '🏆' : '🏁', `/leads/${leadId}`, lead.client_id);
          }
        }
      } catch { /* non critique */ }
    }
  }

  await audit(env, auth.userId, 'lead.update', 'lead', leadId, body as Record<string, unknown>);
  return json({ success: true });
}

export async function handleBulkLeads(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as {
    ids?: string[];
    action?: string;
    value?: string;
  };

  if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 100) {
    return json({ error: 'Liste de IDs requise (max 100)' }, 400);
  }
  if (!body.action) {
    return json({ error: 'Action requise' }, 400);
  }

  const validActions = ['change_status', 'add_tag', 'remove_tag', 'assign', 'delete'];
  if (!validActions.includes(body.action)) {
    return json({ error: 'Action invalide' }, 400);
  }

  const ids = body.ids.map(id => sanitizeInput(id, 100)).filter(Boolean);
  let affected = 0;

  switch (body.action) {
    case 'change_status': {
      const validStatuses = ['new', 'contacted', 'qualified', 'won', 'closed', 'lost'];
      if (!body.value || !validStatuses.includes(body.value)) {
        return json({ error: 'Statut invalide' }, 400);
      }
      const placeholders = ids.map(() => '?').join(',');
      await env.DB.prepare(
        `UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`
      ).bind(body.value, ...ids).run();
      affected = ids.length;
      break;
    }

    case 'add_tag': {
      if (!body.value) return json({ error: 'Tag requis' }, 400);
      const tag = sanitizeInput(body.value, 50).toLowerCase();
      for (const id of ids) {
        await env.DB.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag) VALUES (?, ?)').bind(id, tag).run();
      }
      affected = ids.length;
      break;
    }

    case 'remove_tag': {
      if (!body.value) return json({ error: 'Tag requis' }, 400);
      const tag = sanitizeInput(body.value, 50).toLowerCase();
      const placeholders = ids.map(() => '?').join(',');
      await env.DB.prepare(
        `DELETE FROM lead_tags WHERE lead_id IN (${placeholders}) AND tag = ?`
      ).bind(...ids, tag).run();
      affected = ids.length;
      break;
    }

    case 'assign': {
      if (!body.value) return json({ error: 'Assigné requis' }, 400);
      const placeholders = ids.map(() => '?').join(',');
      await env.DB.prepare(
        `UPDATE leads SET assigned_to = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`
      ).bind(sanitizeInput(body.value, 100), ...ids).run();
      affected = ids.length;
      break;
    }

    case 'delete': {
      const placeholders = ids.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).bind(...ids).run();
      await env.DB.prepare(`DELETE FROM lead_tags WHERE lead_id IN (${placeholders})`).bind(...ids).run();
      await env.DB.prepare(`DELETE FROM activity_log WHERE lead_id IN (${placeholders})`).bind(...ids).run();
      affected = ids.length;
      break;
    }
  }

  await audit(env, auth.userId, `lead.bulk.${body.action}`, 'lead', 'bulk', { ids, value: body.value, affected });
  return json({ data: { success: true, affected } });
}

export async function handleCreateLead(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const clientId = sanitizeInput(body.client_id as string, 100);
  const name = sanitizeInput(body.name as string, 100);
  const email = sanitizeInput((body.email as string) || '', 200).toLowerCase();
  const phone = sanitizeInput((body.phone as string) || '', 30);
  const rawType = sanitizeInput((body.type as string) || '', 20);
  const type = ['inbound', 'customer'].includes(rawType) ? rawType : 'inbound';
  const source = sanitizeInput((body.source as string) || 'manual', 50);
  const message = sanitizeInput((body.message as string) || '', 2000);

  if (!clientId) return json({ error: 'client_id requis' }, 400);
  if (!name) return json({ error: 'Nom requis' }, 400);
  if (!email) return json({ error: 'Email requis' }, 400);

  const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ? AND is_active = 1').bind(clientId).first();
  if (!client) return json({ error: 'Client introuvable' }, 404);

  const existing = await env.DB.prepare(
    'SELECT id FROM leads WHERE LOWER(email) = ? AND client_id = ?'
  ).bind(email, clientId).first();
  if (existing) return json({ error: `Un lead avec l'email "${email}" existe déjà pour ce client` }, 409);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO leads (id, client_id, name, email, phone, type, source, message, status, pipeline_id, stage_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', 'pipeline-default', 'stage-new')`
  ).bind(id, clientId, name, email, phone, type, source, message).run();

  await audit(env, auth.userId, 'lead.create', 'lead', id, { client_id: clientId, name, email, source });
  return json({ data: { id } }, 201);
}

export async function handleGetPipeline(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const pipelineId = url.searchParams.get('pipeline_id');
  let query = `SELECT l.*, c.name as client_name FROM leads l
               LEFT JOIN clients c ON l.client_id = c.id
               WHERE l.status NOT IN ('closed', 'lost')`;
  const params: string[] = [];

  if (pipelineId) {
    query += ' AND l.pipeline_id = ?';
    params.push(pipelineId);
  } else {
    // Si pas de pipeline spécifié, fallback sur le pipeline par défaut
    query += ` AND (l.pipeline_id IS NULL OR l.pipeline_id = (SELECT id FROM pipelines WHERE is_default = 1 LIMIT 1))`;
  }

  query += ' ORDER BY l.created_at DESC';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return json({ data: results || [] });
}

export async function handleGetLeadDetail(env: Env, auth: { role: string }, leadId: string): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const { results: leadRows } = await env.DB.prepare(
    `SELECT l.*, c.name as client_name FROM leads l
     LEFT JOIN clients c ON l.client_id = c.id WHERE l.id = ?`
  ).bind(leadId).all();

  if (!leadRows || leadRows.length === 0) {
    return json({ error: 'Lead non trouvé' }, 404);
  }

  const lead = leadRows[0] as Record<string, unknown>;

  const { results: tagRows } = await env.DB.prepare(
    'SELECT tag FROM lead_tags WHERE lead_id = ? ORDER BY created_at DESC'
  ).bind(leadId).all();
  const tags = (tagRows || []).map((r: Record<string, unknown>) => r.tag as string);

  const { results: actRows } = await env.DB.prepare(
    `SELECT a.*, u.name as user_name FROM activity_log a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.lead_id = ? ORDER BY a.created_at DESC LIMIT 50`
  ).bind(leadId).all();

  return json({ data: { ...lead, tags, activity: actRows || [] } });
}

export async function handleAddTag(
  request: Request, env: Env, auth: { role: string; userId: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as { tag?: string };
  const tag = sanitizeInput(body.tag, 50);
  if (!tag) return json({ error: 'Tag requis' }, 400);

  try {
    await env.DB.prepare(
      'INSERT INTO lead_tags (lead_id, tag) VALUES (?, ?)'
    ).bind(leadId, tag.toLowerCase()).run();

    await env.DB.prepare(
      "INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, 'tag_added', ?)"
    ).bind(leadId, auth.userId, JSON.stringify({ tag })).run();
  } catch {
    // Tag déjà existant (UNIQUE constraint) — pas grave
  }

  return json({ success: true });
}

export async function handleRemoveTag(
  request: Request, env: Env, auth: { role: string; userId: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as { tag?: string };
  const tag = sanitizeInput(body.tag, 50);
  if (!tag) return json({ error: 'Tag requis' }, 400);

  await env.DB.prepare(
    'DELETE FROM lead_tags WHERE lead_id = ? AND tag = ?'
  ).bind(leadId, tag.toLowerCase()).run();

  await env.DB.prepare(
    "INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, 'tag_removed', ?)"
  ).bind(leadId, auth.userId, JSON.stringify({ tag })).run();

  return json({ success: true });
}

export async function handleGetAllTags(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const { results } = await env.DB.prepare(
    'SELECT DISTINCT tag FROM lead_tags ORDER BY tag ASC'
  ).all();

  const tags = (results || []).map((r: Record<string, unknown>) => r.tag as string);
  return json({ data: tags });
}

export async function handleGetActivity(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);

  const { results } = await env.DB.prepare(
    `SELECT a.*, u.name as user_name, l.name as lead_name
     FROM activity_log a
     LEFT JOIN users u ON a.user_id = u.id
     LEFT JOIN leads l ON a.lead_id = l.id
     ORDER BY a.created_at DESC LIMIT ?`
  ).bind(limit).all();

  return json({ data: results || [] });
}

export async function handleExportCsv(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const status = url.searchParams.get('status');
  const clientId = url.searchParams.get('client_id');

  let query = `SELECT l.*, c.name as client_name FROM leads l
               LEFT JOIN clients c ON l.client_id = c.id WHERE 1=1`;
  const params: string[] = [];

  if (status) { query += ' AND l.status = ?'; params.push(status); }
  if (clientId) { query += ' AND l.client_id = ?'; params.push(clientId); }
  query += ' ORDER BY l.created_at DESC';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  const leads = (results || []) as Record<string, unknown>[];

  const headers = ['Nom', 'Email', 'Téléphone', 'Type', 'Statut', 'Client', 'Source', 'Budget', 'Valeur', 'Message', 'Date'];
  const rows = leads.map(l => [
    l.name, l.email, l.phone, l.type, l.status, l.client_name || l.client_id,
    l.source, l.budget, l.deal_value ?? 0, l.message,
    l.created_at,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-intralys-${new Date().toISOString().slice(0, 10)}.csv"`,
      ...corsHeaders(),
    },
  });
}

// ── Webhook — Réception de leads externes ───────────────────
export async function handleWebhookLead(request: Request, env: Env): Promise<Response> {
  // Vérifier le secret webhook
  const secret = request.headers.get('X-Webhook-Secret') || '';
  const expectedSecret = (env as unknown as Record<string, unknown>).WEBHOOK_SECRET as string || '';
  if (!expectedSecret || secret !== expectedSecret) {
    return json({ error: 'Invalid webhook secret' }, 401);
  }

  // Identifier le client via le header
  const clientId = request.headers.get('X-Client-Id') || '';
  if (!clientId) {
    return json({ error: 'Missing X-Client-Id header' }, 400);
  }

  // Vérifier que le client existe
  const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) {
    return json({ error: 'Unknown client' }, 404);
  }

  // Parser et sanitiser le body
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const name = sanitizeInput(String(body.name || ''), 100);
  const email = sanitizeInput(String(body.email || ''), 255);
  const phone = sanitizeInput(String(body.phone || ''), 30);
  const message = sanitizeInput(String(body.message || ''), 2000);
  const typeRaw = String(body.type || 'inbound').toLowerCase();
  const type = ['inbound', 'qualified', 'customer'].includes(typeRaw) ? typeRaw : 'inbound';

  if (!name || !email) {
    return json({ error: 'name and email are required' }, 400);
  }

  // Vérifier doublon (même email + même client dans les 24h)
  const existing = await env.DB.prepare(
    `SELECT id FROM leads WHERE email = ? AND client_id = ? AND created_at > datetime('now', '-1 day')`
  ).bind(email, clientId).first();
  if (existing) {
    return json({ success: true, id: existing.id, duplicate: true }, 200);
  }

  // Créer le lead
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO leads (id, client_id, name, email, phone, message, type, source, status, score) VALUES (?, ?, ?, ?, ?, ?, ?, 'website', 'new', 30)`
  ).bind(id, clientId, name, email, phone, message, type).run();

  // Logger l'activité
  await audit(env, id, 'created', 'Lead reçu via webhook', '');

  // Notification (best-effort)
  try {
    await createNotification(env, '', 'lead', `Nouveau lead : ${name}`, id);
  } catch { /* silencieux */ }

  // Auto-enroll workflow si configuré
  if (autoEnrollFn) {
    const workflows = await env.DB.prepare(
      `SELECT id FROM workflows WHERE trigger_type = 'lead_created' AND is_active = 1 AND (trigger_config LIKE '%"client_id":"${clientId}"%' OR trigger_config LIKE '%"all_clients":true%')`
    ).all();
    for (const wf of (workflows.results || []) as { id: string }[]) {
      try { await autoEnrollFn(env, wf.id, id); } catch { /* silencieux */ }
    }
  }

  return json({ success: true, id }, 201);
}

