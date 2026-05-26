// ── lot4-i18n-signup.test.ts — LOT 4 SaaS M1 (2026-05-18) ───────────────────
//
// Couvre la PARITÉ STRICTE i18n des 18 clés ajoutées au Lot 4 (CONTRAT §6.18 +
// §6.19) dans les 4 catalogues réels `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` :
//   - §6.18 : 14 clés `auth.signup.*` (libellés statiques, zéro {{var}})
//   - §6.19 : 4 clés `onboarding.agency.*` (interpolation réelle dans .plan)
//   - Parité : exactement les mêmes 18 clés présentes & non-vides ×4 catalogues
//   - Parité placeholders : set {{var}} identique entre catalogues
//     (surtout `onboarding.agency.plan` → {{subAccounts}} + {{leads}})
//
// Test pur i18n (aucun mock D1/Worker requis). NE touche PAS
// lot1-isolation-regression.test.ts. La clé existante plate `'auth.signup'`
// (≠ `'auth.signup.title'`) n'est PAS dans le périmètre Lot 4.

import { describe, it, expect } from 'vitest';
import { frCA } from '../../lib/i18n/fr-CA';
import { frFR } from '../../lib/i18n/fr-FR';
import { en } from '../../lib/i18n/en';
import { es } from '../../lib/i18n/es';

const CATALOGS: Record<string, Record<string, string>> = { frCA, frFR, en, es };

// §6.18 — 14 clés auth.signup.* (zéro placeholder)
const SIGNUP_KEYS = [
  'auth.signup.title',
  'auth.signup.subtitle',
  'auth.signup.email_label',
  'auth.signup.password_label',
  'auth.signup.password_hint',
  'auth.signup.name_label',
  'auth.signup.company_label',
  'auth.signup.submit',
  'auth.signup.have_account',
  'auth.signup.email_taken',
  'auth.signup.invalid',
  'auth.signup.success',
  'auth.signup.error',
  'auth.signup.create_link',
] as const;

// §6.19 — 4 clés onboarding.agency.* (interpolation réelle dans .plan)
const ONBOARDING_KEYS = [
  'onboarding.agency.welcome',
  'onboarding.agency.subaccounts',
  'onboarding.agency.plan',
  'onboarding.agency.cta',
] as const;

const ALL_KEYS = [...SIGNUP_KEYS, ...ONBOARDING_KEYS];

// Placeholders {{var}} attendus par clé (parité STRICTE 4 catalogues).
const EXPECTED_PLACEHOLDERS: Record<string, string[]> = {
  'onboarding.agency.plan': ['leads', 'subAccounts'],
};

function placeholdersOf(value: string): string[] {
  const out = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) out.add(m[1]);
  return [...out].sort();
}

describe('LOT 4 i18n — parité 18 clés signup/onboarding (§6.18 + §6.19)', () => {
  it('expose exactement 18 clés Lot 4', () => {
    expect(ALL_KEYS).toHaveLength(18);
    expect(SIGNUP_KEYS).toHaveLength(14);
    expect(ONBOARDING_KEYS).toHaveLength(4);
    expect(new Set(ALL_KEYS).size).toBe(18); // aucun doublon
  });

  for (const [lang, cat] of Object.entries(CATALOGS)) {
    it(`[${lang}] possède les 18 clés Lot 4, non-vides`, () => {
      for (const k of ALL_KEYS) {
        expect(cat, `clé manquante: ${k} dans ${lang}`).toHaveProperty(k);
        const v = cat[k];
        expect(typeof v, `${k} (${lang}) doit être string`).toBe('string');
        expect(v.trim().length, `${k} (${lang}) ne doit pas être vide`).toBeGreaterThan(0);
      }
    });

    it(`[${lang}] clés signup.* ne contiennent AUCUN placeholder {{var}}`, () => {
      for (const k of SIGNUP_KEYS) {
        expect(placeholdersOf(cat[k]), `${k} (${lang}) doit être statique`).toEqual([]);
      }
    });
  }

  it("ne casse pas la clé plate existante 'auth.signup' (≠ 'auth.signup.title')", () => {
    for (const [lang, cat] of Object.entries(CATALOGS)) {
      expect(cat['auth.signup'], `'auth.signup' absent dans ${lang}`).toBeTruthy();
      expect(cat['auth.signup']).not.toBe(cat['auth.signup.title']);
    }
  });

  it('parité STRICTE des placeholders {{var}} entre les 4 catalogues', () => {
    for (const k of ALL_KEYS) {
      const ref = placeholdersOf(frCA[k]);
      for (const [lang, cat] of Object.entries(CATALOGS)) {
        expect(placeholdersOf(cat[k]), `placeholders divergents pour ${k} (${lang})`).toEqual(ref);
      }
      if (EXPECTED_PLACEHOLDERS[k]) {
        expect(ref, `placeholders attendus pour ${k}`).toEqual(EXPECTED_PLACEHOLDERS[k]);
      }
    }
  });

  it('onboarding.agency.plan interpole bien {{subAccounts}} + {{leads}} ×4', () => {
    for (const [lang, cat] of Object.entries(CATALOGS)) {
      const v = cat['onboarding.agency.plan'];
      expect(v, `{{subAccounts}} manquant (${lang})`).toContain('{{subAccounts}}');
      expect(v, `{{leads}} manquant (${lang})`).toContain('{{leads}}');
    }
  });
});
