// ── WorkflowDetail — Vue détaillée d'un workflow avec steps ─

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState } from '@/components/ui';
import { getWorkflow, toggleWorkflow } from '@/lib/api';
import type { Workflow, WorkflowStep, WorkflowEnrollment, TriggerType, StepType, EnrollmentStatus } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS, STEP_TYPE_LABELS, STEP_TYPE_ICONS, ENROLLMENT_STATUS_LABELS } from '@/lib/types';

type WorkflowWithDetails = Workflow & { steps: WorkflowStep[]; enrollments: WorkflowEnrollment[] };

export function WorkflowDetailPage() {
  const { workflowId } = useParams({ strict: false }) as { workflowId: string };
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<WorkflowWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadWorkflow = useCallback(async () => {
    setIsLoading(true);
    const result = await getWorkflow(workflowId);
    if (result.data) {
      setWorkflow(result.data);
    }
    setIsLoading(false);
  }, [workflowId]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  const handleToggle = async () => {
    if (!workflow) return;
    await toggleWorkflow(workflow.id, workflow.is_active === 0);
    void loadWorkflow();
  };

  const formatDelay = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
    return `${Math.round(minutes / 1440)} jour${minutes >= 2880 ? 's' : ''}`;
  };

  const parseConfig = (configStr: string): Record<string, unknown> => {
    try { return JSON.parse(configStr) as Record<string, unknown>; }
    catch { return {}; }
  };

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr + 'Z').getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'à l\'instant';
    if (diffMin < 60) return `il y a ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `il y a ${diffH}h`;
    return `il y a ${Math.floor(diffH / 24)}j`;
  };

  if (isLoading) {
    return (
      <AppLayout title="Workflow">
        <div className="max-w-4xl space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      </AppLayout>
    );
  }

  if (!workflow) {
    return (
      <AppLayout title="Workflow introuvable">
        <EmptyState title="Workflow introuvable" description="Ce workflow n'existe pas."
          action={<Button onClick={() => void navigate({ to: '/workflows' })}>Retour</Button>} />
      </AppLayout>
    );
  }

  const steps = workflow.steps || [];
  const enrollments = workflow.enrollments || [];

  return (
    <AppLayout title={workflow.name}>
      <button onClick={() => void navigate({ to: '/workflows' })}
        className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-accent)] mb-4 flex items-center gap-1 cursor-pointer">
        ← Retour aux automations
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-5xl">
        {/* Colonne principale — Steps visuels */}
        <div className="lg:col-span-2 space-y-4">
          {/* En-tête */}
          <Card className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold">{workflow.name}</h2>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">{workflow.description}</p>
              </div>
              <button
                onClick={() => void handleToggle()}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors cursor-pointer ${
                  workflow.is_active ? 'bg-[var(--color-success)]' : 'bg-[var(--color-bg-hover)]'
                }`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform shadow-sm ${
                  workflow.is_active ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-tertiary)] rounded-[var(--radius-md)]">
              <span className="text-lg">{TRIGGER_ICONS[workflow.trigger_type as TriggerType] || '⚡'}</span>
              <span className="text-sm font-medium">
                Déclencheur : <strong>{TRIGGER_LABELS[workflow.trigger_type as TriggerType]}</strong>
              </span>
              {workflow.trigger_config && workflow.trigger_config !== '{}' && (
                <span className="text-xs text-[var(--color-text-muted)] ml-2">
                  ({workflow.trigger_config})
                </span>
              )}
            </div>
          </Card>

          {/* ── Flowchart des steps ──────────────────────── */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">🔗 Séquence d'étapes ({steps.length})</h3>
            {steps.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Aucune étape configurée.</p>
            ) : (
              <div className="space-y-0">
                {steps.sort((a, b) => a.step_order - b.step_order).map((step, i) => {
                  const config = parseConfig(step.config);
                  const isLast = i === steps.length - 1;

                  return (
                    <div key={step.id}>
                      {/* Step card */}
                      <div className="flex items-start gap-3">
                        {/* Numéro + ligne */}
                        <div className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                            step.step_type === 'wait' 
                              ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]' 
                              : step.step_type === 'condition'
                                ? 'bg-[var(--color-info)]/15 text-[var(--color-info)]'
                                : 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                          }`}>
                            {STEP_TYPE_ICONS[step.step_type as StepType] || '•'}
                          </div>
                          {!isLast && (
                            <div className="w-0.5 h-8 bg-[var(--color-border-subtle)]" />
                          )}
                        </div>

                        {/* Contenu */}
                        <div className="flex-1 pb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--color-text-muted)]">#{step.step_order}</span>
                            <span className="text-sm font-medium">{STEP_TYPE_LABELS[step.step_type as StepType]}</span>
                          </div>
                          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                            {step.step_type === 'wait' && `⏳ Attendre ${formatDelay(Number(config.delay_minutes || 0))}`}
                            {step.step_type === 'send_email' && `📧 Template : ${String(config.template_id || '')}`}
                            {step.step_type === 'send_sms' && `💬 « ${String(config.message || '').slice(0, 60)}... »`}
                            {step.step_type === 'add_tag' && `🏷️ Tag : ${String(config.tag || '')}`}
                            {step.step_type === 'remove_tag' && `🏷️ Retirer : ${String(config.tag || '')}`}
                            {step.step_type === 'change_status' && `🔄 → ${String(config.status || '')}`}
                            {step.step_type === 'notify' && `🔔 « ${String(config.message || '').slice(0, 80)}... »`}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Colonne latérale */}
        <div className="space-y-4">
          {/* Stats */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Statistiques</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">Statut</span>
                <Badge color={workflow.is_active ? 'var(--color-success)' : 'var(--color-muted)'}>
                  {workflow.is_active ? 'Actif' : 'Inactif'}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">Étapes</span>
                <span className="font-medium">{steps.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">Leads inscrits</span>
                <span className="font-medium">{enrollments.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">Actifs</span>
                <span className="font-medium text-[var(--color-success)]">
                  {enrollments.filter(e => e.status === 'active').length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">Terminés</span>
                <span className="font-medium">
                  {enrollments.filter(e => e.status === 'completed').length}
                </span>
              </div>
            </div>
          </Card>

          {/* Enrollments récents */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
              Leads inscrits ({enrollments.length})
            </h3>
            {enrollments.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">Aucun lead inscrit dans ce workflow.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {enrollments.slice(0, 20).map((enr) => (
                  <div key={enr.id} className="flex items-center justify-between text-xs p-2 bg-[var(--color-bg-hover)] rounded-[var(--radius-sm)]">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{enr.lead_name || enr.lead_id.slice(0, 8)}</p>
                      <p className="text-[var(--color-text-muted)]">{timeAgo(enr.enrolled_at)}</p>
                    </div>
                    <Badge color={
                      enr.status === 'active' ? 'var(--color-success)' : 
                      enr.status === 'completed' ? 'var(--color-info)' :
                      enr.status === 'cancelled' ? 'var(--color-danger)' : 'var(--color-muted)'
                    }>
                      {ENROLLMENT_STATUS_LABELS[enr.status as EnrollmentStatus]}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Infos */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Infos</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Créé le</span>
                <span>{new Date(workflow.created_at).toLocaleDateString('fr-CA')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Scope</span>
                <span>{workflow.client_id ? 'Client spécifique' : 'Global (tous)'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">ID</span>
                <span className="font-mono truncate ml-2">{workflow.id.slice(0, 12)}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
