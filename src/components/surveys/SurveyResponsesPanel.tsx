// ── SurveyResponsesPanel — Sprint S52 (additif) ─────────────────────────────
// Surface les réponses (responses) d'un survey, jusqu'ici invisibles dans
// l'UI : aucune surface ne consommait listResponses / getSurveyResponse /
// getSurvey. Ce panneau les expose :
//   1. getSurvey(surveyId)        → en-tête (titre, publié, type)
//   2. listResponses(surveyId, …) → liste des sessions (filtre status)
//   3. getSurveyResponse(id)      → détail d'une session + answers (modal)
//
// API back FIGÉE. Imports RELATIFS (consigne Sprint 50). aria-labels i18n.
// 100 % additif — aucun composant existant modifié. Aucun console.log.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, RefreshCw, Eye, Mail, Clock } from 'lucide-react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Badge } from '../ui/Badge';
import { Select } from '../ui/Select';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t, getLocale } from '../../lib/i18n';
import { formatDateTime } from '../../lib/i18n/datetime';
import {
  getSurvey,
  listResponses,
  getSurveyResponse,
  type Survey,
  type SurveyResponse,
  type SurveyResponseAnswer,
  type SurveyResponseStatus,
} from '../../lib/api';

interface SurveyResponsesPanelProps {
  surveyId: string;
}

type StatusFilter = '' | SurveyResponseStatus;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Mappe un statut de réponse → intent Badge sémantique. */
function statusIntent(
  status?: SurveyResponseStatus | null,
): 'success' | 'info' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'in_progress') return 'info';
  return 'neutral';
}

/** Libellé i18n d'un statut (clés surveysx.* nouvelles). */
function statusLabel(status?: SurveyResponseStatus | null): string {
  if (status === 'completed') return t('surveysx.status.completed');
  if (status === 'in_progress') return t('surveysx.status.in_progress');
  if (status === 'abandoned') return t('surveysx.status.abandoned');
  return t('surveysx.status.unknown');
}

/** Formatte une date ISO en locale courte ; '—' si absente. */
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return formatDateTime(iso, getLocale());
  } catch {
    return d.toLocaleString();
  }
}

/** Rend défensivement une `answer_value` arbitraire en texte lisible. */
function renderAnswerValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '—';
    }
  }
  return String(v);
}

// ── Composant ──────────────────────────────────────────────────────────────

export function SurveyResponsesPanel({ surveyId }: SurveyResponsesPanelProps) {
  const { error: toastError } = useToast();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('');

  // ── Détail d'une réponse (modal) ─────────────────────────────────────────
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<
    (SurveyResponse & { answers: SurveyResponseAnswer[] }) | null
  >(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Survey detail (header) + responses en parallèle.
      const [surveyRes, listRes] = await Promise.all([
        getSurvey(surveyId),
        listResponses(surveyId, status ? { status } : undefined),
      ]);
      if (surveyRes.error) {
        // Non bloquant : on garde la liste mais on signale via toast.
        toastError(surveyRes.error);
        setSurvey(null);
      } else {
        setSurvey(surveyRes.data ?? null);
      }
      if (listRes.error) {
        toastError(listRes.error);
        setLoadError(listRes.error);
        setResponses([]);
      } else {
        setResponses(Array.isArray(listRes.data) ? listRes.data : []);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common.error.title');
      toastError(msg);
      setLoadError(msg);
      setResponses([]);
      setSurvey(null);
    } finally {
      setLoading(false);
    }
  }, [surveyId, status, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      try {
        const res = await getSurveyResponse(id);
        if (res.error) {
          toastError(res.error);
          setDetailError(res.error);
        } else {
          // Garde-fou : answers doit être un tableau pour les map() en aval.
          const data = res.data ?? null;
          if (data) {
            setDetail({
              ...data,
              answers: Array.isArray(data.answers) ? data.answers : [],
            });
          } else {
            setDetail(null);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('common.error.title');
        toastError(msg);
        setDetailError(msg);
      } finally {
        setDetailLoading(false);
      }
    },
    [toastError],
  );

  const openDetail = useCallback(
    (id: string) => {
      setDetailId(id);
      void loadDetail(id);
    },
    [loadDetail],
  );

  const closeDetail = useCallback(() => {
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const statusOptions = useMemo(
    () =>
      [
        { value: '', label: t('surveysx.filter.all') },
        { value: 'completed', label: t('surveysx.status.completed') },
        { value: 'in_progress', label: t('surveysx.status.in_progress') },
        { value: 'abandoned', label: t('surveysx.status.abandoned') },
      ] as Array<{ value: StatusFilter; label: string }>,
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section
      className="space-y-5"
      data-testid="survey-responses-panel"
      aria-labelledby="survey-responses-title"
    >
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3
            id="survey-responses-title"
            className="t-h3 text-[var(--text-primary)] flex items-center gap-2"
          >
            <Icon as={Inbox} size={20} />
            {t('surveysx.title')}
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
            {survey?.title ?? t('surveys.responses.title')}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Select
            label={t('surveysx.filter.status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            aria-label={t('surveysx.filter.status')}
            data-testid="survey-responses-status-filter"
          >
            {statusOptions.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Icon as={RefreshCw} size="sm" aria-hidden="true" />}
            onClick={() => void load()}
            aria-label={t('surveysx.refresh')}
            data-testid="survey-responses-refresh"
          >
            {t('surveysx.refresh')}
          </Button>
        </div>
      </header>

      {loading ? (
        <div
          className="space-y-2"
          data-testid="survey-responses-loading"
          aria-busy="true"
          aria-live="polite"
        >
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : loadError ? (
        <div
          role="alert"
          aria-live="polite"
          data-testid="survey-responses-error"
          className="p-5 rounded-xl border border-[var(--danger-soft,var(--border-subtle))] bg-[var(--danger-soft,var(--bg-subtle))] flex flex-col items-center gap-3 text-center"
        >
          <p className="text-sm font-medium text-[var(--danger,var(--text-primary))]">
            {t('common.error.title')}
          </p>
          <p className="text-xs text-[var(--text-secondary)] max-w-md break-words">
            {loadError}
          </p>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Icon as={RefreshCw} size="sm" aria-hidden="true" />}
            onClick={() => void load()}
            aria-label={t('common.retry')}
            data-testid="survey-responses-retry"
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : responses.length === 0 ? (
        <div data-testid="survey-responses-empty">
          <EmptyState
            icon={<Icon as={Inbox} size={32} />}
            title={t('surveysx.empty.title')}
            description={t('surveysx.empty.description')}
          />
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]"
          data-testid="survey-responses-list"
        >
          <table className="w-full text-sm">
            <caption className="sr-only">{t('surveysx.title')}</caption>
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('surveysx.col.respondent')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('surveysx.col.status')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('surveysx.col.started')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('surveysx.col.completed')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium text-right">
                  {t('surveysx.col.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r, i) => (
                <tr
                  key={r.id ?? `resp_${i}`}
                  className="border-b border-[var(--border-subtle)] last:border-0"
                  data-testid="survey-response-row"
                >
                  <td className="px-4 py-2 text-[var(--text-primary)]">
                    {r.respondent_name || r.respondent_email || (
                      <span className="text-[var(--text-muted)]">
                        {t('surveysx.anonymous')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge intent={statusIntent(r.status)} fill="soft" size="sm">
                      {statusLabel(r.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">
                    {fmtDate(r.started_at)}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">
                    {fmtDate(r.completed_at)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Icon as={Eye} size="sm" aria-hidden="true" />}
                      onClick={() => r.id && openDetail(r.id)}
                      disabled={!r.id}
                      aria-label={t('surveysx.view')}
                      data-testid="survey-response-view"
                    >
                      {t('surveysx.view')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Détail d'une réponse (modal) ──────────────────────────────────── */}
      <Modal
        open={detailId !== null}
        onOpenChange={(o) => {
          if (!o) closeDetail();
        }}
        title={t('surveysx.detail.title')}
        size="md"
        closeLabel={t('common.close')}
      >
        {detailLoading ? (
          <div
            className="space-y-2"
            data-testid="survey-response-detail-loading"
            aria-busy="true"
            aria-live="polite"
          >
            <Skeleton className="h-6 w-2/3 rounded" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : detailError ? (
          <div
            role="alert"
            aria-live="polite"
            data-testid="survey-response-detail-error"
            className="p-4 rounded-xl border border-[var(--border-subtle)] flex flex-col items-start gap-3"
          >
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {t('common.error.title')}
            </p>
            <p className="text-xs text-[var(--text-muted)] break-words">
              {detailError}
            </p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icon as={RefreshCw} size="sm" aria-hidden="true" />}
              onClick={() => detailId && void loadDetail(detailId)}
              aria-label={t('common.retry')}
              data-testid="survey-response-detail-retry"
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : detail ? (
          <div className="space-y-4" data-testid="survey-response-detail">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Icon as={Mail} size={12} aria-hidden="true" />
                  {t('surveysx.col.respondent')}
                </dt>
                <dd className="text-[var(--text-primary)]">
                  {detail.respondent_name ||
                    detail.respondent_email ||
                    t('surveysx.anonymous')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">
                  {t('surveysx.col.status')}
                </dt>
                <dd>
                  <Badge
                    intent={statusIntent(detail.status)}
                    fill="soft"
                    size="sm"
                  >
                    {statusLabel(detail.status)}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Icon as={Clock} size={12} aria-hidden="true" />
                  {t('surveysx.col.started')}
                </dt>
                <dd className="text-[var(--text-secondary)]">
                  {fmtDate(detail.started_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Icon as={Clock} size={12} aria-hidden="true" />
                  {t('surveysx.col.completed')}
                </dt>
                <dd className="text-[var(--text-secondary)]">
                  {fmtDate(detail.completed_at)}
                </dd>
              </div>
            </dl>

            <div className="space-y-2">
              <h4 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                {t('surveysx.answers.title')}
              </h4>
              {detail.answers.length === 0 ? (
                <p
                  className="text-sm text-[var(--text-muted)]"
                  data-testid="survey-response-answers-empty"
                  role="status"
                >
                  {t('surveysx.answers.empty')}
                </p>
              ) : (
                <ul className="space-y-2" data-testid="survey-response-answers">
                  {detail.answers.map((a, i) => (
                    <li
                      key={a.id ?? `${a.question_id ?? 'q'}_${i}`}
                      className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle,white)]"
                    >
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {a.question_id}
                      </p>
                      <p className="text-sm text-[var(--text-primary)] break-words">
                        {a.answer_text ?? renderAnswerValue(a.answer_value)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

export default SurveyResponsesPanel;
