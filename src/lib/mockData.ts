// ── Mock Data — Données de démo pour le dev local ───────────
// Activé automatiquement quand le backend (Cloudflare Worker/D1) n'est pas joignable.
// Permet de rendre le dashboard vivant et testable sans wrangler dev.

import type { Client, Lead, DashboardStats } from './types';

// ── Helpers ──────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

// ── Clients courtiers fictifs (réaliste Québec) ─────────────

export const MOCK_CLIENTS: Client[] = [
  {
    id: 'c-mathis', name: 'Mathis Guimont', email: 'mathis@gatineaupremier.ca',
    phone: '819-555-0101', site_url: 'https://gatineaupremier.ca', city: 'Gatineau',
    banner: 'Royal LePage', is_active: 1, created_at: daysAgo(180), updated_at: daysAgo(2),
  },
  {
    id: 'c-sarah', name: 'Sarah Tremblay', email: 'sarah@tremblayimmo.ca',
    phone: '418-555-0202', site_url: 'https://tremblayimmo.ca', city: 'Québec',
    banner: 'RE/MAX', is_active: 1, created_at: daysAgo(120), updated_at: daysAgo(1),
  },
  {
    id: 'c-marc', name: 'Marc-Antoine Roy', email: 'marc@royimmo.ca',
    phone: '514-555-0303', site_url: 'https://royimmo.ca', city: 'Montréal',
    banner: 'Sutton', is_active: 1, created_at: daysAgo(90), updated_at: daysAgo(5),
  },
  {
    id: 'c-julie', name: 'Julie Bergeron', email: 'julie@bergeroncourtier.ca',
    phone: '450-555-0404', site_url: 'https://bergeroncourtier.ca', city: 'Laval',
    banner: 'Royal LePage', is_active: 1, created_at: daysAgo(60), updated_at: daysAgo(3),
  },
];

// ── Leads fictifs diversifiés ───────────────────────────────

const FIRST_NAMES = ['Alexandre', 'Camille', 'David', 'Émilie', 'François', 'Gabrielle', 'Hugo', 'Isabelle', 'Jean-Philippe', 'Katherine', 'Louis', 'Marie-Ève', 'Nicolas', 'Olivia', 'Philippe', 'Rachel', 'Sébastien', 'Tanya', 'Vincent', 'Zoé'];
const LAST_NAMES = ['Bouchard', 'Côté', 'Gagnon', 'Lavoie', 'Morin', 'Pelletier', 'Richard', 'Simard', 'Thériault', 'Villeneuve'];
const SOURCES = ['website', 'facebook', 'google', 'referral', 'phone'] as const;
const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;
const TYPES = ['inbound', 'qualified', 'customer'] as const;

function makeLead(index: number): Lead {
  const firstName = FIRST_NAMES[index % FIRST_NAMES.length]!;
  const lastName = LAST_NAMES[index % LAST_NAMES.length]!;
  const name = `${firstName} ${lastName}`;
  const status = STATUSES[index % STATUSES.length]!;
  const source = SOURCES[index % SOURCES.length]!;
  const client = MOCK_CLIENTS[index % MOCK_CLIENTS.length]!;
  const daysOld = Math.floor(Math.random() * 60) + 1;
  const score = status === 'won' ? 90 + Math.floor(Math.random() * 10) :
                status === 'qualified' ? 60 + Math.floor(Math.random() * 25) :
                status === 'contacted' ? 35 + Math.floor(Math.random() * 20) :
                status === 'lost' ? 10 + Math.floor(Math.random() * 15) :
                20 + Math.floor(Math.random() * 30);
  const dealValue = status === 'won' ? 15000 + Math.floor(Math.random() * 35000) :
                    status === 'qualified' ? 10000 + Math.floor(Math.random() * 25000) :
                    Math.floor(Math.random() * 15000);

  return {
    id: uuid(),
    client_id: client.id,
    external_id: '',
    name,
    email: `${firstName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.${lastName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}@email.com`,
    phone: `514-${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    message: '',
    type: TYPES[index % TYPES.length]!,
    status,
    budget: `${Math.floor(Math.random() * 500 + 200)}k`,
    timeline: ['1-3 mois', '3-6 mois', '6-12 mois'][index % 3]!,
    address: '',
    property_type: ['Condo', 'Maison', 'Duplex', 'Terrain'][index % 4]!,
    source,
    notes: '',
    deal_value: dealValue,
    utm_source: source === 'facebook' ? 'fb_ads' : source === 'google' ? 'google_ads' : '',
    utm_medium: source === 'facebook' || source === 'google' ? 'cpc' : '',
    utm_campaign: '',
    assigned_to: 'admin',
    score,
    created_at: daysAgo(daysOld),
    updated_at: daysAgo(Math.max(0, daysOld - Math.floor(Math.random() * 5))),
    dnd: 0,
    dnd_settings: '{}',
    date_of_birth: '',
    country: 'CA',
    timezone: 'America/Toronto',
    additional_emails: '[]',
    additional_phones: '[]',
    city: client.city,
    postal_code: '',
    company: '',
    lifecycle_stage: status === 'won' ? 'customer' : status === 'qualified' ? 'sql' : status === 'contacted' ? 'mql' : 'lead',
    favorite: index < 3 ? 1 : 0,
    last_activity_at: daysAgo(Math.floor(Math.random() * 7)),
    social_linkedin: '',
    social_facebook: '',
    social_instagram: '',
    avatar_url: '',
    migrated_from: '',
    pipeline_id: '',
    stage_id: '',
    client_name: client.name,
    tags: index % 3 === 0 ? ['premier-achat'] : index % 3 === 1 ? ['investisseur', 'vip'] : ['vendeur'],
  };
}

export const MOCK_LEADS: Lead[] = Array.from({ length: 24 }, (_, i) => makeLead(i));

// ── Dashboard Stats agrégées ────────────────────────────────

function buildDashboardStats(): DashboardStats {
  const leads = MOCK_LEADS;
  const totalLeads = leads.length;
  const newLeads7d = leads.filter(l => new Date(l.created_at).getTime() > Date.now() - 7 * 86400000).length;
  const pendingLeads = leads.filter(l => l.status === 'new' || l.status === 'contacted').length;
  const wonLeads = leads.filter(l => l.status === 'won');
  const conversionRate = Math.round((wonLeads.length / totalLeads) * 100);
  const totalDealValue = leads.reduce((s, l) => s + l.deal_value, 0);
  const revenueValue = wonLeads.reduce((s, l) => s + l.deal_value, 0);

  // Leads par client
  const byClient = MOCK_CLIENTS.map(c => ({
    client_name: c.name,
    count: leads.filter(l => l.client_id === c.id).length,
  }));

  // Leads par statut
  const byStatus = (['new', 'contacted', 'qualified', 'won', 'lost'] as const).map(s => ({
    status: s,
    count: leads.filter(l => l.status === s).length,
  }));

  // Leads par jour (30 derniers jours) — données simulées
  const byDay: Array<{ date: string; count: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    // Courbe réaliste : base 0-2, avec pics certains jours
    const base = Math.floor(Math.random() * 3);
    const spike = (i % 7 === 2 || i % 7 === 5) ? Math.floor(Math.random() * 3) : 0;
    byDay.push({ date: dateStr, count: base + spike });
  }

  // Leads par source
  const bySource = [
    { source: 'website', count: 9, value: 45000 },
    { source: 'facebook', count: 6, value: 32000 },
    { source: 'google', count: 4, value: 28000 },
    { source: 'referral', count: 3, value: 22000 },
    { source: 'phone', count: 2, value: 12000 },
  ];

  // Conversion par statut
  const conversionByStatus = byStatus.map(s => ({
    status: s.status,
    count: s.count,
    pct: Math.round((s.count / totalLeads) * 100),
  }));

  // Activité récente
  const activityFeed = leads.slice(0, 8).map((lead, i) => ({
    id: i + 1,
    lead_id: lead.id,
    client_id: lead.client_id,
    user_id: 'admin',
    action: (['created', 'status_change', 'email_sent', 'note_added', 'tag_added', 'assigned', 'deal_value_changed', 'sms_sent'] as const)[i % 8]!,
    details: JSON.stringify({ name: lead.name, email: lead.email }),
    created_at: daysAgo(i),
    user_name: i % 2 === 0 ? 'Rochdi Dahmani' : 'Système',
    lead_name: lead.name,
  }));

  return {
    total_leads: totalLeads,
    new_leads_7d: newLeads7d,
    pending_leads: pendingLeads,
    conversion_rate: conversionRate,
    total_deal_value: totalDealValue,
    revenue_value: revenueValue,
    avg_conversion_days: 12,
    leads_by_client: byClient,
    leads_by_status: byStatus,
    leads_by_day: byDay,
    leads_by_source: bySource,
    conversion_by_status: conversionByStatus,
    activity_feed: activityFeed,
  };
}

export const MOCK_DASHBOARD_STATS: DashboardStats = buildDashboardStats();
