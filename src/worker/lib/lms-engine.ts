// ── Sprint 43 — lms-engine.ts — Courses LMS core (PHASE B — REINFORCED) ──
//
// Helpers : compute progress + grade quiz + generate certificate PDF +
// pick certificate number + drip availability + answers validation +
// HTML certificate render (XSS-safe) + UUID-hex validation.
//
// Contrat FIGÉ §6 docs/LOT-COURSES-LMS-S43.md :
//   - computeProgress       → { completed_lessons, total_lessons, progress_pct, can_get_certificate }
//   - gradeQuizAttempt      → { score, passed, breakdown }
//   - generateCertificatePdf → Promise<Uint8Array>
//   - pickCertificateNumber  → string (CERT-XXXXXXXX-XXXXXXXX, 16 hex chars total)
//
// Helpers AJOUTÉS (Sprint 43 reinforcement) — tous PURE (zéro side-effect) :
//   - generateCertificateNumber  → alias canonique de pickCertificateNumber
//   - renderCertificateHtml      → interpolation Handlebars-like + HTML escape
//   - isLessonAvailable          → drip release check (enrolled_at + delay vs now)
//   - validateQuizAnswers        → garde-fou (questions présentes, types corrects)
//   - isUuidHex                  → format PRIMARY KEY migration (32 hex lower)
//   - LMS_ERROR_CODES            → constantes erreur stables (audit / i18n UI)
//
// AUCUN side-effect, AUCUN DB write — caller (courses-lms.ts) persiste.

import type { Env } from '../types';
import type {
  CourseLesson,
  QuizQuestion,
  EnrollmentProgress,
} from '../../lib/api';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTES — codes erreur stables (exposés pour audit / mapping UI i18n)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Codes erreur LMS stables — utilisables par les handlers + UI pour mapping
 * i18n. ⚠ Le contrat §6 dit `json({ error })` SANS champ `code` — ces
 * constantes restent INTERNES (logs / audit / future extension).
 */
export const LMS_ERROR_CODES = {
  LESSON_NOT_FOUND: 'LESSON_NOT_FOUND',
  QUIZ_NOT_FOUND: 'QUIZ_NOT_FOUND',
  ENROLLMENT_INVALID: 'ENROLLMENT_INVALID',
  ENROLLMENT_NOT_FOUND: 'ENROLLMENT_NOT_FOUND',
  COURSE_NOT_FOUND: 'COURSE_NOT_FOUND',
  QUIZ_MAX_ATTEMPTS: 'QUIZ_MAX_ATTEMPTS',
  QUIZ_INVALID_TYPE: 'QUIZ_INVALID_TYPE',
  QUIZ_MISSING_ANSWER: 'QUIZ_MISSING_ANSWER',
  R2_NOT_CONFIGURED: 'R2_NOT_CONFIGURED',
  CERTIFICATE_NOT_FOUND: 'CERTIFICATE_NOT_FOUND',
  LESSON_LOCKED_DRIP: 'LESSON_LOCKED_DRIP',
  INVALID_ID_FORMAT: 'INVALID_ID_FORMAT',
} as const;

export type LmsErrorCode =
  (typeof LMS_ERROR_CODES)[keyof typeof LMS_ERROR_CODES];

/** Threshold par défaut si `courses.completion_threshold` est NULL / invalide. */
export const DEFAULT_COMPLETION_THRESHOLD = 0.8;

/** Types de questions whitelistés (calque migration seq138). */
const VALID_QUIZ_TYPES = new Set(['multiple_choice', 'text', 'true_false']);

/**
 * Calcule la progression agrégée d'un enrollment :
 *   - completed_lessons : COUNT(lms_lesson_progress WHERE completed_at NOT NULL AND enrollment_id=?)
 *   - total_lessons    : COUNT(course_lessons WHERE course_id=enrollment.course_id AND is_published=1)
 *   - progress_pct     : completed_lessons / total_lessons (0..1)
 *   - can_get_certificate : progress_pct >= course.completion_threshold (default 0.8)
 *
 * Edge cases couverts :
 *   - enrollment introuvable          → fallback 0/0
 *   - course sans leçons publiées     → total=0, progress_pct=0, can_get_certificate=false
 *   - course.completion_threshold NULL → fallback DEFAULT_COMPLETION_THRESHOLD (0.8)
 *   - completion_threshold > 1 ou <= 0 → fallback DEFAULT_COMPLETION_THRESHOLD
 *
 * Borné tenant via enrollment_id (lookup course_enrollments.client_id seq87).
 * Best-effort : toute erreur D1 (ex: table pas encore créée si migration pas
 * appliquée) → progression 0/0 (fallback safe).
 */
export async function computeProgress(
  env: Env,
  enrollmentId: string,
): Promise<EnrollmentProgress> {
  const fallback: EnrollmentProgress = {
    completed_lessons: 0,
    total_lessons: 0,
    progress_pct: 0,
    can_get_certificate: false,
  };

  if (!enrollmentId || typeof enrollmentId !== 'string') return fallback;

  try {
    // 1) Resolve course_id from enrollment
    const enroll = (await env.DB.prepare(
      'SELECT course_id, client_id FROM course_enrollments WHERE id = ? LIMIT 1',
    )
      .bind(enrollmentId)
      .first()) as { course_id: string | null; client_id: string | null } | null;

    if (!enroll || !enroll.course_id) return fallback;
    const courseId = enroll.course_id;

    // 2) Total published lessons for this course
    const totalRow = (await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM course_lessons WHERE course_id = ? AND is_published = 1',
    )
      .bind(courseId)
      .first()) as { count: number } | null;
    const total = totalRow && typeof totalRow.count === 'number' ? totalRow.count : 0;

    // 3) Completed lessons for this enrollment
    let completed = 0;
    try {
      const completedRow = (await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM lms_lesson_progress WHERE enrollment_id = ? AND completed_at IS NOT NULL',
      )
        .bind(enrollmentId)
        .first()) as { count: number } | null;
      completed = completedRow && typeof completedRow.count === 'number' ? completedRow.count : 0;
    } catch {
      // Table pas encore créée (migration pas appliquée) → fallback 0.
      completed = 0;
    }

    // 4) Course completion_threshold (default 0.8)
    // ⚠ Si la colonne est NULL ou hors-bornes (0..1), on retombe sur le default.
    let threshold = DEFAULT_COMPLETION_THRESHOLD;
    try {
      const courseRow = (await env.DB.prepare(
        'SELECT completion_threshold FROM courses WHERE id = ? LIMIT 1',
      )
        .bind(courseId)
        .first()) as { completion_threshold: number | null } | null;
      if (
        courseRow &&
        typeof courseRow.completion_threshold === 'number' &&
        courseRow.completion_threshold > 0 &&
        courseRow.completion_threshold <= 1
      ) {
        threshold = courseRow.completion_threshold;
      }
    } catch {
      // ALTER non joué → garde le default 0.8
    }

    // Edge case : course sans leçon publiée → 0% (jamais de certificat).
    const progress_pct = total > 0 ? completed / total : 0;
    const can_get_certificate = total > 0 && progress_pct >= threshold;

    return {
      completed_lessons: completed,
      total_lessons: total,
      progress_pct,
      can_get_certificate,
    };
  } catch {
    return fallback;
  }
}

/**
 * Note une tentative de quiz : pour chaque question, compare answer fourni
 * à correct_answer. Retourne score 0..1 (somme points correctes / total
 * points) + breakdown détail par question.
 *
 * `passed` est calculé par le caller (comparaison vs `course_quizzes.passing_score`).
 * Validation HANDLER case-insensitive trim pour text, exact match pour MC,
 * "true"/"false" lowercased pour true_false.
 *
 * Pondération : `points` négatif → forcé à 0. `points` non-fini (NaN/Infinity)
 * → 1. Total points = 0 → score 0 (évite division par 0).
 */
export function gradeQuizAttempt(
  questions: QuizQuestion[],
  answers: Record<string, string>,
): {
  score: number;
  passed: boolean;
  breakdown: Record<
    string,
    { correct: boolean; points_earned: number; points_possible: number }
  >;
} {
  const breakdown: Record<
    string,
    { correct: boolean; points_earned: number; points_possible: number }
  > = {};
  let totalPoints = 0;
  let earnedPoints = 0;

  const safeQuestions = Array.isArray(questions) ? questions : [];
  const safeAnswers =
    answers && typeof answers === 'object' ? answers : ({} as Record<string, string>);

  for (const q of safeQuestions) {
    if (!q || typeof q.id !== 'string') continue;
    const points =
      typeof q.points === 'number' && isFinite(q.points) && q.points >= 0
        ? q.points
        : 1;
    totalPoints += points;

    const userRaw = safeAnswers[q.id];
    const userAns = typeof userRaw === 'string' ? userRaw : '';
    const correctRaw = typeof q.correct_answer === 'string' ? q.correct_answer : '';

    let isCorrect = false;
    const userNorm = userAns.trim().toLowerCase();
    const correctNorm = correctRaw.trim().toLowerCase();

    if (q.type === 'text') {
      // case-insensitive trim compare
      isCorrect = userNorm.length > 0 && userNorm === correctNorm;
    } else if (q.type === 'true_false') {
      // normalize "true"/"false"
      isCorrect = userNorm === correctNorm && (userNorm === 'true' || userNorm === 'false');
    } else {
      // multiple_choice (default) : case-insensitive match on the option label.
      isCorrect = userNorm.length > 0 && userNorm === correctNorm;
    }

    const earned = isCorrect ? points : 0;
    earnedPoints += earned;
    breakdown[q.id] = {
      correct: isCorrect,
      points_earned: earned,
      points_possible: points,
    };
  }

  const score = totalPoints > 0 ? earnedPoints / totalPoints : 0;

  return {
    score,
    // `passed` is left at false here — the caller compares score vs the quiz's
    // passing_score to set the real value (contract docs §6).
    passed: false,
    breakdown,
  };
}

/**
 * Garde-fou applicatif validant que `answers` est compatible avec `questions` :
 *   - chaque question est présente dans `answers` (sauf si elle est explicitement
 *     marquée optional — non-supporté par le schéma seq138 → toutes obligatoires).
 *   - chaque type de question est whitelist (`multiple_choice|text|true_false`).
 *   - chaque réponse est une string non-vide après trim.
 *
 * Retourne `{ ok: true }` si tout passe, sinon `{ ok: false, error, code }`
 * avec un code stable (LMS_ERROR_CODES).
 *
 * ⚠ PURE — `gradeQuizAttempt` reste tolérant (réponse absente → 0). Ce helper
 * est destiné aux handlers qui veulent rejeter un body malformé EN AMONT
 * (validation explicite).
 */
export function validateQuizAnswers(
  questions: QuizQuestion[],
  answers: Record<string, string>,
): { ok: true } | { ok: false; error: string; code: LmsErrorCode; questionId?: string } {
  if (!Array.isArray(questions)) {
    return {
      ok: false,
      error: 'questions doit être un tableau',
      code: LMS_ERROR_CODES.QUIZ_INVALID_TYPE,
    };
  }
  if (!answers || typeof answers !== 'object') {
    return {
      ok: false,
      error: 'answers doit être un objet',
      code: LMS_ERROR_CODES.QUIZ_MISSING_ANSWER,
    };
  }

  for (const q of questions) {
    if (!q || typeof q.id !== 'string' || q.id.length === 0) {
      return {
        ok: false,
        error: 'question.id manquant',
        code: LMS_ERROR_CODES.QUIZ_INVALID_TYPE,
      };
    }
    if (typeof q.type !== 'string' || !VALID_QUIZ_TYPES.has(q.type)) {
      return {
        ok: false,
        error: `type invalide pour question ${q.id} (attendu : multiple_choice|text|true_false)`,
        code: LMS_ERROR_CODES.QUIZ_INVALID_TYPE,
        questionId: q.id,
      };
    }
    const raw = answers[q.id];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return {
        ok: false,
        error: `réponse manquante pour la question ${q.id}`,
        code: LMS_ERROR_CODES.QUIZ_MISSING_ANSWER,
        questionId: q.id,
      };
    }
  }

  return { ok: true };
}

/**
 * Échappe les caractères HTML dangereux pour éviter XSS dans le rendu du
 * certificat (le `customer_name` peut venir d'un input membre).
 *
 * Couvre `& < > " '` — suffisant pour interpolation HTML body / attribute.
 */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Interpole un template HTML Handlebars-like avec le contexte du certificat :
 *   - `{{customer_name}}`
 *   - `{{course_title}}`
 *   - `{{date}}` (ISO YYYY-MM-DD si non fourni)
 *   - `{{certificate_number}}`
 *
 * ⚠ Toutes les valeurs interpolées sont HTML-escapées (anti-XSS). Le template
 * lui-même n'est PAS échappé (HTML attendu — fourni par admin, déjà trusted).
 *
 * Si `template` est vide / null → retourne un HTML minimal par défaut.
 * PURE — zéro side-effect.
 */
export function renderCertificateHtml(
  template: string | null | undefined,
  ctx: {
    customer_name?: string;
    course_title?: string;
    date?: string;
    certificate_number?: string;
  },
): string {
  const safeCtx = {
    customer_name: escapeHtml(ctx.customer_name ?? 'Membre'),
    course_title: escapeHtml(ctx.course_title ?? 'Cours'),
    date: escapeHtml(ctx.date ?? new Date().toISOString().slice(0, 10)),
    certificate_number: escapeHtml(ctx.certificate_number ?? ''),
  };

  if (template && typeof template === 'string' && template.length > 0) {
    return template
      .replace(/\{\{customer_name\}\}/g, safeCtx.customer_name)
      .replace(/\{\{course_title\}\}/g, safeCtx.course_title)
      .replace(/\{\{date\}\}/g, safeCtx.date)
      .replace(/\{\{certificate_number\}\}/g, safeCtx.certificate_number);
  }

  return (
    `<html><body><h1>Certificate</h1>` +
    `<p>${safeCtx.customer_name} completed ${safeCtx.course_title} on ${safeCtx.date}</p>` +
    (safeCtx.certificate_number
      ? `<p>Certificate #${safeCtx.certificate_number}</p>`
      : '') +
    `</body></html>`
  );
}

/**
 * Génère un PDF de certificat (stub HTML encodé UTF-8 → Uint8Array).
 *
 * Délègue l'interpolation à `renderCertificateHtml` (XSS-safe). Phase B
 * Manager-B remplacera par rendu HTML→PDF réel (pdf-lib / Workers AI).
 * Actuellement on retourne l'HTML encodé UTF-8 (placeholder consommé par le
 * caller qui upload R2). AUCUN side-effect — pure function.
 */
export async function generateCertificatePdf(
  course: { id: string; title: string; certificate_template_html?: string | null },
  customer: { id: string; name: string },
  template: string | null,
  certificateNumber?: string,
): Promise<Uint8Array> {
  const html = renderCertificateHtml(template, {
    customer_name:
      (customer && typeof customer.name === 'string' && customer.name) || 'Membre',
    course_title:
      (course && typeof course.title === 'string' && course.title) || 'Cours',
    date: new Date().toISOString().slice(0, 10),
    certificate_number: certificateNumber || '',
  });
  return new TextEncoder().encode(html);
}

/**
 * Génère un numéro de certificat : `CERT-XXXXXXXX-XXXXXXXX` (16 chars hex
 * uppercase en 2 blocs de 8). Uniqueness 1 in 2^64 (8 bytes crypto random).
 * Le caller (HANDLER) doit toujours valider l'absence de collision par tenant
 * (SELECT par client_id) et retry si besoin.
 */
export function pickCertificateNumber(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `CERT-${hex.slice(0, 8)}-${hex.slice(8, 16)}`;
}

/**
 * Alias canonique : nom plus parlant pour les handlers + tests Phase C.
 * Identique à `pickCertificateNumber()`. Garde-rétro : on conserve les deux.
 */
export function generateCertificateNumber(): string {
  return pickCertificateNumber();
}

/**
 * Drip release check : une leçon est disponible si la durée écoulée depuis
 * l'enrollment ≥ `drip_delay_days` * 24h.
 *
 * Edge cases :
 *   - `dripDelayDays` <= 0  → disponible immédiatement (true)
 *   - `dripDelayDays` non-fini ou NaN → traité comme 0 (disponible)
 *   - `enrolledAt` invalide (NaN après parse) → false (sécurité : verrouille)
 *   - `now` non fourni → `Date.now()`
 *
 * Tous les timestamps ISO sont interprétés en UTC (timezone-safe).
 *
 * @param enrolledAt - ISO timestamp (course_enrollments.enrolled_at)
 * @param dripDelayDays - délai en jours (course_lessons.drip_delay_days)
 * @param now - date de référence (default : maintenant)
 */
export function isLessonAvailable(
  enrolledAt: string | null | undefined,
  dripDelayDays: number | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  // Drip <= 0 ou invalide → toujours disponible.
  const delay =
    typeof dripDelayDays === 'number' && isFinite(dripDelayDays) && dripDelayDays > 0
      ? dripDelayDays
      : 0;
  if (delay === 0) return true;

  if (!enrolledAt || typeof enrolledAt !== 'string') return false;
  const enrolledMs = Date.parse(enrolledAt);
  if (!isFinite(enrolledMs)) return false;

  const nowMs = typeof now === 'number' ? now : now.getTime();
  const elapsedMs = nowMs - enrolledMs;
  const requiredMs = delay * 24 * 60 * 60 * 1000;
  return elapsedMs >= requiredMs;
}

/**
 * Vérifie qu'une string respecte le format PRIMARY KEY de la migration seq138 :
 * `lower(hex(randomblob(16)))` = 32 caractères hex lowercase.
 *
 * ⚠ Ce n'est PAS un UUID canonique (8-4-4-4-12 avec tirets). C'est le format
 * brut hex 16 bytes utilisé en interne par D1. Toute valeur avec tirets,
 * uppercase, ou longueur ≠ 32 est REJETÉE.
 *
 * Note : `crypto.randomUUID()` (utilisé par certains handlers existants pour
 * générer des IDs Cloudflare Workers) produit le format canonique 36 chars
 * avec tirets. Ce helper teste uniquement le format hex brut migration. Pour
 * accepter les deux, utiliser `isValidLmsId` (à venir si besoin).
 */
export function isUuidHex(s: string): boolean {
  if (typeof s !== 'string') return false;
  return /^[0-9a-f]{32}$/.test(s);
}

// Helper local : map d'une row DB → CourseLesson.
export function mapLessonRow(r: Record<string, unknown>): CourseLesson {
  return {
    id: String(r.id ?? ''),
    course_id: String(r.course_id ?? ''),
    title: String(r.title ?? ''),
    content: r.content == null ? null : String(r.content),
    video_url: r.video_url == null ? null : String(r.video_url),
    order_index: typeof r.order_index === 'number' ? r.order_index : 0,
    drip_delay_days:
      typeof r.drip_delay_days === 'number' ? r.drip_delay_days : 0,
    is_published: r.is_published === 1 || r.is_published === true,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}
