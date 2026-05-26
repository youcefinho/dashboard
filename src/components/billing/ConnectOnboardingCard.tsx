// ── Sprint 31 — Stripe Connect UI (Manager-C C3) ─────────────────────────────
// Card d'onboarding Stripe Connect d'un sous-compte client.
// Fetch au mount via getStripeConnectStatus(), affiche l'état (badge) et :
//   - account=null            → bouton "Configurer" (créer un Express account)
//   - account pending/restrict → bouton "Continuer" + requirements due
//   - account active          → message success, pas de CTA
//
// Le bouton "Configurer/Continuer" appelle createStripeConnectOnboarding(),
// récupère une URL Stripe-hosted KYC et redirige le user (full nav, pas popup
// car Stripe Connect refuse l'iframe).
//
// Routes refresh/return = /settings/billing avec query params pour différencier
// (le parent route peut reload sur ?return=1 → trigger refetch automatique).
import { useCallback, useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { getStripeConnectStatus, createStripeConnectOnboarding } from '@/lib/api';
import type { StripeConnectAccount } from '@/lib/types';
import { Card, Button, Skeleton, Icon } from '@/components/ui';
import { AlertCircle } from 'lucide-react';
import { ConnectStatusBadge } from './ConnectStatusBadge';

export interface ConnectOnboardingCardProps {
  /** Override URLs (par défaut : /settings/billing?refresh=1 et ?return=1) */
  refreshUrl?: string;
  returnUrl?: string;
  /** Callback à l'issue d'un onboarding complété (status active détecté) */
  onActivated?: (account: StripeConnectAccount) => void;
}

export function ConnectOnboardingCard(props: ConnectOnboardingCardProps = {}) {
  const { refreshUrl, returnUrl, onActivated } = props;

  const [account, setAccount] = useState<StripeConnectAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStripeConnectStatus();
      if (res.error) {
        setError(res.error);
        setAccount(null);
        return;
      }
      const acc = res.data ?? null;
      setAccount(acc);
      if (acc && acc.chargesEnabled && acc.payoutsEnabled) {
        onActivated?.(acc);
      }
    } catch {
      setError(t('billing.error.load'));
    } finally {
      setLoading(false);
    }
  }, [onActivated]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleOnboard = useCallback(async () => {
    if (onboarding) return;
    setOnboarding(true);
    setError(null);

    // URLs par défaut : route billing courante avec marqueur ?refresh / ?return.
    // Stripe rappelle refreshUrl si KYC expire avant complétion, et returnUrl
    // une fois l'utilisateur fini (success OU pas — vérifier status au retour).
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const defaultRefresh = `${origin}/settings/billing?refresh=1`;
    const defaultReturn = `${origin}/settings/billing?return=1`;

    try {
      const res = await createStripeConnectOnboarding({
        refreshUrl: refreshUrl ?? defaultRefresh,
        returnUrl: returnUrl ?? defaultReturn,
      });
      if (res.error || !res.data) {
        setError(res.error || t('billing.error.load'));
        return;
      }
      if (res.data.url && typeof window !== 'undefined') {
        // Full navigation — Stripe Connect onboarding refuse les iframes.
        window.location.href = res.data.url;
        // On laisse `onboarding=true` jusqu'au unload — pas de reset
        // pour éviter un flash "click again" pendant la redirection.
        return;
      }
      setError(t('billing.error.load'));
    } catch {
      setError(t('billing.error.load'));
    } finally {
      // Reset uniquement si on n'a pas redirigé (cas erreur ci-dessus).
      setOnboarding(false);
    }
  }, [onboarding, refreshUrl, returnUrl]);

  // ── State derivation ─────────────────────────────────────────────────────
  const requirementsDue = account?.requirements?.currently_due?.length ?? 0;
  const isPending = account != null && account.detailsSubmitted === false;
  const isRestricted =
    account != null && account.detailsSubmitted === true && !account.chargesEnabled;
  const isActive =
    account != null && account.chargesEnabled === true && account.payoutsEnabled === true;
  const needsAction = account == null || isPending || isRestricted;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Card
      className="p-5"
      data-component="ConnectOnboardingCard"
      data-loading={loading ? 'true' : undefined}
      data-state={
        loading
          ? 'loading'
          : account == null
            ? 'none'
            : isActive
              ? 'active'
              : isPending
                ? 'pending'
                : isRestricted
                  ? 'restricted'
                  : 'unknown'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-[17px] font-bold text-[var(--text-primary)]">
            {t('billing.real.connect.title')}
          </h3>
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5 text-pretty">
            {t('billing.real.connect.subtitle')}
          </p>
        </div>
        <ConnectStatusBadge account={account} />
      </div>

      {error && (
        <div
          className="mb-3 flex items-start gap-2 text-[13px] text-[var(--danger-text)]"
          role="alert"
          data-error="true"
        >
          <Icon as={AlertCircle} size={14} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-9 w-40" />
        </div>
      )}

      {!loading && !account && (
        <Button
          variant="primary"
          onClick={() => void handleOnboard()}
          disabled={onboarding}
          isLoading={onboarding}
          data-action="onboard"
        >
          {t('billing.real.connect.onboard_cta')}
        </Button>
      )}

      {!loading && account && needsAction && !isActive && (
        <div className="space-y-3">
          {requirementsDue > 0 && (
            <p
              className="text-[13px] text-[var(--warning-text)]"
              data-component="ConnectOnboardingCard-requirements"
              data-count={requirementsDue}
            >
              {t('billing.real.connect.requirements_due', { count: requirementsDue })}
            </p>
          )}
          <Button
            variant="primary"
            onClick={() => void handleOnboard()}
            disabled={onboarding}
            isLoading={onboarding}
            data-action="onboard"
          >
            {t('billing.real.connect.onboard_cta')}
          </Button>
        </div>
      )}

      {!loading && account && isActive && (
        <p className="text-[13px] text-[var(--success-text)]" data-state="active">
          {t('billing.real.connect.status_active')}
        </p>
      )}
    </Card>
  );
}

export default ConnectOnboardingCard;
