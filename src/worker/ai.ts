// ── Module AI — Intralys CRM (Sprint 6 enrichi) ─────────────
// Claude Haiku 4.5 + 8 actions + brand_voice contextualisé
import type { Env } from './types';
import { json } from './helpers';

// ── LLM : Claude Haiku 4.5 via Anthropic (fallback mock) ────

async function callLLM(env: Env, systemPrompt: string, userPrompt: string): Promise<string> {
  const useMock = env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY;

  if (useMock) {
    // Petit délai pour simuler la latence réseau et déclencher le loading state
    await new Promise(r => setTimeout(r, 600));
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

function generateMockContent(systemPrompt: string, userPrompt: string): string {
  // ── Sprint 19 : mocks pour actions inline (utilisent le texte source) ──
  // Le user prompt commence par "Texte source :\n" pour les actions inline.
  const inlineMatch = userPrompt.match(/^Texte source :\n([\s\S]+?)(?:\n\n|$)/);
  if (inlineMatch) {
    const sourceText = inlineMatch[1]!.trim();
    if (systemPrompt.includes('Améliore le texte')) {
      return sourceText.charAt(0).toUpperCase() + sourceText.slice(1)
        .replace(/\s+/g, ' ')
        .replace(/(\w)\s*([.!?])/g, '$1$2')
        .replace(/\bje\b/g, 'je')
        + (sourceText.endsWith('.') || sourceText.endsWith('!') || sourceText.endsWith('?') ? '' : '.');
    }
    if (systemPrompt.includes('Raccourcis')) {
      const words = sourceText.split(/\s+/);
      const half = Math.max(3, Math.ceil(words.length / 2));
      return words.slice(0, half).join(' ') + (half < words.length ? '.' : '');
    }
    if (systemPrompt.includes('formel')) {
      return sourceText
        .replace(/\bsalut\b/gi, 'Bonjour')
        .replace(/\btu\b/g, 'vous')
        .replace(/\bton\b/g, 'votre')
        .replace(/\bta\b/g, 'votre')
        .replace(/\btes\b/g, 'vos');
    }
    if (systemPrompt.includes('amical')) {
      return sourceText
        .replace(/\bBonjour\b/g, 'Salut')
        .replace(/\bMadame\b/gi, '')
        .replace(/\bMonsieur\b/gi, '')
        .replace(/\bvous\b/g, 'tu')
        .replace(/\bvotre\b/g, 'ton') + ' 😊';
    }
  }
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
  // Sprint 20 : mock summarize_conversation (3 puces FR)
  if (systemPrompt.includes('Résume cette conversation')) {
    return '- Discussion sur un projet de rénovation salle de bain\n- Client hésite sur le budget proposé\n- Relance avec 2 options tarifaires + appel 15 min cette semaine';
  }
  // Sprint 21 : mock batch summarize leads (LEAD N: ...)
  if (systemPrompt.includes('Pour chaque lead, écris UNE')) {
    const leadMatches = userPrompt.match(/LEAD \d+ — ([^(]+)/g);
    if (leadMatches) {
      return leadMatches.map((m, i) => {
        const name = m.replace(/LEAD \d+ — /, '').trim();
        const variants = [
          `${name} : lead chaud avec engagement récent — relancer cette semaine`,
          `${name} : lead inactif depuis plusieurs jours, envoyer une relance amicale`,
          `${name} : qualifié, en attente de la proposition — confirmer la date`,
          `${name} : tiède, besoin d'un appel rapide pour ranimer l'intérêt`,
        ];
        return `LEAD ${i + 1}: ${variants[i % variants.length]}`;
      }).join('\n');
    }
  }
  // Sprint 20 : mock suggest_next_action (JSON valide)
  if (systemPrompt.includes('coach commercial')) {
    return JSON.stringify({
      action: 'email',
      reason: 'Lead inactif depuis plus de 7 jours, une relance ciblée peut raviver l\'intérêt.',
      draft: 'Bonjour,\n\nJ\'espère que vous allez bien. Je voulais revenir vers vous suite à notre dernier échange — avez-vous eu l\'occasion de réfléchir à notre proposition?\n\nDisponible pour répondre à vos questions ou planifier un court appel.\n\nCordialement',
    });
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
  // Sprint 19 — actions inline pour AiSparkles (rewrite générique)
  'improve_text', 'shorten', 'formalize', 'casualize',
] as const;

type AiAction = typeof AI_ACTIONS[number];

const INLINE_REWRITE_ACTIONS: ReadonlySet<AiAction> = new Set(['improve_text', 'shorten', 'formalize', 'casualize']);

export async function handleAiGenerate(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    action?: string;
    context?: string;
    /** Sprint 19 — texte source à transformer pour les actions inline */
    text?: string;
    lead_id?: string;
    client_id?: string;
    brand_voice?: string;
  };

  const action = body.action as AiAction;
  if (!AI_ACTIONS.includes(action)) {
    return json({ error: `Action non supportée. Actions disponibles : ${AI_ACTIONS.join(', ')}` }, 400);
  }

  // Validation pour les actions inline : text requis
  if (INLINE_REWRITE_ACTIONS.has(action) && !body.text?.trim()) {
    return json({ error: 'Texte requis pour les actions de réécriture inline.' }, 400);
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
    // ── Sprint 19 : actions inline (rewrite) ─────────────────
    case 'improve_text':
      systemPrompt += ' Améliore le texte fourni : corrige les fautes, clarifie le sens, garde la longueur similaire et préserve l\'intention. Retourne UNIQUEMENT le texte amélioré, sans préambule ni guillemets.';
      break;
    case 'shorten':
      systemPrompt += ' Raccourcis le texte fourni d\'environ 50%. Garde l\'essentiel et l\'intention. Retourne UNIQUEMENT le texte raccourci, sans préambule ni guillemets.';
      break;
    case 'formalize':
      systemPrompt += ' Réécris le texte fourni en registre formel et professionnel québécois. Garde l\'intention et la longueur similaire. Retourne UNIQUEMENT le texte transformé, sans préambule ni guillemets.';
      break;
    case 'casualize':
      systemPrompt += ' Réécris le texte fourni en registre amical et chaleureux québécois (sans vulgarité). Garde l\'intention et la longueur similaire. Retourne UNIQUEMENT le texte transformé, sans préambule ni guillemets.';
      break;
  }

  // Pour les actions inline, le user prompt est le texte source à transformer.
  const userPrompt = INLINE_REWRITE_ACTIONS.has(action)
    ? `Texte source :\n${body.text}\n\n${leadContext ? `Contexte additionnel : ${leadContext}` : ''}`
    : (leadContext || 'Génère un contenu générique de qualité.');

  const generatedContent = await callLLM(env, systemPrompt, userPrompt);

  return json({ data: { content: generatedContent, action } });
}

// ── Sprint 20 : AI Summarize Conversation ────────────────────

interface CachedSummary {
  summary: string[];
  last_message_id: string;
  cached_at: number;
}

// Cache mémoire process-local (Cloudflare Workers : isolate-level, TTL 1h)
const SUMMARY_CACHE = new Map<string, CachedSummary>();
const SUMMARY_TTL_MS = 60 * 60 * 1000;

export async function handleAiSummarizeConversation(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { conversation_id?: string };
  const convId = body.conversation_id;
  if (!convId) return json({ error: 'conversation_id requis' }, 400);

  // Charger les 30 derniers messages
  const messagesQuery = await env.DB.prepare(
    `SELECT id, direction, channel, body, sender_name, created_at
     FROM messages WHERE conversation_id = ?
     ORDER BY created_at DESC LIMIT 30`
  ).bind(convId).all();
  const messages = (messagesQuery.results || []) as Array<Record<string, unknown>>;
  if (messages.length === 0) {
    return json({ data: { summary: ['Aucun message dans cette conversation.'] } });
  }

  // Cache check : si dernier message id identique, retourner le cache
  const lastMessageId = String(messages[0]!.id);
  const cached = SUMMARY_CACHE.get(convId);
  if (cached && cached.last_message_id === lastMessageId && Date.now() - cached.cached_at < SUMMARY_TTL_MS) {
    return json({ data: { summary: cached.summary, cached: true } });
  }

  // Construire le contexte chronologique pour le LLM
  const chronological = [...messages].reverse();
  const transcript = chronological.map(m => {
    const who = m.direction === 'outbound' ? 'Nous' : (m.sender_name || 'Client');
    return `${who}: ${m.body}`;
  }).join('\n');

  const systemPrompt = `Tu es un assistant CRM pour PME québécoise. \
Résume cette conversation en exactement 3 puces concises (8-15 mots chacune) : \
1. Sujet principal de l'échange \
2. État actuel / dernier point bloquant \
3. Prochaine étape suggérée pour faire avancer \
Réponds UNIQUEMENT avec 3 lignes commençant par "- " (tiret + espace), sans numérotation, sans préambule.`;

  const userPrompt = `Conversation (chronologique) :\n${transcript}`;
  const result = await callLLM(env, systemPrompt, userPrompt);

  // Parse en 3 puces (sépare par ligne, garde celles qui commencent par "-" ou "•")
  const summary = result
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('-') || l.startsWith('•') || l.startsWith('*'))
    .map(l => l.replace(/^[-•*]\s*/, ''))
    .filter(l => l.length > 0)
    .slice(0, 3);

  // Si parsing rate (LLM répond sans tirets), fallback split par lignes simples
  const finalSummary = summary.length >= 2 ? summary : result.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3);

  SUMMARY_CACHE.set(convId, {
    summary: finalSummary,
    last_message_id: lastMessageId,
    cached_at: Date.now(),
  });

  return json({ data: { summary: finalSummary, cached: false } });
}

// ── Sprint 20 : AI Suggest Next Action ────────────────────────

export async function handleAiSuggestNextAction(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { lead_id?: string };
  const leadId = body.lead_id;
  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  // Charger lead + 3 dernières interactions
  const lead = await env.DB.prepare(
    `SELECT id, name, email, phone, status, score, source, message, notes, deal_value,
            created_at, updated_at
     FROM leads WHERE id = ?`
  ).bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) return json({ error: 'Lead introuvable' }, 404);

  const lastMessages = await env.DB.prepare(
    `SELECT direction, channel, body, created_at
     FROM messages WHERE lead_id = ?
     ORDER BY created_at DESC LIMIT 3`
  ).bind(leadId).all();
  const lastNotes = await env.DB.prepare(
    `SELECT body, category, created_at FROM lead_notes
     WHERE lead_id = ? ORDER BY created_at DESC LIMIT 2`
  ).bind(leadId).all();

  const daysSinceUpdate = Math.floor((Date.now() - new Date(String(lead.updated_at)).getTime()) / 86400000);

  const systemPrompt = `Tu es un coach commercial pour une PME au Québec. \
Analyse ce lead et propose UNE action concrète à faire MAINTENANT pour le faire avancer. \
Réponds UNIQUEMENT en JSON valide (sans markdown, sans préambule) au format : \
{"action":"email"|"sms"|"call","reason":"<pourquoi cette action en 15 mots>","draft":"<brouillon de message prêt à envoyer si email/sms, ou questions clés à poser si call, max 80 mots>"}. \
FR québécois naturel, ton chaleureux et professionnel.`;

  const context = JSON.stringify({
    lead: { ...lead, days_since_update: daysSinceUpdate },
    last_messages: lastMessages.results || [],
    last_notes: lastNotes.results || [],
  });

  const result = await callLLM(env, systemPrompt, `Lead context :\n${context}`);

  // Parse JSON robuste : essaie de trouver {...} dans la réponse
  let parsed: { action?: string; reason?: string; draft?: string } | null = null;
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch { /* fallback ci-dessous */ }

  // Fallback si parsing échoue
  if (!parsed || !parsed.action) {
    parsed = {
      action: daysSinceUpdate > 14 ? 'call' : 'email',
      reason: 'Lead inactif depuis plusieurs jours, une relance personnalisée peut le réactiver.',
      draft: `Bonjour ${lead.name || ''},\n\nJe voulais prendre de vos nouvelles suite à notre dernier échange. Êtes-vous toujours intéressé(e) par notre solution? Disponible pour répondre à vos questions.\n\nCordialement,`,
    };
  }

  return json({ data: parsed });
}

// ── Sprint 21 : AI Summarize Leads (batch) ────────────────────

export async function handleAiSummarizeLeads(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { lead_ids?: string[] };
  const ids = (body.lead_ids || []).slice(0, 50); // hard cap 50
  if (ids.length === 0) return json({ error: 'lead_ids requis (1-50)' }, 400);

  // Charger les leads en batch — placeholders SQL-safe
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, name, email, status, score, source, deal_value, notes, updated_at
     FROM leads WHERE id IN (${placeholders})`
  ).bind(...ids).all();
  const leads = (rows.results || []) as Array<Record<string, unknown>>;
  if (leads.length === 0) return json({ data: { summary: [], overview: 'Aucun lead trouvé.' } });

  // Compute stats simples (sans LLM, déterministe)
  const total = leads.length;
  const hot = leads.filter(l => Number(l.score) >= 70).length;
  const warm = leads.filter(l => { const s = Number(l.score); return s >= 40 && s < 70; }).length;
  const cold = leads.filter(l => Number(l.score) < 40).length;
  const inactiveDays = leads.filter(l => {
    const d = Math.floor((Date.now() - new Date(String(l.updated_at)).getTime()) / 86400000);
    return d >= 14;
  }).length;
  const totalDealValue = leads.reduce((sum, l) => sum + (Number(l.deal_value) || 0), 0);

  // Per-lead AI summary (1 ligne)
  const systemPrompt = `Tu es un assistant CRM québécois. Pour chaque lead, écris UNE
phrase courte (10-15 mots) qui décrit son état et l'action prioritaire suggérée. FR québécois.
Format de réponse : EXACTEMENT N lignes, chacune préfixée par "LEAD <index>: " (index 1-based).`;

  const userPrompt = leads.map((l, i) => {
    const daysSinceUpdate = Math.floor((Date.now() - new Date(String(l.updated_at)).getTime()) / 86400000);
    return `LEAD ${i + 1} — ${l.name} (${l.status}, score ${l.score || '?'}, ${daysSinceUpdate}j sans activité) ${l.notes ? '— Notes: ' + String(l.notes).slice(0, 100) : ''}`;
  }).join('\n');

  const result = await callLLM(env, systemPrompt, userPrompt);

  // Parse en lignes "LEAD N: ..."
  const perLead: Array<{ lead_id: string; name: string; summary: string }> = leads.map((l, i) => {
    const match = result.match(new RegExp(`LEAD ${i + 1}:?\\s*([^\\n]+)`, 'i'));
    return {
      lead_id: String(l.id),
      name: String(l.name),
      summary: match ? match[1]!.trim() : 'Pas de résumé disponible.',
    };
  });

  const overview = `${total} leads sélectionnés · ${hot} chauds · ${warm} tièdes · ${cold} froids · ${inactiveDays} inactifs (≥14j) · Pipeline total ${totalDealValue.toLocaleString('fr-CA')} $`;

  return json({ data: { per_lead: perLead, overview, stats: { total, hot, warm, cold, inactiveDays, totalDealValue } } });
}

// ── AI Workflow Assistant (Sprint 7 enrichi) ─────────────────

export async function handleAiSuggestWorkflow(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { prompt: string; client_id?: string };

  // Charger le contexte métier si client_id fourni
  let businessContext = '';
  if (body.client_id) {
    const client = await env.DB.prepare(
      'SELECT business_type, brand_voice FROM clients WHERE id = ?'
    ).bind(body.client_id).first() as { business_type?: string; brand_voice?: string } | null;

    if (client) {
      businessContext += `Type d'entreprise : ${client.business_type || 'B2B'}. `;
      businessContext += `Ton : ${client.brand_voice || 'professionnel québécois'}. `;
    }

    // Charger les custom fields disponibles
    const { results: fields } = await env.DB.prepare(
      'SELECT name, slug, field_type FROM custom_field_defs WHERE client_id = ? ORDER BY sort_order'
    ).bind(body.client_id).all();

    if (fields && fields.length > 0) {
      const fieldNames = fields.map(f => `${f.name} (${f.field_type})`).join(', ');
      businessContext += `Champs personnalisés disponibles : ${fieldNames}. `;
    }

    // Charger les tags existants
    const { results: tags } = await env.DB.prepare(
      'SELECT DISTINCT tag FROM lead_tags WHERE lead_id IN (SELECT id FROM leads WHERE client_id = ?) LIMIT 20'
    ).bind(body.client_id).all();

    if (tags && tags.length > 0) {
      businessContext += `Tags existants : ${tags.map(t => t.tag).join(', ')}. `;
    }
  }

  const VALID_TYPES = ['wait', 'email', 'sms', 'task', 'condition', 'tag', 'notification'];

  const systemPrompt = `Tu es un expert en automatisation marketing pour PMEs québécoises. \
${businessContext}\
L'utilisateur décrit un besoin en langage naturel. Génère un objet JSON structuré représentant un workflow Intralys CRM. \
Format de sortie : { "name": "Nom du workflow", "description": "Description courte", "trigger_type": "lead_created|form_submitted|tag_added|manual", "steps": [...] }. \
Chaque step dans "steps" doit avoir: id (string), type (${VALID_TYPES.map(t => `'${t}'`).join('|')}), et config (objet avec les détails). \
Pour 'wait': { delay_hours: number }. Pour 'email': { subject: string, body: string }. Pour 'sms': { body: string }. \
Pour 'task': { title: string, due_in_days: number }. Pour 'tag': { tag: string }. Pour 'notification': { message: string }. \
Pour 'condition': { field: string, operator: 'eq'|'ne'|'gt'|'lt', value: string, if_true_step: string, if_false_step: string }. \
Réponds UNIQUEMENT avec le JSON valide, sans markdown autour. Maximum 6 étapes.`;

  const result = await callLLM(env, systemPrompt, body.prompt);

  try {
    const jsonStr = result.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const workflow = JSON.parse(jsonStr) as {
      name?: string;
      description?: string;
      trigger_type?: string;
      steps?: Array<{ id: string; type: string; config: Record<string, unknown> }>;
    };

    // Validation : filtrer les types invalides
    if (workflow.steps) {
      workflow.steps = workflow.steps.filter(s => VALID_TYPES.includes(s.type));
    }

    return json({
      data: {
        name: workflow.name || 'Workflow IA',
        description: workflow.description || '',
        trigger_type: workflow.trigger_type || 'manual',
        steps: workflow.steps || [],
      },
    });
  } catch (_err) {
    // Fallback mock workflow
    return json({
      data: {
        name: 'Bienvenue nouveau lead',
        description: 'Séquence de bienvenue automatique',
        trigger_type: 'lead_created',
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
