// ── Types partagés Intralys CRM ─────────────────────────────

// Statuts possibles du pipeline
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'closed', 'lost'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

export const LEAD_TYPES = ['inbound', 'qualified', 'customer'] as const;
export type LeadType = typeof LEAD_TYPES[number];

export const USER_ROLES = ['admin', 'broker'] as const;
export type UserRole = typeof USER_ROLES[number];

// Sources de leads
export const LEAD_SOURCES = ['website', 'facebook', 'google', 'referral', 'phone', 'walkin', 'ghl_import', 'other'] as const;
export type LeadSource = typeof LEAD_SOURCES[number];

// Lifecycle stages
export const LIFECYCLE_STAGES = ['lead', 'mql', 'sql', 'opportunity', 'customer', 'lost'] as const;
export type LifecycleStage = typeof LIFECYCLE_STAGES[number];

// Types d'activité
export const ACTIVITY_TYPES = [
  'created', 'status_change', 'note_added', 'tag_added', 'tag_removed',
  'email_sent', 'sms_sent', 'assigned', 'deal_value_changed',
] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];

// ── Entités ─────────────────────────────────────────────────

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  site_url: string;
  city: string;
  banner: string;
  is_active: number;
  // Sprint E1 M2.1 — feature-flag modules par tenant (JSON, défaut '["crm"]')
  modules_json?: string;
  created_at: string;
  updated_at: string;
  // Jointures optionnelles
  lead_count?: number;
  new_lead_count?: number;
}

export interface Lead {
  id: string;
  client_id: string;
  external_id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  type: LeadType;
  status: LeadStatus;
  budget: string;
  timeline: string;
  address: string;
  property_type: string;
  source: string;
  notes: string;
  deal_value: number;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  // Sprint 51 M3 — attribution étendue (colonnes ajoutées par M1/M2, lecture seule UI)
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  referrer?: string;
  consent_status?: string;
  lead_source_id?: string;
  assigned_to: string;
  score: number;
  created_at: string;
  updated_at: string;
  // Sprint 2 — champs enrichis
  dnd: number;
  dnd_settings: string; // JSON
  date_of_birth: string;
  country: string;
  timezone: string;
  // Sprint MULTILANG-B — langue préférée du contact (additif optionnel).
  // 'fr-CA'|'fr-FR'|'en'|'es' ; null/absent = défaut tenant fr-CA.
  preferred_language?: string | null;
  additional_emails: string; // JSON array
  additional_phones: string; // JSON array
  city: string;
  postal_code: string;
  company: string;
  lifecycle_stage: LifecycleStage;
  favorite: number;
  last_activity_at: string;
  social_linkedin: string;
  social_facebook: string;
  social_instagram: string;
  avatar_url: string;
  migrated_from: string;
  pipeline_id: string;
  stage_id: string;
  // Jointures optionnelles
  client_name?: string;
  tags?: string[];
}

export interface LeadTag {
  id: number;
  lead_id: string;
  tag: string;
  created_at: string;
}

// ── Multi-Pipelines ──────────────────────────

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
  probability: number;
  wip_limit: number | null;
  sla_days: number | null;
  created_at: string;
  updated_at: string;
  lead_count?: number;
}

export interface LostReason {
  id: string;
  client_id: string;
  label: string;
  sort_order: number;
  created_at: string;
}

export interface Pipeline {
  id: string;
  client_id: string | null;
  name: string;
  description: string;
  position: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  stages?: PipelineStage[];
}

export interface ActivityLogEntry {
  id: number;
  lead_id: string;
  client_id: string;
  user_id: string;
  action: ActivityType;
  details: string;
  created_at: string;
  // Jointures optionnelles
  user_name?: string;
  lead_name?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  client_id: string | null;
  is_active: number;
  created_at: string;
}

// ── Phase 2 : Conversations & Email ────────────────────────

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type MessageDirection = typeof MESSAGE_DIRECTIONS[number];

export const MESSAGE_CHANNELS = ['email', 'sms', 'webchat', 'facebook_messenger', 'instagram_dm', 'internal_note'] as const;
export type MessageChannel = typeof MESSAGE_CHANNELS[number];

// 'sending' = état optimistic client-only (Sprint 19) — n'existe jamais en DB
export const MESSAGE_STATUSES = ['draft', 'sending', 'sent', 'delivered', 'failed', 'read', 'bounced'] as const;
export type MessageStatus = typeof MESSAGE_STATUSES[number];

export const CONVERSATION_STATUSES = ['open', 'closed', 'snoozed'] as const;
export type ConversationStatus = typeof CONVERSATION_STATUSES[number];

export const TEMPLATE_CATEGORIES = ['welcome', 'followup', 'reminder', 'notification', 'marketing', 'general'] as const;
export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number];

export interface Conversation {
  id: string;
  lead_id: string;
  client_id: string;
  channel: MessageChannel;
  status: ConversationStatus;
  assigned_to: string | null;
  subject: string;
  last_message_at: string;
  last_message_preview: string;
  unread_count: number;
  is_starred: number;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
  // Jointures optionnelles
  lead_name?: string;
  lead_email?: string;
  lead_phone?: string;
  lead_avatar?: string;
  assigned_name?: string;
}

export interface Message {
  id: string;
  lead_id: string;
  client_id: string;
  conversation_id: string;
  direction: MessageDirection;
  channel: MessageChannel;
  subject: string;
  body: string;
  status: MessageStatus;
  sent_by: string;
  external_id: string;
  metadata: string;
  created_at: string;
  // Sprint 3 GIGA — statut de livraison SMS (delivery receipts Twilio ; NULL = legacy)
  delivery_status?: string | null;
  // Jointures optionnelles
  lead_name?: string;
  sender_name?: string;
}

export interface EmailTemplate {
  id: string;
  client_id: string | null;
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  variables: string;       // JSON array
  category: TemplateCategory;
  channel: MessageChannel; // email, sms
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Snippet {
  id: string;
  client_id: string | null;
  user_id: string;
  name: string;
  shortcut: string;
  body: string;
  created_at: string;
}

// ── Phase 3 : Automations & Workflows ──────────────────────

export const TRIGGER_TYPES = [
  'lead_created', 'status_changed', 'pipeline_stage_changed', 'tag_added', 'form_submitted', 
  'score_threshold', 'lead_score_changed', 'deal_won', 'task_overdue',
  'email_opened', 'link_clicked', 'appointment_booked', 'appointment_cancelled', 'appointment_no_show',
  'opportunity_status_changed', 'note_added', 'task_completed', 'inactivity_threshold', 'birthday_today', 'manual',
  // ── Sprint E9 — triggers e-commerce (ADDITIF, triggers CRM ci-dessus
  // INTACTS). Reconnus par le moteur workflows M1 (worker/workflows.ts).
  'order_created', 'order_paid', 'cart_abandoned', 'post_purchase', 'win_back', 'refund_issued',
] as const;
export type TriggerType = typeof TRIGGER_TYPES[number];

export const STEP_TYPES = [
  'send_email', 'send_internal_email', 'send_sms', 'wait', 'condition', 'add_tag', 'remove_tag', 
  'change_status', 'assign', 'notify', 'webhook', 'update_pipeline', 'update_stage',
  'create_task', 'create_appointment', 'create_opportunity', 'update_opportunity',
  'update_custom_field', 'trigger_another_workflow', 'end_other_workflow', 'ai_action',
  'math_operation', 'goal_reached', 'add_to_smart_list',
  // ── LOT REPUTATION (Sprint 8) — ADDITIF. Action workflow de déclenchement AUTO
  //    d'une demande d'avis 1st-party : crée une review_invitation + token et
  //    envoie l'email (pattern reviews.ts/Resend + CASL isLeadDnd). Le `case
  //    'request_review'` dans executeStep (src/worker/workflows.ts) est ajouté par
  //    Manager-B (case ADDITIF, default inchangé). Valeurs existantes INTOUCHÉES.
  'request_review'
] as const;
export type StepType = typeof STEP_TYPES[number];

export const ENROLLMENT_STATUSES = ['active', 'paused', 'completed', 'cancelled'] as const;
export type EnrollmentStatus = typeof ENROLLMENT_STATUSES[number];

export interface Workflow {
  id: string;
  client_id: string | null;
  name: string;
  description: string;
  trigger_type: TriggerType;
  trigger_config: string;       // JSON
  is_active: number;
  created_at: string;
  updated_at: string;
  // Jointures optionnelles
  steps_count?: number;
  active_enrollments?: number;
  total_executions?: number;
  // ── Sprint 4 (LOT AUTOMATION BUILDER seq 105) — ADDITIF FIGÉ Phase A ─────
  // Clé du modèle WORKFLOW_TEMPLATES ayant instancié ce workflow (NULL =
  // créé manuellement / legacy). Miroir de workflows.template_key (seq 105).
  template_key?: string | null;
}

export interface WorkflowStep {
  id: string;
  workflow_id: string;
  step_order: number;
  step_type: StepType;
  config: string;               // JSON
  created_at: string;
}

export interface WorkflowEnrollment {
  id: string;
  workflow_id: string;
  lead_id: string;
  current_step_id: string | null;
  status: EnrollmentStatus;
  next_action_at: string | null;
  enrolled_at: string;
  completed_at: string | null;
  // Jointures optionnelles
  lead_name?: string;
  workflow_name?: string;
}

export interface WorkflowExecutionLog {
  id: number;
  enrollment_id: string;
  step_id: string;
  status: 'executed' | 'skipped' | 'failed';
  result: string;
  executed_at: string;
}

// ── Sprint 4 (LOT AUTOMATION BUILDER seq 105) — interfaces ADDITIVES FIGÉES
// Phase A (Manager-A). Phase B/C les CONSOMMENT verbatim, n'en créent AUCUNE.
// Voir docs/LOT-AUTOMATION-BUILDER.md §6.

// Modèle d'automation pré-configuré (catalogue serveur WORKFLOW_TEMPLATES,
// src/worker/workflow-templates.ts + miroir front src/pages/workflow-templates.ts).
// Calque l'esprit de FunnelTemplate (funnel-templates.ts) : DATA PURE.
// Chaque step porte step_type + un objet config dont les clés sont EXACTEMENT
// celles que executeStep (workflows.ts) sait lire (cf. §6.D du contrat).
export interface WorkflowTemplateStep {
  step_order: number;
  step_type: StepType;
  /** Config du step — clés conformes à executeStep (§6.D). */
  config: Record<string, unknown>;
  /** Branche de rattachement (sentinel 'trigger_1' pour le 1er step). */
  branch?: 'main' | 'true' | 'false';
  /** id du step parent dans le gabarit (placeholder, ré-indexé à l'instanciation). */
  parent_step_id?: string | null;
}

export interface WorkflowTemplate {
  /** Clé stable persistée dans workflows.template_key (ex 'immo-new-lead'). */
  key: string;
  /** Alias de `key` (compat consommateurs front attendant `id`). */
  id?: string;
  name: string;
  /** Slug industrie (immobilier, dentiste, …) — TEXT libre. */
  industry: string;
  description: string;
  trigger_type: TriggerType;
  /** Config du trigger (JSON sérialisable, ex quiet_hours_*). */
  trigger_config?: Record<string, unknown>;
  steps: WorkflowTemplateStep[];
}

// Entrée de LECTURE du journal d'exécution (workflow_execution_log). ALIGNÉE
// sur les colonnes RÉELLES (phase3 : id/enrollment_id/step_id/status/result/
// executed_at) + lead_id ADDITIF (seq 105). Les handlers de lecture (Phase B)
// peuvent enrichir par jointure (workflow_id via enrollment, step_type, lead_name).
export interface ExecLogEntry {
  id: number;
  enrollment_id: string;
  /** Renseigné par jointure workflow_enrollments (la table log n'a pas la colonne). */
  workflow_id?: string;
  /** Colonne ADDITIVE seq 105 (NULL = log legacy / entité non-lead). */
  lead_id?: string | null;
  step_id?: string;
  /** Enrichissement de lecture optionnel (jointure workflow_steps). */
  step_type?: StepType | string;
  status: 'executed' | 'skipped' | 'failed';
  /** Colonne timestamp RÉELLE = executed_at (PAS created_at). */
  executed_at: string;
  /** Colonne RÉELLE = `result` (JSON détails). Exposée ici sous l'alias detail. */
  detail?: string;
}

// Résultat d'une SIMULATION read-only (parcours des steps SANS effet de bord,
// chemin SÉPARÉ qui NE réutilise PAS executeStep — Phase B). `path` = suite des
// steps traversés ; `reached_goal` = un step goal_reached a été atteint.
export interface WorkflowSimulationResult {
  path: Array<{
    step_id: string;
    step_type: StepType | string;
    branch?: 'main' | 'true' | 'false';
    outcome: string;
  }>;
  reached_goal?: boolean;
}

// ── Sprint 2 : Sequence Analytics (LECTURE PURE, additif) ────
// Stats d'engagement agrégées au niveau séquence (messages.campaign_id =
// sequenceId AND campaign_kind = 'sequence' + message_events open/click).
// open_rate / click_rate sont des RATIOS 0..1 (front formatte en %). Voir
// docs/LOT-SEQUENCE-ANALYTICS.md §6.A.
export interface SequenceStats {
  sent: number;
  opened: number;
  clicked: number;
  open_rate: number;   // ratio 0..1 (opened / sent), 0 si sent = 0
  click_rate: number;  // ratio 0..1 (clicked / sent), 0 si sent = 0
}

// ── Phase 7 : Tâches ────────────────────────────────────────

export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export interface Task {
  id: string;
  title: string;
  description: string;
  due_date: string;
  priority: TaskPriority;
  status: TaskStatus;
  lead_id: string | null;
  lead_name?: string;
  client_id: string | null;
  assigned_to: string;
  recurring_rule: string | null;
  parent_task_id: string | null;
  reminder_minutes_before: number | null;
  created_at: string;
  updated_at: string;
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  is_done: number;
  sort_order: number;
  created_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface TaskTemplate {
  id: string;
  client_id: string | null;
  user_id: string | null;
  name: string;
  description: string;
  default_priority: TaskPriority;
  default_due_offset_days: number;
  subtasks_json: string;
  created_at: string;
}

// ── Phase 7 : Champs personnalisés ─────────────────────────

export const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'boolean'] as const;
export type CustomFieldType = typeof CUSTOM_FIELD_TYPES[number];

export interface CustomFieldDef {
  id: string;
  client_id: string;
  name: string;
  slug: string;
  field_type: CustomFieldType;
  options: string[];
  is_required: boolean;
  sort_order: number;
}

export interface CustomFieldValue {
  field_id: string;
  field_name: string;
  field_type: CustomFieldType;
  value: string;
}

// ── Phase 7 : Smart Lists ──────────────────────────────────

export interface SmartList {
  id: string;
  user_id: string;
  client_id: string;
  name: string;
  filters: Record<string, unknown>;
  count?: number;
  created_at: string;
  updated_at?: string;
}

// ── Phase 4 : Calendrier & RDV ─────────────────────────────

export const APPOINTMENT_TYPES = ['meeting', 'call', 'visit', 'signing', 'other'] as const;
export type AppointmentType = typeof APPOINTMENT_TYPES[number];

export const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'cancelled', 'completed', 'no_show'] as const;
export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number];

export interface Appointment {
  id: string;
  lead_id: string | null;
  client_id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  location: string;
  type: AppointmentType;
  status: AppointmentStatus;
  calendly_event_id: string | null;
  notes: string;
  calendar_id: string | null;
  assignee_user_id: string | null;
  attendees_json: string;
  conference_link: string | null;
  recurring_rule: string | null;
  reminder_minutes: number;
  buffer_before_min: number;
  buffer_after_min: number;
  created_at: string;
  updated_at: string;
  // Jointures optionnelles
  lead_name?: string;
  client_name?: string;
}

// ── API Responses ───────────────────────────────────────────


export interface DashboardStats {
  total_leads: number;
  new_leads_7d: number;
  pending_leads: number;
  conversion_rate: number;
  total_deal_value: number;
  revenue_value: number;
  avg_conversion_days: number;
  leads_by_client: Array<{ client_name: string; count: number }>;
  leads_by_status: Array<{ status: LeadStatus; count: number }>;
  leads_by_day: Array<{ date: string; count: number }>;
  leads_by_source: Array<{ source: string; count: number; value: number }>;
  conversion_by_status: Array<{ status: string; count: number; pct: number }>;
  activity_feed: ActivityLogEntry[];
}

export interface LeadDetail extends Lead {
  tags: string[];
  activity: ActivityLogEntry[];
}

// Sprint 2 — Notes multiples
export interface LeadNote {
  id: string;
  lead_id: string;
  user_id: string;
  body: string;
  category: 'general' | 'call' | 'meeting' | 'follow-up' | 'important';
  is_pinned: number;
  created_at: string;
  author_name?: string;
}

// Sprint 2 — Score profiles
export interface ScoreProfile {
  id: string;
  name: string;
  description: string;
  formula: string;
  is_default: number;
}

export interface LeadScore {
  profile_id: string;
  name: string;
  description: string;
  score: number;
  computed_at: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success?: boolean;
}

// ── LOT G8 — AI Workspace conversationnel (assistant global cmd+/) ───────────
// Threads + messages persistés (tables ai_chat_threads / ai_chat_messages seq
// 91, PRÉFIXE ai_chat_* — distinct de ai_conversations/ai_messages seq 7).
// v1 READ-ONLY / DRAFT-ONLY : l'assistant lit/calcule/rédige des brouillons,
// aucune mutation auto. Corps des handlers worker = Phase B Manager-B.
export interface AiChatThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** JSON sérialisé des tool-calls READ-ONLY exécutés worker-side (trace). */
  tool_calls?: string;
  created_at: string;
  /**
   * SPRINT 11 (Copilot v2, ADDITIF) — actions sûres PROPOSÉES par le LLM au tour
   * courant. Optionnel : absent ⇒ message sans action (rétro-compat v1). Le LLM
   * ne fait QU'EN PROPOSER ; l'exécution exige une confirmation humaine UI puis
   * un POST worker dédié (confirmAiAction). JAMAIS d'exécution dans la boucle LLM.
   */
  proposed_actions?: AiProposedAction[];
}

// ── SPRINT 11 — Copilot v2 : actions sûres + contexte de page (100% ADDITIF) ──
// Tout est optionnel/additif : aucune signature existante n'est cassée. La
// SÉCURITÉ est worker-side : le `client_id` n'est JAMAIS porté ici (résolu via
// scopeClientId(auth) côté worker), et toute action est RE-VALIDÉE worker-side
// avant exécution via un handler MÉTIER EXISTANT (jamais nouveau chemin mutant).

/**
 * Action sûre/réversible PROPOSÉE par l'assistant (jamais exécutée
 * automatiquement). Limitée à 3 opérations whitelistées. `args` ne contient
 * JAMAIS de champ tenant (client_id résolu worker-side via l'auth).
 * `label` = phrase de confirmation FR affichée sur la carte d'action.
 */
export interface AiProposedAction {
  id: string;
  tool: 'create_task' | 'update_lead_status' | 'add_lead_tag';
  args: Record<string, unknown>;
  label: string;
}

/**
 * Contexte de la page courante envoyé par le front à l'envoi d'un message
 * (best-effort, optionnel). RE-VALIDÉ + RE-BORNÉ tenant worker-side avant toute
 * utilisation : aucune confiance accordée à ces valeurs telles quelles.
 */
export interface AiPageContext {
  route?: string;
  entity_type?: string;
  entity_id?: string;
}

export interface PipelineData {
  [key: string]: Lead[];
}

// ── Labels i18n pour l'interface ────────────────────────────
// Chaque getter construit un Record dynamique via t() — permet le changement de langue à la volée.
// L'API publique (nom, type) est inchangée : les consommateurs existants n'ont aucune modification à faire.

import { t } from '@/lib/i18n';


export const STATUS_LABELS: Record<LeadStatus, string> = new Proxy({} as Record<LeadStatus, string>, {
  get: (_, key: string) => t(`labels.status.${key}` as any) || key,
});

export const STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'var(--primary)',
  contacted: 'var(--info)',
  qualified: 'var(--warning)',
  won: 'var(--success)',
  closed: 'var(--text-muted)',
  lost: 'var(--danger)',
};

export const TYPE_LABELS: Record<LeadType, string> = new Proxy({} as Record<LeadType, string>, {
  get: (_, key: string) => t(`labels.type.${key}` as any) || key,
});

export const SOURCE_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, key: string) => {
    if (typeof key !== 'string') return undefined;
    return t(`labels.source.${key}` as any) || key;
  },
});

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = new Proxy({} as Record<LifecycleStage, string>, {
  get: (_, key: string) => t(`labels.lifecycle.${key}` as any) || key,
});

export const LIFECYCLE_COLORS: Record<LifecycleStage, string> = {
  lead: 'var(--info)',
  mql: 'var(--primary)',
  sql: 'var(--warning)',
  opportunity: 'oklch(0.7 0.18 60)',
  customer: 'var(--success)',
  lost: 'var(--danger)',
};

export const NOTE_CATEGORY_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, key: string) => {
    if (typeof key !== 'string') return undefined;
    return t(`labels.note.${key}` as any) || key;
  },
});

export const NOTE_CATEGORY_ICONS: Record<string, string> = {
  general: '📝',
  call: '📞',
  meeting: '🤝',
  'follow-up': '🔄',
  important: '⚠️',
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = new Proxy({} as Record<ActivityType, string>, {
  get: (_, key: string) => t(`labels.activity.${key}` as any) || key,
});

export const ACTIVITY_ICONS: Record<ActivityType, string> = {
  created: '🆕',
  status_change: '🔄',
  note_added: '📝',
  tag_added: '🏷️',
  tag_removed: '🏷️',
  email_sent: '📧',
  sms_sent: '💬',
  assigned: '👤',
  deal_value_changed: '💰',
};

// ── Labels Phase 2 : Conversations ─────────────────────────

export const CHANNEL_LABELS: Record<MessageChannel, string> = new Proxy({} as Record<MessageChannel, string>, {
  get: (_, key: string) => t(`labels.channel.${key}` as any) || key,
});

export const CHANNEL_ICONS: Record<MessageChannel, string> = {
  email: '📧',
  sms: '💬',
  webchat: '🌐',
  facebook_messenger: '📘',
  instagram_dm: '📷',
  internal_note: '📝',
};

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = new Proxy({} as Record<ConversationStatus, string>, {
  get: (_, key: string) => t(`labels.conv_status.${key}` as any) || key,
});

export const CONVERSATION_STATUS_COLORS: Record<ConversationStatus, string> = {
  open: 'var(--success)',
  closed: 'var(--text-muted)',
  snoozed: 'var(--warning)',
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = new Proxy({} as Record<MessageStatus, string>, {
  get: (_, key: string) => t(`labels.msg_status.${key}` as any) || key,
});

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = new Proxy({} as Record<TemplateCategory, string>, {
  get: (_, key: string) => t(`labels.tpl_cat.${key}` as any) || key,
});

// ── Labels Phase 3 : Workflows ─────────────────────────────

export const TRIGGER_LABELS: Record<TriggerType, string> = new Proxy({} as Record<TriggerType, string>, {
  get: (_, key: string) => t(`labels.trigger.${key}` as any) || key,
});

export const TRIGGER_ICONS: Record<TriggerType, string> = {
  lead_created: '🆕',
  status_changed: '🔄',
  pipeline_stage_changed: '🔀',
  tag_added: '🏷️',
  form_submitted: '📋',
  score_threshold: '📊',
  lead_score_changed: '📈',
  deal_won: '🎉',
  task_overdue: '⏰',
  email_opened: '👁️',
  link_clicked: '🖱️',
  appointment_booked: '📅',
  appointment_cancelled: '❌',
  appointment_no_show: '👻',
  opportunity_status_changed: '💰',
  note_added: '📝',
  task_completed: '✅',
  inactivity_threshold: '😴',
  birthday_today: '🎂',
  manual: '⚡',
  // ── Sprint E9 — icônes e-commerce (additif) ──
  order_created: '🛒',
  order_paid: '💳',
  cart_abandoned: '🛍️',
  post_purchase: '📦',
  win_back: '🔁',
  refund_issued: '↩️',
};

export const STEP_TYPE_LABELS: Record<StepType, string> = new Proxy({} as Record<StepType, string>, {
  get: (_, key: string) => t(`labels.step.${key}` as any) || key,
});

export const STEP_TYPE_ICONS: Record<StepType, string> = {
  send_email: '📧',
  send_internal_email: '📨',
  send_sms: '💬',
  wait: '⏳',
  condition: '🔀',
  add_tag: '🏷️',
  remove_tag: '🏷️',
  change_status: '🔄',
  assign: '👤',
  notify: '🔔',
  webhook: '🌐',
  update_pipeline: '🔀',
  update_stage: '⏭️',
  create_task: '📝',
  create_appointment: '📅',
  create_opportunity: '💰',
  update_opportunity: '📈',
  update_custom_field: '✏️',
  trigger_another_workflow: '➡️',
  end_other_workflow: '⏹️',
  ai_action: '🤖',
  math_operation: '➕',
  goal_reached: '🎯',
  add_to_smart_list: '📋',
  request_review: '⭐',
};

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = new Proxy({} as Record<EnrollmentStatus, string>, {
  get: (_, key: string) => t(`labels.enrollment.${key}` as any) || key,
});

// ── Labels Phase 4 : Calendrier ────────────────────────────

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = new Proxy({} as Record<AppointmentType, string>, {
  get: (_, key: string) => t(`labels.appt_type.${key}` as any) || key,
});

export const APPOINTMENT_TYPE_ICONS: Record<AppointmentType, string> = {
  meeting: '🤝',
  call: '📞',
  visit: '🏠',
  signing: '✍️',
  other: '📌',
};

export const APPOINTMENT_TYPE_COLORS: Record<AppointmentType, string> = {
  meeting: 'var(--primary)',
  call: 'var(--info)',
  visit: 'var(--success)',
  signing: 'var(--warning)',
  other: 'var(--text-muted)',
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = new Proxy({} as Record<AppointmentStatus, string>, {
  get: (_, key: string) => t(`labels.appt_status.${key}` as any) || key,
});

// ── Labels Phase 7 : Tâches ────────────────────────────────

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = new Proxy({} as Record<TaskPriority, string>, {
  get: (_, key: string) => t(`labels.task_priority.${key}` as any) || key,
});

export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: 'var(--danger)',
  medium: 'var(--warning)',
  low: 'var(--info)',
};

export const TASK_PRIORITY_ICONS: Record<TaskPriority, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🔵',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = new Proxy({} as Record<TaskStatus, string>, {
  get: (_, key: string) => t(`labels.task_status.${key}` as any) || key,
});

export const TASK_STATUS_ICONS: Record<TaskStatus, string> = {
  todo: '⬜',
  in_progress: '🔄',
  done: '✅',
};

// ════════════════════════════════════════════════════════════
// Sprint E1 M1 — Module e-commerce (B2 : Intralys = la boutique)
// Univers parallèle au CRM. customers.lead_id = lien faible réconciliation.
// Money en cents (INTEGER) partout. snake_case aligné colonnes D1.
// ════════════════════════════════════════════════════════════

// ── Unions de statuts ───────────────────────────────────────

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = typeof PRODUCT_STATUSES[number];

export const ORDER_STATUSES = [
  'pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded',
] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export const FINANCIAL_STATUSES = [
  'unpaid', 'paid', 'partially_refunded', 'refunded',
] as const;
export type FinancialStatus = typeof FINANCIAL_STATUSES[number];

export const FULFILLMENT_STATUSES = [
  'unfulfilled', 'partial', 'fulfilled',
] as const;
export type FulfillmentStatus = typeof FULFILLMENT_STATUSES[number];

export const CART_STATUSES = ['active', 'abandoned', 'converted'] as const;
export type CartStatus = typeof CART_STATUSES[number];

export const INVENTORY_MOVEMENT_REASONS = [
  'sale', 'restock', 'adjustment', 'return', 'reservation',
] as const;
export type InventoryMovementReason = typeof INVENTORY_MOVEMENT_REASONS[number];

// RFM segments (réconciliation analytics, ex 'champions', 'at_risk'...)
export const RFM_SEGMENTS = [
  'champions', 'loyal', 'potential_loyalist', 'new', 'promising',
  'needs_attention', 'at_risk', 'hibernating', 'lost',
] as const;
export type RfmSegment = typeof RFM_SEGMENTS[number];

// ── Entités e-commerce ──────────────────────────────────────

export interface Product {
  id: string;
  client_id: string;
  title: string;
  slug: string;
  description: string;
  status: ProductStatus;
  product_type: string;
  vendor: string;
  base_price: number;       // cents
  currency: string;
  tax_class: string;
  seo_title: string;
  seo_description: string;
  created_at: string;
  updated_at: string;
  // Jointures optionnelles
  variants?: ProductVariant[];
  images?: ProductImage[];
  categories?: ProductCategory[];
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string | null;
  title: string;
  price_override: number | null;   // cents
  options_json: string;            // JSON ex {"color":"Rouge","size":"L"}
  barcode: string | null;
  weight_grams: number | null;
  position: number;
  created_at: string;
  updated_at: string;
  // Jointures optionnelles
  inventory?: InventoryRecord;
}

export interface ProductCategory {
  id: string;
  client_id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Jointures optionnelles
  children?: ProductCategory[];
  product_count?: number;
}

export interface ProductImage {
  id: string;
  product_id: string;
  variant_id: string | null;
  url: string;
  alt: string;
  position: number;
  created_at: string;
}

export interface InventoryRecord {
  id: string;
  variant_id: string;
  quantity: number;
  reserved: number;
  low_stock_threshold: number;
  track_inventory: number;
  allow_backorder: number;
  location: string | null;
  updated_at: string;
  location_stocks?: Array<{
    location_id: string;
    warehouse_name: string;
    quantity: number;
    reserved: number;
  }>;
}

export interface InventoryMovement {
  id: string;
  variant_id: string;
  delta: number;
  reason: InventoryMovementReason;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  client_id: string;
  lead_id: string | null;       // lien faible réconciliation CRM
  email: string;
  phone: string | null;
  first_name: string;
  last_name: string;
  accepts_marketing: number;
  total_spent_cents: number;
  orders_count: number;
  avg_order_value_cents: number;
  first_order_at: string | null;
  last_order_at: string | null;
  rfm_segment: RfmSegment | null;
  tags_json: string | null;          // JSON array
  default_address_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  client_id: string;
  customer_id: string | null;        // null = guest checkout
  order_number: string | null;
  status: OrderStatus;
  financial_status: FinancialStatus;
  fulfillment_status: FulfillmentStatus;
  subtotal_cents: number;
  tps_cents: number;
  tvq_cents: number;
  shipping_cents: number;
  discount_cents: number;
  total_cents: number;
  currency: string;
  email: string;
  shipping_address_json: string | null;
  billing_address_json: string | null;
  note: string;
  source: string;                    // web/shopify/woo/manual
  external_id: string | null;
  placed_at: string | null;
  // Sprint E3 M1 — timestamps de cycle de vie (machine à états lifecycle).
  paid_at?: string | null;
  shipped_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
  // Jointures optionnelles
  items?: OrderItem[];
  customer?: Customer;
  // Sprint E3 M1 — enrichissements list/get.
  items_count?: number;
  customer_email?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  variant_id: string | null;
  product_title_snapshot: string;
  variant_title_snapshot: string;
  sku_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
  tax_cents: number;
  created_at: string;
}

export interface Cart {
  id: string;
  client_id: string;
  customer_id: string | null;
  token: string;
  status: CartStatus;
  abandoned_at: string | null;
  recovered_at: string | null;
  currency: string;
  created_at: string;
  updated_at: string;
  // Jointures optionnelles
  items?: CartItem[];
}

export interface CartItem {
  id: string;
  cart_id: string;
  variant_id: string;
  quantity: number;
  added_at: string;
}

// ── Sprint E-R M2 — Internationalisation : config région boutique ────────────
// Additif pur : aucun type existant modifié. snake_case cohérent avec le reste
// des entités e-commerce. Aligné moteur fiscal M1 (ecommerce-tax-engine.ts).

/** Régime fiscal du tenant — STRICTEMENT aligné sur le moteur M1. */
export type TaxRegime = 'qc' | 'eu' | 'dz' | 'exempt';

/** Devises supportées (extensible). 'CAD' = défaut rétro-compat Québec. */
export type SupportedCurrency = 'CAD' | 'EUR' | 'DZD';

/** Code pays ISO 3166-1 alpha-2 utilisé par les formats + le moteur fiscal. */
export type CountryCode = 'CA' | 'FR' | 'DZ' | (string & {});

/** Drapeaux légaux régionaux — FLAGS uniquement (impl. légale = Sprint E6). */
export interface LegalFlags {
  loi25?: boolean;   // Québec — Loi 25 (protection renseignements personnels)
  rgpd?: boolean;    // UE — RGPD
  casl?: boolean;    // Canada — anti-pourriel
  conso_dz?: boolean; // Algérie — protection du consommateur
}

/** Config région résolue du tenant courant (contrat endpoint /region). */
export interface RegionConfig {
  region: string;                 // ex 'QC' / 'EU' / 'DZ'
  country: CountryCode;           // ex 'CA' / 'FR' / 'DZ'
  currency: SupportedCurrency;    // devise par défaut boutique
  tax_regime: TaxRegime;          // régime fiscal (aligné moteur M1)
  legal_flags: LegalFlags;        // flags légaux régionaux (parsés)
}

/** Contexte région consommable par le backend commande (resolveRegionContext). */
export interface RegionContext {
  region: string;
  country: CountryCode;
  currency: SupportedCurrency;
  tax_regime: TaxRegime;
  /** true = prix TTC (UE) / false = HT (QC/DZ) — cohérent moteur M1. */
  tax_inclusive_default: boolean;
}

// ── Sprint E4 — Paiement multi-provider/région ──────────────────────────────
// Additif PUR : aucun type existant modifié. Contrat FIGÉ (M2/M3 codent
// contre). PCI : aucun type ne porte de donnée carte (PAN/CVV/expiry) — que
// des références opaques côté provider.

/**
 * Statut d'un paiement marchand — CONTRAT FIGÉ.
 * `pending_cod` = paiement à la livraison non capturé (≠ payé : la commande
 * reste 'unpaid' tant que non encaissé). `paid` = seul état déclenchant le
 * pont lifecycle (commitSale via recordPaymentTransition).
 */
export type PaymentStatus =
  | 'pending'
  | 'pending_cod'
  | 'authorized'
  | 'paid'
  | 'failed';

/** Méthode de paiement (libellé logique, indépendant du provider). */
export type PaymentMethod =
  | 'card'
  | 'cod'
  | 'bank_transfer'
  | 'dz_local';

/** Identifiant de provider de paiement — CONTRAT FIGÉ. */
export type PaymentProviderId = 'stripe' | 'cod' | 'dz_gateway';

/** Ligne `payments` (référence opaque provider — JAMAIS de donnée carte). */
export interface PaymentRecord {
  id: string;
  client_id: string;
  order_id: string;
  provider: PaymentProviderId;
  method: PaymentMethod | string;
  amount_cents: number;
  currency: SupportedCurrency;
  status: PaymentStatus;
  provider_ref: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

/** Résultat d'init de paiement renvoyé par l'endpoint (contrat figé). */
export interface PaymentInitResult {
  payment_id: string;
  status: PaymentStatus;
  redirect_url?: string;
}

/** Résultat normalisé d'un webhook provider (pont lifecycle). */
export interface PaymentWebhookResult {
  order_id: string;
  payment_ref: string;
  status: PaymentStatus;
}

/** Capabilities d'un provider filtrées par contexte région (devises/méthodes). */
export interface PaymentCapabilities {
  methods: PaymentMethod[];
  currencies: SupportedCurrency[];
}

// ── Sprint E5 ───────────────────────────────────────────────────────────────
// Fulfillment region-aware. Additif PUR : aucun type existant modifié
// (FulfillmentStatus E1 INTOUCHÉ — l'expédition ne le remplace pas, elle le
// recalcule de façon déterministe côté handler). Bloc UNIQUE writer E5 :
// inclut les types M1 (shipments) ET M2 (zones/tarifs) pour que M2/M3 les
// importent sans toucher ce fichier (zéro race).

/**
 * Statut d'une expédition — machine PROPRE au shipment, DISTINCTE de la
 * machine commande E3 (preparing→shipped→delivered). Une expédition est une
 * TRACE PURE : elle ne touche jamais le stock ni le statut de la commande.
 */
export type ShipmentStatus =
  | 'preparing'
  | 'shipped'
  | 'in_transit'
  | 'delivered'
  | 'failed';

/** Ligne `shipments` — trace d'un envoi (total ou partiel) d'une commande. */
export interface Shipment {
  id: string;
  client_id: string;
  order_id: string;
  status: ShipmentStatus;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  /** Lignes expédiées (jointes par handleGetShipment / handleListShipments). */
  items?: ShipmentItem[];
}

/** Ligne `shipment_items` — quelle ligne de commande, quelle quantité. */
export interface ShipmentItem {
  id: string;
  shipment_id: string;
  order_item_id: string;
  quantity: number;
  created_at?: string;
}

/**
 * Zone d'expédition (M2) — regroupement géographique (pays/régions) auquel
 * s'appliquent des tarifs. Multi-tenant. `countries` = liste de codes ISO
 * alpha-2 couverts par la zone.
 */
export interface ShippingZone {
  id: string;
  client_id: string;
  name: string;
  countries: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Tarif d'expédition (M2) — rattaché à une zone. `min_subtotal_cents` /
 * `max_subtotal_cents` : palier optionnel de déclenchement (panier). Money
 * TOUJOURS en cents INTEGER.
 */
export interface ShippingRate {
  id: string;
  client_id: string;
  zone_id: string;
  name: string;
  price_cents: number;
  min_subtotal_cents: number | null;
  max_subtotal_cents: number | null;
  created_at: string;
  updated_at: string;
}

/** Résultat de résolution d'un tarif (M2) — POST /shipping/resolve. */
export interface ShippingRateResult {
  zone_id: string | null;
  rate_id: string | null;
  name: string | null;
  price_cents: number;
  /** false si aucune zone/tarif ne couvre la destination (repli marchand). */
  matched: boolean;
}

// ── Sprint E6 ───────────────────────────────────────────────────────────────
// Remboursements / litiges / RMA + politique conso indicative. M3 est le SEUL
// writer E6 de ce fichier : bloc UNIQUE, additif PUR (aucun type existant
// modifié — RefundRecord/DisputeRecord côté api.ts restent les vues client
// déjà publiées par M1). snake_case cohérent e-commerce. Money en cents.
// ⚠️ ZONE RÉGULÉE — la politique conso (ConsumerPolicy) est INDICATIVE :
// revue légale requise avant activation commerciale (la bannière UI le dit).

/** Statut d'un remboursement (vue marchand) — machine M1 (E4 délégué). */
export type RefundStatus = 'pending' | 'succeeded' | 'failed';

/** Statut d'un litige / chargeback — enregistrement DB seul (régulé, libre). */
export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'won'
  | 'lost'
  | 'refunded'
  | (string & {});

/** Statut d'une demande de retour (RMA) — machine PROPRE au RMA (M2). */
export type RmaStatus =
  | 'pending'
  | 'approved'
  | 'received'
  | 'refunded'
  | 'rejected';

/** Remboursement marchand (réfs opaques — ZÉRO donnée carte, PCI). */
export interface Refund {
  id: string;
  order_id: string;
  payment_id: string;
  amount_cents: number;
  currency: string;
  status: RefundStatus | string;
  provider_ref: string | null;
  reason: string | null;
  restocked: boolean;
  created_at: string;
}

/** Litige / chargeback provider (réf opaque uniquement, jamais de carte). */
export interface Dispute {
  id: string;
  order_id: string;
  payment_id: string | null;
  provider: string;
  provider_dispute_ref: string;
  status: DisputeStatus;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

/** Ligne d'une demande de retour (article + quantité + intention restock). */
export interface RmaItem {
  id: string;
  return_request_id: string;
  order_item_id: string;
  quantity: number;
  restock: boolean;
  created_at?: string;
}

/** Demande de retour (RMA) — cycle dédié, distinct commande E3 / shipment E5. */
export interface ReturnRequest {
  id: string;
  client_id: string;
  order_id: string;
  status: RmaStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
  /** Lignes du retour (jointes par handleListReturns M2). */
  items?: RmaItem[];
}

/**
 * Politique de rétractation INDICATIVE renvoyée par handleGetOrderPolicy.
 * ⚠️ RÉGULÉ : informatif uniquement — revue légale requise avant activation.
 * `withdrawal_window_days` = fenêtre indicative depuis la livraison (E5).
 */
export interface ConsumerPolicy {
  withdrawal_window_days: number;
  mentions: string[];
  region: string;
}

// ════════════════════════════════════════════════════════════
// ── Sprint E7 ── Customer 360 + RFM + LTV multi-devise + panier abandonné
// ════════════════════════════════════════════════════════════
//
// LTV PAR DEVISE BOUTIQUE (resolveRegionContext().currency). PAS de conversion
// FX (aucun taux en base — sommer CAD+EUR+DZD est INTERDIT). total_spent_cents
// = somme NET (orders − refunds succeeded), devise boutique uniquement, clampé
// ≥ 0. Les autres devises sont ventilées séparément dans spend_by_currency.
// RfmSegment réutilise l'union E1 (RFM_SEGMENTS) — pas de redéfinition.

/** Métriques agrégées d'un client (recalcul FULL idempotent, net-of-refunds). */
export interface CustomerMetrics {
  /** LTV nette en cents, DEVISE BOUTIQUE uniquement (jamais convertie). */
  total_spent_cents: number;
  orders_count: number;
  avg_order_value_cents: number;
  first_order_at: string | null;
  last_order_at: string | null;
  /** Devise boutique de référence (resolveRegionContext). */
  currency: SupportedCurrency;
}

/** Ventilation des dépenses par devise (aucune somme cross-devise). */
export interface SpendByCurrency {
  currency: string;
  /** Net (commandes − remboursements succeeded) en cents pour CETTE devise. */
  net_spent_cents: number;
  orders_count: number;
}

/** Payload agrégé GET /api/ecommerce/customers/:id/360. */
export interface Customer360 {
  customer: Customer;
  metrics: CustomerMetrics;
  /** Ventilation multi-devise (devise boutique incluse, jamais sommée). */
  spend_by_currency: SpendByCurrency[];
  orders: Order[];
  refunds: Array<Record<string, unknown>>;
  shipments: Array<Record<string, unknown>>;
  returns: Array<Record<string, unknown>>;
  /** Panier actif (non converti / non abandonné) ou null. */
  active_cart: Record<string, unknown> | null;
  /** Lead CRM réconcilié (lien faible customers.lead_id) ou null. */
  linked_lead: { id: string; name: string; email: string } | null;
}

/**
 * Panier abandonné (M2 : detectAbandonedCarts + handleListAbandonedCarts +
 * handleRecoverCart). Type partagé exposé ici (M1 = seul writer types E7).
 */
export interface AbandonedCart {
  id: string;
  client_id: string;
  customer_id: string | null;
  email: string | null;
  status: CartStatus;
  items_count: number;
  subtotal_cents: number;
  currency: string;
  updated_at: string;
  /** Posé par le flux de récupération M2 (relance envoyée). */
  recovery_sent_at?: string | null;
}

// ════════════════════════════════════════════════════════════
// ── Sprint E9 ── Analytics e-commerce + recommandations / churn
// ════════════════════════════════════════════════════════════
//
// DERNIER sprint roadmap e-comm. Section ADDITIVE (append-only) : zéro
// type E1-E8 modifié. Contrats FIGÉS M2 (ecommerce-analytics.ts /
// ecommerce-reco.ts). RÈGLE D'OR multi-devise héritée E7 : on NE SOMME
// JAMAIS deux devises (aucun taux FX en base). Le revenu est TOUJOURS
// ventilé par devise. Montants en cents (formatMoneyCents côté UI).

/** Revenu net ventilé pour UNE devise (jamais sommé cross-devise). */
export interface RevenueByCurrency {
  currency: string;
  /** Brut encaissé en cents pour CETTE devise. */
  gross: number;
  /** Remboursements succeeded en cents pour CETTE devise. */
  refunds: number;
  /** Net = gross − refunds en cents, clampé ≥ 0. */
  net: number;
  orders: number;
  /** Panier moyen net en cents pour CETTE devise. */
  aov: number;
}

/** Payload GET /api/ecommerce/analytics/revenue. */
export interface EcommerceRevenue {
  by_currency: RevenueByCurrency[];
}

/** Une cohorte mensuelle d'acquisition + courbe de rétention. */
export interface RevenueCohort {
  /** Mois d'acquisition (YYYY-MM). */
  month: string;
  /** Taille de la cohorte (clients acquis ce mois). */
  size: number;
  /** Rétention par mois relatif (index 0 = mois d'acquisition), en %. */
  retention: number[];
}

/** Payload GET /api/ecommerce/analytics/cohorts. */
export interface EcommerceCohorts {
  cohorts: RevenueCohort[];
}

/** Payload GET /api/ecommerce/analytics/ltv (ventilé devise, jamais sommé). */
export interface EcommerceLtv {
  by_currency: Array<{ currency: string; ltv_cents: number; customers: number }>;
  /** Taux de rachat global (0..1) — clients avec ≥ 2 commandes. */
  repurchase_rate: number;
}

/** Une ligne du classement produits (par devise, jamais sommée). */
export interface TopProductRow {
  variant_id: string;
  title: string;
  qty: number;
  revenue_cents: number;
  currency: string;
}

/** Payload GET /api/ecommerce/analytics/top-products. */
export interface EcommerceTopProducts {
  products: TopProductRow[];
}

/** Une ligne ventes par canal (mois × canal × devise — calque worker
 *  ecommerce-analytics.ts:469 SalesByChannelRow, local là-bas). */
export interface SalesByChannelRow {
  period: string;
  channel: string;
  currency: string;
  orders: number;
  gross_cents: number;
}

/** Payload GET /api/ecommerce/analytics/sales-by-channel (MICRO-FIX
 *  Sprint 4 — handler ecommerce-analytics.ts:484 déjà écrit, renvoie
 *  { data: { window_days, by_channel } }). */
export interface EcommerceSalesByChannel {
  window_days: number;
  by_channel: SalesByChannelRow[];
}

/** Une recommandation produit (cross-sell / up-sell, contrat M2). */
export interface ProductReco {
  variant_id: string;
  title: string;
  /** Type de reco : croisée (souvent achetés ensemble) ou montée en gamme. */
  kind: 'cross_sell' | 'up_sell';
  /** Score de confiance 0..1 (heuristique M2). */
  score: number;
  price_cents?: number;
  currency?: string;
}

/** Payload GET /api/ecommerce/reco/products/:id. */
export interface ProductRecoResult {
  recommendations: ProductReco[];
}

/** Prédiction de désabonnement client (contrat M2). */
export interface CustomerChurnPrediction {
  /** Score de risque 0..1 (1 = risque maximal de churn). */
  score: number;
  /** Bucket lisible dérivé du score. */
  risk: 'low' | 'medium' | 'high';
  /** Raisons explicables (RGPD : décision compréhensible). */
  reasons: string[];
  /** True si M2 a renvoyé une heuristique de repli (données insuffisantes). */
  fallback: boolean;
}

// ── SPRINT 13 — Scoring prédictif calibré tenant (conversion-scoring) ────────
/**
 * Baseline de conversion agrégée sur l'historique won/lost RÉEL d'un tenant, par
 * dimension (table conversion_baselines seq 113). DÉTERMINISTE, calculée par le
 * cron Phase B. dimension ∈ 'source' | 'status' | 'score_bucket' | 'overall'
 * (validée HANDLER, jamais CHECK SQL).
 */
export interface ConversionBaseline {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  dimension: string;
  dimension_value: string;
  won_count: number;
  lost_count: number;
  /** won / (won + lost), 0..1. */
  conversion_rate: number;
  /** won_count + lost_count — sert au fallback coefficients fixes si < 10. */
  sample_size: number;
  computed_at?: string;
}

/**
 * Prédiction de conversion CALIBRÉE d'un lead (cache conversion_predictions seq
 * 113, DISTINCT du cache lead_predictions seq 54). Repart de la base déterministe
 * lead-predict EN LECTURE, ajustée par le taux observé du tenant.
 */
export interface ConversionPrediction {
  /** Probabilité de conversion calibrée, 0..100. */
  probability: number;
  /** 1 si la base tenant a servi à calibrer, 0 si fallback coefficients fixes. */
  calibrated: number;
  /** Facteurs explicables (ex « Source », « Taux historique source 32% »). */
  factors: ConversionFactor[];
  /** Confiance dérivée de la taille d'échantillon / richesse des signaux. */
  confidence?: 'low' | 'medium' | 'high';
}

/** Facteur explicable d'une prédiction de conversion calibrée. */
export interface ConversionFactor {
  label: string;
  impact: number;
}

// ── LOT FORECASTING — projection + objectifs + scénarios (Sprint 14, seq 114) ─
// Le forecast pondéré NAÏF existe déjà (pipelines.ts handleGetPipelineForecast,
// réponse { data, total_pipeline_value, weighted_total } — INTOUCHÉE). Ce lot
// AJOUTE un moteur enrichi (DÉTERMINISTE, ZÉRO LLM) servi par /api/forecast*.

/**
 * Objectif / quota de revenu d'un tenant pour une période (table forecast_targets
 * seq 114). pipeline_id null = tous pipelines ; assigned_to null = objectif
 * d'équipe (sinon quota d'un commercial = users.id). target_amount en unité
 * monétaire (même unité que leads.deal_value — PAS en cents).
 */
export interface ForecastTarget {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  /** null = tous pipelines du tenant. */
  pipeline_id?: string | null;
  /** null = objectif d'équipe, sinon quota d'un commercial (users.id). */
  assigned_to?: string | null;
  /** Période ciblée, format 'YYYY-MM'. */
  period_month: string;
  /** Montant cible (unité monétaire, REAL — PAS en cents). */
  target_amount: number;
  created_at?: string;
}

/**
 * Point de forecast pour une période (mois 'YYYY-MM'). weighted = revenu pondéré
 * projeté (DÉTERMINISTE). target/actual optionnels (objectif vs réalisé).
 */
export interface ForecastPoint {
  period_month: string;
  /** Revenu pondéré projeté pour la période. */
  weighted: number;
  /** Objectif de la période (forecast_targets), si défini. */
  target?: number;
  /** Réalisé observé (leads won/closed × deal_value et/ou orders), si dispo. */
  actual?: number;
}

/**
 * Scénarios déterministes bornés (facteurs sur la probabilité). best ≥ likely ≥
 * worst — montants pondérés totaux projetés.
 */
export interface ForecastScenario {
  best: number;
  likely: number;
  worst: number;
}

/** Agrégat de forecast par dimension (commercial = assigned_to, source = utm_source). */
export interface ForecastGroup {
  /** Clé de la dimension (user_id / nom commercial OU valeur de source). */
  key: string;
  /** Revenu pondéré projeté pour ce groupe. */
  weighted: number;
}

/**
 * Réponse du moteur de forecast enrichi (GET /api/forecast). points[] = série
 * temporelle pondérée (+ target/actual). scenarios = best/likely/worst. by_rep /
 * by_source = group-by optionnels. trend = projection de tendance (moyenne
 * mobile + régression linéaire simple, déterministe).
 */
export interface ForecastResponse {
  points: ForecastPoint[];
  scenarios: ForecastScenario;
  /** Group-by commercial (group_by='rep'). */
  by_rep?: ForecastGroup[];
  /** Group-by source (group_by='source'). */
  by_source?: ForecastGroup[];
  /** Projection de tendance par période (déterministe). */
  trend?: ForecastPoint[];
}

// ── SPRINT 15 — Reports builder : templates de dashboard clonables ───────────
// Le Reports builder (DashboardBuilder.tsx + dashboards.ts + table dashboards
// seq 51) existe DÉJÀ. Ce lot AJOUTE un catalogue de modèles clonables
// (table report_templates seq 115). Le clone produit un nouveau `dashboards`
// (POST /report-templates/:id/apply → handleCreateDashboard côté worker).

/**
 * Modèle de dashboard clonable (table report_templates seq 115). is_system=1 +
 * client_id/agency_id null = template SYSTÈME global (catalogue, lecture pour
 * tous). config = JSON au format DashboardBuilderValue ({ cols, widgets[] }),
 * cloné tel quel dans dashboards.config par le handler après validation
 * whitelist. category = regroupement validé HANDLER (jamais CHECK SQL).
 */
export interface ReportTemplate {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  /** JSON au format DashboardBuilderValue : { cols: number; widgets: WidgetConfig[] }. */
  config: unknown;
  /** 1 = template système (catalogue global non éditable par le tenant). */
  is_system: number;
}

// ── LOT G9 — White-label custom domain ──────────────────────────────────────
/** Hostname personnalisé mappé sur un tenant (table custom_hostnames seq 94). */
export interface CustomHostname {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  hostname: string;
  /** Statut de provisioning : 'pending' tant que le flag CF for SaaS est OFF. */
  status: string;
  /** Statut DKIM : 'pending' tant que le flag from/DKIM par tenant est OFF. */
  dkim_status: string;
  /** Référence externe Cloudflare for SaaS (null tant que non provisionné). */
  provider_ref: string | null;
  created_at: string;
  updated_at: string;
}

// ── LOT G4 — OAuth natives ───────────────────────────────────────────────────
/**
 * Connexion OAuth native d'un tenant (table oauth_connections seq 95).
 * Projection SANS tokens (jamais exposés au front) : seuls les métadonnées
 * d'affichage transitent. v1 = 'google' (Calendar) + 'slack'.
 */
export interface OauthConnection {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  /** 'google' | 'slack' (v1). */
  provider: string;
  /** 'active' par défaut. */
  status: string;
  /** Scopes accordés (chaîne brute du provider), null si non renseigné. */
  scopes: string | null;
  /** Email du compte connecté (affichage UI), null si non récupéré. */
  account_email: string | null;
  /** Expiration de l'access token (ISO), null si non applicable. */
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── LOT SMS/WHATSAPP seq 104 — miroirs front (FIGÉS Phase A) ────────────────
// Miroir des interfaces worker (src/worker/types.ts). Phase C les CONSOMME tels
// quels (Campaigns / SmsTemplates / Integrations). access_token JAMAIS exposé
// par le backend (secret) — absent du miroir front WhatsAppConnection.

/** Modèle de SMS réutilisable (table sms_templates seq 104). */
export interface SmsTemplate {
  id: string;
  client_id?: string | null;
  name: string;
  body: string;
  created_at?: string | null;
}

/** Connexion WhatsApp Business par tenant (table whatsapp_connections seq 104).
 *  status 'inactive' tant que non configuré (carte « non configuré » côté UI). */
export interface WhatsAppConnection {
  id: string;
  client_id?: string | null;
  phone_number_id?: string | null;
  status: string;
  created_at?: string | null;
}

// ── LOT FORMS XL (Sprint 5) — type d'un champ de formulaire ────
// Miroir EXACT de la structure JSON sérialisée dans `forms.fields` par
// FormBuilder.tsx (l'écrivain canonique) et relue par PublicForm.tsx. Tous les
// nouveaux attributs (conditional, step) sont OPTIONNELS ⇒ rétro-compat byte :
// un formulaire existant sans ces clés rend EXACTEMENT comme avant. NE RIEN
// rendre obligatoire ici. Manager-C produit/lit ces clés, Manager-B évalue
// `conditional` côté serveur. Voir docs/LOT-FORMS-XL.md §6.B.
export type FormFieldType =
  | 'text' | 'email' | 'phone' | 'number' | 'date' | 'select'
  | 'multiselect' | 'checkbox' | 'radio' | 'textarea' | 'file' | 'hidden';

export type FormFieldConditionOperator =
  | 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'is_not_empty';

export interface FormFieldCondition {
  // Nom (clé `name`) du champ pilote dont dépend la visibilité de CE champ.
  field_name: string;
  operator: FormFieldConditionOperator;
  // Valeur comparée. OPTIONNELLE : ignorée pour is_empty / is_not_empty.
  value?: string;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  name: string;
  label: string;
  // Présents/écrits par FormBuilder.tsx (placeholder + required NON nullables
  // côté builder, mais tolérés optionnels en lecture pour les rows legacy).
  placeholder?: string;
  required?: boolean;
  validation?: string;
  // string[] côté builder (1 option par ligne) ; PublicForm tolère aussi
  // [{label,value}] pour le rendu — la source de vérité reste string[].
  options?: string[];
  custom_field_id?: string;
  weight?: number;
  // ── Sprint 5 « Forms XL » — ADDITIF OPTIONNEL (rétro-compat) ──
  // show-if : le champ n'est rendu QUE si la condition est satisfaite. Absent =
  // toujours visible (legacy). Manager-B: ne valider `required` que pour les
  // champs VISIBLES selon ces conditions.
  conditional?: FormFieldCondition;
  // Multi-étapes : numéro d'étape (1-indexé). Absent ou 0 = étape 1 (legacy).
  step?: number;
}

// Agrégat drop-off par champ retourné par GET /api/forms/:id/field-analytics
// (corps Phase B). DATA pure. `reached` = sessions ayant atteint le champ ;
// `completed` = sessions l'ayant rempli ; `dropoff_rate` = % d'abandon.
export interface FormFieldAnalyticsRow {
  field_name: string;
  reached: number;
  completed: number;
  dropoff_rate: number;
}

// ════════════════════════════════════════════════════════════════════════════
// LOT STOREFRONT CHECKOUT (Sprint 7) — types tunnel acheteur PUBLIC (FIGÉS par
// Manager-A Phase A). Miroir PUBLIC des entités e-commerce E1-E9 : on N'EXPOSE
// QUE le strict nécessaire à la vitrine/checkout (zéro donnée tenant interne).
// Money TOUJOURS en cents (INTEGER). Calque les types ecom existants (Product /
// Order / Cart / CartItem ci-dessus). Phase B (worker storefront-public.ts) +
// Phase C (pages PublicStore/PublicCheckout) les CONSOMMENT tels quels.
// Contrat figé docs/LOT-STOREFRONT-CHECKOUT.md §6.B.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Projection PUBLIQUE d'un produit (vitrine + fiche). Miroir minimal de
 * `Product` : AUCUN champ tenant interne (client_id, coûts, SEO admin…). Le prix
 * `price_cents` est le prix effectif (variante par défaut : price_override ??
 * base_price). `in_stock` = agrégat best-effort (au moins une variante dispo).
 */
export interface StorefrontProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  price_cents: number;
  currency?: string;
  image: string | null;
  in_stock: boolean;
  // Variantes exposées publiquement (fiche produit — ajout au panier par
  // variant_id, calque createOrderCore qui prend des variant_id). OPTIONNEL :
  // la vitrine (liste) peut s'en passer ; la fiche les renseigne.
  variants?: Array<{
    variant_id: string;
    title: string | null;
    price_cents: number;
    in_stock: boolean;
  }>;
}

/**
 * Panier PUBLIC anonyme (token). Miroir de la forme renvoyée par shapeCart
 * (ecommerce-cart.ts) MAIS résolu sans auth (clientId via slug). Le `token` est
 * persisté côté front (localStorage) — JAMAIS de cookie/session admin.
 */
export interface PublicCart {
  token: string;
  items: Array<{
    id?: string;            // id de cart_item (PATCH/DELETE ciblent cet id)
    product_id?: string;
    variant_id?: string;
    name: string;
    price_cents: number;
    qty: number;
  }>;
  subtotal_cents: number;
  currency?: string;
}

/** Réglages vitrine (lecture/écriture PRO). store_settings_json décodé. */
export interface StoreSettings {
  slug: string;
  name: string;
  currency: string;
  enabled: boolean;
}

/**
 * Payload de checkout PUBLIC. `cart_token` cible le panier anonyme. `email` =
 * checkout guest (createOrderCore accepte un email sans customer_id). L'adresse
 * sert au quote de livraison + au calcul de taxe (region/country passés à
 * createOrderCore). ZÉRO donnée carte (PAN/CVV) — paiement MOCK (E4/E6 inactif).
 */
export interface CheckoutInput {
  email: string;
  name: string;
  phone?: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;       // province/état (→ tax_region indicatif)
    postal_code?: string;
    country: string;       // ISO 3166-1 alpha-2 (→ resolveShippingRate / computeTax)
  };
  shipping_method?: string;
  coupon_code?: string;
  cart_token: string;
}

/**
 * Résultat de checkout PUBLIC. `status` reflète EXACTEMENT ce que createOrderCore
 * produit ('pending'/'unpaid') — le tunnel public n'invente AUCUN statut, le
 * paiement reste MOCK tant que payments_live_enabled=0.
 */
export interface CheckoutResult {
  order_id: string;
  order_number: string;
  total_cents: number;
  status: string;
}

// ════════════════════════════════════════════════════════════════════════════
// LOT REPUTATION (Sprint 8) — collecte 1st-party + routing intelligent.
//
// Types ADDITIFS — FIGÉS Phase A (corps réels Phase B Manager-B dans
// reputation-public.ts / reputation.ts ; front Phase C Manager-C dans
// PublicReview.tsx / Reviews.tsx). ApiResponse INCHANGÉ (JAMAIS `code` — §6.A).
//
// Le différenciateur GHL = routing intelligent : un avis déposé sur la page
// publique 1st-party (token) est ROUTÉ selon le seuil du tenant
// (reputation_settings.rating_threshold) — note ≥ seuil → redirection PUBLIQUE
// (Google/FB via URL configurée) + reviews_cache(source_origin='internal') ;
// note < seuil → private_feedback (interne, JAMAIS exposé). Google/FB restent
// INACTIFS (_v2-backlog) : le « public » se fait par URL CONFIGURÉE, pas par
// une API GBP/FB live. Contrat figé docs/LOT-REPUTATION.md §6.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Invitation d'avis 1st-party (review_invitations seq 109). Résolue par TOKEN
 * sur la page publique /r/:token. Créée par l'action workflow `request_review`
 * (Manager-B) ou manuellement. Les champs `*_submitted` / `routed_to` /
 * `submitted_at` sont remplis au POST public (routing intelligent).
 */
export interface ReviewInvitation {
  id: string;
  client_id?: string | null;
  lead_id?: string | null;
  token: string;
  channel?: string | null;
  /** 'sent' (défaut) → 'submitted' (avis déposé). */
  status: string;
  rating_submitted?: number | null;
  comment_submitted?: string | null;
  /** 'public' (≥ seuil → redirigé Google/FB) | 'private' (< seuil → interne). */
  routed_to?: string | null;
  submitted_at?: string | null;
  created_at?: string;
}

/**
 * Feedback NÉGATIF capté en privé (private_feedback seq 109) : note < seuil ⇒
 * ne part JAMAIS vers Google/FB, reste interne. Listé côté PRO (Reviews.tsx
 * onglet « Feedback privé »).
 */
export interface PrivateFeedback {
  id: string;
  client_id?: string | null;
  lead_id?: string | null;
  invitation_id?: string | null;
  rating?: number | null;
  comment?: string | null;
  /** 'new' (défaut) → traité. */
  status: string;
  created_at?: string;
}

/**
 * Réglages réputation PAR tenant (reputation_settings seq 109, lecture/écriture
 * PRO). `rating_threshold` pilote le routing intelligent ; `public_redirect_url`
 * = URL de dépôt public (Google/FB) — fallback clients.google_place_id côté
 * worker si NULL.
 */
export interface ReputationSettings {
  client_id?: string | null;
  /** Seuil de routing (défaut 4 ⇒ 4-5 → public, 1-3 → privé). */
  rating_threshold: number;
  public_redirect_url?: string | null;
  /** 0/1 (flag d'affichage du widget). */
  widget_enabled?: number;
  /** 0/1 (notifier le tenant à chaque avis déposé). */
  notify_on_review?: number;
  updated_at?: string;
}

/**
 * Ce que la page PUBLIQUE de dépôt d'avis reçoit (GET /api/r/:token). N'EXPOSE
 * JAMAIS le seuil de routing (`rating_threshold` reste serveur — sinon un
 * déposant pourrait deviner le routing). Le front affiche nom business +
 * message, capte note + commentaire, puis POST → le worker route et renvoie
 * éventuellement une URL de redirection publique.
 */
export interface PublicReviewPage {
  /** Nom du business (affiché en en-tête de la page publique). */
  business_name: string;
  /** Message d'accueil/invitation (optionnel, configurable). */
  message?: string | null;
  /** Statut de l'invitation ('sent' = en attente ; autre = déjà soumise). */
  status?: string;
}

// ── LOT SOCIAL PLANNER (Sprint 9) — types FIGÉS Phase A ─────────────────────
// Social planner : composer + calendrier + file planifiée + cron de publication
// MOCK + génération IA de posts + connexions sociales (flag INACTIF). Tables
// social_accounts / social_posts (migration seq 110). Contrat figé
// docs/LOT-SOCIAL-PLANNER.md §6. Publication réelle + analytics = MOCK / flag.

/**
 * Réseaux sociaux supportés (valeur APPLICATIVE, PAS de CHECK en base — calque
 * seq 109). Tous INACTIFS par défaut (flag = présence des credentials OAuth
 * social ; absent ⇒ authorize 400 propre, publishToNetwork mock).
 */
export type SocialProvider = 'facebook' | 'instagram' | 'linkedin' | 'google_business';

/**
 * Connexion sociale d'un tenant (OAuth tenant-borné, calque OauthConnection /
 * social_accounts seq 110). access_token / refresh_token JAMAIS exposés au front
 * (projection serveur sans tokens). status='inactive' tant que les credentials
 * OAuth social ne sont pas posés.
 */
export interface SocialAccount {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  provider: SocialProvider;
  account_name?: string | null;
  account_external_id?: string | null;
  /** 'inactive' (flag par défaut) | 'active' (connecté). Valeur applicative. */
  status?: string;
  scopes?: string | null;
  expires_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Post du Social planner (composer + file planifiée — social_posts seq 110).
 * status APPLICATIF draft|queued|processing|published|failed (SANS CHECK) :
 * draft (composer) → queued (planifié) → processing (verrou cron) →
 * published / failed (résultat MOCK). networks = providers ciblés ; media =
 * URLs/médias attachés. published_at / error remplis par le cron mock.
 */
export interface SocialPost {
  id: string;
  client_id?: string | null;
  content: string;
  /** Médias attachés (URLs). Sérialisé media_json en base. */
  media: string[];
  /** Réseaux ciblés. Sérialisé networks_json en base. */
  networks: SocialProvider[];
  /** Échéance de publication (ISO). NULL/absent = brouillon non planifié. */
  scheduled_at?: string | null;
  /** draft | queued | processing | published | failed (valeur applicative). */
  status: string;
  published_at?: string | null;
  error?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── SPRINT 12 « IA contenu — atelier centralisé » (FIGÉS Phase A) ───────────
// Persistance de la bibliothèque + presets de voix de marque. Le moteur de
// génération (ai.ts:handleAiGenerate, social-ai.ts, aiDrafts.ts) est RÉUTILISÉ.
// `clients.brand_voice` legacy NON exposé ici (couche presets ADDITIVE).

/** Format de contenu géré par l'atelier (validé HANDLER côté worker). */
export type AiContentFormat = 'email' | 'sms' | 'social' | 'blog' | 'landing';

/**
 * Élément de la bibliothèque de contenus générés (table ai_content_items seq 112).
 * client_id / user_id bornés tenant côté worker (depuis l'AUTH, jamais le body).
 */
export interface AiContentItem {
  id: string;
  client_id?: string | null;
  user_id?: string | null;
  format: AiContentFormat;
  title?: string | null;
  /** Consigne utilisateur ayant servi à la génération. */
  brief?: string | null;
  /** Contenu généré puis édité. */
  content: string;
  /** Jointure applicative → AiBrandVoice.id (preset de ton utilisé). */
  tone_preset_id?: string | null;
  /** Action du moteur (ex 'email_followup', 'rewrite:expand') — traçabilité. */
  source_action?: string | null;
  /** draft | … (valeur applicative validée HANDLER). */
  status: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Preset de voix de marque éditable (table ai_brand_voices seq 112). `description`
 * = prompt de ton injecté dans le system prompt. is_default : un seul actif par
 * tenant (unicité gérée applicativement). NE REMPLACE PAS clients.brand_voice.
 */
export interface AiBrandVoice {
  id: string;
  client_id?: string | null;
  user_id?: string | null;
  name: string;
  /** Prompt de ton. */
  description?: string | null;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

// ════════════════════════════════════════════════════════════
// ── LOT WHITE-LABEL APPLY (Sprint 20) — métadonnées branding tenant
// ════════════════════════════════════════════════════════════
//
// 100% ADDITIF — AUCUNE migration. Le branding est DÉJÀ stocké :
//   • colonnes `clients.{logo_url,primary_color,accent_color}` (seq 81) ;
//   • colonne `clients.branding` JSON EXTENSIBLE (seq 81) — sérialisée par
//     BrandingSettings.buildBrandingBody (companyName/address/websiteUrl/
//     shortDescription) et lue par getClientBranding.
//
// Ce sprint PROPAGE le branding stocké (front + footer email), il ne le
// re-stocke PAS et n'ajoute AUCUNE colonne : les nouveaux champs (favicon,
// sender_name, remove_powered_by) sont des CLÉS additionnelles de la même
// colonne `branding` JSON extensible — aucun DDL requis.
//
// `ClientBranding` (colonnes seq 81) reste défini dans `src/lib/api.ts`
// (FIGÉ — GET/PATCH /clients/:id/branding, garde clients.manage). On ne le
// modifie PAS : on type ici UNIQUEMENT la forme du JSON `branding` désérialisé,
// en interface OPTIONNELLE-partout (rétro-compat byte : un branding legacy
// non-JSON ou vide ⇒ tous champs absents ⇒ comportement Intralys inchangé).

/**
 * Forme désérialisée de la colonne `clients.branding` (JSON extensible seq 81).
 * TOUS les champs sont OPTIONNELS (rétro-compat : un tenant sans branding, ou
 * une chaîne non-JSON legacy, donne un objet vide ⇒ défauts Intralys). Aucun
 * champ ici n'est une colonne DB : ce sont des clés du JSON `branding`.
 *
 * `company_name` est l'alias canonique consommé par la propagation
 * (applyTenantBranding / footer email). BrandingSettings sérialise
 * historiquement `companyName` (camelCase) : les deux graphies sont tolérées en
 * lecture (cf. ClientBrandingMeta.companyName), aucune migration de données.
 */
export interface ClientBrandingMeta {
  /** Nom commercial du tenant (suffixe titre, footer, logo fallback). */
  company_name?: string;
  /** Graphie historique BrandingSettings.buildBrandingBody (camelCase) — lue en repli. */
  companyName?: string;
  /** URL/data-URI du favicon tenant (pose <link rel=icon>). null/absent = favicon Intralys. */
  favicon?: string | null;
  /** Nom d'expéditeur email (enrichit resolveFromAddress côté Manager-B si trivial). */
  sender_name?: string | null;
  /** true = masquer la mention « Généré par Intralys » (footer email + footer PDF). Défaut false. */
  remove_powered_by?: boolean;
  // ── Champs méta historiques DÉJÀ sérialisés par BrandingSettings (lecture). ──
  address?: string;
  websiteUrl?: string;
  shortDescription?: string;
}

/**
 * Branding tenant prêt à propager côté front (couleurs colonnes seq 81 + méta
 * JSON fusionnée). Forme STRUCTURELLE acceptée par applyTenantBranding : c'est
 * un SUPER-ENSEMBLE optionnel de `ClientBranding` (api.ts) + `ClientBrandingMeta`.
 * Toute valeur null/absente = NO-OP sur la surface concernée (défaut Intralys).
 */
export interface TenantBranding {
  /** Couleur primaire (#rrggbb) — colonne seq 81. Invalide/absent ⇒ var Intralys conservée. */
  primary_color?: string | null;
  /** Couleur accent (#rrggbb) — colonne seq 81. Invalide/absent ⇒ var Intralys conservée. */
  accent_color?: string | null;
  /** Logo tenant (url/data-URI) — colonne seq 81. */
  logo_url?: string | null;
  /** Métadonnées branding désérialisées (colonne `branding` JSON extensible). */
  company_name?: string;
  favicon?: string | null;
  remove_powered_by?: boolean;
}

// ── Sprint 21 — Onboarding durci : items checklist côté serveur ─────────────
// Persistance D1 via colonnes additives `onboarding_state.checklist_items_json`
// + `skipped_items_json` (seq119). Audit léger via `onboarding_events` (idem).
// Best-effort dégradé : si la migration seq119 n'est pas jouée, les handlers
// renvoient { items:{}, total:0, ... } (PAS 500). Item keys = enum applicatif
// (pas de CHECK SQL) — la validation est faite dans le HANDLER worker.

export type OnboardingChecklistItemKey =
  | 'profile_completed'
  | 'leads_imported'
  | 'pipeline_configured'
  | 'team_invited'
  | 'integration_connected'
  | 'docs_visited'
  | 'ecommerce_catalog'
  | 'ecommerce_first_product'
  | 'ecommerce_channel';

export interface OnboardingChecklistItemState {
  done: boolean;
  skipped: boolean;
  completedAt: string | null;
  skippedAt: string | null;
  skipReason?: string;
}

export interface OnboardingChecklistResponse {
  items: Partial<Record<OnboardingChecklistItemKey, OnboardingChecklistItemState>>;
  total: number;
  completed: number;
  skipped: number;
  pct: number;
  lastActiveAt: string | null;
}

// ── Sprint 22 — Billing Stripe prod (E4 flag mock) — types figés ────────────
// DISTINCT du namespace E4 marchand (Payment*/PaymentStatus côté products).
// Côté SaaS Intralys (abo agence → Intralys) on parle de billing_plans /
// billing_events / billing_invoices_mock (seq120). En V1, isMock=true partout.
export type PlanTier = 'free' | 'starter' | 'pro' | 'unlimited';
export type BillingPeriod = 'monthly' | 'yearly';
export type SubscriptionStatus =
  | 'active' | 'trialing' | 'past_due' | 'canceled'
  | 'incomplete' | 'incomplete_expired' | 'paused';
export type BillingProvider = 'stripe' | 'mock';

export interface BillingPlanLimits {
  maxSubAccounts: number | null;
  maxLeads: number | null;
  maxUsers: number | null;
}

export interface BillingPlanCatalog {
  id: string;
  tier: PlanTier;
  displayName: string;
  description: string | null;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  limits: BillingPlanLimits;
  features: string[];
  displayOrder: number;
  isActive: boolean;
  isCurrent?: boolean;
}

export interface ClientSubscription {
  id: string;
  agencyId: string | null;
  clientId: string;
  planTier: PlanTier;
  status: SubscriptionStatus;
  billingPeriod: BillingPeriod | null;
  provider: BillingProvider;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  isMock: boolean;
  createdAt: string;
  updatedAt: string | null;
  parentSubscriptionId?: string | null;
}

export interface BillingUsage {
  subAccounts: { current: number; limit: number | null };
  leads:       { current: number; limit: number | null };
  users:       { current: number; limit: number | null };
}

export interface BillingPortalSession {
  url: string;
  expiresAt: string;
  isMock: boolean;
}

export interface BillingInvoiceMock {
  id: string;
  number: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
  isMock: boolean;
  createdAt: string;
}

export interface BillingWebhookConfig {
  endpointUrl: string;
  signingSecretConfigured: boolean;
  stripeKeyConfigured: boolean;
  modeMock: boolean;
  supportedEvents: string[];
}

export interface StripeWebhookEventMock {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  created?: number;
  livemode?: boolean;
}

// ── Sprint 23 — Sécurité / conformité ────────────────────────────────────
export type CookieCategory = 'essential' | 'preferences' | 'analytics' | 'marketing';
export type CookieConsent = Record<CookieCategory, boolean>;

export interface CookieConsentRecord {
  id: string;
  anonymous_id: string | null;
  user_id: string | null;
  categories: CookieConsent;
  policy_version: string;
  ip: string;
  user_agent: string;
  url: string;
  granted_at: string;
}

export interface AccountDeletionRequest {
  id: string;
  user_id: string;
  reason: string;
  status: 'pending' | 'canceled' | 'executed';
  requested_at: string;
  scheduled_for: string;
  executed_at: string | null;
}

export interface MyDataExport {
  user: Record<string, unknown>;
  sessions: Array<Record<string, unknown>>;
  audit_log: Array<Record<string, unknown>>;
  consents_given: Array<Record<string, unknown>>;
  cookie_consents: Array<Record<string, unknown>>;
  exported_at: string;
  purpose: string;
}

export interface AuditLogEntry {
  id: number;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  tenant_id: string | null;
  redacted: number;
  created_at: string;
}

export interface AuditLogQuery {
  action?: string;
  user_id?: string;
  resource_type?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export interface CapabilityOverride {
  id: string;
  user_id: string;
  capability: string;
  granted: 0 | 1;
  created_at: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  bucket_key: string;
}

// ── Sprint 24 — Observabilité (types front) ──────────────────────────────
// Miroirs des types worker (src/worker/types.ts). `enabled` est bool côté
// front (le worker le sérialise en bool dans la réponse JSON).
export type AlertConditionType = 'error_rate' | 'p95_latency' | 'web_vital_p75';
export type AlertChannel = 'log' | 'webhook';

export interface AlertRule {
  id: string;
  name: string;
  condition_type: AlertConditionType;
  metric_name: string | null;
  threshold: number;
  window_minutes: number;
  notification_channel: AlertChannel;
  notification_target: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertEvent {
  id: string;
  rule_id: string;
  triggered_at: string;
  payload: Record<string, unknown>;
  resolved_at: string | null;
}

export interface ObservabilityHealth {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
  version: string;
  uptime_s: number;
  ai_mock: boolean;
  migrations_count: number | null;
  last_migration: string | null;
}

export interface RequestMetricsBucket {
  route: string;
  count: number;
  error_count: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  error_rate_pct: number;
}

// ── Sprint 27 — Mobile / PWA : DeviceToken étendu (seq124) ────────────────
// Aligné colonnes RÉELLES : base seq20 (migration_p3_10.sql:7-13) + colonnes
// ADDITIVES seq124 (last_seen_at, app_version, enabled, device_label).
// `enabled` = INTEGER NOT NULL DEFAULT 1 côté DB → 0 | 1 côté TS.
// Les 3 autres colonnes additives sont nullables (TEXT sans DEFAULT).
export interface DeviceToken {
  id: string;
  user_id: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  last_seen_at: string | null;
  app_version: string | null;
  enabled: 0 | 1;
  device_label: string | null;
  created_at: string;
}

// ── Sprint 30 — Release Candidate / Beta ──────────────────────────────────
export interface ReleaseGateCheck {
  ok: boolean;
  value?: unknown;
  missing?: string[];
  status?: number;
  count?: number;
}

export interface ReleaseGatesStatus {
  all_green: boolean;
  checks: {
    migrations_last_seq: ReleaseGateCheck;
    env_critical_present: ReleaseGateCheck;
    env_optional_present: ReleaseGateCheck;
    dev_bypass_off: ReleaseGateCheck;
    payments_live_disabled: ReleaseGateCheck;
    health_endpoint: ReleaseGateCheck;
    web_vitals_endpoint: ReleaseGateCheck;
    beta_codes_seeded: ReleaseGateCheck;
  };
  checked_at: string;
}

export interface ReleaseGatesRun {
  id: string;
  ran_by: string | null;
  all_green: 0 | 1;
  payload: string;
  created_at: string;
}

// ── Sprint 31 — Stripe live activation ───────────────────────────────────
export type PaymentMethodBrand = 'visa'|'mastercard'|'amex'|'discover'|'diners'|'jcb'|'unionpay'|'unknown';
export type PaymentMethodType = 'card'|'apple_pay'|'google_pay';

export interface StripePaymentMethod {
  id: string;
  stripePaymentMethodId: string;
  type: PaymentMethodType;
  brand: PaymentMethodBrand | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  createdAt: string;
}

export interface StripeSetupIntent {
  clientSecret: string;
  setupIntentId: string;
}

export interface StripeConnectAccount {
  id: string;
  clientId: string;
  stripeAccountId: string;
  accountType: 'express'|'standard'|'custom';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities: Record<string, 'active'|'pending'|'inactive'>;
  requirements: { currently_due: string[]; eventually_due: string[]; past_due: string[] };
  onboardingCompletedAt: string | null;
}

export interface StripeConnectOnboardingLink {
  url: string;
  expiresAt: string;
}

// ── Sprint 32 — Google Business Profile (GBP) integration ─────────────────
export interface GbpConnection {
  id: string;
  clientId: string;
  agencyId: string | null;
  oauthConnectionId: string | null;
  gbpAccountId: string | null;
  gbpAccountName: string | null;
  status: 'active' | 'disconnected' | 'error';
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GbpLocation {
  id: string;
  gbpLocationId: string;
  locationTitle: string | null;
  primaryPhone: string | null;
  primaryCategory: string | null;
  storeCode: string | null;
  isDefault: boolean;
  metadata?: Record<string, unknown>;
}

export interface GbpReviewSync {
  id: string;
  reviewsCacheId: string | null;
  gbpReviewName: string;
  replyStatus: 'none' | 'pending' | 'sent' | 'failed';
  replySyncedAt: string | null;
  lastFetchedAt: string | null;
}

export interface GbpInsightsMetric {
  metric: string;
  value: number;
  trend?: number;
}

export interface GbpInsights {
  locationName: string;
  startDate: string;
  endDate: string;
  metrics: GbpInsightsMetric[];
}

export interface GbpPostInput {
  locationId: string;
  summary: string;
  topicType?: 'STANDARD' | 'OFFER' | 'EVENT';
  callToAction?: { actionType: 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'CALL'; url?: string };
  mediaUrl?: string;
}

// ── Sprint 33 — Calendar sync ──────────────────────────────────────────
export type CalendarSyncProvider = 'google_calendar' | 'outlook';
export type CalendarSyncStatus = 'active' | 'paused' | 'error' | 'revoked';
export type AppointmentSyncStatus = 'pending' | 'synced' | 'conflict' | 'error' | 'deleted_remote';

export interface CalendarConnection {
  id: string;
  clientId: string;
  agencyId: string | null;
  userId: string | null;
  provider: CalendarSyncProvider;
  externalAccountEmail: string | null;
  externalCalendarId: string | null;
  externalCalendarName: string | null;
  syncDirection: 'push_only' | 'pull_only' | 'bidirectional';
  status: CalendarSyncStatus;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarExternalEvent {
  id: string;
  externalEventId: string;
  summary: string | null;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  status: string | null;
  externalUpdatedAt: string | null;
}

export interface AppointmentSync {
  id: string;
  appointmentId: string;
  calendarConnectionId: string;
  externalEventId: string | null;
  syncStatus: AppointmentSyncStatus;
  syncDirection: 'push' | 'pull';
  lastSyncedAt: string | null;
  lastError: string | null;
  conflictResolution: string | null;
}

export interface CalendarConflict {
  syncId: string;
  appointmentId: string;
  externalEventId: string;
  provider: CalendarSyncProvider;
  intralysUpdatedAt: string;
  externalUpdatedAt: string;
  intralysSummary: string;
  externalSummary: string;
}

// ── Sprint 39 — Multi-currency + Tax extension (additif strict) ─────────────
// PRÉSERVATION : SupportedCurrency existant ('CAD'|'EUR'|'DZD') reste FIGÉ
// (consommé par RegionConfig + ecommerce-region.ts + tax-engine legacy 'qc'/'eu'/
// 'dz'/'exempt'). On ajoute SupportedCurrencyExt (élargi USD + MAD) consommé
// par le nouveau moteur multi-currency (currency_rates) ET TaxRegimeExt élargi
// avec 'us_sales_tax' consommé par tax-engine-multi.ts (délégation legacy).
//
// Régression-zéro QC/EU/DZ : tout consumer qui type SupportedCurrency continue
// d'accepter strictement 'CAD'|'EUR'|'DZD'. Le nouveau type 'Ext' est un SUR-
// ensemble — un cast est requis pour passer d'un type Ext à legacy (intentionnel,
// garde-fou TypeScript).
export type SupportedCurrencyExt = 'CAD' | 'USD' | 'EUR' | 'DZD' | 'MAD';
export type TaxRegimeExt = TaxRegime | 'us_sales_tax';

/**
 * Taux de change base→quote (cache `currency_rates` seq134).
 * Source 'ecb'|'frankfurter' = fetch automatique cron, 'manual' = override admin.
 */
export interface CurrencyRate {
  id: string;
  base_currency: SupportedCurrencyExt;
  quote_currency: SupportedCurrencyExt;
  rate: number;
  source: 'ecb' | 'frankfurter' | 'manual';
  fetched_at: string;
}

/**
 * Région fiscale admin-managed par tenant (table `tax_regions` seq134).
 * code = identifiant tenant ('QC-CA', 'NY-US'). type pilote la stratégie
 * délégation moteur multi : vat→eu | gst_pst→qc | sales_tax→us_sales_tax |
 * tva_dz→dz | exempt→exempt.
 */
export interface TaxRegion {
  id: string;
  client_id: string;
  code: string;
  name: string;
  country: string;
  country_subdiv: string | null;
  type: 'vat' | 'gst_pst' | 'sales_tax' | 'tva_dz' | 'exempt';
  rates_json: Record<string, number>;
  tax_inclusive: boolean;
  active: boolean;
}

/**
 * Règle taux par catégorie produit dans une région fiscale (`tax_rules` seq134).
 * product_category match products.tax_category (DEFAULT 'standard').
 * compound = taxe en cascade (rare : QC pré-2013 — TVQ sur TPS+sub).
 */
export interface TaxRule {
  id: string;
  region_id: string;
  product_category: string;
  rate: number;
  compound: boolean;
  applies_from: string;
}

/**
 * Taux de taxe simplifiés multi-régions (table `tax_rates`).
 * Utilisé pour configurer des taxes TPS/TVQ/TVA de façon simple par pays/province.
 */
export interface TaxRate {
  id: string;
  client_id: string;
  country: string;
  state_province: string | null;
  rate_tps: number;
  rate_tvq: number;
  rate_tva: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

// ════════════════════════════════════════════════════════════
// ── Sprint 40 ── Product Reviews + Abandoned Carts Recovery (seq135)
// ════════════════════════════════════════════════════════════

/**
 * Statut de modération d'un avis produit (`product_reviews.status` seq135).
 * Validation enum HANDLER (pas de CHECK SQLite — rebuild interdit).
 */
export type ProductReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

/**
 * Avis produit déposé par un client (public submit + moderation admin).
 * Source : table `product_reviews` seq135.
 *
 * verified_buyer = order_id non-NULL ET matché à une commande livrée du
 * customer_id (checkVerifiedBuyer lib/review-moderation.ts). photos = array
 * d'URLs uploadées (R2/storage), max 5 (validation HANDLER).
 */
export interface ProductReview {
  id: string;
  client_id: string;
  product_id: string;
  customer_id: string | null;
  order_id: string | null;
  rating: number; // 1..5 validation HANDLER
  title: string;
  body: string;
  photos: string[] | null;
  verified_buyer: boolean;
  status: ProductReviewStatus;
  moderation_notes: string | null;
  helpful_count: number;
  spam_score: number; // 0..100 heuristique HANDLER
  created_at: string;
  updated_at: string;
}

/**
 * Input PUBLIC submit avis produit (POST /api/products/:id/reviews).
 * website_url = honeypot anti-bot (champ caché frontend — toute valeur ≠ '' ⇒ rejet silencieux).
 * email requis pour matching verified_buyer + envoi notif modération admin.
 */
export interface ProductReviewSubmitInput {
  rating: number;
  title?: string;
  body: string;
  email: string;
  name?: string;
  photos?: string[];
  /** Honeypot anti-bot — DOIT être vide. Toute valeur ⇒ rejet 202 silencieux. */
  website_url?: string;
  order_id?: string;
}

/**
 * Etat d'un panier dans la séquence de récupération multi-touch (seq135).
 * Source : table `carts` ALTERs additifs (recovery_email_sent_count, etc.).
 * cart_token = jeton public landing /api/recovery/:token (signé HMAC).
 * attempts[] = historique tentatives (step, channel, sent_at, coupon_code).
 */
export interface RecoverySequenceState {
  cart_id: string;
  cart_token: string;
  recovery_email_sent_count: number;
  last_recovery_at: string | null;
  next_recovery_due_at: string | null;
  recovery_discount_code: string | null;
  recovery_completed_at: string | null;
  attempts: Array<{
    step: 1 | 2 | 3;
    channel: 'email' | 'sms';
    sent_at: string;
    coupon_code: string | null;
  }>;
}

/**
 * Délais (minutes) entre touches de la séquence multi-touch (FIGÉS seq135).
 * Step 1 = 1h après abandon, Step 2 = 24h, Step 3 = 72h.
 */
export const RECOVERY_DELAYS_MIN = {
  1: 60,
  2: 1440,
  3: 4320,
} as const;

/**
 * Discount progressif (%) par touche (FIGÉ seq135).
 * Step 1 = pas de coupon (juste rappel), Step 2 = 5%, Step 3 = 10%.
 * Implémenté via engine `coupons` existant (seq18 + ALTER seq85) en
 * Phase B via generateRecoveryCoupon().
 */
export const RECOVERY_DISCOUNT_PCT = {
  1: 0,
  2: 5,
  3: 10,
} as const;

// ── Sprint 66 — Moteur de Routage Intelligent des Commandes ─────────────────
export interface OrderRoutingCondition {
  field: 'shipping_country' | 'shipping_country_subdiv' | 'shipping_postal_code';
  operator: 'equals' | 'not_equals' | 'contains' | 'starts_with';
  value: string;
}

export interface OrderRoutingRule {
  id: string;
  client_id: string;
  name: string;
  priority: number;
  conditions_json: string; // stringified OrderRoutingCondition[]
  action_warehouse_id: string;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

// ── Sprint 71 — RAG sur Base de Connaissances ──────────────────────────────
export interface KbIndexStatus {
  source_id: string;
  chunks_count: number;
  last_indexed_at: string;
}

// ── Sprint 72 — Sessions Chatbot Autonome ───────────────────────────────────
export interface ChatbotSession {
  id: string;
  session_token: string;
  is_active: number;
  confidence_avg: number;
  client_id: string;
  created_at: string;
  updated_at: string;
}

