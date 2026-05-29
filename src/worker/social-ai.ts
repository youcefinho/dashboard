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
import { isAiMockMode } from './ai';

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

// ── POST /api/social/generate-image (PROTÉGÉ) — génération d'images via IA ─────
export async function handleGenerateSocialImage(
  request: Request, env: Env, auth: SocialAiAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;

  let body: { prompt?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }
  const prompt = sanitizeInput(body.prompt, 1000);
  if (!prompt) return json({ error: 'Prompt requis' }, 400);

  const clientId = auth.tenant?.clientId ?? auth.clientId ?? 'global';
  const fileId = crypto.randomUUID();
  const useMock = isAiMockMode(env);

  let fileName = `social_${fileId}.png`;
  let mimeType = 'image/png';
  let r2Key = `${clientId}/social_${fileId}.png`;
  let fileBuffer: ArrayBuffer;

  if (useMock) {
    // Générer SVG Mock propre (Stripe-clean, texte encodé pour éviter les XSS/problèmes XML)
    const escapedPrompt = prompt
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
      
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="100%" height="100%">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="20" y="20" width="760" height="560" rx="12" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2"/>
  <circle cx="60" cy="60" r="20" fill="#6366f1"/>
  <path d="M 54 60 L 58 64 L 66 56" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="95" y="58" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="16" font-weight="bold" fill="#0f172a">Intralys AI Visualizer</text>
  <text x="95" y="75" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="12" fill="#64748b">Visual Mock Preview</text>
  
  <path d="M 400 160 L 250 310 M 400 160 L 550 310 M 280 290 L 280 440 L 520 440 L 520 290" fill="none" stroke="#6366f1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="375" y="360" width="50" height="80" fill="none" stroke="#e2e8f0" stroke-width="3" rx="2"/>
  <circle cx="390" cy="400" r="4" fill="#6366f1"/>
  
  <rect x="80" y="480" width="640" height="70" rx="8" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>
  <text x="100" y="510" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#64748b">Prompt IA :</text>
  <text x="100" y="532" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="14" fill="#0f172a">${escapedPrompt}</text>
</svg>`;
    
    fileBuffer = new TextEncoder().encode(svg).buffer;
    fileName = `social_${fileId}.svg`;
    mimeType = 'image/svg+xml';
    r2Key = `${clientId}/social_${fileId}.svg`;
  } else {
    // Mode réel avec Workers AI
    const ai = (env as any).AI;
    if (!ai || typeof ai.run !== 'function') {
      return json({ error: 'Binding Workers AI non configuré' }, 500);
    }
    try {
      const response = await ai.run('@cf/bytedance/stable-diffusion-xl-lightning', { prompt });
      if (response instanceof Response) {
        fileBuffer = await response.arrayBuffer();
      } else if (response instanceof ArrayBuffer) {
        fileBuffer = response;
      } else if (response && typeof response === 'object' && response.buffer instanceof ArrayBuffer) {
        fileBuffer = response.buffer;
      } else if (response && (response as any).result) {
        const resObj = (response as any).result;
        if (resObj instanceof ArrayBuffer) fileBuffer = resObj;
        else if (typeof resObj === 'string') {
          const binaryString = atob(resObj);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          fileBuffer = bytes.buffer;
        } else {
          throw new Error('Format de réponse AI non supporté');
        }
      } else {
        throw new Error('Format de réponse AI non supporté');
      }
    } catch (err) {
      console.error('handleGenerateSocialImage: Real AI failed, falling back to SVG mock', err);
      const escapedPrompt = prompt
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
        
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="100%" height="100%">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="20" y="20" width="760" height="560" rx="12" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2"/>
  <text x="95" y="58" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="bold" fill="#0f172a">Intralys AI Visualizer (Fallback)</text>
  <text x="100" y="532" font-family="Inter, system-ui, sans-serif" font-size="14" fill="#0f172a">${escapedPrompt}</text>
</svg>`;
      fileBuffer = new TextEncoder().encode(svg).buffer;
      fileName = `social_${fileId}.svg`;
      mimeType = 'image/svg+xml';
      r2Key = `${clientId}/social_${fileId}.svg`;
    }
  }

  if (!env.FILES) {
    return json({ error: 'Binding R2 FILES non configuré' }, 500);
  }
  
  try {
    await env.FILES.put(r2Key, fileBuffer, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { prompt, generatedBy: auth.userId || 'system' },
    });
  } catch (err) {
    console.error('handleGenerateSocialImage: R2 put failed', err);
    return json({ error: 'Échec sauvegarde R2' }, 500);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO files (id, client_id, name, size, mime, r2_key, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      fileId,
      clientId === 'global' ? null : clientId,
      fileName,
      fileBuffer.byteLength,
      mimeType,
      r2Key,
      auth.userId || null
    ).run();
  } catch (err) {
    console.error('handleGenerateSocialImage: D1 insert failed', err);
    try { await env.FILES.delete(r2Key); } catch {}
    return json({ error: 'Échec enregistrement base de données' }, 500);
  }

  return json({
    data: {
      url: `/api/files/${fileId}`,
      fileId,
    }
  });
}

