// ════════════════════════════════════════════════════════════
// S4 M1 — Logger structuré minimal (zéro dépendance, edge-safe)
// ════════════════════════════════════════════════════════════
//
// ── OBJECTIF ────────────────────────────────────────────────
//
// Avant S4, les 2 catch racine du routeur (`src/worker.ts`)
// faisaient un `console.error('Erreur ...', err)` brut puis un 500
// nu. Ce logger normalise la sortie en **1 ligne JSON** (parseable
// par les logs Cloudflare / observabilité) et borne la verbosité
// via `LOG_LEVEL`.
//
// ── LOI 25 / SÉCURITÉ (NON NÉGOCIABLE) ──────────────────────
//
// Le `ctx` passé à logger.* DOIT contenir UNIQUEMENT des
// métadonnées sûres : route, méthode, status, nom/type d'erreur,
// message d'erreur. JAMAIS de body de requête, token, mot de
// passe, en-tête Authorization, PII (email/téléphone/nom client),
// secret ou stack contenant des chemins/valeurs sensibles.
// Le logger ne fait AUCUNE introspection profonde : il sérialise
// `ctx` tel quel — c'est à l'appelant de ne passer que du sûr.
// `error-response.ts` (le seul appelant prévu) respecte cette règle.
//
// ── NIVEAUX ─────────────────────────────────────────────────
//
//   error < warn < info   (ordre de sévérité décroissante)
//
// `LOG_LEVEL` (binding Wrangler optionnel, lu défensivement —
// PAS dans l'interface Env figée) ∈ {'error','warn','info'}.
// Défaut = 'warn' (discret : seuls error+warn passent en prod).
// Une valeur inconnue retombe sur le défaut 'warn'.

// Sprint 24 — Observabilité : niveau 'debug' AJOUTÉ (additif, additionne en
// fin de la hiérarchie de sévérité). Threshold 'warn' par défaut : 'debug' est
// donc OFF en prod sauf si LOG_LEVEL='info' (debug<info dans SEVERITY → skip)
// ou LOG_LEVEL='debug' (nouveau, opt-in explicite).
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** Sévérité numérique : un message passe si severity(msgLevel) <= severity(threshold). */
const SEVERITY: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const DEFAULT_LEVEL: LogLevel = 'warn';

/**
 * Lit `LOG_LEVEL` de façon défensive depuis `env` (binding optionnel,
 * absent de l'interface `Env` figée — d'où l'accès indexé typé large).
 * Toute valeur non reconnue → défaut 'warn'.
 */
function resolveLevel(env: unknown): LogLevel {
  const raw =
    env && typeof env === 'object'
      ? (env as Record<string, unknown>)['LOG_LEVEL']
      : undefined;
  if (raw === 'error' || raw === 'warn' || raw === 'info' || raw === 'debug') return raw;
  return DEFAULT_LEVEL;
}

/** Métadonnées sûres uniquement (voir entête Loi 25). */
export type LogContext = Record<string, unknown>;

export interface Logger {
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  // Sprint 24 — Observabilité : niveau 'debug' (off par défaut, opt-in
  // LOG_LEVEL='debug'). Utile pour traces fines (request_id propagation,
  // alert evaluator, request-metrics flush). Pas de PII (Loi 25, cf. entête).
  debug(msg: string, ctx?: LogContext): void;
}

/**
 * Émet une ligne JSON unique sur le bon canal `console.*`.
 * Ne throw jamais (un `console.*` qui échoue ne doit pas casser
 * le handler d'erreur appelant). Le `ctx` est inclus à plat.
 */
function emit(level: LogLevel, msg: string, ctx?: LogContext): void {
  try {
    const line = JSON.stringify({
      lvl: level,
      msg,
      ts: new Date().toISOString(),
      ...(ctx || {}),
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level === 'debug') console.debug(line);
    else console.info(line);
  } catch {
    // Sérialisation impossible (ctx circulaire, etc.) : on dégrade
    // sans throw — ne JAMAIS faire échouer le chemin d'erreur.
    try {
      console.error(`{"lvl":"${level}","msg":"log-serialize-failed"}`);
    } catch {
      /* dernier recours : silencieux, ne jamais throw */
    }
  }
}

/**
 * Construit un logger borné par `env.LOG_LEVEL` (défaut 'warn').
 *
 * @param env  Objet d'environnement Worker (ou tout objet) — seule
 *             la clé `LOG_LEVEL` est lue, défensivement.
 * @returns    `Logger` avec `info`/`warn`/`error`. Un message dont
 *             la sévérité est plus faible que le seuil est ignoré
 *             silencieusement (aucune sortie).
 *
 * @example
 *   const log = createLogger(env);
 *   log.error('unhandled', { route: '/api/x', name: 'TypeError' });
 */
export function createLogger(env: unknown): Logger {
  const threshold = resolveLevel(env);
  const max = SEVERITY[threshold];
  const passes = (lvl: LogLevel) => SEVERITY[lvl] <= max;
  return {
    info(msg, ctx) {
      if (passes('info')) emit('info', msg, ctx);
    },
    warn(msg, ctx) {
      if (passes('warn')) emit('warn', msg, ctx);
    },
    error(msg, ctx) {
      if (passes('error')) emit('error', msg, ctx);
    },
    debug(msg, ctx) {
      if (passes('debug')) emit('debug', msg, ctx);
    },
  };
}

/**
 * Logger par défaut (seuil = défaut 'warn', `LOG_LEVEL` non résolu).
 * Pratique pour un usage sans `env` sous la main ; quand `env` est
 * disponible préférer `createLogger(env)` pour respecter `LOG_LEVEL`.
 */
export const logger: Logger = createLogger(undefined);

// ── Sprint 24 — Observabilité : logger corrélé par requête ──────────────
//
// `createCorrelatedLogger(env, requestId)` est un WRAPPER additif autour de
// `createLogger(env)` qui enrichit chaque `ctx` log avec `request_id`. Permet
// de tracer une requête HTTP de bout en bout dans les logs (corrélation avec
// audit_log.request_id seq121 et header de réponse X-Request-Id).
//
// La signature `createLogger(env): Logger` figée S4 n'est PAS modifiée — ce
// helper est strictement additif. Si `requestId` est null/empty, on dégrade
// proprement en pass-through (aucun ajout au ctx). JAMAIS de throw.
//
// Loi 25 : `request_id` est un UUID v4 généré côté serveur (aucune PII), donc
// safe à logger librement.
export function createCorrelatedLogger(env: unknown, requestId: string | null): Logger {
  const base = createLogger(env);
  const enrich = (ctx?: LogContext): LogContext =>
    requestId ? { ...(ctx || {}), request_id: requestId } : (ctx || {});
  return {
    info: (m, c) => base.info(m, enrich(c)),
    warn: (m, c) => base.warn(m, enrich(c)),
    error: (m, c) => base.error(m, enrich(c)),
    debug: (m, c) => base.debug(m, enrich(c)),
  };
}
