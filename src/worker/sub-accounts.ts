// ── Module Sub-Accounts, Snapshots, Whitelabel, Widget — Intralys CRM ─
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';
import { hashPassword } from './crypto';

// ── Sub-Accounts ────────────────────────────────────────────

export async function handleGetSubAccounts(env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.account_level, u.parent_user_id, u.max_clients, u.is_active, u.created_at,
     p.name as parent_name, (SELECT COUNT(*) FROM users WHERE parent_user_id = u.id) as child_count
     FROM users u LEFT JOIN users p ON u.parent_user_id = p.id ORDER BY u.account_level, u.name`
  ).all();
  return json({ data: results || [] });
}

export async function handleCreateSubAccount(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { name?: string; email?: string; role?: string; account_level?: string; parent_user_id?: string; max_clients?: number; password?: string };
  if (!body.name || !body.email || !body.password) return json({ error: 'name, email et password requis' }, 400);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email.toLowerCase()).first();
  if (existing) return json({ error: 'Email déjà utilisé' }, 409);
  const id = crypto.randomUUID();
  const hash = await hashPassword(body.password);
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, account_level, parent_user_id, max_clients) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, sanitizeInput(body.name, 100), body.email.toLowerCase(), hash, body.role || 'broker', body.account_level || 'user', body.parent_user_id || auth.userId, body.max_clients || 5).run();
  await audit(env, auth.userId, 'sub_account.create', 'user', id, { name: body.name, level: body.account_level });
  return json({ data: { id } }, 201);
}

export async function handleUpdateSubAccount(request: Request, env: Env, auth: { userId: string; role: string }, userId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;
  const u: string[] = []; const p: (string | number)[] = [];
  if (body.name) { u.push('name = ?'); p.push(sanitizeInput(body.name as string, 100)); }
  if (body.is_active !== undefined) { u.push('is_active = ?'); p.push(body.is_active as number); }
  if (body.max_clients !== undefined) { u.push('max_clients = ?'); p.push(body.max_clients as number); }
  if (body.account_level) { u.push('account_level = ?'); p.push(body.account_level as string); }
  if (body.permissions) { u.push('permissions = ?'); p.push(JSON.stringify(body.permissions)); }
  if (body.branding) { u.push('branding = ?'); p.push(JSON.stringify(body.branding)); }
  if (u.length === 0) return json({ error: 'Aucune modification' }, 400);
  u.push("updated_at = datetime('now')"); p.push(userId);
  await env.DB.prepare(`UPDATE users SET ${u.join(', ')} WHERE id = ?`).bind(...p).run();
  await audit(env, auth.userId, 'sub_account.update', 'user', userId);
  return json({ data: { success: true } });
}

// ── Snapshots ───────────────────────────────────────────────

export async function handleCreateSnapshot(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { source_client_id?: string; name?: string };
  if (!body.source_client_id) return json({ error: 'source_client_id requis' }, 400);
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(body.source_client_id).first();
  if (!client) return json({ error: 'Client introuvable' }, 404);
  const { results: workflows } = await env.DB.prepare('SELECT * FROM workflows WHERE client_id = ?').bind(body.source_client_id).all();
  const { results: templates } = await env.DB.prepare('SELECT * FROM email_templates WHERE client_id = ?').bind(body.source_client_id).all();
  const { results: forms } = await env.DB.prepare('SELECT * FROM forms WHERE client_id = ?').bind(body.source_client_id).all();
  const { results: bookingPages } = await env.DB.prepare('SELECT * FROM booking_pages WHERE client_id = ?').bind(body.source_client_id).all();
  const { results: pipelines } = await env.DB.prepare('SELECT * FROM pipelines').all();
  const { results: stages } = await env.DB.prepare('SELECT * FROM pipeline_stages').all();
  const snapshot = { id: crypto.randomUUID(), name: body.name || `Snapshot ${new Date().toISOString().split('T')[0]}`, source_client_id: body.source_client_id, created_by: auth.userId, created_at: new Date().toISOString(), data: { workflows: workflows || [], templates: templates || [], forms: forms || [], booking_pages: bookingPages || [], pipelines: pipelines || [], stages: stages || [] } };
  await env.DB.prepare("INSERT INTO audit_log (user_id, action, resource_type, resource_id, details) VALUES (?, 'snapshot.create', 'snapshot', ?, ?)").bind(auth.userId, snapshot.id, JSON.stringify(snapshot)).run();
  await audit(env, auth.userId, 'snapshot.create', 'snapshot', snapshot.id, { name: snapshot.name });
  return json({ data: { id: snapshot.id, name: snapshot.name, items: { workflows: (workflows || []).length, templates: (templates || []).length, forms: (forms || []).length, booking_pages: (bookingPages || []).length } } }, 201);
}

export async function handleApplySnapshot(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { snapshot_id?: string; target_client_id?: string };
  if (!body.snapshot_id || !body.target_client_id) return json({ error: 'snapshot_id et target_client_id requis' }, 400);
  const snapshotRow = await env.DB.prepare("SELECT details FROM audit_log WHERE resource_id = ? AND action = 'snapshot.create'").bind(body.snapshot_id).first() as { details: string } | null;
  if (!snapshotRow) return json({ error: 'Snapshot introuvable' }, 404);
  const snapshot = JSON.parse(snapshotRow.details) as { data: { workflows: Array<Record<string, unknown>>; templates: Array<Record<string, unknown>>; forms: Array<Record<string, unknown>>; booking_pages: Array<Record<string, unknown>> } };
  const applied = { workflows: 0, templates: 0, forms: 0, booking_pages: 0 };
  for (const wf of snapshot.data.workflows) { await env.DB.prepare('INSERT INTO workflows (id, client_id, name, trigger_type, trigger_config, is_active) VALUES (?, ?, ?, ?, ?, 0)').bind(crypto.randomUUID(), body.target_client_id, wf.name as string, wf.trigger_type as string, wf.trigger_config as string).run(); applied.workflows++; }
  for (const tpl of snapshot.data.templates) { await env.DB.prepare('INSERT INTO email_templates (id, client_id, name, category, subject, body_html, body_text) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), body.target_client_id, tpl.name as string, tpl.category as string, tpl.subject as string, tpl.body_html as string, tpl.body_text as string).run(); applied.templates++; }
  for (const f of snapshot.data.forms) { const slug = `${(f.slug as string)}-${body.target_client_id.substring(0, 8)}`; await env.DB.prepare('INSERT INTO forms (id, client_id, name, slug, fields, submit_action, success_message) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), body.target_client_id, f.name as string, slug, f.fields as string, f.submit_action as string, f.success_message as string).run(); applied.forms++; }
  for (const bp of snapshot.data.booking_pages) { const slug = `${(bp.slug as string)}-${body.target_client_id.substring(0, 8)}`; await env.DB.prepare('INSERT INTO booking_pages (id, client_id, slug, title, description, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), body.target_client_id, slug, bp.title as string, (bp.description || '') as string, (bp.duration_minutes || 30) as number).run(); applied.booking_pages++; }
  await audit(env, auth.userId, 'snapshot.apply', 'snapshot', body.snapshot_id, { target: body.target_client_id, applied });
  return json({ data: { applied } });
}

// ── White-Label ─────────────────────────────────────────────

export async function handleGetWhitelabel(env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const user = await env.DB.prepare('SELECT branding FROM users WHERE id = ?').bind(auth.userId).first() as { branding: string } | null;
  let branding: Record<string, unknown> = {};
  try { branding = JSON.parse(user?.branding || '{}'); } catch { /* */ }
  return json({ data: branding });
}

export async function handleUpdateWhitelabel(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;
  const user = await env.DB.prepare('SELECT branding FROM users WHERE id = ?').bind(auth.userId).first() as { branding: string } | null;
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(user?.branding || '{}'); } catch { /* */ }
  const merged = { ...current, ...body };
  await env.DB.prepare("UPDATE users SET branding = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(merged), auth.userId).run();
  await audit(env, auth.userId, 'whitelabel.update', 'user', auth.userId);
  return json({ data: merged });
}

// ── Widget Embed Script ─────────────────────────────────────

export async function handleWidgetScript(env: Env, url: URL): Promise<Response> {
  const formSlug = url.searchParams.get('form');
  if (!formSlug) return new Response('// Erreur: ?form=slug requis', { status: 400, headers: { 'Content-Type': 'application/javascript' } });
  const form = await env.DB.prepare('SELECT * FROM forms WHERE slug = ? AND is_active = 1').bind(formSlug).first() as Record<string, unknown> | null;
  if (!form) return new Response('// Formulaire non trouvé', { status: 404, headers: { 'Content-Type': 'application/javascript' } });
  let fields: Array<{ name: string; label: string; type: string; required?: boolean }> = [];
  try { fields = JSON.parse(form.fields as string); } catch { /* */ }
  if (fields.length === 0) { fields = [{ name: 'nom', label: 'Nom complet', type: 'text', required: true }, { name: 'email', label: 'Courriel', type: 'email', required: true }, { name: 'phone', label: 'Téléphone', type: 'tel' }, { name: 'message', label: 'Message', type: 'textarea' }]; }
  const apiBase = url.origin;
  const script = `(function(){var c=document.getElementById('intralys-form');if(!c)return;var f=${JSON.stringify(fields)};var h='<div class="ilf"><form id="ilf-form">';f.forEach(function(x){h+='<label>'+x.label+(x.required?' *':'')+'</label>';h+=x.type==='textarea'?'<textarea name="'+x.name+'"'+(x.required?' required':'')+''+'></textarea>':'<input type="'+x.type+'" name="'+x.name+'"'+(x.required?' required':'')+' />';});h+='<button type="submit">Envoyer</button></form></div>';c.innerHTML=h;document.getElementById('ilf-form').addEventListener('submit',function(e){e.preventDefault();var d={};f.forEach(function(x){d[x.name]=e.target.elements[x.name].value;});var b=e.target.querySelector('button');b.textContent='Envoi...';b.disabled=true;fetch('${apiBase}/api/form/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({form_id:'${form.id}',data:d})}).then(function(r){return r.json()}).then(function(r){if(r.data){c.querySelector('.ilf').innerHTML='<div class="ilf-ok">'+(r.data.success_message||'Merci !')+'</div>';}else{b.textContent='Envoyer';b.disabled=false;}}).catch(function(){b.textContent='Envoyer';b.disabled=false;});});})();`;
  return new Response(script, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
}
