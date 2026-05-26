// ── Sprint 25 — Perf budgets (source de vérité partagée) ────────────────────
// Référence officielle : web.dev/vitals (seuils Google).
// Réplique des seuils déjà in-line dans webVitals.ts (THRESHOLDS lignes 36-42).
// DRY différée : webVitals.ts reste autonome (1 dep externe = 0), ce module
// est consommé par PerfBudgetCard.tsx + perf-budget-log.ts (worker).

export type WebVitalName = 'LCP' | 'CLS' | 'INP' | 'TTFB' | 'FCP';
export type BudgetSeverity = 'pass' | 'needs-improvement' | 'fail';

export const WEB_VITALS_BUDGETS: Record<WebVitalName, { good: number; poor: number; unit: 'ms' | 'score' }> = {
  LCP:  { good: 2500, poor: 4000, unit: 'ms' },
  CLS:  { good: 0.1,  poor: 0.25, unit: 'score' },
  INP:  { good: 200,  poor: 500,  unit: 'ms' },
  TTFB: { good: 800,  poor: 1800, unit: 'ms' },
  FCP:  { good: 1800, poor: 3000, unit: 'ms' },
};

// Budgets bundle gzip (KB). Source : scripts/check-bundle-size.mjs BUDGETS.
// Ré-exposé ici pour usage admin panel (lecture seule, jamais d'enforcement
// côté UI — c'est CI / Antigravity côté hôte qui enforce via le script).
export const BUNDLE_SIZE_BUDGETS_KB: Record<string, number> = {
  initialApp: 230,
  pageChunkMax: 220,
  vendorChunkMax: 320,
  cssMax: 80,
};

export function checkVitalBudget(name: WebVitalName, value: number): {
  severity: BudgetSeverity;
  budget: { good: number; poor: number; unit: 'ms' | 'score' };
} {
  const b = WEB_VITALS_BUDGETS[name];
  if (value <= b.good) return { severity: 'pass', budget: b };
  if (value <= b.poor) return { severity: 'needs-improvement', budget: b };
  return { severity: 'fail', budget: b };
}
