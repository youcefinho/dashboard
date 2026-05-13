// ── Tabs — Radix tabs underline style ───────────────────────
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'flex gap-1 border-b border-[var(--border-subtle)]',
      className
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Sprint 23 — gradient underline avec glow sur active (cohérent avec LeadDetail)
      'relative px-4 py-2.5 text-sm font-semibold transition-all cursor-pointer whitespace-nowrap',
      'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
      'data-[state=active]:text-[var(--brand-primary)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
      'group',
      className
    )}
    {...props}
  >
    {children}
    {/* Underline gradient active state — invisible par défaut, visible via data-state */}
    <span aria-hidden
      className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t-full opacity-0 group-data-[state=active]:opacity-100 transition-opacity"
      style={{
        background: 'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
        boxShadow: '0 -2px 12px rgba(0,157,219,0.5), 0 0 8px rgba(217,110,39,0.4)',
      }} />
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-4 focus-visible:outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';
