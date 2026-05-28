// ── Boutique — Détail d'une expédition (SlidePanel) ─────────────────────────
// Vue détail FOCALISÉE d'une expédition unique, chargée par son id via
// getShipment(shipmentId). Surface depuis la page Commandes (lecture seule) :
// statut · transporteur · suivi (numéro + lien cliquable) · dates
// expédiée/livrée · lignes expédiées (qté). 100 % ADDITIF — ne touche ni
// OrderDetailPanel ni ShipmentPanel (qui listent via getOrderShipments et ne
// font jamais d'appel getShipment unitaire).
//
// États : chargement (aria-busy/role=status) · erreur (role=alert + retry) ·
// vide. i18n : nouvelles clés t('ordersx.*') + réutilisation 'shop.shipment.*'.

import { useEffect, useState } from 'react';
import { SlidePanel, Button, Tag, Skeleton, Icon } from '@/components/ui';
import { getShipment, shipmentStatusKey } from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';
import type { Shipment, ShipmentStatus } from '@/lib/types';
import { Truck, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-react';

interface ShipmentDetailPanelProps {
  /** Id de l'expédition à afficher. null = panneau fermé. */
  shipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Variante de Tag selon le statut figé d'expédition. */
function shipmentVariant(s?: ShipmentStatus | string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (s) {
    case 'delivered': return 'success';
    case 'shipped':
    case 'in_transit': return 'warning';
    case 'failed': return 'danger';
    default: return 'neutral';
  }
}

export function ShipmentDetailPanel({ shipmentId, open, onOpenChange }: ShipmentDetailPanelProps) {
  const locale = getLocale();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = async () => {
    if (!shipmentId) return;
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await getShipment(shipmentId);
      setShipment((res.data as Shipment) ?? null);
    } catch {
      setLoadError(true);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (open && shipmentId) {
      void load();
    } else if (!open) {
      // Reset au repos pour éviter d'afficher une expédition obsolète à la
      // réouverture (état visuel pur).
      setShipment(null);
      setLoadError(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shipmentId]);

  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={t('ordersx.shipment_detail_title')}
      description={shipment ? `#${shipment.id.slice(0, 8)}` : undefined}
      size="md"
      closeLabel={t('ordersx.close')}
    >
      {isLoading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite" role="status">
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-4 w-1/2 rounded" />
          <Skeleton className="h-4 w-2/3 rounded" />
          <Skeleton className="h-4 w-1/3 rounded" />
          <Skeleton className="h-24 w-full rounded" />
        </div>
      ) : loadError ? (
        <div
          className="flex flex-col items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4"
          role="alert"
          aria-live="assertive"
        >
          <span className="flex items-center gap-2 text-[var(--text-primary)] font-medium">
            <Icon as={AlertTriangle} size="md" /> {t('ordersx.shipment_error_title')}
          </span>
          <p className="text-[13px] text-[var(--text-secondary)]">
            {t('ordersx.shipment_error_desc')}
          </p>
          <Button size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}
            aria-label={t('ordersx.retry')}>
            {t('ordersx.retry')}
          </Button>
        </div>
      ) : !shipment ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
          <Icon as={Truck} size="lg" />
          <p className="text-[13px] text-[var(--text-secondary)]">
            {t('ordersx.shipment_empty')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Statut */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] uppercase tracking-wide text-[var(--text-muted)]">
              {t('shop.order.status')}
            </span>
            <Tag dot size="sm" variant={shipmentVariant(shipment.status)}>
              {t(shipmentStatusKey(shipment.status))}
            </Tag>
          </div>

          {/* Transporteur + suivi */}
          <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-[var(--text-muted)]">{t('shop.shipment.carrier')}</span>
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                {shipment.carrier || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-[var(--text-muted)]">{t('shop.shipment.tracking_number')}</span>
              <span className="text-[13px] font-medium t-mono-num text-[var(--text-primary)] truncate max-w-[220px]">
                {shipment.tracking_number || '—'}
              </span>
            </div>
            {shipment.tracking_url && (
              <a
                href={shipment.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label={t('shop.shipment.tracking_url')}
              >
                <ExternalLink size={14} /> {t('ordersx.track_package')}
              </a>
            )}
          </div>

          {/* Dates */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-[var(--text-muted)]">{t('shop.shipment.shipped_at')}</span>
              <span className="text-[13px] text-[var(--text-secondary)] whitespace-nowrap">
                {shipment.shipped_at ? formatDate(shipment.shipped_at, locale) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-[var(--text-muted)]">{t('shop.shipment.delivered_at')}</span>
              <span className="text-[13px] text-[var(--text-secondary)] whitespace-nowrap">
                {shipment.delivered_at ? formatDate(shipment.delivered_at, locale) : '—'}
              </span>
            </div>
          </div>

          {/* Note interne */}
          {shipment.note && (
            <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3" role="note">
              <span className="block text-[12px] text-[var(--text-muted)] mb-1">{t('shop.shipment.note')}</span>
              <p className="text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap">{shipment.note}</p>
            </div>
          )}

          {/* Lignes expédiées */}
          <div className="pt-3 border-t border-[var(--border-subtle)]">
            <span className="block text-[12px] uppercase tracking-wide text-[var(--text-muted)] mb-2">
              {t('shop.shipment.lines')}
            </span>
            {shipment.items && shipment.items.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {shipment.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate text-[var(--text-secondary)]">{it.order_item_id}</span>
                    <span className="t-mono-num text-[var(--text-primary)] whitespace-nowrap">
                      {t('shop.shipment.qty')}: {it.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-[var(--text-muted)]">{t('ordersx.no_lines')}</p>
            )}
          </div>
        </div>
      )}
    </SlidePanel>
  );
}
