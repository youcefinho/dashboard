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

  // Sprint 51 M3.2 — bloc consentement Loi 25 lu depuis settings_json (back-compat)
  let requireConsent = false;
  let consentText = "J'accepte d'être recontacté(e) conformément à la Loi 25.";
  try {
    const s = JSON.parse((form.settings_json as string) || '{}') as { require_consent?: boolean; consent_text?: string };
    if (s.require_consent === true) requireConsent = true;
    if (s.consent_text) consentText = String(s.consent_text);
  } catch { /* */ }
  const redirectUrl = (form.redirect_url as string) || '';
  const successMsg = (form.success_message as string) || 'Merci ! Nous vous recontacterons sous peu.';

  const cfg = JSON.stringify({
    formId: form.id, apiBase, fields, requireConsent, consentText,
    redirectUrl, successMsg,
  });

  // Script auto-contenu, zéro dépendance, CORS *. Back-compat : ancien markup
  // (#intralys-form, .ilf, #ilf-form) conservé. Nouveaux comportements sûrs par défaut :
  // honeypot anti-spam, capture attribution (utm/gclid/fbclid/referrer), anti double-submit.
  const script = `(function(){var C=${cfg};var c=document.getElementById('intralys-form');if(!c)return;` +
    `var f=C.fields;` +
    // Attribution : lue sur la page hôte (querystring + referrer)
    `function attr(){var p=new URLSearchParams(window.location.search||'');var a={};` +
    `['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(function(k){var v=p.get(k);if(v)a[k]=v;});` +
    `if(document.referrer)a.referrer=document.referrer;return a;}` +
    // Anti double-submit : verrou localStorage 30s par formulaire
    `var LK='ilf_sent_'+C.formId;function locked(){try{var t=localStorage.getItem(LK);return t&&(Date.now()-parseInt(t,10))<30000;}catch(e){return false;}}` +
    `function lock(){try{localStorage.setItem(LK,String(Date.now()));}catch(e){}}` +
    // Markup
    `var h='<div class="ilf"><form id="ilf-form" novalidate>';` +
    `f.forEach(function(x){var id='ilf-'+x.name;h+='<label for="'+id+'">'+x.label+(x.required?' <span aria-hidden=\\'true\\'>*</span>':'')+'</label>';` +
    `h+=x.type==='textarea'?'<textarea id="'+id+'" name="'+x.name+'"'+(x.required?' required':'')+' aria-required="'+(x.required?'true':'false')+'"></textarea>':'<input id="'+id+'" type="'+x.type+'" name="'+x.name+'"'+(x.required?' required':'')+' aria-required="'+(x.required?'true':'false')+'" />';});` +
    // Honeypot (caché des humains + lecteurs d'écran)
    `h+='<div style="position:absolute;left:-9999px;top:-9999px;" aria-hidden="true"><label>Ne pas remplir</label><input type="text" name="ilf_hp" tabindex="-1" autocomplete="off" /></div>';` +
    // Consentement obligatoire Loi 25
    `if(C.requireConsent){h+='<div class="ilf-consent" style="display:flex;align-items:flex-start;gap:8px;margin:10px 0;"><input type="checkbox" id="ilf-consent" name="consent" required aria-required="true" /><label for="ilf-consent" style="font-size:13px;font-weight:400;">'+C.consentText+' <span aria-hidden="true">*</span></label></div>';}` +
    `h+='<div class="ilf-err" role="alert" aria-live="polite" style="display:none;color:#c0392b;font-size:13px;margin:6px 0;"></div>';` +
    `h+='<button type="submit">Envoyer</button></form></div>';c.innerHTML=h;` +
    `var form=document.getElementById('ilf-form');var errBox=c.querySelector('.ilf-err');` +
    `form.addEventListener('submit',function(e){e.preventDefault();` +
    // Honeypot rempli → drop silencieux (faux succès, pas d'appel réseau)
    `if(e.target.elements['ilf_hp']&&e.target.elements['ilf_hp'].value){c.querySelector('.ilf').innerHTML='<div class="ilf-ok">'+C.successMsg+'</div>';return;}` +
    `if(locked()){errBox.style.display='block';errBox.textContent='Demande déjà envoyée. Merci de patienter quelques instants.';return;}` +
    // Consentement requis non coché → blocage
    `if(C.requireConsent){var cb=e.target.elements['consent'];if(!cb||!cb.checked){errBox.style.display='block';errBox.textContent='Veuillez accepter le consentement pour continuer.';return;}}` +
    `errBox.style.display='none';var d={};f.forEach(function(x){var el=e.target.elements[x.name];if(el)d[x.name]=el.value;});` +
    `if(C.requireConsent)d.consent=true;` +
    `var A=attr();Object.keys(A).forEach(function(k){d[k]=A[k];});` +
    `var b=e.target.querySelector('button[type=submit]');b.textContent='Envoi...';b.disabled=true;` +
    `fetch(C.apiBase+'/api/form/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({form_id:C.formId,data:d})}).then(function(r){return r.json()}).then(function(r){` +
    `if(r&&r.data){lock();var ru=(r.data.redirect_url)||C.redirectUrl;if(ru){window.location.href=ru;return;}c.querySelector('.ilf').innerHTML='<div class="ilf-ok">'+(r.data.success_message||C.successMsg)+'</div>';}` +
    `else{b.textContent='Envoyer';b.disabled=false;errBox.style.display='block';errBox.textContent=(r&&r.error)||'Une erreur est survenue. Réessayez.';}` +
    `}).catch(function(){b.textContent='Envoyer';b.disabled=false;errBox.style.display='block';errBox.textContent='Connexion impossible. Vérifiez votre réseau et réessayez.';});});})();`;
  return new Response(script, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
}
