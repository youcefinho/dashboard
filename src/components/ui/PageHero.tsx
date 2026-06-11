// ── PageHero — Header de page sobre (LOT A — migration paradigme Stripe) ─────
// Sprint 38 RESET impose : pas d'orbs décoratifs, pas de gradient brand sur
// surfaces (cf index.css:9-13). PageHero avait ÉCHAPPÉ au RESET : il rendait
// 2 orbs radial-gradient + un titre `text-gradient-brand` → incohérence #1
// "vrai produit" sur 21 pages consommatrices.
//
// LOT A migre le RENDU vers sobre Stripe :
//   - titre en `--text-primary` (token), plus de gradient brand ;
//   - orbs décoratifs retirés du DOM (ils étaient déjà neutralisés globalement
//     par `index.css:2377` `.hero-stat-orb { display:none }`, ce JSX était mort).
//
// ⚠️ Signature des props 100% INCHANGÉE — les 21 appelants ne changent rien.
//    `highlight` est conservé dans la signature (back-compat) mais n'applique
//    plus de gradient brand : le titre entier est sobre, uniforme.
//    Les classes CSS legacy `text-gradient-brand` / `hero-stat-orb` ne sont
//    PAS supprimées de index.css (contractuelles, autres consommateurs).
//
// Usage (inchangé) :
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
  /** Titre principal de la page */
  title: string;
  /**
   * @deprecated LOT A — conservé pour back-compat (21 appelants le passent).
   * N'applique plus de gradient brand : le titre est désormais sobre/uniforme
   * conformément au paradigme Stripe RESET (index.css:9-13). No-op visuel.
   */
  highlight?: string;
  description?: string;
  actions?: ReactNode;
  /** Variante "compact" pour pages denses (header plus court) */
  compact?: boolean;
}

export function PageHero({ meta, title, description, actions, compact }: PageHeroProps) {
  return (
    /* LOT A — surface sobre Stripe : carte blanche, border subtle, shadow-xs.
       Plus d'orbs, plus de gradient brand. .page-hero--sober = override append. */
    <div
      className="page-hero--sober relative rounded-2xl mb-6"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        padding: compact ? '1rem 1.25rem' : '1.5rem 1.75rem',
      }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          {meta && (
            <p className="t-meta mb-2.5">{meta}</p>
          )}
          {/* LOT A — titre sobre en token --text-primary (plus de gradient brand) */}
          <h1
            className={
              (compact ? 't-h2' : 't-h1') +
              ' tracking-tight leading-tight text-[var(--text-primary)]'
            }
          >
            {title}
          </h1>
          {description && (
            <p className="t-body text-[var(--text-secondary)] mt-2 max-w-2xl">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}
