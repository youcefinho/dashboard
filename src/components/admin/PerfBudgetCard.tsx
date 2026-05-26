// ── Sprint 25 — Perf : PerfBudgetCard (admin observability) ─────────────────
// Lit `vitals: Array<{ metric_name; count; avg; p75 }>` props, affiche 5
// cellules badge Pass/Borderline/Fail vs budget (web.dev/vitals).
// Source de vérité budgets : @/lib/perf-budgets (WEB_VITALS_BUDGETS).
//
// Intégré côté Manager-C dans ObservabilityPanel (sous AdminGuard existant,
// pas de capability nouvelle — capabilities figées seq80).

import { t } from '@/lib/i18n';
import {
  WEB_VITALS_BUDGETS,
  checkVitalBudget,
  type WebVitalName,
} from '@/lib/perf-budgets';
import { Card, Tag, EmptyState } from '@/components/ui';

interface VitalRow {
  metric_name: string;
  count: number;
  avg: number;
  p75: number;
}

export interface PerfBudgetCardProps {
  vitals: VitalRow[];
}

const TRACKED_VITALS: WebVitalName[] = ['LCP', 'CLS', 'INP', 'TTFB', 'FCP'];

export function PerfBudgetCard({ vitals }: PerfBudgetCardProps) {
  if (vitals.length === 0) {
    return (
      <Card>
        <h3 className="font-semibold text-base mb-2">{t('perf.budget_card_title')}</h3>
        <EmptyState title={t('perf.no_data')} variant="compact" />
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="font-semibold text-base">{t('perf.budget_card_title')}</h3>
      <p className="text-sm text-muted-foreground mb-4">{t('perf.budget_card_subtitle')}</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {TRACKED_VITALS.map((name) => {
          const v = vitals.find((x) => x.metric_name === name);
          if (!v) {
            return (
              <div key={name} className="space-y-1" data-testid={`vital-${name}-status`}>
                <div className="font-medium text-sm">
                  {t(`perf.metric_${name.toLowerCase()}_label`)}
                </div>
                <div className="text-muted-foreground">—</div>
              </div>
            );
          }
          const result = checkVitalBudget(name, v.p75);
          const variant =
            result.severity === 'pass'
              ? 'success'
              : result.severity === 'needs-improvement'
                ? 'warning'
                : 'danger';
          const label =
            result.severity === 'pass'
              ? t('perf.budget_pass')
              : result.severity === 'needs-improvement'
                ? t('perf.budget_needs')
                : t('perf.budget_fail');
          const formattedValue =
            name === 'CLS' ? v.p75.toFixed(2) : String(Math.round(v.p75));
          const unitLabel = name === 'CLS' ? t('perf.unit_score') : t('perf.unit_ms');
          const budgetGood = WEB_VITALS_BUDGETS[name].good;
          return (
            <div key={name} className="space-y-1" data-testid={`vital-${name}-status`}>
              <div className="font-medium text-sm">
                {t(`perf.metric_${name.toLowerCase()}_label`)}
              </div>
              <div className="text-lg font-mono">
                {formattedValue} {unitLabel}
              </div>
              <Tag variant={variant}>{label}</Tag>
              <div className="text-xs text-muted-foreground">
                {t('perf.threshold_good').replace('{good}', String(budgetGood))}
                {name === 'CLS' ? '' : ' ms'}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
