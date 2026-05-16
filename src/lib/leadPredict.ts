// ── leadPredict — Sprint 49 M2.1 ────────────────────────────────────────────
// Prévision de conversion à 30 jours pour un lead.
//
// Stratégie :
//   fetchLeadPredict(leadId) → GET /api/leads/:id/score-predict
//     (cache D1 `lead_predictions`, recompute > 6h, Claude Haiku + fallback
//      heuristique déterministe côté serveur).
//   predictLeadLocal(lead)   → heuristique déterministe 100% client-side,
//     utilisée en mode dégradé (offline / worker indispo / SSR).
//
// API publique stable : si le backend tombe, l'UI bascule sur la version locale
// SANS changer de forme de données (LeadPrediction identique).

import type { Lead, LeadDetail } from './types';
import { explainScore } from './leadScoreExplain';

export type PredictConfidence = 'low' | 'medium' | 'high';

export interface PredictFactor {
  /** Libellé court FR québécois. */
  label: string;
  /** Impact en points de probabilité (peut être négatif). */
  impact: number;
}

export interface LeadPrediction {
  /** Probabilité de conversion sous 30 jours, 0..100. */
  probability30d: number;
  /** Niveau de confiance basé sur la quantité de signal disponible. */
  confidence: PredictConfidence;
  /** 3 actions concrètes suggérées (FR québécois informel). */
  suggestedActions: string[];
  /** Top facteurs (impact +/-) triés par |impact| décroissant. */
  factors: PredictFactor[];
  /** true si calcul local (mode dégradé). */
  local?: boolean;
  /** epoch (s) du calcul serveur si dispo. */
  computed_at?: number;
}

type LeadLike = Pick<
  Lead,
  | 'score'
  | 'status'
  | 'source'
  | 'deal_value'
  | 'updated_at'
  | 'created_at'
  | 'last_activity_at'
  | 'tags'
> &
  Partial<Pick<LeadDetail, 'activity'>> & {
    messagesCount?: number;
    tasksDoneCount?: number;
    stageProbability?: number;
  };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function daysSince(dateStr?: string | null): number {
  if (!dateStr) return 999;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return 999;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * Heuristique déterministe : combine le score explicable (Sprint 32/43),
 * la fraîcheur d'activité et l'étape pipeline en une probabilité 30j.
 * Pure (aucun appel réseau) — sûre offline / SSR.
 */
export function predictLeadLocal(lead: LeadLike): LeadPrediction {
  const signals = explainScore(lead);
  const sumContrib = signals.reduce((acc, s) => acc + s.contribution, 0);
  const baseScore = clamp(30 + sumContrib, 0, 100);

  const lastActivityDays = daysSince(lead.last_activity_at || lead.updated_at);
  const stageProb = lead.stageProbability ?? 30;

  // Probabilité = mélange pondéré score qualité (50%), étape pipeline (35%),
  // fraîcheur (15%). Décroissance exponentielle douce sur l'inactivité.
  const freshness = clamp(100 * Math.exp(-lastActivityDays / 14), 0, 100);
  let probability = Math.round(
    baseScore * 0.5 + stageProb * 0.35 + freshness * 0.15,
  );

  // Garde-fous métier déterministes
  if (lead.status === 'won' || lead.status === 'closed') probability = 100;
  if (lead.status === 'lost') probability = 0;
  probability = clamp(probability, 0, 100);

  // Confiance = quantité de signal exploitable (engagement + récence + valeur)
  const msgCount = lead.messagesCount ?? 0;
  const tasksDone = lead.tasksDoneCount ?? 0;
  const signalRichness =
    (msgCount > 0 ? 1 : 0) +
    (tasksDone > 0 ? 1 : 0) +
    (lastActivityDays <= 14 ? 1 : 0) +
    ((lead.deal_value || 0) > 0 ? 1 : 0);
  const confidence: PredictConfidence =
    signalRichness >= 3 ? 'high' : signalRichness >= 2 ? 'medium' : 'low';

  // Facteurs : on réutilise les signaux explicables, top 3 par |contribution|.
  const factors: PredictFactor[] = [...signals]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3)
    .map((s) => ({ label: s.label, impact: Math.round(s.contribution) }));

  // Actions suggérées déterministes selon le contexte
  const suggestedActions: string[] = [];
  if (probability >= 70) {
    suggestedActions.push('Proposer un appel découverte cette semaine');
    suggestedActions.push('Envoyer une proposition pendant que c\'est chaud');
    suggestedActions.push('Confirmer le budget et l\'échéancier');
  } else if (probability >= 40) {
    if (lastActivityDays >= 5) {
      suggestedActions.push(`Relancer (sans contact depuis ${lastActivityDays}j)`);
    } else {
      suggestedActions.push('Relancer dans 2 jours avec une valeur ajoutée');
    }
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
    probability30d: probability,
    confidence,
    suggestedActions: suggestedActions.slice(0, 3),
    factors,
    local: true,
  };
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem('intralys_token');
  } catch {
    return null;
  }
}

/**
 * Fetch GET /api/leads/:id/score-predict.
 * Retourne null si backend KO / offline pour que l'appelant bascule sur
 * predictLeadLocal(lead) en mode dégradé (mêmes types).
 */
export async function fetchLeadPredict(
  leadId: string,
): Promise<LeadPrediction | null> {
  if (!leadId || typeof fetch === 'undefined') return null;
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(
      `/api/leads/${encodeURIComponent(leadId)}/score-predict`,
      { headers },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: LeadPrediction };
    if (!json.data || typeof json.data.probability30d !== 'number') return null;
    return json.data;
  } catch {
    return null;
  }
}
