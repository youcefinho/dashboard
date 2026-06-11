// ── Sparkline — mini SVG chart premium (Sprint 23 wave 11) ───────────────────
// Refonte: gradient stroke brand cyan→orange, area gradient avec multi-stops,
// dot terminal glowing sur dernière valeur, animation path draw au mount,
// markers min/max optionnels. Respect prefers-reduced-motion.

import { useId, useMemo } from 'react';
import { cn } from '@/lib/cn';

interface SparklineProps {
  data: number[];
  /** "brand" = gradient cyan→orange, sinon couleur unique (string) */
  color?: 'brand' | 'success' | 'warning' | 'danger' | string;
  height?: number;
  width?: number;
  /** Affiche un dot glowing sur la dernière valeur (défaut true) */
  showLastDot?: boolean;
  /** Affiche des marqueurs min/max (défaut false) */
  showMinMax?: boolean;
  /** Désactive l'animation draw au mount */
  noAnimation?: boolean;
  className?: string;
  /** Sprint 40 40-1A — épaisseur stroke (défaut 2px, KPI bump 2.5px) */
  strokeWidth?: number;
  /** Sprint 40 40-1A — Stripe-style terminal dot (no glow, white ring 1.5px, r=3.5) */
  terminalDotStripe?: boolean;
}

type ColorStops = { primary: string; secondary: string };

function resolveColors(color: SparklineProps['color']): ColorStops {
  switch (color) {
    case 'brand':
    case undefined:
      return { primary: 'var(--primary)', secondary: '#8B5CF6' };
    case 'success':
      return { primary: '#37CA37', secondary: '#635BFF' };
    case 'warning':
      return { primary: '#FF9A00', secondary: '#C7912C' };
    case 'danger':
      return { primary: '#E93D3D', secondary: '#CD3D64' };
    default:
      return { primary: color, secondary: color };
  }
}

export function Sparkline({
  data,
  color = 'brand',
  height = 32,
  width = 80,
  showLastDot = true,
  showMinMax = false,
  noAnimation = false,
  className,
  strokeWidth = 2,
  terminalDotStripe = false,
}: SparklineProps) {
  const uid = useId().replace(/:/g, '');
  const colors = resolveColors(color);

  const geometry = useMemo(() => {
    if (data.length === 0) return null;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const padding = 3;
    const usableH = height - padding * 2;

    const points = data.map((v, i) => {
      const x = data.length === 1 ? width / 2 : (i / (data.length - 1)) * width;
      const y = height - padding - ((v - min) / range) * usableH;
      return { x, y, v };
    });

    const pointsStr = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

    // Path lissé (Catmull-Rom-ish quadratics) pour rendu plus organique sur 4+ pts
    const smoothPath = (() => {
      if (points.length < 2) return '';
      if (points.length === 2) {
        return `M ${points[0]!.x},${points[0]!.y} L ${points[1]!.x},${points[1]!.y}`;
      }
      let d = `M ${points[0]!.x},${points[0]!.y}`;
      for (let i = 0; i < points.length - 1; i++) {
        const curr = points[i]!;
        const next = points[i + 1]!;
        const cx = (curr.x + next.x) / 2;
        const cy = (curr.y + next.y) / 2;
        d += ` Q ${curr.x},${curr.y} ${cx},${cy}`;
      }
      const last = points[points.length - 1]!;
      d += ` T ${last.x},${last.y}`;
      return d;
    })();

    const areaPath = smoothPath
      ? `${smoothPath} L ${width},${height} L 0,${height} Z`
      : `M 0,${height} L ${pointsStr} L ${width},${height} Z`;

    const minIdx = points.reduce((acc, p, i, arr) => (p.y > arr[acc]!.y ? i : acc), 0);
    const maxIdx = points.reduce((acc, p, i, arr) => (p.y < arr[acc]!.y ? i : acc), 0);

    return { points, pointsStr, smoothPath, areaPath, minIdx, maxIdx };
  }, [data, width, height]);

  if (!geometry) return null;

  const { points, smoothPath, areaPath, minIdx, maxIdx } = geometry;
  const last = points[points.length - 1]!;
  const strokeGradientId = `sl-stroke-${uid}`;
  const areaGradientId = `sl-area-${uid}`;
  const glowId = `sl-glow-${uid}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('overflow-visible block', className)}
      width={width}
      height={height}
      role="img"
      aria-label="Tendance"
    >
      <defs>
        <linearGradient id={strokeGradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.secondary} />
        </linearGradient>
        <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.primary} stopOpacity={0.32} />
          <stop offset="55%" stopColor={colors.primary} stopOpacity={0.10} />
          <stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
        </linearGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Area fill */}
      <path d={areaPath} fill={`url(#${areaGradientId})`} />

      {/* Stroke (animated path draw au mount) */}
      <path
        d={smoothPath}
        fill="none"
        stroke={`url(#${strokeGradientId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={terminalDotStripe ? undefined : `url(#${glowId})`}
        style={
          noAnimation
            ? undefined
            : {
                strokeDasharray: 1000,
                strokeDashoffset: 1000,
                animation: 'sparkline-draw 900ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
              }
        }
      />

      {/* Min/Max markers */}
      {showMinMax && points.length >= 3 && (
        <>
          <circle
            cx={points[maxIdx]!.x}
            cy={points[maxIdx]!.y}
            r={1.8}
            fill={colors.primary}
            opacity={0.6}
          />
          <circle
            cx={points[minIdx]!.x}
            cy={points[minIdx]!.y}
            r={1.8}
            fill={colors.secondary}
            opacity={0.4}
          />
        </>
      )}

      {/* Last dot — Stripe terminal (Sprint 40 40-1A) ou glowing legacy */}
      {showLastDot && (
        terminalDotStripe ? (
          <circle
            cx={last.x}
            cy={last.y}
            r={3.5}
            fill={colors.primary}
            stroke="white"
            strokeWidth={1.5}
            className="dashboard-kpi-sparkline-dot-terminal"
          />
        ) : (
          <>
            <circle
              cx={last.x}
              cy={last.y}
              r={4.5}
              fill={colors.secondary}
              opacity={0.18}
            />
            <circle
              cx={last.x}
              cy={last.y}
              r={2.4}
              fill={colors.secondary}
              stroke="white"
              strokeWidth={1}
              filter={`url(#${glowId})`}
            />
          </>
        )
      )}
    </svg>
  );
}
