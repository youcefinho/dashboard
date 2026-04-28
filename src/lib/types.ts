// ── Types partagés Intralys CRM ─────────────────────────────

// Statuts possibles du pipeline
export const LEAD_STATUSES = ['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

export const LEAD_TYPES = ['buy', 'sell'] as const;
export type LeadType = typeof LEAD_TYPES[number];

export const USER_ROLES = ['admin', 'broker'] as const;
export type UserRole = typeof USER_ROLES[number];

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
  created_at: string;
  updated_at: string;
  // Jointure optionnelle
  client_name?: string;
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

// ── API Responses ───────────────────────────────────────────

export interface DashboardStats {
  total_leads: number;
  new_leads_7d: number;
  pending_leads: number;
  conversion_rate: number;
  leads_by_client: Array<{ client_name: string; count: number }>;
  leads_by_status: Array<{ status: LeadStatus; count: number }>;
  leads_by_day: Array<{ date: string; count: number }>;
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
