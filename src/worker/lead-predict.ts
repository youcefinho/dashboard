// ── Module Lead Predict — Sprint 49 M2.1 ───────────────────────
// Prévision de conversion à 30 jours (cache D1 `lead_predictions`, recompute >6h).
//
// Endpoint :
//   GET /api/leads/:id/score-predict
//     → { probability30d, confidence, suggestedActions, factors, computed_at }
//
// Stratégie :
//  - Lookup `lead_predictions` par lead_id ; si computed_at > now-6h → serve cache
//  - Sinon recompute :
//      1. Heuristique déterministe (parité 1:1 avec src/lib/leadPredict.ts)
//      2. Tentative d'affinage Claude Haiku (prompt structuré JSON) — si l'API
//         répond un JSON valide, on prend sa probabilité/actions ; sinon on
//         garde la version déterministe (offline-safe).
//  - Upsert + serve
//
// Réutilise les coefficients de score (Sprint 43 lead-score.ts) sans modifier
// ce module.

import type { Env } from './types';
import { json } from './helpers';

const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6h

type PredictConfidence = 'low' | 'medium' | 'high';

interface PredictFactor {
  label: string;
  impact: number;
}

interface LeadPrediction {
  probability30d: number;
  confidence: PredictConfidence;
  suggestedActions: string[];
  factors: PredictFactor[];
  computed_at?: number;
}

interface LeadRow {
  id: string;
  score: number | null;
  status: string;
  source: string | null;
  deal_value: number | null;
  updated_at: string | null;
  created_at: string | null;
  last_activity_at: string | null;
  tags: string | null;
}

interface PredictCacheRow {
  lead_id: string;
  payload: string;
  computed_at: number;
}

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
  } catch {
    /* fall through */
  }
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
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
 * Calcul déterministe — parité 1:1 avec src/lib/leadPredict.ts.
 * Renvoie aussi les compteurs pour enrichir le prompt LLM.
 */
async function computeDeterministic(
  env: Env,
  lead: LeadRow,
): Promise<{ prediction: LeadPrediction; msgCount: number; tasksDone: number }> {
  const msgRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM messages WHERE lead_id = ?`,
  )
    .bind(lead.id)
    .first<{ c: number }>()
    .catch(() => null);
  const msgCount = Number(msgRow?.c || 0);

  const tasksRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM tasks WHERE lead_id = ? AND status = 'done'`,
  )
    .bind(lead.id)
    .first<{ c: number }>()
    .catch(() => null);
  const tasksDone = Number(tasksRow?.c || 0);

  // Score qualité (somme contributions clampée — aligné lead-score.ts)
  const lastActivityDays = daysSince(lead.last_activity_at || lead.updated_at);
  let activityContribution: number;
  if (lastActivityDays <= 1) activityContribution = 25;
  else if (lastActivityDays <= 3) activityContribution = 18;
  else if (lastActivityDays <= 7) activityContribution = 8;
  else if (lastActivityDays <= 14) activityContribution = -3;
  else activityContribution = -10;

  const engagementContribution = clamp(msgCount * 2 + tasksDone * 4, 0, 22);

  const stageProb = statusToProbability(lead.status);
  const stageContribution = Math.round((stageProb - 30) * 0.4);

  const dealValue = Number(lead.deal_value || 0);
  let dealContribution: number;
  if (dealValue >= 100_000) dealContribution = 18;
  else if (dealValue >= 50_000) dealContribution = 12;
  else if (dealValue >= 10_000) dealContribution = 6;
  else if (dealValue > 0) dealContribution = 2;
  else dealContribution = 0;

  const sourceKey = (lead.source || '').toLowerCase();
  const sourceCoef = SOURCE_COEFFICIENTS[sourceKey] ?? 4;

  const tags = parseTags(lead.tags).map((t) => t.toLowerCase());
  const hotKeywords = [
    'hot',
    'chaud',
    'qualified',
    'qualifié',
    'priority',
    'vip',
  ];
  const matchedTags = tags.filter((t) =>
    hotKeywords.some((kw) => t.includes(kw)),
  );
  const tagsContribution =
    matchedTags.length > 0 ? 8 + (matchedTags.length - 1) * 3 : 0;

  const sumContrib =
    activityContribution +
    engagementContribution +
    stageContribution +
    dealContribution +
    sourceCoef +
    tagsContribution;
  const baseScore = clamp(30 + sumContrib, 0, 100);

  const freshness = clamp(100 * Math.exp(-lastActivityDays / 14), 0, 100);
  let probability = Math.round(
    baseScore * 0.5 + stageProb * 0.35 + freshness * 0.15,
  );
  if (lead.status === 'won' || lead.status === 'closed') probability = 100;
  if (lead.status === 'lost') probability = 0;
  probability = clamp(probability, 0, 100);

  const signalRichness =
    (msgCount > 0 ? 1 : 0) +
    (tasksDone > 0 ? 1 : 0) +
    (lastActivityDays <= 14 ? 1 : 0) +
    (dealValue > 0 ? 1 : 0);
  const confidence: PredictConfidence =
    signalRichness >= 3 ? 'high' : signalRichness >= 2 ? 'medium' : 'low';

  const allFactors: PredictFactor[] = [
    { label: 'Activité récente', impact: activityContribution },
    { label: 'Engagement', impact: engagementContribution },
    { label: 'Étape pipeline', impact: stageContribution },
    { label: 'Valeur deal', impact: dealContribution },
    { label: 'Source', impact: sourceCoef },
  ];
  if (tagsContribution > 0)
    allFactors.push({ label: 'Tags chauds', impact: tagsContribution });
  const factors = allFactors
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 3)
    .map((f) => ({ label: f.label, impact: Math.round(f.impact) }));

  const suggestedActions: string[] = [];
  if (probability >= 70) {
    suggestedActions.push('Proposer un appel découverte cette semaine');
    suggestedActions.push("Envoyer une proposition pendant que c'est chaud");
    suggestedActions.push("Confirmer le budget et l'échéancier");
  } else if (probability >= 40) {
    suggestedActions.push(
      lastActivityDays >= 5
        ? `Relancer (sans contact depuis ${lastActivityDays}j)`
        : 'Relancer dans 2 jours avec une valeur ajoutée',
    );
    suggestedActions.push('Partager un cas client similaire');
    suggestedActions.push('Proposer un court appel de 15 min');
  } else {
    suggestedActions.push('Mettre dans une séquence de nurturing');
    suggestedActions.push('Qualifier le besoin avec 2-3 questions ciblées');
    suggestedActions.push(
      lastActivityDays >= 14
        ? 'Tenter une dernière relance avant de marquer perdu'
        : 'Garder au chaud avec du contenu utile',
    );
  }

  return {
    prediction: {
      probability30d: probability,
      confidence,
      suggestedActions: suggestedActions.slice(0, 3),
      factors,
    },
    msgCount,
    tasksDone,
  };
}

/**
 * Affinage optionnel via Claude Haiku 4.5. Si USE_MOCKS ou pas de clé API,
 * on saute (la version déterministe est déjà robuste). Tout échec → fallback.
 */
async function refineWithLLM(
  env: Env,
  lead: LeadRow,
  base: LeadPrediction,
  msgCount: number,
  tasksDone: number,
): Promise<LeadPrediction> {
  if (env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY) return base;

  const lastActivityDays = daysSince(lead.last_activity_at || lead.updated_at);
  const ageDays = daysSince(lead.created_at);
  const systemPrompt = `Tu es un analyste de conversion pour une PME québécoise. \
À partir des signaux d'un lead, estime sa probabilité de conversion dans les 30 prochains jours. \
Réponds UNIQUEMENT en JSON valide (sans markdown) au format : \
{"probability30d": <0-100>, "confidence": "low"|"medium"|"high", \
"suggestedActions": ["<action 1>","<action 2>","<action 3>"], \
"factors": [{"label":"<court>","impact":<entier +/->}]}. \
3 actions concrètes en français québécois informel. 3 facteurs max.`;

  const userPrompt = `Signaux du lead :
- Étape pipeline : ${lead.status}
- Source : ${lead.source || 'inconnue'}
- Valeur deal : ${Number(lead.deal_value || 0)} $
- Jours depuis dernière activité : ${lastActivityDays}
- Ancienneté du lead : ${ageDays} jours
- Messages échangés : ${msgCount}
- Tâches complétées : ${tasksDone}
- Estimation déterministe de référence : ${base.probability30d}% (${base.confidence})`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) return base;
    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return base;
    const parsed = JSON.parse(match[0]) as Partial<LeadPrediction>;
    const prob = Number(parsed.probability30d);
    if (!Number.isFinite(prob)) return base;
    return {
      probability30d: clamp(Math.round(prob), 0, 100),
      confidence:
        parsed.confidence === 'low' ||
        parsed.confidence === 'medium' ||
        parsed.confidence === 'high'
          ? parsed.confidence
          : base.confidence,
      suggestedActions:
        Array.isArray(parsed.suggestedActions) &&
        parsed.suggestedActions.length > 0
          ? parsed.suggestedActions.map(String).slice(0, 3)
          : base.suggestedActions,
      factors:
        Array.isArray(parsed.factors) && parsed.factors.length > 0
          ? parsed.factors
              .map((f) => ({
                label: String(f.label),
                impact: Math.round(Number(f.impact) || 0),
              }))
              .slice(0, 3)
          : base.factors,
    };
  } catch {
    return base;
  }
}

export async function handleGetLeadPredict(
  env: Env,
  _auth: { userId: string; role: string },
  leadId: string,
): Promise<Response> {
  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  const now = Math.floor(Date.now() / 1000);

  // Cache lookup (table créée best-effort si migration pas appliquée)
  const cached = await env.DB.prepare(
    `SELECT lead_id, payload, computed_at FROM lead_predictions WHERE lead_id = ?`,
  )
    .bind(leadId)
    .first<PredictCacheRow>()
    .catch(() => null);

  if (cached && now - cached.computed_at < CACHE_TTL_SECONDS) {
    try {
      const payload = JSON.parse(cached.payload) as LeadPrediction;
      return json({
        data: { ...payload, computed_at: cached.computed_at, cached: true },
      });
    } catch {
      /* cache corrompu — recompute */
    }
  }

  const lead = await env.DB.prepare(
    `SELECT id, score, status, source, deal_value, updated_at, created_at, last_activity_at, tags
     FROM leads WHERE id = ?`,
  )
    .bind(leadId)
    .first<LeadRow>();

  if (!lead) return json({ error: 'Lead introuvable' }, 404);

  const { prediction, msgCount, tasksDone } = await computeDeterministic(
    env,
    lead,
  );
  const refined = await refineWithLLM(
    env,
    lead,
    prediction,
    msgCount,
    tasksDone,
  );

  const payloadJson = JSON.stringify(refined);
  await env.DB.prepare(
    `INSERT INTO lead_predictions (lead_id, payload, computed_at)
     VALUES (?, ?, ?)
     ON CONFLICT(lead_id) DO UPDATE SET
       payload = excluded.payload,
       computed_at = excluded.computed_at`,
  )
    .bind(leadId, payloadJson, now)
    .run()
    .catch(() => null); // best-effort si table absente

  return json({ data: { ...refined, computed_at: now, cached: false } });
}
