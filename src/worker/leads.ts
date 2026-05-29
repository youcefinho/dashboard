// ── Module Leads — Intralys CRM ─────────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit, corsHeaders, createNotification } from './helpers';
import { applyLeadMapping } from './lead-mapping';
import { normalizeLeadLocale, SUPPORTED_LEAD_LOCALES } from './i18n-server';
import { resolveDedup, mergeIntoLead, type DedupStrategy } from './lead-dedup';
import { validate, createLeadSchema, patchLeadSchemaS3, bulkLeadsSchemaS3, webhookLeadIngestSchema } from '../lib/schemas';
import { validationError } from './lib/validate-response';
import { requireQuota } from './plans';
import { requireCapability, type Capability } from './capabilities';
// Core CRM Sprint 1 — helpers PURS additifs (validation renforcée + normalization).
// Adoption progressive : on enrichit handleCreateLead + bulk add_tag à ce stade.
import {
  validateEmail,
  validatePhone,
  computeInitialScore,
  isValidStatus,
  LEAD_ERROR_CODES,
} from './lib/leads-engine';

// ── LOT TEAM B-bis — garde de capability CONDITIONNELLE (mode-agence-only) ───
// N'enforce QUE si l'auth porte un contexte agence (tenant.agencyId != null)
// ET un set capabilities injecté au choke-point worker.ts. En legacy/mono-
// tenant (tenant absent / agencyId == null), chemin API-key public
// ({role:'api'}, sans tenant/capabilities) et suites de test (auth sans
// .capabilities) ⇒ condition FALSE ⇒ skip ⇒ comportement BYTE-IDENTIQUE.
function capGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> },
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;
}

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
  const language = url.searchParams.get('language'); // Sprint MULTILANG-B (opt-in)

  let query = 'SELECT * FROM leads WHERE client_id = ?';
  const params: string[] = [clientId];

  if (status && isValidStatus(status)) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (type && ['inbound', 'qualified', 'customer'].includes(type)) {
    query += ' AND type = ?';
    params.push(type);
  }
  // Sprint MULTILANG-B — filtre opt-in par langue préférée (calque status,
  // whitelist locales). Absent → comportement inchangé. SELECT * remonte déjà
  // la colonne preferred_language.
  if (language && (SUPPORTED_LEAD_LOCALES as string[]).includes(language)) {
    query += ' AND preferred_language = ?';
    params.push(language);
  }
  if (search) {
    const cleanSearch = sanitizeInput(search, 100);
    query += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
    params.push(`%${cleanSearch}%`, `%${cleanSearch}%`, `%${cleanSearch}%`);
  }

  // ── Pagination opt-in additive (Sprint S9 M1) ──────────────────────────────
  // RÉTRO-COMPAT STRICTE : si `limit`/`offset` ABSENTS → comportement ACTUEL
  // byte-identique (`ORDER BY created_at DESC LIMIT 200`, pas d'offset, réponse
  // `{ data }` seule). Si fournis → on borne et on expose total/limit/offset
  // EN PLUS de `data` (jamais à la place). Pattern parsePaging répliqué
  // localement (cf ecommerce-orders.ts:81 — pas d'import cross-module).
  const MAX_LIMIT = 200; // préserve le cap historique dur de 200.
  const DEFAULT_LIMIT = 200;
  const rawLimitParam = url.searchParams.get('limit');
  const rawOffsetParam = url.searchParams.get('offset');
  const paginated = rawLimitParam !== null || rawOffsetParam !== null;

  if (!paginated) {
    // Chemin historique INCHANGÉ (byte-identique).
    query += ' ORDER BY created_at DESC LIMIT 200';
    const stmt = env.DB.prepare(query);
    const { results } = await stmt.bind(...params).all();
    return json({ data: results || [] });
  }

  const rawLimit = parseInt(rawLimitParam || '', 10);
  const rawOffset = parseInt(rawOffsetParam || '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  // total = nombre de lignes correspondant aux filtres (avant LIMIT/OFFSET).
  const countStmt = env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM (${query})`
  );
  const { results: countRows } = await countStmt.bind(...params).all();
  const total = Number((countRows?.[0] as { cnt?: number } | undefined)?.cnt ?? 0);

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const pageParams = [...params, limit, offset];
  const stmt = env.DB.prepare(query);
  const { results } = await stmt.bind(...pageParams).all();

  return json({ data: results || [], total, limit, offset });
}

export async function handleGetLeads(env: Env, auth: { role: string; clientId?: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin' && auth.role !== 'api') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search');
  const source = url.searchParams.get('source');
  const language = url.searchParams.get('language'); // Sprint MULTILANG-B (opt-in)
  const clientId = url.searchParams.get('client_id');
  const sort = url.searchParams.get('sort') || 'newest';
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let query = `SELECT l.*, c.name as client_name FROM leads l
               LEFT JOIN clients c ON l.client_id = c.id WHERE 1=1`;
  const params: (string | number)[] = [];

  if (status && isValidStatus(status)) {
    query += ' AND l.status = ?';
    params.push(status);
  }
  if (source) {
    query += ' AND l.source = ?';
    params.push(sanitizeInput(source, 50));
  }
  // Sprint MULTILANG-B — filtre opt-in par langue préférée (calque status,
  // whitelist locales). Absent → comportement inchangé.
  if (language && (SUPPORTED_LEAD_LOCALES as string[]).includes(language)) {
    query += ' AND l.preferred_language = ?';
    params.push(language);
  }
  // Filtrage par client_id : obligatoire pour les API keys, optionnel pour admin
  const effectiveClientId = auth.role === 'api' && auth.clientId ? auth.clientId : clientId;
  if (effectiveClientId) {
    query += ' AND l.client_id = ?';
    params.push(sanitizeInput(effectiveClientId, 100));
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
  request: Request, env: Env, auth: { role: string; userId: string; clientId?: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin' && auth.role !== 'api') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }
  const cg = capGuard(auth as never, 'leads.write');
  if (cg) return cg;

  const rawBody = await request.json().catch(() => null);
  const v = validate(patchLeadSchemaS3, rawBody);
  if (!v.success) return validationError(v.error);
  const body = v.data as Record<string, unknown>;
  const oldLead = await env.DB.prepare('SELECT pipeline_id, stage_id FROM leads WHERE id = ?').bind(leadId).first() as { pipeline_id: string | null; stage_id: string | null } | null;
  if (!oldLead) return json({ error: 'Lead introuvable' }, 404);
  const updates: string[] = [];
  // null inclus : Sprint MULTILANG-B permet de remettre preferred_language à NULL
  // (repasser au défaut tenant). D1 .bind() accepte null nativement.
  const params: (string | number | null)[] = [];
  const activities: Array<{ action: string; details: string }> = [];

  if (body.status !== undefined) {
    const status = body.status as string;
    if (!isValidStatus(status)) {
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

  // Sprint MULTILANG-B — langue préférée (additif, calque country/timezone).
  // Whitelist locales validée ICI (handler) : valeur supportée → set ;
  // hors-liste OU chaîne vide → set NULL ("repasser au défaut tenant fr-CA").
  if (body.preferred_language !== undefined) {
    const normalized = normalizeLeadLocale(body.preferred_language as unknown);
    updates.push('preferred_language = ?');
    params.push(normalized); // null = repasser au défaut tenant (D1 .bind() accepte null)
    activities.push({ action: 'language_changed', details: JSON.stringify({ preferred_language: normalized }) });
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

    // ── LOT G2 AFFILIATION — hook commission best-effort (additif, ne modifie
    //    JAMAIS le comportement existant). Quand le statut passe à 'won', si le
    //    lead a une jonction affiliate_referrals, onLeadWon calcule la commission
    //    SERVEUR (programme fixed/percent) et l'enregistre (status 'pending').
    //    Import dynamique + try/catch TOTAL avalant : un échec n'altère JAMAIS
    //    le patch. Corps réel de onLeadWon = Phase B (affiliates.ts).
    if (body.status === 'won') {
      try {
        const { onLeadWon } = await import('./affiliates');
        await onLeadWon(env, leadId);
      } catch { /* best-effort : la commission affilié n'échoue jamais le patch */ }
      
      try {
        const { onAgentLeadWon } = await import('./agent-commissions');
        await onAgentLeadWon(env, leadId);
      } catch { /* best-effort */ }
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

  // Webhook event
  if (body.status !== undefined) {
    try {
      const { publishEvent } = await import('./webhooks-dispatch');
      const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first();
      if (lead) {
        publishEvent(env, lead.client_id as string, 'lead.status_changed', lead);
      }
    } catch (e) {
      console.error('Webhook error:', e);
    }
  }

  return json({ success: true });
}

export async function handleBulkLeads(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }
  const cg = capGuard(auth as never, 'leads.write');
  if (cg) return cg;

  const rawBody = await request.json().catch(() => null);
  const v = validate(bulkLeadsSchemaS3, rawBody);
  if (!v.success) return validationError(v.error);
  const body = v.data as {
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
      if (!body.value || !isValidStatus(body.value)) {
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
      const cgDel = capGuard(auth as never, 'leads.delete');
      if (cgDel) return cgDel;
      const placeholders = ids.map(() => '?').join(',');
      await env.DB.prepare(`UPDATE leads SET deleted_at = datetime('now') WHERE id IN (${placeholders})`).bind(...ids).run();
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
  const cg = capGuard(auth as never, 'leads.write');
  if (cg) return cg;

  const rawBody = await request.json().catch(() => null);
  const v = validate(createLeadSchema, rawBody);
  if (!v.success) return validationError(v.error);
  const body = v.data as Record<string, unknown>;
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

  // Core CRM Sprint 1 — validation RFC 5322 additive (helpers PURS).
  // Le sanitizeInput a déjà appliqué cap+escape ; on durcit avec un check
  // format strict + retourne un error_code stable (`invalid_email`). Si
  // l'email passe l'ancien filtre `if (!email)` mais échoue RFC, on rejette
  // AVANT le 404 client (cohérent avec le 400 "Email requis").
  const emailCheck = validateEmail(email);
  if (!emailCheck.ok) {
    return json({ error: 'Email invalide', error_code: emailCheck.error || LEAD_ERROR_CODES.INVALID_EMAIL }, 400);
  }
  // Phone optionnel : si fourni, on valide (ne FAIL pas le create si non-fourni).
  // Best-effort — si le format est étrange on accepte tel quel (rétro-compat
  // avec leads existants pré-validation). On expose le code stable seulement
  // sur les payloads NOTOIREMENT invalides (lettres, > 15 chiffres).
  if (phone) {
    const phoneCheck = validatePhone(phone);
    if (!phoneCheck.ok) {
      return json({ error: 'Téléphone invalide', error_code: phoneCheck.error || LEAD_ERROR_CODES.INVALID_PHONE }, 400);
    }
  }

  const client = await env.DB.prepare('SELECT id, agency_id FROM clients WHERE id = ? AND is_active = 1').bind(clientId).first();
  if (!client) return json({ error: 'Client introuvable' }, 404);

  // LOT 3 SaaS M2 — enforcement quota leads (§6.16(b)). Inséré APRÈS le 404,
  // AVANT l'INSERT. Garde-fou #1 ABSOLU : un client sans agence (agency_id
  // NULL ⇒ legacy mono-tenant) ⇒ requireQuota retourne null IMMÉDIATEMENT
  // (0 requête D1, 0 blocage) ⇒ handleCreateLead byte-identique au
  // comportement actuel. Quota évalué UNIQUEMENT pour un client d'agence.
  const q = await requireQuota(env, (client as { agency_id?: string | null }).agency_id, 'leads');
  if (q) return q;

  const existing = await env.DB.prepare(
    'SELECT id FROM leads WHERE LOWER(email) = ? AND client_id = ?'
  ).bind(email, clientId).first();
  if (existing) return json({ error: `Un lead avec l'email "${email}" existe déjà pour ce client` }, 409);

  const id = crypto.randomUUID();
  // Core CRM Sprint 1 — score initial calculé serveur-side (helper PUR).
  // Garde compatibilité schéma : la colonne `score` existe (default 0 dans la
  // migration historique). On l'écrit explicitement maintenant.
  const initialScore = computeInitialScore({ email, phone, source });
  await env.DB.prepare(
    `INSERT INTO leads (id, client_id, name, email, phone, type, source, message, status, pipeline_id, stage_id, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', 'pipeline-default', 'stage-new', ?)`
  ).bind(id, clientId, name, email, phone, type, source, message, initialScore).run();

  await audit(env, auth.userId, 'lead.create', 'lead', id, { client_id: clientId, name, email, source });

  // Webhook event
  try {
    const { publishEvent } = await import('./webhooks-dispatch');
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
    if (lead) {
      publishEvent(env, clientId, 'lead.created', lead);
    }
  } catch (e) {
    console.error('Webhook error:', e);
  }

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
  const cg = capGuard(auth as never, 'export');
  if (cg) return cg;

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

// ── Sprint 51 M2 — Connecteur entrant générique ─────────────
interface LeadSourceRow {
  id: string;
  client_id: string;
  name: string;
  source_key: string;
  type: string;
  token: string;
  mapping_json: string | null;
  dedup_strategy: string;
  consent_default: string;
  active: number;
}

// Comparaison timing-safe de deux tokens (anti timing-attack).
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!;
  return diff === 0;
}

// Génère un token d'ingestion fort (32 octets → base64url ~43 chars).
export function generateSourceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Ingestion partagée : mapping → attribution → dédoublonnage → consentement → lead.
 * Utilisée par /api/ingest/:token, /api/webhook/lead (legacy), /api/form/submit.
 * dryRun = ne crée rien, renvoie l'aperçu du lead qui serait créé.
 */
export async function ingestLead(
  env: Env,
  opts: {
    request: Request;
    clientId: string;
    sourceKey: string;
    sourceId?: string | null;
    body: Record<string, unknown>;
    mappingJson?: string | null;
    dedupStrategy?: DedupStrategy;
    consentDefault?: string;
    dryRun?: boolean;
    baseScore?: number;
  }
): Promise<Response> {
  const {
    request, clientId, sourceKey, sourceId = null, body,
    mappingJson = null, dedupStrategy = 'email_phone',
    consentDefault = 'unknown', dryRun = false, baseScore = 30,
  } = opts;

  const m = applyLeadMapping(body, mappingJson);

  // S4 M2 — validation POST-mapping (early-return additif). Le mapping
  // est appliqué EN PREMIER (préservé) ; on valide ensuite l'objet mappé.
  // Permissif (schéma webhook figé S3, .passthrough()). La logique
  // ingest/dedup/scoring reste INCHANGÉE sous ce point.
  const vi = validate(webhookLeadIngestSchema, m as unknown as Record<string, unknown>);
  if (!vi.success) return validationError(vi.error);

  if (!m.name || !m.email) {
    return json({ error: 'name and email are required (vérifiez le mapping)' }, 400);
  }

  // consent_status : true→granted, false→denied, null→défaut de la source
  const consentStatus = m.consent === true ? 'granted'
    : m.consent === false ? 'denied'
    : consentDefault;

  const decision = await resolveDedup(env, dedupStrategy, {
    clientId, email: m.email, phone: m.phone,
  });

  if (dryRun) {
    return json({
      data: {
        dry_run: true,
        action: decision.action,
        existing_id: decision.existingId || null,
        lead: {
          name: m.name, email: m.email, phone: m.phone, message: m.message,
          type: m.type, company: m.company, source: sourceKey,
          consent_status: consentStatus, attribution: m.attribution,
          custom_fields: m.customFields,
          preferred_language: m.preferred_language,
        },
      },
    }, 200);
  }

  // Doublon récent → idempotent (retry-safe)
  if (decision.action === 'skip' && decision.existingId) {
    return json({ success: true, id: decision.existingId, duplicate: true }, 200);
  }

  // Doublon ancien → enrichissement non destructif
  if (decision.action === 'merge' && decision.existingId) {
    await mergeIntoLead(env, decision.existingId, {
      name: m.name, phone: m.phone, message: m.message, company: m.company,
      ...m.attribution,
    });
    await audit(env, decision.existingId, 'updated', `Lead enrichi via source "${sourceKey}"`, '');
    await logIngestConsent(env, request, decision.existingId, m.consent, consentStatus);

    // ── LOT ATTRIBUTION-D — capture touchpoint best-effort (MERGE) ───────────
    //    Lead ré-ingéré multi-source → touchpoint additionnel (touch_order=-1
    //    SENTINEL « append » → Phase B résout SELECT MAX(touch_order)+1).
    //    Import dynamique + try/catch TOTAL avalant (calque hook affiliation
    //    plus bas:974-992) : n'échoue JAMAIS l'enrichissement du lead. Corps réel
    //    de recordTouchpoint = Phase B (touchpoints.ts ; STUB no-op Phase A).
    try {
      const { recordTouchpoint } = await import('./touchpoints');
      await recordTouchpoint(env, decision.existingId, clientId, {
        utm_source: m.attribution.utm_source,
        utm_medium: m.attribution.utm_medium,
        utm_campaign: m.attribution.utm_campaign,
        referrer: m.attribution.referrer,
      }, -1);
    } catch { /* best-effort : la capture de touchpoint n'échoue jamais l'ingestion */ }

    return json({ success: true, id: decision.existingId, merged: true }, 200);
  }

  // Sprint MULTILANG-B — langue préférée à la capture (opt-in). Le mapping a
  // déjà normalisé un éventuel champ payload (preferred_language|language|
  // langue|locale|lang). Fallback best-effort : si absent, on dérive de l'en-tête
  // Accept-Language de la requête entrante (normalisé vers une locale supportée,
  // sinon null = défaut tenant). JAMAIS de déduction heuristique au-delà de ça.
  let preferredLanguage: string | null = m.preferred_language;
  if (!preferredLanguage) {
    const acceptLang = request.headers.get('Accept-Language') || '';
    const firstTag = acceptLang.split(',')[0]?.split(';')[0]?.trim();
    preferredLanguage = normalizeLeadLocale(firstTag);
  }

  // Création
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO leads
       (id, client_id, name, email, phone, message, type, source, status, score,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        gclid, fbclid, referrer, consent_status, lead_source_id, preferred_language)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, clientId, m.name, m.email, m.phone, m.message, m.type, sourceKey, baseScore,
    m.attribution.utm_source, m.attribution.utm_medium, m.attribution.utm_campaign,
    m.attribution.utm_term, m.attribution.utm_content,
    m.attribution.gclid, m.attribution.fbclid, m.attribution.referrer,
    consentStatus, sourceId, preferredLanguage
  ).run();

  // Custom fields perso (best-effort, ignore si table/colonne absente)
  for (const [label, value] of Object.entries(m.customFields)) {
    try {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO custom_field_values (lead_id, field_id, value) VALUES (?, ?, ?)'
      ).bind(id, label, value).run();
    } catch { /* silencieux */ }
  }

  await audit(env, id, 'created', `Lead reçu via source "${sourceKey}"`, '');
  await logIngestConsent(env, request, id, m.consent, consentStatus);

  try {
    await createNotification(env, '', 'lead', `Nouveau lead : ${m.name}`, id);
  } catch { /* silencieux */ }

  // ── LOT G2 AFFILIATION — hook attribution best-effort (additif, ne modifie
  //    JAMAIS le comportement existant). Si le payload porte un code affilié
  //    (`aff` à la racine OU sous `data.aff` — calque la double-arrivée
  //    forms.ts:body.data), on rattache le lead à l'affilié via la table de
  //    jonction affiliate_referrals (attribution `?aff=`, PAS `?ref=` — 'ref'
  //    est avalé par ATTRIBUTION_ALIASES.referrer). Import dynamique + try/catch
  //    TOTAL avalant : un échec n'échoue JAMAIS la création du lead. Corps réel
  //    de attributeReferral = Phase B (affiliates.ts).
  try {
    const dataObj = (body && typeof body.data === 'object' && body.data)
      ? (body.data as Record<string, unknown>)
      : body;
    const affRaw = (dataObj?.aff ?? (body as Record<string, unknown>)?.aff) as unknown;
    const affCode = typeof affRaw === 'string' && affRaw.trim() ? affRaw.trim() : null;
    if (affCode) {
      const { attributeReferral } = await import('./affiliates');
      await attributeReferral(env, id, affCode, clientId);
    }
  } catch { /* best-effort : l'attribution affilié n'échoue jamais l'ingestion */ }

  // ── LOT ATTRIBUTION-D — capture touchpoint best-effort (CRÉATION) ──────────
  //    Premier touch du lead (touch_order=0). Import dynamique + try/catch TOTAL
  //    avalant (calque hook affiliation ci-dessus:982-992) : n'échoue JAMAIS la
  //    création du lead. Corps réel de recordTouchpoint = Phase B (touchpoints.ts ;
  //    STUB no-op Phase A). Multi-touch PROSPECTIF — les leads existants n'ont
  //    aucun touch (cohortes couvrent l'historique, attribution le futur).
  try {
    const { recordTouchpoint } = await import('./touchpoints');
    await recordTouchpoint(env, id, clientId, {
      utm_source: m.attribution.utm_source,
      utm_medium: m.attribution.utm_medium,
      utm_campaign: m.attribution.utm_campaign,
      referrer: m.attribution.referrer,
    }, 0);
  } catch { /* best-effort : la capture de touchpoint n'échoue jamais l'ingestion */ }

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

// Loi 25 / CASL : capture du consentement à la source.
// Réutilise le schéma consent_log (compliance.ts) : data_processing pour toute
// ingestion + marketing_email si opt-in explicite vrai.
export async function logIngestConsent(
  env: Env, request: Request, leadId: string,
  consent: boolean | null, consentStatus: string
): Promise<void> {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'ingest';
    const ua = request.headers.get('User-Agent') || '';
    // Traitement des données : toujours journalisé (granted si explicite, sinon état connu)
    await env.DB.prepare(
      'INSERT INTO consent_log (id, lead_id, consent_type, granted, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), leadId, 'data_processing', consentStatus === 'granted' ? 1 : 0, ip, ua).run();
    // Consentement marketing explicite (CASL : preuve d'opt-in)
    if (consent !== null) {
      await env.DB.prepare(
        'INSERT INTO consent_log (id, lead_id, consent_type, granted, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), leadId, 'marketing_email', consent ? 1 : 0, ip, ua).run();
    }
  } catch { /* best-effort, ne bloque jamais l'ingestion */ }
}

// ── /api/ingest/:token — Connecteur entrant par token (Sprint 51 M2) ───
export async function handleIngestByToken(
  request: Request, env: Env, token: string, url: URL
): Promise<Response> {
  if (!token || token.length < 16) return json({ error: 'Invalid token' }, 401);

  const source = await env.DB.prepare(
    'SELECT * FROM lead_sources WHERE token = ?'
  ).bind(token).first() as LeadSourceRow | null;

  // Comparaison timing-safe + source active
  if (!source || !timingSafeEqual(source.token, token)) {
    return json({ error: 'Invalid token' }, 401);
  }
  if (!source.active) {
    return json({ error: 'Source désactivée' }, 403);
  }

  const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(source.client_id).first();
  if (!client) return json({ error: 'Unknown client' }, 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const dryRun = url.searchParams.get('dryRun') === '1';
  const res = await ingestLead(env, {
    request,
    clientId: source.client_id,
    sourceKey: source.source_key,
    sourceId: source.id,
    body,
    mappingJson: source.mapping_json,
    dedupStrategy: (source.dedup_strategy || 'email_phone') as DedupStrategy,
    consentDefault: source.consent_default || 'unknown',
    dryRun,
  });

  if (!dryRun && res.status < 400) {
    await env.DB.prepare(
      "UPDATE lead_sources SET last_received_at = datetime('now') WHERE id = ?"
    ).bind(source.id).run();
  }
  return res;
}

// ── Webhook legacy — Réception de leads externes (DÉPRÉCIÉ, rétro-compat) ───
// Conserve X-Webhook-Secret global + X-Client-Id. Préférer /api/ingest/:token.
export async function handleWebhookLead(request: Request, env: Env): Promise<Response> {
  console.warn('[DEPRECATED] /api/webhook/lead — migrer vers /api/ingest/:token (Sprint 51 M2)');

  const secret = request.headers.get('X-Webhook-Secret') || '';
  const expectedSecret = (env as unknown as Record<string, unknown>).WEBHOOK_SECRET as string || '';
  if (!expectedSecret || secret !== expectedSecret) {
    return json({ error: 'Invalid webhook secret' }, 401);
  }

  const clientId = request.headers.get('X-Client-Id') || '';
  if (!clientId) {
    return json({ error: 'Missing X-Client-Id header' }, 400);
  }

  const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) {
    return json({ error: 'Unknown client' }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Réutilise le moteur d'ingestion unifié. source = 'website' (rétro-compat).
  return ingestLead(env, {
    request,
    clientId,
    sourceKey: 'website',
    body,
    dedupStrategy: 'email',     // ancien comportement : doublon email+client 24h
    consentDefault: 'unknown',
  });
}

