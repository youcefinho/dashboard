// ── Page Téléphonie — Journal d'appels global filtrable (Sprint 16, seq 116) ──
//   NEUVE (Manager-C). Journal global du tenant via getCallLogs() (sans lead_id =
//   tous les appels). Filtres direction/disposition câblés worker-side
//   (handleGetCallLogs accepte ?direction= / ?disposition=, Phase B) → on appelle
//   apiFetch('/calls?…') directement quand un filtre est actif (helper getCallLogs
//   FIGÉ Phase A). Colonnes : direction / numéro / lead / durée mm:ss / statut /
//   disposition. Lecteur recording si présent + transcription dépliable.
//   Libellés via clés i18n FIGÉES Phase A (telephony.*). Style Stripe sobre,
//   primitives existantes, ZÉRO CSS global.

import { useState, useEffect, useCallback, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Badge, Select, EmptyState, PageHero, Button, Skeleton, AiLoadingShimmer } from '@/components/ui';
import { apiFetch, getCallSummary, generateCallSummary, type CallLog, type CallSummary, type Task } from '@/lib/api';
import { t } from '@/lib/i18n';
import { PhoneIncoming, PhoneOutgoing, Phone, Sparkles, Calendar, CheckSquare, AlertCircle } from 'lucide-react';

// CallLog côté journal global : le worker (handleGetCallLogs) JOINT leads → expose
// `lead_name`. Le type FIGÉ ne le déclare pas → extension locale (lecture seule).
type CallLogRow = CallLog & { lead_name?: string | null };

const DISPOSITION_OPTIONS = ['interested', 'callback', 'voicemail', 'wrong_number', 'not_interested'] as const;

interface CallSummarySectionProps {
  callId: string;
  hasTranscription: boolean;
}

function CallSummarySection({ callId, hasTranscription }: CallSummarySectionProps) {
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [aiTasks, setAiTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadSummary() {
      if (!callId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await getCallSummary(callId);
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
        if (active) setLoading(false);
      }
    }
    void loadSummary();
    return () => {
      active = false;
    };
  }, [callId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateCallSummary(callId);
      if (res.data) {
        setSummary(res.data);
        if (res.data.tasks) {
          setAiTasks(res.data.tasks);
        }
      } else if (res.error) {
        setError(res.error || t('calls.ai.summary.error'));
      }
    } catch {
      setError(t('calls.ai.summary.error'));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3" data-testid="telephony-ai-summary">
      <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 flex items-center gap-1">
        <Sparkles size={11} className="text-[var(--primary)] animate-pulse" />
        {t('calls.ai.summary.title')}
      </h4>

      {loading ? (
        <div className="space-y-1" data-testid="summary-loading">
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <div className="text-[10px] text-[var(--danger)] flex items-center gap-1" data-testid="summary-error">
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      ) : summary ? (
        <div className="space-y-2">
          <div className="text-[10px] text-[var(--text-secondary)] prose max-w-none p-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] leading-relaxed">
            <ReactMarkdown>{summary.summary}</ReactMarkdown>
          </div>

          {aiTasks.length > 0 && (
            <div className="space-y-1" data-testid="summary-tasks">
              <h5 className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1">
                <CheckSquare size={9} />
                {t('calls.ai.summary.tasks_created')}
              </h5>
              <ul className="space-y-1">
                {aiTasks.map((task) => (
                  <li
                    key={task.id}
                    className="p-1.5 text-[9px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-medium text-[var(--text-primary)]">{task.title}</span>
                      {task.due_date && (
                        <span className="text-[var(--text-muted)] flex items-center gap-0.5 shrink-0">
                          <Calendar size={8} />
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
        <div className="flex flex-col items-start gap-1">
          {generating ? (
            <AiLoadingShimmer text={t('calls.ai.summary.generating')} />
          ) : (
            <div className="flex flex-col gap-1">
              <Button
                variant="secondary"
                size="sm"
                className="h-6 text-[9px] px-2 gap-1"
                leftIcon={<Sparkles size={9} />}
                disabled={!hasTranscription}
                onClick={handleGenerate}
                data-testid="generate-summary-btn"
              >
                {t('calls.ai.summary.generate')}
              </Button>
              {!hasTranscription && (
                <span className="text-[9px] text-[var(--danger)]">
                  {t('calls.ai.summary.not_transcribed')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TelephoniePage() {
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [direction, setDirection] = useState<'' | 'inbound' | 'outbound'>('');
  const [disposition, setDisposition] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Filtres OPTIONNELS câblés worker-side (Phase B). getCallLogs() FIGÉ ne porte
      // que lead_id → on appelle /calls directement pour direction/disposition.
      const params = new URLSearchParams();
      if (direction) params.set('direction', direction);
      if (disposition) params.set('disposition', disposition);
      const qs = params.toString();
      const res = await apiFetch<CallLogRow[]>(`/calls${qs ? `?${qs}` : ''}`);
      if (res.data) {
        setCalls(res.data);
      } else {
        // Discrimination res.error / !res.data (pattern §6.A) — sans `code`.
        setCalls([]);
        if (res.error) setLoadError(res.error);
      }
    } catch {
      setCalls([]);
      setLoadError(t('state.error'));
    }
    setLoading(false);
  }, [direction, disposition]);

  useEffect(() => { void loadData(); }, [loadData]);

  const fmtDuration = (sec: number | null | undefined) => {
    const s = sec || 0;
    if (!s) return '—';
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const statusColor = (status: string) =>
    status === 'completed' ? 'var(--success)' :
    status === 'failed' || status === 'no-answer' || status === 'noanswer' || status === 'busy' ? 'var(--danger)' :
    status === 'ringing' || status === 'queued' ? 'var(--warning)' : 'var(--text-muted)';

  // i18n statut (clés Phase A) — normalise no-answer → noanswer, fallback brut
  const statusLabel = (status: string) => {
    const key = `telephony.status.${(status || '').replace('-', '')}`;
    const tr = t(key);
    return tr === key ? (status || '—') : tr;
  };

  // i18n disposition (clés Phase A) — fallback brut si valeur hors whitelist
  const dispositionLabel = (d: string) => {
    const key = `telephony.disposition.${d}`;
    const tr = t(key);
    return tr === key ? d : tr;
  };

  return (
    <AppLayout title={t('telephony.page.title')}>
      <PageHero
        meta="Telephony"
        title={t('telephony.page.title')}
        highlight={t('telephony.calllog.title')}
        description={t('telephony.calllog.title')}
      />

      {/* Filtres direction / disposition */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <Select
          size="sm"
          containerClassName="w-44"
          label={t('telephony.calllog.title')}
          value={direction}
          onChange={(e) => setDirection(e.target.value as '' | 'inbound' | 'outbound')}
        >
          <option value="">—</option>
          <option value="inbound">{t('telephony.direction.inbound')}</option>
          <option value="outbound">{t('telephony.direction.outbound')}</option>
        </Select>
        <Select
          size="sm"
          containerClassName="w-52"
          label={t('telephony.page.filter_disposition')}
          value={disposition}
          onChange={(e) => setDisposition(e.target.value)}
        >
          <option value="">—</option>
          {DISPOSITION_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{t(`telephony.disposition.${opt}`)}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div
          className="space-y-2"
          role="status"
          aria-busy="true"
          aria-label={t('state.loading')}
          data-testid="tel-loading"
        >
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-12 rounded-[var(--radius-md)]" />)}
        </div>
      ) : loadError ? (
        <Card
          className="p-6"
          role="alert"
          aria-live="polite"
          data-testid="tel-error"
        >
          <p className="text-sm text-[var(--danger-text)] mb-3">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadData()}
            aria-label={`${t('action.retry')} — ${t('telephony.calllog.title')}`}
            data-testid="tel-btn-retry"
            className="text-xs rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-hover)]"
          >
            {t('action.retry')}
          </button>
        </Card>
      ) : calls.length === 0 ? (
        <div data-testid="tel-empty">
          <EmptyState
            icon={<Phone size={28} />}
            title={t('telephony.calllog.empty')}
          />
        </div>
      ) : (
        <Card className="overflow-hidden p-0" data-testid="tel-list">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="px-3 py-2 font-semibold">{t('telephony.direction.outbound')}</th>
                  <th className="px-3 py-2 font-semibold">{t('telephony.clicktocall.action')}</th>
                  <th className="px-3 py-2 font-semibold">{t('nav.leads')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('telephony.calllog.title')}</th>
                  <th className="px-3 py-2 font-semibold">{t('telephony.status.completed')}</th>
                  <th className="px-3 py-2 font-semibold">{t('telephony.disposition.label')}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => {
                  const isInbound = call.direction === 'inbound';
                  const number = isInbound ? call.from_number : call.to_number;
                  const hasDetail = !!(call.recording_url || call.transcription);
                  const isExpanded = expandedId === call.id;
                  return (
                    <Fragment key={call.id}>
                      <tr
                        className={`border-b border-[var(--border-subtle)] ${hasDetail ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : ''}`}
                        onClick={() => hasDetail && setExpandedId(isExpanded ? null : call.id)}
                        onKeyDown={(e) => {
                          if (!hasDetail) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setExpandedId(isExpanded ? null : call.id);
                          }
                        }}
                        tabIndex={hasDetail ? 0 : undefined}
                        role={hasDetail ? 'button' : undefined}
                        aria-expanded={hasDetail ? isExpanded : undefined}
                        aria-label={hasDetail ? t('telephony.transcription') : undefined}
                        data-testid={`tel-row-${call.id}`}
                      >
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            {isInbound
                              ? <PhoneIncoming size={13} className="text-[var(--success)] shrink-0" aria-label={t('telephony.direction.inbound')} />
                              : <PhoneOutgoing size={13} className="text-[var(--primary)] shrink-0" aria-label={t('telephony.direction.outbound')} />}
                            <span className="text-xs text-[var(--text-secondary)]">{isInbound ? t('telephony.direction.inbound') : t('telephony.direction.outbound')}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs tabular-nums">{number || '—'}</td>
                        <td className="px-3 py-2 text-xs">{call.lead_name || '—'}</td>
                        <td className="px-3 py-2 text-xs text-right tabular-nums text-[var(--text-muted)]">{fmtDuration(call.duration_sec)}</td>
                        <td className="px-3 py-2">
                          <Badge color={statusColor(call.status)}>{statusLabel(call.status)}</Badge>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {call.disposition
                            ? <Badge intent="brand">{dispositionLabel(call.disposition)}</Badge>
                            : <span className="text-[var(--text-muted)]">—</span>}
                        </td>
                      </tr>
                      {isExpanded && hasDetail && (
                        <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                          <td colSpan={6} className="px-3 py-2">
                            {call.recording_url && (
                              <audio controls preload="none" src={call.recording_url} className="w-full max-w-md h-8 mb-2" />
                            )}
                            {call.transcription && (
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">{t('telephony.transcription')}</p>
                                <p className="text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap leading-snug">{call.transcription}</p>
                              </div>
                            )}
                            {call.notes && (
                              <div className="mt-2">
                                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">{t('telephony.notes.label')}</p>
                                <p className="text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap leading-snug">{call.notes}</p>
                              </div>
                            )}
                            <CallSummarySection callId={call.id} hasTranscription={!!call.transcription} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AppLayout>
  );
}
