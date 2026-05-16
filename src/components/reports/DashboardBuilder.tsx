// ══════════════════════════════════════════════════════════════
// ██  DashboardBuilder — Sprint 46 M1.1 + M1.2
// ██  Reports builder drag-drop, 12-col grid, 8 widget types,
// ██  config panel (SlidePanel), keyboard a11y.
// ══════════════════════════════════════════════════════════════
//
// API publique :
//   <DashboardBuilder
//     value={config}                       // {widgets:[], cols:12}
//     onChange={(next) => setConfig(next)} // controlled
//     readOnly={false}                     // public share = true
//   />
//
// Widget types (8) : KPI, BarChart, LineChart, Donut, Table, Map, Funnel, Heatmap
//
// A11y :
//   - Drag handle = button focusable + aria-label
//   - Space toggle drag mode, arrows déplacent, Enter drop (dnd-kit KeyboardSensor)
//   - "Ajouter widget" = dropdown native pour clavier-first
//
// Recharts lazy-import (Sprint 43 vendor chunk) → on importe statiquement les
// petits charts internes (BarChart/LineChart/PieChart) seulement à l'usage du
// widget. Pattern : import direct depuis 'recharts' ici (déjà lazy-loadé au
// niveau du chunk recharts-core généré par Vite).

import { useState, useCallback, useRef, useMemo, useEffect, lazy, Suspense, type CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, Plus, Trash2, Settings2, BarChart3,
  LineChart as LineIcon, PieChart as PieIcon, Table2,
  Map as MapIcon, TrendingUp, Gauge, Maximize2, Minimize2,
  Sparkles,
} from 'lucide-react';
import {
  Card, Button, SlidePanel, Tag, Select, Switch, Input, Icon,
} from '@/components/ui';
import { cn } from '@/lib/cn';

// Recharts lazy-loaded inline (vendor chunk recharts existe déjà Sprint 43)
const RechartsLazy = lazy(() => import('./_dashboardCharts'));

// ── Types publiques ──────────────────────────────────────────

export type WidgetType =
  | 'kpi' | 'barchart' | 'linechart' | 'donut'
  | 'table' | 'map' | 'funnel' | 'heatmap';

export type WidgetSize = '1x1' | '2x1' | '2x2';

export type WidgetDataSource = 'leads' | 'tasks' | 'conversations' | 'events' | 'invoices';

export type WidgetMetric = 'count' | 'sum' | 'avg' | 'median' | 'min' | 'max';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  size: WidgetSize;
  /** Datasource canonique */
  source: WidgetDataSource;
  /** Filtres optionnels */
  filters: {
    dateRange?: '7d' | '30d' | '90d' | '12m' | 'all';
    source?: string | null;
    status?: string | null;
    tags?: string[];
  };
  /** Axe principal (groupBy) */
  dimension?: string;
  /** Metric */
  metric: WidgetMetric;
  /** Display */
  display: {
    color?: string;
    showLegend?: boolean;
    showLabels?: boolean;
  };
}

export interface DashboardBuilderValue {
  cols: number;             // toujours 12
  widgets: WidgetConfig[];
}

export interface DashboardBuilderProps {
  value: DashboardBuilderValue;
  onChange: (next: DashboardBuilderValue) => void;
  readOnly?: boolean;
}

// ── Catalogue widgets ────────────────────────────────────────

const WIDGET_CATALOG: Array<{
  type: WidgetType; label: string; icon: typeof BarChart3; defaultSize: WidgetSize;
}> = [
  { type: 'kpi',       label: 'KPI',           icon: TrendingUp, defaultSize: '1x1' },
  { type: 'barchart',  label: 'Bar chart',     icon: BarChart3,  defaultSize: '2x1' },
  { type: 'linechart', label: 'Line chart',    icon: LineIcon,   defaultSize: '2x1' },
  { type: 'donut',     label: 'Donut',         icon: PieIcon,    defaultSize: '1x1' },
  { type: 'table',     label: 'Table',         icon: Table2,     defaultSize: '2x2' },
  { type: 'map',       label: 'Carte',         icon: MapIcon,    defaultSize: '2x2' },
  { type: 'funnel',    label: 'Funnel',        icon: Gauge,      defaultSize: '2x1' },
  { type: 'heatmap',   label: 'Heatmap',       icon: Sparkles,   defaultSize: '2x2' },
];

const DATA_SOURCES: Array<{ value: WidgetDataSource; label: string }> = [
  { value: 'leads',         label: 'Leads' },
  { value: 'tasks',         label: 'Tâches' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'events',        label: 'Rendez-vous' },
  { value: 'invoices',      label: 'Factures' },
];

const METRICS: Array<{ value: WidgetMetric; label: string }> = [
  { value: 'count',  label: 'Compte (count)' },
  { value: 'sum',    label: 'Somme (sum)' },
  { value: 'avg',    label: 'Moyenne (avg)' },
  { value: 'median', label: 'Médiane (median)' },
  { value: 'min',    label: 'Minimum (min)' },
  { value: 'max',    label: 'Maximum (max)' },
];

const SIZE_TO_GRID: Record<WidgetSize, { cols: number; rows: number }> = {
  '1x1': { cols: 3, rows: 1 },
  '2x1': { cols: 6, rows: 1 },
  '2x2': { cols: 6, rows: 2 },
};

const COLOR_THEMES = ['brand', 'success', 'warning', 'danger', 'info', 'accent'] as const;

// ── Helpers ──────────────────────────────────────────────────

function genId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultWidget(type: WidgetType): WidgetConfig {
  const cat = WIDGET_CATALOG.find(w => w.type === type)!;
  return {
    id: genId(),
    type,
    title: cat.label,
    size: cat.defaultSize,
    source: 'leads',
    filters: { dateRange: '30d' },
    dimension: 'source',
    metric: 'count',
    display: { color: 'brand', showLegend: true, showLabels: false },
  };
}

// ── Sortable widget card ─────────────────────────────────────

interface SortableWidgetProps {
  widget: WidgetConfig;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onResize: (next: WidgetSize) => void;
}

function SortableWidget({ widget, selected, readOnly, onSelect, onDelete, onResize }: SortableWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: readOnly,
  });
  const grid = SIZE_TO_GRID[widget.size] || SIZE_TO_GRID['1x1'];
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: `span ${grid.cols} / span ${grid.cols}`,
    gridRow: `span ${grid.rows} / span ${grid.rows}`,
  } as CSSProperties;

  const cat = WIDGET_CATALOG.find(w => w.type === widget.type);
  const Ico = cat?.icon || BarChart3;

  const cycleSize = () => {
    const order: WidgetSize[] = ['1x1', '2x1', '2x2'];
    const idx = order.indexOf(widget.size);
    onResize(order[(idx + 1) % order.length]!);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'db-widget-card',
        selected && 'db-widget-card--selected',
        isDragging && 'db-widget-card--dragging',
      )}
      data-widget-id={widget.id}
      data-widget-type={widget.type}
      data-widget-size={widget.size}
      onClick={readOnly ? undefined : onSelect}
    >
      <div className="db-widget-card__head">
        <div className="db-widget-card__title">
          <Icon as={Ico} size="sm" className="db-widget-card__title-icon" aria-hidden />
          <span className="truncate">{widget.title}</span>
        </div>
        {!readOnly && (
          <div className="db-widget-card__actions">
            <button
              type="button"
              className="db-widget-card__btn"
              onClick={(e) => { e.stopPropagation(); cycleSize(); }}
              aria-label={`Redimensionner (actuel : ${widget.size})`}
              title="Redimensionner"
            >
              <Icon as={widget.size === '2x2' ? Minimize2 : Maximize2} size={14} />
            </button>
            <button
              type="button"
              className="db-widget-card__btn"
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
              aria-label="Configurer le widget"
              title="Configurer"
            >
              <Icon as={Settings2} size={14} />
            </button>
            <button
              type="button"
              className="db-widget-card__btn db-widget-card__btn--danger"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              aria-label="Supprimer le widget"
              title="Supprimer"
            >
              <Icon as={Trash2} size={14} />
            </button>
            <button
              type="button"
              className="db-widget-card__handle"
              {...attributes}
              {...listeners}
              aria-label="Déplacer le widget (Espace pour activer, flèches pour bouger, Entrée pour déposer)"
              title="Déplacer"
            >
              <Icon as={GripVertical} size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="db-widget-card__body">
        <Suspense fallback={<div className="db-widget-card__skeleton" aria-hidden />}>
          <RechartsLazy widget={widget} />
        </Suspense>
      </div>
    </div>
  );
}

// ── Toolbar : Add widget dropdown (keyboard-first) ───────────

interface AddWidgetMenuProps {
  onAdd: (type: WidgetType) => void;
}

function AddWidgetMenu({ onAdd }: AddWidgetMenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="db-add-widget-menu">
      <Button
        variant="primary"
        onClick={() => setOpen(o => !o)}
        className="gap-1.5 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        ref={btnRef as any}
      >
        <Icon as={Plus} size={14} /> Ajouter widget
      </Button>
      {open && (
        <div ref={menuRef} role="menu" className="db-add-widget-menu__list">
          {WIDGET_CATALOG.map(w => (
            <button
              key={w.type}
              type="button"
              role="menuitem"
              className="db-add-widget-menu__item"
              onClick={() => { onAdd(w.type); setOpen(false); }}
            >
              <Icon as={w.icon} size="sm" />
              <span>{w.label}</span>
              <span className="db-add-widget-menu__hint">{w.defaultSize}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Config panel ─────────────────────────────────────────────

interface ConfigPanelProps {
  widget: WidgetConfig | null;
  onClose: () => void;
  onApply: (next: WidgetConfig) => void;
}

function ConfigPanel({ widget, onClose, onApply }: ConfigPanelProps) {
  const [draft, setDraft] = useState<WidgetConfig | null>(widget);
  useEffect(() => { setDraft(widget); }, [widget]);

  if (!draft) {
    return (
      <SlidePanel open={false} onOpenChange={onClose} title="Configurer le widget">
        <div />
      </SlidePanel>
    );
  }

  const update = <K extends keyof WidgetConfig>(k: K, v: WidgetConfig[K]) =>
    setDraft(prev => prev ? { ...prev, [k]: v } : prev);
  const updateDisplay = (patch: Partial<WidgetConfig['display']>) =>
    setDraft(prev => prev ? { ...prev, display: { ...prev.display, ...patch } } : prev);
  const updateFilters = (patch: Partial<WidgetConfig['filters']>) =>
    setDraft(prev => prev ? { ...prev, filters: { ...prev.filters, ...patch } } : prev);

  return (
    <SlidePanel
      open={!!widget}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Configurer · ${draft.title}`}
      description="Source de données, filtres, dimensions, métriques et affichage."
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} className="text-xs">Annuler</Button>
          <Button variant="primary" onClick={() => onApply(draft)} className="text-xs">Appliquer</Button>
        </div>
      }
    >
      <div className="db-cfg">
        {/* Titre */}
        <label className="db-cfg__field">
          <span className="db-cfg__label">Titre</span>
          <Input
            value={draft.title}
            onChange={(e) => update('title', (e.target as HTMLInputElement).value)}
            maxLength={80}
          />
        </label>

        {/* Data source — segmented */}
        <div className="db-cfg__field">
          <span className="db-cfg__label">Source de données</span>
          <div role="radiogroup" aria-label="Source de données" className="db-cfg__segmented">
            {DATA_SOURCES.map(s => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={draft.source === s.value}
                className={cn('db-cfg__seg-btn', draft.source === s.value && 'db-cfg__seg-btn--active')}
                onClick={() => update('source', s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filtres */}
        <div className="db-cfg__field">
          <span className="db-cfg__label">Filtres</span>
          <div className="db-cfg__row">
            <Select
              label="Période"
              value={draft.filters.dateRange || '30d'}
              onChange={(e) => updateFilters({ dateRange: (e.target as HTMLSelectElement).value as any })}
            >
              <option value="7d">7 derniers jours</option>
              <option value="30d">30 derniers jours</option>
              <option value="90d">90 derniers jours</option>
              <option value="12m">12 derniers mois</option>
              <option value="all">Toute la période</option>
            </Select>
            <Input
              label="Source (lead)"
              placeholder="ex : google, facebook"
              value={draft.filters.source || ''}
              onChange={(e) => updateFilters({ source: (e.target as HTMLInputElement).value || null })}
            />
          </div>
          <div className="db-cfg__row">
            <Input
              label="Statut"
              placeholder="ex : new, won"
              value={draft.filters.status || ''}
              onChange={(e) => updateFilters({ status: (e.target as HTMLInputElement).value || null })}
            />
            <Input
              label="Tags (séparés par virgule)"
              placeholder="ex : vip, chaud"
              value={(draft.filters.tags || []).join(', ')}
              onChange={(e) => {
                const raw = (e.target as HTMLInputElement).value;
                const tags = raw.split(',').map(s => s.trim()).filter(Boolean);
                updateFilters({ tags });
              }}
            />
          </div>
        </div>

        {/* Dimensions */}
        <div className="db-cfg__field">
          <Select
            label="Dimension (axe)"
            value={draft.dimension || 'source'}
            onChange={(e) => update('dimension', (e.target as HTMLSelectElement).value)}
          >
            <option value="source">Source</option>
            <option value="status">Statut</option>
            <option value="type">Type</option>
            <option value="owner">Propriétaire</option>
            <option value="client">Sous-compte</option>
            <option value="date">Date (jour)</option>
            <option value="week">Semaine</option>
            <option value="month">Mois</option>
          </Select>
        </div>

        {/* Metric */}
        <div className="db-cfg__field">
          <span className="db-cfg__label">Métrique</span>
          <div role="radiogroup" aria-label="Métrique" className="db-cfg__segmented db-cfg__segmented--wrap">
            {METRICS.map(m => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={draft.metric === m.value}
                className={cn('db-cfg__seg-btn', draft.metric === m.value && 'db-cfg__seg-btn--active')}
                onClick={() => update('metric', m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Display */}
        <div className="db-cfg__field">
          <span className="db-cfg__label">Affichage</span>
          <div className="db-cfg__row">
            <Select
              label="Thème couleur"
              value={draft.display.color || 'brand'}
              onChange={(e) => updateDisplay({ color: (e.target as HTMLSelectElement).value })}
            >
              {COLOR_THEMES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <div className="db-cfg__switches">
              <Switch
                checked={!!draft.display.showLegend}
                onCheckedChange={(v) => updateDisplay({ showLegend: v })}
                label="Légende"
              />
              <Switch
                checked={!!draft.display.showLabels}
                onCheckedChange={(v) => updateDisplay({ showLabels: v })}
                label="Étiquettes"
              />
            </div>
          </div>
        </div>

        {/* Aperçu type */}
        <div className="db-cfg__preview" aria-label="Aperçu du widget">
          <Tag size="sm" variant="brand">{draft.type}</Tag>
          <Tag size="sm">{draft.size}</Tag>
        </div>
      </div>
    </SlidePanel>
  );
}

// ── Main builder ─────────────────────────────────────────────

export function DashboardBuilder({ value, onChange, readOnly = false }: DashboardBuilderProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // dnd-kit sensors — pointer + keyboard
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = useMemo(() => value.widgets.map(w => w.id), [value.widgets]);
  const selected = useMemo(() => value.widgets.find(w => w.id === selectedId) || null, [value.widgets, selectedId]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = value.widgets.findIndex(w => w.id === active.id);
    const newIdx = value.widgets.findIndex(w => w.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onChange({ ...value, widgets: arrayMove(value.widgets, oldIdx, newIdx) });
  }, [value, onChange]);

  const handleAdd = (type: WidgetType) => {
    onChange({ ...value, widgets: [...value.widgets, defaultWidget(type)] });
  };

  const handleDelete = (id: string) => {
    onChange({ ...value, widgets: value.widgets.filter(w => w.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };

  const handleResize = (id: string, size: WidgetSize) => {
    onChange({
      ...value,
      widgets: value.widgets.map(w => w.id === id ? { ...w, size } : w),
    });
  };

  const handleApplyConfig = (next: WidgetConfig) => {
    onChange({
      ...value,
      widgets: value.widgets.map(w => w.id === next.id ? next : w),
    });
    setSelectedId(null);
  };

  return (
    <div className="db-builder">
      {/* Toolbar */}
      {!readOnly && (
        <div className="db-builder__toolbar" role="toolbar" aria-label="Outils dashboard">
          <AddWidgetMenu onAdd={handleAdd} />
          <span className="db-builder__count" aria-live="polite">
            {value.widgets.length} widget{value.widgets.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Grid */}
      {value.widgets.length === 0 ? (
        <Card className="db-builder__empty">
          <Icon as={BarChart3} size="xl" className="db-builder__empty-icon" aria-hidden />
          <h3 className="db-builder__empty-title">Aucun widget</h3>
          <p className="db-builder__empty-desc">
            {readOnly
              ? 'Ce tableau de bord ne contient pas encore de widgets.'
              : 'Clique sur « Ajouter widget » pour commencer à construire ton tableau de bord.'}
          </p>
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items} strategy={rectSortingStrategy}>
            <div className="db-builder__grid" style={{ gridTemplateColumns: `repeat(${value.cols || 12}, minmax(0, 1fr))` }}>
              {value.widgets.map(w => (
                <SortableWidget
                  key={w.id}
                  widget={w}
                  selected={selectedId === w.id}
                  readOnly={readOnly}
                  onSelect={() => setSelectedId(w.id)}
                  onDelete={() => handleDelete(w.id)}
                  onResize={(s) => handleResize(w.id, s)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Config panel */}
      {!readOnly && (
        <ConfigPanel
          widget={selected}
          onClose={() => setSelectedId(null)}
          onApply={handleApplyConfig}
        />
      )}
    </div>
  );
}

// Default empty value helper (utile pour Reports.tsx / Shared page)
export function createEmptyDashboard(): DashboardBuilderValue {
  return { cols: 12, widgets: [] };
}
