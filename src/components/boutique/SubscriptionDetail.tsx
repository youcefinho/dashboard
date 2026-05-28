// ── Boutique — Détail d'un abonnement produit (SlidePanel) ──────────────────
// Surface le helper FIGÉ getEcommerceSubscription (jusqu'ici jamais wiré) :
// récupère l'abonnement à jour côté serveur (statut / next_run / cycles /
// dernière exécution) et l'affiche en lecture seule dans un panneau latéral.
//
// 100% additif : aucun champ paiement exposé (modèle COD/mock, cf Abonnements).
// i18n NOUVELLES clés sous namespace subsx.* ; réutilise ecommerce.subscriptions.*
// + common.* déjà présents. Helpers d'affichage (interval/status) reçus en props
// pour rester cohérents avec la page parente — zéro duplication de logique.

import { useEffect, useState } from 'react';
import { SlidePanel, Tag, Skeleton, EmptyState, Button } from '@/components/ui';
import {
  getEcommerceSubscription,
  type ProductSubscription,
} from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import { formatDateTime } from '@/lib/i18n/datetime';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface SubscriptionDetailProps {
  /** Id de l'abonnement à charger ; null = panneau fermé. */
  subscriptionId: string | null;
  onClose: () => void;
  /** Demande au parent d'ouvrir l'édition (réutilise la Modal existante). */
  onEdit?: (sub: ProductSubscription) => void;
  /** Libellé i18n du statut (fourni par la page parente, source unique). */
  statusLabel: (status: string) => string;
  statusVariant: (status: string) => 'success' | 'warning' | 'neutral';
  /** Libellé i18n de l'unité d'intervalle. */
  intervalLabel: (unit: string) => string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <span className="text-[12px] text-[var(--text-muted)] shrink-0">{label}</span>
      <span className="text-[13px] text-[var(--text-primary)] text-right break-words">
        {children}
      </span>
    </div>
  );
}

export function SubscriptionDetail({
  subscriptionId,
  onClose,
  onEdit,
  statusLabel,
  statusVariant,
  intervalLabel,
}: SubscriptionDetailProps) {
  const locale = getLocale();
  const [sub, setSub] = useState<ProductSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!subscriptionId) {
      setSub(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setIsLoading(true);
      setLoadError(false);
      try {
        const res = await getEcommerceSubscription(subscriptionId);
        if (cancelled) return;
        if (!res || !res.data || res.error) {
          setLoadError(true);
        } else {
          setSub(res.data);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
      if (!cancelled) setIsLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [subscriptionId]);

  const reload = () => {
    // Force re-run en repassant par l'effet : on s'appuie sur subscriptionId.
    // Garde anti double-clic : ignore si une requête est déjà en vol.
    if (!subscriptionId || isLoading) return;
    setLoadError(false);
    setIsLoading(true);
    void getEcommerceSubscription(subscriptionId)
      .then((res) => {
        if (!res || !res.data || res.error) setLoadError(true);
        else setSub(res.data);
      })
      .catch(() => setLoadError(true))
      .finally(() => setIsLoading(false));
  };

  return (
    <SlidePanel
      open={subscriptionId != null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={t('subsx.detail_title')}
      description={t('ecommerce.subscriptions.subtitle')}
      closeLabel={t('common.close')}
      size="md"
      headerActions={
        sub && onEdit ? (
          <Button variant="ghost" size="sm" onClick={() => onEdit(sub)}>
            {t('subsx.edit')}
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('common.loading')}</span>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-5 w-full rounded" />
          ))}
        </div>
      ) : loadError ? (
        <div role="alert">
          <EmptyState
            variant="compact"
            icon={<AlertTriangle size={32} strokeWidth={1.8} />}
            title={t('subsx.detail_error')}
            description={t('subsx.detail_error')}
            action={
              <Button onClick={reload} leftIcon={<RefreshCw size={14} />}>
                {t('subsx.retry')}
              </Button>
            }
          />
        </div>
      ) : sub ? (
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-3 pb-3 mb-1">
            <Tag dot size="sm" variant={statusVariant(sub.status)}>
              {statusLabel(sub.status)}
            </Tag>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">{sub.id}</span>
          </div>
          <Row label={t('ecommerce.subscriptions.customer')}>{sub.customer_id || '—'}</Row>
          <Row label={t('ecommerce.subscriptions.variant')}>{sub.variant_id || '—'}</Row>
          <Row label={t('ecommerce.subscriptions.quantity')}>
            <span className="t-mono-num">
              {Number.isFinite(sub.quantity) ? Math.max(0, sub.quantity) : 0}
            </span>
          </Row>
          <Row label={t('ecommerce.subscriptions.interval')}>
            {Number.isFinite(sub.interval_count) && sub.interval_count > 1
              ? `${sub.interval_count} `
              : ''}
            {intervalLabel(sub.interval_unit || '')}
          </Row>
          <Row label={t('subsx.unit_price')}>
            {Number.isFinite(sub.unit_price_cents) && sub.unit_price_cents > 0
              ? formatMoneyCents(
                  Math.max(0, sub.unit_price_cents),
                  locale,
                  sub.currency || 'CAD',
                )
              : '—'}
          </Row>
          <Row label={t('ecommerce.subscriptions.cycles')}>
            <span className="t-mono-num">
              {Number.isFinite(sub.cycles_completed) ? Math.max(0, sub.cycles_completed) : 0}
            </span>
          </Row>
          <Row label={t('ecommerce.subscriptions.next_run')}>
            {sub.next_run_at ? formatDateTime(sub.next_run_at, locale) : '—'}
          </Row>
          <Row label={t('subsx.last_run')}>
            {sub.last_run_at ? formatDateTime(sub.last_run_at, locale) : '—'}
          </Row>
          {sub.created_at && (
            <Row label={t('subsx.created_at')}>{formatDateTime(sub.created_at, locale)}</Row>
          )}
        </div>
      ) : null}
    </SlidePanel>
  );
}
