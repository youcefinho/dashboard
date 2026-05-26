// ── perf-budgets.test.ts — Sprint 25 (Manager-B) ─────────────────────────
//
// Couvre src/lib/perf-budgets.ts : checkVitalBudget + constantes
// WEB_VITALS_BUDGETS / BUNDLE_SIZE_BUDGETS_KB. Source de vérité partagée
// worker (perf-budget-log) + UI (PerfBudgetCard). Doit rester aligné avec
// les seuils inline de webVitals.ts:36-42 (THRESHOLDS) et avec
// scripts/check-bundle-size.mjs BUDGETS (vérifié via assertions ci-dessous).
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande bun/node). Écrits pour
//    vitest, vérifiés statiquement.
//
// ⚠ La vitest.config.ts du repo doit inclure le glob `src/lib/__tests__/**`
//    (ajouté Phase B Sprint 25) pour que ce fichier soit ramassé.

import { describe, it, expect } from 'vitest';
import {
  WEB_VITALS_BUDGETS,
  BUNDLE_SIZE_BUDGETS_KB,
  checkVitalBudget,
  type WebVitalName,
} from '../perf-budgets';

describe('Sprint 25 — checkVitalBudget (severity)', () => {
  it('LCP value=2000 → pass (<=2500)', () => {
    const r = checkVitalBudget('LCP', 2000);
    expect(r.severity).toBe('pass');
    expect(r.budget).toEqual(WEB_VITALS_BUDGETS.LCP);
  });

  it('LCP value=2500 → pass (boundary inclus)', () => {
    expect(checkVitalBudget('LCP', 2500).severity).toBe('pass');
  });

  it('LCP value=3000 → needs-improvement (>2500, <=4000)', () => {
    expect(checkVitalBudget('LCP', 3000).severity).toBe('needs-improvement');
  });

  it('LCP value=4000 → needs-improvement (boundary inclus)', () => {
    expect(checkVitalBudget('LCP', 4000).severity).toBe('needs-improvement');
  });

  it('LCP value=5000 → fail (>4000)', () => {
    expect(checkVitalBudget('LCP', 5000).severity).toBe('fail');
  });

  it('CLS scoring : pass / needs / fail', () => {
    expect(checkVitalBudget('CLS', 0.05).severity).toBe('pass');
    expect(checkVitalBudget('CLS', 0.1).severity).toBe('pass'); // boundary
    expect(checkVitalBudget('CLS', 0.15).severity).toBe('needs-improvement');
    expect(checkVitalBudget('CLS', 0.25).severity).toBe('needs-improvement'); // boundary
    expect(checkVitalBudget('CLS', 0.30).severity).toBe('fail');
  });

  it('INP scoring : pass / needs / fail', () => {
    expect(checkVitalBudget('INP', 150).severity).toBe('pass');
    expect(checkVitalBudget('INP', 200).severity).toBe('pass');
    expect(checkVitalBudget('INP', 300).severity).toBe('needs-improvement');
    expect(checkVitalBudget('INP', 500).severity).toBe('needs-improvement');
    expect(checkVitalBudget('INP', 600).severity).toBe('fail');
  });

  it('TTFB scoring : pass / needs / fail', () => {
    expect(checkVitalBudget('TTFB', 500).severity).toBe('pass');
    expect(checkVitalBudget('TTFB', 800).severity).toBe('pass');
    expect(checkVitalBudget('TTFB', 1000).severity).toBe('needs-improvement');
    expect(checkVitalBudget('TTFB', 1800).severity).toBe('needs-improvement');
    expect(checkVitalBudget('TTFB', 2000).severity).toBe('fail');
  });

  it('FCP scoring : pass / needs / fail', () => {
    expect(checkVitalBudget('FCP', 1500).severity).toBe('pass');
    expect(checkVitalBudget('FCP', 1800).severity).toBe('pass');
    expect(checkVitalBudget('FCP', 2500).severity).toBe('needs-improvement');
    expect(checkVitalBudget('FCP', 3000).severity).toBe('needs-improvement');
    expect(checkVitalBudget('FCP', 3500).severity).toBe('fail');
  });

  it('exhaustivité : table-driven sur les 5 vitals', () => {
    const table: Array<{ name: WebVitalName; pass: number; needs: number; fail: number }> = [
      { name: 'LCP',  pass: 1000, needs: 3000, fail: 5000 },
      { name: 'CLS',  pass: 0.05, needs: 0.15, fail: 0.30 },
      { name: 'INP',  pass: 150,  needs: 300,  fail: 600 },
      { name: 'TTFB', pass: 500,  needs: 1000, fail: 2000 },
      { name: 'FCP',  pass: 1500, needs: 2500, fail: 3500 },
    ];
    for (const row of table) {
      expect(checkVitalBudget(row.name, row.pass).severity).toBe('pass');
      expect(checkVitalBudget(row.name, row.needs).severity).toBe('needs-improvement');
      expect(checkVitalBudget(row.name, row.fail).severity).toBe('fail');
    }
  });
});

describe('Sprint 25 — WEB_VITALS_BUDGETS (parité avec webVitals.ts:36-42)', () => {
  it('LCP good=2500, poor=4000, unit=ms', () => {
    expect(WEB_VITALS_BUDGETS.LCP.good).toBe(2500);
    expect(WEB_VITALS_BUDGETS.LCP.poor).toBe(4000);
    expect(WEB_VITALS_BUDGETS.LCP.unit).toBe('ms');
  });

  it('CLS good=0.1, poor=0.25, unit=score', () => {
    expect(WEB_VITALS_BUDGETS.CLS.good).toBe(0.1);
    expect(WEB_VITALS_BUDGETS.CLS.poor).toBe(0.25);
    expect(WEB_VITALS_BUDGETS.CLS.unit).toBe('score');
  });

  it('INP good=200, poor=500, unit=ms', () => {
    expect(WEB_VITALS_BUDGETS.INP.good).toBe(200);
    expect(WEB_VITALS_BUDGETS.INP.poor).toBe(500);
    expect(WEB_VITALS_BUDGETS.INP.unit).toBe('ms');
  });

  it('TTFB good=800, poor=1800, unit=ms', () => {
    expect(WEB_VITALS_BUDGETS.TTFB.good).toBe(800);
    expect(WEB_VITALS_BUDGETS.TTFB.poor).toBe(1800);
    expect(WEB_VITALS_BUDGETS.TTFB.unit).toBe('ms');
  });

  it('FCP good=1800, poor=3000, unit=ms', () => {
    expect(WEB_VITALS_BUDGETS.FCP.good).toBe(1800);
    expect(WEB_VITALS_BUDGETS.FCP.poor).toBe(3000);
    expect(WEB_VITALS_BUDGETS.FCP.unit).toBe('ms');
  });
});

describe('Sprint 25 — BUNDLE_SIZE_BUDGETS_KB (alignement avec scripts/check-bundle-size.mjs)', () => {
  it('initialApp = 230 KB', () => {
    expect(BUNDLE_SIZE_BUDGETS_KB.initialApp).toBe(230);
  });

  it('pageChunkMax = 220 KB', () => {
    expect(BUNDLE_SIZE_BUDGETS_KB.pageChunkMax).toBe(220);
  });

  it('vendorChunkMax = 320 KB', () => {
    expect(BUNDLE_SIZE_BUDGETS_KB.vendorChunkMax).toBe(320);
  });

  it('cssMax = 80 KB', () => {
    expect(BUNDLE_SIZE_BUDGETS_KB.cssMax).toBe(80);
  });
});
