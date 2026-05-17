// ── NotFound — 404 page premium (Sprint 24 vague 5A) ───────────────────────
// Réutilise <EmptyState> primitive avec orbs floats + gradient brand pour
// une expérience de page introuvable cohérente avec le design system.

import { useNavigate } from '@tanstack/react-router';
import { Search, Home } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
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
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
      }}
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
              <stop offset="0%" stopColor="#009DDB" />
              <stop offset="100%" stopColor="#D96E27" />
            </linearGradient>
            <radialGradient id="halo-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,157,219,0.30)" />
              <stop offset="100%" stopColor="rgba(0,157,219,0)" />
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
          <circle cx="78" cy="78" r="44" fill="rgba(0,157,219,0.08)" />
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
          <button
            onClick={() => void navigate({ to: '/dashboard' })}
            className="inline-flex items-center gap-2 h-10 px-5 text-sm font-semibold rounded-[10px] text-white active:scale-[0.98] transition-all cursor-pointer"
            style={{
              background:
                'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
              boxShadow:
                '0 4px 16px -2px rgba(0,157,219,0.45), 0 0 22px -4px rgba(217,110,39,0.35), inset 0 1px 0 rgba(255,255,255,0.20)',
              border: '1px solid rgba(0,157,219,0.55)',
            }}
          >
            <Icon as={Home} size={15} strokeWidth={2.3} />
            {t('notfound.action.home')}
          </button>
        }
        secondaryAction={
          <button
            onClick={openSearch}
            className="inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold rounded-[10px] text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors cursor-pointer"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
            }}
          >
            <Icon as={Search} size={15} strokeWidth={2.3} />
            {t('notfound.action.search')}
            <span
              className="ml-1 text-[10px] px-1.5 py-0.5 rounded font-bold tracking-wider"
              style={{
                background:
                  'linear-gradient(135deg, rgba(0,157,219,0.10) 0%, rgba(217,110,39,0.06) 100%)',
                color: 'var(--primary)',
                border: '1px solid rgba(0,157,219,0.22)',
              }}
            >
              ⌘K
            </span>
          </button>
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
