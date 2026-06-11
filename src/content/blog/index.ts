// ── Blog content index — Sprint 47 M3.1 (2026-05-15) ─────────────────────
// Source de vérité des articles. Les corps markdown sont servis depuis
// `public/blog/*.md` (loadés lazy via fetch dans BlogArticle).
// Stripe-clean : pas de gradient brand massif, sober.

export interface BlogAuthor {
  id: string;
  name: string;
  role: string;
  initials: string;
}

export type BlogTag =
  | 'conseils-crm'
  | 'etudes-de-cas'
  | 'produit'
  | 'loi-25'
  | 'mobile'
  | 'tech';

export interface BlogPost {
  /** slug = filename sans .md, route /blog/$slug */
  slug: string;
  title: string;
  excerpt: string;
  /** YYYY-MM-DD */
  date: string;
  author: BlogAuthor;
  tag: BlogTag;
  /** temps de lecture estimé minutes */
  readingTime: number;
  /** placeholder gradient color (à terme : url cover image) */
  coverColor: string;
}

export const BLOG_AUTHORS: Record<string, BlogAuthor> = {
  rochdi: {
    id: 'rochdi',
    name: 'Rochdi Dahmani',
    role: 'Fondateur & CEO',
    initials: 'RD',
  },
  team: {
    id: 'team',
    name: 'L’équipe Intralys',
    role: 'Rédaction',
    initials: 'EI',
  },
};

export const BLOG_TAGS: Record<BlogTag, { label: string; color: string }> = {
  'conseils-crm':   { label: 'Conseils CRM',   color: '#635BFF' },
  'etudes-de-cas':  { label: 'Études de cas',  color: '#1AAB59' },
  'produit':        { label: 'Produit',         color: '#635BFF' },
  'loi-25':         { label: 'Loi 25',          color: '#CD3D64' },
  'mobile':         { label: 'Mobile',          color: '#C7912C' },
  'tech':           { label: 'Tech',            color: '#697386' },
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: '2026-05-01-comment-organiser-pipeline-crm',
    title: 'Comment organiser ton pipeline CRM pour vendre plus (sans t’épuiser)',
    excerpt:
      'Un pipeline bien structuré, c’est 80% du job de vente déjà fait. Voici 5 étapes concrètes pour structurer le tien dans Intralys, avec les pièges classiques à éviter.',
    date: '2026-05-01',
    author: BLOG_AUTHORS.rochdi!,
    tag: 'conseils-crm',
    readingTime: 7,
    coverColor: '#635BFF',
  },
  {
    slug: '2026-04-15-loi-25-quebec-pme',
    title: 'Loi 25 au Québec : ce que ta PME doit faire (et ce qu’Intralys gère déjà)',
    excerpt:
      'La Loi 25 est en vigueur depuis 2024. Audit rapide pour t’aider à être conforme sans paperasse infinie : registres, consentements, responsable, droits des personnes.',
    date: '2026-04-15',
    author: BLOG_AUTHORS.rochdi!,
    tag: 'loi-25',
    readingTime: 9,
    coverColor: '#CD3D64',
  },
  {
    slug: '2026-04-01-automation-tasks-pmes',
    title: '5 automatisations à mettre en place dans ton CRM (vrais cas PME)',
    excerpt:
      'Stop les rappels manuels. Voici 5 workflows que nos clients PME ont activés en moins de 15 minutes — résultats mesurés sur 3 mois.',
    date: '2026-04-01',
    author: BLOG_AUTHORS.team!,
    tag: 'produit',
    readingTime: 6,
    coverColor: '#635BFF',
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
