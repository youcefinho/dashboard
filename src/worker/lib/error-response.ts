// ════════════════════════════════════════════════════════════
// S4 M1 — Réponse d'erreur 500 normalisée + log structuré
// ════════════════════════════════════════════════════════════
//
// ── OBJECTIF ────────────────────────────────────────────────
//
// Les 2 catch racine de `src/worker.ts` (bloc public + enveloppe
// `routeProtected`) renvoyaient un 500 NU sans log structuré :
//
//   catch (err) { console.error('Erreur ...', err);
//                 return json({ error: 'Erreur ...' }, 500); }
//
// `errorResponse()` centralise ce comportement : log structuré
// (via `createLogger`) + réponse 500 au format rétro-compat.
//
// ── FORMAT (rétro-compat front — prouvé S3) ─────────────────
//
// Le front lit `data.error` comme une STRING brute (src/lib/api.ts,
// `data.error || ...`). On garde donc `error` = string FR à la
// racine et on AJOUTE `code` (additif, ignoré par les lecteurs
// actuels — même philosophie que `validate-response.ts`/S3).
//
//   HTTP 500 : { error: "Erreur serveur interne", code: "INTERNAL" }
//
// ── GARANTIES ───────────────────────────────────────────────
//
// • Idempotent (aucun état).
// • Ne throw JAMAIS (le log est entouré d'un try/catch interne :
//   un échec de logging ne doit pas masquer la réponse 500).
// • Zéro PII/secret/body/token loggé (Loi 25) : seuls le nom et
//   le message de l'exception + une route optionnelle sont émis.
// • Réutilise le helper figé `json()` (NE LE MODIFIE PAS).

import { json } from '../helpers';
import { createLogger } from './logger';

/**
 * Extrait des métadonnées d'erreur SÛRES (jamais de PII/secret).
 * On ne logge que `name` + `message` : le message d'une exception
 * applicative ne contient pas de body/token (les inputs sensibles
 * ne sont jamais interpolés dans les `throw` du worker). La stack
 * n'est PAS incluse (chemins/valeurs potentiellement sensibles).
 */
function safeErrorMeta(e: unknown): { name: string; message: string } {
  if (e instanceof Error) {
    return {
      name: e.name || 'Error',
      // borne défensive : tronque un message anormalement long
      message: String(e.message || '').slice(0, 500),
    };
  }
  if (typeof e === 'string') return { name: 'NonError', message: e.slice(0, 500) };
  return { name: 'NonError', message: 'unknown' };
}

/**
 * Construit la réponse HTTP 500 normalisée pour une exception NON
 * gérée interceptée par un catch racine, et journalise l'incident.
 *
 * @param e     L'exception interceptée (`unknown` — peut être tout).
 * @param env   Environnement Worker — utilisé pour résoudre
 *               `LOG_LEVEL` (lu défensivement par le logger).
 * @param route Chemin de la requête (métadonnée sûre, optionnel) —
 *               aide au diagnostic sans exposer de PII.
 * @returns     `Response` 500 — corps :
 *               `{ error: "Erreur serveur interne", code: "INTERNAL" }`.
 *               `error` reste une STRING racine (rétro-compat front).
 *
 * @remarks Ne throw jamais : si le logging échoue, on retourne quand
 *          même la réponse 500.
 *
 * @example
 *   try { return await routeProtected(...); }
 *   catch (err) { return errorResponse(err, env, path); }
 */
export function errorResponse(e: unknown, env: unknown, route?: string): Response {
  try {
    const meta = safeErrorMeta(e);
    const ctx: Record<string, unknown> = { name: meta.name, message: meta.message };
    if (route) ctx['route'] = route;
    createLogger(env).error('unhandled', ctx);
  } catch {
    // Le logging ne doit JAMAIS empêcher la réponse 500.
  }
  return json({ error: 'Erreur serveur interne', code: 'INTERNAL' }, 500);
}
