// ── UserActivityHeatmap — Sprint 46 M2.3 ─────────────────────
// Heatmap 7 jours × 24h, intensity color-coded primary.
// Tooltip hover : "Lundi 14h-15h : 42 événements"
// Period selector last 7d (par défaut) / 30d / 90d.
//
// Data source : GET /api/admin/activity-heatmap?period=7d
// Réponse : { heatmap: number[7][24] }  (Lun=0, Dim=6)
//
// Stripe-clean : pas d'orb/glow/gradient. Cell 22px arrondie, intensity
// par bucket 0-5 mappé sur gray-100 → primary-soft → primary-700.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { t } from '@/lib/i18n';
import { Card, Icon, Skeleton, Tooltip } from '@/components/ui';
import { Flame } from 'lucide-react';

type HeatmapPeriod = '7d' | '30d' | '90d';

function periodLabel(p: HeatmapPeriod): string {
  switch (p) {
    case '7d': return t('admin.period_7d');
    case '30d': return t('admin.period_30d');
    case '90d': return t('admin.period_90d');
  }
}

const DAY_LABELS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
const DAY_LABELS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;

// 6 buckets d'intensité : 0 (vide) → 5 (max).
// Mapping CSS vars Stripe-clean : --bg-subtle → --primary (foncé).
function intensityForValue(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  const ratio = value / max;
  if (ratio < 0.05) return 1;
  if (ratio < 0.20) return 2;
  if (ratio < 0.45) return 3;
  if (ratio < 0.75) return 4;
  return 5;
}

function colorForIntensity(level: number): string {
  switch (level) {
    case 0: return 'var(--bg-subtle)';
    case 1: return 'color-mix(in srgb, var(--primary) 8%, var(--bg-surface))';
    case 2: return 'color-mix(in srgb, var(--primary) 22%, var(--bg-surface))';
    case 3: return 'color-mix(in srgb, var(--primary) 42%, var(--bg-surface))';
    case 4: return 'color-mix(in srgb, var(--primary) 68%, var(--bg-surface))';
    case 5: return 'var(--primary)';
    default: return 'var(--bg-subtle)';
  }
}

// [LOT RÉEL-bis] Grille honnête vide : 7×24 zéros (JAMAIS de Math.random).
// Utilisée si l'API échoue ou renvoie une forme invalide — l'UI affiche alors
// l'état « pas encore de données » au lieu de fabriquer une heatmap.
function emptyHeatmap(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

async function fetchHeatmap(period: HeatmapPeriod, token: string | null): Promise<number[][]> {
  try {
    const res = await fetch(`/api/admin/activity-heatmap?period=${period}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json() as { heatmap?: number[][]; data?: { heatmap?: number[][] } };
    const grid = data.heatmap || data.data?.heatmap;
    if (Array.isArray(grid) && grid.length === 7 && grid[0]?.length === 24) {
      return grid;
    }
    throw new Error('invalid shape');
  } catch {
    // Pas de fallback fabriqué : grille vide honnête (l'UI montre no_data_yet).
    return emptyHeatmap();
  }
}

export interface UserActivityHeatmapProps {
  /** Période par défaut (default: '7d') */
  defaultPeriod?: HeatmapPeriod;
  /** className additionnel sur le wrapper Card */
  className?: string;
}

export function UserActivityHeatmap({ defaultPeriod = '7d', className = '' }: UserActivityHeatmapProps) {
  const [period, setPeriod] = useState<HeatmapPeriod>(defaultPeriod);
  const [grid, setGrid] = useState<number[][] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    fetchHeatmap(period, token).then(data => {
      if (!cancelled) {
        setGrid(data);
        setIsLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setGrid(emptyHeatmap());
        setIsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [period]);

  // Max global pour normaliser l'intensité.
  const maxValue = useMemo(() => {
    if (!grid) return 0;
    let m = 0;
    for (const row of grid) for (const v of row) if (v > m) m = v;
    return m;
  }, [grid]);

  // Cell renderer — Stripe-clean, arrondi 3px, hover scale 1.08
  const renderCell = useCallback((dayIdx: number, hour: number, value: number) => {
    const level = intensityForValue(value, maxValue);
    const bg = colorForIntensity(level);
    const dayLabel = DAY_LABELS_FULL[dayIdx];
    const hourLabel = `${hour.toString().padStart(2, '0')}h-${((hour + 1) % 24).toString().padStart(2, '0')}h`;
    const tooltipContent = `${dayLabel} ${hourLabel} : ${value} événement${value !== 1 ? 's' : ''}`;
    return (
      <Tooltip content={tooltipContent} key={`${dayIdx}-${hour}`}>
        <button
          type="button"
          aria-label={tooltipContent}
          className="heatmap-cell"
          style={{
            background: bg,
            // Subtle border pour distinguer cells empty
            border: level === 0 ? '1px solid var(--border)' : '1px solid transparent',
          }}
        />
      </Tooltip>
    );
  }, [maxValue]);

  return (
    <Card className={`p-5 ${className}`.trim()}>
      <header className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Icon as={Flame} size={16} className="text-[var(--primary)] shrink-0" />
          <div className="min-w-0">
            <h3 className="t-h3">{t('admin.heat_title')}</h3>
            <p className="t-caption text-[var(--text-muted)]">{t('admin.heat_subtitle')}</p>
          </div>
        </div>
        <div role="tablist" aria-label={t('admin.heat_period_aria')} className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-[12px]">
          {(['7d', '30d', '90d'] as HeatmapPeriod[]).map(p => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer ${
                period === p
                  ? 'bg-[var(--primary-soft)] text-[var(--primary)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {periodLabel(p)}
            </button>
          ))}
        </div>
      </header>

      {isLoading || !grid ? (
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : maxValue <= 0 ? (
        // [LOT RÉEL-bis] État honnête : aucune activité réelle enregistrée.
        // On NE rend PAS une heatmap vide muette ni des chiffres fabriqués.
        <p className="t-caption text-[var(--text-muted)] py-6 text-center">
          {t('admin.no_data_yet')}
        </p>
      ) : (
        <div className="heatmap-wrap" role="grid" aria-label={t('admin.heat_grid_aria')}>
          {/* Header heures 0-23 — affiche 0, 6, 12, 18 pour ne pas surcharger */}
          <div className="heatmap-header" aria-hidden>
            <span className="heatmap-day-label" />
            {Array.from({ length: 24 }).map((_, h) => (
              <span key={h} className="heatmap-hour-label">
                {[0, 6, 12, 18].includes(h) ? `${h}h` : ''}
              </span>
            ))}
          </div>
          {grid.map((row, dayIdx) => (
            <div key={dayIdx} className="heatmap-row" role="row">
              <span className="heatmap-day-label" role="rowheader">{DAY_LABELS_SHORT[dayIdx]}</span>
              {row.map((value, hour) => renderCell(dayIdx, hour, value))}
            </div>
          ))}
          {/* Légende intensity */}
          <div className="heatmap-legend">
            <span className="t-caption text-[var(--text-muted)]">{t('admin.heat_less')}</span>
            {[0, 1, 2, 3, 4, 5].map(lvl => (
              <span
                key={lvl}
                className="heatmap-legend-cell"
                style={{
                  background: colorForIntensity(lvl),
                  border: lvl === 0 ? '1px solid var(--border)' : '1px solid transparent',
                }}
                aria-hidden
              />
            ))}
            <span className="t-caption text-[var(--text-muted)]">{t('admin.heat_more')}</span>
          </div>
        </div>
      )}
    </Card>
  );
}
