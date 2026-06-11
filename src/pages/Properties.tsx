// ── Page Propriétés (Centris Sync) — Intralys CRM (Sprint 9) ──
// Sprint 31 vague 31-2A — Table premium (frozen first col + expand row inline)
import { useState, useEffect, useRef, Fragment } from 'react';
import { apiFetch } from '@/lib/api';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Input, Card, Tag, Skeleton, EmptyState, useConfirm, useToast, PageHero, KpiStrip, Icon, type KpiItem } from '@/components/ui';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { Modal } from '@/components/ui/Modal';
// Sprint 48 M3 — Intl currency + number formatters
import { formatMoneyCAD, formatNumber } from '@/lib/i18n/number';
import { getLocale } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { Home, RefreshCw, Plus, Search, MapPin, Trash2, ChevronRight } from 'lucide-react';

interface Property {
  id: string;
  mls_number: string;
  title: string;
  description: string;
  price: number;
  address: string;
  city: string;
  property_type: string;
  status: string;
  bedrooms: number;
  bathrooms: number;
  area_sqft: number;
  image_url: string;
  sync_source: string;
}

export function PropertiesPage() {
  const confirm = useConfirm();
  const { error: toastError, success } = useToast();
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [mlsInput, setMlsInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  // Sprint 31 vague 31-2A — expand row inline detail
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  useEffect(() => {
    loadProperties();
  }, []);

  const loadProperties = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch<Property[]>('/properties');
      if (res.data) setProperties(res.data);
      else if (res.error) setLoadError(res.error);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('properties.error.load'));
    }
    setIsLoading(false);
  };

  const handleSync = async () => {
    if (!mlsInput) return;
    setIsSyncing(true);
    try {
      const res = await apiFetch<any>('/properties/centris-sync', {
        method: 'POST',
        body: JSON.stringify({ mls_number: mlsInput })
      });
      if (res.data?.property) {
        setProperties(prev => [res.data.property, ...prev.filter(p => p.mls_number !== mlsInput)]);
        setIsSyncModalOpen(false);
        setMlsInput('');
        success(t('properties.sync.success'));
      }
    } catch (err: any) {
      toastError(err.message || t('properties.error.sync'));
    }
    setIsSyncing(false);
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('properties.confirm.delete_title'),
      description: t('properties.confirm.delete_desc'),
      confirmLabel: t('properties.confirm.delete_label'),
      cancelLabel: t('properties.modal.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/properties/${id}`, { method: 'DELETE' });
      setProperties(prev => prev.filter(p => p.id !== id));
    } catch (err: any) {
      toastError(err?.message || t('properties.error.delete'));
    }
  };

  const filtered = properties.filter(p => 
    p.title.toLowerCase().includes(search.toLowerCase()) || 
    p.mls_number.includes(search) ||
    p.city.toLowerCase().includes(search.toLowerCase())
  );

  // Sprint 44 M3.3 — Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await loadProperties(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title={t('properties.page.title')}>
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <PageHero
        meta="Workspace"
        title={t('properties.page.title')}
        highlight={t('documents.hero.title')}
        description={t('properties.hero.description')}
      />

      {/* KPI Strip — Sprint 23 wave 17 */}
      {!isLoading && properties.length > 0 && (
        <KpiStrip
          items={(() => {
            const active = properties.filter(p => p.status === 'active' || p.status === 'for_sale').length;
            const sold = properties.filter(p => p.status === 'sold' || p.status === 'closed').length;
            const totalValue = properties.reduce((s, p) => s + (p.price || 0), 0);
            return [
              { label: t('properties.kpi.total'), value: properties.length, color: 'brand', icon: <Home size={11} /> },
              { label: t('properties.kpi.active'), value: active, color: 'success' },
              { label: t('properties.kpi.sold'), value: sold, color: 'info' },
              { label: t('properties.kpi.value'), value: `${(totalValue / 1000000).toFixed(1)}M`, color: 'accent' },
            ] satisfies KpiItem[];
          })()}
        />
      )}

      <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
          <Input 
            placeholder={t('properties.search.placeholder')} 
            value={search} 
            onChange={(e: any) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <Button variant="secondary" onClick={() => setIsSyncModalOpen(true)} className="flex-1 md:flex-none gap-2">
            <Icon as={RefreshCw} size="md" /> {t('properties.action.sync')}
          </Button>
          <Button className="flex-1 md:flex-none gap-2">
            <Icon as={Plus} size="md" /> {t('properties.action.add')}
          </Button>
        </div>
      </div>

      {loadError && !isLoading && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[var(--danger)]"
        >
          <span className="text-sm">{loadError}</span>
          <Button size="sm" variant="secondary" onClick={() => void loadProperties()} aria-label={t('action.retry')}>
            {t('action.retry')}
          </Button>
        </div>
      )}

      {isLoading ? (
        <Card className="p-0 overflow-hidden" aria-busy="true" aria-live="polite">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
            {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-3 w-20 rounded" />)}
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1,2,3,4,5,6,7,8].map(i => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-10 w-14 rounded shrink-0" />
                <Skeleton className="h-4 w-1/3 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3 w-16 rounded ml-auto" />
              </div>
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 && !loadError ? (
        <EmptyState
          variant="first-time"
          icon={<Home size={32} strokeWidth={1.8} />}
          meta="Premier pas"
          title={t('properties.empty.title')}
          description={t('properties.empty.desc')}
          action={
            <Button onClick={() => setIsSyncModalOpen(true)} leftIcon={<RefreshCw size={14} />}>
              {t('properties.action.import')}
            </Button>
          }
          secondaryAction={
            <Button variant="ghost" onClick={() => { /* placeholder ajout manuel */ }}>
              {t('properties.action.add')}
            </Button>
          }
          tips={[
            'Connectez Centris dans Paramètres → Intégrations pour synchroniser automatiquement.',
            'Les propriétés synchronisées remontent dans la map et les fiches lead.',
            'Vous pouvez aussi importer un CSV de mandats exclusifs (max 500 lignes).',
          ]}
        />
      ) : (
        /* Sprint 31 vague 31-2A — Table premium (frozen first col + expand row inline) */
        <Card className="p-0 overflow-hidden">
          <div className="table-premium-container overflow-x-auto animate-stagger">
            <table className="table-premium print-data-table">
              <thead>
                <tr>
                  <th className="col-frozen" style={{ minWidth: 280 }}>{t('properties.table.property')}</th>
                  <th className="text-left">MLS</th>
                  <th className="text-right">{t('properties.table.price')}</th>
                  <th className="text-left">{t('properties.table.city')}</th>
                  <th className="text-left">{t('properties.table.type')}</th>
                  <th className="text-center">{t('properties.table.bedrooms')}</th>
                  <th className="text-center">{t('properties.table.bathrooms')}</th>
                  <th className="text-right">{t('properties.table.area')}</th>
                  <th className="text-left">{t('properties.table.status')}</th>
                  <th data-print-hide style={{ width: 48 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((property, idx) => {
                  const isExpanded = expandedRows.has(property.id);
                  return (
                    <Fragment key={property.id}>
                      <tr
                        className="row-premium table-row-hover list-item-enter"
                        style={{ animationDelay: `${idx * 28}ms` }}
                      >
                        <td className="col-frozen">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
                              onClick={() => toggleExpand(property.id)}
                              aria-label={isExpanded ? t('properties.row_collapse') : t('properties.row_expand')}
                              aria-expanded={isExpanded}
                            >
                              <ChevronRight size={14} />
                            </button>
                            <div
                              className="h-10 w-14 rounded-md overflow-hidden bg-[var(--bg-subtle)] flex items-center justify-center shrink-0 border border-[var(--border-subtle)]"
                              aria-hidden
                            >
                              {property.image_url ? (
                                <img src={property.image_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                              ) : (
                                <Icon as={Home} size="sm" className="text-[var(--text-muted)]" />
                              )}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-[13px] truncate" title={property.title}>
                                {property.title || t('properties.untitled')}
                              </span>
                              <span className="text-[11px] text-[var(--text-muted)] truncate">
                                {property.address || '—'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="text-[12px] font-mono text-[var(--text-secondary)]">
                          {property.mls_number || '—'}
                        </td>
                        <td className="table-cell-numeric text-right font-bold t-mono-num" style={{ color: 'var(--primary)', fontWeight: 700 }}>
                          {property.price ? formatMoneyCAD(property.price, getLocale()) : '—'}
                        </td>
                        <td className="text-[12px]">
                          <span className="inline-flex items-center gap-1">
                            <Icon as={MapPin} size="xs" className="text-[var(--text-muted)]" />
                            {property.city || '—'}
                          </span>
                        </td>
                        <td className="text-[12px] text-[var(--text-secondary)]">
                          {property.property_type || '—'}
                        </td>
                        <td className="text-center t-mono-num text-[12px]">
                          {property.bedrooms || '—'}
                        </td>
                        <td className="text-center t-mono-num text-[12px]">
                          {property.bathrooms || '—'}
                        </td>
                        <td className="table-cell-numeric text-right t-mono-num text-[12px] text-[var(--text-secondary)]">
                          {property.area_sqft ? `${formatNumber(property.area_sqft, getLocale())} pc` : '—'}
                        </td>
                        <td>
                          <Tag dot size="sm" variant={
                            property.status === 'active' || property.status === 'for_sale' ? 'success'
                            : property.status === 'sold' || property.status === 'closed' ? 'info'
                            : 'neutral'
                          }>
                            {property.status === 'active' || property.status === 'for_sale' ? t('properties.status.for_sale')
                              : property.status === 'sold' || property.status === 'closed' ? t('properties.status.sold')
                              : property.status || '—'}
                          </Tag>
                        </td>
                        <td data-print-hide className="text-right">
                          <button
                            type="button"
                            onClick={() => handleDelete(property.id)}
                            className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                            aria-label={t('properties.action.remove_aria')}
                            title={t('properties.action.remove_title')}
                          >
                            <Icon as={Trash2} size="sm" />
                          </button>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={10} style={{ padding: 0, border: 'none' }}>
                          <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                            <div className="table-expand-inner">
                              <div className="table-expand-detail">
                                <div className="table-expand-detail-section" style={{ flex: '1 1 320px' }}>
                                  <span className="table-expand-detail-label">{t('properties.expand.description_label')}</span>
                                  <span className="table-expand-detail-value text-[12px] leading-relaxed">
                                    {property.description || t('properties.expand.no_description')}
                                  </span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('properties.expand.source_label')}</span>
                                  <span className="table-expand-detail-value text-[12px]">
                                    {property.sync_source || t('properties.expand.source_manual')}
                                  </span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('properties.expand.address_label')}</span>
                                  <span className="table-expand-detail-value text-[12px]">
                                    {property.address || '—'}
                                    {property.city && <>, {property.city}</>}
                                  </span>
                                </div>
                                {property.image_url && (
                                  <div className="table-expand-detail-section">
                                    <span className="table-expand-detail-label">{t('properties.expand.photo_label')}</span>
                                    <img
                                      src={property.image_url}
                                      alt={property.title}
                                      className="h-24 rounded-md object-cover border border-[var(--border-subtle)]"
                                      loading="lazy"
                                    />
                                  </div>
                                )}
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

      <Modal open={isSyncModalOpen} onOpenChange={() => setIsSyncModalOpen(false)} title={t('properties.modal.title')}>
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            {t('properties.modal.help')}
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">{t('properties.form.mls_label')}</label>
            <Input
              value={mlsInput}
              onChange={(e: any) => setMlsInput(e.target.value)}
              placeholder="12345678"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="secondary" onClick={() => setIsSyncModalOpen(false)}>{t('properties.modal.cancel')}</Button>
            <Button onClick={handleSync} disabled={!mlsInput || isSyncing} aria-busy={isSyncing}>
              {isSyncing ? t('properties.modal.syncing') : t('properties.modal.import')}
            </Button>
          </div>
        </div>
      </Modal>
      </div>
    </AppLayout>
  );
}