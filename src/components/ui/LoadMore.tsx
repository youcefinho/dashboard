// ── LoadMore — primitive pagination "charger plus" (LOT RÉEL Manager B) ─────
// Contrat figé docs/LOT-REEL.md §6.A B.3. Libellés via i18n §6.D (clés
// `leads.pagination.*` figées par Manager A — JAMAIS hardcodé, format {{var}}).
// 3 états mutuellement exclusifs :
//   - hasMore && !loading → bouton load_more + sous-texte loaded {{shown}}
//   - loading             → texte loading
//   - !hasMore            → texte all_loaded
import { Loader2 } from 'lucide-react';
import { Icon } from './Icon';
import { Button } from './Button';
import { t } from '@/lib/i18n';

export interface LoadMoreProps {
  onLoadMore: () => void;
  loading: boolean;
  hasMore: boolean;
  loadedCount: number;
  /** Libellé du bouton. Défaut : t('leads.pagination.load_more'). */
  label?: string;
}

export function LoadMore({
  onLoadMore,
  loading,
  hasMore,
  loadedCount,
  label,
}: LoadMoreProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--text-muted)]">
        <Icon as={Loader2} size={16} className="animate-spin" />
        <span>{t('leads.pagination.loading')}</span>
      </div>
    );
  }

  if (!hasMore) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-6">
        <p className="text-sm text-[var(--text-muted)]">
          {t('leads.pagination.all_loaded')}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {t('leads.pagination.loaded', { shown: loadedCount })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-6">
      <Button variant="secondary" size="sm" onClick={onLoadMore}>
        {label ?? t('leads.pagination.load_more')}
      </Button>
      <p className="text-xs text-[var(--text-muted)]">
        {t('leads.pagination.loaded', { shown: loadedCount })}
      </p>
    </div>
  );
}
