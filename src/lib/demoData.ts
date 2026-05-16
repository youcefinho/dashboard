// ── demoData — Sprint 45 M1.2 (2026-05-15) ───────────────────────────────────
// Seed data offerte à l'onboarding pour aider les nouveaux utilisateurs à
// explorer Intralys sans avoir à créer leur propre base. Toutes les entités
// sont préfixées `demo-` dans leur id pour permettre un cleanup propre
// (cf. `clearDemoData()`).
//
// Fonctions exportées :
//   buildDemoLeads()         — 20 leads variés (noms FR-QC, scores, sources, tags)
//   buildDemoTasks()         — 10 tasks (échéances variées, priorités)
//   buildDemoConversations() — 5 conversations (FR-QC pro CRM)
//   buildDemoPipelines()     — 3 pipelines avec stages
//   importDemoData()         — pousse via /api/* en background + retourne summary
//   clearDemoData()          — supprime les entités demo via /api/* + flag local
//   isDemoDataLoaded()       — lit `localStorage.demo_data`

import type { Lead, LeadStatus, LifecycleStage } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

function demoId(prefix: string, i: number): string {
  return `demo-${prefix}-${String(i).padStart(3, '0')}`;
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Leads démo (20 leads FR-QC variés) ───────────────────────────────────────

const DEMO_FIRST_NAMES = [
  'Émile', 'Sophie', 'Maxime', 'Laurence', 'Antoine', 'Charlotte', 'Vincent',
  'Camille', 'Olivier', 'Béatrice', 'Hugo', 'Léa', 'Samuel', 'Audrey',
  'Étienne', 'Mathilde', 'Jérémie', 'Anaïs', 'Félix', 'Rosalie',
];
const DEMO_LAST_NAMES = [
  'Tremblay', 'Gagnon', 'Roy', 'Côté', 'Bouchard', 'Gauthier', 'Morin',
  'Lavoie', 'Bélanger', 'Pelletier', 'Lévesque', 'Bergeron', 'Leblanc',
  'Dubé', 'Beaulieu', 'Fortin', 'Caron', 'Cloutier', 'Dion', 'Rousseau',
];
const DEMO_CITIES = ['Montréal', 'Québec', 'Gatineau', 'Laval', 'Longueuil', 'Sherbrooke', 'Trois-Rivières'];
const DEMO_SOURCES = ['website', 'facebook', 'google', 'referral', 'phone'] as const;
const DEMO_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'won', 'lost'];
const DEMO_TAG_POOLS = [
  ['premier-achat', 'condo'],
  ['investisseur', 'vip'],
  ['vendeur', 'rapide'],
  ['acheteur', 'famille'],
  ['second-rdv'],
  ['à-rappeler'],
  ['budget-élevé'],
  ['urgent'],
];

export function buildDemoLeads(clientId = 'demo-client-001'): Lead[] {
  return Array.from({ length: 20 }, (_, i) => {
    const first = DEMO_FIRST_NAMES[i % DEMO_FIRST_NAMES.length]!;
    const last = DEMO_LAST_NAMES[i % DEMO_LAST_NAMES.length]!;
    const name = `${first} ${last}`;
    const status = DEMO_STATUSES[i % DEMO_STATUSES.length]!;
    const source = DEMO_SOURCES[i % DEMO_SOURCES.length]!;
    const score =
      status === 'won' ? 88 + (i % 12) :
      status === 'qualified' ? 62 + (i % 25) :
      status === 'contacted' ? 38 + (i % 22) :
      status === 'lost' ? 12 + (i % 15) :
      22 + (i % 28);
    const dealValue =
      status === 'won' ? 18000 + i * 1200 :
      status === 'qualified' ? 12000 + i * 800 :
      4000 + i * 400;
    const lifecycle: LifecycleStage =
      status === 'won' ? 'customer' :
      status === 'qualified' ? 'sql' :
      status === 'contacted' ? 'mql' :
      status === 'lost' ? 'lost' :
      'lead';

    return {
      id: demoId('lead', i + 1),
      client_id: clientId,
      external_id: '',
      name,
      email: `${stripDiacritics(first.toLowerCase())}.${stripDiacritics(last.toLowerCase())}@demo-intralys.ca`,
      phone: `514-${String(200 + i).padStart(3, '0')}-${String(1000 + i * 37).slice(-4)}`,
      message: '',
      type: (i % 3 === 0 ? 'inbound' : i % 3 === 1 ? 'qualified' : 'customer') as Lead['type'],
      status,
      budget: `${(200 + (i % 8) * 50)}k`,
      timeline: ['1-3 mois', '3-6 mois', '6-12 mois'][i % 3]!,
      address: '',
      property_type: ['Condo', 'Maison', 'Duplex', 'Terrain'][i % 4]!,
      source,
      notes: '',
      deal_value: dealValue,
      utm_source: source === 'facebook' ? 'fb_ads' : source === 'google' ? 'google_ads' : '',
      utm_medium: source === 'facebook' || source === 'google' ? 'cpc' : '',
      utm_campaign: '',
      assigned_to: 'admin',
      score,
      created_at: daysAgo((i % 30) + 1),
      updated_at: daysAgo(i % 7),
      dnd: 0,
      dnd_settings: '{}',
      date_of_birth: '',
      country: 'CA',
      timezone: 'America/Toronto',
      additional_emails: '[]',
      additional_phones: '[]',
      city: DEMO_CITIES[i % DEMO_CITIES.length]!,
      postal_code: '',
      company: '',
      lifecycle_stage: lifecycle,
      favorite: i < 3 ? 1 : 0,
      last_activity_at: daysAgo(i % 5),
      social_linkedin: '',
      social_facebook: '',
      social_instagram: '',
      avatar_url: '',
      migrated_from: 'demo',
      pipeline_id: '',
      stage_id: '',
      client_name: 'Démo Intralys',
      tags: DEMO_TAG_POOLS[i % DEMO_TAG_POOLS.length]!.slice(),
    };
  });
}

// ── Tasks démo (10 tasks) ────────────────────────────────────────────────────

export interface DemoTask {
  id: string;
  title: string;
  description: string;
  due_at: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done';
  lead_id?: string;
  assigned_to: string;
}

export function buildDemoTasks(): DemoTask[] {
  const titles = [
    'Rappeler Émile Tremblay pour confirmer la visite',
    'Envoyer la documentation OACIQ à Sophie Gagnon',
    'Préparer la promesse d\'achat — duplex Verdun',
    'Suivi post-visite condo Plateau-Mont-Royal',
    'Réviser le scoring du lead Maxime Roy',
    'Confirmer rendez-vous notaire pour Laurence Côté',
    'Relancer Antoine Bouchard (3e relance)',
    'Estimation marchande — maison Ahuntsic',
    'Préparer photos pro pour mise en marché',
    'Réunion équipe — pipeline hebdomadaire',
  ];
  const priorities: DemoTask['priority'][] = ['high', 'high', 'medium', 'medium', 'low', 'high', 'medium', 'low', 'medium', 'high'];
  const statuses: DemoTask['status'][] = ['todo', 'todo', 'in_progress', 'todo', 'done', 'todo', 'in_progress', 'todo', 'todo', 'todo'];
  const dueDeltas = [0, 1, 2, 3, -1, 5, 7, 14, 0, 2];

  return titles.map((title, i) => ({
    id: demoId('task', i + 1),
    title,
    description: '',
    due_at: daysFromNow(dueDeltas[i] ?? 0),
    priority: priorities[i] ?? 'medium',
    status: statuses[i] ?? 'todo',
    lead_id: demoId('lead', (i % 20) + 1),
    assigned_to: 'admin',
  }));
}

// ── Conversations démo (5 conversations FR-QC) ───────────────────────────────

export interface DemoConversation {
  id: string;
  lead_id: string;
  channel: 'sms' | 'email' | 'whatsapp' | 'webchat';
  preview: string;
  messages: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    body: string;
    sent_at: string;
  }>;
  unread: number;
}

export function buildDemoConversations(): DemoConversation[] {
  return [
    {
      id: demoId('conv', 1),
      lead_id: demoId('lead', 1),
      channel: 'sms',
      preview: 'Allô! Pour la visite de samedi, ça fonctionne 14h?',
      unread: 1,
      messages: [
        { id: demoId('msg', 1), direction: 'inbound', body: 'Allô! J\'aimerais visiter le condo du Plateau ce weekend.', sent_at: daysAgo(2) },
        { id: demoId('msg', 2), direction: 'outbound', body: 'Bonjour Émile! Bien sûr — samedi ou dimanche?', sent_at: daysAgo(2) },
        { id: demoId('msg', 3), direction: 'inbound', body: 'Samedi serait parfait. 14h ça fonctionne?', sent_at: daysAgo(1) },
      ],
    },
    {
      id: demoId('conv', 2),
      lead_id: demoId('lead', 2),
      channel: 'email',
      preview: 'Merci pour les documents OACIQ — quelques questions',
      unread: 0,
      messages: [
        { id: demoId('msg', 4), direction: 'outbound', body: 'Bonjour Sophie, voici les documents OACIQ promis. N\'hésite pas si tu as des questions.', sent_at: daysAgo(3) },
        { id: demoId('msg', 5), direction: 'inbound', body: 'Merci beaucoup! J\'aurais quelques questions sur la clause de financement.', sent_at: daysAgo(2) },
      ],
    },
    {
      id: demoId('conv', 3),
      lead_id: demoId('lead', 3),
      channel: 'sms',
      preview: 'Parfait, je suis dispo demain pour signer',
      unread: 2,
      messages: [
        { id: demoId('msg', 6), direction: 'outbound', body: 'Maxime, le vendeur a accepté ta promesse d\'achat 🎉', sent_at: daysAgo(1) },
        { id: demoId('msg', 7), direction: 'inbound', body: 'Wow merci! C\'est une excellente nouvelle.', sent_at: daysAgo(1) },
        { id: demoId('msg', 8), direction: 'inbound', body: 'Parfait, je suis dispo demain pour signer.', sent_at: daysAgo(0) },
      ],
    },
    {
      id: demoId('conv', 4),
      lead_id: demoId('lead', 4),
      channel: 'whatsapp',
      preview: 'J\'aimerais revoir la maison une dernière fois',
      unread: 0,
      messages: [
        { id: demoId('msg', 9), direction: 'inbound', body: 'Salut Laurence ici. J\'aimerais revoir la maison une dernière fois avant de décider.', sent_at: daysAgo(4) },
        { id: demoId('msg', 10), direction: 'outbound', body: 'Pas de problème Laurence! Quel moment t\'arrangerait?', sent_at: daysAgo(4) },
      ],
    },
    {
      id: demoId('conv', 5),
      lead_id: demoId('lead', 5),
      channel: 'webchat',
      preview: 'Question sur les frais de notaire',
      unread: 1,
      messages: [
        { id: demoId('msg', 11), direction: 'inbound', body: 'Bonjour, j\'ai une question rapide sur les frais de notaire au QC.', sent_at: daysAgo(0) },
      ],
    },
  ];
}

// ── Pipelines démo (3 pipelines avec stages) ─────────────────────────────────

export interface DemoPipeline {
  id: string;
  name: string;
  description: string;
  stages: Array<{ id: string; name: string; color: string; order: number }>;
}

export function buildDemoPipelines(): DemoPipeline[] {
  return [
    {
      id: demoId('pipeline', 1),
      name: 'Pipeline Achat',
      description: 'Acheteurs — du premier contact à la signature notariée',
      stages: [
        { id: demoId('stage', 1), name: 'Premier contact', color: '#94A3B8', order: 0 },
        { id: demoId('stage', 2), name: 'Qualification', color: '#0EA5E9', order: 1 },
        { id: demoId('stage', 3), name: 'Visite planifiée', color: '#8B5CF6', order: 2 },
        { id: demoId('stage', 4), name: 'Promesse d\'achat', color: '#D97706', order: 3 },
        { id: demoId('stage', 5), name: 'Acceptée', color: '#15803D', order: 4 },
      ],
    },
    {
      id: demoId('pipeline', 2),
      name: 'Pipeline Vente',
      description: 'Vendeurs — de l\'estimation à la mise en marché',
      stages: [
        { id: demoId('stage', 6), name: 'Estimation demandée', color: '#94A3B8', order: 0 },
        { id: demoId('stage', 7), name: 'Évaluation maison', color: '#0EA5E9', order: 1 },
        { id: demoId('stage', 8), name: 'Contrat signé', color: '#8B5CF6', order: 2 },
        { id: demoId('stage', 9), name: 'Mise en marché', color: '#D97706', order: 3 },
        { id: demoId('stage', 10), name: 'Vendue', color: '#15803D', order: 4 },
      ],
    },
    {
      id: demoId('pipeline', 3),
      name: 'Pipeline Investisseurs',
      description: 'Acquisitions plex / locatif',
      stages: [
        { id: demoId('stage', 11), name: 'Brief reçu', color: '#94A3B8', order: 0 },
        { id: demoId('stage', 12), name: 'Recherche en cours', color: '#0EA5E9', order: 1 },
        { id: demoId('stage', 13), name: 'Analyse rendement', color: '#8B5CF6', order: 2 },
        { id: demoId('stage', 14), name: 'Offre déposée', color: '#D97706', order: 3 },
        { id: demoId('stage', 15), name: 'Acquise', color: '#15803D', order: 4 },
      ],
    },
  ];
}

// ── Import / Cleanup ─────────────────────────────────────────────────────────

const DEMO_DATA_FLAG_KEY = 'demo_data';

export function isDemoDataLoaded(): boolean {
  try {
    return localStorage.getItem(DEMO_DATA_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export interface DemoImportSummary {
  leads: number;
  tasks: number;
  conversations: number;
  pipelines: number;
}

/**
 * Pousse les entités démo via /api/* en background.
 * Si le backend n'est pas joignable (offline / dev) on stocke quand même les
 * flags pour que l'UI reflète l'état "données démo chargées".
 *
 * Best-effort : ignore les erreurs réseau individuelles (chaque POST est try/catch).
 */
export async function importDemoData(): Promise<DemoImportSummary> {
  const leads = buildDemoLeads();
  const tasks = buildDemoTasks();
  const conversations = buildDemoConversations();
  const pipelines = buildDemoPipelines();

  const token = (() => {
    try { return localStorage.getItem('intralys_token'); } catch { return null; }
  })();

  if (token) {
    // Best-effort : un endpoint groupé si dispo, sinon silent fallback.
    try {
      await fetch('/api/admin/demo-seed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leads, tasks, conversations, pipelines }),
      });
    } catch {
      /* silent — fallback localStorage seul */
    }
  }

  // Persist locally (fallback dev + reload-safe)
  try {
    localStorage.setItem(DEMO_DATA_FLAG_KEY, '1');
    localStorage.setItem('demo_data_summary', JSON.stringify({
      leads: leads.length,
      tasks: tasks.length,
      conversations: conversations.length,
      pipelines: pipelines.length,
      imported_at: new Date().toISOString(),
    }));
  } catch { /* ignore */ }

  return {
    leads: leads.length,
    tasks: tasks.length,
    conversations: conversations.length,
    pipelines: pipelines.length,
  };
}

/**
 * Supprime les entités démo via /api/admin/demo-reset (endpoint existant)
 * + retire le flag local. Best-effort : ignore les erreurs réseau.
 */
export async function clearDemoData(): Promise<void> {
  const token = (() => {
    try { return localStorage.getItem('intralys_token'); } catch { return null; }
  })();

  if (token) {
    try {
      await fetch('/api/admin/demo-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ scope: 'demo' }),
      });
    } catch {
      /* silent */
    }
  }

  try {
    localStorage.removeItem(DEMO_DATA_FLAG_KEY);
    localStorage.removeItem('demo_data_summary');
  } catch { /* ignore */ }
}
