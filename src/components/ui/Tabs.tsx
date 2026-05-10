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
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px whitespace-nowrap',
      'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]',
      'data-[state=active]:border-[var(--brand-primary)] data-[state=active]:text-[var(--brand-primary)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
      className
    )}
    {...props}
  />
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
