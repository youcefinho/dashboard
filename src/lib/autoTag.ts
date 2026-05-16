// ── Sprint 49 M3.1 — Auto-tagging conversations ──────────────────────
// Classifie une conversation via Claude Haiku (endpoint /api/ai/classify-
// conversation) avec fallback keyword-matching local FR québécois 100%
// offline-safe. SUGGESTION UNIQUEMENT : jamais d'auto-apply (Loi 25 — l'IA
// propose, l'utilisateur confirme). La logique commune (vocabulaire de tags,
// fallback regex) est mutualisée ici et réutilisée par autoTagLead.ts.

import { apiFetch } from './api';

/** Vocabulaire fermé de tags conversation (aligné worker). */
export const CONVERSATION_TAG_VOCAB = [
  'urgent',
  'question-prix',
  'demande-info',
  'plainte',
  'prêt-à-acheter',
  'lead-froid',
  'relance-nécessaire',
  'rendez-vous',
] as const;

export type ConversationTag = (typeof CONVERSATION_TAG_VOCAB)[number];

/** Libellés FR québécois affichés dans les chips de suggestion. */
export const CONVERSATION_TAG_LABELS: Record<ConversationTag, string> = {
  urgent: 'Urgent',
  'question-prix': 'Question prix',
  'demande-info': 'Demande info',
  plainte: 'Plainte',
  'prêt-à-acheter': 'Prêt à acheter',
  'lead-froid': 'Lead froid',
  'relance-nécessaire': 'Relance nécessaire',
  'rendez-vous': 'Rendez-vous',
};

// ── Fallback keyword-matching FR québécois (offline-safe) ────────────
// Réutilisé par autoTagLead.ts pour la portion "intent" du fallback lead.
const CONV_KEYWORD_RULES: Array<{ tag: ConversationTag; re: RegExp }> = [
  { tag: 'urgent', re: /\b(urgent|au plus vite|asap|aujourd'?hui|tout de suite|presse|rapidement|d[èe]s que possible)\b/i },
  { tag: 'question-prix', re: /\b(prix|co[ûu]te?|tarif|combien|budget|devis|soumission|estim[ée]|cher|paiement|facture)\b/i },
  { tag: 'demande-info', re: /\b(information|renseignement|en savoir plus|d[ée]tails|comment|est-ce que|pourriez-vous|j'?aimerais savoir)\b/i },
  { tag: 'plainte', re: /\b(d[ée][çc]u|insatisfait|probl[èe]me|plainte|remboursement|inacceptable|m[ée]content|pas content|arnaque)\b/i },
  { tag: 'prêt-à-acheter', re: /\b(je veux|on signe|pr[êe]t[e]? [àa] (?:commencer|acheter|signer)|allons-y|c'?est bon pour moi|je confirme|on y va)\b/i },
  { tag: 'lead-froid', re: /\b(pas int[ée]ress[ée]|plus tard|peut-[êe]tre|on verra|pas pour l'?instant|trop t[ôo]t|je vous recontacte)\b/i },
  { tag: 'relance-nécessaire', re: /\b(toujours pas|j'?attends|aucune nouvelle|relance|suivi|vous m'?aviez dit|on devait)\b/i },
  { tag: 'rendez-vous', re: /\b(rendez-vous|rencontre|appel|disponib|c[ée]dule|agenda|prendre un moment|planifier)\b/i },
];

/** Fallback déterministe : matche le texte aux règles regex FR québécois. */
export function keywordTagsConversation(text: string): ConversationTag[] {
  const out: ConversationTag[] = [];
  for (const { tag, re } of CONV_KEYWORD_RULES) {
    if (re.test(text) && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 3);
}

export interface ConversationClassification {
  tags: ConversationTag[];
  confidence: number;
  /** true si la classification provient du fallback local (API indisponible). */
  fromFallback: boolean;
}

/**
 * Classifie une conversation. Tente l'endpoint AI ; bascule sur le
 * keyword-matching local si l'API échoue ou ne retourne rien.
 * @param conversationId id de la conversation (chargé serveur si lastMessages absent)
 * @param lastMessages   derniers messages bruts (texte) — optionnel mais recommandé
 */
export async function classifyConversation(
  conversationId: string,
  lastMessages?: string[],
): Promise<ConversationClassification> {
  const localText = (lastMessages || []).join('\n');
  try {
    const res = await apiFetch<{ tags: string[]; confidence: number }>(
      '/ai/classify-conversation',
      {
        method: 'POST',
        body: JSON.stringify({ conversationId, lastMessages: lastMessages?.slice(-12) }),
      },
    );
    if (res.data && Array.isArray(res.data.tags) && res.data.tags.length > 0) {
      const tags = res.data.tags.filter(
        (t): t is ConversationTag => (CONVERSATION_TAG_VOCAB as readonly string[]).includes(t),
      );
      if (tags.length > 0) {
        return { tags, confidence: res.data.confidence ?? 0.5, fromFallback: false };
      }
    }
  } catch {
    /* bascule fallback */
  }
  const tags = keywordTagsConversation(localText);
  return { tags, confidence: tags.length > 0 ? 0.4 : 0, fromFallback: true };
}
