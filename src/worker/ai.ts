import type { Env } from './types';
import { json } from './helpers';

// Fallback to OpenAI API since it's the standard integration here.
// In a real scenario, this could use Claude Haiku if Anthropic API key is provided.
async function callLLM(env: Env, systemPrompt: string, userPrompt: string): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    return 'L\'intégration IA n\'est pas configurée (clé manquante).';
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      })
    });
    
    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.statusText}`);
    }

    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('LLM API error:', err);
    return 'Désolé, le service IA est momentanément indisponible.';
  }
}

// ── P3.6.a: AI Lead Scoring ─────────────────────────────────

export async function scoreLeadAI(env: Env, leadData: Record<string, any>, history: any[]): Promise<number> {
  const systemPrompt = "Tu es un expert en qualification de leads B2B/B2C au Québec. Ton objectif est d'analyser le profil d'un lead (budget, source, message, historique) et d'assigner un score de qualification entre 0 et 100. Réponds UNIQUEMENT avec un nombre entier. Ne justifie pas.";
  
  const userPrompt = `
Lead Data: ${JSON.stringify(leadData)}
Historique: ${JSON.stringify(history)}
  `.trim();

  const result = await callLLM(env, systemPrompt, userPrompt);
  const score = parseInt(result.trim(), 10);
  
  if (isNaN(score)) return 50; // Fallback score
  return Math.max(0, Math.min(100, score)); // Clamp between 0-100
}

// ── P3.6.c: AI Content Generator ────────────────────────────

export async function handleAiGenerate(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    action: 'email_followup' | 'generate_proposal' | 'social_post' | 'objection_handler' | 'reply_message';
    context: string;
    brandVoice?: string;
  };

  const { action, context, brandVoice = 'Professionnel, rassurant et québécois naturel.' } = body;

  let systemPrompt = `Tu es un assistant IA pour une PME au Québec. Ton ton doit être: ${brandVoice}. `;

  switch (action) {
    case 'email_followup':
      systemPrompt += "Génère un email de relance ou de suivi basé sur le contexte fourni. L'email doit être convaincant, poli et proposer une prochaine étape claire (ex: appel téléphonique).";
      break;
    case 'generate_proposal':
      systemPrompt += "Génère une proposition commerciale attrayante basée sur le contexte. Mets en valeur les points forts de notre service et incite à l'action.";
      break;
    case 'social_post':
      systemPrompt += "Génère un post pour les réseaux sociaux (Facebook/Instagram) basé sur le contexte. Inclus des hashtags pertinents et un call-to-action.";
      break;
    case 'objection_handler':
      systemPrompt += "Le client a émis une objection immobilière. Fournis une réponse professionnelle et rassurante pour traiter cette objection.";
      break;
    case 'reply_message':
      systemPrompt += "Génère une réponse courte et professionnelle à envoyer via SMS ou Webchat basée sur le dernier message reçu.";
      break;
    default:
      return json({ error: 'Action non supportée' }, 400);
  }

  const generatedContent = await callLLM(env, systemPrompt, context);

  return json({ data: { content: generatedContent } });
}

// ── P3.6.d: AI Workflow Assistant ───────────────────────────

export async function handleAiSuggestWorkflow(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { prompt: string };
  
  const systemPrompt = "Tu es un expert en automatisation marketing. L'utilisateur va décrire un besoin en langage naturel. Tu dois générer un tableau JSON représentant les étapes d'un workflow Intralys CRM. Chaque objet doit avoir: id, type ('trigger', 'delay', 'email', 'sms', 'task', 'condition'), et config (un objet avec les détails). Exemple de config pour delay: { duration: 48, unit: 'hours' }. Réponds UNIQUEMENT avec le JSON valide, sans markdown autour.";
  
  const userPrompt = body.prompt;

  const result = await callLLM(env, systemPrompt, userPrompt);
  
  try {
    // Attempt to parse the JSON output
    const jsonStr = result.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
    const workflowSteps = JSON.parse(jsonStr);
    return json({ data: { steps: workflowSteps } });
  } catch (err) {
    console.error('Failed to parse AI workflow JSON:', err, result);
    return json({ error: 'Impossible de générer un workflow valide. Veuillez reformuler votre demande.' }, 500);
  }
}
