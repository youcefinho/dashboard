// ── Page Pipeline — Kanban refondu Sprint Design 2 (D2.1) + Multi-Pipelines (Phase C)
import { useState, useEffect, useCallback, type DragEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Skeleton, Card, Button, EmptyState, PageHero } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { getPipeline, getPipelines, updateLead } from '@/lib/api';
import { confettiBurst } from '@/lib/confetti';
import { TYPE_LABELS, SOURCE_LABELS, type Lead, type Pipeline, type PipelineStage } from '@/lib/types';
import { MoreHorizontal, ChevronDown, LayoutList, BarChart3, Kanban, Filter, Clock, DollarSign, TrendingUp, AlertTriangle, X, Check } from 'lucide-react';
import { ForecastView } from '@/components/pipelines/ForecastView';

const LOST_REASONS = ['Prix trop élevé', 'Concurrent choisi', 'Mauvais timing', 'Pas de réponse', 'Financement refusé', 'Changement de plan', 'Autre'];

type ViewMode = 'kanban' | 'list' | 'forecast';

export function PipelinePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [isPipelinesDropdownOpen, setIsPipelinesDropdownOpen] = useState(false);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('intralys_pipeline_viewmode') as ViewMode) || 'kanban');
  const [lostModal, setLostModal] = useState<{ leadId: string; show: boolean }>({ leadId: '', show: false });
  const [lostReason, setLostReason] = useState('');
  const [lostDetails, setLostDetails] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('intralys_pipeline_filters') || '[]'); } catch { return []; }
  });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { localStorage.setItem('intralys_pipeline_viewmode', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('intralys_pipeline_filters', JSON.stringify(activeFilters)); }, [activeFilters]);

  const loadData = useCallback(async (forcedPipelineId?: string) => {
    setIsLoading(true);
    const pipesRes = await getPipelines();
    let currentPipelineId = forcedPipelineId || activePipelineId;

    if (pipesRes.data && pipesRes.data.length > 0) {
      setPipelines(pipesRes.data);
      if (!currentPipelineId) {
        currentPipelineId = pipesRes.data.find(p => p.is_default)?.id || pipesRes.data[0]!.id;
        setActivePipelineId(currentPipelineId);
      }
      const result = await getPipeline(currentPipelineId!);
      if (result.data) setLeads(result.data);
    }
    setIsLoading(false);
  }, [activePipelineId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const activePipeline = pipelines.find(p => p.id === activePipelineId) || pipelines[0];
  const stages = activePipeline?.stages || [];

  // Helper pour obtenir la probabilité
  const getStageProbability = (stage: PipelineStage) => {
    if (stage.probability !== undefined && stage.probability !== null) return stage.probability;
    if (stage.probability === 100) return 100;
    if (stage.probability === 0) return 0;
    // Approximatif basé sur la position
    const idx = stages.indexOf(stage);
    return Math.min(10 + (idx * 20), 90);
  };

  // ── Drag & Drop ────────────────────────────────────
  const handleDragStart = (e: DragEvent, leadId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leadId);
    setDraggedId(leadId);
  };
  const handleDragOver = (e: DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(stageId);
  };
  const handleDragLeave = () => setDropTarget(null);
  const handleDrop = async (e: DragEvent, newStageId: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    setDraggedId(null);
    setDropTarget(null);
    if (!leadId) return;

    const targetStage = stages.find(s => s.id === newStageId);
    
    // Si on drop sur "lost" (stage de perte) → ouvrir modal raison
    if (targetStage?.probability === 0) {
      setLostModal({ leadId, show: true });
      // Ne pas mettre à jour le state tout de suite
      return;
    }

    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: newStageId } : l));
    // Sprint 23 wave 8 — confetti si drop sur stage gagnant (probability 100)
    if (targetStage?.probability === 100) {
      confettiBurst();
    }
    const result = await updateLead(leadId, { stage_id: newStageId });
    if (result.error) void loadData(activePipelineId!);
  };

  const confirmLost = async () => {
    if (!lostModal.leadId) return;
    const lossStage = stages.find(s => s.probability === 0);
    if (!lossStage) return; // Fallback

    setLeads(prev => prev.map(l => l.id === lostModal.leadId ? { ...l, stage_id: lossStage.id } : l));
    await updateLead(lostModal.leadId, { stage_id: lossStage.id, status: 'lost', notes: `[PERDU] ${lostReason}${lostDetails ? ` — ${lostDetails}` : ''}` });
    setLostModal({ leadId: '', show: false });
    setLostReason('');
    setLostDetails('');
  };

  const getColumnLeads = (stageId: string) => leads.filter(l => (l.stage_id || stages[0]?.id) === stageId);
  const getDaysInStage = (lead: Lead) => Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86400000);
  const scoreColor = (s: number) => s >= 70 ? 'var(--success)' : s >= 40 ? 'var(--warning)' : 'var(--danger)';
  const daysColor = (d: number) => d > 14 ? 'var(--danger)' : d > 7 ? 'var(--warning)' : 'var(--success)';

  const totalValue = leads.reduce((s, l) => s + (l.deal_value || 0), 0);
  const weightedForecast = leads.reduce((s, l) => {
    const stage = stages.find(st => st.id === (l.stage_id || stages[0]?.id));
    const prob = stage ? getStageProbability(stage) : 0;
    return s + (l.deal_value || 0) * (prob / 100);
  }, 0);
  
  const dormantCount = leads.filter(l => {
    const stage = stages.find(st => st.id === (l.stage_id || stages[0]?.id));
    return getDaysInStage(l) > 7 && stage?.probability !== 100 && stage?.probability !== 0;
  }).length;

  const removeFilter = (f: string) => setActiveFilters(prev => prev.filter(x => x !== f));

  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  return (
    <AppLayout title="Pipeline">
      <PageHero
        compact
        meta="Workspace"
        title="Pipeline de ventes"
        highlight="Pipeline"
        description="Kanban drag-and-drop, vue liste ou forecast. Suivez vos opportunités en temps réel."
      />
      {/* ── Header : Pipeline selector + KPIs sticky ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5 relative">
        {/* Pipeline selector */}
        <div className="relative">
          <button 
            onClick={() => setIsPipelinesDropdownOpen(!isPipelinesDropdownOpen)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--brand-primary)] transition-colors cursor-pointer"
          >
            {activePipeline?.name || 'Chargement...'} <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          
          {isPipelinesDropdownOpen && pipelines.length > 0 && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsPipelinesDropdownOpen(false)} />
              <div className="absolute top-full left-0 mt-1 w-56 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-lg z-20 py-1 overflow-hidden">
                {pipelines.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setActivePipelineId(p.id);
                      setIsPipelinesDropdownOpen(false);
                      void loadData(p.id);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] flex items-center justify-between"
                  >
                    {p.name}
                    {p.id === activePipelineId && <Check size={14} className="text-[var(--brand-primary)]" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* KPIs inline — Sprint 23 : mini hero cards */}
        <div className="flex items-stretch gap-2 ml-2">
          {/* KPI Valeur */}
          <div className="relative overflow-hidden flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:scale-[1.02] cursor-default"
            style={{
              background: 'linear-gradient(135deg, #FFFFFF 0%, #F0FAFE 100%)',
              border: '1px solid rgba(0,157,219,0.25)',
              boxShadow: '0 1px 2px rgba(0,157,219,0.06), 0 6px 16px -8px rgba(0,157,219,0.25)',
            }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #009DDB 0%, #0086C0 100%)', boxShadow: '0 2px 8px rgba(0,157,219,0.4)' }}>
              <DollarSign size={15} className="text-white" />
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Valeur</p>
              <p className="text-sm font-bold tabular-nums leading-tight" style={{ color: 'var(--brand-primary)' }}>
                {totalValue.toLocaleString('fr-CA')} <span className="text-[10px] text-[var(--text-muted)]">$</span>
              </p>
            </div>
          </div>

          {/* KPI Prévision */}
          <div className="relative overflow-hidden flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:scale-[1.02] cursor-default"
            style={{
              background: 'linear-gradient(135deg, #FFFFFF 0%, #F5FBF5 100%)',
              border: '1px solid rgba(55,202,55,0.25)',
              boxShadow: '0 1px 2px rgba(55,202,55,0.06), 0 6px 16px -8px rgba(55,202,55,0.25)',
            }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #37CA37 0%, #2ba62b 100%)', boxShadow: '0 2px 8px rgba(55,202,55,0.4)' }}>
              <TrendingUp size={15} className="text-white" />
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Prévision</p>
              <p className="text-sm font-bold tabular-nums leading-tight" style={{ color: 'var(--success)' }}>
                {weightedForecast.toLocaleString('fr-CA')} <span className="text-[10px] text-[var(--text-muted)]">$</span>
              </p>
            </div>
          </div>

          {/* KPI Dormants */}
          <div className="relative overflow-hidden flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:scale-[1.02] cursor-default"
            style={{
              background: 'linear-gradient(135deg, #FFFFFF 0%, #FFFBF5 100%)',
              border: '1px solid rgba(255,154,0,0.25)',
              boxShadow: '0 1px 2px rgba(255,154,0,0.06), 0 6px 16px -8px rgba(255,154,0,0.25)',
            }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #FF9A00 0%, #D96E27 100%)', boxShadow: '0 2px 8px rgba(255,154,0,0.4)' }}>
              <AlertTriangle size={15} className="text-white" />
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Dormants</p>
              <p className="text-sm font-bold tabular-nums leading-tight" style={{ color: 'var(--warning)' }}>
                {dormantCount}
              </p>
            </div>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filtres */}
        <button onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${showFilters ? 'bg-[var(--brand-primary)] text-white' : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--brand-primary)]'}`}>
          <Filter size={13} /> Filtres
          {activeFilters.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">{activeFilters.length}</span>}
        </button>

        {/* Vue switcher */}
        <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5">
          {([['kanban', Kanban], ['list', LayoutList], ['forecast', BarChart3]] as const).map(([mode, Icon]) => (
            <button key={mode} onClick={() => setViewMode(mode as ViewMode)}
              className={`p-1.5 rounded-md cursor-pointer transition-all ${viewMode === mode ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>

      {/* Filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilters.map(f => (
            <span key={f} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--brand-tint)] text-[var(--brand-primary)] text-xs font-medium">
              {f} <button onClick={() => removeFilter(f)} className="cursor-pointer hover:text-[var(--danger)]"><X size={12} /></button>
            </span>
          ))}
          <button onClick={() => setActiveFilters([])} className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer">Tout effacer</button>
        </div>
      )}

      {/* ── Kanban ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[1,2,3,4,5,6].map(s => (
            <div key={s} className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>
          ))}
        </div>
      ) : leads.length === 0 && activeFilters.length === 0 ? (
        <EmptyState
          icon={<TrendingUp size={48} />}
          title="Aucun lead dans le pipeline"
          description="Vos leads apparaîtront ici une fois capturés (formulaires, webhooks, intégrations) ou ajoutés manuellement."
          action={<Link to="/leads"><Button>Voir mes leads</Button></Link>}
        />
      ) : viewMode === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4 min-h-[calc(100vh-14rem)] snap-x snap-mandatory custom-scrollbar pr-4">
          {stages.map(stage => {
            const colLeads = getColumnLeads(stage.id);
            const isOver = dropTarget === stage.id;
            const colValue = colLeads.reduce((s, l) => s + (l.deal_value || 0), 0);
            const prob = getStageProbability(stage);

            return (
              <div key={stage.id}
                className="pipeline-column relative flex flex-col rounded-2xl overflow-hidden transition-all duration-300 shrink-0 w-[85vw] sm:w-72 snap-center sm:snap-start"
                style={{
                  // Sprint 23 — gradient DRAMATIQUE 20% → 3% (au lieu de 8% → 2%)
                  ['--stage-color' as string]: stage.color,
                  background: `linear-gradient(180deg, ${hexToRgba(stage.color, isOver ? 0.32 : 0.20)} 0%, ${hexToRgba(stage.color, 0.08)} 35%, ${hexToRgba(stage.color, 0.03)} 100%)`,
                  border: `1px solid ${hexToRgba(stage.color, isOver ? 0.55 : 0.25)}`,
                  boxShadow: isOver
                    ? `0 0 0 3px ${hexToRgba(stage.color, 0.2)}, 0 12px 32px -8px ${hexToRgba(stage.color, 0.55)}`
                    : `0 4px 24px -8px ${hexToRgba(stage.color, 0.4)}`,
                }}
                onDragOver={e => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={e => void handleDrop(e, stage.id)}>

                {/* Trait shimmer animé en haut */}
                <div className="absolute top-0 left-0 right-0 h-[3px] overflow-hidden pointer-events-none"
                  style={{ background: hexToRgba(stage.color, 0.3) }}>
                  <div className="stage-shimmer h-full w-1/3"
                    style={{
                      background: `linear-gradient(90deg, transparent, ${stage.color}, transparent)`,
                      boxShadow: `0 0 12px ${stage.color}`,
                    }} />
                </div>

                {/* Header glassmorphism sticky */}
                <div className="sticky top-0 z-10 px-4 py-3"
                  style={{
                    background: 'rgba(255, 255, 255, 0.55)',
                    backdropFilter: 'blur(12px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(12px) saturate(160%)',
                    borderBottom: `1px solid ${hexToRgba(stage.color, 0.18)}`,
                  }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${stage.probability <= 25 ? 'status-new-dot' : ''}`}
                        style={{ background: stage.color, boxShadow: `0 0 10px ${stage.color}`, color: stage.color }} />
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] truncate"
                        style={{ color: stage.color }}>{stage.name}</h3>
                    </div>
                    <span className="text-xs font-mono font-bold tabular-nums px-2 py-0.5 rounded-md shrink-0"
                      style={{ background: 'rgba(255,255,255,0.7)', color: stage.color, border: `1px solid ${hexToRgba(stage.color, 0.2)}` }}>
                      {colLeads.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {colValue > 0 ? (
                      <p className="text-[12px] font-bold tabular-nums text-[var(--text-primary)]">
                        {colValue.toLocaleString('fr-CA')} <span className="text-[var(--text-muted)] font-normal">$</span>
                      </p>
                    ) : (
                      <span className="text-[10px] text-[var(--text-muted)]">—</span>
                    )}
                    <span className="text-[10px] font-bold tabular-nums uppercase tracking-wider"
                      style={{ color: hexToRgba(stage.color, 0.85) }}>{prob}%</span>
                  </div>
                  <div className="h-1 mt-2 rounded-full overflow-hidden"
                    style={{ background: hexToRgba(stage.color, 0.12) }}>
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${prob}%`,
                        background: `linear-gradient(90deg, ${stage.color}, ${hexToRgba(stage.color, 0.7)})`,
                        boxShadow: prob > 30 ? `0 0 8px ${stage.color}` : undefined,
                      }} />
                  </div>
                </div>

                {/* Drop indicator */}
                {isOver && (
                  <div className="mx-3 mb-2 h-1 rounded-full animate-pulse" style={{ background: stage.color, boxShadow: `0 0 8px ${stage.color}` }} />
                )}

                {/* Cards */}
                <div className="flex-1 space-y-2 px-2 pb-2 overflow-y-auto max-h-[calc(100vh-20rem)] custom-scrollbar">
                  {colLeads.length === 0 && (
                    draggedId ? (
                      <div className="text-center py-8 text-[10px] text-[var(--text-muted)] border-2 border-dashed rounded-xl mx-1 transition-colors" style={{ borderColor: isOver ? stage.color : 'var(--border-subtle)' }}>
                        Déposez ici
                      </div>
                    ) : (
                      <div className="text-center py-6 text-[10px] text-[var(--text-muted)] mx-1 opacity-40">—</div>
                    )
                  )}
                  {colLeads.map(lead => {
                    const days = getDaysInStage(lead);
                    const isDormant = days > 7 && stage.probability !== 100 && stage.probability !== 0;
                    const isHot = lead.score >= 70;
                    const hasDeal = lead.deal_value > 0;
                    const hasScore = lead.score > 0;
                    return (
                      <div key={lead.id} draggable
                        onDragStart={e => handleDragStart(e, lead.id)}
                        className={`group relative rounded-xl p-4 cursor-grab active:cursor-grabbing transition-all duration-300 ${
                          isHot ? 'hot-lead-card' : 'hover:-translate-y-0.5 hover:scale-[1.01]'
                        } ${draggedId === lead.id ? 'opacity-40 scale-95 rotate-1' : ''}`}
                        style={{
                          // Pattern 1 dramatique pour hot leads
                          background: isHot
                            ? 'linear-gradient(135deg, #FFFFFF 0%, #F0FAFE 60%, #E0F4FB 100%)'
                            : '#FFFFFF',
                          border: isHot
                            ? '1.5px solid rgba(0, 157, 219, 0.55)'
                            : '1px solid var(--border-subtle)',
                          boxShadow: isHot
                            ? undefined  // géré par .hot-lead-card animation
                            : '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.06)',
                          borderLeft: isDormant ? '3px solid var(--warning)' : undefined,
                        }}>

                        {/* Badge HOT en absolute top-right pour hot leads */}
                        {isHot && (
                          <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-bold text-white tracking-wider shrink-0 z-10"
                            style={{
                              background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                              boxShadow: '0 4px 12px rgba(217, 110, 39, 0.45)',
                            }}>
                            HOT {lead.score}
                          </div>
                        )}

                        {/* Row 1 : Avatar + Name + Score (non-hot) + 3-dots */}
                        <div className="flex items-start gap-2 mb-2 relative">
                          <Avatar name={lead.name} size="xs" ring={isHot ? 'hot' : 'none'} />
                          <div className="flex-1 min-w-0">
                            <Link to={`/leads/${lead.id}`} className="text-[13px] font-semibold text-[var(--text-primary)] hover:text-[var(--brand-primary)] transition-colors truncate block leading-tight">
                              {lead.name}
                            </Link>
                            {lead.client_name && <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{lead.client_name}</p>}
                          </div>
                          {hasScore && !isHot && (
                            <span className="inline-flex items-center justify-center min-w-[26px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums shrink-0"
                              style={{
                                background: hexToRgba(scoreColor(lead.score).startsWith('var') ? '#FF9A00' : scoreColor(lead.score), 0.12),
                                color: scoreColor(lead.score),
                              }}>
                              {lead.score}
                            </span>
                          )}
                          <button className="opacity-0 group-hover:opacity-100 p-1 -m-1 rounded-md hover:bg-[var(--bg-subtle)] transition-all cursor-pointer text-[var(--text-muted)] shrink-0">
                            <MoreHorizontal size={14} />
                          </button>
                        </div>

                        {/* Row 2 : Type pill + Deal value (uniquement si > 0) */}
                        {(hasDeal || lead.type === 'customer') && (
                          <div className="flex items-center justify-between mb-2">
                            <Badge color={lead.type === 'inbound' ? 'var(--brand-primary)' : 'var(--warning)'}>{TYPE_LABELS[lead.type]}</Badge>
                            {hasDeal && (
                              <span className="text-[12px] font-bold tabular-nums"
                                style={isHot ? {
                                  background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                                  WebkitBackgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                  backgroundClip: 'text',
                                } : { color: 'var(--brand-primary)' }}>
                                {lead.deal_value.toLocaleString('fr-CA')} $
                              </span>
                            )}
                          </div>
                        )}

                        {/* Row 3 : Days + Source (compact footer) */}
                        <div className="flex items-center justify-between text-[10px] mt-2 pt-2"
                          style={{ borderTop: `1px solid ${isHot ? 'rgba(0,157,219,0.15)' : 'rgba(0,0,0,0.05)'}` }}>
                          <span className="flex items-center gap-1 font-semibold tabular-nums" style={{ color: daysColor(days) }}>
                            <Clock size={10} />
                            {days}j
                            {isDormant && <span className="ml-0.5">⚠</span>}
                          </span>
                          <span className="text-[var(--text-muted)] truncate max-w-[100px] uppercase tracking-wider text-[9px] font-medium">
                            {SOURCE_LABELS[lead.source] || lead.source}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'list' ? (
        /* ── Vue Liste ── */
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Contact</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Client</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Stage</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Type</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Valeur</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Score</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Jours</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Source</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => {
                  const days = getDaysInStage(lead);
                  const stage = stages.find(s => s.id === (lead.stage_id || stages[0]?.id));
                  return (
                    <tr key={lead.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/leads/${lead.id}`} className="flex items-center gap-2 hover:text-[var(--brand-primary)]">
                          <Avatar name={lead.name} size="xs" />
                          <span className="font-medium text-[13px]">{lead.name}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{lead.client_name || '—'}</td>
                      <td className="px-4 py-3">
                        {stage && <Badge color={stage.color}>{stage.name}</Badge>}
                      </td>
                      <td className="px-4 py-3"><Badge color={lead.type === 'inbound' ? 'var(--brand-primary)' : 'var(--warning)'}>{lead.type === 'inbound' ? 'Entrant' : 'Client'}</Badge></td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-[var(--brand-primary)]">{lead.deal_value > 0 ? `${lead.deal_value.toLocaleString('fr-CA')} $` : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${lead.score}%`, background: scoreColor(lead.score) }} />
                          </div>
                          <span className="text-[10px] font-semibold" style={{ color: scoreColor(lead.score) }}>{lead.score}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium" style={{ color: daysColor(days) }}>{days}j</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{SOURCE_LABELS[lead.source] || lead.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* ── Vue Forecast ── */
        <ForecastView pipelineId={activePipelineId!} />
      )}

      {/* ── Modal Lost Reason ── */}
      <Modal open={lostModal.show} onOpenChange={() => setLostModal({ leadId: '', show: false })} title="Marquer comme perdu">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Raison de la perte</label>
            <select value={lostReason} onChange={e => setLostReason(e.target.value)}
              className="w-full h-[38px] px-3 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none">
              <option value="">Sélectionner une raison...</option>
              {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Détails (optionnel)</label>
            <textarea value={lostDetails} onChange={e => setLostDetails(e.target.value)} rows={3} placeholder="Notes supplémentaires..."
              className="w-full px-3 py-2.5 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-lg placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLostModal({ leadId: '', show: false })}>Annuler</Button>
            <Button onClick={() => void confirmLost()} className="!bg-[var(--danger)] hover:!bg-[var(--danger)]/90">Confirmer la perte</Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}