// ── Types partagés Intralys CRM ─────────────────────────────

// Statuts possibles du pipeline
export const LEAD_STATUSES = ['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

export const LEAD_TYPES = ['buy', 'sell'] as const;
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

export const MESSAGE_CHANNELS = ['email', 'sms', 'internal_note'] as const;
export type MessageChannel = typeof MESSAGE_CHANNELS[number];

export const MESSAGE_STATUSES = ['draft', 'sent', 'delivered', 'failed', 'read', 'bounced'] as const;
export type MessageStatus = typeof MESSAGE_STATUSES[number];

export const TEMPLATE_CATEGORIES = ['welcome', 'followup', 'reminder', 'notification', 'marketing', 'general'] as const;
export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number];

export interface Message {
  id: string;
  lead_id: string;
  client_id: string;
  direction: MessageDirection;
  channel: MessageChannel;
  subject: string;
  body: string;
  status: MessageStatus;
  sent_by: string;
  external_id: string;
  metadata: string;
  created_at: string;
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
  is_active: number;
  created_at: string;
  updated_at: string;
}

// ── Phase 3 : Automations & Workflows ──────────────────────

export const TRIGGER_TYPES = ['lead_created', 'status_changed', 'tag_added', 'form_submitted', 'score_threshold'] as const;
export type TriggerType = typeof TRIGGER_TYPES[number];

export const STEP_TYPES = [
  'send_email', 'send_sms', 'wait', 'condition',
  'add_tag', 'remove_tag', 'change_status', 'assign', 'notify', 'webhook',
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
  created_at: string;
  updated_at: string;
}

// ── Phase 7 : Champs personnalisés ─────────────────────────

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'select', 'date', 'checkbox'] as const;
export type CustomFieldType = typeof CUSTOM_FIELD_TYPES[number];

export interface CustomFieldDef {
  id: string;
  name: string;
  field_type: CustomFieldType;
  options: string[];  // pour type 'select'
  is_required: boolean;
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
  name: string;
  filters: {
    status?: string;
    source?: string;
    client_id?: string;
    search?: string;
    tag?: string;
  };
  count?: number;
  created_at: string;
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
  avg_conversion_days: number;
  leads_by_client: Array<{ client_name: string; count: number }>;
  leads_by_status: Array<{ status: LeadStatus; count: number }>;
  leads_by_day: Array<{ date: string; count: number }>;
  leads_by_source: Array<{ source: string; count: number }>;
  conversion_by_status: Array<{ status: string; count: number; pct: number }>;
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

export interface PipelineData {
  [key: string]: Lead[];
}

// ── Labels FR pour l'interface ──────────────────────────────

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Nouveau',
  contacted: 'Contacté',
  meeting: 'RDV',
  signed: 'Signé',
  closed: 'Fermé',
  lost: 'Perdu',
};

export const STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'var(--color-accent)',
  contacted: 'var(--color-info)',
  meeting: 'var(--color-warning)',
  signed: 'var(--color-success)',
  closed: 'var(--color-muted)',
  lost: 'var(--color-danger)',
};

export const TYPE_LABELS: Record<LeadType, string> = {
  buy: 'Acheteur',
  sell: 'Vendeur',
};

export const SOURCE_LABELS: Record<string, string> = {
  website: 'Site web',
  facebook: 'Facebook',
  google: 'Google Ads',
  referral: 'Référence',
  phone: 'Téléphone',
  walkin: 'Sans RDV',
  ghl_import: 'Import GHL',
  other: 'Autre',
};

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  lead: 'Lead',
  mql: 'MQL',
  sql: 'SQL',
  opportunity: 'Opportunité',
  customer: 'Client',
  lost: 'Perdu',
};

export const LIFECYCLE_COLORS: Record<LifecycleStage, string> = {
  lead: 'var(--color-info)',
  mql: 'var(--color-accent)',
  sql: 'var(--color-warning)',
  opportunity: 'oklch(0.7 0.18 60)',
  customer: 'var(--color-success)',
  lost: 'var(--color-danger)',
};

export const NOTE_CATEGORY_LABELS: Record<string, string> = {
  general: 'Général',
  call: 'Appel',
  meeting: 'Rencontre',
  'follow-up': 'Relance',
  important: 'Important',
};

export const NOTE_CATEGORY_ICONS: Record<string, string> = {
  general: '📝',
  call: '📞',
  meeting: '🤝',
  'follow-up': '🔄',
  important: '⚠️',
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  created: 'Lead créé',
  status_change: 'Statut modifié',
  note_added: 'Note ajoutée',
  tag_added: 'Tag ajouté',
  tag_removed: 'Tag retiré',
  email_sent: 'Email envoyé',
  sms_sent: 'SMS envoyé',
  assigned: 'Assigné',
  deal_value_changed: 'Valeur modifiée',
};

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

export const CHANNEL_LABELS: Record<MessageChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  internal_note: 'Note interne',
};

export const CHANNEL_ICONS: Record<MessageChannel, string> = {
  email: '📧',
  sms: '💬',
  internal_note: '📝',
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  delivered: 'Livré',
  failed: 'Échoué',
  read: 'Lu',
  bounced: 'Rebondi',
};

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  welcome: 'Bienvenue',
  followup: 'Relance',
  reminder: 'Rappel',
  notification: 'Notification',
  marketing: 'Marketing',
  general: 'Général',
};

// ── Labels Phase 3 : Workflows ─────────────────────────────

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  lead_created: 'Lead créé',
  status_changed: 'Statut modifié',
  tag_added: 'Tag ajouté',
  form_submitted: 'Formulaire soumis',
  score_threshold: 'Score atteint',
};

export const TRIGGER_ICONS: Record<TriggerType, string> = {
  lead_created: '🆕',
  status_changed: '🔄',
  tag_added: '🏷️',
  form_submitted: '📋',
  score_threshold: '📊',
};

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  send_email: 'Envoyer email',
  send_sms: 'Envoyer SMS',
  wait: 'Attendre',
  condition: 'Condition',
  add_tag: 'Ajouter tag',
  remove_tag: 'Retirer tag',
  change_status: 'Changer statut',
  assign: 'Assigner',
  notify: 'Notifier',
  webhook: 'Webhook',
};

export const STEP_TYPE_ICONS: Record<StepType, string> = {
  send_email: '📧',
  send_sms: '💬',
  wait: '⏳',
  condition: '🔀',
  add_tag: '🏷️',
  remove_tag: '🏷️',
  change_status: '🔄',
  assign: '👤',
  notify: '🔔',
  webhook: '🌐',
};

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  active: 'Actif',
  paused: 'En pause',
  completed: 'Terminé',
  cancelled: 'Annulé',
};

// ── Labels Phase 4 : Calendrier ────────────────────────────

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  meeting: 'Rencontre',
  call: 'Appel',
  visit: 'Visite',
  signing: 'Signature',
  other: 'Autre',
};

export const APPOINTMENT_TYPE_ICONS: Record<AppointmentType, string> = {
  meeting: '🤝',
  call: '📞',
  visit: '🏠',
  signing: '✍️',
  other: '📌',
};

export const APPOINTMENT_TYPE_COLORS: Record<AppointmentType, string> = {
  meeting: 'var(--color-accent)',
  call: 'var(--color-info)',
  visit: 'var(--color-success)',
  signing: 'var(--color-warning)',
  other: 'var(--color-muted)',
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Planifié',
  confirmed: 'Confirmé',
  cancelled: 'Annulé',
  completed: 'Terminé',
  no_show: 'Absent',
};

// ── Labels Phase 7 : Tâches ────────────────────────────────

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
};

export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: 'var(--color-danger)',
  medium: 'var(--color-warning)',
  low: 'var(--color-info)',
};

export const TASK_PRIORITY_ICONS: Record<TaskPriority, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🔵',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  done: 'Terminé',
};

export const TASK_STATUS_ICONS: Record<TaskStatus, string> = {
  todo: '⬜',
  in_progress: '🔄',
  done: '✅',
};
