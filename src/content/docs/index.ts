// ── Docs content index — Sprint 47 M3.3 / étendu Sprint 50 M2 (2026-05-16) ──
// Source de vérité de la nav hiérarchique des docs.
// Stripe-clean : sections, articles servis depuis /public/docs/$slug.md.
// Sprint 50 M2 : +27 articles user, +10 admin, +4 dev API.

export interface DocArticle {
  slug: string;
  title: string;
  description: string;
  sectionId: string;
  /** Sprint 50 M2 — sections admin gated côté affichage si rôle requis */
  adminOnly?: boolean;
}

export interface DocSection {
  id: string;
  label: string;
  description: string;
  /** Sprint 50 M2 — section admin (badge / gating optionnel) */
  adminOnly?: boolean;
}

export const DOC_SECTIONS: DocSection[] = [
  { id: 'getting-started', label: 'Démarrage rapide',          description: 'Premiers pas dans Intralys' },
  { id: 'leads-pipeline',  label: 'Leads & Pipeline',           description: 'Gérer tes prospects' },
  { id: 'communication',   label: 'Communication',              description: 'Email, SMS, WhatsApp' },
  { id: 'automation',      label: 'Automatisation & Workflows', description: 'Workflows, tâches et règles' },
  { id: 'api',             label: 'API & Développeurs',          description: 'Intégrations, API REST, webhooks' },
  { id: 'admin',           label: 'Administration',              description: 'Org, équipe, sécurité, conformité', adminOnly: true },
];

export const DOC_ARTICLES: DocArticle[] = [
  // ── Démarrage rapide ──────────────────────────────────────────────
  { slug: 'getting-started',   title: 'Démarrage rapide',        description: 'De rien à premier lead converti en 30 minutes.', sectionId: 'getting-started' },
  { slug: 'premiere-connexion',title: 'Première connexion',      description: 'Ce qui se passe à ta toute première connexion.', sectionId: 'getting-started' },
  { slug: 'creer-premier-lead',title: 'Créer ton premier lead',  description: 'Ajouter un prospect manuellement en une minute.', sectionId: 'getting-started' },
  { slug: 'tour-interface',    title: 'Tour de l’interface',     description: 'Navigation, barre latérale et raccourcis.', sectionId: 'getting-started' },
  { slug: 'profil-equipe',     title: 'Profil & équipe',         description: 'Gérer ton compte et inviter des collègues.', sectionId: 'getting-started' },
  { slug: 'branding',          title: 'Branding',                description: 'Ton image de marque sur Intralys et tes documents.', sectionId: 'getting-started' },
  { slug: 'loi-25-conformite', title: 'Conformité Loi 25',       description: 'Respecter la loi québécoise sur les renseignements personnels.', sectionId: 'getting-started' },
  { slug: 'casl-conformite',   title: 'Conformité CASL',         description: 'Respecter la loi canadienne anti-pourriel.', sectionId: 'getting-started' },

  // ── Leads & Pipeline ──────────────────────────────────────────────
  { slug: 'leads-management',       title: 'Gérer tes leads (aperçu)', description: 'Créer, organiser, enrichir, assigner tes leads.', sectionId: 'leads-pipeline' },
  { slug: 'gerer-leads',            title: 'Gérer tes leads',          description: 'Filtrer, trier, assigner et faire avancer tes prospects.', sectionId: 'leads-pipeline' },
  { slug: 'import-leads',           title: 'Importer des leads',       description: 'Charger un CSV/Excel, mapper, éviter les doublons.', sectionId: 'leads-pipeline' },
  { slug: 'scoring-ia',             title: 'Le scoring IA',            description: 'Comment Intralys note tes leads et pourquoi.', sectionId: 'leads-pipeline' },
  { slug: 'tags-segmentation',      title: 'Tags & segmentation',      description: 'Organiser avec tags et listes intelligentes.', sectionId: 'leads-pipeline' },
  { slug: 'lead-detail',            title: 'Le détail d’un lead',      description: 'Tout ce que la fiche d’un lead contient.', sectionId: 'leads-pipeline' },
  { slug: 'pipeline-customization', title: 'Personnaliser ton pipeline (aperçu)', description: 'Étapes, SLA, auto-progression, probabilités.', sectionId: 'leads-pipeline' },
  { slug: 'configurer-pipeline',    title: 'Configurer ton pipeline',  description: 'Étapes, SLA, probabilités et auto-progression.', sectionId: 'leads-pipeline' },
  { slug: 'drag-drop',              title: 'Glisser-déposer (pipeline)', description: 'Faire avancer un deal et redimensionner les cartes.', sectionId: 'leads-pipeline' },
  { slug: 'forecast',               title: 'La prévision (forecast)',  description: 'Projeter ton chiffre d’affaires depuis le pipeline.', sectionId: 'leads-pipeline' },
  { slug: 'tableaux-bord',          title: 'Tableaux de bord',         description: 'Lire tes chiffres clés en un coup d’œil.', sectionId: 'leads-pipeline' },
  { slug: 'dashboard-builder',      title: 'Le dashboard builder',     description: 'Composer ton propre tableau de bord.', sectionId: 'leads-pipeline' },
  { slug: 'export-pdf',             title: 'Export PDF',               description: 'Rapports, factures et fiches en PDF propre.', sectionId: 'leads-pipeline' },

  // ── Communication ─────────────────────────────────────────────────
  { slug: 'messaging-setup',     title: 'Configurer Email/SMS/WhatsApp (aperçu)', description: 'Connecter tes canaux et créer des templates.', sectionId: 'communication' },
  { slug: 'messagerie-unifiee',  title: 'La messagerie unifiée',  description: 'Courriel, SMS et WhatsApp dans une seule Inbox.', sectionId: 'communication' },
  { slug: 'slash-variables',     title: 'Slash-variables',        description: 'Personnaliser tes messages sans copier-coller.', sectionId: 'communication' },
  { slug: 'reponses-rapides',    title: 'Réponses rapides',       description: 'Répondre en un clic aux questions fréquentes.', sectionId: 'communication' },
  { slug: 'ia-redaction',        title: 'IA de rédaction',        description: 'L’IA propose des brouillons de réponse en français.', sectionId: 'communication' },
  { slug: 'reactions',           title: 'Réactions',              description: 'Accuser réception d’un message sans rien rédiger.', sectionId: 'communication' },

  // ── Automatisation & Workflows ────────────────────────────────────
  { slug: 'automations-pipeline', title: 'Automatisations du pipeline', description: 'Déclencher des actions au changement d’étape.', sectionId: 'automation' },
  { slug: 'creer-taches',         title: 'Créer des tâches',         description: 'Ne plus jamais oublier un suivi.', sectionId: 'automation' },
  { slug: 'rappels-echeances',    title: 'Rappels & échéances',      description: 'Recevoir une alerte au bon moment, partout.', sectionId: 'automation' },
  { slug: 'taches-recurrentes',   title: 'Tâches récurrentes',       description: 'Automatiser les suivis qui reviennent toujours.', sectionId: 'automation' },
  { slug: 'calendrier',           title: 'Le calendrier',            description: 'Planifier des rendez-vous et gérer tes dispos.', sectionId: 'automation' },

  // ── API & Développeurs ────────────────────────────────────────────
  { slug: 'api-introduction',     title: 'Introduction à l’API',     description: 'Vue d’ensemble, base URL, premiers appels.', sectionId: 'api' },
  { slug: 'authentication',       title: 'Authentification',         description: 'Clés API, scopes et en-tête Authorization.', sectionId: 'api' },
  { slug: 'rate-limits',          title: 'Limites de débit',         description: 'Quotas, en-têtes et reprises (backoff).', sectionId: 'api' },
  { slug: 'endpoints-reference',  title: 'Référence des endpoints',  description: 'Tous les endpoints avec curl, JS et Python.', sectionId: 'api' },
  { slug: 'integrations',         title: 'Intégrations',             description: 'Connecter Intralys à tes autres outils.', sectionId: 'api' },
  { slug: 'api-webhooks',         title: 'API & Webhooks',           description: 'Recevoir des événements et piloter Intralys.', sectionId: 'api' },

  // ── Administration (adminOnly) ────────────────────────────────────
  { slug: 'admin-setup-organisation',     title: 'Configurer ton organisation', description: 'Les réglages de base d’une organisation.', sectionId: 'admin', adminOnly: true },
  { slug: 'admin-gerer-utilisateurs',     title: 'Gérer les utilisateurs',      description: 'Inviter, désactiver, réassigner les membres.', sectionId: 'admin', adminOnly: true },
  { slug: 'admin-roles-permissions',      title: 'Rôles & permissions',         description: 'Qui peut voir et faire quoi.', sectionId: 'admin', adminOnly: true },
  { slug: 'admin-facturation',            title: 'Facturation & abonnement',    description: 'Plan, paiements et factures de l’organisation.', sectionId: 'admin', adminOnly: true },
  { slug: 'admin-integrations-admin',     title: 'Intégrations (administration)', description: 'Connexions au niveau organisation.', sectionId: 'admin', adminOnly: true },
  { slug: 'admin-cles-api',               title: 'Clés API',                    description: 'Créer, scoper et révoquer les clés API.', sectionId: 'admin', adminOnly: true },
  { slug: 'admin-webhooks-config',        title: 'Configuration des webhooks',  description: 'Webhooks sortants fiables, signature, retries.', sectionId: 'admin', adminOnly: true },
  { slug: 'admin-audit-log',              title: 'Journal d’audit',             description: 'Tracer qui a fait quoi — exigence Loi 25.', sectionId: 'admin', adminOnly: true },
  { slug: 'admin-conformite-loi25-admin', title: 'Conformité Loi 25 (admin)',   description: 'Responsabilités structurelles de l’admin.', sectionId: 'admin', adminOnly: true },
  { slug: 'admin-securite-2fa',           title: 'Sécurité & 2FA',              description: 'Renforcer la sécurité d’accès de l’organisation.', sectionId: 'admin', adminOnly: true },
];

export function getDocBySlug(slug: string): DocArticle | undefined {
  return DOC_ARTICLES.find((d) => d.slug === slug);
}

export function getDocsBySection(sectionId: string): DocArticle[] {
  return DOC_ARTICLES.filter((d) => d.sectionId === sectionId);
}
