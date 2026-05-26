// ── SkipToContent — Sprint 29 a11y AAA ─────────────────────────────────────
// Skip-to-content link reusable. Caché jusqu'au focus (CSS `.skip-link`
// existante dans src/index.css). À placer en TOUT premier enfant des pages
// publiques hors AppLayout (PublicForm, PublicReview, SharedDashboard,
// SignDocument, etc.).
//
// AppLayout a déjà son propre skip-link inline (ne pas dupliquer).

import { t } from '@/lib/i18n';

export interface SkipToContentProps {
  /** Target id (sans #). Défaut "main-content". */
  targetId?: string;
  /** Override texte i18n par défaut "a11y.skip_content". */
  label?: string;
}

export function SkipToContent({ targetId = 'main-content', label }: SkipToContentProps) {
  return (
    <a href={`#${targetId}`} className="skip-link">
      {label ?? t('a11y.skip_content')}
    </a>
  );
}
