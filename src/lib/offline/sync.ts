// ── Offline Sync — Synchronisation cache ↔ API ──────────────
// Sprint 11 — Capacitor V1

import { offlineDb, purgeExpiredCache, type CachedLead, type CachedConversation, type CachedTask } from './db';

// ── Sync leads depuis l'API vers le cache ───────────────────

export async function syncLeadsToCache(apiBase: string, token: string): Promise<void> {
  try {
    const res = await fetch(`${apiBase}/leads?limit=200`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;

    const data = await res.json() as { data: CachedLead[] };
    if (!data.data?.length) return;

    const now = Date.now();
    const leads = data.data.map(lead => ({ ...lead, cached_at: now }));

    await offlineDb.leads.bulkPut(leads);
  } catch {
    // Pas de réseau — on garde le cache existant
  }
}

// ── Sync conversations depuis l'API vers le cache ───────────

export async function syncConversationsToCache(apiBase: string, token: string): Promise<void> {
  try {
    const res = await fetch(`${apiBase}/conversations?limit=100`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;

    const data = await res.json() as { data: CachedConversation[] };
    if (!data.data?.length) return;

    const now = Date.now();
    const convos = data.data.map(c => ({ ...c, cached_at: now }));

    await offlineDb.conversations.bulkPut(convos);
  } catch {
    // Pas de réseau
  }
}

// ── Sync tasks depuis l'API vers le cache ───────────────────

export async function syncTasksToCache(apiBase: string, token: string): Promise<void> {
  try {
    const res = await fetch(`${apiBase}/tasks`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;

    const data = await res.json() as { data: CachedTask[] };
    if (!data.data?.length) return;

    const now = Date.now();
    const tasks = data.data.map(t => ({ ...t, cached_at: now }));

    await offlineDb.tasks.bulkPut(tasks);
  } catch {
    // Pas de réseau
  }
}

// ── Sync global au boot de l'app ────────────────────────────

export async function syncAllToCache(apiBase: string, token: string): Promise<void> {
  // Nettoyer les entrées expirées d'abord
  await purgeExpiredCache();

  // Sync en parallèle
  await Promise.allSettled([
    syncLeadsToCache(apiBase, token),
    syncConversationsToCache(apiBase, token),
    syncTasksToCache(apiBase, token),
  ]);
}

// ── Lire depuis le cache (offline) ──────────────────────────

export async function getCachedLeads(): Promise<CachedLead[]> {
  return offlineDb.leads.orderBy('cached_at').reverse().toArray();
}

export async function getCachedConversations(): Promise<CachedConversation[]> {
  return offlineDb.conversations.orderBy('cached_at').reverse().toArray();
}

export async function getCachedTasks(): Promise<CachedTask[]> {
  return offlineDb.tasks.toArray();
}

// ── Vérifier la connectivité ────────────────────────────────

export function isOnline(): boolean {
  return navigator.onLine;
}

export function onConnectivityChange(callback: (online: boolean) => void): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
