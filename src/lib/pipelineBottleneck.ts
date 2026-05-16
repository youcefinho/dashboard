// ── pipelineBottleneck — Sprint 49 M2.2 ─────────────────────────────────────
// Détection de goulots d'étranglement dans le pipeline.
//
//   fetchBottlenecks(pipelineId?) → GET /api/pipeline/bottlenecks
//   detectBottlenecksLocal(leads, stages) → calcul client-side déterministe
//     (fallback offline — réutilise les leads déjà en mémoire dans Pipeline.tsx).
//
// Règle : pour chaque stage, temps moyen passé dans le stage vs médiane
// historique de tous les stages. Si avg > 1.5× médiane (et ≥ 3 leads dans le
// stage) → flag bottleneck.

import type { Lead } from './types';

export interface Bottleneck {
  stageId: string;
  stageName: string;
  /** Temps moyen (jours) des leads actuellement dans ce stage. */
  avgDays: number;
  /** Médiane de référence (jours) calculée sur tous les stages. */
  baselineDays: number;
  /** Ids des leads considérés bloqués (au-dessus de la baseline). */
  stuckLeadIds: string[];
}

interface StageLike {
  id: string;
  name: string;
  probability?: number;
}

function daysInStage(lead: Lead): number {
  const t = new Date(lead.updated_at || lead.created_at).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Calcul déterministe client-side. Exclut les stages terminaux
 * (probability 0 = perdu, 100 = gagné) du diagnostic de blocage.
 */
export function detectBottlenecksLocal(
  leads: Lead[],
  stages: StageLike[],
): Bottleneck[] {
  if (stages.length === 0 || leads.length === 0) return [];

  const firstStageId = stages[0]?.id;
  const stageAvg: { stage: StageLike; avg: number; leadDays: Array<{ id: string; days: number }> }[] = [];

  for (const stage of stages) {
    const isTerminal =
      stage.probability === 0 || stage.probability === 100;
    if (isTerminal) continue;
    const stageLeads = leads.filter(
      (l) => (l.stage_id || firstStageId) === stage.id,
    );
    if (stageLeads.length === 0) continue;
    const leadDays = stageLeads.map((l) => ({
      id: l.id,
      days: daysInStage(l),
    }));
    const avg =
      leadDays.reduce((s, d) => s + d.days, 0) / leadDays.length;
    stageAvg.push({ stage, avg, leadDays });
  }

  if (stageAvg.length === 0) return [];

  const baseline = median(stageAvg.map((s) => s.avg));
  if (baseline <= 0) return [];

  const bottlenecks: Bottleneck[] = [];
  for (const s of stageAvg) {
    if (s.leadDays.length < 3) continue;
    if (s.avg > baseline * 1.5) {
      const stuck = s.leadDays
        .filter((d) => d.days >= baseline)
        .map((d) => d.id);
      bottlenecks.push({
        stageId: s.stage.id,
        stageName: s.stage.name,
        avgDays: Math.round(s.avg),
        baselineDays: Math.round(baseline),
        stuckLeadIds: stuck,
      });
    }
  }
  return bottlenecks.sort((a, b) => b.avgDays - a.avgDays);
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
 * Fetch GET /api/pipeline/bottlenecks. Retourne null si backend KO pour que
 * l'appelant bascule sur detectBottlenecksLocal(leads, stages).
 */
export async function fetchBottlenecks(
  pipelineId?: string,
): Promise<Bottleneck[] | null> {
  if (typeof fetch === 'undefined') return null;
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const qs = pipelineId
    ? `?pipeline_id=${encodeURIComponent(pipelineId)}`
    : '';
  try {
    const res = await fetch(`/api/pipeline/bottlenecks${qs}`, { headers });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { bottlenecks?: Bottleneck[] } };
    if (!json.data || !Array.isArray(json.data.bottlenecks)) return null;
    return json.data.bottlenecks;
  } catch {
    return null;
  }
}
