// ── ScoreGauge — Visualisation circulaire d'un score 0-100 (Sprint 23 wave 9) ─
// Demi-cercle SVG avec gradient brand qui se remplit selon la valeur.
// Couleur dynamique : rouge < 40 < orange < 70 < vert.

interface ScoreGaugeProps {
  score: number;
  /** Taille du SVG (carré). Défaut 80. */
  size?: number;
  /** Affiche le label sous le chiffre (ex: "chaud / tiède / froid") */
  showLabel?: boolean;
  className?: string;
}

function getColors(score: number): { primary: string; secondary: string; label: string } {
  if (score >= 70) return { primary: '#37CA37', secondary: 'var(--primary)', label: '🔥 Chaud' };
  if (score >= 40) return { primary: '#FF9A00', secondary: '#D96E27', label: '🟡 Tiède' };
  return { primary: '#188BF6', secondary: '#155EEF', label: '🔵 Froid' };
}

export function ScoreGauge({ score, size = 80, showLabel = false, className }: ScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const colors = getColors(clamped);
  const radius = size / 2 - 6;
  const circumference = Math.PI * radius; // demi-cercle
  const filled = (clamped / 100) * circumference;
  const gradientId = `score-gradient-${score}-${Math.random().toString(36).slice(2, 7)}`;

  return (
    <div className={className} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: size, height: size / 2 + 8 }}>
        <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={colors.primary} />
              <stop offset="100%" stopColor={colors.secondary} />
            </linearGradient>
            <filter id={`${gradientId}-glow`}>
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Track */}
          <path
            d={`M 6 ${size / 2} A ${radius} ${radius} 0 0 1 ${size - 6} ${size / 2}`}
            fill="none"
            stroke="rgba(0,157,219,0.10)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          {/* Fill */}
          <path
            d={`M 6 ${size / 2} A ${radius} ${radius} 0 0 1 ${size - 6} ${size / 2}`}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - filled}
            filter={`url(#${gradientId}-glow)`}
            style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        </svg>
        {/* Score number en absolute */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingBottom: 0,
          }}
        >
          <span
            style={{
              fontSize: size * 0.32,
              lineHeight: 1,
              fontWeight: 800,
              fontVariantNumeric: 'tabular-nums',
              background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '-0.02em',
            }}
          >
            {Math.round(clamped)}
          </span>
        </div>
      </div>
      {showLabel && (
        <span style={{ fontSize: 10, fontWeight: 600, color: colors.primary }}>{colors.label}</span>
      )}
    </div>
  );
}
