// ── reports-engine.test.ts — Renforcement P2 (2026-05-26) ──────────────────
// Tests unitaires des helpers purs reports-engine.ts. 20+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  REPORTS_ERROR_CODES,
  MAX_GROUP_BY_FIELDS,
  MAX_DATE_RANGE_DAYS,
  MAX_FILTERS_PER_QUERY,
  VALID_AGGREGATIONS,
  VALID_FILTER_OPERATORS,
  VALID_REPORT_SOURCES,
  VALID_REPORT_DIMENSIONS,
  isValidFieldName,
  validateQueryFilters,
  validateDateRange,
  validateGroupBy,
  validateAggregation,
  formatExportCsv,
  csvEscape,
} from '../lib/reports-engine';

describe('REPORTS_ERROR_CODES & constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(REPORTS_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_AGGREGATIONS)).toBe(true);
    expect(Object.isFrozen(VALID_FILTER_OPERATORS)).toBe(true);
    expect(Object.isFrozen(VALID_REPORT_SOURCES)).toBe(true);
    expect(Object.isFrozen(VALID_REPORT_DIMENSIONS)).toBe(true);
  });

  it('contient les bornes attendues', () => {
    expect(MAX_GROUP_BY_FIELDS).toBe(5);
    expect(MAX_DATE_RANGE_DAYS).toBe(730);
    expect(MAX_FILTERS_PER_QUERY).toBe(20);
  });

  it('VALID_AGGREGATIONS contient les 6 ops attendues', () => {
    expect(VALID_AGGREGATIONS).toContain('count');
    expect(VALID_AGGREGATIONS).toContain('sum');
    expect(VALID_AGGREGATIONS).toContain('distinct');
  });

  it('VALID_FILTER_OPERATORS contient eq/in/contains', () => {
    expect(VALID_FILTER_OPERATORS).toContain('eq');
    expect(VALID_FILTER_OPERATORS).toContain('in');
    expect(VALID_FILTER_OPERATORS).toContain('contains');
  });
});

describe('isValidFieldName', () => {
  it('accepte les noms alphanumériques + underscore', () => {
    expect(isValidFieldName('status')).toBe(true);
    expect(isValidFieldName('created_at')).toBe(true);
    expect(isValidFieldName('user_id_v2')).toBe(true);
  });

  it('rejette les noms avec caractères dangereux', () => {
    expect(isValidFieldName("'; DROP TABLE--")).toBe(false);
    expect(isValidFieldName('user;')).toBe(false);
    expect(isValidFieldName('user-name')).toBe(false);
    expect(isValidFieldName('user name')).toBe(false);
  });

  it('rejette vide et trop long', () => {
    expect(isValidFieldName('')).toBe(false);
    expect(isValidFieldName('a'.repeat(65))).toBe(false);
  });

  it('rejette commençant par chiffre', () => {
    expect(isValidFieldName('1user')).toBe(false);
  });

  it('rejette non-string', () => {
    expect(isValidFieldName(42)).toBe(false);
    expect(isValidFieldName(null)).toBe(false);
  });
});

describe('validateQueryFilters', () => {
  it('null/undefined ⇒ ok', () => {
    expect(validateQueryFilters(null).ok).toBe(true);
    expect(validateQueryFilters(undefined).ok).toBe(true);
  });

  it('rejette non-array', () => {
    expect(validateQueryFilters({}).ok).toBe(false);
    expect(validateQueryFilters('filters').ok).toBe(false);
  });

  it('accepte filtres valides', () => {
    const ok = validateQueryFilters([
      { field: 'status', operator: 'eq', value: 'won' },
      { field: 'amount', operator: 'gte', value: 100 },
    ]);
    expect(ok.ok).toBe(true);
  });

  it('rejette opérateur invalide', () => {
    const res = validateQueryFilters([{ field: 'x', operator: 'nope', value: 1 }]);
    expect(res.ok).toBe(false);
    expect(res.code).toBe(REPORTS_ERROR_CODES.FILTER_OPERATOR_INVALID);
  });

  it('rejette field invalide (anti-injection)', () => {
    const res = validateQueryFilters([
      { field: "x'; DROP TABLE--", operator: 'eq', value: 1 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.code).toBe(REPORTS_ERROR_CODES.FILTER_FIELD_INVALID);
  });

  it('opérateur in requiert array', () => {
    const res = validateQueryFilters([{ field: 'x', operator: 'in', value: 'a' }]);
    expect(res.ok).toBe(false);
  });

  it('opérateur contains requiert string', () => {
    const res = validateQueryFilters([{ field: 'x', operator: 'contains', value: 123 }]);
    expect(res.ok).toBe(false);
  });

  it('rejette trop de filtres', () => {
    const many = Array.from({ length: 25 }, () => ({
      field: 'x',
      operator: 'eq',
      value: 1,
    }));
    expect(validateQueryFilters(many).ok).toBe(false);
  });
});

describe('validateDateRange', () => {
  it('accepte range valide < 730j', () => {
    const r = validateDateRange('2026-01-01', '2026-05-26');
    expect(r.ok).toBe(true);
    expect(r.days).toBeGreaterThan(0);
  });

  it('rejette range > 730j', () => {
    const r = validateDateRange('2020-01-01', '2026-05-26');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(REPORTS_ERROR_CODES.DATE_RANGE_TOO_LARGE);
  });

  it('rejette range inversé', () => {
    const r = validateDateRange('2026-05-26', '2026-01-01');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(REPORTS_ERROR_CODES.DATE_RANGE_INVERTED);
  });

  it('accepte Date objects', () => {
    const r = validateDateRange(new Date('2026-01-01'), new Date('2026-02-01'));
    expect(r.ok).toBe(true);
  });

  it('accepte epoch ms', () => {
    const r = validateDateRange(Date.now() - 86400000, Date.now());
    expect(r.ok).toBe(true);
  });

  it('rejette dates invalides', () => {
    expect(validateDateRange('not-a-date', 'also-not').ok).toBe(false);
    expect(validateDateRange(null, null).ok).toBe(false);
  });
});

describe('validateGroupBy', () => {
  it('null/undefined ⇒ ok', () => {
    expect(validateGroupBy(null).ok).toBe(true);
  });

  it('accepte tableau de fields valides', () => {
    expect(validateGroupBy(['status', 'source']).ok).toBe(true);
  });

  it('rejette > 5 fields', () => {
    const r = validateGroupBy(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(REPORTS_ERROR_CODES.GROUP_BY_TOO_MANY);
  });

  it('rejette field invalide', () => {
    expect(validateGroupBy(["x; DROP"]).ok).toBe(false);
  });

  it('rejette non-array', () => {
    expect(validateGroupBy('status').ok).toBe(false);
  });
});

describe('validateAggregation', () => {
  it('count sans field ⇒ ok', () => {
    expect(validateAggregation({ op: 'count' }).ok).toBe(true);
  });

  it('sum requiert field', () => {
    const r = validateAggregation({ op: 'sum' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(REPORTS_ERROR_CODES.AGGREGATION_FIELD_REQUIRED);
  });

  it('sum avec field valide ⇒ ok', () => {
    expect(validateAggregation({ op: 'sum', field: 'amount' }).ok).toBe(true);
  });

  it('rejette op invalide', () => {
    expect(validateAggregation({ op: 'mean' }).ok).toBe(false);
  });

  it('rejette field injection', () => {
    expect(validateAggregation({ op: 'sum', field: "x'; DROP--" }).ok).toBe(false);
  });

  it('rejette input non-objet', () => {
    expect(validateAggregation(null).ok).toBe(false);
    expect(validateAggregation('count').ok).toBe(false);
  });
});

describe('csvEscape & formatExportCsv', () => {
  it('csvEscape quote si contient virgule', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('csvEscape échappe les double quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('csvEscape quote si contient newline', () => {
    expect(csvEscape('line1\nline2')).toContain('"');
  });

  it('csvEscape null/undefined → string vide', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('formatExportCsv header + rows', () => {
    const csv = formatExportCsv(
      [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      ['id', 'name'],
    );
    expect(csv).toContain('id,name');
    expect(csv).toContain('1,Alice');
    expect(csv).toContain('2,Bob');
    expect(csv.split('\r\n').length).toBe(3); // header + 2 rows
  });

  it('formatExportCsv échappe valeurs avec virgules', () => {
    const csv = formatExportCsv(
      [{ note: 'a,b,c', n: 1 }],
      ['note', 'n'],
    );
    expect(csv).toContain('"a,b,c"');
  });

  it('formatExportCsv columns vides ⇒ ""', () => {
    expect(formatExportCsv([{ a: 1 }], [])).toBe('');
  });

  it('formatExportCsv rows non-array ⇒ ""', () => {
    expect(formatExportCsv(null as never, ['a'])).toBe('');
  });
});
