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
  'math_operation', 'goal_reached', 'add_to_smart_list'
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

