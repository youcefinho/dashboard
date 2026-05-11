// ── Page Workflows — Liste + Builder preview Sprint Design 2 (D2.4) ──

import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Skeleton, EmptyState } from '@/components/ui';
import { getWorkflows, toggleWorkflow, deleteWorkflow } from '@/lib/api';
import type { Workflow, TriggerType } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS } from '@/lib/types';
import { Search, Zap, Play, Trash2, Copy, Eye, Users, Activity, ArrowRight, Plus, FolderOpen, LayoutGrid, LayoutList } from 'lucide-react';

type FilterMode = 'all' | 'active' | 'inactive';
type ViewMode = 'grid' | 'list';
type FolderFilter = 'all' | 'onboarding' | 'sales' | 'reactivation' | 'custom';

const FOLDER_LABELS: Record<FolderFilter, string> = { all: 'Tous', onboarding: 'Onboarding', sales: 'Ventes', reactivation: 'Réactivation', custom: 'Personnalisé' };

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all');

  const load = useCallback(async () => {
    setIsLoading(true);
    const r = await getWorkflows();
    if (r.data) setWorkflows(r.data);
    setIsLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (id: string, active: number) => { await toggleWorkflow(id, active === 0); void load(); };
  const handleDelete = async (id: string) => { if (!confirm('Supprimer ce workflow et toutes ses données ?')) return; await deleteWorkflow(id); void load(); };

  const activeCount = workflows.filter(w => w.is_active).length;
  const totalExecs = workflows.reduce((s, w) => s + (w.total_executions ?? 0), 0);
  const totalEnrolled = workflows.reduce((s, w) => s + (w.active_enrollments ?? 0), 0);

  const filtered = workflows.filter(w => {
    if (filterMode === 'active' && !w.is_active) return false;
    if (filterMode === 'inactive' && w.is_active) return false;
    if (searchQuery) { const q = searchQuery.toLowerCase(); return w.name.toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q); }
    return true;
  });

  return (
    <AppLayout title="Automations">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium">
          <Zap size={14} className="text-[var(--warning)]" />
          <span className="text-[var(--text-secondary)]">{workflows.length} workflows</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium">
          <Play size={14} className="text-[var(--success)]" />
          <span className="text-[var(--text-secondary)]">{activeCount} actifs</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium">
          <Users size={14} className="text-[var(--info)]" />
          <span className="text-[var(--text-secondary)]">{totalEnrolled} inscrits</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium">
          <Activity size={14} className="text-[var(--brand-primary)]" />
          <span className="text-[var(--text-secondary)]">{totalExecs} exécutions</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5">
          {([['grid', LayoutGrid], ['list', LayoutList]] as const).map(([m, Icon]) => (
            <button key={m} onClick={() => setViewMode(m as ViewMode)}
              className={`p-1.5 rounded-md cursor-pointer transition-all ${viewMode === m ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
              <Icon size={15} />
            </button>
          ))}
        </div>

        <Link to="/workflows/new"><Button size="sm" leftIcon={<Plus size={14} />}>Nouveau</Button></Link>
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
                  ${folderFilter === f ? 'bg-[var(--brand-tint)] text-[var(--brand-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'}`}>
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
                className="w-full pl-9 pr-3 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none" />
            </div>
            <div className="flex gap-1">
              {(['all', 'active', 'inactive'] as const).map(m => (
                <button key={m} onClick={() => setFilterMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all
                    ${filterMode === m ? 'bg-[var(--brand-primary)] text-white' : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--brand-primary)]'}`}>
                  {m === 'all' ? 'Tous' : m === 'active' ? 'Actifs' : 'Inactifs'}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Zap size={48} />} title="Aucune automation" description="Créez votre premier workflow pour automatiser vos relances." />
          ) : viewMode === 'grid' ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map(wf => (
                <Card key={wf.id} className={`group hover:border-[var(--brand-primary)]/30 hover:shadow-md transition-all ${!wf.is_active ? 'opacity-60' : ''}`}>
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
                            <p className="text-[10px] text-[var(--text-muted)]">{wf.is_active ? '🟢 Actif' : '⏸️ Inactif'}</p>
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
                    <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-[var(--bg-subtle)] rounded-lg border-l-[3px] border-l-[var(--brand-primary)]">
                      <Zap size={11} className="text-[var(--brand-primary)]" />
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">{TRIGGER_LABELS[wf.trigger_type as TriggerType] || wf.trigger_type}</span>
                    </div>

                    {/* Steps visual */}
                    <div className="flex items-center gap-1 mb-3 overflow-hidden">
                      {Array.from({ length: Math.min(wf.steps_count ?? 0, 6) }).map((_, i) => (
                        <div key={i} className="flex items-center gap-0.5">
                          <div className="w-5 h-5 rounded-full bg-[var(--brand-tint)] text-[var(--brand-primary)] text-[9px] font-bold flex items-center justify-center">{i + 1}</div>
                          {i < Math.min((wf.steps_count ?? 0) - 1, 5) && <ArrowRight size={10} className="text-[var(--border-default)]" />}
                        </div>
                      ))}
                      {(wf.steps_count ?? 0) > 6 && <span className="text-[10px] text-[var(--text-muted)]">+{(wf.steps_count ?? 0) - 6}</span>}
                      {(wf.steps_count ?? 0) === 0 && <span className="text-[10px] text-[var(--text-muted)] italic">Aucune étape</span>}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-1.5 mb-3">
                      {[
                        { v: wf.steps_count ?? 0, l: 'Étapes', c: 'var(--brand-primary)' },
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
                        <Button variant="secondary" size="sm" className="w-full" leftIcon={<Eye size={13} />}>Détails</Button>
                      </Link>
                      <button className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--brand-primary)] hover:border-[var(--brand-primary)] cursor-pointer transition-all" title="Dupliquer">
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
            /* Vue list */
            <Card className="overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Workflow</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Déclencheur</th>
                    <th className="text-center px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Étapes</th>
                    <th className="text-center px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Inscrits</th>
                    <th className="text-center px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Exécutions</th>
                    <th className="text-center px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(wf => (
                    <tr key={wf.id} className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] transition-colors ${!wf.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{TRIGGER_ICONS[wf.trigger_type as TriggerType] || '⚡'}</span>
                          <div><p className="font-medium text-[13px]">{wf.name}</p>{wf.description && <p className="text-[10px] text-[var(--text-muted)] truncate max-w-[200px]">{wf.description}</p>}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{TRIGGER_LABELS[wf.trigger_type as TriggerType] || wf.trigger_type}</td>
                      <td className="px-4 py-3 text-center text-xs font-semibold">{wf.steps_count ?? 0}</td>
                      <td className="px-4 py-3 text-center text-xs font-semibold text-[var(--success)]">{wf.active_enrollments ?? 0}</td>
                      <td className="px-4 py-3 text-center text-xs font-semibold text-[var(--info)]">{wf.total_executions ?? 0}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => void handleToggle(wf.id, wf.is_active)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${wf.is_active ? 'bg-[var(--success)]' : 'bg-[var(--bg-muted)]'}`}>
                          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm ${wf.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <Link to={`/workflows/${wf.id}`} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-primary)] hover:bg-[var(--bg-subtle)] transition-all"><Eye size={14} /></Link>
                          <button onClick={() => void handleDelete(wf.id)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-all"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
