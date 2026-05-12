// ── Offline Mutation Queue — Actions hors ligne ─────────────
// Sprint 11 — Capacitor V1

import { offlineDb, type OfflineMutation } from './db';
import { isOnline } from './sync';

// ── Ajouter une mutation à la queue ─────────────────────────

export async function enqueueMutation(
  method: string,
  path: string,
  body?: unknown
): Promise<void> {
  const mutation: OfflineMutation = {
    id: crypto.randomUUID(),
    method,
    path,
    body: body ? JSON.stringify(body) : '',
    created_at: Date.now(),
    retries: 0,
  };

  await offlineDb.mutations.add(mutation);
}

// ── Rejouer les mutations en attente ────────────────────────

export async function replayMutations(
  apiBase: string,
  token: string
): Promise<{ success: number; failed: number }> {
  if (!isOnline()) return { success: 0, failed: 0 };

  const mutations = await offlineDb.mutations
    .orderBy('created_at')
    .toArray();

  let success = 0;
  let failed = 0;

  for (const mutation of mutations) {
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const res = await fetch(`${apiBase}${mutation.path}`, {
        method: mutation.method,
        headers,
        body: mutation.body || undefined,
      });

      if (res.ok || res.status === 409) {
        // Succès ou conflit (déjà créé) → supprimer de la queue
        await offlineDb.mutations.delete(mutation.id);
        success++;
      } else if (res.status >= 500) {
        // Erreur serveur → réessayer plus tard
        await offlineDb.mutations.update(mutation.id, {
          retries: mutation.retries + 1,
        });
        failed++;
      } else {
        // Erreur client (400, 403, etc.) → supprimer (pas récupérable)
        await offlineDb.mutations.delete(mutation.id);
        failed++;
      }
    } catch {
      // Pas de réseau → arrêter le replay
      failed++;
      break;
    }
  }

  return { success, failed };
}

// ── Auto-replay au retour online ────────────────────────────

export function setupAutoReplay(apiBase: string, getToken: () => string | null): void {
  window.addEventListener('online', async () => {
    const token = getToken();
    if (!token) return;

    const result = await replayMutations(apiBase, token);
    if (result.success > 0) {
      // Notification toast via sonner
      import('sonner').then(({ toast }) => {
        toast.success(`${result.success} action(s) synchronisée(s)`);
      });
    }
  });
}
