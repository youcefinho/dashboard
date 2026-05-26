// ── Module Télémétrie — Intralys (Sprint S9 M1) ─────────────
// Endpoint beacon Web Vitals : POST /api/telemetry/web-vitals.
//
// Câblé depuis src/lib/webVitals.ts:189-207 (reportToBackend → navigator.sendBeacon).
// Contrat : c'est un BEACON. Best-effort, non bloquant, JAMAIS d'erreur fatale —
// un échec de persistance NE doit jamais dégrader l'UX (le client a déjà fermé
// l'onglet la plupart du temps). On répond 204 quoi qu'il arrive.
//
// Validation INLINE défensive (pas de schemas.ts — helper figé hors scope) :
//   - whitelist `name` ∈ Core Web Vitals connus
//   - clamp `value` numérique fini, borné
//   - best-effort INSERT dans `web_vitals` (migration-sprintS9-m1.sql)
//   - client_id best-effort si dispo, sinon NULL (la table l'autorise)
import type { Env } from './types';
// ── Sprint 25 — Perf budget side-effect (best-effort, never blocks 204).
// Si le beacon contient un Web Vital >= seuil 'fail' (LCP/CLS/INP TRACKED),
// logPerfBudget consigne un audit_log('perf.budget_exceeded'). Le traitement
// est lancé via ctx.waitUntil quand ctx dispo (route depuis worker.ts), sinon
// fire-and-forget — l'INSERT web_vitals reste inchangé.
import { logPerfBudget } from './perf-budget-log';

// Whitelist alignée src/lib/webVitals.ts:14 (WebVitalName).
const KNOWN_VITALS = new Set(['LCP', 'CLS', 'INP', 'TTFB', 'FCP']);
const KNOWN_RATINGS = new Set(['good', 'needs-improvement', 'poor']);

// Borne large : LCP/INP/TTFB/FCP en ms (peuvent atteindre plusieurs dizaines de
// secondes sur connexion dégradée), CLS = score <1. 600000 = 10 min, plafond
// défensif anti-garbage. On clamp plutôt que rejeter (beacon = best-effort).
const VALUE_MAX = 600000;

interface WebVitalBeacon {
  name?: unknown;
  value?: unknown;
  rating?: unknown;
  delta?: unknown;
  id?: unknown;
  navigationType?: unknown;
}

/**
 * POST /api/telemetry/web-vitals — beacon Web Vitals best-effort.
 *
 * Body accepté : WebVitalMetric (src/lib/webVitals.ts:18-31) =
 *   { name, value, rating, delta, id, navigationType }
 * Seuls `name` (whitelisté) et `value` (numérique fini, clampé) sont requis.
 * Réponse : 204 No Content systématique (succès, payload invalide, ou erreur
 * DB) — un beacon ne reçoit jamais d'erreur exploitable côté client.
 *
 * @param request requête entrante (body JSON envoyé via sendBeacon)
 * @param env     bindings worker (env.DB)
 * @param ctx    ExecutionContext optionnel — utilisé Sprint 25 pour fire-and-
 *               forget `logPerfBudget` (audit perf.budget_exceeded best-effort).
 *               Signature OPTIONNELLE (rétro-compat appels existants).
 */
export async function handlePostWebVitals(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  // 204 = réponse canonique d'un beacon. On la renvoie dans TOUS les cas.
  // 204 No Content ne peut PAS avoir de body (spec HTTP) → new Response(null).
  const ack = (): Response => new Response(null, { status: 204 });

  let body: WebVitalBeacon;
  try {
    body = (await request.json()) as WebVitalBeacon;
  } catch {
    return ack(); // payload illisible : on ignore silencieusement.
  }
  if (!body || typeof body !== 'object') return ack();

  // ── Validation inline défensive ──
  const name = typeof body.name === 'string' ? body.name : '';
  if (!KNOWN_VITALS.has(name)) return ack(); // métrique inconnue → drop.

  const rawValue = typeof body.value === 'number' ? body.value : Number(body.value);
  if (!Number.isFinite(rawValue)) return ack(); // valeur non numérique → drop.
  const value = Math.min(Math.max(rawValue, 0), VALUE_MAX); // clamp [0, VALUE_MAX]

  const rating =
    typeof body.rating === 'string' && KNOWN_RATINGS.has(body.rating)
      ? body.rating
      : null;
  // `id` sert d'identifiant de session côté tracker (webVitals.ts:27-28).
  const sessionId =
    typeof body.id === 'string' && body.id.length <= 128 ? body.id : null;

  // URL : best-effort depuis le header Referer (sendBeacon n'envoie pas d'URL
  // explicite dans le body de WebVitalMetric — navigationType ≠ URL).
  const referer = request.headers.get('Referer') || request.headers.get('Referrer');
  const url = referer && referer.length <= 512 ? referer : null;

  // client_id : best-effort. Le beacon est non authentifié (sendBeacon ne porte
  // pas le cookie de session de façon fiable) ⇒ NULL la plupart du temps. La
  // table web_vitals autorise client_id NULL (migration-sprintS9-m1.sql).
  const clientId: string | null = null;

  // ── Persistance best-effort — JAMAIS throw ──
  try {
    await env.DB.prepare(
      `INSERT INTO web_vitals (metric_name, value, rating, url, session_id, client_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(name, value, rating, url, sessionId, clientId)
      .run();
  } catch {
    // best-effort : table absente (migration non jouée) ou DB indispo → on
    // avale. Un beacon ne doit JAMAIS faire échouer la requête.
  }

  // ── Sprint 25 — Perf budget : audit best-effort si Web Vital tracked >= fail.
  // Filtré côté perf-budget-log (TRACKED = LCP/CLS/INP, severity === 'fail'
  // uniquement). Userless (beacon non authentifié → userId = undefined → 'system'
  // côté audit). Lancé via ctx.waitUntil si dispo (non bloquant), sinon
  // fire-and-forget (la promesse peut être interrompue après ack mais le worker
  // tient assez longtemps pour l'INSERT dans la pratique). NEVER throws.
  try {
    const payload = { name, value, rating: rating ?? undefined };
    if (ctx) {
      ctx.waitUntil(logPerfBudget(env, payload));
    } else {
      // Fallback sans ctx : on lance la promesse sans l'attendre (best-effort).
      void logPerfBudget(env, payload);
    }
  } catch {
    /* never throws */
  }

  return ack();
}
