// ── Module Workflows — Intralys CRM ─────────────────────────
import { Resend } from 'resend';
import type { Env } from './types';
import { sanitizeInput, json, sendSms, isLeadDnd } from './helpers';

export async function handleGetWorkflows(
  env: Env,
  _auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  const folderId = url.searchParams.get('folder_id');
  let query = `SELECT w.*,
       (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = w.id) as steps_count,
       (SELECT COUNT(*) FROM workflow_enrollments WHERE workflow_id = w.id AND status = 'active') as active_enrollments,
       (SELECT COUNT(*) FROM workflow_execution_log el
        JOIN workflow_enrollments we ON el.enrollment_id = we.id
        WHERE we.workflow_id = w.id) as total_executions
     FROM workflows w`;
  
  if (folderId) {
    query += ` WHERE w.folder_id = ? ORDER BY w.created_at DESC`;
    const { results } = await env.DB.prepare(query).bind(folderId).all();
    return json({ data: results || [] });
  } else {
    query += ` ORDER BY w.created_at DESC`;
    const { results } = await env.DB.prepare(query).all();
    return json({ data: results || [] });
  }
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
    'SELECT id, config, step_type FROM workflow_steps WHERE workflow_id = ? AND (parent_step_id IS NULL OR parent_step_id = \'trigger_1\') ORDER BY step_order ASC LIMIT 1'
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
//
// Sprint E9 M1 — généralisation entité-agnostique RÉTRO-COMPAT.
// `EnrollTarget` permet d'enrôler un lead CRM (rétro-compat Sprint 46/E7),
// un client e-comm, ou une commande e-comm. Le contrat FIGÉ (M2/M3 codent
// contre) :
//   type EnrollTarget = { leadId?:string; customerId?:string; orderId?:string }
//   autoEnrollForTrigger(env, triggerType, target: string | EnrollTarget)
//   - `string`  ⇒ leadId (RÉTRO-COMPAT : tous les call sites existants —
//                 forms/tasks/bookings/scoring/tracking/E7 cart-recovery
//                 l.233 — restent valides bit-pour-bit, entity_type='lead').
//   - `{customerId|orderId}` sans leadId ⇒ entité e-comm, lead_id reste NULL.
// Triggers e-comm reconnus : 'order_created' | 'order_paid' |
//   'cart_abandoned' (existant E7) | 'post_purchase' | 'win_back' |
//   'refund_issued'. (Triggers CRM Sprint 46 inchangés.)
export type EnrollTarget = { leadId?: string; customerId?: string; orderId?: string };

// Normalise la cible vers (entity_type, leadId, customerId, orderId).
// string ⇒ leadId (branche LEAD historique). Objet ⇒ priorité order > customer
// > lead (un order implique un customer ; entity_type le plus spécifique).
function resolveEnrollTarget(target: string | EnrollTarget): {
  entityType: 'lead' | 'customer' | 'order';
  leadId: string | null;
  customerId: string | null;
  orderId: string | null;
} {
  if (typeof target === 'string') {
    return { entityType: 'lead', leadId: target, customerId: null, orderId: null };
  }
  if (target.orderId) {
    return { entityType: 'order', leadId: target.leadId || null, customerId: target.customerId || null, orderId: target.orderId };
  }
  if (target.customerId) {
    return { entityType: 'customer', leadId: target.leadId || null, customerId: target.customerId, orderId: null };
  }
  return { entityType: 'lead', leadId: target.leadId || null, customerId: null, orderId: null };
}

export async function autoEnroll(env: Env, workflowId: string, target: string | EnrollTarget): Promise<void> {
  const t = resolveEnrollTarget(target);

  // Garde anti-doublon par entité (même logique que Sprint 46 pour les leads :
  // un seul enrollment actif par (workflow, entité)).
  let dedupCol: 'lead_id' | 'customer_id' | 'order_id';
  let dedupVal: string | null;
  if (t.entityType === 'order') { dedupCol = 'order_id'; dedupVal = t.orderId; }
  else if (t.entityType === 'customer') { dedupCol = 'customer_id'; dedupVal = t.customerId; }
  else { dedupCol = 'lead_id'; dedupVal = t.leadId; }
  if (!dedupVal) return;

  const exists = await env.DB.prepare(
    `SELECT id FROM workflow_enrollments WHERE workflow_id = ? AND ${dedupCol} = ? AND status = 'active'`
  ).bind(workflowId, dedupVal).first();
  if (exists) return;
  const firstStep = await env.DB.prepare(
    'SELECT id, config, step_type FROM workflow_steps WHERE workflow_id = ? AND (parent_step_id IS NULL OR parent_step_id = \'trigger_1\') ORDER BY step_order ASC LIMIT 1'
  ).bind(workflowId).first() as { id: string; config: string; step_type: string } | null;
  if (!firstStep) return;
  let nextAt = new Date().toISOString();
  if (firstStep.step_type === 'wait') {
    try { nextAt = new Date(Date.now() + ((JSON.parse(firstStep.config) as { delay_minutes?: number }).delay_minutes || 0) * 60_000).toISOString(); } catch { /* */ }
  }
  await env.DB.prepare(
    `INSERT INTO workflow_enrollments (id, workflow_id, lead_id, customer_id, order_id, entity_type, current_step_id, status, next_action_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  ).bind(crypto.randomUUID(), workflowId, t.leadId, t.customerId, t.orderId, t.entityType, firstStep.id, nextAt).run();
}

export async function autoEnrollForTrigger(env: Env, triggerType: string, target: string | EnrollTarget): Promise<void> {
  const { results: workflows } = await env.DB.prepare(
    "SELECT id FROM workflows WHERE is_active = 1 AND trigger_type = ?"
  ).bind(triggerType).all();
  if (workflows && workflows.length > 0) {
    for (const w of workflows as { id: string }[]) {
      await autoEnroll(env, w.id, target);
    }
  }
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

// Sprint E9 M1 — projette une entité e-comm (customer/order) en un record
// "lead-shaped" pour que `executeStep` reste INCHANGÉ (interpolation
// {{name}}/{{email}}, DND, INSERT messages — clés id/email/name/phone/
// client_id préservées). Si l'entité e-comm est rattachée à un lead CRM
// (customers.lead_id, réconciliation E1), on retourne le VRAI lead :
// les steps mutateurs (add_tag/change_status/...) agissent alors sur le
// lead réel, cohérent avec le CRM. Sinon, on synthétise un record sûr
// (id e-comm — jamais persisté côté leads). Best-effort : null ⇒ enrollment
// annulé proprement (même comportement que la branche lead si lead absent).
async function resolveEcomEntity(
  env: Env,
  enrollment: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const entityType = (enrollment.entity_type as string) || 'lead';
  const customerId = (enrollment.customer_id as string) || null;
  const orderId = (enrollment.order_id as string) || null;

  // Résout le customer (directement, ou via la commande).
  let custId = customerId;
  let orderRow: Record<string, unknown> | null = null;
  if (entityType === 'order' && orderId) {
    orderRow = await env.DB.prepare(
      'SELECT id, customer_id, client_id, email FROM orders WHERE id = ?'
    ).bind(orderId).first() as Record<string, unknown> | null;
    if (!orderRow) return null;
    if (!custId) custId = (orderRow.customer_id as string) || null;
  }

  let cust: Record<string, unknown> | null = null;
  if (custId) {
    cust = await env.DB.prepare(
      'SELECT id, lead_id, client_id, email, phone, first_name, last_name FROM customers WHERE id = ?'
    ).bind(custId).first() as Record<string, unknown> | null;
  }

  // Réconciliation E1 : si le customer est lié à un lead CRM, on agit sur
  // le VRAI lead (cohérence CRM, steps mutateurs sûrs).
  if (cust && cust.lead_id) {
    const realLead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?')
      .bind(cust.lead_id as string).first() as Record<string, unknown> | null;
    if (realLead) return realLead;
  }

  if (!cust && !orderRow) return null;

  // Projection lead-shaped (aucune écriture côté leads — id e-comm).
  const first = String(cust?.first_name || '').trim();
  const last = String(cust?.last_name || '').trim();
  const name = `${first} ${last}`.trim() || String(cust?.email || orderRow?.email || '');
  return {
    id: String(cust?.id || orderRow?.id || ''),
    client_id: String(cust?.client_id || orderRow?.client_id || ''),
    email: String(cust?.email || orderRow?.email || ''),
    phone: cust?.phone ?? null,
    name,
    first_name: first,
    last_name: last,
    status: 'customer',
    entity_type: entityType,
    customer_id: custId,
    order_id: orderId,
  };
}

async function advanceEnrollment(env: Env, enrollment: Record<string, unknown>): Promise<void> {
  const enrollmentId = enrollment.id as string;
  const workflowId = enrollment.workflow_id as string;
  const leadId = enrollment.lead_id as string;
  const currentStepId = enrollment.current_step_id as string | null;

  // Sprint E9 M1 — résolution entité-agnostique. La branche LEAD est
  // INCHANGÉE bit-pour-bit (entity_type 'lead' OU absent = enrollments
  // pré-E9 / call sites string) : on lit `SELECT * FROM leads` exactement
  // comme Sprint 46, et `executeStep` reçoit le même record `lead`.
  // Les entités e-comm (customer/order) sont projetées en un record
  // "lead-shaped" (id/email/name/phone/client_id) pour que `executeStep`
  // (interpolation {{name}}, DND, messages) fonctionne SANS modification.
  const entityType = (enrollment.entity_type as string) || 'lead';
  let lead: Record<string, unknown> | null;
  if (entityType === 'lead') {
    lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  } else {
    lead = await resolveEcomEntity(env, enrollment);
  }
  if (!lead) {
    await env.DB.prepare("UPDATE workflow_enrollments SET status = 'cancelled' WHERE id = ?").bind(enrollmentId).run();
    return;
  }

  const step = currentStepId
    ? await env.DB.prepare('SELECT * FROM workflow_steps WHERE id = ?').bind(currentStepId).first() as Record<string, unknown> | null
    : null;

  let branchTaken: string | null = 'main';
  if (step) {
    branchTaken = await executeStep(env, step, lead, enrollmentId);
    await env.DB.prepare(
      `INSERT INTO workflow_execution_log (enrollment_id, step_id, status) VALUES (?, ?, 'executed')`
    ).bind(enrollmentId, step.id as string).run();
  }

  // Find next step based on parent_step_id and branch
  let nextStep: Record<string, unknown> | null = null;
  if (step) {
    nextStep = await env.DB.prepare(
      'SELECT * FROM workflow_steps WHERE workflow_id = ? AND parent_step_id = ? AND branch = ? LIMIT 1'
    ).bind(workflowId, step.id as string, branchTaken || 'main').first() as Record<string, unknown> | null;
  } else {
    // Fallback if no step
    const currentOrder = 0;
    nextStep = await env.DB.prepare(
      'SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1'
    ).bind(workflowId, currentOrder).first() as Record<string, unknown> | null;
  }

  if (!nextStep) {
    await env.DB.prepare(
      "UPDATE workflow_enrollments SET status = 'completed', completed_at = datetime('now'), next_action_at = NULL WHERE id = ?"
    ).bind(enrollmentId).run();
    return;
  }

  let nextAt: Date;
  if (nextStep.step_type === 'wait') {
    let config: any = {};
    try { config = JSON.parse(nextStep.config as string); } catch { /* */ }
    
    if (config.wait_type === 'until_date' && config.wait_date) {
      nextAt = new Date(config.wait_date);
    } else if (config.wait_type === 'until_time' && config.wait_time) {
      nextAt = new Date();
      const [h, m] = config.wait_time.split(':');
      nextAt.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
      if (nextAt < new Date()) nextAt.setDate(nextAt.getDate() + 1);
    } else if (config.wait_type === 'for_event') {
       nextAt = new Date(Date.now() + 365 * 24 * 3600 * 1000); 
    } else {
      let delay = config.delay_minutes || 0;
      nextAt = new Date(Date.now() + delay * 60_000);
    }
  } else {
    nextAt = new Date();
  }

  const workflow = await env.DB.prepare('SELECT trigger_config FROM workflows WHERE id = ?').bind(workflowId).first() as Record<string, unknown>;
  if (workflow && workflow.trigger_config) {
     let wfConfig: any = {};
     try { wfConfig = JSON.parse(workflow.trigger_config as string); } catch {}
     if (wfConfig.quiet_hours_start && wfConfig.quiet_hours_end) {
        const startH = parseInt(wfConfig.quiet_hours_start.split(':')[0], 10);
        const endH = parseInt(wfConfig.quiet_hours_end.split(':')[0], 10);
        const currentH = nextAt.getHours();
        let inQuiet = false;
        if (startH > endH) {
           inQuiet = currentH >= startH || currentH < endH;
        } else {
           inQuiet = currentH >= startH && currentH < endH;
        }
        if (inQuiet) {
           if (currentH >= startH && startH > endH) nextAt.setDate(nextAt.getDate() + 1);
           nextAt.setHours(endH, 0, 0, 0);
        }
     }
  }

  await env.DB.prepare(
    "UPDATE workflow_enrollments SET current_step_id = ?, next_action_at = ? WHERE id = ?"
  ).bind(nextStep.id as string, nextAt.toISOString(), enrollmentId).run();
}

async function executeStep(env: Env, step: Record<string, unknown>, lead: Record<string, unknown>, _enrollmentId: string): Promise<string | null> {
  const stepType = step.step_type as string;
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(step.config as string); } catch { /* */ }

  const interpolate = (s: string): string =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(lead[key] ?? ''));

  switch (stepType) {
    case 'wait':
      return 'main';

    case 'condition': {
      const field = String(config.field || '');
      const operator = String(config.operator || 'equals');
      const value = String(config.value || '');
      const leadVal = String(lead[field] || '');
      let isTrue = false;
      
      if (operator === 'equals') isTrue = leadVal.toLowerCase() === value.toLowerCase();
      else if (operator === 'not_equals') isTrue = leadVal.toLowerCase() !== value.toLowerCase();
      else if (operator === 'contains') isTrue = leadVal.toLowerCase().includes(value.toLowerCase());
      else if (operator === 'greater_than') isTrue = parseFloat(leadVal) > parseFloat(value);
      else if (operator === 'less_than') isTrue = parseFloat(leadVal) < parseFloat(value);
      
      return isTrue ? 'true' : 'false';
    }

    case 'send_email': {
      if (!env.RESEND_API_KEY) return 'main';
      // Vérification DND email
      const emailDnd = await isLeadDnd(env, lead.id as string, 'email');
      if (emailDnd) return 'main';
      const tplId = config.template_id as string;
      const tpl = tplId
        ? await env.DB.prepare('SELECT subject, body_html FROM email_templates WHERE id = ?').bind(tplId).first() as { subject: string; body_html: string } | null
        : null;
      if (!tpl) return 'main';
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
      return 'main';
    }

    case 'send_internal_email': {
      if (!env.RESEND_API_KEY) return 'main';
      const toEmail = config.to_email as string || 'admin@intralys.com';
      const subject = config.subject as string || 'Notification Système';
      const body = config.body as string || 'Nouvelle notification pour {{name}}';
      try {
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Intralys System <system@intralys.com>',
          to: [toEmail],
          subject: interpolate(subject),
          html: interpolate(body),
        });
      } catch (err) {
        console.error('Workflow send_internal_email failed:', err);
        await env.DB.prepare(
          `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result)
           VALUES (?, ?, 'failed', ?)`
        ).bind(_enrollmentId, step.id as string, JSON.stringify({ error: String(err) })).run();
      }
      return 'main';
    }

    case 'send_sms': {
      if (!lead.phone) return 'main';
      // Vérification DND SMS
      const smsDnd = await isLeadDnd(env, lead.id as string, 'sms');
      if (smsDnd) return 'main';
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
      return 'main';
    }

    case 'add_tag':
      if (config.tag) {
        await env.DB.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag) VALUES (?, ?)')
          .bind(lead.id as string, String(config.tag).toLowerCase()).run();
      }
      return 'main';

    case 'remove_tag':
      if (config.tag) {
        await env.DB.prepare('DELETE FROM lead_tags WHERE lead_id = ? AND tag = ?')
          .bind(lead.id as string, String(config.tag).toLowerCase()).run();
      }
      return 'main';

    case 'change_status':
      if (config.status && ['new', 'contacted', 'qualified', 'won', 'closed', 'lost'].includes(config.status as string)) {
        await env.DB.prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(config.status as string, lead.id as string).run();
        await env.DB.prepare(
          "INSERT INTO activity_log (lead_id, client_id, action, details) VALUES (?, ?, 'status_change', ?)"
        ).bind(lead.id as string, lead.client_id as string, JSON.stringify({ to: config.status, by: 'workflow' })).run();
      }
      return 'main';

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
      return 'main';

    case 'webhook': {
      const url = String(config.url || '');
      if (!url || !url.startsWith('https://')) return 'main';
      try {
        await fetch(url, {
          method: String(config.method || 'POST'),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead }),
        });
      } catch (err) {
        console.warn('Webhook step failed', err);
      }
      return 'main';
    }

    case 'update_pipeline': {
      const pipelineId = String(config.pipeline_id || '');
      if (pipelineId) {
        await env.DB.prepare('UPDATE leads SET pipeline_id = ?, updated_at = datetime("now") WHERE id = ?').bind(pipelineId, lead.id as string).run();
        await env.DB.prepare(
          "INSERT INTO activity_log (lead_id, client_id, action, details) VALUES (?, ?, 'status_change', ?)"
        ).bind(lead.id as string, lead.client_id as string, JSON.stringify({ to_pipeline: pipelineId, by: 'workflow' })).run();
      }
      return 'main';
    }

    case 'update_stage': {
      const stageId = String(config.stage_id || '');
      if (stageId) {
        await env.DB.prepare('UPDATE leads SET stage_id = ?, updated_at = datetime("now") WHERE id = ?').bind(stageId, lead.id as string).run();
        await env.DB.prepare(
          "INSERT INTO activity_log (lead_id, client_id, action, details) VALUES (?, ?, 'status_change', ?)"
        ).bind(lead.id as string, lead.client_id as string, JSON.stringify({ to_stage: stageId, by: 'workflow' })).run();
      }
      return 'main';
    }
    case 'create_task': {
      const title = interpolate(String(config.title || 'Nouvelle tâche'));
      const desc = interpolate(String(config.description || ''));
      await env.DB.prepare(
        "INSERT INTO tasks (id, title, description, priority, status, lead_id, client_id, assigned_to) VALUES (?, ?, ?, ?, 'todo', ?, ?, ?)"
      ).bind(crypto.randomUUID(), title, desc, config.priority || 'medium', lead.id as string, lead.client_id as string, config.assigned_to || '').run();
      return 'main';
    }

    case 'create_appointment': {
      const title = interpolate(String(config.title || 'Nouveau RDV'));
      const days = parseInt(String(config.days_from_now || '1'), 10);
      const startAt = new Date(Date.now() + days * 86400000).toISOString();
      const endAt = new Date(Date.now() + days * 86400000 + 3600000).toISOString();
      await env.DB.prepare(
        "INSERT INTO appointments (id, lead_id, client_id, title, start_time, end_time, type, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')"
      ).bind(crypto.randomUUID(), lead.id as string, lead.client_id as string, title, startAt, endAt, config.type || 'meeting').run();
      return 'main';
    }

    case 'create_opportunity': {
      await env.DB.prepare('UPDATE leads SET lifecycle_stage = "opportunity", deal_value = ?, updated_at = datetime("now") WHERE id = ?')
        .bind(parseFloat(String(config.deal_value || '0')), lead.id as string).run();
      return 'main';
    }

    case 'update_opportunity': {
      if (config.deal_value) {
         await env.DB.prepare('UPDATE leads SET deal_value = ?, updated_at = datetime("now") WHERE id = ?')
           .bind(parseFloat(String(config.deal_value || '0')), lead.id as string).run();
      }
      return 'main';
    }

    case 'update_custom_field': {
      const fieldId = String(config.field_id || '');
      const val = interpolate(String(config.value || ''));
      if (fieldId && val) {
        await env.DB.prepare(
          "INSERT INTO lead_custom_fields (lead_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(lead_id, field_id) DO UPDATE SET value = excluded.value"
        ).bind(lead.id as string, fieldId, val).run();
      }
      return 'main';
    }

    case 'trigger_another_workflow': {
      const targetWfId = String(config.workflow_id || '');
      if (targetWfId) {
        await env.DB.prepare(
           "INSERT INTO workflow_enrollments (id, workflow_id, lead_id, status) VALUES (?, ?, ?, 'active')"
        ).bind(crypto.randomUUID(), targetWfId, lead.id as string).run();
      }
      return 'main';
    }

    case 'end_other_workflow': {
      const targetWfId = String(config.workflow_id || '');
      if (targetWfId) {
        await env.DB.prepare(
           "UPDATE workflow_enrollments SET status = 'cancelled' WHERE workflow_id = ? AND lead_id = ? AND status = 'active'"
        ).bind(targetWfId, lead.id as string).run();
      }
      return 'main';
    }

    case 'ai_action':
    case 'math_operation':
    case 'add_to_smart_list':
      // Mocks for now as they require external or complex services not fully wired
      return 'main';

    case 'goal_reached': {
       await env.DB.prepare(
           "UPDATE workflow_enrollments SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
       ).bind(_enrollmentId).run();
       return 'main';
    }

    default:
      return 'main';
  }
}
