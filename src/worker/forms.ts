// ── Module Forms — Intralys CRM (Sprint 7 enrichi) ──────────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';
import { autoEnrollForTrigger } from './workflows';

export async function handlePublicFormGet(env: Env, url: URL): Promise<Response> {
  const slug = url.pathname.replace('/api/form/', '');
  if (!slug) return json({ error: 'Slug requis' }, 400);
  const form = await env.DB.prepare('SELECT * FROM forms WHERE slug = ? AND is_active = 1').bind(slug).first();
  if (!form) return json({ error: 'Formulaire non trouvé' }, 404);
  return json({ data: form });
}

export async function handlePublicFormSubmit(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { form_id?: string; data?: Record<string, unknown> };
  if (!body.form_id || !body.data) return json({ error: 'form_id et data requis' }, 400);
  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ? AND is_active = 1')
    .bind(body.form_id).first() as Record<string, unknown> | null;
  if (!form) return json({ error: 'Formulaire non trouvé' }, 404);

  const subId = crypto.randomUUID();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  await env.DB.prepare(
    'INSERT INTO form_submissions (id, form_id, client_id, data, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(subId, body.form_id, form.client_id as string, JSON.stringify(body.data), ip, sanitizeInput(ua, 300)).run();

  // Incrémenter total_submissions
  await env.DB.prepare(
    'UPDATE forms SET total_submissions = total_submissions + 1 WHERE id = ?'
  ).bind(body.form_id).run();

  // Quiz scoring : calcul pondéré si form_type = 'quiz'
  let quizScore: number | null = null;
  let quizResult: { range: string; message: string } | null = null;

  if (form.form_type === 'quiz') {
    quizScore = 0;
    const answers = body.data as Record<string, string>;
    for (const [, value] of Object.entries(answers)) {
      const opt = await env.DB.prepare(
        'SELECT weight FROM form_field_options WHERE value = ? LIMIT 1'
      ).bind(String(value)).first() as { weight: number } | null;
      if (opt) quizScore += opt.weight;
    }

    // 3 ranges : low (0-33), mid (34-66), high (67-100)
    const settingsJson = form.settings_json as string;
    let settings: { quiz_results?: Array<{ min: number; max: number; range: string; message: string }> } = {};
    try { settings = JSON.parse(settingsJson || '{}'); } catch { /* ignore */ }

    const ranges = settings.quiz_results || [
      { min: 0, max: 33, range: 'low', message: 'Score faible — explorez nos options de base.' },
      { min: 34, max: 66, range: 'mid', message: 'Bon potentiel — prenez rendez-vous pour en discuter!' },
      { min: 67, max: 100, range: 'high', message: 'Excellent profil — nous avons la solution parfaite!' },
    ];

    const normalizedScore = Math.min(100, Math.max(0, quizScore));
    quizResult = ranges.find(r => normalizedScore >= r.min && normalizedScore <= r.max) || ranges[ranges.length - 1] || null;
  }

  // Créer lead si submit_action = 'create_lead'
  if (form.submit_action === 'create_lead') {
    const d = body.data as Record<string, string>;
    const fName = sanitizeInput(d.name || d.nom || '', 100);
    const fEmail = sanitizeInput(d.email || '', 200).toLowerCase();
    const fPhone = sanitizeInput(d.phone || d.telephone || '', 30);
    const fMsg = sanitizeInput(d.message || d.note || '', 2000);

    // Sprint 51 M3.1 — attribution + consentement (alignés sur le moteur M2).
    // applyLeadMapping lit utm_*/gclid/fbclid/referrer + consent depuis le payload
    // injecté par widget.js (M3.2). consent_status : granted/denied/unknown.
    const { applyLeadMapping } = await import('./lead-mapping');
    const { logIngestConsent } = await import('./leads');
    const m = applyLeadMapping(body.data as Record<string, unknown>, null);
    const consentStatus = m.consent === true ? 'granted'
      : m.consent === false ? 'denied' : 'unknown';
    const attr = m.attribution;

    // Sprint 51 M2 — dédoublonnage unifié (le form submit n'en avait pas).
    // Non destructif : merge enrichit, skip = idempotent. Création conservée.
    const { resolveDedup, mergeIntoLead } = await import('./lead-dedup');
    const decision = await resolveDedup(env, 'email_phone', {
      clientId: form.client_id as string, email: fEmail, phone: fPhone,
    });

    let leadId: string;
    if (decision.action !== 'create' && decision.existingId) {
      leadId = decision.existingId;
      if (decision.action === 'merge') {
        await mergeIntoLead(env, leadId, {
          name: fName, phone: fPhone, message: fMsg, ...attr,
        });
        await audit(env, leadId, 'updated', 'Lead enrichi via formulaire public', '');
      }
      await env.DB.prepare('UPDATE form_submissions SET lead_id = ? WHERE id = ?').bind(leadId, subId).run();
      await logIngestConsent(env, request, leadId, m.consent, consentStatus);
    } else {
      leadId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO leads (id, client_id, name, email, phone, source, message, status, pipeline_id, stage_id,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, referrer, consent_status)
         VALUES (?, ?, ?, ?, ?, 'form', ?, 'new', 'pipeline-default', 'stage-new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        leadId, form.client_id as string, fName, fEmail, fPhone, fMsg,
        attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_term, attr.utm_content,
        attr.gclid, attr.fbclid, attr.referrer, consentStatus
      ).run();
      await env.DB.prepare('UPDATE form_submissions SET lead_id = ? WHERE id = ?').bind(leadId, subId).run();
      await logIngestConsent(env, request, leadId, m.consent, consentStatus);
    }

    // Mapper custom fields si présents
    const fields = form.fields as string;
    let fieldsDef: Array<{ name: string; custom_field_id?: string }> = [];
    try { fieldsDef = JSON.parse(fields || '[]'); } catch { /* ignore */ }

    for (const field of fieldsDef) {
      if (field.custom_field_id && d[field.name]) {
        await env.DB.prepare(
          'INSERT OR REPLACE INTO custom_field_values (lead_id, field_id, value) VALUES (?, ?, ?)'
        ).bind(leadId, field.custom_field_id, sanitizeInput(d[field.name], 500)).run();
      }
    }

    await autoEnrollForTrigger(env, 'form_submitted', leadId);
  }

  return json({
    data: {
      id: subId,
      success_message: form.success_message,
      redirect_url: form.redirect_url,
      quiz_score: quizScore,
      quiz_result: quizResult,
    },
  }, 201);
}

// ── Sprint 7 : Form view tracking ───────────────────────────

export async function handleTrackFormView(
  request: Request,
  env: Env,
  formId: string
): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  const refUrl = request.headers.get('Referer') || '';

  await env.DB.prepare(
    'INSERT INTO form_views (form_id, ip, user_agent, url) VALUES (?, ?, ?, ?)'
  ).bind(formId, ip, sanitizeInput(ua, 300), sanitizeInput(refUrl, 500)).run();

  await env.DB.prepare(
    'UPDATE forms SET total_views = total_views + 1 WHERE id = ?'
  ).bind(formId).run();

  return json({ data: { success: true } });
}

// ── Sprint 7 : Form stats ───────────────────────────────────

export async function handleGetFormStats(
  env: Env,
  auth: { role: string },
  formId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const form = await env.DB.prepare(
    'SELECT total_views, total_submissions FROM forms WHERE id = ?'
  ).bind(formId).first() as { total_views: number; total_submissions: number } | null;

  if (!form) return json({ error: 'Formulaire introuvable' }, 404);

  const conversionRate = form.total_views > 0
    ? ((form.total_submissions / form.total_views) * 100).toFixed(1)
    : '0.0';

  const { results: viewsByDay } = await env.DB.prepare(
    `SELECT date(viewed_at) as day, COUNT(*) as count
     FROM form_views WHERE form_id = ?
     GROUP BY date(viewed_at) ORDER BY day DESC LIMIT 30`
  ).bind(formId).all();

  return json({
    data: {
      total_views: form.total_views,
      total_submissions: form.total_submissions,
      conversion_rate: conversionRate,
      views_by_day: viewsByDay || [],
    },
  });
}

export async function handleGetForms(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const { results } = await env.DB.prepare(
    'SELECT f.*, (SELECT COUNT(*) FROM form_submissions WHERE form_id = f.id) as submission_count FROM forms f ORDER BY f.created_at DESC'
  ).all();
  return json({ data: results || [] });
}

export async function handleGetForm(env: Env, auth: { role: string }, formId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(formId).first();
  if (!form) return json({ error: 'Formulaire introuvable' }, 404);
  return json({ data: form });
}

export async function handleCreateForm(request: Request, env: Env, auth: { role: string; userId: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;
  if (!body.client_id || !body.name || !body.slug) return json({ error: 'client_id, name et slug requis' }, 400);
  const id = crypto.randomUUID();
  const formType = (body.form_type || 'form') as string;
  const settingsJson = body.settings_json ? JSON.stringify(body.settings_json) : '{}';

  await env.DB.prepare(
    `INSERT INTO forms (id, client_id, name, slug, description, fields, submit_action, success_message, form_type, settings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.client_id as string, sanitizeInput(body.name as string, 200), sanitizeInput(body.slug as string, 50),
    sanitizeInput((body.description || '') as string, 500), JSON.stringify(body.fields || []),
    (body.submit_action || 'create_lead') as string, sanitizeInput((body.success_message || 'Merci !') as string, 500),
    formType, settingsJson).run();
  await audit(env, auth.userId, 'form.create', 'form', id);
  return json({ data: { id } }, 201);
}

export async function handleUpdateForm(request: Request, env: Env, auth: { role: string; userId: string }, formId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;
  const u: string[] = []; const p: (string | number)[] = [];
  if (body.name) { u.push('name = ?'); p.push(sanitizeInput(body.name as string, 200)); }
  if (body.fields) { u.push('fields = ?'); p.push(JSON.stringify(body.fields)); }
  if (body.is_active !== undefined) { u.push('is_active = ?'); p.push(body.is_active as number); }
  if (body.success_message) { u.push('success_message = ?'); p.push(sanitizeInput(body.success_message as string, 500)); }
  // Sprint 51 M3.1 — redirect_url configurable (utilisé par le widget après succès)
  if (body.redirect_url !== undefined) { u.push('redirect_url = ?'); p.push(sanitizeInput(body.redirect_url as string, 500)); }
  if (body.submit_action) { u.push('submit_action = ?'); p.push(body.submit_action as string); }
  if (body.form_type) { u.push('form_type = ?'); p.push(body.form_type as string); }
  if (body.settings_json) { u.push('settings_json = ?'); p.push(JSON.stringify(body.settings_json)); }
  if (body.folder_id !== undefined) { u.push('folder_id = ?'); p.push(body.folder_id as string); }
  if (u.length === 0) return json({ error: 'Aucune modification' }, 400);
  u.push("updated_at = datetime('now')"); p.push(formId);
  await env.DB.prepare(`UPDATE forms SET ${u.join(', ')} WHERE id = ?`).bind(...p).run();
  await audit(env, auth.userId, 'form.update', 'form', formId);
  return json({ data: { success: true } });
}

export async function handleDeleteForm(env: Env, auth: { role: string; userId: string }, formId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  await env.DB.prepare('DELETE FROM form_submissions WHERE form_id = ?').bind(formId).run();
  await env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(formId).run();
  await audit(env, auth.userId, 'form.delete', 'form', formId);
  return json({ data: { success: true } });
}

export async function handleGetFormSubmissions(env: Env, auth: { role: string }, formId: string, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const { results } = await env.DB.prepare(
    'SELECT * FROM form_submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(formId, limit).all();
  return json({ data: results || [] });
}
