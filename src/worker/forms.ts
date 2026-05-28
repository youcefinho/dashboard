// ── Module Forms — Intralys CRM (Sprint 7 enrichi) ──────────
import type { Env } from './types';
import type { FormFieldAnalyticsRow } from '../lib/types';
import { sanitizeInput, json, audit } from './helpers';
import { autoEnrollForTrigger } from './workflows';
import { validate, publicFormSubmitSchema, createFormSchema } from '../lib/schemas';
import { validationError } from './lib/validate-response';
// Renforcement V2 — helpers PUR engine (détection bot).
import {
  detectBotSubmission,
} from './lib/forms-engine';

// ── LOT FORMS XL (Sprint 5) — éval conditionnelle serveur (Manager-B) ──────────
// Structure d'un champ dans le JSON forms.fields (cf. §6.B-bis). conditional/step
// OPTIONNELS : un champ sans conditional est TOUJOURS visible (legacy).
type FormFieldShape = {
  name: string;
  required?: boolean;
  custom_field_id?: string;
  conditional?: { field_name?: string; operator?: string; value?: string };
};

// Évalue la VISIBILITÉ d'un champ selon son `conditional` contre les valeurs
// soumises dans `data`. Opérateurs : equals/not_equals/contains/is_empty/
// is_not_empty (§6.D). En cas de doute (conditional malformé / opérateur inconnu)
// le champ est considéré VISIBLE — l'éval conditionnelle ne doit JAMAIS empêcher
// une soumission légitime.
function isFieldVisible(field: FormFieldShape, data: Record<string, unknown>): boolean {
  const cond = field.conditional;
  if (!cond || !cond.field_name || !cond.operator) return true; // pas de condition = visible
  const raw = data[cond.field_name];
  const actual = raw === undefined || raw === null ? '' : String(raw);
  const expected = cond.value === undefined || cond.value === null ? '' : String(cond.value);
  switch (cond.operator) {
    case 'equals': return actual === expected;
    case 'not_equals': return actual !== expected;
    case 'contains': return actual.includes(expected);
    case 'is_empty': return actual.trim() === '';
    case 'is_not_empty': return actual.trim() !== '';
    default: return true; // opérateur inconnu ⇒ visible (ne bloque pas)
  }
}

export async function handlePublicFormGet(env: Env, url: URL): Promise<Response> {
  const slug = url.pathname.replace('/api/form/', '');
  if (!slug) return json({ error: 'Slug requis' }, 400);
  const form = await env.DB.prepare('SELECT * FROM forms WHERE slug = ? AND is_active = 1').bind(slug).first();
  if (!form) return json({ error: 'Formulaire non trouvé' }, 404);
  return json({ data: form });
}

export async function handlePublicFormSubmit(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.json().catch(() => null);
  const v = validate(publicFormSubmitSchema, rawBody);
  if (!v.success) return validationError(v.error);
  const body = v.data as { form_id?: string; data?: Record<string, unknown> };
  if (!body.form_id || !body.data) return json({ error: 'form_id et data requis' }, 400);
  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ? AND is_active = 1')
    .bind(body.form_id).first() as Record<string, unknown> | null;
  if (!form) return json({ error: 'Formulaire non trouvé' }, 404);

  const submitData = body.data as Record<string, unknown>;

  // ── Anti-spam HONEYPOT (§6.D) — champ caché `_hp` (convention FIGÉE). Posé par
  //    Manager-C dans PublicForm, jamais rempli par un humain. Rempli (valeur non
  //    vide) ⇒ REJET SILENCIEUX : on renvoie un succès factice (201, même forme
  //    que le succès réel) SANS créer de submission/lead ni autoEnrollForTrigger.
  //    Aucun signal au bot. Placé TÔT, avant toute écriture.
  const hp = submitData['_hp'];
  if (hp !== undefined && hp !== null && String(hp).trim() !== '') {
    return json({
      data: {
        id: crypto.randomUUID(),
        success_message: form.success_message,
        redirect_url: form.redirect_url,
        quiz_score: null,
        quiz_result: null,
      },
    }, 201);
  }

  // Renforcement V2 — détection bot via engine PUR (vérifie le honeypot de façon centralisée).
  if (detectBotSubmission(submitData)) {
    return json({
      data: {
        id: crypto.randomUUID(),
        success_message: form.success_message,
        redirect_url: form.redirect_url,
        quiz_score: null,
        quiz_result: null,
      },
    }, 201);
  }

  // ── Éval conditionnelle serveur (§6.D) — ne valider `required` que pour les
  //    champs VISIBLES. Un champ caché par condition non satisfaite ne bloque pas
  //    la soumission. Best-effort : un fields JSON illisible ⇒ pas de blocage.
  {
    let fieldsForValidation: FormFieldShape[] = [];
    try { fieldsForValidation = JSON.parse((form.fields as string) || '[]'); } catch { /* legacy / illisible ⇒ skip */ }
    for (const field of fieldsForValidation) {
      if (!field || !field.name || field.name === '_hp') continue; // honeypot jamais requis
      if (!field.required) continue;
      if (!isFieldVisible(field, submitData)) continue; // champ caché ⇒ pas requis
      const val = submitData[field.name];
      const empty = val === undefined || val === null
        || (typeof val === 'string' && val.trim() === '')
        || (Array.isArray(val) && val.length === 0);
      if (empty) return json({ error: `Champ requis manquant: ${field.name}` }, 400);
    }
  }

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
    let fieldsDef: FormFieldShape[] = [];
    try { fieldsDef = JSON.parse(fields || '[]'); } catch { /* ignore */ }

    for (const field of fieldsDef) {
      // Éval conditionnelle (§6.D) : un champ caché par condition non satisfaite
      // n'est NI requis NI mappé. Champ sans conditional = toujours visible.
      if (!isFieldVisible(field, submitData)) continue;
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
  const rawBody = await request.json().catch(() => null);
  const v = validate(createFormSchema, rawBody);
  if (!v.success) return validationError(v.error);
  const body = v.data as Record<string, unknown>;
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

// ════════════════════════════════════════════════════════════
// ── LOT FORMS XL (Sprint 5) — STUBS Phase A (Manager-A) ───────
// ⚠ ZONE STUBS : Phase A n'ajoute QUE ces 2 stubs en FIN de fichier. Manager-B
// (Phase B) remplit les corps réels ET fait le reste de forms.ts (éval
// conditionnelle serveur dans handlePublicFormSubmit : ne valider `required` que
// pour les champs VISIBLES ; rejet honeypot : champ caché spécifique rempli ⇒
// 200 silencieux sans créer de lead). NE PAS modifier ces signatures.
// Voir docs/LOT-FORMS-XL.md §6.F / §6.H.
// ════════════════════════════════════════════════════════════

// POST /api/form/:slug/field-event — PUBLIC (aucun auth). Journalise un
// événement de champ (focus/blur/complete/abandon) pour l'analytics drop-off.
// Corps réel Phase B (Manager-B) : résoudre slug → form_id, INSERT INTO
// form_field_events (form_id, field_name, event, session_id). Best-effort : le
// tracking ne doit JAMAIS bloquer le remplissage.
export async function handleLogFormFieldEvent(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  // Best-effort intégral : tout échec (body illisible, slug inconnu, table
  // absente) ⇒ on renvoie 200 success sans throw. Le tracking ne doit JAMAIS
  // bloquer le remplissage côté visiteur.
  try {
    const raw = await request.json().catch(() => null) as
      { field_name?: string; event?: string; session_id?: string } | null;
    if (!raw || !raw.field_name) return json({ data: { success: true } });

    // Résoudre slug → form_id (lien APPLICATIF, pas de FK). Slug inconnu ⇒
    // best-effort silencieux (pas d'INSERT, mais 200).
    const f = await env.DB.prepare('SELECT id FROM forms WHERE slug = ? AND is_active = 1')
      .bind(slug).first() as { id: string } | null;
    if (!f) return json({ data: { success: true } });

    await env.DB.prepare(
      'INSERT INTO form_field_events (form_id, field_name, event, session_id) VALUES (?, ?, ?, ?)'
    ).bind(
      f.id,
      sanitizeInput(raw.field_name, 200),
      sanitizeInput(raw.event || 'interaction', 50),
      sanitizeInput(raw.session_id || '', 100),
    ).run();
  } catch { /* best-effort : ne jamais bloquer */ }
  return json({ data: { success: true } });
}

// GET /api/forms/:id/field-analytics — PROTÉGÉ (admin via auth.role, comme les
// autres handlers forms). Agrège le drop-off par champ depuis form_field_events
// + form_submissions. Corps réel Phase B (Manager-B) → FormFieldAnalyticsRow[].
export async function handleGetFormFieldAnalytics(
  env: Env,
  auth: { role: string },
  formId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  // Best-effort : table absente / formId inconnu ⇒ { data: [] }, jamais de 500.
  try {
    // Agrégation par champ depuis form_field_events :
    //   reached    = nb de sessions DISTINCTES ayant interagi avec le champ
    //                (fallback : nb d'événements si session_id vide).
    //   completed  = nb de sessions DISTINCTES ayant marqué le champ 'complete'.
    // Le drop-off par champ = (reached - completed) / reached.
    const { results } = await env.DB.prepare(
      `SELECT
         field_name,
         COUNT(DISTINCT CASE WHEN session_id IS NOT NULL AND session_id != ''
                             THEN session_id END) AS sessions_reached,
         COUNT(*) AS events_reached,
         COUNT(DISTINCT CASE WHEN event = 'complete'
                             AND session_id IS NOT NULL AND session_id != ''
                             THEN session_id END) AS sessions_completed,
         SUM(CASE WHEN event = 'complete' THEN 1 ELSE 0 END) AS events_completed
       FROM form_field_events
       WHERE form_id = ? AND field_name IS NOT NULL AND field_name != ''
       GROUP BY field_name
       ORDER BY events_reached DESC`
    ).bind(formId).all() as {
      results: Array<{
        field_name: string;
        sessions_reached: number;
        events_reached: number;
        sessions_completed: number;
        events_completed: number;
      }>;
    };

    // Recoupement form_submissions : nb de soumissions complètes du formulaire
    // (baseline de complétion globale). Best-effort.
    let totalSubmissions = 0;
    try {
      const sub = await env.DB.prepare(
        'SELECT COUNT(*) AS c FROM form_submissions WHERE form_id = ?'
      ).bind(formId).first() as { c: number } | null;
      totalSubmissions = sub?.c ?? 0;
    } catch { /* best-effort */ }

    const rows: FormFieldAnalyticsRow[] = (results || []).map((r) => {
      // Préférer les sessions distinctes ; fallback sur le compte d'événements
      // si aucun session_id n'a été fourni par le client.
      const reached = r.sessions_reached > 0 ? r.sessions_reached : r.events_reached;
      // completion par champ : sessions 'complete' du champ, sinon recoupe avec
      // les soumissions réelles (un champ atteint par tous puis soumis).
      let completed = r.sessions_completed > 0 ? r.sessions_completed : r.events_completed;
      if (completed === 0 && totalSubmissions > 0) {
        completed = Math.min(reached, totalSubmissions);
      }
      const dropoff = reached > 0
        ? Math.round(((reached - completed) / reached) * 1000) / 10
        : 0;
      return {
        field_name: r.field_name,
        reached,
        completed,
        dropoff_rate: Math.max(0, dropoff),
      };
    });

    return json({ data: rows });
  } catch {
    return json({ data: [] as FormFieldAnalyticsRow[] });
  }
}
