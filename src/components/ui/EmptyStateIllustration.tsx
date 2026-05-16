// ── EmptyStateIllustration — SVG illustrations Stripe-clean (Sprint 45 M2.1) ─
// Refonte minimalist line-art : stroke 1.5px, primary purple #635BFF,
// accent gray-400 #9CA3AF. Plus de gradient cyan→orange dramatic, plus
// d'halo radial massif, plus de fond fill opacité 22+%.
//
// Style guide :
//   - viewBox 0 0 160 120 (ratio 4:3)
//   - stroke #635BFF (primary) pour traits principaux
//   - stroke #9CA3AF (gray-400) pour secondary
//   - fill #F9FAFB (gray-50) pour fond cards subtle
//   - radius arrondi rx="3-8" cards / rx="2" chips
//
// 8 illustrations Stripe-clean :
//   leads · tasks · pipeline · inbox · calendar · reports
//   onboarding (NEW) · celebration (NEW)
//
// API préservée 100% (`kind`, `size`) — alias `<Illustration name=... />`
// exporté en parallèle pour cohérence avec brief Sprint 45.

import { type CSSProperties } from 'react';

type Kind =
  | 'leads'
  | 'tasks'
  | 'pipeline'
  | 'inbox'
  | 'calendar'
  | 'reports'
  | 'onboarding'
  | 'celebration';

interface EmptyStateIllustrationProps {
  kind: Kind;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

// Colors Stripe-clean (no gradient brand massif)
const COLOR_PRIMARY = '#635BFF';     // primary purple
const COLOR_PRIMARY_SOFT = '#A5A0FF'; // primary 60%
const COLOR_GRAY = '#9CA3AF';        // gray-400 accent
const COLOR_GRAY_SOFT = '#E5E7EB';   // gray-200
const COLOR_BG = '#F9FAFB';          // gray-50
const COLOR_WHITE = '#FFFFFF';

export function EmptyStateIllustration({
  kind,
  size = 140,
  className,
  style,
}: EmptyStateIllustrationProps) {
  const w = size;
  const h = Math.round((size * 120) / 160); // ratio 160:120

  switch (kind) {
    case 'leads':
      return (
        <svg
          viewBox="0 0 160 120"
          width={w}
          height={h}
          className={className}
          style={style}
          role="img"
          aria-hidden
          focusable="false"
        >
          {/* Card backdrop */}
          <rect x="20" y="20" width="120" height="80" rx="8" fill={COLOR_BG} stroke={COLOR_GRAY_SOFT} strokeWidth="1" />
          {/* Center silhouette larger */}
          <circle cx="80" cy="50" r="12" fill="none" stroke={COLOR_PRIMARY} strokeWidth="1.5" />
          <path d="M64 80 Q80 64 96 80" fill="none" stroke={COLOR_PRIMARY} strokeWidth="1.5" strokeLinecap="round" />
          {/* Left silhouette */}
          <circle cx="44" cy="58" r="8" fill="none" stroke={COLOR_GRAY} strokeWidth="1.5" />
          <path d="M34 84 Q44 72 54 84" fill="none" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
          {/* Right silhouette */}
          <circle cx="116" cy="58" r="8" fill="none" stroke={COLOR_GRAY} strokeWidth="1.5" />
          <path d="M106 84 Q116 72 126 84" fill="none" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
          {/* Plus indicator subtle top-right */}
          <circle cx="128" cy="32" r="6" fill={COLOR_PRIMARY} />
          <line x1="125" y1="32" x2="131" y2="32" stroke={COLOR_WHITE} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="128" y1="29" x2="128" y2="35" stroke={COLOR_WHITE} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'tasks':
      return (
        <svg
          viewBox="0 0 160 120"
          width={w}
          height={h}
          className={className}
          style={style}
          role="img"
          aria-hidden
          focusable="false"
        >
          {/* Card */}
          <rect x="36" y="14" width="88" height="92" rx="8" fill={COLOR_WHITE} stroke={COLOR_GRAY_SOFT} strokeWidth="1" />
          {/* Header line */}
          <line x1="46" y1="28" x2="84" y2="28" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
          {/* Item 1 — checked */}
          <rect x="46" y="42" width="12" height="12" rx="3" fill={COLOR_PRIMARY} />
          <path d="M49 48 L52 51 L56 46" stroke={COLOR_WHITE} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="64" y1="48" x2="110" y2="48" stroke={COLOR_GRAY_SOFT} strokeWidth="2" strokeLinecap="round" />
          {/* Item 2 — unchecked */}
          <rect x="46" y="62" width="12" height="12" rx="3" fill="none" stroke={COLOR_PRIMARY} strokeWidth="1.5" />
          <line x1="64" y1="68" x2="104" y2="68" stroke={COLOR_GRAY_SOFT} strokeWidth="2" strokeLinecap="round" />
          {/* Item 3 — unchecked */}
          <rect x="46" y="82" width="12" height="12" rx="3" fill="none" stroke={COLOR_PRIMARY} strokeWidth="1.5" />
          <line x1="64" y1="88" x2="98" y2="88" stroke={COLOR_GRAY_SOFT} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case 'pipeline':
      return (
        <svg
          viewBox="0 0 160 120"
          width={w}
          height={h}
          className={className}
          style={style}
          role="img"
          aria-hidden
          focusable="false"
        >
          {/* 3 Kanban columns */}
          <rect x="14" y="22" width="40" height="76" rx="6" fill={COLOR_BG} stroke={COLOR_GRAY_SOFT} strokeWidth="1" />
          <rect x="60" y="22" width="40" height="76" rx="6" fill={COLOR_BG} stroke={COLOR_GRAY_SOFT} strokeWidth="1" />
          <rect x="106" y="22" width="40" height="76" rx="6" fill={COLOR_BG} stroke={COLOR_GRAY_SOFT} strokeWidth="1" />
          {/* Card col 1 */}
          <rect x="20" y="32" width="28" height="16" rx="3" fill={COLOR_WHITE} stroke={COLOR_PRIMARY} strokeWidth="1.5" />
          <rect x="20" y="54" width="28" height="16" rx="3" fill={COLOR_WHITE} stroke={COLOR_GRAY} strokeWidth="1.5" />
          {/* Card col 2 — drag indicator */}
          <rect x="66" y="32" width="28" height="16" rx="3" fill={COLOR_WHITE} stroke={COLOR_PRIMARY} strokeWidth="1.5" />
          {/* Card col 3 */}
          <rect x="112" y="32" width="28" height="16" rx="3" fill={COLOR_WHITE} stroke={COLOR_GRAY} strokeWidth="1.5" />
          {/* Column headers (tiny dots) */}
          <circle cx="34" cy="18" r="2" fill={COLOR_PRIMARY} />
          <circle cx="80" cy="18" r="2" fill={COLOR_GRAY} />
          <circle cx="126" cy="18" r="2" fill={COLOR_GRAY} />
          {/* Arrow flow */}
          <path d="M54 40 L60 40" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M100 40 L106 40" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'inbox':
      return (
        <svg
          viewBox="0 0 160 120"
          width={w}
          height={h}
          className={className}
          style={style}
          role="img"
          aria-hidden
          focusable="false"
        >
          {/* Envelope body */}
          <rect x="28" y="36" width="104" height="60" rx="8" fill={COLOR_WHITE} stroke={COLOR_PRIMARY} strokeWidth="1.5" />
          {/* Flap (open V) */}
          <path d="M28 42 L80 72 L132 42" fill="none" stroke={COLOR_PRIMARY} strokeWidth="1.5" strokeLinejoin="round" />
          {/* Paper peeking out top */}
          <rect x="44" y="22" width="72" height="22" rx="3" fill={COLOR_BG} stroke={COLOR_GRAY} strokeWidth="1.5" />
          <line x1="52" y1="30" x2="92" y2="30" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="52" y1="36" x2="84" y2="36" stroke={COLOR_GRAY_SOFT} strokeWidth="1.5" strokeLinecap="round" />
          {/* Notification dot (subtle) */}
          <circle cx="124" cy="36" r="5" fill={COLOR_PRIMARY} />
          <circle cx="124" cy="36" r="2" fill={COLOR_WHITE} />
        </svg>
      );

    case 'calendar':
      return (
        <svg
          viewBox="0 0 160 120"
          width={w}
          height={h}
          className={className}
          style={style}
          role="img"
          aria-hidden
          focusable="false"
        >
          {/* Calendar card */}
          <rect x="28" y="24" width="104" height="80" rx="8" fill={COLOR_WHITE} stroke={COLOR_PRIMARY} strokeWidth="1.5" />
          {/* Header band */}
          <path
            d="M28 32 a8 8 0 0 1 8 -8 L124 24 a8 8 0 0 1 8 8 L132 42 L28 42 Z"
            fill={COLOR_PRIMARY}
          />
          {/* Hook rails */}
          <rect x="46" y="18" width="4" height="12" rx="1" fill={COLOR_PRIMARY_SOFT} />
          <rect x="110" y="18" width="4" height="12" rx="1" fill={COLOR_PRIMARY_SOFT} />
          {/* Grid 5×3 */}
          {[0, 1, 2, 3, 4].map((c) =>
            [0, 1, 2].map((r) => (
              <rect
                key={`${c}-${r}`}
                x={38 + c * 18}
                y={50 + r * 16}
                width="14"
                height="11"
                rx="2"
                fill={c === 2 && r === 1 ? COLOR_PRIMARY : 'none'}
                stroke={c === 2 && r === 1 ? 'none' : COLOR_GRAY_SOFT}
                strokeWidth="1"
              />
            ))
          )}
        </svg>
      );

    case 'reports':
      return (
        <svg
          viewBox="0 0 160 120"
          width={w}
          height={h}
          className={className}
          style={style}
          role="img"
          aria-hidden
          focusable="false"
        >
          {/* Card */}
          <rect x="20" y="20" width="120" height="80" rx="8" fill={COLOR_WHITE} stroke={COLOR_GRAY_SOFT} strokeWidth="1" />
          {/* Axis */}
          <line x1="34" y1="84" x2="126" y2="84" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="34" y1="34" x2="34" y2="84" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
          {/* Bars */}
          <rect x="44" y="62" width="14" height="22" rx="2" fill={COLOR_PRIMARY_SOFT} />
          <rect x="64" y="48" width="14" height="36" rx="2" fill={COLOR_PRIMARY} />
          <rect x="84" y="56" width="14" height="28" rx="2" fill={COLOR_PRIMARY_SOFT} />
          <rect x="104" y="40" width="14" height="44" rx="2" fill={COLOR_PRIMARY} />
          {/* Trend line over bars */}
          <polyline
            points="51,62 71,48 91,56 111,40"
            fill="none"
            stroke={COLOR_GRAY}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 3"
          />
        </svg>
      );

    case 'onboarding':
      return (
        <svg
          viewBox="0 0 160 120"
          width={w}
          height={h}
          className={className}
          style={style}
          role="img"
          aria-hidden
          focusable="false"
        >
          {/* Path / checklist */}
          <rect x="28" y="18" width="104" height="88" rx="8" fill={COLOR_WHITE} stroke={COLOR_GRAY_SOFT} strokeWidth="1" />
          {/* Step 1 — done */}
          <circle cx="44" cy="36" r="6" fill={COLOR_PRIMARY} />
          <path d="M41 36 L43 38 L47 34" stroke={COLOR_WHITE} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="56" y1="36" x2="116" y2="36" stroke={COLOR_GRAY_SOFT} strokeWidth="1.5" strokeLinecap="round" />
          {/* Connector */}
          <line x1="44" y1="42" x2="44" y2="56" stroke={COLOR_PRIMARY_SOFT} strokeWidth="1.5" strokeDasharray="2 3" />
          {/* Step 2 — done */}
          <circle cx="44" cy="62" r="6" fill={COLOR_PRIMARY} />
          <path d="M41 62 L43 64 L47 60" stroke={COLOR_WHITE} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="56" y1="62" x2="110" y2="62" stroke={COLOR_GRAY_SOFT} strokeWidth="1.5" strokeLinecap="round" />
          {/* Connector */}
          <line x1="44" y1="68" x2="44" y2="82" stroke={COLOR_GRAY_SOFT} strokeWidth="1.5" strokeDasharray="2 3" />
          {/* Step 3 — current */}
          <circle cx="44" cy="88" r="6" fill="none" stroke={COLOR_PRIMARY} strokeWidth="1.5" />
          <circle cx="44" cy="88" r="2" fill={COLOR_PRIMARY} />
          <line x1="56" y1="88" x2="120" y2="88" stroke={COLOR_GRAY_SOFT} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'celebration':
      return (
        <svg
          viewBox="0 0 160 120"
          width={w}
          height={h}
          className={className}
          style={style}
          role="img"
          aria-hidden
          focusable="false"
        >
          {/* Trophy / check medal */}
          <circle cx="80" cy="60" r="28" fill={COLOR_WHITE} stroke={COLOR_PRIMARY} strokeWidth="1.5" />
          <circle cx="80" cy="60" r="22" fill={COLOR_PRIMARY} />
          <path d="M70 60 L77 67 L90 54" stroke={COLOR_WHITE} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {/* Confetti subtle (gray-400 + primary-soft) */}
          <line x1="32" y1="30" x2="36" y2="34" stroke={COLOR_PRIMARY_SOFT} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="36" y1="30" x2="32" y2="34" stroke={COLOR_PRIMARY_SOFT} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="124" y1="32" x2="128" y2="36" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="128" y1="32" x2="124" y2="36" stroke={COLOR_GRAY} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="26" cy="68" r="2.5" fill={COLOR_PRIMARY_SOFT} />
          <circle cx="134" cy="72" r="2.5" fill={COLOR_GRAY} />
          <circle cx="44" cy="98" r="2" fill={COLOR_PRIMARY} />
          <circle cx="118" cy="100" r="2" fill={COLOR_PRIMARY_SOFT} />
          {/* Star sparkle top-center */}
          <path d="M80 18 L82 24 L88 24 L83 28 L85 34 L80 30 L75 34 L77 28 L72 24 L78 24 Z" fill={COLOR_PRIMARY_SOFT} />
        </svg>
      );

    default:
      return null;
  }
}

// ── Alias `<Illustration name=... size=... />` ─────────────────────
// Brief Sprint 45 M2.1 — API canonical `name` prop. Wrapper non destructif
// qui re-route vers `EmptyStateIllustration` (kind === name).
export interface IllustrationProps {
  name: Kind;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Illustration({ name, size = 140, className, style }: IllustrationProps) {
  return (
    <EmptyStateIllustration kind={name} size={size} className={className} style={style} />
  );
}
