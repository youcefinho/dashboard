// ── Module Workflow Templates (serveur) — Intralys CRM ──────────────────────
//
// LOT AUTOMATION BUILDER (Sprint 4, seq 105) — Manager-A pose ce fichier NEUF
// avec un CATALOGUE STATIQUE fonctionnel + un handler de LECTURE. Manager-B le
// possède en EXCLUSIF ensuite (peut compléter / instancier ; signature du
// handler FIGÉE). Imports RELATIFS (./types, ./helpers, ./capabilities) — PAS
// d'alias @/.
//
// ⚠ FICHIER DIFFÉRENT de src/pages/workflow-templates.ts (front, Manager-C).
//   Noms identiques mais CHEMINS distincts (worker/ vs pages/) — aucun conflit.
//
// Chaque template = trigger + steps dont chaque `config` ne porte QUE des clés
// que executeStep (workflows.ts) sait lire (cf. docs/LOT-AUTOMATION-BUILDER.md
// §6.D). Les `parent_step_id` utilisent le sentinel 'trigger_1' pour le 1er
// step (cohérent avec autoEnroll/handleEnrollLead qui lisent
// `parent_step_id IS NULL OR parent_step_id = 'trigger_1'`). Les wait portent
// `delay_minutes`. DATA PURE (aucun effet de bord ici).

import type { Env } from './types';
import { json } from './helpers';
import { requireCapability, type Capability } from './capabilities';

// Type local (le worker n'importe pas src/lib/types — frontière front/back).
export interface WorkflowTemplateDef {
  key: string;
  name: string;
  industry: string;
  description: string;
  trigger_type: string;
  trigger_config?: Record<string, unknown>;
  steps: Array<{
    step_order: number;
    step_type: string;
    config: Record<string, unknown>;
    branch?: 'main' | 'true' | 'false';
    parent_step_id?: string | null;
  }>;
}

// Garde de capability CONDITIONNELLE (calque workflows.ts:capGuard) — enforce
// uniquement en mode-agence (tenant.agencyId + capabilities). Lecture seule ici.
function capGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> },
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;
}

// ── Catalogue serveur (source de vérité de l'instanciation Phase B) ─────────
export const WORKFLOW_TEMPLATES: WorkflowTemplateDef[] = [
  // ── Immobilier : nouveau lead → relance multicanal ────────────────────────
  {
    key: 'immo-new-lead-nurture',
    name: 'Immobilier — Relance nouveau lead',
    industry: 'immobilier',
    description:
      'Accueille un nouveau lead immobilier : courriel de bienvenue immédiat, étiquette, attente 1 jour, puis SMS de relance et notification au courtier.',
    trigger_type: 'lead_created',
    trigger_config: { quiet_hours_start: '21:00', quiet_hours_end: '08:00' },
    steps: [
      { step_order: 1, step_type: 'send_internal_email', parent_step_id: 'trigger_1', branch: 'main',
        config: { to_email: 'courtier@intralys.com', subject: 'Nouveau lead immobilier : {{name}}', body: 'Un nouveau lead vient d’arriver : {{name}} ({{email}}).' } },
      { step_order: 2, step_type: 'add_tag', branch: 'main',
        config: { tag: 'immobilier-nouveau' } },
      { step_order: 3, step_type: 'wait', branch: 'main',
        config: { wait_type: 'delay', delay_minutes: 1440 } },
      { step_order: 4, step_type: 'send_sms', branch: 'main',
        config: { message: 'Bonjour {{name}}, ici votre courtier. Souhaitez-vous planifier une visite cette semaine ?' } },
      { step_order: 5, step_type: 'notify', branch: 'main',
        config: { message: 'Relancer le lead {{name}} par téléphone' } },
    ],
  },

  // ── Immobilier : RDV booké → rappels ──────────────────────────────────────
  {
    key: 'immo-appointment-reminder',
    name: 'Immobilier — Rappels de visite',
    industry: 'immobilier',
    description:
      'Lorsqu’un rendez-vous de visite est réservé, crée une tâche de préparation et envoie un rappel SMS la veille.',
    trigger_type: 'appointment_booked',
    steps: [
      { step_order: 1, step_type: 'create_task', parent_step_id: 'trigger_1', branch: 'main',
        config: { title: 'Préparer la visite de {{name}}', description: 'Dossier + clés', priority: 'high' } },
      { step_order: 2, step_type: 'wait', branch: 'main',
        config: { wait_type: 'delay', delay_minutes: 60 } },
      { step_order: 3, step_type: 'send_sms', branch: 'main',
        config: { message: 'Rappel : votre visite est confirmée. À très bientôt, {{name}} !' } },
    ],
  },

  // ── Dentiste : rappel de soin / réactivation ──────────────────────────────
  {
    key: 'dentist-recall',
    name: 'Dentiste — Rappel de nettoyage',
    industry: 'dentiste',
    description:
      'Réactive un patient inactif : courriel de rappel de nettoyage, attente, puis SMS et changement de statut s’il reste froid.',
    trigger_type: 'inactivity_threshold',
    steps: [
      { step_order: 1, step_type: 'send_internal_email', parent_step_id: 'trigger_1', branch: 'main',
        config: { to_email: 'reception@intralys.com', subject: 'Patient à rappeler : {{name}}', body: 'Le patient {{name}} est dû pour un nettoyage.' } },
      { step_order: 2, step_type: 'wait', branch: 'main',
        config: { wait_type: 'delay', delay_minutes: 4320 } },
      { step_order: 3, step_type: 'send_sms', branch: 'main',
        config: { message: 'Bonjour {{name}}, il est temps de planifier votre nettoyage dentaire. Répondez OUI pour réserver.' } },
      { step_order: 4, step_type: 'add_tag', branch: 'main',
        config: { tag: 'rappel-nettoyage' } },
    ],
  },

  // ── Services pro : qualification conditionnelle ───────────────────────────
  {
    key: 'services-qualify-branch',
    name: 'Services pro — Qualification conditionnelle',
    industry: 'services',
    description:
      'Branche le lead selon son statut : si « qualified », notifie l’équipe ; sinon, courriel de nurturing automatique.',
    trigger_type: 'lead_created',
    steps: [
      { step_order: 1, step_type: 'condition', parent_step_id: 'trigger_1', branch: 'main',
        config: { field: 'status', operator: 'equals', value: 'qualified' } },
      { step_order: 2, step_type: 'notify', branch: 'true',
        config: { message: 'Lead qualifié à contacter rapidement : {{name}}' } },
      { step_order: 3, step_type: 'send_internal_email', branch: 'false',
        config: { to_email: 'ventes@intralys.com', subject: 'Lead à nurturer : {{name}}', body: 'Le lead {{name}} n’est pas encore qualifié.' } },
    ],
  },

  // ── Restauration / commerce : bienvenue + objectif ────────────────────────
  {
    key: 'resto-welcome-goal',
    name: 'Restauration — Bienvenue et objectif',
    industry: 'restauration',
    description:
      'Souhaite la bienvenue à un nouveau contact, attend une journée, étiquette le contact puis marque l’objectif atteint.',
    trigger_type: 'lead_created',
    steps: [
      { step_order: 1, step_type: 'add_tag', parent_step_id: 'trigger_1', branch: 'main',
        config: { tag: 'nouveau-client' } },
      { step_order: 2, step_type: 'wait', branch: 'main',
        config: { wait_type: 'delay', delay_minutes: 1440 } },
      { step_order: 3, step_type: 'change_status', branch: 'main',
        config: { status: 'contacted' } },
      { step_order: 4, step_type: 'goal_reached', branch: 'main',
        config: {} },
    ],
  },
];

// ── GET /api/workflow-templates — LECTURE du catalogue (corps fonctionnel) ──
// Signature FIGÉE Phase A. Capability 'workflows.manage' (réutilisée seq 80).
export async function handleGetWorkflowTemplates(
  _env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  const cg = capGuard(auth as never, 'workflows.manage');
  if (cg) return cg;
  return json({ data: WORKFLOW_TEMPLATES });
}
