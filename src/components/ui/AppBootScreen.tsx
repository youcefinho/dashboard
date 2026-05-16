// ── AppBootScreen — Loading screen premium initial mount (Sprint 34 vague 34-3A) ─
// Affiché pendant le chargement initial avant que le routeur boot, ou en
// fallback Suspense. Pattern visuel cohérent avec EmptyState (Sprint 25) :
// 2 orbs animés cyan/orange, logo gradient brand avec halo pulse 2s, tagline
// gradient cyan→orange. Respect prefers-reduced-motion : skip pulse + orbs.
//
// Usage typique :
//   <Suspense fallback={<AppBootScreen />}>...</Suspense>
//   ou directement avant que le router boot complet.

interface AppBootScreenProps {
  /** Texte d'accroche custom — defaults to "Chargement..." */
  tagline?: string;
  /** Sous-texte optionnel sous le tagline (ex: "Initialisation des données") */
  subtitle?: string;
}

export function AppBootScreen({ tagline = 'Chargement...', subtitle }: AppBootScreenProps) {
  return (
    <div className="app-boot-screen" role="status" aria-live="polite" aria-busy="true">
      {/* Orb #1 — cyan top-left */}
      <div
        aria-hidden
        className="app-boot-orb app-boot-orb--cyan"
      />
      {/* Orb #2 — orange bottom-right */}
      <div
        aria-hidden
        className="app-boot-orb app-boot-orb--orange"
      />

      <div className="app-boot-content">
        {/* Logo chip gradient brand + halo pulse */}
        <div className="app-boot-logo-wrap">
          <div
            aria-hidden
            className="app-boot-logo-halo"
          />
          <div className="app-boot-logo" aria-label="Intralys">
            {/* Logo "I" stylisé — placeholder gradient brand. Si un asset SVG
                logo existe, on peut le substituer ici. */}
            <svg
              viewBox="0 0 32 32"
              width="40"
              height="40"
              fill="none"
              aria-hidden
            >
              <rect x="6" y="4" width="20" height="6" rx="2" fill="white" opacity="0.95" />
              <rect x="13" y="10" width="6" height="14" rx="1.5" fill="white" opacity="0.95" />
              <rect x="6" y="24" width="20" height="6" rx="2" fill="white" opacity="0.95" />
            </svg>
          </div>
        </div>

        {/* Tagline gradient brand */}
        <p className="app-boot-tagline">{tagline}</p>
        {subtitle && <p className="app-boot-subtitle">{subtitle}</p>}

        {/* Petite barre de progression indeterminée — réutilise gradient brand */}
        <div className="app-boot-progress" aria-hidden>
          <div className="app-boot-progress-bar" />
        </div>
      </div>
    </div>
  );
}
