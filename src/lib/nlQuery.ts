// ── Sprint 49 M3.4 — AI Command Palette : recherche naturelle ────────
// Détecte les requêtes en langage naturel ("trouve mes leads chauds…"),
// les envoie à /api/ai/nl-query pour extraction de filtres structurés, puis
// applique ces filtres via URL params (réutilise le pattern Sprint 31
// CmdPalette URL params consommés par Leads/Pipeline/Tasks).
// Fallback : extraction par regex locale 100% offline-safe si l'API est down.

import { apiFetch } from './api';

/** Filtres structurés extraits d'une requête NL. Tous optionnels. */
export interface NlFilters {
  status?: string;
  source?: string;
  scoreMin?: number;
  stage?: string;
  dormantDays?: number;
  lastContactDays?: number;
  tag?: string;
  /** Page cible : 'leads' (défaut) | 'pipeline' | 'tasks'. */
  target?: 'leads' | 'pipeline' | 'tasks';
}

export interface NlQueryResult {
  filters: NlFilters;
  explanation: string;
  fromFallback: boolean;
}

// ── Détection du mode "recherche naturelle" ─────────────────────────
// Triggers : la query commence par un verbe d'intention de recherche.
// On NE déclenche PAS sur les intents existants (create/navigate/move) :
// ceux-ci sont gérés en amont par parseIntent() dans CommandPalette.
const NL_TRIGGER = /^(?:trouve|trouver|montre|montrer|affiche|cherche|liste|leads?\s+qui|deals?\s+qui|find|show\s+me|show|search|list)\b/i;

export function isNaturalLanguageQuery(query: string): boolean {
  const q = query.trim();
  if (q.length < 6) return false;
  return NL_TRIGGER.test(q);
}

// ── Fallback : extraction regex locale FR québécois / EN ────────────
export function localExtractFilters(query: string): NlFilters {
  const q = query.toLowerCase();
  const f: NlFilters = {};

  // Cible
  if (/\b(pipeline|deals?|n[ée]gociation|kanban)\b/.test(q)) f.target = 'pipeline';
  else if (/\b(t[âa]ches?|tasks?|todo|[àa] faire)\b/.test(q)) f.target = 'tasks';
  else f.target = 'leads';

  // Statut
  if (/\b(perdu|perdus|lost)\b/.test(q)) f.status = 'lost';
  else if (/\b(gagn[ée]s?|won|sign[ée]s?)\b/.test(q)) f.status = 'won';
  else if (/\bqualifi[ée]s?\b/.test(q)) f.status = 'qualified';
  else if (/\bcontact[ée]s?\b/.test(q) && !/pas\s+contact/.test(q)) f.status = 'contacted';
  else if (/\bnouveaux?\b|\bnew\b/.test(q)) f.status = 'new';

  // Source
  if (/\b(facebook|meta|instagram)\b/.test(q)) f.source = 'meta';
  else if (/\bgoogle\b/.test(q)) f.source = 'google';
  else if (/\br[ée]f[ée]rence|referral\b/.test(q)) f.source = 'referral';
  else if (/\bsite web|website\b/.test(q)) f.source = 'website';

  // Score / chaud
  if (/\b(chauds?|hot|prioritaires?|prometteurs?)\b/.test(q)) f.scoreMin = 70;
  const scoreM = q.match(/score\s*(?:de\s*)?(?:>|>=|sup[ée]rieur[e]?\s*[àa]|min|au moins)?\s*(\d{1,3})/);
  if (scoreM) f.scoreMin = Math.min(100, parseInt(scoreM[1]!, 10));

  // Dernier contact / inactivité
  if (/cette semaine|7\s*jours|une semaine/.test(q) && /pas\s+contact|sans\s+contact|aucun\s+contact|non\s+contact/.test(q)) {
    f.lastContactDays = 7;
  } else {
    const lcM = q.match(/pas\s+contact[ée]s?\s+depuis\s+(\d+)\s*(jour|semaine)/);
    if (lcM) f.lastContactDays = parseInt(lcM[1]!, 10) * (lcM[2] === 'semaine' ? 7 : 1);
  }

  // Dormant / bloqué
  if (/\b(bloqu[ée]s?|stagne|dormants?|coinc[ée]s?|inactifs?)\b/.test(q)) {
    const dM = q.match(/depuis\s+(\d+)\s*(jour|semaine)/);
    f.dormantDays = dM ? parseInt(dM[1]!, 10) * (dM[2] === 'semaine' ? 7 : 1) : 5;
  }

  // Étape pipeline mentionnée explicitement
  if (/n[ée]gociation/.test(q)) f.stage = 'negotiation';
  else if (/proposition|devis/.test(q)) f.stage = 'proposal';

  return f;
}

/**
 * Parse une requête NL : tente l'endpoint AI, fallback regex local.
 * Garantit toujours un résultat exploitable (offline-safe).
 */
export async function parseNlQuery(query: string, locale = 'fr-CA'): Promise<NlQueryResult> {
  try {
    const res = await apiFetch<{ filters: NlFilters; explanation: string }>('/ai/nl-query', {
      method: 'POST',
      body: JSON.stringify({ query, locale }),
    });
    if (res.data && res.data.filters && Object.keys(res.data.filters).length > 0) {
      return {
        filters: res.data.filters,
        explanation: res.data.explanation || `Recherche : « ${query} »`,
        fromFallback: false,
      };
    }
  } catch {
    /* bascule fallback */
  }
  const filters = localExtractFilters(query);
  return {
    filters,
    explanation: Object.keys(filters).filter(k => k !== 'target').length > 0
      ? `Filtres détectés localement pour « ${query} »`
      : `Aucun filtre clair pour « ${query} » — affichage complet`,
    fromFallback: true,
  };
}

/**
 * Convertit des NlFilters en chemin + query string consommable par les
 * pages cible (réutilise les params Sprint 31 : status/source/scoreMin/
 * stage/dormantDays + lastContactDays/tag nouveaux).
 */
export function nlFiltersToPath(filters: NlFilters): string {
  const target = filters.target || 'leads';
  const base = target === 'pipeline' ? '/pipeline' : target === 'tasks' ? '/tasks' : '/leads';
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.source) params.set('source', filters.source);
  if (filters.scoreMin != null) params.set('scoreMin', String(filters.scoreMin));
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.dormantDays != null) params.set('dormantDays', String(filters.dormantDays));
  if (filters.lastContactDays != null) params.set('lastContactDays', String(filters.lastContactDays));
  if (filters.tag) params.set('tag', filters.tag);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
