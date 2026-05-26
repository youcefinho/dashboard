// ── Site Templates multi-pages — Intralys CRM (LOT SITE BUILDER, Sprint 10) ──
//
// Manager-C Phase B (frontend) — fichier NOUVEAU (§6.G/§6.H). DATA PURE
// uniquement : aucun import de logique, aucun effet de bord. CALQUE le pattern
// de funnel-templates.ts (Manager-C, LOT FUNNEL) mais pour des SITES
// multi-pages : chaque template = { id, label, description, industry, pages[],
// nav[] } où chaque page porte ses propres FunnelBlock[] (moteur de blocs
// funnel RÉUTILISÉ — §6.C/§6.B) et `nav` = SiteNavItem[] (lien interne
// page_slug prioritaire).
//
// Les `id` de blocs sont générés à l'instanciation (le builder appelle
// crypto.randomUUID au moment de consommer le gabarit) — ici on laisse id:''
// (placeholder data) pour rester 100% statique/sérialisable, EXACTEMENT comme
// funnel-templates.ts.
//
// Clés de config STRICTEMENT conformes aux interfaces figées §6.C de
// src/worker/funnel-blocks.ts (Hero/Text/Image/Video/Form/Button/Cta/Spacer),
// alignées sur l'usage réel de funnel-templates.ts.

import type { FunnelBlock, SiteNavItem, SitePage } from '@/lib/api';

/** Page d'un gabarit de site — sous-ensemble sérialisable de SitePage. */
export interface SiteTemplatePage {
  slug: string;
  title: string;
  is_home: number;
  in_nav: number;
  blocks: FunnelBlock[];
  seo_title?: string;
  seo_description?: string;
}

export interface SiteTemplate {
  id: string;
  /** Libellé affiché (déjà en fr-CA — gabarits = contenu, pas chrome i18n). */
  label: string;
  description: string;
  industry: string;
  pages: SiteTemplatePage[];
  nav: SiteNavItem[];
}

// Helper interne (data) : bloc sans id (généré à l'instanciation).
const b = (
  type: FunnelBlock['type'],
  config: Record<string, unknown>,
): FunnelBlock => ({ id: '', type, config });

const LEAD_FORM_FIELDS = [
  { name: 'name', label: 'Nom complet', type: 'text' as const, required: true },
  { name: 'email', label: 'Courriel', type: 'email' as const, required: true },
  { name: 'phone', label: 'Téléphone', type: 'tel' as const, required: false },
  {
    name: 'message',
    label: 'Votre besoin',
    type: 'textarea' as const,
    required: false,
  },
];

export const SITE_TEMPLATES: SiteTemplate[] = [
  // ── 1. Site vitrine PME (services pro) — Accueil · Services · Contact ──────
  {
    id: 'tmpl-site-vitrine-pme',
    label: 'Site vitrine PME — services professionnels',
    description:
      'Site vitrine 3 pages pour une PME de services : présentation, offre détaillée et page de contact avec capture de leads.',
    industry: 'services',
    pages: [
      {
        slug: 'accueil',
        title: 'Accueil',
        is_home: 1,
        in_nav: 1,
        seo_title: 'Votre PME de services au Québec',
        seo_description:
          'Des solutions concrètes pour faire croître votre entreprise. Demandez votre consultation gratuite.',
        blocks: [
          b('hero', {
            headline: 'Faites croître votre entreprise avec un partenaire de confiance',
            subheadline:
              'Plus de 200 PME québécoises nous confient leur croissance. Découvrez comment on peut vous aider.',
            align: 'center',
            backgroundColor: '#0b1220',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('text', {
            html: 'Nous accompagnons les PME dans leur stratégie, leurs opérations et leur mise en marché — avec des résultats mesurables.',
            color: '#374151',
            fontSize: '17px',
            align: 'center',
            maxWidth: '680px',
          }),
          b('cta', {
            headline: 'Prêt à passer à l’action ?',
            text: 'Réservez une consultation gratuite de 30 minutes, sans engagement.',
            buttonText: 'Nous contacter',
            buttonUrl: '/site/contact',
            backgroundColor: '#0b1220',
            textColor: '#ffffff',
            buttonColor: '#009DDB',
            align: 'center',
          }),
        ],
      },
      {
        slug: 'services',
        title: 'Services',
        is_home: 0,
        in_nav: 1,
        seo_title: 'Nos services',
        seo_description:
          'Stratégie, opérations et mise en marché : découvrez notre offre de services pour PME.',
        blocks: [
          b('hero', {
            headline: 'Nos services',
            subheadline: 'Une offre claire, pensée pour les PME en croissance.',
            align: 'center',
            backgroundColor: '#102a43',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('text', {
            html: 'Stratégie d’affaires · Optimisation des opérations · Marketing et acquisition · Accompagnement continu.',
            color: '#374151',
            fontSize: '16px',
            align: 'center',
            maxWidth: '680px',
          }),
          b('button', {
            text: 'Demander une soumission',
            url: '/site/contact',
            backgroundColor: '#009DDB',
            color: '#ffffff',
            align: 'center',
          }),
        ],
      },
      {
        slug: 'contact',
        title: 'Contact',
        is_home: 0,
        in_nav: 1,
        seo_title: 'Contactez-nous',
        seo_description:
          'Réservez votre consultation gratuite. On vous répond sous 24 h ouvrables.',
        blocks: [
          b('hero', {
            headline: 'Parlons de votre projet',
            subheadline: 'Remplissez le formulaire, on vous contacte rapidement.',
            align: 'center',
            backgroundColor: '#0b1220',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('form', {
            fields: LEAD_FORM_FIELDS,
            submitLabel: 'Envoyer ma demande',
            successMessage: 'Merci ! On vous contacte sous 24 h ouvrables.',
            redirectUrl: '',
          }),
        ],
      },
    ],
    nav: [
      { label: 'Accueil', page_slug: 'accueil' },
      { label: 'Services', page_slug: 'services' },
      { label: 'Contact', page_slug: 'contact' },
    ],
  },

  // ── 2. Site service local (resto / commerce) — Accueil · Offre · Réserver ─
  {
    id: 'tmpl-site-service-local',
    label: 'Site commerce local — offre et réservation',
    description:
      'Site 3 pages pour un commerce local : vitrine, offre exclusive et page de réservation/capture.',
    industry: 'restauration',
    pages: [
      {
        slug: 'accueil',
        title: 'Accueil',
        is_home: 1,
        in_nav: 1,
        seo_title: 'Bienvenue chez nous',
        seo_description:
          'Découvrez notre commerce local, notre offre exclusive et réservez votre visite.',
        blocks: [
          b('hero', {
            headline: 'Une expérience locale, juste pour vous',
            subheadline:
              'Découvrez ce qui fait notre réputation et profitez de nos offres exclusives.',
            align: 'center',
            backgroundColor: '#7c2d12',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('image', {
            src: '',
            alt: 'Notre établissement',
            width: '100%',
            align: 'center',
            link: '',
          }),
          b('text', {
            html: 'Ouvert 7 jours sur 7 · Produits frais · Accueil chaleureux.',
            color: '#374151',
            fontSize: '16px',
            align: 'center',
            maxWidth: '600px',
          }),
        ],
      },
      {
        slug: 'offre',
        title: 'Notre offre',
        is_home: 0,
        in_nav: 1,
        seo_title: 'Offre exclusive',
        seo_description: 'Profitez de 15 % de rabais sur votre prochaine visite.',
        blocks: [
          b('hero', {
            headline: '15 % de rabais sur votre prochaine visite',
            subheadline: 'Une offre réservée à nos clients inscrits.',
            align: 'center',
            backgroundColor: '#b45309',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('cta', {
            headline: 'Profitez-en dès maintenant',
            text: 'Inscrivez-vous pour recevoir votre coupon par courriel.',
            buttonText: 'Réserver / s’inscrire',
            buttonUrl: '/site/reserver',
            backgroundColor: '#7c2d12',
            textColor: '#ffffff',
            buttonColor: '#FF9A00',
            align: 'center',
          }),
        ],
      },
      {
        slug: 'reserver',
        title: 'Réserver',
        is_home: 0,
        in_nav: 1,
        seo_title: 'Réservez votre visite',
        seo_description: 'Réservez en ligne et recevez votre coupon exclusif.',
        blocks: [
          b('hero', {
            headline: 'Réservez votre visite',
            subheadline: 'Laissez-nous vos coordonnées, on s’occupe du reste.',
            align: 'center',
            backgroundColor: '#7c2d12',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('form', {
            fields: [
              { name: 'name', label: 'Prénom', type: 'text', required: true },
              { name: 'email', label: 'Courriel', type: 'email', required: true },
              { name: 'phone', label: 'Téléphone', type: 'tel', required: false },
            ],
            submitLabel: 'Réserver et recevoir mon coupon',
            successMessage: 'Merci ! Vérifiez votre boîte courriel pour votre coupon.',
            redirectUrl: '',
          }),
        ],
      },
    ],
    nav: [
      { label: 'Accueil', page_slug: 'accueil' },
      { label: 'Notre offre', page_slug: 'offre' },
      { label: 'Réserver', page_slug: 'reserver' },
    ],
  },

  // ── 3. Site portfolio / entrepreneur — Accueil · Réalisations · Contact ───
  {
    id: 'tmpl-site-portfolio',
    label: 'Site portfolio — entrepreneur / construction',
    description:
      'Site 3 pages pour un entrepreneur : présentation, réalisations et demande de soumission.',
    industry: 'construction',
    pages: [
      {
        slug: 'accueil',
        title: 'Accueil',
        is_home: 1,
        in_nav: 1,
        seo_title: 'Votre projet, réalisé avec soin',
        seo_description:
          'Construction et rénovation de qualité. Voyez nos réalisations et demandez votre soumission.',
        blocks: [
          b('hero', {
            headline: 'Votre projet, réalisé avec soin',
            subheadline:
              'Construction et rénovation : un travail soigné, des échéanciers respectés.',
            align: 'center',
            backgroundColor: '#1c1917',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('text', {
            html: 'Plus de 15 ans d’expérience · Soumission gratuite · Garantie sur nos travaux.',
            color: '#374151',
            fontSize: '16px',
            align: 'center',
            maxWidth: '640px',
          }),
          b('button', {
            text: 'Voir nos réalisations',
            url: '/site/realisations',
            backgroundColor: '#D96E27',
            color: '#ffffff',
            align: 'center',
          }),
        ],
      },
      {
        slug: 'realisations',
        title: 'Réalisations',
        is_home: 0,
        in_nav: 1,
        seo_title: 'Nos réalisations',
        seo_description: 'Découvrez quelques-uns de nos projets de construction et rénovation.',
        blocks: [
          b('hero', {
            headline: 'Nos réalisations',
            subheadline: 'Un aperçu de notre savoir-faire.',
            align: 'center',
            backgroundColor: '#292524',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('image', {
            src: '',
            alt: 'Projet réalisé',
            width: '100%',
            align: 'center',
            link: '',
          }),
          b('cta', {
            headline: 'Votre projet est le prochain',
            text: 'Demandez une soumission gratuite et détaillée.',
            buttonText: 'Demander une soumission',
            buttonUrl: '/site/contact',
            backgroundColor: '#1c1917',
            textColor: '#ffffff',
            buttonColor: '#D96E27',
            align: 'center',
          }),
        ],
      },
      {
        slug: 'contact',
        title: 'Contact',
        is_home: 0,
        in_nav: 1,
        seo_title: 'Demander une soumission',
        seo_description: 'Décrivez votre projet, on vous rappelle sous 24 h.',
        blocks: [
          b('hero', {
            headline: 'Demandez votre soumission',
            subheadline: 'Décrivez votre projet, on vous rappelle rapidement.',
            align: 'center',
            backgroundColor: '#1c1917',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('form', {
            fields: [
              { name: 'name', label: 'Nom', type: 'text', required: true },
              { name: 'phone', label: 'Téléphone', type: 'tel', required: true },
              { name: 'email', label: 'Courriel', type: 'email', required: false },
              {
                name: 'message',
                label: 'Type de projet',
                type: 'textarea',
                required: true,
              },
            ],
            submitLabel: 'Demander ma soumission',
            successMessage: 'Merci ! On vous rappelle sous 24 h pour planifier la visite.',
            redirectUrl: '',
          }),
        ],
      },
    ],
    nav: [
      { label: 'Accueil', page_slug: 'accueil' },
      { label: 'Réalisations', page_slug: 'realisations' },
      { label: 'Contact', page_slug: 'contact' },
    ],
  },
];

/** Instancie les pages d'un gabarit (ids de blocs générés) pour createSite. */
export function instantiateTemplatePages(
  tmpl: SiteTemplate,
): Partial<SitePage>[] {
  return tmpl.pages.map((p, i) => ({
    slug: p.slug,
    title: p.title,
    is_home: p.is_home,
    in_nav: p.in_nav,
    position: i,
    seo_title: p.seo_title ?? null,
    seo_description: p.seo_description ?? null,
    blocks: p.blocks.map((bl) => ({ ...bl, id: crypto.randomUUID() })),
  }));
}
