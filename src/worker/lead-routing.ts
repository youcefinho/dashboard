// ── Module Lead Routing Prédictif — Sprint 77 ───────────────────
// Assignation automatique de leads basée sur les performances de closing historiques
// avec lissage de Laplace pour régulariser les petits échantillons.
//
// Formule du score : (won_leads + 1) / (won_leads + lost_leads + 2)
//

import type { Env } from './types';
import { json } from './helpers';

interface AgentScore {
  agent_id: string;
  agent_name: string;
  score: number;
  won_count: number;
  lost_count: number;
  active_leads_count: number;
}

export async function handleRouteLeadPredictive(
  _request: Request,
  env: Env,
  auth: { role: string; userId: string },
  leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  if (!leadId) {
    return json({ error: 'ID du lead requis' }, 400);
  }

  // 1. Récupérer les infos du lead
  const lead = await env.DB.prepare(
    'SELECT id, client_id, type, source FROM leads WHERE id = ?'
  )
    .bind(leadId)
    .first<{ id: string; client_id: string; type: string | null; source: string | null }>();

  if (!lead) {
    return json({ error: 'Lead introuvable' }, 404);
  }

  const clientId = lead.client_id;
  const source = lead.source || 'unknown';
  const type = lead.type || 'inbound';
  const leadTypeMapped = type === 'inbound' ? 'buy' : type === 'customer' ? 'sell' : type;
  const leadCategory = `source:${source}|type:${leadTypeMapped}`;

  // 2. Récupérer tous les agents actifs associés à ce client
  const agents = await env.DB.prepare(
    "SELECT id, name, role FROM users WHERE client_id = ? AND is_active = 1"
  )
    .bind(clientId)
    .all<{ id: string; name: string; role: string }>();

  const activeAgents = agents.results || [];
  if (activeAgents.length === 0) {
    return json({ error: 'Aucun agent actif trouvé pour ce client' }, 400);
  }

  // 3. Récupérer l'historique des performances de closing de chaque agent pour cette catégorie de lead
  // et compter le nombre de leads actifs de chaque agent (pour équilibrer la charge en cas d'égalité)
  const agentScores: AgentScore[] = [];

  for (const agent of activeAgents) {
    // Nombre de leads gagnés (won) dans cette catégorie
    const wonRow = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM leads 
       WHERE client_id = ? AND assigned_to = ? AND status = 'won'
         AND (source = ? OR (source IS NULL AND ? = 'unknown'))
         AND (type = ? OR (type = 'inbound' AND ? = 'buy') OR (type = 'customer' AND ? = 'sell'))`
    )
      .bind(clientId, agent.id, lead.source, source, lead.type, leadTypeMapped, leadTypeMapped)
      .first<{ c: number }>();
    const wonCount = wonRow?.c || 0;

    // Nombre de leads perdus (lost) dans cette catégorie
    const lostRow = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM leads 
       WHERE client_id = ? AND assigned_to = ? AND status = 'lost'
         AND (source = ? OR (source IS NULL AND ? = 'unknown'))
         AND (type = ? OR (type = 'inbound' AND ? = 'buy') OR (type = 'customer' AND ? = 'sell'))`
    )
      .bind(clientId, agent.id, lead.source, source, lead.type, leadTypeMapped, leadTypeMapped)
      .first<{ c: number }>();
    const lostCount = lostRow?.c || 0;

    // Nombre de leads actifs actuellement assignés (statuts non terminés)
    const activeRow = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM leads 
       WHERE client_id = ? AND assigned_to = ? 
         AND status NOT IN ('won', 'closed', 'lost')`
    )
      .bind(clientId, agent.id)
      .first<{ c: number }>();
    const activeLeadsCount = activeRow?.c || 0;

    // Calcul du score avec lissage de Laplace
    const score = (wonCount + 1) / (wonCount + lostCount + 2);

    agentScores.push({
      agent_id: agent.id,
      agent_name: agent.name,
      score,
      won_count: wonCount,
      lost_count: lostCount,
      active_leads_count: activeLeadsCount,
    });
  }

  // 4. Mettre en cache les scores calculés dans la table lead_routing_scores
  for (const agentScore of agentScores) {
    await env.DB.prepare(
      `INSERT INTO lead_routing_scores (agent_id, lead_category, score)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id, lead_category) DO UPDATE SET score = excluded.score`
    )
      .bind(agentScore.agent_id, leadCategory, agentScore.score)
      .run()
      .catch(() => null); // best-effort si souci d'écriture
  }

  // 5. Sélectionner le meilleur agent
  // Tri par score descendant, puis par nombre de leads actifs ascendant (charge de travail), puis par ID pour la stabilité.
  agentScores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.active_leads_count !== b.active_leads_count) {
      return a.active_leads_count - b.active_leads_count;
    }
    return a.agent_id.localeCompare(b.agent_id);
  });

  const bestAgent = agentScores[0];
  if (!bestAgent) {
    return json({ error: 'Erreur de calcul du meilleur agent' }, 500);
  }

  // 6. Assigner le lead à cet agent
  await env.DB.prepare(
    "UPDATE leads SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(bestAgent.agent_id, leadId)
    .run();

  // Enregistrer l'activité d'assignation
  await env.DB.prepare(
    "INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, 'assigned', ?)"
  )
    .bind(
      leadId,
      auth.userId,
      JSON.stringify({ to: bestAgent.agent_id, by: 'ai_routing', agent_name: bestAgent.agent_name })
    )
    .run()
    .catch(() => null);

  return json({
    success: true,
    assigned_to: bestAgent.agent_id,
    agent_name: bestAgent.agent_name,
    category: leadCategory,
    scores: agentScores.map((s) => ({
      agent_id: s.agent_id,
      agent_name: s.agent_name,
      score: Number(s.score.toFixed(4)),
      won_count: s.won_count,
      lost_count: s.lost_count,
      active_leads_count: s.active_leads_count,
    })),
  });
}
