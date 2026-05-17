// ── Boutique — Expéditions d'une commande — Sprint E5 M3.1 ──────────────────
// Composant ADDITIF inséré dans OrderDetailPanel (section « Expéditions »).
// Liste les expéditions de la commande (statut Tag color-codé, tracking lien
// cliquable, items) + crée une expédition (sélection des lignes non encore
// expédiées + quantités, transporteur, n° + URL suivi, note) + change le
// statut d'une expédition (machine PROPRE au shipment, DISTINCTE de la machine
// commande E3 : preparing→shipped→in_transit→delivered/failed).
//
// Une expédition est une TRACE PURE : aucun effet stock / statut commande
// client-side — le worker recalcule fulfillment_status. Aucune donnée fictive.
// Stripe SUBTLE, FR québécois, a11y focus-visible + aria, reduced-motion.

import { useEffect, useMemo, useState } from 'react';
import {
  Modal, Button, Tag, Input, Textarea, Skeleton, EmptyState, Icon, useToast,
} from '@/components/ui';
import {
  getOrderShipments, createShipment, updateShipmentStatus,
  shipmentStatusKey, type CreateShipmentPayload,
} from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';
import type { Order, Shipment, ShipmentStatus } from '@/lib/types';
import {
  Truck, Plus, ExternalLink, PackageCheck, PackageX, MapPin, Clock,
} from 'lucide-react';

// ── Helpers statut expédition (inline — pas de fichier partagé) ─────────────
function shipmentStatusVariant(
  s?: ShipmentStatus | string,
): 'success' | 'warning' | 'neutral' | 'danger' | 'info' {
  switch (s) {
    case 'delivered': return 'success';
    case 'shipped': case 'in_transit': return 'info';
    case 'preparing': return 'warning';
    case 'failed': return 'danger';
    default: return 'neutral';
  }
}

// Machine à états PROPRE au shipment (distincte commande E3).
function allowedShipmentTransitions(s: ShipmentStatus): Array<{
  to: ShipmentStatus; labelKey: string; icon: typeof Truck; danger?: boolean;
}> {
  switch (s) {
    case 'preparing':
      return [{ to: 'shipped', labelKey: 'shop.shipment.act_ship', icon: Truck }];
    case 'shipped':
      return [
        { to: 'in_transit', labelKey: 'shop.shipment.act_in_transit', icon: MapPin },
        { to: 'failed', labelKey: 'shop.shipment.act_fail', icon: PackageX, danger: true },
      ];
    case 'in_transit':
      return [
        { to: 'delivered', labelKey: 'shop.shipment.act_deliver', icon: PackageCheck },
        { to: 'failed', labelKey: 'shop.shipment.act_fail', icon: PackageX, danger: true },
      ];
    default:
      return []; // delivered / failed = terminal
  }
}

interface ShipmentPanelProps {
  order: Order;
  /** Refresh la commande parente (fulfillment_status recalculé serveur). */
  onChanged?: () => void;
}

export function ShipmentPanel({ order, onChanged }: ShipmentPanelProps) {
  const { success, error: toastError } = useToast();
  const locale = getLocale();

  const [shipments, setShipments] = useState<Shipment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  // Modal de création
  const [createOpen, setCreateOpen] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [note, setNote] = useState('');
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const loadShipments = async () => {
    setLoading(true);
    try {
      const res = await getOrderShipments(order.id);
      setShipments(res.data || []);
    } catch {
      setShipments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadShipments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  // Quantité déjà expédiée par order_item_id (toutes expéditions confondues).
  const shippedByItem = useMemo(() => {
    const m: Record<string, number> = {};
    for (const sh of shipments || []) {
      for (const it of sh.items || []) {
        m[it.order_item_id] = (m[it.order_item_id] || 0) + it.quantity;
      }
    }
    return m;
  }, [shipments]);

  // Lignes encore expédiables (quantité commandée − déjà expédiée > 0).
  const shippableItems = useMemo(() => {
    return (order.items || [])
      .map((it) => {
        const remaining = it.quantity - (shippedByItem[it.id] || 0);
        return { item: it, remaining };
      })
      .filter((x) => x.remaining > 0);
  }, [order.items, shippedByItem]);

  const openCreate = () => {
    // Pré-remplit chaque ligne expédiable à sa quantité restante.
    const init: Record<string, number> = {};
    for (const { item, remaining } of shippableItems) init[item.id] = remaining;
    setQtyByItem(init);
    setCarrier('');
    setTrackingNumber('');
    setTrackingUrl('');
    setNote('');
    setCreateOpen(true);
  };

  const selectedLines = useMemo(
    () =>
      shippableItems
        .map(({ item, remaining }) => ({
          order_item_id: item.id,
          quantity: Math.max(0, Math.min(remaining, qtyByItem[item.id] ?? 0)),
        }))
        .filter((l) => l.quantity > 0),
    [shippableItems, qtyByItem],
  );

  const handleCreate = async () => {
    if (selectedLines.length === 0) {
      toastError(t('shop.shipment.no_items'));
      return;
    }
    setSubmitting(true);
    try {
      const payload: CreateShipmentPayload = {
        items: selectedLines,
        carrier: carrier.trim() || undefined,
        tracking_number: trackingNumber.trim() || undefined,
        tracking_url: trackingUrl.trim() || undefined,
        note: note.trim() || undefined,
      };
      const res = await createShipment(order.id, payload);
      if (res.error || !res.data) {
        toastError(res.error || t('shop.shipment.create_error'));
        return;
      }
      success(t('shop.shipment.created'));
      setCreateOpen(false);
      await loadShipments();
      onChanged?.();
    } catch {
      toastError(t('shop.shipment.create_error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatus = async (sid: string, to: ShipmentStatus) => {
    setActing(sid);
    try {
      const res = await updateShipmentStatus(sid, to);
      if (res.error) {
        toastError(t('shop.shipment.status_error'));
        return;
      }
      success(t('shop.shipment.status_updated'));
      await loadShipments();
      onChanged?.();
    } catch {
      toastError(t('shop.shipment.status_error'));
    } finally {
      setActing(null);
    }
  };

  // Titre snapshot d'une ligne de commande (pour affichage items expédiés).
  const itemTitle = (orderItemId: string): string => {
    const it = (order.items || []).find((x) => x.id === orderItemId);
    if (!it) return orderItemId.slice(0, 8);
    return [it.product_title_snapshot, it.variant_title_snapshot]
      .filter(Boolean)
      .join(' — ');
  };

  return (
    <div className="flex flex-col gap-4">
      {/* En-tête section + action créer */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-[var(--text-secondary)]">
          {t('shop.shipment.subtitle')}
        </p>
        {shippableItems.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={openCreate}
          >
            <Icon as={Plus} size="sm" /> {t('shop.shipment.create')}
          </Button>
        )}
      </div>

      {/* Liste des expéditions */}
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full rounded" />
          <Skeleton className="h-20 w-full rounded" />
        </div>
      ) : (shipments || []).length === 0 ? (
        <EmptyState
          variant="compact"
          icon={<Truck size={32} strokeWidth={1.8} />}
          title={t('shop.shipment.empty')}
          description={
            shippableItems.length === 0
              ? t('shop.shipment.all_shipped')
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {(shipments || []).map((sh) => {
            const transitions = allowedShipmentTransitions(sh.status);
            return (
              <div
                key={sh.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Tag dot size="sm" variant={shipmentStatusVariant(sh.status)}>
                    {t(shipmentStatusKey(sh.status))}
                  </Tag>
                  {sh.carrier && (
                    <Tag size="sm" variant="neutral">
                      {sh.carrier}
                    </Tag>
                  )}
                  <span className="ml-auto t-mono-num text-[11px] text-[var(--text-muted)]">
                    {formatDate(sh.created_at, locale, {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* Tracking cliquable */}
                {sh.tracking_number && (
                  <div className="mb-3 text-[12px] flex items-center gap-2 flex-wrap">
                    <span className="text-[var(--text-muted)]">
                      {t('shop.shipment.tracking')}
                    </span>
                    {sh.tracking_url ? (
                      <a
                        href={sh.tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--primary)] font-medium inline-flex items-center gap-1 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] rounded-sm"
                      >
                        {sh.tracking_number}
                        <Icon as={ExternalLink} size="xs" aria-hidden />
                      </a>
                    ) : (
                      <span className="font-medium t-mono-num">
                        {sh.tracking_number}
                      </span>
                    )}
                  </div>
                )}

                {/* Items expédiés */}
                {(sh.items || []).length > 0 && (
                  <ul className="flex flex-col gap-1.5 mb-3 border-t border-[var(--border-subtle)] pt-3">
                    {(sh.items || []).map((it) => (
                      <li
                        key={it.id}
                        className="flex items-center gap-2 text-[12px]"
                      >
                        <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">
                          {itemTitle(it.order_item_id)}
                        </span>
                        <span className="t-mono-num text-[var(--text-muted)] shrink-0">
                          × {it.quantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {sh.note && (
                  <p className="text-[12px] text-[var(--text-secondary)] whitespace-pre-line mb-3">
                    {sh.note}
                  </p>
                )}

                {/* Timeline expédition */}
                {(sh.shipped_at || sh.delivered_at) && (
                  <ul className="flex flex-col gap-1.5 mb-3 text-[11px] text-[var(--text-muted)]">
                    {sh.shipped_at && (
                      <li className="flex items-center gap-2">
                        <Icon as={Clock} size="xs" aria-hidden />
                        {t('shop.shipment.shipped_at')} ·{' '}
                        {formatDate(sh.shipped_at, locale)}
                      </li>
                    )}
                    {sh.delivered_at && (
                      <li className="flex items-center gap-2">
                        <Icon as={PackageCheck} size="xs" aria-hidden />
                        {t('shop.shipment.delivered_at')} ·{' '}
                        {formatDate(sh.delivered_at, locale)}
                      </li>
                    )}
                  </ul>
                )}

                {/* Transitions de statut */}
                {transitions.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
                    {transitions.map((tr) => (
                      <Button
                        key={tr.to}
                        variant={tr.danger ? 'ghost' : 'secondary'}
                        size="sm"
                        className="gap-1.5"
                        disabled={acting === sh.id}
                        onClick={() => handleStatus(sh.id, tr.to)}
                        style={tr.danger ? { color: 'var(--danger)' } : undefined}
                      >
                        <Icon as={tr.icon} size="sm" /> {t(tr.labelKey)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal création d'expédition */}
      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('shop.shipment.create_title')}
        description={t('shop.shipment.create_desc')}
        size="md"
      >
        <div className="flex flex-col gap-5">
          {/* Sélection lignes + quantités */}
          <div>
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">
              {t('shop.shipment.lines')}
            </h4>
            {shippableItems.length === 0 ? (
              <p className="text-[12px] text-[var(--text-muted)]">
                {t('shop.shipment.all_shipped')}
              </p>
            ) : (
              <div className="flex flex-col gap-2 border border-[var(--border-subtle)] rounded-[var(--radius-md)] divide-y divide-[var(--border-subtle)]">
                {shippableItems.map(({ item, remaining }) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium truncate">
                        {item.product_title_snapshot}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {t('shop.shipment.remaining')} : {remaining}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={remaining}
                      value={String(qtyByItem[item.id] ?? 0)}
                      onChange={(e: any) => {
                        const raw = parseInt(e.target.value, 10);
                        const v = Number.isNaN(raw)
                          ? 0
                          : Math.max(0, Math.min(remaining, raw));
                        setQtyByItem((p) => ({ ...p, [item.id]: v }));
                      }}
                      className="w-20 text-right"
                      aria-label={`${t('shop.shipment.qty')} — ${item.product_title_snapshot}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Transporteur + tracking */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="ship-carrier"
                className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5"
              >
                {t('shop.shipment.carrier')}
              </label>
              <Input
                id="ship-carrier"
                value={carrier}
                onChange={(e: any) => setCarrier(e.target.value)}
                placeholder={t('shop.shipment.carrier_ph')}
              />
            </div>
            <div>
              <label
                htmlFor="ship-tracking-num"
                className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5"
              >
                {t('shop.shipment.tracking_number')}
              </label>
              <Input
                id="ship-tracking-num"
                value={trackingNumber}
                onChange={(e: any) => setTrackingNumber(e.target.value)}
                placeholder={t('shop.shipment.tracking_number_ph')}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="ship-tracking-url"
              className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5"
            >
              {t('shop.shipment.tracking_url')}
            </label>
            <Input
              id="ship-tracking-url"
              type="url"
              value={trackingUrl}
              onChange={(e: any) => setTrackingUrl(e.target.value)}
              placeholder="https://"
            />
          </div>

          <div>
            <label
              htmlFor="ship-note"
              className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5"
            >
              {t('shop.shipment.note')}
            </label>
            <Textarea
              id="ship-note"
              value={note}
              onChange={(e: any) => setNote(e.target.value)}
              rows={2}
              placeholder={t('shop.shipment.note_ph')}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreateOpen(false)}
              disabled={submitting}
            >
              {t('shop.shipment.cancel')}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleCreate}
              disabled={submitting || selectedLines.length === 0}
            >
              <Icon as={Truck} size="sm" />
              {submitting
                ? t('shop.shipment.creating')
                : t('shop.shipment.submit')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
