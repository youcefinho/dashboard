import type { Env } from '../types';

/** Normalise un texte (minuscule, sans accent, sans espace superflu). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Fallback local déterministe basé sur des heuristiques de mots-clés.
 * Utilisé si env.AI est absent ou en cas d'erreur de Workers AI.
 */
export function analyzeSentimentAndIntentFallback(text: string): { sentiment: string; intent: string } {
  if (!text || text.trim().length === 0) {
    return { sentiment: 'Neutre', intent: 'Autre' };
  }

  const normalized = normalize(text);

  // 1. Classification du sentiment
  let sentiment = 'Neutre';
  const angerWords = [
    'fache', 'colere', 'honteux', 'nul', 'mauvais', 'remboursement', 'decu',
    'insatisfait', 'angry', 'irritated', 'inacceptable', 'merde', 'arnaque',
    'horrible', 'decue', 'plainte', 'scandaleux', 'rembourser', 'pire',
    'remboursez', 'incompetent', 'inutilisable', 'rembourse'
  ];
  const positiveWords = [
    'genial', 'super', 'merci', 'cool', 'bravo', 'parfait', 'excellent',
    'adore', 'enthousiaste', 'happy', 'great', 'content', 'heureux',
    'ravi', 'top', 'magnifique', 'extra', 'formidable', 'merveilleux'
  ];

  // Détection de ponctuation excessive indiquant la colère/urgence
  const hasMultipleExclamations = (text.match(/!/g) || []).length >= 2;

  if (angerWords.some(w => normalized.includes(w)) || (hasMultipleExclamations && normalized.includes('pas'))) {
    sentiment = 'Fâché';
  } else if (positiveWords.some(w => normalized.includes(w))) {
    sentiment = 'Enthousiaste';
  }

  // 2. Classification de l'intention
  let intent = 'Autre';
  const rdvWords = [
    'rdv', 'rendez-vous', 'rencontre', 'rencontrer', 'date', 'calendar',
    'calendrier', 'reserver', 'book', 'meeting', 'disponibilite', 'dispo',
    'disponibles', 'creneau', 'horaire', 'heure', 'planning', 'agenda'
  ];
  const priceWords = [
    'prix', 'cher', 'tarif', 'cout', 'chere', 'payer', 'dollars', '$',
    'budget', 'facture', 'mensuel', 'abonnement', 'combien', 'tard',
    'cheres', 'frais'
  ];
  const unsubWords = [
    'stop', 'desabonner', 'quitter', 'unsubscribe', 'annuler', 'retirer',
    'ne plus recevoir', 'desabonnement', 'unsub'
  ];

  if (unsubWords.some(w => normalized.includes(w))) {
    intent = 'Désabonnement';
  } else if (rdvWords.some(w => normalized.includes(w))) {
    intent = 'Prendre RDV';
  } else if (priceWords.some(w => normalized.includes(w))) {
    intent = 'Prix trop cher';
  }

  return { sentiment, intent };
}

/**
 * Analyse le texte en entrée pour détecter le sentiment et l'intention.
 * Utilise le binding Workers AI (@cf/anthropic/claude-3-haiku-20240307) si présent,
 * avec un fallback silencieux et résilient sur les heuristiques locales.
 */
export async function analyzeSentimentAndIntent(
  env: Env,
  text: string
): Promise<{ sentiment: string; intent: string }> {
  if (!text || text.trim().length === 0) {
    return { sentiment: 'Neutre', intent: 'Autre' };
  }

  const ai = (env as unknown as { AI?: { run: (model: string, args: unknown) => Promise<unknown> } }).AI;
  if (!ai || typeof ai.run !== 'function') {
    return analyzeSentimentAndIntentFallback(text);
  }

  try {
    const systemPrompt =
      'Tu es un agent expert en analyse de messages clients pour un CRM immobilier et commercial.\n' +
      'Analyse le sentiment et l\'intention du texte fourni par l\'utilisateur.\n\n' +
      'Sentiment (uniquement l\'un de ceux-ci) :\n' +
      '- "Fâché"\n' +
      '- "Neutre"\n' +
      '- "Enthousiaste"\n\n' +
      'Intention (uniquement l\'un de ceux-ci) :\n' +
      '- "Prendre RDV"\n' +
      '- "Prix trop cher"\n' +
      '- "Désabonnement"\n' +
      '- "Autre"\n\n' +
      'Réponds UNIQUEMENT sous la forme d\'un objet JSON valide au format strict suivant, sans aucun autre texte :\n' +
      '{"sentiment": "<Fâché|Neutre|Enthousiaste>", "intent": "<Prendre RDV|Prix trop cher|Désabonnement|Autre>"}';

    const result = await ai.run('@cf/anthropic/claude-3-haiku-20240307', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    }) as any;

    let respText = '';
    if (typeof result === 'string') {
      respText = result;
    } else if (result && typeof result === 'object') {
      if (typeof result.response === 'string') respText = result.response;
      else if (result.result && typeof result.result.response === 'string') {
        respText = result.result.response;
      }
    }

    if (!respText || respText.trim().length === 0) {
      return analyzeSentimentAndIntentFallback(text);
    }

    // Extraction robuste du bloc JSON
    const match = respText.match(/\{[\s\S]*\}/);
    if (!match) {
      return analyzeSentimentAndIntentFallback(text);
    }

    const parsed = JSON.parse(match[0]) as { sentiment?: string; intent?: string };

    // Validation et normalisation du sentiment
    let sentiment = 'Neutre';
    if (parsed.sentiment) {
      const s = parsed.sentiment.trim();
      if (['Fâché', 'Neutre', 'Enthousiaste'].includes(s)) {
        sentiment = s;
      } else if (s.toLowerCase().includes('fach') || s.toLowerCase().includes('angr') || s.toLowerCase().includes('fur')) {
        sentiment = 'Fâché';
      } else if (s.toLowerCase().includes('enth') || s.toLowerCase().includes('happ') || s.toLowerCase().includes('cont')) {
        sentiment = 'Enthousiaste';
      }
    }

    // Validation et normalisation de l'intention
    let intent = 'Autre';
    if (parsed.intent) {
      const i = parsed.intent.trim();
      const lowerI = i.toLowerCase();
      if (['Prendre RDV', 'Prix trop cher', 'Désabonnement', 'Autre'].includes(i)) {
        intent = i;
      } else if (lowerI.includes('rdv') || lowerI.includes('rendez') || lowerI.includes('meet') || lowerI.includes('book') || lowerI.includes('appoint')) {
        intent = 'Prendre RDV';
      } else if (lowerI.includes('cher') || lowerI.includes('prix') || lowerI.includes('expens') || lowerI.includes('cost') || lowerI.includes('tarif')) {
        intent = 'Prix trop cher';
      } else if (lowerI.includes('stop') || lowerI.includes('unsub') || lowerI.includes('desabon')) {
        intent = 'Désabonnement';
      }
    }

    return { sentiment, intent };
  } catch (err) {
    console.error('[analyzeSentimentAndIntent] AI error, falling back to keywords:', err);
    return analyzeSentimentAndIntentFallback(text);
  }
}
