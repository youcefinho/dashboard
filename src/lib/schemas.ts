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

// ════════════════════════════════════════════════════════════
// S3 M1 — Schémas mutations critiques (dérivés des handlers RÉELS)
// ════════════════════════════════════════════════════════════
//
// PRINCIPE : permissif. Chaque schéma est calqué sur le comportement
// EXACT du handler cible (champs/optionnels/defaults/nullables lus dans
// le code, pas inventés). On ne rejette QUE le clairement invalide
// (requis absent, type franchement faux). Tout l'incertain est
// .optional()/.nullable() et chaque objet est .passthrough() afin de
// NE JAMAIS rejeter un payload légitime actuel (les handlers ignorent
// déjà les champs inconnus). Money TOUJOURS en cents (INTEGER).
//
// Ces schémas sont DESTINÉS à être consommés par M2 (ecommerce-*) et
// M3 (leads/tasks/pipelines/forms) en Phase B via le helper
// validationError() — aucun handler n'est modifié par M1.

// ── E-commerce : Commandes ──────────────────────────────────

// createOrderCore (ecommerce-orders.ts) : email requis (sanitizé),
// items[] {variant_id, quantity}, customer_id nullable, shipping/
// discount cents optionnels, source défaut 'web', tax_region/country
// optionnels (défaut régime 'qc'). On reste large : quantity coercée
// côté handler (Math.max(1,…)), donc on accepte tout nombre/manquant.
export const orderItemSchema = z.object({
  variant_id: z.string().min(1).max(100),
  quantity: z.number().optional(),
}).passthrough();

export const createOrderSchema = z.object({
  email: z.string().min(1).max(200),
  items: z.array(orderItemSchema).min(1, { message: 'Ajoute au moins un article' }),
  customer_id: z.string().max(100).nullable().optional(),
  shipping_cents: z.number().optional(),
  discount_cents: z.number().optional(),
  note: z.string().max(2000).optional(),
  source: z.string().max(50).optional(),
  tax_region: z.string().max(20).optional(),
  tax_country: z.string().max(10).optional(),
}).passthrough();

// handleCreateManualOrder : même cœur, customer optionnel, source
// forcée 'manual' côté handler → schéma identique permissif.
export const createManualOrderSchema = createOrderSchema;

// handleUpdateOrderStatus : body { status } parmi la machine à états.
export const orderStatusEnum = z.enum([
  'pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded',
]);
export const updateOrderStatusSchema = z.object({
  status: orderStatusEnum,
}).passthrough();

// ── E-commerce : Produits / variantes ───────────────────────

// handleCreateProduct : seul `title` requis. status défaut 'draft',
// base_price cents défaut 0, variants[] optionnels (1 défaut sinon).
export const productVariantInputSchema = z.object({
  title: z.string().max(200).optional(),
  sku: z.string().max(100).nullable().optional(),
  price_override: z.number().nullable().optional(),
  barcode: z.string().max(100).nullable().optional(),
  weight_grams: z.number().nullable().optional(),
  options_json: z.unknown().optional(),
}).passthrough();

export const createProductSchema = z.object({
  title: z.string().min(1, { message: 'Le titre du produit est requis' }).max(200),
  slug: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  base_price: z.number().optional(),
  product_type: z.string().max(100).optional(),
  vendor: z.string().max(100).optional(),
  currency: z.string().max(8).optional(),
  tax_class: z.string().max(50).optional(),
  seo_title: z.string().max(200).optional(),
  seo_description: z.string().max(320).optional(),
  variants: z.array(productVariantInputSchema).optional(),
}).passthrough();

// handleUpdateProduct : tous champs optionnels (au moins 1 côté handler).
export const updateProductSchema = z.object({
  title: z.string().max(200).optional(),
  slug: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  base_price: z.number().optional(),
  product_type: z.string().max(100).optional(),
  vendor: z.string().max(100).optional(),
  currency: z.string().max(8).optional(),
  tax_class: z.string().max(50).optional(),
  seo_title: z.string().max(200).optional(),
  seo_description: z.string().max(320).optional(),
}).passthrough();

// ── E-commerce : Inventaire ─────────────────────────────────

// handleAdjustInventory : delta entier non-nul requis ; reason/note/
// reference_* optionnels (reason filtrée par allowlist côté handler).
export const adjustInventorySchema = z.object({
  delta: z.number().refine(n => Math.round(n) !== 0, { message: 'Le delta doit être non nul' }),
  reason: z.string().max(50).optional(),
  note: z.string().max(500).optional(),
  reference_type: z.string().max(50).optional(),
  reference_id: z.string().max(100).optional(),
}).passthrough();

// ── E-commerce : Panier ─────────────────────────────────────

// handleAddCartItem : variant_id requis ; quantity coercée (≥1) côté
// handler, customer_id/token optionnels nullables.
export const addCartItemSchema = z.object({
  variant_id: z.string().min(1, { message: 'Variante requise' }).max(100),
  quantity: z.number().optional(),
  customer_id: z.string().max(100).nullable().optional(),
  token: z.string().max(100).nullable().optional(),
}).passthrough();

// ── E-commerce : Retours ────────────────────────────────────

// handleCreateReturn : order_id requis ; items[] + reason optionnels
// (validation fine ligne-à-ligne reste côté handler).
export const createReturnSchema = z.object({
  order_id: z.string().min(1, { message: 'Commande requise' }).max(100),
  items: z.array(z.unknown()).optional(),
  reason: z.string().max(500).optional(),
}).passthrough();

// ── CRM : Leads ─────────────────────────────────────────────

// handleCreateLead : client_id + name + email requis ; type défaut
// 'inbound', source défaut 'manual', message optionnel.
export const createLeadSchema = z.object({
  client_id: z.string().min(1, { message: 'client_id requis' }).max(100),
  name: z.string().min(1, { message: 'Nom requis' }).max(100),
  email: z.string().min(1, { message: 'Email requis' }).max(200),
  phone: z.string().max(30).optional(),
  type: z.string().max(20).optional(),
  source: z.string().max(50).optional(),
  message: z.string().max(2000).optional(),
}).passthrough();

// handleWebhookLead (ingest public) : name + email requis ; reste large.
export const webhookLeadIngestSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  message: z.string().max(2000).optional(),
  type: z.string().max(20).optional(),
  external_id: z.string().max(200).optional(),
  budget: z.string().max(50).optional(),
  timeline: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  property_type: z.string().max(50).optional(),
  source: z.string().max(50).optional(),
}).passthrough();

// ── CRM : Tasks ─────────────────────────────────────────────

// handleCreateTask : title requis ; tout le reste optionnel (defaults
// posés côté handler : priority 'medium', status 'todo', assigné à soi).
export const createTaskSchemaS3 = z.object({
  title: z.string().min(1, { message: 'Titre requis' }).max(200),
  description: z.string().max(1000).optional(),
  due_date: z.string().max(30).nullable().optional(),
  priority: z.string().max(10).optional(),
  status: z.string().max(20).optional(),
  lead_id: z.string().max(100).nullable().optional(),
  client_id: z.string().max(100).nullable().optional(),
  assigned_to: z.string().max(100).optional(),
  recurring_rule: z.string().max(100).nullable().optional(),
  parent_task_id: z.string().max(100).nullable().optional(),
}).passthrough();

// handlePatchTask : tous champs optionnels (≥1 exigé côté handler).
export const patchTaskSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  due_date: z.string().max(30).nullable().optional(),
  priority: z.string().max(10).optional(),
  status: z.string().max(20).optional(),
  assigned_to: z.string().max(100).optional(),
  recurring_rule: z.string().max(100).nullable().optional(),
}).passthrough();

// ── CRM : Pipeline (déplacement de lead = patchLead pipeline/stage) ──

// handlePatchLead accepte status/notes/deal_value/assigned_to/score +
// pipeline_id/stage_id (le "move" Kanban). Tout optionnel, ≥1 exigé
// côté handler. Permissif : on ne contraint pas pipeline_id/stage_id.
export const patchLeadSchemaS3 = z.object({
  status: z.string().max(30).optional(),
  notes: z.string().max(2000).optional(),
  deal_value: z.number().optional(),
  assigned_to: z.string().max(100).optional(),
  score: z.number().optional(),
  pipeline_id: z.string().max(100).optional(),
  stage_id: z.string().max(100).optional(),
  date_of_birth: z.string().max(20).optional(),
  country: z.string().max(10).optional(),
  timezone: z.string().max(50).optional(),
}).passthrough();

// handleBulkLeads : ids[] (1..100) + action allowlistée + value optionnel.
export const bulkLeadsSchemaS3 = z.object({
  ids: z.array(z.string().max(100)).min(1, { message: 'Liste de IDs requise' }).max(100),
  action: z.enum(['change_status', 'add_tag', 'remove_tag', 'assign', 'delete']),
  value: z.string().max(100).optional(),
}).passthrough();

// handleCreatePipeline : name + client_id requis ; color/is_default opt.
export const createPipelineSchema = z.object({
  name: z.string().min(1, { message: 'Nom requis' }).max(200),
  client_id: z.string().min(1, { message: 'client_id requis' }).max(100),
  color: z.string().max(20).optional(),
  is_default: z.boolean().optional(),
}).passthrough();

// handleCreatePipelineStage : name requis ; reste optionnel.
export const createPipelineStageSchema = z.object({
  name: z.string().min(1, { message: 'Nom requis' }).max(100),
  color: z.string().max(20).optional(),
  probability: z.number().optional(),
  wip_limit: z.number().optional(),
  sla_days: z.number().optional(),
}).passthrough();

// ── Forms : soumission publique ─────────────────────────────

// handlePublicFormSubmit : form_id + data requis (data = objet libre,
// les champs dynamiques varient par formulaire → on ne contraint PAS
// data au-delà d'« objet présent »).
export const publicFormSubmitSchema = z.object({
  form_id: z.string().min(1, { message: 'form_id requis' }).max(100),
  data: z.record(z.string(), z.unknown()),
}).passthrough();

// handleCreateForm : client_id + name + slug requis ; reste optionnel.
export const createFormSchema = z.object({
  client_id: z.string().min(1, { message: 'client_id requis' }).max(100),
  name: z.string().min(1, { message: 'name requis' }).max(200),
  slug: z.string().min(1, { message: 'slug requis' }).max(50),
  description: z.string().max(500).optional(),
  fields: z.unknown().optional(),
  form_type: z.string().max(50).optional(),
  submit_action: z.string().max(50).optional(),
  success_message: z.string().max(500).optional(),
  settings_json: z.unknown().optional(),
}).passthrough();

// ════════════════════════════════════════════════════════════
// S4 M2 — Schémas additifs (dérivés des handlers RÉELS)
// ════════════════════════════════════════════════════════════
//
// MÊME PRINCIPE que S3 M1 : permissif, calqué EXACTEMENT sur ce que
// le handler cible LIT (champs/optionnels/defaults). On ne rejette
// QUE le clairement invalide. .passthrough() systématique. 0 modif
// des schémas/`validate()` existants (purement additif).

// ── CRM : Lead Notes ────────────────────────────────────────

// handleCreateLeadNote (lead-notes.ts ~:25) : seul `body` requis
// (non vide après trim côté handler). category filtrée par allowlist
// côté handler (on ne contraint donc PAS l'enum ici → permissif),
// is_pinned booléen optionnel.
export const createLeadNoteSchema = z.object({
  body: z.string().min(1, { message: 'Le contenu de la note est requis' }).max(10000),
  category: z.string().max(50).optional(),
  is_pinned: z.boolean().optional(),
}).passthrough();

// handleUpdateLeadNote (lead-notes.ts ~:61) : tous champs optionnels
// (au moins 1 effectif exigé côté handler — message « Rien à modifier »).
export const updateLeadNoteSchema = z.object({
  body: z.string().max(10000).optional(),
  category: z.string().max(50).optional(),
  is_pinned: z.boolean().optional(),
}).passthrough();

// ── E-commerce : Panier (update ligne) ──────────────────────

// handleUpdateCartItem (ecommerce-cart.ts ~:271) : body { quantity }
// — quantity coercée côté handler (Math.max(0,Round(Number||0)),
// 0 = suppression). Donc totalement permissif (manquant accepté).
export const updateCartItemSchema = z.object({
  quantity: z.number().optional(),
}).passthrough();

// ── Templates (create / update — handlers legacy permissifs) ─

// handleCreateTemplate (templates.ts ~:29) : name + subject requis
// (vérifiés APRÈS sanitize côté handler). body_html optionnel
// (`bodyHtml || ''`), category/channel defaults côté handler. Le
// `createTemplateSchema` S2 historique exige body_html.min(1) — trop
// strict vs le handler réel → schéma S4 additif permissif dédié.
export const createTemplateSchemaS4 = z.object({
  name: z.string().min(1, { message: 'Nom et sujet requis' }).max(100),
  subject: z.string().min(1, { message: 'Nom et sujet requis' }).max(200),
  body_html: z.string().max(50000).optional(),
  category: z.string().max(20).optional(),
  channel: z.string().max(20).optional(),
  preheader: z.string().max(200).optional(),
  reply_to: z.string().max(200).optional(),
  folder_id: z.string().max(100).nullable().optional(),
}).passthrough();

// handleUpdateTemplate (templates.ts ~:68) : tous champs optionnels
// (≥1 effectif exigé côté handler).
export const updateTemplateSchemaS4 = z.object({
  name: z.string().max(100).optional(),
  subject: z.string().max(200).optional(),
  body_html: z.string().max(50000).optional(),
  category: z.string().max(20).optional(),
  channel: z.string().max(20).optional(),
  preheader: z.string().max(200).optional(),
  reply_to: z.string().max(200).optional(),
  folder_id: z.string().max(100).nullable().optional(),
}).passthrough();

// ── Appointments (create / update — handlers legacy permissifs) ─

// handleCreateAppointment (appointments.ts ~:34) : title + start_time
// + end_time requis (vérifiés APRÈS sanitize). type validé par
// allowlist côté handler (on ne contraint PAS l'enum → permissif).
// Le `createAppointmentSchema` S2 historique a end_time OPTIONNEL —
// incohérent avec le handler qui l'exige → schéma S4 additif dédié.
export const createAppointmentSchemaS4 = z.object({
  title: z.string().min(1, { message: 'Titre, heure de début et de fin requis' }).max(200),
  start_time: z.string().min(1, { message: 'Titre, heure de début et de fin requis' }).max(50),
  end_time: z.string().min(1, { message: 'Titre, heure de début et de fin requis' }).max(50),
  description: z.string().max(1000).optional(),
  location: z.string().max(300).optional(),
  type: z.string().max(20).optional(),
  client_id: z.string().max(100).optional(),
  lead_id: z.string().max(100).nullable().optional(),
  calendar_id: z.string().max(100).nullable().optional(),
  assignee_user_id: z.string().max(100).nullable().optional(),
  conference_link: z.string().max(300).nullable().optional(),
  recurring_rule: z.string().max(100).nullable().optional(),
  reminder_minutes: z.number().optional(),
  buffer_before_min: z.number().optional(),
  buffer_after_min: z.number().optional(),
  attendees: z.unknown().optional(),
}).passthrough();

// handleUpdateAppointment (appointments.ts ~:103) : tous champs
// optionnels (≥1 effectif exigé côté handler).
export const updateAppointmentSchemaS4 = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  start_time: z.string().max(50).optional(),
  end_time: z.string().max(50).optional(),
  location: z.string().max(300).optional(),
  type: z.string().max(20).optional(),
  status: z.string().max(20).optional(),
  notes: z.string().max(2000).optional(),
  calendar_id: z.string().max(100).nullable().optional(),
  assignee_user_id: z.string().max(100).nullable().optional(),
  conference_link: z.string().max(300).nullable().optional(),
  recurring_rule: z.string().max(100).nullable().optional(),
  attendees: z.unknown().optional(),
}).passthrough();

// ── Onboarding unifié CRM + e-commerce (S8) ─────────────────

// PUT /api/onboarding/state (src/worker/onboarding.ts handleGetOnboardingState
// / handlePutOnboardingState) : patch partiel non destructif. Tous champs
// optionnels (≥1 effectif accepté ; corps vide ⇒ no-op idempotent renvoyant
// l'état courant). `payload` libre (echo du WelcomePayload front, best-effort,
// stocké en payload_json) → permissif. `passthrough()` : tout champ inconnu
// est toléré (rétro-compat front qui peut enrichir le payload).
export const onboardingStateSchema = z.object({
  currentStep: z.number().int().min(0).max(50).optional(),
  completedSteps: z.array(z.string().max(60)).max(50).optional(),
  ecommerceOptedIn: z.boolean().optional(),
  payload: z.unknown().optional(),
}).passthrough();

// ── Helper pour parser et valider ───────────────────────────
// ⚠️ SIGNATURE FIGÉE (contrat S3) — NE PAS modifier. Retourne un
// `error` STRING (rétro-compat front : src/lib/api.ts lit data.error
// comme string, cf. validate-response.ts §JSDoc).

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
