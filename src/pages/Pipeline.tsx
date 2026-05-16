// ── Page Pipeline — Kanban refondu Sprint Design 2 (D2.1) + Multi-Pipelines (Phase C)
import { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useRouterState, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tag, Skeleton, Card, Button, EmptyState, KpiStrip, type KpiItem, SmartBanner, AvatarGroup, AppliedFiltersBar, type FilterDescriptor, EmptyStateIllustration, Icon, ContextualActionsSheet, type ContextualAction } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { getPipeline, getPipelines, updateLead } from '@/lib/api';
import { confettiBurst } from '@/lib/confetti';
import { TYPE_LABELS, SOURCE_LABELS, type Lead, type Pipeline, type PipelineStage } from '@/lib/types';
import { MoreHorizontal, ChevronDown, LayoutList, BarChart3, Kanban, Filter, Clock, DollarSign, TrendingUp, AlertTriangle, Check, ExternalLink, Archive, Copy, Pencil, ArrowRightCircle, Sparkles } from 'lucide-react';
// Sprint 43 M1.2 — ForecastView lazy : tire Recharts (vendor-recharts ~135 KB
// gzip) → ne charge QUE si l'user clique sur la vue Forecast.
const ForecastView = lazy(() => import('@/components/pipelines/ForecastView').then(m => ({ default: m.ForecastView })));
import { useLeadHoverPreview } from '@/components/panels/LeadHoverPreview';
// Sprint 49 M3.3 — AI smart sort 6 heuristiques (tri intra-colonne kanban)
import { applyAiSort, AI_SORT_MODES, AI_SORT_LABELS, AI_SORT_DESCRIPTIONS, type AiSortMode } from '@/lib/aiSort';
import {
  DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem as DDItem, DropdownMenuLabel as DDLabel, DropdownMenuSeparator as DDSep,
} from '@/components/ui/DropdownMenu';
// Sprint 48 M3.3 — currency formatting via Intl
import { formatMoneyCAD } from '@/lib/i18n/number';
import { plural } from '@/lib/i18n/plural';
import { getLocale } from '@/lib/i18n';
import { useLongPress } from '@/hooks/useLongPress';
// Sprint 30 vague 30-3C — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
// Sprint 33 vague 33-3A — Haptic feedback (snap mode change)
import { useHaptic } from '@/hooks/useHaptic';
// Sprint 44 M3.2 — Ancien import DropdownMenu retiré : remplacé par ContextualActionsSheet
// (BottomSheet uniforme pour long-press contextual menu mobile).
// Sprint 45 M3.2 — Coachmark contextuel (1ère visite → drag-drop hint)
import { ContextualCoachmark } from '@/components/onboarding/ContextualCoachmark';
// Sprint 49 M2.2 — Détection de goulots pipeline
import { fetchBottlenecks, detectBottlenecksLocal, type Bottleneck } from '@/lib/pipelineBottleneck';

const LOST_REASONS = ['Prix trop élevé', 'Concurrent choisi', 'Mauvais timing', 'Pas de réponse', 'Financement refusé', 'Changement de plan', 'Autre'];

type ViewMode = 'kanban' | 'list' | 'forecast';

// ── Sprint 33 vague 33-3A — Pipeline card resize ─────────────────────────
// 3 modes hauteur snap : compact 80 / normal 140 / expanded 240 px.
// Persist per-lead dans localStorage.
type CardHeightMode = 'compact' | 'normal' | 'expanded';
// Référence hauteurs snap (utilisé dans pickHeightModeForDelta + CSS)
const _CARD_HEIGHT_PX: Record<CardHeightMode, number> = {
  compact: 80,
  normal: 140,
  expanded: 240,
};
void _CARD_HEIGHT_PX; // Empêche TS6133 — constante de référence documentaire
const CARD_HEIGHT_STORAGE_KEY = 'intralys_pipeline_card_heights';
const CARD_HEIGHT_MODES: CardHeightMode[] = ['compact', 'normal', 'expanded'];
function readCardHeights(): Record<string, CardHeightMode> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CARD_HEIGHT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, CardHeightMode> = {};
    for (const k of Object.keys(parsed)) {
      const v = parsed[k];
      if (v === 'compact' || v === 'normal' || v === 'expanded') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
function pickHeightModeForDelta(baseMode: CardHeightMode, deltaY: number): CardHeightMode {
  // Drag bottom : deltaY positif → cycle vers expanded. négatif → cycle vers compact.
  // Seuils : on snap chaque 60px de drag.
  const STEP_PX = 60;
  const baseIdx = CARD_HEIGHT_MODES.indexOf(baseMode);
  const steps = Math.round(deltaY / STEP_PX);
  const nextIdx = Math.max(0, Math.min(CARD_HEIGHT_MODES.length - 1, baseIdx + steps));
  return CARD_HEIGHT_MODES[nextIdx]!;
}

// ── Sprint 31 vague 31-1A — Read URL params (?stage=&owner=) ──
// stage = stage_id ou stage name (slug normalisé) ; owner = assigned_to (raw string).
function readPipelineUrlState(): { stage: string | null; owner: string | null } {
  if (typeof window === 'undefined') return { stage: null, owner: null };
  const params = new URLSearchParams(window.location.search);
  return {
    stage: params.get('stage'),
    owner: params.get('owner'),
  };
}

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

  // ── Sprint 31 vague 31-1A — URL params (?stage=&owner=) hydratent au mount ──
  // CmdPalette / sidebar peut deep-link vers /pipeline?stage={id} ou ?owner={name}.
  // Bi-directionnel : changement local → URL replaceState.
  const initialPipelineUrl = useMemo(() => readPipelineUrlState(), []);
  const [stageFilter, setStageFilter] = useState<string | null>(initialPipelineUrl.stage);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(initialPipelineUrl.owner);

  useEffect(() => { localStorage.setItem('intralys_pipeline_viewmode', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('intralys_pipeline_filters', JSON.stringify(activeFilters)); }, [activeFilters]);

  // ── Sprint 33 vague 33-3A — Card heights state (per-lead) ──────────────
  const [cardHeights, setCardHeights] = useState<Record<string, CardHeightMode>>(() => readCardHeights());
  useEffect(() => {
    try { localStorage.setItem(CARD_HEIGHT_STORAGE_KEY, JSON.stringify(cardHeights)); } catch { /* noop quota */ }
  }, [cardHeights]);
  const setCardHeight = useCallback((leadId: string, mode: CardHeightMode) => {
    setCardHeights(prev => (prev[leadId] === mode ? prev : { ...prev, [leadId]: mode }));
  }, []);

  // ── Sprint 31 vague 31-1A — Persist stage/owner → URL replaceState ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (stageFilter) params.set('stage', stageFilter); else params.delete('stage');
    if (ownerFilter) params.set('owner', ownerFilter); else params.delete('owner');
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', newUrl);
  }, [stageFilter, ownerFilter]);

  // popstate sync (Back/Forward)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const next = readPipelineUrlState();
      setStageFilter(next.stage);
      setOwnerFilter(next.owner);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // TanStack Router sync (CmdPalette re-nav)
  const routerLocation = useRouterState({ select: (s) => s.location });
  // Sprint 49 M2.2 — navigation depuis la bannière goulot
  const pageNavigate = useNavigate();
  useEffect(() => {
    const next = readPipelineUrlState();
    setStageFilter((prev) => (next.stage !== prev ? next.stage : prev));
    setOwnerFilter((prev) => (next.owner !== prev ? next.owner : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerLocation.search]);

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
  // Sprint 25 vague 6B — drag premium : ghost image custom (clone DOM tilté +
  // shadow brand) injecté via setDragImage. Skip si prefers-reduced-motion.
  const handleDragStart = (e: DragEvent, leadId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leadId);
    setDraggedId(leadId);

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    // Cloner la carte source pour ghost custom — appended hidden, retire tick après
    const source = e.currentTarget as HTMLElement;
    if (!source || typeof source.cloneNode !== 'function') return;
    try {
      const clone = source.cloneNode(true) as HTMLElement;
      clone.classList.add('pipeline-ghost-card');
      clone.style.position = 'fixed';
      clone.style.top = '-1000px';
      clone.style.left = '-1000px';
      clone.style.width = `${source.offsetWidth}px`;
      clone.style.pointerEvents = 'none';
      clone.style.zIndex = '9999';
      document.body.appendChild(clone);
      // dx/dy : centre du clone au cursor
      e.dataTransfer.setDragImage(clone, source.offsetWidth / 2, 24);
      // Cleanup au tick suivant (le browser a déjà capturé le snapshot)
      setTimeout(() => {
        if (clone.parentNode) clone.parentNode.removeChild(clone);
      }, 0);
    } catch {
      /* Fallback : drag image native (browser default) */
    }
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

  // Sprint 31 vague 31-1A — Filtre owner (assigned_to) appliqué côté client
  const visibleLeads = useMemo(() => {
    if (!ownerFilter) return leads;
    const target = ownerFilter.trim().toLowerCase();
    return leads.filter(l => (l.assigned_to || '').trim().toLowerCase() === target);
  }, [leads, ownerFilter]);

  // Sprint 31 vague 31-1A — Filtre stage : matche par id OU par nom (case-insensitive)
  const visibleStages = useMemo(() => {
    if (!stageFilter) return stages;
    const target = stageFilter.toLowerCase();
    const match = stages.filter(s => s.id === stageFilter || s.name.toLowerCase() === target);
    return match.length > 0 ? match : stages; // fallback : si invalide, on garde tous (graceful)
  }, [stages, stageFilter]);

  // Sprint 49 M3.3 — AI smart sort appliqué intra-colonne (6 heuristiques).
  // null = ordre par défaut (back-compat : aucun changement de comportement).
  const [aiSortMode, setAiSortMode] = useState<AiSortMode | null>(null);

  const getColumnLeads = (stageId: string) => {
    const cols = visibleLeads.filter(l => (l.stage_id || stages[0]?.id) === stageId);
    return aiSortMode ? applyAiSort(cols, aiSortMode) : cols;
  };

  // ── Sprint 23 wave 44A2 — Assignees uniques par stage (memo) ──────────────
  const assigneesByStage = useMemo(() => {
    const map: Record<string, { name: string }[]> = {};
    for (const stage of stages) {
      const stageLeads = leads.filter(l => (l.stage_id || stages[0]?.id) === stage.id);
      const seen = new Set<string>();
      const list: { name: string }[] = [];
      for (const l of stageLeads) {
        const a = (l.assigned_to || '').trim();
        if (a && !seen.has(a)) {
          seen.add(a);
          list.push({ name: a });
        }
      }
      map[stage.id] = list;
    }
    return map;
  }, [leads, stages]);

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

  // ── Sprint 49 M2.2 — Détection de goulots (backend + fallback client) ──
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const remote = await fetchBottlenecks(activePipelineId ?? undefined);
      if (!active) return;
      setBottlenecks(remote ?? detectBottlenecksLocal(leads, stages));
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePipelineId, leads, stages]);
  const topBottleneck = bottlenecks[0];

  const removeFilter = (f: string) => setActiveFilters(prev => prev.filter(x => x !== f));

  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Sprint 30 vague 30-3C — Pull-to-refresh mobile
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await loadData(activePipelineId ?? undefined); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title="Pipeline">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />

      {/* ── Header Stripe-clean : titre + count + actions ── */}
      <header className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="t-h1">Pipeline</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {plural(getLocale(), leads.length, { one: '# deal', other: '# deals' })}
              {activePipeline ? ` · ${activePipeline.name}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Pipeline selector — sober */}
          <div className="relative">
            <button
              onClick={() => setIsPipelinesDropdownOpen(!isPipelinesDropdownOpen)}
              className="flex items-center gap-2 h-9 px-3 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
            >
              {activePipeline?.name || 'Chargement...'} <Icon as={ChevronDown} size={14} className="text-[var(--text-muted)]" />
            </button>

            {isPipelinesDropdownOpen && pipelines.length > 0 && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsPipelinesDropdownOpen(false)} />
                <div className="absolute top-full right-0 mt-1 w-56 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md shadow-md z-20 py-1 overflow-hidden">
                  {pipelines.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setActivePipelineId(p.id);
                        setIsPipelinesDropdownOpen(false);
                        void loadData(p.id);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] flex items-center justify-between"
                    >
                      {p.name}
                      {p.id === activePipelineId && <Icon as={Check} size="sm" className="text-[var(--primary)]" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Filtres */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm font-medium transition-colors cursor-pointer ${
              showFilters
                ? 'bg-[var(--bg-subtle)] border-[var(--border-default)] text-[var(--text-primary)]'
                : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
            }`}
            aria-label="Filtres"
          >
            <Icon as={Filter} size={13} />
            Filtres
            {activeFilters.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-[var(--primary)] text-white">
                {activeFilters.length}
              </span>
            )}
          </button>

          {/* Sprint 49 M3.3 — AI Smart Sort dropdown (6 heuristiques, tri intra-colonne) */}
          <DropdownMenuRoot>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`ai-sort-button ${aiSortMode ? 'ai-sort-button--active' : ''}`}
                aria-label="Trier intelligemment avec l'AI"
                title="Trier intelligemment (AI)"
              >
                <Sparkles size={12} className="ai-sort-sparkle" />
                <span>{aiSortMode ? AI_SORT_LABELS[aiSortMode] : 'Tri intelligent'}</span>
                <ChevronDown size={12} className="opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DDLabel>AI Smart Sort</DDLabel>
              {AI_SORT_MODES.map(mode => (
                <DDItem key={mode} onSelect={() => setAiSortMode(mode)}>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium flex items-center gap-1.5">
                      {aiSortMode === mode && <Check size={11} className="text-[var(--primary)]" />}
                      {AI_SORT_LABELS[mode]}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] leading-tight">
                      {AI_SORT_DESCRIPTIONS[mode]}
                    </span>
                  </div>
                </DDItem>
              ))}
              <DDSep />
              <DDItem onSelect={() => setAiSortMode(null)}>
                <span className="text-[var(--text-secondary)]">Tri par défaut</span>
              </DDItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>

          {/* Vue switcher — segmented control sober */}
          <div className="segmented-control segmented-control--icon">
            {([['kanban', Kanban, 'Kanban'], ['list', LayoutList, 'Liste'], ['forecast', BarChart3, 'Prévisions']] as const).map(([mode, ModeIcon, label]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode as ViewMode)}
                className={viewMode === mode ? 'is-active' : ''}
                aria-label={label}
                title={label}
              >
                <Icon as={ModeIcon} size={15} />
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Sprint 23 wave 18 — SmartBanner contextuel : dormants à relancer */}
      {dormantCount >= 3 && (
        <SmartBanner
          dismissKey="pipeline-dormants-tip"
          variant="warning"
          title={`${dormantCount} deals dormants depuis +7 jours`}
          description="Ces opportunités stagnent dans le pipeline. Une relance rapide augmente les chances de conversion de 40%."
          secondaryLabel="Plus tard"
          className="w-full mb-4"
        />
      )}

      {/* ── Sprint 49 M2.2 — Bannière goulot pipeline (Stripe sober) ── */}
      {topBottleneck && topBottleneck.stuckLeadIds.length > 0 && (
        <div className="pipeline-bottleneck-banner" role="status">
          <div className="pipeline-bottleneck-banner__icon" aria-hidden>
            <Icon as={AlertTriangle} size={15} />
          </div>
          <div className="pipeline-bottleneck-banner__body">
            <p className="pipeline-bottleneck-banner__title">
              {plural(getLocale(), topBottleneck.stuckLeadIds.length, {
                one: '# lead bloqué',
                other: '# leads bloqués',
              })}{' '}
              dans « {topBottleneck.stageName} » — {topBottleneck.avgDays}j en moyenne
              {' '}(vs ~{topBottleneck.baselineDays}j ailleurs)
            </p>
            <div className="pipeline-bottleneck-banner__actions">
              <button
                type="button"
                className="pipeline-bottleneck-banner__cta"
                onClick={() => setStageFilter(topBottleneck.stageId)}
              >
                Voir les leads concernés
              </button>
              <button
                type="button"
                className="pipeline-bottleneck-banner__cta pipeline-bottleneck-banner__cta--ai"
                onClick={() => void pageNavigate({ to: '/leads' })}
              >
                <Icon as={TrendingUp} size={12} />
                Suggérer relances IA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KPI Strip — Sprint 23 wave 16 (unified GHL pattern), sober Stripe */}
      <KpiStrip
        className="mb-5"
        items={(() => {
          const items: KpiItem[] = [
            { label: 'Total deals', value: leads.length, color: 'brand', icon: <Icon as={DollarSign} size={11} /> },
            { label: 'Valeur $', value: `${(totalValue / 1000).toFixed(1)}K`, color: 'brand' },
            { label: 'Prévision $', value: `${(weightedForecast / 1000).toFixed(1)}K`, color: 'success', icon: <Icon as={TrendingUp} size={11} /> },
            { label: 'Dormants', value: dormantCount, color: 'warning', icon: <Icon as={AlertTriangle} size={11} /> },
          ];
          return items;
        })()}
      />

      {/* Filter chips — Sprint 24 vague 2 : AppliedFiltersBar premium */}
      {/* Sprint 31 vague 31-1A — chips stage + owner depuis URL params */}
      {(activeFilters.length > 0 || stageFilter || ownerFilter) && (
        <div className="mb-4">
          <AppliedFiltersBar
            filters={[
              ...(stageFilter ? [{
                id: 'stage',
                label: 'Stage',
                value: stages.find(s => s.id === stageFilter)?.name || stageFilter,
                onRemove: () => setStageFilter(null),
              } satisfies FilterDescriptor] : []),
              ...(ownerFilter ? [{
                id: 'owner',
                label: 'Owner',
                value: ownerFilter,
                onRemove: () => setOwnerFilter(null),
              } satisfies FilterDescriptor] : []),
              ...activeFilters.map(f => ({
                id: f,
                label: f,
                onRemove: () => removeFilter(f),
              } satisfies FilterDescriptor)),
            ]}
            onClearAll={() => { setActiveFilters([]); setStageFilter(null); setOwnerFilter(null); }}
          />
        </div>
      )}

      {/* ── Kanban ── */}
      {isLoading ? (
        /* Skeleton matche kanban réel : 5 cols stages + 3-5 cards/col (Stripe sober) */
        <div className="flex gap-3 overflow-x-hidden pb-4 min-h-[calc(100vh-14rem)]">
          {[0,1,2,3,4].map(s => {
            const cardsPerCol = [4, 5, 3, 4, 3][s] ?? 4;
            return (
            <div
              key={s}
              className="shrink-0 w-[85vw] sm:w-72 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden"
              style={{ animationDelay: `${s * 40}ms` }}
            >
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-2 w-2 rounded-full" style={{ animationDelay: `${s * 40}ms` }} />
                    <Skeleton className="h-3 w-20 rounded" style={{ animationDelay: `${s * 40 + 20}ms` }} />
                  </div>
                  <Skeleton className="h-4 w-8 rounded-md" style={{ animationDelay: `${s * 40 + 40}ms` }} />
                </div>
                <Skeleton className="h-3.5 w-16 rounded" style={{ animationDelay: `${s * 40 + 60}ms` }} />
                <Skeleton className="h-1 w-full rounded-full" style={{ animationDelay: `${s * 40 + 80}ms` }} />
              </div>
              <div className="p-2 space-y-2">
                {Array.from({ length: cardsPerCol }).map((_, c) => {
                  return (
                  <div
                    key={c}
                    className="rounded-lg border border-[var(--border-subtle)] p-3 space-y-2 bg-[var(--bg-surface)] relative"
                    style={{
                      animationDelay: `${(s * cardsPerCol + c) * 40}ms`,
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <Skeleton className="h-6 w-6 rounded-full shrink-0" style={{ animationDelay: `${(s * cardsPerCol + c) * 40}ms` }} />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-3 w-3/4 rounded" style={{ animationDelay: `${(s * cardsPerCol + c) * 40 + 20}ms` }} />
                        <Skeleton className="h-2.5 w-1/2 rounded" style={{ animationDelay: `${(s * cardsPerCol + c) * 40 + 40}ms` }} />
                      </div>
                      <Skeleton className="h-4 w-8 rounded-full shrink-0" style={{ animationDelay: `${(s * cardsPerCol + c) * 40 + 60}ms` }} />
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
                      <Skeleton className="h-2.5 w-10 rounded" style={{ animationDelay: `${(s * cardsPerCol + c) * 40 + 80}ms` }} />
                      <Skeleton className="h-2.5 w-14 rounded" style={{ animationDelay: `${(s * cardsPerCol + c) * 40 + 100}ms` }} />
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      ) : leads.length === 0 && activeFilters.length === 0 ? (
        <EmptyState
          variant="first-time"
          illustration={<EmptyStateIllustration kind="pipeline" size={160} />}
          title="Pipeline vide"
          description="Ajoute des étapes et glisse des leads pour visualiser ta progression commerciale."
          action={<Link to="/leads"><Button variant="primary">Voir mes leads</Button></Link>}
        />
      ) : viewMode === 'kanban' ? (
        <div className="print-pipeline-kanban flex gap-3 overflow-x-auto pb-4 min-h-[calc(100vh-14rem)] snap-x snap-mandatory custom-scrollbar pr-4">
          {/* Sprint 31 vague 31-1A — visibleStages filtre stage; visibleLeads filtre owner */}
          {visibleStages.map(stage => {
            const colLeads = getColumnLeads(stage.id);
            const isOver = dropTarget === stage.id;
            const colValue = colLeads.reduce((s, l) => s + (l.deal_value || 0), 0);
            const prob = getStageProbability(stage);

            return (
              <div key={stage.id}
                className="pipeline-column relative flex flex-col rounded-lg overflow-hidden transition-colors shrink-0 w-[85vw] sm:w-72 snap-center sm:snap-start bg-[var(--bg-surface)]"
                style={{
                  ['--stage-color' as string]: stage.color,
                  border: `1px solid ${isOver ? 'var(--primary)' : 'var(--border-subtle)'}`,
                  boxShadow: isOver
                    ? '0 0 0 3px var(--ring), 0 1px 2px rgba(15,23,42,0.04)'
                    : '0 1px 2px rgba(15,23,42,0.04)',
                }}
                onDragOver={e => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={e => void handleDrop(e, stage.id)}>

                {/* Header sticky sober */}
                <div className="sticky top-0 z-10 px-4 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: stage.color }} />
                      <h3 className="t-h3 text-[12px] font-semibold uppercase tracking-wider truncate text-[var(--text-primary)]">{stage.name}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Tag size="xs" variant="neutral">{colLeads.length}</Tag>
                      {assigneesByStage[stage.id] && assigneesByStage[stage.id]!.length > 0 && (
                        <AvatarGroup
                          avatars={assigneesByStage[stage.id]!}
                          max={4}
                          size="xs"
                          aria-label={`${assigneesByStage[stage.id]!.length} assigné${assigneesByStage[stage.id]!.length > 1 ? 's' : ''} dans ${stage.name}`}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {colValue > 0 ? (
                      <p className="text-[12px] font-semibold tabular-nums text-[var(--text-primary)]">
                        {formatMoneyCAD(colValue, getLocale())}
                      </p>
                    ) : (
                      <span className="text-[10px] text-[var(--text-muted)]">—</span>
                    )}
                    <span className="text-[10px] font-semibold tabular-nums text-[var(--text-muted)]">{prob}%</span>
                  </div>
                  <div className="h-1 mt-2 rounded-full overflow-hidden bg-[var(--bg-subtle)]">
                    <div className="h-full rounded-full transition-all duration-500 bg-[var(--primary)]"
                      style={{ width: `${prob}%` }} />
                  </div>
                </div>

                {/* Drop indicator — Phase 1 sober */}
                {isOver && (
                  <div className="pipeline-drop-zone-pulse mx-3 mb-2 h-1.5 rounded-full" />
                )}

                {/* Cards */}
                <div className="flex-1 space-y-2 px-2 py-2 overflow-y-auto max-h-[calc(100vh-20rem)] custom-scrollbar">
                  {colLeads.length === 0 && (
                    draggedId ? (
                      <div className="text-center py-8 text-[10px] text-[var(--text-muted)] border-2 border-dashed rounded-xl mx-1 transition-colors" style={{ borderColor: isOver ? stage.color : 'var(--border-subtle)' }}>
                        Déposez ici
                      </div>
                    ) : (
                      <div className="text-center py-6 text-[10px] text-[var(--text-muted)] mx-1 opacity-40">—</div>
                    )
                  )}
                  {colLeads.map(lead => (
                    <PipelineLeadCard
                      key={lead.id}
                      lead={lead}
                      stage={stage}
                      stages={stages}
                      draggedId={draggedId}
                      onDragStart={handleDragStart}
                      onChangeStage={async (newStageId) => {
                        const targetStage = stages.find(s => s.id === newStageId);
                        if (targetStage?.probability === 0) {
                          setLostModal({ leadId: lead.id, show: true });
                          return;
                        }
                        setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage_id: newStageId } : l));
                        if (targetStage?.probability === 100) confettiBurst();
                        const result = await updateLead(lead.id, { stage_id: newStageId });
                        if (result.error) void loadData(activePipelineId!);
                      }}
                      getDaysInStage={getDaysInStage}
                      scoreColor={scoreColor}
                      daysColor={daysColor}
                      hexToRgba={hexToRgba}
                      heightMode={cardHeights[lead.id] || 'normal'}
                      onHeightChange={(mode) => setCardHeight(lead.id, mode)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'list' ? (
        /* ── Vue Liste — Stripe-clean table-premium ── */
        <div className="table-premium-container">
          <table className="table-premium w-full text-left border-collapse">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Client</th>
                <th>Stage</th>
                <th>Type</th>
                <th className="text-right">Valeur</th>
                <th>Score</th>
                <th>Jours</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {/* Sprint 31 vague 31-1A — vue liste utilise visibleLeads + filtre par visibleStages */}
              {visibleLeads
                .filter(l => visibleStages.some(s => s.id === (l.stage_id || stages[0]?.id)))
                .map(lead => {
                const days = getDaysInStage(lead);
                const stage = stages.find(s => s.id === (lead.stage_id || stages[0]?.id));
                return (
                  <tr key={lead.id} className="row-premium">
                    <td>
                      <Link to={`/leads/${lead.id}`} className="flex items-center gap-2 hover:text-[var(--primary)]">
                        <Avatar name={lead.name} size="xs" />
                        <span className="font-medium text-[13px] text-[var(--text-primary)]">{lead.name}</span>
                      </Link>
                    </td>
                    <td className="text-xs text-[var(--text-secondary)]">{lead.client_name || '—'}</td>
                    <td>
                      {stage && (
                        <Tag
                          size="sm"
                          /* Sprint 40 40-1B — variant + statusIcon dérivés depuis probability */
                          variant={
                            stage.probability >= 90 ? 'success' :
                            stage.probability === 0 ? 'danger' :
                            stage.probability >= 50 ? 'warning' :
                            'info'
                          }
                          statusIcon
                        >
                          {stage.name}
                        </Tag>
                      )}
                    </td>
                    <td><Tag dot size="sm" color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>{lead.type === 'inbound' ? 'Entrant' : 'Client'}</Tag></td>
                    <td className="text-right text-xs font-semibold text-[var(--text-primary)] t-mono-num">{lead.deal_value > 0 ? formatMoneyCAD(lead.deal_value, getLocale()) : '—'}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${lead.score}%`, background: scoreColor(lead.score) }} />
                        </div>
                        <span className="text-[10px] font-semibold tabular-nums" style={{ color: scoreColor(lead.score) }}>{lead.score}</span>
                      </div>
                    </td>
                    <td>
                      <span className="text-xs font-medium tabular-nums" style={{ color: daysColor(days) }}>{days}j</span>
                    </td>
                    <td className="text-xs text-[var(--text-muted)]">{SOURCE_LABELS[lead.source] || lead.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Vue Forecast ── (Sprint 43 M1.2 — lazy Recharts) */
        <Suspense fallback={<div className="p-6"><Skeleton className="h-[300px] w-full rounded-lg" /></div>}>
          <ForecastView pipelineId={activePipelineId!} />
        </Suspense>
      )}

      {/* ── Modal Lost Reason ── */}
      <Modal open={lostModal.show} onOpenChange={() => setLostModal({ leadId: '', show: false })} title="Marquer comme perdu">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Raison de la perte</label>
            <select value={lostReason} onChange={e => setLostReason(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none">
              <option value="">Sélectionner une raison...</option>
              {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Détails (optionnel)</label>
            <textarea value={lostDetails} onChange={e => setLostDetails(e.target.value)} rows={3} placeholder="Notes supplémentaires..."
              className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-md placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLostModal({ leadId: '', show: false })}>Annuler</Button>
            <Button onClick={() => void confirmLost()} className="!bg-[var(--danger)] hover:!bg-[var(--danger)]/90">Confirmer la perte</Button>
          </div>
        </div>
      </Modal>
      </div>
      {/* Sprint 45 M3.2 — Coachmark contextuel : "Glisse cette carte vers une autre étape" */}
      <ContextualCoachmark page="pipeline" />
    </AppLayout>
  );
}

// ── PipelineLeadCard — Sprint 23 wave 11 : extract pour hover preview hook ──
// Le hook `useLeadHoverPreview` est appelé par card; le wrapping div garde
// l'API drag & drop intacte. Désactivé sur pointer:coarse (touch).
interface PipelineLeadCardProps {
  lead: Lead;
  stage: PipelineStage;
  stages: PipelineStage[];
  draggedId: string | null;
  onDragStart: (e: DragEvent, leadId: string) => void;
  onChangeStage: (stageId: string) => Promise<void> | void;
  getDaysInStage: (lead: Lead) => number;
  scoreColor: (s: number) => string;
  daysColor: (d: number) => string;
  hexToRgba: (hex: string, alpha: number) => string;
  // ── Sprint 33 vague 33-3A — Resize hauteur per-card ──
  heightMode: CardHeightMode;
  onHeightChange: (mode: CardHeightMode) => void;
}

function PipelineLeadCard({
  lead,
  stage,
  stages,
  draggedId,
  onDragStart,
  onChangeStage,
  getDaysInStage,
  scoreColor,
  daysColor,
  hexToRgba,
  heightMode,
  onHeightChange,
}: PipelineLeadCardProps) {
  const days = getDaysInStage(lead);
  const isDormant = days > 7 && stage.probability !== 100 && stage.probability !== 0;
  const isHot = lead.score >= 70;
  const hasDeal = lead.deal_value > 0;
  const hasScore = lead.score > 0;
  const isCoarsePointer =
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // ── Sprint 33 vague 33-3A — Resize drag state ────────────────────────
  // Pattern Calendar Sprint 31 31-3B : startY captured on pointerdown sur handle,
  // mousemove window updates preview, mouseup commit. Haptic medium au snap change.
  const haptic = useHaptic();
  const [isResizing, setIsResizing] = useState(false);
  const [previewMode, setPreviewMode] = useState<CardHeightMode | null>(null);
  const resizeStateRef = useRef<{ baseMode: CardHeightMode; startY: number; lastSnap: CardHeightMode } | null>(null);

  const startResize = useCallback(
    (e: ReactMouseEvent) => {
      if (isCoarsePointer) return; // Mobile : skip (handles too fragile)
      e.preventDefault();
      e.stopPropagation();
      resizeStateRef.current = {
        baseMode: heightMode,
        startY: e.clientY,
        lastSnap: heightMode,
      };
      setIsResizing(true);
      setPreviewMode(heightMode);
    },
    [heightMode, isCoarsePointer]
  );

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (ev: MouseEvent) => {
      const st = resizeStateRef.current;
      if (!st) return;
      const next = pickHeightModeForDelta(st.baseMode, ev.clientY - st.startY);
      if (next !== st.lastSnap) {
        st.lastSnap = next;
        haptic.vibrate('medium');
        setPreviewMode(next);
      }
    };
    const onUp = () => {
      const st = resizeStateRef.current;
      setIsResizing(false);
      resizeStateRef.current = null;
      const finalMode = st?.lastSnap;
      setPreviewMode(null);
      if (finalMode && finalMode !== heightMode) {
        onHeightChange(finalMode);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizing]);

  const effectiveHeightMode = previewMode ?? heightMode;
  const { onMouseEnter, onMouseLeave, preview } = useLeadHoverPreview({
    lead,
    clientName: lead.client_name || undefined,
    disabled: isCoarsePointer || draggedId !== null,
    delay: 380,
  });

  // ── Sprint 44 M3.2 — Long-press → ContextualActionsSheet (mobile uniquement) ──
  // Remplace l'ancien DropdownMenu Sprint 23 par BottomSheet iOS-style avec actions
  // contextuelles uniformes (Voir détail / Modifier / Changer de stage / Archiver / Supprimer).
  // Note : Sprint 41 a aussi un swipe-action sur les rows leads ; sheet est complémentaire.
  const navigate = useNavigate();
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const longPressProps = useLongPress(
    () => {
      setActionsSheetOpen(true);
    },
    undefined,
    { delay: 550, mobileOnly: true, shouldPreventDefault: false }
  );

  // Construction de la liste d'actions Edit/Duplicate/Archive/Delete + stage chips.
  // Stage chips intégrées en tant qu'actions individuelles (avec dot color) en bas de liste.
  const sheetActions: ContextualAction[] = useMemo(() => {
    const baseActions: ContextualAction[] = [
      {
        id: 'open',
        icon: ExternalLink,
        label: 'Ouvrir le lead',
        description: `${lead.name}${lead.client_name ? ` · ${lead.client_name}` : ''}`,
        onSelect: () => { void navigate({ to: `/leads/${lead.id}` }); },
      },
      {
        id: 'edit',
        icon: Pencil,
        label: 'Modifier',
        description: 'Éditer fiche complète',
        onSelect: () => { void navigate({ to: `/leads/${lead.id}` }); },
      },
      {
        id: 'duplicate',
        icon: Copy,
        label: 'Dupliquer',
        description: 'Créer une copie de ce lead',
        // Pas d'API duplicate dédiée : ouvre la page Leads (l'user re-saisit ou utilise le bulk-duplicate Sprint 24)
        onSelect: () => { void navigate({ to: '/leads' }); },
      },
      {
        id: 'archive',
        icon: Archive,
        label: stage.probability === 0 ? 'Déjà archivé' : 'Archiver',
        description: 'Marquer comme perdu / archivé',
        disabled: stage.probability === 0,
        onSelect: () => {
          const lostStage = stages.find((s) => s.probability === 0);
          if (lostStage) void onChangeStage(lostStage.id);
        },
      },
    ];
    // Chips "Changer de stage" — une action par stage (max 5 pour ne pas saturer)
    const stageActions: ContextualAction[] = stages
      .filter((s) => s.id !== stage.id)
      .slice(0, 6)
      .map((s) => ({
        id: `stage-${s.id}`,
        icon: ArrowRightCircle,
        label: `→ ${s.name}`,
        description: `Déplacer vers ${s.name}`,
        onSelect: () => { void onChangeStage(s.id); },
      }));
    return [...baseActions, ...stageActions];
  }, [lead.id, lead.name, lead.client_name, stage.id, stage.probability, stages, onChangeStage, navigate]);

  return (
    <>
      <div
        draggable
        onDragStart={(e) => onDragStart(e, lead.id)}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onTouchStart={longPressProps.onTouchStart}
        onTouchMove={longPressProps.onTouchMove}
        onTouchEnd={longPressProps.onTouchEnd}
        className={`pipeline-card group relative rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all duration-200 list-item-enter is-${effectiveHeightMode}${
          isResizing ? ' is-resizing' : ''
        } hover:-translate-y-0.5 ${draggedId === lead.id ? 'opacity-40' : ''}`}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
          borderLeft: isDormant ? '3px solid var(--warning)' : (isHot ? '3px solid var(--primary)' : undefined),
        }}
      >
        <div className="flex items-start gap-2 mb-2 relative">
          <Avatar name={lead.name} size="xs" />
          <div className="flex-1 min-w-0">
            <Link
              to={`/leads/${lead.id}`}
              className="text-[13px] font-semibold text-[var(--text-primary)] hover:text-[var(--primary)] transition-colors truncate block leading-tight"
            >
              {lead.name}
            </Link>
            {lead.client_name && (
              <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{lead.client_name}</p>
            )}
          </div>
          {hasScore && (
            <span
              className="inline-flex items-center justify-center min-w-[26px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold tabular-nums shrink-0"
              style={{
                background: hexToRgba(scoreColor(lead.score).startsWith('var') ? '#FF9A00' : scoreColor(lead.score), 0.10),
                color: scoreColor(lead.score),
              }}
            >
              {lead.score}
            </span>
          )}
          <button
            className="opacity-0 group-hover:opacity-100 p-1 -m-1 rounded-md hover:bg-[var(--bg-subtle)] transition-all cursor-pointer text-[var(--text-muted)] shrink-0"
            aria-label="Actions sur ce lead"
            title="Actions"
          >
            <Icon as={MoreHorizontal} size="sm" />
          </button>
        </div>
        {(hasDeal || lead.type === 'customer') && (
          <div className="flex items-center justify-between mb-2">
            <Tag dot size="xs" color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>
              {TYPE_LABELS[lead.type]}
            </Tag>
            {hasDeal && (
              <span className="text-[12px] font-semibold tabular-nums text-[var(--text-primary)]">
                {formatMoneyCAD(lead.deal_value, getLocale())}
              </span>
            )}
          </div>
        )}
        <div
          className="flex items-center justify-between text-[10px] mt-2 pt-2 border-t border-[var(--border-subtle)]"
        >
          <span
            className="flex items-center gap-1 font-semibold tabular-nums"
            style={{ color: daysColor(days) }}
          >
            <Icon as={Clock} size={10} />
            {days}j
            {isDormant && <span className="ml-0.5">⚠</span>}
          </span>
          <span className="text-[var(--text-muted)] truncate max-w-[100px] uppercase tracking-wider text-[9px] font-medium">
            {SOURCE_LABELS[lead.source] || lead.source}
          </span>
        </div>
        {/* ── Sprint 33 vague 33-3A — Resize handle bottom (3 modes snap) ── */}
        {/* Anti-conflit DnD : pointerDown stopProp + draggable=false sur handle */}
        <span
          className="pipeline-card-resize-handle"
          role="separator"
          aria-label={`Ajuster la hauteur de la carte (${effectiveHeightMode})`}
          aria-orientation="horizontal"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={startResize}
          onDragStart={(e) => e.preventDefault()}
          draggable={false}
        />
      </div>
      {/* Sprint 44 M3.2 — ContextualActionsSheet (mobile long-press → actions uniformes) */}
      <ContextualActionsSheet
        open={actionsSheetOpen}
        onOpenChange={setActionsSheetOpen}
        title={lead.name}
        description={`${stage.name}${lead.deal_value > 0 ? ` · ${formatMoneyCAD(lead.deal_value, getLocale())}` : ''}`}
        actions={sheetActions}
      />
      {preview}
    </>
  );
}