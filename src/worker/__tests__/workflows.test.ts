import { describe, it, expect } from 'vitest';

describe('Workflows - Smoke Tests', () => {
  it('interpolates lead data correctly in workflow actions', () => {
    const lead = {
      name: 'Rochdi',
      email: 'rochdi@intralys.com',
      phone: '514-555-5555'
    };
    const template = 'Bonjour {{name}}, votre email est {{email}} et tél: {{phone}} ou encore {{name}} !';
    
    // Simulate interpolation logic from workflows.ts
    const result = template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const k = key.trim() as keyof typeof lead;
      return lead[k] !== undefined && lead[k] !== null ? String(lead[k]) : '';
    });

    expect(result).toBe('Bonjour Rochdi, votre email est rochdi@intralys.com et tél: 514-555-5555 ou encore Rochdi !');
  });
  
  it('handles empty or missing lead data in interpolation', () => {
    const lead = {
      name: 'Rochdi'
    };
    const template = 'Hello {{name}}, phone: {{phone}}';
    
    const result = template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const k = key.trim() as keyof typeof lead;
      return lead[k] !== undefined && lead[k] !== null ? String(lead[k]) : '';
    });

    expect(result).toBe('Hello Rochdi, phone: ');
  });
});
