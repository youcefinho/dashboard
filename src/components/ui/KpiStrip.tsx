// ── KpiStrip — Bande de mini-KPIs contextuels (Sprint 38 Stripe-clean) ──────
// Rangée de mini-stats sober : label uppercase 11px gray-muted + value 28px
// gray-900 tabular-nums + delta chip success/danger/neutral.
// Plus de gradient brand, orbs, ou shadows cyan-tinted.
//
// API préservée 100% :
//   - `items: KpiItem[]`
//   - `className?: string`
//   - `compact?: boolean`  (Sprint 38 — padding réduit, value 22px)
//   - `dense?: boolean`    (Sprint 38 — alias compat, mappe sur compact)

import type { ReactNode } from 'react';
import { AnimatedNumber } from './AnimatedNumber';

export interface KpiItem {
  label: string;
  value: number | string;
  /** Couleur sémantique du delta + accent icon (Stripe sober). */
  color?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral';
  /** Icon optionnel à gauche du label */
  icon?: ReactNode;
  /** Delta % vs période précédente (ex: "+12%") */
  delta?: string;
  /** true = delta vert (success), false = delta rouge (danger), undefined = neutre */
  deltaUp?: boolean;
  /** Sparkline data optionnelle (réservé future intégration). */
  sparkData?: number[];
  /** Au clic, exécuter une action (ex: filter, navigate) */
  onClick?: () => void;
}

interface KpiStripProps {
  items: KpiItem[];
  className?: string;
  /** Mode compact (padding réduit + value 22px). */
  compact?: boolean;
  /** Alias compat — équivalent à `compact`. */
  dense?: boolean;
}

// Résolution sémantique vers couleurs sober Stripe (var() pour cohérence).
function resolveAccent(color: KpiItem['color']): string {
  switch (color) {
    case 'success': return 'var(--success)';
    case 'warning': return 'var(--warning)';
    case 'danger':  return 'var(--danger)';
    case 'info':    return 'var(--info)';
    case 'accent':  return 'var(--accent-orange)';
    case 'neutral': return 'var(--text-muted)';
    case 'brand':
    case undefined:
    default:        return 'var(--primary)';
  }
}

export function KpiStrip({ items, className = '', compact, dense }: KpiStripProps) {
  const isCompact = Boolean(compact || dense);
  return (
    <div
      className={`flex gap-6 overflow-x-auto ${isCompact ? 'py-2 px-1' : 'py-4 px-1'} ${className}`.trim()}
    >
      {items.map((item, i) => {
        const accent = resolveAccent(item.color);
        const isClickable = !!item.onClick;
        const Tag = isClickable ? 'button' : 'div';

        // Delta color sémantique (Stripe sober)
        const deltaIsDown = item.deltaUp === false;
        const deltaColor = item.deltaUp === undefined
          ? 'var(--text-muted)'
          : deltaIsDown ? 'var(--danger)' : 'var(--success)';
        const deltaBg = item.deltaUp === undefined
          ? 'var(--bg-subtle)'
          : deltaIsDown ? 'var(--danger-soft)' : 'var(--success-soft)';
        const deltaArrow = item.deltaUp === undefined ? '' : deltaIsDown ? '▼' : '▲';

        return (
          <Tag
            key={i}
            onClick={item.onClick}
            type={isClickable ? 'button' : undefined}
            className={`flex flex-col gap-1 min-w-0 flex-1 text-left ${
              isClickable
                ? 'cursor-pointer rounded-md transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'
                : ''
            } ${isCompact ? 'px-2 py-1' : 'px-2 py-1'}`}
          >
            {/* Label uppercase 11px gray-muted (.t-meta) */}
            <div className="flex items-center gap-1.5">
              {item.icon && (
                <span
                  aria-hidden
                  className="inline-flex items-center justify-center w-4 h-4 shrink-0"
                  style={{ color: accent }}
                >
                  {item.icon}
                </span>
              )}
              <span className="t-meta">{item.label}</span>
            </div>

            {/* Value 28px (22 compact) gray-900 tabular-nums + delta chip */}
            <div className="flex items-baseline gap-2 flex-wrap">
              <span
                className="t-mono-num font-semibold text-[var(--text-primary)] leading-[1.2]"
                style={{ fontSize: isCompact ? 22 : 28 }}
              >
                {typeof item.value === 'number' ? <AnimatedNumber value={item.value} /> : item.value}
              </span>
              {item.delta && (
                <span
                  className="inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-[var(--radius-sm)]"
                  style={{ color: deltaColor, background: deltaBg }}
                >
                  {deltaArrow && <span aria-hidden>{deltaArrow}</span>}
                  <span>{item.delta}</span>
                </span>
              )}
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
