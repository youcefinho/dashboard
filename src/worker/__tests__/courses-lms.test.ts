// ── Tests — Courses LMS (Sprint 51 — Agent T43) ────────────────────────────
//
// Sprint 43 Courses LMS : 5 cas engine (lms-engine.ts) + 5 cas handlers
// (courses-lms.ts). Mock D1 complet via _helpers.createMockD1.
//
// Contrats §6 (docs/LOT-COURSES-LMS-S43.md) :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)   ← JAMAIS de champ `code`
//
// Bornage tenant via getClientModules (calque _ecommerce-fixtures.ts) :
//   - SELECT client_id FROM users WHERE id = ?       → users.client_id
//   - SELECT modules_json FROM clients WHERE id = ?  → clients.modules_json
//
// First-seed-wins : seed les needles SPÉCIFIQUES avant les GÉNÉRIQUES.

import { describe, it, expect } from 'vitest';
import {
  computeProgress,
  gradeQuizAttempt,
  generateCertificatePdf,
  pickCertificateNumber,
  generateCertificateNumber,
  renderCertificateHtml,
  isLessonAvailable,
  validateQuizAnswers,
  isUuidHex,
  LMS_ERROR_CODES,
  DEFAULT_COMPLETION_THRESHOLD,
} from '../lib/lms-engine';
import {
  handleCreateLesson,
  handleMarkLessonComplete,
  handleSubmitQuizAttempt,
  handleGetProgress,
} from '../courses-lms';
import { createMockD1, type MockD1 } from './_helpers';
import type { QuizQuestion } from '../../lib/api';

const CLIENT_ID = 'client-A';
const USER_ID = 'user-A';
const COURSE_ID = 'course-1';
const LESSON_ID = 'lesson-1';
const QUIZ_ID = 'quiz-1';
const ENROLLMENT_ID = 'enroll-1';
const CUSTOMER_ID = 'cust-1';

type Auth = {
  userId: string;
  role: string;
  capabilities?: Set<string>;
};

function makeAuth(caps: string[] = ['clients.manage', 'leads.write']): Auth {
  return {
    userId: USER_ID,
    role: 'admin',
    capabilities: new Set(caps),
  };
}

function lmsEnv(db: MockD1): { DB: MockD1 } {
  return { DB: db };
}

/** Seed la résolution du tenant (getClientModules → users + clients). */
function seedTenant(db: MockD1): void {
  db.seed('from users where id', [{ client_id: CLIENT_ID }]);
  db.seed('modules_json from clients', [{ modules_json: '[]' }]);
}

/** Seed un cours tenant-bound (assertCourseInTenant + resolveLessonTenant). */
function seedCourse(db: MockD1, threshold = 0.5): void {
  // assertCourseInTenant : SELECT id FROM courses WHERE id = ? AND client_id = ?
  db.seed('id from courses where id = ? and client_id', [{ id: COURSE_ID }]);
  // computeProgress : SELECT completion_threshold FROM courses WHERE id = ?
  db.seed('completion_threshold from courses', [
    { completion_threshold: threshold },
  ]);
  // courses load pour certificat
  db.seed('certificate_template_html from courses', [
    {
      id: COURSE_ID,
      title: 'Cours Test',
      certificate_template_html: null,
    },
  ]);
}

/** Seed resolveLessonTenant (JOIN course_lessons + courses). */
function seedLessonTenant(db: MockD1): void {
  db.seed('from course_lessons cl', [{ course_id: COURSE_ID }]);
}

/** Seed resolveQuizTenant (JOIN course_quizzes + course_lessons + courses). */
function seedQuizTenant(db: MockD1): void {
  db.seed('from course_quizzes cq', [
    { lesson_id: LESSON_ID, course_id: COURSE_ID },
  ]);
}

/** Seed resolveEnrollmentTenant + computeProgress lookup. */
function seedEnrollment(db: MockD1): void {
  // resolveEnrollmentTenant : SELECT course_id, member_id, client_id FROM course_enrollments WHERE id = ? AND client_id = ?
  db.seed('from course_enrollments where id = ? and client_id', [
    { course_id: COURSE_ID, member_id: CUSTOMER_ID, client_id: CLIENT_ID },
  ]);
  // computeProgress : SELECT course_id, client_id FROM course_enrollments WHERE id = ?
  db.seed('course_id, client_id from course_enrollments', [
    { course_id: COURSE_ID, client_id: CLIENT_ID },
  ]);
}

function hasCall(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}

// ════════════════════════════════════════════════════════════════════════════
// ENGINE — 5 cas
// ════════════════════════════════════════════════════════════════════════════

describe('computeProgress', () => {
  it('5 lessons total / 3 completed → progress_pct=0.6, can_get_certificate=true (threshold 0.5)', async () => {
    const db = createMockD1();
    // resolveEnrollment course_id
    db.seed('course_id, client_id from course_enrollments', [
      { course_id: COURSE_ID, client_id: CLIENT_ID },
    ]);
    // total lessons (COUNT course_lessons WHERE is_published=1)
    db.seed('from course_lessons where course_id', [{ count: 5 }]);
    // completed lessons (COUNT lms_lesson_progress WHERE completed_at NOT NULL)
    db.seed('from lms_lesson_progress where enrollment_id', [{ count: 3 }]);
    // course threshold = 0.5
    db.seed('completion_threshold from courses', [
      { completion_threshold: 0.5 },
    ]);

    const out = await computeProgress(lmsEnv(db) as never, ENROLLMENT_ID);

    expect(out.total_lessons).toBe(5);
    expect(out.completed_lessons).toBe(3);
    expect(out.progress_pct).toBeCloseTo(0.6, 5);
    expect(out.can_get_certificate).toBe(true);
  });
});

describe('gradeQuizAttempt — multiple_choice', () => {
  it('4 questions (1pt chacune), 3 correctes → score 0.75', () => {
    const questions: QuizQuestion[] = [
      {
        id: 'q1',
        quiz_id: QUIZ_ID,
        question_text: 'Q1',
        type: 'multiple_choice',
        options_json: '["A","B","C","D"]',
        correct_answer: 'A',
        points: 1,
        order_index: 0,
      },
      {
        id: 'q2',
        quiz_id: QUIZ_ID,
        question_text: 'Q2',
        type: 'multiple_choice',
        options_json: '["A","B","C","D"]',
        correct_answer: 'B',
        points: 1,
        order_index: 1,
      },
      {
        id: 'q3',
        quiz_id: QUIZ_ID,
        question_text: 'Q3',
        type: 'multiple_choice',
        options_json: '["A","B","C","D"]',
        correct_answer: 'C',
        points: 1,
        order_index: 2,
      },
      {
        id: 'q4',
        quiz_id: QUIZ_ID,
        question_text: 'Q4',
        type: 'multiple_choice',
        options_json: '["A","B","C","D"]',
        correct_answer: 'D',
        points: 1,
        order_index: 3,
      },
    ];
    const answers = { q1: 'A', q2: 'B', q3: 'C', q4: 'X' }; // 3 correctes

    const result = gradeQuizAttempt(questions, answers);

    expect(result.score).toBeCloseTo(0.75, 5);
    expect(result.breakdown.q1.correct).toBe(true);
    expect(result.breakdown.q2.correct).toBe(true);
    expect(result.breakdown.q3.correct).toBe(true);
    expect(result.breakdown.q4.correct).toBe(false);
    expect(result.breakdown.q1.points_earned).toBe(1);
    expect(result.breakdown.q4.points_earned).toBe(0);
  });
});

describe('gradeQuizAttempt — text case-insensitive', () => {
  it('correct=PARIS, answer=paris → correct', () => {
    const questions: QuizQuestion[] = [
      {
        id: 'qt',
        quiz_id: QUIZ_ID,
        question_text: 'Capitale France ?',
        type: 'text',
        options_json: null,
        correct_answer: 'PARIS',
        points: 1,
        order_index: 0,
      },
    ];
    const result = gradeQuizAttempt(questions, { qt: 'paris' });

    expect(result.breakdown.qt.correct).toBe(true);
    expect(result.score).toBe(1);
  });

  it('correct=PARIS, answer="  Paris  " (trim + lower) → correct', () => {
    const questions: QuizQuestion[] = [
      {
        id: 'qt',
        quiz_id: QUIZ_ID,
        question_text: 'Capitale ?',
        type: 'text',
        options_json: null,
        correct_answer: 'PARIS',
        points: 1,
        order_index: 0,
      },
    ];
    const result = gradeQuizAttempt(questions, { qt: '  Paris  ' });
    expect(result.breakdown.qt.correct).toBe(true);
  });
});

describe('pickCertificateNumber — format', () => {
  it('matches /^CERT-[A-F0-9]{8}-[A-F0-9]{8}$/', () => {
    const n = pickCertificateNumber();
    expect(n).toMatch(/^CERT-[A-F0-9]{8}-[A-F0-9]{8}$/);
  });

  it('génère des valeurs distinctes (entropie crypto)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 10; i++) set.add(pickCertificateNumber());
    expect(set.size).toBe(10);
  });
});

describe('generateCertificatePdf — interpolation', () => {
  it('template avec {{customer_name}} + {{course_title}} → Uint8Array contient les valeurs', async () => {
    const tpl =
      '<html><body><h1>{{customer_name}}</h1><p>{{course_title}}</p><p>#{{certificate_number}}</p></body></html>';
    const bytes = await generateCertificatePdf(
      { id: COURSE_ID, title: 'Cours Avancé' },
      { id: CUSTOMER_ID, name: 'Jean Dupont' },
      tpl,
      'CERT-AAAAAAAA-BBBBBBBB',
    );

    expect(bytes).toBeInstanceOf(Uint8Array);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain('Jean Dupont');
    expect(decoded).toContain('Cours Avancé');
    expect(decoded).toContain('CERT-AAAAAAAA-BBBBBBBB');
    // Les placeholders eux-mêmes ont été remplacés.
    expect(decoded).not.toContain('{{customer_name}}');
    expect(decoded).not.toContain('{{course_title}}');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — 5 cas
// ════════════════════════════════════════════════════════════════════════════

describe('handleCreateLesson', () => {
  it('succès : INSERT course_lessons + 201 + data complet', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedCourse(db);

    const req = new Request(`https://x/api/courses/${COURSE_ID}/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Leçon 1 — Intro',
        content: 'Contenu HTML',
        order_index: 0,
        is_published: true,
      }),
    });

    const res = await handleCreateLesson(
      req,
      lmsEnv(db) as never,
      makeAuth(['clients.manage']),
      COURSE_ID,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data?: { id: string; course_id: string; title: string; is_published: boolean };
    };
    expect(body.data).toBeTruthy();
    expect(typeof body.data?.id).toBe('string');
    expect(body.data?.course_id).toBe(COURSE_ID);
    expect(body.data?.title).toBe('Leçon 1 — Intro');
    expect(body.data?.is_published).toBe(true);
    expect(hasCall(db, /insert\s+into\s+course_lessons/i)).toBe(true);
  });

  it('sans cap clients.manage → 403', async () => {
    const db = createMockD1();
    const req = new Request(`https://x/api/courses/${COURSE_ID}/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X' }),
    });
    const res = await handleCreateLesson(
      req,
      lmsEnv(db) as never,
      makeAuth([]), // pas de cap
      COURSE_ID,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });
});

describe('handleMarkLessonComplete', () => {
  it('UPSERT lms_lesson_progress + threshold atteint → INSERT course_certificate', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedCourse(db, 0.5);
    seedLessonTenant(db);
    seedEnrollment(db);
    // computeProgress : 2/2 complétées → 100% > 50%
    db.seed('from course_lessons where course_id', [{ count: 2 }]);
    db.seed('from lms_lesson_progress where enrollment_id', [{ count: 2 }]);
    // Pas de certificat existant.
    db.seed('from course_certificates where enrollment_id', []);
    // Pas de collision sur certificate_number.
    db.seed('from course_certificates cc', []);
    // Customer name lookup
    db.seed('from members where id', [
      { name: 'Alice Test', first_name: null, last_name: null, email: null },
    ]);

    const req = new Request(`https://x/api/lessons/${LESSON_ID}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollment_id: ENROLLMENT_ID, time_spent_sec: 120 }),
    });

    const res = await handleMarkLessonComplete(
      req,
      lmsEnv(db) as never,
      makeAuth(['leads.write']),
      LESSON_ID,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: {
        lesson_id: string;
        progress: { can_get_certificate: boolean; progress_pct: number };
        certificate: { id: string; certificate_number: string } | null;
      };
    };
    expect(body.data?.lesson_id).toBe(LESSON_ID);
    expect(body.data?.progress.can_get_certificate).toBe(true);
    expect(body.data?.certificate).toBeTruthy();
    expect(body.data?.certificate?.certificate_number).toMatch(
      /^CERT-[A-F0-9]{8}-[A-F0-9]{8}$/,
    );
    // UPSERT lms_lesson_progress (INSERT OR IGNORE + UPDATE)
    expect(hasCall(db, /insert\s+or\s+ignore\s+into\s+lms_lesson_progress/i)).toBe(
      true,
    );
    expect(hasCall(db, /update\s+lms_lesson_progress/i)).toBe(true);
    // INSERT course_certificates
    expect(hasCall(db, /insert\s+into\s+course_certificates/i)).toBe(true);
  });
});

describe('handleSubmitQuizAttempt', () => {
  it('load questions + gradeQuizAttempt + INSERT quiz_attempts', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedQuizTenant(db);
    seedEnrollment(db);
    // Quiz config
    db.seed('passing_score, max_attempts from course_quizzes', [
      { passing_score: 0.5, max_attempts: 3 },
    ]);
    // Aucune tentative précédente
    db.seed('count(*) as count from quiz_attempts', [{ count: 0 }]);
    // 2 questions seedées
    db.seed('from quiz_questions', [
      {
        id: 'q1',
        quiz_id: QUIZ_ID,
        question_text: 'Q1',
        type: 'multiple_choice',
        options_json: '["A","B"]',
        correct_answer: 'A',
        points: 1,
        order_index: 0,
      },
      {
        id: 'q2',
        quiz_id: QUIZ_ID,
        question_text: 'Q2',
        type: 'text',
        options_json: null,
        correct_answer: 'paris',
        points: 1,
        order_index: 1,
      },
    ]);

    const req = new Request(`https://x/api/quizzes/${QUIZ_ID}/attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enrollment_id: ENROLLMENT_ID,
        answers: { q1: 'A', q2: 'PARIS' }, // les 2 correctes
      }),
    });

    const res = await handleSubmitQuizAttempt(
      req,
      lmsEnv(db) as never,
      makeAuth(['leads.write']),
      QUIZ_ID,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data?: { score: number; passed: boolean; passing_score: number };
    };
    expect(body.data?.score).toBe(1);
    expect(body.data?.passed).toBe(true);
    expect(body.data?.passing_score).toBe(0.5);
    expect(hasCall(db, /insert\s+into\s+quiz_attempts/i)).toBe(true);
  });
});

describe('handleGetProgress', () => {
  it('appelle computeProgress et retourne { data }', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedEnrollment(db);
    db.seed('from course_lessons where course_id', [{ count: 4 }]);
    db.seed('from lms_lesson_progress where enrollment_id', [{ count: 2 }]);
    db.seed('completion_threshold from courses', [
      { completion_threshold: 0.8 },
    ]);

    const res = await handleGetProgress(
      lmsEnv(db) as never,
      makeAuth(['leads.write']),
      ENROLLMENT_ID,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: {
        completed_lessons: number;
        total_lessons: number;
        progress_pct: number;
        can_get_certificate: boolean;
      };
    };
    expect(body.data?.total_lessons).toBe(4);
    expect(body.data?.completed_lessons).toBe(2);
    expect(body.data?.progress_pct).toBeCloseTo(0.5, 5);
    expect(body.data?.can_get_certificate).toBe(false); // 0.5 < 0.8
  });
});

describe('Cap check — sans leads.write → 403', () => {
  it('handleGetProgress sans cap → 403', async () => {
    const db = createMockD1();
    const res = await handleGetProgress(
      lmsEnv(db) as never,
      makeAuth([]), // aucune cap
      ENROLLMENT_ID,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REINFORCEMENT — helpers ajoutés (Sprint 43)
// ════════════════════════════════════════════════════════════════════════════

describe('gradeQuizAttempt — edge cases', () => {
  it('all correct → score 1', () => {
    const questions: QuizQuestion[] = [
      {
        id: 'q1',
        quiz_id: QUIZ_ID,
        question_text: 'Q1',
        type: 'multiple_choice',
        options_json: '["A","B"]',
        correct_answer: 'A',
        points: 1,
        order_index: 0,
      },
      {
        id: 'q2',
        quiz_id: QUIZ_ID,
        question_text: 'Q2',
        type: 'multiple_choice',
        options_json: '["A","B"]',
        correct_answer: 'B',
        points: 1,
        order_index: 1,
      },
    ];
    const res = gradeQuizAttempt(questions, { q1: 'A', q2: 'B' });
    expect(res.score).toBe(1);
    expect(res.breakdown.q1.correct).toBe(true);
    expect(res.breakdown.q2.correct).toBe(true);
  });

  it('all wrong → score 0', () => {
    const questions: QuizQuestion[] = [
      {
        id: 'q1',
        quiz_id: QUIZ_ID,
        question_text: 'Q1',
        type: 'multiple_choice',
        options_json: '["A","B"]',
        correct_answer: 'A',
        points: 1,
        order_index: 0,
      },
      {
        id: 'q2',
        quiz_id: QUIZ_ID,
        question_text: 'Q2',
        type: 'multiple_choice',
        options_json: '["A","B"]',
        correct_answer: 'B',
        points: 1,
        order_index: 1,
      },
    ];
    const res = gradeQuizAttempt(questions, { q1: 'X', q2: 'Y' });
    expect(res.score).toBe(0);
    expect(res.breakdown.q1.correct).toBe(false);
    expect(res.breakdown.q2.correct).toBe(false);
  });

  it('partial credit avec pondération points (3+1 sur 4) → score 0.75', () => {
    const questions: QuizQuestion[] = [
      {
        id: 'q1',
        quiz_id: QUIZ_ID,
        question_text: 'Q1 (3pts)',
        type: 'multiple_choice',
        options_json: '["A","B"]',
        correct_answer: 'A',
        points: 3,
        order_index: 0,
      },
      {
        id: 'q2',
        quiz_id: QUIZ_ID,
        question_text: 'Q2 (1pt)',
        type: 'multiple_choice',
        options_json: '["A","B"]',
        correct_answer: 'B',
        points: 1,
        order_index: 1,
      },
    ];
    // q1 correct (3 pts), q2 wrong (0 pts) → 3/4 = 0.75
    const res = gradeQuizAttempt(questions, { q1: 'A', q2: 'X' });
    expect(res.score).toBeCloseTo(0.75, 5);
    expect(res.breakdown.q1.points_earned).toBe(3);
    expect(res.breakdown.q2.points_earned).toBe(0);
  });

  it('true_false normalise "TRUE" / "False" → correct', () => {
    const questions: QuizQuestion[] = [
      {
        id: 'tf1',
        quiz_id: QUIZ_ID,
        question_text: 'TF1',
        type: 'true_false',
        options_json: null,
        correct_answer: 'true',
        points: 1,
        order_index: 0,
      },
      {
        id: 'tf2',
        quiz_id: QUIZ_ID,
        question_text: 'TF2',
        type: 'true_false',
        options_json: null,
        correct_answer: 'FALSE',
        points: 1,
        order_index: 1,
      },
    ];
    const res = gradeQuizAttempt(questions, { tf1: 'TRUE', tf2: 'False' });
    expect(res.breakdown.tf1.correct).toBe(true);
    expect(res.breakdown.tf2.correct).toBe(true);
    expect(res.score).toBe(1);
  });

  it('true_false rejette valeur non true/false (ex: "oui")', () => {
    const questions: QuizQuestion[] = [
      {
        id: 'tf1',
        quiz_id: QUIZ_ID,
        question_text: 'TF1',
        type: 'true_false',
        options_json: null,
        correct_answer: 'true',
        points: 1,
        order_index: 0,
      },
    ];
    const res = gradeQuizAttempt(questions, { tf1: 'oui' });
    expect(res.breakdown.tf1.correct).toBe(false);
    expect(res.score).toBe(0);
  });

  it('total points = 0 → score 0 (pas de division par 0)', () => {
    const questions: QuizQuestion[] = [
      {
        id: 'q1',
        quiz_id: QUIZ_ID,
        question_text: 'Q1',
        type: 'multiple_choice',
        options_json: '["A","B"]',
        correct_answer: 'A',
        points: 0,
        order_index: 0,
      },
    ];
    const res = gradeQuizAttempt(questions, { q1: 'A' });
    expect(res.score).toBe(0);
    expect(Number.isNaN(res.score)).toBe(false);
  });
});

describe('renderCertificateHtml', () => {
  it('interpolation OK des 4 placeholders', () => {
    const tpl =
      '<h1>{{customer_name}}</h1><p>{{course_title}}</p>' +
      '<p>{{date}} — #{{certificate_number}}</p>';
    const html = renderCertificateHtml(tpl, {
      customer_name: 'Alice',
      course_title: 'Finance 101',
      date: '2026-05-25',
      certificate_number: 'CERT-AAAA-BBBB',
    });
    expect(html).toContain('<h1>Alice</h1>');
    expect(html).toContain('Finance 101');
    expect(html).toContain('2026-05-25');
    expect(html).toContain('CERT-AAAA-BBBB');
    expect(html).not.toContain('{{customer_name}}');
  });

  it('XSS escape : <script> dans customer_name → escaped', () => {
    const html = renderCertificateHtml('<p>{{customer_name}}</p>', {
      customer_name: '<script>alert("xss")</script>',
      course_title: 'Course',
      date: '2026-01-01',
      certificate_number: 'X',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;xss&quot;');
  });

  it('escape quotes + ampersand dans course_title', () => {
    const html = renderCertificateHtml('<p>{{course_title}}</p>', {
      course_title: `Tom & Jerry's "Best"`,
      customer_name: 'A',
      date: 'd',
      certificate_number: 'c',
    });
    expect(html).toContain('Tom &amp; Jerry&#39;s &quot;Best&quot;');
  });

  it('template null → HTML par défaut avec valeurs escapées', () => {
    const html = renderCertificateHtml(null, {
      customer_name: 'Bob <Evil>',
      course_title: 'C1',
      date: '2026-05-25',
      certificate_number: 'CERT-1',
    });
    expect(html).toContain('<h1>Certificate</h1>');
    expect(html).toContain('Bob &lt;Evil&gt;');
    expect(html).not.toContain('Bob <Evil>');
  });

  it('template vide → HTML par défaut', () => {
    const html = renderCertificateHtml('', {
      customer_name: 'A',
      course_title: 'B',
      date: '2026-01-01',
      certificate_number: '',
    });
    expect(html).toContain('<h1>Certificate</h1>');
    // certificate_number vide → pas de ligne "Certificate #"
    expect(html).not.toMatch(/Certificate #\s*<\/p>/);
  });
});

describe('generateCertificateNumber', () => {
  it('match format CERT-XXXXXXXX-XXXXXXXX uppercase hex', () => {
    const n = generateCertificateNumber();
    expect(n).toMatch(/^CERT-[A-F0-9]{8}-[A-F0-9]{8}$/);
  });

  it('1000 itérations → unicité parfaite (collision < 1 in 2^64)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateCertificateNumber());
    expect(set.size).toBe(1000);
  });

  it('alias parité avec pickCertificateNumber (même format)', () => {
    expect(pickCertificateNumber()).toMatch(/^CERT-[A-F0-9]{8}-[A-F0-9]{8}$/);
    expect(generateCertificateNumber()).toMatch(/^CERT-[A-F0-9]{8}-[A-F0-9]{8}$/);
  });
});

describe('isLessonAvailable — drip release', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('drip 0 → immediate (true)', () => {
    const enrolledAt = new Date('2026-05-25T00:00:00Z').toISOString();
    expect(isLessonAvailable(enrolledAt, 0, new Date('2026-05-25T00:00:01Z'))).toBe(
      true,
    );
  });

  it('drip 7 → false avant 7 jours, true à 7 jours', () => {
    const enrolledMs = Date.parse('2026-05-25T00:00:00Z');
    const enrolledAt = new Date(enrolledMs).toISOString();
    // 6 jours après → false
    expect(isLessonAvailable(enrolledAt, 7, enrolledMs + 6 * DAY_MS)).toBe(false);
    // exactement 7 jours après → true
    expect(isLessonAvailable(enrolledAt, 7, enrolledMs + 7 * DAY_MS)).toBe(true);
    // 8 jours après → true
    expect(isLessonAvailable(enrolledAt, 7, enrolledMs + 8 * DAY_MS)).toBe(true);
  });

  it('drip 30 → false à 29j, true à 30j', () => {
    const enrolledMs = Date.parse('2026-01-01T00:00:00Z');
    const enrolledAt = new Date(enrolledMs).toISOString();
    expect(isLessonAvailable(enrolledAt, 30, enrolledMs + 29 * DAY_MS)).toBe(false);
    expect(isLessonAvailable(enrolledAt, 30, enrolledMs + 30 * DAY_MS)).toBe(true);
  });

  it('drip négatif ou NaN → immediate (true)', () => {
    const enrolledAt = new Date('2026-05-25T00:00:00Z').toISOString();
    expect(isLessonAvailable(enrolledAt, -5)).toBe(true);
    expect(isLessonAvailable(enrolledAt, NaN)).toBe(true);
    expect(isLessonAvailable(enrolledAt, null)).toBe(true);
    expect(isLessonAvailable(enrolledAt, undefined)).toBe(true);
  });

  it('enrolledAt invalide / null → false (verrouille par sécurité)', () => {
    expect(isLessonAvailable(null, 7)).toBe(false);
    expect(isLessonAvailable('not-a-date', 7)).toBe(false);
    expect(isLessonAvailable('', 7)).toBe(false);
  });

  it('drip 0 + enrolledAt null → true (drip 0 court-circuite)', () => {
    // drip 0 = pas de verrou, peu importe enrolledAt
    expect(isLessonAvailable(null, 0)).toBe(true);
  });
});

describe('validateQuizAnswers', () => {
  const baseQuestions: QuizQuestion[] = [
    {
      id: 'q1',
      quiz_id: QUIZ_ID,
      question_text: 'Q1',
      type: 'multiple_choice',
      options_json: '["A","B"]',
      correct_answer: 'A',
      points: 1,
      order_index: 0,
    },
    {
      id: 'q2',
      quiz_id: QUIZ_ID,
      question_text: 'Q2',
      type: 'text',
      options_json: null,
      correct_answer: 'paris',
      points: 1,
      order_index: 1,
    },
  ];

  it('toutes les réponses présentes + types valides → ok', () => {
    const res = validateQuizAnswers(baseQuestions, { q1: 'A', q2: 'Paris' });
    expect(res.ok).toBe(true);
  });

  it('question manquante → error MISSING_ANSWER + questionId', () => {
    const res = validateQuizAnswers(baseQuestions, { q1: 'A' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(LMS_ERROR_CODES.QUIZ_MISSING_ANSWER);
      expect(res.questionId).toBe('q2');
    }
  });

  it('réponse vide (trim) → error MISSING_ANSWER', () => {
    const res = validateQuizAnswers(baseQuestions, { q1: 'A', q2: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(LMS_ERROR_CODES.QUIZ_MISSING_ANSWER);
    }
  });

  it('type invalide → error INVALID_TYPE', () => {
    const bad: QuizQuestion[] = [
      {
        ...baseQuestions[0]!,
        type: 'essay' as unknown as QuizQuestion['type'],
      },
    ];
    const res = validateQuizAnswers(bad, { q1: 'A' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(LMS_ERROR_CODES.QUIZ_INVALID_TYPE);
    }
  });

  it('answers non-object → error', () => {
    const res = validateQuizAnswers(baseQuestions, null as unknown as Record<string, string>);
    expect(res.ok).toBe(false);
  });

  it('questions non-array → error', () => {
    const res = validateQuizAnswers(
      null as unknown as QuizQuestion[],
      { q1: 'A' },
    );
    expect(res.ok).toBe(false);
  });
});

describe('computeProgress — edge cases', () => {
  it('course sans leçon publiée (total=0) → progress_pct=0, can_get_certificate=false', async () => {
    const db = createMockD1();
    db.seed('course_id, client_id from course_enrollments', [
      { course_id: COURSE_ID, client_id: CLIENT_ID },
    ]);
    // Zéro leçon publiée
    db.seed('from course_lessons where course_id', [{ count: 0 }]);
    db.seed('from lms_lesson_progress where enrollment_id', [{ count: 0 }]);
    db.seed('completion_threshold from courses', [
      { completion_threshold: 0.8 },
    ]);

    const out = await computeProgress(lmsEnv(db) as never, ENROLLMENT_ID);
    expect(out.total_lessons).toBe(0);
    expect(out.completed_lessons).toBe(0);
    expect(out.progress_pct).toBe(0);
    expect(out.can_get_certificate).toBe(false);
  });

  it('completion_threshold null → fallback 0.8 (DEFAULT_COMPLETION_THRESHOLD)', async () => {
    const db = createMockD1();
    db.seed('course_id, client_id from course_enrollments', [
      { course_id: COURSE_ID, client_id: CLIENT_ID },
    ]);
    db.seed('from course_lessons where course_id', [{ count: 10 }]);
    db.seed('from lms_lesson_progress where enrollment_id', [{ count: 8 }]);
    // Threshold null
    db.seed('completion_threshold from courses', [
      { completion_threshold: null },
    ]);

    const out = await computeProgress(lmsEnv(db) as never, ENROLLMENT_ID);
    expect(out.progress_pct).toBeCloseTo(0.8, 5);
    // 0.8 >= 0.8 (default) → true
    expect(out.can_get_certificate).toBe(true);
    expect(DEFAULT_COMPLETION_THRESHOLD).toBe(0.8);
  });

  it('completion_threshold hors-borne (>1) → fallback 0.8', async () => {
    const db = createMockD1();
    db.seed('course_id, client_id from course_enrollments', [
      { course_id: COURSE_ID, client_id: CLIENT_ID },
    ]);
    db.seed('from course_lessons where course_id', [{ count: 10 }]);
    db.seed('from lms_lesson_progress where enrollment_id', [{ count: 9 }]);
    db.seed('completion_threshold from courses', [
      { completion_threshold: 1.5 }, // invalide
    ]);

    const out = await computeProgress(lmsEnv(db) as never, ENROLLMENT_ID);
    // Fallback 0.8 → 0.9 >= 0.8 → true (pas faux à cause du 1.5)
    expect(out.can_get_certificate).toBe(true);
  });

  it('enrollment introuvable → fallback 0/0', async () => {
    const db = createMockD1();
    // resolveCourse renvoie null
    db.seed('course_id, client_id from course_enrollments', []);

    const out = await computeProgress(lmsEnv(db) as never, ENROLLMENT_ID);
    expect(out.total_lessons).toBe(0);
    expect(out.completed_lessons).toBe(0);
    expect(out.progress_pct).toBe(0);
    expect(out.can_get_certificate).toBe(false);
  });
});

describe('isUuidHex', () => {
  it('32 hex lowercase → true (format migration seq138)', () => {
    expect(isUuidHex('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isUuidHex('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isUuidHex('ffffffffffffffffffffffffffffffff')).toBe(true);
  });

  it('uppercase → false (lower hex only)', () => {
    expect(isUuidHex('0123456789ABCDEF0123456789abcdef')).toBe(false);
    expect(isUuidHex('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
  });

  it('avec tirets (UUID canonique) → false', () => {
    expect(isUuidHex('01234567-89ab-cdef-0123-456789abcdef')).toBe(false);
  });

  it('mauvaise longueur → false', () => {
    expect(isUuidHex('0123456789abcdef')).toBe(false); // 16
    expect(isUuidHex('0123456789abcdef0123456789abcdef0')).toBe(false); // 33
    expect(isUuidHex('')).toBe(false);
  });

  it('caractères non-hex → false', () => {
    expect(isUuidHex('g123456789abcdef0123456789abcdef')).toBe(false);
    expect(isUuidHex('0123456789abcdef0123456789abcdeZ')).toBe(false);
  });

  it('non-string → false', () => {
    expect(isUuidHex(null as unknown as string)).toBe(false);
    expect(isUuidHex(undefined as unknown as string)).toBe(false);
    expect(isUuidHex(123 as unknown as string)).toBe(false);
  });
});

describe('LMS_ERROR_CODES — constantes stables', () => {
  it('exporte les codes attendus avec valeurs string identiques aux clés', () => {
    expect(LMS_ERROR_CODES.LESSON_NOT_FOUND).toBe('LESSON_NOT_FOUND');
    expect(LMS_ERROR_CODES.QUIZ_NOT_FOUND).toBe('QUIZ_NOT_FOUND');
    expect(LMS_ERROR_CODES.ENROLLMENT_INVALID).toBe('ENROLLMENT_INVALID');
    expect(LMS_ERROR_CODES.QUIZ_MAX_ATTEMPTS).toBe('QUIZ_MAX_ATTEMPTS');
    expect(LMS_ERROR_CODES.R2_NOT_CONFIGURED).toBe('R2_NOT_CONFIGURED');
    expect(LMS_ERROR_CODES.LESSON_LOCKED_DRIP).toBe('LESSON_LOCKED_DRIP');
    expect(LMS_ERROR_CODES.INVALID_ID_FORMAT).toBe('INVALID_ID_FORMAT');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WIRE-UP — helpers renforcés branchés dans les handlers (Sprint 43)
// ════════════════════════════════════════════════════════════════════════════

describe('handleMarkLessonComplete — drip release', () => {
  it('drip 30 jours pas atteint (enrolled hier) → 423 LESSON_LOCKED_DRIP', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedCourse(db, 0.5);
    // Drip lookup queries DOIVENT être seedées AVANT seedLessonTenant
    // (first-seed-wins via _helpers.createMockD1).
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // SELECT drip_delay_days FROM course_lessons WHERE id = ?
    db.seed('select drip_delay_days from course_lessons', [
      { drip_delay_days: 30 },
    ]);
    // SELECT enrolled_at FROM course_enrollments WHERE id = ?
    db.seed('select enrolled_at from course_enrollments', [
      { enrolled_at: yesterday },
    ]);
    seedLessonTenant(db);
    seedEnrollment(db);

    const req = new Request(`https://x/api/lessons/${LESSON_ID}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollment_id: ENROLLMENT_ID, time_spent_sec: 0 }),
    });

    const res = await handleMarkLessonComplete(
      req,
      lmsEnv(db) as never,
      makeAuth(['leads.write']),
      LESSON_ID,
    );

    expect(res.status).toBe(423);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.error).toBe(LMS_ERROR_CODES.LESSON_LOCKED_DRIP);
    // Aucun UPSERT lms_lesson_progress effectué (verrouillé en amont).
    expect(hasCall(db, /insert\s+or\s+ignore\s+into\s+lms_lesson_progress/i)).toBe(
      false,
    );
  });
});

describe('handleSubmitQuizAttempt — max_attempts', () => {
  it('max_attempts=3, déjà 3 tentatives → 429 QUIZ_MAX_ATTEMPTS', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedQuizTenant(db);
    seedEnrollment(db);
    db.seed('passing_score, max_attempts from course_quizzes', [
      { passing_score: 0.5, max_attempts: 3 },
    ]);
    // 3 tentatives déjà enregistrées → 4e refusée.
    db.seed('count(*) as count from quiz_attempts', [{ count: 3 }]);

    const req = new Request(`https://x/api/quizzes/${QUIZ_ID}/attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enrollment_id: ENROLLMENT_ID,
        answers: { q1: 'A' },
      }),
    });

    const res = await handleSubmitQuizAttempt(
      req,
      lmsEnv(db) as never,
      makeAuth(['leads.write']),
      QUIZ_ID,
    );

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.error).toBe(LMS_ERROR_CODES.QUIZ_MAX_ATTEMPTS);
    // Pas d'INSERT quiz_attempts (refusé en amont).
    expect(hasCall(db, /insert\s+into\s+quiz_attempts/i)).toBe(false);
  });
});

describe('renderCertificateHtml — wire-up XSS-safe (cert template)', () => {
  it('customer_name avec <script> injection → escaped en HTML safe', () => {
    const tpl = '<html><body><h1>{{customer_name}}</h1></body></html>';
    const html = renderCertificateHtml(tpl, {
      customer_name: '<script>alert("pwned")</script>',
      course_title: 'Cours',
      date: '2026-05-26',
      certificate_number: 'CERT-AAAA-BBBB',
    });
    // Le tag <script> brut doit avoir disparu (escapé).
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('alert(&quot;pwned&quot;)');
  });
});

describe('handleSubmitQuizAttempt — path param invalid uuid', () => {
  it('quizId avec caractères OBVIOUSLY malformés (XSS) → 400 INVALID_ID_FORMAT', async () => {
    const db = createMockD1();
    // Aucun seed nécessaire : on rejette AVANT toute lookup DB.
    const req = new Request(`https://x/api/quizzes/bad/attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollment_id: ENROLLMENT_ID, answers: {} }),
    });

    const res = await handleSubmitQuizAttempt(
      req,
      lmsEnv(db) as never,
      makeAuth(['leads.write']),
      '<script>alert(1)</script>', // path param manifestement invalide
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.error).toBe(LMS_ERROR_CODES.INVALID_ID_FORMAT);
    // Aucune call DB ne doit avoir été émise (rejet AVANT resolveQuizTenant).
    expect(db.calls.length).toBe(0);
  });
});

describe('handleSubmitQuizAttempt — validateQuizAnswers missing answer', () => {
  it('answer manquante pour q2 → 400 QUIZ_MISSING_ANSWER + questionId', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedQuizTenant(db);
    seedEnrollment(db);
    db.seed('passing_score, max_attempts from course_quizzes', [
      { passing_score: 0.5, max_attempts: 3 },
    ]);
    db.seed('count(*) as count from quiz_attempts', [{ count: 0 }]);
    db.seed('from quiz_questions', [
      {
        id: 'q1',
        quiz_id: QUIZ_ID,
        question_text: 'Q1',
        type: 'multiple_choice',
        options_json: '["A","B"]',
        correct_answer: 'A',
        points: 1,
        order_index: 0,
      },
      {
        id: 'q2',
        quiz_id: QUIZ_ID,
        question_text: 'Q2',
        type: 'text',
        options_json: null,
        correct_answer: 'paris',
        points: 1,
        order_index: 1,
      },
    ]);

    const req = new Request(`https://x/api/quizzes/${QUIZ_ID}/attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enrollment_id: ENROLLMENT_ID,
        answers: { q1: 'A' }, // q2 manquante
      }),
    });

    const res = await handleSubmitQuizAttempt(
      req,
      lmsEnv(db) as never,
      makeAuth(['leads.write']),
      QUIZ_ID,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error?: string;
      code?: string;
      questionId?: string;
    };
    expect(body.error).toBe(LMS_ERROR_CODES.QUIZ_MISSING_ANSWER);
    expect(body.questionId).toBe('q2');
    // Pas d'INSERT quiz_attempts (refusé en amont).
    expect(hasCall(db, /insert\s+into\s+quiz_attempts/i)).toBe(false);
  });
});
