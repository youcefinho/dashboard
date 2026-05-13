// ── PageHero — Header de page signature (Sprint 23) ─────────────────────────
// Bandeau hero réutilisable avec orb animé + gradient bg + title premium.
// Remplace les `<h1>Page Title</h1>` plats par un en-tête identitaire Intralys.
//
// Usage :
//   <PageHero
//     meta="Workspace"
//     title="Tâches"
//     description="Gérez vos relances et engagements quotidiens."
//     actions={<Button variant="premium">Nouvelle tâche</Button>}
//   />

import { type ReactNode } from 'react';

interface PageHeroProps {
  /** Étiquette uppercase (ex: "Workspace", "Marketing", "Premier pas") */
  meta?: string;
  /** Titre principal — partie en gradient brand si highlight fourni */
  title: string;
  /** Mot du titre à coloriser en gradient (sinon tout le titre est gradient) */
  highlight?: string;
  description?: string;
  actions?: ReactNode;
  /** Variante "compact" pour pages denses (header plus court) */
  compact?: boolean;
}

export function PageHero({ meta, title, highlight, description, actions, compact }: PageHeroProps) {
  // Rendu du titre avec gradient sur le mot highlight si fourni, sinon tout en gradient
  const titleNode = highlight ? (
    title.split(highlight).map((part, i, arr) => (
      <span key={i}>
        {part}
        {i < arr.length - 1 && <span className="text-gradient-brand">{highlight}</span>}
      </span>
    ))
  ) : (
    <span className="text-gradient-brand">{title}</span>
  );

  return (
    <div className="relative overflow-hidden rounded-2xl mb-4"
      style={{
        background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 40%, #F0FAFE 100%)',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 40px -12px rgba(0,157,219,0.12)',
        padding: compact ? '1rem 1.25rem' : '1.5rem 1.75rem',
      }}>
      {/* Orb décoratif animé top-right */}
      <div
        aria-hidden
        className="hero-stat-orb absolute -top-20 -right-20 w-72 h-72 rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(0,157,219,0.22) 0%, rgba(217,110,39,0.14) 50%, transparent 80%)',
          filter: 'blur(48px)',
        }}
      />
      {/* Orb secondaire bottom-left */}
      <div
        aria-hidden
        className="hero-stat-orb absolute -bottom-16 left-1/4 w-48 h-48 rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(217,110,39,0.18) 0%, transparent 70%)',
          filter: 'blur(40px)',
          animationDelay: '3s',
        }}
      />

      <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          {meta && (
            <p className="heading-premium mb-1.5">{meta}</p>
          )}
          <h1 className={compact ? 'text-xl font-bold tracking-tight leading-tight' : 'text-3xl font-bold tracking-tight leading-tight'}>
            {titleNode}
          </h1>
          {description && (
            <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-2xl leading-relaxed">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}
