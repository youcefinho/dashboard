// ── Sprint 51 M2 — Dédoublonnage unifié (connecteur entrant) ─────────────────
// Stratégie cohérente avec handleCreateLead (email+client) et handleWebhookLead.
// Merge = compléter les champs vides du lead existant (jamais écraser), + log.
import type { Env } from './types';

export type DedupStrategy = 'email' | 'phone' | 'email_phone' | 'none';

export interface DedupDecision {
  action: 'create' | 'merge' | 'skip';
  existingId?: string;
}

interface DedupInput {
  clientId: string;
  email: string;
  phone: string;
}

/**
 * Décide quoi faire d'un lead entrant selon la stratégie de la source.
 * - none      : toujours créer
 * - email     : doublon si même email + client
 * - phone     : doublon si même phone + client
 * - email_phone (défaut) : doublon si email OU phone match (client)
 *
 * Retro-compat : conserve la fenêtre 24h de l'ancien webhook → 'skip'
 * (idempotence retry-safe). Hors fenêtre → 'merge' (enrichit, ne duplique pas).
 */
export async function resolveDedup(
  env: Env,
  strategy: DedupStrategy,
  input: DedupInput
): Promise<DedupDecision> {
  if (strategy === 'none') return { action: 'create' };

  const { clientId, email, phone } = input;
  const conds: string[] = [];
  const params: string[] = [];

  if ((strategy === 'email' || strategy === 'email_phone') && email) {
    conds.push('LOWER(email) = ?');
    params.push(email.toLowerCase());
  }
  if ((strategy === 'phone' || strategy === 'email_phone') && phone) {
    conds.push('phone = ?');
    params.push(phone);
  }
  if (conds.length === 0) return { action: 'create' };

  // Doublon récent (< 24h) → skip idempotent (retry webhook safe)
  const recent = await env.DB.prepare(
    `SELECT id FROM leads WHERE client_id = ? AND (${conds.join(' OR ')})
       AND created_at > datetime('now', '-1 day')
       AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).bind(clientId, ...params).first() as { id: string } | null;
  if (recent) return { action: 'skip', existingId: recent.id };

  // Doublon plus ancien → merge (enrichissement non destructif)
  const older = await env.DB.prepare(
    `SELECT id FROM leads WHERE client_id = ? AND (${conds.join(' OR ')})
       AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).bind(clientId, ...params).first() as { id: string } | null;
  if (older) return { action: 'merge', existingId: older.id };

  return { action: 'create' };
}

/**
 * Complète les champs vides d'un lead existant (merge non destructif).
 * N'écrase JAMAIS une valeur déjà présente.
 */
export async function mergeIntoLead(
  env: Env,
  existingId: string,
  fields: Partial<{
    name: string; phone: string; message: string; company: string;
    utm_source: string; utm_medium: string; utm_campaign: string;
    utm_term: string; utm_content: string; gclid: string; fbclid: string; referrer: string;
  }>
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT name, phone, message, company, utm_source, utm_medium, utm_campaign,
            utm_term, utm_content, gclid, fbclid, referrer
       FROM leads WHERE id = ?`
  ).bind(existingId).first() as Record<string, unknown> | null;
  if (!row) return;

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!v) continue;
    const cur = row[k];
    if (cur == null || String(cur).trim() === '') {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (sets.length === 0) return;

  params.push(existingId);
  await env.DB.prepare(
    `UPDATE leads SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).bind(...params).run();
}
