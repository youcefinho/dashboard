import { describe, it, expect, vi } from 'vitest';
import {
  analyzeSentimentAndIntent,
  analyzeSentimentAndIntentFallback,
} from '../lib/sentiment-intent-engine';
import type { Env } from '../types';

describe('Sentiment & Intent Fallback local', () => {
  it('devrait classifier les sentiments positivement ou négativement', () => {
    // Enthousiaste
    expect(analyzeSentimentAndIntentFallback('Super boulot, merci beaucoup !').sentiment).toBe('Enthousiaste');
    expect(analyzeSentimentAndIntentFallback('C\'est tout simplement génial et parfait.').sentiment).toBe('Enthousiaste');

    // Fâché
    expect(analyzeSentimentAndIntentFallback('Je veux un remboursement immédiat, c\'est nul !').sentiment).toBe('Fâché');
    expect(analyzeSentimentAndIntentFallback('C\'est inacceptable et horrible.').sentiment).toBe('Fâché');
    expect(analyzeSentimentAndIntentFallback('Ça ne marche pas du tout !!!').sentiment).toBe('Fâché');

    // Neutre
    expect(analyzeSentimentAndIntentFallback('Bonjour, pouvez-vous m\'aider ?').sentiment).toBe('Neutre');
    expect(analyzeSentimentAndIntentFallback('Le ciel est bleu aujourd\'hui.').sentiment).toBe('Neutre');
  });

  it('devrait classifier les intentions correctement', () => {
    // Prendre RDV
    expect(analyzeSentimentAndIntentFallback('Je voudrais réserver un rendez-vous demain.').intent).toBe('Prendre RDV');
    expect(analyzeSentimentAndIntentFallback('Avez-vous des disponibilités dans votre calendrier ?').intent).toBe('Prendre RDV');

    // Prix trop cher
    expect(analyzeSentimentAndIntentFallback('Votre service est beaucoup trop cher, quel est le tarif mensuel ?').intent).toBe('Prix trop cher');
    expect(analyzeSentimentAndIntentFallback('Quel est votre budget pour cette maison ?').intent).toBe('Prix trop cher');

    // Désabonnement
    expect(analyzeSentimentAndIntentFallback('STOP, veuillez me désabonner de cette liste.').intent).toBe('Désabonnement');
    expect(analyzeSentimentAndIntentFallback('Unsubscribe me please.').intent).toBe('Désabonnement');

    // Autre
    expect(analyzeSentimentAndIntentFallback('Bonjour comment ça va ?').intent).toBe('Autre');
  });
});

describe('Sentiment & Intent avec Workers AI (mock)', () => {
  it('devrait retourner le fallback si env.AI est absent', async () => {
    const mockEnv = {} as Env;
    const res = await analyzeSentimentAndIntent(mockEnv, 'merci beaucoup pour le rdv');
    
    // Fallback devrait classer comme Enthousiaste + Prendre RDV
    expect(res.sentiment).toBe('Enthousiaste');
    expect(res.intent).toBe('Prendre RDV');
  });

  it('devrait interroger env.AI et parser le JSON retourné', async () => {
    const mockAiRun = vi.fn().mockResolvedValue({
      response: '{"sentiment": "Fâché", "intent": "Désabonnement"}',
    });
    const mockEnv = {
      AI: { run: mockAiRun },
    } as unknown as Env;

    const res = await analyzeSentimentAndIntent(mockEnv, 'Je suis mécontent, arrêtez tout.');
    
    expect(mockAiRun).toHaveBeenCalled();
    expect(res.sentiment).toBe('Fâché');
    expect(res.intent).toBe('Désabonnement');
  });

  it('devrait normaliser les sentiments et intentions retournés par env.AI', async () => {
    const mockAiRun = vi.fn().mockResolvedValue({
      response: '{"sentiment": "angry", "intent": "appointment"}',
    });
    const mockEnv = {
      AI: { run: mockAiRun },
    } as unknown as Env;

    const res = await analyzeSentimentAndIntent(mockEnv, 'Je veux parler à un agent pour fixer un rdv.');
    
    expect(res.sentiment).toBe('Fâché');
    expect(res.intent).toBe('Prendre RDV');
  });

  it('devrait utiliser le fallback si le JSON de env.AI est invalide', async () => {
    const mockAiRun = vi.fn().mockResolvedValue({
      response: 'Une réponse en texte brut qui n\'est pas du tout du JSON.',
    });
    const mockEnv = {
      AI: { run: mockAiRun },
    } as unknown as Env;

    const res = await analyzeSentimentAndIntent(mockEnv, 'super service, merci !');
    
    // Devrait retomber sur le fallback (Enthousiaste / Autre)
    expect(res.sentiment).toBe('Enthousiaste');
    expect(res.intent).toBe('Autre');
  });
});
