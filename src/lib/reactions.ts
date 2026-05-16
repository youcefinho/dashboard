// ── reactions — Sprint 33 vague 33-2A / Sprint 43 M3.1 backend ───────────────
// Persistence des reactions emoji par message.
//
// Sprint 43 M3.1 : bascule fetch /api/messages/:id/reactions (Workers + D1).
// Fallback localStorage conservé pour :
//   - mode hors-ligne (réseau down)
//   - dev local sans worker
//   - SSR / tests unitaires
//
// API publique 100% back-compat :
//   - getReactions(messageId, currentUserId?) -> Reaction[]      (sync — cache local)
//   - toggleReaction(messageId, emoji, userId?) -> Promise<Reaction[]>  (async — best of backend / local)
//   - clearAllReactions() -> void
//
// Optimistic UI pattern : toggleReaction commit local immédiatement, puis
// reconcile avec le retour serveur (override le cache si serveur OK, rollback
// silencieux si serveur KO + erreur surfacée via console).

export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
  reacted: boolean;
}

const STORAGE_KEY = 'intralys_reactions';
const DEFAULT_USER_ID = 'current-user';

type Storage = Record<string, Record<string, string[]>>;

// ── localStorage helpers (cache + fallback offline) ─────────────────────────

function readStore(): Storage {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Storage;
    return {};
  } catch {
    return {};
  }
}

function writeStore(store: Storage): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota / private mode — silencieux
  }
}

function aggregate(
  byEmoji: Record<string, string[]> | undefined,
  currentUserId: string,
): Reaction[] {
  if (!byEmoji) return [];
  const list: Reaction[] = [];
  for (const [emoji, userIds] of Object.entries(byEmoji)) {
    if (!userIds || userIds.length === 0) continue;
    list.push({
      emoji,
      count: userIds.length,
      userIds: [...userIds],
      reacted: userIds.includes(currentUserId),
    });
  }
  list.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.emoji.localeCompare(b.emoji);
  });
  return list;
}

// ── Backend fetch (best-effort) ──────────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem('intralys_token'); } catch { return null; }
}

async function fetchBackend(input: string, init?: RequestInit): Promise<Response | null> {
  if (typeof fetch === 'undefined') return null;
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(input, { ...init, headers });
    return res;
  } catch {
    return null; // réseau down → fallback local
  }
}

/** Sync : lit les reactions depuis le cache localStorage (UX immédiate). */
export function getReactions(
  messageId: string,
  currentUserId: string = DEFAULT_USER_ID,
): Reaction[] {
  if (!messageId) return [];
  const store = readStore();
  return aggregate(store[messageId], currentUserId);
}

/**
 * Async : fetch /api/messages/:id/reactions et hydrate le cache local.
 * Retourne la liste à jour. Si serveur KO → fallback cache local.
 */
export async function syncReactions(
  messageId: string,
  currentUserId: string = DEFAULT_USER_ID,
): Promise<Reaction[]> {
  if (!messageId) return [];
  const res = await fetchBackend(`/api/messages/${encodeURIComponent(messageId)}/reactions`);
  if (res && res.ok) {
    try {
      const json = await res.json() as { data?: Reaction[] };
      const list = json.data || [];
      // Rehydrate cache local pour cohérence (data race-safe : on écrase juste cet id)
      const store = readStore();
      const byEmoji: Record<string, string[]> = {};
      for (const r of list) byEmoji[r.emoji] = r.userIds || [];
      if (Object.keys(byEmoji).length === 0) delete store[messageId];
      else store[messageId] = byEmoji;
      writeStore(store);
      return list.map(r => ({ ...r, reacted: (r.userIds || []).includes(currentUserId) }));
    } catch { /* tomber dans fallback */ }
  }
  return getReactions(messageId, currentUserId);
}

/**
 * Toggle une reaction. Optimistic UI : commit cache local immédiatement,
 * puis sync backend en arrière-plan. Si backend KO → garde l'état local.
 */
export function toggleReaction(
  messageId: string,
  emoji: string,
  userId: string = DEFAULT_USER_ID,
): Promise<Reaction[]> {
  return new Promise((resolve) => {
    if (!messageId || !emoji) {
      resolve(getReactions(messageId, userId));
      return;
    }

    // ── 1. Optimistic commit local
    const store = readStore();
    const byMessage = store[messageId] ?? {};
    const userIds = byMessage[emoji] ?? [];
    const idx = userIds.indexOf(userId);
    const isUnreact = idx >= 0;
    const nextUserIds = isUnreact
      ? userIds.filter((u) => u !== userId)
      : [...userIds, userId];
    const nextByMessage: Record<string, string[]> = { ...byMessage };
    if (nextUserIds.length === 0) delete nextByMessage[emoji];
    else nextByMessage[emoji] = nextUserIds;
    const nextStore: Storage = { ...store };
    if (Object.keys(nextByMessage).length === 0) delete nextStore[messageId];
    else nextStore[messageId] = nextByMessage;
    writeStore(nextStore);
    const optimistic = aggregate(nextByMessage, userId);

    // ── 2. Sync backend (fire-and-forget — la résolution Promise utilise l'optimistic
    //    si backend lent, mais on reconcile via override storage si serveur répond OK)
    const endpoint = `/api/messages/${encodeURIComponent(messageId)}/reactions`;
    const req = isUnreact
      ? fetchBackend(`${endpoint}/${encodeURIComponent(emoji)}`, { method: 'DELETE' })
      : fetchBackend(endpoint, { method: 'POST', body: JSON.stringify({ emoji }) });

    req.then(async (res) => {
      if (res && res.ok) {
        try {
          const json = await res.json() as { data?: Reaction[] };
          const serverList = json.data || [];
          // Rehydrate cache local avec la vérité serveur (rollback silencieux si divergence)
          const s = readStore();
          const map: Record<string, string[]> = {};
          for (const r of serverList) map[r.emoji] = r.userIds || [];
          if (Object.keys(map).length === 0) delete s[messageId];
          else s[messageId] = map;
          writeStore(s);
        } catch { /* silencieux — on garde l'optimistic */ }
      }
      // Si !res.ok ou réseau down : on garde l'optimistic (mode dégradé)
    }).catch(() => { /* silencieux */ });

    // Résoud immédiatement avec l'optimistic — caller n'attend pas le serveur
    resolve(optimistic);
  });
}

export function clearAllReactions(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silencieux
  }
}
