// ── Boutique — SlidePanel détail produit — Sprint E2 M3.4 ────────────────────
// Lecture : infos + variantes + stock + galerie images. Bouton "Modifier"
// délègue au ProductWizard (géré par le parent via onEdit).

import { useEffect, useState } from 'react';
import { SlidePanel, Tag, Button, Icon, Skeleton } from '@/components/ui';
import { getEcommerceProduct } from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import type { Product } from '@/lib/types';
import { Pencil, Package, Image as ImageIcon, Calculator } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { TierPricesEditor } from '../b2b/TierPricesEditor';

interface ProductDetailPanelProps {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (id: string) => void;
}

function statusVariant(s?: string) {
  return s === 'active' ? 'success' : s === 'archived' ? 'neutral' : 'warning';
}
function statusLabel(s?: string) {
  return s === 'active' ? t('shop.status_active')
    : s === 'archived' ? t('shop.status_archived')
    : t('shop.status_draft');
}

export function ProductDetailPanel({ productId, open, onOpenChange, onEdit }: ProductDetailPanelProps) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !productId) return;
    setLoading(true);
    setProduct(null);
    getEcommerceProduct(productId)
      .then((r) => setProduct(r.data || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, productId]);

  const price = (p: Product) =>
    p.base_price != null
      ? formatMoneyCents(p.base_price, getLocale(), p.currency || 'CAD')
      : '—';

  return (
    <>
      <SlidePanel
        open={open}
        onOpenChange={onOpenChange}
      title={product?.title || t('shop.product_detail')}
      description={product ? statusLabel(product.status) : undefined}
      size="lg"
      headerActions={
        product && (
          <Button variant="secondary" size="sm" className="gap-1.5"
            onClick={() => onEdit?.(product.id)}>
            <Icon as={Pencil} size="sm" /> {t('shop.edit_product')}
          </Button>
        )
      }
    >
      {loading || !product ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-4 w-2/3 rounded" />
          <Skeleton className="h-24 w-full rounded" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Galerie */}
          {product.images && product.images.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {product.images.map((img) => (
                <img key={img.id} src={img.url} alt={img.alt || product.title}
                  className="h-28 w-28 rounded-lg object-cover border border-[var(--border-subtle)] shrink-0"
                  loading="lazy" />
              ))}
            </div>
          ) : (
            <div className="h-28 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)]">
              <Icon as={ImageIcon} size="lg" />
            </div>
          )}

          {/* Infos */}
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('shop.base_price')} value={price(product)} accent />
            <Field label="Statut" value={
              <Tag dot size="sm" variant={statusVariant(product.status)}>
                {statusLabel(product.status)}
              </Tag>
            } />
            <Field label={t('shop.product_type')} value={product.product_type || '—'} />
            <Field label={t('shop.vendor')} value={product.vendor || '—'} />
          </div>

          {product.description && (
            <div>
              <span className="t-label-form mb-1 block">{t('shop.description')}</span>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {product.description}
              </p>
            </div>
          )}

          {/* Catégories */}
          {product.categories && product.categories.length > 0 && (
            <div>
              <span className="t-label-form mb-1.5 block">{t('shop.categories')}</span>
              <div className="flex flex-wrap gap-2">
                {product.categories.map((c) => (
                  <Tag key={c.id} size="sm" variant="neutral">{c.name}</Tag>
                ))}
              </div>
            </div>
          )}

          {/* Variantes + stock */}
          <div>
            <span className="t-label-form mb-2 block inline-flex items-center gap-1.5">
              <Icon as={Package} size="sm" /> {t('shop.variants')} ({product.variants?.length || 0})
            </span>
            <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden divide-y divide-[var(--border-subtle)]">
              {(product.variants || []).map((v) => {
                const qty = v.inventory?.quantity ?? null;
                const thr = v.inventory?.low_stock_threshold ?? 0;
                const low = qty != null && qty <= thr;
                return (
                  <div key={v.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                    <span className="font-medium flex-1 min-w-0 truncate">{v.title}</span>
                    {v.sku && <span className="text-[11px] font-mono text-[var(--text-muted)]">{v.sku}</span>}
                    <div className="flex items-center gap-1">
                      <span className="t-mono-num">
                        {v.price_override != null
                          ? formatMoneyCents(v.price_override, getLocale(), product.currency || 'CAD')
                          : formatMoneyCents(product.base_price || 0, getLocale(), product.currency || 'CAD')}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-1 h-auto text-[var(--text-muted)] hover:text-[var(--primary)]"
                        onClick={() => setSelectedVariantId(v.id)}
                        title="Gérer les tarifs B2B"
                        aria-label={`Gérer les tarifs B2B pour ${v.title}`}
                      >
                        <Icon as={Calculator} size="sm" />
                      </Button>
                    </div>
                    {qty != null && (
                      <Tag size="sm" variant={low ? 'warning' : 'neutral'}>
                        {qty} {low ? `· ${t('shop.low_stock')}` : ''}
                      </Tag>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </SlidePanel>
    <Modal
      open={Boolean(selectedVariantId)}
      onOpenChange={(op) => { if (!op) setSelectedVariantId(null); }}
      title="Tarifs B2B par Segment"
      size="lg"
    >
      {selectedVariantId && (
        <TierPricesEditor variantId={selectedVariantId} />
      )}
    </Modal>
  </>
  );
}

function Field({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div>
      <span className="t-label-form mb-0.5 block">{label}</span>
      <span className={`text-[14px] font-semibold ${accent ? 'text-[var(--primary)]' : 'text-[var(--text-primary)]'}`}>
        {value}
      </span>
    </div>
  );
}
