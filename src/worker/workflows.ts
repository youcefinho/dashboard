// ── Module Workflows — Intralys CRM ─────────────────────────
import { Resend } from 'resend';
import type { Env } from './types';
import { sanitizeInput, json, sendSms, isLeadDnd } from './helpers';
import { isUnsubscribed } from './compliance';
import { requireCapability, type Capability } from './capabilities';
import { resolveFromAddress } from './clients-admin';
import { WORKFLOW_TEMPLATES } from './workflow-templates';

// ── LOT TEAM B-bis — garde de capability CONDITIONNELLE (mode-agence-only) ───
// Enforce UNIQUEMENT si l'auth porte un contexte agence (tenant.agencyId !=
// null) ET un set capabilities (injecté choke-point worker.ts). Legacy/mono-
// tenant, chemin API-key et suites de test ⇒ condition FALSE ⇒ skip ⇒
// comportement BYTE-IDENTIQUE à l'existant.
function capGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> },
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;
}

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
  const cg = capGuard(auth as never, 'workflows.manage');
  if (cg) return cg;

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
  const cg = capGuard(auth as never, 'workflows.manage');
  if (cg) return cg;

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
        `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result, lead_id)
         VALUES (?, ?, 'failed', ?, ?)`
      ).bind(e.id as string, (e.current_step_id as string) || '', JSON.stringify({ error: String(err) }), (e.lead_id as string) || null).run();
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
      `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, lead_id) VALUES (?, ?, 'executed', ?)`
    ).bind(enrollmentId, step.id as string, (lead.id as string) || null).run();
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

// ── LOT WHITE-LABEL APPLY (P4) §6.H — footer email brandé tenant ─────────────
// Lit le branding du SEUL sous-compte `clientId` (lead.client_id ⇒ borné tenant,
// JAMAIS cross-tenant) et construit un footer HTML brandé à concaténer APRÈS le
// corps interpolé de l'email. RÉUTILISE le stockage EXISTANT (colonnes seq 81
// `clients.{branding,logo_url}` ; les méta `company_name`/`companyName` +
// `remove_powered_by` vivent dans le JSON `branding` extensible — AUCUNE
// migration, AUCUNE colonne ajoutée, cf. §1/§6.B).
//
// RÉTRO-COMPAT BYTE (§6.I.5) : retourne '' (chaîne vide) si AUCUN branding
// exploitable — pas de company_name/companyName NI logo_url, ET remove_powered_by
// falsy ⇒ html INCHANGÉ (la concaténation d'une chaîne vide est un no-op
// byte-identique : footer générique actuel / pas de footer ajouté préservé).
// La mention « Propulsé par Intralys » est INCLUSE par défaut et MASQUÉE
// UNIQUEMENT si `branding.remove_powered_by === true`.
//
// best-effort (§6.H) : tout en try/catch ; un échec de lecture/parse du branding
// ⇒ '' ⇒ ZÉRO impact sur l'envoi (jamais de throw). Borné `clientId` seul.
async function buildTenantFooter(env: Env, clientId: string | null): Promise<string> {
  if (!clientId) return '';
  try {
    const row = (await env.DB.prepare(
      'SELECT branding, logo_url FROM clients WHERE id = ?',
    )
      .bind(clientId)
      .first()) as { branding: string | null; logo_url: string | null } | null;
    if (!row) return '';

    const logoUrl = (row.logo_url || '').trim();

    let meta: Record<string, unknown> = {};
    if (row.branding) {
      try {
        const parsed = JSON.parse(row.branding) as unknown;
        if (parsed && typeof parsed === 'object') {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        // JSON branding malformé : on ignore les méta (lecture tolérante),
        // logo_url (colonne) reste exploitable.
        meta = {};
      }
    }

    // Graphie canonique `company_name` (snake) ; repli historique `companyName`
    // (camel, sérialisé par buildBrandingBody) — §6.I.12, lecture tolérante.
    const rawName = meta.company_name ?? meta.companyName;
    const companyName = typeof rawName === 'string' ? rawName.trim() : '';
    const removePoweredBy = meta.remove_powered_by === true;

    // Aucun élément brandé ET powered-by conservé ⇒ pas de footer (byte-identique).
    if (!companyName && !logoUrl && !removePoweredBy) return '';

    // Échappement minimal pour l'injection sûre des valeurs branding dans le HTML.
    const esc = (v: string): string =>
      v
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const parts: string[] = [];
    if (logoUrl) {
      parts.push(
        `<img src="${esc(logoUrl)}" alt="${esc(companyName || '')}" style="max-height:40px;max-width:160px;display:block;margin:0 auto 8px;" />`,
      );
    }
    if (companyName) {
      parts.push(
        `<div style="font-size:13px;font-weight:600;color:#333;">${esc(companyName)}</div>`,
      );
    }
    if (!removePoweredBy) {
      parts.push(
        '<div style="font-size:11px;color:#888;margin-top:6px;">Propulsé par Intralys</div>',
      );
    }

    if (parts.length === 0) return '';

    return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;text-align:center;font-family:Arial,Helvetica,sans-serif;">${parts.join('')}</div>`;
  } catch {
    // Échec lecture branding (table/colonne absente, panne D1) : aucun footer,
    // l'envoi se poursuit byte-identique. best-effort, jamais de throw.
    return '';
  }
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

      // ── Sprint 5 (LOT EMAIL 5) §6.H — UNIQUE modif tolérée de workflows.ts ──
      // Garde ADDITIVE : on n'instrumente (pixel + réécriture liens + colonnes
      // campaign_id/campaign_kind) QUE si ce step appartient à une SÉQUENCE
      // (workflows.is_sequence = 1). Pour un workflow @xyflow CLASSIQUE
      // (is_sequence = 0 / absent / requête en échec), `campaignKind` reste
      // null ⇒ on exécute EXACTEMENT les deux statements legacy d'origine
      // (resend.emails.send html=interpolate(tpl.body_html) PUIS INSERT messages
      // sans colonnes campagne ni pixel) ⇒ comportement BYTE-IDENTIQUE à
      // l'existant (aucun row de tracking, aucun pixel — cf. §6.I). Le moteur
      // d'ordonnancement reste INTOUCHÉ ; signature executeStep INCHANGÉE ;
      // `is_sequence` n'est lu QUE ici, jamais par processWorkflowQueue /
      // advanceEnrollment / autoEnrollForTrigger.
      let campaignKind: string | null = null;
      try {
        const wf = await env.DB.prepare(
          'SELECT is_sequence FROM workflows WHERE id = ?'
        ).bind(step.workflow_id as string).first() as { is_sequence?: number } | null;
        if (wf && Number(wf.is_sequence) === 1) campaignKind = 'sequence';
      } catch { campaignKind = null; }

      try {
        const resend = new Resend(env.RESEND_API_KEY);
        // LOT G9 white-label : from par tenant DERRIÈRE flag WHITELABEL_DKIM_ENABLED.
        // Flag OFF (défaut) OU pas de hostname active ⇒ from défaut BYTE-IDENTIQUE
        // ('Intralys CRM <noreply@intralys.com>'). best-effort, jamais de throw.
        const fromAddress = await resolveFromAddress(env, (lead.client_id as string) || null);
        // LOT WHITE-LABEL APPLY (P4) : footer brandé tenant, borné lead.client_id.
        // '' si pas de branding ⇒ concaténation no-op ⇒ html BYTE-IDENTIQUE.
        // best-effort déjà encapsulé dans buildTenantFooter (jamais de throw).
        const tenantFooter = await buildTenantFooter(env, (lead.client_id as string) || null);
        if (campaignKind) {
          // Chemin SÉQUENCE (tracké) : INSERT messages AVANT envoi (messageId
          // = ancre pixel/liens), injection tracking RÉUTILISANT le tracker
          // EXISTANT (tracking.ts READ-ONLY, /api/t/o · /api/t/c) via le helper
          // partagé broadcast.ts (aucun cycle d'import). origin best-effort.
          const { injectTracking } = await import('./broadcast');
          const origin = String(
            (env as unknown as Record<string, string | undefined>).PUBLIC_BASE_URL ||
            (env as unknown as Record<string, string | undefined>).APP_URL ||
            'https://app.intralys.com'
          ).replace(/\/+$/, '');
          const messageId = crypto.randomUUID();
          const subjectOut = interpolate(tpl.subject);
          // Footer brandé concaténé APRÈS le corps interpolé, AVANT l'injection
          // tracking (footer inclus dans le tracking de manière cohérente).
          // tenantFooter = '' sans branding ⇒ htmlBase BYTE-IDENTIQUE.
          const htmlBase = interpolate(tpl.body_html) + tenantFooter;
          const htmlTracked = injectTracking(htmlBase, messageId, origin);
          await env.DB.prepare(
            `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by, campaign_id, campaign_kind)
             VALUES (?, ?, ?, 'outbound', 'email', ?, ?, 'sent', 'workflow', ?, 'sequence')`
          ).bind(messageId, lead.id as string, lead.client_id as string, subjectOut, htmlTracked, step.workflow_id as string).run();
          await resend.emails.send({
            from: fromAddress,
            to: [lead.email as string],
            subject: subjectOut,
            html: htmlTracked,
          });
        } else {
          // Chemin LEGACY — footer brandé concaténé APRÈS le corps interpolé.
          // tenantFooter = '' sans branding ⇒ html BYTE-IDENTIQUE à l'origine.
          const legacyHtml = interpolate(tpl.body_html) + tenantFooter;
          await resend.emails.send({
            from: fromAddress,
            to: [lead.email as string],
            subject: interpolate(tpl.subject),
            html: legacyHtml,
          });
          await env.DB.prepare(
            `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by)
             VALUES (?, ?, ?, 'outbound', 'email', ?, ?, 'sent', 'workflow')`
          ).bind(crypto.randomUUID(), lead.id as string, lead.client_id as string, interpolate(tpl.subject), legacyHtml).run();
        }
      } catch (err) {
        console.error('Workflow send_email failed:', err);
        await env.DB.prepare(
          `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result, lead_id)
           VALUES (?, ?, 'failed', ?, ?)`
        ).bind(_enrollmentId, step.id as string, JSON.stringify({ error: String(err) }), (lead.id as string) || null).run();
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
          `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result, lead_id)
           VALUES (?, ?, 'failed', ?, ?)`
        ).bind(_enrollmentId, step.id as string, JSON.stringify({ error: String(err) }), (lead.id as string) || null).run();
      }
      return 'main';
    }

    case 'send_sms': {
      if (!lead.phone) return 'main';
      // Vérification DND SMS (INCHANGÉE — check existant conservé).
      const smsDnd = await isLeadDnd(env, lead.id as string, 'sms');
      if (smsDnd) return 'main';
      // LOT SMS/WHATSAPP seq 104 (§6.H) — opt-out CASL : skip si le contact est
      // désabonné SMS (lookup par téléphone, channel 'sms'). best-effort :
      // table absente ⇒ false ⇒ envoi normal.
      const smsUnsub = await isUnsubscribed(env, '', lead.phone as string, 'sms');
      if (smsUnsub) return 'main';
      // LOT SMS/WHATSAPP seq 104 (§6.H) — respect quiet-hours : on RÉUTILISE la
      // MÊME logique horaire que le séquençage (advanceEnrollment l.512-526) au
      // lieu de la réinventer. Si l'heure courante tombe dans la plage silencieuse
      // configurée sur le workflow (trigger_config.quiet_hours_start/end), on skip
      // l'envoi (le moteur de séquençage replanifie déjà hors plage ; ceci est un
      // garde-fou runtime). Plage absente ⇒ aucun changement.
      try {
        const wf = await env.DB.prepare('SELECT trigger_config FROM workflows WHERE id = ?')
          .bind(step.workflow_id as string).first() as { trigger_config?: string } | null;
        if (wf?.trigger_config) {
          let wfConfig: any = {};
          try { wfConfig = JSON.parse(wf.trigger_config); } catch {}
          if (wfConfig.quiet_hours_start && wfConfig.quiet_hours_end) {
            const startH = parseInt(String(wfConfig.quiet_hours_start).split(':')[0] ?? '0', 10);
            const endH = parseInt(String(wfConfig.quiet_hours_end).split(':')[0] ?? '0', 10);
            const currentH = new Date().getHours();
            let inQuiet = false;
            if (startH > endH) {
              inQuiet = currentH >= startH || currentH < endH;
            } else {
              inQuiet = currentH >= startH && currentH < endH;
            }
            if (inQuiet) return 'main';
          }
        }
      } catch { /* best-effort : pas de blocage si la lecture échoue */ }
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
            `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result, lead_id)
             VALUES (?, ?, 'failed', ?, ?)`
          ).bind(_enrollmentId, step.id as string, JSON.stringify({ error: result.error }), (lead.id as string) || null).run();
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

    // ── LOT AUTOMATION BUILDER (seq 105) — case `assign` ADDITIF (Manager-B).
    // Calque `change_status` : assigne le lead à un utilisateur (clé config
    // `assigned_to`, cf. §6.D). UPDATE borné leads.assigned_to (colonne réelle
    // migration-phase1.sql:38) + trace activity_log. `default` INCHANGÉ.
    case 'assign':
      if (config.assigned_to) {
        await env.DB.prepare("UPDATE leads SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(String(config.assigned_to), lead.id as string).run();
        await env.DB.prepare(
          "INSERT INTO activity_log (lead_id, client_id, action, details) VALUES (?, ?, 'status_change', ?)"
        ).bind(lead.id as string, lead.client_id as string, JSON.stringify({ assigned_to: config.assigned_to, by: 'workflow' })).run();
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

    // ── LOT AUTOMATION BUILDER (seq 105) — 3 mocks FINIS (Manager-B). ──────────
    // Corps réels ADDITIFS, best-effort, branche 'main' comme les autres steps.

    // ai_action — clés config : prompt (string, interpolé {{champ}}),
    // output_field_id (id custom_field_defs où stocker la sortie, optionnel).
    // Gating IDENTIQUE au reste du worker (ai.ts:isAiMockMode) : si USE_MOCKS
    // ou pas de ANTHROPIC_API_KEY ⇒ NO-OP gracieux (flag IA inactif), aucun
    // appel réseau, aucune écriture. Si clé présente ⇒ appel Anthropic Haiku +
    // stockage du résultat dans custom_field_values (table réelle phase9, PK
    // lead_id+field_id) si output_field_id fourni.
    case 'ai_action': {
      const aiInactive = env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY;
      const prompt = interpolate(String(config.prompt || ''));
      if (aiInactive || !prompt) return 'main'; // no-op gracieux (flag inactif)
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY as string,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 512,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (res.ok) {
          const data = await res.json() as { content?: Array<{ text?: string }> };
          const out = data.content?.[0]?.text || '';
          const outField = String(config.output_field_id || '');
          if (outField && out) {
            await env.DB.prepare(
              "INSERT INTO custom_field_values (lead_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(lead_id, field_id) DO UPDATE SET value = excluded.value"
            ).bind(lead.id as string, outField, out).run();
          }
        }
      } catch (err) {
        console.warn('Workflow ai_action failed (best-effort)', err);
      }
      return 'main';
    }

    // math_operation — clés config : field_id (id custom_field_defs cible),
    // operator ('add'|'subtract'|'multiply'|'divide'|'set'), operand (number).
    // Applique l'opération sur la valeur numérique courante du custom field
    // (custom_field_values, table réelle phase9) et upsert le résultat.
    case 'math_operation': {
      const fieldId = String(config.field_id || '');
      const operator = String(config.operator || 'set');
      const operand = parseFloat(String(config.operand ?? '0'));
      if (fieldId && !isNaN(operand)) {
        const row = await env.DB.prepare(
          'SELECT value FROM custom_field_values WHERE lead_id = ? AND field_id = ?'
        ).bind(lead.id as string, fieldId).first() as { value?: string } | null;
        const current = parseFloat(String(row?.value ?? '0')) || 0;
        let result: number;
        switch (operator) {
          case 'add': result = current + operand; break;
          case 'subtract': result = current - operand; break;
          case 'multiply': result = current * operand; break;
          case 'divide': result = operand !== 0 ? current / operand : current; break;
          case 'set': default: result = operand; break;
        }
        await env.DB.prepare(
          "INSERT INTO custom_field_values (lead_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(lead_id, field_id) DO UPDATE SET value = excluded.value"
        ).bind(lead.id as string, fieldId, String(result)).run();
      }
      return 'main';
    }

    // add_to_smart_list — clés config : smart_list_id (id smart_lists) OU
    // list_name. La table `smart_lists` (phase9 / sprint2-phase0) est une VUE
    // SAUVEGARDÉE par filtres (colonnes name/filters), PAS une table de
    // membership (aucune table smart_list_members n'existe — vérifié schéma).
    // Effet réel ADDITIF et sûr sans nouvelle table : on pose un tag de
    // marquage stable `liste:<id|nom>` sur le lead (table lead_tags existante),
    // matérialisant l'appartenance de façon requêtable. Best-effort.
    case 'add_to_smart_list': {
      const listRef = String(config.smart_list_id || config.list_name || '');
      if (listRef) {
        await env.DB.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag) VALUES (?, ?)')
          .bind(lead.id as string, `liste:${listRef}`.toLowerCase()).run();
      }
      return 'main';
    }

    case 'goal_reached': {
       await env.DB.prepare(
           "UPDATE workflow_enrollments SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
       ).bind(_enrollmentId).run();
       return 'main';
    }

    // ── LOT REPUTATION (Sprint 8, seq 109) — case `request_review` ADDITIF
    // (Manager-B). Déclenchement AUTO de la demande d'avis 1st-party : crée une
    // review_invitation + token, envoie un courriel pointant vers la page PUBLIQUE
    // hébergée Intralys /r/<token> (PAS Google direct — c'est la page qui applique
    // le routing intelligent au submit). RÉUTILISE le pattern reviews.ts §6.C :
    // CASL isLeadDnd(email) + anti-doublon 30j sur review_invitations. Best-effort,
    // branche 'main'. default INCHANGÉ ; moteur d'ordonnancement INTOUCHÉ.
    case 'request_review': {
      if (!env.RESEND_API_KEY) return 'main';
      if (!lead.email) return 'main';
      // CASL/DND : skip si le contact est DND email (calque case send_email).
      const reviewDnd = await isLeadDnd(env, lead.id as string, 'email');
      if (reviewDnd) return 'main';

      try {
        // Anti-doublon 30j sur review_invitations par lead_id (calque
        // reviews.ts:handleCreateReviewRequest qui garde sur review_requests).
        const recent = await env.DB.prepare(
          "SELECT id FROM review_invitations WHERE lead_id = ? AND created_at > datetime('now', '-30 days')"
        ).bind(lead.id as string).first();
        if (recent) return 'main';

        // Création invitation + token (client_id depuis le lead — calque reviews.ts).
        const id = crypto.randomUUID();
        const token = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO review_invitations (id, client_id, lead_id, token, channel, status)
           VALUES (?, ?, ?, ?, 'email', 'sent')`
        ).bind(id, (lead.client_id as string) || null, lead.id as string, token).run();

        // Lien vers la page PUBLIQUE Intralys /r/<token> (route App.tsx no-auth).
        const baseUrl = String(
          (env as unknown as Record<string, string | undefined>).PUBLIC_BASE_URL ||
          (env as unknown as Record<string, string | undefined>).APP_URL ||
          'https://app.intralys.com'
        ).replace(/\/+$/, '');
        const reviewLink = `${baseUrl}/r/${token}`;
        const leadName = (lead.name as string) || '';

        // Envoi Resend (calque case send_email / reviews.ts l.88-116).
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({
          from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com',
          to: [lead.email as string],
          subject: `${leadName}, votre avis compte pour nous !`,
          html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #1a1a2e;">⭐ Comment s'est passée votre expérience ?</h2>
              <p>Bonjour ${leadName},</p>
              <p>Merci de nous avoir fait confiance ! Votre avis nous aide à nous améliorer et à aider d'autres personnes comme vous.</p>
              <p>Cela ne prend que 30 secondes :</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${reviewLink}" style="background: #f59e0b; color: #1a1a2e; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 18px;">
                  ⭐⭐⭐⭐⭐ Laisser un avis
                </a>
              </p>
              <p style="color: #666; font-size: 12px;">Votre avis est important pour nous.</p>
            </div>
          `,
        });
      } catch (err) {
        console.error('Workflow request_review failed:', err);
        await env.DB.prepare(
          `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result, lead_id)
           VALUES (?, ?, 'failed', ?, ?)`
        ).bind(_enrollmentId, step.id as string, JSON.stringify({ error: String(err) }), (lead.id as string) || null).run();
      }
      return 'main';
    }

    default:
      return 'main';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LOT AUTOMATION BUILDER (Sprint 4, seq 105) — STUBS posés par Manager-A
// (Phase A). ⚠ ZONE A ⇄ B : Manager-A n'a ajouté QUE ces 4 fonctions stub EN
// FIN DE FICHIER. Manager-B (backend) remplit les CORPS RÉELS + le case `assign`
// (additif dans le switch executeStep, default INCHANGÉ) + les 3 mocks
// ai_action/math_operation/add_to_smart_list + le renseignement de `lead_id`
// dans les INSERT workflow_execution_log existants. Manager-B NE TOUCHE PAS le
// case send_email / chemin séquence (is_sequence). Signatures FIGÉES (worker.ts
// les câble). Voir docs/LOT-AUTOMATION-BUILDER.md §6.D / §6.H.
//
// Capability 'workflows.manage' via le capGuard ci-dessus (mode-agence-only).
// Forme {data}/{error} ; corps stub renvoient des données VIDES qui COMPILENT.
// ════════════════════════════════════════════════════════════════════════════

// GET /api/workflows/:id/exec-log — journal d'exécution du workflow (LECTURE de
// workflow_execution_log via jointure enrollment). Manager-B : SELECT joignant
// workflow_enrollments (we.workflow_id = ?) → ExecLogEntry[] (id, enrollment_id,
// workflow_id, lead_id, step_id, status, executed_at, result→detail).
export async function handleGetWorkflowExecLog(
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string,
): Promise<Response> {
  const cg = capGuard(auth as never, 'workflows.manage');
  if (cg) return cg;
  // LECTURE workflow_execution_log JOIN workflow_enrollments pour borner au
  // workflowId (la table log N'A PAS workflow_id : jointure
  // enrollment_id → workflow_enrollments.id → .workflow_id, cf. §6.C).
  // Projection ExecLogEntry : we.workflow_id (lecture), lead_id (col seq105
  // sinon fallback enrollment), step_id, step_type (jointure workflow_steps),
  // status, executed_at tel quel, detail = result. LIMIT 100, plus récents.
  try {
    const { results } = await env.DB.prepare(
      `SELECT el.id, el.enrollment_id, we.workflow_id AS workflow_id,
              COALESCE(el.lead_id, we.lead_id) AS lead_id,
              el.step_id, ws.step_type AS step_type,
              el.status, el.executed_at, el.result AS detail
       FROM workflow_execution_log el
       JOIN workflow_enrollments we ON el.enrollment_id = we.id
       LEFT JOIN workflow_steps ws ON el.step_id = ws.id
       WHERE we.workflow_id = ?
       ORDER BY el.executed_at DESC
       LIMIT 100`
    ).bind(workflowId).all();
    return json({ data: results || [] });
  } catch (err) {
    console.warn('handleGetWorkflowExecLog failed (best-effort)', err);
    return json({ data: [] });
  }
}

// GET /api/leads/:id/automation-history — toutes les exécutions d'un lead
// (lecture par lead_id ADDITIF seq 105, tous workflows confondus).
export async function handleGetLeadAutomationHistory(
  env: Env,
  auth: { userId: string; role: string },
  leadId: string,
): Promise<Response> {
  const cg = capGuard(auth as never, 'workflows.manage');
  if (cg) return cg;
  // LECTURE de TOUTES les exécutions d'un lead, tous workflows confondus.
  // Filtre par la colonne ADDITIVE seq 105 `el.lead_id` OU, pour les logs
  // legacy (lead_id NULL antérieur au renseignement), par jointure
  // enrollment (we.lead_id). Même projection ExecLogEntry que l'exec-log.
  // ORDER BY executed_at DESC, borné à 100.
  try {
    const { results } = await env.DB.prepare(
      `SELECT el.id, el.enrollment_id, we.workflow_id AS workflow_id,
              COALESCE(el.lead_id, we.lead_id) AS lead_id,
              el.step_id, ws.step_type AS step_type,
              el.status, el.executed_at, el.result AS detail
       FROM workflow_execution_log el
       JOIN workflow_enrollments we ON el.enrollment_id = we.id
       LEFT JOIN workflow_steps ws ON el.step_id = ws.id
       WHERE el.lead_id = ? OR (el.lead_id IS NULL AND we.lead_id = ?)
       ORDER BY el.executed_at DESC
       LIMIT 100`
    ).bind(leadId, leadId).all();
    return json({ data: results || [] });
  } catch (err) {
    console.warn('handleGetLeadAutomationHistory failed (best-effort)', err);
    return json({ data: [] });
  }
}

// POST /api/workflows/:id/simulate — simulation read-only (parcours des steps
// SANS effet de bord). Manager-B : chemin SÉPARÉ qui NE réutilise PAS
// executeStep ; évalue uniquement les branches (condition true/false) et
// construit WorkflowSimulationResult { path, reached_goal }.
export async function handleSimulateWorkflow(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string,
): Promise<Response> {
  const cg = capGuard(auth as never, 'workflows.manage');
  if (cg) return cg;

  // Chemin SÉPARÉ read-only : NE réutilise PAS executeStep, n'exécute AUCUN
  // effet (aucun INSERT messages/tags/email/sms, aucun UPDATE). On charge les
  // workflow_steps, on parcourt l'arbre depuis le sentinel 'trigger_1' en
  // suivant parent_step_id + branch, et on évalue UNIQUEMENT les `condition`
  // (true/false) sur un payload de test fourni dans le body. Tout autre step
  // suit la branche 'main'. goal_reached marque reached_goal sans muter la DB.
  let payload: Record<string, unknown> = {};
  try {
    const body = await request.json() as Record<string, unknown>;
    // Accepte soit le payload directement, soit { payload: {...} }.
    payload = (body && typeof body.payload === 'object' && body.payload !== null)
      ? body.payload as Record<string, unknown>
      : (body || {});
  } catch { payload = {}; }

  try {
    const { results: stepRows } = await env.DB.prepare(
      'SELECT id, step_type, config, parent_step_id, branch FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC'
    ).bind(workflowId).all();
    const steps = (stepRows || []) as Array<Record<string, unknown>>;

    // Évaluation pure d'une condition sur le payload (calque executeStep mais
    // SANS aucun effet de bord). Retourne 'true' | 'false'.
    const evalCondition = (cfg: Record<string, unknown>): 'true' | 'false' => {
      const field = String(cfg.field || '');
      const operator = String(cfg.operator || 'equals');
      const value = String(cfg.value || '');
      const leadVal = String((payload as Record<string, unknown>)[field] ?? '');
      let isTrue = false;
      if (operator === 'equals') isTrue = leadVal.toLowerCase() === value.toLowerCase();
      else if (operator === 'not_equals') isTrue = leadVal.toLowerCase() !== value.toLowerCase();
      else if (operator === 'contains') isTrue = leadVal.toLowerCase().includes(value.toLowerCase());
      else if (operator === 'greater_than') isTrue = parseFloat(leadVal) > parseFloat(value);
      else if (operator === 'less_than') isTrue = parseFloat(leadVal) < parseFloat(value);
      return isTrue ? 'true' : 'false';
    };

    // Step initial : sentinel 'trigger_1' (ou parent_step_id NULL) — même
    // logique que handleEnrollLead / autoEnroll.
    const findChild = (parentId: string | null, branch: string): Record<string, unknown> | undefined =>
      steps.find(s => {
        const p = (s.parent_step_id as string) ?? null;
        const b = (s.branch as string) || 'main';
        if (parentId === null) return (p === null || p === 'trigger_1') && b === branch;
        return p === parentId && b === branch;
      });

    const path: Array<{ step_id: string; step_type: string; branch?: string; outcome: string }> = [];
    let reachedGoal = false;

    // Premier step : rattaché au trigger (sentinel), branche 'main'.
    let current: Record<string, unknown> | undefined =
      steps.find(s => {
        const p = (s.parent_step_id as string) ?? null;
        return p === null || p === 'trigger_1';
      });

    const seen = new Set<string>();
    while (current && !seen.has(current.id as string)) {
      seen.add(current.id as string);
      const stepType = String(current.step_type || '');
      let cfg: Record<string, unknown> = {};
      try { cfg = JSON.parse(String(current.config || '{}')); } catch { /* */ }

      let branchTaken = 'main';
      let outcome = 'main';
      if (stepType === 'condition') {
        branchTaken = evalCondition(cfg);
        outcome = branchTaken;
      } else if (stepType === 'goal_reached') {
        reachedGoal = true;
        outcome = 'goal';
      } else {
        outcome = 'main';
      }

      path.push({
        step_id: current.id as string,
        step_type: stepType,
        branch: (current.branch as string) || 'main',
        outcome,
      });

      if (stepType === 'goal_reached') break;
      current = findChild(current.id as string, branchTaken);
    }

    return json({ data: { path, reached_goal: reachedGoal } });
  } catch (err) {
    console.warn('handleSimulateWorkflow failed (best-effort)', err);
    return json({ data: { path: [], reached_goal: false } });
  }
}

// POST /api/workflows/from-template — instancie un workflow depuis un modèle
// (WORKFLOW_TEMPLATES). Manager-B : lit le body { template_key }, retrouve le
// def, INSERT workflows (avec template_key seq 105) + workflow_steps, retourne
// { id, success }.
export async function handleCreateWorkflowFromTemplate(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }
  const cg = capGuard(auth as never, 'workflows.manage');
  if (cg) return cg;

  const body = await request.json() as Record<string, unknown>;
  const templateKey = sanitizeInput(body.template_key as string, 100);
  if (!templateKey) {
    return json({ error: 'template_key requis' }, 400);
  }

  const tpl = WORKFLOW_TEMPLATES.find(t => t.key === templateKey);
  if (!tpl) {
    return json({ error: 'Modèle introuvable' }, 404);
  }

  // INSERT workflow (calque createWorkflow) + template_key (colonne seq 105).
  const workflowId = crypto.randomUUID();
  const triggerConfig = JSON.stringify(tpl.trigger_config || {});
  await env.DB.prepare(
    `INSERT INTO workflows (id, client_id, name, description, trigger_type, trigger_config, template_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    workflowId,
    (body.client_id as string) || null,
    sanitizeInput(tpl.name, 100),
    sanitizeInput(tpl.description, 500),
    sanitizeInput(tpl.trigger_type, 30),
    triggerConfig,
    templateKey,
  ).run();

  // INSERT steps en sérialisant parent_step_id / branch (sentinel 'trigger_1'
  // pour le 1er step) — comme attendu par le moteur (advanceEnrollment :
  // WHERE parent_step_id = ? AND branch = ?). Le def template porte des
  // parent_step_id symboliques ('trigger_1' pour le 1er ; sinon implicite via
  // l'ordre). On mappe chaque step_order → id généré pour relier les enfants.
  // Convention template : le 1er step porte parent_step_id 'trigger_1' ; les
  // branches 'true'/'false' (condition) ET 'main' se rattachent au step
  // immédiatement précédent dans l'ordre quand parent_step_id n'est pas fourni.
  const orderToId = new Map<number, string>();
  // Pré-génère les ids pour pouvoir résoudre les parents.
  for (const step of tpl.steps) orderToId.set(step.step_order, crypto.randomUUID());

  for (let i = 0; i < tpl.steps.length; i++) {
    const step = tpl.steps[i]!;
    const stepId = orderToId.get(step.step_order)!;
    const branch = step.branch || 'main';
    // Résolution du parent : explicite ('trigger_1' ou un step_order),
    // sinon rattachement au step précédent (chaînage linéaire par défaut).
    let parentStepId: string;
    if (step.parent_step_id === 'trigger_1' || (i === 0 && step.parent_step_id == null)) {
      parentStepId = 'trigger_1';
    } else if (step.parent_step_id != null && /^\d+$/.test(String(step.parent_step_id))) {
      // parent_step_id numérique = référence à un step_order du template.
      parentStepId = orderToId.get(Number(step.parent_step_id)) || 'trigger_1';
    } else if (step.parent_step_id != null) {
      parentStepId = String(step.parent_step_id);
    } else if (branch === 'true' || branch === 'false') {
      // Branche conditionnelle sans parent explicite : se rattache au plus
      // proche `condition` PRÉCÉDENT (le moteur cherche
      // parent_step_id = <condition> AND branch = 'true'|'false').
      let cond = null as (typeof tpl.steps)[number] | null;
      for (let j = i - 1; j >= 0; j--) {
        if (tpl.steps[j]!.step_type === 'condition') { cond = tpl.steps[j]!; break; }
      }
      parentStepId = cond ? (orderToId.get(cond.step_order) || 'trigger_1') : 'trigger_1';
    } else {
      // Branche 'main' sans parent explicite : chaînage linéaire au step
      // précédent (ordre).
      const prev = tpl.steps[i - 1];
      parentStepId = prev ? (orderToId.get(prev.step_order) || 'trigger_1') : 'trigger_1';
    }

    await env.DB.prepare(
      `INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, config, parent_step_id, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      stepId,
      workflowId,
      step.step_order,
      step.step_type,
      JSON.stringify(step.config || {}),
      parentStepId,
      branch,
    ).run();
  }

  return json({ data: { id: workflowId, success: true } }, 201);
}
