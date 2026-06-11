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
      // Sprint S10 — underline 2px sliding Stripe-style
      'relative px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap',
      'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
      'data-[state=active]:text-[var(--primary)] data-[state=active]:font-semibold',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)]',
      'group',
      className
    )}
    {...props}
  >
    {children}
    {/* Underline 2px — transition scale+opacity pour effet slide subtil */}
    <span aria-hidden
      className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full transition-all duration-200 ease-out scale-x-0 opacity-0 group-data-[state=active]:scale-x-100 group-data-[state=active]:opacity-100"
      style={{
        background: 'var(--primary)',
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
