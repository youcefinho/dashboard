// ── BillingSettings — SaaS Lot 3 §6.15 : plan + quotas RÉELS (GET /api/agency/plan)
// Plans en dur côté Worker (zéro Stripe/paiement/facture — E4/E6 intouché).
// Affichage honnête : usage réel borné agence, "illimité" si limite null, ou erreur.
import { useEffect, useState } from 'react';
import { Card, Tag, KpiStrip, Button, Skeleton, Icon } from '@/components/ui';
import { CreditCard, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { t } from '@/lib/i18n';

// Shape §6.15 : Infinity sérialisé `null` côté Worker ⇒ limite null = illimité côté UI.
interface PlanData {
  plan: string;
  limits: { maxSubAccounts: number | null; maxLeads: number | null; maxUsers: number | null };
  usage: { subAccounts: number; leads: number; users: number };
}

type QuotaRow = {
  key: 'subAccounts' | 'leads' | 'users';
  label: string;
  current: number;
  limit: number | null;
  variant: 'primary' | 'warning' | 'info';
};

function planLabel(plan: string): string {
  const p = (plan || 'free').toLowerCase();
  if (p === 'pro') return t('billing.plan.pro');
  if (p === 'unlimited') return t('billing.plan.unlimited');
  return t('billing.plan.free');
}

export function BillingSettings() {
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    apiFetch<PlanData>('/agency/plan')
      .then((res) => {
        // 403 AGENCY_ONLY et toute autre erreur ⇒ res.error (apiFetch:103-105).
        if (res.error || !res.data) {
          setError(res.error || t('billing.error.load'));
          return;
        }
        setData(res.data);
      })
      .catch(() => setError(t('billing.error.load')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[64px] w-full" />
        <Card className="settings-card p-6">
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-4 w-64 mb-6" />
          <div className="settings-usage-grid">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="settings-card p-6">
        <div className="flex flex-col items-center text-center gap-3 py-6">
          <Icon as={AlertCircle} size={24} className="text-[var(--text-muted)]" />
          <p className="t-body text-[var(--text-primary)]">{error || t('billing.error.load')}</p>
          <Button variant="secondary" onClick={load}>
            {t('action.retry')}
          </Button>
        </div>
      </Card>
    );
  }

  const rows: QuotaRow[] = [
    {
      key: 'subAccounts',
      label: t('billing.quota.subAccounts'),
      current: data.usage.subAccounts,
      limit: data.limits.maxSubAccounts,
      variant: 'primary',
    },
    {
      key: 'leads',
      label: t('billing.quota.leads'),
      current: data.usage.leads,
      limit: data.limits.maxLeads,
      variant: 'warning',
    },
    {
      key: 'users',
      label: t('billing.quota.users'),
      current: data.usage.users,
      limit: data.limits.maxUsers,
      variant: 'info',
    },
  ];

  return (
    <div className="space-y-6">
      <KpiStrip
        items={[
          {
            label: t('set.billing.plan'),
            value: planLabel(data.plan),
            color: 'brand',
            icon: <CreditCard size={12} />,
          },
        ]}
      />

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3">{t('billing.plan.title')}</h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('billing.plan.current', { plan: planLabel(data.plan) })}
            </p>
          </div>
          <Tag variant="brand" size="sm">
            {planLabel(data.plan)}
          </Tag>
        </header>

        <div className="settings-usage-grid">
          {rows.map((r) => {
            const unlimited = r.limit === null;
            const pct = unlimited || !r.limit ? 0 : Math.min(100, Math.round((r.current / r.limit) * 100));
            return (
              <div className="settings-usage-meter" key={r.key}>
                <p className="settings-usage-meter__label">{r.label}</p>
                <p className="settings-usage-meter__value">
                  {unlimited ? (
                    <>
                      {r.current.toLocaleString('fr-CA')}{' '}
                      <span className="settings-usage-meter__quota">
                        / {t('billing.plan.unlimited_value')}
                      </span>
                    </>
                  ) : (
                    <>
                      {r.current.toLocaleString('fr-CA')}{' '}
                      <span className="settings-usage-meter__quota">
                        {t('billing.quota.of', {
                          current: r.current.toLocaleString('fr-CA'),
                          limit: (r.limit ?? 0).toLocaleString('fr-CA'),
                        })}
                      </span>
                    </>
                  )}
                </p>
                {!unlimited && (
                  <div className="settings-usage-meter__bar">
                    <div
                      className={`settings-usage-meter__bar-fill settings-usage-meter__bar-fill--${r.variant}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
