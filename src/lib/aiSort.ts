// ── AI Smart Sort heuristics — Sprint 31 vague 31-2B ──────────────
// Heuristiques de scoring locales (pas de vraie AI, formules déterministes).
// Inspiration : Salesforce Einstein Lead Scoring, HubSpot Smart Sort.
//
// Trois axes :
//   1. Contact priority    → qui rappeler aujourd'hui ?
//   2. Conversion likelihood → qui va signer bientôt ?
//   3. Dormant value       → quels gros deals dorment trop longtemps ?
//
// Toutes les fonctions retournent un *nouveau* tableau (immutable).

import type { Lead } from './types';
// Sprint 49 M3.3 — win_probability_30d réutilise leadPredict (Sprint 49 M2).
// predictLeadLocal est une fonction pure (aucun réseau) → safe SSR/offline.
import { predictLeadLocal } from './leadPredict';

// Liste des modes supportés par le UI (toolbar + cmd palette).
// Sprint 49 M3.3 — étendu de 3 → 6 heuristiques (3 premières INCHANGÉES,
// API publique préservée : signatures scoreXxx/aiSortByXxx intactes).
export const AI_SORT_MODES = [
  'contact_priority',
  'conversion_likelihood',
  'dormant_value',
  // ── Sprint 49 M3.3 — 3 nouvelles heuristiques (additive) ──
  'revenue_potential',
  'engagement_decay',
  'win_probability_30d',
] as const;
export type AiSortMode = (typeof AI_SORT_MODES)[number];

export const AI_SORT_LABELS: Record<AiSortMode, string> = {
  contact_priority: 'Priorité de contact',
  conversion_likelihood: 'Plus susceptibles de convertir',
  dormant_value: 'Dormants à réveiller',
  revenue_potential: 'Potentiel de revenu',
  engagement_decay: 'Engagement qui s\'effrite',
  win_probability_30d: 'Probabilité de signer (30j)',
};

export const AI_SORT_DESCRIPTIONS: Record<AiSortMode, string> = {
  contact_priority: 'Combine score, dernière activité et valeur du deal pour révéler qui rappeler en premier aujourd\'hui.',
  conversion_likelihood: 'Met en avant les leads chauds, actifs récemment et avancés dans le pipeline.',
  dormant_value: 'Identifie les leads à forte valeur qui n\'ont eu aucune activité depuis 14+ jours.',
  revenue_potential: 'Montant estimé du deal pondéré par la probabilité de conversion — concentre l\'effort là où l\'argent est.',
  engagement_decay: 'Temps écoulé depuis la dernière interaction, pondéré par l\'historique d\'engagement — rattrape ceux qui décrochent.',
  win_probability_30d: 'Probabilité de signature sous 30 jours (modèle prédictif M2) — priorise les deals les plus mûrs.',
};

// ── Helpers internes ──────────────────────────────────────────────

const DAY_MS = 1000 * 60 * 60 * 24;

/** Retourne le nombre de jours écoulés depuis dateStr (ou Infinity si invalide). */
function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return Infinity;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, (Date.now() - t) / DAY_MS);
}

/** Bonus selon le stade de pipeline (qualified > contacted > new). */
function stageMomentum(status: string): number {
  switch (status) {
    case 'won': return 40;       // Déjà gagné — on rétrograde plus bas dans conversion
    case 'qualified': return 30;
    case 'contacted': return 18;
    case 'new': return 6;
    case 'lost': return -20;
    default: return 0;
  }
}

/** Normalise une valeur de deal en bonus (0–25 points). */
function dealValueBonus(value: number): number {
  if (!value || value <= 0) return 0;
  // 25k$ ≈ 12 pts, 100k$ ≈ 20 pts, 500k$+ ≈ 25 pts
  return Math.min(25, Math.log10(value + 1) * 6);
}

// ── 1. Priorité de contact ────────────────────────────────────────
// Formule : score (0–100) × 0.6 + recency_penalty (plus on a négligé, plus
// ça remonte) + dealValueBonus. Idée : si un hot lead n'a pas été contacté
// depuis 5j, il devrait remonter au-dessus d'un froid contacté hier.

export function aiSortByContactPriority(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => scoreContactPriority(b) - scoreContactPriority(a));
}

export function scoreContactPriority(lead: Lead): number {
  const baseScore = (lead.score || 0) * 0.6;
  const daysIdle = daysSince(lead.last_activity_at || lead.updated_at);
  // Pénalité linéaire jusqu'à 14j, clamp à 30 pts max
  const recency = Math.min(30, daysIdle * 2.1);
  const value = dealValueBonus(lead.deal_value || 0);
  // Pénalise les statuts terminés
  const stagePenalty = lead.status === 'won' || lead.status === 'lost' ? -40 : 0;
  return baseScore + recency + value + stagePenalty;
}

// ── 2. Conversion likelihood ──────────────────────────────────────
// Formule : score × 0.5 + stageMomentum + activity_freshness_bonus +
// dealValueBonus × 0.4. Inverse de la priorité contact : on veut les
// leads qui *bougent* et qui sont *proches du oui*.

export function aiSortByConversionLikelihood(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => scoreConversionLikelihood(b) - scoreConversionLikelihood(a));
}

export function scoreConversionLikelihood(lead: Lead): number {
  if (lead.status === 'lost') return -100;
  if (lead.status === 'won') return -50; // Déjà gagné, on le push plus bas
  const baseScore = (lead.score || 0) * 0.5;
  const stage = stageMomentum(lead.status);
  const daysIdle = daysSince(lead.last_activity_at || lead.updated_at);
  // Bonus si activité récente (≤ 3j = 20 pts, décroît jusqu'à 0 à 14j)
  const freshness = Math.max(0, 20 - daysIdle * 1.4);
  const value = dealValueBonus(lead.deal_value || 0) * 0.4;
  return baseScore + stage + freshness + value;
}

// ── 3. Dormants à réveiller ───────────────────────────────────────
// Formule : on ne retient que les leads avec deal_value > 0 ou score ≥ 50
// ET dormants depuis ≥ 14j. Score = deal_value_normalized + days_idle ×
// score_factor. Statuts won/lost exclus (renvoyés en queue avec -∞).

export function aiSortByDormantValue(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => scoreDormantValue(b) - scoreDormantValue(a));
}

export function scoreDormantValue(lead: Lead): number {
  if (lead.status === 'won' || lead.status === 'lost') return -Infinity;
  const daysIdle = daysSince(lead.last_activity_at || lead.updated_at);
  // Pas dormant → out
  if (daysIdle < 14) return -Infinity;
  const valuePts = dealValueBonus(lead.deal_value || 0) * 2;
  const scorePts = (lead.score || 0) * 0.4;
  // Plus c'est dormant, plus ça remonte (clamp à 60j pour éviter spam vieux leads)
  const idleBonus = Math.min(40, (daysIdle - 14) * 1.2);
  // Filtre : exclut si pas de valeur ET pas de score
  if (valuePts < 6 && scorePts < 20) return -Infinity;
  return valuePts + scorePts + idleBonus;
}

// ── 4. Potentiel de revenu (Sprint 49 M3.3) ──────────────────────
// Formule : deal_value × probabilité_de_conversion_normalisée. La proba est
// dérivée du score (0–100) et d'un facteur d'étape. Idée : un deal 80k$ à
// 60% > un deal 200k$ à 5%. Won/lost exclus (déjà résolus).

export function aiSortByRevenuePotential(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => scoreRevenuePotential(b) - scoreRevenuePotential(a));
}

export function scoreRevenuePotential(lead: Lead): number {
  if (lead.status === 'won' || lead.status === 'lost') return -Infinity;
  const value = lead.deal_value || 0;
  if (value <= 0) return 0;
  // Probabilité ≈ score (0–1) ajusté par le momentum d'étape (centré 0.5).
  const scoreProb = (lead.score || 0) / 100;
  const stageAdj = (stageMomentum(lead.status) + 20) / 50; // ~0.4 (new) → ~1.0 (qualified)
  const prob = Math.max(0.02, Math.min(1, scoreProb * 0.7 + stageAdj * 0.3));
  // Espérance de revenu pondérée — log-compressée pour éviter qu'un seul
  // méga-deal écrase tout le tri.
  return Math.log10(value * prob + 1) * 100;
}

// ── 5. Engagement qui s'effrite (Sprint 49 M3.3) ──────────────────
// Formule : temps depuis dernière interaction pondéré par l'historique
// d'engagement (score = proxy d'engagement passé). Plus un lead était
// engagé ET plus il se tait → plus il remonte (risque de perte).

export function aiSortByEngagementDecay(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => scoreEngagementDecay(b) - scoreEngagementDecay(a));
}

export function scoreEngagementDecay(lead: Lead): number {
  if (lead.status === 'won' || lead.status === 'lost') return -Infinity;
  const daysIdle = daysSince(lead.last_activity_at || lead.updated_at);
  if (daysIdle < 2) return -Infinity; // encore frais → pas de décrochage
  // Engagement passé : score + bonus si avancé dans le pipeline.
  const pastEngagement = (lead.score || 0) * 0.7 + Math.max(0, stageMomentum(lead.status));
  // Decay : croît avec l'inactivité (clamp 45j) mais pénalise si l'engagement
  // passé était nul (un froid silencieux n'est pas une perte).
  const decay = Math.min(45, daysIdle) * 1.5;
  return (pastEngagement * 0.6) + (decay * (pastEngagement > 25 ? 1.4 : 0.4));
}

// ── 6. Probabilité de signer 30j (Sprint 49 M3.3) ─────────────────
// Réutilise leadPredict (Sprint 49 M2) — predictLeadLocal est pur (offline).
// Graceful : si le calcul échoue, fallback sur conversion_likelihood.

export function aiSortByWinProbability30d(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => scoreWinProbability30d(b) - scoreWinProbability30d(a));
}

export function scoreWinProbability30d(lead: Lead): number {
  try {
    const pred = predictLeadLocal(lead);
    if (pred && Number.isFinite(pred.probability30d)) return pred.probability30d;
  } catch { /* fallback ci-dessous */ }
  // Fallback heuristique si leadPredict indisponible/erreur
  return scoreConversionLikelihood(lead);
}

// ── Dispatcher unique ─────────────────────────────────────────────
// Permet à la UI (Leads.tsx, Pipeline.tsx, CmdPalette) d'appeler une seule
// fonction avec la clé du mode pour appliquer le tri correspondant.

export function applyAiSort(leads: Lead[], mode: AiSortMode | null): Lead[] {
  switch (mode) {
    case 'contact_priority': return aiSortByContactPriority(leads);
    case 'conversion_likelihood': return aiSortByConversionLikelihood(leads);
    case 'dormant_value': {
      // Dormants à réveiller : on filtre les leads non-dormants (score = -Inf)
      const scored = leads
        .map(l => ({ lead: l, score: scoreDormantValue(l) }))
        .filter(x => Number.isFinite(x.score))
        .sort((a, b) => b.score - a.score);
      return scored.map(x => x.lead);
    }
    // ── Sprint 49 M3.3 — 3 nouvelles heuristiques ──
    case 'revenue_potential': {
      const scored = leads
        .map(l => ({ lead: l, score: scoreRevenuePotential(l) }))
        .filter(x => Number.isFinite(x.score))
        .sort((a, b) => b.score - a.score);
      return scored.map(x => x.lead);
    }
    case 'engagement_decay': {
      const scored = leads
        .map(l => ({ lead: l, score: scoreEngagementDecay(l) }))
        .filter(x => Number.isFinite(x.score))
        .sort((a, b) => b.score - a.score);
      return scored.map(x => x.lead);
    }
    case 'win_probability_30d': return aiSortByWinProbability30d(leads);
    default: return leads;
  }
}
