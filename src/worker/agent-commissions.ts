import type { Env } from './types';
import { json, audit } from './helpers';
import type { CapAuth } from './capabilities';

export type AgentCommissionAuth = CapAuth & { capabilities?: Set<string> };

// Statuts valides pour les commissions d'agent
export const AGENT_COMMISSION_STATUSES = ['pending', 'paid', 'cancelled'] as const;

/**
 * Hook déclenché à la fermeture (won) d'un lead.
 * Calcule et enregistre une commission pour l'agent assigné.
 * Règle : 5% de la valeur du contrat (deal_value) converti en cents.
 */
export async function onAgentLeadWon(env: Env, leadId: string): Promise<void> {
  try {
    if (!leadId) return;

    // 1) Récupérer le lead
    const lead = await env.DB.prepare(
      'SELECT client_id, assigned_to, deal_value, status FROM leads WHERE id = ? LIMIT 1'
    )
      .bind(leadId)
      .first() as { client_id: string; assigned_to: string | null; deal_value: number | null; status: string } | null;

    if (!lead || !lead.assigned_to) return;

    // 2) Idempotence : pas de double commission d'agent pour ce lead
    const existing = await env.DB.prepare(
      'SELECT 1 AS x FROM agent_commissions WHERE lead_id = ? LIMIT 1'
    )
      .bind(leadId)
      .first() as { x: number } | null;
    
    if (existing) return;

    // 3) Résoudre l'utilisateur (agent) associé par son id ou son nom
    const agent = await env.DB.prepare(
      'SELECT id FROM users WHERE (id = ? OR name = ?) AND client_id = ? LIMIT 1'
    )
      .bind(lead.assigned_to, lead.assigned_to, lead.client_id)
      .first() as { id: string } | null;

    // Si on ne trouve pas d'utilisateur exact, on peut utiliser assigned_to s'il ressemble à un UUID,
    // ou tout simplement ne pas insérer de commission si l'agent n'est pas un utilisateur valide.
    const userId = agent ? agent.id : (lead.assigned_to.length === 36 ? lead.assigned_to : null);
    if (!userId) return;

    // 4) Calculer la commission : 5% de la valeur de l'opportunité (deal_value) en cents
    const dealValue = lead.deal_value != null && Number.isFinite(Number(lead.deal_value)) ? Number(lead.deal_value) : 0;
    const commissionCents = Math.round(dealValue * 100 * 0.05);

    // 5) Insérer la commission d'agent
    await env.DB.prepare(
      `INSERT INTO agent_commissions (id, client_id, user_id, lead_id, commission_cents, status)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, 'pending')`
    )
      .bind(lead.client_id, userId, leadId, commissionCents)
      .run();

  } catch (e) {
    console.error('Erreur onAgentLeadWon:', e);
  }
}

/**
 * Récupère la liste des commissions des agents pour le tenant courant.
 */
export async function handleGetAgentCommissions(
  env: Env,
  auth: AgentCommissionAuth,
  url: URL
): Promise<Response> {
  const clientId = auth.role === 'broker' ? auth.clientId : (url.searchParams.get('client_id') || auth.clientId);
  if (!clientId) {
    return json({ error: 'Identifiant client (tenant) manquant' }, 400);
  }

  // Filtrage par agent si rôle broker
  let query = `
    SELECT ac.*, u.name as agent_name, u.email as agent_email, l.name as lead_name, l.deal_value as lead_deal_value
    FROM agent_commissions ac
    LEFT JOIN users u ON ac.user_id = u.id
    LEFT JOIN leads l ON ac.lead_id = l.id
    WHERE ac.client_id = ?
  `;
  const params: (string | number)[] = [clientId];

  if (auth.role === 'broker') {
    query += ' AND ac.user_id = ?';
    params.push(auth.userId);
  }

  query += ' ORDER BY ac.created_at DESC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return json({ data: results || [] });
}

/**
 * Met à jour le statut d'une commission (ex: payer ou annuler).
 * Seuls les administrateurs peuvent effectuer cette action.
 */
export async function handleUpdateAgentCommissionStatus(
  request: Request,
  env: Env,
  auth: AgentCommissionAuth,
  commissionId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json().catch(() => null) as { status?: string } | null;
  const status = body?.status;

  if (!status || !AGENT_COMMISSION_STATUSES.includes(status as any)) {
    return json({ error: 'Statut invalide' }, 400);
  }

  // Vérifier l'existence et le bon tenant
  const commission = await env.DB.prepare(
    'SELECT id, client_id, commission_cents FROM agent_commissions WHERE id = ? LIMIT 1'
  )
    .bind(commissionId)
    .first() as { id: string; client_id: string; commission_cents: number } | null;

  if (!commission) {
    return json({ error: 'Commission introuvable' }, 404);
  }

  // Bornage tenant agence si applicable
  if (auth.clientId && commission.client_id !== auth.clientId) {
    return json({ error: 'Accès non autorisé' }, 403);
  }

  await env.DB.prepare(
    "UPDATE agent_commissions SET status = ? WHERE id = ?"
  )
    .bind(status, commissionId)
    .run();

  await audit(env, auth.userId, 'agent_commission.update_status', 'agent_commission', commissionId, { status });

  return json({ success: true });
}
