// ── scheduled-reports-engine.test.ts — Renforcement P1 (2026-05-26) ────────
// Tests unitaires des helpers purs scheduled-reports-engine.ts.
// 20+ tests edge cases.

import { describe, it, expect } from 'vitest';
import {
  SCHEDULED_REPORTS_ERROR_CODES,
  MAX_RECIPIENTS,
  MAX_FREQUENCY_PER_DAY,
  MAX_NAME_LENGTH,
  VALID_CADENCES,
  VALID_FORMATS,
  VALID_KINDS,
  validateCronExpression,
  parseRecipients,
  computeNextRun,
  validateReportInput,
  renderReportHtml,
  escHtml,
} from '../lib/scheduled-reports-engine';

describe('SCHEDULED_REPORTS_ERROR_CODES', () => {
  it('exporte un objet figé immuable', () => {
    expect(Object.isFrozen(SCHEDULED_REPORTS_ERROR_CODES)).toBe(true);
    expect(SCHEDULED_REPORTS_ERROR_CODES.CRON_INVALID).toBe('CRON_INVALID');
  });

  it('expose les bonnes constantes de borne', () => {
    expect(MAX_RECIPIENTS).toBe(50);
    expect(MAX_FREQUENCY_PER_DAY).toBe(10);
    expect(MAX_NAME_LENGTH).toBe(120);
  });

  it('expose les whitelists figées', () => {
    expect(Object.isFrozen(VALID_CADENCES)).toBe(true);
    expect(Object.isFrozen(VALID_FORMATS)).toBe(true);
    expect(Object.isFrozen(VALID_KINDS)).toBe(true);
  });
});

describe('validateCronExpression', () => {
  it('accepte une expression cron classique 5-fields', () => {
    expect(validateCronExpression('0 9 * * 1').ok).toBe(true);
    expect(validateCronExpression('*/15 * * * *').ok).toBe(true);
    expect(validateCronExpression('0 0 1 * *').ok).toBe(true);
  });

  it('rejette une cron string vide ou non-string', () => {
    expect(validateCronExpression('').ok).toBe(false);
    expect(validateCronExpression('   ').ok).toBe(false);
    expect(validateCronExpression(null).ok).toBe(false);
    expect(validateCronExpression(42).ok).toBe(false);
  });

  it('rejette les aliases @ (sécurité)', () => {
    const res = validateCronExpression('@daily');
    expect(res.ok).toBe(false);
    expect(res.code).toBe(SCHEDULED_REPORTS_ERROR_CODES.CRON_ALIAS_REJECTED);
  });

  it('rejette une cron avec mauvais nombre de champs', () => {
    expect(validateCronExpression('0 9 * *').ok).toBe(false);
    expect(validateCronExpression('0 9 * * * *').ok).toBe(false);
  });

  it('rejette une valeur hors borne (heure > 23)', () => {
    const res = validateCronExpression('0 25 * * *');
    expect(res.ok).toBe(false);
    expect(res.code).toBe(SCHEDULED_REPORTS_ERROR_CODES.CRON_FIELD_OUT_OF_RANGE);
    expect(res.field).toBe('hour');
  });

  it('rejette une valeur hors borne (minute négative)', () => {
    expect(validateCronExpression('-1 9 * * *').ok).toBe(false);
  });

  it('rejette day_of_month = 0 ou > 31', () => {
    expect(validateCronExpression('0 9 0 * *').ok).toBe(false);
    expect(validateCronExpression('0 9 32 * *').ok).toBe(false);
  });

  it('accepte ranges et steps valides', () => {
    expect(validateCronExpression('0 9-17 * * 1-5').ok).toBe(true);
    expect(validateCronExpression('*/10 */2 * * *').ok).toBe(true);
  });

  it('rejette un range inversé', () => {
    expect(validateCronExpression('0 17-9 * * *').ok).toBe(false);
  });

  it('rejette un step non numérique', () => {
    expect(validateCronExpression('*/abc * * * *').ok).toBe(false);
  });
});

describe('parseRecipients', () => {
  it('parse un array de strings', () => {
    const r = parseRecipients(['a@b.com', 'c@d.com']);
    expect(r.emails).toEqual(['a@b.com', 'c@d.com']);
    expect(r.invalid).toEqual([]);
  });

  it('parse une string CSV', () => {
    const r = parseRecipients('a@b.com, c@d.com; e@f.com');
    expect(r.emails).toHaveLength(3);
  });

  it('dédoublonne (case-insensitive)', () => {
    const r = parseRecipients(['a@b.com', 'A@B.COM', 'a@b.com']);
    expect(r.emails).toEqual(['a@b.com']);
  });

  it('retourne les invalides séparément', () => {
    const r = parseRecipients(['valid@x.com', 'pas-un-email', 'aussi pas']);
    expect(r.emails).toEqual(['valid@x.com']);
    expect(r.invalid).toContain('pas-un-email');
  });

  it('cap à MAX_RECIPIENTS', () => {
    const arr = Array.from({ length: 100 }, (_, i) => `u${i}@x.com`);
    const r = parseRecipients(arr);
    expect(r.emails.length).toBe(MAX_RECIPIENTS);
  });

  it('input null/non-string/non-array → vide', () => {
    expect(parseRecipients(null).emails).toEqual([]);
    expect(parseRecipients({} as never).emails).toEqual([]);
    expect(parseRecipients(42 as never).emails).toEqual([]);
  });

  it('rejette emails sans @ ou sans point', () => {
    const r = parseRecipients(['nope', 'no@dot', '@no.com', 'space @ x.com']);
    expect(r.emails).toEqual([]);
  });
});

describe('computeNextRun', () => {
  it('renvoie un Date pour une cron valide', () => {
    const next = computeNextRun('0 9 * * *', new Date('2026-05-26T07:00:00Z'));
    expect(next).toBeInstanceOf(Date);
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  it('avance au jour suivant si l\'heure est passée', () => {
    const next = computeNextRun('0 9 * * *', new Date('2026-05-26T10:00:00Z'));
    expect(next!.getUTCDate()).toBe(27);
  });

  it('renvoie null pour une cron invalide', () => {
    expect(computeNextRun('invalid cron', new Date())).toBe(null);
  });

  it('respecte les ranges (lundi-vendredi)', () => {
    // 2026-05-30 = samedi (jour 6). Next 9h doit sauter au lundi 2026-06-01.
    const next = computeNextRun('0 9 * * 1-5', new Date('2026-05-30T08:00:00Z'));
    expect(next).toBeInstanceOf(Date);
    expect(next!.getUTCDay()).toBeGreaterThanOrEqual(1);
    expect(next!.getUTCDay()).toBeLessThanOrEqual(5);
  });

  it('cron du 1er du mois (jour 1)', () => {
    const next = computeNextRun('0 9 1 * *', new Date('2026-05-15T00:00:00Z'));
    expect(next!.getUTCDate()).toBe(1);
    expect(next!.getUTCMonth()).toBe(5); // juin (0-indexé)
  });

  it('cron toutes les 15 minutes', () => {
    const next = computeNextRun('*/15 * * * *', new Date('2026-05-26T10:07:00Z'));
    expect(next!.getUTCMinutes() % 15).toBe(0);
  });
});

describe('validateReportInput', () => {
  it('accepte un input minimal vide (tous champs optionnels)', () => {
    expect(validateReportInput({}).ok).toBe(true);
  });

  it('rejette cadence invalide', () => {
    const res = validateReportInput({ cadence: 'hourly' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(SCHEDULED_REPORTS_ERROR_CODES.CADENCE_INVALID);
  });

  it('rejette day_of_week hors [0..6]', () => {
    expect(validateReportInput({ day_of_week: 7 }).ok).toBe(false);
    expect(validateReportInput({ day_of_week: -1 }).ok).toBe(false);
    expect(validateReportInput({ day_of_week: 3 }).ok).toBe(true);
  });

  it('rejette day_of_month hors [1..28]', () => {
    expect(validateReportInput({ day_of_month: 0 }).ok).toBe(false);
    expect(validateReportInput({ day_of_month: 29 }).ok).toBe(false);
    expect(validateReportInput({ day_of_month: 15 }).ok).toBe(true);
  });

  it('rejette recipients vide après parse', () => {
    const res = validateReportInput({ recipients: ['pas-un-email'] });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(SCHEDULED_REPORTS_ERROR_CODES.RECIPIENTS_EMPTY);
  });

  it('accepte recipients valides', () => {
    expect(validateReportInput({ recipients: ['a@b.com'] }).ok).toBe(true);
  });

  it('rejette format non whitelisté', () => {
    const res = validateReportInput({ format: 'pdf' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(SCHEDULED_REPORTS_ERROR_CODES.FORMAT_INVALID);
  });
});

describe('escHtml', () => {
  it('échappe les caractères dangereux', () => {
    expect(escHtml('<script>')).toBe('&lt;script&gt;');
    expect(escHtml('"\'&')).toBe('&quot;&#39;&amp;');
  });

  it('null/undefined → string vide', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });
});

describe('renderReportHtml', () => {
  it('rend un HTML valide avec titre et sections', () => {
    const html = renderReportHtml({
      title: 'Mon rapport',
      sections: [{ title: 'Leads', rows: [{ label: 'Nouveaux', value: 42 }] }],
    });
    expect(html).toContain('Mon rapport');
    expect(html).toContain('Leads');
    expect(html).toContain('Nouveaux');
    expect(html).toContain('42');
  });

  it('échappe XSS dans titre et sections', () => {
    const html = renderReportHtml({
      title: '<img src=x onerror=alert(1)>',
      sections: [{ title: '<svg/onload=x>', rows: [{ label: '"\'', value: '<>' }] }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg/onload');
    expect(html).toContain('&lt;img');
  });

  it('inclut un footer par défaut', () => {
    const html = renderReportHtml({ title: 'T', sections: [] });
    expect(html).toContain('Intralys');
  });

  it('subtitle optionnel', () => {
    const html = renderReportHtml({ title: 'T', subtitle: 'Sous-titre', sections: [] });
    expect(html).toContain('Sous-titre');
  });
});
