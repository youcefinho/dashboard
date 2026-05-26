// ── Sprint 31 — Add payment method dialog (Manager-C / Agent C2) ────────────
// Modal qui :
//   1. Au mount → createStripeSetupIntent() → récupère clientSecret
//   2. Wrap <StripeElementsProvider clientSecret={...}> (Agent C1)
//   3. Rend <StripePaymentForm onSuccess={pmId => onAdded(pmId); onClose()} />
//   4. Sur success → toast + onAdded + onClose
//
// Reset du clientSecret à chaque ouverture (sinon Stripe Elements bind un
// vieux SetupIntent expiré). Cleanup contre race condition si user ferme
// pendant le fetch.

import { useEffect, useState } from 'react';
import { Modal, Skeleton, Button, useToast, Icon } from '@/components/ui';
import { AlertCircle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { createStripeSetupIntent } from '@/lib/api';
import { StripeElementsProvider } from './StripeElementsProvider';
import { StripePaymentForm } from './StripePaymentForm';

export interface AddPaymentMethodDialogProps {
  open: boolean;
  onClose: () => void;
  /** Appelé avec le `pm_xxx` (Stripe PaymentMethod ID) au succès. */
  onAdded: (paymentMethodId: string) => void;
}

export function AddPaymentMethodDialog({ open, onClose, onAdded }: AddPaymentMethodDialogProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const { success, error: toastError } = useToast();

  // Reset + fetch SetupIntent à chaque ouverture
  useEffect(() => {
    if (!open) {
      // Cleanup state à la fermeture (sinon mémoire stale entre 2 ouvertures)
      setClientSecret(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setError(null);
    setClientSecret(null);
    setLoading(true);

    createStripeSetupIntent()
      .then((res) => {
        if (cancelled) return;
        if (res.error || !res.data?.clientSecret) {
          setError(res.error || t('billing.real.error.stripe_api'));
          return;
        }
        setClientSecret(res.data.clientSecret);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('billing.real.error.stripe_api'));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSuccess = (paymentMethodId: string) => {
    success(t('billing.real.payment_method.added'));
    onAdded(paymentMethodId);
    onClose();
  };

  const handleError = (err: Error) => {
    const msg = err?.message || t('billing.real.error.stripe_api');
    setError(msg);
    toastError(msg);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('billing.real.payment_method.add')}
      description={t('billing.real.payment_method.add_description')}
      size="md"
      closeLabel={t('action.close')}
    >
      <div data-component="AddPaymentMethodDialog" className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 p-3 rounded-[var(--radius-md)] border border-[var(--danger-border,var(--border))] bg-[var(--danger-soft,var(--bg-muted))] text-[var(--danger-text,var(--text-primary))]"
          >
            <Icon as={AlertCircle} size={16} className="flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {loading && !clientSecret && !error && (
          <div className="space-y-3" aria-busy="true" aria-live="polite">
            <p className="text-sm text-[var(--text-secondary)]">
              {t('billing.real.payment_method.initializing')}
            </p>
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-2/3 rounded-md" />
          </div>
        )}

        {!error && clientSecret && (
          <StripeElementsProvider clientSecret={clientSecret}>
            <StripePaymentForm onSuccess={handleSuccess} onError={handleError} />
            <div className="flex justify-end mt-3">
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t('action.cancel')}
              </Button>
            </div>
          </StripeElementsProvider>
        )}

        {error && !clientSecret && (
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('action.close')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Re-trigger fetch en réutilisant l'effet : reset open path
                setError(null);
                setClientSecret(null);
                setLoading(true);
                void createStripeSetupIntent().then((res) => {
                  if (res.error || !res.data?.clientSecret) {
                    setError(res.error || t('billing.real.error.stripe_api'));
                    setLoading(false);
                    return;
                  }
                  setClientSecret(res.data.clientSecret);
                  setLoading(false);
                });
              }}
            >
              {t('action.retry')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default AddPaymentMethodDialog;
