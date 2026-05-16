// ── Settings — Paiements — Sprint E4 M3.2 ───────────────────────────────────
//
// ⚠️ ZONE RÉGULÉE — revue Rochdi requise avant tout go-live.
//
// Page Réglages admin : fournisseurs de paiement (Stripe / COD / passerelle
// Algérie) + flag de sûreté `payments_live_enabled` (défaut OFF — sandbox).
//
// RÉGULÉ : M1 N'EXPOSE PAS d'endpoint GET/PUT de configuration provider, et le
// file-ownership M3 interdit de toucher worker/. Cette page est donc en
// LECTURE SEULE : elle reflète l'état documenté du contrat (sandbox, live OFF)
// via api.ts (bloc E4). Le toggle « paiements réels » est désactivé et porte
// une bannière explicite : l'activation passe par une revue de conformité
// côté serveur. Aucune clé secrète n'est saisie ici (PCI — bindings serveur).
//
// Stripe SUBTLE, FR québécois, a11y focus-visible + aria, reduced-motion.

import { useEffect, useState } from 'react';
import {
  Card, Switch, Tag, AutosaveIndicator, useToast, Icon, Skeleton,
} from '@/components/ui';
import {
  getPaymentConfig,
  type PaymentConfigState,
  type PaymentProviderState,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { CreditCard, ShieldAlert, Lock, Server } from 'lucide-react';

// Provider → métadonnées d'affichage (libellés i18n + icône).
const PROVIDER_META: Record<
  PaymentProviderState['provider'],
  { titleKey: string; descKey: string }
> = {
  stripe: {
    titleKey: 'shop.payment.settings.provider_stripe',
    descKey: 'shop.payment.settings.provider_stripe_desc',
  },
  cod: {
    titleKey: 'shop.payment.settings.provider_cod',
    descKey: 'shop.payment.settings.provider_cod_desc',
  },
  dz_gateway: {
    titleKey: 'shop.payment.settings.provider_dz',
    descKey: 'shop.payment.settings.provider_dz_desc',
  },
};

export function PaymentSettings() {
  const { error: toastError } = useToast();
  const [cfg, setCfg] = useState<PaymentConfigState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getPaymentConfig()
      .then((r) => {
        if (cancelled) return;
        if (r.data) setCfg(r.data);
        else toastError(t('shop.payment.settings.load_error'));
      })
      .catch(() => {
        if (!cancelled) toastError(t('shop.payment.settings.load_error'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="settings-card p-6 space-y-4">
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-3 w-2/3 rounded" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <div className="space-y-3 pt-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const isLive = Boolean(cfg?.payments_live_enabled);
  const readOnly = cfg?.read_only !== false;

  return (
    <div className="space-y-6">
      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={CreditCard} size={16} className="text-[var(--primary)]" />
              {t('shop.payment.settings.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('shop.payment.settings.subtitle')}
            </p>
          </div>
          {/* Lecture seule tant que M1 n'expose pas l'endpoint config. */}
          <AutosaveIndicator state="idle" />
        </header>

        {/* ⚠️ ZONE RÉGULÉE — bannière mode test (claire, non dismissable). */}
        <div
          role="status"
          className="mt-5 rounded-[var(--radius-md)] p-4 flex gap-3"
          style={{
            background: 'rgba(217,110,39,0.06)',
            border: '1px solid rgba(217,110,39,0.28)',
          }}
        >
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-full shrink-0"
            style={{
              background: 'rgba(217,110,39,0.14)',
              color: 'var(--brand-orange, #D96E27)',
            }}
          >
            <Icon as={ShieldAlert} size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">
              {t('shop.payment.settings.banner_title')}
            </p>
            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
              {t('shop.payment.settings.banner_body')}
            </p>
          </div>
        </div>

        {/* Flag de sûreté : paiements réels (verrouillé — géré serveur). */}
        <div className="mt-5 pt-5 border-t border-[var(--border-subtle)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <label
                htmlFor="pay-live-toggle"
                className="block text-[13px] font-semibold text-[var(--text-primary)]"
              >
                {t('shop.payment.settings.live_toggle')}
              </label>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {t('shop.payment.settings.read_only_notice')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Tag
                size="sm"
                variant={isLive ? 'success' : 'warning'}
                dot
              >
                {isLive
                  ? t('shop.payment.settings.mode_live')
                  : t('shop.payment.settings.mode_test')}
              </Tag>
              <Switch
                id="pay-live-toggle"
                checked={isLive}
                disabled={readOnly}
                onCheckedChange={() => {
                  // Verrouillé : activation = revue conformité côté serveur.
                  toastError(t('shop.payment.settings.read_only_notice'));
                }}
                aria-label={t('shop.payment.settings.live_toggle')}
              />
            </div>
          </div>
        </div>

        {/* Fournisseurs (état documenté — lecture seule). */}
        <div className="mt-6 pt-5 border-t border-[var(--border-subtle)]">
          <div className="flex flex-col gap-3">
            {(cfg?.providers || []).map((p) => {
              const meta = PROVIDER_META[p.provider];
              return (
                <div
                  key={p.provider}
                  className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {t(meta.titleKey)}
                      </p>
                      <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                        {t(meta.descKey)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Tag
                        size="sm"
                        variant={p.enabled ? 'success' : 'neutral'}
                        dot
                      >
                        {p.enabled
                          ? t('shop.payment.settings.enabled')
                          : t('shop.payment.settings.disabled')}
                      </Tag>
                      <Tag size="sm" variant="neutral">
                        {t('shop.payment.settings.mode')} ·{' '}
                        {p.mode === 'live'
                          ? t('shop.payment.settings.mode_live')
                          : t('shop.payment.settings.mode_test')}
                      </Tag>
                    </div>
                  </div>

                  {/* Stripe : référence Connect (lecture seule — serveur). */}
                  {p.provider === 'stripe' && (
                    <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                      <Icon as={Server} size={12} aria-hidden />
                      <span>
                        {t('shop.payment.settings.connect_ref')} —{' '}
                        {t('shop.payment.settings.server_managed')}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Clés secrètes = bindings serveur, jamais saisies ici (PCI). */}
          <div className="mt-4 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <Icon as={Lock} size={12} aria-hidden />
            <span>{t('shop.payment.settings.server_managed_hint')}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
