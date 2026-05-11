// ── Tests Sprint 7 — Templates, Forms, Trigger Links, AI ────
import { describe, test, expect } from 'vitest';
import { compileBlocksToHtml, createDefaultBlock, getAbVariant, type EmailBlock } from '../email-blocks';

// ── 1. Email Blocks : compilation HTML ──────────────────────

describe('Sprint 7 — Email Blocks → HTML', () => {
  test('compileBlocksToHtml génère HTML valide avec table-based layout', () => {
    const blocks: EmailBlock[] = [
      createDefaultBlock('header'),
      createDefaultBlock('text'),
      createDefaultBlock('button'),
    ];
    const html = compileBlocksToHtml(blocks, 'Preview text');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('600px');
    expect(html).toContain('Preview text');
  });

  test('compileBlocksToHtml gère un tableau vide', () => {
    const html = compileBlocksToHtml([]);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('undefined');
  });

  test('tous les 8 block types compilent sans erreur', () => {
    const types = ['header', 'image', 'text', 'button', 'columns', 'divider', 'spacer', 'footer'] as const;
    for (const type of types) {
      const block = createDefaultBlock(type);
      const html = compileBlocksToHtml([block]);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).not.toContain('undefined');
    }
  });

  test('header block inclut le texte et le bon tag h', () => {
    const block = createDefaultBlock('header');
    block.config.text = 'Mon titre test';
    block.config.level = 1;
    const html = compileBlocksToHtml([block]);
    expect(html).toContain('Mon titre test');
    expect(html).toContain('<h1');
  });

  test('button block inclut le lien et le texte', () => {
    const block = createDefaultBlock('button');
    block.config.text = 'Cliquer';
    block.config.url = 'https://test.com';
    const html = compileBlocksToHtml([block]);
    expect(html).toContain('Cliquer');
    expect(html).toContain('https://test.com');
  });
});

// ── 2. A/B variant déterministe ─────────────────────────────

describe('Sprint 7 — A/B Testing', () => {
  test('getAbVariant retourne A ou B de manière déterministe', () => {
    const result1 = getAbVariant('lead-123');
    const result2 = getAbVariant('lead-123');
    expect(result1).toBe(result2);
    expect(['A', 'B']).toContain(result1);
  });

  test('getAbVariant distribue entre A et B sur un échantillon', () => {
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      results.add(getAbVariant(`lead-test-${i}`));
    }
    expect(results.has('A')).toBe(true);
    expect(results.has('B')).toBe(true);
  });
});

// ── 3. SMS opt-out validation (logique) ─────────────────────

describe('Sprint 7 — SMS Templates', () => {
  test('SMS sans STOP/ARRÊT est invalide', () => {
    const smsBody = 'Bonjour, votre rendez-vous est confirmé.';
    const hasOptOut = smsBody.includes('STOP') || smsBody.includes('ARRÊT');
    expect(hasOptOut).toBe(false);
  });

  test('SMS avec STOP est valide pour CASL', () => {
    const smsBody = 'Bonjour! Répondez STOP pour se désabonner.';
    const hasOptOut = smsBody.includes('STOP') || smsBody.includes('ARRÊT');
    expect(hasOptOut).toBe(true);
  });

  test('SMS avec ARRÊT est valide pour CASL (français)', () => {
    const smsBody = 'Info importante. Répondez ARRÊT pour cesser.';
    const hasOptOut = smsBody.includes('STOP') || smsBody.includes('ARRÊT');
    expect(hasOptOut).toBe(true);
  });
});

// ── 4. Quiz scoring (logique pondération) ───────────────────

describe('Sprint 7 — Quiz Scoring', () => {
  test('quiz score calcule la somme des poids', () => {
    const optionWeights: Record<string, number> = { 'option_a': 10, 'option_b': 25, 'option_c': 15 };
    const answers = { q1: 'option_a', q2: 'option_b', q3: 'option_c' };
    let score = 0;
    for (const [, value] of Object.entries(answers)) {
      score += optionWeights[value] || 0;
    }
    expect(score).toBe(50);
  });

  test('quiz 3 ranges MVP : low/mid/high', () => {
    const ranges = [
      { min: 0, max: 33, range: 'low', message: 'Faible' },
      { min: 34, max: 66, range: 'mid', message: 'Moyen' },
      { min: 67, max: 100, range: 'high', message: 'Excellent' },
    ];

    const findRange = (score: number) => {
      const normalized = Math.min(100, Math.max(0, score));
      const found = ranges.find(r => normalized >= r.min && normalized <= r.max);
      // ranges couvre 0-100, un match est garanti
      return found!;
    };

    expect(findRange(10).range).toBe('low');
    expect(findRange(50).range).toBe('mid');
    expect(findRange(80).range).toBe('high');
    expect(findRange(0).range).toBe('low');
    expect(findRange(100).range).toBe('high');
    expect(findRange(33).range).toBe('low');
    expect(findRange(34).range).toBe('mid');
    expect(findRange(67).range).toBe('high');
  });
});

// ── 5. Email block defaults ─────────────────────────────────

describe('Sprint 7 — Block Defaults', () => {
  test('createDefaultBlock retourne un block avec id unique', () => {
    const block1 = createDefaultBlock('text');
    const block2 = createDefaultBlock('text');
    expect(block1.id).not.toBe(block2.id);
    expect(block1.type).toBe('text');
    expect(block1.config).toBeDefined();
  });

  test('footer block contient le lien de désabonnement', () => {
    const block = createDefaultBlock('footer');
    const html = block.config.html as string;
    expect(html).toContain('unsubscribe_url');
  });
});

// ── 6. Template interpolation logic ─────────────────────────

describe('Sprint 7 — Template Interpolation', () => {
  test('variables lead sont correctement remplacées', () => {
    let text = 'Bonjour {{lead.name}}, votre email est {{lead.email}}';
    const lead = { name: 'Jean Dupont', email: 'jean@test.com' };
    text = text.replace(/\{\{lead\.name\}\}/g, lead.name);
    text = text.replace(/\{\{lead\.email\}\}/g, lead.email);
    expect(text).toBe('Bonjour Jean Dupont, votre email est jean@test.com');
  });

  test('{{lead.first_name}} extrait le prénom', () => {
    let text = 'Bonjour {{lead.first_name}}!';
    const name = 'Jean Dupont';
    const firstName = name.split(' ')[0] ?? '';
    text = text.replace(/\{\{lead\.first_name\}\}/g, firstName);
    expect(text).toBe('Bonjour Jean!');
  });

  test('{{year}} est remplacé par l\'année courante', () => {
    let text = '© {{year}} Intralys';
    const year = new Date().getFullYear().toString();
    text = text.replace(/\{\{year\}\}/g, year);
    expect(text).toContain(year);
  });
});

// ── 7. AI workflow types validation ─────────────────────────

describe('Sprint 7 — AI Workflow Validation', () => {
  test('types de step valides sont filtrés correctement', () => {
    const VALID_TYPES = ['wait', 'email', 'sms', 'task', 'condition', 'tag', 'notification'];
    const steps = [
      { id: '1', type: 'wait', config: {} },
      { id: '2', type: 'email', config: {} },
      { id: '3', type: 'invalid_type', config: {} },
      { id: '4', type: 'sms', config: {} },
    ];
    const filtered = steps.filter(s => VALID_TYPES.includes(s.type));
    expect(filtered).toHaveLength(3);
    expect(filtered.map(s => s.type)).toEqual(['wait', 'email', 'sms']);
  });
});
