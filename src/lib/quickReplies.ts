// ── quickReplies — Sprint 33 vague 33-2B / Sprint 43 M3.2 backend ────────────
// Quick reply chips per-lead (FIFO 3).
//
// Sprint 43 M3.2 : bascule fetch /api/leads/:id/quick-replies.
// Fallback localStorage conservé pour offline / dev / SSR.
//
// API publique 100% back-compat :
//   - getQuickReplies(leadId): string[]                (sync — cache local)
//   - recordReply(leadId, text): void                  (fire-and-forget + cache)
//   - syncQuickReplies(leadId): Promise<string[]>      (nouveau — pull serveur)
//   - clearQuickReplies(leadId?): void

const STORAGE_KEY = 'intralys_quick_replies';
const MAX_PER_LEAD = 3;
const MAX_TEXT_LENGTH = 280;

type Storage = Record<string, string[]>;

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
    // silencieux (quota)
  }
}

// ── Backend fetch helpers ───────────────────────────────────────────────────

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
    return await fetch(input, { ...init, headers });
  } catch {
    return null;
  }
}

/** Sync : cache local. Affichage immédiat — UX sub-100ms garanti. */
export function getQuickReplies(leadId: string): string[] {
  if (!leadId) return [];
  const store = readStore();
  const list = store[leadId];
  if (!Array.isArray(list)) return [];
  return list.filter((t) => typeof t === 'string' && t.length > 0).slice(0, MAX_PER_LEAD);
}

/**
 * Async : pull serveur + hydrate cache local. Retourne la liste à jour.
 * Si backend KO → fallback cache local.
 */
export async function syncQuickReplies(leadId: string): Promise<string[]> {
  if (!leadId) return [];
  const res = await fetchBackend(`/api/leads/${encodeURIComponent(leadId)}/quick-replies`);
  if (res && res.ok) {
    try {
      const json = await res.json() as { data?: string[] };
      const list = (json.data || []).slice(0, MAX_PER_LEAD);
      const store = readStore();
      if (list.length === 0) delete store[leadId];
      else store[leadId] = list;
      writeStore(store);
      return list;
    } catch { /* fallback */ }
  }
  return getQuickReplies(leadId);
}

/**
 * Enregistre un quick reply. Optimistic UI : commit cache local immédiatement,
 * sync backend en arrière-plan. Préserve FIFO 3 + dedup case-sensitive.
 */
export function recordReply(leadId: string, text: string): void {
  if (!leadId) return;
  const trimmed = (text ?? '').trim();
  if (!trimmed) return;
  if (trimmed.length > MAX_TEXT_LENGTH) return;

  // ── 1. Optimistic commit local
  const store = readStore();
  const existing = store[leadId] ?? [];
  const filtered = existing.filter((t) => t !== trimmed);
  const next = [trimmed, ...filtered].slice(0, MAX_PER_LEAD);
  const nextStore: Storage = { ...store, [leadId]: next };
  writeStore(nextStore);

  // ── 2. Sync backend (fire-and-forget)
  fetchBackend(`/api/leads/${encodeURIComponent(leadId)}/quick-replies`, {
    method: 'POST',
    body: JSON.stringify({ content: trimmed }),
  }).then(async (res) => {
    if (res && res.ok) {
      try {
        const json = await res.json() as { data?: string[] };
        const serverList = (json.data || []).slice(0, MAX_PER_LEAD);
        // Reconcile cache local (serveur fait autorité)
        const s = readStore();
        if (serverList.length === 0) delete s[leadId];
        else s[leadId] = serverList;
        writeStore(s);
      } catch { /* silencieux — garde optimistic */ }
    }
    // Si KO → on garde l'optimistic (mode dégradé)
  }).catch(() => { /* silencieux */ });
}

export function clearQuickReplies(leadId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!leadId) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const store = readStore();
    if (leadId in store) {
      const next = { ...store };
      delete next[leadId];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // silencieux
  }
}
