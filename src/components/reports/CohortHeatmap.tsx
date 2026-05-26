// ── CohortHeatmap — Onglet « Cohortes » de Reports.tsx ─────────────────────
// LOT ATTRIBUTION-D Sprint D — Phase B Manager-C (front exclusif).
// Heatmap de cohortes : mois d'acquisition en lignes, M+0..M+N en colonnes,
// % d'avancement color-coded (vert = forte rétention, pâle = faible).
// Helpers + types + clés i18n posés en Phase A (api.ts / cohort.*).
// SUBTLE Stripe-grade : réutilise Card / EmptyState / Skeleton. CSS dédié
// dans le bloc sentinellé `=== Sprint D Attribution ===` de index.css.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Skeleton, EmptyState, EmptyStateIllustration, Icon,
} from '@/components/ui';
import { getLeadCohorts, type LeadCohortRow } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Users } from 'lucide-react';

// Couleur de cellule selon % — dégradé sobre du primary (Stripe-grade).
function cellStyle(pct: number): React.CSSProperties {
  if (pct <= 0) return { background: 'var(--surface-2, rgba(0,0,0,0.02))', color: 'var(--text-muted)' };
  // Opacité bornée 0.10 → 0.85 pour rester lisible sur fond clair.
  const alpha = 0.10 + (Math.min(100, pct) / 100) * 0.75;
  return {
    background: `color-mix(in srgb, var(--primary) ${Math.round(alpha * 100)}%, transparent)`,
    color: pct >= 55 ? '#fff' : 'var(--text)',
  };
}

export function CohortHeatmap() {
  const [cohorts, setCohorts] = useState<LeadCohortRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getLeadCohorts();
    if (res.data?.cohorts) setCohorts(res.data.cohorts);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Nombre max de colonnes M+i sur l'ensemble des cohortes.
  const maxMonths = useMemo(
    () => cohorts.reduce((max, c) => Math.max(max, c.retention.length), 0),
    [cohorts],
  );

  if (loading) {
    return (
      <Card className="p-5 space-y-3">
        <Skeleton className="h-6 w-48 rounded-lg" />
        <Skeleton className="h-[280px] w-full rounded-2xl" />
      </Card>
    );
  }

  if (cohorts.length === 0 || maxMonths === 0) {
    return (
      <Card className="p-0">
        <EmptyState
          illustration={<EmptyStateIllustration kind="reports" size={160} />}
          title={t('cohort.title')}
          description={t('cohort.empty')}
        />
      </Card>
    );
  }

  const monthCols = Array.from({ length: maxMonths }, (_, i) => i);

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Icon as={Users} size={15} className="text-[var(--primary)]" />
        {t('cohort.title')}
      </h3>

      <div className="cohort-heatmap-scroll">
        <table className="cohort-heatmap">
          <thead>
            <tr>
              <th className="cohort-heatmap__th cohort-heatmap__th--month">{t('cohort.col_month')}</th>
              <th className="cohort-heatmap__th cohort-heatmap__th--size">{t('cohort.col_size')}</th>
              <th className="cohort-heatmap__th cohort-heatmap__th--span" colSpan={maxMonths}>
                {t('cohort.col_retention')}
              </th>
            </tr>
            <tr>
              <th className="cohort-heatmap__th" aria-hidden="true" />
              <th className="cohort-heatmap__th" aria-hidden="true" />
              {monthCols.map(i => (
                <th key={i} className="cohort-heatmap__th cohort-heatmap__th--col">M+{i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map(c => (
              <tr key={c.month}>
                <td className="cohort-heatmap__month">{c.month}</td>
                <td className="cohort-heatmap__size t-mono-num">{c.size}</td>
                {monthCols.map(i => {
                  const pct = c.retention[i];
                  const has = typeof pct === 'number';
                  return (
                    <td
                      key={i}
                      className="cohort-heatmap__cell"
                      style={has ? cellStyle(pct) : { background: 'transparent' }}
                      title={has ? `${c.month} · M+${i} : ${Math.round(pct)}%` : ''}
                    >
                      {has ? `${Math.round(pct)}%` : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
