// ── Page Corbeille — Leads supprimés ──────────────────────

import React, { useState, useEffect, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, EmptyState, Skeleton, PageHero, KpiStrip, Icon, type KpiItem, Tag, SmartBanner, useToast } from '@/components/ui';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { getTrash, restoreLead, emptyTrash } from '@/lib/api';
import { Trash2, RotateCcw, AlertTriangle, Calendar, FileX, ChevronRight, Mail, Phone } from 'lucide-react';
import { t } from '@/lib/i18n';

interface TrashItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  client_id: string;
  deleted_at: string;
}

export function TrashPage() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [lastRestored, setLastRestored] = useState<TrashItem | null>(null);
  // Renforcement — error state
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEmptying, setIsEmptying] = useState(false);
  // Sprint 32 vague 32-3A — Expand inline (deleted_at + days_remaining_purge + restore action)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchTrash = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getTrash();
      if (res.error) {
        setLoadError(res.error);
      } else if (res.data) {
        setItems(res.data as unknown as TrashItem[]);
      }
    } catch (err) {
      console.error(err);
      setLoadError(err instanceof Error ? err.message : t('trash.error.load_failed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchTrash();
  }, []);

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    const item = items.find(i => i.id === id) ?? null;
    try {
      const res = await restoreLead(id);
      if (!res.error) {
        setItems(prev => prev.filter(i => i.id !== id));
        if (item) {
          setLastRestored(item);
          toastSuccess(t('trash.banner.restored', { name: item.name }));
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRestoringId(null);
    }
  };

  const handleEmptyTrash = async () => {
    setIsEmptying(true);
    try {
      const res = await emptyTrash();
      if (res && (res as { error?: string }).error) {
        toastError((res as { error: string }).error);
      } else {
        setShowConfirm(false);
        void fetchTrash();
      }
    } catch (err) {
      console.error(err);
      toastError(err instanceof Error ? err.message : t('trash.error.empty_failed'));
    } finally {
      setIsEmptying(false);
    }
  };

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffD = Math.floor(diffMs / 86400000);
    if (diffD === 0) return "aujourd'hui";
    if (diffD === 1) return 'hier';
    if (diffD < 7) return `il y a ${diffD} jours`;
    if (diffD < 30) return `il y a ${Math.floor(diffD / 7)} semaines`;
    return `il y a ${diffD} jours`;
  };

  const daysRemaining = (dateStr: string): number => {
    const deletedAt = new Date(dateStr).getTime();
    const thirtyDaysMs = 30 * 86400000;
    const remaining = Math.ceil((deletedAt + thirtyDaysMs - Date.now()) / 86400000);
    return Math.max(0, remaining);
  };

  const urgentCount = items.filter(i => daysRemaining(i.deleted_at) <= 7).length;
  const soonestDays = items.length > 0
    ? Math.min(...items.map(i => daysRemaining(i.deleted_at)))
    : 0;

  const kpiItems: KpiItem[] = [
    { label: t('trash.label.items'), value: items.length, icon: <Trash2 size={11} />, color: 'brand' },
    { label: t('trash.label.restorable'), value: items.length, icon: <RotateCcw size={11} />, color: 'success' },
    { label: t('trash.label.next_purge'), value: items.length > 0 ? `${soonestDays}j` : '—', icon: <Calendar size={11} />, color: urgentCount > 0 ? 'danger' : 'warning' },
    { label: t('trash.label.urgent'), value: urgentCount, icon: <FileX size={11} />, color: urgentCount > 0 ? 'danger' : 'neutral' },
  ];

  // Sprint 44 M3.3 — Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await fetchTrash(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title={t('trash.page.title')}>
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <PageHero
        meta={t('trash.page.meta')}
        title={t('trash.page.title')}
        highlight={t('trash.page.title')}
        description={t('trash.page.description')}
        actions={items.length > 0 && (
          <Button variant="destructive" size="sm" leftIcon={<Icon as={AlertTriangle} size="sm" />}
            onClick={() => setShowConfirm(true)}>
            {t('trash.action.empty')}
          </Button>
        )}
      />

      {items.length > 0 && <KpiStrip items={kpiItems} />}

      {urgentCount > 0 && (
        <SmartBanner
          variant="warning"
          title={t('trash.banner.urgent', { n: urgentCount })}
          description={t('trash.banner.urgent_desc')}
        />
      )}

      {lastRestored && (
        <div role="status" aria-live="polite">
          <SmartBanner
            variant="success"
            title={t('trash.banner.restored', { name: lastRestored.name })}
            description={t('trash.banner.restored_desc')}
            action={{ label: 'Voir', onClick: () => { setLastRestored(null); } }}
            secondaryLabel="Fermer"
            onSecondaryClick={() => setLastRestored(null)}
          />
        </div>
      )}

      {/* Renforcement — error state */}
      {loadError && !isLoading && (
        <Card className="p-6" role="alert" aria-live="assertive">
          <p className="text-sm font-semibold text-[var(--danger)] mb-1">
            {t('trash.error.load_failed')}
          </p>
          <p className="text-xs text-[var(--text-muted)] mb-3 break-all">{loadError}</p>
          <Button variant="secondary" size="sm" onClick={() => { void fetchTrash(); }}>
            {t('trash.action.retry')}
          </Button>
        </Card>
      )}

      {isLoading ? (
        <Card className="p-0 overflow-hidden" aria-busy="true" aria-live="polite">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
            {[1,2,3,4,5,6].map(i => (
              <Skeleton key={i} className="h-3 w-20 rounded" />
            ))}
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="flex items-center gap-2.5 flex-1">
                  <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                  <Skeleton className="h-3.5 w-32 rounded" />
                </div>
                <Skeleton className="h-3 w-32 rounded shrink-0" />
                <Skeleton className="h-3 w-20 rounded shrink-0" />
                <Skeleton className="h-3 w-16 rounded shrink-0" />
                <Skeleton className="h-5 w-20 rounded-full shrink-0" />
                <Skeleton className="h-7 w-24 rounded shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      ) : loadError ? null : items.length === 0 ? (
        <EmptyState
          variant="first-time"
          icon={<Icon as={Trash2} size={48} />}
          title={t('trash.empty.title')}
          description={t('trash.empty.description')}
        />
      ) : (
        /* Sprint 32 vague 32-3A — table-premium + frozen col + expand inline */
        <Card className="p-0 overflow-hidden">
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="col-frozen" style={{ minWidth: 240 }}>{t('trash.table.contact')}</th>
                  <th style={{ minWidth: 200 }}>{t('trash.table.email')}</th>
                  <th style={{ minWidth: 140 }}>{t('trash.table.phone')}</th>
                  <th style={{ minWidth: 120 }}>{t('trash.table.deleted')}</th>
                  <th style={{ minWidth: 120 }}>{t('trash.table.expires')}</th>
                  <th className="text-right" style={{ minWidth: 120 }}>{t('trash.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const days = daysRemaining(item.deleted_at);
                  const urgencyVariant: 'danger' | 'warning' | 'neutral' = days <= 5 ? 'danger' : days <= 15 ? 'warning' : 'neutral';
                  const isExpanded = expandedId === item.id;
                  const deletedDateFull = new Date(item.deleted_at).toLocaleString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                  return (
                    <React.Fragment key={item.id}>
                      <tr className="row-premium list-item-enter" style={{ animationDelay: `${idx * 30}ms` }}>
                        <td className="col-frozen">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
                              onClick={() => setExpandedId(isExpanded ? null : item.id)}
                              aria-label={isExpanded ? t('trash.action.restore') : t('trash.label.deleted_lead')}
                              aria-expanded={isExpanded}
                            >
                              <ChevronRight size={14} />
                            </button>
                            <Avatar name={item.name} size="sm" />
                            <div className="min-w-0">
                              <p className="font-medium text-[var(--text-primary)] truncate">{item.name}</p>
                              <p className="text-[10px] text-[var(--text-muted)]">{t('trash.label.deleted_lead')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="text-[var(--text-secondary)] truncate max-w-[260px]">{item.email}</td>
                        <td className="text-[var(--text-secondary)]">{item.phone || '—'}</td>
                        <td className="text-[var(--text-muted)] text-xs">{timeAgo(item.deleted_at)}</td>
                        <td>
                          <Tag dot variant={urgencyVariant} size="xs">{t('trash.label.days_remaining', { n: days })}</Tag>
                        </td>
                        <td className="text-right">
                          <Button variant="secondary" size="sm" leftIcon={<Icon as={RotateCcw} size="sm" />}
                            onClick={() => handleRestore(item.id)}
                            disabled={restoringId === item.id}>
                            {restoringId === item.id ? '...' : t('trash.action.restore')}
                          </Button>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={6} style={{ padding: 0, border: 'none' }}>
                          <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                            <div className="table-expand-inner">
                              <div className="table-expand-detail">
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('trash.label.deleted_at')}</span>
                                  <span className="table-expand-detail-value text-[12px]">{deletedDateFull}</span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('trash.label.days_before_purge')}</span>
                                  <span className="table-expand-detail-value t-mono-num" style={{ color: days <= 5 ? 'var(--danger)' : days <= 15 ? 'var(--warning)' : 'var(--text-primary)' }}>{days} j</span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Email</span>
                                  <span className="table-expand-detail-value text-[12px] inline-flex items-center gap-1.5"><Mail size={11} className="text-[var(--text-muted)]" />{item.email || '—'}</span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Téléphone</span>
                                  <span className="table-expand-detail-value text-[12px] inline-flex items-center gap-1.5"><Phone size={11} className="text-[var(--text-muted)]" />{item.phone || '—'}</span>
                                </div>
                                <div className="table-expand-detail-section" style={{ flex: '1 1 100%' }}>
                                  <Button variant="secondary" size="sm" leftIcon={<Icon as={RotateCcw} size="sm" />}
                                    onClick={() => handleRestore(item.id)}
                                    disabled={restoringId === item.id}>
                                    {restoringId === item.id ? t('trash.action.restoring') : t('trash.action.restore_lead')}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal confirmation vider */}
      <Modal open={showConfirm} onOpenChange={() => setShowConfirm(false)} title={t('trash.modal.title')}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-[var(--danger)]/8 rounded-xl border border-[var(--danger)]/20">
            <AlertTriangle size={20} className="text-[var(--danger)] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-[var(--text-primary)]">{t('trash.modal.warning')}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                {t('trash.modal.warning_desc', { n: items.length })}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={isEmptying}>{t('trash.modal.cancel')}</Button>
            <Button variant="destructive" onClick={handleEmptyTrash} disabled={isEmptying} isLoading={isEmptying} aria-busy={isEmptying}>
              {isEmptying ? t('trash.action.emptying') : t('trash.modal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
      </div>
    </AppLayout>
  );
}