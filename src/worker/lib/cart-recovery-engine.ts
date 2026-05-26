// ── Cart recovery engine — pure helpers (Sprint 40 hardening — 2026-05-26) ──
//
// Helpers PURS extraits depuis `abandoned-carts.ts` + `lib/abandoned-cart-
// recovery.ts` pour faciliter tests unitaires, réutilisation cross-handler, et
// audit cross-tenant. AUCUN appel D1 / fetch / I/O ici — tout est synchrone
// et déterministe (sauf RNG via crypto.getRandomValues pour codes/tokens).
//
// 100% ADDITIF :
//   - NE TOUCHE PAS `abandoned-cart-recovery.ts` (Sprint 40 Phase B, sequence
//     multi-touch live avec D1).
//   - NE TOUCHE PAS `ecommerce-cart-recovery.ts` (Sprint E7 single-touch
//     legacy, colonne `recovered_at`).
//
// Contrats stables :
//   - `CART_RECOVERY_DELAYS_MIN` : [60, 1440, 4320] (step 1/2/3 = 1h/24h/72h)
//   - `MAX_RECOVERY_STEPS` : 3
//   - `CART_RECOVERY_ERROR_CODES` : codes stables pour API/UI surface
//   - `getNextRecoveryStep` : calcule prochaine étape éligible
//   - `generateCouponCode` : `CART-XXXXXX` 6 hex uppercase
//   - `generateCartToken` : 32 chars base64url unique
//   - `isRecoveryEligible` : audit completed / expired / opt-in / status
//   - `shouldEscalateToHuman` : 3+ tentatives sans click
//   - `parseRecoveryAttempts` : safe parse + validation shape

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Délais minutes entre touches de la séquence multi-touch (FIGÉS seq135).
 *
 * Index 0 = step 1 (1h après abandon), index 1 = step 2 (24h après step 1),
 * index 2 = step 3 (72h après step 2). Total fenêtre = 4380 minutes ≈ 73h.
 *
 * Tuple `as const readonly` pour TS strict (immuable au type-level).
 */
export const CART_RECOVERY_DELAYS_MIN = [60, 1440, 4320] as const;

/** Nombre max d'étapes de relance (après step 3, la séquence est terminée). */
export const MAX_RECOVERY_STEPS = 3;

/**
 * Fenêtre d'expiration absolue depuis l'abandon : au-delà, plus aucune relance
 * n'est éligible (cart considéré "froid"). Égal à la somme des délais = 72h
 * après step 2 = 73h après abandon. Volontairement aligné sur step 3 + buffer.
 */
export const CART_RECOVERY_EXPIRY_MIN =
  CART_RECOVERY_DELAYS_MIN[0] +
  CART_RECOVERY_DELAYS_MIN[1] +
  CART_RECOVERY_DELAYS_MIN[2];

/**
 * Seuil d'escalade humain : si N tentatives ont été envoyées et qu'AUCUNE
 * n'a été cliquée, on considère le cart "non récupérable automatiquement"
 * et on flag pour intervention manuelle (admin dashboard).
 */
export const HUMAN_ESCALATION_THRESHOLD = 3;

/**
 * Codes d'erreur STABLES exposés côté API/UI. Toute string ici est un contrat
 * public — NE PAS RENOMMER sans bump majeur. UI/intl peut mapper sur ces clés.
 */
export const CART_RECOVERY_ERROR_CODES = {
  CART_NOT_FOUND: 'CART_NOT_FOUND',
  CART_TOKEN_INVALID: 'CART_TOKEN_INVALID',
  RECOVERY_COMPLETED: 'RECOVERY_COMPLETED',
  RECOVERY_EXPIRED: 'RECOVERY_EXPIRED',
  RECOVERY_OPTIN_REQUIRED: 'RECOVERY_OPTIN_REQUIRED',
  RECOVERY_STEP_INVALID: 'RECOVERY_STEP_INVALID',
  RECOVERY_STEP_NOT_SENT: 'RECOVERY_STEP_NOT_SENT',
  RECOVERY_MAX_STEPS_REACHED: 'RECOVERY_MAX_STEPS_REACHED',
  RECOVERY_STATUS_INVALID: 'RECOVERY_STATUS_INVALID',
} as const;

export type CartRecoveryErrorCode =
  (typeof CART_RECOVERY_ERROR_CODES)[keyof typeof CART_RECOVERY_ERROR_CODES];

// ── Types ──────────────────────────────────────────────────────────────────

export type RecoveryStep = 1 | 2 | 3;
export type RecoveryChannel = 'email' | 'sms';

export interface RecoveryAttempt {
  step: RecoveryStep;
  channel: RecoveryChannel;
  ts: string;
  coupon_code: string | null;
  opened_at: string | null;
  clicked_at: string | null;
}

/** Shape minimale d'un cart pour les helpers d'éligibilité. */
export interface CartEligibilityInput {
  status?: string | null;
  email_optin?: boolean | number | null;
  abandoned_at?: string | null;
  last_recovery_at?: string | null;
  recovery_email_sent_count?: number | null;
  recovery_completed_at?: string | null;
}

export interface NextRecoveryStep {
  /** Prochaine étape éligible (1..3) ou null si séquence terminée. */
  step: RecoveryStep | null;
  /** True si cart éligible IMMÉDIATEMENT (now ≥ nextDueAt). */
  eligible: boolean;
  /**
   * Date ISO 8601 (UTC, suffix `Z`) à laquelle la prochaine touche devient
   * éligible. Null si séquence terminée (step=null) OU si éligible immédiat
   * (jamais envoyé encore, ou lastRecoveryAt absent).
   */
  nextDueAt: string | null;
}

export interface EligibilityVerdict {
  eligible: boolean;
  /** Code d'erreur stable si !eligible, sinon undefined. */
  reason?: CartRecoveryErrorCode;
}

// ── Helper : parseTimestamp (SQLite datetime → epoch ms) ───────────────────

/**
 * Parse un timestamp SQLite `YYYY-MM-DD HH:MM:SS` (UTC) OU ISO 8601 vers
 * epoch ms. Retourne NaN si invalide (jamais throw). Tolère les deux formats
 * pour cohérence avec datetime('now') (SQLite) vs new Date().toISOString().
 */
export function parseRecoveryTimestamp(raw: string | null | undefined): number {
  if (!raw) return NaN;
  const s = raw.toString().trim();
  if (!s) return NaN;
  // SQLite "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SSZ" pour Date.parse fiable.
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

// ── 1. getNextRecoveryStep ─────────────────────────────────────────────────

/**
 * Calcule la prochaine étape de relance éligible.
 *
 * Logique :
 *   - currentStep ≥ MAX_RECOVERY_STEPS ⇒ séquence terminée, step=null.
 *   - currentStep < 0 ou non-fini ⇒ clamp à 0 (treat as never sent).
 *   - currentStep = 0 ⇒ step 1 ; éligible immédiat (lastRecoveryAt ignoré).
 *   - currentStep ≥ 1 ET lastRecoveryAt absent ⇒ état incohérent, on traite
 *     comme éligible immédiat (best-effort, le cron a déjà skip via SELECT).
 *   - currentStep ≥ 1 ET lastRecoveryAt valide ⇒ nextDueAt = last + delay[next];
 *     éligible si now ≥ nextDueAt.
 *
 * Pure : aucun appel D1, déterministe modulo `nowDate`.
 */
export function getNextRecoveryStep(
  lastRecoveryAt: string | null | undefined,
  currentStep: number | null | undefined,
  nowDate: Date,
): NextRecoveryStep {
  const cur = clampStepCount(currentStep);
  if (cur >= MAX_RECOVERY_STEPS) {
    return { step: null, eligible: false, nextDueAt: null };
  }

  const nextStep = (cur + 1) as RecoveryStep;
  const delayMin = CART_RECOVERY_DELAYS_MIN[nextStep - 1] ?? 0;

  // Step 1 (cur=0) ou état incohérent (cur≥1 sans last) ⇒ éligible immédiat.
  if (cur === 0 || !lastRecoveryAt) {
    return { step: nextStep, eligible: true, nextDueAt: null };
  }

  const lastMs = parseRecoveryTimestamp(lastRecoveryAt);
  if (!Number.isFinite(lastMs)) {
    // Timestamp invalide : fallback éligible immédiat (audit log côté caller).
    return { step: nextStep, eligible: true, nextDueAt: null };
  }

  const dueMs = lastMs + delayMin * 60_000;
  const nowMs = nowDate.getTime();
  const eligible = nowMs >= dueMs;

  return {
    step: nextStep,
    eligible,
    nextDueAt: new Date(dueMs).toISOString(),
  };
}

/** Clamp + coerce le compteur (anti-NaN/négatif). */
function clampStepCount(v: number | null | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_RECOVERY_STEPS, Math.floor(n));
}

// ── 2. generateCouponCode ──────────────────────────────────────────────────

/**
 * Génère un code coupon `PREFIX-XXXXXX` (6 hex uppercase aléatoires).
 *
 * Format : `CART-A3F9B2` (default prefix `CART`). Prefix custom autorisé
 * (`REC`, `WELCOME`, etc.) — uppercase forcé, alphanumeric+hyphen only.
 * Uniformité 16^6 ≈ 16.7M combinaisons, collision <10^-6 sur 100 codes.
 *
 * Utilise crypto.getRandomValues (Web Crypto API, dispo en Workers + Node 20+).
 * Pure modulo le RNG.
 */
export function generateCouponCode(prefix: string = 'CART'): string {
  const safePrefix = sanitizePrefix(prefix);
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    hex += b.toString(16).padStart(2, '0');
  }
  return `${safePrefix}-${hex.toUpperCase()}`;
}

/** Sanitize prefix : uppercase, [A-Z0-9] only, max 12 chars, fallback 'CART'. */
function sanitizePrefix(prefix: string): string {
  const cleaned = (prefix || '')
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return cleaned || 'CART';
}

// ── 3. generateCartToken ───────────────────────────────────────────────────

/**
 * Génère un token cart URL-safe (base64url) de 32 caractères.
 *
 * 24 bytes d'entropie ⇒ 32 chars base64url (24 * 4/3 = 32). Collision
 * effectivement nulle (~10^-29 sur 10^9 tokens). URL-safe : caractères
 * `A-Za-z0-9-_` uniquement (pas de `+`, `/`, `=`).
 *
 * Utilise crypto.getRandomValues. Pure modulo le RNG.
 */
export function generateCartToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** Convert Uint8Array → base64url string (URL-safe, no padding). */
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] ?? 0);
  }
  // btoa : standard base64 ; on remplace pour URL-safe + strip padding.
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// ── 4. isRecoveryEligible ──────────────────────────────────────────────────

/**
 * Audit d'éligibilité globale d'un cart pour la séquence de récupération.
 *
 * Checks (ordre prioritaire) :
 *   1. recovery_completed_at posé ⇒ RECOVERY_COMPLETED.
 *   2. recovery_email_sent_count ≥ MAX_RECOVERY_STEPS ⇒ RECOVERY_MAX_STEPS_REACHED.
 *   3. status ≠ 'abandoned' ⇒ RECOVERY_STATUS_INVALID.
 *   4. abandoned_at + CART_RECOVERY_EXPIRY_MIN < now ⇒ RECOVERY_EXPIRED.
 *   5. email_optin = false / 0 ⇒ RECOVERY_OPTIN_REQUIRED.
 *   6. Sinon ⇒ eligible.
 *
 * Note : ne calcule PAS le délai entre touches (rôle de getNextRecoveryStep).
 * Pure : aucun I/O. Tolère undefined/null sur tous les champs.
 */
export function isRecoveryEligible(
  cart: CartEligibilityInput,
  nowDate: Date,
): EligibilityVerdict {
  // 1. Déjà complété.
  if (cart.recovery_completed_at) {
    return { eligible: false, reason: CART_RECOVERY_ERROR_CODES.RECOVERY_COMPLETED };
  }

  // 2. Max steps atteints.
  const sentCount = clampStepCount(cart.recovery_email_sent_count);
  if (sentCount >= MAX_RECOVERY_STEPS) {
    return {
      eligible: false,
      reason: CART_RECOVERY_ERROR_CODES.RECOVERY_MAX_STEPS_REACHED,
    };
  }

  // 3. Status check (cart doit être 'abandoned' pour entrer dans la séquence).
  if (cart.status && cart.status !== 'abandoned') {
    return {
      eligible: false,
      reason: CART_RECOVERY_ERROR_CODES.RECOVERY_STATUS_INVALID,
    };
  }

  // 4. Expiry check (cart trop vieux ⇒ "cart froid").
  if (cart.abandoned_at) {
    const abandonedMs = parseRecoveryTimestamp(cart.abandoned_at);
    if (Number.isFinite(abandonedMs)) {
      const expiryMs = abandonedMs + CART_RECOVERY_EXPIRY_MIN * 60_000;
      if (nowDate.getTime() > expiryMs) {
        return {
          eligible: false,
          reason: CART_RECOVERY_ERROR_CODES.RECOVERY_EXPIRED,
        };
      }
    }
  }

  // 5. Opt-in check (RGPD / Loi 25 / CASL).
  // undefined ⇒ on ne sait pas, on laisse passer (caller doit checker ailleurs).
  // null / false / 0 explicites ⇒ refus.
  if (cart.email_optin === false || cart.email_optin === 0) {
    return {
      eligible: false,
      reason: CART_RECOVERY_ERROR_CODES.RECOVERY_OPTIN_REQUIRED,
    };
  }

  return { eligible: true };
}

// ── 5. shouldEscalateToHuman ───────────────────────────────────────────────

/**
 * Détermine si une intervention humaine est requise sur un cart.
 *
 * Critère : ≥ HUMAN_ESCALATION_THRESHOLD tentatives envoyées ET aucune n'a
 * été cliquée (le visiteur n'a jamais réagi malgré la séquence complète).
 *
 * Args :
 *   - attempts : array d'attempts (post `parseRecoveryAttempts` recommandé).
 *
 * Pure : aucun I/O.
 */
export function shouldEscalateToHuman(attempts: RecoveryAttempt[]): boolean {
  if (!Array.isArray(attempts)) return false;
  if (attempts.length < HUMAN_ESCALATION_THRESHOLD) return false;
  // Au moins HUMAN_ESCALATION_THRESHOLD tentatives ET zéro click.
  for (const a of attempts) {
    if (a && a.clicked_at) return false;
  }
  return true;
}

// ── 6. parseRecoveryAttempts ───────────────────────────────────────────────

/**
 * Safe-parse + validation shape du JSON `recovery_attempts_json`.
 *
 * Rejette silencieusement :
 *   - JSON malformé (`{"foo"` etc.).
 *   - Type racine ≠ array.
 *   - Entries non-objet ou sans champs minimum (step + channel + ts).
 *   - step hors {1,2,3} ou channel hors {email,sms}.
 *
 * Normalise :
 *   - opened_at / clicked_at undefined → null.
 *   - coupon_code undefined → null.
 *
 * Pure : aucun I/O. Toujours retourne un array (jamais throw).
 */
export function parseRecoveryAttempts(
  json: string | null | undefined,
): RecoveryAttempt[] {
  if (!json) return [];
  const raw = json.toString().trim();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: RecoveryAttempt[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    const stepNum = Number(e.step);
    if (stepNum !== 1 && stepNum !== 2 && stepNum !== 3) continue;

    const ch = e.channel;
    if (ch !== 'email' && ch !== 'sms') continue;

    const ts = e.ts;
    if (typeof ts !== 'string' || !ts) continue;

    out.push({
      step: stepNum as RecoveryStep,
      channel: ch as RecoveryChannel,
      ts,
      coupon_code: typeof e.coupon_code === 'string' ? e.coupon_code : null,
      opened_at: typeof e.opened_at === 'string' ? e.opened_at : null,
      clicked_at: typeof e.clicked_at === 'string' ? e.clicked_at : null,
    });
  }
  return out;
}

// ── 7. validateCartToken (helper bonus) ────────────────────────────────────

/**
 * Valide qu'un cart token est URL-safe base64url (`[A-Za-z0-9_-]`) de
 * longueur attendue (16..64 chars). Anti-injection pour endpoint PUBLIC
 * `/api/recovery/:cartToken/:step`.
 *
 * Pure : aucun I/O.
 */
export function isValidCartToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const s = token.toString();
  if (s.length < 16 || s.length > 64) return false;
  return /^[A-Za-z0-9_-]+$/.test(s);
}

/**
 * Valide qu'un step est dans la plage `{1, 2, 3}`. Accepte number OU string
 * (les URL params arrivent comme strings).
 *
 * Pure : aucun I/O.
 */
export function isValidRecoveryStep(
  step: number | string | null | undefined,
): step is RecoveryStep | '1' | '2' | '3' {
  if (step === null || step === undefined) return false;
  const n = typeof step === 'string' ? parseInt(step, 10) : step;
  return n === 1 || n === 2 || n === 3;
}
