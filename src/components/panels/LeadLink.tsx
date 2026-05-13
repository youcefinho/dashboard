// ── LeadLink — Lien vers fiche lead qui ouvre un SlidePanel par défaut ──────
// Comportement :
//   - Click simple → ouvre le SlidePanel (pas de navigation full-page)
//   - Cmd/Ctrl+Click, Shift+Click, middle-click → comportement <a> natif (nouvel onglet etc.)
//   - Keyboard accessible (Tab + Enter)

import { type ReactNode, type MouseEvent, type KeyboardEvent } from 'react';
import { usePanelStack } from '@/components/ui';
import { prefetchLeadOnHover, cancelPrefetchHover } from '@/lib/prefetch';

interface LeadLinkProps {
  leadId: string;
  className?: string;
  children: ReactNode;
  /** Si true, force la navigation full-page au lieu du panel (back-compat) */
  forcePage?: boolean;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

export function LeadLink({ leadId, className, children, forcePage, onClick }: LeadLinkProps) {
  const { openPanel } = usePanelStack();

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    // Laisser le browser gérer si modifier ou click hors bouton gauche
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || forcePage) return;
    e.preventDefault();
    openPanel({ type: 'lead', id: leadId });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !forcePage) {
      e.preventDefault();
      openPanel({ type: 'lead', id: leadId });
    }
  };

  return (
    <a
      href={`/leads/${leadId}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => prefetchLeadOnHover(leadId)}
      onMouseLeave={() => cancelPrefetchHover(leadId)}
      onFocus={() => prefetchLeadOnHover(leadId)}
      className={className}
    >
      {children}
    </a>
  );
}
