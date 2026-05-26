// ── Sprint 43 — courses-lms.ts — Handlers REST Courses LMS (PHASE B impl) ──
// 13 handlers : 4 lessons CRUD admin + 1 mark complete member-facing +
// 4 quizzes/questions CRUD + 1 attempt submit + 1 progress + 2 certs.
//
// Contrats GELÉS (docs/LOT-COURSES-LMS-S43.md §6) :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)   ← JAMAIS de champ `code`
//
// Bornage tenant strict : JOIN courses (course_id) → courses.client_id =
// resolveClientId(). resolveClientId() = calque chat-bot.ts:33 + voice-agent.ts:32.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { getClientModules } from './modules';
import {
  computeProgress,
  gradeQuizAttempt,
  generateCertificatePdf,
  generateCertificateNumber,
  isLessonAvailable,
  isUuidHex,
  validateQuizAnswers,
  mapLessonRow,
  LMS_ERROR_CODES,
} from './lib/lms-engine';
import type { QuizQuestion, QuizQuestionType } from '../lib/api';

type CoursesLmsAuth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

/**
 * Garde permissive sur les path params : accepte le format migration seq138
 * (isUuidHex : 32 hex lower) OU un slug raisonnable (alphanumérique + `-_`,
 * 1..128 chars). Rejet uniquement des valeurs OBVIOUSLY malformées (XSS,
 * caractères de contrôle, longueur excessive). Compat ascendante : les IDs
 * historiques comme `lesson-1` / `enroll-uuid-v4` restent acceptés.
 *
 * Le wire-up "INVALID_ID_FORMAT" rejette par exemple `<script>...` ou des
 * strings de plusieurs centaines de chars.
 */
function isLikelyValidId(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (isUuidHex(id)) return true;
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

/** Résout le client_id du tenant courant (calque chat-bot.ts:33). */
async function resolveClientId(
  env: Env,
  auth: CoursesLmsAuth,
): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

const VALID_QUESTION_TYPES = new Set<QuizQuestionType>([
  'multiple_choice',
  'text',
  'true_false',
]);

/** Vérifie qu'un course appartient bien au tenant courant. */
async function assertCourseInTenant(
  env: Env,
  courseId: string,
  clientId: string,
): Promise<boolean> {
  const row = (await env.DB.prepare(
    'SELECT id FROM courses WHERE id = ? AND client_id = ? LIMIT 1',
  )
    .bind(courseId, clientId)
    .first()) as { id: string } | null;
  return !!row;
}

/** Résout le course_id parent d'une leçon + vérifie tenant. */
async function resolveLessonTenant(
  env: Env,
  lessonId: string,
  clientId: string,
): Promise<{ courseId: string } | null> {
  const row = (await env.DB.prepare(
    `SELECT cl.course_id AS course_id
       FROM course_lessons cl
       JOIN courses c ON c.id = cl.course_id
      WHERE cl.id = ? AND c.client_id = ?
      LIMIT 1`,
  )
    .bind(lessonId, clientId)
    .first()) as { course_id: string } | null;
  if (!row) return null;
  return { courseId: row.course_id };
}

/** Résout le lesson_id parent d'un quiz + vérifie tenant. */
async function resolveQuizTenant(
  env: Env,
  quizId: string,
  clientId: string,
): Promise<{ lessonId: string; courseId: string } | null> {
  const row = (await env.DB.prepare(
    `SELECT cq.lesson_id AS lesson_id, cl.course_id AS course_id
       FROM course_quizzes cq
       JOIN course_lessons cl ON cl.id = cq.lesson_id
       JOIN courses c ON c.id = cl.course_id
      WHERE cq.id = ? AND c.client_id = ?
      LIMIT 1`,
  )
    .bind(quizId, clientId)
    .first()) as { lesson_id: string; course_id: string } | null;
  if (!row) return null;
  return { lessonId: row.lesson_id, courseId: row.course_id };
}

/** Résout le course_id parent d'un enrollment + vérifie tenant. */
async function resolveEnrollmentTenant(
  env: Env,
  enrollmentId: string,
  clientId: string,
): Promise<{ courseId: string; customerId: string | null; memberId: string | null } | null> {
  const row = (await env.DB.prepare(
    'SELECT course_id, member_id, client_id FROM course_enrollments WHERE id = ? AND client_id = ? LIMIT 1',
  )
    .bind(enrollmentId, clientId)
    .first()) as { course_id: string; member_id: string | null; client_id: string } | null;
  if (!row || !row.course_id) return null;
  return { courseId: row.course_id, customerId: row.member_id, memberId: row.member_id };
}

// ── 5 handlers Lessons (4 admin CRUD + 1 member-facing complete) ───────────

/** GET /api/courses/:id/lessons — liste leçons d'un cours. */
export async function handleListLessons(
  env: Env,
  auth: CoursesLmsAuth,
  courseId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'clients.manage');
  if (g) return g;
  if (!courseId || typeof courseId !== 'string') {
    return json({ error: 'course_id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    if (!(await assertCourseInTenant(env, courseId, clientId))) {
      return json({ error: 'Cours introuvable' }, 404);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, course_id, title, content, video_url, order_index,
              drip_delay_days, is_published, created_at, updated_at
         FROM course_lessons
        WHERE course_id = ?
        ORDER BY order_index ASC`,
    )
      .bind(courseId)
      .all();

    const rows = ((results || []) as Array<Record<string, unknown>>).map(mapLessonRow);
    return json({ data: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/courses/:id/lessons — créer une leçon. */
export async function handleCreateLesson(
  request: Request,
  env: Env,
  auth: CoursesLmsAuth,
  courseId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'clients.manage');
  if (g) return g;
  if (!courseId || typeof courseId !== 'string') {
    return json({ error: 'course_id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    if (!(await assertCourseInTenant(env, courseId, clientId))) {
      return json({ error: 'Cours introuvable' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const title = sanitizeInput(typeof body.title === 'string' ? body.title : '', 200);
    if (!title) {
      return json({ error: 'Le titre est requis' }, 400);
    }

    const content = typeof body.content === 'string' ? body.content : null;
    const videoUrl = typeof body.video_url === 'string' ? body.video_url : null;
    const orderIndex = typeof body.order_index === 'number' ? body.order_index : 0;
    const dripDelay = typeof body.drip_delay_days === 'number' ? body.drip_delay_days : 0;
    const isPublished = body.is_published === true ? 1 : 0;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO course_lessons
         (id, course_id, title, content, video_url, order_index,
          drip_delay_days, is_published, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, courseId, title, content, videoUrl, orderIndex, dripDelay, isPublished, now, now)
      .run();

    await audit(env, auth.userId, 'create', 'course_lesson', id, {
      course_id: courseId,
      title,
    });

    return json(
      {
        data: {
          id,
          course_id: courseId,
          title,
          content,
          video_url: videoUrl,
          order_index: orderIndex,
          drip_delay_days: dripDelay,
          is_published: isPublished === 1,
          created_at: now,
          updated_at: now,
        },
      },
      201,
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** PATCH /api/lessons/:id — update partial d'une leçon. */
export async function handleUpdateLesson(
  request: Request,
  env: Env,
  auth: CoursesLmsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'clients.manage');
  if (g) return g;
  if (!id || typeof id !== 'string') {
    return json({ error: 'id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await resolveLessonTenant(env, id, clientId);
    if (!tenant) {
      return json({ error: 'Leçon introuvable' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const updates: string[] = [];
    const binds: unknown[] = [];
    const patched: Record<string, unknown> = {};

    if (typeof body.title === 'string') {
      const title = sanitizeInput(body.title, 200);
      if (!title) return json({ error: 'Le titre ne peut pas être vide' }, 400);
      updates.push('title = ?');
      binds.push(title);
      patched.title = title;
    }
    if (typeof body.content === 'string' || body.content === null) {
      updates.push('content = ?');
      binds.push(body.content as string | null);
      patched.content = body.content;
    }
    if (typeof body.video_url === 'string' || body.video_url === null) {
      updates.push('video_url = ?');
      binds.push(body.video_url as string | null);
      patched.video_url = body.video_url;
    }
    if (typeof body.order_index === 'number') {
      updates.push('order_index = ?');
      binds.push(body.order_index);
      patched.order_index = body.order_index;
    }
    if (typeof body.drip_delay_days === 'number') {
      updates.push('drip_delay_days = ?');
      binds.push(body.drip_delay_days);
      patched.drip_delay_days = body.drip_delay_days;
    }
    if (typeof body.is_published === 'boolean') {
      updates.push('is_published = ?');
      binds.push(body.is_published ? 1 : 0);
      patched.is_published = body.is_published;
    }

    if (updates.length === 0) {
      return json({ error: 'Aucun champ à mettre à jour' }, 400);
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    binds.push(now);

    // Bornage via id seul (déjà vérifié tenant via JOIN ci-dessus).
    binds.push(id);
    await env.DB.prepare(
      `UPDATE course_lessons SET ${updates.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();

    await audit(env, auth.userId, 'update', 'course_lesson', id, patched);

    return json({ data: { id, course_id: tenant.courseId, ...patched, updated_at: now } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** DELETE /api/lessons/:id — supprime une leçon. */
export async function handleDeleteLesson(
  env: Env,
  auth: CoursesLmsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'clients.manage');
  if (g) return g;
  if (!id || typeof id !== 'string') {
    return json({ error: 'id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await resolveLessonTenant(env, id, clientId);
    if (!tenant) {
      return json({ error: 'Leçon introuvable' }, 404);
    }

    await env.DB.prepare('DELETE FROM course_lessons WHERE id = ?').bind(id).run();
    await audit(env, auth.userId, 'delete', 'course_lesson', id, {
      course_id: tenant.courseId,
    });

    return json({ data: { success: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/lessons/:id/complete — marque une leçon complétée (member-facing).
 * Capability `leads.write`. Body { enrollment_id, time_spent_sec }.
 * UPSERT lms_lesson_progress. Si progress >= threshold → INSERT course_certificate
 * + upload R2 best-effort.
 */
export async function handleMarkLessonComplete(
  request: Request,
  env: Env,
  auth: CoursesLmsAuth,
  lessonId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;
  if (!lessonId || typeof lessonId !== 'string') {
    return json({ error: 'lesson_id invalide' }, 400);
  }
  if (!isLikelyValidId(lessonId)) {
    return json(
      { error: LMS_ERROR_CODES.INVALID_ID_FORMAT, code: LMS_ERROR_CODES.INVALID_ID_FORMAT },
      400,
    );
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await resolveLessonTenant(env, lessonId, clientId);
    if (!tenant) {
      return json({ error: 'Leçon introuvable' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const enrollmentId =
      typeof body.enrollment_id === 'string' ? body.enrollment_id.trim() : '';
    if (!enrollmentId) {
      return json({ error: 'enrollment_id requis' }, 400);
    }
    const timeSpent =
      typeof body.time_spent_sec === 'number' && body.time_spent_sec >= 0
        ? Math.floor(body.time_spent_sec)
        : 0;

    const enroll = await resolveEnrollmentTenant(env, enrollmentId, clientId);
    if (!enroll) {
      return json({ error: 'Enrollment introuvable' }, 404);
    }
    if (enroll.courseId !== tenant.courseId) {
      return json({ error: 'Enrollment ne correspond pas au cours de cette leçon' }, 400);
    }

    // Drip release check (member-facing).
    // Charge drip_delay_days de la leçon + enrolled_at de l'enrollment et
    // vérifie qu'on a atteint le délai. Si non, refuse avec 423 LESSON_LOCKED_DRIP.
    // Best-effort : si la DB ne renvoie rien, on laisse passer (legacy fallback).
    try {
      const dripLessonRow = (await env.DB.prepare(
        'SELECT drip_delay_days FROM course_lessons WHERE id = ? LIMIT 1',
      )
        .bind(lessonId)
        .first()) as { drip_delay_days: number | null } | null;
      const dripEnrollRow = (await env.DB.prepare(
        'SELECT enrolled_at FROM course_enrollments WHERE id = ? LIMIT 1',
      )
        .bind(enrollmentId)
        .first()) as { enrolled_at: string | null } | null;

      if (dripLessonRow && dripEnrollRow) {
        const available = isLessonAvailable(
          dripEnrollRow.enrolled_at,
          dripLessonRow.drip_delay_days,
          new Date(),
        );
        if (!available) {
          return json(
            {
              error: LMS_ERROR_CODES.LESSON_LOCKED_DRIP,
              code: LMS_ERROR_CODES.LESSON_LOCKED_DRIP,
            },
            423,
          );
        }
      }
    } catch {
      // Lecture DB KO (legacy schema) → on n'applique pas de verrou drip.
    }

    const now = new Date().toISOString();
    const progressId = crypto.randomUUID();

    // UPSERT lms_lesson_progress via INSERT OR IGNORE + UPDATE completed_at WHERE NULL.
    // L'index UNIQUE (lesson_id, enrollment_id) seq138 garantit l'atomicité.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO lms_lesson_progress
         (id, lesson_id, enrollment_id, customer_id, started_at, completed_at, time_spent_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        progressId,
        lessonId,
        enrollmentId,
        enroll.customerId,
        now,
        now,
        timeSpent,
      )
      .run();

    await env.DB.prepare(
      `UPDATE lms_lesson_progress
          SET completed_at = ?,
              time_spent_sec = COALESCE(time_spent_sec, 0) + ?
        WHERE lesson_id = ? AND enrollment_id = ? AND completed_at IS NULL`,
    )
      .bind(now, timeSpent, lessonId, enrollmentId)
      .run();

    // Recompute progress + déclenche certificat si seuil atteint.
    const progress = await computeProgress(env, enrollmentId);
    let certificateIssued: {
      id: string;
      certificate_number: string;
      certificate_url: string | null;
    } | null = null;

    if (progress.can_get_certificate) {
      // Vérifie qu'un certificat n'existe pas déjà pour cet enrollment.
      const existing = (await env.DB.prepare(
        'SELECT id, certificate_number, certificate_url FROM course_certificates WHERE enrollment_id = ? LIMIT 1',
      )
        .bind(enrollmentId)
        .first()) as {
        id: string;
        certificate_number: string | null;
        certificate_url: string | null;
      } | null;

      if (existing) {
        certificateIssued = {
          id: existing.id,
          certificate_number: existing.certificate_number || '',
          certificate_url: existing.certificate_url,
        };
      } else {
        // Load course + customer pour template.
        const courseRow = (await env.DB.prepare(
          'SELECT id, title, certificate_template_html FROM courses WHERE id = ? LIMIT 1',
        )
          .bind(enroll.courseId)
          .first()) as {
          id: string;
          title: string;
          certificate_template_html: string | null;
        } | null;

        let customerName = 'Membre';
        if (enroll.customerId) {
          try {
            const m = (await env.DB.prepare(
              'SELECT name, first_name, last_name, email FROM members WHERE id = ? LIMIT 1',
            )
              .bind(enroll.customerId)
              .first()) as {
              name?: string | null;
              first_name?: string | null;
              last_name?: string | null;
              email?: string | null;
            } | null;
            if (m) {
              customerName =
                (m.name && String(m.name)) ||
                [m.first_name, m.last_name].filter(Boolean).join(' ').trim() ||
                (m.email && String(m.email)) ||
                'Membre';
            }
          } catch {
            // members table absente ou colonnes manquantes — garde default.
          }
        }

        // Pick numéro unique par tenant (max 5 retries).
        let certNumber = generateCertificateNumber();
        for (let attempt = 0; attempt < 5; attempt++) {
          const collide = (await env.DB.prepare(
            `SELECT cc.id FROM course_certificates cc
               JOIN courses c ON c.id = cc.course_id
              WHERE c.client_id = ? AND cc.certificate_number = ?
              LIMIT 1`,
          )
            .bind(clientId, certNumber)
            .first()) as { id: string } | null;
          if (!collide) break;
          certNumber = generateCertificateNumber();
        }

        const pdfBytes = await generateCertificatePdf(
          {
            id: enroll.courseId,
            title: courseRow?.title || 'Cours',
            certificate_template_html: courseRow?.certificate_template_html ?? null,
          },
          { id: enroll.customerId || '', name: customerName },
          courseRow?.certificate_template_html ?? null,
          certNumber,
        );

        // Upload R2 best-effort (binding env.FILES).
        let r2Key: string | null = null;
        if (env.FILES && pdfBytes && pdfBytes.byteLength > 0) {
          try {
            const key = `certificates/${clientId}/${enrollmentId}/${certNumber}.pdf`;
            await env.FILES.put(key, pdfBytes, {
              httpMetadata: { contentType: 'application/pdf' },
              customMetadata: {
                course_id: enroll.courseId,
                enrollment_id: enrollmentId,
                certificate_number: certNumber,
              },
            });
            r2Key = key;
          } catch {
            // R2 KO : on persiste sans URL (UI affichera « indisponible »).
            r2Key = null;
          }
        }

        const certId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO course_certificates
             (id, course_id, enrollment_id, customer_id, certificate_url,
              certificate_number, issued_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            certId,
            enroll.courseId,
            enrollmentId,
            enroll.customerId,
            r2Key,
            certNumber,
            now,
          )
          .run();

        await audit(env, auth.userId, 'create', 'course_certificate', certId, {
          enrollment_id: enrollmentId,
          course_id: enroll.courseId,
          certificate_number: certNumber,
        });

        certificateIssued = {
          id: certId,
          certificate_number: certNumber,
          certificate_url: r2Key,
        };
      }
    }

    await audit(env, auth.userId, 'complete', 'course_lesson', lessonId, {
      enrollment_id: enrollmentId,
      time_spent_sec: timeSpent,
    });

    return json({
      data: {
        lesson_id: lessonId,
        enrollment_id: enrollmentId,
        completed_at: now,
        progress,
        certificate: certificateIssued,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 4 handlers Quizzes/Questions CRUD ──────────────────────────────────────

/** GET /api/lessons/:id/quizzes — liste quizzes d'une leçon. */
export async function handleListLessonQuizzes(
  env: Env,
  auth: CoursesLmsAuth,
  lessonId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'clients.manage');
  if (g) return g;
  if (!lessonId || typeof lessonId !== 'string') {
    return json({ error: 'lesson_id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await resolveLessonTenant(env, lessonId, clientId);
    if (!tenant) {
      return json({ error: 'Leçon introuvable' }, 404);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, lesson_id, title, passing_score, max_attempts, created_at, updated_at
         FROM course_quizzes
        WHERE lesson_id = ?
        ORDER BY created_at ASC`,
    )
      .bind(lessonId)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/lessons/:id/quizzes — créer un quiz attaché à une leçon. */
export async function handleCreateQuiz(
  request: Request,
  env: Env,
  auth: CoursesLmsAuth,
  lessonId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'clients.manage');
  if (g) return g;
  if (!lessonId || typeof lessonId !== 'string') {
    return json({ error: 'lesson_id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await resolveLessonTenant(env, lessonId, clientId);
    if (!tenant) {
      return json({ error: 'Leçon introuvable' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const title =
      typeof body.title === 'string' ? sanitizeInput(body.title, 200) : null;
    const passing =
      typeof body.passing_score === 'number' &&
      body.passing_score >= 0 &&
      body.passing_score <= 1
        ? body.passing_score
        : 0.7;
    const maxAttempts =
      typeof body.max_attempts === 'number' && body.max_attempts > 0
        ? Math.floor(body.max_attempts)
        : 3;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO course_quizzes
         (id, lesson_id, title, passing_score, max_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, lessonId, title, passing, maxAttempts, now, now)
      .run();

    await audit(env, auth.userId, 'create', 'course_quiz', id, {
      lesson_id: lessonId,
      title,
    });

    return json(
      {
        data: {
          id,
          lesson_id: lessonId,
          title,
          passing_score: passing,
          max_attempts: maxAttempts,
          created_at: now,
          updated_at: now,
        },
      },
      201,
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** GET /api/quizzes/:id/questions — liste questions d'un quiz. */
export async function handleListQuizQuestions(
  env: Env,
  auth: CoursesLmsAuth,
  quizId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'clients.manage');
  if (g) return g;
  if (!quizId || typeof quizId !== 'string') {
    return json({ error: 'quiz_id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await resolveQuizTenant(env, quizId, clientId);
    if (!tenant) {
      return json({ error: 'Quiz introuvable' }, 404);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, quiz_id, question_text, type, options_json,
              correct_answer, points, order_index
         FROM quiz_questions
        WHERE quiz_id = ?
        ORDER BY order_index ASC`,
    )
      .bind(quizId)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/quizzes/:id/questions — créer une question. */
export async function handleCreateQuestion(
  request: Request,
  env: Env,
  auth: CoursesLmsAuth,
  quizId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'clients.manage');
  if (g) return g;
  if (!quizId || typeof quizId !== 'string') {
    return json({ error: 'quiz_id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await resolveQuizTenant(env, quizId, clientId);
    if (!tenant) {
      return json({ error: 'Quiz introuvable' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const questionText =
      typeof body.question_text === 'string' ? body.question_text.trim() : '';
    if (!questionText) {
      return json({ error: 'question_text est requis' }, 400);
    }

    const typeRaw = typeof body.type === 'string' ? body.type : 'multiple_choice';
    if (!VALID_QUESTION_TYPES.has(typeRaw as QuizQuestionType)) {
      return json(
        { error: 'type invalide (valeurs : multiple_choice|text|true_false)' },
        400,
      );
    }
    const type = typeRaw as QuizQuestionType;

    const correctAnswer =
      typeof body.correct_answer === 'string' ? body.correct_answer.trim() : '';
    if (!correctAnswer) {
      return json({ error: 'correct_answer est requis' }, 400);
    }

    let optionsJson: string | null = null;
    if (body.options_json != null) {
      if (typeof body.options_json === 'string') {
        optionsJson = body.options_json;
      } else if (Array.isArray(body.options_json)) {
        optionsJson = JSON.stringify(body.options_json);
      }
    }

    const points =
      typeof body.points === 'number' && body.points >= 0
        ? Math.floor(body.points)
        : 1;
    const orderIndex =
      typeof body.order_index === 'number' ? Math.floor(body.order_index) : 0;

    const id = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO quiz_questions
         (id, quiz_id, question_text, type, options_json, correct_answer, points, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, quizId, questionText, type, optionsJson, correctAnswer, points, orderIndex)
      .run();

    await audit(env, auth.userId, 'create', 'quiz_question', id, {
      quiz_id: quizId,
      type,
    });

    return json(
      {
        data: {
          id,
          quiz_id: quizId,
          question_text: questionText,
          type,
          options_json: optionsJson,
          correct_answer: correctAnswer,
          points,
          order_index: orderIndex,
        },
      },
      201,
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/quizzes/:id/attempt — submit une tentative (member-facing).
 * Capability `leads.write`. Body { enrollment_id, answers }.
 */
export async function handleSubmitQuizAttempt(
  request: Request,
  env: Env,
  auth: CoursesLmsAuth,
  quizId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;
  if (!quizId || typeof quizId !== 'string') {
    return json({ error: 'quiz_id invalide' }, 400);
  }
  if (!isLikelyValidId(quizId)) {
    return json(
      { error: LMS_ERROR_CODES.INVALID_ID_FORMAT, code: LMS_ERROR_CODES.INVALID_ID_FORMAT },
      400,
    );
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await resolveQuizTenant(env, quizId, clientId);
    if (!tenant) {
      return json({ error: 'Quiz introuvable' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const enrollmentId =
      typeof body.enrollment_id === 'string' ? body.enrollment_id.trim() : '';
    if (!enrollmentId) {
      return json({ error: 'enrollment_id requis' }, 400);
    }
    const answersRaw =
      body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
        ? (body.answers as Record<string, unknown>)
        : {};
    const answers: Record<string, string> = {};
    for (const [k, v] of Object.entries(answersRaw)) {
      if (typeof v === 'string') answers[k] = v;
      else if (typeof v === 'boolean') answers[k] = v ? 'true' : 'false';
      else if (typeof v === 'number') answers[k] = String(v);
    }

    const enroll = await resolveEnrollmentTenant(env, enrollmentId, clientId);
    if (!enroll) {
      return json({ error: 'Enrollment introuvable' }, 404);
    }
    if (enroll.courseId !== tenant.courseId) {
      return json({ error: 'Enrollment ne correspond pas au cours du quiz' }, 400);
    }

    // Load passing_score du quiz.
    const quizRow = (await env.DB.prepare(
      'SELECT passing_score, max_attempts FROM course_quizzes WHERE id = ? LIMIT 1',
    )
      .bind(quizId)
      .first()) as { passing_score: number | null; max_attempts: number | null } | null;
    const passingScore =
      quizRow && typeof quizRow.passing_score === 'number' ? quizRow.passing_score : 0.7;
    const maxAttempts =
      quizRow && typeof quizRow.max_attempts === 'number' && quizRow.max_attempts > 0
        ? quizRow.max_attempts
        : 3;

    // Check max_attempts (hard cap applicatif → 429 QUIZ_MAX_ATTEMPTS).
    const previousRow = (await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM quiz_attempts WHERE quiz_id = ? AND enrollment_id = ?',
    )
      .bind(quizId, enrollmentId)
      .first()) as { count: number } | null;
    const previousCount =
      previousRow && typeof previousRow.count === 'number' ? previousRow.count : 0;
    if (previousCount >= maxAttempts) {
      return json(
        {
          error: LMS_ERROR_CODES.QUIZ_MAX_ATTEMPTS,
          code: LMS_ERROR_CODES.QUIZ_MAX_ATTEMPTS,
        },
        429,
      );
    }

    // Load questions du quiz.
    const { results: qResults } = await env.DB.prepare(
      `SELECT id, quiz_id, question_text, type, options_json,
              correct_answer, points, order_index
         FROM quiz_questions
        WHERE quiz_id = ?
        ORDER BY order_index ASC`,
    )
      .bind(quizId)
      .all();

    const questions: QuizQuestion[] = ((qResults || []) as Array<Record<string, unknown>>).map(
      (r) => ({
        id: String(r.id ?? ''),
        quiz_id: String(r.quiz_id ?? ''),
        question_text: String(r.question_text ?? ''),
        type:
          (r.type as QuizQuestionType) === 'text' ||
          (r.type as QuizQuestionType) === 'true_false'
            ? (r.type as QuizQuestionType)
            : 'multiple_choice',
        options_json: r.options_json == null ? null : String(r.options_json),
        correct_answer: String(r.correct_answer ?? ''),
        points: typeof r.points === 'number' ? r.points : 1,
        order_index: typeof r.order_index === 'number' ? r.order_index : 0,
      }),
    );

    // Validation explicite : toutes les questions présentes + types whitelist.
    // Refuse les body malformés AVANT grade (DX UI + audit log clair).
    const validation = validateQuizAnswers(questions, answers);
    if (!validation.ok) {
      return json(
        {
          error: validation.code,
          code: validation.code,
          ...(validation.questionId ? { questionId: validation.questionId } : {}),
        },
        400,
      );
    }

    const graded = gradeQuizAttempt(questions, answers);
    const passed = graded.score >= passingScore;

    const attemptId = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO quiz_attempts
         (id, quiz_id, enrollment_id, customer_id, answers_json, score, passed, attempted_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        attemptId,
        quizId,
        enrollmentId,
        enroll.customerId,
        JSON.stringify(answers),
        graded.score,
        passed ? 1 : 0,
        now,
        now,
      )
      .run();

    await audit(env, auth.userId, 'create', 'quiz_attempt', attemptId, {
      quiz_id: quizId,
      enrollment_id: enrollmentId,
      score: graded.score,
      passed,
    });

    return json(
      {
        data: {
          id: attemptId,
          quiz_id: quizId,
          enrollment_id: enrollmentId,
          customer_id: enroll.customerId,
          score: graded.score,
          passed,
          passing_score: passingScore,
          breakdown: graded.breakdown,
          attempted_at: now,
          completed_at: now,
        },
      },
      201,
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 3 handlers Progress + Certificates ─────────────────────────────────────

/** GET /api/enrollments/:id/progress — progression agrégée d'un enrollment. */
export async function handleGetProgress(
  env: Env,
  auth: CoursesLmsAuth,
  enrollmentId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;
  if (!enrollmentId || typeof enrollmentId !== 'string') {
    return json({ error: 'enrollment_id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const enroll = await resolveEnrollmentTenant(env, enrollmentId, clientId);
    if (!enroll) {
      return json({ error: 'Enrollment introuvable' }, 404);
    }

    const progress = await computeProgress(env, enrollmentId);
    return json({ data: progress });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** GET /api/certificates?customer_id=:id — liste certificats d'un customer. */
export async function handleListCertificates(
  env: Env,
  auth: CoursesLmsAuth,
  url: URL,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const customerId = url.searchParams.get('customer_id');
    const enrollmentFilter = url.searchParams.get('enrollment_id');

    let query =
      `SELECT cc.id, cc.course_id, cc.enrollment_id, cc.customer_id,
              cc.certificate_url, cc.certificate_number, cc.issued_at
         FROM course_certificates cc
         JOIN courses c ON c.id = cc.course_id
        WHERE c.client_id = ?`;
    const binds: unknown[] = [clientId];

    if (customerId) {
      query += ' AND cc.customer_id = ?';
      binds.push(customerId);
    }
    if (enrollmentFilter) {
      query += ' AND cc.enrollment_id = ?';
      binds.push(enrollmentFilter);
    }
    query += ' ORDER BY cc.issued_at DESC LIMIT 200';

    const { results } = await env.DB.prepare(query)
      .bind(...binds)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * GET /api/certificates/:id/download — télécharge le PDF du certificat
 * (streaming R2 GET). Retourne JSON 503 si env.FILES (R2) absent.
 */
export async function handleDownloadCertificate(
  env: Env,
  auth: CoursesLmsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;
  if (!id || typeof id !== 'string') {
    return json({ error: 'id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const cert = (await env.DB.prepare(
      `SELECT cc.id, cc.certificate_url, cc.certificate_number, cc.course_id
         FROM course_certificates cc
         JOIN courses c ON c.id = cc.course_id
        WHERE cc.id = ? AND c.client_id = ?
        LIMIT 1`,
    )
      .bind(id, clientId)
      .first()) as {
      id: string;
      certificate_url: string | null;
      certificate_number: string | null;
      course_id: string;
    } | null;

    if (!cert) {
      return json({ error: 'Certificat introuvable' }, 404);
    }

    if (!env.FILES) {
      return json({ error: 'Stockage R2 non configuré' }, 503);
    }

    if (!cert.certificate_url) {
      return json({ error: 'Certificat indisponible (PDF manquant)' }, 404);
    }

    const r2Object = await env.FILES.get(cert.certificate_url);
    if (!r2Object) {
      return json({ error: 'PDF non trouvé dans le stockage' }, 404);
    }

    const filename =
      (cert.certificate_number ? `certificate-${cert.certificate_number}` : `certificate-${id}`) +
      '.pdf';

    return new Response(r2Object.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
