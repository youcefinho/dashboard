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

// ── Sprint 44 M2.2 — Méta cache (clés=valeurs sync timestamps, etc.) ────────
export interface CachedMeta {
  key: string;
  value: string;
  updated_at: number;
}

// ── Sprint 44 M2.3 — Outbox messages Inbox offline ──────────────────────────
export type OutboxMessageStatus = 'queued' | 'sending' | 'failed';

export interface OutboxMessage {
  id: string;
  conversationId: string;
  channel: string;       // sms, email, webchat, etc.
  body: string;
  created_at: number;    // timestamp ms
  status: OutboxMessageStatus;
  retries: number;       // 0..3
  last_error?: string;   // message d'erreur dernier essai
  tmp_message_id?: string; // id optimistic message dans thread UI
}

// ── Définition de la base ───────────────────────────────────

const db = new Dexie('intralys-offline') as Dexie & {
  leads: EntityTable<CachedLead, 'id'>;
  conversations: EntityTable<CachedConversation, 'id'>;
  tasks: EntityTable<CachedTask, 'id'>;
  mutations: EntityTable<OfflineMutation, 'id'>;
  // Sprint 44 M2.2/M2.3
  cached_meta: EntityTable<CachedMeta, 'key'>;
  outbox: EntityTable<OutboxMessage, 'id'>;
};

// Version 1 préservée pour compat (existing users)
db.version(1).stores({
  leads: 'id, status, client_id, cached_at',
  conversations: 'id, lead_id, cached_at',
  tasks: 'id, status, lead_id, cached_at',
  mutations: 'id, created_at',
});

// Sprint 44 M2.2/M2.3 — Version 2 : ajout cached_meta + outbox.
// Dexie applique le diff automatiquement (upgrade non-destructif).
db.version(2).stores({
  leads: 'id, status, client_id, cached_at',
  conversations: 'id, lead_id, cached_at',
  tasks: 'id, status, lead_id, cached_at',
  mutations: 'id, created_at',
  cached_meta: '&key, updated_at',
  outbox: 'id, conversationId, status, created_at',
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

// ── Sprint 44 M2.2 — Helpers cached_meta (clés génériques) ──────────────────

export async function getMeta(key: string): Promise<string | null> {
  try {
    const row = await db.cached_meta.get(key);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setMeta(key: string, value: string): Promise<void> {
  try {
    await db.cached_meta.put({ key, value, updated_at: Date.now() });
  } catch {
    /* ignore — pas critique */
  }
}

export async function getLastSyncAt(domain: 'leads' | 'conversations' | 'tasks'): Promise<number | null> {
  const raw = await getMeta(`last_sync_at:${domain}`);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

export async function setLastSyncAt(domain: 'leads' | 'conversations' | 'tasks', ts: number): Promise<void> {
  await setMeta(`last_sync_at:${domain}`, String(ts));
}

// ── Sprint 44 M2.3 — Helpers outbox ─────────────────────────────────────────

export async function getOutboxCount(conversationId?: string): Promise<number> {
  if (conversationId) {
    return db.outbox.where('conversationId').equals(conversationId).count();
  }
  return db.outbox.count();
}

export async function getOutboxForConversation(conversationId: string): Promise<OutboxMessage[]> {
  return db.outbox
    .where('conversationId')
    .equals(conversationId)
    .toArray();
}

export async function getAllOutbox(): Promise<OutboxMessage[]> {
  return db.outbox.orderBy('created_at').toArray();
}
