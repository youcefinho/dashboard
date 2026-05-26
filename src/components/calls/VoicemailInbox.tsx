// ── VoicemailInbox — Sprint 34 (Agent B2) ───────────────────────────────────
// Boîte vocale structurée : liste paginée (gauche) + détail (droite) avec
// audio player lazy (signed R2 URL fetché au play seulement, économie réseau)
// + transcription + actions (marquer écouté, supprimer RGPD soft-delete).
//
// API helpers FIGÉS Phase A (lib/api.ts §6470+) :
//   - getVoicemails({ unread, lead_id, limit })  →  Voicemail[]
//   - getVoicemail(id)                           →  Voicemail (audio_url incl.)
//   - markVoicemailListened(id)                  →  POST /voicemails/:id/listen
//   - deleteVoicemail(id)                        →  DELETE (soft + RGPD cascade)
//   - getCallRecordingUrl(callLogId)             →  { url, expires_at, … }
//
// Sécurité : signed URL provient EXCLUSIVEMENT du worker (allowlist R2 + HMAC).
// On ne stocke jamais l'URL en composant parent — fetch on-demand au play.
//
// Capabilities côté worker :
//   - lecture/listen : 'leads.write'  (déjà appliqué — pas de check ici)
//   - delete (RGPD)  : 'settings.manage'

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2, Inbox, CheckCircle2, Volume2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useConfirm } from '../ui/ConfirmDialog';
import {
  getVoicemails,
  markVoicemailListened,
  deleteVoicemail,
  getCallRecordingUrl,
  type Voicemail,
} from '../../lib/api';
import { t } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import { cn } from '../../lib/cn';

// ── Helpers ────────────────────────────────────────────────────────────────

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  return t('voice.voicemail.duration', { seconds: s });
}

function getLocale(): string {
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'fr-CA';
}

// ── Composant ──────────────────────────────────────────────────────────────

export interface VoicemailInboxProps {
  /** Callback optionnel quand la liste change (refresh parent badge). */
  onChange?: () => void;
}

export function VoicemailInbox({ onChange }: VoicemailInboxProps) {
  const [voicemails, setVoicemails] = useState<Voicemail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [unreadOnly, setUnreadOnly] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Signed audio URL state (lazy — fetch au play).
  const [audioByVm, setAudioByVm] = useState<Record<string, string>>({});
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [marking, setMarking] = useState<boolean>(false);

  const confirm = useConfirm();
  const locale = useMemo(() => getLocale(), []);

  const selected = useMemo(
    () => voicemails.find((v) => v.id === selectedId) ?? null,
    [voicemails, selectedId],
  );

  // ── Fetch list ───────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getVoicemails({ unread: unreadOnly, limit: 50 });
    if (res.error) {
      setError(res.error);
      setVoicemails([]);
    } else {
      const list = res.data ?? [];
      setVoicemails(list);
      // Réconcilie selection : garde la sélection si toujours présente, sinon
      // sélectionne le 1er. Ne force PAS une sélection sur empty list.
      setSelectedId((prev) => {
        if (prev && list.some((v) => v.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    }
    setLoading(false);
  }, [unreadOnly]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  // ── Audio lazy fetch ─────────────────────────────────────
  const handleLoadAudio = useCallback(
    async (vm: Voicemail) => {
      if (!vm.call_log_id) return;
      if (audioByVm[vm.id]) return; // déjà chargé
      setAudioLoadingId(vm.id);
      const res = await getCallRecordingUrl(vm.call_log_id);
      if (!res.error && res.data?.url) {
        setAudioByVm((prev) => ({ ...prev, [vm.id]: res.data!.url }));
      }
      setAudioLoadingId(null);

      // Auto-mark listened au 1er play (idempotent worker-side).
      if (!vm.listened_at) {
        await markVoicemailListened(vm.id);
        // Refresh badge état UI sans re-fetch complet.
        setVoicemails((prev) =>
          prev.map((v) =>
            v.id === vm.id
              ? { ...v, listened_at: new Date().toISOString() }
              : v,
          ),
        );
        onChange?.();
      }
    },
    [audioByVm, onChange],
  );

  // ── Actions ──────────────────────────────────────────────
  const handleMarkListened = useCallback(async () => {
    if (!selected || selected.listened_at) return;
    setMarking(true);
    const res = await markVoicemailListened(selected.id);
    setMarking(false);
    if (!res.error) {
      await fetchList();
      onChange?.();
    }
  }, [selected, fetchList, onChange]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    const ok = await confirm({
      title: t('voice.voicemail.delete'),
      description: t('voice.recording.delete_confirm'),
      confirmLabel: t('voice.voicemail.delete'),
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    const res = await deleteVoicemail(selected.id);
    setDeleting(false);
    if (!res.error) {
      // Libère l'URL signée locale du voicemail supprimé.
      setAudioByVm((prev) => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });
      setSelectedId(null);
      await fetchList();
      onChange?.();
    }
  }, [selected, confirm, fetchList, onChange]);

  // ── Render ───────────────────────────────────────────────
  return (
    <div
      className="flex flex-col md:flex-row gap-4 w-full"
      data-testid="voicemail-inbox"
    >
      {/* ── Colonne gauche : liste + filtre ───────────────── */}
      <aside
        className={cn(
          'flex flex-col gap-3 w-full md:w-[360px] md:max-w-[40%]',
          'md:border-r md:border-[var(--border)] md:pr-4',
        )}
        aria-label={t('voice.voicemail.inbox_title')}
      >
        {/* Header + filtre */}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t('voice.voicemail.inbox_title')}
          </h2>
          <fieldset
            className="flex items-center gap-3 text-xs"
            aria-label={t('voice.voicemail.unread_filter')}
          >
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="vm-filter"
                checked={!unreadOnly}
                onChange={() => setUnreadOnly(false)}
                className="accent-[var(--primary)]"
                data-testid="vm-filter-all"
              />
              <span className="text-[var(--text-secondary)]">Tous</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="vm-filter"
                checked={unreadOnly}
                onChange={() => setUnreadOnly(true)}
                className="accent-[var(--primary)]"
                data-testid="vm-filter-unread"
              />
              <span className="text-[var(--text-secondary)]">
                {t('voice.voicemail.unread_filter')}
              </span>
            </label>
          </fieldset>
        </div>

        {/* Liste */}
        {loading ? (
          <div
            className="flex flex-col gap-2"
            data-testid="vm-list-loading"
            aria-busy="true"
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-2 p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)]"
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div
            className="p-3 rounded-[var(--radius-md)] border border-[var(--danger)]/30 bg-[var(--danger)]/5 text-sm text-[var(--danger)]"
            role="alert"
          >
            {error}
          </div>
        ) : voicemails.length === 0 ? (
          <div data-testid="vm-empty">
            <EmptyState
              icon={<Icon as={Inbox} size="lg" />}
              title={t('voice.voicemail.empty')}
            />
          </div>
        ) : (
          <ul
            className="flex flex-col gap-2"
            role="listbox"
            aria-label={t('voice.voicemail.inbox_title')}
            data-testid="vm-list"
          >
            {voicemails.map((vm) => {
              const isSelected = vm.id === selectedId;
              const isUnread = !vm.listened_at;
              return (
                <li key={vm.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(vm.id)}
                    role="option"
                    aria-selected={isSelected}
                    data-testid={`vm-item-${vm.id}`}
                    className={cn(
                      'w-full text-left flex flex-col gap-1.5 p-3',
                      'rounded-[var(--radius-md)] border bg-[var(--bg-surface)]',
                      'shadow-[var(--shadow-xs)] transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
                      'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-canvas)]',
                      isSelected
                        ? 'border-[var(--primary)] bg-[var(--bg-hover)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {vm.lead_name ||
                          t('voice.voicemail.from', { number: vm.from_number ?? '—' })}
                      </span>
                      {isUnread && (
                        <Badge intent="brand" fill="solid" size="sm">
                          Non lu
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                      <span>
                        {vm.created_at
                          ? formatRelativeTime(vm.created_at, locale)
                          : '—'}
                      </span>
                      <span>{formatDuration(vm.duration_sec)}</span>
                    </div>
                    {vm.transcription && (
                      <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                        {truncate(vm.transcription, 80)}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* ── Colonne droite : détail ────────────────────────── */}
      <section
        className="flex-1 min-w-0"
        aria-live="polite"
        data-testid="vm-detail"
      >
        {!selected ? (
          <div className="flex items-center justify-center min-h-[200px] p-6 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--bg-canvas)]">
            <p className="text-sm text-[var(--text-secondary)]">
              {t('voice.voicemail.empty')}
            </p>
          </div>
        ) : (
          <article
            className="flex flex-col gap-4 p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)]"
            aria-label={t('voice.voicemail.from', {
              number: selected.from_number ?? '—',
            })}
          >
            {/* Header detail */}
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1 min-w-0">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  {selected.lead_name ||
                    t('voice.voicemail.from', {
                      number: selected.from_number ?? '—',
                    })}
                </h3>
                <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                  <span>
                    {selected.created_at
                      ? formatRelativeTime(selected.created_at, locale)
                      : '—'}
                  </span>
                  <span>{formatDuration(selected.duration_sec)}</span>
                  {selected.listened_at && (
                    <span className="inline-flex items-center gap-1 text-[var(--success)]">
                      <Icon as={CheckCircle2} size="sm" />
                      {t('voice.voicemail.listened_at', {
                        when: formatRelativeTime(selected.listened_at, locale),
                      })}
                    </span>
                  )}
                </div>
              </div>
            </header>

            {/* Audio player — lazy fetch signed URL au click play */}
            <div className="flex flex-col gap-2">
              {audioByVm[selected.id] ? (
                <audio
                  controls
                  src={audioByVm[selected.id]}
                  preload="metadata"
                  className="w-full"
                  aria-label={t('voice.recording.play')}
                  data-testid="vm-audio"
                />
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleLoadAudio(selected)}
                  disabled={
                    audioLoadingId === selected.id || !selected.call_log_id
                  }
                  leftIcon={
                    audioLoadingId === selected.id ? (
                      <Icon as={Loader2} size="sm" className="animate-spin" />
                    ) : (
                      <Icon as={Volume2} size="sm" />
                    )
                  }
                  aria-label={t('voice.recording.play')}
                  data-testid="vm-audio-load"
                >
                  {t('voice.recording.play')}
                </Button>
              )}
            </div>

            {/* Transcription complète */}
            {selected.transcription ? (
              <div className="flex flex-col gap-1">
                <p
                  className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap"
                  data-testid="vm-transcription"
                >
                  {selected.transcription}
                </p>
              </div>
            ) : selected.transcription_status === 'pending' ? (
              <p className="text-xs italic text-[var(--text-secondary)]">
                {t('voice.recording.transcribing')}
              </p>
            ) : null}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {!selected.listened_at && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleMarkListened()}
                  disabled={marking}
                  leftIcon={
                    marking ? (
                      <Icon as={Loader2} size="sm" className="animate-spin" />
                    ) : (
                      <Icon as={CheckCircle2} size="sm" />
                    )
                  }
                  aria-label={t('voice.voicemail.mark_listened')}
                  data-testid="vm-mark-listened"
                >
                  {t('voice.voicemail.mark_listened')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleDelete()}
                disabled={deleting}
                leftIcon={
                  deleting ? (
                    <Icon as={Loader2} size="sm" className="animate-spin" />
                  ) : (
                    <Icon as={Trash2} size="sm" />
                  )
                }
                aria-label={t('voice.voicemail.delete')}
                data-testid="vm-delete"
              >
                {t('voice.voicemail.delete')}
              </Button>
            </div>
          </article>
        )}
      </section>
    </div>
  );
}

export default VoicemailInbox;
