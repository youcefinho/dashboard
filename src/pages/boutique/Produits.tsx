// ── Boutique — Produits (catalogue réel) — Sprint E2 M3.1 ────────────────────
// Remplace le scaffolding E1. Table-premium (pattern Properties.tsx) : frozen
// col image+titre, SKU / prix formaté / statut / variantes / stock / catégories.
// Filtres (statut, catégorie, recherche debounced), tri, expand inline.
// Wiré endpoints M1/M2 via api.ts. EmptyState Sprint 45 → ouvre ProductWizard.
// <ModuleGuard module="ecommerce"> préservé (appliqué au niveau route par E1).

import { useEffect, useRef, useState, Fragment } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHero, Card, EmptyState, Button, Skeleton, Tag, Input, Select, Icon,
  useToast, useConfirm,
} from '@/components/ui';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import {
  getEcommerceProducts, getEcommerceCategories, deleteEcommerceProduct,
} from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents, formatNumber } from '@/lib/i18n/number';
import type { Product, ProductCategory } from '@/lib/types';
import { ProductWizard } from '@/components/ecommerce/ProductWizard';
import { ProductDetailPanel } from '@/components/ecommerce/ProductDetailPanel';
import { CategoriesPanel } from '@/components/ecommerce/CategoriesPanel';
import {
  Package, Plus, Search, Trash2, ChevronRight, FolderTree, RefreshCw,
} from 'lucide-react';

// Le worker renvoie p.* + variants_count + primary_image (alias SQL).
type ProductRow = Product & { variants_count?: number; primary_image?: string | null };

function statusVariant(s?: string) {
  return s === 'active' ? 'success' : s === 'archived' ? 'neutral' : 'warning';
}
function statusLabel(s?: string) {
  return s === 'active' ? t('shop.status_active')
    : s === 'archived' ? t('shop.status_archived')
    : t('shop.status_draft');
}

export function ProduitsPage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Error state (Sprint reinforcement) — affiché si le fetch produits échoue.
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filtres
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [sort, setSort] = useState('created_desc');

  // Expand inline
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpanded((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // Panels
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);

  // Debounce recherche
  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(search.trim()), 320);
    return () => clearTimeout(h);
  }, [search]);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getEcommerceProducts({
        status: statusFilter || undefined,
        category_id: catFilter || undefined,
        search: debouncedSearch || undefined,
        sort,
      });
      if (res.error) {
        setLoadError(res.error);
        setProducts([]);
      } else {
        setProducts((res.data as ProductRow[]) || []);
      }
    } catch {
      // Pas de donnée fictive — on affiche un état d'erreur honnête.
      setLoadError(t('shop.error.load_failed'));
      setProducts([]);
    }
    setIsLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debouncedSearch, statusFilter, catFilter, sort]);
  useEffect(() => {
    getEcommerceCategories().then((r) => setCategories(r.data || [])).catch(() => {});
  }, []);

  const handleDelete = async (p: ProductRow) => {
    const ok = await confirm({
      title: t('shop.delete_product_q'),
      description: t('shop.delete_product_desc'),
      confirmLabel: t('action.delete'),
      cancelLabel: t('action.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await deleteEcommerceProduct(p.id);
      if (res && res.error) {
        toastError(res.error);
        return;
      }
      setProducts((prev) => prev.filter((x) => x.id !== p.id));
      success(t('shop.product_deleted'));
    } catch {
      // Réseau / exception non-API : on prévient l'utilisateur (pas silencieux).
      toastError(t('common.error.load_failed'));
    }
  };

  const openCreate = () => { setEditId(null); setWizardOpen(true); };
  const openEdit = (id: string) => { setDetailId(null); setEditId(id); setWizardOpen(true); };

  // Pull-to-refresh (pattern Properties)
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await load(); }, { scrollParent: scrollParentRef });

  const hasFilters = Boolean(debouncedSearch || statusFilter || catFilter);

  return (
    <AppLayout title={t('shop.products')}>
      <div ref={ptr.containerRef}>
        <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
        <PageHero
          meta={t('shop.nav')}
          title={t('shop.products')}
          highlight={t('shop.products')}
          description="Le catalogue de ta boutique : photos, variantes, prix et stock."
          actions={
            <div className="flex gap-2">
              <Button variant="secondary" className="gap-2" onClick={() => setCatsOpen(true)}>
                <Icon as={FolderTree} size="md" /> {t('shop.categories')}
              </Button>
              <Button className="gap-2" onClick={openCreate}>
                <Icon as={Plus} size="md" /> {t('shop.add_product_full')}
              </Button>
            </div>
          }
        />

        {/* Filtres */}
        <div className="flex flex-col md:flex-row gap-3 mb-5">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
            <Input className="pl-9" placeholder={t('shop.search_products')}
              value={search} onChange={(e: any) => setSearch(e.target.value)} />
          </div>
          <Select className="md:w-48" value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)} aria-label={t('shop.filter_status_aria')}>
            <option value="">{t('shop.filter_all_status')}</option>
            <option value="active">{t('shop.status_active')}</option>
            <option value="draft">{t('shop.status_draft')}</option>
            <option value="archived">{t('shop.status_archived')}</option>
          </Select>
          <Select className="md:w-48" value={catFilter}
            onChange={(e: any) => setCatFilter(e.target.value)} aria-label={t('shop.category')}>
            <option value="">{t('shop.filter_all_categories')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select className="md:w-48" value={sort}
            onChange={(e: any) => setSort(e.target.value)} aria-label={t('shop.sort_aria')}>
            <option value="created_desc">{t('shop.sort_recent')}</option>
            <option value="created_asc">{t('shop.sort_oldest')}</option>
            <option value="title_asc">{t('shop.sort_title_asc')}</option>
            <option value="title_desc">{t('shop.sort_title_desc')}</option>
            <option value="price_asc">{t('shop.sort_price_asc')}</option>
            <option value="price_desc">{t('shop.sort_price_desc')}</option>
          </Select>
        </div>

        {isLoading ? (
          <Card className="p-0 overflow-hidden" aria-busy="true" data-testid="produits-loading">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-3 w-20 rounded" />)}
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-10 w-10 rounded shrink-0" />
                  <Skeleton className="h-4 w-1/3 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-3 w-16 rounded ml-auto" />
                </div>
              ))}
            </div>
          </Card>
        ) : loadError ? (
          <Card className="p-6" aria-live="polite" data-testid="produits-error">
            <p className="text-sm text-[var(--danger-text)] mb-3">{loadError}</p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icon as={RefreshCw} size="sm" />}
              onClick={() => void load()}
              aria-label={t('action.retry')}
              data-testid="produits-retry"
            >
              {t('action.retry')}
            </Button>
          </Card>
        ) : products.length === 0 ? (
          <Card className="p-0 overflow-hidden">
            <EmptyState
              variant={hasFilters ? 'filtered' : 'first-time'}
              icon={<Package size={32} strokeWidth={1.8} />}
              meta={t('shop.nav')}
              title={hasFilters ? t('shop.empty.products_title') : t('shop.empty.catalog_title')}
              description={hasFilters ? t('shop.empty.products_desc') : t('shop.empty.catalog_desc')}
              action={
                !hasFilters && (
                  <Button onClick={openCreate} leftIcon={<Plus size={14} />}>
                    {t('shop.add_product_full')}
                  </Button>
                )
              }
              secondaryAction={
                hasFilters && (
                  <Button variant="ghost" leftIcon={<RefreshCw size={14} />}
                    onClick={() => { setSearch(''); setStatusFilter(''); setCatFilter(''); }}>
                    {t('shop.reset_filters')}
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="table-premium-container overflow-x-auto">
              <table className="table-premium print-data-table">
                <thead>
                  <tr>
                    <th className="col-frozen" style={{ minWidth: 300 }}>{t('shop.col_product')}</th>
                    <th className="text-left">{t('shop.col_sku')}</th>
                    <th className="text-right">{t('shop.col_price')}</th>
                    <th className="text-center">{t('shop.col_variants')}</th>
                    <th className="text-right">{t('shop.col_stock')}</th>
                    <th className="text-left">{t('shop.col_categories')}</th>
                    <th className="text-left">{t('shop.col_status')}</th>
                    <th data-print-hide style={{ width: 48 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, idx) => {
                    const isOpen = expanded.has(p.id);
                    const v0 = p.variants?.[0];
                    const stockTotal = (p.variants || []).reduce(
                      (s, v) => s + (v.inventory?.quantity ?? 0), 0);
                    return (
                      <Fragment key={p.id}>
                        <tr className="list-item-enter" style={{ animationDelay: `${idx * 28}ms` }}>
                          <td className="col-frozen">
                            <div className="flex items-center gap-3">
                              <button type="button"
                                className={`table-expand-trigger ${isOpen ? 'is-expanded' : ''}`}
                                onClick={() => toggleExpand(p.id)}
                                aria-expanded={isOpen}
                                aria-label={isOpen ? t('shop.collapse_details') : t('shop.expand_details')}>
                                <ChevronRight size={14} />
                              </button>
                              <div className="h-10 w-10 rounded-md overflow-hidden bg-[var(--bg-subtle)] flex items-center justify-center shrink-0 border border-[var(--border-subtle)]" aria-hidden>
                                {p.primary_image
                                  ? <img src={p.primary_image} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                                  : <Icon as={Package} size="sm" className="text-[var(--text-muted)]" />}
                              </div>
                              <button type="button"
                                className="flex flex-col min-w-0 text-left hover:text-[var(--primary)] transition-colors"
                                onClick={() => setDetailId(p.id)}>
                                <span className="font-semibold text-[13px] truncate" title={p.title}>
                                  {p.title || t('shop.untitled')}
                                </span>
                                <span className="text-[11px] text-[var(--text-muted)] truncate">
                                  {p.product_type || p.vendor || p.slug}
                                </span>
                              </button>
                            </div>
                          </td>
                          <td className="text-[12px] font-mono text-[var(--text-secondary)]">
                            {v0?.sku || '—'}
                          </td>
                          <td className="text-right font-semibold t-mono-num" style={{ color: 'var(--primary)' }}>
                            {p.base_price != null ? formatMoneyCents(p.base_price, getLocale(), p.currency || 'CAD') : '—'}
                          </td>
                          <td className="text-center t-mono-num text-[12px]">
                            {p.variants_count ?? p.variants?.length ?? 0}
                          </td>
                          <td className="text-right t-mono-num text-[12px] text-[var(--text-secondary)]">
                            {p.variants && p.variants.length > 0
                              ? formatNumber(stockTotal, getLocale())
                              : '—'}
                          </td>
                          <td className="text-[12px]">
                            {p.categories && p.categories.length > 0 ? (
                              <span className="inline-flex flex-wrap gap-1">
                                {p.categories.slice(0, 2).map((c) => (
                                  <Tag key={c.id} size="sm" variant="neutral">{c.name}</Tag>
                                ))}
                                {p.categories.length > 2 && (
                                  <span className="text-[11px] text-[var(--text-muted)]">
                                    +{p.categories.length - 2}
                                  </span>
                                )}
                              </span>
                            ) : <span className="text-[var(--text-muted)]">—</span>}
                          </td>
                          <td>
                            <Tag dot size="sm" variant={statusVariant(p.status)}>
                              {statusLabel(p.status)}
                            </Tag>
                          </td>
                          <td data-print-hide className="text-right">
                            <button type="button" onClick={() => handleDelete(p)}
                              className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                              aria-label={`${t('shop.delete_product_action')} — ${p.title || t('shop.untitled')}`}
                              title={t('shop.delete_product_action')}>
                              <Icon as={Trash2} size="sm" />
                            </button>
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={8} style={{ padding: 0, border: 'none' }}>
                            <div className={`table-expand-content ${isOpen ? 'is-open' : ''}`}>
                              <div className="table-expand-inner">
                                <div className="table-expand-detail">
                                  <div className="table-expand-detail-section" style={{ flex: '1 1 280px' }}>
                                    <span className="table-expand-detail-label">{t('shop.description')}</span>
                                    <span className="table-expand-detail-value text-[12px] leading-relaxed">
                                      {p.description || t('shop.no_description')}
                                    </span>
                                  </div>
                                  <div className="table-expand-detail-section" style={{ flex: '2 1 360px' }}>
                                    <span className="table-expand-detail-label">{t('shop.variants')}</span>
                                    <div className="flex flex-col gap-1 mt-1">
                                      {(p.variants || []).length === 0 && (
                                        <span className="text-[12px] text-[var(--text-muted)]">—</span>
                                      )}
                                      {(p.variants || []).map((v) => {
                                        const qty = v.inventory?.quantity ?? null;
                                        const thr = v.inventory?.low_stock_threshold ?? 0;
                                        const low = qty != null && qty <= thr;
                                        return (
                                          <div key={v.id} className="flex items-center gap-3 text-[12px]">
                                            <span className="font-medium min-w-[100px]">{v.title}</span>
                                            {v.sku && <span className="font-mono text-[var(--text-muted)]">{v.sku}</span>}
                                            <span className="t-mono-num ml-auto">
                                              {v.price_override != null
                                                ? formatMoneyCents(v.price_override, getLocale(), p.currency || 'CAD')
                                                : formatMoneyCents(p.base_price || 0, getLocale(), p.currency || 'CAD')}
                                            </span>
                                            {qty != null && (
                                              <Tag size="sm" variant={low ? 'warning' : 'neutral'}>
                                                {qty}{low ? ` · ${t('shop.low_stock')}` : ''}
                                              </Tag>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <div className="table-expand-detail-section">
                                    <span className="table-expand-detail-label">&nbsp;</span>
                                    <Button variant="secondary" size="sm" onClick={() => openEdit(p.id)}>
                                      {t('shop.edit_product')}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <ProductWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        productId={editId}
        onSaved={load}
      />
      <ProductDetailPanel
        productId={detailId}
        open={Boolean(detailId)}
        onOpenChange={(o) => { if (!o) setDetailId(null); }}
        onEdit={openEdit}
      />
      <CategoriesPanel
        open={catsOpen}
        onOpenChange={setCatsOpen}
        onChanged={() => {
          getEcommerceCategories().then((r) => setCategories(r.data || [])).catch(() => {});
          load();
        }}
      />
    </AppLayout>
  );
}
