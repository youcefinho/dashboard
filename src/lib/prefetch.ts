// ── Prefetch cache — Map in-memory pour pre-fetch on hover ───────────────────
// Différenciateur perf : on hover une row de leads, on déclenche le fetch en
// background → quand le user clique, la donnée est déjà là, panel s'ouvre instant.
//
// Usage :
//   import { prefetchLead, getCachedLead } from '@/lib/prefetch';
//   <tr onMouseEnter={() => prefetchLead(lead.id)}>...</tr>
//   const cached = getCachedLead(leadId); // dans LeadDetailBody pour initial state

import { getLeadDetail } from '@/lib/api';
import type { LeadDetail } from '@/lib/types';

interface CacheEntry<T> {
  data: T;
  ts: number;
  ttl: number;
}

const DEFAULT_TTL_MS = 30_000;

// Cache typé — un sous-cache par type d'entité pour pas avoir à typer en union
const leadCache = new Map<string, CacheEntry<LeadDetail>>();

// Promesses en cours pour dédupliquer les prefetch concurrents
const pendingFetches = new Map<string, Promise<unknown>>();

function isStale(entry: CacheEntry<unknown>): boolean {
  return Date.now() - entry.ts > entry.ttl;
}

// ── Leads ───────────────────────────────────────────────────────────────────

export function getCachedLead(leadId: string): LeadDetail | null {
  const entry = leadCache.get(leadId);
  if (!entry || isStale(entry)) return null;
  return entry.data;
}

export function setCachedLead(leadId: string, data: LeadDetail, ttl = DEFAULT_TTL_MS): void {
  leadCache.set(leadId, { data, ts: Date.now(), ttl });
}

export function invalidateLead(leadId: string): void {
  leadCache.delete(leadId);
}

/**
 * Lance le fetch d'un lead en background si pas en cache.
 * No-op si déjà en cache (frais) ou si une requête est déjà en cours.
 */
export function prefetchLead(leadId: string): void {
  if (!leadId) return;
  if (getCachedLead(leadId)) return; // déjà frais
  if (pendingFetches.has(`lead:${leadId}`)) return; // déjà en cours

  const promise = getLeadDetail(leadId)
    .then(res => {
      if (res.data) setCachedLead(leadId, res.data);
    })
    .catch(() => { /* silently fail — pas un user-facing fetch */ })
    .finally(() => {
      pendingFetches.delete(`lead:${leadId}`);
    });

  pendingFetches.set(`lead:${leadId}`, promise);
}

// ── Debounced prefetch hover helper ─────────────────────────────────────────
// Évite de prefetcher pour chaque survol fugitif (mouse passe sur 20 rows par
// seconde en scroll rapide). 150ms suffit pour distinguer intention.

const debounceTimers = new Map<string, number>();
const DEBOUNCE_HOVER_MS = 150;

export function prefetchLeadOnHover(leadId: string): void {
  const key = `lead:${leadId}`;
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = window.setTimeout(() => {
    prefetchLead(leadId);
    debounceTimers.delete(key);
  }, DEBOUNCE_HOVER_MS);
  debounceTimers.set(key, timer);
}

export function cancelPrefetchHover(leadId: string): void {
  const key = `lead:${leadId}`;
  const existing = debounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    debounceTimers.delete(key);
  }
}
