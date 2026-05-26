// @vitest-environment jsdom
// LOT C (GIGA-PLAN-V2) — Parité STRICTE des 4 catalogues i18n.
// Cause racine de la régression R : clés ajoutées sans parité 4 catalogues.
// Ce test prouve l'égalité stricte des ensembles de clés (Object.keys triés)
// fr-CA = fr-FR = en = es, + présence des clés LOT C ×4.
// NON exécuté en VM (build/tests délégués Antigravity).
import { describe, it, expect } from 'vitest';
import { frCA } from '@/lib/i18n/fr-CA';
import { frFR } from '@/lib/i18n/fr-FR';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';

const catalogues: Record<string, Record<string, string>> = {
  'fr-CA': frCA,
  'fr-FR': frFR,
  en,
  es,
};

function sortedKeys(o: Record<string, string>): string[] {
  return Object.keys(o).sort();
}

describe('LOT C — parité stricte des 4 catalogues i18n', () => {
  const base = sortedKeys(frCA);

  it('fr-FR a exactement le même ensemble de clés que fr-CA', () => {
    expect(sortedKeys(frFR)).toEqual(base);
  });

  it('en a exactement le même ensemble de clés que fr-CA', () => {
    expect(sortedKeys(en)).toEqual(base);
  });

  it('es a exactement le même ensemble de clés que fr-CA', () => {
    expect(sortedKeys(es)).toEqual(base);
  });

  it('aucune valeur vide dans aucun catalogue', () => {
    for (const [name, cat] of Object.entries(catalogues)) {
      for (const [k, v] of Object.entries(cat)) {
        expect(typeof v, `${name}/${k}`).toBe('string');
        expect(v.length, `${name}/${k} non-vide`).toBeGreaterThan(0);
      }
    }
  });

  // Échantillon de clés LOT C nouvelles — doivent exister ×4.
  const lotCSample = [
    'admin.hero_title',
    'help.no_results',
    'compliance.page_title',
    'customfields.page_title',
    'reports.cac_title',
    'templates.view_grid',
    'integrations.db_add_widget',
    'onboarding.wiz_title',
    'panels.task_deleted',
    'feedback.nps_title',
    'inbox.list_title',
  ];

  it.each(lotCSample)('clé LOT C "%s" présente dans les 4 catalogues', (key) => {
    for (const [name, cat] of Object.entries(catalogues)) {
      expect(cat[key], `${name} doit contenir ${key}`).toBeTruthy();
    }
  });
});

describe('Sprint 28 — clés extraites présentes ×4', () => {
  const sprint28Sample = [
    'leads.table.type',
    'leads.table.contact',
    'leads.filter.all_statuses',
    'set.team.invitation',
    'set.team.invitations',
    'set.team.pending',
    'email_builder.prop.level',
    'workflow_builder.field.method',
    'kb_admin.category.general',
    'inbox.new_conversation_title',
    'conversations.empty_state',
    'onboarding.chip.ready',
    'profile_settings.subtitle',
  ];
  it.each(sprint28Sample)('clé Sprint 28 "%s" présente dans les 4 catalogues', (key) => {
    for (const [name, cat] of Object.entries(catalogues)) {
      expect(cat[key], `${name} doit contenir ${key}`).toBeTruthy();
    }
  });
});
