// ── Module Sequences — Intralys CRM (Sprint 5, Email marketing & séquences) ──
//
// SÉQUENCE = `workflows{is_sequence:1}` + workflow_steps linéaires
// (send_email / wait). Ce module est un WRAPPER LÉGER au-dessus du moteur
// EXISTANT (src/worker/workflows.ts) : create/list/get/update/delete/enroll
// d'une séquence = exactement create/list/get/update/delete/enroll d'un
// workflow, AVEC `is_sequence = 1` posé et le filtrage list sur ce flag.
//
// ⚠ Le MOTEUR d'exécution reste INTÉGRALEMENT workflows.ts
// (processWorkflowQueue / advanceEnrollment / executeStep /
// autoEnrollForTrigger / handleEnrollLead) — AUCUN code moteur neuf,
// AUCUN nouveau scheduler. Le flag `is_sequence` est IGNORÉ par le moteur
// (drapeau de classement UI uniquement) ⇒ zéro régression cron / @xyflow.
//
// Capability = `workflows.manage` RÉUTILISÉE (capabilities.ts:45 ;
// capGuard conditionnel workflows.ts:12). ZÉRO ajout ALL_CAPABILITIES.
// Bornage tenant via `client_id` (calque broadcast.ts:31 / workflows.ts:105).
//
// Phase B (Manager-B) : corps réels. DÉLÈGUE aux helpers EXISTANTS de
// workflows.ts (handleCreateWorkflow / handleUpdateWorkflow /
// handleDeleteWorkflow / handleEnrollLead) — ZÉRO duplication du moteur ni
// de la logique d'enrôlement. Les seules requêtes SQL propres ici sont les
// SELECT de LISTE / DÉTAIL (filtre is_sequence = 1 + bornage client_id) et
// le marquage is_sequence = 1 post-création. Retours `{ data }` / `{ error }`
// (jamais `code` — ApiResponse GELÉ, docs/LOT-EMAIL5.md §6.A).

import type { Env } from './types';
import { json } from './helpers';
import {
  handleCreateWorkflow,
  handleUpdateWorkflow,
  handleDeleteWorkflow,
  handleEnrollLead,
} from './workflows';
import { runDueScheduledBroadcasts } from './broadcast';

type SeqAuth = {
  userId: string;
  role: string;
  tenant?: { agencyId?: string | null };
  capabilities?: Set<string>;
};

// Récupère le client_id de bornage : query ?client_id= (liste) prioritaire,
// sinon contexte tenant. Optionnel (legacy/mono-tenant ⇒ pas de filtre, calque
// broadcast.ts:31 où client_id est conditionnel).
function scopeClientId(_auth: SeqAuth, url?: URL): string | null {
  const fromQuery = url?.searchParams.get('client_id');
  if (fromQuery) return fromQuery;
  return null;
}

// GET /api/sequences — liste des workflows is_sequence=1 (bornage client_id).
// SELECT w.* (calque handleGetWorkflows) WHERE w.is_sequence = 1
// [+ AND w.client_id = ? si fourni]. Lecture pure (pas de capGuard : calque
// handleGetWorkflows qui n'en pose pas — la mutation est gardée ailleurs).
export async function handleGetSequences(
  env: Env,
  auth: SeqAuth,
  url: URL,
): Promise<Response> {
  try {
    const clientId = scopeClientId(auth, url);
    let query = `SELECT w.*,
         (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = w.id) as steps_count,
         (SELECT COUNT(*) FROM workflow_enrollments WHERE workflow_id = w.id AND status = 'active') as active_enrollments,
         (SELECT COUNT(*) FROM workflow_execution_log el
          JOIN workflow_enrollments we ON el.enrollment_id = we.id
          WHERE we.workflow_id = w.id) as total_executions
       FROM workflows w
       WHERE w.is_sequence = 1`;
    const params: string[] = [];
    if (clientId) { query += ' AND w.client_id = ?'; params.push(clientId); }
    query += ' ORDER BY w.created_at DESC';
    const { results } = params.length > 0
      ? await env.DB.prepare(query).bind(...params).all()
      : await env.DB.prepare(query).all();
    return json({ data: results || [] });
  } catch (err) {
    return json({ error: 'Erreur de chargement des séquences: ' + String(err) }, 500);
  }
}

// POST /api/sequences — crée une séquence. DÉLÈGUE à handleCreateWorkflow
// (capGuard 'workflows.manage' + admin + INSERT workflows/steps EXISTANTS,
// bornage client_id via le body comme un workflow), PUIS marque is_sequence=1
// sur l'id retourné. ZÉRO duplication du moteur de création.
export async function handleCreateSequence(
  request: Request,
  env: Env,
  auth: SeqAuth,
): Promise<Response> {
  // handleCreateWorkflow consomme request.json() et applique admin+capGuard.
  const res = await handleCreateWorkflow(request, env, auth as never);
  if (res.status !== 201) return res; // erreur (403/400/...) propagée telle quelle
  let payload: { data?: { id?: string }; error?: string };
  try {
    payload = await res.clone().json() as { data?: { id?: string } };
  } catch {
    return res;
  }
  const id = payload?.data?.id;
  if (id) {
    try {
      await env.DB.prepare(
        `UPDATE workflows SET is_sequence = 1 WHERE id = ?`
      ).bind(id).run();
    } catch (err) {
      // Best-effort : la séquence existe (workflow créé) mais n'apparaîtra
      // pas dans la liste filtrée is_sequence=1. On NE casse PAS la réponse.
      console.error('handleCreateSequence: flag is_sequence failed', id, err);
    }
  }
  return json({ data: { id: id || '' } }, 201);
}

// GET /api/sequences/:id — détail (workflow + steps + enrollments), GARDE
// is_sequence=1 (un workflow @xyflow classique n'est pas exposé ici).
export async function handleGetSequenceDetail(
  env: Env,
  _auth: SeqAuth,
  sequenceId: string,
): Promise<Response> {
  try {
    const workflow = await env.DB.prepare(
      'SELECT * FROM workflows WHERE id = ? AND is_sequence = 1'
    ).bind(sequenceId).first();
    if (!workflow) {
      return json({ error: 'Séquence introuvable' }, 404);
    }
    const { results: steps } = await env.DB.prepare(
      'SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC'
    ).bind(sequenceId).all();
    const { results: enrollments } = await env.DB.prepare(
      `SELECT we.*, l.name as lead_name
       FROM workflow_enrollments we
       LEFT JOIN leads l ON we.lead_id = l.id
       WHERE we.workflow_id = ?
       ORDER BY we.enrolled_at DESC
       LIMIT 50`
    ).bind(sequenceId).all();
    return json({
      data: {
        ...workflow,
        steps: steps || [],
        enrollments: enrollments || [],
      },
    });
  } catch (err) {
    return json({ error: 'Erreur de chargement de la séquence: ' + String(err) }, 500);
  }
}

// GET /api/sequences/:id/stats — stats d'engagement de la séquence (Sprint 2,
// LECTURE PURE). Calque le niveau de garde de handleGetSequenceDetail /
// handleGetSequences (PAS de capGuard — lecture). STUB Phase A : retourne des
// zéros pour COMPILER sans rien casser. open_rate/click_rate = ratios 0..1.
// Corps réel = Manager-B (agrégation calquée broadcast.ts:632-644, jointe sur
// campaign_id = :id AND campaign_kind = 'sequence', event_type 'open'/'click').
// Voir docs/LOT-SEQUENCE-ANALYTICS.md §6.H.
export async function handleGetSequenceStats(
  env: Env,
  _auth: SeqAuth,
  sequenceId: string,
): Promise<Response> {
  try {
    // Manager-B: agrégation réelle (sent/opened/clicked + taux) ici.
    // Borne : la séquence existe et est bien is_sequence=1 (calque le
    // WHERE id = ? AND is_sequence = 1 de handleGetSequenceDetail). 404 sinon.
    const seq = await env.DB.prepare(
      'SELECT id FROM workflows WHERE id = ? AND is_sequence = 1'
    ).bind(sequenceId).first();
    if (!seq) {
      return json({ error: 'Séquence introuvable' }, 404);
    }

    // Agrégation LECTURE PURE calquée sur broadcast.ts:632-644 (COUNT DISTINCT
    // m.id joint message_events), mais bornée sur les messages de la séquence :
    //   m.campaign_id = :sequenceId AND m.campaign_kind = 'sequence'
    // (index idx_messages_campaign). event_type 'open'/'click' = valeurs RÉELLES
    // insérées par tracking.ts:102/147 (PAS email_opened/link_clicked).
    // Best-effort : toute erreur D1 (table/colonne absente) ⇒ zéros, JAMAIS 500.
    let sent = 0, opened = 0, clicked = 0;
    try {
      const agg = await env.DB.prepare(
        `SELECT
           (SELECT COUNT(DISTINCT m.id) FROM messages m
            WHERE m.campaign_id = ? AND m.campaign_kind = 'sequence') AS sent,
           (SELECT COUNT(DISTINCT m.id) FROM messages m
              JOIN message_events me ON me.message_id = m.id
            WHERE m.campaign_id = ? AND m.campaign_kind = 'sequence' AND me.event_type = 'open') AS opened,
           (SELECT COUNT(DISTINCT m.id) FROM messages m
              JOIN message_events me ON me.message_id = m.id
            WHERE m.campaign_id = ? AND m.campaign_kind = 'sequence' AND me.event_type = 'click') AS clicked`
      ).bind(sequenceId, sequenceId, sequenceId).first() as
        { sent: number; opened: number; clicked: number } | null;
      sent = agg?.sent || 0;
      opened = agg?.opened || 0;
      clicked = agg?.clicked || 0;
    } catch (aggErr) {
      // Best-effort : table/colonne manquante ou erreur D1 ⇒ stats à zéro
      // (calque la robustesse de broadcast.ts:645 et handleCreateSequence).
      console.error('handleGetSequenceStats: aggregation failed (best-effort)', sequenceId, aggErr);
    }

    // Ratios 0..1 (§6.A), division gardée contre /0 → 0 quand sent === 0.
    const open_rate = sent ? opened / sent : 0;
    const click_rate = sent ? clicked / sent : 0;

    return json({
      data: { sent, opened, clicked, open_rate, click_rate },
    });
  } catch (err) {
    return json({ error: 'Erreur de chargement des stats de la séquence: ' + String(err) }, 500);
  }
}

// PUT /api/sequences/:id — met à jour. GARDE is_sequence=1 PUIS DÉLÈGUE à
// handleUpdateWorkflow (capGuard 'workflows.manage' + admin + UPDATE/steps
// EXISTANTS). is_sequence n'est jamais dans le SET de handleUpdateWorkflow ⇒
// le flag est PRÉSERVÉ (zéro régression).
export async function handleUpdateSequence(
  request: Request,
  env: Env,
  auth: SeqAuth,
  sequenceId: string,
): Promise<Response> {
  try {
    const exists = await env.DB.prepare(
      'SELECT id FROM workflows WHERE id = ? AND is_sequence = 1'
    ).bind(sequenceId).first();
    if (!exists) return json({ error: 'Séquence introuvable' }, 404);
  } catch (err) {
    return json({ error: 'Erreur: ' + String(err) }, 500);
  }
  return handleUpdateWorkflow(request, env, auth as never, sequenceId);
}

// DELETE /api/sequences/:id — supprime. GARDE is_sequence=1 PUIS DÉLÈGUE à
// handleDeleteWorkflow (admin + DELETE enrollments/steps/workflow EXISTANTS).
export async function handleDeleteSequence(
  env: Env,
  auth: SeqAuth,
  sequenceId: string,
): Promise<Response> {
  try {
    const exists = await env.DB.prepare(
      'SELECT id FROM workflows WHERE id = ? AND is_sequence = 1'
    ).bind(sequenceId).first();
    if (!exists) return json({ error: 'Séquence introuvable' }, 404);
  } catch (err) {
    return json({ error: 'Erreur: ' + String(err) }, 500);
  }
  return handleDeleteWorkflow(env, auth as never, sequenceId);
}

// POST /api/sequences/:id/enroll — enrôle un lead. GARDE is_sequence=1 PUIS
// DÉLÈGUE à handleEnrollLead (anti-doublon par entité + premier step +
// next_action_at selon `wait` — moteur EXISTANT, AUCUNE logique neuve).
export async function handleEnrollSequence(
  request: Request,
  env: Env,
  auth: SeqAuth,
  sequenceId: string,
): Promise<Response> {
  try {
    const exists = await env.DB.prepare(
      'SELECT id FROM workflows WHERE id = ? AND is_sequence = 1'
    ).bind(sequenceId).first();
    if (!exists) return json({ error: 'Séquence introuvable' }, 404);
  } catch (err) {
    return json({ error: 'Erreur: ' + String(err) }, 500);
  }
  return handleEnrollLead(request, env, auth as never, sequenceId);
}

// Cron hook — traite les broadcasts PROGRAMMÉS échus (status='queued' +
// scheduled_at <= now). DÉLÈGUE à runDueScheduledBroadcasts (broadcast.ts —
// cohésion : le pipeline d'envoi/queue vit dans broadcast.ts ; signature +
// call site worker.ts FIGÉS, cf. §6.H point processScheduledBroadcasts).
// Best-effort : catch global, JAMAIS de throw (appelé via le .catch(()=>undefined)
// du scheduled() E7 — un échec isolé ne casse ni le cron ni processWorkflowQueue).
export async function processScheduledBroadcasts(env: Env): Promise<void> {
  try {
    await runDueScheduledBroadcasts(env);
  } catch (err) {
    console.error('processScheduledBroadcasts failed (best-effort, swallowed)', err);
  }
}
