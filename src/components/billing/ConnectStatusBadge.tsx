// ── Sprint 31 — Stripe Connect UI (Manager-C C3) ─────────────────────────────
// Badge d'état d'un compte Stripe Connect d'un client (sous-account).
// 4 états logiques mappés sur intents du Badge primitive :
//   - null               → neutral "—"
//   - charges+payouts ON → success  (status_active)
//   - !detailsSubmitted  → warning  (status_pending)
//   - detailsSubmitted   → danger   (status_restricted)
//     mais !chargesEnabled (KYC soumis mais Stripe a restreint)
//
// Pas de fetch ici — composant purement présentational. Le parent
// (ConnectOnboardingCard) gère l'état et passe `account`.
import { t } from '@/lib/i18n';
import type { StripeConnectAccount } from '@/lib/types';
import { Badge } from '@/components/ui';

export interface ConnectStatusBadgeProps {
  account: StripeConnectAccount | null;
}

export function ConnectStatusBadge({ account }: ConnectStatusBadgeProps) {
  if (!account) {
    return (
      <Badge intent="neutral" fill="soft" data-component="ConnectStatusBadge" data-state="none">
        —
      </Badge>
    );
  }

  if (account.chargesEnabled && account.payoutsEnabled) {
    return (
      <Badge intent="success" fill="soft" data-component="ConnectStatusBadge" data-state="active">
        {t('billing.real.connect.status_active')}
      </Badge>
    );
  }

  if (!account.detailsSubmitted) {
    return (
      <Badge intent="warning" fill="soft" data-component="ConnectStatusBadge" data-state="pending">
        {t('billing.real.connect.status_pending')}
      </Badge>
    );
  }

  // detailsSubmitted=true mais pas chargesEnabled → restricted (Stripe a bloqué)
  return (
    <Badge intent="danger" fill="soft" data-component="ConnectStatusBadge" data-state="restricted">
      {t('billing.real.connect.status_restricted')}
    </Badge>
  );
}

export default ConnectStatusBadge;
