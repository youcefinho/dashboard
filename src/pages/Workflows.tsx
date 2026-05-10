// ── WorkflowsPage — Liste enrichie des automations ─────────

import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState } from '@/components/ui';
import { getWorkflows, toggleWorkflow, deleteWorkflow } from '@/lib/api';
import type { Workflow, TriggerType } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS } from '@/lib/types';

type FilterMode = 'all' | 'active' | 'inactive';

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    const result = await getWorkflows();
    if (result.data) setWorkflows(result.data);
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadWorkflows(); }, [loadWorkflows]);

  const handleToggle = async (id: string, currentActive: number) => {
    await toggleWorkflow(id, currentActive === 0);
    void loadWorkflows();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce workflow et toutes ses données ?')) return;
    await deleteWorkflow(id);
    void loadWorkflows();
  };

  const activeCount = workflows.filter(w => w.is_active).length;
  const totalExecs = workflows.reduce((s, w) => s + (w.total_executions ?? 0), 0);
  const totalEnrolled = workflows.reduce((s, w) => s + (w.active_enrollments ?? 0), 0);

  const filteredWorkflows = workflows.filter(w => {
    if (filterMode === 'active') return w.is_active;
    if (filterMode === 'inactive') return !w.is_active;
    return true;
  });

  return (
    <AppLayout title="Automations">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">⚡ Automations</h1>
          <Badge color="var(--color-success)">{activeCount} actifs</Badge>
          <Badge>{workflows.length} total</Badge>
        </div>
        <Link to="/workflows/new"><Button>+ Nouveau workflow</Button></Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-accent)]">{workflows.length}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Workflows</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-success)]">{activeCount}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Actifs</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-info)]">{totalEnrolled}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Leads inscrits</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-warning)]">{totalExecs}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Exécutions</p>
        </Card>
      </div>

      {/* Filtres */}
      <div className="flex gap-2 mb-6">
        {(['all', 'active', 'inactive'] as const).map(mode => (
          <button key={mode} onClick={() => setFilterMode(mode)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-all ${filterMode === mode ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)]'}`}>
            {mode === 'all' ? `Tous (${workflows.length})` : mode === 'active' ? `✅ Actifs (${activeCount})` : `⏸️ Inactifs (${workflows.length - activeCount})`}
          </button>
        ))}
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : filteredWorkflows.length === 0 ? (
        <EmptyState icon="⚡" title="Aucune automation" description="Créez votre premier workflow pour automatiser vos relances." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredWorkflows.map((wf) => {
            const successRate = (wf.total_executions ?? 0) > 0 ? Math.round(((wf.total_executions ?? 0) / Math.max(wf.total_executions ?? 1, 1)) * 100) : 0;
            return (
              <Card key={wf.id} className={`hover:border-[var(--color-accent)]/30 transition-all ${!wf.is_active ? 'opacity-60' : ''}`}>
                <div className="p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{TRIGGER_ICONS[wf.trigger_type as TriggerType] || '⚡'}</span>
                        <h3 className="font-semibold text-sm truncate">{wf.name}</h3>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] line-clamp-2">{wf.description}</p>
                    </div>
                    <button onClick={() => void handleToggle(wf.id, wf.is_active)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-3 ${wf.is_active ? 'bg-[var(--color-success)]' : 'bg-[var(--color-bg-hover)]'}`}>
                      <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform shadow-sm ${wf.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  {/* Trigger enrichi */}
                  <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-[var(--color-bg-tertiary)] rounded-[var(--radius-md)] border-l-2 border-l-[var(--color-accent)]">
                    <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                      Quand : {TRIGGER_LABELS[wf.trigger_type as TriggerType] || wf.trigger_type}
                    </span>
                  </div>

                  {/* Étapes visuelles */}
                  <div className="flex items-center gap-1 mb-3">
                    {Array.from({ length: wf.steps_count ?? 0 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <div className="w-5 h-5 rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)] text-[9px] font-bold flex items-center justify-center">
                          {i + 1}
                        </div>
                        {i < (wf.steps_count ?? 0) - 1 && <div className="w-3 h-px bg-[var(--color-border-subtle)]" />}
                      </div>
                    ))}
                    {(wf.steps_count ?? 0) === 0 && <span className="text-[10px] text-[var(--color-text-muted)]">Aucune étape</span>}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div className="bg-[var(--color-bg-hover)] rounded-[var(--radius-sm)] px-2 py-1.5">
                      <p className="text-lg font-bold text-[var(--color-accent)]">{wf.steps_count ?? 0}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">Étapes</p>
                    </div>
                    <div className="bg-[var(--color-bg-hover)] rounded-[var(--radius-sm)] px-2 py-1.5">
                      <p className="text-lg font-bold text-[var(--color-success)]">{wf.active_enrollments ?? 0}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">Inscrits</p>
                    </div>
                    <div className="bg-[var(--color-bg-hover)] rounded-[var(--radius-sm)] px-2 py-1.5">
                      <p className="text-lg font-bold text-[var(--color-info)]">{wf.total_executions ?? 0}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">Exécutions</p>
                    </div>
                  </div>

                  {/* Barre de progression */}
                  {(wf.total_executions ?? 0) > 0 && (
                    <div className="mb-3">
                      <div className="h-1.5 rounded-full bg-[var(--color-bg-hover)] overflow-hidden">
                        <div className="h-full rounded-full bg-[var(--color-success)] transition-all" style={{ width: `${successRate}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Link to={`/workflows/${wf.id}`} className="flex-1">
                      <Button variant="secondary" size="sm" className="w-full">👁️ Détails</Button>
                    </Link>
                    <button onClick={() => void handleDelete(wf.id)}
                      className="px-3 py-1.5 text-xs text-[var(--color-danger)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--color-danger)]/10 transition-colors cursor-pointer">
                      🗑️
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
