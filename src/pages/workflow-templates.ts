// ── Workflow Templates — métadonnées galerie FRONT (LOT AUTOMATION BUILDER) ──
//
// Manager-C — fichier NOUVEAU (§6.H). DATA PURE uniquement : aucun import de
// logique, aucun effet de bord. Miroir d'affichage du catalogue serveur
// WORKFLOW_TEMPLATES (src/worker/workflow-templates.ts, Manager-B). Sert à
// enrichir la galerie front (icône + accent par industrie) quand on liste les
// modèles renvoyés par getWorkflowTemplates(). La source de vérité reste le
// serveur : la galerie itère sur les `WorkflowTemplate[]` retournés par l'API
// et appelle ce helper par `industry` (fallback générique si inconnue).
//
// ⚠ FICHIER DIFFÉRENT de src/worker/workflow-templates.ts (backend, Manager-B).
//   Noms identiques mais CHEMINS distincts (pages/ vs worker/) — aucun conflit.
//
// Industries calquées sur les cibles PME francophones QC/CA (cohérence avec
// funnel-templates.ts : services, immobilier, construction, sante, restauration)
// + dentiste (catalogue workflow serveur). industry = slug court (TEXT libre).

export interface WorkflowTemplateMeta {
  /** Slug industrie tel que renvoyé par WORKFLOW_TEMPLATES.industry. */
  industry: string;
  /** Libellé lisible de l'industrie (fr-CA — contenu, pas chrome i18n). */
  industryLabel: string;
  /** Emoji/icône d'accent de la carte. */
  icon: string;
  /** Couleur d'accent (token CSS existant ou hex de la palette de marque). */
  accent: string;
}

// Accent par industrie — palette alignée sur funnel-templates / index.css
// (primary #635BFF, accent #8B5CF6, success #37CA37, warning #FF9A00).
const WORKFLOW_TEMPLATE_META: Record<string, WorkflowTemplateMeta> = {
  immobilier: { industry: 'immobilier', industryLabel: 'Immobilier', icon: '🏠', accent: '#635BFF' },
  dentiste: { industry: 'dentiste', industryLabel: 'Dentiste', icon: '🦷', accent: '#37CA37' },
  services: { industry: 'services', industryLabel: 'Services professionnels', icon: '💼', accent: '#8B5CF6' },
  restauration: { industry: 'restauration', industryLabel: 'Restauration', icon: '🍽️', accent: '#FF9A00' },
  construction: { industry: 'construction', industryLabel: 'Construction & rénovation', icon: '🔨', accent: '#1c1917' },
  sante: { industry: 'sante', industryLabel: 'Santé & bien-être', icon: '🌿', accent: '#134e4a' },
};

const WORKFLOW_TEMPLATE_META_FALLBACK: WorkflowTemplateMeta = {
  industry: 'autre',
  industryLabel: 'Automation',
  icon: '⚡',
  accent: '#635BFF',
};

/** Métadonnées d'affichage pour une industrie donnée (fallback générique). */
export function getWorkflowTemplateMeta(industry: string | undefined | null): WorkflowTemplateMeta {
  if (!industry) return WORKFLOW_TEMPLATE_META_FALLBACK;
  return WORKFLOW_TEMPLATE_META[industry] ?? { ...WORKFLOW_TEMPLATE_META_FALLBACK, industry, industryLabel: industry };
}
