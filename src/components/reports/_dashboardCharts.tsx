// ══════════════════════════════════════════════════════════════
// ██  _dashboardCharts — Sprint 46 M1.1
// ██  Lazy-loaded recharts wrappers pour DashboardBuilder.
// ██  Une seule export default (consommée par React.lazy()).
// ══════════════════════════════════════════════════════════════
//
// Pourquoi un fichier dédié : permet à Vite de bundler les widgets dans le
// chunk `recharts-vendor` Sprint 43 (lazy) — la page Reports charge donc le
// JS chart uniquement quand un widget est rendu.

import {
  BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  XAxis, YAxis, Legend, FunnelChart, Funnel, LabelList,
} from 'recharts';
import type { WidgetConfig } from './DashboardBuilder';

const COLOR_VAR: Record<string, string> = {
  brand:   'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger:  'var(--danger)',
  info:    'var(--info)',
  accent:  'var(--accent, var(--primary))',
};

// Sample/mock data placeholder. Le wirage des datasources réelles
// (leads/tasks/...) se fera dans une vague Sprint 46 M2+ ou via getReportsOverview()
// déjà exposé. On rend ici un dataset déterministe par widget.id pour preview.
function sampleSeries(widget: WidgetConfig): { name: string; value: number }[] {
  const seed = widget.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const buckets = widget.dimension === 'month' ? 12 : 6;
  const labelsByDim: Record<string, string[]> = {
    source: ['Google', 'Facebook', 'Direct', 'Référence', 'Email', 'SMS'],
    status: ['Nouveau', 'Contacté', 'Qualifié', 'Gagné', 'Perdu', 'Fermé'],
    type:   ['Entrant', 'Client', 'Prospect', 'Lead chaud', 'VIP', 'Autre'],
    owner:  ['Rochdi', 'Alice', 'Bruno', 'Camille', 'Dimitri', 'Élise'],
    client: ['Acme', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'],
    date:   ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
    week:   ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
    month:  ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'],
  };
  const labels = labelsByDim[widget.dimension || 'source'] || labelsByDim.source!;
  return Array.from({ length: buckets }, (_, i) => ({
    name: labels[i % labels.length]!,
    value: Math.max(2, Math.round(((seed * (i + 3)) % 87) + 5)),
  }));
}

function widgetColor(w: WidgetConfig): string {
  return COLOR_VAR[w.display.color || 'brand'] || 'var(--primary)';
}

// ── KPI ──────────────────────────────────────────────────────
function KpiWidget({ widget }: { widget: WidgetConfig }) {
  const series = sampleSeries(widget);
  const total = series.reduce((s, p) => s + p.value, 0);
  const delta = (series[series.length - 1]!.value - series[0]!.value) / Math.max(1, series[0]!.value);
  return (
    <div className="db-widget-kpi">
      <div className="db-widget-kpi__value">{total.toLocaleString('fr-CA')}</div>
      <div className="db-widget-kpi__label">{widget.metric} · {widget.source}</div>
      <div className={`db-widget-kpi__delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>
        {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
      </div>
    </div>
  );
}

// ── Bar ──────────────────────────────────────────────────────
function BarWidget({ widget }: { widget: WidgetConfig }) {
  const data = sampleSeries(widget);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} />
        <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
        {widget.display.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        <Bar dataKey="value" fill={widgetColor(widget)} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Line ─────────────────────────────────────────────────────
function LineWidget({ widget }: { widget: WidgetConfig }) {
  const data = sampleSeries(widget);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} />
        <Tooltip />
        {widget.display.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        <Line type="monotone" dataKey="value" stroke={widgetColor(widget)} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Donut ────────────────────────────────────────────────────
function DonutWidget({ widget }: { widget: WidgetConfig }) {
  const data = sampleSeries(widget);
  const palette = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--info)', 'var(--accent, var(--primary))'];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" innerRadius="50%" outerRadius="80%" paddingAngle={2}
          label={widget.display.showLabels ? (e: any) => `${e.name}` : false}>
          {data.map((_, i) => <Cell key={i} fill={palette[i % palette.length]!} />)}
        </Pie>
        <Tooltip />
        {widget.display.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Table ────────────────────────────────────────────────────
function TableWidget({ widget }: { widget: WidgetConfig }) {
  const data = sampleSeries(widget);
  return (
    <div className="db-widget-table">
      <table>
        <thead>
          <tr>
            <th>{widget.dimension || 'Dimension'}</th>
            <th className="text-right">{widget.metric}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <td>{d.name}</td>
              <td className="text-right t-mono-num">{d.value.toLocaleString('fr-CA')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Map (placeholder léger — Mapbox-ready) ───────────────────
function MapWidget({ widget }: { widget: WidgetConfig }) {
  // Note Loi 25/Mapbox : on n'instancie pas Mapbox tant que le widget Map
  // n'est pas explicitement activé via config (token). Placeholder visuel.
  const data = sampleSeries(widget);
  const total = data.reduce((s, p) => s + p.value, 0);
  return (
    <div className="db-widget-map" aria-label="Aperçu carte (Mapbox)">
      <div className="db-widget-map__hint">Carte (Mapbox)</div>
      <div className="db-widget-map__sub">{total} points · {widget.source}</div>
    </div>
  );
}

// ── Funnel ───────────────────────────────────────────────────
function FunnelWidget({ widget }: { widget: WidgetConfig }) {
  const raw = sampleSeries(widget);
  // Tri décroissant pour effet entonnoir
  const sorted = [...raw].sort((a, b) => b.value - a.value);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <FunnelChart>
        <Tooltip />
        <Funnel dataKey="value" data={sorted} isAnimationActive={false} fill={widgetColor(widget)}>
          {widget.display.showLabels && <LabelList position="right" dataKey="name" fill="var(--text-primary)" />}
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}

// ── Heatmap (grille CSS — pas recharts pour léger) ───────────
function HeatmapWidget({ widget }: { widget: WidgetConfig }) {
  // 7 jours × 6 plages horaires
  const seed = widget.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const cells = Array.from({ length: 42 }, (_, i) => ((seed + i * 7) % 10));
  const days = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const slots = ['9h', '11h', '13h', '15h', '17h', '19h'];
  return (
    <div className="db-widget-heatmap">
      <div className="db-widget-heatmap__grid">
        {cells.map((v, i) => (
          <div
            key={i}
            className="db-widget-heatmap__cell"
            style={{ opacity: 0.15 + (v / 10) * 0.85, background: widgetColor(widget) }}
            title={`${days[i % 7]} ${slots[Math.floor(i / 7)]} — intensité ${v}`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Dispatcher ───────────────────────────────────────────────
export default function DashboardChart({ widget }: { widget: WidgetConfig }) {
  switch (widget.type) {
    case 'kpi':       return <KpiWidget widget={widget} />;
    case 'barchart':  return <BarWidget widget={widget} />;
    case 'linechart': return <LineWidget widget={widget} />;
    case 'donut':     return <DonutWidget widget={widget} />;
    case 'table':     return <TableWidget widget={widget} />;
    case 'map':       return <MapWidget widget={widget} />;
    case 'funnel':    return <FunnelWidget widget={widget} />;
    case 'heatmap':   return <HeatmapWidget widget={widget} />;
    default:          return null;
  }
}
