// ── Sprint 22 — Billing Stripe prod (E4 flag mock) — Manager-C ──────────────
// Bannière "Mode démo" affichée tant que toute réponse billing renvoie
// isMock=true OU /api/billing/webhook-config renvoie modeMock=true.
// Dismiss session-only via sessionStorage (réapparaît au prochain reload).
//
// API :
//   - `visible?: boolean` (default true) — masque si false
//   - `dismissible?: boolean` (default true) — autorise le close (×)
//   - `reason?: 'stripe_not_configured' | 'live_branch_locked' | string`
//     — informatif, simple label sous le message (i18n optionnel)
import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Icon } from '@/components/ui';
import { t } from '@/lib/i18n';

export interface BillingMockBannerProps {
  visible?: boolean;
  dismissible?: boolean;
  reason?: string;
}

const SS_KEY = 'billing_mock_banner_dismissed';

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(SS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SS_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function BillingMockBanner(props: BillingMockBannerProps) {
  const { visible = true, dismissible = true, reason } = props;
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);

  if (!visible || dismissed) return null;

  const handleDismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex items-start gap-3 rounded-[var(--radius-lg)] border p-4 mb-4"
      style={{
        background: 'var(--info-soft, rgba(59,130,246,0.08))',
        borderColor: 'var(--info, #3B82F6)',
        color: 'var(--text-primary)',
      }}
      data-component="BillingMockBanner"
    >
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0"
        style={{
          background: 'var(--info, #3B82F6)',
          color: '#fff',
        }}
        aria-hidden="true"
      >
        <Icon as={AlertCircle} size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] text-[var(--text-primary)]">
          {t('billing.mock.banner.title')}
        </p>
        <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
          {t('billing.mock.banner.message')}
        </p>
        {reason && (
          <p className="mt-1 text-[11px] uppercase tracking-wider font-mono text-[var(--text-muted)]">
            {reason}
          </p>
        )}
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('common.close')}
          className="p-1 -m-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors shrink-0"
        >
          <Icon as={X} size={16} />
        </button>
      )}
    </div>
  );
}

export default BillingMockBanner;
