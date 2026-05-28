// ── Phase 1 V2 — câblage engine (wire-up) billing.ts ─────────────────────
//
// Prouve que billing.ts délègue désormais le format de n° de facture et le
// breakdown taxes QC à l'invoice-engine (helpers purs déjà testés dans
// invoice-engine.test.ts). Câblage byte-identique vérifié :
//   - formatInvoiceNumber(count+1, year, 4) == `INV-${year}-${pad4}`
//   - computeTaxBreakdown(subtotal,'QC') → tps/tvq identiques (round2 +
//     taux QC TPS 5% / TVQ 9.975% prouvés identiques des deux côtés).
// Ancrage statique : si quelqu'un retire le câblage, ce test casse.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Sanity : les helpers existent et produisent la forme attendue (QC).
import { formatInvoiceNumber, computeTaxBreakdown } from '../lib/invoice-engine';

describe('billing.ts — câblage invoice-engine (wire-up)', () => {
  const src = readFileSync(resolve(__dirname, '..', 'billing.ts'), 'utf8');

  it('importe formatInvoiceNumber + computeTaxBreakdown depuis le moteur', () => {
    expect(src).toContain("from './lib/invoice-engine'");
    expect(src).toContain('formatInvoiceNumber');
    expect(src).toContain('computeTaxBreakdown');
  });

  it('appelle les helpers aux bons call-sites (n° facture + taxes QC)', () => {
    expect(src).toContain('formatInvoiceNumber(count + 1, year, 4)');
    expect(src).toContain("computeTaxBreakdown(subtotal, 'QC')");
  });

  it("ne recalcule plus TPS/TVQ en dur dans computeInvoiceTotals", () => {
    expect(src).not.toContain('round2(subtotal * 0.05)');
    expect(src).not.toContain('round2(subtotal * 0.09975)');
  });

  it('équivalence byte-identique : formatInvoiceNumber padding 4', () => {
    expect(formatInvoiceNumber(1, 2026, 4)).toBe('INV-2026-0001');
    expect(formatInvoiceNumber(42, 2026, 4)).toBe('INV-2026-0042');
  });

  it('équivalence byte-identique : taxes QC = round2(subtotal*0.05/0.09975)', () => {
    const subtotal = 199.99;
    const b = computeTaxBreakdown(subtotal, 'QC');
    expect(b.tps).toBe(Math.round(subtotal * 0.05 * 100) / 100);
    expect(b.tvq).toBe(Math.round(subtotal * 0.09975 * 100) / 100);
  });
});
