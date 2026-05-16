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

interface TrashItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  client_id: string;
  deleted_at: string;
}

export function TrashPage() {
  const { success: toastSuccess } = useToast();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [lastRestored, setLastRestored] = useState<TrashItem | null>(null);
  // Sprint 32 vague 32-3A — Expand inline (deleted_at + days_remaining_purge + restore action)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchTrash = async () => {
    setIsLoading(true);
    try {
      const res = await getTrash();
      if (res.data) setItems(res.data as unknown as TrashItem[]);
    } catch (err) {
      console.error(err);
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
          toastSuccess(`${item.name} restauré`);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRestoringId(null);
    }
  };

  const handleEmptyTrash = async () => {
    try {
      await emptyTrash();
      setShowConfirm(false);
      void fetchTrash();
    } catch (err) {
      console.error(err);
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
    { label: 'Items', value: items.length, icon: <Trash2 size={11} />, color: 'brand' },
    { label: 'Restaurables', value: items.length, icon: <RotateCcw size={11} />, color: 'success' },
    { label: 'Auto-purge prochaine', value: items.length > 0 ? `${soonestDays}j` : '—', icon: <Calendar size={11} />, color: urgentCount > 0 ? 'danger' : 'warning' },
    { label: 'Urgents (≤7j)', value: urgentCount, icon: <FileX size={11} />, color: urgentCount > 0 ? 'danger' : 'neutral' },
  ];

  // Sprint 44 M3.3 — Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await fetchTrash(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title="Corbeille">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <PageHero
        meta="Système"
        title="Corbeille"
        highlight="Corbeille"
        description="Les leads supprimés sont conservés 30 jours avant d'être définitivement effacés."
        actions={items.length > 0 && (
          <Button variant="destructive" size="sm" leftIcon={<Icon as={AlertTriangle} size="sm" />}
            onClick={() => setShowConfirm(true)}>
            Vider la corbeille
          </Button>
        )}
      />

      {items.length > 0 && <KpiStrip items={kpiItems} />}

      {urgentCount > 0 && (
        <SmartBanner
          variant="warning"
          title={`${urgentCount} lead${urgentCount > 1 ? 's' : ''} sera purgé${urgentCount > 1 ? 's' : ''} dans ≤ 7 jours`}
          description="Restaure ce qui vaut la peine avant qu'il soit perdu définitivement."
        />
      )}

      {lastRestored && (
        <SmartBanner
          variant="success"
          title={`${lastRestored.name} restauré`}
          description="Le lead est revenu dans ta liste active."
          action={{ label: 'Voir', onClick: () => { setLastRestored(null); } }}
          secondaryLabel="Fermer"
          onSecondaryClick={() => setLastRestored(null)}
        />
      )}

      {isLoading ? (
        <Card className="p-0 overflow-hidden">
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
      ) : items.length === 0 ? (
        <EmptyState
          variant="first-time"
          icon={<Icon as={Trash2} size={48} />}
          title="Corbeille vide"
          description="Aucun élément supprimé récemment. Les leads supprimés apparaîtront ici pendant 30 jours."
        />
      ) : (
        /* Sprint 32 vague 32-3A — table-premium + frozen col + expand inline */
        <Card className="p-0 overflow-hidden">
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="col-frozen" style={{ minWidth: 240 }}>Contact</th>
                  <th style={{ minWidth: 200 }}>Email</th>
                  <th style={{ minWidth: 140 }}>Téléphone</th>
                  <th style={{ minWidth: 120 }}>Supprimé</th>
                  <th style={{ minWidth: 120 }}>Expire dans</th>
                  <th className="text-right" style={{ minWidth: 120 }}>Actions</th>
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
                              aria-label={isExpanded ? 'Réduire' : 'Afficher les détails'}
                              aria-expanded={isExpanded}
                            >
                              <ChevronRight size={14} />
                            </button>
                            <Avatar name={item.name} size="sm" />
                            <div className="min-w-0">
                              <p className="font-medium text-[var(--text-primary)] truncate">{item.name}</p>
                              <p className="text-[10px] text-[var(--text-muted)]">Lead supprimé</p>
                            </div>
                          </div>
                        </td>
                        <td className="text-[var(--text-secondary)] truncate max-w-[260px]">{item.email}</td>
                        <td className="text-[var(--text-secondary)]">{item.phone || '—'}</td>
                        <td className="text-[var(--text-muted)] text-xs">{timeAgo(item.deleted_at)}</td>
                        <td>
                          <Tag dot variant={urgencyVariant} size="xs">{days}j restants</Tag>
                        </td>
                        <td className="text-right">
                          <Button variant="secondary" size="sm" leftIcon={<Icon as={RotateCcw} size="sm" />}
                            onClick={() => handleRestore(item.id)}
                            disabled={restoringId === item.id}>
                            {restoringId === item.id ? '...' : 'Restaurer'}
                          </Button>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={6} style={{ padding: 0, border: 'none' }}>
                          <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                            <div className="table-expand-inner">
                              <div className="table-expand-detail">
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Supprimé le</span>
                                  <span className="table-expand-detail-value text-[12px]">{deletedDateFull}</span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Jours avant purge auto</span>
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
                                    {restoringId === item.id ? 'Restauration…' : 'Restaurer ce lead'}
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
      <Modal open={showConfirm} onOpenChange={() => setShowConfirm(false)} title="Vider la corbeille ?">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-[var(--danger)]/8 rounded-xl border border-[var(--danger)]/20">
            <AlertTriangle size={20} className="text-[var(--danger)] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-[var(--text-primary)]">Action irréversible</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Cette action supprimera définitivement <strong>{items.length} lead(s)</strong> et toutes leurs données associées. Cette action ne peut pas être annulée.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowConfirm(false)}>Annuler</Button>
            <Button variant="destructive" onClick={handleEmptyTrash}>Supprimer définitivement</Button>
          </div>
        </div>
      </Modal>
      </div>
    </AppLayout>
  );
}