import { json } from './helpers';
import type { Env } from './types';

export async function handleHealth(env: Env, uptime_s: number): Promise<Response> {
  let dbOk = 'ok';
  let details = undefined;
  try { 
    await env.DB.prepare('SELECT 1').first(); 
  } catch (e: any) { 
    dbOk = 'error'; 
    details = e.message || 'DB connection failed';
  }
  
  if (dbOk === 'error') {
    return json({ status: 'error', db: 'error', details, version: '2.1.0', uptime_s }, 503);
  }

  // S10 §6.4 — champ ADDITIF best-effort `migrations_count` (snake_case, number).
  // Source : COUNT(*) sur la table du runner S2 `_migrations`
  // (cf scripts/migrate.ts:190 — `CREATE TABLE IF NOT EXISTS _migrations`).
  // Strictement optionnel : si la requête échoue (table absente, DB lente),
  // le champ est OMIS — JAMAIS de 503, JAMAIS de changement de `status`.
  // Le shape existant { status, db, version, uptime_s } reste INCHANGÉ.
  const base = { status: 'ok', db: 'ok', version: '2.1.0', uptime_s };
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM _migrations').first() as { c?: number } | null;
    const c = row && typeof row.c === 'number' ? row.c : undefined;
    if (typeof c === 'number') {
      return json({ ...base, migrations_count: c });
    }
  } catch { /* best-effort : champ omis, shape de succès intact */ }

  return json(base);
}
