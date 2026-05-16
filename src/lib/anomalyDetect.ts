// ── anomalyDetect — Sprint 49 M2.3 ──────────────────────────────────────────
// Détection d'anomalies d'activité : chute vs baseline rolling 4 semaines.
//
//   fetchAnomalies()                 → GET /api/analytics/anomalies
//   detectLeadAnomalyLocal(leads)    → fallback déterministe client-side
//     (basé sur les leads déjà chargés dans le Dashboard — seul le metric
//      "nouveaux leads" est calculable hors-ligne, suffisant pour l'insight).

import type { Lead } from './types';

export type AnomalySeverity = 'info' | 'warning' | 'critical';

export interface Anomaly {
  /** Identifiant stable : leads_created | messages_sent | tasks_done | appointments_booked */
  metric: string;
  /** Libellé FR québécois. */
  label: string;
  /** Valeur de la semaine courante. */
  current: number;
  /** Moyenne hebdo des 4 semaines précédentes. */
  baseline: number;
  /** Variation en % (négatif = chute). */
  deltaPct: number;
  severity: AnomalySeverity;
}

const WEEK_MS = 7 * 86_400_000;

/**
 * Fallback client-side : seul "nouveaux leads" est calculable depuis la liste
 * en mémoire (les messages/tâches/RDV ne sont pas tous chargés côté Dashboard).
 * Renvoie [] si pas assez d'historique (évite faux positifs au démarrage).
 */
export function detectLeadAnomalyLocal(leads: Lead[]): Anomaly[] {
  if (leads.length === 0) return [];
  const now = Date.now();

  const inWindow = (l: Lead, fromMs: number, toMs: number): boolean => {
    const t = new Date(l.created_at).getTime();
    return Number.isFinite(t) && t >= fromMs && t < toMs;
  };

  const current = leads.filter((l) =>
    inWindow(l, now - WEEK_MS, now),
  ).length;
  const prior4 = leads.filter((l) =>
    inWindow(l, now - 5 * WEEK_MS, now - WEEK_MS),
  ).length;
  const baseline = prior4 / 4;

  if (baseline < 3) return [];
  if (current >= baseline * 0.6) return [];

  const deltaPct = Math.round(((current - baseline) / baseline) * 100);
  const ratio = current / baseline;
  const severity: AnomalySeverity =
    ratio < 0.3 ? 'critical' : ratio < 0.5 ? 'warning' : 'info';

  return [
    {
      metric: 'leads_created',
      label: 'nouveaux leads',
      current,
      baseline: Math.round(baseline),
      deltaPct,
      severity,
    },
  ];
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
 * Fetch GET /api/analytics/anomalies. Retourne null si backend KO pour que
 * l'appelant bascule sur detectLeadAnomalyLocal(leads).
 */
export async function fetchAnomalies(): Promise<Anomaly[] | null> {
  if (typeof fetch === 'undefined') return null;
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch('/api/analytics/anomalies', { headers });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { anomalies?: Anomaly[] } };
    if (!json.data || !Array.isArray(json.data.anomalies)) return null;
    return json.data.anomalies;
  } catch {
    return null;
  }
}
