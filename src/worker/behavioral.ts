// ── Module Lead Scoring Comportemental v2 — Sprint 78 ───────────────────
import type { Env } from './types';
import { json } from './helpers';

// Helper pour mapper la description de l'événement en français québécois
function getEventDescription(eventType: string, delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  const deltaStr = `(${sign}${delta})`;
  switch (eventType) {
    case 'email_click':
      return `Clic sur un courriel ${deltaStr}`;
    case 'file_download':
      return `Téléchargement d'un fichier ${deltaStr}`;
    case 'page_view':
      return `Visite d'une page ${deltaStr}`;
    case 'form_submit':
      return `Soumission d'un formulaire ${deltaStr}`;
    case 'unsubscribe':
      return `Désabonnement ${deltaStr}`;
    default:
      return `Événement comportemental : ${eventType} ${deltaStr}`;
  }
}

// Handler public pour le tracking d'événements comportementaux (POST /api/public/track)
export async function handleTrackBehavioralEvent(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée' }, 405);
  }

  let body: { lead_id?: string; email?: string; event_type?: string; score_delta?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Payload JSON invalide' }, 400);
  }

  const { lead_id, email, event_type, score_delta } = body;

  if (!lead_id && !email) {
    return json({ error: 'lead_id ou email requis pour le tracking' }, 400);
  }

  if (!event_type) {
    return json({ error: 'event_type requis' }, 400);
  }

  // 1. Rechercher le lead en base de données
  let lead: { id: string; client_id: string; score: number } | null = null;

  if (lead_id) {
    lead = await env.DB.prepare('SELECT id, client_id, score FROM leads WHERE id = ?')
      .bind(lead_id)
      .first<{ id: string; client_id: string; score: number }>();
  } else if (email) {
    const normalizedEmail = email.trim().toLowerCase();
    lead = await env.DB.prepare('SELECT id, client_id, score FROM leads WHERE email = ?')
      .bind(normalizedEmail)
      .first<{ id: string; client_id: string; score: number }>();
  }

  if (!lead) {
    return json({ error: 'Lead introuvable' }, 404);
  }

  // 2. Déterminer le score delta
  let delta = 1;
  if (typeof score_delta === 'number') {
    delta = score_delta;
  } else {
    switch (event_type) {
      case 'email_click':
        delta = 5;
        break;
      case 'file_download':
        delta = 10;
        break;
      case 'page_view':
        delta = 2;
        break;
      case 'form_submit':
        delta = 15;
        break;
      case 'unsubscribe':
        delta = -20;
        break;
      default:
        delta = 1;
    }
  }

  const oldScore = typeof lead.score === 'number' ? lead.score : 30;
  const newScore = Math.max(0, Math.min(100, oldScore + delta));

  // 3. Insérer l'événement comportemental
  const eventId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO behavioral_events (id, lead_id, event_type, score_delta, score_after) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(eventId, lead.id, event_type, delta, newScore)
    .run();

  // 4. Mettre à jour le score du lead en base de données
  await env.DB.prepare('UPDATE leads SET score = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(newScore, lead.id)
    .run();

  // 5. Enregistrer dans l'activity log pour affichage dans la timeline du CRM
  const description = getEventDescription(event_type, delta);
  await env.DB.prepare(
    'INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, ?, ?)'
  )
    .bind(
      lead.id,
      'system_tracking',
      'behavioral_event',
      JSON.stringify({
        event_type,
        score_delta: delta,
        score_after: newScore,
        description,
      })
    )
    .run()
    .catch(() => null); // best-effort

  return json({
    success: true,
    lead_id: lead.id,
    new_score: newScore,
    event: {
      id: eventId,
      event_type,
      score_delta: delta,
      score_after: newScore,
    },
  });
}

// Handler privé authentifié pour récupérer l'historique d'un lead (GET /api/leads/:id/behavioral-events)
export async function handleGetLeadBehavioralEvents(
  _request: Request,
  env: Env,
  auth: { role: string; clientId?: string },
  leadId: string
): Promise<Response> {
  if (!leadId) {
    return json({ error: 'ID du lead requis' }, 400);
  }

  // Sécurité multi-tenant : vérifier que le lead appartient au même client_id
  const lead = await env.DB.prepare('SELECT client_id FROM leads WHERE id = ?')
    .bind(leadId)
    .first<{ client_id: string }>();

  if (!lead) {
    return json({ error: 'Lead introuvable' }, 404);
  }

  if (auth.role !== 'admin' && lead.client_id !== auth.clientId) {
    return json({ error: 'Accès interdit (propriétaire différent)' }, 403);
  }

  // Récupérer les événements par ordre chronologique
  const events = await env.DB.prepare(
    'SELECT id, event_type, score_delta, score_after, created_at FROM behavioral_events WHERE lead_id = ? ORDER BY created_at ASC'
  )
    .bind(leadId)
    .all<{ id: string; event_type: string; score_delta: number; score_after: number; created_at: string }>();

  return json({
    events: events.results || [],
  });
}
