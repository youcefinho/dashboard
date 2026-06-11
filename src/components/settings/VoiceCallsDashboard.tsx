// ── VoiceCallsDashboard — Sprint 41 (Agent B2) ─────────────────────────────
// Dashboard d'historique des appels traités par l'AI Voice Agent.
// Layout 2 colonnes Stripe-clean :
//   • Gauche : liste compacte des calls (sélection courante highlight)
//   • Droite : détail call sélectionné (metadata + transcript + réponse AI
//              + escalation_reason si escaladé)
// Filtres top : toggle "Escalated only" + select script_id.
//
// API back FIGÉE (Phase A) :
//   getVoiceAgentCalls(filters?)  → ApiResponse<VoiceAgentCall[]>
//   getVoiceAgentCallDetail(id)   → ApiResponse<VoiceAgentCallDetail>
//   listVoiceAgentScripts()       → ApiResponse<VoiceAgentScript[]>
//
// Style : Stripe-clean, surfaces plates, focus ring purple, badges
// gris/vert/rouge. aria-labels i18n. Aucun console.log (CLAUDE.md).
// Imports RELATIFS (règle Sprint 41).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
import { PhoneCall, AlertTriangle, Bot, Phone, Clock } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { Badge } from '../ui/Badge';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t, getLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import {
  getVoiceAgentCalls,
  getVoiceAgentCallDetail,
  listVoiceAgentScripts,
  type VoiceAgentCall,
  type VoiceAgentCallDetail,
  type VoiceAgentCallFilters,
  type VoiceAgentScript,
  type VoiceAgentEscalationReason,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Formate une durée secondes → "mm:ss" (clamp >=0). */
function formatDuration(sec: number | null | undefined): string {
  const s = typeof sec === 'number' && Number.isFinite(sec) && sec >= 0 ? Math.floor(sec) : 0;
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Confidence 0..1 → "72 %". Null → "—". */
function formatConfidence(c: number | null | undefined): string {
  if (typeof c !== 'number' || !Number.isFinite(c)) return '—';
  const pct = Math.round(Math.max(0, Math.min(1, c)) * 100);
  return `${pct} %`;
}

/** Confidence → intent badge (rouge < 0.4, jaune < 0.7, vert ≥ 0.7). */
function confidenceIntent(
  c: number | null | undefined,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (typeof c !== 'number' || !Number.isFinite(c)) return 'neutral';
  if (c >= 0.7) return 'success';
  if (c >= 0.4) return 'warning';
  return 'danger';
}

/** Map raison d'escalade → libellé FR (clés i18n absentes — fallback inline). */
function escalationLabel(reason: VoiceAgentEscalationReason | null | undefined): string {
  switch (reason) {
    case 'low_confidence':
      return 'Confiance trop faible';
    case 'user_request':
      return 'Demande de l’appelant';
    case 'no_match':
      return 'Aucun script correspondant';
    case 'error':
      return 'Erreur technique';
    default:
      return '—';
  }
}

/**
 * Récupère un from_number éventuellement enrichi par le back depuis call_logs.
 * L'interface VoiceAgentCall est FIGÉE (Phase A) et ne l'expose pas
 * formellement, mais le worker peut le joindre — accès défensif typé.
 */
function pickFromNumber(call: VoiceAgentCall | VoiceAgentCallDetail | null): string | null {
  if (!call) return null;
  const anyCall = call as unknown as Record<string, unknown>;
  const candidate =
    (typeof anyCall.from_number === 'string' && anyCall.from_number) ||
    (typeof anyCall.caller_number === 'string' && anyCall.caller_number) ||
    null;
  return candidate ?? null;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function VoiceCallsDashboard() {
  const { error: toastError } = useToast();
  const locale = useMemo(() => getLocale(), []);

  // État liste
  const [calls, setCalls] = useState<VoiceAgentCall[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filtres
  const [filterEscalated, setFilterEscalated] = useState<boolean>(false);
  const [filterScriptId, setFilterScriptId] = useState<string>('');

  // Scripts (pour le select de filtre)
  const [scripts, setScripts] = useState<VoiceAgentScript[]>([]);

  // Sélection + détail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<VoiceAgentCallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  // ── Chargement scripts (filtre) — une fois au mount ─────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listVoiceAgentScripts();
      if (cancelled) return;
      if (res.error) {
        // Silencieux : pas de toast pour cette ressource auxiliaire.
        setScripts([]);
      } else if (res.data) {
        setScripts(res.data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Chargement liste calls (mount + sur changement filtres) ─────────────
  const loadCalls = useCallback(async () => {
    setLoading(true);
    const filters: VoiceAgentCallFilters = {};
    if (filterEscalated) filters.escalated = true;
    if (filterScriptId) filters.script_id = filterScriptId;
    const res = await getVoiceAgentCalls(filters);
    if (res.error) {
      toastError(res.error);
      setCalls([]);
    } else if (res.data) {
      setCalls(res.data);
      // Auto-sélectionne le premier si rien de sélectionné ou si la
      // sélection courante n'est plus dans la liste filtrée.
      const first = res.data[0];
      if (first) {
        const stillThere =
          selectedId && res.data.some((c) => c.id === selectedId);
        if (!stillThere) {
          setSelectedId(first.id);
        }
      } else {
        setSelectedId(null);
        setSelected(null);
      }
    }
    setLoading(false);
    // selectedId intentionnellement omis : on n'auto-reload pas la liste sur
    // simple changement de sélection (lecture détail séparée).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEscalated, filterScriptId, toastError]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  // ── Chargement détail au changement de sélection ────────────────────────
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      const res = await getVoiceAgentCallDetail(selectedId);
      if (cancelled) return;
      if (res.error) {
        toastError(res.error);
        setSelected(null);
      } else if (res.data) {
        setSelected(res.data);
      }
      setDetailLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, toastError]);

  // ── Handlers filtres ────────────────────────────────────────────────────
  const handleScriptChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      setFilterScriptId(e.target.value);
    },
    [],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  const labelEscalatedToggle = 'Escaladés uniquement';
  const labelScriptFilter = 'Filtrer par script';
  const labelAllScripts = 'Tous les scripts';
  const labelAriaList = t('voice_agent.calls.title');

  return (
    <div className="space-y-6" data-testid="voice-calls-dashboard">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('voice_agent.calls.title')}</h2>
        </div>
      </header>

      {/* Filtres */}
      <div
        className="flex flex-col sm:flex-row sm:items-end gap-4 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        data-testid="voice-calls-filters"
      >
        <div className="flex items-center gap-3">
          <Switch
            checked={filterEscalated}
            onCheckedChange={setFilterEscalated}
            label={labelEscalatedToggle}
            variant="danger"
            size="sm"
          />
        </div>
        <div className="flex-1 min-w-0 sm:max-w-xs">
          <Select
            label={labelScriptFilter}
            size="sm"
            value={filterScriptId}
            onChange={handleScriptChange}
            aria-label={labelScriptFilter}
          >
            <option value="">{labelAllScripts}</option>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Body 2 colonnes */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_1fr] gap-4">
        {/* ── Colonne gauche : liste ─────────────────────────────────── */}
        <section
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden"
          aria-label={labelAriaList}
        >
          {loading ? (
            <div className="p-3 space-y-2" data-testid="voice-calls-loading">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg border border-[var(--border-subtle)]"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 space-y-2 min-w-0">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-5 w-12 rounded-full shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          ) : calls.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={<Icon as={PhoneCall} size={32} />}
              title={t('voice_agent.calls.empty')}
            />
          ) : (
            <ul
              className="list-none p-0 m-0 divide-y divide-[var(--border-subtle)]"
              data-testid="voice-calls-list"
              aria-label={labelAriaList}
            >
              {calls.map((call) => {
                const isSelected = call.id === selectedId;
                const created = formatRelativeTime(call.created_at, locale);
                const fromNumber = pickFromNumber(call);
                const cIntent = confidenceIntent(call.confidence);
                return (
                  <li key={call.id} className="m-0">
                    <button
                      type="button"
                      onClick={() => setSelectedId(call.id)}
                      data-testid={`voice-call-row-${call.id}`}
                      aria-current={isSelected ? 'true' : undefined}
                      aria-label={`${t('voice_agent.calls.title')} — ${call.intent_detected ?? '—'} — ${created}`}
                      className={
                        'w-full text-left px-4 py-3 flex flex-col gap-1.5 transition-colors ' +
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ' +
                        (isSelected
                          ? 'bg-[var(--primary-soft)]'
                          : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)]')
                      }
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="font-medium text-sm text-[var(--text-primary)] truncate">
                          {call.intent_detected ?? '—'}
                        </span>
                        <span className="shrink-0 flex items-center gap-1.5">
                          <Badge intent={cIntent} size="sm">
                            {formatConfidence(call.confidence)}
                          </Badge>
                          {call.escalated ? (
                            <Badge intent="danger" size="sm">
                              {t('voice_agent.calls.escalated_badge')}
                            </Badge>
                          ) : null}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)] min-w-0">
                        <span className="truncate flex items-center gap-1.5">
                          {fromNumber ? (
                            <>
                              <Icon as={Phone} size={12} />
                              <span className="font-mono">{fromNumber}</span>
                            </>
                          ) : (
                            <span aria-hidden="true">—</span>
                          )}
                        </span>
                        <span className="shrink-0 flex items-center gap-1.5">
                          <Icon as={Clock} size={12} />
                          <span className="font-mono">
                            {formatDuration(call.duration_sec)}
                          </span>
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {created}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Colonne droite : détail ─────────────────────────────────── */}
        <section
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 min-h-[320px]"
          aria-label={t('voice_agent.calls.transcript')}
          data-testid="voice-call-detail"
        >
          {detailLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64" />
              <Skeleton className="h-3 w-40" />
              <div className="pt-4 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-10/12" />
                <Skeleton className="h-3 w-9/12" />
              </div>
            </div>
          ) : !selected ? (
            <EmptyState
              variant="compact"
              icon={<Icon as={PhoneCall} size={32} />}
              title={t('voice_agent.calls.empty')}
            />
          ) : (
            <div className="space-y-5">
              {/* Header metadata */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--text-primary)] truncate">
                    {selected.intent_detected ?? '—'}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {formatRelativeTime(selected.created_at, locale)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <Badge intent={confidenceIntent(selected.confidence)} size="md">
                    {t('voice_agent.calls.confidence_label')} {formatConfidence(selected.confidence)}
                  </Badge>
                  {selected.escalated ? (
                    <Badge intent="danger" size="md">
                      {t('voice_agent.calls.escalated_badge')}
                    </Badge>
                  ) : null}
                </div>
              </div>

              {/* Metadata bar */}
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="text-[var(--text-muted)]">
                    {t('voice_agent.calls.duration')}
                  </dt>
                  <dd className="font-mono text-[var(--text-primary)]">
                    {formatDuration(selected.duration_sec)}
                  </dd>
                </div>
                {pickFromNumber(selected) ? (
                  <div>
                    <dt className="text-[var(--text-muted)]">
                      {/* Pas de clé i18n dédiée — libellé direct */}
                      Numéro
                    </dt>
                    <dd className="font-mono text-[var(--text-primary)] truncate">
                      {pickFromNumber(selected)}
                    </dd>
                  </div>
                ) : null}
                {selected.script ? (
                  <div>
                    <dt className="text-[var(--text-muted)]">
                      {t('voice_agent.scripts.name')}
                    </dt>
                    <dd className="text-[var(--text-primary)] truncate">
                      {selected.script.name}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {/* Escalation banner */}
              {selected.escalated ? (
                <div
                  className="flex items-start gap-3 p-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)]"
                  role="alert"
                  aria-label={t('voice_agent.calls.escalated_badge')}
                >
                  <Icon as={AlertTriangle} size={16} className="text-[var(--danger-text)] mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--danger-text)]">
                      {t('voice_agent.calls.escalated_badge')}
                    </div>
                    <div className="text-xs text-[var(--danger-text)] mt-0.5">
                      {escalationLabel(selected.escalation_reason)}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Section réponse AI */}
              {selected.response_text ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge intent="brand" size="sm" dot>
                      <Icon as={Bot} size={12} className="mr-1" />
                      Réponse AI
                    </Badge>
                  </div>
                  <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed p-3 rounded-lg bg-[var(--bg-muted)] border border-[var(--border-subtle)]">
                    {selected.response_text}
                  </p>
                </div>
              ) : null}

              {/* Section transcript_full */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                  {t('voice_agent.calls.transcript')}
                </div>
                <div
                  className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed p-3 rounded-lg bg-[var(--bg-muted)] border border-[var(--border-subtle)] max-h-80 overflow-y-auto font-mono"
                  data-testid="voice-call-transcript"
                  tabIndex={0}
                  aria-label={t('voice_agent.calls.transcript')}
                >
                  {selected.transcript_full && selected.transcript_full.trim().length > 0
                    ? selected.transcript_full
                    : '—'}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
