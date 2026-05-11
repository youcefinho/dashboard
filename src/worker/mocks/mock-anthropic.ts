// ── Mock Anthropic (Claude) — réponses prédéfinies pour dev local ──

export function mockClaude(systemPrompt: string, userMessage: string): string {
  const lower = (systemPrompt + ' ' + userMessage).toLowerCase();

  // Détection scoring lead
  if (lower.includes('score') && lower.includes('0-100')) {
    return JSON.stringify({
      score: 65,
      reason: 'Lead qualifié avec budget moyen. Intérêt confirmé par message initial. Recommandation : relance sous 48h avec proposition de rencontre stratégique.'
    });
  }

  // Détection workflow suggestion
  if (lower.includes('workflow') && lower.includes('steps')) {
    return JSON.stringify({
      name: 'Relance automatique nouveau lead',
      trigger_type: 'lead_created',
      steps: [
        { step_order: 1, action_type: 'send_email', config: { template: 'welcome', delay_hours: 0 } },
        { step_order: 2, action_type: 'wait', config: { delay_hours: 24 } },
        { step_order: 3, action_type: 'send_sms', config: { body: 'Bonjour {{nom}}, avez-vous eu le temps de consulter notre courriel ?', delay_hours: 0 } },
        { step_order: 4, action_type: 'wait', config: { delay_hours: 72 } },
        { step_order: 5, action_type: 'send_email', config: { template: 'followup_j3', delay_hours: 0 } },
      ]
    });
  }

  // Détection email followup
  if (lower.includes('email_followup') || lower.includes('email') && lower.includes('followup')) {
    return JSON.stringify({
      subject: 'Suite à votre demande — Rencontre stratégique gratuite',
      body: `Bonjour {{nom}},\n\nMerci d'avoir manifesté votre intérêt pour nos services.\n\nJ'aimerais vous proposer une rencontre stratégique gratuite de 30 minutes pour discuter de votre projet. C'est sans engagement et confidentiel.\n\nQuand seriez-vous disponible cette semaine ?\n\nAu plaisir,\nVotre conseiller`,
      tone: 'professionnel_chaleureux'
    });
  }

  // Détection SMS followup
  if (lower.includes('sms_followup') || lower.includes('sms')) {
    return JSON.stringify({
      body: 'Bonjour {{nom}}, j\'ai bien reçu votre demande. Êtes-vous disponible pour un appel de 5 min cette semaine ? Sans engagement. 😊',
      characters: 142
    });
  }

  // Détection objection handler
  if (lower.includes('objection')) {
    return JSON.stringify({
      response: 'Je comprends tout à fait votre hésitation. Beaucoup de mes clients avaient les mêmes préoccupations au départ. Ce que je vous propose, c\'est une première rencontre sans engagement — ça vous permettra de voir si le courant passe et si mon approche vous convient.',
      technique: 'empathie_reframing'
    });
  }

  // Détection proposition commerciale
  if (lower.includes('proposition') || lower.includes('offre')) {
    return JSON.stringify({
      title: 'Magnifique propriété avec vue panoramique',
      description: 'Superbe maison unifamiliale de 4 chambres située dans un quartier recherché. Rénovée avec goût, cette propriété offre des espaces de vie lumineux, une cuisine moderne avec îlot central, et un grand terrain paysagé. Proche des écoles, parcs et services.',
      highlights: ['4 chambres', 'Cuisine rénovée', 'Grand terrain', 'Quartier familial']
    });
  }

  // Détection social post
  if (lower.includes('social_post') || lower.includes('social')) {
    return JSON.stringify({
      post: '🚀 Nouveau service disponible ! Contactez-nous pour découvrir comment nous pouvons transformer votre entreprise. #entreprise #croissance',
      platform: 'instagram',
      hashtags: ['entreprise', 'croissance', 'pme']
    });
  }

  // Chat assistant par défaut
  return 'Bonjour ! Je suis l\'assistant CRM Intralys. Comment puis-je vous aider avec votre gestion de leads et de clients aujourd\'hui ?';
}
