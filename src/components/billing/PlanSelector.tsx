// ── Sprint 22 — Billing Stripe prod (E4 flag mock) — Manager-C ──────────────
// Sélecteur de plan : 4 cartes côte à côte (free/starter/pro/unlimited) +
// toggle monthly/yearly. Click "Sélectionner / Mettre à niveau / Rétrograder"
// → confirm dialog → onSelect(tier, period).
//
// API (extension du skeleton Phase A — additive, retro-compat) :
//   - plans            : BillingPlanCatalog[]
//   - currentTier      : PlanTier | null   (badge "Plan actuel")
//   - currentPeriod    : BillingPeriod | null  (initial toggle state)
//   - onSelect         : (tier, period) => void
//   - disabled?        : boolean   (mode mock → désactive les CTA mutate)
//   - loading?         : boolean   (skeleton)
import { useMemo, useState } from 'react';
import { Card, Button, Badge, Skeleton, useConfirm, Icon } from '@/components/ui';
import { Check } from 'lucide-react';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import type { BillingPeriod, BillingPlanCatalog, PlanTier } from '@/lib/types';

export interface PlanSelectorProps {
  plans: BillingPlanCatalog[];
  currentTier: PlanTier | null;
  currentPeriod: BillingPeriod | null;
  onSelect: (tier: PlanTier, period: BillingPeriod) => void;
  disabled?: boolean;
  loading?: boolean;
}

const TIER_ORDER: Record<PlanTier, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  unlimited: 3,
};

function tierName(tier: PlanTier): string {
  return t(`billing.plans.tier.${tier}.name`);
}

function tierTagline(tier: PlanTier): string {
  return t(`billing.plans.tier.${tier}.tagline`);
}

function formatLimit(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return t('billing.plans.feature.unlimited');
  }
  try {
    return value.toLocaleString(getLocale());
  } catch {
    return String(value);
  }
}

function ctaLabel(
  planTier: PlanTier,
  currentTier: PlanTier | null,
  isCurrent: boolean,
): string {
  if (isCurrent) return t('billing.plans.cta_current');
  if (!currentTier) return t('billing.plans.cta_select');
  const diff = TIER_ORDER[planTier] - TIER_ORDER[currentTier];
  if (diff > 0) return t('billing.plans.cta_upgrade');
  if (diff < 0) return t('billing.plans.cta_downgrade');
  return t('billing.plans.cta_select');
}

export function PlanSelector(props: PlanSelectorProps) {
  const { plans, currentTier, currentPeriod, onSelect, disabled, loading } = props;
  const confirm = useConfirm();

  const [period, setPeriod] = useState<BillingPeriod>(currentPeriod || 'monthly');

  const sortedPlans = useMemo(() => {
    return [...plans].sort((a, b) => {
      const ao = a.displayOrder ?? TIER_ORDER[a.tier] ?? 0;
      const bo = b.displayOrder ?? TIER_ORDER[b.tier] ?? 0;
      return ao - bo;
    });
  }, [plans]);

  const locale = getLocale();

  const handleSelect = async (tier: PlanTier) => {
    if (disabled) return;
    if (currentTier === tier) return;
    const ok = await confirm({
      title: t('billing.action.confirm_change'),
      description: `${tierName(tier)} — ${
        period === 'yearly'
          ? t('billing.plans.period.yearly')
          : t('billing.plans.period.monthly')
      }`,
    });
    if (!ok) return;
    onSelect(tier, period);
  };

  if (loading) {
    return (
      <div className="space-y-4" data-component="PlanSelector">
        <Skeleton className="h-9 w-48 rounded-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-[var(--radius-xl)]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-component="PlanSelector">
      {/* Toggle monthly/yearly */}
      <div
        className="inline-flex items-center gap-1 p-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-full"
        role="tablist"
        aria-label={t('billing.plans.period.toggle')}
      >
        {(['monthly', 'yearly'] as const).map((p) => {
          const active = p === period;
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`plan-selector-toggle-${p}`}
              onClick={() => setPeriod(p)}
              className="px-4 py-1.5 text-[13px] font-medium rounded-full transition-all cursor-pointer"
              style={
                active
                  ? {
                      background: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      boxShadow: 'var(--shadow-xs)',
                    }
                  : {
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                    }
              }
            >
              {p === 'monthly'
                ? t('billing.plans.period.monthly')
                : t('billing.plans.period.yearly')}
            </button>
          );
        })}
      </div>

      {/* 4 cartes plans */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {sortedPlans.map((plan) => {
          const isCurrent = plan.tier === currentTier;
          const priceCents =
            period === 'yearly' ? plan.priceYearlyCents : plan.priceMonthlyCents;
          const isFree = priceCents <= 0;
          const priceText = isFree
            ? t('billing.plans.price.free')
            : formatMoneyCents(priceCents, locale, plan.currency || 'CAD');
          const periodSuffix = isFree
            ? ''
            : period === 'yearly'
              ? t('billing.plans.price.per_year')
              : t('billing.plans.price.per_month');

          return (
            <Card
              key={plan.id}
              className="p-5 flex flex-col gap-4"
              style={
                isCurrent
                  ? {
                      borderColor: 'var(--primary)',
                      boxShadow:
                        '0 0 0 1px var(--primary), 0 4px 16px -4px rgba(0,157,219,0.20)',
                    }
                  : undefined
              }
              data-tier={plan.tier}
              data-current={isCurrent ? 'true' : undefined}
            >
              <header className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[16px] font-bold text-[var(--text-primary)]">
                    {plan.displayName || tierName(plan.tier)}
                  </h3>
                  {isCurrent && (
                    <Badge intent="brand" fill="solid" size="sm">
                      {t('billing.plans.cta_current')}
                    </Badge>
                  )}
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] min-h-[18px]">
                  {plan.description || tierTagline(plan.tier)}
                </p>
              </header>

              {/* Prix */}
              <div className="flex items-baseline gap-1">
                <span className="text-[28px] font-bold text-[var(--text-primary)] leading-none">
                  {priceText}
                </span>
                {periodSuffix && (
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {periodSuffix}
                  </span>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-1.5 flex-1">
                <li className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]">
                  <Icon
                    as={Check}
                    size={14}
                    className="text-[var(--success)] shrink-0 mt-0.5"
                  />
                  <span>
                    <strong className="text-[var(--text-primary)]">
                      {formatLimit(plan.limits.maxSubAccounts)}
                    </strong>{' '}
                    {t('billing.plans.feature.subAccounts')}
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]">
                  <Icon
                    as={Check}
                    size={14}
                    className="text-[var(--success)] shrink-0 mt-0.5"
                  />
                  <span>
                    <strong className="text-[var(--text-primary)]">
                      {formatLimit(plan.limits.maxLeads)}
                    </strong>{' '}
                    {t('billing.plans.feature.leads')}
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]">
                  <Icon
                    as={Check}
                    size={14}
                    className="text-[var(--success)] shrink-0 mt-0.5"
                  />
                  <span>
                    <strong className="text-[var(--text-primary)]">
                      {formatLimit(plan.limits.maxUsers)}
                    </strong>{' '}
                    {t('billing.plans.feature.users')}
                  </span>
                </li>
                {(plan.features || []).slice(0, 3).map((f, idx) => (
                  <li
                    key={`${plan.id}-feat-${idx}`}
                    className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]"
                  >
                    <Icon
                      as={Check}
                      size={14}
                      className="text-[var(--success)] shrink-0 mt-0.5"
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Button
                fullWidth
                variant={isCurrent ? 'secondary' : 'primary'}
                disabled={isCurrent || disabled}
                onClick={() => {
                  void handleSelect(plan.tier);
                }}
                aria-label={ctaLabel(plan.tier, currentTier, isCurrent)}
              >
                {ctaLabel(plan.tier, currentTier, isCurrent)}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default PlanSelector;
