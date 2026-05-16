// ── messageQueue — Sprint 44 M2.3 ────────────────────────────────────────────
// Outbox d'envois Inbox (SMS/email/webchat) pour mode offline-first.
//
// Workflow :
//   1. User clique "Envoyer" en offline → enqueueOutbound() ajoute dans IndexedDB
//      avec status='queued'. UI affiche le message avec icon Clock + label
//      "En attente d'envoi".
//   2. Au retour online (event 'online' OR appel manuel flushOutbox()), on
//      itère la queue par created_at asc, on appelle l'API send.
//   3. Sur succès → delete row, on notifie listener (via onProgress callback).
//   4. Sur 4xx (sauf 409) → marquer status='failed' (pas de retry auto, requires
//      manual user retry car payload probablement invalide).
//   5. Sur 5xx ou network error → retries++. À retries >= MAX_RETRIES → 'failed'.
//
// API :
//   - enqueueOutbound(payload) → ajoute en queue (status='queued')
//   - flushOutbox(apiBase, token, callbacks) → process toute la queue
//   - retryOutboxItem(id, apiBase, token) → manual retry (status='failed' → 'queued')
//   - removeOutboxItem(id) → supprime (user dismiss)
//   - subscribeOutbox(callback) → subscribe aux changements (poll-based simple)

import { offlineDb, type OutboxMessage, type OutboxMessageStatus } from './offline/db';

const MAX_RETRIES = 3;

export interface EnqueueOutboundPayload {
  conversationId: string;
  channel: string;
  body: string;
  /** ID du message optimistic dans le thread UI — sert au mapping retour */
  tmpMessageId?: string;
}

export async function enqueueOutbound(payload: EnqueueOutboundPayload): Promise<OutboxMessage> {
  const msg: OutboxMessage = {
    id: crypto.randomUUID(),
    conversationId: payload.conversationId,
    channel: payload.channel,
    body: payload.body,
    created_at: Date.now(),
    status: 'queued',
    retries: 0,
    tmp_message_id: payload.tmpMessageId,
  };
  await offlineDb.outbox.add(msg);
  return msg;
}

export async function removeOutboxItem(id: string): Promise<void> {
  await offlineDb.outbox.delete(id);
}

export async function updateOutboxStatus(id: string, status: OutboxMessageStatus, lastError?: string): Promise<void> {
  await offlineDb.outbox.update(id, { status, ...(lastError !== undefined ? { last_error: lastError } : {}) });
}

export interface FlushOutboxCallbacks {
  /** Avant d'envoyer une item — passe l'item courant */
  onItemStart?: (item: OutboxMessage) => void;
  /** Après succès — l'item a été supprimé de l'outbox */
  onItemSuccess?: (item: OutboxMessage, serverResponse: unknown) => void;
  /** Après échec terminal (4xx ou retries>=MAX) */
  onItemFailed?: (item: OutboxMessage, error: string) => void;
}

export interface FlushOutboxResult {
  success: number;
  failed: number;
  retrying: number;
}

/**
 * Envoie tous les items 'queued' de l'outbox. À appeler au retour online.
 * Stop si network error (pas de réseau effectif → break loop, on réessaiera plus tard).
 */
export async function flushOutbox(
  apiBase: string,
  token: string,
  callbacks: FlushOutboxCallbacks = {},
): Promise<FlushOutboxResult> {
  let success = 0;
  let failed = 0;
  let retrying = 0;

  // On ne flush que les 'queued' (les 'failed' sont en attente d'action manuelle).
  const items = await offlineDb.outbox
    .where('status')
    .equals('queued')
    .sortBy('created_at');

  for (const item of items) {
    callbacks.onItemStart?.(item);
    await updateOutboxStatus(item.id, 'sending');

    try {
      const res = await fetch(`${apiBase}/conversations/${item.conversationId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: item.body, channel: item.channel }),
      });

      if (res.ok) {
        let serverData: unknown = null;
        try { serverData = await res.json(); } catch { /* may be empty */ }
        await offlineDb.outbox.delete(item.id);
        callbacks.onItemSuccess?.(item, serverData);
        success++;
        continue;
      }

      if (res.status === 409) {
        // Conflit (déjà créé) → succès idempotent
        await offlineDb.outbox.delete(item.id);
        callbacks.onItemSuccess?.(item, null);
        success++;
        continue;
      }

      if (res.status >= 400 && res.status < 500) {
        // Erreur client — pas la peine de retry (payload invalide)
        const errorMsg = `Erreur ${res.status} — vérifiez le contenu`;
        await updateOutboxStatus(item.id, 'failed', errorMsg);
        callbacks.onItemFailed?.(item, errorMsg);
        failed++;
        continue;
      }

      // 5xx → retry
      const newRetries = item.retries + 1;
      if (newRetries >= MAX_RETRIES) {
        const errorMsg = `Échec après ${MAX_RETRIES} tentatives (serveur)`;
        await offlineDb.outbox.update(item.id, { retries: newRetries, status: 'failed', last_error: errorMsg });
        callbacks.onItemFailed?.(item, errorMsg);
        failed++;
      } else {
        await offlineDb.outbox.update(item.id, { retries: newRetries, status: 'queued', last_error: `Serveur ${res.status}` });
        retrying++;
      }
    } catch (err) {
      // Network error → break (pas de réseau, on réessaiera au prochain 'online')
      await updateOutboxStatus(item.id, 'queued', 'Pas de réseau');
      break;
    }
  }

  return { success, failed, retrying };
}

/** Retry manuel d'un item 'failed' — reset retries + status='queued' */
export async function retryOutboxItem(id: string): Promise<void> {
  await offlineDb.outbox.update(id, {
    status: 'queued',
    retries: 0,
    last_error: undefined,
  });
}

/**
 * Subscribe aux changements de l'outbox via simple polling (1s).
 * Retourne un unsubscribe.
 * Évite d'introduire une dépendance Dexie liveQuery pour rester léger.
 */
export function subscribeOutbox(
  conversationId: string | null,
  callback: (items: OutboxMessage[]) => void,
  intervalMs = 1000,
): () => void {
  let stopped = false;
  let lastSerialized = '';

  const poll = async () => {
    if (stopped) return;
    try {
      const items = conversationId
        ? await offlineDb.outbox.where('conversationId').equals(conversationId).toArray()
        : await offlineDb.outbox.toArray();
      const serialized = JSON.stringify(items.map(i => ({ id: i.id, status: i.status, retries: i.retries })));
      if (serialized !== lastSerialized) {
        lastSerialized = serialized;
        callback(items);
      }
    } catch { /* ignore — DB may not be ready */ }
  };

  void poll();
  const timer = window.setInterval(() => { void poll(); }, intervalMs);

  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

/**
 * Setup auto-flush : écoute event 'online' et flush outbox.
 * À appeler au boot dans AppLayout, idéalement après l'auth.
 */
export function setupOutboxAutoFlush(
  apiBase: string,
  getToken: () => string | null,
  callbacks?: FlushOutboxCallbacks,
): () => void {
  const handler = async () => {
    const token = getToken();
    if (!token) return;
    await flushOutbox(apiBase, token, callbacks);
  };
  window.addEventListener('online', () => { void handler(); });
  return () => window.removeEventListener('online', handler);
}
