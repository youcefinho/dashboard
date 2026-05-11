// ── Module Scoring — Intralys CRM ───────────────────────────
// Multi-score profiles (Q.4) — Sprint 2 Phase 2.0
import type { Env } from './types';
import { json } from './helpers';
import { autoEnrollForTrigger } from './workflows';

// ── Types ───────────────────────────────────────────────────

interface ScoreFormula {
  weights: Record<string, number>;
}

interface ScoreProfile {
  id: string;
  client_id: string | null;
  name: string;
  description: string;
  formula: string;
  is_default: number;
  is_active: number;
  created_at: string;
}

// ── Handlers ────────────────────────────────────────────────

// Liste des profils de scoring
export async function handleGetScoreProfiles(
  env: Env, _auth: { role: string }, url: URL
): Promise<Response> {
  const clientId = url.searchParams.get('client_id');
  let query = 'SELECT * FROM score_profiles WHERE is_active = 1';
  const params: string[] = [];
  if (clientId) {
    query += ' AND (client_id = ? OR client_id IS NULL)';
    params.push(clientId);
  }
  query += ' ORDER BY is_default DESC, name ASC';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

// Créer un profil de scoring
export async function handleCreateScoreProfile(
  request: Request, env: Env, auth: { role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as {
    name?: string;
    description?: string;
    formula?: ScoreFormula;
    client_id?: string;
    is_default?: boolean;
  };

  if (!body.name) return json({ error: 'Nom requis' }, 400);
  if (!body.formula?.weights) return json({ error: 'Formule (weights) requise' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO score_profiles (id, client_id, name, description, formula, is_default)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    body.client_id || null,
    body.name.trim().slice(0, 200),
    (body.description || '').trim().slice(0, 500),
    JSON.stringify(body.formula),
    body.is_default ? 1 : 0
  ).run();

  return json({ data: { id } }, 201);
}

// Modifier un profil de scoring
export async function handleUpdateScoreProfile(
  request: Request, env: Env, auth: { role: string }, profileId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as {
    name?: string;
    description?: string;
    formula?: ScoreFormula;
    is_active?: boolean;
  };

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name.trim().slice(0, 200)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(body.description.trim().slice(0, 500)); }
  if (body.formula !== undefined) { updates.push('formula = ?'); params.push(JSON.stringify(body.formula)); }
  if (body.is_active !== undefined) { updates.push('is_active = ?'); params.push(body.is_active ? 1 : 0); }

  if (updates.length === 0) return json({ error: 'Rien à modifier' }, 400);

  params.push(profileId);
  await env.DB.prepare(
    `UPDATE score_profiles SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return json({ success: true });
}

// Scores d'un lead pour tous les profils
export async function handleGetLeadScores(
  env: Env, _auth: { role: string }, leadId: string
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT ls.profile_id, ls.score, ls.computed_at, sp.name, sp.description
     FROM lead_scores ls
     JOIN score_profiles sp ON sp.id = ls.profile_id
     WHERE ls.lead_id = ? AND sp.is_active = 1
     ORDER BY sp.is_default DESC, sp.name ASC`
  ).bind(leadId).all();

  return json({ data: results || [] });
}

// Recalculer le score d'un lead
export async function handleRecomputeLeadScore(
  env: Env, _auth: { role: string }, leadId: string
): Promise<Response> {
  // Charger le lead
  const lead = await env.DB.prepare(
    'SELECT * FROM leads WHERE id = ?'
  ).bind(leadId).first() as Record<string, unknown> | null;

  if (!lead) return json({ error: 'Lead non trouvé' }, 404);

  // Charger les profils actifs
  const clientId = lead.client_id as string;
  const { results: profiles } = await env.DB.prepare(
    'SELECT * FROM score_profiles WHERE is_active = 1 AND (client_id = ? OR client_id IS NULL)'
  ).bind(clientId).all();

  const scores: Array<{ profile_id: string; name: string; score: number }> = [];

  for (const profile of ((profiles || []) as unknown as ScoreProfile[])) {
    const formula = JSON.parse(profile.formula) as ScoreFormula;
    const score = computeScore(lead, formula);

    // Upsert le score
    await env.DB.prepare(
      `INSERT INTO lead_scores (lead_id, profile_id, score, computed_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (lead_id, profile_id) DO UPDATE SET score = ?, computed_at = datetime('now')`
    ).bind(leadId, profile.id, score, score).run();

    scores.push({ profile_id: profile.id, name: profile.name, score });
  }

  // Mettre à jour le score principal du lead (profil par défaut)
  const defaultProfile = ((profiles || []) as unknown as ScoreProfile[]).find((p) => p.is_default);
  if (defaultProfile) {
    const defaultScore = scores.find(s => s.profile_id === defaultProfile.id);
    if (defaultScore) {
      await env.DB.prepare(
        'UPDATE leads SET score = ? WHERE id = ?'
      ).bind(defaultScore.score, leadId).run();
    }
  }

  // Auto-enroll workflows for score changes
  try {
    await autoEnrollForTrigger(env, 'lead_score_changed', leadId);
  } catch (err) {
    console.error('Failed to trigger score change workflows', err);
  }

  return json({ data: scores });
}

// ── Compute engine ──────────────────────────────────────────

function computeScore(lead: Record<string, unknown>, formula: ScoreFormula): number {
  let totalScore = 0;
  const maxScore = 100;

  for (const [criterion, weight] of Object.entries(formula.weights)) {
    let met = false;

    switch (criterion) {
      // Complétude du profil
      case 'has_phone':
        met = !!(lead.phone && (lead.phone as string).length > 0);
        break;
      case 'has_email':
        met = !!(lead.email && (lead.email as string).length > 0);
        break;
      case 'has_budget':
        met = (lead.deal_value as number || 0) > 0;
        break;
      case 'has_property_address':
        met = !!(lead.address && (lead.address as string).length > 0);
        break;
      case 'has_property_value':
        met = (lead.deal_value as number || 0) > 100000;
        break;

      // Type de lead
      case 'type_buy':
        met = lead.type === 'inbound';
        break;
      case 'type_sell':
        met = lead.type === 'customer';
        break;

      // Tags spéciaux
      case 'tag_chaud':
        // On vérifierait les tags du lead (simplifié ici)
        met = lead.status === 'qualified' || lead.status === 'won';
        break;

      // Source
      case 'source_referral':
        met = lead.source === 'referral';
        break;
      case 'source_website':
        met = lead.source === 'website';
        break;

      // Engagement
      case 'engagement_7d': {
        // Lead actif dans les 7 derniers jours
        const lastActivity = lead.last_activity_at as string || lead.created_at as string || '';
        if (lastActivity) {
          const diff = Date.now() - new Date(lastActivity).getTime();
          met = diff < 7 * 24 * 60 * 60 * 1000;
        }
        break;
      }

      // RDV
      case 'meeting_booked':
        met = lead.status === 'qualified' || lead.status === 'won';
        break;

      // Réactivité
      case 'response_time_24h':
        // Simplifié — si contacté dans les 24h
        met = lead.status !== 'new';
        break;

      default:
        met = false;
    }

    if (met) totalScore += weight;
  }

  return Math.min(Math.round(totalScore), maxScore);
}

// ── Seed default profiles ───────────────────────────────────

export async function seedDefaultScoreProfiles(env: Env): Promise<void> {
  const defaults = [
    {
      name: 'Qualification globale',
      description: 'Score de qualification général basé sur la complétude du profil et l\'engagement',
      formula: { weights: { has_phone: 10, has_email: 10, has_budget: 20, engagement_7d: 15, tag_chaud: 25, source_referral: 20 } },
      is_default: 1,
    },
    {
      name: 'Score prospect',
      description: 'Score spécifique pour les leads entrants',
      formula: { weights: { type_buy: 30, has_budget: 25, response_time_24h: 20, meeting_booked: 25 } },
      is_default: 0,
    },
    {
      name: 'Score client',
      description: 'Score spécifique pour les clients',
      formula: { weights: { type_sell: 30, has_property_address: 25, has_property_value: 25, engagement_7d: 20 } },
      is_default: 0,
    },
  ];

  for (const profile of defaults) {
    const existing = await env.DB.prepare(
      'SELECT id FROM score_profiles WHERE name = ?'
    ).bind(profile.name).first();

    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO score_profiles (id, name, description, formula, is_default, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).bind(
        crypto.randomUUID(),
        profile.name,
        profile.description,
        JSON.stringify(profile.formula),
        profile.is_default
      ).run();
    }
  }
}
