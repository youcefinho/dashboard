// ── CoursesLMSPage — Sprint 43 (Agent B2) ──────────────────────────────────
// Page standalone routée `/lms` — AppLayout + PageHero + Tabs 2 onglets :
//   - Leçons : Select course → <LessonsManager courseId={selected} />
//   - Certificats : Input customerId → <CertificatesList customerId={...} />
//
// Style Stripe-clean. Imports RELATIFS. Aucun console.log. aria-labels i18n.
//
// ── Renforcement (additif, 0 refactor) ──────────────────────────────────────
// Ajoute :
//   - État `loadError` + UI inline d'erreur avec retry (en plus du toast existant).
//   - aria-busy / role="status" pendant Skeleton (annonce screen reader).
//   - <ErrorBoundary> autour de LessonsManager + CertificatesList.
//   - Validation soft du customerId (longueur min 3) : si saisie non-vide trop
//     courte, n'instancie pas <CertificatesList /> et affiche l'EmptyState.
//   - data-testid sur les zones racines (faciliter QA Playwright).
// Aucun key i18n ajouté (parité STRICT préservée).

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Award, RefreshCcw } from 'lucide-react';
import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/Tabs';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Icon } from '../../components/ui/Icon';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { LessonsManager } from '../../components/lms/LessonsManager';
import { CertificatesList } from '../../components/lms/CertificatesList';
import { ErrorBoundary } from '../ErrorBoundary';
import { t } from '../../lib/i18n';
import { getCourses, type Course } from '../../lib/api';

// ── Composant ──────────────────────────────────────────────────────────────

export function CoursesLMSPage() {
  const title = t('lms.title');
  const { error: toastError } = useToast();

  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('');

  // ── Chargement courses ──────────────────────────────────────────────────
  const loadCourses = useCallback(async () => {
    setLoadingCourses(true);
    setLoadError(null);
    const res = await getCourses();
    if (res.error) {
      toastError(res.error);
      setLoadError(res.error);
      setCourses([]);
    } else if (res.data) {
      setCourses(res.data);
      // Auto-pick le premier cours publié si rien de selected.
      if (!selectedCourseId && res.data.length > 0) {
        const firstPublished =
          res.data.find((c) => c.is_published === 1) ?? res.data[0];
        if (firstPublished) setSelectedCourseId(firstPublished.id);
      }
    }
    setLoadingCourses(false);
  }, [selectedCourseId, toastError]);

  useEffect(() => {
    void loadCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Validation soft customerId (min 3 chars pour éviter mount fetch sur 1-2 chars).
  const trimmedCustomerId = customerId.trim();
  const customerIdValid = trimmedCustomerId.length >= 3;

  return (
    <AppLayout title={title}>
      <PageHero
        meta="Workspace · LMS"
        title={title}
        highlight={title}
        description={t('lms.lessons.title')}
      />

      <Tabs defaultValue="lessons" className="w-full">
        <TabsList aria-label={title}>
          <TabsTrigger value="lessons" aria-label={t('lms.lessons.title')}>
            <span className="inline-flex items-center gap-2">
              <Icon as={BookOpen} size="sm" aria-hidden="true" />
              {t('lms.lessons.title')}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="certificates"
            aria-label={t('lms.certificates.title')}
          >
            <span className="inline-flex items-center gap-2">
              <Icon as={Award} size="sm" aria-hidden="true" />
              {t('lms.certificates.title')}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* ── Onglet Leçons ────────────────────────────────────────────── */}
        <TabsContent value="lessons" className="space-y-6">
          <div
            className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            data-testid="lms-courses-card"
          >
            {loadingCourses ? (
              <div
                role="status"
                aria-busy="true"
                aria-label={t('state.loading')}
                data-testid="lms-courses-loading"
              >
                <Skeleton className="h-10 w-full max-w-md rounded-md" />
              </div>
            ) : loadError ? (
              <div
                role="alert"
                aria-live="polite"
                className="flex flex-wrap items-center gap-3"
                data-testid="lms-courses-error"
              >
                <p className="text-sm text-[var(--danger-text)]">{loadError}</p>
                <button
                  type="button"
                  onClick={() => void loadCourses()}
                  aria-label={`${t('action.retry')} — ${t('lms.lessons.title')}`}
                  data-testid="lms-courses-retry"
                  className="inline-flex items-center gap-1.5 text-xs rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-hover)]"
                >
                  <RefreshCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('action.retry')}
                </button>
              </div>
            ) : courses.length === 0 ? (
              <EmptyState
                icon={<Icon as={BookOpen} size={32} />}
                title={t('lms.lessons.empty')}
              />
            ) : (
              <div className="max-w-md">
                <Select
                  id="lms-course-select"
                  label={t('lms.lessons.title')}
                  value={selectedCourseId}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  aria-label={t('lms.lessons.title')}
                  data-testid="lms-course-select"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {c.is_published === 0 ? ` — ${t('lms.lessons.empty')}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {selectedCourseId ? (
            <ErrorBoundary>
              <LessonsManager courseId={selectedCourseId} />
            </ErrorBoundary>
          ) : null}
        </TabsContent>

        {/* ── Onglet Certificats ──────────────────────────────────────── */}
        <TabsContent value="certificates" className="space-y-6">
          <div
            className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            data-testid="lms-customer-card"
          >
            <div className="max-w-md">
              <Input
                id="lms-customer-id"
                label={t('lms.certificates.title')}
                placeholder="customer_id"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value.trim())}
                aria-label={t('lms.certificates.title')}
                aria-invalid={customerId.length > 0 && !customerIdValid ? true : undefined}
                data-testid="lms-customer-id-input"
              />
            </div>
          </div>

          {customerIdValid ? (
            <ErrorBoundary>
              <CertificatesList customerId={trimmedCustomerId} />
            </ErrorBoundary>
          ) : (
            <EmptyState
              icon={<Icon as={Award} size={32} />}
              title={t('lms.certificates.empty')}
            />
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}

export default CoursesLMSPage;
