// ── social-ai.ts — LOT SOCIAL PLANNER (Sprint 9) — NEUF (owned Manager-B)
//
// ⚠ État : corps réel Phase B (Manager-B). Signature FIGÉE (worker.ts la câble
//   déjà). Imports worker RELATIFS.
//
// Génération IA de posts (calque EXACT reviews.ts:handleSuggestReviewReply
// l.222) : garde env.ANTHROPIC_API_KEY (absent ⇒ json({ error }, 500)) →
// fetch https://api.anthropic.com/v1/messages (modèle claude-haiku, system +
// messages) → renvoie json({ data: { content } }). Capability EXISTANTE 'ai.use'
// (présente dans ALL_CAPABILITIES seq 80 — AUCUN ajout). Bornage tenant via
// l'auth (le prompt ne franchit jamais le tenant). Succès json({ data }) /
// erreur json({ error }, status) — JAMAIS de `code`.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';

export type SocialAiAuth = CapAuth & { capabilities?: Set<string> };

// Garde capability : 'ai.use' (EXISTANTE — calque génération IA reviews.ts).
function capGuard(auth: SocialAiAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'ai.use');
}

// Consigne réseau-spécifique (longueur / ton). Best-effort, jamais bloquant.
function networkHint(network?: string): string {
  switch (network) {
    case 'linkedin':
      return 'Réseau LinkedIn : ton professionnel, valeur métier, 1-2 hashtags max.';
    case 'instagram':
      return 'Réseau Instagram : ton chaleureux et visuel, émojis pertinents, 3-5 hashtags.';
    case 'facebook':
      return 'Réseau Facebook : ton conversationnel et engageant, appel à l\'action léger.';
    case 'google_business':
      return 'Réseau Google Business : ton informatif et local, sans hashtags, appel à l\'action clair.';
    default:
      return 'Adapte la longueur et le ton à un post de réseau social générique.';
  }
}

// ── POST /api/social/generate (PROTÉGÉ) — brouillon de post via IA ──────────
//    CALQUE reviews.ts:handleSuggestReviewReply :
//      1. if (!env.ANTHROPIC_API_KEY) return json({ error }, 500).
//      2. body = { prompt, network? } ; fetch api.anthropic.com/v1/messages
//         (model 'claude-haiku-4-5-20250401', system rédacteur social québécois
//         adapté au `network`, messages: [{ role:'user', content: prompt }]).
//      3. content = result.content?.[0]?.text || '' ; json({ data: { content } }).
//      try/catch best-effort → json({ error }, 500) sur exception.
export async function handleGenerateSocialPost(
  request: Request, env: Env, auth: SocialAiAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;

  let body: { prompt?: string; network?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }
  const prompt = sanitizeInput(body.prompt, 2000);
  if (!prompt) return json({ error: 'Prompt requis' }, 400);

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Clé API Anthropic non configurée' }, 500);
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20250401',
        max_tokens: 600,
        system:
          `Tu es le rédacteur social d'une PME québécoise. Rédige UN post de réseau ` +
          `social prêt à publier à partir de la demande de l'utilisateur. Ton québécois ` +
          `naturel, engageant et authentique. Renvoie UNIQUEMENT le texte du post (pas ` +
          `d'explications, pas de guillemets autour). ${networkHint(body.network)}`,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const result = (await resp.json()) as { content?: Array<{ text: string }> };
    const content = result.content?.[0]?.text || '';
    return json({ data: { content } });
  } catch (err) {
    console.error('handleGenerateSocialPost: AI generation failed', err);
    return json({ error: 'Échec génération du post' }, 500);
  }
}
