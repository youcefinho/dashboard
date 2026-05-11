import { useState, useEffect, useCallback } from 'react';
import { Card, Button, Badge } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { getPipelines, createPipeline, updatePipeline, deletePipeline, createPipelineStage, updatePipelineStage, deletePipelineStage } from '@/lib/api';
import type { Pipeline } from '@/lib/types';
import { Plus, Trash2, Edit2, Check, X, ArrowUp, ArrowDown } from 'lucide-react';

export function PipelineSettings() {
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

  const loadPipelines = useCallback(async () => {
    setIsLoading(true);
    const res = await getPipelines();
    if (res.data) {
      setPipelines(res.data);
      if (!activePipelineId && res.data.length > 0) {
        setActivePipelineId(res.data.find(p => p.is_default)?.id || res.data[0]!.id);
      }
    }
    setIsLoading(false);
  }, [activePipelineId]);

  useEffect(() => { void loadPipelines(); }, [loadPipelines]);

  const activePipeline = pipelines.find(p => p.id === activePipelineId);

  // ── Actions Pipeline ───────────────────────────────────────────────

  const handleCreatePipeline = async () => {
    if (!newPipelineName.trim()) return;
    const res = await createPipeline({ name: newPipelineName.trim() });
    if (res.data?.success) {
      setNewPipelineName('');
      setIsCreatingPipeline(false);
      setActivePipelineId(res.data.id);
      await loadPipelines();
    }
  };

  const handleUpdatePipeline = async () => {
    if (!activePipeline || !editPipelineName.trim()) return;
    const res = await updatePipeline(activePipeline.id, { name: editPipelineName.trim() });
    if (res.data?.success) {
      setIsEditingPipeline(false);
      await loadPipelines();
    }
  };

  const handleDeletePipeline = async (id: string) => {
    if (!confirm('Voulez-vous vraiment supprimer ce pipeline ? Les leads associés seront déplacés vers le pipeline par défaut.')) return;
    const res = await deletePipeline(id);
    if (res.data?.success) {
      setActivePipelineId(null);
      await loadPipelines();
    } else if (res.error) {
      alert(res.error);
    }
  };

  // ── Actions Stages ────────────────────────────────────────────────

  const handleCreateStage = async () => {
    if (!activePipeline || !newStageName.trim()) return;
    const is_win_stage = newStageType === 'win';
    const is_loss_stage = newStageType === 'loss';
    
    await createPipelineStage(activePipeline.id, { 
      name: newStageName.trim(), 
      color: newStageColor,
      probability: is_win_stage ? 100 : is_loss_stage ? 0 : 50
    });
    
    setNewStageName('');
    setNewStageColor('#009DDB');
    setNewStageType('normal');
    setIsCreatingStage(false);
    await loadPipelines();
  };

  const handleUpdateStage = async (stageId: string) => {
    if (!activePipeline || !editStageName.trim()) return;
    await updatePipelineStage(activePipeline.id, stageId, { 
      name: editStageName.trim(), 
      color: editStageColor,
      probability: editStageType === 'win' ? 100 : editStageType === 'loss' ? 0 : 50
    });
    
    setEditingStageId(null);
    await loadPipelines();
  };

  const handleDeleteStage = async (stageId: string) => {
    if (!activePipeline) return;
    if (!confirm('Voulez-vous vraiment supprimer cette étape ?')) return;
    await deletePipelineStage(activePipeline.id, stageId);
    await loadPipelines();
  };

  const handleMoveStage = async (stageId: string, direction: 'up' | 'down') => {
    if (!activePipeline) return;
    const stages = [...(activePipeline.stages || [])];
    const currentIndex = stages.findIndex(s => s.id === stageId);
    if (currentIndex === -1) return;
    if (direction === 'up' && currentIndex === 0) return;
    if (direction === 'down' && currentIndex === stages.length - 1) return;

    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    
    const currentStage = stages[currentIndex];
    const swapStage = stages[swapIndex];
    if (!currentStage || !swapStage) return;
    
    // Pour simplifier, on envoie les nouvelles positions via API.
    // L'API mettra à jour position=nouvellePos.
    const currentPos = currentStage.position;
    const swapPos = swapStage.position;

    // Mettons à jour localement d'abord pour plus de fluidité (optimistic ui basique)
    const newStages = [...stages];
    newStages[currentIndex] = { ...currentStage, position: swapPos };
    newStages[swapIndex] = { ...swapStage, position: currentPos };
    newStages.sort((a, b) => a.position - b.position);
    
    const newPipelines = pipelines.map(p => p.id === activePipeline.id ? { ...p, stages: newStages } : p);
    setPipelines(newPipelines);

    await updatePipelineStage(activePipeline.id, currentStage.id, { position: swapPos });
    await updatePipelineStage(activePipeline.id, swapStage.id, { position: currentPos });
    // loadPipelines() is implicitly needed but the UI is already correct. We can reload just to be sure.
    await loadPipelines();
  };

  if (isLoading) {
    return <div className="p-8 text-center text-[var(--text-muted)] text-sm">Chargement des pipelines...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-[var(--text-primary)] mb-1">Pipelines & Opportunités</h2>
        <p className="text-sm text-[var(--text-muted)]">Gérez vos pipelines et personnalisez les étapes (colonnes) de votre Kanban.</p>
      </div>

      <div className="flex gap-6 items-start flex-col md:flex-row">
        {/* Liste des pipelines */}
        <Card className="w-full md:w-64 shrink-0 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Pipelines</h3>
            <button onClick={() => setIsCreatingPipeline(true)} className="p-1 text-[var(--brand-primary)] hover:bg-[var(--brand-tint)] rounded-md transition-colors">
              <Plus size={16} />
            </button>
          </div>
          
          <div className="space-y-1.5">
            {pipelines.map(pipeline => (
              <button
                key={pipeline.id}
                onClick={() => setActivePipelineId(pipeline.id)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                  activePipelineId === pipeline.id 
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm' 
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                <span className="truncate">{pipeline.name}</span>
                {pipeline.is_default === 1 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${activePipelineId === pipeline.id ? 'bg-white/20' : 'bg-[var(--bg-muted)]'}`}>Défaut</span>
                )}
              </button>
            ))}
            
            {isCreatingPipeline && (
              <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] mt-2">
                <input 
                  autoFocus
                  placeholder="Nom du pipeline..."
                  value={newPipelineName}
                  onChange={e => setNewPipelineName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleCreatePipeline(); if (e.key === 'Escape') setIsCreatingPipeline(false); }}
                  className="w-full text-sm bg-transparent border-none focus:outline-none focus:ring-0 mb-2 px-1 text-[var(--text-primary)]"
                />
                <div className="flex gap-1 justify-end">
                  <button onClick={() => setIsCreatingPipeline(false)} className="p-1 hover:bg-white rounded text-[var(--text-muted)]"><X size={14} /></button>
                  <button onClick={() => void handleCreatePipeline()} className="p-1 hover:bg-white rounded text-[var(--success)]"><Check size={14} /></button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Détails du pipeline sélectionné */}
        {activePipeline ? (
          <div className="flex-1 w-full space-y-4">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-6">
                {isEditingPipeline ? (
                  <div className="flex items-center gap-2 flex-1 max-w-sm">
                    <Input 
                      value={editPipelineName} 
                      onChange={e => setEditPipelineName(e.target.value)} 
                      autoFocus 
                      className="!h-9"
                    />
                    <Button size="sm" onClick={() => void handleUpdatePipeline()}>OK</Button>
                    <Button size="sm" variant="ghost" onClick={() => setIsEditingPipeline(false)}>Annuler</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">{activePipeline.name}</h3>
                    <button onClick={() => { setEditPipelineName(activePipeline.name); setIsEditingPipeline(true); }} className="text-[var(--text-muted)] hover:text-[var(--brand-primary)] cursor-pointer p-1">
                      <Edit2 size={14} />
                    </button>
                  </div>
                )}

                {activePipeline.is_default !== 1 && (
                  <Button size="sm" variant="destructive" onClick={() => void handleDeletePipeline(activePipeline.id)} className="shrink-0 gap-1.5">
                    <Trash2 size={14} /> Supprimer pipeline
                  </Button>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-[var(--text-secondary)]">Étapes du pipeline (Colonnes)</h4>
                  <Button size="sm" variant="secondary" onClick={() => setIsCreatingStage(true)} className="gap-1.5">
                    <Plus size={14} /> Ajouter étape
                  </Button>
                </div>

                <div className="space-y-2">
                  {(activePipeline.stages || []).map((stage, idx) => {
                    const isWin = stage.probability === 100;
                    const isLoss = stage.probability === 0;
                    const typeLabel = isWin ? 'Gagné' : isLoss ? 'Perdu' : 'Normal';
                    const isEditing = editingStageId === stage.id;

                    return (
                      <div key={stage.id} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--brand-primary)] transition-colors group">
                        
                        <div className="flex flex-col gap-0.5 opacity-30 hover:opacity-100 transition-opacity">
                          <button disabled={idx === 0} onClick={() => void handleMoveStage(stage.id, 'up')} className={`p-0.5 cursor-pointer ${idx === 0 ? 'invisible' : 'hover:bg-[var(--bg-subtle)] rounded'}`}><ArrowUp size={14} /></button>
                          <button disabled={idx === (activePipeline.stages || []).length - 1} onClick={() => void handleMoveStage(stage.id, 'down')} className={`p-0.5 cursor-pointer ${idx === (activePipeline.stages || []).length - 1 ? 'invisible' : 'hover:bg-[var(--bg-subtle)] rounded'}`}><ArrowDown size={14} /></button>
                        </div>

                        {isEditing ? (
                          <div className="flex-1 flex flex-wrap items-center gap-3">
                            <input type="color" value={editStageColor} onChange={e => setEditStageColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer p-0 border-0" />
                            <Input value={editStageName} onChange={e => setEditStageName(e.target.value)} placeholder="Nom" className="!h-8 max-w-[200px]" autoFocus />
                            <select value={editStageType} onChange={e => setEditStageType(e.target.value as any)} className="h-8 px-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)]">
                              <option value="normal">Normal</option>
                              <option value="win">Gagné (100%)</option>
                              <option value="loss">Perdu (0%)</option>
                            </select>
                            <div className="flex gap-1 ml-auto">
                              <Button size="sm" onClick={() => void handleUpdateStage(stage.id)}>Sauver</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingStageId(null)}>Annuler</Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-[var(--text-primary)]">{stage.name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-[var(--text-muted)]">Probabilité estimée: {isWin ? '100%' : isLoss ? '0%' : '~' + Math.min(10 + (idx * 20), 90) + '%'}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge color={isWin ? 'var(--success)' : isLoss ? 'var(--danger)' : 'var(--border-default)'}>{typeLabel}</Badge>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => {
                                  setEditStageName(stage.name);
                                  setEditStageColor(stage.color);
                                  setEditStageType(isWin ? 'win' : isLoss ? 'loss' : 'normal');
                                  setEditingStageId(stage.id);
                                }} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--brand-primary)] rounded-md hover:bg-[var(--bg-subtle)] cursor-pointer">
                                  <Edit2 size={14} />
                                </button>
                                <button onClick={() => void handleDeleteStage(stage.id)} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] rounded-md hover:bg-[var(--bg-subtle)] cursor-pointer">
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
                    <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                      <input type="color" value={newStageColor} onChange={e => setNewStageColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer p-0 border-0" />
                      <Input value={newStageName} onChange={e => setNewStageName(e.target.value)} placeholder="Nom de l'étape" className="!h-8 max-w-[200px]" autoFocus />
                      <select value={newStageType} onChange={e => setNewStageType(e.target.value as any)} className="h-8 px-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)]">
                        <option value="normal">Normal</option>
                        <option value="win">Gagné (100%)</option>
                        <option value="loss">Perdu (0%)</option>
                      </select>
                      <div className="flex gap-1 ml-auto">
                        <Button size="sm" onClick={() => void handleCreateStage()}>Ajouter</Button>
                        <Button size="sm" variant="ghost" onClick={() => setIsCreatingStage(false)}>Annuler</Button>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            </Card>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-12 text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] rounded-xl">
            Sélectionnez un pipeline pour modifier ses étapes.
          </div>
        )}
      </div>
    </div>
  );
}
