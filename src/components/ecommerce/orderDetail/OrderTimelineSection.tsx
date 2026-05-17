// ── OrderDetailPanel split S9 (Manager B) — timeline ────────────────────────
// Extraction ISO-RENDU STRICT depuis OrderDetailPanel.tsx (lignes 563-592).
// Pur déplacement de JSX : DOM identique, aucune logique modifiée.
import { Icon } from '@/components/ui';
import { t, type Locale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';
import type { Order } from '@/lib/types';
import { Clock } from 'lucide-react';

export function OrderTimelineSection(
  { order, locale }: { order: Order; locale: Locale },
) {
  return (
    <section>
      <h3 className="t-h3 mb-3">{t('shop.order.timeline')}</h3>
      <ul className="flex flex-col gap-2.5">
        {([
          ['placed', order.placed_at, t('shop.order.placed')],
          ['paid', order.paid_at, t('shop.order.paid_at')],
          ['shipped', order.shipped_at, t('shop.order.shipped_at')],
          ['cancelled', order.cancelled_at, t('shop.order.cancelled_at')],
        ] as const)
          .filter(([, ts]) => Boolean(ts))
          .map(([k, ts, label]) => (
            <li key={k} className="flex items-center gap-2.5 text-[13px]">
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-muted)] shrink-0"
                aria-hidden
              >
                <Icon as={Clock} size="xs" />
              </span>
              <span className="text-[var(--text-secondary)]">{label}</span>
              <span className="ml-auto t-mono-num text-[12px] text-[var(--text-muted)]">
                {formatDate(ts as string, locale, {
                  year: 'numeric', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}
