// ── Sprint 49 M3.2 — Auto-tagging leads ──────────────────────────────
// Suggère des tags lead (industrie / intent / budget-tier / source-quality)
// via Claude Haiku (endpoint /api/ai/classify-lead) avec fallback de règles
// déterministes 100% offline-safe (source → tag, montant → budget-tier).
// SUGGESTION UNIQUEMENT : l'utilisateur accepte/rejette chaque tag (Loi 25).
// Réutilise le pattern apiFetch + fallback de autoTag.ts (M3.1).

import { apiFetch } from './api';
import type { Lead } from './types';

/** Mapping déterministe source → tag de qualité de source (fallback). */
const SOURCE_TAG_MAP: Record<string, string> = {
  meta: 'source-social',
  facebook: 'source-social',
  instagram: 'source-social',
  google: 'source-paid',
  google_ads: 'source-paid',
  referral: 'source-référence',
  website: 'source-web',
  direct: 'source-web',
  manual: 'source-manuel',
};

/** Règles déterministes (offline-safe) : source / budget-tier / intent. */
export function deterministicLeadTags(lead: Partial<Lead>): string[] {
  const out: string[] = [];
  const src = String(lead.source || '').toLowerCase();
  if (SOURCE_TAG_MAP[src]) out.push(SOURCE_TAG_MAP[src]!);

  const val = Number(lead.deal_value) || 0;
  if (val >= 50000) out.push('budget-élevé');
  else if (val >= 10000) out.push('budget-moyen');
  else if (val > 0) out.push('budget-modeste');

  const score = Number(lead.score) || 0;
  if (score >= 70) out.push('intent-fort');
  else if (score > 0 && score < 40) out.push('intent-faible');

  return out.slice(0, 4);
}

export interface LeadClassification {
  suggestedTags: string[];
  confidence: number;
  fromFallback: boolean;
}

/**
 * Suggère des tags pour un lead. Tente l'endpoint AI ; bascule sur les
 * règles déterministes si l'API échoue. Filtre les tags déjà présents
 * sur le lead pour ne proposer que du neuf.
 */
export async function classifyLead(
  leadId: string,
  leadData: Partial<Lead>,
): Promise<LeadClassification> {
  const existing = new Set((leadData.tags || []).map(t => t.toLowerCase()));
  const dedupe = (tags: string[]) =>
    tags
      .map(t => t.toLowerCase().trim().replace(/\s+/g, '-'))
      .filter((t, i, a) => t.length > 1 && !existing.has(t) && a.indexOf(t) === i)
      .slice(0, 4);

  try {
    const res = await apiFetch<{ suggestedTags: string[]; confidence: number }>(
      '/ai/classify-lead',
      {
        method: 'POST',
        body: JSON.stringify({ leadId, leadData }),
      },
    );
    if (res.data && Array.isArray(res.data.suggestedTags) && res.data.suggestedTags.length > 0) {
      const tags = dedupe(res.data.suggestedTags);
      if (tags.length > 0) {
        return { suggestedTags: tags, confidence: res.data.confidence ?? 0.5, fromFallback: false };
      }
    }
  } catch {
    /* bascule fallback */
  }
  const tags = dedupe(deterministicLeadTags(leadData));
  return { suggestedTags: tags, confidence: tags.length > 0 ? 0.4 : 0, fromFallback: true };
}
