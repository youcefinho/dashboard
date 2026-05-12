// ── Offline DB — IndexedDB avec Dexie ───────────────────────
// Sprint 11 — Capacitor V1 — Cache lecture offline

import Dexie, { type EntityTable } from 'dexie';

// ── Types des entités cachées ───────────────────────────────

export interface CachedLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  source: string;
  score: number;
  assigned_to: string | null;
  client_id: string | null;
  created_at: string;
  updated_at: string;
  cached_at: number; // timestamp ms pour expiration
}

export interface CachedConversation {
  id: string;
  lead_id: string;
  lead_name: string;
  channel: string;
  status: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
  cached_at: number;
}

export interface CachedTask {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  lead_id: string | null;
  cached_at: number;
}

export interface OfflineMutation {
  id: string;
  method: string;    // POST, PATCH, DELETE
  path: string;      // /api/leads/xxx
  body: string;      // JSON stringifié
  created_at: number; // timestamp ms
  retries: number;
}

// ── Définition de la base ───────────────────────────────────

const db = new Dexie('intralys-offline') as Dexie & {
  leads: EntityTable<CachedLead, 'id'>;
  conversations: EntityTable<CachedConversation, 'id'>;
  tasks: EntityTable<CachedTask, 'id'>;
  mutations: EntityTable<OfflineMutation, 'id'>;
};

db.version(1).stores({
  leads: 'id, status, client_id, cached_at',
  conversations: 'id, lead_id, cached_at',
  tasks: 'id, status, lead_id, cached_at',
  mutations: 'id, created_at',
});

export { db as offlineDb };

// ── Helpers ─────────────────────────────────────────────────

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// Nettoyer les entrées expirées
export async function purgeExpiredCache(): Promise<void> {
  const cutoff = Date.now() - CACHE_TTL_MS;
  await db.leads.where('cached_at').below(cutoff).delete();
  await db.conversations.where('cached_at').below(cutoff).delete();
  await db.tasks.where('cached_at').below(cutoff).delete();
}

// Compter les mutations en attente
export async function getPendingMutationCount(): Promise<number> {
  return db.mutations.count();
}
