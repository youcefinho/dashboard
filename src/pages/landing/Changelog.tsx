// ── Changelog public — Sprint 50 M2.4 (2026-05-16) ──────────────────────────
// Refonte Stripe SUBTLE : timeline verticale sobre, version badges, catégories
// Ajouté / Modifié / Corrigé / Retiré. Aucun orb / gradient brand / glow.
// (Remplace l'ancienne version dramatique Sprint 23 — paradigme Sprint 38 RESET.)

import { PublicLayout } from './PublicLayout';
import { Tag } from '@/components/ui/Tag';
import { Icon } from '@/components/ui/Icon';
import { Plus, Pencil, Wrench, Minus } from 'lucide-react';

type ChangeCat = 'added' | 'changed' | 'fixed' | 'removed';

interface ReleaseGroup {
  cat: ChangeCat;
  items: string[];
}

interface Release {
  version: string;
  date: string;
  /** Synthèse user-facing (pas technique interne). */
  headline: string;
  groups: ReleaseGroup[];
  current?: boolean;
}

const CAT_META: Record<ChangeCat, { label: string; icon: typeof Plus; variant: 'success' | 'info' | 'warning' | 'neutral' }> = {
  added:   { label: 'Ajouté',  icon: Plus,   variant: 'success' },
  changed: { label: 'Modifié', icon: Pencil, variant: 'info' },
  fixed:   { label: 'Corrigé', icon: Wrench, variant: 'warning' },
  removed: { label: 'Retiré',  icon: Minus,  variant: 'neutral' },
};

// Synthèse user-facing v0.9 → v1.0-beta (Sprint 38 RESET → Sprint 50).
const RELEASES: Release[] = [
  {
    version: 'v1.0-beta',
    date: 'Mai 2026',
    headline: 'Release candidate beta — prête pour les premiers utilisateurs.',
    current: true,
    groups: [
      { cat: 'added', items: [
        'Documentation complète : 30+ guides utilisateur, 10 guides admin, référence API développeurs.',
        'Page Nouveautés (changelog) publique.',
        'Spécification OpenAPI publique et explorateur d’API.',
      ] },
      { cat: 'changed', items: [
        'Centre d’aide enrichi avec recherche et navigation par sections.',
        'Polissage final de l’interface et des parcours d’intégration.',
      ] },
    ],
  },
  {
    version: 'v0.12',
    date: 'Mai 2026',
    headline: 'Pages publiques, multilingue et IA avancée.',
    groups: [
      { cat: 'added', items: [
        'Site public : accueil, tarifs, blog, à propos, contact.',
        'Multilingue : français, anglais, espagnol.',
        'IA avancée : rédaction assistée, prédictions et insights.',
      ] },
      { cat: 'changed', items: [
        'Accessibilité renforcée jusqu’au niveau AAA.',
      ] },
    ],
  },
  {
    version: 'v0.11',
    date: 'Avril 2026',
    headline: 'App mobile native, mode hors-ligne et dashboards personnalisables.',
    groups: [
      { cat: 'added', items: [
        'Applications mobiles natives iOS et Android.',
        'Mode hors-ligne : consulte et travaille sans connexion.',
        'Constructeur de tableaux de bord personnalisés.',
      ] },
      { cat: 'changed', items: [
        'Navigation mobile repensée (gestes, pull-to-refresh).',
      ] },
    ],
  },
  {
    version: 'v0.10',
    date: 'Avril 2026',
    headline: 'Inbox & Calendrier repensés, performance doublée.',
    groups: [
      { cat: 'added', items: [
        'Messagerie unifiée enrichie : réactions, réponses rapides, brouillons IA.',
        'Calendrier avec glisser-déposer et pages de réservation.',
      ] },
      { cat: 'changed', items: [
        'Performance générale de l’application environ deux fois plus rapide.',
        'IA déplacée côté serveur pour des réponses plus fiables.',
      ] },
    ],
  },
  {
    version: 'v0.9',
    date: 'Mars 2026',
    headline: 'Refonte design complète — interface épurée style Stripe.',
    groups: [
      { cat: 'changed', items: [
        'Nouvelle interface sobre et lisible, centrée sur l’essentiel.',
        'Tableau de bord, leads et pipeline redessinés.',
      ] },
      { cat: 'removed', items: [
        'Effets visuels superflus retirés au profit de la clarté.',
      ] },
    ],
  },
];

export function ChangelogPage() {
  return (
    <PublicLayout>
      <a
        href="#changelog-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-white focus:border focus:border-[var(--primary)] focus:rounded-md"
      >
        Aller au contenu
      </a>

      <div className="changelog-wrap max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20">
        <header className="changelog-head">
          <p className="changelog-eyebrow">Produit</p>
          <h1 className="changelog-title">Nouveautés</h1>
          <p className="changelog-sub">
            L’évolution d’Intralys, version par version. De la refonte à la
            release candidate beta.
          </p>
        </header>

        <ol id="changelog-main" className="changelog-timeline" aria-label="Historique des versions">
          {RELEASES.map((rel) => (
            <li key={rel.version} className="changelog-entry">
              <span className="changelog-dot" aria-hidden />
              <div className="changelog-meta">
                <div className="changelog-version-row">
                  <h2 className="changelog-version">{rel.version}</h2>
                  {rel.current && (
                    <Tag size="xs" variant="brand">Actuelle</Tag>
                  )}
                  <span className="changelog-date">{rel.date}</span>
                </div>
                <p className="changelog-headline">{rel.headline}</p>
              </div>

              <div className="changelog-groups">
                {rel.groups.map((g) => {
                  const meta = CAT_META[g.cat];
                  return (
                    <div key={g.cat} className="changelog-group">
                      <div className="changelog-group-head">
                        <Tag size="xs" variant={meta.variant} leftIcon={<Icon as={meta.icon} size={10} />}>
                          {meta.label}
                        </Tag>
                      </div>
                      <ul className="changelog-items">
                        {g.items.map((it, i) => (
                          <li key={i}>{it}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>

        <footer className="changelog-foot">
          <p className="text-sm text-[var(--text-secondary)]">
            Une question sur une nouveauté ?{' '}
            <a href="mailto:support@intralys.app" className="changelog-link">
              support@intralys.app
            </a>
          </p>
        </footer>
      </div>
    </PublicLayout>
  );
}
