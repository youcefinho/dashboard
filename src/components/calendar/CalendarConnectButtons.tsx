// ── CalendarConnectButtons — Sprint 33 C1 ────────────────────────────────────
// Boutons de connexion OAuth Google Calendar + Microsoft Outlook (calendrier).
//
// Pattern calqué sur GbpConnectButton (Sprint 32 C1) :
//   - Au montage, charge l'état actuel via getCalendarConnections().
//   - Pour chaque provider (google_calendar / outlook) :
//       * Si non connecté : affiche le bouton "Connecter <provider>" qui appelle
//         connectGcalSync() / connectOutlookSync() pour récupérer l'URL d'authorize
//         et fait un window.location.href top-level (flow OAuth natif).
//       * Si déjà connecté : affiche "Connecté en tant que <email>" + bouton
//         "Déconnecter" (confirmation native + disconnectCalendarConnection()
//         + reload de la liste).
//
// Honnêteté UI : si le backend renvoie une erreur (not_configured, etc.),
// l'erreur est affichée sous les boutons plutôt qu'un état silencieux.
//
// V1 : une connexion max par provider (find par provider). La structure
// `connections[]` reste un tableau pour préparer le multi-compte sans refactor.
//
// Tokens jamais exposés au front (le worker projette uniquement les métadonnées
// nécessaires : id, provider, externalAccountEmail, status).

import { useState, useEffect } from 'react';
import { t } from '@/lib/i18n';
import {
  getCalendarConnections,
  connectGcalSync,
  connectOutlookSync,
  disconnectCalendarConnection,
} from '@/lib/api';
import type { CalendarConnection } from '@/lib/types';
import { Button } from '@/components/ui';

interface Props {
  /** Callback optionnel invoqué après une connexion réussie (post-redirect). */
  onConnected?: () => void;
}

type Provider = 'gcal' | 'outlook';

export function CalendarConnectButtons({ onConnected: _onConnected }: Props) {
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingGcal, setConnectingGcal] = useState(false);
  const [connectingOutlook, setConnectingOutlook] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await getCalendarConnections();
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setConnections(res.data ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleConnect(provider: Provider) {
    if (provider === 'gcal') setConnectingGcal(true);
    else setConnectingOutlook(true);
    setError(null);

    const res =
      provider === 'gcal' ? await connectGcalSync() : await connectOutlookSync();

    if (provider === 'gcal') setConnectingGcal(false);
    else setConnectingOutlook(false);

    if (res.error) {
      // Honnêteté : not_configured = credentials serveur manquants côté worker.
      setError(res.error || t('calendar_sync.error.not_configured'));
      return;
    }
    if (res.data?.url) {
      // Flow OAuth top-level (calque GbpConnectButton / Google Calendar / Slack).
      window.location.href = res.data.url;
    }
  }

  async function handleDisconnect(connId: string) {
    // confirm() natif : suffisant pour cette action peu fréquente. Si besoin
    // ultérieur d'un design custom : remplacer par useConfirm() de @/components/ui.
    if (!window.confirm(t('calendar_sync.disconnect') + ' ?')) return;
    await disconnectCalendarConnection(connId);
    await load();
  }

  if (loading) {
    return (
      <div
        data-component="CalendarConnectButtons"
        data-loading
        className="text-xs text-[var(--text-muted)]"
      >
        …
      </div>
    );
  }

  // V1 : 1 connexion max par provider.
  const gcalConn = connections.find((c) => c.provider === 'google_calendar');
  const outlookConn = connections.find((c) => c.provider === 'outlook');

  return (
    <div data-component="CalendarConnectButtons" className="space-y-3">
      <h3 className="t-h3 text-[var(--text-primary)]">{t('calendar_sync.title')}</h3>
      <p className="text-sm text-[var(--text-muted)]">
        {t('calendar_sync.subtitle')}
      </p>

      <div className="space-y-2">
        {/* Google Calendar */}
        <div
          data-provider="google_calendar"
          className="flex items-center justify-between gap-3 flex-wrap p-3 border border-[var(--border)] rounded-[var(--radius-md)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          <div>
            <div className="font-medium text-[var(--text-primary)]">Google Calendar</div>
            {gcalConn && (
              <div className="text-xs text-[var(--success)]">
                {t('calendar_sync.connected_as').replace(
                  '{{email}}',
                  gcalConn.externalAccountEmail || '',
                )}
              </div>
            )}
          </div>
          {!gcalConn ? (
            <Button
              onClick={() => void handleConnect('gcal')}
              disabled={connectingGcal}
            >
              {connectingGcal ? '…' : t('calendar_sync.connect.gcal')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleDisconnect(gcalConn.id)}
            >
              {t('calendar_sync.disconnect')}
            </Button>
          )}
        </div>

        {/* Microsoft Outlook */}
        <div
          data-provider="outlook"
          className="flex items-center justify-between gap-3 flex-wrap p-3 border border-[var(--border)] rounded-[var(--radius-md)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          <div>
            <div className="font-medium text-[var(--text-primary)]">Microsoft Outlook</div>
            {outlookConn && (
              <div className="text-xs text-[var(--success)]">
                {t('calendar_sync.connected_as').replace(
                  '{{email}}',
                  outlookConn.externalAccountEmail || '',
                )}
              </div>
            )}
          </div>
          {!outlookConn ? (
            <Button
              onClick={() => void handleConnect('outlook')}
              disabled={connectingOutlook}
            >
              {connectingOutlook ? '…' : t('calendar_sync.connect.outlook')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleDisconnect(outlookConn.id)}
            >
              {t('calendar_sync.disconnect')}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-[var(--danger)] text-xs mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
