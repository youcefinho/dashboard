// ── NotFound — 404 page premium (Sprint 24 vague 5A) ───────────────────────
// Réutilise <EmptyState> primitive avec orbs floats + gradient brand pour
// une expérience de page introuvable cohérente avec le design system.

import { useNavigate } from '@tanstack/react-router';
import { Search, Home } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/lib/i18n';

export function NotFound() {
  const navigate = useNavigate();

  const openSearch = () => {
    // Simule cmd+K via event keyboard (CommandPalette listen handleGlobalKeyDown)
    const ev = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(ev);
  };

  return (
    <div
      className="empty-state-premium-s4 relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-[var(--bg-canvas)]"
    >
      {/* Illustration SVG inline — loupe + orb décoratif */}
      <div className="relative mb-2 mt-12">
        <svg
          width="180"
          height="180"
          viewBox="0 0 180 180"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
          className="relative z-10"
        >
          <defs>
            <linearGradient id="lens-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#635BFF" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>
            <radialGradient id="halo-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(99,91,255,0.30)" />
              <stop offset="100%" stopColor="rgba(99,91,255,0)" />
            </radialGradient>
          </defs>
          {/* Halo */}
          <circle cx="78" cy="78" r="76" fill="url(#halo-grad)" />
          {/* Loupe ring */}
          <circle
            cx="78"
            cy="78"
            r="48"
            stroke="url(#lens-grad)"
            strokeWidth="8"
            fill="none"
          />
          {/* Loupe glass tint */}
          <circle cx="78" cy="78" r="44" fill="rgba(99,91,255,0.08)" />
          {/* Handle */}
          <line
            x1="118"
            y1="118"
            x2="158"
            y2="158"
            stroke="url(#lens-grad)"
            strokeWidth="10"
            strokeLinecap="round"
          />
          {/* "?" inside loupe */}
          <text
            x="78"
            y="92"
            textAnchor="middle"
            fontSize="44"
            fontWeight="800"
            fill="url(#lens-grad)"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            ?
          </text>
        </svg>
      </div>

      <EmptyState
        meta={t('notfound.meta')}
        title={t('notfound.title')}
        description={t('notfound.description')}
        action={
          <Button
            variant="primary"
            size="lg"
            onClick={() => void navigate({ to: '/dashboard' })}
            leftIcon={<Icon as={Home} size={15} strokeWidth={2.3} />}
          >
            {t('notfound.action.home')}
          </Button>
        }
        secondaryAction={
          <Button
            variant="secondary"
            onClick={openSearch}
            leftIcon={<Icon as={Search} size={15} strokeWidth={2.3} />}
          >
            {t('notfound.action.search')}
            <span
              className="ml-1 text-[10px] px-1.5 py-0.5 rounded font-bold tracking-wider bg-[var(--primary-soft)] text-[var(--primary)] border border-[var(--primary-ring)]"
            >
              ⌘K
            </span>
          </Button>
        }
        tips={[
          t('notfound.tips.url'),
          t('notfound.tips.search'),
          t('notfound.tips.link'),
        ]}
      />
    </div>
  );
}
