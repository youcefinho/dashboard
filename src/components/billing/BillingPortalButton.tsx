// ── Sprint 22 — Billing Stripe prod (E4 flag mock) — Manager-C ──────────────
// Bouton "Gérer dans le portail" → POST /api/billing/portal-session :
//   - Si data.isMock=true → toast info "Action non disponible en mode démo"
//     + appel optionnel onMockNotice(). Pas de window.open.
//   - Si live → window.open(url, '_blank').
// Capacitor/PWA-friendly : window.open autorisé pour URL externe portal.
import { useState } from 'react';
import { Button, useToast, Icon } from '@/components/ui';
import { ExternalLink } from 'lucide-react';
import { t } from '@/lib/i18n';
import { createBillingPortalSession } from '@/lib/api';

export interface BillingPortalButtonProps {
  returnUrl?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Appelé quand l'API renvoie isMock:true (avant le toast). Utile pour
   *  afficher un Banner mock dans le panel parent. */
  onMockNotice?: () => void;
}

export function BillingPortalButton(props: BillingPortalButtonProps) {
  const { returnUrl, disabled, variant = 'primary', onMockNotice } = props;
  const { info, error: toastError } = useToast();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading || disabled) return;
    setLoading(true);
    try {
      const res = await createBillingPortalSession(returnUrl ? { returnUrl } : {});
      if (res.error || !res.data) {
        toastError(res.error || t('billing.portal.error'));
        return;
      }
      if (res.data.isMock) {
        onMockNotice?.();
        info(t('billing.mock.action_unavailable'));
        return;
      }
      // Live : ouvrir dans nouvel onglet
      if (typeof window !== 'undefined') {
        window.open(res.data.url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      toastError(t('billing.portal.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={variant}
      onClick={() => {
        void handleClick();
      }}
      disabled={disabled || loading}
      isLoading={loading}
      leftIcon={loading ? undefined : <Icon as={ExternalLink} size={14} />}
      data-component="BillingPortalButton"
    >
      {loading ? t('billing.portal.opening') : t('billing.action.manage_in_portal')}
    </Button>
  );
}

export default BillingPortalButton;
