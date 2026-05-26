// ── SurveysAndDnsPage — Sprint 50 (Agent B2) ───────────────────────────────
// Page standalone routée `/settings/surveys-and-dns` — wrap les 3 surfaces
// Sprint 50 en un seul espace de gestion :
//   1. Surveys      → <SurveyBuilder />     (Agent B1)
//   2. NPS analytics → Select survey + <NpsAnalytics surveyId=... />  (Agent B1)
//   3. Domains      → <CustomDomainsManager />  (Agent B2 — ce LOT)
//
// Layout AppLayout + PageHero. Tabs Radix (3 onglets). Calque
// VoiceAgentPage / CurrencyMultiSettingsPage. Style Stripe-clean.
//
// Imports RELATIFS (consigne Sprint 50). aria-labels via t(). Aucun
// console.log (CLAUDE.md).

import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/Tabs';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../lib/i18n';
import {
  listSurveys,
  type Survey,
} from '../../lib/api';
import { SurveyBuilder } from '../../components/surveys/SurveyBuilder';
import { NpsAnalytics } from '../../components/surveys/NpsAnalytics';
import { CustomDomainsManager } from '../../components/dns/CustomDomainsManager';
import { ErrorBoundary } from '../ErrorBoundary';

type TabValue = 'surveys' | 'nps' | 'domains';

export function SurveysAndDnsPage() {
  const title = t('surveys.title');
  const [tab, setTab] = useState<TabValue>('surveys');

  // ── NPS tab — liste surveys NPS pour le selector ──────────────────────
  const { error: toastError } = useToast();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loadingSurveys, setLoadingSurveys] = useState<boolean>(true);
  const [surveysLoadError, setSurveysLoadError] = useState<string | null>(null);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string>('');

  const loadSurveys = useCallback(async () => {
    setLoadingSurveys(true);
    setSurveysLoadError(null);
    const res = await listSurveys({ type: 'nps' });
    if (res.error) {
      toastError(res.error);
      setSurveysLoadError(res.error);
      setSurveys([]);
    } else if (res.data) {
      setSurveys(res.data);
      // Sélection par défaut : 1er survey de la liste si rien sélectionné.
      const first = res.data[0];
      if (first && !selectedSurveyId) {
        setSelectedSurveyId(first.id);
      }
    }
    setLoadingSurveys(false);
  }, [selectedSurveyId, toastError]);

  // Charge la liste des surveys NPS uniquement quand l'utilisateur ouvre
  // l'onglet NPS (évite un fetch inutile au mount).
  useEffect(() => {
    if (tab === 'nps') {
      void loadSurveys();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <AppLayout title={title}>
      <PageHero
        meta={t('page.meta.workspace_settings')}
        title={`${t('surveys.title')} & ${t('dns.title')}`}
        highlight={title}
        description={`${t('surveys.responses.title')} · ${t('surveys.nps.score')} · ${t('dns.records.title')}`}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} data-testid="surveys-and-dns-tabs">
        <TabsList aria-label={title}>
          <TabsTrigger value="surveys" data-testid="surveys-and-dns-tab-surveys">
            {t('surveys.title')}
          </TabsTrigger>
          <TabsTrigger value="nps" data-testid="surveys-and-dns-tab-nps">
            {t('surveys.nps.score')}
          </TabsTrigger>
          <TabsTrigger value="domains" data-testid="surveys-and-dns-tab-domains">
            {t('dns.title')}
          </TabsTrigger>
        </TabsList>

        {/* Tab 1 — Surveys (Agent B1) */}
        <TabsContent value="surveys" data-testid="surveys-and-dns-pane-surveys">
          <ErrorBoundary>
            <SurveyBuilder />
          </ErrorBoundary>
        </TabsContent>

        {/* Tab 2 — NPS analytics (Agent B1) — Select survey NPS + dashboard */}
        <TabsContent value="nps" data-testid="surveys-and-dns-pane-nps">
          <ErrorBoundary>
            <div className="space-y-5">
              <header className="flex items-end justify-between gap-4 flex-wrap">
                <div className="min-w-0 max-w-md flex-1">
                  {loadingSurveys ? (
                    <Skeleton
                      className="h-9 w-full rounded-md"
                      aria-busy="true"
                      aria-live="polite"
                    />
                  ) : (
                    <Select
                      label={t('surveys.title')}
                      value={selectedSurveyId}
                      onChange={(e) => setSelectedSurveyId(e.target.value)}
                      disabled={surveys.length === 0}
                      aria-label={t('surveys.title')}
                      data-testid="surveys-and-dns-nps-select"
                    >
                      {surveys.length === 0 ? (
                        <option value="">{t('surveys.empty')}</option>
                      ) : (
                        surveys.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))
                      )}
                    </Select>
                  )}
                </div>
              </header>

              {/* Error state (load surveys NPS failed) — a11y role=alert
                  + retry button. Affiché en plus du toast pour persistance. */}
              {surveysLoadError ? (
                <div
                  className="rounded-xl border border-[var(--border-subtle)] p-6 flex flex-col items-start gap-3"
                  role="alert"
                  aria-live="polite"
                  data-testid="surveys-and-dns-nps-error"
                >
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {t('common.loading_error')}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">{surveysLoadError}</p>
                  <button
                    type="button"
                    onClick={() => void loadSurveys()}
                    className="text-xs underline text-[var(--text-primary)]"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              ) : selectedSurveyId ? (
                <NpsAnalytics surveyId={selectedSurveyId} />
              ) : (
                <div
                  className="rounded-xl border border-dashed border-[var(--border-subtle)] p-10 text-center text-sm text-[var(--text-muted)]"
                  data-testid="surveys-and-dns-nps-empty"
                  role="status"
                  aria-live="polite"
                >
                  {t('surveys.empty')}
                </div>
              )}
            </div>
          </ErrorBoundary>
        </TabsContent>

        {/* Tab 3 — Domains (Agent B2 — ce LOT) */}
        <TabsContent value="domains" data-testid="surveys-and-dns-pane-domains">
          <ErrorBoundary>
            <CustomDomainsManager />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}

export default SurveysAndDnsPage;
