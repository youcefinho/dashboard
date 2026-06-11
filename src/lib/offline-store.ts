// ── offline-store.ts — Sprint 97 (seq192) ───────────────────────────────────
// Store offline IndexedDB via Dexie.js pour le mode mobile hors-ligne.
//
// Stratégie : Cache-first avec sync queue.
//   1. Les données critiques (leads, tâches, messages) sont stockées en IDB.
//   2. Les mutations hors-ligne sont mises en queue (sync queue).
//   3. Au retour de la connexion, la queue est rejouée automatiquement.
//
// ZÉRO migration SQL. Utilise IndexedDB côté client uniquement.
// Dépendance : dexie (déjà dans vendor-dexie chunk).

import Dexie, { type Table } from 'dexie';

// ── Schéma IndexedDB ─────────────────────────────────────────────────────────

/** Lead minimal pour affichage offline. */
export interface OfflineLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  stage_id: string;
  score: number;
  updated_at: string;
  /** Timestamp de la dernière sync serveur. */
  _synced_at: number;
}

/** Tâche offline. */
export interface OfflineTask {
  id: string;
  title: string;
  due_date: string;
  priority: string;
  status: string;
  lead_id: string | null;
  _synced_at: number;
}

/** Message offline (derniers par lead). */
export interface OfflineMessage {
  id: string;
  lead_id: string;
  body: string;
  direction: 'in' | 'out';
  channel: string;
  created_at: string;
  _synced_at: number;
}

/** Entrée de la sync queue (mutations hors-ligne à rejouer). */
export interface SyncQueueEntry {
  /** Auto-incrémenté par Dexie. */
  _qid?: number;
  /** Méthode HTTP (POST, PATCH, DELETE). */
  method: string;
  /** Path API sans le host (ex: /api/leads/abc123). */
  path: string;
  /** Body JSON sérialisé (null pour DELETE). */
  body: string | null;
  /** Timestamp de création de l'entrée. */
  created_at: number;
  /** Nombre de tentatives de rejeu. */
  retries: number;
  /** Dernière erreur (null si jamais tenté). */
  last_error: string | null;
}

// ── Instance Dexie ───────────────────────────────────────────────────────────

class IntralysOfflineDB extends Dexie {
  leads!: Table<OfflineLead, string>;
  tasks!: Table<OfflineTask, string>;
  messages!: Table<OfflineMessage, string>;
  syncQueue!: Table<SyncQueueEntry, number>;

  constructor() {
    super('intralys-offline');

    this.version(1).stores({
      leads: 'id, status, stage_id, updated_at, _synced_at',
      tasks: 'id, status, due_date, lead_id, _synced_at',
      messages: 'id, lead_id, created_at, _synced_at',
      syncQueue: '++_qid, created_at',
    });
  }
}

/** Instance singleton du store offline. */
export const offlineDb = new IntralysOfflineDB();

// ── Helpers de cache ─────────────────────────────────────────────────────────

/** Durée de validité du cache local (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Vérifie si les données locales sont encore fraîches. */
export function isCacheFresh(syncedAt: number): boolean {
  return Date.now() - syncedAt < CACHE_TTL_MS;
}

/** Sauvegarde une liste de leads en local (upsert batch). */
export async function cacheLeads(leads: OfflineLead[]): Promise<void> {
  const now = Date.now();
  const withSync = leads.map((l) => ({ ...l, _synced_at: now }));
  await offlineDb.leads.bulkPut(withSync);
}

/** Récupère les leads depuis le cache local. */
export async function getCachedLeads(): Promise<OfflineLead[]> {
  return offlineDb.leads.orderBy('updated_at').reverse().limit(200).toArray();
}

/** Sauvegarde une liste de tâches en local. */
export async function cacheTasks(tasks: OfflineTask[]): Promise<void> {
  const now = Date.now();
  const withSync = tasks.map((t) => ({ ...t, _synced_at: now }));
  await offlineDb.tasks.bulkPut(withSync);
}

/** Récupère les tâches depuis le cache local. */
export async function getCachedTasks(): Promise<OfflineTask[]> {
  return offlineDb.tasks.orderBy('due_date').limit(100).toArray();
}

// ── Sync Queue ───────────────────────────────────────────────────────────────

/** Ajoute une mutation à la sync queue (pour rejeu au retour online). */
export async function enqueueSync(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<void> {
  await offlineDb.syncQueue.add({
    method,
    path,
    body: body ? JSON.stringify(body) : null,
    created_at: Date.now(),
    retries: 0,
    last_error: null,
  });
}

/** Retourne le nombre d'entrées en attente dans la sync queue. */
export async function getSyncQueueCount(): Promise<number> {
  return offlineDb.syncQueue.count();
}

/** Récupère toutes les entrées de la sync queue (FIFO). */
export async function getSyncQueue(): Promise<SyncQueueEntry[]> {
  return offlineDb.syncQueue.orderBy('created_at').toArray();
}

/** Supprime une entrée de la sync queue (après rejeu réussi). */
export async function dequeueSyncEntry(qid: number): Promise<void> {
  await offlineDb.syncQueue.delete(qid);
}

/** Met à jour le compteur de retries et l'erreur d'une entrée. */
export async function markSyncRetry(qid: number, error: string): Promise<void> {
  await offlineDb.syncQueue.update(qid, {
    retries: (await offlineDb.syncQueue.get(qid))?.retries ?? 0 + 1,
    last_error: error,
  });
}

/** Vide la sync queue (reset complet). */
export async function clearSyncQueue(): Promise<void> {
  await offlineDb.syncQueue.clear();
}

// ── Rejeu automatique ────────────────────────────────────────────────────────

/** Nombre max de tentatives par entrée. */
const MAX_RETRIES = 5;

/**
 * Rejoue toutes les mutations en queue (FIFO).
 * Appelé automatiquement au retour online (via useNetworkStatus).
 *
 * Retourne le nombre d'entrées rejouées avec succès.
 */
export async function replayOfflineQueue(
  apiFetch: (path: string, init?: RequestInit) => Promise<unknown>,
): Promise<{ replayed: number; failed: number }> {
  const entries = await getSyncQueue();
  let replayed = 0;
  let failed = 0;

  for (const entry of entries) {
    if (entry.retries >= MAX_RETRIES) {
      // Trop de tentatives — on skip mais on ne supprime pas
      failed++;
      continue;
    }

    try {
      const init: RequestInit = {
        method: entry.method,
      };
      if (entry.body) {
        init.body = entry.body;
        init.headers = { 'Content-Type': 'application/json' };
      }

      await apiFetch(entry.path, init);
      // Succès — supprimer de la queue
      if (entry._qid !== undefined) {
        await dequeueSyncEntry(entry._qid);
      }
      replayed++;
    } catch (err) {
      // Échec — incrémenter le retry
      if (entry._qid !== undefined) {
        await markSyncRetry(entry._qid, String(err));
      }
      failed++;
    }
  }

  return { replayed, failed };
}

// ── Hook React ───────────────────────────────────────────────────────────────

/**
 * Hook pour vérifier si l'app est en mode offline.
 * Utilise navigator.onLine + écouteurs d'événements.
 *
 * Usage : const isOffline = useOfflineStatus();
 */
export function getOfflineStatus(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !navigator.onLine;
}

// ── Nettoyage ────────────────────────────────────────────────────────────────

/** Purge les données locales trop anciennes (> 7 jours). */
export async function pruneStaleData(): Promise<void> {
  const staleThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  await offlineDb.leads.where('_synced_at').below(staleThreshold).delete();
  await offlineDb.tasks.where('_synced_at').below(staleThreshold).delete();
  await offlineDb.messages.where('_synced_at').below(staleThreshold).delete();
}
