// ── Sprint 22 — Billing Stripe prod (E4 flag mock) — Manager-C ──────────────
// Panneau billing enrichi (vue complète, distincte de la vue compacte
// `<BillingSettings />` qui reste affichée AVANT — rétro-compat absolue).
//
// Fetch au mount :
//   - getBillingPlans()
//   - getCurrentSubscription()
//   - getBillingUsage()
//   - getBillingWebhookConfig()
//   - listBillingInvoices()
//
// Sections :
//   1. BillingMockBanner si mock détecté
//   2. PlanSelector (4 plans + toggle monthly/yearly)
//   3. Subscription actions (portal + resume si canceled + cancel si active)
//   4. BillingInvoicesList
//   5. WebhookConfigPanel
//
// `data.mock===true` côté mutations → toast i18n + refetch.
import { useCallback, useEffect, useState } from 'react';
import { Card, Button, Badge, Skeleton, useToast, useConfirm, Icon } from '@/components/ui';
import { CreditCard, AlertCircle, PlayCircle, XCircle } from 'lucide-react';
import { t, getLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';
import {
  getBillingPlans,
  listBillingSubscriptions,
  getBillingUsage,
  getBillingWebhookConfig,
  listBillingInvoices,
  changeSubscriptionPlan,
  cancelSubscription,
  resumeSubscription,
} from '@/lib/api';
import type {
  PlanTier,
  BillingPeriod,
  BillingPlanCatalog,
  ClientSubscription,
  BillingUsage,
  BillingWebhookConfig,
  BillingInvoiceMock,
  SubscriptionStatus,
} from '@/lib/types';

import { BillingMockBanner } from './BillingMockBanner';
import { PlanSelector } from './PlanSelector';
import { BillingPortalButton } from './BillingPortalButton';
import { BillingInvoicesList } from './BillingInvoicesList';
import { WebhookConfigPanel } from './WebhookConfigPanel';
// ── Sprint 31 — Payment Methods + Stripe Connect onboarding ────────────────
import { PaymentMethodsList } from './PaymentMethodsList';
import { AddPaymentMethodDialog } from './AddPaymentMethodDialog';
import { ConnectOnboardingCard } from './ConnectOnboardingCard';

export interface BillingPlanPanelProps {
  onPlanChanged?: (newTier: PlanTier) => void;
}

function statusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case 'active': return t('billing.subscription.status.active');
    case 'trialing': return t('billing.subscription.status.trialing');
    case 'past_due': return t('billing.subscription.status.past_due');
    case 'canceled': return t('billing.subscription.status.canceled');
    case 'incomplete':
    case 'incomplete_expired':
      return t('billing.subscription.status.incomplete');
    case 'paused': return t('billing.subscription.status.paused');
  }
}

function statusIntent(status: SubscriptionStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'active': return 'success';
    case 'trialing': return 'info';
    case 'past_due': return 'warning';
    case 'canceled':
    case 'incomplete_expired':
      return 'danger';
    case 'incomplete':
    case 'paused':
      return 'neutral';
  }
}

export function BillingPlanPanel(props: BillingPlanPanelProps) {
  const { onPlanChanged } = props;
  const { success, info, error: toastError } = useToast();
  const confirm = useConfirm();

  const [plans, setPlans] = useState<BillingPlanCatalog[]>([]);
  const [subscription, setSubscription] = useState<ClientSubscription | null>(null);
  const [subscriptions, setSubscriptions] = useState<ClientSubscription[]>([]);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [webhookConfig, setWebhookConfig] = useState<BillingWebhookConfig | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoiceMock[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mockNoticeForced, setMockNoticeForced] = useState(false);

  // ── Sprint 31 — Add payment method dialog state ───────────────────────────
  const [addPmOpen, setAddPmOpen] = useState(false);
  const [pmRefreshKey, setPmRefreshKey] = useState(0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [plansRes, subsRes, usageRes, hookRes, invRes] = await Promise.all([
        getBillingPlans(),
        listBillingSubscriptions(),
        getBillingUsage(),
        getBillingWebhookConfig(),
        listBillingInvoices(),
      ]);

      // Dégrade gracieusement : aucun fetch ne doit faire crash
      if (plansRes.data) setPlans(plansRes.data);
      if (subsRes.data) {
        setSubscriptions(subsRes.data);
        const mainSub = subsRes.data.find(s => !s.parentSubscriptionId) || subsRes.data[0] || null;
        setSubscription(mainSub);
      } else {
        setSubscriptions([]);
        setSubscription(null);
      }
      if (usageRes.data) setUsage(usageRes.data);
      if (hookRes.data) setWebhookConfig(hookRes.data);
      if (invRes.data) setInvoices(invRes.data);
      else setInvoices([]);

      // Si tous les endpoints failent → error message
      if (
        plansRes.error &&
        subsRes.error &&
        usageRes.error &&
        hookRes.error &&
        invRes.error
      ) {
        setLoadError(plansRes.error || t('billing.error.load'));
      }
    } catch {
      setLoadError(t('billing.error.load'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Détecte si quelque chose dans la pile billing est en mode mock
  const anyMock =
    mockNoticeForced ||
    (webhookConfig?.modeMock ?? false) ||
    (subscription?.isMock ?? false) ||
    invoices.some((inv) => inv.isMock);

  const handleChangePlan = useCallback(
    async (tier: PlanTier, period: BillingPeriod) => {
      if (mutating) return;
      setMutating(true);
      try {
        const res = await changeSubscriptionPlan({ planTier: tier, billingPeriod: period });
        if (res.error || !res.data) {
          toastError(res.error || t('billing.error.load'));
          return;
        }
        if (res.data.mock) {
          setMockNoticeForced(true);
          info(t('billing.mock.banner.message'));
        } else {
          success(t('billing.action.confirm_change'));
        }
        onPlanChanged?.(tier);
        await fetchAll();
      } catch {
        toastError(t('billing.error.load'));
      } finally {
        setMutating(false);
      }
    },
    [mutating, fetchAll, info, success, toastError, onPlanChanged],
  );

  const handleResume = useCallback(async () => {
    if (mutating) return;
    setMutating(true);
    try {
      const res = await resumeSubscription();
      if (res.error || !res.data) {
        toastError(res.error || t('billing.error.load'));
        return;
      }
      if (res.data.mock) {
        setMockNoticeForced(true);
        info(t('billing.mock.banner.message'));
      } else {
        success(t('billing.action.resume_subscription'));
      }
      await fetchAll();
    } catch {
      toastError(t('billing.error.load'));
    } finally {
      setMutating(false);
    }
  }, [mutating, fetchAll, info, success, toastError]);

  const handleCancel = useCallback(async () => {
    if (mutating) return;
    const ok = await confirm({
      title: t('billing.action.confirm_cancel'),
      description: t('billing.action.cancel_subscription'),
      danger: true,
      confirmLabel: t('billing.action.confirm_cancel'),
    });
    if (!ok) return;
    setMutating(true);
    try {
      const res = await cancelSubscription({ atPeriodEnd: true });
      if (res.error || !res.data) {
        toastError(res.error || t('billing.error.load'));
        return;
      }
      if (res.data.mock) {
        setMockNoticeForced(true);
        info(t('billing.mock.banner.message'));
      } else {
        success(t('billing.action.cancel_subscription'));
      }
      await fetchAll();
    } catch {
      toastError(t('billing.error.load'));
    } finally {
      setMutating(false);
    }
  }, [mutating, confirm, fetchAll, info, success, toastError]);

  const handleSubscribeChild = useCallback(
    async (tier: PlanTier) => {
      if (mutating || !subscription) return;
      setMutating(true);
      try {
        const res = await changeSubscriptionPlan({
          planTier: tier,
          parentSubscriptionId: subscription.id,
        });
        if (res.error || !res.data) {
          toastError(res.error || t('billing.error.load'));
          return;
        }
        success("Abonnement secondaire souscrit avec succès");
        await fetchAll();
      } catch {
        toastError(t('billing.error.load'));
      } finally {
        setMutating(false);
      }
    },
    [mutating, subscription, fetchAll, success, toastError],
  );

  const handleMockNotice = useCallback(() => {
    setMockNoticeForced(true);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && !subscription && plans.length === 0) {
    return (
      <div
        className="space-y-6 mt-6"
        data-component="BillingPlanPanel"
        data-loading="true"
      >
        <Skeleton className="h-16 w-full" />
        <Card className="p-6 space-y-4">
          <Skeleton className="h-6 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64 w-full rounded-[var(--radius-xl)]" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (loadError && !plans.length) {
    return (
      <div className="mt-6" data-component="BillingPlanPanel" data-error="true">
        <Card className="p-6">
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <Icon as={AlertCircle} size={24} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-primary)]">{loadError}</p>
            <Button variant="secondary" onClick={() => void fetchAll()}>
              {t('action.retry')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const locale = getLocale();
  const sub = subscription;
  const renewDate = sub?.currentPeriodEnd
    ? formatDate(new Date(sub.currentPeriodEnd), locale)
    : null;
  const trialEnds = sub?.trialEndsAt ? formatDate(new Date(sub.trialEndsAt), locale) : null;
  const canceledOn = sub?.canceledAt ? formatDate(new Date(sub.canceledAt), locale) : null;

  return (
    <div
      className="space-y-6 mt-6"
      data-component="BillingPlanPanel"
      aria-label={t('billing.plans.title')}
    >
      {anyMock && <BillingMockBanner />}

      {/* État abonnement actuel */}
      {sub && (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                <Icon as={CreditCard} size={12} className="inline-block mr-1 align-[-1px]" />
                {t('set.billing.plan')}
              </p>
              <h3 className="text-[18px] font-bold text-[var(--text-primary)] flex items-center gap-2">
                {t(`billing.plans.tier.${sub.planTier}.name`)}
                <Badge intent={statusIntent(sub.status)} fill="soft" size="sm">
                  {statusLabel(sub.status)}
                </Badge>
              </h3>
              <div className="mt-2 space-y-0.5 text-[13px] text-[var(--text-secondary)]">
                {sub.cancelAtPeriodEnd && (
                  <p>{t('billing.subscription.cancel_at_period_end')}</p>
                )}
                {!sub.cancelAtPeriodEnd && renewDate && sub.status === 'active' && (
                  <p>{t('billing.subscription.renews_on', { date: renewDate })}</p>
                )}
                {canceledOn && sub.status === 'canceled' && (
                  <p>{t('billing.subscription.canceled_on', { date: canceledOn })}</p>
                )}
                {trialEnds && sub.status === 'trialing' && (
                  <p>{t('billing.subscription.trial_ends', { date: trialEnds })}</p>
                )}
              </div>
            </div>

            {/* Quotas synthétiques */}
            {usage && (
              <div className="grid grid-cols-3 gap-3 text-right">
                {(['subAccounts', 'leads', 'users'] as const).map((k) => {
                  const u = usage[k];
                  const limitTxt =
                    u.limit === null
                      ? t('billing.plans.feature.unlimited')
                      : u.limit.toLocaleString(locale);
                  return (
                    <div key={k} className="min-w-[80px]">
                      <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">
                        {t(`billing.plans.feature.${k}`)}
                      </p>
                      <p className="text-[14px] font-semibold text-[var(--text-primary)]">
                        {u.current.toLocaleString(locale)}
                        <span className="text-[11px] text-[var(--text-secondary)] font-normal ml-1">
                          / {limitTxt}
                        </span>
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Abonnements secondaires */}
      {sub && (
        <section aria-labelledby="billing-secondary-heading">
          <header className="mb-3">
            <h2
              id="billing-secondary-heading"
              className="text-[17px] font-bold text-[var(--text-primary)]"
            >
              Abonnements secondaires / enfants
            </h2>
            <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
              Gérez les abonnements secondaires rattachés à votre formule principale.
            </p>
          </header>

          <Card className="p-5 space-y-4">
            {subscriptions.filter(s => s.parentSubscriptionId === sub.id).length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">Aucun abonnement secondaire actif.</p>
            ) : (
              <div className="space-y-3">
                {subscriptions.filter(s => s.parentSubscriptionId === sub.id).map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-[var(--bg-inset)] rounded-lg border border-[var(--border-subtle)]">
                    <div>
                      <h4 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                        {t(`billing.plans.tier.${s.planTier}.name`)}
                        <Badge intent="info" size="sm">Secondaire</Badge>
                        <Badge intent={statusIntent(s.status)} fill="soft" size="sm">
                          {statusLabel(s.status)}
                        </Badge>
                      </h4>
                      <p className="text-xs text-[var(--text-secondary)] mt-1">
                        Période : {s.billingPeriod === 'yearly' ? 'Annuel' : 'Mensuel'}
                        {s.currentPeriodEnd && ` · Expire le ${formatDate(new Date(s.currentPeriodEnd), locale)}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap gap-2">
              <span className="text-xs text-[var(--text-muted)] self-center mr-2">Souscrire à un produit secondaire (simulation) :</span>
              {['starter', 'pro', 'unlimited'].map((tier) => (
                <Button
                  key={tier}
                  variant="secondary"
                  size="sm"
                  disabled={mutating}
                  onClick={() => void handleSubscribeChild(tier as PlanTier)}
                >
                  + {t(`billing.plans.tier.${tier}.name`)}
                </Button>
              ))}
            </div>
          </Card>
        </section>
      )}

      {/* PlanSelector */}
      <section aria-labelledby="billing-plans-heading">
        <header className="mb-3 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2
              id="billing-plans-heading"
              className="text-[17px] font-bold text-[var(--text-primary)]"
            >
              {t('billing.plans.title')}
            </h2>
            <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
              {t('billing.plans.subtitle')}
            </p>
          </div>
        </header>
        <PlanSelector
          plans={plans}
          currentTier={sub?.planTier ?? null}
          currentPeriod={sub?.billingPeriod ?? 'monthly'}
          onSelect={(tier, period) => void handleChangePlan(tier, period)}
          disabled={mutating}
          loading={loading && plans.length === 0}
        />
      </section>

      {/* Actions abonnement */}
      <section aria-labelledby="billing-actions-heading">
        <h2
          id="billing-actions-heading"
          className="sr-only"
        >
          {t('billing.portal.title')}
        </h2>
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <BillingPortalButton
              variant="primary"
              onMockNotice={handleMockNotice}
              disabled={mutating}
            />
            {sub?.status === 'canceled' && (
              <Button
                variant="secondary"
                onClick={() => void handleResume()}
                disabled={mutating}
                leftIcon={<Icon as={PlayCircle} size={14} />}
              >
                {t('billing.action.resume_subscription')}
              </Button>
            )}
            {sub?.status === 'active' && !sub.cancelAtPeriodEnd && (
              <Button
                variant="ghost"
                onClick={() => void handleCancel()}
                disabled={mutating}
                leftIcon={<Icon as={XCircle} size={14} />}
              >
                {t('billing.action.cancel_subscription')}
              </Button>
            )}
          </div>
          <p className="text-[12px] text-[var(--text-muted)] mt-2">
            {t('billing.portal.subtitle')}
          </p>
        </Card>
      </section>

      {/* Invoices */}
      <section aria-labelledby="billing-invoices-heading">
        <header className="mb-3">
          <h2
            id="billing-invoices-heading"
            className="text-[17px] font-bold text-[var(--text-primary)]"
          >
            {t('billing.invoices.title')}
          </h2>
        </header>
        <BillingInvoicesList
          invoices={invoices}
          loading={loading && invoices.length === 0}
        />
      </section>

      {/* Webhook diagnostic */}
      <section aria-labelledby="billing-webhook-heading">
        <h2
          id="billing-webhook-heading"
          className="sr-only"
        >
          {t('billing.webhook.title')}
        </h2>
        <WebhookConfigPanel config={webhookConfig ?? undefined} loading={loading && !webhookConfig} />
      </section>

      {/* ── Sprint 31 — Payment Methods + Stripe Connect (live activated tenant) ── */}
      <section aria-label={t('billing.payment_methods.title')}>
        <PaymentMethodsList
          key={pmRefreshKey}
          onAddClick={() => setAddPmOpen(true)}
        />
        <AddPaymentMethodDialog
          open={addPmOpen}
          onClose={() => setAddPmOpen(false)}
          onAdded={() => {
            setAddPmOpen(false);
            setPmRefreshKey((k) => k + 1);
          }}
        />
      </section>

      <section aria-label={t('billing.connect.title')}>
        <ConnectOnboardingCard />
      </section>
    </div>
  );
}

export default BillingPlanPanel;
