// ── i18n / plural — Sprint 48 M3.1 ──────────────────────────
// Wrapper léger sur Intl.PluralRules pour gérer le pluriel selon la locale.
// Zero-dep, opt-in, back-compat 100%.
//
// Usage :
//   plural('fr-CA', 0, { one: '1 lead', other: '# leads' })  → "0 leads"
//   plural('fr-CA', 1, { one: '1 lead', other: '# leads' })  → "1 lead"
//   plural('fr-CA', 5, { one: '1 lead', other: '# leads' })  → "5 leads"
//
// La forme `#` est remplacée par la valeur numérique (formatée localement
// si on passe par formatNumber). Pour custom formatting, passer la valeur
// déjà formatée dans la string elle-même.
//
// Notes locale :
//   - fr-CA / fr-FR : 'one' (0, 1), 'other' (sinon)
//   - en : 'one' (1), 'other' (sinon — inclut 0)
//   - es : 'one' (1), 'other' (sinon — inclut 0)
//   - ar / ru / pl ont 'few' / 'many' (supportés en fallback chain).

export type PluralForms = {
  one: string;
  other: string;
  zero?: string;
  two?: string;
  few?: string;
  many?: string;
};

/**
 * Sélectionne la forme plurielle correcte selon la locale et le count.
 * Remplace `#` par la valeur numérique (en String brut — pas de formatNumber
 * pour rester déterministe et sans dep croisée).
 *
 * Fallback chain : catégorie demandée → 'other'.
 */
export function plural(
  locale: string,
  count: number,
  forms: PluralForms
): string {
  let template: string;
  try {
    const rules = new Intl.PluralRules(locale);
    const cat = rules.select(count);
    template =
      (forms[cat as keyof PluralForms] as string | undefined) ?? forms.other;
  } catch {
    // Intl.PluralRules indispo (très vieux runtime) — fallback simple
    template = count === 1 ? forms.one : forms.other;
  }
  return template.replace(/#/g, String(count));
}

/**
 * Helper raccourci pour le pattern "X item / X items" sans format.
 * @example pluralSimple('en', 3, 'item', 'items') → '3 items'
 */
export function pluralSimple(
  locale: string,
  count: number,
  singular: string,
  pluralForm: string
): string {
  return plural(locale, count, {
    one: `# ${singular}`,
    other: `# ${pluralForm}`,
  });
}
