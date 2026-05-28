// ── ExternalCalendarSync — Sprint 49 (surface calendar-sync controls) ───────
// Section additive pour la page Calendar : connecter Google Calendar (OAuth),
// lister les connexions + leurs calendriers externes, déclencher une sync now,
// et prévisualiser quelques événements externes.
//
// Flag-aware : si aucune connexion (pas de creds OAuth côté serveur) → empty
// state "connecter" clair, jamais de crash. 100 % additif — n'altère pas la
// vue calendrier existante.
//
// API (src/lib/api.ts, signatures FIGÉES — non modifiées) :
//   getGcalAuthUrl()        → ApiResponse<{ auth_url: string }>
//   getCalendarConnections()→ ApiResponse<CalendarConnection[]>
//   listExternalCalendars(connId) → ApiResponse<any[]>
//   syncGcal()              → ApiResponse<{ synced: number; total: number }>
//   getGcalEvents(min?,max?)→ ApiResponse<{ events: Array<Record<string,unknown>> }>

import { useCallback, useEffect, useState } from 'react';
import { Card, Button, Badge, Icon, useToast } from '@/components/ui';
import {
  getGcalAuthUrl,
  getCalendarConnections,
  listExternalCalendars,
  syncGcal,
  getGcalEvents,
} from '@/lib/api';
import type { CalendarConnection } from '@/lib/types';
import { t } from '@/lib/i18n';
import { RefreshCw, Plus, ExternalLink, CalendarClock, Eye } from 'lucide-react';

interface ExternalEventLite {
  id: string;
  summary: string;
  start: string | null;
}

function statusIntent(status: CalendarConnection['status']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'error' || status === 'revoked') return 'danger';
  if (status === 'paused') return 'warning';
  return 'neutral';
}

// Les events Gcal arrivent en Record<string, unknown> brut — extraction défensive.
function normalizeGcalEvent(raw: Record<string, unknown>, idx: number): ExternalEventLite {
  const id = typeof raw.id === 'string' ? raw.id : `gcal-${idx}`;
  const summary =
    typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary
      : t('calsync.event.untitled');
  let start: string | null = null;
  const startField = raw.start as unknown;
  if (typeof startField === 'string') {
    start = startField;
  } else if (startField && typeof startField === 'object') {
    const so = startField as Record<string, unknown>;
    if (typeof so.dateTime === 'string') start = so.dateTime;
    else if (typeof so.date === 'string') start = so.date;
  }
  return { id, summary, start };
}

export function ExternalCalendarSync() {
  const { success, error: toastError } = useToast();

  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Calendriers externes par connexion (lazy, déclenché à l'expand)
  const [externalCals, setExternalCals] = useState<Record<string, any[]>>({});
  const [externalLoading, setExternalLoading] = useState<Record<string, boolean>>({});
  const [externalError, setExternalError] = useState<Record<string, string | null>>({});

  // Aperçu événements externes (Gcal)
  const [events, setEvents] = useState<ExternalEventLite[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getCalendarConnections();
      if (res.data) setConnections(res.data);
      else if (res.error) setLoadError(res.error);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('calsync.error.load'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const res = await getGcalAuthUrl();
      if (res.data?.auth_url) {
        // Ouvre le flux OAuth Google dans un nouvel onglet.
        window.open(res.data.auth_url, '_blank', 'noopener,noreferrer');
        success(t('calsync.toast.connect_opened'));
      } else {
        toastError(res.error || t('calsync.error.connect'));
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('calsync.error.connect'));
    } finally {
      setIsConnecting(false);
    }
  }, [success, toastError]);

  const handleSyncNow = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await syncGcal();
      if (res.data) {
        success(t('calsync.toast.synced', { synced: res.data.synced, total: res.data.total }));
        void loadConnections();
      } else {
        toastError(res.error || t('calsync.error.sync'));
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('calsync.error.sync'));
    } finally {
      setIsSyncing(false);
    }
  }, [success, toastError, loadConnections]);

  const handleLoadExternal = useCallback(async (connId: string) => {
    // Toggle : si déjà chargé, on masque.
    if (externalCals[connId]) {
      setExternalCals((prev) => {
        const next = { ...prev };
        delete next[connId];
        return next;
      });
      return;
    }
    setExternalLoading((prev) => ({ ...prev, [connId]: true }));
    setExternalError((prev) => ({ ...prev, [connId]: null }));
    try {
      const res = await listExternalCalendars(connId);
      if (res.data) {
        setExternalCals((prev) => ({ ...prev, [connId]: res.data! }));
      } else {
        setExternalError((prev) => ({ ...prev, [connId]: res.error || t('calsync.error.external') }));
      }
    } catch (err) {
      setExternalError((prev) => ({
        ...prev,
        [connId]: err instanceof Error ? err.message : t('calsync.error.external'),
      }));
    } finally {
      setExternalLoading((prev) => ({ ...prev, [connId]: false }));
    }
  }, [externalCals]);

  const handlePreviewEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const now = new Date();
      const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const res = await getGcalEvents(now.toISOString(), in30d.toISOString());
      if (res.data) {
        setEvents(res.data.events.slice(0, 8).map((e, i) => normalizeGcalEvent(e, i)));
      } else {
        setEventsError(res.error || t('calsync.error.events'));
      }
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : t('calsync.error.events'));
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const fmtDate = (s: string | null): string => {
    if (!s) return '';
    const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const hasConnections = connections.length > 0;

  return (
    <Card className="p-4 mt-4" data-component="ExternalCalendarSync">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon as={CalendarClock} size={18} />
          <h3 className="text-sm font-semibold">{t('calsync.section.title')}</h3>
        </div>
        <div className="flex items-center gap-2">
          {hasConnections && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icon as={RefreshCw} size={14} />}
              onClick={() => void handleSyncNow()}
              disabled={isSyncing}
              aria-busy={isSyncing}
            >
              {isSyncing ? t('calsync.action.syncing') : t('calsync.action.sync_now')}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Icon as={Plus} size={14} />}
            onClick={() => void handleConnect()}
            disabled={isConnecting}
            aria-busy={isConnecting}
          >
            {isConnecting ? t('calsync.action.connecting') : t('calsync.action.connect_google')}
          </Button>
        </div>
      </div>

      <p className="text-xs text-[var(--text-muted)] mb-3">{t('calsync.section.subtitle')}</p>

      {/* ── Loading ── */}
      {isLoading && (
        <div className="text-xs text-[var(--text-muted)]" aria-busy="true">
          {t('calsync.loading')}
        </div>
      )}

      {/* ── Error ── */}
      {!isLoading && loadError && (
        <div
          className="text-xs p-3 rounded-lg border border-[var(--danger)]/30 text-[var(--danger)]"
          role="alert"
        >
          <p className="mb-2 break-all">{loadError}</p>
          <Button variant="ghost" size="sm" onClick={() => void loadConnections()}>
            {t('calsync.action.retry')}
          </Button>
        </div>
      )}

      {/* ── Empty state (flag-aware : pas de connexion / pas de creds) ── */}
      {!isLoading && !loadError && !hasConnections && (
        <div className="text-xs text-[var(--text-muted)] p-3 rounded-lg border border-dashed border-[var(--border)]">
          <p className="mb-2">{t('calsync.empty.title')}</p>
          <p>{t('calsync.empty.desc')}</p>
        </div>
      )}

      {/* ── Liste des connexions ── */}
      {!isLoading && !loadError && hasConnections && (
        <ul className="space-y-2">
          {connections.map((conn) => {
            const externals = externalCals[conn.id];
            const extLoading = externalLoading[conn.id];
            const extError = externalError[conn.id];
            return (
              <li key={conn.id} className="p-3 rounded-lg border border-[var(--border)]">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {conn.externalAccountEmail || conn.externalCalendarName || t('calsync.connection.unnamed')}
                      </span>
                      <Badge intent={statusIntent(conn.status)}>
                        {t(`calsync.status.${conn.status}`)}
                      </Badge>
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      {t(`calsync.provider.${conn.provider}`)}
                      {conn.lastPullAt && ` · ${t('calsync.last_sync', { date: fmtDate(conn.lastPullAt) })}`}
                    </div>
                    {conn.lastError && (
                      <div className="text-xs text-[var(--danger)] mt-1 break-all" role="alert">
                        {conn.lastError}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleLoadExternal(conn.id)}
                    disabled={extLoading}
                    aria-busy={extLoading || undefined}
                    aria-expanded={!!externals}
                  >
                    {externals ? t('calsync.action.hide_calendars') : t('calsync.action.show_calendars')}
                  </Button>
                </div>

                {/* Calendriers externes de cette connexion */}
                {extLoading && (
                  <div className="text-xs text-[var(--text-muted)] mt-2" aria-busy="true">
                    {t('calsync.loading')}
                  </div>
                )}
                {extError && (
                  <div className="text-xs text-[var(--danger)] mt-2" role="alert">
                    {extError}
                  </div>
                )}
                {externals && externals.length === 0 && (
                  <div className="text-xs text-[var(--text-muted)] mt-2">
                    {t('calsync.external.empty')}
                  </div>
                )}
                {externals && externals.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {externals.map((cal: any, i: number) => (
                      <li
                        key={(cal && (cal.id ?? cal.externalCalendarId)) ?? i}
                        className="text-xs flex items-center gap-2 text-[var(--text-secondary)]"
                      >
                        <Icon as={CalendarClock} size={12} />
                        <span className="truncate">
                          {(cal && (cal.summary ?? cal.name ?? cal.externalCalendarName)) ||
                            t('calsync.connection.unnamed')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Aperçu événements externes (Gcal, 30 prochains jours) ── */}
      {!isLoading && !loadError && hasConnections && (
        <div className="mt-4 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <h4 className="text-xs font-semibold">{t('calsync.preview.title')}</h4>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Icon as={Eye} size={14} />}
              onClick={() => void handlePreviewEvents()}
              disabled={eventsLoading}
              aria-busy={eventsLoading}
            >
              {eventsLoading ? t('calsync.action.loading_events') : t('calsync.action.preview_events')}
            </Button>
          </div>
          {eventsError && (
            <div className="text-xs text-[var(--danger)]" role="alert">
              {eventsError}
            </div>
          )}
          {events && events.length === 0 && !eventsError && (
            <div className="text-xs text-[var(--text-muted)]">{t('calsync.preview.empty')}</div>
          )}
          {events && events.length > 0 && (
            <ul className="space-y-1">
              {events.map((ev) => (
                <li key={ev.id} className="text-xs flex items-center gap-2 text-[var(--text-secondary)]">
                  <Icon as={ExternalLink} size={12} />
                  <span className="truncate">{ev.summary}</span>
                  {ev.start && <span className="text-[var(--text-muted)]">· {fmtDate(ev.start)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
