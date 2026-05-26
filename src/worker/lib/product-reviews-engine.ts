// ── Product reviews engine — Sprint 40 renforcement (2026-05-26) ───────────
//
// Helpers PURS (zéro D1, zéro réseau) extraits de `product-reviews.ts` pour :
//   - centraliser la validation input (stars/body/photo_url) avec codes
//     d'erreur stables, ré-utilisable depuis n'importe quel call site
//     (handler PUBLIC submit, futur endpoint admin POST review, scripts CLI).
//   - sanitiser le body avis (defense-in-depth XSS — calque
//     `lib/community-engine.sanitizeBody`).
//   - calculer l'agrégat rating storefront (avg + count + distribution
//     stars 1..5) sans recourir à AVG/COUNT SQL si on a déjà la liste en RAM
//     (BulkOps, cron de re-aggregation, tests).
//   - whitelister actions de modération + photos URL.
//
// Politique :
//   - Aucun helper ne throw — toutes les fonctions retournent un résultat
//     structuré (`{ ok, error?, code? }`) ou un boolean (calque
//     `lib/loyalty-engine.ts` + `lib/community-engine.ts`).
//   - Codes d'erreur stables (`PRODUCT_REVIEWS_ERROR_CODES`) pour log / audit /
//     assertions tests — JAMAIS exposés tels quels au client (handler garde
//     son contrat `{ error: '...' }` figé — voir `product-reviews.ts:20`).
//   - 100% additif : signatures handlers `product-reviews.ts` figées,
//     le refactor remplace UNIQUEMENT le bloc validation par un appel à
//     `validateReviewInput` quand pertinent (mapping vers `{ error }` legacy
//     préservé).
//   - JAMAIS log le body sanitizé ni les mots détectés (XSS body peut contenir
//     PII / Loi 25 — calque `lib/review-moderation.containsBadWords`).

/** Bornes longueur body (calque limite handler existant 10/2000). */
export const MIN_BODY_LENGTH = 10;
export const MAX_BODY_LENGTH = 2000;

/** Étoiles valides — set FIGÉ (entier strict 1..5, refuse float/0/6+). */
export const VALID_STARS: readonly number[] = [1, 2, 3, 4, 5];
const VALID_STARS_SET = new Set<number>(VALID_STARS);

/** Bornes titre/photos optionnels (alignées handler). */
export const MAX_TITLE_LENGTH = 200;
export const MAX_PHOTO_URL_LENGTH = 2048;
export const MAX_PHOTOS_PER_REVIEW = 10;

/** Whitelist actions modération (handler + admin UI). */
export const VALID_MODERATION_ACTIONS: readonly string[] = [
  'approve',
  'reject',
  'flag',
  'delete',
];
const VALID_MODERATION_ACTIONS_SET = new Set<string>(VALID_MODERATION_ACTIONS);

/** Whitelist extensions photo (lowercase, sans le point). */
const VALID_PHOTO_EXTENSIONS = new Set<string>(['jpg', 'jpeg', 'png', 'webp']);

// ── Codes d'erreur stables (logs + audit + assertions tests) ────────────────
// NB : le handler `product-reviews.ts` retourne toujours `{ error: '...' }`
// FR-locale (contrat S40 GELÉ). Ces codes servent à :
//   - audit_log.payload.error_code
//   - assertions tests
//   - éventuel logger.warn structuré
export const PRODUCT_REVIEWS_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_STARS: 'INVALID_STARS',
  BODY_TOO_SHORT: 'BODY_TOO_SHORT',
  BODY_TOO_LONG: 'BODY_TOO_LONG',
  INVALID_PHOTO_URL: 'INVALID_PHOTO_URL',
  INVALID_MODERATION_ACTION: 'INVALID_MODERATION_ACTION',
  REPLY_ALREADY_EXISTS: 'REPLY_ALREADY_EXISTS',
  REPLY_FORBIDDEN: 'REPLY_FORBIDDEN',
} as const;

export type ProductReviewsErrorCode =
  (typeof PRODUCT_REVIEWS_ERROR_CODES)[keyof typeof PRODUCT_REVIEWS_ERROR_CODES];

/** Résultat validation input avis (PUR, pas de D1). */
export interface ReviewValidationResult {
  ok: boolean;
  /** Message FR court (réutilisable directement en `{ error: ... }`). */
  error?: string;
  /** Code stable (audit/log/tests). */
  code?: ProductReviewsErrorCode;
  /** Données normalisées (post-trim/slice/round) — seulement si ok=true. */
  data?: {
    stars: number;
    body: string;
    photo_url: string | null;
  };
}

/** Agrégat rating (storefront listing + bordereau client). */
export interface AggregateRating {
  /** Moyenne pondérée 0..5, deux décimales (rounded). 0 si aucun avis. */
  avg: number;
  /** Nombre total d'avis comptés dans `distribution`. */
  count: number;
  /** Distribution indexée 0..4 → étoiles 1..5 (distribution[0] = nb 1★). */
  distribution: [number, number, number, number, number];
}

/** Shape minimale d'un avis pour `computeAggregateRating`. */
export interface ReviewLike {
  /** Étoiles — sera coercé via Number() puis validé via VALID_STARS_SET. */
  rating?: number | string | null;
  /** Alias accepté pour Compat handler legacy (le code utilise `rating`,
   *  mais le brief réfère "stars" — on accepte les deux pour éviter trap). */
  stars?: number | string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION INPUT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Valide un input avis avant INSERT. PUR.
 *
 * Règles :
 *   - `stars`     : entier strict ∈ {1,2,3,4,5}. Rejette float (3.5),
 *                   0, 6+, NaN, string non-numérique. Accepte string
 *                   numérique entière ("5").
 *   - `body`      : 10..2000 chars POST-trim POST-sanitize. Vide ou
 *                   trop court ⇒ BODY_TOO_SHORT. Trop long ⇒ BODY_TOO_LONG
 *                   (PAS de truncate silencieux côté validation — explicite).
 *   - `photo_url` : optionnel (null/undefined OK). Si fourni, doit passer
 *                   `isValidPhotoUrl` (https + ext jpg/jpeg/png/webp).
 *
 * Retourne `{ ok: true, data: { stars, body, photo_url } }` avec body
 * sanitizé+trim, ou `{ ok: false, error, code }`.
 *
 * Contrat FIGÉ : validateReviewInput(input)
 *   -> { ok; error?; code?; data? }.
 */
export function validateReviewInput(
  input: unknown,
): ReviewValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Input invalide',
      code: PRODUCT_REVIEWS_ERROR_CODES.INVALID_INPUT,
    };
  }
  const obj = input as Record<string, unknown>;

  // ── 1) Stars (entier strict 1..5)
  const rawStars = obj.stars;
  const starsNum = typeof rawStars === 'string'
    ? Number(rawStars)
    : (typeof rawStars === 'number' ? rawStars : NaN);
  if (
    !Number.isFinite(starsNum) ||
    !Number.isInteger(starsNum) ||
    !VALID_STARS_SET.has(starsNum)
  ) {
    return {
      ok: false,
      error: 'Note invalide (1-5)',
      code: PRODUCT_REVIEWS_ERROR_CODES.INVALID_STARS,
    };
  }

  // ── 2) Body (10..2000 post-sanitize-trim)
  const rawBody = typeof obj.body === 'string' ? obj.body : '';
  const sanitized = sanitizeReviewBody(rawBody).trim();
  if (sanitized.length === 0 || sanitized.length < MIN_BODY_LENGTH) {
    return {
      ok: false,
      error: `Corps trop court (${MIN_BODY_LENGTH} min)`,
      code: PRODUCT_REVIEWS_ERROR_CODES.BODY_TOO_SHORT,
    };
  }
  if (sanitized.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      error: `Corps trop long (${MAX_BODY_LENGTH} max)`,
      code: PRODUCT_REVIEWS_ERROR_CODES.BODY_TOO_LONG,
    };
  }

  // ── 3) Photo URL (optionnel)
  let photoUrl: string | null = null;
  const rawPhoto = obj.photo_url;
  if (typeof rawPhoto === 'string' && rawPhoto.trim().length > 0) {
    const trimmed = rawPhoto.trim();
    if (!isValidPhotoUrl(trimmed)) {
      return {
        ok: false,
        error: 'URL photo invalide (https + jpg/png/webp uniquement)',
        code: PRODUCT_REVIEWS_ERROR_CODES.INVALID_PHOTO_URL,
      };
    }
    photoUrl = trimmed;
  } else if (rawPhoto !== undefined && rawPhoto !== null && typeof rawPhoto !== 'string') {
    // Type inattendu (number, object) ⇒ rejet explicite.
    return {
      ok: false,
      error: 'URL photo invalide',
      code: PRODUCT_REVIEWS_ERROR_CODES.INVALID_PHOTO_URL,
    };
  }

  return {
    ok: true,
    data: {
      stars: starsNum,
      body: sanitized,
      photo_url: photoUrl,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SANITIZATION HTML (defense-in-depth XSS — calque community-engine.sanitizeBody)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Strip les vecteurs XSS dangereux d'un body avis utilisateur.
 *
 * Approche : strip aggressif (PAS d'allowlist DOM — Worker n'a pas DOMParser).
 *   - `<script>` ... `</script>` et `<script ... />` retirés.
 *   - `<iframe>`, `<object>`, `<embed>`, `<style>`, `<link>`, `<meta>`,
 *     `<base>`, `<form>` retirés.
 *   - Attributs handlers `on*=` (onclick, onerror, onload, etc.) retirés.
 *   - Protocoles dangereux `javascript:` / `vbscript:` retirés (les `data:`
 *     orphelins préservés — image inline markdown légitime).
 *
 * PUR — pas de D1, pas de réseau, idempotent. Calque
 * `lib/community-engine.sanitizeBody` (Sprint 45 Phase B+). Best-effort sur
 * input non-string (retourne '').
 *
 * NB : ne fait PAS d'escape HTML global — le frontend rend en markdown / `<pre>`
 * (escape React déjà géré). Cette fonction = couche backend défense-en-profondeur.
 *
 * Contrat FIGÉ : sanitizeReviewBody(body) -> string.
 */
export function sanitizeReviewBody(body: unknown): string {
  if (typeof body !== 'string' || body.length === 0) return '';

  let s = body;

  // 1) Strip <script> blocks (avec contenu).
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  // 2) Strip <script> self-closing ou orphelin.
  s = s.replace(/<script\b[^>]*\/?>/gi, '');
  // 3) Strip blocs <iframe>/<object>/<embed>/<style>/<link>/<meta>/<base>/<form>.
  s = s.replace(
    /<(iframe|object|embed|style|link|meta|base|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  s = s.replace(
    /<(iframe|object|embed|style|link|meta|base|form)\b[^>]*\/?>/gi,
    '',
  );
  // 4) Strip handlers `on*=...` (onclick, onerror, onload, etc.).
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // 5) Strip protocoles dangereux dans href/src/action.
  s = s.replace(
    /(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(?:javascript|vbscript|file)\s*:[^"'>\s]*\2/gi,
    '$1=$2#$2',
  );
  // 6) Strip protocoles orphelins (text plain, CSS).
  s = s.replace(/javascript\s*:/gi, '');
  s = s.replace(/vbscript\s*:/gi, '');

  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// AGRÉGATION RATING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Calcule `avg + count + distribution` pour une liste d'avis. PUR.
 *
 * Comportement :
 *   - Ignore avis avec `rating` (ou `stars`) hors `VALID_STARS_SET` (entier
 *     1..5). Float / 0 / 6+ / NaN / null / string non-num ⇒ skip silencieux.
 *   - `avg` arrondi à 2 décimales (réutilisable directement en `aria-label`
 *     storefront — calque Octoperf review aggregation).
 *   - `distribution[i]` = nombre d'avis avec rating === (i+1). Index 0 = 1★,
 *     index 4 = 5★.
 *   - Aucun avis valide ⇒ `{ avg: 0, count: 0, distribution: [0,0,0,0,0] }`.
 *
 * Contrat FIGÉ : computeAggregateRating(reviews) -> AggregateRating.
 */
export function computeAggregateRating(
  reviews: readonly ReviewLike[] | null | undefined,
): AggregateRating {
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;

  if (!reviews || !Array.isArray(reviews)) {
    return { avg: 0, count: 0, distribution };
  }

  for (const r of reviews) {
    if (!r || typeof r !== 'object') continue;
    const raw = r.rating ?? r.stars;
    const n = typeof raw === 'string' ? Number(raw) : (typeof raw === 'number' ? raw : NaN);
    if (!Number.isFinite(n) || !Number.isInteger(n) || !VALID_STARS_SET.has(n)) continue;
    sum += n;
    count += 1;
    // n ∈ {1..5} garanti par VALID_STARS_SET → index 0..4 safe sur tuple.
    const idx = n - 1;
    const prev = distribution[idx] ?? 0;
    distribution[idx as 0 | 1 | 2 | 3 | 4] = prev + 1;
  }

  const avg = count === 0 ? 0 : Math.round((sum / count) * 100) / 100;
  return { avg, count, distribution };
}

// ════════════════════════════════════════════════════════════════════════════
// PHOTO URL WHITELIST
// ════════════════════════════════════════════════════════════════════════════

/**
 * Valide une URL photo : https UNIQUEMENT + extension jpg/jpeg/png/webp.
 *
 * Garde-fous :
 *   - Type string non vide, ≤ MAX_PHOTO_URL_LENGTH (anti-DoS storage).
 *   - URL parseable via `new URL()` (rejet espaces, malformés, protocoles
 *     custom).
 *   - Protocole strict `https:` (rejet http, data:, javascript:, file:, ftp).
 *   - Pathname se termine par .jpg/.jpeg/.png/.webp (case-insensitive).
 *     Query string (?w=200) toléré (extension lookup se fait sur pathname,
 *     pas sur href). Pas de query "?ext=.exe" exploit.
 *
 * Refuse :
 *   - http (insecure), data: (XSS vecteur via SVG), file: (LFI),
 *     ftp/ws/wss (protocole non-CDN).
 *   - Extensions .exe/.svg/.gif/.bmp/.tiff/.avif (sécurité + standardisation).
 *   - .svg refusé : peut contenir `<script>` malgré ext "image".
 *
 * Contrat FIGÉ : isValidPhotoUrl(url) -> boolean.
 */
export function isValidPhotoUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PHOTO_URL_LENGTH) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  // Extension sur pathname (ignore query string).
  const path = parsed.pathname.toLowerCase();
  const dotIdx = path.lastIndexOf('.');
  if (dotIdx < 0 || dotIdx === path.length - 1) return false;
  const ext = path.slice(dotIdx + 1);
  return VALID_PHOTO_EXTENSIONS.has(ext);
}

// ════════════════════════════════════════════════════════════════════════════
// POLITIQUE REPLY MERCHANT (PUR — single reply rule)
// ════════════════════════════════════════════════════════════════════════════

/** Shape minimale d'un avis pour `canReply` (statut + product_id check). */
export interface ReviewForReply {
  status?: string | null;
}

/**
 * Décide si un merchant peut poster une réponse à un avis.
 *
 * Règles (ordre compte) :
 *   1. Pas admin ⇒ false (REPLY_FORBIDDEN — seul admin tenant peut répondre).
 *   2. Avis introuvable / null ⇒ false.
 *   3. Avis status !== 'approved' ⇒ false (pas de reply sur
 *      pending/rejected/flagged — éviter exposer brouillons).
 *   4. Reply existante ⇒ false (single response per review — anti-dialogue
 *      infini, calque pattern Amazon/Trustpilot).
 *   5. Sinon ⇒ true.
 *
 * NB : la fonction NE crée PAS la reply ni ne vérifie le tenant — c'est au
 * handler de borner `WHERE client_id = ?`. Helper pur = juste la POLITIQUE.
 *
 * Contrat FIGÉ : canReply(review, isAdmin, hasExistingReply) -> boolean.
 */
export function canReply(
  review: ReviewForReply | null | undefined,
  isAdmin: boolean,
  hasExistingReply: boolean,
): boolean {
  if (!isAdmin) return false;
  if (!review || typeof review !== 'object') return false;
  if (review.status !== 'approved') return false;
  if (hasExistingReply) return false;
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// MODÉRATION — whitelist actions
// ════════════════════════════════════════════════════════════════════════════

/**
 * Whitelist actions de modération admin (approve|reject|flag|delete).
 *
 * Refuse tout action hors whitelist (ex: 'delete_all', 'unflag', 'bulk_approve',
 * SQL injection 'approve OR 1=1'). PUR — pas d'I/O.
 *
 * NB : le handler `handleModerateReview` ne supporte actuellement que
 * approve|reject|flag (pas delete — qui passe par `handleDeleteReview` DELETE
 * dédié). Cette whitelist couvre les 4 actions pour usage générique (audit
 * filter, UI dropdown, futur bulk endpoint).
 *
 * Contrat FIGÉ : validateModerationAction(action) -> boolean.
 */
export function validateModerationAction(action: unknown): boolean {
  if (typeof action !== 'string') return false;
  return VALID_MODERATION_ACTIONS_SET.has(action);
}
