// ── DropdownMenu — Radix dropdown wrapper Stripe-clean (Sprint 38) ──────────
// Surface blanche, border subtile, shadow-md, items plain hover bg-hover.
// API ergonomique : <DropdownMenu trigger={...}><DropdownMenuItem .../></DropdownMenu>
// ou plus bas niveau via les sous-exports si besoin de groupes/sub-menus.
// API publique 100% préservée (Root, Trigger, Content, Item, CheckboxItem,
// RadioGroup, RadioItem, Label, Separator, SubTrigger, SubContent, Portal).

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';

// ── Root + trigger réexports ────────────────────────────────────────────────

export const DropdownMenuRoot = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

// ── Content (la "carte" qui flotte) ─────────────────────────────────────────

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[80] min-w-[180px] overflow-hidden p-1',
        'animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className
      )}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        animationDuration: 'var(--duration-fast)',
        animationTimingFunction: 'var(--ease)',
      }}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Content>
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

// ── Item (variantes : default | brand | danger) ─────────────────────────────

type DropdownItemVariant = 'default' | 'brand' | 'danger';

interface DropdownMenuItemProps extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  variant?: DropdownItemVariant;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode; // ex: shortcut "⌘K"
}

export const DropdownMenuItem = forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  ({ className, variant = 'default', leftIcon, rightSlot, children, ...props }, ref) => {
    const isDanger = variant === 'danger';
    const isBrand = variant === 'brand';

    const baseColor = isDanger
      ? 'var(--danger)'
      : isBrand
        ? 'var(--primary)'
        : 'var(--text-secondary)';

    const hoverBg = isDanger ? 'var(--danger-soft)' : 'var(--bg-hover)';
    const hoverColor = isDanger ? 'var(--danger)' : 'var(--text-primary)';

    return (
      <DropdownMenuPrimitive.Item
        ref={ref}
        className={cn(
          'relative flex items-center gap-2 outline-none',
          'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          className
        )}
        style={{
          padding: '8px 12px',
          fontSize: 'var(--text-body)',
          color: baseColor,
          cursor: 'pointer',
          borderRadius: 'var(--radius-sm)',
          fontWeight: isBrand ? 600 : 500,
          userSelect: 'none',
          transition: `background-color var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease)`,
        }}
        onPointerMove={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = hoverBg;
          el.style.color = hoverColor;
        }}
        onPointerLeave={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = '';
          el.style.color = baseColor;
        }}
        {...props}
      >
        {leftIcon && (
          <span className="shrink-0 inline-flex items-center justify-center w-4 h-4">
            {leftIcon}
          </span>
        )}
        <span className="flex-1 truncate">{children}</span>
        {rightSlot && (
          <span
            className="ml-auto shrink-0"
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              letterSpacing: '0.04em',
            }}
          >
            {rightSlot}
          </span>
        )}
      </DropdownMenuPrimitive.Item>
    );
  }
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

// ── CheckboxItem ───────────────────────────────────────────────────────────

export const DropdownMenuCheckboxItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(
      'relative flex items-center gap-2 outline-none',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      'data-[highlighted]:bg-[var(--bg-hover)] data-[highlighted]:text-[var(--text-primary)]',
      className
    )}
    style={{
      padding: '8px 12px 8px 32px',
      fontSize: 'var(--text-body)',
      color: 'var(--text-secondary)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      fontWeight: 500,
      userSelect: 'none',
    }}
    {...props}
  >
    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Icon as={Check} size={12} className="text-[var(--primary)]" strokeWidth={2.5} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

// ── RadioItem ──────────────────────────────────────────────────────────────

export const DropdownMenuRadioItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      'relative flex items-center gap-2 outline-none',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      'data-[highlighted]:bg-[var(--bg-hover)] data-[highlighted]:text-[var(--text-primary)]',
      className
    )}
    style={{
      padding: '8px 12px 8px 32px',
      fontSize: 'var(--text-body)',
      color: 'var(--text-secondary)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      fontWeight: 500,
      userSelect: 'none',
    }}
    {...props}
  >
    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <span
          className="block h-2 w-2 rounded-full"
          style={{ background: 'var(--primary)' }}
        />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';

// ── Label, Separator ───────────────────────────────────────────────────────

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'uppercase',
      className
    )}
    style={{
      padding: '6px 12px',
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '0.08em',
      color: 'var(--text-muted)',
    }}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('h-px', className)}
    style={{
      background: 'var(--border)',
      margin: '4px 0',
    }}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

// ── SubTrigger / SubContent ────────────────────────────────────────────────

export const DropdownMenuSubTrigger = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'flex items-center gap-2 outline-none',
      'data-[highlighted]:bg-[var(--bg-hover)] data-[highlighted]:text-[var(--text-primary)]',
      'data-[state=open]:bg-[var(--bg-hover)] data-[state=open]:text-[var(--text-primary)]',
      className
    )}
    style={{
      padding: '8px 12px',
      fontSize: 'var(--text-body)',
      color: 'var(--text-secondary)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      fontWeight: 500,
      userSelect: 'none',
    }}
    {...props}
  >
    {children}
    <Icon as={ChevronRight} size={12} className="ml-auto text-[var(--text-muted)]" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger';

export const DropdownMenuSubContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      'z-[80] min-w-[180px] overflow-hidden p-1',
      'animate-in fade-in-0',
      className
    )}
    style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      animationDuration: 'var(--duration-fast)',
      animationTimingFunction: 'var(--ease)',
    }}
    {...props}
  />
));
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent';

// ── DropdownMenu wrapper ergonomique ────────────────────────────────────────
// Pour les cas simples : <DropdownMenu trigger={<button>...</button>}>...</DropdownMenu>

interface DropdownMenuProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contentClassName?: string;
}

export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  sideOffset = 6,
  open,
  onOpenChange,
  contentClassName,
}: DropdownMenuProps) {
  return (
    <DropdownMenuRoot open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} sideOffset={sideOffset} className={contentClassName}>
        {children}
      </DropdownMenuContent>
    </DropdownMenuRoot>
  );
}
