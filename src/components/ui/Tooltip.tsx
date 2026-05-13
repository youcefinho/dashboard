// ── Tooltip — Radix tooltip accessible ──────────────────────
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

export function Tooltip({ children, content, side = 'top', className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              // Sprint 23 — tooltip premium : gradient bg + shadow brand + animation
              'z-50 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-white animate-in fade-in-0 zoom-in-95',
              className
            )}
            style={{
              background: 'linear-gradient(135deg, oklch(0.20 0.02 260) 0%, oklch(0.15 0.025 260) 100%)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.1), 0 8px 16px -4px rgba(0,157,219,0.25), 0 0 0 1px rgba(0,157,219,0.15)',
            }}
          >
            {content}
            <TooltipPrimitive.Arrow style={{ fill: 'oklch(0.18 0.022 260)' }} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
