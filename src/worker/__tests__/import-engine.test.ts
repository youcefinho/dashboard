// ── Tests — Import Engine (Sprint P0-6, 2026-05-26) ──────────────────────────
//
// Tests PURS sur les helpers exportés par lib/import-engine.ts.

import { describe, it, expect } from 'vitest';
import {
  parseCsvRow,
  validateImportRow,
  collectImportErrors,
  dryRunImport,
  IMPORT_ERROR_CODES,
  MAX_IMPORT_ROWS,
  VALID_IMPORT_TYPES,
  type CsvSchema,
} from '../lib/import-engine';

const productSchema: CsvSchema = {
  fields: [
    { name: 'title', required: true, type: 'string', maxLength: 200 },
    { name: 'sku', type: 'string', maxLength: 100 },
    { name: 'price', type: 'number' },
    { name: 'quantity', type: 'integer' },
    { name: 'email', type: 'email' },
  ],
};

describe('import-engine — parseCsvRow', () => {
  it('row valide → ok avec data', () => {
    const r = parseCsvRow(
      { title: 'Foo', sku: 'SKU1', price: '19.99', quantity: '5' },
      productSchema,
    );
    expect(r.ok).toBe(true);
    expect(r.data?.title).toBe('Foo');
    expect(r.data?.price).toBe(19.99);
    expect(r.data?.quantity).toBe(5);
  });

  it('required missing → erreur', () => {
    const r = parseCsvRow({ sku: 'SKU1' }, productSchema);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.REQUIRED_FIELD_MISSING);
    expect(r.field).toBe('title');
  });

  it('price non numérique → erreur', () => {
    const r = parseCsvRow(
      { title: 'Foo', price: 'abc' },
      productSchema,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.FIELD_TYPE_INVALID);
  });

  it('quantity float → erreur (integer requis)', () => {
    const r = parseCsvRow(
      { title: 'Foo', quantity: '5.5' },
      productSchema,
    );
    expect(r.ok).toBe(false);
  });

  it('email invalide → erreur', () => {
    const r = parseCsvRow(
      { title: 'Foo', email: 'not-an-email' },
      productSchema,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.EMAIL_INVALID);
  });

  it('email vide accepté (non required)', () => {
    const r = parseCsvRow({ title: 'Foo' }, productSchema);
    expect(r.ok).toBe(true);
  });

  it('field trop long → erreur', () => {
    const r = parseCsvRow(
      { title: 'X'.repeat(201) },
      productSchema,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.FIELD_TOO_LONG);
  });

  it('schema vide → erreur header', () => {
    const r = parseCsvRow({ title: 'Foo' }, { fields: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.CSV_HEADER_MISSING);
  });

  it('row null → erreur', () => {
    const r = parseCsvRow(null as unknown as Record<string, unknown>, productSchema);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.ROW_INVALID);
  });
});

describe('import-engine — validateImportRow product', () => {
  it('product avec title → ok (warnings sku/price si missing)', () => {
    const r = validateImportRow({ title: 'Foo' }, 'product');
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain('price_missing');
    expect(r.warnings).toContain('sku_missing');
  });

  it('product sans title → erreur', () => {
    const r = validateImportRow({}, 'product');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.REQUIRED_FIELD_MISSING);
  });

  it('product avec price négatif → erreur', () => {
    const r = validateImportRow({ title: 'Foo', price: -10 }, 'product');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.PRICE_INVALID);
  });

  it('product avec quantity float → erreur', () => {
    const r = validateImportRow({ title: 'Foo', quantity: 1.5 }, 'product');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.QTY_INVALID);
  });
});

describe('import-engine — validateImportRow customer', () => {
  it('customer avec email valide → ok', () => {
    const r = validateImportRow({ email: 'foo@bar.com' }, 'customer');
    expect(r.ok).toBe(true);
  });

  it('customer sans email → erreur', () => {
    const r = validateImportRow({}, 'customer');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.REQUIRED_FIELD_MISSING);
  });

  it('customer email invalide → erreur', () => {
    const r = validateImportRow({ email: 'invalid' }, 'customer');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.EMAIL_INVALID);
  });

  it('customer sans nom → warning', () => {
    const r = validateImportRow({ email: 'foo@bar.com' }, 'customer');
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain('name_missing');
  });
});

describe('import-engine — validateImportRow order', () => {
  it('order avec customer_email → ok', () => {
    const r = validateImportRow({ customer_email: 'foo@bar.com' }, 'order');
    expect(r.ok).toBe(true);
  });

  it('order avec customer_id → ok', () => {
    const r = validateImportRow({ customer_id: 'cust-1' }, 'order');
    expect(r.ok).toBe(true);
  });

  it('order sans customer → erreur', () => {
    const r = validateImportRow({}, 'order');
    expect(r.ok).toBe(false);
  });

  it('order total négatif → erreur', () => {
    const r = validateImportRow({ customer_id: 'c', total: -5 }, 'order');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(IMPORT_ERROR_CODES.PRICE_INVALID);
  });
});

describe('import-engine — collectImportErrors', () => {
  it('accumule les erreurs ligne par ligne', () => {
    const rows = [
      { title: 'Foo' },
      {}, // erreur
      { title: 'Bar' },
      {}, // erreur
    ];
    const r = collectImportErrors(rows, (row) =>
      validateImportRow(row, 'product'),
    );
    expect(r.totalErrors).toBe(2);
    expect(r.errors[0]?.row).toBe(2);
    expect(r.errors[1]?.row).toBe(4);
  });

  it('aucune erreur → totalErrors=0', () => {
    const r = collectImportErrors(
      [{ title: 'A' }, { title: 'B' }],
      (row) => validateImportRow(row, 'product'),
    );
    expect(r.totalErrors).toBe(0);
  });

  it('rows non-array → totalErrors=0', () => {
    const r = collectImportErrors(
      null as unknown as Array<Record<string, unknown>>,
      () => ({ ok: true }),
    );
    expect(r.totalErrors).toBe(0);
  });
});

describe('import-engine — dryRunImport', () => {
  it('compte import / skip / error', () => {
    const rows = [
      { title: 'A' },
      { title: 'B' }, // skipped
      {}, // erreur (title manquant)
    ];
    const r = dryRunImport(rows, 'product', (_row, i) => i === 1);
    expect(r.wouldImport).toBe(1);
    expect(r.wouldSkip).toBe(1);
    expect(r.wouldError).toBe(1);
    expect(r.errors[0]?.row).toBe(3);
  });

  it('rejette > MAX_IMPORT_ROWS', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({ title: 'X' }));
    const r = dryRunImport(rows, 'product');
    expect(r.wouldError).toBe(rows.length);
    expect(r.errors[0]?.error).toBe(IMPORT_ERROR_CODES.TOO_MANY_ROWS);
  });

  it('MAX_IMPORT_ROWS = 10000', () => {
    expect(MAX_IMPORT_ROWS).toBe(10000);
  });

  it('VALID_IMPORT_TYPES contient les 3 types', () => {
    expect(VALID_IMPORT_TYPES).toContain('product');
    expect(VALID_IMPORT_TYPES).toContain('customer');
    expect(VALID_IMPORT_TYPES).toContain('order');
  });

  it('rows vide → tout 0', () => {
    const r = dryRunImport([], 'product');
    expect(r.wouldImport).toBe(0);
    expect(r.wouldSkip).toBe(0);
    expect(r.wouldError).toBe(0);
  });
});
