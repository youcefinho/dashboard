// ── Offline Sync — Synchronisation cache ↔ API ──────────────
// Sprint 11 — Capacitor V1

import {
  offlineDb,
  purgeExpiredCache,
  getLastSyncAt,
  setLastSyncAt,
  type CachedLead,
  type CachedConversation,
  type CachedTask,
} from './db';

// ── Sync leads depuis l'API vers le cache ───────────────────
// Sprint 44 M2.2 : si `last_sync_at:leads` existe, on tente un delta via
// `?updated_after=ISO`. Le worker peut ne pas (encore) supporter ce param ;
// dans ce cas, fallback automatique = full refresh (API renvoie tout).
// On persiste la nouvelle valeur post-sync.

export async function syncLeadsToCache(apiBase: string, token: string): Promise<void> {
  try {
    const lastSync = await getLastSyncAt('leads');
    const params = new URLSearchParams({ limit: '200' });
    if (lastSync) {
      params.set('updated_after', new Date(lastSync).toISOString());
    }
    const res = await fetch(`${apiBase}/leads?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;

    const data = await res.json() as { data: CachedLead[] };
    const now = Date.now();
    if (data.data?.length) {
      const leads = data.data.map(lead => ({ ...lead, cached_at: now }));
      await offlineDb.leads.bulkPut(leads);
    }
    // Toujours bump le timestamp même si delta vide (sync a réussi)
    await setLastSyncAt('leads', now);
  } catch {
    // Pas de réseau — on garde le cache existant
  }
}

// ── Sync conversations depuis l'API vers le cache ───────────

export async function syncConversationsToCache(apiBase: string, token: string): Promise<void> {
  try {
    const lastSync = await getLastSyncAt('conversations');
    const params = new URLSearchParams({ limit: '100' });
    if (lastSync) {
      params.set('updated_after', new Date(lastSync).toISOString());
    }
    const res = await fetch(`${apiBase}/conversations?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;

    const data = await res.json() as { data: CachedConversation[] };
    const now = Date.now();
    if (data.data?.length) {
      const convos = data.data.map(c => ({ ...c, cached_at: now }));
      await offlineDb.conversations.bulkPut(convos);
    }
    await setLastSyncAt('conversations', now);
  } catch {
    // Pas de réseau
  }
}

// ── Sync tasks depuis l'API vers le cache ───────────────────

export async function syncTasksToCache(apiBase: string, token: string): Promise<void> {
  try {
    const lastSync = await getLastSyncAt('tasks');
    const qs = lastSync ? `?updated_after=${encodeURIComponent(new Date(lastSync).toISOString())}` : '';
    const res = await fetch(`${apiBase}/tasks${qs}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;

    const data = await res.json() as { data: CachedTask[] };
    const now = Date.now();
    if (data.data?.length) {
      const tasks = data.data.map(t => ({ ...t, cached_at: now }));
      await offlineDb.tasks.bulkPut(tasks);
    }
    await setLastSyncAt('tasks', now);
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
