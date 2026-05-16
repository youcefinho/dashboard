// ── leadScoreExplain — Sprint 32 vague 32-2B / Sprint 43 M3.4 backend ────────
// Décompose le score d'un lead en 4-6 signaux explicables.
//
// Sprint 43 M3.4 : bascule GET /api/leads/:id/score (cache D1 1h serveur).
// Heuristique locale conservée en fallback (offline / dev / SSR).
//
// API publique 100% back-compat :
//   explainScore(lead): ScoreSignal[]               (sync — heuristique locale)
//   fetchExplainScore(leadId): Promise<{score, signals, computed_at}>  (nouveau — backend)

import type { Lead, LeadDetail } from './types';

export interface ScoreSignal {
  /** Identifiant stable pour key React (`activity`, `engagement`, …). */
  id: string;
  /** Libellé court affiché à l'utilisateur. */
  label: string;
  /** Valeur brute mesurée (ex: nb messages, nb jours, montant deal). */
  value: number | string;
  /** Contribution en points au score total (peut être négative). */
  contribution: number;
  /**
   * Poids relatif (0..1) — utilisé pour la longueur de la barre visuelle.
   * Indépendant du signe de `contribution`.
   */
  weight: number;
  /** Détail textuel court (tooltip / sous-ligne). */
  detail?: string;
}

type LeadLike = Pick<
  Lead,
  | 'score'
  | 'status'
  | 'source'
  | 'deal_value'
  | 'updated_at'
  | 'last_activity_at'
  | 'tags'
> &
  Partial<Pick<LeadDetail, 'activity'>> & {
    /** Compteurs optionnels passés par l'appelant si dispo */
    messagesCount?: number;
    tasksDoneCount?: number;
    stageProbability?: number;
  };

// ── Coefficients sources (mock) ─────────────────────────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────────
function daysSince(dateStr?: string | null): number {
  if (!dateStr) return 999;
  const d = new Date(dateStr).getTime();
  if (!Number.isFinite(d)) return 999;
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ── API ─────────────────────────────────────────────────────────────────

/**
 * Retourne 4-6 signaux explicables qui décomposent (mock) le score du lead.
 * Total `contribution` ≈ score affiché (à ±5 points près — heuristique).
 */
export function explainScore(lead: LeadLike): ScoreSignal[] {
  const signals: ScoreSignal[] = [];

  // 1. ── Activity récente ──
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
    activityDetail = `${lastActivityDays}j d\'inactivité — refroidi`;
  }
  signals.push({
    id: 'activity',
    label: 'Activité récente',
    value: `${lastActivityDays}j`,
    contribution: activityContribution,
    weight: clamp(1 - lastActivityDays / 30, 0.05, 1),
    detail: activityDetail,
  });

  // 2. ── Engagement (messages + tasks complétées) ──
  const msgCount = lead.messagesCount ?? 0;
  const tasksDone = lead.tasksDoneCount ?? 0;
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

  // 3. ── Stage avancé (probabilité pipeline) ──
  const stageProb = lead.stageProbability ?? statusToProbability(lead.status);
  const stageContribution = Math.round((stageProb - 30) * 0.4); // -12..+28 sur 0..100
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

  // 4. ── Valeur du deal ──
  const dealValue = lead.deal_value || 0;
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

  // 5. ── Source du lead ──
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

  // 6. ── Tags chauds ──
  const tags = (lead.tags || []).map((t) => t.toLowerCase());
  const hotKeywords = ['hot', 'chaud', 'qualified', 'qualifié', 'priority', 'vip'];
  const matchedTags = tags.filter((t) => hotKeywords.some((kw) => t.includes(kw)));
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

  return signals;
}

// ── Mapping legacy status → probability (fallback si pas de stage backend) ─
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

// ── Sprint 43 M3.4 : fetch backend (cache D1 1h) ────────────────────────────

export interface FetchedLeadScore {
  score: number;
  signals: ScoreSignal[];
  computed_at: number;
  cached: boolean;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem('intralys_token'); } catch { return null; }
}

/**
 * Fetch GET /api/leads/:id/score — retourne le breakdown serveur (cache 1h D1).
 * Si backend KO / offline → retourne null pour que le caller bascule sur
 * explainScore(lead) en mode dégradé.
 */
export async function fetchExplainScore(leadId: string): Promise<FetchedLeadScore | null> {
  if (!leadId || typeof fetch === 'undefined') return null;
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/score`, { headers });
    if (!res.ok) return null;
    const json = await res.json() as { data?: FetchedLeadScore };
    if (!json.data || !Array.isArray(json.data.signals)) return null;
    return json.data;
  } catch {
    return null;
  }
}
