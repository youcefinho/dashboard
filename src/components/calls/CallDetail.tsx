// ── CallDetail — Sprint 34 (Agent B4) ───────────────────────────────────────
// Panneau de détail d'un appel (CallLog) : header (direction + numéros + date
// + status + duration + disposition/notes), section enregistrement (réutilise
// <CallRecordingPlayer />), section transcription avec badges de status.
//
// Style Stripe-clean : surfaces neutres, badges intent-driven (Badge.tsx),
// aria-labels i18n via t(). Aucune fetch ici : la donnée arrive en prop
// callLog (assumé enrichi par le parent — typiquement page CallsListPage).
//
// API publique :
//   <CallDetail callLog={callLog} />

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Calendar, CheckSquare, AlertCircle } from 'lucide-react';
import { CallRecordingPlayer } from './CallRecordingPlayer';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { AiLoadingShimmer } from '../ui/AiLoadingShimmer';
import { formatDateTime } from '../../lib/i18n/datetime';
import { getLocale, t } from '../../lib/i18n';
import { getCallSummary, generateCallSummary, type CallSummary } from '../../lib/api';
import type { CallLog, Task } from '../../lib/api';

export interface CallDetailProps {
  callLog: CallLog;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

type DirectionDescriptor = {
  label: string;
  intent: 'success' | 'info' | 'danger' | 'neutral';
};

function getDirectionDescriptor(
  direction: string | null | undefined,
  status: string | null | undefined,
): DirectionDescriptor {
  // Manqué : prioritaire sur direction (un inbound non décroché = manqué)
  const isMissed =
    direction === 'inbound' &&
    (status === 'no-answer' || status === 'missed' || status === 'failed' || status === 'busy');
  if (isMissed) {
    return { label: 'Manqué', intent: 'danger' };
  }
  if (direction === 'outbound') {
    return { label: 'Sortant', intent: 'info' };
  }
  if (direction === 'inbound') {
    return { label: 'Entrant', intent: 'success' };
  }
  return { label: direction || '—', intent: 'neutral' };
}

type StatusIntent = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

function getStatusIntent(status: string | null | undefined): StatusIntent {
  switch (status) {
    case 'completed':
      return 'success';
    case 'in-progress':
    case 'initiated':
    case 'queued':
    case 'ringing':
      return 'info';
    case 'busy':
    case 'no-answer':
      return 'warning';
    case 'failed':
    case 'canceled':
      return 'danger';
    default:
      return 'neutral';
  }
}

type TranscriptionIntent = 'warning' | 'success' | 'danger' | 'neutral';

function getTranscriptionIntent(status: string | null | undefined): TranscriptionIntent {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'done':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export function CallDetail({ callLog }: CallDetailProps) {
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [aiTasks, setAiTasks] = useState<Task[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadSummary() {
      if (!callLog.id) return;
      setLoadingSummary(true);
      setSummaryError(null);
      try {
        const res = await getCallSummary(callLog.id);
        if (active) {
          if (res.data) {
            setSummary(res.data);
          } else {
            setSummary(null);
          }
        }
      } catch (err) {
        if (active) {
          setSummary(null);
        }
      } finally {
        if (active) setLoadingSummary(false);
      }
    }
    void loadSummary();
    return () => {
      active = false;
    };
  }, [callLog.id]);

  const handleGenerate = async () => {
    setGenerating(true);
    setSummaryError(null);
    try {
      const res = await generateCallSummary(callLog.id);
      if (res.data) {
        setSummary(res.data);
        if (res.data.tasks) {
          setAiTasks(res.data.tasks);
        }
      } else if (res.error) {
        setSummaryError(res.error || t('calls.ai.summary.error'));
      }
    } catch {
      setSummaryError(t('calls.ai.summary.error'));
    } finally {
      setGenerating(false);
    }
  };

  const locale = getLocale();
  const direction = getDirectionDescriptor(callLog.direction, callLog.status);
  const statusIntent = getStatusIntent(callLog.status);
  const transcriptionIntent = getTranscriptionIntent(callLog.transcription_status);
  const formattedCreatedAt = callLog.created_at
    ? formatDateTime(callLog.created_at, locale)
    : '—';
  const formattedCallDuration = formatDuration(callLog.duration_sec);
  const formattedRecordingDuration =
    callLog.recording_duration_sec != null
      ? formatDuration(callLog.recording_duration_sec)
      : null;

  return (
    <div className="flex flex-col gap-6" data-testid="call-detail">
      {/* ── Section 1 — Header ─────────────────────────────────────────── */}
      <section
        aria-label={t('voice.outbound.cta')}
        className="flex flex-col gap-4 p-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)]"
        data-testid="call-detail-header"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            intent={direction.intent}
            fill="soft"
            size="md"
            data-testid="call-detail-direction"
            aria-label={direction.label}
          >
            {direction.label}
          </Badge>
          <Badge
            intent={statusIntent}
            fill="soft"
            size="md"
            data-testid="call-detail-status"
            aria-label={callLog.status || ''}
          >
            {callLog.status || '—'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-primary)]">
          <span
            className="font-medium tabular-nums"
            data-testid="call-detail-from"
          >
            {callLog.from_number || '—'}
          </span>
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            →
          </span>
          <span
            className="font-medium tabular-nums"
            data-testid="call-detail-to"
          >
            {callLog.to_number || '—'}
          </span>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="flex flex-col">
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Date
            </dt>
            <dd
              className="text-[var(--text-primary)] tabular-nums"
              data-testid="call-detail-created-at"
            >
              {formattedCreatedAt}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Durée
            </dt>
            <dd
              className="text-[var(--text-primary)] tabular-nums"
              data-testid="call-detail-duration"
            >
              {formattedCallDuration}
            </dd>
          </div>
          {callLog.disposition ? (
            <div className="flex flex-col">
              <dt className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Disposition
              </dt>
              <dd
                className="text-[var(--text-primary)]"
                data-testid="call-detail-disposition"
              >
                {callLog.disposition}
              </dd>
            </div>
          ) : null}
        </dl>

        {callLog.notes ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Notes
            </span>
            <p
              className="text-sm text-[var(--text-primary)] whitespace-pre-wrap"
              data-testid="call-detail-notes"
            >
              {callLog.notes}
            </p>
          </div>
        ) : null}
      </section>

      {/* ── Section 2 — Enregistrement ─────────────────────────────────── */}
      <section
        aria-label={t('voice.recording.play')}
        className="flex flex-col gap-3"
        data-testid="call-detail-recording-section"
      >
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('voice.recording.play')}
          </h3>
          {formattedRecordingDuration ? (
            <span
              className="text-xs text-[var(--text-muted)] tabular-nums"
              data-testid="call-detail-recording-duration"
            >
              {formattedRecordingDuration}
            </span>
          ) : null}
        </header>

        {callLog.recording_r2_key ? (
          <>
            <CallRecordingPlayer callLogId={callLog.id} />
            {callLog.recording_consent_obtained_at ? (
              <Badge
                intent="success"
                fill="soft"
                size="sm"
                className="self-start"
                data-testid="call-detail-consent-badge"
                aria-label="Consentement obtenu"
              >
                Consentement obtenu
              </Badge>
            ) : null}
          </>
        ) : (
          <p
            className="text-sm text-[var(--text-muted)] italic p-4 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--bg-surface)]"
            data-testid="call-detail-no-recording"
          >
            Aucun enregistrement disponible
          </p>
        )}
      </section>

      {/* ── Section 3 — Transcription ──────────────────────────────────── */}
      <section
        aria-label={t('voice.recording.transcribing')}
        className="flex flex-col gap-3"
        data-testid="call-detail-transcription-section"
      >
        <header className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Transcription
          </h3>
          {callLog.transcription_status ? (
            <Badge
              intent={transcriptionIntent}
              fill="soft"
              size="sm"
              data-testid="call-detail-transcription-status"
              aria-label={t(`voice.recording.status.${callLog.transcription_status}`)}
            >
              {t(`voice.recording.status.${callLog.transcription_status}`)}
            </Badge>
          ) : null}
          {callLog.transcription_lang ? (
            <span
              className="text-xs text-[var(--text-muted)]"
              data-testid="call-detail-transcription-lang"
            >
              (Langue: {callLog.transcription_lang})
            </span>
          ) : null}
        </header>

        {callLog.transcription_status === 'done' && callLog.transcription ? (
          <p
            className="text-sm text-[var(--text-primary)] whitespace-pre-wrap p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)]"
            data-testid="call-detail-transcription-text"
          >
            {callLog.transcription}
          </p>
        ) : null}
      </section>

      {/* ── Section 4 — Compte-rendu IA ────────────────────────────────── */}
      <section
        className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-6"
        data-testid="call-detail-ai-summary-section"
      >
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
            <Sparkles size={16} className="text-[var(--primary)] animate-pulse" />
            {t('calls.ai.summary.title')}
          </h3>
        </header>

        {loadingSummary ? (
          <div className="space-y-2" data-testid="ai-summary-loading">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : summaryError ? (
          <div className="text-sm text-[var(--danger)] flex items-center gap-1.5" data-testid="ai-summary-error">
            <AlertCircle size={16} />
            <span>{summaryError}</span>
          </div>
        ) : summary ? (
          <div className="space-y-4">
            <div
              className="text-sm text-[var(--text-primary)] prose max-w-none p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)]"
              data-testid="call-detail-summary-text"
            >
              <ReactMarkdown>{summary.summary}</ReactMarkdown>
            </div>

            {aiTasks.length > 0 && (
              <div className="space-y-2" data-testid="call-detail-summary-tasks">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                  <CheckSquare size={14} />
                  {t('calls.ai.summary.tasks_created')}
                </h4>
                <ul className="space-y-2">
                  {aiTasks.map((task) => (
                    <li
                      key={task.id}
                      className="p-3 text-xs rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[var(--text-primary)]">{task.title}</span>
                        {task.due_date && (
                          <span className="text-[var(--text-muted)] flex items-center gap-1 shrink-0">
                            <Calendar size={12} />
                            {task.due_date}
                          </span>
                        )}
                      </div>
                      {task.description && (
                        <p className="text-[var(--text-secondary)]">{task.description}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 p-4 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--bg-surface)]">
            <p className="text-sm text-[var(--text-muted)] italic">
              {t('calls.ai.summary.empty')}
            </p>
            {generating ? (
              <AiLoadingShimmer text={t('calls.ai.summary.generating')} />
            ) : (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Sparkles size={14} />}
                disabled={callLog.transcription_status !== 'done' || !callLog.transcription}
                onClick={handleGenerate}
                data-testid="generate-summary-btn"
                title={
                  callLog.transcription_status !== 'done' || !callLog.transcription
                    ? t('calls.ai.summary.not_transcribed')
                    : undefined
                }
              >
                {t('calls.ai.summary.generate')}
              </Button>
            )}
            {callLog.transcription_status !== 'done' || !callLog.transcription ? (
              <span className="text-xs text-[var(--danger)]">
                {t('calls.ai.summary.not_transcribed')}
              </span>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

export default CallDetail;
