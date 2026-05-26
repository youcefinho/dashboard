// ── Sprint 31 — Payment methods list (Manager-C / Agent C2) ─────────────────
// Affiche la liste des moyens de paiement Stripe rattachés au client courant.
//   - GET /billing/stripe/payment-methods → liste (card / apple_pay / google_pay)
//   - Action "Définir par défaut" → POST /billing/stripe/payment-methods/{id}/default
//   - Action "Supprimer" → DELETE /billing/stripe/payment-methods/{id}
//   - Bouton "Ajouter" (optionnel via `onAddClick`) délégué au parent qui
//     ouvre <AddPaymentMethodDialog />.
//
// États gérés :
//   - loading (skeleton minimal)
//   - error (EmptyState avec message API)
//   - empty (EmptyState "ajoutez une carte")
//   - liste (cartes / wallets stylisés)
//
// i18n via clés `billing.real.payment_method.*` + `billing.real.error.*`.
// Pattern repris de BillingInvoicesList (fetch interne au mount).

import { useEffect, useState } from 'react';
import { Card, Button, Badge, Skeleton, EmptyState, Icon, useToast } from '@/components/ui';
import { CreditCard, Trash2, Star, Plus } from 'lucide-react';
import { t } from '@/lib/i18n';
import {
  listStripePaymentMethods,
  setDefaultStripePaymentMethod,
  deleteStripePaymentMethod,
} from '@/lib/api';
import type { StripePaymentMethod } from '@/lib/types';

export interface PaymentMethodsListProps {
  /** Callback déclenché quand l'utilisateur clique "Ajouter".
   *  Le parent ouvre <AddPaymentMethodDialog /> + rappelle `refresh()` au succès. */
  onAddClick?: () => void;
}

export function PaymentMethodsList({ onAddClick }: PaymentMethodsListProps) {
  const [methods, setMethods] = useState<StripePaymentMethod[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { success, error: toastError } = useToast();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listStripePaymentMethods();
      if (res.error) {
        setError(res.error);
        setMethods([]);
        return;
      }
      setMethods(res.data ?? []);
    } catch {
      setError(t('billing.real.error.stripe_api'));
      setMethods([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSetDefault(pm: StripePaymentMethod) {
    if (busyId) return;
    setBusyId(pm.stripePaymentMethodId);
    try {
      const res = await setDefaultStripePaymentMethod(pm.stripePaymentMethodId);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('billing.real.payment_method.default_updated'));
      await load();
    } catch {
      toastError(t('billing.real.error.stripe_api'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(pm: StripePaymentMethod) {
    if (busyId) return;
    // Confirmation native (rapide, accessible, pas de dépendance ConfirmProvider
    // dans le contrat d'API exigé par Sprint 31). Le parent peut wrapper avec
    // un ConfirmDialog s'il préfère un UX plus riche.
    if (
      typeof window !== 'undefined' &&
      typeof window.confirm === 'function' &&
      !window.confirm(t('billing.real.payment_method.remove_confirm'))
    ) {
      return;
    }
    setBusyId(pm.stripePaymentMethodId);
    try {
      const res = await deleteStripePaymentMethod(pm.stripePaymentMethodId);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('billing.real.payment_method.removed'));
      await load();
    } catch {
      toastError(t('billing.real.error.stripe_api'));
    } finally {
      setBusyId(null);
    }
  }

  function brandLabel(brand: string | null | undefined): string {
    if (brand === 'visa') return t('billing.real.payment_method.brand_visa');
    if (brand === 'mastercard') return t('billing.real.payment_method.brand_mastercard');
    if (brand === 'amex') return t('billing.real.payment_method.brand_amex');
    if (brand === 'discover') return t('billing.real.payment_method.brand_discover');
    return brand ?? t('billing.real.payment_method.brand_generic');
  }

  function pmLabel(pm: StripePaymentMethod): string {
    if (pm.type === 'apple_pay') return t('billing.real.payment_method.apple_pay');
    if (pm.type === 'google_pay') return t('billing.real.payment_method.google_pay');
    return `${brandLabel(pm.brand)} •••• ${pm.last4 ?? '????'}`;
  }

  function expiryLabel(pm: StripePaymentMethod): string | null {
    if (pm.type !== 'card') return null;
    if (!pm.expMonth || !pm.expYear) return null;
    return t('billing.real.payment_method.expires')
      .replace('{{month}}', String(pm.expMonth).padStart(2, '0'))
      .replace('{{year}}', String(pm.expYear));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const header = (
    <div className="flex justify-between items-center mb-4">
      <h3 className="text-base font-semibold text-[var(--text-primary)]">
        {t('billing.real.payment_method.title')}
      </h3>
      {onAddClick && (
        <Button
          variant="primary"
          size="sm"
          onClick={onAddClick}
          leftIcon={<Icon as={Plus} size={14} />}
        >
          {t('billing.real.payment_method.add')}
        </Button>
      )}
    </div>
  );

  if (loading) {
    return (
      <Card data-component="PaymentMethodsList" data-loading="true">
        {header}
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-component="PaymentMethodsList" data-error="true">
        {header}
        <EmptyState
          icon={<Icon as={CreditCard} size={48} />}
          title={t('billing.real.error.stripe_api')}
          description={error}
          variant="compact"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {t('action.retry')}
            </Button>
          }
        />
      </Card>
    );
  }

  if (methods.length === 0) {
    return (
      <Card data-component="PaymentMethodsList" data-empty="true">
        {header}
        <EmptyState
          icon={<Icon as={CreditCard} size={48} />}
          title={t('billing.real.payment_method.title')}
          description={t('billing.real.error.not_activated')}
          variant="first-time"
          action={
            onAddClick ? (
              <Button
                variant="primary"
                size="sm"
                onClick={onAddClick}
                leftIcon={<Icon as={Plus} size={14} />}
              >
                {t('billing.real.payment_method.add')}
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <Card data-component="PaymentMethodsList">
      {header}
      <ul className="space-y-2" role="list">
        {methods.map((pm) => {
          const expiry = expiryLabel(pm);
          const isBusy = busyId === pm.stripePaymentMethodId;
          return (
            <li
              key={pm.id}
              data-testid={`pm-${pm.stripePaymentMethodId}`}
              className="flex justify-between items-center gap-3 p-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--bg-muted)] text-[var(--text-secondary)]"
                  aria-hidden="true"
                >
                  <Icon as={CreditCard} size={18} />
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-[var(--text-primary)] text-sm truncate">
                    {pmLabel(pm)}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {expiry && (
                      <span className="text-xs text-[var(--text-muted)]">{expiry}</span>
                    )}
                    {pm.isDefault && (
                      <Badge intent="success" fill="soft" size="sm">
                        {t('billing.real.payment_method.is_default')}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                {!pm.isDefault && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleSetDefault(pm)}
                    disabled={isBusy}
                    isLoading={isBusy && busyId === pm.stripePaymentMethodId}
                    leftIcon={<Icon as={Star} size={13} />}
                  >
                    {t('billing.real.payment_method.set_default')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(pm)}
                  disabled={isBusy}
                  aria-label={t('billing.real.payment_method.remove')}
                  leftIcon={<Icon as={Trash2} size={13} />}
                >
                  {t('billing.real.payment_method.remove')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default PaymentMethodsList;
