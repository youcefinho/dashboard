// ── Page Workflows — Liste + Builder preview Sprint Design 2 (D2.4) ──

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Skeleton, EmptyState, useConfirm, PageHero, KpiStrip, Icon as UIcon, type KpiItem, Tag } from '@/components/ui';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { getWorkflows, toggleWorkflow, deleteWorkflow } from '@/lib/api';
import type { Workflow, TriggerType } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS } from '@/lib/types';
import { Search, Zap, Play, Trash2, Copy, Eye, Users, Activity, ArrowRight, Plus, FolderOpen, LayoutGrid, LayoutList, ChevronRight } from 'lucide-react';

type FilterMode = 'all' | 'active' | 'inactive';
type ViewMode = 'grid' | 'list';
type FolderFilter = 'all' | 'onboarding' | 'sales' | 'reactivation' | 'custom';

const FOLDER_LABELS: Record<FolderFilter, string> = { all: 'Tous', onboarding: 'Onboarding', sales: 'Ventes', reactivation: 'Réactivation', custom: 'Personnalisé' };

export function WorkflowsPage() {
  const confirm = useConfirm();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all');
  // Sprint 32 vague 32-3A — Expand inline (trigger + actions count + last_run_at)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const r = await getWorkflows(folderFilter === 'all' ? undefined : folderFilter);
    if (r.data) setWorkflows(r.data);
    setIsLoading(false);
  }, [folderFilter]);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (id: string, active: number) => { await toggleWorkflow(id, active === 0); void load(); };
  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Supprimer ce workflow ?',
      description: 'Toutes les inscriptions actives et l\'historique d\'exécution seront effacés. Les leads concernés ne recevront plus les actions de ce workflow.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    await deleteWorkflow(id);
    void load();
  };

  const activeCount = workflows.filter(w => w.is_active).length;
  const inactiveCount = workflows.length - activeCount;
  const totalExecs = workflows.reduce((s, w) => s + (w.total_executions ?? 0), 0);
  const totalEnrolled = workflows.reduce((s, w) => s + (w.active_enrollments ?? 0), 0);

  // KPI strip — Sprint 23 wave 27
  const kpiItems: KpiItem[] = [
    { label: 'Workflows', value: workflows.length, icon: <Zap size={11} />, color: 'brand' },
    { label: 'Actifs', value: activeCount, icon: <Play size={11} />, color: 'success' },
    { label: 'Pausés', value: inactiveCount, icon: <Activity size={11} />, color: 'warning' },
    { label: 'Exécutions', value: totalExecs, icon: <Users size={11} />, color: 'info' },
  ];

  const filtered = workflows.filter(w => {
    if (filterMode === 'active' && !w.is_active) return false;
    if (filterMode === 'inactive' && w.is_active) return false;
    if (searchQuery) { const q = searchQuery.toLowerCase(); return w.name.toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q); }
    return true;
  });

  // Sprint 44 M3.3 — Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await load(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title="Automations">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <PageHero
        meta="Marketing"
        title="Automations"
        highlight="Automations"
        description="Vos workflows AI : relances automatiques, scoring, attribution, nurturing."
      />

      <KpiStrip items={kpiItems} />

      {/* ── Header secondaire — view switch + nouveau ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="text-[11px] text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text-secondary)]">{totalEnrolled}</span> inscrits actifs au total
        </div>

        <div className="flex-1" />

        <div className="segmented-control segmented-control--icon">
          {([['grid', LayoutGrid], ['list', LayoutList]] as const).map(([m, Icon]) => (
            <button key={m} onClick={() => setViewMode(m as ViewMode)} className={viewMode === m ? 'is-active' : ''} aria-label={m === 'grid' ? 'Vue grille' : 'Vue liste'}>
              <Icon size={15} />
            </button>
          ))}
        </div>

        <Link to="/workflows/new"><Button size="sm" leftIcon={<UIcon as={Plus} size="sm" />}>Nouveau</Button></Link>
      </div>

      {/* ── Sidebar folders + content ── */}
      <div className="flex gap-4">
        {/* Left sidebar folders */}
        <div className="w-48 flex-shrink-0 hidden lg:block">
          <h3 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2 px-2">Dossiers</h3>
          <div className="space-y-0.5">
            {(Object.keys(FOLDER_LABELS) as FolderFilter[]).map(f => (
              <button key={f} onClick={() => setFolderFilter(f)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-2
                  ${folderFilter === f ? 'bg-[var(--brand-tint)] text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'}`}>
                <FolderOpen size={14} /> {FOLDER_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1">
          {/* Search + filter bar */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Rechercher un workflow..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none" />
            </div>
            <div className="flex gap-1">
              {(['all', 'active', 'inactive'] as const).map(m => (
                <button key={m} onClick={() => setFilterMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all
                    ${filterMode === m ? 'bg-[var(--primary)] text-white' : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--primary)]'}`}>
                  {m === 'all' ? 'Tous' : m === 'active' ? 'Actifs' : 'Inactifs'}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-1">
                      <Skeleton className="h-8 w-8 rounded-lg" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-20 rounded-full" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-12 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-full mb-2" />
                  <Skeleton className="h-3 w-2/3 mb-4" />
                  <div className="flex gap-2 pt-3 border-t border-[var(--border-subtle)]">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20 ml-auto" />
                  </div>
                </Card>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            workflows.length > 0 ? (
              <EmptyState
                variant="filtered"
                icon={<Zap size={48} />}
                title="Aucun résultat"
                description="Aucun workflow ne correspond à tes filtres."
                action={<Button variant="secondary" onClick={() => { setSearchQuery(''); setFilterMode('all'); setFolderFilter('all'); }}>Effacer les filtres</Button>}
              />
            ) : (
              <EmptyState
                variant="first-time"
                icon={<Zap size={48} />}
                title="Aucune automation encore"
                description="Crée ton premier workflow pour automatiser tes relances et gagner du temps."
              />
            )
          ) : viewMode === 'grid' ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((wf, idx) => (
                <Card key={wf.id} className={`group hover:border-[var(--primary)]/30 hover:shadow-md transition-all list-item-enter ${!wf.is_active ? 'opacity-60' : ''}`} style={{ animationDelay: `${idx * 30}ms` }}>
                  <div className="p-5">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: wf.is_active ? 'var(--success-soft)' : 'var(--bg-subtle)' }}>
                            {TRIGGER_ICONS[wf.trigger_type as TriggerType] || '⚡'}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-[13px] text-[var(--text-primary)] truncate">{wf.name}</h3>
                            <div className="mt-0.5">
                              <Tag dot variant={wf.is_active ? 'success' : 'neutral'} size="xs">
                                {wf.is_active ? 'Actif' : 'Inactif'}
                              </Tag>
                            </div>
                          </div>
                        </div>
                        {wf.description && <p className="text-[11px] text-[var(--text-muted)] line-clamp-2 mt-1">{wf.description}</p>}
                      </div>
                      <button onClick={() => void handleToggle(wf.id, wf.is_active)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-3 ${wf.is_active ? 'bg-[var(--success)]' : 'bg-[var(--bg-muted)]'}`}>
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm ${wf.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                      </button>
                    </div>

                    {/* Trigger pill */}
                    <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-[var(--bg-subtle)] rounded-lg border-l-[3px] border-l-[var(--primary)]">
                      <Zap size={11} className="text-[var(--primary)]" />
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">{TRIGGER_LABELS[wf.trigger_type as TriggerType] || wf.trigger_type}</span>
                    </div>

                    {/* Steps visual */}
                    <div className="flex items-center gap-1 mb-3 overflow-hidden">
                      {Array.from({ length: Math.min(wf.steps_count ?? 0, 6) }).map((_, i) => (
                        <div key={i} className="flex items-center gap-0.5">
                          <div className="w-5 h-5 rounded-full bg-[var(--brand-tint)] text-[var(--primary)] text-[9px] font-bold flex items-center justify-center">{i + 1}</div>
                          {i < Math.min((wf.steps_count ?? 0) - 1, 5) && <ArrowRight size={10} className="text-[var(--border-default)]" />}
                        </div>
                      ))}
                      {(wf.steps_count ?? 0) > 6 && <span className="text-[10px] text-[var(--text-muted)]">+{(wf.steps_count ?? 0) - 6}</span>}
                      {(wf.steps_count ?? 0) === 0 && <span className="text-[10px] text-[var(--text-muted)] italic">Aucune étape</span>}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-1.5 mb-3">
                      {[
                        { v: wf.steps_count ?? 0, l: 'Étapes', c: 'var(--primary)' },
                        { v: wf.active_enrollments ?? 0, l: 'Inscrits', c: 'var(--success)' },
                        { v: wf.total_executions ?? 0, l: 'Exécutions', c: 'var(--info)' },
                      ].map(s => (
                        <div key={s.l} className="text-center bg-[var(--bg-subtle)] rounded-lg px-2 py-1.5">
                          <p className="text-sm font-bold" style={{ color: s.c }}>{s.v}</p>
                          <p className="text-[9px] text-[var(--text-muted)]">{s.l}</p>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                      <Link to={`/workflows/${wf.id}`} className="flex-1">
                        <Button variant="secondary" size="sm" className="w-full" leftIcon={<UIcon as={Eye} size="xs" />}>Détails</Button>
                      </Link>
                      <button className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)] cursor-pointer transition-all" title="Dupliquer">
                        <Copy size={13} />
                      </button>
                      <button onClick={() => void handleDelete(wf.id)}
                        className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] cursor-pointer transition-all" title="Supprimer">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            /* Vue list — Sprint 32 vague 32-3A : table-premium + frozen col + expand inline */
            <Card className="p-0 overflow-hidden">
              <div className="table-premium-container overflow-x-auto">
                <table className="table-premium w-full text-left border-collapse">
                  <thead>
                    <tr>
                      <th className="col-frozen" style={{ minWidth: 240 }}>Workflow</th>
                      <th style={{ minWidth: 160 }}>Déclencheur</th>
                      <th className="text-center" style={{ minWidth: 80 }}>Étapes</th>
                      <th className="text-center" style={{ minWidth: 90 }}>Inscrits</th>
                      <th className="text-center" style={{ minWidth: 100 }}>Exécutions</th>
                      <th className="text-center" style={{ minWidth: 80 }}>Statut</th>
                      <th className="text-right" style={{ minWidth: 90 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((wf, idx) => {
                      const isExpanded = expandedId === wf.id;
                      const lastRunRaw = (wf as unknown as { last_run_at?: string }).last_run_at;
                      const lastRunLabel = lastRunRaw ? new Date(lastRunRaw).toLocaleString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Jamais exécuté';
                      const actionsCount = (wf as unknown as { actions_count?: number }).actions_count ?? wf.steps_count ?? 0;
                      return (
                        <React.Fragment key={wf.id}>
                          <tr className={`row-premium list-item-enter ${!wf.is_active ? 'opacity-50' : ''}`} style={{ animationDelay: `${idx * 30}ms` }}>
                            <td className="col-frozen">
                              <div className="flex items-center gap-2.5">
                                <button
                                  type="button"
                                  className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
                                  onClick={() => setExpandedId(isExpanded ? null : wf.id)}
                                  aria-label={isExpanded ? 'Réduire' : 'Afficher les détails'}
                                  aria-expanded={isExpanded}
                                >
                                  <ChevronRight size={14} />
                                </button>
                                <span className="text-base leading-none">{TRIGGER_ICONS[wf.trigger_type as TriggerType] || '⚡'}</span>
                                <div className="min-w-0">
                                  <p className="font-medium text-[13px] text-[var(--text-primary)] truncate">{wf.name}</p>
                                  <Tag dot variant={wf.is_active ? 'success' : 'neutral'} size="xs">{wf.is_active ? 'Actif' : 'Inactif'}</Tag>
                                </div>
                              </div>
                            </td>
                            <td className="text-xs text-[var(--text-secondary)]">{TRIGGER_LABELS[wf.trigger_type as TriggerType] || wf.trigger_type}</td>
                            <td className="text-center text-xs font-semibold">{wf.steps_count ?? 0}</td>
                            <td className="text-center text-xs font-semibold text-[var(--success)]">{wf.active_enrollments ?? 0}</td>
                            <td className="text-center text-xs font-semibold text-[var(--info)]">{wf.total_executions ?? 0}</td>
                            <td className="text-center">
                              <button onClick={() => void handleToggle(wf.id, wf.is_active)}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${wf.is_active ? 'bg-[var(--success)]' : 'bg-[var(--bg-muted)]'}`}
                                aria-label={wf.is_active ? 'Désactiver le workflow' : 'Activer le workflow'}>
                                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm ${wf.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                              </button>
                            </td>
                            <td className="text-right">
                              <div className="flex gap-1 justify-end">
                                <Link to={`/workflows/${wf.id}`} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-all" aria-label="Voir détails"><UIcon as={Eye} size="sm" /></Link>
                                <button onClick={() => void handleDelete(wf.id)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-all" aria-label="Supprimer"><UIcon as={Trash2} size="sm" /></button>
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={7} style={{ padding: 0, border: 'none' }}>
                              <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                                <div className="table-expand-inner">
                                  <div className="table-expand-detail">
                                    <div className="table-expand-detail-section" style={{ flex: '1 1 240px' }}>
                                      <span className="table-expand-detail-label">Déclencheur</span>
                                      <span className="table-expand-detail-value text-[12px]">{TRIGGER_LABELS[wf.trigger_type as TriggerType] || wf.trigger_type}</span>
                                    </div>
                                    <div className="table-expand-detail-section">
                                      <span className="table-expand-detail-label">Actions</span>
                                      <span className="table-expand-detail-value t-mono-num">{actionsCount}</span>
                                    </div>
                                    <div className="table-expand-detail-section">
                                      <span className="table-expand-detail-label">Dernière exécution</span>
                                      <span className="table-expand-detail-value text-[12px]">{lastRunLabel}</span>
                                    </div>
                                    {wf.description && (
                                      <div className="table-expand-detail-section" style={{ flex: '1 1 320px' }}>
                                        <span className="table-expand-detail-label">Description</span>
                                        <span className="table-expand-detail-value text-[12px] text-[var(--text-secondary)] leading-relaxed">{wf.description}</span>
                                      </div>
                                    )}
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
        </div>
      </div>
      </div>
    </AppLayout>
  );
}
