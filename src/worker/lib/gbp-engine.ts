// ── lib/gbp-engine.ts — Sprint 32 (renforcement) ─────────────────────────────
//
// Helpers PURS (zéro I/O, zéro D1, zéro fetch) extraits/dérivés de gbp.ts +
// gbp-client.ts pour rendre la logique de mapping/validation testable
// indépendamment des appels REST Google Business Profile.
//
// CONTENU :
//   - GBP_ERROR_CODES                 (codes erreur stables exposés handlers)
//   - GBP_METRICS_WHITELIST           (métriques Performance API v1 acceptées)
//   - GBP_MAX_REPLY_LENGTH            (4096 chars — limite Google)
//   - GBP_MAX_POST_SUMMARY_LENGTH     (1500 chars — limite localPosts API)
//   - GBP_MAX_DATE_RANGE_DAYS         (540 j — limite Performance API)
//   - mapStarRating()                  (Google enum FIVE → 5, UNSPECIFIED → null)
//   - validateReplyComment()           (1..4096 + sanitize XSS basic)
//   - validateLocalPostPayload()       (summary 1..1500 + topicType + CTA + media)
//   - validateMetricsList()            (filter whitelist GBP metrics)
//   - parseGbpDateRange()              (ISO valid + end > start + ≤ 540 j)
//   - mapConnectionRow()               (D1 row gbp_connections → GbpConnection DTO)
//
// AUCUNE dépendance Worker (Env, D1, fetch) → 100 % unit-testable.
// Aucune dépendance externe : ce fichier est self-contained.

// ════════════════════════════════════════════════════════════
//  TYPES (miroir gbp.ts — exportés ici pour réutilisation)
// ════════════════════════════════════════════════════════════

/** Mapped row gbp_connections → réponse front (calque gbp.ts:GbpConnection). */
export interface GbpConnection {
  id: string;
  clientId: string | null;
  agencyId: string | null;
  oauthConnectionId: string | null;
  gbpAccountId: string | null;
  gbpAccountName: string | null;
  status: string;
  lastSyncAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ════════════════════════════════════════════════════════════
//  CONSTANTES
// ════════════════════════════════════════════════════════════

/**
 * Codes erreur stables exposés à l'API (json error.code) et aux logs.
 * Alignés sur les codes déjà utilisés dans gbp.ts. NE PAS renommer — les
 * UI / dashboards / alertes matchent dessus.
 */
export const GBP_ERROR_CODES = {
  GBP_NOT_CONNECTED: 'GBP_NOT_CONNECTED',
  GBP_API_ERROR: 'GBP_API_ERROR',
  GBP_REVIEW_NOT_FOUND: 'GBP_REVIEW_NOT_FOUND',
  GBP_LOCATION_NOT_FOUND: 'GBP_LOCATION_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type GbpErrorCode = (typeof GBP_ERROR_CODES)[keyof typeof GBP_ERROR_CODES];

/**
 * Whitelist des métriques acceptées par Business Profile Performance API v1
 * (fetchMultiDailyMetricsTimeSeries). Toute métrique hors-liste est filtrée
 * silencieusement par validateMetricsList() pour éviter un 400 Google.
 *
 * Source : https://developers.google.com/my-business/reference/performance/rest/v1/DailyMetric
 */
export const GBP_METRICS_WHITELIST: readonly string[] = Object.freeze([
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_FOOD_ORDERS',
  'BUSINESS_FOOD_MENU_CLICKS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
]);

/** Topic types acceptés par l'API localPosts (POST /v4/locations/{l}/localPosts). */
export const GBP_LOCAL_POST_TOPIC_TYPES: readonly string[] = Object.freeze([
  'STANDARD',
  'EVENT',
  'OFFER',
  'ALERT',
]);

/** Longueur max d'une réponse à un avis Google (limite Google). */
export const GBP_MAX_REPLY_LENGTH = 4096 as const;

/** Longueur max d'un summary de localPost (limite Google API localPosts). */
export const GBP_MAX_POST_SUMMARY_LENGTH = 1500 as const;

/** Fenêtre max acceptée par Performance API v1 (≈ 18 mois de données). */
export const GBP_MAX_DATE_RANGE_DAYS = 540 as const;

// ════════════════════════════════════════════════════════════
//  mapStarRating
// ════════════════════════════════════════════════════════════

/**
 * Parse l'enum Google starRating → entier 1..5 ou null (UNSPECIFIED/absent).
 *
 * Google renvoie : 'STAR_RATING_UNSPECIFIED' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE'
 * Le mapping est défensif : tout input invalide → null (pas de throw, calque
 * la philosophie best-effort des handlers).
 */
export function mapStarRating(
  googleEnum: string | null | undefined,
): 1 | 2 | 3 | 4 | 5 | null {
  if (!googleEnum) return null;
  const map: Record<string, 1 | 2 | 3 | 4 | 5> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };
  return map[googleEnum] ?? null;
}

// ════════════════════════════════════════════════════════════
//  validateReplyComment
// ════════════════════════════════════════════════════════════

/**
 * Valide un commentaire de réponse à un avis Google.
 *
 * Règles :
 *   - non vide après trim (length ≥ 1)
 *   - length ≤ GBP_MAX_REPLY_LENGTH (4096)
 *   - sanitize basique : strip balises `<script>` / `<iframe>` (XSS basic)
 *     pour éviter qu'un texte malveillant se retrouve affiché brut côté UI
 *     dashboard. Google de son côté affiche le texte brut, donc on garde
 *     l'intention user mais on neutralise les vecteurs HTML les plus connus.
 */
export function validateReplyComment(
  comment: string | null | undefined,
): { ok: boolean; sanitized?: string; error?: string; code?: GbpErrorCode } {
  if (comment == null) {
    return {
      ok: false,
      error: 'comment requis',
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  const trimmed = String(comment).trim();
  if (trimmed.length < 1) {
    return {
      ok: false,
      error: 'comment requis (1 caractère minimum)',
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  if (trimmed.length > GBP_MAX_REPLY_LENGTH) {
    return {
      ok: false,
      error: `comment trop long (${trimmed.length} > ${GBP_MAX_REPLY_LENGTH})`,
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  // Sanitize basique : strip <script>...</script> et <iframe>...</iframe>
  // (case-insensitive, multi-ligne). On NE strip pas tout le HTML — Google
  // affiche le texte brut, le sanitize est pour notre UI dashboard interne.
  const sanitized = trimmed
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<\/?(?:script|iframe)\b[^>]*>/gi, '');
  return { ok: true, sanitized };
}

// ════════════════════════════════════════════════════════════
//  validateLocalPostPayload
// ════════════════════════════════════════════════════════════

/**
 * Valide le payload d'un localPost avant envoi à l'API GBP.
 *
 * Règles :
 *   - summary requis, 1..GBP_MAX_POST_SUMMARY_LENGTH (1500)
 *   - topicType ∈ GBP_LOCAL_POST_TOPIC_TYPES (défaut STANDARD si absent)
 *   - callToAction.actionType requis si callToAction fourni
 *   - callToAction.url valide URL http(s) si fourni
 *   - mediaUrl valide URL http(s) si fourni
 */
export function validateLocalPostPayload(payload: {
  summary?: string | null;
  topicType?: string | null;
  callToAction?: { actionType?: string | null; url?: string | null } | null;
  mediaUrl?: string | null;
}): { ok: boolean; error?: string; code?: GbpErrorCode } {
  // summary
  if (payload.summary == null) {
    return {
      ok: false,
      error: 'summary requis',
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  const summary = String(payload.summary).trim();
  if (summary.length < 1) {
    return {
      ok: false,
      error: 'summary requis (1 caractère minimum)',
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  if (summary.length > GBP_MAX_POST_SUMMARY_LENGTH) {
    return {
      ok: false,
      error: `summary trop long (${summary.length} > ${GBP_MAX_POST_SUMMARY_LENGTH})`,
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  // topicType (optionnel, défaut STANDARD)
  if (payload.topicType != null) {
    const tt = String(payload.topicType).toUpperCase();
    if (!GBP_LOCAL_POST_TOPIC_TYPES.includes(tt)) {
      return {
        ok: false,
        error: `topicType invalide (${GBP_LOCAL_POST_TOPIC_TYPES.join('|')})`,
        code: GBP_ERROR_CODES.INVALID_INPUT,
      };
    }
  }
  // callToAction (optionnel)
  if (payload.callToAction != null) {
    if (!payload.callToAction.actionType) {
      return {
        ok: false,
        error: 'callToAction.actionType requis si callToAction fourni',
        code: GBP_ERROR_CODES.INVALID_INPUT,
      };
    }
    if (payload.callToAction.url != null && !isValidHttpUrl(payload.callToAction.url)) {
      return {
        ok: false,
        error: 'callToAction.url invalide (http/https attendu)',
        code: GBP_ERROR_CODES.INVALID_INPUT,
      };
    }
  }
  // mediaUrl (optionnel)
  if (payload.mediaUrl != null && payload.mediaUrl !== '') {
    if (!isValidHttpUrl(payload.mediaUrl)) {
      return {
        ok: false,
        error: 'mediaUrl invalide (http/https attendu)',
        code: GBP_ERROR_CODES.INVALID_INPUT,
      };
    }
  }
  return { ok: true };
}

// Helper interne : valide qu'une string est une URL http(s) parseable.
function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════
//  validateMetricsList
// ════════════════════════════════════════════════════════════

/**
 * Filtre une liste de métriques user-fournies → ne conserve que celles
 * présentes dans GBP_METRICS_WHITELIST. Renvoie un nouveau tableau (immutable).
 *
 * Anti-abuse : protège contre des requêtes Google rejetées en 400 (métriques
 * inconnues) ET contre l'enrichissement d'audit avec des chaînes arbitraires.
 * Si le filtre vide la liste, l'appelant doit gérer (typiquement : fallback
 * sur les 4 métriques par défaut du handler).
 */
export function validateMetricsList(
  metrics: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  if (!metrics || !Array.isArray(metrics)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of metrics) {
    if (m == null) continue;
    const norm = String(m).trim().toUpperCase();
    if (!norm) continue;
    if (!GBP_METRICS_WHITELIST.includes(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

// ════════════════════════════════════════════════════════════
//  parseGbpDateRange
// ════════════════════════════════════════════════════════════

/**
 * Valide une fenêtre temporelle pour Performance API.
 *
 * Règles :
 *   - startTime + endTime ISO 8601 parseables
 *   - endTime > startTime (strict)
 *   - (endTime - startTime) ≤ GBP_MAX_DATE_RANGE_DAYS (540 j)
 *
 * Renvoie { valid, days, error? } où days = nombre de jours calendaires
 * (arrondi haut, basé sur diff ms / 86 400 000).
 */
export function parseGbpDateRange(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): { valid: boolean; days: number; error?: string; code?: GbpErrorCode } {
  if (!startTime || !endTime) {
    return {
      valid: false,
      days: 0,
      error: 'startTime et endTime requis (ISO 8601)',
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return {
      valid: false,
      days: 0,
      error: 'startTime/endTime invalides (ISO 8601 attendu)',
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) {
    return {
      valid: false,
      days: 0,
      error: 'endTime doit être strictement postérieur à startTime',
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  const days = Math.ceil(diffMs / 86_400_000);
  if (days > GBP_MAX_DATE_RANGE_DAYS) {
    return {
      valid: false,
      days,
      error: `fenêtre trop large (${days} > ${GBP_MAX_DATE_RANGE_DAYS} jours)`,
      code: GBP_ERROR_CODES.INVALID_INPUT,
    };
  }
  return { valid: true, days };
}

// ════════════════════════════════════════════════════════════
//  mapConnectionRow
// ════════════════════════════════════════════════════════════

/**
 * Adapter D1 row gbp_connections → GbpConnection DTO (camelCase, défensif).
 *
 * Identique à la version privée de gbp.ts mais exporté ici pour réutilisation
 * (tests + autres modules). gbp.ts peut importer cette version (ré-export).
 */
export function mapConnectionRow(r: Record<string, unknown>): GbpConnection {
  return {
    id: String(r.id ?? ''),
    clientId: (r.client_id as string | null) ?? null,
    agencyId: (r.agency_id as string | null) ?? null,
    oauthConnectionId: (r.oauth_connection_id as string | null) ?? null,
    gbpAccountId: (r.gbp_account_id as string | null) ?? null,
    gbpAccountName: (r.gbp_account_name as string | null) ?? null,
    status: String(r.status ?? 'active'),
    lastSyncAt: (r.last_sync_at as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}
