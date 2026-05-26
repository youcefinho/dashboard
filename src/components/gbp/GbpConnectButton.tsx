// ── GbpConnectButton — Sprint 32 C1 ─────────────────────────────────────────
// Bouton de connexion OAuth Google Business Profile (GBP).
//
// Pattern aligné sur les autres connecteurs OAuth (Google Calendar / Slack) :
//   - Au montage, charge l'état actuel via getGbpConnections().
//   - Si aucune connexion : affiche le bouton "Connecter Google Business Profile"
//     qui appelle connectGbp() pour récupérer l'URL d'authorize et fait un
//     window.location.href top-level (flow OAuth natif).
//   - Si déjà connecté : affiche "Connecté en tant que <gbpAccountName>" + bouton
//     "Déconnecter" (confirmation native + disconnectGbp() + reload).
//
// Honnêteté UI : si le backend renvoie une erreur (not_configured, etc.),
// l'erreur est affichée sous le bouton plutôt qu'un état silencieux.
//
// V1 : on n'expose qu'une seule connexion (le premier élément). La structure
// `connections[]` reste un tableau pour préparer le multi-compte sans refactor.
//
// Tokens jamais exposés au front (le worker projette uniquement les métadonnées
// nécessaires : id, gbpAccountId, gbpAccountName, status).

import { useState, useEffect } from 'react';
import { t } from '@/lib/i18n';
import { connectGbp, getGbpConnections, disconnectGbp } from '@/lib/api';
import type { GbpConnection } from '@/lib/types';
import { Button } from '@/components/ui';

interface Props {
  /** Callback optionnel invoqué après une connexion réussie (post-redirect). */
  onConnected?: () => void;
}

export function GbpConnectButton({ onConnected: _onConnected }: Props) {
  const [connections, setConnections] = useState<GbpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await getGbpConnections();
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

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    const res = await connectGbp();
    setConnecting(false);
    if (res.error) {
      // Honnêteté : not_configured = credentials serveur manquants côté worker.
      setError(res.error || t('gbp.error.not_configured'));
      return;
    }
    if (res.data?.url) {
      // Flow OAuth top-level (calque Google Calendar / Slack).
      window.location.href = res.data.url;
    }
  }

  async function handleDisconnect(connId: string) {
    // confirm() natif : suffisant pour cette action peu fréquente. Si besoin
    // ultérieur d'un design custom : remplacer par useConfirm() de @/components/ui.
    if (!window.confirm(t('gbp.disconnect') + '?')) return;
    await disconnectGbp(connId);
    await load();
  }

  if (loading) {
    return (
      <div data-component="GbpConnectButton" data-loading className="text-xs text-[var(--text-muted)]">
        …
      </div>
    );
  }

  // V1 : 1 connexion max par tenant (premier élément du tableau).
  const conn = connections[0];

  return (
    <div data-component="GbpConnectButton">
      {!conn && (
        <>
          <Button onClick={() => void handleConnect()} disabled={connecting}>
            {connecting ? '…' : t('gbp.connect')}
          </Button>
          {error && (
            <p className="text-[var(--danger)] text-xs mt-2" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {conn && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-[var(--success)]">
            {t('gbp.connected_as')}: {conn.gbpAccountName || conn.gbpAccountId}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void handleDisconnect(conn.id)}>
            {t('gbp.disconnect')}
          </Button>
        </div>
      )}
    </div>
  );
}
