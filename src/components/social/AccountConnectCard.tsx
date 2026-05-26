// ── AccountConnectCard — connexion sociale d'un réseau (flag INACTIF géré) ──
// LOT SOCIAL PLANNER (Sprint 9) — Manager-C (front). Affiche l'état d'un réseau
// (connecté / non connecté) + actions connecter/déconnecter. Gère PROPREMENT le
// cas « OAuth flag inactif » (connectSocialAccount renvoie { error } 400, calque
// oauth.ts) → message clair via i18n social.not_configured, PAS de crash.
// AUCUN CSS global.

import { Button } from '@/components/ui';
import { Tag } from '@/components/ui';
import type { SocialAccount, SocialProvider } from '@/lib/types';
import { NetworkIcon, networkLabel } from './NetworkPreview';
import { t } from '@/lib/i18n';

interface AccountConnectCardProps {
  provider: SocialProvider;
  /** Compte existant pour ce réseau (si déjà connecté/enregistré), sinon null. */
  account?: SocialAccount | null;
  connecting?: boolean;
  onConnect: (provider: SocialProvider) => void;
  onDisconnect: (account: SocialAccount) => void;
}

export function AccountConnectCard({
  provider,
  account = null,
  connecting = false,
  onConnect,
  onDisconnect,
}: AccountConnectCardProps) {
  // status applicatif : 'active' = connecté ; tout le reste (inactive/absent) =
  // non connecté (calque types.ts SocialAccount.status).
  const isActive = !!account && account.status === 'active';

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-3 min-w-0">
        <NetworkIcon provider={provider} />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{networkLabel(provider)}</p>
          {account?.account_name ? (
            <p className="text-xs text-[var(--text-muted)] truncate">{account.account_name}</p>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">{isActive ? '—' : t('social.not_configured')}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isActive ? (
          <>
            <Tag dot size="xs" variant="success">{t('social.status.published')}</Tag>
            {account && (
              <Button size="sm" variant="ghost" onClick={() => onDisconnect(account)}>
                {t('social.disconnect')}
              </Button>
            )}
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            isLoading={connecting}
            onClick={() => onConnect(provider)}
          >
            {t('social.connect')}
          </Button>
        )}
      </div>
    </div>
  );
}
