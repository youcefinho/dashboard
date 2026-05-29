import type { Env } from './types';
import { json, sanitizeInput } from './helpers';

/**
 * Enregistre un événement d'audit système de manière robuste et isolée.
 * Ne lance jamais d'exception pour ne pas bloquer l'action utilisateur parente.
 */
export async function auditSystem(
  env: Env,
  clientId: string,
  userId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  payload: any,
  ipAddress: string | null,
): Promise<void> {
  try {
    const id = crypto.randomUUID();
    const payloadStr = payload ? JSON.stringify(payload) : null;
    
    await env.DB.prepare(
      `INSERT INTO system_audit_logs 
         (id, client_id, user_id, action, target_type, target_id, payload_json, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(id, clientId, userId, action, targetType, targetId, payloadStr, ipAddress)
      .run();
  } catch (err) {
    console.error('[auditSystem] Échec de l\'enregistrement d\'audit :', err);
  }
}

/**
 * Récupère les logs d'audit système pour le client authentifié.
 * Gère le multi-tenant de façon étanche et offre un filtre de recherche.
 */
export async function handleGetSystemAuditLogs(
  request: Request,
  env: Env,
  auth: any,
): Promise<Response> {
  // Protection multi-tenant
  const clientId = auth.clientId;
  if (!clientId) {
    return json({ error: 'Contexte client introuvable' }, 400);
  }

  // Vérifier la capability d'accès
  if (auth.role !== 'admin' && (!auth.capabilities || !auth.capabilities.has('settings.manage'))) {
    return json({ error: 'Accès refusé' }, 403);
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const actionFilter = sanitizeInput(url.searchParams.get('action') || '');
  const targetTypeFilter = sanitizeInput(url.searchParams.get('target_type') || '');

  try {
    let sql = `SELECT id, user_id, action, target_type, target_id, payload_json, ip_address, created_at 
               FROM system_audit_logs 
               WHERE client_id = ?`;
    const params: any[] = [clientId];

    if (actionFilter) {
      sql += ' AND action = ?';
      params.push(actionFilter);
    }
    if (targetTypeFilter) {
      sql += ' AND target_type = ?';
      params.push(targetTypeFilter);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results } = await env.DB.prepare(sql).bind(...params).all();

    // Récupérer le nombre total pour la pagination
    let countSql = 'SELECT COUNT(*) as total FROM system_audit_logs WHERE client_id = ?';
    const countParams: any[] = [clientId];
    if (actionFilter) {
      countSql += ' AND action = ?';
      countParams.push(actionFilter);
    }
    if (targetTypeFilter) {
      countSql += ' AND target_type = ?';
      countParams.push(targetTypeFilter);
    }
    const countResult = await env.DB.prepare(countSql).bind(...countParams).first() as { total: number } | null;

    return json({
      data: results || [],
      pagination: {
        total: countResult?.total || 0,
        limit,
        offset
      }
    });
  } catch (err: any) {
    // Si la table n'existe pas encore (dégradation gracieuse)
    if (err.message && (err.message.includes('no such table') || err.message.includes('system_audit_logs'))) {
      return json({ data: [], pagination: { total: 0, limit, offset } });
    }
    return json({ error: 'Erreur lors de la récupération des logs d\'audit' }, 500);
  }
}
