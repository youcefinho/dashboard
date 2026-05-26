// ── Sprint 22 — Billing Stripe prod (E4 flag mock) — Manager-C ──────────────
// Panneau diagnostic admin (read-only).
// Affichage :
//   - URL d'endpoint (code-block, copiable visuellement)
//   - Badge "Clé API configurée" / "manquante" (stripeKeyConfigured)
//   - Badge "Secret de signature configuré" / "manquant" (signingSecretConfigured)
//   - Banner "Mode démo activé" si modeMock=true
//   - Liste des supportedEvents[]
// Fetch interne via getBillingWebhookConfig() au mount si `config` non fourni.
// Dégrade gracieusement : si erreur fetch → message d'erreur sober.
import { useEffect, useState } from 'react';
import { Card, Badge, Skeleton, Icon } from '@/components/ui';
import { Webhook, CheckCircle2, AlertCircle, KeyRound, ShieldCheck, ShieldAlert } from 'lucide-react';
import { t } from '@/lib/i18n';
import { getBillingWebhookConfig } from '@/lib/api';
import type { BillingWebhookConfig } from '@/lib/types';

export interface WebhookConfigPanelProps {
  config?: BillingWebhookConfig;
  loading?: boolean;
}

export function WebhookConfigPanel(props: WebhookConfigPanelProps) {
  const [internalConfig, setInternalConfig] = useState<BillingWebhookConfig | undefined>(props.config);
  const [internalLoading, setInternalLoading] = useState<boolean>(
    props.loading ?? props.config === undefined,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Si config fourni en prop → ne pas refetch
    if (props.config !== undefined) {
      setInternalConfig(props.config);
      setInternalLoading(props.loading ?? false);
      return;
    }
    let active = true;
    setInternalLoading(true);
    setError(null);
    getBillingWebhookConfig()
      .then((res) => {
        if (!active) return;
        if (res.error || !res.data) {
          setError(res.error || t('billing.portal.error'));
          return;
        }
        setInternalConfig(res.data);
      })
      .catch(() => {
        if (!active) return;
        setError(t('billing.portal.error'));
      })
      .finally(() => {
        if (active) setInternalLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.config, props.loading]);

  if (internalLoading) {
    return (
      <Card className="p-5 space-y-3" data-component="WebhookConfigPanel">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-3 w-80" />
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-40 rounded-full" />
          <Skeleton className="h-6 w-44 rounded-full" />
        </div>
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  if (error || !internalConfig) {
    return (
      <Card className="p-5" data-component="WebhookConfigPanel">
        <div className="flex items-start gap-3">
          <Icon as={AlertCircle} size={20} className="text-[var(--text-muted)] mt-0.5" />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              {t('billing.webhook.title')}
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              {error || t('billing.portal.error')}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const cfg = internalConfig;

  return (
    <Card className="p-5 space-y-4" data-component="WebhookConfigPanel">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Icon as={Webhook} size={18} />
            {t('billing.webhook.title')}
          </h3>
        </div>
        {cfg.modeMock && (
          <Badge intent="warning" fill="soft" size="sm" dot pulse>
            {t('billing.webhook.mode_mock')}
          </Badge>
        )}
      </header>

      {/* Endpoint URL */}
      <div>
        <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
          {t('billing.webhook.endpoint_url')}
        </p>
        <code
          className="block w-full px-3 py-2 text-[12px] font-mono bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] break-all"
          aria-label={t('billing.webhook.endpoint_url')}
        >
          {cfg.endpointUrl}
        </code>
      </div>

      {/* Badges configuration */}
      <div className="flex flex-wrap gap-2">
        {cfg.stripeKeyConfigured ? (
          <Badge intent="success" fill="soft" size="md">
            <Icon as={KeyRound} size={12} className="mr-1.5 inline-block align-[-1px]" />
            {t('billing.webhook.key_present')}
          </Badge>
        ) : (
          <Badge intent="danger" fill="soft" size="md">
            <Icon as={KeyRound} size={12} className="mr-1.5 inline-block align-[-1px]" />
            {t('billing.webhook.key_missing')}
          </Badge>
        )}

        {cfg.signingSecretConfigured ? (
          <Badge intent="success" fill="soft" size="md">
            <Icon as={ShieldCheck} size={12} className="mr-1.5 inline-block align-[-1px]" />
            {t('billing.webhook.signing_secret_present')}
          </Badge>
        ) : (
          <Badge intent="danger" fill="soft" size="md">
            <Icon as={ShieldAlert} size={12} className="mr-1.5 inline-block align-[-1px]" />
            {t('billing.webhook.signing_secret_missing')}
          </Badge>
        )}
      </div>

      {/* Events listened */}
      <div>
        <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
          {t('billing.webhook.events_listened')}
          {cfg.supportedEvents.length > 0 && (
            <span className="ml-1.5 text-[var(--text-secondary)] normal-case tracking-normal">
              ({cfg.supportedEvents.length})
            </span>
          )}
        </p>
        {cfg.supportedEvents.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] italic">—</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {cfg.supportedEvents.map((evt) => (
              <li
                key={evt}
                className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-mono bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-md text-[var(--text-secondary)]"
              >
                <Icon as={CheckCircle2} size={12} className="text-[var(--success)] shrink-0" />
                <span className="truncate">{evt}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default WebhookConfigPanel;
