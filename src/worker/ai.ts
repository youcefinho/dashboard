// ── Module AI — Intralys CRM (Sprint 6 enrichi) ─────────────
// Claude Haiku 4.5 + 8 actions + brand_voice contextualisé
import type { Env } from './types';
import { json } from './helpers';
import { fetchWithTimeout } from './lib/fetch-timeout';

// ── LLM : Claude Haiku 4.5 via Anthropic (fallback mock) ────

/**
 * LOT RÉEL §6 — Source de vérité unique du mode mock IA.
 * true => les endpoints IA renvoient du contenu mock déterministe
 * (USE_MOCKS forcé OU aucune clé Anthropic configurée).
 * Réutilise EXACTEMENT la condition de `useMock` ci-dessous (factorisé).
 */
export function isAiMockMode(env: Env): boolean {
  return env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY;
}

async function callLLM(env: Env, systemPrompt: string, userPrompt: string): Promise<string> {
  const useMock = isAiMockMode(env);

  if (useMock) {
    // Petit délai pour simuler la latence réseau et déclencher le loading state
    await new Promise(r => setTimeout(r, 600));
    return generateMockContent(systemPrompt, userPrompt);
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
  // Sprint 49 M3.1 : mock classify-conversation (JSON tags fermés)
  if (systemPrompt.includes('Classe cette conversation')) {
    const t = userPrompt.toLowerCase();
    const picked: string[] = [];
    if (/\b(urgent|asap|au plus vite)\b/.test(t)) picked.push('urgent');
    if (/\b(prix|tarif|combien|budget|devis)\b/.test(t)) picked.push('question-prix');
    if (/\b(rendez-vous|appel|rencontre|disponib)\b/.test(t)) picked.push('rendez-vous');
    if (picked.length === 0) picked.push('demande-info');
    return JSON.stringify({ tags: picked.slice(0, 3), confidence: 0.72 });
  }
  // Sprint 49 M3.2 : mock classify-lead (JSON suggestedTags)
  if (systemPrompt.includes('suggère 2 à 4 tags')) {
    const t = userPrompt.toLowerCase();
    const tags: string[] = [];
    if (/referral|référence/.test(t)) tags.push('source-référence');
    else if (/meta|facebook|instagram/.test(t)) tags.push('source-social');
    else tags.push('source-web');
    tags.push('intent-fort', 'budget-moyen');
    return JSON.stringify({ suggestedTags: tags.slice(0, 4), confidence: 0.68 });
  }
  // Sprint 49 M3.4 : mock nl-query (JSON filters + explanation)
  if (systemPrompt.includes('parseur de requêtes CRM')) {
    const q = userPrompt.toLowerCase();
    const filters: Record<string, unknown> = {};
    if (/chaud|hot|prioritaire/.test(q)) filters.scoreMin = 70;
    if (/cette semaine|7 jours|pas contact/.test(q)) filters.lastContactDays = 7;
    if (/bloqu|stagne|dormant|n[ée]gociation/.test(q)) { filters.stage = 'negotiation'; filters.dormantDays = 5; }
    if (/perdu|lost/.test(q)) filters.status = 'lost';
    if (/gagn|won/.test(q)) filters.status = 'won';
    return JSON.stringify({ filters, explanation: 'Filtres extraits de la requête en langage naturel.' });
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

// ── Sprint 43 M3.3 : AI Drafts (3 tones — replace src/lib/aiDrafts.ts stub) ─

type DraftTone = 'short' | 'detailed' | 'awaiting';

interface DraftOption {
  id: string;
  title: string;
  body: string;
  tone: DraftTone;
}

const DRAFT_TONE_META: Record<DraftTone, { id: string; title: string; instruction: string }> = {
  short: {
    id: 'draft-short',
    title: 'Courte & directe',
    instruction: 'Rédige une réponse COURTE de 1-2 phrases (max 40 mots). Accuse réception, propose une prochaine étape concrète. Pas de formule de politesse longue.',
  },
  detailed: {
    id: 'draft-detailed',
    title: 'Détaillée & professionnelle',
    instruction: 'Rédige une réponse DÉTAILLÉE (3-4 paragraphes, 80-150 mots). Salutation personnalisée, reformulation du sujet, engagement clair sur prochaine étape, clôture cordiale.',
  },
  awaiting: {
    id: 'draft-awaiting',
    title: 'En attente d\'info — propose call',
    instruction: 'Rédige une réponse qui DEMANDE CLARIFICATION (60-100 mots). Remercie, demande 1-2 précisions concrètes sur le sujet, propose un court appel 15 min cette semaine, clôture cordiale.',
  },
};

function buildDraftSystemPrompt(tone: DraftTone, brandVoice: string, targetLang?: string): string {
  // Sprint 49 M1.4 — langue cible (multi-lingue : si le client écrit en EN/ES,
  // on rédige le brouillon dans sa langue plutôt qu'en français.)
  const lang = (targetLang || '').toLowerCase();
  let langClause = 'Utilise un français québécois informel mais professionnel (pas parisien, pas trop guindé).';
  if (lang.startsWith('en')) {
    langClause = 'Write the reply in natural professional English (the client wrote in English).';
  } else if (lang.startsWith('es')) {
    langClause = 'Redacta la respuesta en español profesional y natural (el cliente escribió en español).';
  } else if (lang === 'fr-fr') {
    langClause = 'Utilise un français standard professionnel (le client écrit en français de France).';
  }
  return `Tu es un assistant CRM pour PME québécoises francophones. \
Ton du client : ${brandVoice}. \
${langClause} \
Évite le tutoiement sauf si le ton brand l'indique. \
${DRAFT_TONE_META[tone].instruction} \
Réponds UNIQUEMENT avec le corps du message, sans préambule, sans markdown, sans guillemets.`;
}

/**
 * Génère 3 brouillons (short/detailed/awaiting) en parallèle pour un message reçu.
 * Body : { lead_id?, last_message: string, conversation_context?: string[], tones?: DraftTone[] }
 * Retour : { data: { drafts: DraftOption[] } }
 *
 * Notes :
 *  - Préserve l'API publique de src/lib/aiDrafts.ts (3 tones, mêmes ids).
 *  - Pas de streaming SSE pour le moment — réponse JSON unique (les 3 drafts générés
 *    en parallèle via Promise.all, latence ≈ 1 draft Haiku ≈ 1-2s).
 *    SSE upgrade trivial plus tard si besoin (cf TODO doc).
 *  - Fallback heuristique local si LLM échoue (préserve la robustesse du stub original).
 */
export async function handleAiDrafts(request: Request, env: Env): Promise<Response> {
  let body: {
    lead_id?: string;
    last_message?: string;
    conversation_context?: string[];
    tones?: DraftTone[];
    brand_voice?: string;
    /** Sprint 49 M1.4 — langue cible de réponse (locale i18n). */
    target_lang?: string;
  };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }

  const lastMessage = (body.last_message || '').trim();
  if (!lastMessage) return json({ error: 'last_message requis' }, 400);

  const allowedTones: DraftTone[] = ['short', 'detailed', 'awaiting'];
  const tones: DraftTone[] = (body.tones && body.tones.length > 0
    ? body.tones.filter((t): t is DraftTone => allowedTones.includes(t as DraftTone))
    : allowedTones);
  if (tones.length === 0) return json({ error: 'Au moins un tone requis' }, 400);

  // Charger contexte lead si fourni
  let leadCtxStr = '';
  let brandVoice = body.brand_voice || 'Professionnel, rassurant, québécois naturel.';
  if (body.lead_id) {
    const lead = await env.DB.prepare(
      'SELECT name, email, status, source, client_id FROM leads WHERE id = ?'
    ).bind(body.lead_id).first() as { name?: string; email?: string; status?: string; source?: string; client_id?: string } | null;
    if (lead) {
      leadCtxStr = `Contexte lead : ${lead.name || 'sans nom'}${lead.status ? ` (étape ${lead.status})` : ''}${lead.source ? `, source ${lead.source}` : ''}.\n`;
      if (lead.client_id) {
        const client = await env.DB.prepare('SELECT brand_voice FROM clients WHERE id = ?').bind(lead.client_id).first() as { brand_voice?: string } | null;
        if (client?.brand_voice) brandVoice = client.brand_voice;
      }
    }
  }

  const recentContext = (body.conversation_context || [])
    .filter(s => typeof s === 'string' && s.trim().length > 0)
    .slice(-6) // garder les 6 derniers échanges max
    .map((s, i) => `Échange ${i + 1}: ${s}`)
    .join('\n');

  const userPromptBase = `${leadCtxStr}${recentContext ? `Historique récent:\n${recentContext}\n\n` : ''}Dernier message reçu du lead :\n"""${lastMessage}"""`;

  // Génération parallèle des 3 drafts (1 appel LLM par tone)
  const drafts: DraftOption[] = await Promise.all(
    tones.map(async (tone): Promise<DraftOption> => {
      const sys = buildDraftSystemPrompt(tone, brandVoice, body.target_lang);
      const generated = await callLLM(env, sys, userPromptBase);
      const cleaned = (generated || '').trim()
        .replace(/^["«»]+/g, '')
        .replace(/["«»]+$/g, '');
      return {
        id: DRAFT_TONE_META[tone].id,
        title: DRAFT_TONE_META[tone].title,
        tone,
        body: cleaned || `Bonjour,\n\nMerci pour votre message. Je reviens vers vous rapidement.\n\nCordialement,`,
      };
    })
  );

  return json({ data: { drafts } });
}

// ── Sprint 49 M1.1 : AI Compose Suggest (ghost text inline) ──────────────────

/**
 * Suggère les prochains mots (max 12) en ghost text — Gmail Smart Compose.
 * Body : { currentDraft: string, conversationContext?: string, locale?: string }
 * Retour : { data: { suggestion: string } }
 *
 * Low-latency : un seul appel Haiku, suite courte attendue.
 * Fallback : '' si LLM KO (le client a son propre fallback heuristique local).
 */
export async function handleAiComposeSuggest(request: Request, env: Env): Promise<Response> {
  let body: { currentDraft?: string; conversationContext?: string; locale?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }

  const draft = (body.currentDraft || '').trim();
  if (!draft || draft.split(/\s+/).filter(Boolean).length < 3) {
    return json({ data: { suggestion: '' } });
  }

  const locale = body.locale || 'fr-CA';
  const isEn = locale.toLowerCase().startsWith('en');
  const isEs = locale.toLowerCase().startsWith('es');
  const langName = isEn ? 'English' : isEs ? 'Spanish' : 'français québécois naturel';

  const systemPrompt = `Tu es un moteur d'autocomplétion type Gmail Smart Compose pour un CRM PME québécois. \
Continue le brouillon de l'utilisateur par UNE suite naturelle de MAXIMUM 12 mots, dans la même langue (${langName}). \
Ne répète pas le texte déjà écrit. Ne reformule pas. Ne commence pas par une majuscule sauf si début de phrase. \
Si aucune suite évidente, réponds EXACTEMENT par une chaîne vide. \
Réponds UNIQUEMENT par la suite proposée, sans guillemets, sans préambule, sans retour ligne.`;

  const ctx = (body.conversationContext || '').slice(0, 800);
  const userPrompt = `${ctx ? `Contexte conversation :\n"""${ctx}"""\n\n` : ''}Brouillon en cours (continue-le) :\n"""${draft}"""`;

  const raw = await callLLM(env, systemPrompt, userPrompt);
  const cleaned = (raw || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["«»']+/, '')
    .replace(/["«»']+$/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .join(' ');

  return json({ data: { suggestion: cleaned } });
}

// ── Sprint 49 M1.3 : AI Proofread (relecture FR québécois) ───────────────────

interface ProofreadIssueWire {
  start: number;
  end: number;
  type: 'orthographe' | 'grammaire' | 'accord' | 'anglicisme';
  suggestion: string;
  message: string;
  optional?: boolean;
}

/**
 * Relecture non-intrusive : retourne une liste d'issues localisées.
 * Body : { text: string, locale?: string }
 * Retour : { data: { issues: ProofreadIssueWire[] } }
 *
 * Le LLM renvoie des paires (segment fautif, suggestion) qu'on re-mappe
 * sur des index réels via indexOf (robuste si le LLM décale les offsets).
 * Fallback : { issues: [] } si LLM KO (le client a son dico local QC).
 */
export async function handleAiProofread(request: Request, env: Env): Promise<Response> {
  let body: { text?: string; locale?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }

  const text = (body.text || '').trim();
  if (!text || text.split(/\s+/).filter(Boolean).length < 3) {
    return json({ data: { issues: [] } });
  }
  const safeText = text.slice(0, 3000);

  const systemPrompt = `Tu es un correcteur de français québécois pour un CRM PME. \
Repère UNIQUEMENT les vraies erreurs : orthographe, grammaire, accord, anglicisme. \
Spécial Québec : les anglicismes courants ("céduler", "canceller", "booker") sont signalés mais marqués "optional": true (usage québécois accepté). \
NE corrige PAS le style, le ton, ni les choix de mots valides. Sois conservateur : en cas de doute, ne signale rien. \
Réponds UNIQUEMENT en JSON valide, sans markdown : \
{"issues":[{"segment":"<texte fautif EXACT tel qu'il apparaît>","type":"orthographe|grammaire|accord|anglicisme","suggestion":"<correction>","message":"<explication courte FR>","optional":false}]}. \
Si aucune erreur : {"issues":[]}.`;

  const result = await callLLM(env, systemPrompt, `Texte à relire :\n"""${safeText}"""`);

  let parsed: { issues?: Array<{ segment?: string; type?: string; suggestion?: string; message?: string; optional?: boolean }> } = {};
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch { /* fallback ci-dessous */ }

  const validTypes = ['orthographe', 'grammaire', 'accord', 'anglicisme'];
  const issues: ProofreadIssueWire[] = [];
  let searchFrom = 0;

  for (const raw of parsed.issues || []) {
    const segment = (raw.segment || '').trim();
    const suggestion = (raw.suggestion || '').trim();
    if (!segment || !suggestion) continue;
    const idx = safeText.indexOf(segment, searchFrom);
    if (idx === -1) continue;
    const type = (validTypes.includes(raw.type || '') ? raw.type : 'orthographe') as ProofreadIssueWire['type'];
    issues.push({
      start: idx,
      end: idx + segment.length,
      type,
      suggestion,
      message: (raw.message || '').slice(0, 160) || 'Suggestion de correction.',
      optional: Boolean(raw.optional),
    });
    searchFrom = idx + segment.length;
  }

  return json({ data: { issues } });
}

// ── Sprint 49 M3 — Auto-tag conversations + leads + NL query ─────────
// Suggestion uniquement (jamais auto-apply — Loi 25 friendly : transparence
// IA, l'utilisateur garde le contrôle). Fallback déterministe local côté
// frontend (src/lib/autoTag.ts / autoTagLead.ts / nlQuery.ts) si l'endpoint
// est down. Ici on enrichit avec Claude Haiku + un fallback keyword serveur.

const CONV_TAG_VOCAB = [
  'urgent', 'question-prix', 'demande-info', 'plainte',
  'prêt-à-acheter', 'lead-froid', 'relance-nécessaire', 'rendez-vous',
] as const;

// Keyword-matching FR québécois — utilisé en fallback serveur si le LLM
// retourne du JSON invalide (le frontend a aussi son propre fallback).
const CONV_KEYWORD_RULES: Array<{ tag: string; re: RegExp }> = [
  { tag: 'urgent', re: /\b(urgent|au plus vite|asap|aujourd'?hui|tout de suite|presse|rapidement|d[èe]s que possible)\b/i },
  { tag: 'question-prix', re: /\b(prix|co[ûu]te?|tarif|combien|budget|devis|soumission|estim[ée]|cher|paiement|facture)\b/i },
  { tag: 'demande-info', re: /\b(information|renseignement|en savoir plus|d[ée]tails|comment|est-ce que|pourriez-vous|j'?aimerais savoir)\b/i },
  { tag: 'plainte', re: /\b(d[ée][çc]u|insatisfait|probl[èe]me|plainte|remboursement|inacceptable|m[ée]content|pas content|nul|arnaque)\b/i },
  { tag: 'prêt-à-acheter', re: /\b(je veux|on signe|pr[êe]t[e]? [àa] (commencer|acheter|signer)|allons-y|c'?est bon pour moi|je confirme|on y va|quand peut-on (commencer|d[ée]marrer))\b/i },
  { tag: 'lead-froid', re: /\b(pas int[ée]ress[ée]|plus tard|peut-[êe]tre|on verra|pas pour l'?instant|trop t[ôo]t|je vous recontacte)\b/i },
  { tag: 'relance-nécessaire', re: /\b(toujours pas|j'?attends|aucune nouvelle|relance|suivi|vous m'?aviez dit|on devait)\b/i },
  { tag: 'rendez-vous', re: /\b(rendez-vous|rencontre|appel|disponib|c[ée]dule|agenda|quand (?:[êe]tes|seriez)-vous|prendre un moment|planifier)\b/i },
];

function keywordTagsConversation(text: string): string[] {
  const out: string[] = [];
  for (const { tag, re } of CONV_KEYWORD_RULES) {
    if (re.test(text)) out.push(tag);
  }
  return out.slice(0, 4);
}

/**
 * POST /api/ai/classify-conversation
 * Body : { conversationId, lastMessages? } (lastMessages optionnel — sinon
 *         chargé depuis D1 : 12 derniers messages).
 * Retour : { data: { tags: string[], confidence: number } }
 * Suggestion uniquement — aucune écriture en DB.
 */
export async function handleAiClassifyConversation(request: Request, env: Env): Promise<Response> {
  let body: { conversationId?: string; conversation_id?: string; lastMessages?: string[] };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }
  const convId = body.conversationId || body.conversation_id;
  if (!convId && (!body.lastMessages || body.lastMessages.length === 0)) {
    return json({ error: 'conversationId ou lastMessages requis' }, 400);
  }

  let transcript = '';
  if (body.lastMessages && body.lastMessages.length > 0) {
    transcript = body.lastMessages.slice(-12).join('\n');
  } else if (convId) {
    const rows = await env.DB.prepare(
      `SELECT direction, sender_name, body FROM messages
       WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 12`
    ).bind(convId).all();
    const msgs = (rows.results || []) as Array<Record<string, unknown>>;
    transcript = [...msgs].reverse().map(m => {
      const who = m.direction === 'outbound' ? 'Nous' : (m.sender_name || 'Client');
      return `${who}: ${m.body}`;
    }).join('\n');
  }

  if (!transcript.trim()) {
    return json({ data: { tags: [], confidence: 0 } });
  }

  const systemPrompt = `Tu es un assistant CRM pour PME québécoise. \
Classe cette conversation en sélectionnant les tags pertinents PARMI cette liste fermée : \
${CONV_TAG_VOCAB.join(', ')}. \
N'invente AUCUN autre tag. Choisis 1 à 3 tags maximum, les plus pertinents. \
Réponds UNIQUEMENT en JSON valide (sans markdown) au format : \
{"tags":["tag1","tag2"],"confidence":0.0-1.0}. \
confidence = ta certitude globale.`;

  const result = await callLLM(env, systemPrompt, `Conversation :\n${transcript}`);

  let tags: string[] = [];
  let confidence = 0.5;
  try {
    const m = result.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as { tags?: string[]; confidence?: number };
      tags = (parsed.tags || []).filter((t): t is string => typeof t === 'string' && (CONV_TAG_VOCAB as readonly string[]).includes(t));
      if (typeof parsed.confidence === 'number') confidence = Math.max(0, Math.min(1, parsed.confidence));
    }
  } catch { /* fallback ci-dessous */ }

  if (tags.length === 0) {
    tags = keywordTagsConversation(transcript);
    confidence = tags.length > 0 ? 0.45 : 0;
  }

  return json({ data: { tags: tags.slice(0, 3), confidence } });
}

const LEAD_TAG_FALLBACK_SOURCES: Record<string, string> = {
  meta: 'source-social', facebook: 'source-social', instagram: 'source-social',
  google: 'source-paid', google_ads: 'source-paid',
  referral: 'source-référence', website: 'source-web', direct: 'source-web',
  manual: 'source-manuel',
};

function deterministicLeadTags(lead: Record<string, unknown>): string[] {
  const out: string[] = [];
  const src = String(lead.source || '').toLowerCase();
  if (LEAD_TAG_FALLBACK_SOURCES[src]) out.push(LEAD_TAG_FALLBACK_SOURCES[src]!);
  const val = Number(lead.deal_value) || 0;
  if (val >= 50000) out.push('budget-élevé');
  else if (val >= 10000) out.push('budget-moyen');
  else if (val > 0) out.push('budget-modeste');
  const score = Number(lead.score) || 0;
  if (score >= 70) out.push('intent-fort');
  else if (score < 40 && score > 0) out.push('intent-faible');
  return out.slice(0, 4);
}

/**
 * POST /api/ai/classify-lead
 * Body : { leadId?, leadData? } — leadData optionnel (sinon chargé depuis D1).
 * Retour : { data: { suggestedTags: string[], confidence: number } }
 * Suggestion uniquement — aucune écriture lead_tags.
 */
export async function handleAiClassifyLead(request: Request, env: Env): Promise<Response> {
  let body: { leadId?: string; lead_id?: string; leadData?: Record<string, unknown> };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }
  const leadId = body.leadId || body.lead_id;
  let lead: Record<string, unknown> | null = body.leadData || null;
  if (!lead && leadId) {
    lead = await env.DB.prepare(
      `SELECT name, email, status, score, source, message, notes, deal_value, company, city
       FROM leads WHERE id = ?`
    ).bind(leadId).first() as Record<string, unknown> | null;
  }
  if (!lead) return json({ error: 'leadId ou leadData requis' }, 400);

  const systemPrompt = `Tu es un expert en qualification de leads pour PME québécoise. \
Analyse ce lead et suggère 2 à 4 tags courts (kebab-case, sans accents superflus) qui décrivent : \
son industrie probable, son intention, son tier de budget, et la qualité de sa source. \
Exemples de format : "industrie-construction", "intent-fort", "budget-élevé", "source-référence". \
Réponds UNIQUEMENT en JSON valide (sans markdown) au format : \
{"suggestedTags":["tag1","tag2"],"confidence":0.0-1.0}.`;

  const result = await callLLM(env, systemPrompt, `Lead : ${JSON.stringify(lead)}`);

  let suggestedTags: string[] = [];
  let confidence = 0.5;
  try {
    const m = result.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as { suggestedTags?: string[]; confidence?: number };
      suggestedTags = (parsed.suggestedTags || [])
        .filter((t): t is string => typeof t === 'string' && t.length > 1 && t.length <= 40)
        .map(t => t.toLowerCase().trim().replace(/\s+/g, '-'))
        .slice(0, 4);
      if (typeof parsed.confidence === 'number') confidence = Math.max(0, Math.min(1, parsed.confidence));
    }
  } catch { /* fallback */ }

  if (suggestedTags.length === 0) {
    suggestedTags = deterministicLeadTags(lead);
    confidence = suggestedTags.length > 0 ? 0.4 : 0;
  }

  return json({ data: { suggestedTags, confidence } });
}

/**
 * POST /api/ai/nl-query
 * Body : { query, locale? } → parse la requête en langage naturel en filtres
 * structurés applicables aux pages Leads/Pipeline/Tasks via URL params.
 * Retour : { data: { filters: {...}, explanation: string } }
 */
export async function handleAiNlQuery(request: Request, env: Env): Promise<Response> {
  let body: { query?: string; locale?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }
  const query = (body.query || '').trim();
  if (!query) return json({ error: 'query requis' }, 400);

  const systemPrompt = `Tu es un parseur de requêtes CRM pour PME québécoise. \
L'utilisateur décrit en langage naturel (FR québécois ou EN) les leads/deals qu'il cherche. \
Extrais des filtres structurés. Champs disponibles (tous optionnels) : \
status (new|contacted|qualified|won|lost), source (meta|google|website|referral|manual|direct), \
scoreMin (0-100, leads "chauds" = 70), stage (texte libre nom d'étape pipeline), \
dormantDays (entier, "bloqué/stagne depuis X jours"), lastContactDays (entier, "pas contacté depuis X jours / cette semaine = 7"), \
tag (texte libre), target ("leads"|"pipeline"|"tasks", défaut "leads"). \
Réponds UNIQUEMENT en JSON valide (sans markdown) : \
{"filters":{...},"explanation":"<reformulation courte FR de ce qui sera filtré>"}. \
N'inclus QUE les champs détectés. Si rien de clair : {"filters":{},"explanation":"..."}.`;

  const result = await callLLM(env, systemPrompt, `Requête : ${query}\nLangue : ${body.locale || 'fr-CA'}`);

  let filters: Record<string, unknown> = {};
  let explanation = '';
  try {
    const m = result.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as { filters?: Record<string, unknown>; explanation?: string };
      const allowed = ['status', 'source', 'scoreMin', 'stage', 'dormantDays', 'lastContactDays', 'tag', 'target'];
      const f = parsed.filters || {};
      for (const k of allowed) {
        if (f[k] !== undefined && f[k] !== null && f[k] !== '') filters[k] = f[k];
      }
      explanation = typeof parsed.explanation === 'string' ? parsed.explanation : '';
    }
  } catch { /* fallback frontend regex */ }

  return json({ data: { filters, explanation: explanation || `Recherche : « ${query} »` } });
}

/**
 * Fallback local déterministe pour générer 3 suggestions types de réponses québécoises
 * basées sur le sentiment ou l'intention du dernier message inbound.
 */
function localSuggestRepliesFallback(
  lastMessageText: string,
  intent: string | null,
  sentiment: string | null,
  leadName: string | null
): string[] {
  const namePhrase = leadName ? ` ${leadName}` : '';
  const text = lastMessageText.toLowerCase();

  // Détection d'intentions si non passée
  let resolvedIntent = intent;
  if (!resolvedIntent) {
    if (/\b(prix|tarif|combien|budget|devis|coûte|cout)\b/.test(text)) {
      resolvedIntent = 'pricing';
    } else if (/\b(rendez-vous|appel|rencontre|disponib|rencontrer|call|visite|rdv)\b/.test(text)) {
      resolvedIntent = 'appointment';
    } else if (/\b(stop|désabonner|desabonner|quitter|unsubscribe)\b/.test(text)) {
      resolvedIntent = 'opt_out';
    }
  }

  // 1. Apaisement si sentiment fâché/colère
  if (sentiment === 'Fâché' || sentiment === 'Colère' || /\b(pas content|mauvais|nul|inacceptable|colere|fache|insatisfait)\b/.test(text)) {
    return [
      `Bonjour${namePhrase}, je suis sincèrement désolé pour cette situation. Je propose qu'on s'appelle brièvement pour clarifier les choses de vive voix. Quel moment vous conviendrait?`,
      `Je comprends tout à fait votre frustration${namePhrase}. Laissez-moi faire les vérifications nécessaires dès maintenant et je reviens vers vous avec une solution concrète.`,
      `Toutes nos excuses pour ces inconvénients. Je transmets immédiatement votre dossier à notre responsable pour qu'il puisse régler cela au plus vite.`
    ];
  }

  // 2. Si désabonnement / opt-out
  if (resolvedIntent === 'opt_out' || resolvedIntent === 'unsubscribe' || resolvedIntent === 'Désabonnement') {
    return [
      `C'est bien noté. Vous avez été désabonné de nos communications. Bonne continuation.`,
      `Bonjour, votre demande a été prise en compte. Vous ne recevrez plus de messages de notre part.`,
      `C'est fait, nous avons retiré vos coordonnées de nos listes de contacts. Bonne journée.`
    ];
  }

  // 3. Intention de Prix / Tarifs
  if (resolvedIntent === 'pricing' || resolvedIntent === 'price_objection' || resolvedIntent === 'Prix trop cher') {
    return [
      `Bonjour${namePhrase}! Notre rencontre stratégique est 100% gratuite et sans engagement. Nous pourrons évaluer ensemble vos besoins afin de vous proposer un plan adapté à votre budget.`,
      `Nos tarifs sont très compétitifs et s'adaptent à vos objectifs. Seriez-vous disponible pour un court appel de 15 minutes afin que je puisse vous donner une estimation juste?`,
      `Je serais ravi de vous envoyer notre grille de services par courriel. Pouvez-vous me confirmer votre adresse courriel préférée?`
    ];
  }

  // 4. Intention de Prendre RDV / Disponibilités
  if (resolvedIntent === 'appointment' || resolvedIntent === 'meeting' || resolvedIntent === 'Prendre RDV') {
    return [
      `Avec plaisir${namePhrase}! Vous pouvez choisir le moment qui vous convient le mieux directement dans mon calendrier ici : [Lien Calendly].`,
      `Bonjour! Je serais ravi de vous rencontrer pour notre rencontre stratégique gratuite. Seriez-vous disponible ce jeudi à 14h ou ce vendredi à 10h?`,
      `C'est noté! Pour notre appel de 15 minutes, quel numéro de téléphone devrais-je privilégier pour vous joindre?`
    ];
  }

  // 5. Par défaut (salutations ou relance générale)
  return [
    `Bonjour${namePhrase}! J'espère que vous allez bien. Comment puis-je vous aider dans votre projet aujourd'hui?`,
    `Merci pour votre intérêt! Je vous propose qu'on s'appelle brièvement (15 minutes) pour faire le tour de vos questions. Seriez-vous disponible cette semaine?`,
    `Bonjour! Je voulais simplement faire un suivi pour savoir si vous aviez toujours de l'intérêt pour notre accompagnement. Au plaisir!`
  ];
}

/**
 * POST /api/ai/suggest-replies
 * Body : { conversation_id }
 * Retour : { data: { suggestions: string[] } }
 */
export async function handleAiSuggestReplies(request: Request, env: Env): Promise<Response> {
  let body: { conversation_id?: string; conversationId?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }
  
  const conversationId = body.conversation_id || body.conversationId;
  if (!conversationId) return json({ error: 'conversation_id requis' }, 400);

  // 1. Charger conversation + lead associé
  const conv = await env.DB.prepare(
    `SELECT c.lead_id, l.name as lead_name, l.email as lead_email, l.status as lead_status, 
            l.source as lead_source, l.message as lead_message, l.notes as lead_notes, l.client_id
     FROM conversations c
     LEFT JOIN leads l ON c.lead_id = l.id
     WHERE c.id = ?`
  ).bind(conversationId).first() as {
    lead_id: string | null;
    lead_name: string | null;
    lead_email: string | null;
    lead_status: string | null;
    lead_source: string | null;
    lead_message: string | null;
    lead_notes: string | null;
    client_id: string | null;
  } | null;

  if (!conv) return json({ error: 'Conversation introuvable' }, 404);

  // 2. Charger les 10 derniers messages
  const { results: messages } = await env.DB.prepare(
    `SELECT direction, channel, body, created_at, sender_name, sentiment, detected_intent
     FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT 10`
  ).bind(conversationId).all() as {
    results: Array<{
      direction: string;
      channel: string;
      body: string;
      created_at: string;
      sender_name: string | null;
      sentiment: string | null;
      detected_intent: string | null;
    }>;
  };

  // Trouver le dernier message entrant pour l'analyse locale / sentiment
  const lastInbound = (messages || []).find(m => m.direction === 'inbound');
  const lastInboundText = lastInbound?.body || conv.lead_message || '';
  const lastInboundIntent = lastInbound?.detected_intent || null;
  const lastInboundSentiment = lastInbound?.sentiment || null;

  // 3. Charger le brand voice du client
  let brandVoice = 'Professionnel, chaleureux et québécois naturel.';
  if (conv.client_id) {
    const client = await env.DB.prepare(
      'SELECT brand_voice FROM clients WHERE id = ?'
    ).bind(conv.client_id).first() as { brand_voice?: string } | null;
    if (client?.brand_voice) {
      brandVoice = client.brand_voice;
    }
  }

  // 4. Si mock activé, renvoyer immédiatement les suggestions locales
  if (isAiMockMode(env)) {
    const suggestions = localSuggestRepliesFallback(
      lastInboundText,
      lastInboundIntent,
      lastInboundSentiment,
      conv.lead_name
    );
    return json({ data: { suggestions } });
  }

  // 5. Sinon, appeler Claude Haiku
  const baseSystem = `Tu es un copilote commercial IA pour un courtier immobilier ou une PME au Québec. \
Ton du client : ${brandVoice}. \
Utilise un français québécois naturel (pas parisien), chaleureux et professionnel. \
Évite le tutoiement sauf si le profil du client ou l'historique l'indique clairement. \
En te basant sur le profil du lead et l'historique récent de la conversation, génère EXACTEMENT 3 suggestions de réponses courtes (max 40 mots chacune). \
Les suggestions doivent être concrètes et adaptées aux derniers échanges. Elles doivent correspondre aux 3 intentions suivantes : \
1. Option A (Rendez-vous) : Proposer ou fixer un rendez-vous (ex: rencontre stratégique gratuite, appel de 15 minutes, partage de calendrier Calendly). \
2. Option B (Information / Prix) : Répondre aux questions posées (prix, détails sur un service) ou donner des informations utiles. \
3. Option C (Générale / Relance) : Une réponse générale, courtoise ou une relance amicale pour inciter le lead à répondre. \
\
Tu dois renvoyer UNIQUEMENT un tableau JSON de chaînes de caractères (sans markdown, sans en-tête ni enrobage) contenant exactement 3 éléments. \
Exemple de format attendu : \
[ \
  "Suggestion A", \
  "Suggestion B", \
  "Suggestion C" \
]`;

  const leadInfo = {
    name: conv.lead_name,
    email: conv.lead_email,
    status: conv.lead_status,
    source: conv.lead_source,
    message_original: conv.lead_message,
    notes: conv.lead_notes
  };

  const chronologicalMessages = [...(messages || [])].reverse();
  const transcript = chronologicalMessages.map(m => {
    const who = m.direction === 'outbound' ? 'Nous' : (m.sender_name || 'Client');
    return `${who}: ${m.body}${m.sentiment ? ` (Sentiment: ${m.sentiment})` : ''}${m.detected_intent ? ` (Intention: ${m.detected_intent})` : ''}`;
  }).join('\n');

  const userPrompt = `Profil du Lead : ${JSON.stringify(leadInfo)}\n\nHistorique récent de la conversation :\n${transcript || '(Aucun message encore)'}`;

  try {
    const result = await callLLM(env, baseSystem, userPrompt);
    
    // Tentative de parsing
    let suggestions: string[] = [];
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      suggestions = JSON.parse(jsonMatch[0]) as string[];
    }

    if (Array.isArray(suggestions) && suggestions.length === 3) {
      return json({ data: { suggestions: suggestions.map(s => s.trim()) } });
    }
  } catch (err) {
    console.error('Erreur suggestions AI:', err);
  }

  // Fallback local si LLM ou parsing échoue
  const suggestions = localSuggestRepliesFallback(
    lastInboundText,
    lastInboundIntent,
    lastInboundSentiment,
    conv.lead_name
  );
  return json({ data: { suggestions } });
}

/**
 * Fallback local déterministe pour générer le rapport hebdomadaire IA
 * basé sur les métriques et deltas calculés en SQLite/D1.
 */
function localWeeklyInsightFallback(metrics: any): string {
  const leadsPct = metrics.leads_delta_pct >= 0 ? `une hausse de **${metrics.leads_delta_pct}%**` : `une baisse de **${Math.abs(metrics.leads_delta_pct)}%**`;
  const dealsText = metrics.deals_won_this_week > 0 ? `vous avez conclu **${metrics.deals_won_this_week} ventes**` : `aucune vente n'a été conclue cette semaine`;
  
  return `### 🌟 Points forts de la semaine
- **Acquisition de leads** : Nous constatons ${leadsPct} du nombre de nouveaux contacts par rapport à la semaine précédente, avec un total de **${metrics.leads_this_week} nouveaux leads**.
- **Engagement client** : Un volume d'échanges soutenu avec **${metrics.messages_count} messages** échangés, montrant un intérêt marqué de vos prospects.

### ⚠️ Opportunités d'amélioration
- **Conversion du pipeline** : Actuellement, ${dealsText}. Il y a un volume de **${(metrics.pipeline_value / 1000).toFixed(1)}K $** de transactions potentiellement actives en cours de négociation qui méritent une attention immédiate.
- **Réactivité** : Certains leads n'ont pas reçu de suivi régulier depuis plus de 48 heures.

### 🎯 Plan d'action recommandé
1. **Prioriser les relances** : Contacter en priorité les leads de l'étape *Négociation* pour sécuriser les ventes du mois.
2. **Optimiser le Calendly** : Proposer activement des rencontres stratégiques gratuites via SMS copilote.
3. **Mettre à jour les fiches** : Qualifier et taguer les nouveaux prospects entrants pour affiner le ciblage.`;
}

/**
 * GET /api/ai/weekly-insight
 * Retourne le dernier rapport d'insight hebdomadaire généré pour le client.
 */
export async function handleGetWeeklyInsight(_request: Request, env: Env, auth: { userId: string; role: string; clientId?: string }): Promise<Response> {
  const clientId = auth.clientId || 'default-client';
  
  const lastInsight = await env.DB.prepare(
    `SELECT * FROM weekly_ai_insights 
     WHERE client_id = ? 
     ORDER BY created_at DESC 
     LIMIT 1`
  ).bind(clientId).first() as {
    id: string;
    client_id: string;
    content: string;
    metric_changes_json: string;
    created_at: string;
  } | null;

  return json({ data: lastInsight });
}

/**
 * POST /api/ai/weekly-insight/generate
 * Calcule les métriques hebdomadaires, interroge l'IA et stocke le rapport narratif.
 */
export async function handleGenerateWeeklyInsight(_request: Request, env: Env, auth: { userId: string; role: string; clientId?: string }): Promise<Response> {
  const clientId = auth.clientId || 'default-client';

  // 1. Calculer les métriques D1 en parallèle
  const [
    leadsThisWeekRow,
    leadsPrevWeekRow,
    dealsWonThisWeekRow,
    dealsWonPrevWeekRow,
    pipelineValueRow,
    messagesCountRow
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) as count FROM leads WHERE client_id = ? AND created_at >= datetime('now', '-7 days')`
    ).bind(clientId).first() as Promise<{ count: number } | null>,
    env.DB.prepare(
      `SELECT COUNT(*) as count FROM leads WHERE client_id = ? AND created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')`
    ).bind(clientId).first() as Promise<{ count: number } | null>,
    env.DB.prepare(
      `SELECT COUNT(*) as count FROM leads WHERE client_id = ? AND status = 'won' AND updated_at >= datetime('now', '-7 days')`
    ).bind(clientId).first() as Promise<{ count: number } | null>,
    env.DB.prepare(
      `SELECT COUNT(*) as count FROM leads WHERE client_id = ? AND status = 'won' AND updated_at >= datetime('now', '-14 days') AND updated_at < datetime('now', '-7 days')`
    ).bind(clientId).first() as Promise<{ count: number } | null>,
    env.DB.prepare(
      `SELECT SUM(deal_value) as val FROM leads WHERE client_id = ? AND status NOT IN ('won', 'lost')`
    ).bind(clientId).first() as Promise<{ val: number } | null>,
    env.DB.prepare(
      `SELECT COUNT(*) as count FROM messages m 
       JOIN leads l ON m.lead_id = l.id 
       WHERE l.client_id = ? AND m.created_at >= datetime('now', '-7 days')`
    ).bind(clientId).first() as Promise<{ count: number } | null>
  ]);

  const leadsThisWeek = Number(leadsThisWeekRow?.count || 0);
  const leadsPrevWeek = Number(leadsPrevWeekRow?.count || 0);
  let leadsDeltaPct = 0;
  if (leadsPrevWeek > 0) {
    leadsDeltaPct = Math.round(((leadsThisWeek - leadsPrevWeek) / leadsPrevWeek) * 100);
  } else if (leadsThisWeek > 0) {
    leadsDeltaPct = 100;
  }

  const dealsWonThisWeek = Number(dealsWonThisWeekRow?.count || 0);
  const dealsWonPrevWeek = Number(dealsWonPrevWeekRow?.count || 0);
  const dealsWonDelta = dealsWonThisWeek - dealsWonPrevWeek;

  const pipelineValue = Number(pipelineValueRow?.val || 0);
  const messagesCount = Number(messagesCountRow?.count || 0);

  const metrics = {
    leads_this_week: leadsThisWeek,
    leads_prev_week: leadsPrevWeek,
    leads_delta_pct: leadsDeltaPct,
    deals_won_this_week: dealsWonThisWeek,
    deals_won_prev_week: dealsWonPrevWeek,
    deals_won_delta: dealsWonDelta,
    pipeline_value: pipelineValue,
    messages_count: messagesCount
  };

  // 2. Charger le brand voice du client
  let brandVoice = 'Professionnel, chaleureux et québécois naturel.';
  const client = await env.DB.prepare(
    'SELECT brand_voice FROM clients WHERE id = ?'
  ).bind(clientId).first() as { brand_voice?: string } | null;
  if (client?.brand_voice) {
    brandVoice = client.brand_voice;
  }

  let content = '';

  // 3. Si mode mock, appeler le fallback local
  if (isAiMockMode(env)) {
    content = localWeeklyInsightFallback(metrics);
  } else {
    // 4. Sinon, inférence Claude Haiku
    const systemPrompt = `Tu es un expert en intelligence d'affaires pour les agences immobilières et PME au Québec. \
Ton du client : ${brandVoice}. \
Analyse les KPIs de la semaine écoulée comparés à la semaine précédente, et rédige un rapport hebdomadaire narratif en français québécois naturel. \
Le ton doit être professionnel, encourageant, perspicace et orienté vers l'action commerciale. \
\
Formatte ton rapport en Markdown avec EXACTEMENT les 3 sections suivantes : \
### 🌟 Points forts de la semaine \
<Analyse des réussites, par exemple hausse des leads, deals gagnés ou forte activité de messagerie. Sois concret et concis.> \
\
### ⚠️ Opportunités d'amélioration \
<Analyse des points faibles, baisse de performance ou leads dormants à réactiver.> \
\
### 🎯 Plan d'action recommandé \
<3 recommandations ultra-précises et actionnables pour la semaine prochaine (ex: relancer tel segment, proposer tel CTA, etc.).> \
\
Voici les métriques de la semaine : \
${JSON.stringify(metrics, null, 2)}`;

    try {
      content = await callLLM(env, systemPrompt, `Calcule l'analyse narrative des KPIs.`);
    } catch (err) {
      console.error('Erreur génération Weekly Insight LLM:', err);
      content = localWeeklyInsightFallback(metrics);
    }
  }

  // 5. Enregistrer en base de données
  const insightId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO weekly_ai_insights (id, client_id, content, metric_changes_json, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(insightId, clientId, content, JSON.stringify(metrics)).run();

  return json({
    data: {
      id: insightId,
      client_id: clientId,
      content,
      metric_changes_json: JSON.stringify(metrics),
      created_at: new Date().toISOString()
    }
  });
}



