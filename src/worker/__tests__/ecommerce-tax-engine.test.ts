// ════════════════════════════════════════════════════════════════════════════
// Sprint S5 M1 — Tax-engine (ecommerce-tax-engine.ts) : valeurs EXACTES au cent
// ════════════════════════════════════════════════════════════════════════════
//
// `computeTax` est PUR (zéro I/O) → tests sans mock D1, déterministes.
// On prouve :
//   - QC : TPS 5% + TVQ 9.975% arrondies SÉPARÉMENT (jamais en cascade) ;
//   - EU : tax-INCLUSIVE par défaut (extraction sub − sub/(1+rate)) +
//          override exclusive + table pays + défaut 20% ;
//   - DZ : TVA 19% exclusive (TAP désactivé) ;
//   - exempt : 0 taxe ;
//   - régime/pays inconnu : comportement défensif documenté.
//
// Source de vérité = code prod LU (ecommerce-tax-engine.ts), pas supposé.

import { describe, it, expect } from 'vitest';
import { computeTax } from '../ecommerce-tax-engine';

describe('computeTax — régime QC (verbatim createOrderCore, régression-zéro)', () => {
  it('10000¢ → TPS=500, TVQ=998, total_tax=1498, exclusive', () => {
    const r = computeTax('qc', 10000);
    expect(r.lines).toEqual([
      { label: 'TPS', rate: 0.05, amountCents: 500 },     // round(10000*0.05)
      { label: 'TVQ', rate: 0.09975, amountCents: 998 },  // round(997.5)=998
    ]);
    expect(r.totalTaxCents).toBe(1498);
    expect(r.taxInclusive).toBe(false);
  });

  it('arrondi SÉPARÉ non-cascade : 333¢ → TPS=17, TVQ=33', () => {
    // round(333*0.05)=round(16.65)=17 ; round(333*0.09975)=round(33.21675)=33
    // (une cascade TVQ sur sub+TPS donnerait une autre valeur → on vérifie NON-cascade)
    const r = computeTax('qc', 333);
    expect(r.lines[0].amountCents).toBe(17);
    expect(r.lines[1].amountCents).toBe(33);
    expect(r.totalTaxCents).toBe(50);
  });

  it('vectorisé : valeurs exactes pour plusieurs sous-totaux', () => {
    const cases: Array<[number, number, number]> = [
      // [sub, tpsAttendu, tvqAttendu]
      [0, 0, 0],
      [1, 0, 0],          // round(0.05)=0 ; round(0.09975)=0
      [10, 1, 1],         // round(0.5)=1 (round-half-up JS) ; round(0.9975)=1
      [100, 5, 10],       // round(5)=5 ; round(9.975)=10
      [1999, 100, 199],   // round(99.95)=100 ; round(199.40025)=199
      [12345, 617, 1232], // round(617.25)=617 ; round(1231.41375)=1232
      [99999, 5000, 9975],// round(4999.95)=5000 ; round(9974.90025)=9975
    ];
    for (const [sub, tps, tvq] of cases) {
      const r = computeTax('qc', sub);
      expect(r.lines[0].amountCents, `TPS sub=${sub}`).toBe(tps);
      expect(r.lines[1].amountCents, `TVQ sub=${sub}`).toBe(tvq);
      expect(r.totalTaxCents, `total sub=${sub}`).toBe(tps + tvq);
    }
  });

  it('sous-total négatif/NaN borné à 0 (Math.max(0, round(sub||0)))', () => {
    expect(computeTax('qc', -500).totalTaxCents).toBe(0);
    expect(computeTax('qc', NaN).totalTaxCents).toBe(0);
    expect(computeTax('qc', 100.4).lines[0].amountCents).toBe(5); // sub→round(100.4)=100
  });
});

describe('computeTax — régime EU (tax-INCLUSIVE par défaut)', () => {
  it('FR 20% inclusive : 12000¢ → round(12000 − 12000/1.2) = 2000', () => {
    const r = computeTax('eu', 12000, { country: 'FR' });
    expect(r.lines).toEqual([{ label: 'TVA (FR)', rate: 0.20, amountCents: 2000 }]);
    expect(r.totalTaxCents).toBe(2000);
    expect(r.taxInclusive).toBe(true);
  });

  it('override taxInclusive=false (B2B HT) : FR 10000¢ → round(10000*0.20)=2000', () => {
    const r = computeTax('eu', 10000, { country: 'FR', taxInclusive: false });
    expect(r.lines[0].amountCents).toBe(2000);
    expect(r.taxInclusive).toBe(false);
  });

  it('table pays : DE 19% inclusive → round(11900 − 11900/1.19)=1900', () => {
    const r = computeTax('eu', 11900, { country: 'DE' });
    expect(r.lines[0]).toEqual({ label: 'TVA (DE)', rate: 0.19, amountCents: 1900 });
  });

  it('pays UE inconnu/absent → défaut 20% (EU_VAT_DEFAULT), label "UE"', () => {
    const r = computeTax('eu', 12000, { country: 'ZZ' });
    expect(r.lines[0].rate).toBe(0.20);
    expect(r.lines[0].amountCents).toBe(2000); // round(12000 - 12000/1.2)
    const noCountry = computeTax('eu', 12000);
    expect(noCountry.lines[0]).toEqual({ label: 'TVA (UE)', rate: 0.20, amountCents: 2000 });
  });

  it('vectorisé inclusive par pays (extraction exacte au cent)', () => {
    const cases: Array<[string, number, number, number]> = [
      // [country, rate, sub, tvaAttendue=round(sub - sub/(1+rate))]
      ['LU', 0.17, 11700, Math.round(11700 - 11700 / 1.17)],
      ['HU', 0.27, 12700, Math.round(12700 - 12700 / 1.27)],
      ['SE', 0.25, 12500, Math.round(12500 - 12500 / 1.25)],
      ['FI', 0.255, 12550, Math.round(12550 - 12550 / 1.255)],
    ];
    for (const [cc, rate, sub, tva] of cases) {
      const r = computeTax('eu', sub, { country: cc });
      expect(r.lines[0].rate, `rate ${cc}`).toBe(rate);
      expect(r.lines[0].amountCents, `tva ${cc}`).toBe(tva);
    }
  });
});

describe('computeTax — régime DZ (Algérie, exclusive)', () => {
  it('TVA 19% exclusive, TAP désactivé : 10000¢ → 1900, 1 seule ligne', () => {
    const r = computeTax('dz', 10000);
    expect(r.lines).toEqual([{ label: 'TVA', rate: 0.19, amountCents: 1900 }]);
    expect(r.totalTaxCents).toBe(1900);
    expect(r.taxInclusive).toBe(false);
    expect(r.lines).toHaveLength(1); // DZ_TAP_ENABLED=false → pas de ligne TAP
  });

  it('arrondi par taxe : 333¢ → round(63.27)=63', () => {
    expect(computeTax('dz', 333).lines[0].amountCents).toBe(63);
  });
});

describe('computeTax — régime exempt + comportements défensifs', () => {
  it('exempt : 0 taxe, lines vide', () => {
    const r = computeTax('exempt', 99999);
    expect(r.lines).toEqual([]);
    expect(r.totalTaxCents).toBe(0);
    expect(r.taxInclusive).toBe(false);
  });

  it('régime inconnu → exonéré (sécurité défensive, jamais de taxe fantôme)', () => {
    // Documenté ligne ~205 prod : default → computeExempt()
    const r = computeTax('inconnu' as unknown as 'qc', 10000);
    expect(r.lines).toEqual([]);
    expect(r.totalTaxCents).toBe(0);
  });
});
