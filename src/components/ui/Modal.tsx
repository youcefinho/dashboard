// ── Modal — Radix Dialog primitive ──────────────────────────
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-4xl' };

export function Modal({ open, onOpenChange, title, description, children, className, size = 'md' }: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.18_0.015_260/0.5)] backdrop-blur-[4px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-[var(--bg-surface)] rounded-[var(--radius-lg)] shadow-[var(--shadow-xl)] w-[calc(100%-2rem)]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          sizeMap[size], className
        )}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-[var(--text-primary)]">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="text-xs text-[var(--text-muted)] mt-0.5">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="p-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
