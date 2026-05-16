// ── CellHoverInfo — Sprint 30 vague 30-1A ────────────────────────────────────
// Tooltip riche pour cells de tables Reports. Delay 280ms, glass background,
// brand-tinted shadow, max-w 220px. Support optionnel d'une mini-Sparkline et
// d'un trend % calculé hors composant. Respecte prefers-reduced-motion
// (instant-show, animation neutralisée).
//
// API
// ────
// <CellHoverInfo
//   title="Revenus Meta"
//   description="42 leads · 12 gagnés"
//   breakdown={[
//     { label: 'Cliqué', value: '+12', tone: 'brand' },
//     { label: 'Soumis', value: '+8', tone: 'success' },
//   ]}
//   trend={{ value: 14.2, direction: 'up' }}
//   sparkline={[4, 6, 5, 8, 9, 11, 12]}
//   delay={280}
// >
//   <td>2 480 $</td>
// </CellHoverInfo>

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ReactNode } from 'react';
import { Sparkline } from './Sparkline';

export type CellHoverInfoTone = 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface CellHoverInfoBreakdownItem {
  label: string;
  value: string | number;
  /** Couleur valeur (default neutral) */
  tone?: CellHoverInfoTone;
}

export interface CellHoverInfoTrend {
  /** % de variation (signé ou absolu — direction décide affichage) */
  value: number;
  direction: 'up' | 'down' | 'flat';
  /** Label suffix optionnel (ex: "vs 30 derniers jours") */
  label?: string;
}

export interface CellHoverInfoProps {
  children: ReactNode;
  /** Contenu simple (one-liner) — alternatif à title/description */
  content?: ReactNode;
  /** Titre bold */
  title?: string;
  /** Description sous le titre */
  description?: string;
  /** Breakdown numerics (chacune sur une ligne `label : value`) */
  breakdown?: CellHoverInfoBreakdownItem[];
  /** Trend chip — affiché en haut-droite avec flèche unicode */
  trend?: CellHoverInfoTrend;
  /** Sparkline data — affichée tout en bas si présente */
  sparkline?: number[];
  /** Delay avant apparition (ms) — défaut 280 */
  delay?: number;
  /** Skip rendu (mobile no-hover) — children passé sans wrap */
  shouldRender?: boolean;
  /** Sides Radix */
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

function toneColor(tone: CellHoverInfoTone | undefined): string {
  switch (tone) {
    case 'brand': return 'rgba(120,200,238,1)';
    case 'accent': return 'rgba(240,170,120,1)';
    case 'success': return 'rgba(120,220,150,1)';
    case 'warning': return 'rgba(245,180,90,1)';
    case 'danger': return 'rgba(245,130,130,1)';
    case 'info': return 'rgba(140,180,250,1)';
    case 'neutral':
    default:
      return 'rgba(255,255,255,0.92)';
  }
}

function trendChipStyle(direction: CellHoverInfoTrend['direction']) {
  if (direction === 'up') {
    return {
      bg: 'rgba(55,202,55,0.22)',
      border: 'rgba(55,202,55,0.45)',
      color: '#86F19A',
      arrow: '▲',
    };
  }
  if (direction === 'down') {
    return {
      bg: 'rgba(233,61,61,0.22)',
      border: 'rgba(233,61,61,0.45)',
      color: '#FFA9A9',
      arrow: '▼',
    };
  }
  return {
    bg: 'rgba(255,255,255,0.14)',
    border: 'rgba(255,255,255,0.28)',
    color: 'rgba(255,255,255,0.88)',
    arrow: '–',
  };
}

export function CellHoverInfo({
  children,
  content,
  title,
  description,
  breakdown,
  trend,
  sparkline,
  delay = 280,
  shouldRender = true,
  side = 'top',
  align = 'center',
}: CellHoverInfoProps) {
  if (!shouldRender) return <>{children}</>;

  const hasRichContent =
    !!title || !!description || (breakdown && breakdown.length > 0) || (sparkline && sparkline.length > 0) || !!trend;

  const trendStyles = trend ? trendChipStyle(trend.direction) : null;
  const trendValue = trend
    ? `${trend.direction === 'down' && trend.value > 0 ? '-' : trend.direction === 'up' && trend.value < 0 ? '+' : ''}${Math.abs(trend.value).toFixed(1)}%`
    : '';

  return (
    <TooltipPrimitive.Provider delayDuration={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={8}
            className="cell-hover-popover"
          >
            {hasRichContent ? (
              <div className="cell-hover-popover-inner">
                {(title || trend) && (
                  <div className="cell-hover-popover-header">
                    {title && <p className="cell-hover-popover-title">{title}</p>}
                    {trendStyles && (
                      <span
                        className="cell-hover-popover-trend"
                        style={{
                          background: trendStyles.bg,
                          border: `1px solid ${trendStyles.border}`,
                          color: trendStyles.color,
                        }}
                      >
                        <span aria-hidden="true">{trendStyles.arrow}</span>
                        <span className="t-mono-num">{trendValue}</span>
                      </span>
                    )}
                  </div>
                )}
                {description && (
                  <p className="cell-hover-popover-description">{description}</p>
                )}
                {breakdown && breakdown.length > 0 && (
                  <div className="cell-hover-popover-breakdown">
                    {breakdown.map((b, i) => (
                      <div key={`${b.label}-${i}`} className="cell-hover-popover-breakdown-row">
                        <span className="cell-hover-popover-breakdown-label">{b.label}</span>
                        <span
                          className="cell-hover-popover-breakdown-value t-mono-num"
                          style={{ color: toneColor(b.tone) }}
                        >
                          {b.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {sparkline && sparkline.length > 0 && (
                  <div className="cell-hover-popover-spark">
                    <Sparkline data={sparkline} color="brand" width={196} height={28} className="w-full" />
                  </div>
                )}
                {trend?.label && (
                  <p className="cell-hover-popover-trend-label">{trend.label}</p>
                )}
              </div>
            ) : (
              <div className="cell-hover-popover-inner">
                <span className="cell-hover-popover-simple">{content}</span>
              </div>
            )}
            <TooltipPrimitive.Arrow className="cell-hover-popover-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
