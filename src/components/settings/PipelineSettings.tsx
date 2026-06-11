// ── PipelineSettings — Sprint 23 W33 + Sprint 27 vague 27-2A : Tabs 3 sections
// ── Sprint 42 M3.1 — Migration 3 tabs inline → <Wizard embedded> 3 steps (2026-05-15)
//   Tabs (stages / scoring / automations) restent identiques en logique métier.
//   Seule la structure de rendering passe du segmented-control inline vers
//   Wizard embedded sober (chips numérotés + connectors + Précédent/Suivant).
//   API publique : aucun props externe, donc 100% compatible.
//   Préserve : drag stages (ArrowUp/Down), ColorSwatch, win/loss/normal, scoring
//   probabilités, automations placeholder.
import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Input,
  Select,
  Tag,
  ColorSwatch,
  EmptyState,
  Skeleton,
  useConfirm,
  useToast,
  Icon,
  Wizard,
  type WizardStep,
} from '@/components/ui';
import { EmptyStateIllustration } from '@/components/ui/EmptyStateIllustration';
import {
  getPipelines,
  createPipeline,
  updatePipeline,
  deletePipeline,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
} from '@/lib/api';
import type { Pipeline } from '@/lib/types';
import { Plus, Trash2, Pencil, Check, X, ArrowUp, ArrowDown, Workflow, BarChart3, Zap } from 'lucide-react';
import { t } from '@/lib/i18n';

const STAGE_PRESETS = ['#009DDB', '#D96E27', '#37CA37', '#FF9A00', '#E93D3D', '#188BF6', '#8B5CF6', '#8A93A4'];

export function PipelineSettings() {
  const confirm = useConfirm();
  const { success, error: toastError } = useToast();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // States pour l'édition de Pipeline
  const [isEditingPipeline, setIsEditingPipeline] = useState(false);
  const [editPipelineName, setEditPipelineName] = useState('');

  // States pour la création de Pipeline
  const [isCreatingPipeline, setIsCreatingPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');

  // States pour l'édition/création d'un stage
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editStageName, setEditStageName] = useState('');
  const [editStageColor, setEditStageColor] = useState('#009DDB');
  const [editStageType, setEditStageType] = useState<'normal' | 'win' | 'loss'>('normal');

  const [isCreatingStage, setIsCreatingStage] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState('#009DDB');
  const [newStageType, setNewStageType] = useState<'normal' | 'win' | 'loss'>('normal');

  // Sprint 42 M3.1 — Wizard embedded step (0 = Étapes, 1 = Scoring, 2 = Automations)
  const [wizardStep, setWizardStep] = useState(0);

  const loadPipelines = useCallback(async () => {
    setIsLoading(true);
    const res = await getPipelines();
    if (res.data) {
      setPipelines(res.data);
      if (!activePipelineId && res.data.length > 0) {
        setActivePipelineId(res.data.find((p) => p.is_default)?.id || res.data[0]!.id);
      }
    }
    setIsLoading(false);
  }, [activePipelineId]);

  useEffect(() => {
    void loadPipelines();
  }, [loadPipelines]);

  const activePipeline = pipelines.find((p) => p.id === activePipelineId);

  // ── Actions Pipeline ───────────────────────────────────────────────

  const handleCreatePipeline = async () => {
    if (!newPipelineName.trim()) return;
    const res = await createPipeline({ name: newPipelineName.trim() });
    if (res.data?.success) {
      setNewPipelineName('');
      setIsCreatingPipeline(false);
      setActivePipelineId(res.data.id);
      await loadPipelines();
      success(t('set.pipe.create') + ' ✓');
    } else if (res.error) {
      toastError(res.error);
    }
  };

  const handleUpdatePipeline = async () => {
    if (!activePipeline || !editPipelineName.trim()) return;
    const res = await updatePipeline(activePipeline.id, { name: editPipelineName.trim() });
    if (res.data?.success) {
      setIsEditingPipeline(false);
      await loadPipelines();
      success(t('set.pipe.rename') + ' ✓');
    } else if (res.error) {
      toastError(res.error);
    }
  };

  const handleDeletePipeline = async (id: string) => {
    const ok = await confirm({
      title: t('set.pipe.confirm_del'),
      description: t('set.pipe.confirm_del_desc'),
      confirmLabel: t('set.pipe.delete'),
      danger: true,
    });
    if (!ok) return;
    const res = await deletePipeline(id);
    if (res.data?.success) {
      setActivePipelineId(null);
      await loadPipelines();
      success(t('set.pipe.delete') + ' ✓');
    } else if (res.error) {
      toastError(res.error);
    }
  };

  // ── Actions Stages ────────────────────────────────────────────────

  const handleCreateStage = async () => {
    if (!activePipeline || !newStageName.trim()) return;
    const is_win_stage = newStageType === 'win';
    const is_loss_stage = newStageType === 'loss';

    const res = await createPipelineStage(activePipeline.id, {
      name: newStageName.trim(),
      color: newStageColor,
      probability: is_win_stage ? 100 : is_loss_stage ? 0 : 50,
    });

    setNewStageName('');
    setNewStageColor('#009DDB');
    setNewStageType('normal');
    setIsCreatingStage(false);
    await loadPipelines();
    if (res?.error) toastError(res.error);
    else success(t('set.pipe.add_a_stage') + ' ✓');
  };

  const handleUpdateStage = async (stageId: string) => {
    if (!activePipeline || !editStageName.trim()) return;
    const res = await updatePipelineStage(activePipeline.id, stageId, {
      name: editStageName.trim(),
      color: editStageColor,
      probability: editStageType === 'win' ? 100 : editStageType === 'loss' ? 0 : 50,
    });

    setEditingStageId(null);
    await loadPipelines();
    if (res?.error) toastError(res.error);
    else success(t('set.pipe.save') + ' ✓');
  };

  const handleDeleteStage = async (stageId: string) => {
    if (!activePipeline) return;
    const ok = await confirm({
      title: t('set.pipe.confirm_del_stage'),
      description: t('set.pipe.confirm_del_stage_desc'),
      confirmLabel: t('set.pipe.delete'),
      danger: true,
    });
    if (!ok) return;
    const res = await deletePipelineStage(activePipeline.id, stageId);
    await loadPipelines();
    if (res?.error) toastError(res.error);
    else success(t('set.pipe.delete') + ' ✓');
  };

  const handleMoveStage = async (stageId: string, direction: 'up' | 'down') => {
    if (!activePipeline) return;
    const stages = [...(activePipeline.stages || [])];
    const currentIndex = stages.findIndex((s) => s.id === stageId);
    if (currentIndex === -1) return;
    if (direction === 'up' && currentIndex === 0) return;
    if (direction === 'down' && currentIndex === stages.length - 1) return;

    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    const currentStage = stages[currentIndex];
    const swapStage = stages[swapIndex];
    if (!currentStage || !swapStage) return;

    const currentPos = currentStage.position;
    const swapPos = swapStage.position;

    const newStages = [...stages];
    newStages[currentIndex] = { ...currentStage, position: swapPos };
    newStages[swapIndex] = { ...swapStage, position: currentPos };
    newStages.sort((a, b) => a.position - b.position);

    const newPipelines = pipelines.map((p) =>
      p.id === activePipeline.id ? { ...p, stages: newStages } : p
    );
    setPipelines(newPipelines);

    await updatePipelineStage(activePipeline.id, currentStage.id, { position: swapPos });
    await updatePipelineStage(activePipeline.id, swapStage.id, { position: currentPos });
    await loadPipelines();
  };

  if (isLoading) {
    /* Skeleton matche layout : header + sidebar pipelines (4 items) + main stages list */
    return (
      <div className="space-y-6">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-80" style={{ animationDelay: '40ms' }} />
        </div>
        <div className="flex gap-6 items-start flex-col md:flex-row">
          <Card className="w-full md:w-64 shrink-0 p-4">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-7 rounded-lg" style={{ animationDelay: '40ms' }} />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-lg" style={{ animationDelay: `${i * 40}ms` }} />
              ))}
            </div>
          </Card>
          <Card className="flex-1 w-full p-4">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-32 rounded-lg" style={{ animationDelay: '40ms' }} />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="row-premium flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', animationDelay: `${i * 50}ms` }}
                >
                  <Skeleton className="h-4 w-4 rounded-full shrink-0" style={{ animationDelay: `${i * 50}ms` }} />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-32" style={{ animationDelay: `${i * 50 + 20}ms` }} />
                    <Skeleton className="h-2.5 w-20" style={{ animationDelay: `${i * 50 + 40}ms` }} />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full shrink-0" style={{ animationDelay: `${i * 50 + 60}ms` }} />
                  <Skeleton className="h-6 w-6 rounded shrink-0" style={{ animationDelay: `${i * 50 + 80}ms` }} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (pipelines.length === 0 && !isCreatingPipeline) {
    return (
      <Card className="p-5">
        <EmptyState
          icon={<Icon as={Workflow} size={32} />}
          title={t('set.pipe.no_pipeline')}
          description={t('set.pipe.no_pipeline_desc')}
          action={
            <Button onClick={() => setIsCreatingPipeline(true)} leftIcon={<Icon as={Plus} size="sm" />}>
              {t('set.pipe.create')}
            </Button>
          }
        />
      </Card>
    );
  }

  // ── Sprint 42 M3.1 — Step contents extraits comme JSX inline pour Wizard ──

  const stagesContent = activePipeline && (
    <div className="pipeline-step-body">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h4 className="text-sm font-semibold text-[var(--text-secondary)]">
          {t('set.pipe.stages_title')}
        </h4>
        <button
          type="button"
          onClick={() => setIsCreatingStage(true)}
          className="action-chip action-chip--accent"
        >
          <Plus size={14} />
          {t('set.pipe.add_stage')}
        </button>
      </div>

      {(activePipeline.stages || []).length === 0 && !isCreatingStage ? (
        <EmptyState
          variant="compact"
          icon={<Icon as={Workflow} size={28} />}
          title={t('set.pipe.no_stage')}
          description={t('set.pipe.no_stage_desc')}
          action={
            <Button onClick={() => setIsCreatingStage(true)} leftIcon={<Icon as={Plus} size={14} />}>
              {t('set.pipe.add_a_stage')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {(activePipeline.stages || []).map((stage, idx) => {
            const isWin = stage.probability === 100;
            const isLoss = stage.probability === 0;
            const typeLabel = isWin ? t('set.pipe.won') : isLoss ? t('set.pipe.lost') : t('set.pipe.normal');
            const isEditing = editingStageId === stage.id;
            const lastIdx = (activePipeline.stages || []).length - 1;

            return (
              <div
                key={stage.id}
                className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl group"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
              >
                <div className="flex flex-col gap-0.5 opacity-30 group-hover:opacity-100 transition-opacity">
                  <button
                    disabled={idx === 0}
                    onClick={() => void handleMoveStage(stage.id, 'up')}
                    className={`p-0.5 cursor-pointer ${
                      idx === 0 ? 'invisible' : 'hover:bg-[var(--bg-subtle)] rounded'
                    }`}
                    aria-label={t('set.pipe.move_up')}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    disabled={idx === lastIdx}
                    onClick={() => void handleMoveStage(stage.id, 'down')}
                    className={`p-0.5 cursor-pointer ${
                      idx === lastIdx ? 'invisible' : 'hover:bg-[var(--bg-subtle)] rounded'
                    }`}
                    aria-label={t('set.pipe.move_down')}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>

                {isEditing ? (
                  <div className="flex-1 flex flex-wrap items-center gap-3">
                    <ColorSwatch
                      value={editStageColor}
                      onChange={setEditStageColor}
                      presets={STAGE_PRESETS}
                      size="sm"
                    />
                    <Input
                      value={editStageName}
                      onChange={(e) => setEditStageName(e.target.value)}
                      placeholder="Nom"
                      className="!h-8 max-w-[200px]"
                      autoFocus
                    />
                    <Select
                      size="sm"
                      value={editStageType}
                      onChange={(e) => setEditStageType(e.target.value as any)}
                      className="!h-8 max-w-[180px]"
                    >
                      <option value="normal">{t('set.pipe.normal')}</option>
                      <option value="win">{t('set.pipe.won_100')}</option>
                      <option value="loss">{t('set.pipe.lost_0')}</option>
                    </Select>
                    <div className="flex gap-1 ml-auto">
                      <Button size="sm" onClick={() => void handleUpdateStage(stage.id)}>
                        {t('set.pipe.save')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingStageId(null)}>
                        {t('set.pipe.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="w-4 h-4 rounded-full shrink-0"
                      style={{
                        backgroundColor: stage.color,
                        boxShadow: `0 0 0 1px rgba(15,23,42,0.10), 0 0 8px ${stage.color}55`,
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {stage.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {t('set.pipe.estimated')}:{' '}
                          {isWin
                            ? '100%'
                            : isLoss
                              ? '0%'
                              : '~' + Math.min(10 + idx * 20, 90) + '%'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Tag
                        dot
                        size="sm"
                        variant={
                          isWin
                            ? 'success'
                            : isLoss
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {typeLabel}
                      </Tag>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setEditStageName(stage.name);
                            setEditStageColor(stage.color);
                            setEditStageType(isWin ? 'win' : isLoss ? 'loss' : 'normal');
                            setEditingStageId(stage.id);
                          }}
                          className="p-1.5 text-[var(--text-muted)] hover:text-[var(--primary)] rounded-md hover:bg-[var(--bg-subtle)] cursor-pointer"
                          aria-label={`Modifier ${stage.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => void handleDeleteStage(stage.id)}
                          className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] rounded-md hover:bg-[var(--bg-subtle)] cursor-pointer"
                          aria-label={`Supprimer ${stage.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {isCreatingStage && (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border-2 border-dashed border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <ColorSwatch
                value={newStageColor}
                onChange={setNewStageColor}
                presets={STAGE_PRESETS}
                size="sm"
              />
              <Input
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder={t('set.pipe.name_ph')}
                className="!h-8 max-w-[200px]"
                autoFocus
              />
              <Select
                size="sm"
                value={newStageType}
                onChange={(e) => setNewStageType(e.target.value as any)}
                className="!h-8 max-w-[180px]"
              >
                <option value="normal">{t('set.pipe.normal')}</option>
                <option value="win">{t('set.pipe.won_100')}</option>
                <option value="loss">{t('set.pipe.lost_0')}</option>
              </Select>
              <div className="flex gap-1 ml-auto">
                <Button size="sm" onClick={() => void handleCreateStage()}>
                  {t('set.pipe.add')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsCreatingStage(false)}>
                  {t('set.pipe.cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const scoringContent = activePipeline && (
    <div className="pipeline-step-body space-y-4">
      <h4 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
        <Icon as={BarChart3} size={16} className="text-[var(--primary)]" />
        {t('set.pipe.scoring_title')}
      </h4>
      <p className="text-xs text-[var(--text-muted)] -mt-2">
        {t('set.pipe.scoring_desc')}
      </p>
      {(activePipeline.stages || []).length === 0 ? (
        <EmptyState
          variant="compact"
          icon={<Icon as={BarChart3} size={28} />}
          title={t('set.pipe.no_stage_scoring')}
          description={t('set.pipe.no_stage_scoring_desc')}
          action={
            <Button variant="secondary" size="sm" onClick={() => setWizardStep(0)}>
              {t('set.pipe.go_stages')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {(activePipeline.stages || []).map((stage, idx) => {
            const isWin = stage.probability === 100;
            const isLoss = stage.probability === 0;
            const prob = isWin ? 100 : isLoss ? 0 : Math.min(10 + idx * 20, 90);
            return (
              <div
                key={stage.id}
                className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl"
                style={{ animationDelay: `${idx * 40}ms` }}
              >
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: stage.color, boxShadow: `0 0 6px ${stage.color}55` }}
                />
                <span className="text-sm font-medium text-[var(--text-primary)] flex-1 truncate">{stage.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-24 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${prob}%`,
                        background: isWin ? 'var(--success)' : isLoss ? 'var(--danger)' : stage.color,
                      }}
                    />
                  </div>
                  <span className="text-xs font-bold t-mono-num w-8 text-right" style={{ color: isWin ? 'var(--success)' : isLoss ? 'var(--danger)' : stage.color }}>
                    {prob}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const automationsContent = (
    <div className="pipeline-step-body py-6">
      <EmptyState
        icon={<EmptyStateIllustration kind="pipeline" size={96} />}
        title={t('set.pipe.auto_title')}
        description={t('set.pipe.auto_desc')}
      />
    </div>
  );

  const wizardSteps: WizardStep[] = [
    {
      id: 'stages',
      label: t('set.pipe.stages_step'),
      icon: <Icon as={Workflow} size={12} />,
      content: stagesContent,
    },
    {
      id: 'scoring',
      label: 'Scoring',
      icon: <Icon as={BarChart3} size={12} />,
      content: scoringContent,
    },
    {
      id: 'automations',
      label: 'Automations',  // universal
      icon: <Icon as={Zap} size={12} />,
      content: automationsContent,
    },
  ];

  return (
    <div className="space-y-6 animate-stagger">
      <div>
        <h2 className="text-base font-bold text-[var(--text-primary)] mb-1">{t('set.pipe.title')}</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {t('set.pipe.subtitle')}
        </p>
      </div>

      <div className="flex gap-6 items-start flex-col md:flex-row">
        {/* Liste des pipelines */}
        <Card className="w-full md:w-64 shrink-0 p-4 form-section-s4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Pipelines</h3>
            <button
              onClick={() => setIsCreatingPipeline(true)}
              className="action-chip action-chip-icon"
              aria-label={t('set.pipe.create')}
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="space-y-1.5">
            {pipelines.map((pipeline) => (
              <button
                key={pipeline.id}
                onClick={() => setActivePipelineId(pipeline.id)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                  activePipelineId === pipeline.id
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                <span className="truncate">{pipeline.name}</span>
                {pipeline.is_default === 1 && (
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                      activePipelineId === pipeline.id ? 'bg-[var(--bg-surface)]/20' : 'bg-[var(--bg-muted)]'
                    }`}
                  >
                    {t('set.pipe.default')}
                  </span>
                )}
              </button>
            ))}

            {isCreatingPipeline && (
              <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] mt-2">
                <input
                  autoFocus
                  placeholder={t('set.pipe.pl_name_ph')}
                  value={newPipelineName}
                  onChange={(e) => setNewPipelineName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreatePipeline();
                    if (e.key === 'Escape') setIsCreatingPipeline(false);
                  }}
                  className="w-full text-sm bg-transparent border-none focus:outline-none focus:ring-0 mb-2 px-1 text-[var(--text-primary)]"
                />
                <div className="flex gap-1 justify-end">
                  <button
                    onClick={() => setIsCreatingPipeline(false)}
                    className="p-1 hover:bg-[var(--bg-surface)] rounded text-[var(--text-muted)]"
                    aria-label="Annuler"
                  >
                    <X size={14} />
                  </button>
                  <button
                    onClick={() => void handleCreatePipeline()}
                    className="p-1 hover:bg-[var(--bg-surface)] rounded text-[var(--success)]"
                    aria-label="Confirmer"
                  >
                    <Check size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Détails du pipeline sélectionné */}
        {activePipeline ? (
          <div className="flex-1 w-full space-y-4">
            <Card className="p-5 form-section-s4">
              <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                {isEditingPipeline ? (
                  <div className="flex items-center gap-2 flex-1 max-w-sm">
                    <Input
                      value={editPipelineName}
                      onChange={(e) => setEditPipelineName(e.target.value)}
                      autoFocus
                      className="!h-9"
                    />
                    <Button size="sm" onClick={() => void handleUpdatePipeline()}>
                      OK
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setIsEditingPipeline(false)}>
                      Annuler
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">{activePipeline.name}</h3>
                    <button
                      onClick={() => {
                        setEditPipelineName(activePipeline.name);
                        setIsEditingPipeline(true);
                      }}
                      className="text-[var(--text-muted)] hover:text-[var(--primary)] cursor-pointer p-1"
                      aria-label={t('set.pipe.rename')}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                )}

                {activePipeline.is_default !== 1 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleDeletePipeline(activePipeline.id)}
                    className="shrink-0 gap-1.5"
                  >
                    <Icon as={Trash2} size="sm" /> {t('set.pipe.delete_pipeline')}
                  </Button>
                )}
              </div>

              {/* Sprint 42 M3.1 — Wizard embedded sober (3 steps : stages → scoring → automations) */}
              <Wizard
                embedded
                open
                onOpenChange={() => { /* no-op : embedded ne gère pas open/close lui-même */ }}
                title=""
                steps={wizardSteps}
                currentIndex={wizardStep}
                onStepChange={setWizardStep}
                onComplete={() => {
                  // Step final atteint — pas d'action métier (déjà sauvé en autosave par toggles)
                  success(t('set.pipe.configured'));
                }}
                completeLabel={t('set.pipe.done')}
              />
            </Card>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-12 text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] rounded-xl">
            {t('set.pipe.select')}
          </div>
        )}
      </div>
    </div>
  );
}
