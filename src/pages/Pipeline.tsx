// ── Page Pipeline — Kanban refondu Sprint Design 2 (D2.1) + Multi-Pipelines (Phase C)
import { useState, useEffect, useCallback, type DragEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { t } from '@/lib/i18n';
import { Badge, Button, EmptyState, PageHero, Select } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { getPipeline, getPipelines, updateLead, getLeadConversionScore } from '@/lib/api';
import { confettiBurst } from '@/lib/confetti';
import { TYPE_LABELS, SOURCE_LABELS, type Lead, type Pipeline, type PipelineStage } from '@/lib/types';
import { MoreHorizontal, ChevronDown, LayoutList, BarChart3, Kanban, Filter, Clock, DollarSign, TrendingUp, AlertTriangle, X, Check, Flame } from 'lucide-react';
import { ForecastView } from '@/components/pipelines/ForecastView';
// Sprint 21 — Onboarding durci : auto-complète 'pipeline_configured' dès que
// l'user a un pipeline avec au moins une étape (idempotent, best-effort).
import { useOnboardingItemCompletion } from '@/components/onboarding/useOnboardingItemCompletion';

// Sprint LOT 1-3 — Liste de clés i18n pour les raisons de perte (translation au render via t())
const LOST_REASON_KEYS = [
  'pipeline.page.lost_reason_price',
  'pipeline.page.lost_reason_competitor',
  'pipeline.page.lost_reason_timing',
  'pipeline.page.lost_reason_no_response',
  'pipeline.page.lost_reason_financing',
  'pipeline.page.lost_reason_plan_change',
  'pipeline.page.lost_reason_other',
] as const;

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
  // ── Sprint 13 — proba de conversion calibrée + filtre « leads chauds ». ──
  // Best-effort : map leadId → proba (0..100). Score absent ⇒ pas d'entrée.
  const [convProba, setConvProba] = useState<Record<string, number>>({});
  const [hotOnly, setHotOnly] = useState(false);
  const HOT_THRESHOLD = 60; // proba calibrée ≥ 60 % = lead chaud

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

  // ── Sprint 13 — proba de conversion calibrée par lead (best-effort) ──
  // Borné à 30 leads (fan-out maîtrisé). Appels isolés (catch) : un échec
  // n'altère ni le kanban ni les autres probas. Score absent / KO ⇒ pas
  // d'entrée ⇒ badge masqué (jamais de crash).
  useEffect(() => {
    let alive = true;
    const targets = leads.slice(0, 30);
    if (targets.length === 0) return;
    void Promise.all(
      targets.map(async (l) => {
        try {
          const r = await getLeadConversionScore(l.id);
          const p = r.data?.probability;
          if (typeof p === 'number' && p > 0) return [l.id, p] as const;
        } catch { /* best-effort */ }
        return null;
      }),
    ).then((pairs) => {
      if (!alive) return;
      const next: Record<string, number> = {};
      for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
      setConvProba(next);
    });
    return () => { alive = false; };
  }, [leads]);

  const hasAnyConvProba = Object.keys(convProba).length > 0;

  const activePipeline = pipelines.find(p => p.id === activePipelineId) || pipelines[0];
  const stages = activePipeline?.stages || [];

  // ── Sprint 21 (Onboarding durci) — auto-complète 'pipeline_configured' dès
  //    que le tenant a un pipeline avec au moins une étape configurée. Le hook
  //    est idempotent (un seul appel API par session) et silencieux en cas
  //    d'échec API. Condition basée sur l'état déjà chargé — pas de fetch
  //    supplémentaire.
  const isPipelineCustomized = stages.length > 0;
  useOnboardingItemCompletion('pipeline_configured', isPipelineCustomized);

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

  // Sprint 13 — filtre « leads chauds » (best-effort : si aucune proba chargée,
  // on n'écrème pas pour éviter un pipeline vide).
  const isHotLead = (l: Lead) => (convProba[l.id] ?? 0) >= HOT_THRESHOLD;
  const visibleLeads = (hotOnly && hasAnyConvProba) ? leads.filter(isHotLead) : leads;
  const getColumnLeads = (stageId: string) => visibleLeads.filter(l => (l.stage_id || stages[0]?.id) === stageId);
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
    <AppLayout title={t('pipeline.page.highlight')}>
      <PageHero
        compact
        meta={t('pipeline.page.meta')}
        title={t('pipeline.page.title')}
        highlight={t('pipeline.page.highlight')}
        description={t('pipeline.page.description')}
      />
      {/* ── Header : Pipeline selector + KPIs sticky ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5 relative">
        {/* Pipeline selector */}
        <div className="relative">
          <button 
            onClick={() => setIsPipelinesDropdownOpen(!isPipelinesDropdownOpen)}
            className="surface-card flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--primary)] cursor-pointer press-scale"
          >
            {activePipeline?.name || t('pipeline.loading')} <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          
          {isPipelinesDropdownOpen && pipelines.length > 0 && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsPipelinesDropdownOpen(false)} />
              <div className="absolute top-full left-0 mt-1 w-56 surface-card z-20 py-1 overflow-hidden animate-fade-in-up" style={{ boxShadow: 'var(--shadow-overlay)' }}>
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
                    {p.id === activePipelineId && <Check size={14} className="text-[var(--primary)]" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* KPIs inline — Sprint 23 : mini hero cards */}
        <div className="flex items-stretch gap-2 ml-2">
          {/* KPI Valeur */}
          <div className="stat-card flex items-center gap-2 px-3 py-2 hover-lift cursor-default animate-fade-in-up stagger-1">
            <div className="stat-icon-chip" style={{ background: 'linear-gradient(135deg, #635BFF 0%, #5851E5 100%)' }}>
              <DollarSign size={15} className="text-white" />
            </div>
            <div>
              <p className="text-meta-label">{t('pipeline.kpi.value')}</p>
              <p className="text-sm font-bold tabular-nums leading-tight text-[var(--primary)]">
                {totalValue.toLocaleString('fr-CA')} <span className="text-[10px] text-[var(--text-muted)]">$</span>
              </p>
            </div>
          </div>

          {/* KPI Prévision */}
          <div className="stat-card flex items-center gap-2 px-3 py-2 hover-lift cursor-default animate-fade-in-up stagger-2">
            <div className="stat-icon-chip" style={{ background: 'linear-gradient(135deg, #37CA37 0%, #2ba62b 100%)' }}>
              <TrendingUp size={15} className="text-white" />
            </div>
            <div>
              <p className="text-meta-label">{t('pipeline.kpi.forecast')}</p>
              <p className="text-sm font-bold tabular-nums leading-tight text-[var(--success)]">
                {weightedForecast.toLocaleString('fr-CA')} <span className="text-[10px] text-[var(--text-muted)]">$</span>
              </p>
            </div>
          </div>

          {/* KPI Dormants */}
          <div className="stat-card flex items-center gap-2 px-3 py-2 hover-lift cursor-default animate-fade-in-up stagger-3">
            <div className="stat-icon-chip" style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' }}>
              <AlertTriangle size={15} className="text-white" />
            </div>
            <div>
              <p className="text-meta-label">{t('pipeline.kpi.dormant')}</p>
              <p className="text-sm font-bold tabular-nums leading-tight text-[var(--warning)]">
                {dormantCount}
              </p>
            </div>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sprint 13 — filtre « leads chauds » (proba calibrée ≥ seuil).
            Affiché seulement quand au moins une proba a été chargée (best-effort). */}
        {hasAnyConvProba && (
          <button onClick={() => setHotOnly(v => !v)}
            aria-pressed={hotOnly}
            title={t('conversion.hot_leads')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer press-scale transition-all ${hotOnly ? 'bg-[var(--primary)] text-white border border-[var(--primary)]' : 'surface-card text-[var(--text-secondary)] hover:border-[var(--primary)]'}`}>
            <Flame size={13} className={hotOnly ? 'text-white' : 'text-[var(--accent-orange)]'} /> {t('conversion.hot_leads')}
          </button>
        )}

        {/* Filtres */}
        <button onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer press-scale transition-all ${showFilters ? 'bg-[var(--primary)] text-white' : 'surface-card text-[var(--text-secondary)] hover:border-[var(--primary)]'}`}>
          <Filter size={13} /> {t('pipeline.filter.label')}
          {activeFilters.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-[var(--bg-surface)]/20 text-[10px] flex items-center justify-center">{activeFilters.length}</span>}
        </button>

        {/* Vue switcher */}
        <div className="segmented-premium">
          {([['kanban', Kanban], ['list', LayoutList], ['forecast', BarChart3]] as const).map(([mode, Icon]) => {
            const viewLabel = mode === 'kanban' ? t('pipeline.page.view_kanban') : mode === 'list' ? t('pipeline.page.view_list') : t('pipeline.page.view_forecast');
            return (
            <button key={mode} onClick={() => setViewMode(mode as ViewMode)}
              aria-label={viewLabel} aria-pressed={viewMode === mode} title={viewLabel}
              className={`segmented-premium-item flex items-center justify-center p-1.5 ${viewMode === mode ? 'active' : ''}`}>
              <Icon size={15} />
            </button>
          );})}
        </div>
      </div>

      {/* Filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilters.map(f => (
            <span key={f} className="status-badge bg-[var(--primary-soft)] text-[var(--primary)]">
              {f} <button onClick={() => removeFilter(f)} className="cursor-pointer hover:text-[var(--danger)] press-scale"><X size={12} /></button>
            </span>
          ))}
          <button onClick={() => setActiveFilters([])} className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer">{t('pipeline.filter.clear')}</button>
        </div>
      )}

      {/* ── Kanban ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3" aria-busy="true" aria-live="polite">
          {[1,2,3,4,5,6].map(s => (
            <div key={s} className="space-y-3 animate-fade-in-up" style={{ animationDelay: `${s * 0.05}s` }}>
              <div className="skeleton-shimmer h-10 w-full" />
              <div className="skeleton-shimmer h-28 w-full" />
              <div className="skeleton-shimmer h-28 w-full" />
            </div>
          ))}
        </div>
      ) : leads.length === 0 && activeFilters.length === 0 ? (
        <EmptyState
          icon={<TrendingUp size={48} />}
          title={t('pipeline.empty.title')}
          description={t('pipeline.empty.description')}
          action={<Link to="/leads"><Button>{t('pipeline.empty.action')}</Button></Link>}
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
                className={`pipeline-column surface-card relative flex flex-col overflow-hidden shrink-0 w-[85vw] sm:w-72 snap-center sm:snap-start animate-fade-in-up stagger-${Math.min(stages.indexOf(stage) + 1, 8)} ${isOver ? 'ring-2' : ''}`}
                style={{
                  ['--stage-color' as string]: stage.color,
                  borderColor: hexToRgba(stage.color, isOver ? 0.55 : 0.25),
                  borderTopColor: stage.color,
                  borderTopWidth: '3px',
                  boxShadow: isOver
                    ? `0 0 0 3px ${hexToRgba(stage.color, 0.2)}, var(--shadow-md)`
                    : 'var(--shadow-sm)',
                }}
                onDragOver={e => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={e => void handleDrop(e, stage.id)}>

                {/* Indicateur de couleur stage — subtil Stripe */}

                {/* Header sticky Stripe-clean */}
                <div className="sticky top-0 z-10 px-4 py-3 surface-section">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="status-dot shrink-0" style={{ background: stage.color }} />
                      <h3 className="text-meta-label truncate" style={{ color: stage.color }}>{stage.name}</h3>
                    </div>
                    <span className="status-badge text-value-mono text-xs" style={{ background: hexToRgba(stage.color, 0.1), color: stage.color }}>
                      {colLeads.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {colValue > 0 ? (
                      <p className="text-[12px] text-value-mono text-[var(--text-primary)]">
                        {colValue.toLocaleString('fr-CA')} <span className="text-[var(--text-muted)] font-normal">$</span>
                      </p>
                    ) : (
                      <span className="text-subtitle">—</span>
                    )}
                    <span className="text-meta-label tabular-nums" style={{ color: stage.color }}>{prob}%</span>
                  </div>
                  <div className="h-1 mt-2 rounded-full overflow-hidden bg-[var(--bg-subtle)]">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${prob}%`, background: stage.color }} />
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
                        {t('pipeline.page.drop_here')}
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
                        className={`group relative surface-card-interactive p-4 cursor-grab active:cursor-grabbing hover-lift ${
                          isHot ? 'hot-lead-card' : ''
                        } ${draggedId === lead.id ? 'opacity-40 scale-95 rotate-1' : ''}`}
                        style={{
                          borderLeft: isDormant ? '3px solid var(--warning)' : undefined,
                          borderColor: isHot ? 'rgba(99, 91, 255, 0.55)' : undefined,
                        }}>

                        {/* Badge HOT en absolute top-right pour hot leads */}
                        {isHot && (
                          <div className="absolute -top-2 -right-2 status-badge text-[10px] text-white tracking-wider shrink-0 z-10"
                            style={{ background: 'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)', boxShadow: '0 4px 12px rgba(99, 91, 255, 0.45)' }}>
                            HOT {lead.score}
                          </div>
                        )}

                        {/* Row 1 : Avatar + Name + Score (non-hot) + 3-dots */}
                        <div className="flex items-start gap-2 mb-2 relative">
                          <Avatar name={lead.name} size="xs" ring={isHot ? 'hot' : 'none'} />
                          <div className="flex-1 min-w-0">
                            <Link to={`/leads/${lead.id}`} className="text-[13px] font-semibold text-[var(--text-primary)] hover:text-[var(--primary)] transition-colors truncate block leading-tight">
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
                          <button className="reveal-on-hover p-1 -m-1 rounded-md hover:bg-[var(--bg-subtle)] transition-all cursor-pointer text-[var(--text-muted)] shrink-0 press-scale" aria-label={t('pipeline.page.card_actions_aria')} title={t('pipeline.page.card_actions_title')}>
                            <MoreHorizontal size={14} />
                          </button>
                        </div>

                        {/* Row 2 : Type pill + Deal value (uniquement si > 0) */}
                        {(hasDeal || lead.type === 'customer') && (
                          <div className="flex items-center justify-between mb-2">
                            <Badge color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>{TYPE_LABELS[lead.type]}</Badge>
                            {hasDeal && (
                              <span className="text-[12px] font-bold tabular-nums"
                                style={isHot ? {
                                  background: 'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
                                  WebkitBackgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                  backgroundClip: 'text',
                                } : { color: 'var(--primary)' }}>
                                {lead.deal_value.toLocaleString('fr-CA')} $
                              </span>
                            )}
                          </div>
                        )}

                        {/* Row 3 : Days + Source (compact footer) */}
                        <div className="flex items-center justify-between text-[10px] mt-2 pt-2 border-t border-[var(--border)]">
                          <span className="flex items-center gap-1 font-semibold tabular-nums" style={{ color: daysColor(days) }}>
                            <Clock size={10} />
                            {days}j
                            {isDormant && <span className="ml-0.5">⚠</span>}
                          </span>
                          <span className="text-[var(--text-muted)] truncate max-w-[100px] uppercase tracking-wider text-[9px] font-medium">
                            {SOURCE_LABELS[lead.source] || lead.source}
                          </span>
                        </div>

                        {/* Sprint 13 — proba de conversion calibrée (best-effort) */}
                        {(() => {
                          const proba = convProba[lead.id];
                          if (proba === undefined) return null;
                          return (
                            <div className="flex items-center justify-between mt-1.5 text-[9px]">
                              <span className="text-[var(--text-muted)] uppercase tracking-wider font-medium">{t('conversion.probability')}</span>
                              <span className="inline-flex items-center gap-0.5 px-1.5 h-[15px] rounded-full font-semibold tabular-nums"
                                style={{
                                  background: isHotLead(lead) ? 'color-mix(in oklch, var(--accent-orange) 14%, transparent)' : 'var(--bg-subtle)',
                                  color: isHotLead(lead) ? 'var(--accent-orange)' : 'var(--text-muted)',
                                }}>
                                {isHotLead(lead) && <Flame size={9} />}
                                {Math.round(proba)}%
                              </span>
                            </div>
                          );
                        })()}
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
        <div className="surface-card overflow-hidden animate-fade-in-up">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="table-header-cell">{t('pipeline.list.contact')}</th>
                  <th className="table-header-cell">{t('pipeline.list.client')}</th>
                  <th className="table-header-cell">{t('pipeline.list.stage')}</th>
                  <th className="table-header-cell">{t('pipeline.list.type')}</th>
                  <th className="table-header-cell text-right">{t('pipeline.list.value')}</th>
                  <th className="table-header-cell">{t('pipeline.list.score')}</th>
                  <th className="table-header-cell">{t('pipeline.list.days')}</th>
                  <th className="table-header-cell">{t('pipeline.list.source')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleLeads.map(lead => {
                  const days = getDaysInStage(lead);
                  const stage = stages.find(s => s.id === (lead.stage_id || stages[0]?.id));
                  return (
                    <tr key={lead.id} className="border-b border-[var(--border)] row-hover-reveal">
                      <td className="px-4 py-3">
                        <Link to={`/leads/${lead.id}`} className="flex items-center gap-2 hover:text-[var(--primary)]">
                          <Avatar name={lead.name} size="xs" />
                          <span className="font-medium text-[13px]">{lead.name}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-subtitle">{lead.client_name || '—'}</td>
                      <td className="px-4 py-3">
                        {stage && <Badge color={stage.color}>{stage.name}</Badge>}
                      </td>
                      <td className="px-4 py-3"><Badge color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>{lead.type === 'inbound' ? t('pipeline.list.type_inbound') : t('pipeline.list.type_customer')}</Badge></td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-[var(--primary)]">{lead.deal_value > 0 ? `${lead.deal_value.toLocaleString('fr-CA')} $` : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${lead.score}%`, background: scoreColor(lead.score) }} />
                          </div>
                          <span className="text-[10px] font-semibold" style={{ color: scoreColor(lead.score) }}>{lead.score}</span>
                          {/* Sprint 13 — badge proba conversion calibrée (best-effort) */}
                          {(() => {
                            const proba = convProba[lead.id];
                            if (proba === undefined) return null;
                            return (
                              <span title={t('conversion.probability')}
                                className="inline-flex items-center gap-0.5 px-1.5 h-[16px] rounded-full text-[9px] font-semibold tabular-nums"
                                style={{
                                  background: isHotLead(lead) ? 'color-mix(in oklch, var(--accent-orange) 14%, transparent)' : 'var(--bg-muted)',
                                  color: isHotLead(lead) ? 'var(--accent-orange)' : 'var(--text-muted)',
                                }}>
                                {isHotLead(lead) && <Flame size={9} />}
                                {Math.round(proba)}%
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium" style={{ color: daysColor(days) }}>{days}j</span>
                      </td>
                      <td className="px-4 py-3 text-meta-label">{SOURCE_LABELS[lead.source] || lead.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── Vue Forecast ── */
        <ForecastView pipelineId={activePipelineId!} />
      )}

      {/* ── Modal Lost Reason ── */}
      <Modal open={lostModal.show} onOpenChange={() => setLostModal({ leadId: '', show: false })} title={t('pipeline.lost.title')}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">{t('pipeline.lost.reason_label')}</label>
            <Select value={lostReason} onChange={e => setLostReason(e.target.value)}>
              <option value="">{t('pipeline.lost.reason_placeholder')}</option>
              {LOST_REASON_KEYS.map(k => { const label = t(k); return <option key={k} value={label}>{label}</option>; })}
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">{t('pipeline.lost.details_label')}</label>
            <textarea value={lostDetails} onChange={e => setLostDetails(e.target.value)} rows={3} placeholder={t('pipeline.lost.details_placeholder')}
              className="w-full px-3 py-2.5 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-lg placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLostModal({ leadId: '', show: false })}>{t('pipeline.lost.cancel')}</Button>
            <Button onClick={() => void confirmLost()} className="!bg-[var(--danger)] hover:!bg-[var(--danger)]/90">{t('pipeline.lost.confirm')}</Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}