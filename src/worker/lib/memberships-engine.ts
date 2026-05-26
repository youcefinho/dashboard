// ── memberships-engine.ts — helpers PURS pour LOT MEMBERSHIPS (Sprint 6) ────
//
// Engine helpers RENFORCEMENT pour memberships.ts. ZÉRO I/O (pas de DB, pas
// de fetch). Toutes les fonctions sont déterministes et testables.
//
// Périmètre :
//   - Validation drip schedule (0-365 jours)
//   - Disponibilité d'une leçon (drip check enrolled_at + delay)
//   - Progression membre (% + statut)
//   - Validation slug membre / espace membre
//   - Génération token membre (préfixe logique distinct admin)
//
// 100% additif : memberships.ts continue de fonctionner sans cet engine.
// Les handlers peuvent l'appeler EN AMONT pour valider AVANT toute requête DB.

// ── Codes d'erreur stables ──────────────────────────────────────────────────
export const MEMBERSHIPS_ERROR_CODES = {
  INVALID_DRIP_DELAY: 'memberships.drip.delay_invalid',
  DRIP_TOO_LARGE: 'memberships.drip.delay_too_large',
  INVALID_SLUG: 'memberships.slug.invalid',
  INVALID_PROGRESS: 'memberships.progress.invalid',
  LESSON_LOCKED: 'memberships.lesson.locked',
  INVALID_LESSON: 'memberships.lesson.invalid',
} as const;

// ── Bornes documentées ──────────────────────────────────────────────────────
export const MAX_DRIP_DELAY_DAYS = 365;
export const MIN_DRIP_DELAY_DAYS = 0;
export const MEMBER_SLUG_MIN_LENGTH = 3;
export const MEMBER_SLUG_MAX_LENGTH = 120;
export const MEMBER_TOKEN_PREFIX = 'intralys_member_token_';
export const MEMBER_TOKEN_ENTROPY_BYTES = 24; // 192 bits, > admin 16 bytes

export type ProgressStatus = 'not_started' | 'in_progress' | 'completed';

// ── Validation drip schedule ────────────────────────────────────────────────
export interface DripValidationResult {
  ok: boolean;
  error?: string;
}

export function validateDripSchedule(delayDays: unknown): DripValidationResult {
  // Conversion + check
  if (delayDays === null || delayDays === undefined) {
    return { ok: false, error: MEMBERSHIPS_ERROR_CODES.INVALID_DRIP_DELAY };
  }
  const n = Number(delayDays);
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    return { ok: false, error: MEMBERSHIPS_ERROR_CODES.INVALID_DRIP_DELAY };
  }
  if (n < MIN_DRIP_DELAY_DAYS) {
    return { ok: false, error: MEMBERSHIPS_ERROR_CODES.INVALID_DRIP_DELAY };
  }
  if (n > MAX_DRIP_DELAY_DAYS) {
    return { ok: false, error: MEMBERSHIPS_ERROR_CODES.DRIP_TOO_LARGE };
  }
  // Pas de fraction (jours entiers)
  if (Math.floor(n) !== n) {
    return { ok: false, error: MEMBERSHIPS_ERROR_CODES.INVALID_DRIP_DELAY };
  }
  return { ok: true };
}

// ── Disponibilité d'une leçon (drip check) ──────────────────────────────────
// Calque memberships.ts:dripUnlocked MAIS API plus claire :
//   isLessonAvailable(lesson, enrolledAt, now) — now optionnel (Date.now par
//   défaut). enrolledAt en ISO string ou ms (number). drip_days lu sur la
//   leçon. Renvoie booléen direct (pas de Response — c'est pur).
export interface DrippedLesson {
  drip_days?: number | null;
}

export function isLessonAvailable(
  lesson: DrippedLesson,
  enrolledAt: string | number | null | undefined,
  now: number = Date.now(),
): boolean {
  const dripDays = Number(lesson?.drip_days) || 0;
  if (dripDays <= 0) return true; // dispo dès l'inscription
  if (enrolledAt == null) return false; // sans inscription, pas d'accès
  let enrollMs: number;
  if (typeof enrolledAt === 'number') {
    enrollMs = enrolledAt;
  } else {
    // Accepte "YYYY-MM-DD HH:MM:SS" (SQLite) ou ISO standard.
    const isoLike = enrolledAt.includes('T') ? enrolledAt : enrolledAt.replace(' ', 'T');
    const withZ = /Z|[+-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : isoLike + 'Z';
    enrollMs = new Date(withZ).getTime();
  }
  if (!Number.isFinite(enrollMs)) return true; // date illisible : ne pas bloquer
  return enrollMs + dripDays * 86_400_000 <= now;
}

// ── Progression membre (% + statut) ─────────────────────────────────────────
export interface MemberProgress {
  pct: number;
  status: ProgressStatus;
}

export function computeMemberProgress(
  completedLessons: unknown,
  totalLessons: unknown,
): MemberProgress {
  const done = Math.max(0, Math.floor(Number(completedLessons) || 0));
  const total = Math.max(0, Math.floor(Number(totalLessons) || 0));
  if (total === 0) return { pct: 0, status: 'not_started' };
  const capped = Math.min(done, total);
  const pct = Math.round((capped / total) * 100);
  let status: ProgressStatus;
  if (capped === 0) status = 'not_started';
  else if (capped >= total) status = 'completed';
  else status = 'in_progress';
  return { pct, status };
}

// ── Validation slug membre / espace membre ──────────────────────────────────
// Calque memberships.ts:handleMembershipSites borne `slug` (slice 120). Cette
// fonction ajoute une grammaire (kebab-case + chiffres + underscore optionnel).
export function validateMemberSlug(slug: unknown): boolean {
  if (typeof slug !== 'string') return false;
  const trimmed = slug.trim();
  if (
    trimmed.length < MEMBER_SLUG_MIN_LENGTH ||
    trimmed.length > MEMBER_SLUG_MAX_LENGTH
  ) {
    return false;
  }
  // Accepte alpha-num + `-` + `_`. Pas de leading/trailing punct.
  return /^[a-z0-9][a-z0-9_-]*[a-z0-9]$/i.test(trimmed);
}

// ── Génération token membre (distinct admin) ────────────────────────────────
// Préfixe logique `intralys_member_token_` pour distinguer dans les logs
// et JAMAIS collisionner avec un token admin. Bytes via crypto.getRandomValues
// (Worker runtime), fallback Math.random pour les tests purement Node.
export function generateMemberToken(): string {
  const bytes = new Uint8Array(MEMBER_TOKEN_ENTROPY_BYTES);
  // globalThis.crypto disponible en Worker + Node 19+ + jsdom (vitest).
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // base64url sans padding (URL-safe)
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  // btoa always available in Worker + browser + jsdom (vitest).
  const b64 = btoa(bin);
  const urlSafe = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return MEMBER_TOKEN_PREFIX + urlSafe;
}

// ── Helper : valide qu'un token a le bon préfixe membre ─────────────────────
export function isMemberToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  if (!token.startsWith(MEMBER_TOKEN_PREFIX)) return false;
  // Bytes minimum : prefix + ≥ 16 chars utiles
  return token.length >= MEMBER_TOKEN_PREFIX.length + 16;
}
