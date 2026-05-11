// ── Schémas de validation Zod ───────────────────────────────
// Centralisé pour tous les endpoints API du worker

import { z } from 'zod/v4';

// ── Auth ────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(500),
});

export const changePasswordSchema = z.object({
  current: z.string().min(1).max(500),
  next: z.string().min(8).max(500),
});

// ── Leads ───────────────────────────────────────────────────

export const leadStatusEnum = z.enum(['new', 'contacted', 'meeting', 'signed', 'closed', 'lost']);

export const patchLeadSchema = z.object({
  status: leadStatusEnum.optional(),
  notes: z.string().max(2000).optional(),
  deal_value: z.number().min(0).optional(),
  assigned_to: z.string().max(100).optional(),
  score: z.number().min(0).max(100).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'Aucune modification' });

export const bulkLeadsSchema = z.object({
  ids: z.array(z.string().max(100)).min(1).max(100),
  action: z.enum(['change_status', 'add_tag', 'remove_tag', 'assign', 'delete']),
  value: z.string().max(100).optional(),
});

// ── Webhook Lead ────────────────────────────────────────────

export const webhookLeadSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email().max(200),
  phone: z.string().max(30).optional(),
  message: z.string().max(2000).optional(),
  type: z.enum(['inbound', 'customer']).optional(),
  external_id: z.string().max(200).optional(),
  budget: z.string().max(50).optional(),
  timeline: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  property_type: z.string().max(50).optional(),
  source: z.string().max(50).optional(),
});

// ── Clients ─────────────────────────────────────────────────

export const createClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email().max(200),
  phone: z.string().max(30).optional(),
  site_url: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  banner: z.string().max(100).optional(),
});

// ── Tasks ───────────────────────────────────────────────────

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  due_date: z.string().max(30).optional(),
  lead_id: z.string().max(100).optional(),
  assigned_to: z.string().max(100).optional(),
});

// ── Templates ───────────────────────────────────────────────

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  body_html: z.string().min(1).max(50000),
  category: z.string().max(50).optional(),
});

// ── Appointments ────────────────────────────────────────────

export const createAppointmentSchema = z.object({
  title: z.string().min(1).max(200),
  lead_id: z.string().max(100).optional(),
  client_id: z.string().max(100).optional(),
  start_time: z.string().max(50),
  end_time: z.string().max(50).optional(),
  location: z.string().max(300).optional(),
  notes: z.string().max(2000).optional(),
  type: z.enum(['meeting', 'call', 'showing', 'signing', 'other']).optional(),
});

// ── Helper pour parser et valider ───────────────────────────

export function validate<T>(schema: z.ZodType<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // Extraire le premier message d'erreur lisible
  const firstIssue = result.error.issues[0];
  const path = firstIssue?.path?.join('.') || '';
  const message = firstIssue?.message || 'Validation échouée';
  return { success: false, error: path ? `${path}: ${message}` : message };
}
