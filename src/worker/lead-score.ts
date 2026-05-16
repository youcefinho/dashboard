// ── Module Lead Score Explain — Sprint 43 M3.4 ─────────────────
// Cache D1 + recompute des breakdowns explicables (6 signaux).
// Remplace le mock client `src/lib/leadScoreExplain.ts`.
//
// Endpoint :
//   GET /api/leads/:id/score   → { score, signals: ScoreSignal[], computed_at }
//
// Stratégie :
//  - Lookup `lead_score_cache` par lead_id
//  - Si `computed_at` > now - 1h → serve cache
//  - Sinon → recompute (heuristique partagée 100% serveur-side) + upsert + serve
//
// Heuristique 1:1 alignée sur src/lib/leadScoreExplain.ts pour préserver le
// breakdown UX (mêmes ids, mêmes labels, mêmes contributions ±). Le score
// total est la somme des contributions clampée 0..100.

import type { Env } from './types';
import { json } from './helpers';

const CACHE_TTL_SECONDS = 60 * 60; // 1h

export interface ScoreSignal {
  id: string;
  label: string;
  value: number | string;
  contribution: number;
  weight: number;
  detail?: string;
}

interface LeadRow {
  id: string;
  score: number | null;
  status: string;
  source: string | null;
  deal_value: number | null;
  updated_at: string | null;
  last_activity_at: string | null;
  tags: string | null;  // JSON array ou liste séparée — défensif
}

interface ScoreCacheRow {
  lead_id: string;
  score: number;
  signals: string;
  computed_at: number;
}

// Coefficients sources alignés sur le client
const SOURCE_COEFFICIENTS: Record<string, number> = {
  referral: 18,
  call: 14,
  email: 10,
  form: 8,
  webchat: 8,
  facebook_ads: 6,
  google_ads: 6,
  cold: -4,
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 999;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return 999;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j.map(String);
  } catch { /* fall through */ }
  return raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

function statusToProbability(status: string): number {
  const map: Record<string, number> = {
    new: 10,
    contacted: 25,
    qualified: 60,
    won: 100,
    closed: 100,
    lost: 0,
  };
  return map[status] ?? 20;
}

/**
 * Compute les 6 signaux + score total (parité 1:1 avec src/lib/leadScoreExplain.ts).
 */
async function computeSignals(env: Env, lead: LeadRow): Promise<{ score: number; signals: ScoreSignal[] }> {
  const signals: ScoreSignal[] = [];

  // Compteurs supplémentaires depuis D1
  const msgRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM messages WHERE lead_id = ?`
  ).bind(lead.id).first<{ c: number }>();
  const msgCount = Number(msgRow?.c || 0);

  const tasksRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM tasks WHERE lead_id = ? AND status = 'done'`
  ).bind(lead.id).first<{ c: number }>().catch(() => null);
  const tasksDone = Number(tasksRow?.c || 0);

  // 1. Activité récente
  const lastActivityDays = daysSince(lead.last_activity_at || lead.updated_at);
  let activityContribution: number;
  let activityDetail: string;
  if (lastActivityDays <= 1) {
    activityContribution = 25;
    activityDetail = 'Activité aujourd\'hui — momentum fort';
  } else if (lastActivityDays <= 3) {
    activityContribution = 18;
    activityDetail = `Touché il y a ${lastActivityDays}j — chaud`;
  } else if (lastActivityDays <= 7) {
    activityContribution = 8;
    activityDetail = `Touché il y a ${lastActivityDays}j — encore frais`;
  } else if (lastActivityDays <= 14) {
    activityContribution = -3;
    activityDetail = `${lastActivityDays}j sans contact — à relancer`;
  } else {
    activityContribution = -10;
    activityDetail = `${lastActivityDays}j d'inactivité — refroidi`;
  }
  signals.push({
    id: 'activity',
    label: 'Activité récente',
    value: `${lastActivityDays}j`,
    contribution: activityContribution,
    weight: clamp(1 - lastActivityDays / 30, 0.05, 1),
    detail: activityDetail,
  });

  // 2. Engagement
  const engagementRaw = msgCount * 2 + tasksDone * 4;
  const engagementContribution = clamp(engagementRaw, 0, 22);
  signals.push({
    id: 'engagement',
    label: 'Engagement',
    value: `${msgCount} msg · ${tasksDone} ✓`,
    contribution: engagementContribution,
    weight: clamp(engagementRaw / 30, 0.05, 1),
    detail: `${msgCount} message${msgCount > 1 ? 's' : ''} échangés et ${tasksDone} tâche${tasksDone > 1 ? 's' : ''} complétée${tasksDone > 1 ? 's' : ''}`,
  });

  // 3. Stage avancé
  const stageProb = statusToProbability(lead.status);
  const stageContribution = Math.round((stageProb - 30) * 0.4);
  signals.push({
    id: 'stage',
    label: 'Étape pipeline',
    value: `${stageProb}%`,
    contribution: stageContribution,
    weight: clamp(stageProb / 100, 0.05, 1),
    detail: stageProb >= 60
      ? 'Étape avancée — proche de la conversion'
      : stageProb >= 30
        ? 'Étape intermédiaire'
        : 'Début de pipeline',
  });

  // 4. Valeur du deal
  const dealValue = Number(lead.deal_value || 0);
  let dealContribution: number;
  if (dealValue >= 100_000) dealContribution = 18;
  else if (dealValue >= 50_000) dealContribution = 12;
  else if (dealValue >= 10_000) dealContribution = 6;
  else if (dealValue > 0) dealContribution = 2;
  else dealContribution = 0;
  signals.push({
    id: 'deal',
    label: 'Valeur deal',
    value: dealValue ? `${(dealValue / 1000).toFixed(dealValue >= 100_000 ? 0 : 1)}k$` : '—',
    contribution: dealContribution,
    weight: clamp(dealValue / 150_000, 0.05, 1),
    detail: dealValue > 0
      ? `${dealValue.toLocaleString('fr-CA')} $ — poids selon montant`
      : 'Valeur deal non renseignée',
  });

  // 5. Source
  const sourceKey = (lead.source || '').toLowerCase();
  const sourceCoef = SOURCE_COEFFICIENTS[sourceKey] ?? 4;
  signals.push({
    id: 'source',
    label: 'Source',
    value: lead.source || '—',
    contribution: sourceCoef,
    weight: clamp(Math.abs(sourceCoef) / 18, 0.1, 1),
    detail: sourceCoef >= 10
      ? 'Source haute qualité (warm lead)'
      : sourceCoef >= 0
        ? 'Source standard'
        : 'Source froide — taux conversion bas',
  });

  // 6. Tags chauds
  const tags = parseTags(lead.tags).map(t => t.toLowerCase());
  const hotKeywords = ['hot', 'chaud', 'qualified', 'qualifié', 'priority', 'vip'];
  const matchedTags = tags.filter(t => hotKeywords.some(kw => t.includes(kw)));
  if (matchedTags.length > 0) {
    signals.push({
      id: 'tags',
      label: 'Tags chauds',
      value: matchedTags.join(', '),
      contribution: 8 + (matchedTags.length - 1) * 3,
      weight: clamp(matchedTags.length / 3, 0.2, 1),
      detail: `Tag${matchedTags.length > 1 ? 's' : ''} prioritaire${matchedTags.length > 1 ? 's' : ''} détecté${matchedTags.length > 1 ? 's' : ''}`,
    });
  }

  // Score total = somme contributions clampée 0..100 + bias 30 (base score moyen lead nouveau).
  const sumContrib = signals.reduce((acc, s) => acc + s.contribution, 0);
  const score = clamp(30 + sumContrib, 0, 100);
  return { score, signals };
}

export async function handleGetLeadScore(
  env: Env,
  _auth: { userId: string; role: string },
  leadId: string,
): Promise<Response> {
  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  // Cache lookup
  const now = Math.floor(Date.now() / 1000);
  const cached = await env.DB.prepare(
    `SELECT lead_id, score, signals, computed_at FROM lead_score_cache WHERE lead_id = ?`
  ).bind(leadId).first<ScoreCacheRow>();

  if (cached && (now - cached.computed_at) < CACHE_TTL_SECONDS) {
    try {
      const signals = JSON.parse(cached.signals) as ScoreSignal[];
      return json({
        data: {
          score: cached.score,
          signals,
          computed_at: cached.computed_at,
          cached: true,
        },
      });
    } catch {
      // Cache corrompu — recompute fallback
    }
  }

  // Recompute
  const lead = await env.DB.prepare(
    `SELECT id, score, status, source, deal_value, updated_at, last_activity_at, tags
     FROM leads WHERE id = ?`
  ).bind(leadId).first<LeadRow>();

  if (!lead) return json({ error: 'Lead introuvable' }, 404);

  const { score, signals } = await computeSignals(env, lead);
  const signalsJson = JSON.stringify(signals);

  // Upsert cache
  await env.DB.prepare(
    `INSERT INTO lead_score_cache (lead_id, score, signals, computed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(lead_id) DO UPDATE SET
       score = excluded.score,
       signals = excluded.signals,
       computed_at = excluded.computed_at`
  ).bind(leadId, score, signalsJson, now).run();

  return json({
    data: {
      score,
      signals,
      computed_at: now,
      cached: false,
    },
  });
}
