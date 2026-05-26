// ── FunnelsPage — Sprint 44 LOT FUNNEL-S44 (Agent B2) ──────────────────────
// Page standalone routée `/funnels` — AppLayout + PageHero + Tabs 2 onglets :
//   - Entonnoirs : <FunnelsManager /> (CRUD funnels, livré par Agent B1)
//   - Analytique : Select funnel → <FunnelAnalytics funnelId={selected} />
//
// Style Stripe-clean. Imports RELATIFS. aria-labels via t(). Aucun console.log.
// Calque CoursesLMSPage (Sprint 43, Agent B2).

import { useCallback, useEffect, useState } from 'react';
import { Layers, BarChart3 } from 'lucide-react';
import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/Tabs';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Icon } from '../../components/ui/Icon';
import { useToast } from '../../components/ui/Toast';
import { FunnelsManager } from '../../components/funnels/FunnelsManager';
import { FunnelAnalytics } from '../../components/funnels/FunnelAnalytics';
import {
  listFunnels,
  type FunnelBuilder,
} from '../../lib/api';
import { t } from '../../lib/i18n';

// ── Composant ──────────────────────────────────────────────────────────────

export function FunnelsPage() {
  const title = t('funnels.title');
  const { error: toastError } = useToast();

  const [funnels, setFunnels] = useState<FunnelBuilder[]>([]);
  const [loadingFunnels, setLoadingFunnels] = useState<boolean>(true);
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>('');

  // ── Chargement funnels (pour l'onglet Analytique → Select) ──────────────
  const loadFunnels = useCallback(async () => {
    setLoadingFunnels(true);
    const res = await listFunnels();
    if (res.error) {
      toastError(res.error);
      setFunnels([]);
    } else if (res.data) {
      setFunnels(res.data);
      // Auto-pick le premier funnel si rien de selected.
      const first = res.data[0];
      if (!selectedFunnelId && first) {
        setSelectedFunnelId(first.id);
      }
    }
    setLoadingFunnels(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toastError]);

  useEffect(() => {
    void loadFunnels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppLayout title={title}>
      <PageHero
        meta="Workspace · Marketing"
        title={title}
        highlight={title}
        description={t('funnels.subtitle')}
      />

      <Tabs defaultValue="funnels" className="w-full">
        <TabsList aria-label={title}>
          <TabsTrigger value="funnels" aria-label={t('funnels.tab.funnels')}>
            <span className="inline-flex items-center gap-2">
              <Icon as={Layers} size="sm" aria-hidden="true" />
              {t('funnels.tab.funnels')}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="analytics"
            aria-label={t('funnels.tab.analytics')}
          >
            <span className="inline-flex items-center gap-2">
              <Icon as={BarChart3} size="sm" aria-hidden="true" />
              {t('funnels.tab.analytics')}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* ── Onglet Funnels ──────────────────────────────────────────────── */}
        <TabsContent value="funnels" className="space-y-6 pt-6">
          <FunnelsManager />
        </TabsContent>

        {/* ── Onglet Analytique ───────────────────────────────────────────── */}
        <TabsContent value="analytics" className="space-y-6 pt-6">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-white p-4">
            {loadingFunnels ? (
              <Skeleton className="h-10 w-full max-w-md rounded-md" />
            ) : funnels.length === 0 ? (
              <EmptyState
                icon={<Icon as={BarChart3} size={32} aria-hidden="true" />}
                title={t('funnels.empty')}
              />
            ) : (
              <div className="max-w-md">
                <label
                  htmlFor="funnel-analytics-select"
                  className="mb-1 block text-xs font-medium text-[var(--text-muted)]"
                >
                  {t('funnels.analytics.select_funnel')}
                </label>
                <Select
                  id="funnel-analytics-select"
                  value={selectedFunnelId}
                  onChange={(e) => setSelectedFunnelId(e.target.value)}
                  aria-label={t('funnels.analytics.select_funnel')}
                >
                  {funnels.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.is_published ? '' : ` — ${t('funnels.publish')}`}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {selectedFunnelId ? (
            <FunnelAnalytics funnelId={selectedFunnelId} />
          ) : null}
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}

export default FunnelsPage;
