// ── EmptyState — placeholder encourageant ───────────────────
import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-20 px-6 text-center', className)}>
      {icon && <div className="text-[var(--text-muted)] mb-4 text-5xl">{icon}</div>}
      <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      {description && <p className="text-sm text-[var(--text-muted)] max-w-sm mb-4">{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}
