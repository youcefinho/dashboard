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
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.18_0.015_260/0.55)] backdrop-blur-[6px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className={cn(
          // Sprint 23 — modal premium : layered shadow + gradient bg subtil + orb décoratif
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl w-[calc(100%-2rem)] overflow-hidden',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          sizeMap[size], className
        )}
          style={{
            background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 24px 64px -8px rgba(15,23,42,0.18), 0 0 60px -12px rgba(0,157,219,0.18)',
          }}>
          {/* Orb décoratif top-right */}
          <div
            aria-hidden
            className="absolute -top-12 -right-12 w-48 h-48 rounded-full pointer-events-none opacity-50"
            style={{
              background: 'radial-gradient(circle, rgba(217,110,39,0.22) 0%, rgba(0,157,219,0.12) 50%, transparent 75%)',
              filter: 'blur(40px)',
            }}
          />
          <div className="relative flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]"
            style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(12px) saturate(160%)' }}>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-semibold text-[var(--text-primary)] tracking-tight">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="text-xs text-[var(--text-muted)] mt-0.5">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer shrink-0">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="relative p-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
