// ── Boutique — Wizard création / édition produit — Sprint E2 M3.2 ────────────
// 4 étapes : Infos générales · Variantes & SKU · Images · Inventaire.
// Create → POST produit puis variantes / images / inventaire.
// Edit → préremplit depuis GET /products/:id (variants + images + inventory).
// Stripe SUBTLE, FR québécois, A11y (announceSR au changement d'étape).

import { useEffect, useMemo, useState } from 'react';
import {
  Wizard, Input, Select, Textarea, Card, Button, Tag, Icon,
  useToast, announceSR, type WizardStep,
} from '@/components/ui';
import {
  createEcommerceProduct, updateEcommerceProduct, getEcommerceProduct,
  createEcommerceVariant, updateEcommerceVariant, deleteEcommerceVariant,
  addProductImage, setPrimaryProductImage,
  setVariantInventory, getEcommerceCategories, setProductCategories,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Product, ProductCategory } from '@/lib/types';
import { Plus, Trash2, Star, Image as ImageIcon, Package } from 'lucide-react';

interface DraftVariant {
  id?: string;            // présent si variante existante (edit)
  title: string;
  sku: string;
  price_override: string; // en dollars (UI), converti en cents à l'envoi
  barcode: string;
  options: string;        // ex "Couleur: Rouge, Taille: L"
  // Inventaire
  quantity: string;
  low_stock_threshold: string;
  track_inventory: boolean;
  allow_backorder: boolean;
  _inventory_variant_id?: string; // id réel pour PUT inventory
}

interface DraftImage {
  id?: string;
  url: string;
  alt: string;
  primary: boolean;
}

interface ProductWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si fourni → mode édition (préremplissage). */
  productId?: string | null;
  /** Appelé après création / mise à jour réussie. */
  onSaved?: () => void;
}

const emptyVariant = (): DraftVariant => ({
  title: 'Default', sku: '', price_override: '', barcode: '', options: '',
  quantity: '0', low_stock_threshold: '5', track_inventory: true, allow_backorder: false,
});

function dollarsToCents(v: string): number | null {
  const n = parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n * 100));
}
function centsToDollars(c: number | null | undefined): string {
  if (c == null) return '';
  return (c / 100).toFixed(2);
}

export function ProductWizard({ open, onOpenChange, productId, onSaved }: ProductWizardProps) {
  const { success, error: toastError } = useToast();
  const isEdit = Boolean(productId);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<ProductCategory[]>([]);

  // ── Étape 1 — Infos générales ──
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [productType, setProductType] = useState('');
  const [vendor, setVendor] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [status, setStatus] = useState<Product['status']>('draft');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);

  // ── Étape 2 — Variantes ──
  const [variants, setVariants] = useState<DraftVariant[]>([emptyVariant()]);
  // ── Étape 3 — Images ──
  const [images, setImages] = useState<DraftImage[]>([]);

  // Reset / préremplissage à l'ouverture
  useEffect(() => {
    if (!open) return;
    setStep(0);
    getEcommerceCategories().then((r) => setCategories(r.data || [])).catch(() => {});
    if (!isEdit || !productId) {
      setTitle(''); setDescription(''); setProductType(''); setVendor('');
      setBasePrice(''); setStatus('draft'); setSeoTitle(''); setSeoDescription('');
      setSelectedCats([]); setVariants([emptyVariant()]); setImages([]);
      return;
    }
    getEcommerceProduct(productId).then((r) => {
      const p = r.data;
      if (!p) return;
      setTitle(p.title || '');
      setDescription(p.description || '');
      setProductType(p.product_type || '');
      setVendor(p.vendor || '');
      setBasePrice(centsToDollars(p.base_price));
      setStatus(p.status || 'draft');
      setSeoTitle(p.seo_title || '');
      setSeoDescription(p.seo_description || '');
      setSelectedCats((p.categories || []).map((c) => c.id));
      setVariants(
        (p.variants && p.variants.length > 0
          ? p.variants.map((v) => {
              let opts = '';
              try {
                const o = JSON.parse(v.options_json || '{}');
                opts = Object.entries(o).map(([k, val]) => `${k}: ${val}`).join(', ');
              } catch { /* ignore */ }
              return {
                id: v.id,
                title: v.title || 'Default',
                sku: v.sku || '',
                price_override: centsToDollars(v.price_override),
                barcode: v.barcode || '',
                options: opts,
                quantity: String(v.inventory?.quantity ?? 0),
                low_stock_threshold: String(v.inventory?.low_stock_threshold ?? 5),
                track_inventory: (v.inventory?.track_inventory ?? 1) === 1,
                allow_backorder: (v.inventory?.allow_backorder ?? 0) === 1,
                _inventory_variant_id: v.id,
              } as DraftVariant;
            })
          : [emptyVariant()]),
      );
      setImages((p.images || []).map((img, i) => ({
        id: img.id, url: img.url, alt: img.alt || '', primary: i === 0,
      })));
    }).catch(() => toastError(t('shop.product_save_error')));
  }, [open, productId, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStepChange = (i: number) => {
    setStep(i);
    const labels = [t('shop.step_general'), t('shop.step_variants'), t('shop.step_images'), t('shop.step_inventory')];
    announceSR(`${t('shop.step_general') ? '' : ''}${labels[i] || ''}`, 'polite');
  };

  const parseOptions = (raw: string): Record<string, string> => {
    const out: Record<string, string> = {};
    raw.split(',').forEach((pair) => {
      const [k, ...rest] = pair.split(':');
      if (k && rest.length) out[k.trim()] = rest.join(':').trim();
    });
    return out;
  };

  const handleComplete = async () => {
    if (!title.trim()) { toastError(t('shop.product_save_error')); setStep(0); return; }
    setSaving(true);
    try {
      const baseCents = dollarsToCents(basePrice) ?? 0;
      let pid = productId || '';

      if (isEdit && pid) {
        await updateEcommerceProduct(pid, {
          title: title.trim(), description, product_type: productType, vendor,
          base_price: baseCents, status, seo_title: seoTitle, seo_description: seoDescription,
        });
      } else {
        const res = await createEcommerceProduct({
          title: title.trim(), description, product_type: productType, vendor,
          base_price: baseCents, status, seo_title: seoTitle, seo_description: seoDescription,
        });
        pid = res.data?.id || '';
        if (!pid) throw new Error('no id');
      }

      // Catégories
      await setProductCategories(pid, selectedCats).catch(() => {});

      // Variantes
      for (const v of variants) {
        const payload = {
          title: v.title || 'Default',
          sku: v.sku || undefined,
          price_override: dollarsToCents(v.price_override) ?? undefined,
          barcode: v.barcode || undefined,
          options_json: JSON.stringify(parseOptions(v.options)),
        };
        let realVid = v._inventory_variant_id || v.id || '';
        if (v.id) {
          await updateEcommerceVariant(pid, v.id, payload);
        } else {
          const vr = await createEcommerceVariant(pid, payload);
          realVid = vr.data?.id || '';
        }
        // Inventaire (best-effort)
        if (realVid) {
          await setVariantInventory(realVid, {
            quantity: Math.max(0, parseInt(v.quantity || '0', 10) || 0),
            low_stock_threshold: Math.max(0, parseInt(v.low_stock_threshold || '0', 10) || 0),
            track_inventory: v.track_inventory ? 1 : 0,
            allow_backorder: v.allow_backorder ? 1 : 0,
          }).catch(() => {});
        }
      }

      // Images (nouvelles uniquement)
      let firstImgId = '';
      for (const img of images) {
        if (img.id) { if (img.primary) firstImgId = img.id; continue; }
        if (!img.url.trim()) continue;
        const ir = await addProductImage(pid, { url: img.url.trim(), alt: img.alt });
        if (img.primary && ir.data?.id) firstImgId = ir.data.id;
      }
      if (firstImgId) await setPrimaryProductImage(pid, firstImgId).catch(() => {});

      success(isEdit ? t('shop.product_updated') : t('shop.product_created'));
      onSaved?.();
      onOpenChange(false);
    } catch {
      toastError(t('shop.product_save_error'));
    } finally {
      setSaving(false);
    }
  };

  const setVar = (idx: number, patch: Partial<DraftVariant>) =>
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));

  const steps: WizardStep[] = useMemo(() => [
    {
      id: 'general',
      label: t('shop.step_general'),
      isValid: () => title.trim().length > 0,
      content: (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Input label={`${t('shop.product')} *`} value={title}
              onChange={(e: any) => setTitle(e.target.value)}
              placeholder="Ex : T-shirt logo Intralys" autoFocus />
          </div>
          <div className="md:col-span-2">
            <Textarea label={t('shop.description')} value={description} rows={3}
              onChange={(e: any) => setDescription(e.target.value)} />
          </div>
          <Input label={t('shop.product_type')} value={productType}
            onChange={(e: any) => setProductType(e.target.value)} placeholder="Vêtement" />
          <Input label={t('shop.vendor')} value={vendor}
            onChange={(e: any) => setVendor(e.target.value)} placeholder="Intralys" />
          <Input label={`${t('shop.base_price')} ($ CAD)`} value={basePrice} inputMode="decimal"
            onChange={(e: any) => setBasePrice(e.target.value)} placeholder="0,00" />
          <Select label="Statut" value={status}
            onChange={(e: any) => setStatus(e.target.value)}>
            <option value="draft">{t('shop.status_draft')}</option>
            <option value="active">{t('shop.status_active')}</option>
            <option value="archived">{t('shop.status_archived')}</option>
          </Select>
          {categories.length > 0 && (
            <div className="md:col-span-2">
              <span className="t-label-form mb-1.5 block">{t('shop.categories')}</span>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const on = selectedCats.includes(c.id);
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setSelectedCats((prev) =>
                        on ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                      className={`shop-cat-chip ${on ? 'is-on' : ''}`}
                      aria-pressed={on}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="md:col-span-2 pt-2 border-t border-[var(--border-subtle)]">
            <Input label={t('shop.seo_title')} value={seoTitle}
              onChange={(e: any) => setSeoTitle(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Textarea label={t('shop.seo_description')} value={seoDescription} rows={2}
              onChange={(e: any) => setSeoDescription(e.target.value)} />
          </div>
        </div>
      ),
    },
    {
      id: 'variants',
      label: t('shop.step_variants'),
      content: (
        <div className="flex flex-col gap-3">
          {variants.map((v, idx) => (
            <Card key={idx} className="p-4 shop-variant-card">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-semibold inline-flex items-center gap-1.5">
                  <Icon as={Package} size="sm" className="text-[var(--text-muted)]" />
                  {t('shop.variant')} {idx + 1}
                </span>
                {variants.length > 1 && (
                  <button type="button" aria-label="Retirer la variante"
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                    onClick={() => {
                      const removed = variants[idx];
                      if (removed?.id && productId) deleteEcommerceVariant(productId, removed.id).catch(() => {});
                      setVariants((prev) => prev.filter((_, i) => i !== idx));
                    }}>
                    <Icon as={Trash2} size="sm" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label={t('shop.variant')} value={v.title}
                  onChange={(e: any) => setVar(idx, { title: e.target.value })} />
                <Input label={t('shop.sku')} value={v.sku}
                  onChange={(e: any) => setVar(idx, { sku: e.target.value })} placeholder="SKU-001" />
                <Input label={`${t('shop.price_override')} ($)`} value={v.price_override} inputMode="decimal"
                  onChange={(e: any) => setVar(idx, { price_override: e.target.value })}
                  placeholder="Hérite du prix de base" />
                <Input label={t('shop.barcode')} value={v.barcode}
                  onChange={(e: any) => setVar(idx, { barcode: e.target.value })} />
                <div className="md:col-span-2">
                  <Input label="Options (ex : Couleur: Rouge, Taille: L)" value={v.options}
                    onChange={(e: any) => setVar(idx, { options: e.target.value })} />
                </div>
              </div>
            </Card>
          ))}
          <Button variant="secondary" size="md" className="self-start gap-2"
            onClick={() => setVariants((prev) => [...prev, emptyVariant()])}>
            <Icon as={Plus} size="md" /> {t('shop.add_variant')}
          </Button>
        </div>
      ),
    },
    {
      id: 'images',
      label: t('shop.step_images'),
      isOptional: true,
      content: (
        <div className="flex flex-col gap-3">
          {images.length === 0 && (
            <p className="text-[12px] text-[var(--text-muted)] inline-flex items-center gap-1.5">
              <Icon as={ImageIcon} size="sm" /> Aucune image. Ajoute une URL d’image ci-dessous.
            </p>
          )}
          {images.map((img, idx) => (
            <Card key={idx} className="p-3 flex items-start gap-3">
              <div className="h-16 w-16 rounded-md overflow-hidden bg-[var(--bg-subtle)] border border-[var(--border-subtle)] shrink-0 flex items-center justify-center">
                {img.url
                  ? <img src={img.url} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
                  : <Icon as={ImageIcon} size="md" className="text-[var(--text-muted)]" />}
              </div>
              <div className="flex-1 grid grid-cols-1 gap-2">
                <Input label={t('shop.image_url')} value={img.url}
                  onChange={(e: any) => setImages((p) => p.map((x, i) => i === idx ? { ...x, url: e.target.value } : x))}
                  placeholder="https://…" />
                <Input label={t('shop.image_alt')} value={img.alt}
                  onChange={(e: any) => setImages((p) => p.map((x, i) => i === idx ? { ...x, alt: e.target.value } : x))} />
              </div>
              <div className="flex flex-col gap-1.5 items-end">
                <button type="button"
                  className={`shop-img-primary ${img.primary ? 'is-on' : ''}`}
                  aria-label={t('shop.primary_image')} title={t('shop.primary_image')}
                  onClick={() => setImages((p) => p.map((x, i) => ({ ...x, primary: i === idx })))}>
                  <Icon as={Star} size="sm" />
                </button>
                <button type="button" aria-label="Retirer l’image"
                  className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                  onClick={() => setImages((p) => p.filter((_, i) => i !== idx))}>
                  <Icon as={Trash2} size="sm" />
                </button>
              </div>
            </Card>
          ))}
          <Button variant="secondary" size="md" className="self-start gap-2"
            onClick={() => setImages((p) => [...p, { url: '', alt: '', primary: p.length === 0 }])}>
            <Icon as={Plus} size="md" /> {t('shop.add_image')}
          </Button>
        </div>
      ),
    },
    {
      id: 'inventory',
      label: t('shop.step_inventory'),
      content: (
        <div className="flex flex-col gap-3">
          {variants.map((v, idx) => (
            <Card key={idx} className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Tag size="sm" variant="neutral">{v.title || 'Default'}</Tag>
                {v.sku && <span className="text-[11px] font-mono text-[var(--text-muted)]">{v.sku}</span>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label={t('shop.quantity')} value={v.quantity} inputMode="numeric"
                  onChange={(e: any) => setVar(idx, { quantity: e.target.value })} />
                <Input label={t('shop.low_stock_threshold')} value={v.low_stock_threshold} inputMode="numeric"
                  onChange={(e: any) => setVar(idx, { low_stock_threshold: e.target.value })} />
                <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
                  <input type="checkbox" checked={v.track_inventory}
                    onChange={(e) => setVar(idx, { track_inventory: e.target.checked })} />
                  {t('shop.track_inventory')}
                </label>
                <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
                  <input type="checkbox" checked={v.allow_backorder}
                    onChange={(e) => setVar(idx, { allow_backorder: e.target.checked })} />
                  {t('shop.allow_backorder')}
                </label>
              </div>
            </Card>
          ))}
        </div>
      ),
    },
  ], [
    title, description, productType, vendor, basePrice, status, seoTitle, seoDescription,
    categories, selectedCats, variants, images, productId,
  ]);

  return (
    <Wizard
      open={open}
      onOpenChange={onOpenChange}
      onCancel={() => onOpenChange(false)}
      title={isEdit ? t('shop.wizard_edit_title') : t('shop.wizard_create_title')}
      description={t('shop.wizard_desc')}
      steps={steps}
      currentIndex={step}
      onStepChange={handleStepChange}
      onComplete={handleComplete}
      completeLabel={saving ? '…' : (isEdit ? t('shop.product_updated') : t('shop.add_product_full'))}
    />
  );
}
