// ── Module Workflows — Intralys CRM ─────────────────────────
import { Resend } from 'resend';
import type { Env } from './types';
import { sanitizeInput, json, sendSms, isLeadDnd } from './helpers';

export async function handleGetWorkflows(
  env: Env,
  _auth: { userId: string; role: string }
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT w.*,
       (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = w.id) as steps_count,
       (SELECT COUNT(*) FROM workflow_enrollments WHERE workflow_id = w.id AND status = 'active') as active_enrollments,
       (SELECT COUNT(*) FROM workflow_execution_log el
        JOIN workflow_enrollments we ON el.enrollment_id = we.id
        WHERE we.workflow_id = w.id) as total_executions
     FROM workflows w
     ORDER BY w.created_at DESC`
  ).all();

  return json({ data: results || [] });
}

export async function handleGetWorkflowDetail(
  env: Env,
  _auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  const workflow = await env.DB.prepare('SELECT * FROM workflows WHERE id = ?').bind(workflowId).first();
  if (!workflow) {
    return json({ error: 'Workflow introuvable' }, 404);
  }

  const { results: steps } = await env.DB.prepare(
    'SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC'
  ).bind(workflowId).all();

  const { results: enrollments } = await env.DB.prepare(
    `SELECT we.*, l.name as lead_name
     FROM workflow_enrollments we
     LEFT JOIN leads l ON we.lead_id = l.id
     WHERE we.workflow_id = ?
     ORDER BY we.enrolled_at DESC
     LIMIT 50`
  ).bind(workflowId).all();

  return json({
    data: {
      ...workflow,
      steps: steps || [],
      enrollments: enrollments || [],
    },
  });
}

export async function handleCreateWorkflow(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const description = sanitizeInput(body.description as string, 500);
  const triggerType = sanitizeInput(body.trigger_type as string, 30);
  const triggerConfig = sanitizeInput(body.trigger_config as string, 1000) || '{}';

  if (!name || !triggerType) {
    return json({ error: 'Nom et type de déclencheur requis' }, 400);
  }

  const workflowId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO workflows (id, client_id, name, description, trigger_type, trigger_config)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(workflowId, body.client_id as string || null, name, description, triggerType, triggerConfig).run();

  const steps = body.steps as Array<{ step_order: number; step_type: string; config: string }> | undefined;
  if (steps && Array.isArray(steps)) {
    for (const step of steps) {
      const stepId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, config)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(stepId, workflowId, step.step_order, step.step_type, step.config || '{}').run();
    }
  }

  return json({ data: { id: workflowId } }, 201);
}

export async function handleUpdateWorkflow(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | null)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name as string, 100)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description as string, 500)); }
  if (body.trigger_type) { updates.push('trigger_type = ?'); params.push(sanitizeInput(body.trigger_type as string, 30)); }
  if (body.trigger_config) { updates.push('trigger_config = ?'); params.push(sanitizeInput(body.trigger_config as string, 1000)); }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(workflowId);

  await env.DB.prepare(
    `UPDATE workflows SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  const steps = body.steps as Array<{ step_order: number; step_type: string; config: string }> | undefined;
  if (steps && Array.isArray(steps)) {
    await env.DB.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').bind(workflowId).run();
    for (const step of steps) {
      const stepId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, config)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(stepId, workflowId, step.step_order, step.step_type, step.config || '{}').run();
    }
  }

  return json({ data: { success: true } });
}

export async function handleDeleteWorkflow(
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  await env.DB.prepare('DELETE FROM workflow_enrollments WHERE workflow_id = ?').bind(workflowId).run();
  await env.DB.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').bind(workflowId).run();
  await env.DB.prepare('DELETE FROM workflows WHERE id = ?').bind(workflowId).run();

  return json({ data: { success: true } });
}

export async function handleToggleWorkflow(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as { is_active: number };
  const isActive = body.is_active ? 1 : 0;

  await env.DB.prepare(
    "UPDATE workflows SET is_active = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(isActive, workflowId).run();

  return json({ data: { success: true, is_active: isActive } });
}

export async function handleEnrollLead(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  const body = await request.json() as { lead_id: string };
  const leadId = sanitizeInput(body.lead_id, 100);

  if (!leadId) {
    return json({ error: 'lead_id requis' }, 400);
  }

  const workflow = await env.DB.prepare(
    'SELECT id FROM workflows WHERE id = ? AND is_active = 1'
  ).bind(workflowId).first();
  if (!workflow) {
    return json({ error: 'Workflow introuvable ou inactif' }, 404);
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM workflow_enrollments WHERE workflow_id = ? AND lead_id = ? AND status = 'active'"
  ).bind(workflowId, leadId).first();
  if (existing) {
    return json({ error: 'Ce lead est déjà inscrit dans ce workflow' }, 409);
  }

  const firstStep = await env.DB.prepare(
    'SELECT id, config, step_type FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC LIMIT 1'
  ).bind(workflowId).first() as { id: string; config: string; step_type: string } | null;

  const enrollmentId = crypto.randomUUID();
  let nextActionAt: string | null = null;

  if (firstStep?.step_type === 'wait') {
    try {
      const config = JSON.parse(firstStep.config) as { delay_minutes?: number };
      const delay = config.delay_minutes || 0;
      nextActionAt = new Date(Date.now() + delay * 60 * 1000).toISOString();
    } catch { /* config invalide */ }
  }

  await env.DB.prepare(
    `INSERT INTO workflow_enrollments (id, workflow_id, lead_id, current_step_id, status, next_action_at)
     VALUES (?, ?, ?, ?, 'active', ?)`
  ).bind(enrollmentId, workflowId, leadId, firstStep?.id || null, nextActionAt).run();

  const lead = await env.DB.prepare('SELECT client_id FROM leads WHERE id = ?').bind(leadId).first() as { client_id: string } | null;
  await env.DB.prepare(
    `INSERT INTO activity_log (lead_id, client_id, user_id, action, details)
     VALUES (?, ?, ?, 'workflow_enrolled', ?)`
  ).bind(leadId, lead?.client_id || '', auth.userId, JSON.stringify({ workflow_id: workflowId, enrollment_id: enrollmentId })).run();

  return json({ data: { id: enrollmentId } }, 201);
}

// ── Auto-enroll helper ──────────────────────────────────────

export async function autoEnroll(env: Env, workflowId: string, leadId: string): Promise<void> {
  const exists = await env.DB.prepare(
    "SELECT id FROM workflow_enrollments WHERE workflow_id = ? AND lead_id = ? AND status = 'active'"
  ).bind(workflowId, leadId).first();
  if (exists) return;
  const firstStep = await env.DB.prepare(
    'SELECT id, config, step_type FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC LIMIT 1'
  ).bind(workflowId).first() as { id: string; config: string; step_type: string } | null;
  if (!firstStep) return;
  let nextAt = new Date().toISOString();
  if (firstStep.step_type === 'wait') {
    try { nextAt = new Date(Date.now() + ((JSON.parse(firstStep.config) as { delay_minutes?: number }).delay_minutes || 0) * 60_000).toISOString(); } catch { /* */ }
  }
  await env.DB.prepare(
    `INSERT INTO workflow_enrollments (id, workflow_id, lead_id, current_step_id, status, next_action_at)
     VALUES (?, ?, ?, ?, 'active', ?)`
  ).bind(crypto.randomUUID(), workflowId, leadId, firstStep.id, nextAt).run();
}

// ── Workflow Queue Processor ────────────────────────────────

export async function processWorkflowQueue(env: Env): Promise<void> {
  const now = new Date().toISOString();

  const { results: due } = await env.DB.prepare(
    `SELECT * FROM workflow_enrollments
     WHERE status = 'active' AND next_action_at IS NOT NULL AND next_action_at <= ?
     ORDER BY next_action_at ASC LIMIT 50`
  ).bind(now).all();

  for (const e of (due || []) as Array<Record<string, unknown>>) {
    try {
      await advanceEnrollment(env, e);
    } catch (err) {
      console.error('Workflow step failed', e.id, err);
      await env.DB.prepare(
        `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result)
         VALUES (?, ?, 'failed', ?)`
      ).bind(e.id as string, (e.current_step_id as string) || '', JSON.stringify({ error: String(err) })).run();
    }
  }
}

async function advanceEnrollment(env: Env, enrollment: Record<string, unknown>): Promise<void> {
  const enrollmentId = enrollment.id as string;
  const workflowId = enrollment.workflow_id as string;
  const leadId = enrollment.lead_id as string;
  const currentStepId = enrollment.current_step_id as string | null;

  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) {
    await env.DB.prepare("UPDATE workflow_enrollments SET status = 'cancelled' WHERE id = ?").bind(enrollmentId).run();
    return;
  }

  const step = currentStepId
    ? await env.DB.prepare('SELECT * FROM workflow_steps WHERE id = ?').bind(currentStepId).first() as Record<string, unknown> | null
    : null;

  if (step) {
    await executeStep(env, step, lead, enrollmentId);
    await env.DB.prepare(
      `INSERT INTO workflow_execution_log (enrollment_id, step_id, status) VALUES (?, ?, 'executed')`
    ).bind(enrollmentId, step.id as string).run();
  }

  const currentOrder = (step?.step_order as number) || 0;
  const nextStep = await env.DB.prepare(
    'SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1'
  ).bind(workflowId, currentOrder).first() as Record<string, unknown> | null;

  if (!nextStep) {
    await env.DB.prepare(
      "UPDATE workflow_enrollments SET status = 'completed', completed_at = datetime('now'), next_action_at = NULL WHERE id = ?"
    ).bind(enrollmentId).run();
    return;
  }

  let nextAt: string;
  if (nextStep.step_type === 'wait') {
    let delay = 0;
    try { delay = (JSON.parse(nextStep.config as string) as { delay_minutes?: number }).delay_minutes || 0; } catch { /* */ }
    nextAt = new Date(Date.now() + delay * 60_000).toISOString();
  } else {
    nextAt = new Date().toISOString();
  }

  await env.DB.prepare(
    "UPDATE workflow_enrollments SET current_step_id = ?, next_action_at = ? WHERE id = ?"
  ).bind(nextStep.id as string, nextAt, enrollmentId).run();
}

async function executeStep(env: Env, step: Record<string, unknown>, lead: Record<string, unknown>, _enrollmentId: string): Promise<void> {
  const stepType = step.step_type as string;
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(step.config as string); } catch { /* */ }

  const interpolate = (s: string): string =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(lead[key] ?? ''));

  switch (stepType) {
    case 'wait':
      return;

    case 'send_email': {
      if (!env.RESEND_API_KEY) return;
      // Vérification DND email
      const emailDnd = await isLeadDnd(env, lead.id as string, 'email');
      if (emailDnd) return;
      const tplId = config.template_id as string;
      const tpl = tplId
        ? await env.DB.prepare('SELECT subject, body_html FROM email_templates WHERE id = ?').bind(tplId).first() as { subject: string; body_html: string } | null
        : null;
      if (!tpl) return;
      try {
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Intralys CRM <noreply@intralys.com>',
          to: [lead.email as string],
          subject: interpolate(tpl.subject),
          html: interpolate(tpl.body_html),
        });
        await env.DB.prepare(
          `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by)
           VALUES (?, ?, ?, 'outbound', 'email', ?, ?, 'sent', 'workflow')`
        ).bind(crypto.randomUUID(), lead.id as string, lead.client_id as string, interpolate(tpl.subject), interpolate(tpl.body_html)).run();
      } catch (err) {
        console.error('Workflow send_email failed:', err);
        await env.DB.prepare(
          `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result)
           VALUES (?, ?, 'failed', ?)`
        ).bind(_enrollmentId, step.id as string, JSON.stringify({ error: String(err) })).run();
      }
      return;
    }

    case 'send_sms': {
      if (!lead.phone) return;
      // Vérification DND SMS
      const smsDnd = await isLeadDnd(env, lead.id as string, 'sms');
      if (smsDnd) return;
      const smsBody = config.message ? interpolate(config.message as string) : `Bonjour ${lead.name}, merci pour votre intérêt !`;
      try {
        const result = await sendSms(env, lead.phone as string, smsBody);
        if (result.success) {
          await env.DB.prepare(
            `INSERT INTO messages (id, lead_id, client_id, direction, channel, body, status, sent_by, external_id)
             VALUES (?, ?, ?, 'outbound', 'sms', ?, 'sent', 'workflow', ?)`
          ).bind(crypto.randomUUID(), lead.id as string, lead.client_id as string, smsBody, result.sid || '').run();
        } else {
          await env.DB.prepare(
            `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result)
             VALUES (?, ?, 'failed', ?)`
          ).bind(_enrollmentId, step.id as string, JSON.stringify({ error: result.error })).run();
        }
      } catch (err) {
        console.error('Workflow send_sms failed:', err);
      }
      return;
    }

    case 'add_tag':
      if (config.tag) {
        await env.DB.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag) VALUES (?, ?)')
          .bind(lead.id as string, String(config.tag).toLowerCase()).run();
      }
      return;

    case 'remove_tag':
      if (config.tag) {
        await env.DB.prepare('DELETE FROM lead_tags WHERE lead_id = ? AND tag = ?')
          .bind(lead.id as string, String(config.tag).toLowerCase()).run();
      }
      return;

    case 'change_status':
      if (config.status && ['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'].includes(config.status as string)) {
        await env.DB.prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(config.status as string, lead.id as string).run();
        await env.DB.prepare(
          "INSERT INTO activity_log (lead_id, client_id, action, details) VALUES (?, ?, 'status_change', ?)"
        ).bind(lead.id as string, lead.client_id as string, JSON.stringify({ to: config.status, by: 'workflow' })).run();
      }
      return;

    case 'notify':
      await env.DB.prepare(
        `INSERT INTO notifications (user_id, client_id, icon, title, description, link)
         SELECT id, ?, '🔔', 'Workflow', ?, ?
         FROM users WHERE (client_id = ? OR role = 'admin') AND is_active = 1`
      ).bind(
        lead.client_id as string,
        interpolate(String(config.message || 'Action requise')),
        `/leads/${lead.id}`,
        lead.client_id as string,
      ).run();
      return;

    case 'webhook': {
      const url = String(config.url || '');
      if (!url || !url.startsWith('https://')) return;
      try {
        await fetch(url, {
          method: String(config.method || 'POST'),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead }),
        });
      } catch (err) {
        console.warn('Webhook step failed', err);
      }
      return;
    }

    default:
      return;
  }
}
