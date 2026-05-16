// ── Tooltip — Radix tooltip Stripe-clean (Sprint 38) ─────────────────────────
// Container : bg gray-900, text white, padding 6px 10px, radius-md, caption.
// Pas de gradient, sparkle, ou shadow brand bi-color.
// API publique 100% préservée : content, title, description, icon, shortcut,
// side, align, variant (default | brand | danger | success | info), delay,
// shouldRender, className.

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type TooltipVariant = 'default' | 'brand' | 'danger' | 'success' | 'info';

interface TooltipProps {
  children: ReactNode;
  /** Contenu simple — pour les cas one-liner */
  content?: ReactNode;
  /** Titre (bold) — pour multi-line */
  title?: string;
  /** Description sous le titre — pour multi-line */
  description?: string;
  /** Icon à gauche du contenu (taille 12-14) */
  icon?: ReactNode;
  /** Raccourci clavier ("⌘K", "Esc", etc.) — affiché en chip à droite */
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Variante visuelle — défaut dark Stripe */
  variant?: TooltipVariant;
  /** Delay avant apparition (ms) — défaut 200 */
  delay?: number;
  /** Skip le rendu (ex: mobile no-hover) — children passé sans wrap */
  shouldRender?: boolean;
  className?: string;
}

interface VariantStyle {
  bg: string;
  arrowFill: string;
  text: string;
  chipBg: string;
  descColor: string;
}

function resolveVariant(variant: TooltipVariant): VariantStyle {
  switch (variant) {
    case 'brand':
      return {
        bg: 'var(--primary)',
        arrowFill: 'var(--primary)',
        text: '#FFFFFF',
        chipBg: 'rgba(255,255,255,0.20)',
        descColor: 'rgba(255,255,255,0.80)',
      };
    case 'danger':
      return {
        bg: 'var(--danger)',
        arrowFill: 'var(--danger)',
        text: '#FFFFFF',
        chipBg: 'rgba(255,255,255,0.20)',
        descColor: 'rgba(255,255,255,0.80)',
      };
    case 'success':
      return {
        bg: 'var(--success)',
        arrowFill: 'var(--success)',
        text: '#FFFFFF',
        chipBg: 'rgba(255,255,255,0.20)',
        descColor: 'rgba(255,255,255,0.80)',
      };
    case 'info':
      return {
        bg: 'var(--info)',
        arrowFill: 'var(--info)',
        text: '#FFFFFF',
        chipBg: 'rgba(255,255,255,0.20)',
        descColor: 'rgba(255,255,255,0.80)',
      };
    case 'default':
    default:
      return {
        bg: 'var(--gray-900)',
        arrowFill: 'var(--gray-900)',
        text: '#FFFFFF',
        chipBg: 'rgba(255,255,255,0.14)',
        descColor: 'rgba(255,255,255,0.72)',
      };
  }
}

export function Tooltip({
  children,
  content,
  title,
  description,
  icon,
  shortcut,
  side = 'top',
  align = 'center',
  variant = 'default',
  delay = 200,
  shouldRender = true,
  className,
}: TooltipProps) {
  if (!shouldRender) return <>{children}</>;

  const hasMultiLine = !!title || !!description;
  const v = resolveVariant(variant);

  return (
    <TooltipPrimitive.Provider delayDuration={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            className={cn(
              'z-50 animate-in fade-in-0',
              className
            )}
            style={{
              background: v.bg,
              color: v.text,
              padding: hasMultiLine ? '8px 12px' : '6px 10px',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-caption)',
              maxWidth: '280px',
              boxShadow: 'var(--shadow-md)',
              animationDuration: '150ms',
              animationTimingFunction: 'var(--ease)',
            }}
          >
            {hasMultiLine ? (
              <div className="flex items-start gap-2">
                {icon && (
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 shrink-0 mt-0.5"
                    style={{ background: v.chipBg, borderRadius: 'var(--radius-sm)' }}
                  >
                    {icon}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  {title && (
                    <p
                      className="font-semibold leading-tight"
                      style={{ fontSize: 'var(--text-caption)' }}
                    >
                      {title}
                    </p>
                  )}
                  {description && (
                    <p
                      className="mt-0.5 leading-relaxed"
                      style={{
                        color: v.descColor,
                        fontSize: '11px',
                      }}
                    >
                      {description}
                    </p>
                  )}
                </div>
                {shortcut && (
                  <span
                    className="inline-flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background: v.chipBg,
                      color: v.text,
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-xs)',
                      fontSize: '10px',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {shortcut}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {icon && (
                  <span className="inline-flex items-center justify-center shrink-0">{icon}</span>
                )}
                <span style={{ fontSize: 'var(--text-caption)', fontWeight: 500 }}>
                  {content}
                </span>
                {shortcut && (
                  <span
                    className="inline-flex items-center justify-center ml-1"
                    style={{
                      background: v.chipBg,
                      color: v.text,
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-xs)',
                      fontSize: '10px',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {shortcut}
                  </span>
                )}
              </div>
            )}
            <TooltipPrimitive.Arrow style={{ fill: v.arrowFill }} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
