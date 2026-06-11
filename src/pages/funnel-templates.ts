// ── Funnel Templates par industrie — Intralys CRM (LOT FUNNEL, Sprint 1) ────
//
// Manager-C — fichier NOUVEAU (§6.H). DATA PURE uniquement : aucun import de
// logique, aucun effet de bord. Chaque gabarit = { id, labelI18nFallback,
// industry, steps[] } où chaque step porte des FunnelBlock[] typés (clés de
// config STRICTEMENT conformes aux interfaces figées §6.C de
// src/worker/funnel-blocks.ts — Hero/Text/Image/Video/Form/Button/Cta/Spacer).
//
// Les `id` de blocs sont générés à la consommation (FunnelBuilder appelle
// crypto.randomUUID au moment d'instancier le gabarit) — ici on laisse id:''
// (placeholder data) pour rester 100% statique/sérialisable.
//
// Industries calquées sur les cibles PME francophones QC/CA (cohérence packs
// industrie : services pro, immobilier, construction/rénovation, santé/
// bien-être, restauration). industry = slug court réutilisable côté
// funnels.industry (TEXT libre, §6.B).

import type { FunnelBlock, FunnelStep } from '@/lib/api';

export interface FunnelTemplateStep {
  name: string;
  step_type: FunnelStep['step_type'];
  blocks: FunnelBlock[];
}

export interface FunnelTemplate {
  id: string;
  /** Libellé affiché (déjà en fr-CA — gabarits = contenu, pas chrome i18n). */
  label: string;
  description: string;
  industry: string;
  steps: FunnelTemplateStep[];
}

// Helper interne (data) : bloc sans id (généré à l'instanciation).
const b = (type: FunnelBlock['type'], config: Record<string, unknown>): FunnelBlock => ({
  id: '',
  type,
  config,
});

const LEAD_FORM_FIELDS = [
  { name: 'name', label: 'Nom complet', type: 'text' as const, required: true },
  { name: 'email', label: 'Courriel', type: 'email' as const, required: true },
  { name: 'phone', label: 'Téléphone', type: 'tel' as const, required: false },
  { name: 'message', label: 'Votre besoin', type: 'textarea' as const, required: false },
];

export const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  // ── 1. Services professionnels (consultants, agences, avocats…) ──────────
  {
    id: 'tmpl-services-pro',
    label: 'Services professionnels — prise de rendez-vous',
    description:
      'Page de capture pour consultants et prestataires de services. Promesse + formulaire de contact + remerciement.',
    industry: 'services',
    steps: [
      {
        name: 'Opt-in',
        step_type: 'optin',
        blocks: [
          b('hero', {
            headline: 'Obtenez une consultation gratuite de 30 minutes',
            subheadline:
              'On analyse votre situation et on vous propose un plan d’action concret, sans engagement.',
            align: 'center',
            backgroundColor: '#0b1220',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('text', {
            html: 'Plus de 200 entreprises québécoises nous font déjà confiance pour faire croître leurs résultats.',
            color: '#374151',
            fontSize: '17px',
            align: 'center',
            maxWidth: '640px',
          }),
          b('form', {
            fields: LEAD_FORM_FIELDS,
            submitLabel: 'Réserver ma consultation',
            successMessage: 'Merci ! On vous contacte sous 24 h ouvrables.',
            redirectUrl: '',
          }),
        ],
      },
      {
        name: 'Remerciement',
        step_type: 'thankyou',
        blocks: [
          b('cta', {
            headline: 'C’est noté, merci !',
            text: 'Un membre de notre équipe vous joindra très bientôt. En attendant, découvrez nos résultats clients.',
            buttonText: 'Voir nos études de cas',
            buttonUrl: '#',
            backgroundColor: '#0b1220',
            textColor: '#ffffff',
            buttonColor: '#635BFF',
            align: 'center',
          }),
        ],
      },
    ],
  },

  // ── 2. Immobilier (courtiers, évaluation maison) ────────────────────────
  {
    id: 'tmpl-immobilier',
    label: 'Immobilier — évaluation gratuite de propriété',
    description:
      'Funnel courtier : estimation gratuite de la valeur d’une propriété, capture du vendeur.',
    industry: 'immobilier',
    steps: [
      {
        name: 'Opt-in',
        step_type: 'optin',
        blocks: [
          b('hero', {
            headline: 'Combien vaut votre propriété aujourd’hui ?',
            subheadline:
              'Recevez une évaluation gratuite et sans engagement, basée sur les ventes récentes de votre quartier.',
            align: 'center',
            backgroundColor: '#102a43',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('form', {
            fields: [
              { name: 'name', label: 'Nom complet', type: 'text', required: true },
              { name: 'email', label: 'Courriel', type: 'email', required: true },
              { name: 'phone', label: 'Téléphone', type: 'tel', required: true },
              { name: 'message', label: 'Adresse de la propriété', type: 'text', required: true },
            ],
            submitLabel: 'Obtenir mon évaluation gratuite',
            successMessage: 'Merci ! Votre évaluation arrive par courriel sous peu.',
            redirectUrl: '',
          }),
          b('text', {
            html: 'Service confidentiel · Aucun engagement · Réponse en moins de 48 h.',
            color: '#6b7280',
            fontSize: '14px',
            align: 'center',
            maxWidth: '560px',
          }),
        ],
      },
      {
        name: 'Remerciement',
        step_type: 'thankyou',
        blocks: [
          b('cta', {
            headline: 'Votre évaluation est en préparation',
            text: 'Pendant ce temps, voyez les propriétés vendues récemment dans votre secteur.',
            buttonText: 'Voir les ventes récentes',
            buttonUrl: '#',
            backgroundColor: '#102a43',
            textColor: '#ffffff',
            buttonColor: '#8B5CF6',
            align: 'center',
          }),
        ],
      },
    ],
  },

  // ── 3. Construction / rénovation (entrepreneurs) ────────────────────────
  {
    id: 'tmpl-construction',
    label: 'Construction & rénovation — soumission rapide',
    description:
      'Funnel entrepreneur : demande de soumission pour un projet de rénovation ou de construction.',
    industry: 'construction',
    steps: [
      {
        name: 'Opt-in',
        step_type: 'optin',
        blocks: [
          b('hero', {
            headline: 'Votre projet de rénovation, soumissionné en 24 h',
            subheadline:
              'Décrivez votre projet, recevez une soumission claire et détaillée — gratuitement.',
            align: 'center',
            backgroundColor: '#1c1917',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('image', {
            src: '',
            alt: 'Réalisations',
            width: '100%',
            align: 'center',
            link: '',
          }),
          b('form', {
            fields: [
              { name: 'name', label: 'Nom', type: 'text', required: true },
              { name: 'phone', label: 'Téléphone', type: 'tel', required: true },
              { name: 'email', label: 'Courriel', type: 'email', required: false },
              {
                name: 'message',
                label: 'Type de projet',
                type: 'select',
                required: true,
                options: ['Cuisine', 'Salle de bain', 'Sous-sol', 'Agrandissement', 'Autre'],
              },
            ],
            submitLabel: 'Demander ma soumission',
            successMessage: 'Merci ! On vous rappelle pour planifier la visite.',
            redirectUrl: '',
          }),
        ],
      },
      {
        name: 'Remerciement',
        step_type: 'thankyou',
        blocks: [
          b('cta', {
            headline: 'Demande reçue !',
            text: 'Notre équipe vous contacte sous 24 h pour confirmer les détails.',
            buttonText: 'Voir nos réalisations',
            buttonUrl: '#',
            backgroundColor: '#1c1917',
            textColor: '#ffffff',
            buttonColor: '#8B5CF6',
            align: 'center',
          }),
        ],
      },
    ],
  },

  // ── 4. Santé / bien-être (cliniques, coachs, esthétique) ────────────────
  {
    id: 'tmpl-sante-bienetre',
    label: 'Santé & bien-être — première séance offerte',
    description:
      'Funnel clinique/coach : réservation d’une première séance d’évaluation offerte.',
    industry: 'sante',
    steps: [
      {
        name: 'Opt-in',
        step_type: 'optin',
        blocks: [
          b('hero', {
            headline: 'Votre première séance d’évaluation, offerte',
            subheadline:
              'Prenez rendez-vous en ligne et faites le premier pas vers votre mieux-être.',
            align: 'center',
            backgroundColor: '#134e4a',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('text', {
            html: 'Approche personnalisée · Praticiens certifiés · Disponibilités en soirée.',
            color: '#374151',
            fontSize: '16px',
            align: 'center',
            maxWidth: '600px',
          }),
          b('form', {
            fields: LEAD_FORM_FIELDS,
            submitLabel: 'Réserver ma séance offerte',
            successMessage: 'Merci ! Nous confirmons votre rendez-vous par téléphone.',
            redirectUrl: '',
          }),
          b('spacer', { height: '24px' }),
        ],
      },
      {
        name: 'Remerciement',
        step_type: 'thankyou',
        blocks: [
          b('cta', {
            headline: 'À très bientôt !',
            text: 'Votre demande est enregistrée. Nous vous contactons pour fixer l’heure.',
            buttonText: 'Découvrir nos services',
            buttonUrl: '#',
            backgroundColor: '#134e4a',
            textColor: '#ffffff',
            buttonColor: '#37CA37',
            align: 'center',
          }),
        ],
      },
    ],
  },

  // ── 5. Restauration / commerce local (offre + capture) ──────────────────
  {
    id: 'tmpl-restauration',
    label: 'Restauration & commerce local — offre exclusive',
    description:
      'Funnel commerce local : capture d’un courriel contre une offre/coupon exclusif.',
    industry: 'restauration',
    steps: [
      {
        name: 'Opt-in',
        step_type: 'optin',
        blocks: [
          b('hero', {
            headline: 'Recevez 15 % de rabais sur votre prochaine visite',
            subheadline:
              'Inscrivez-vous et recevez votre coupon exclusif directement par courriel.',
            align: 'center',
            backgroundColor: '#7c2d12',
            textColor: '#ffffff',
            backgroundImage: '',
          }),
          b('form', {
            fields: [
              { name: 'name', label: 'Prénom', type: 'text', required: true },
              { name: 'email', label: 'Courriel', type: 'email', required: true },
            ],
            submitLabel: 'Recevoir mon coupon',
            successMessage: 'Merci ! Vérifiez votre boîte courriel pour votre coupon.',
            redirectUrl: '',
          }),
          b('text', {
            html: 'Une seule utilisation par client · Non monnayable.',
            color: '#6b7280',
            fontSize: '13px',
            align: 'center',
            maxWidth: '480px',
          }),
        ],
      },
      {
        name: 'Remerciement',
        step_type: 'thankyou',
        blocks: [
          b('cta', {
            headline: 'Votre coupon est en route !',
            text: 'Présentez-le en magasin ou à votre commande. Au plaisir de vous accueillir.',
            buttonText: 'Voir le menu',
            buttonUrl: '#',
            backgroundColor: '#7c2d12',
            textColor: '#ffffff',
            buttonColor: '#FF9A00',
            align: 'center',
          }),
        ],
      },
    ],
  },
];
