// ── Module AI — Intralys CRM (Sprint 6 enrichi) ─────────────
// Claude Haiku 4.5 + 8 actions + brand_voice contextualisé
import type { Env } from './types';
import { json } from './helpers';

// ── LLM : Claude Haiku 4.5 via Anthropic (fallback mock) ────

async function callLLM(env: Env, systemPrompt: string, userPrompt: string): Promise<string> {
  const useMock = env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY;

  if (useMock) {
    return generateMockContent(systemPrompt, userPrompt);
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
    }

    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    return data.content?.[0]?.text || '';
  } catch (err) {
    console.error('LLM API error:', err);
    // Fallback mock en cas d'erreur
    return generateMockContent(systemPrompt, userPrompt);
  }
}

// ── Mock : génère du contenu réaliste québécois ───────────────

function generateMockContent(systemPrompt: string, _userPrompt: string): string {
  if (systemPrompt.includes('score') || systemPrompt.includes('Score')) {
    return String(Math.floor(Math.random() * 40) + 40); // 40-80
  }
  if (systemPrompt.includes('SMS') || systemPrompt.includes('sms_followup')) {
    return 'Bonjour! Suite à notre échange, je voulais prendre de vos nouvelles. Avez-vous eu la chance de réfléchir à notre proposition? Je suis disponible pour répondre à vos questions 😊';
  }
  if (systemPrompt.includes('social') || systemPrompt.includes('Facebook')) {
    return '🌟 Vous cherchez un expert en qui avoir confiance ? Notre équipe est là pour vous accompagner à chaque étape. Contactez-nous aujourd\'hui pour une consultation gratuite ! #Québec #ServiceProfessionnel #ExpertLocal';
  }
  if (systemPrompt.includes('agenda') || systemPrompt.includes('meeting')) {
    return '📋 Ordre du jour — Rencontre stratégique\n\n1. Tour de table et présentations (5 min)\n2. Revue de la situation actuelle (15 min)\n3. Présentation de notre solution (20 min)\n4. Questions & réponses (10 min)\n5. Prochaines étapes et suivi (10 min)\n\nDurée totale estimée : 60 minutes';
  }
  if (systemPrompt.includes('objection') || systemPrompt.includes('Objection')) {
    return 'Je comprends votre hésitation, c\'est tout à fait normal à cette étape. Permettez-moi de vous rassurer : plusieurs de nos clients avaient les mêmes préoccupations au départ. Ce qui les a convaincus, c\'est [point clé]. Seriez-vous disponible pour qu\'on en discute 15 minutes?';
  }
  if (systemPrompt.includes('proposition') || systemPrompt.includes('proposal')) {
    return 'Bonjour,\n\nSuite à notre échange enrichissant, j\'ai le plaisir de vous présenter notre proposition personnalisée.\n\nNous avons analysé vos besoins spécifiques et sommes convaincus de pouvoir vous apporter une valeur significative. Notre approche se distingue par [avantage clé 1] et [avantage clé 2].\n\nJe reste disponible pour affiner cette proposition selon vos retours.\n\nCordialement';
  }
  if (systemPrompt.includes('récap') || systemPrompt.includes('recap')) {
    return 'Récapitulatif de notre appel :\n\n✅ Points discutés :\n- Situation actuelle et défis\n- Opportunités identifiées\n- Solutions proposées\n\n📌 Prochaines étapes :\n1. Envoi de la documentation (cette semaine)\n2. Présentation à l\'équipe (semaine prochaine)\n3. Décision finale (d\'ici 2 semaines)\n\nMerci pour cet échange productif!';
  }
  // Default : email de bienvenue ou relance
  return 'Bonjour,\n\nJ\'espère que ce message vous trouve en bonne santé.\n\nJe vous contacte suite à votre demande d\'information. Nous serions ravis de vous accompagner dans votre projet.\n\nSerait-il possible de prévoir un appel de 15 minutes pour en discuter?\n\nCordialement,\nL\'équipe Intralys';
}

// ── D1: AI Lead Scoring contextualisé ────────────────────────

export async function scoreLeadAI(
  env: Env,
  leadData: Record<string, unknown>,
  history: unknown[],
  businessContext?: { business_type?: string; brand_voice?: string; scoring_prompt_extra?: string }
): Promise<number> {
  const businessType = businessContext?.business_type || 'B2B générique';
  const brandVoice = businessContext?.brand_voice || 'Professionnel et québécois';
  const extraCriteria = businessContext?.scoring_prompt_extra || '';

  const systemPrompt = `Tu es un expert en qualification de leads pour ${businessType}. \
Ton du client : ${brandVoice}. \
${extraCriteria ? `Critères spécifiques : ${extraCriteria}. ` : ''}\
Analyse le profil du lead (budget, source, message, historique d'interactions) et assigne un score de qualification entre 0 et 100. \
0 = lead froid/non qualifié. 100 = lead chaud/prêt à acheter. \
Réponds UNIQUEMENT avec un nombre entier entre 0 et 100. Ne justifie pas.`;

  const userPrompt = `Lead : ${JSON.stringify(leadData)}\nHistorique : ${JSON.stringify(history)}`;

  const result = await callLLM(env, systemPrompt, userPrompt);
  const score = parseInt(result.trim(), 10);
  if (isNaN(score)) return 50;
  return Math.max(0, Math.min(100, score));
}

// ── D2: AI Content Generator 8 actions (FR québécois) ────────

const AI_ACTIONS = [
  'email_followup', 'email_welcome', 'sms_followup', 'social_post',
  'objection_handler', 'meeting_agenda', 'proposal_intro', 'recap_call',
] as const;

type AiAction = typeof AI_ACTIONS[number];

export async function handleAiGenerate(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    action?: string;
    context?: string;
    lead_id?: string;
    client_id?: string;
    brand_voice?: string;
  };

  const action = body.action as AiAction;
  if (!AI_ACTIONS.includes(action)) {
    return json({ error: `Action non supportée. Actions disponibles : ${AI_ACTIONS.join(', ')}` }, 400);
  }

  // Charger brand_voice depuis le client si client_id fourni
  let brandVoice = body.brand_voice || 'Professionnel, rassurant et québécois naturel.';
  if (body.client_id) {
    const client = await env.DB.prepare(
      'SELECT brand_voice FROM clients WHERE id = ?'
    ).bind(body.client_id).first() as { brand_voice?: string } | null;
    if (client?.brand_voice) brandVoice = client.brand_voice;
  }

  // Charger contexte lead si lead_id fourni
  let leadContext = body.context || '';
  if (body.lead_id) {
    const lead = await env.DB.prepare(
      'SELECT name, email, phone, status, score, source, message FROM leads WHERE id = ?'
    ).bind(body.lead_id).first() as Record<string, unknown> | null;
    if (lead) {
      leadContext = `Lead: ${JSON.stringify(lead)}. ${leadContext}`;
    }
  }

  const baseSystem = `Tu es un assistant IA pour une PME au Québec. \
Ton du client : ${brandVoice}. \
Utilise un français québécois naturel (pas parisien), chaleureux et professionnel. \
Évite le tutoiement sauf si explicitement demandé. \
Garde les messages concis et orientés vers l'action.`;

  let systemPrompt = baseSystem;

  switch (action) {
    case 'email_followup':
      systemPrompt += ' Génère un email de relance pour un lead tiède. Rappelle notre dernière interaction, propose une prochaine étape claire (appel, rencontre). Max 150 mots.';
      break;
    case 'email_welcome':
      systemPrompt += ' Génère un email de bienvenue chaleureux pour un nouveau lead. Présente la valeur offerte, mets à l\'aise, propose une rencontre découverte gratuite. Max 200 mots.';
      break;
    case 'sms_followup':
      systemPrompt += ' Génère un SMS de relance court et amical (max 160 caractères). Inclus un appel à l\'action clair. Pas d\'emojis excessifs.';
      break;
    case 'social_post':
      systemPrompt += ' Génère un post pour Facebook/Instagram. Ton engageant, local (Québec), avec 3-5 hashtags pertinents et un appel à l\'action. Max 200 mots.';
      break;
    case 'objection_handler':
      systemPrompt += ' Le prospect a émis une objection. Génère une réponse professionnelle qui valide l\'objection, offre une perspective différente et relance la conversation. Max 150 mots.';
      break;
    case 'meeting_agenda':
      systemPrompt += ' Génère un ordre du jour structuré pour une rencontre client de 60 minutes. Format clair avec durée par section. Professionnel et québécois.';
      break;
    case 'proposal_intro':
      systemPrompt += ' Génère une introduction de proposition commerciale percutante. Met en valeur la compréhension des besoins du client, les bénéfices clés, et incite à lire la suite. Max 200 mots.';
      break;
    case 'recap_call':
      systemPrompt += ' Génère un résumé d\'appel/réunion à envoyer par email. Format structuré : points discutés, décisions prises, prochaines étapes avec responsables. Professionnel et concis.';
      break;
  }

  const generatedContent = await callLLM(env, systemPrompt, leadContext || 'Génère un contenu générique de qualité.');

  return json({ data: { content: generatedContent, action } });
}

// ── AI Workflow Assistant ─────────────────────────────────────

export async function handleAiSuggestWorkflow(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { prompt: string };

  const systemPrompt = `Tu es un expert en automatisation marketing pour PMEs québécoises. \
L'utilisateur décrit un besoin en langage naturel. Génère un tableau JSON représentant les étapes d'un workflow Intralys CRM. \
Chaque objet doit avoir: id (string), type ('wait'|'email'|'sms'|'task'|'condition'), et config (objet avec les détails). \
Pour 'wait': { delay_hours: number }. Pour 'email': { subject: string, body: string }. Pour 'sms': { body: string }. \
Pour 'task': { title: string, due_in_days: number }. \
Réponds UNIQUEMENT avec le JSON valide, sans markdown autour. Maximum 6 étapes.`;

  const result = await callLLM(env, systemPrompt, body.prompt);

  try {
    const jsonStr = result.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const workflowSteps = JSON.parse(jsonStr);
    return json({ data: { steps: workflowSteps } });
  } catch (_err) {
    // Fallback mock workflow
    return json({
      data: {
        steps: [
          { id: 'step-1', type: 'wait', config: { delay_hours: 1 } },
          { id: 'step-2', type: 'email', config: { subject: 'Bienvenue!', body: 'Bonjour {{lead.name}}, merci de nous avoir contactés.' } },
          { id: 'step-3', type: 'wait', config: { delay_hours: 72 } },
          { id: 'step-4', type: 'sms', config: { body: 'Bonjour {{lead.name}}, avez-vous des questions? 😊' } },
        ],
      },
    });
  }
}

export { AI_ACTIONS };
export type { AiAction };
