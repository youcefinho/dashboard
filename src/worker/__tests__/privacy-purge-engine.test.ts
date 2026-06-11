// ── privacy-purge-engine.test.ts — Sprint 93 (seq188) ───────────────────────
// Tests pour la purge automatisée RGPD & Loi 25.
// 14 cas : validation règles, identification inactivité, anonymisation,
// rapport d'audit, juridictions, edge cases.

import { describe, it, expect } from 'vitest';
import {
  validatePurgeRule,
  identifyPurgeableLeads,
  anonymizeLead,
  isAnonymized,
  buildPurgeReport,
  PURGE_ACTIONS,
  PURGE_ERROR_CODES,
  RETENTION_LIMITS,
  type PurgeRule,
  type LeadForPurge,
} from '../lib/privacy-purge-engine';

// ──────────────────────────────────────────────────────────────────────────
// validatePurgeRule — 4 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S93 — validatePurgeRule', () => {
  it('1. Règle valide → ok', () => {
    const result = validatePurgeRule({ inactive_days: 90, action: 'anonymize' });
    expect(result.ok).toBe(true);
    expect(result.rule?.inactive_days).toBe(90);
    expect(result.rule?.action).toBe('anonymize');
    expect(result.rule?.applies_to).toBe('leads'); // défaut
  });

  it('2. inactive_days invalide (négatif, 0, non-number) → erreur', () => {
    expect(validatePurgeRule({ inactive_days: 0, action: 'delete' }).ok).toBe(false);
    expect(validatePurgeRule({ inactive_days: -1, action: 'delete' }).error).toBe(
      PURGE_ERROR_CODES.DAYS_INVALID,
    );
    expect(validatePurgeRule({ inactive_days: 'abc', action: 'delete' } as never).ok).toBe(false);
    expect(validatePurgeRule({ inactive_days: NaN, action: 'delete' }).ok).toBe(false);
  });

  it('3. Action inconnue → erreur', () => {
    const result = validatePurgeRule({ inactive_days: 30, action: 'nuke' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(PURGE_ERROR_CODES.ACTION_INVALID);
  });

  it('4. Input null/undefined → erreur', () => {
    expect(validatePurgeRule(null as never).ok).toBe(false);
    expect(validatePurgeRule(undefined as never).ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// identifyPurgeableLeads — 4 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S93 — identifyPurgeableLeads', () => {
  const NOW = new Date('2026-06-01T00:00:00Z').getTime();
  const rule90: PurgeRule = { inactive_days: 90, action: 'anonymize' };

  it('5. Lead inactif > 90 jours → identifié', () => {
    const leads: LeadForPurge[] = [
      { id: 'L1', updated_at: '2026-01-01T00:00:00Z', status: 'new' },
    ];
    const results = identifyPurgeableLeads(leads, [rule90], NOW);
    expect(results.length).toBe(1);
    expect(results[0]!.lead.id).toBe('L1');
    expect(results[0]!.inactiveDays).toBeGreaterThanOrEqual(90);
  });

  it('6. Lead récent < 90 jours → PAS identifié', () => {
    const leads: LeadForPurge[] = [
      { id: 'L2', updated_at: '2026-05-15T00:00:00Z', status: 'new' },
    ];
    const results = identifyPurgeableLeads(leads, [rule90], NOW);
    expect(results.length).toBe(0);
  });

  it('7. Lead avec status protégé (won/customer/vip) → JAMAIS purgé', () => {
    const leads: LeadForPurge[] = [
      { id: 'L3', updated_at: '2025-01-01T00:00:00Z', status: 'won' },
      { id: 'L4', updated_at: '2025-01-01T00:00:00Z', status: 'customer' },
      { id: 'L5', updated_at: '2025-01-01T00:00:00Z', status: 'vip' },
    ];
    const results = identifyPurgeableLeads(leads, [rule90], NOW);
    expect(results.length).toBe(0);
  });

  it('8. Listes vides → retour vide sans erreur', () => {
    expect(identifyPurgeableLeads([], [rule90], NOW)).toEqual([]);
    expect(identifyPurgeableLeads([{ id: 'L6', updated_at: '2025-01-01' }], [], NOW)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// anonymizeLead — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S93 — anonymizeLead', () => {
  it('9. Remplace les champs PII par [SUPPRIMÉ]', () => {
    const lead = {
      id: 'L1',
      name: 'Jean Tremblay',
      email: 'jean@example.com',
      phone: '+1-514-555-1234',
      notes: 'Intéressé',
      message: 'Bonjour',
      status: 'lost',
      score: 42,
      source: 'facebook',
    };
    const anon = anonymizeLead(lead);

    expect(anon.name).toBe('[SUPPRIMÉ]');
    expect(anon.email).toBe('[SUPPRIMÉ]');
    expect(anon.phone).toBe('[SUPPRIMÉ]');
    expect(anon.notes).toBe('[SUPPRIMÉ]');
    expect(anon.message).toBe('[SUPPRIMÉ]');

    // Champs métier préservés
    expect(anon.id).toBe('L1');
    expect(anon.status).toBe('lost');
    expect(anon.score).toBe(42);
    expect(anon.source).toBe('facebook');
  });

  it('10. Champs null/undefined → pas remplacés', () => {
    const lead = { id: 'L2', email: null, phone: undefined, name: 'Nom' };
    const anon = anonymizeLead(lead as Record<string, unknown>);
    expect(anon.email).toBeNull();
    // phone n'est pas défini dans le résultat, donc pas anonymisé
    expect(anon.name).toBe('[SUPPRIMÉ]');
  });

  it('11. isAnonymized détecte un lead anonymisé', () => {
    const anon = anonymizeLead({ id: 'L3', name: 'Test', email: 'test@test.com' });
    expect(isAnonymized(anon)).toBe(true);
    expect(isAnonymized({ name: 'Not anon', email: 'real@email.com' })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildPurgeReport — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S93 — buildPurgeReport', () => {
  it('12. Rapport complet avec ventilation par action', () => {
    const items = [
      { lead: { id: 'L1' } as LeadForPurge, rule: { inactive_days: 90, action: 'anonymize' as const } },
      { lead: { id: 'L2' } as LeadForPurge, rule: { inactive_days: 90, action: 'anonymize' as const } },
      { lead: { id: 'L3' } as LeadForPurge, rule: { inactive_days: 180, action: 'delete' as const } },
    ];
    const now = new Date('2026-06-01T00:00:00Z');
    const report = buildPurgeReport(items, 'QC', now);

    expect(report.total_processed).toBe(3);
    expect(report.by_action.anonymize).toBe(2);
    expect(report.by_action.delete).toBe(1);
    expect(report.by_action.archive).toBe(0);
    expect(report.purged_ids).toEqual(['L1', 'L2', 'L3']);
    expect(report.jurisdiction).toBe('QC');
    expect(report.executed_at).toBe('2026-06-01T00:00:00.000Z');
    expect(report.rules_applied.length).toBe(2);
  });

  it('13. Rapport vide → zéros partout', () => {
    const report = buildPurgeReport([]);
    expect(report.total_processed).toBe(0);
    expect(report.purged_ids).toEqual([]);
    expect(report.by_action.anonymize).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Config structurelle
// ──────────────────────────────────────────────────────────────────────────

describe('S93 — config exports', () => {
  it('14. PURGE_ACTIONS contient les 3 actions', () => {
    expect(PURGE_ACTIONS).toContain('anonymize');
    expect(PURGE_ACTIONS).toContain('delete');
    expect(PURGE_ACTIONS).toContain('archive');
    expect(PURGE_ACTIONS.length).toBe(3);
  });

  it('15. RETENTION_LIMITS a les juridictions QC, CA, EU', () => {
    expect(RETENTION_LIMITS.QC.defaultDays).toBe(1095);
    expect(RETENTION_LIMITS.CA.defaultDays).toBe(730);
    expect(RETENTION_LIMITS.EU.defaultDays).toBe(1825);
  });
});
