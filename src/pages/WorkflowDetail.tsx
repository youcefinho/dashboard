// ── WorkflowDetail — Vue détaillée d'un workflow avec steps ─

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState } from '@/components/ui';
import { getWorkflow, toggleWorkflow } from '@/lib/api';
import type { Workflow, WorkflowStep, WorkflowEnrollment, TriggerType, StepType, EnrollmentStatus } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS, STEP_TYPE_LABELS, STEP_TYPE_ICONS, ENROLLMENT_STATUS_LABELS } from '@/lib/types';
import { Activity, Settings, Users, GitMerge } from 'lucide-react';

type WorkflowWithDetails = Workflow & { steps: WorkflowStep[]; enrollments: WorkflowEnrollment[] };
type TabType = 'sequence' | 'config' | 'enrollments' | 'analytics';

export function WorkflowDetailPage() {
  const { workflowId } = useParams({ strict: false }) as { workflowId: string };
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<WorkflowWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('sequence');

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
        className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-primary)] mb-4 flex items-center gap-1 cursor-pointer">
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
                <p className="text-sm text-[var(--text-muted)] mt-1">{workflow.description}</p>
              </div>
              <button
                onClick={() => void handleToggle()}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors cursor-pointer ${
                  workflow.is_active ? 'bg-[var(--success)]' : 'bg-[var(--bg-subtle)]'
                }`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform shadow-sm ${
                  workflow.is_active ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
              <span className="text-lg">{TRIGGER_ICONS[workflow.trigger_type as TriggerType] || '⚡'}</span>
              <span className="text-sm font-medium">
                Déclencheur : <strong>{TRIGGER_LABELS[workflow.trigger_type as TriggerType]}</strong>
              </span>
              {workflow.trigger_config && workflow.trigger_config !== '{}' && (
                <span className="text-xs text-[var(--text-muted)] ml-2">
                  ({workflow.trigger_config})
                </span>
              )}
            </div>
          </Card>

          {/* ── Tabs Navigation ── */}
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] overflow-x-auto hide-scrollbar pb-px">
            {[
              { id: 'sequence', label: 'Séquence', icon: GitMerge },
              { id: 'config', label: 'Configuration', icon: Settings },
              { id: 'enrollments', label: 'Inscrits', icon: Users },
              { id: 'analytics', label: 'Analytique', icon: Activity },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id as TabType)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${activeTab === t.id 
                    ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]' 
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-subtle)]'
                  }`}>
                <t.icon size={15} /> {t.label}
              </button>
            ))}
          </div>

          {/* ── Tab Content ── */}
          {activeTab === 'sequence' && (
            <Card className="p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold">Séquence ({steps.length} étapes)</h3>
                <Link to={`/workflows/${workflow.id}/edit`}>
                  <Button size="sm" variant="secondary">Éditer le workflow</Button>
                </Link>
              </div>
            {steps.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Aucune étape configurée.</p>
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
                              ? 'bg-[var(--warning)]/15 text-[var(--warning)]' 
                              : step.step_type === 'condition'
                                ? 'bg-[var(--info)]/15 text-[var(--info)]'
                                : 'bg-[var(--brand-primary)]/15 text-[var(--brand-primary)]'
                          }`}>
                            {STEP_TYPE_ICONS[step.step_type as StepType] || '•'}
                          </div>
                          {!isLast && (
                            <div className="w-0.5 h-8 bg-[var(--border-subtle)]" />
                          )}
                        </div>

                        {/* Contenu */}
                        <div className="flex-1 pb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--text-muted)]">#{step.step_order}</span>
                            <span className="text-sm font-medium">{STEP_TYPE_LABELS[step.step_type as StepType]}</span>
                          </div>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
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
          )}

          {activeTab === 'config' && (
            <Card className="p-5 space-y-4">
              <h3 className="text-sm font-semibold">Configuration du déclencheur</h3>
              <div className="bg-[var(--bg-subtle)] p-4 rounded-[var(--radius-md)] text-sm">
                <p><span className="text-[var(--text-muted)]">Type:</span> {TRIGGER_LABELS[workflow.trigger_type as TriggerType]}</p>
                <p className="mt-2"><span className="text-[var(--text-muted)]">Filtre JSON:</span></p>
                <pre className="mt-1 p-2 bg-[var(--bg-surface)] rounded text-xs overflow-x-auto text-[var(--text-primary)]">
                  {workflow.trigger_config || '{}'}
                </pre>
              </div>
            </Card>
          )}

          {activeTab === 'enrollments' && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">Leads inscrits ({enrollments.length})</h3>
              {enrollments.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Aucun lead inscrit.</p>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                    <tr>
                      <th className="pb-2 font-medium">Lead</th>
                      <th className="pb-2 font-medium">Inscrit le</th>
                      <th className="pb-2 font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollments.map(enr => (
                      <tr key={enr.id} className="border-b border-[var(--border-subtle)] last:border-0">
                        <td className="py-3 font-medium">{enr.lead_name || enr.lead_id}</td>
                        <td className="py-3 text-[var(--text-muted)]" title={new Date(enr.enrolled_at + 'Z').toLocaleString('fr-CA')}>{timeAgo(enr.enrolled_at)}</td>
                        <td className="py-3">
                          <Badge color={
                            enr.status === 'active' ? 'var(--success)' : 
                            enr.status === 'completed' ? 'var(--info)' : 'var(--text-muted)'
                          }>
                            {ENROLLMENT_STATUS_LABELS[enr.status as EnrollmentStatus]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {activeTab === 'analytics' && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">Performance du workflow</h3>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
                  <p className="text-[var(--text-muted)] text-xs mb-1">Inscrits totaux</p>
                  <p className="text-2xl font-bold">{enrollments.length}</p>
                </div>
                <div className="p-4 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
                  <p className="text-[var(--text-muted)] text-xs mb-1">En cours (Actifs)</p>
                  <p className="text-2xl font-bold text-[var(--success)]">{enrollments.filter(e => e.status === 'active').length}</p>
                </div>
                <div className="p-4 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
                  <p className="text-[var(--text-muted)] text-xs mb-1">Terminés</p>
                  <p className="text-2xl font-bold text-[var(--info)]">{enrollments.filter(e => e.status === 'completed').length}</p>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Colonne latérale */}
        <div className="space-y-4">
          {/* Stats */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Statistiques</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Statut</span>
                <Badge color={workflow.is_active ? 'var(--success)' : 'var(--text-muted)'}>
                  {workflow.is_active ? 'Actif' : 'Inactif'}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Étapes</span>
                <span className="font-medium">{steps.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Leads inscrits</span>
                <span className="font-medium">{enrollments.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Actifs</span>
                <span className="font-medium text-[var(--success)]">
                  {enrollments.filter(e => e.status === 'active').length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Terminés</span>
                <span className="font-medium">
                  {enrollments.filter(e => e.status === 'completed').length}
                </span>
              </div>
            </div>
          </Card>

          {/* Enrollments overview removed from sidebar, moved to tab */}

          {/* Infos */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Infos</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Créé le</span>
                <span>{new Date(workflow.created_at).toLocaleDateString('fr-CA')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Scope</span>
                <span>{workflow.client_id ? 'Client spécifique' : 'Global (tous)'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">ID</span>
                <span className="font-mono truncate ml-2">{workflow.id.slice(0, 12)}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
