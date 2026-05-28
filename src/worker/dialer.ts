// ── dialer.ts — Sprint 54 Power Dialer (Moteur d'Appels en Rafale) ────────────
//
// Gère le cycle de vie des campagnes de numérotation automatique (Power Dialer).
//
// Sécurité :
//   - Multi-tenant strict : Toutes les requêtes filtrent par client_id résolu.
//   - Validation stricte des statuts et payloads via Zod.
//   - Traces d'audit Loi 25 sur les fiches de leads.
//
// Conventions :
//   - Réponses : json({ data }) pour le succès / json({ error }, status) pour l'erreur.
//   - Langue : Français (messages d'erreur et logs).

import type { Env } from './types';
import { json, audit } from './helpers';
import { getClientModules } from './modules';
import { z } from 'zod/v4';

type Auth = { userId: string; role: string };

async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400
  );
}

// ── Schémas Zod ──────────────────────────────────────────────────────────────

const createCampaignSchema = z.object({
  name: z.string().min(1, { message: 'Le nom de la campagne est requis.' }).max(200),
  lead_ids: z.array(z.string()).min(1, { message: 'Précise au moins un prospect.' }),
  script_markdown: z.string().max(10000).optional().default(''),
});

const updateCampaignSchema = z.object({
  name: z.string().max(200).optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed']).optional(),
  current_index: z.number().int().min(0).optional(),
  script_markdown: z.string().max(10000).optional(),
});

// ── GET /api/dialer/campaigns ───────────────────────────────────────────────
export async function handleGetDialerCampaigns(
  _request: Request,
  env: Env,
  auth: Auth
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM dialer_campaigns WHERE client_id = ? ORDER BY created_at DESC'
    )
      .bind(clientId)
      .all();

    const formatted = (results || []).map((c: any) => ({
      ...c,
      lead_ids: JSON.parse(c.leads_json || '[]'),
    }));

    return json({ data: formatted });
  } catch (err: any) {
    return json({ error: 'Erreur SQL', message: err.message }, 500);
  }
}

// ── POST /api/dialer/campaigns ──────────────────────────────────────────────
export async function handleCreateDialerCampaign(
  request: Request,
  env: Env,
  auth: Auth
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const body = await request.json().catch(() => null);
    const vr = createCampaignSchema.safeParse(body);
    if (!vr.success) {
      const msg = vr.error.issues[0]?.message || 'Validation échouée';
      return json({ error: 'Validation échouée', message: msg }, 400);
    }

    const { name, lead_ids, script_markdown } = vr.data;

    // Optionnel : valider que les leads appartiennent bien au tenant
    const placeholders = lead_ids.map(() => '?').join(',');
    const { results: validLeads } = await env.DB.prepare(
      `SELECT id FROM leads WHERE id IN (${placeholders}) AND client_id = ?`
    )
      .bind(...lead_ids, clientId)
      .all();

    const validIds = (validLeads || []).map((l: any) => l.id);
    if (validIds.length === 0) {
      return json({ error: 'Campagne invalide', message: 'Aucun des prospects spécifiés n\'est valide.' }, 400);
    }

    const leadsJson = JSON.stringify(validIds);

    const inserted = await env.DB.prepare(
      `INSERT INTO dialer_campaigns (client_id, name, leads_json, status, current_index, script_markdown)
       VALUES (?, ?, ?, 'draft', 0, ?)
       RETURNING *`
    )
      .bind(clientId, name, leadsJson, script_markdown)
      .first() as any;

    if (!inserted) {
      return json({ error: 'Échec de création', message: 'La campagne n\'a pas pu être insérée.' }, 500);
    }

    await audit(env, auth.userId, 'create', 'dialer_campaign', inserted.id, {
      name,
      leads_count: validIds.length,
    });

    return json({
      data: {
        ...inserted,
        lead_ids: validIds,
      }
    }, 201);
  } catch (err: any) {
    return json({ error: 'Erreur serveur', message: err.message }, 500);
  }
}

// ── GET /api/dialer/campaigns/:id ───────────────────────────────────────────
export async function handleGetDialerCampaign(
  _request: Request,
  env: Env,
  auth: Auth,
  id: string
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const campaign = await env.DB.prepare(
      'SELECT * FROM dialer_campaigns WHERE id = ? AND client_id = ?'
    )
      .bind(id, clientId)
      .first() as any;

    if (!campaign) {
      return json({ error: 'Campagne introuvable' }, 404);
    }

    const leadIds = JSON.parse(campaign.leads_json || '[]');

    return json({
      data: {
        ...campaign,
        lead_ids: leadIds,
      }
    });
  } catch (err: any) {
    return json({ error: 'Erreur SQL', message: err.message }, 500);
  }
}

// ── PATCH /api/dialer/campaigns/:id ─────────────────────────────────────────
export async function handleUpdateDialerCampaign(
  request: Request,
  env: Env,
  auth: Auth,
  id: string
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const campaign = await env.DB.prepare(
      'SELECT id, name, status, current_index FROM dialer_campaigns WHERE id = ? AND client_id = ?'
    )
      .bind(id, clientId)
      .first() as any;

    if (!campaign) {
      return json({ error: 'Campagne introuvable' }, 404);
    }

    const body = await request.json().catch(() => null);
    const vr = updateCampaignSchema.safeParse(body);
    if (!vr.success) {
      const msg = vr.error.issues[0]?.message || 'Validation échouée';
      return json({ error: 'Validation échouée', message: msg }, 400);
    }

    const fields = vr.data;
    const sets: string[] = ["updated_at = datetime('now')"];
    const params: any[] = [];

    if (fields.name !== undefined) {
      sets.push('name = ?');
      params.push(fields.name);
    }
    if (fields.status !== undefined) {
      sets.push('status = ?');
      params.push(fields.status);
    }
    if (fields.current_index !== undefined) {
      sets.push('current_index = ?');
      params.push(fields.current_index);
    }
    if (fields.script_markdown !== undefined) {
      sets.push('script_markdown = ?');
      params.push(fields.script_markdown);
    }

    if (params.length === 0) {
      return json({ error: 'Rien à modifier', message: 'Aucun champ valide n\'a été fourni.' }, 400);
    }

    params.push(id, clientId);
    await env.DB.prepare(
      `UPDATE dialer_campaigns SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`
    )
      .bind(...params)
      .run();

    await audit(env, auth.userId, 'update', 'dialer_campaign', id, fields);

    const updated = await env.DB.prepare(
      'SELECT * FROM dialer_campaigns WHERE id = ?'
    ).bind(id).first() as any;

    return json({
      data: {
        ...updated,
        lead_ids: JSON.parse(updated.leads_json || '[]'),
      }
    });
  } catch (err: any) {
    return json({ error: 'Erreur serveur', message: err.message }, 500);
  }
}

// ── DELETE /api/dialer/campaigns/:id ───────────────────────────────────────
export async function handleDeleteDialerCampaign(
  _request: Request,
  env: Env,
  auth: Auth,
  id: string
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  try {
    const campaign = await env.DB.prepare(
      'SELECT id FROM dialer_campaigns WHERE id = ? AND client_id = ?'
    )
      .bind(id, clientId)
      .first() as any;

    if (!campaign) {
      return json({ error: 'Campagne introuvable' }, 404);
    }

    await env.DB.prepare('DELETE FROM dialer_campaigns WHERE id = ?').bind(id).run();
    await audit(env, auth.userId, 'delete', 'dialer_campaign', id);

    return json({ success: true, message: 'Campagne supprimée avec succès.' });
  } catch (err: any) {
    return json({ error: 'Erreur serveur', message: err.message }, 500);
  }
}

// ── GET /api/dialer/campaigns/:id/lead ──────────────────────────────────────
// Récupère les détails du prospect courant dans la file et gère la progression.
export async function handleGetDialerCurrentLead(
  request: Request,
  env: Env,
  auth: Auth,
  id: string
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const url = new URL(request.url);
  // ?direction=next ou ?direction=prev ou ?direction=current
  const direction = url.searchParams.get('direction') || 'current';

  try {
    const campaign = await env.DB.prepare(
      'SELECT * FROM dialer_campaigns WHERE id = ? AND client_id = ?'
    )
      .bind(id, clientId)
      .first() as any;

    if (!campaign) {
      return json({ error: 'Campagne introuvable' }, 404);
    }

    const leadIds = JSON.parse(campaign.leads_json || '[]') as string[];
    let index = campaign.current_index;

    if (direction === 'next') {
      index = index + 1;
    } else if (direction === 'prev') {
      index = Math.max(0, index - 1);
    }

    let lead: any = null;

    // Recherche itérative du premier lead existant dans la file à partir de l'index
    while (index < leadIds.length) {
      const targetLeadId = leadIds[index]!;
      lead = await env.DB.prepare(
        'SELECT * FROM leads WHERE id = ? AND client_id = ?'
      )
        .bind(targetLeadId, clientId)
        .first() as any;

      if (lead) {
        break; // Prospect trouvé !
      }

      // Si le prospect n'existe pas en base de données, on avance au suivant dans la file
      index = index + 1;
    }

    // Si on dépasse la fin de la file d'attente
    if (index >= leadIds.length) {
      await env.DB.prepare(
        "UPDATE dialer_campaigns SET status = 'completed', current_index = ?, updated_at = datetime('now') WHERE id = ?"
      )
        .bind(leadIds.length, id)
        .run();
      
      return json({
        data: {
          campaign_completed: true,
          current_index: leadIds.length,
          total_leads: leadIds.length,
        }
      });
    }

    // Mettre à jour l'index courant trouvé dans la base
    await env.DB.prepare(
      "UPDATE dialer_campaigns SET current_index = ?, status = 'active', updated_at = datetime('now') WHERE id = ?"
    )
      .bind(index, id)
      .run();

    const targetLeadId = leadIds[index]!;

    // Loi 25 : trace d'accès au lead par le dialer
    await audit(env, auth.userId, 'view', 'lead', targetLeadId, {
      context: 'power_dialer',
      campaign_id: id,
    });

    return json({
      data: {
        campaign_completed: false,
        current_index: index,
        total_leads: leadIds.length,
        lead,
        script: campaign.script_markdown || '',
      }
    });
  } catch (err: any) {
    return json({ error: 'Erreur serveur', message: err.message }, 500);
  }
}
