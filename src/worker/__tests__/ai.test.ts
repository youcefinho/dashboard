// ── Tests mock-anthropic.ts — réponses prédéfinies ──
import { describe, it, expect } from 'vitest';
import { mockClaude } from '../mocks/mock-anthropic';
import { isAiMockMode } from '../ai';
import type { Env } from '../types';

// ── LOT RÉEL §6.1 — isAiMockMode (source de vérité mode mock IA) ──
describe('isAiMockMode', () => {
  it('retourne true quand aucune clé Anthropic n\'est configurée', () => {
    expect(isAiMockMode({} as unknown as Env)).toBe(true);
  });

  it('retourne true quand USE_MOCKS === "true" même avec une clé', () => {
    expect(isAiMockMode({ ANTHROPIC_API_KEY: 'sk-ant-real', USE_MOCKS: 'true' } as unknown as Env)).toBe(true);
  });

  it('retourne false quand une vraie clé Anthropic est présente et USE_MOCKS absent', () => {
    expect(isAiMockMode({ ANTHROPIC_API_KEY: 'sk-ant-real' } as unknown as Env)).toBe(false);
  });

  it('retourne false quand USE_MOCKS a une valeur non-"true" avec clé', () => {
    expect(isAiMockMode({ ANTHROPIC_API_KEY: 'sk-ant-real', USE_MOCKS: 'false' } as unknown as Env)).toBe(false);
  });
});

describe('mockClaude', () => {
  it('retourne un score 0-100 pour un prompt de scoring', () => {
    const result = mockClaude(
      'Tu es un expert en qualification de leads immobiliers QC. Score 0-100.',
      'Lead: {"name": "Sophie", "type": "buy"}'
    );
    const parsed = JSON.parse(result);
    expect(parsed.score).toBe(65);
    expect(parsed.reason).toBeTruthy();
    expect(typeof parsed.reason).toBe('string');
  });

  it('retourne un workflow pour un prompt workflow', () => {
    const result = mockClaude(
      'Expert automatisation CRM QC. Convertis description en JSON workflow steps.',
      'Relance automatique'
    );
    const parsed = JSON.parse(result);
    expect(parsed.name).toBeTruthy();
    expect(parsed.trigger_type).toBeTruthy();
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThan(0);
    expect(parsed.steps[0].step_order).toBe(1);
  });

  it('retourne un email pour un prompt email_followup', () => {
    const result = mockClaude('Action: email_followup', 'email_followup');
    const parsed = JSON.parse(result);
    expect(parsed.subject).toBeTruthy();
    expect(parsed.body).toContain('{{nom}}');
  });

  it('retourne un SMS pour un prompt sms_followup', () => {
    const result = mockClaude('Action: sms_followup', 'sms_followup');
    const parsed = JSON.parse(result);
    expect(parsed.body).toBeTruthy();
    expect(parsed.body.length).toBeLessThanOrEqual(160);
  });

  it('retourne une réponse par défaut pour un prompt inconnu', () => {
    const result = mockClaude('Salut', 'Comment ça va ?');
    expect(result).toContain('assistant');
    expect(typeof result).toBe('string');
  });

  it('retourne un social post', () => {
    const result = mockClaude('Action: social_post', 'social_post');
    const parsed = JSON.parse(result);
    expect(parsed.post).toBeTruthy();
    expect(parsed.hashtags).toBeTruthy();
  });

  it('retourne un objection handler', () => {
    const result = mockClaude('', 'objection handler');
    const parsed = JSON.parse(result);
    expect(parsed.response).toBeTruthy();
    expect(parsed.technique).toBeTruthy();
  });

  it('retourne une proposition commerciale', () => {
    const result = mockClaude('', 'proposition commerciale');
    const parsed = JSON.parse(result);
    expect(parsed.title).toBeTruthy();
    expect(parsed.description).toBeTruthy();
    expect(Array.isArray(parsed.highlights)).toBe(true);
  });
});
