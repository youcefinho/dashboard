// ── Module Templates — Intralys CRM (Sprint 7 enrichi) ──────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';
import { compileBlocksToHtml, type EmailBlock } from './email-blocks';
// S4 M2 — validation d'entrée (schémas additifs, import only).
import { validate, createTemplateSchemaS4, updateTemplateSchemaS4 } from '../lib/schemas';
import { validationError } from './lib/validate-response';
// Renforcement V2 — helpers PUR engine (validation template SMS/channel).
import { MAX_SMS_LENGTH } from './lib/templates-engine';

export async function handleGetTemplates(
  env: Env,
  _auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  const category = url.searchParams.get('category');
  const channel = url.searchParams.get('channel');
  const folderId = url.searchParams.get('folder_id');

  let query = 'SELECT * FROM email_templates WHERE is_active = 1';
  const params: string[] = [];

  if (category) { query += ' AND category = ?'; params.push(category); }
  if (channel) { query += ' AND channel = ?'; params.push(channel); }
  if (folderId) { query += ' AND folder_id = ?'; params.push(folderId); }

  query += ' ORDER BY created_at DESC';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

export async function handleCreateTemplate(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Accès réservé aux administrateurs' }, 403);

  // S4 M2 — validation d'entrée AVANT la logique (early-return additif).
  // Auth-check admin reste AVANT validation (préservé).
  const parsed = await request.json().catch(() => null);
  const vt = validate(createTemplateSchemaS4, parsed);
  if (!vt.success) return validationError(vt.error);
  const body = vt.data as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const subject = sanitizeInput(body.subject as string, 200);
  const bodyHtml = sanitizeInput(body.body_html as string, 50000);
  const category = sanitizeInput(body.category as string, 20) || 'general';
  const channel = sanitizeInput(body.channel as string, 20) || 'email';
  const preheader = sanitizeInput((body.preheader || '') as string, 200);
  const replyTo = sanitizeInput((body.reply_to || '') as string, 200);
  const folderId = (body.folder_id || null) as string | null;

  if (!name || !subject) return json({ error: 'Nom et sujet requis' }, 400);

  // Validation SMS : max 1000 chars + opt-out obligatoire
  if (channel === 'sms') {
    if (bodyHtml && bodyHtml.length > MAX_SMS_LENGTH) {
      return json({ error: `SMS limité à ${MAX_SMS_LENGTH} caractères (MMS)` }, 400);
    }
    if (bodyHtml && !bodyHtml.includes('STOP') && !bodyHtml.includes('ARRÊT')) {
      return json({ error: 'SMS doit contenir STOP ou ARRÊT pour conformité CASL' }, 400);
    }
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO email_templates (id, name, subject, body_html, category, channel, preheader, reply_to, folder_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, subject, bodyHtml || '', category, channel, preheader, replyTo, folderId).run();

  await audit(env, auth.userId, 'template.create', 'email_template', id);
  return json({ data: { id } }, 201);
}

export async function handleUpdateTemplate(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Accès réservé aux administrateurs' }, 403);

  // S4 M2 — validation d'entrée AVANT la logique (early-return additif).
  const parsed = await request.json().catch(() => null);
  const vt = validate(updateTemplateSchemaS4, parsed);
  if (!vt.success) return validationError(vt.error);
  const body = vt.data as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name as string, 100)); }
  if (body.subject) { updates.push('subject = ?'); params.push(sanitizeInput(body.subject as string, 200)); }
  if (body.body_html !== undefined) { updates.push('body_html = ?'); params.push(sanitizeInput(body.body_html as string, 50000)); }
  if (body.category) { updates.push('category = ?'); params.push(sanitizeInput(body.category as string, 20)); }
  if (body.channel) { updates.push('channel = ?'); params.push(sanitizeInput(body.channel as string, 20)); }
  if (body.preheader !== undefined) { updates.push('preheader = ?'); params.push(sanitizeInput(body.preheader as string, 200)); }
  if (body.reply_to !== undefined) { updates.push('reply_to = ?'); params.push(sanitizeInput(body.reply_to as string, 200)); }
  if (body.folder_id !== undefined) { updates.push('folder_id = ?'); params.push(body.folder_id as string | null); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);

  updates.push("updated_at = datetime('now')");
  params.push(templateId);

  await env.DB.prepare(
    `UPDATE email_templates SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return json({ data: { success: true } });
}

export async function handleDeleteTemplate(
  env: Env,
  auth: { userId: string; role: string },
  templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Accès réservé aux administrateurs' }, 403);
  await env.DB.prepare('DELETE FROM email_templates WHERE id = ?').bind(templateId).run();
  await audit(env, auth.userId, 'template.delete', 'email_template', templateId);
  return json({ data: { success: true } });
}

// ── Sprint 7 : Save blocks JSON + compile HTML ─────────────

export async function handleSaveTemplateBlocks(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { blocks: EmailBlock[]; preheader?: string };
  if (!body.blocks || !Array.isArray(body.blocks)) {
    return json({ error: 'blocks requis (tableau)' }, 400);
  }

  const compiledHtml = compileBlocksToHtml(body.blocks, body.preheader);

  await env.DB.prepare(
    `UPDATE email_templates SET blocks_json = ?, body_html = ?, preheader = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(JSON.stringify(body.blocks), compiledHtml, body.preheader || '', templateId).run();

  return json({ data: { success: true, html_length: compiledHtml.length } });
}

// ── Sprint 7 : Send test email (mock mode) ──────────────────

export async function handleSendTestEmail(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { template_id: string; to_email: string };
  if (!body.template_id || !body.to_email) return json({ error: 'template_id et to_email requis' }, 400);

  const template = await env.DB.prepare(
    'SELECT * FROM email_templates WHERE id = ?'
  ).bind(body.template_id).first() as Record<string, unknown> | null;

  if (!template) return json({ error: 'Template introuvable' }, 404);

  const useMock = env.USE_MOCKS === 'true' || !env.RESEND_API_KEY;

  if (useMock) {
    return json({ data: { success: true, mock: true, message: `Email test envoyé (mock) à ${body.to_email}` } });
  }

  // Envoi réel via Resend
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'Intralys CRM <noreply@intralys.com>',
        to: [body.to_email],
        subject: `[TEST] ${template.subject as string}`,
        html: template.body_html as string,
      }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}`);
    return json({ data: { success: true, mock: false } });
  } catch (err) {
    console.error('Send test email error:', err);
    return json({ error: 'Erreur envoi email test' }, 500);
  }
}

// ── Sprint 7 : Duplicate template (A/B variant) ─────────────

export async function handleDuplicateTemplate(
  env: Env,
  auth: { userId: string; role: string },
  templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const original = await env.DB.prepare(
    'SELECT * FROM email_templates WHERE id = ?'
  ).bind(templateId).first() as Record<string, unknown> | null;

  if (!original) return json({ error: 'Template introuvable' }, 404);

  const newId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO email_templates (id, name, subject, body_html, category, channel, blocks_json, preheader, reply_to, folder_id, ab_variant_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    newId,
    `${original.name} (Variant B)`,
    original.subject as string,
    original.body_html as string,
    original.category as string,
    original.channel as string,
    (original.blocks_json || null) as string | null,
    (original.preheader || '') as string,
    (original.reply_to || '') as string,
    (original.folder_id || null) as string | null,
    templateId // lie au parent
  ).run();

  await audit(env, auth.userId, 'template.duplicate', 'email_template', newId);
  return json({ data: { id: newId, parent_id: templateId } }, 201);
}

// ── Sprint 7 : Template folders ─────────────────────────────

export async function handleGetTemplateFolders(
  env: Env,
  _auth: { userId: string; role: string }
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM template_folders ORDER BY sort_order ASC, name ASC'
  ).all();
  return json({ data: results || [] });
}

export async function handleCreateTemplateFolder(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { name: string; client_id?: string };
  if (!body.name) return json({ error: 'Nom requis' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO template_folders (id, client_id, user_id, name) VALUES (?, ?, ?, ?)'
  ).bind(id, body.client_id || '', auth.userId, sanitizeInput(body.name, 100)).run();

  return json({ data: { id } }, 201);
}

// ── Interpolation enrichie (lead + custom fields) ───────────

export async function handleInterpolateTemplate(
  request: Request,
  env: Env,
  _auth: { userId: string; role: string }
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  let text = body.text as string;
  const leadId = body.lead_id as string;

  if (!text) return json({ data: { text: '' } });
  if (!leadId) return json({ data: { text } });

  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) return json({ data: { text } });

  // Variables lead standard
  text = text.replace(/\{\{lead\.name\}\}/g, (lead.name as string) || '');
  text = text.replace(/\{\{lead\.first_name\}\}/g, (((lead.name as string) || '').split(' ')[0]) || '');
  text = text.replace(/\{\{lead\.email\}\}/g, (lead.email as string) || '');
  text = text.replace(/\{\{lead\.phone\}\}/g, (lead.phone as string) || '');
  text = text.replace(/\{\{lead\.company\}\}/g, (lead.company as string) || '');

  // Variables custom fields
  const { results: customValues } = await env.DB.prepare(
    `SELECT cfd.slug, cfv.value FROM custom_field_values cfv 
     JOIN custom_field_defs cfd ON cfv.field_id = cfd.id 
     WHERE cfv.lead_id = ?`
  ).bind(leadId).all();

  for (const cv of (customValues || [])) {
    const slug = cv.slug as string;
    const value = cv.value as string;
    text = text.replace(new RegExp(`\\{\\{custom\\.${slug}\\}\\}`, 'g'), value);
  }

  // Variables utilitaires
  text = text.replace(/\{\{year\}\}/g, new Date().getFullYear().toString());
  text = text.replace(/\{\{date\}\}/g, new Date().toLocaleDateString('fr-CA'));

  return json({ data: { text } });
}
