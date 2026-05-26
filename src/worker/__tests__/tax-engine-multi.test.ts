// ════════════════════════════════════════════════════════════════════════════
// Sprint 39 — Tax engine multi-région : régression-zéro + nouveaux régimes
// ════════════════════════════════════════════════════════════════════════════
//
// `computeTaxMulti` est PUR (zéro I/O) → tests sans mock D1, déterministes.
// On prouve :
//   1) Régression-zéro stricte : sans opts.region, la sortie est IDENTIQUE
//      bit-pour-bit à computeTax legacy pour 'qc' / 'eu' / 'dz' ;
//   2) Stratégies admin-managed via TaxRegion : sales_tax (US), vat (BE),
//      tva_dz (Algérie), exempt ;
//   3) Override par TaxRule : rule matchant productCategory remplace le rate
//      par défaut de la région.
//
// Source de vérité = code prod LU (tax-engine-multi.ts + ecommerce-tax-engine.ts).
// Helpers purs (zéro mock nécessaire).

import { describe, it, expect } from 'vitest';
import { computeTaxMulti } from '../lib/tax-engine-multi';
import { computeTax } from '../ecommerce-tax-engine';
import type { TaxRegion, TaxRule } from '../../lib/types';

// ── Helpers de fabrication TaxRegion (purs) ─────────────────────────────────

function makeRegion(overrides: Partial<TaxRegion> & Pick<TaxRegion, 'type'>): TaxRegion {
  return {
    id: 'reg_test',
    client_id: 'cli_test',
    code: 'TEST',
    name: 'Test region',
    country: '',
    country_subdiv: null,
    rates_json: {},
    tax_inclusive: false,
    active: true,
    ...overrides,
  };
}

function makeRule(overrides: Partial<TaxRule> & Pick<TaxRule, 'product_category' | 'rate'>): TaxRule {
  return {
    id: 'rule_test',
    region_id: 'reg_test',
    compound: false,
    applies_from: '2026-01-01',
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Régression-zéro : sans opts.region, délégation legacy stricte
// ════════════════════════════════════════════════════════════════════════════

describe('computeTaxMulti — régression-zéro (délégation legacy)', () => {
  it("'qc' 10000¢ → identique bit-pour-bit à computeTax legacy (TPS+TVQ)", () => {
    const multi = computeTaxMulti('qc', 10000, {});
    const legacy = computeTax('qc', 10000, {});
    expect(multi).toEqual(legacy);
    // Garde-fou explicite sur la forme attendue.
    expect(multi.lines).toEqual([
      { label: 'TPS', rate: 0.05, amountCents: 500 },
      { label: 'TVQ', rate: 0.09975, amountCents: 998 },
    ]);
    expect(multi.totalTaxCents).toBe(1498);
    expect(multi.taxInclusive).toBe(false);
  });

  it("'eu' 10000¢ FR → identique computeTax legacy (TVA 20% inclusive)", () => {
    const multi = computeTaxMulti('eu', 10000, { country: 'FR' });
    const legacy = computeTax('eu', 10000, { country: 'FR' });
    expect(multi).toEqual(legacy);
    // TVA 20% inclusive : round(10000 − 10000/1.20) = round(1666.66…) = 1667.
    expect(multi.lines).toEqual([
      { label: 'TVA (FR)', rate: 0.20, amountCents: 1667 },
    ]);
    expect(multi.totalTaxCents).toBe(1667);
    expect(multi.taxInclusive).toBe(true);
  });

  it("'dz' 10000¢ → identique computeTax legacy (TVA 19% exclusive)", () => {
    const multi = computeTaxMulti('dz', 10000, {});
    const legacy = computeTax('dz', 10000, {});
    expect(multi).toEqual(legacy);
    expect(multi.lines).toEqual([
      { label: 'TVA', rate: 0.19, amountCents: 1900 },
    ]);
    expect(multi.totalTaxCents).toBe(1900);
    expect(multi.taxInclusive).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Stratégies admin-managed via TaxRegion
// ════════════════════════════════════════════════════════════════════════════

describe("computeTaxMulti — stratégie 'sales_tax' (US)", () => {
  it('region NY 8% → 10000¢ donne 800¢ avec label "Sales tax NY"', () => {
    const region = makeRegion({
      type: 'sales_tax',
      country: 'US',
      country_subdiv: 'NY',
      rates_json: { sales_tax: 0.08 },
    });
    const r = computeTaxMulti('us_sales_tax', 10000, { region });
    expect(r.lines).toEqual([
      { label: 'Sales tax NY', rate: 0.08, amountCents: 800 },
    ]);
    expect(r.totalTaxCents).toBe(800);
    expect(r.taxInclusive).toBe(false);
  });

  it('region CA 8.875% → 10000¢ donne round(10000*0.08875)=888¢', () => {
    const region = makeRegion({
      type: 'sales_tax',
      country: 'US',
      country_subdiv: 'CA',
      rates_json: { sales_tax: 0.08875 },
    });
    const r = computeTaxMulti('us_sales_tax', 10000, { region });
    // 10000 * 0.08875 = 887.5 → Math.round(887.5) = 888 (banker bias JS → 888).
    expect(r.lines).toEqual([
      { label: 'Sales tax CA', rate: 0.08875, amountCents: 888 },
    ]);
    expect(r.totalTaxCents).toBe(888);
    expect(r.taxInclusive).toBe(false);
  });
});

describe("computeTaxMulti — stratégie 'vat' (UE)", () => {
  it('region BE 21% exclusive → 10000¢ donne 2100¢', () => {
    const region = makeRegion({
      type: 'vat',
      country: 'BE',
      country_subdiv: null,
      rates_json: { vat: 0.21 },
      tax_inclusive: false,
    });
    const r = computeTaxMulti('eu', 10000, { region });
    expect(r.lines).toEqual([
      { label: 'VAT (BE)', rate: 0.21, amountCents: 2100 },
    ]);
    expect(r.totalTaxCents).toBe(2100);
    expect(r.taxInclusive).toBe(false);
  });
});

describe("computeTaxMulti — stratégie 'tva_dz' (Algérie)", () => {
  it('region DZ 19% → 10000¢ donne 1900¢', () => {
    const region = makeRegion({
      type: 'tva_dz',
      country: 'DZ',
      rates_json: { tva: 0.19 },
    });
    const r = computeTaxMulti('dz', 10000, { region });
    expect(r.lines).toEqual([
      { label: 'TVA', rate: 0.19, amountCents: 1900 },
    ]);
    expect(r.totalTaxCents).toBe(1900);
    expect(r.taxInclusive).toBe(false);
  });
});

describe("computeTaxMulti — stratégie 'exempt'", () => {
  it('region exempt → { lines: [], totalTaxCents: 0 }', () => {
    const region = makeRegion({ type: 'exempt' });
    const r = computeTaxMulti('exempt', 10000, { region });
    expect(r.lines).toEqual([]);
    expect(r.totalTaxCents).toBe(0);
    expect(r.taxInclusive).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Bonus : override par TaxRule (catégorie produit)
// ════════════════════════════════════════════════════════════════════════════

describe('computeTaxMulti — override par TaxRule (productCategory)', () => {
  it("region NY 8% + rule food 4% + productCategory='food' → 400¢ (rule gagne)", () => {
    const region = makeRegion({
      type: 'sales_tax',
      country: 'US',
      country_subdiv: 'NY',
      rates_json: { sales_tax: 0.08 },
    });
    const rules: TaxRule[] = [
      makeRule({ product_category: 'food', rate: 0.04 }),
    ];
    const r = computeTaxMulti('us_sales_tax', 10000, {
      region,
      rules,
      productCategory: 'food',
    });
    expect(r.lines).toEqual([
      { label: 'Sales tax NY', rate: 0.04, amountCents: 400 },
    ]);
    expect(r.totalTaxCents).toBe(400);
    expect(r.taxInclusive).toBe(false);
  });
});
