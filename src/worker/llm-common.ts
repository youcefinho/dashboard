// ── llm-common.ts — SPRINT 12 « IA contenu » — NEUF (gelé Phase A) ──────────
//
// Helper Claude FACTORISÉ pour le NOUVEAU module Sprint 12 (ai-content.ts).
// ⚠ NE REFACTORE PAS les 7 appelants existants (ai.ts:callLLM, social-ai.ts,
//   aiDrafts.ts, ai-chat.ts, reviews.ts, …) — rétro-compat DURE : ils gardent
//   leur helper LOCAL. Ce module est consommé UNIQUEMENT par ai-content.ts.
//
// Imports worker RELATIFS, jamais `@/`. Pattern Claude commun :
//   model 'claude-haiku-4-5', anthropic-version '2023-06-01' (calque ai.ts:37).
// Flag IA : calque EXACT ai.ts:15 isAiMockMode (USE_MOCKS || !ANTHROPIC_API_KEY).
// Fallback mock DÉTERMINISTE — JAMAIS de throw / 500 brut.

import type { Env } from './types';
import { fetchWithTimeout } from './lib/fetch-timeout';

/**
 * Source de vérité du mode mock IA pour le module Sprint 12 (ai-content.ts).
 * Calque EXACT de la condition `isAiMockMode` (ai.ts:15) — NE PAS inventer de
 * nouveau flag. true ⇒ contenu mock déterministe (USE_MOCKS forcé OU aucune clé
 * Anthropic configurée). E4/E6 inactifs : sans clé, on ne fait AUCUN appel réseau.
 */
export function isAiContentMockMode(env: Env): boolean {
  return env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY;
}

export interface CallClaudeOpts {
  /** Plafond de tokens de sortie. Défaut 1024 (calque ai.ts callLLM). */
  maxTokens?: number;
}

/**
 * Appel Claude commun (claude-haiku-4-5). Best-effort : en mode mock OU sur
 * toute erreur réseau/API, renvoie un mock DÉTERMINISTE — ne THROW JAMAIS, ne
 * remonte JAMAIS de 500 brut (le handler reste responsable de json({data})).
 */
export async function callClaude(
  env: Env,
  system: string,
  user: string,
  opts?: CallClaudeOpts,
): Promise<string> {
  if (isAiContentMockMode(env)) {
    // Petite latence simulée (déclenche le loading state côté front), calque ai.ts.
    await new Promise((r) => setTimeout(r, 400));
    return mockContent(system, user);
  }

  try {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: opts?.maxTokens ?? 1024,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text: string }> };
    const text = data.content?.[0]?.text || '';
    // Filet : réponse vide ⇒ mock déterministe (jamais de contenu vide remonté).
    return text || mockContent(system, user);
  } catch (err) {
    console.error('callClaude: LLM error (fallback mock):', err);
    return mockContent(system, user);
  }
}

/**
 * Mock DÉTERMINISTE (jamais aléatoire) — calibré par indices du system prompt.
 * Réutilisé en mode mock ET en fallback d'erreur. Voix québécoise sobre.
 */
function mockContent(system: string, user: string): string {
  const s = system.toLowerCase();
  const u = user.toLowerCase();

  if (s.includes('sms') || u.includes('sms')) {
    return 'Bonjour! Petit rappel concernant notre échange. Disponible pour répondre à vos questions. Bonne journée!';
  }
  if (s.includes('social') || s.includes('réseau') || u.includes('social')) {
    return 'Nouveau chez nous! Découvrez ce qui fait la différence pour notre clientèle. Contactez-nous dès aujourd\'hui. #Québec #Local #Service';
  }
  if (s.includes('blog') || u.includes('blog')) {
    return '# Titre de l\'article\n\nIntroduction claire qui pose le sujet et son intérêt pour le lecteur.\n\n## Premier point\n\nDéveloppement structuré et concret.\n\n## Deuxième point\n\nExemple appliqué au contexte de la PME.\n\n## Conclusion\n\nRésumé et appel à l\'action.';
  }
  if (s.includes('landing') || s.includes('page d\'atterrissage') || u.includes('landing')) {
    return 'Titre principal percutant\n\nSous-titre qui clarifie la promesse de valeur.\n\n- Bénéfice 1\n- Bénéfice 2\n- Bénéfice 3\n\n[Bouton : Commencer maintenant]';
  }
  if (s.includes('raccourci') || s.includes('shorten')) {
    return user.split(/\s+/).slice(0, Math.max(3, Math.ceil(user.split(/\s+/).length / 2))).join(' ') + '.';
  }
  if (s.includes('allonge') || s.includes('expand') || s.includes('développe')) {
    return user.trim() + ' En complément, voici quelques précisions utiles pour enrichir le propos et clarifier les bénéfices concrets pour la clientèle visée.';
  }
  // Défaut : email courtois québécois.
  return 'Bonjour,\n\nMerci de votre intérêt. Voici le contenu demandé, rédigé dans un français québécois clair et professionnel. N\'hésitez pas à revenir vers nous pour toute précision.\n\nCordialement';
}
