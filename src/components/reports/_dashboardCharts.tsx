// ══════════════════════════════════════════════════════════════
// ██  _dashboardCharts — Sprint 46 M1.1 + LOT D (Phase B Manager-C)
// ██  Lazy-loaded recharts wrappers pour DashboardBuilder.
// ██  Une seule export default (consommée par React.lazy()).
// ══════════════════════════════════════════════════════════════
//
// Pourquoi un fichier dédié : permet à Vite de bundler les widgets dans le
// chunk `recharts-vendor` Sprint 43 (lazy) — la page Reports charge donc le
// JS chart uniquement quand un widget est rendu.
//
// LOT D Phase B Manager-C (2026-05-20) :
//   - sampleSeries(seed) MOCK déterministe → remplacé par useWidgetData
//     qui appelle `runReportWidget` (route /api/reports/widget, dispatcher
//     unique borné tenant — corps réel Phase B Manager-B).
//   - États : loading (skeleton), error (libellé i18n discret), empty
//     (libellé i18n placeholder), data (rendu chart normal).
//   - Fallback dev offline : géré dans le hook useWidgetData lui-même
//     (cf. src/hooks/useWidgetData.ts).

import {
  BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  XAxis, YAxis, Legend, FunnelChart, Funnel, LabelList,
} from 'recharts';
import type { WidgetConfig } from './DashboardBuilder';
import { useWidgetData } from '@/hooks/useWidgetData';
import { t } from '@/lib/i18n';

const COLOR_VAR: Record<string, string> = {
  brand:   'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger:  'var(--danger)',
  info:    'var(--info)',
  accent:  'var(--accent, var(--primary))',
};

function widgetColor(w: WidgetConfig): string {
  return COLOR_VAR[w.display.color || 'brand'] || 'var(--primary)';
}

// ── États transversaux (skeleton / error / empty) ─────────────
//
// On garde ces helpers locaux au fichier pour rester dans le chunk lazy
// recharts (pas de dep externe ajoutée). Les classes db-widget-state__*
// sont append-only dans src/index.css (bloc LOT D Reports Hardening).

function StateSkeleton() {
  return (
    <div className="db-widget-state db-widget-state--loading" aria-busy="true" aria-live="polite">
      <div className="db-widget-state__pulse" />
    </div>
  );
}

function StateError({ message }: { message?: string }) {
  return (
    <div className="db-widget-state db-widget-state--error" role="status">
      <span className="db-widget-state__label">
        {message || t('reports.widget.error_data')}
      </span>
    </div>
  );
}

function StateEmpty() {
  return (
    <div className="db-widget-state db-widget-state--empty" role="status">
      <span className="db-widget-state__label">{t('reports.widget.empty')}</span>
    </div>
  );
}

/**
 * Wrapper transverse autour de chaque sous-widget : intercepte
 * loading / error / empty avant de rendre le chart. Si `data` présent
 * et `series.length > 0`, on appelle le `renderChart(series)` fourni
 * par le sous-widget.
 */
function WidgetShell({
  widget,
  renderChart,
}: {
  widget: WidgetConfig;
  renderChart: (series: Array<{ name: string; value: number }>, total: number) => React.ReactNode;
}) {
  const { data, loading, error, empty } = useWidgetData(widget);
  if (loading) return <StateSkeleton />;
  if (error) return <StateError message={error} />;
  if (empty || !data) return <StateEmpty />;
  return <>{renderChart(data.series, data.total)}</>;
}

// ── KPI ──────────────────────────────────────────────────────
function KpiWidget({ widget }: { widget: WidgetConfig }) {
  return (
    <WidgetShell
      widget={widget}
      renderChart={(series, total) => {
        const first = series[0]?.value || 0;
        const last = series[series.length - 1]?.value || 0;
        const delta = (last - first) / Math.max(1, first);
        return (
          <div className="db-widget-kpi">
            <div className="db-widget-kpi__value">{total.toLocaleString('fr-CA')}</div>
            <div className="db-widget-kpi__label">{widget.metric} · {widget.source}</div>
            <div className={`db-widget-kpi__delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>
              {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
            </div>
          </div>
        );
      }}
    />
  );
}

// ── Bar ──────────────────────────────────────────────────────
function BarWidget({ widget }: { widget: WidgetConfig }) {
  return (
    <WidgetShell
      widget={widget}
      renderChart={(series) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            {widget.display.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            <Bar dataKey="value" fill={widgetColor(widget)} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    />
  );
}

// ── Line ─────────────────────────────────────────────────────
function LineWidget({ widget }: { widget: WidgetConfig }) {
  return (
    <WidgetShell
      widget={widget}
      renderChart={(series) => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} />
            <Tooltip />
            {widget.display.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            <Line type="monotone" dataKey="value" stroke={widgetColor(widget)} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    />
  );
}

// ── Donut ────────────────────────────────────────────────────
function DonutWidget({ widget }: { widget: WidgetConfig }) {
  const palette = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--info)', 'var(--accent, var(--primary))'];
  return (
    <WidgetShell
      widget={widget}
      renderChart={(series) => (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={series} dataKey="value" innerRadius="50%" outerRadius="80%" paddingAngle={2}
              label={widget.display.showLabels ? (e: any) => `${e.name}` : false}>
              {series.map((_, i) => <Cell key={i} fill={palette[i % palette.length]!} />)}
            </Pie>
            <Tooltip />
            {widget.display.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          </PieChart>
        </ResponsiveContainer>
      )}
    />
  );
}

// ── Table ────────────────────────────────────────────────────
function TableWidget({ widget }: { widget: WidgetConfig }) {
  return (
    <WidgetShell
      widget={widget}
      renderChart={(series) => (
        <div className="db-widget-table">
          <table>
            <thead>
              <tr>
                <th>{widget.dimension || 'Dimension'}</th>
                <th className="text-right">{widget.metric}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((d, i) => (
                <tr key={i}>
                  <td>{d.name}</td>
                  <td className="text-right t-mono-num">{d.value.toLocaleString('fr-CA')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    />
  );
}

// ── Map (placeholder léger — Mapbox-ready) ───────────────────
function MapWidget({ widget }: { widget: WidgetConfig }) {
  // Note Loi 25/Mapbox : on n'instancie pas Mapbox tant que le widget Map
  // n'est pas explicitement activé via config (token). Placeholder visuel.
  return (
    <WidgetShell
      widget={widget}
      renderChart={(_series, total) => (
        <div className="db-widget-map" aria-label="Aperçu carte (Mapbox)">
          <div className="db-widget-map__hint">Carte (Mapbox)</div>
          <div className="db-widget-map__sub">{total} points · {widget.source}</div>
        </div>
      )}
    />
  );
}

// ── Funnel ───────────────────────────────────────────────────
function FunnelWidget({ widget }: { widget: WidgetConfig }) {
  return (
    <WidgetShell
      widget={widget}
      renderChart={(series) => {
        // Tri décroissant pour effet entonnoir
        const sorted = [...series].sort((a, b) => b.value - a.value);
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
      }}
    />
  );
}

// ── Heatmap (grille CSS — pas recharts pour léger) ───────────
function HeatmapWidget({ widget }: { widget: WidgetConfig }) {
  // Heatmap reste un placeholder visuel : la dimension 7×6 (jours×plages
  // horaires) ne mappe pas 1:1 sur `series: [{name, value}]`. On utilise
  // la `total` retournée par le widget comme intensité globale, et on
  // module la grille déterministe par widget.id.
  return (
    <WidgetShell
      widget={widget}
      renderChart={(_series, total) => {
        const seed = widget.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const intensity = Math.max(1, Math.min(10, Math.floor(total / 50)));
        const cells = Array.from({ length: 42 }, (_, i) => ((seed + i * 7 + intensity) % 10));
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
      }}
    />
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
