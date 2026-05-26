// ── Sprint 32 — Google Business Profile : GbpInsightsPanel ─────────────────
// Affiche un strip de 4 KPIs (vues maps, appels, itinéraires, clics site web)
// pour une location GBP donnée, sur une fenêtre glissante de 28 jours (J-28 → J).
//
// Pattern :
//   - useEffect fetch insights au mount + à chaque changement de locationId
//   - loading state minimal (placeholder court — perf budget B/C)
//   - empty / error → <EmptyState /> avec clé i18n quota (consistance C1/C2/C3)
//   - 4 KPIs résolus depuis insights.metrics[] via .find() (graceful 0 si absent)
//   - Card wrapper + KpiStrip (UI primitives canoniques Sprint 38)
//
// Pourquoi 4 KPIs et pas plus :
//   - vues (BUSINESS_IMPRESSIONS_DESKTOP_MAPS + MOBILE_MAPS combinés)
//   - appels (CALL_CLICKS)
//   - itinéraires (BUSINESS_DIRECTION_REQUESTS)
//   - site web (WEBSITE_CLICKS)
//   Ce sont les 4 métriques actionables côté agence (driver de leads).

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { getGbpInsights } from '@/lib/api';
import type { GbpInsights } from '@/lib/types';
import { Card, KpiStrip, EmptyState } from '@/components/ui';

interface Props {
  locationId: string;
}

export function GbpInsightsPanel({ locationId }: Props) {
  const [insights, setInsights] = useState<GbpInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    getGbpInsights(locationId, start, end).then((res) => {
      setLoading(false);
      if (res.data) setInsights(res.data);
    });
  }, [locationId]);

  if (loading) {
    return <div data-testid="gbp-insights-loading">...</div>;
  }

  if (!insights || insights.metrics.length === 0) {
    return (
      <EmptyState
        title={t('gbp.insights.title')}
        description={t('gbp.error.api_quota')}
      />
    );
  }

  const find = (name: string) =>
    insights.metrics.find((m) => m.metric === name)?.value ?? 0;

  const kpis = [
    {
      label: t('gbp.insights.views'),
      value: String(
        find('BUSINESS_IMPRESSIONS_DESKTOP_MAPS') +
          find('BUSINESS_IMPRESSIONS_MOBILE_MAPS'),
      ),
    },
    { label: t('gbp.insights.calls'), value: String(find('CALL_CLICKS')) },
    {
      label: t('gbp.insights.directions'),
      value: String(find('BUSINESS_DIRECTION_REQUESTS')),
    },
    { label: 'Site web', value: String(find('WEBSITE_CLICKS')) },
  ];

  return (
    <Card data-testid="gbp-insights-panel">
      <h3>{t('gbp.insights.title')}</h3>
      <KpiStrip items={kpis} />
    </Card>
  );
}
