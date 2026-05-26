// ── LessonViewer — Sprint 43 (Agent B2) ─────────────────────────────────────
// Member-facing : affiche une leçon (content + video) + ses quizzes (form
// answers + submit attempt) + bouton « Marquer terminé ».
//
// API back FIGÉE (Phase A) :
//   listCourseLessons(courseId)        → ApiResponse<CourseLesson[]> (pour retrouver la leçon)
//   listLessonQuizzes(lessonId)        → ApiResponse<CourseQuiz[]>
//   getQuizQuestions(quizId)           → ApiResponse<QuizQuestion[]>
//   submitQuizAttempt(quizId, in)      → ApiResponse<QuizAttempt>
//   markLessonComplete(lessonId, eid)  → ApiResponse<LessonProgress>
//   getLessonProgress(enrollmentId)    → ApiResponse<EnrollmentProgress>
//
// ⚠️ Particularité API : on n'a pas d'helper « get lesson by id » direct.
// On résout la leçon via une recherche (filterById) sur listCourseLessons
// quand on a courseId — sinon on garde un placeholder titre. Le HANDLER
// expose les leçons en POST /complete sans recharge du titre, donc OK.
//
// Style Stripe-clean. Imports RELATIFS. Aucun console.log. aria-labels i18n.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { CheckCircle2, Clock, ListChecks, PlayCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import {
  listLessonQuizzes,
  getQuizQuestions,
  submitQuizAttempt,
  markLessonComplete,
  getLessonProgress,
  type CourseQuiz,
  type QuizQuestion,
  type QuizAttempt,
  type EnrollmentProgress,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse options_json safely → liste options pour MC render. */
function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) {
      return arr
        .filter((v): v is string => typeof v === 'string')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    // silent — render only
  }
  return [];
}

/** 0..1 → "70 %". */
function formatPct(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return `${Math.round(score * 100)} %`;
}

interface LessonViewerProps {
  lessonId: string;
  enrollmentId: string;
  /** Titre + content + video à afficher (parent les charge depuis listCourseLessons). */
  lessonTitle?: string;
  lessonContent?: string | null;
  lessonVideoUrl?: string | null;
  /** Callback optionnel quand l'utilisateur clique « Marquer terminé ». */
  onComplete?: () => void;
}

/** État d'une attempt locale (avant submit). */
interface AttemptDraft {
  answers: Record<string, string>;
  result: QuizAttempt | null;
  submitting: boolean;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function LessonViewer({
  lessonId,
  enrollmentId,
  lessonTitle,
  lessonContent,
  lessonVideoUrl,
  onComplete,
}: LessonViewerProps) {
  const { success, error: toastError } = useToast();

  // Quizzes + leur questions (Record<quizId, Question[]>).
  const [quizzes, setQuizzes] = useState<CourseQuiz[]>([]);
  const [questionsByQuiz, setQuestionsByQuiz] = useState<
    Record<string, QuizQuestion[]>
  >({});
  const [drafts, setDrafts] = useState<Record<string, AttemptDraft>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // État completion
  const [progress, setProgress] = useState<EnrollmentProgress | null>(null);
  const [completing, setCompleting] = useState<boolean>(false);
  const [completed, setCompleted] = useState<boolean>(false);

  // ── Chargement ──────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [quizRes, progressRes] = await Promise.all([
      listLessonQuizzes(lessonId),
      getLessonProgress(enrollmentId),
    ]);

    if (quizRes.error) {
      toastError(quizRes.error);
      setQuizzes([]);
      setLoadError(quizRes.error);
    } else if (quizRes.data) {
      setQuizzes(quizRes.data);
      // Charge les questions de tous les quizzes en parallèle.
      const qResults = await Promise.all(
        quizRes.data.map(async (quiz) => {
          const qRes = await getQuizQuestions(quiz.id);
          return { quizId: quiz.id, questions: qRes.data ?? [] };
        }),
      );
      const map: Record<string, QuizQuestion[]> = {};
      const initialDrafts: Record<string, AttemptDraft> = {};
      for (const { quizId, questions } of qResults) {
        map[quizId] = questions;
        initialDrafts[quizId] = {
          answers: {},
          result: null,
          submitting: false,
        };
      }
      setQuestionsByQuiz(map);
      setDrafts(initialDrafts);
    }

    if (!progressRes.error && progressRes.data) {
      setProgress(progressRes.data);
    }

    setLoading(false);
  }, [lessonId, enrollmentId, toastError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── Form helpers ────────────────────────────────────────────────────────
  const setAnswer = useCallback(
    (quizId: string, questionId: string, value: string) => {
      setDrafts((prev) => {
        const cur = prev[quizId] ?? {
          answers: {},
          result: null,
          submitting: false,
        };
        return {
          ...prev,
          [quizId]: {
            ...cur,
            answers: { ...cur.answers, [questionId]: value },
          },
        };
      });
    },
    [],
  );

  const handleSubmitQuiz = useCallback(
    async (quizId: string, e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const draft = drafts[quizId];
      if (!draft) return;
      const questions = questionsByQuiz[quizId] ?? [];
      // Validation simple : toutes les questions doivent avoir une réponse.
      const allAnswered = questions.every((q) => {
        const v = draft.answers[q.id];
        return typeof v === 'string' && v.trim().length > 0;
      });
      if (!allAnswered) {
        toastError(t('lms.questions.unanswered'));
        return;
      }

      setDrafts((prev) => ({
        ...prev,
        [quizId]: { ...draft, submitting: true },
      }));

      const res = await submitQuizAttempt(quizId, {
        enrollment_id: enrollmentId,
        answers: draft.answers,
      });

      if (res.error) {
        toastError(res.error);
        setDrafts((prev) => ({
          ...prev,
          [quizId]: { ...draft, submitting: false },
        }));
        return;
      }

      setDrafts((prev) => ({
        ...prev,
        [quizId]: {
          ...draft,
          submitting: false,
          result: res.data ?? null,
        },
      }));
      success(t('action.submit'));
    },
    [drafts, questionsByQuiz, enrollmentId, success, toastError],
  );

  // ── Mark complete ───────────────────────────────────────────────────────
  const handleMarkComplete = useCallback(async () => {
    setCompleting(true);
    const res = await markLessonComplete(lessonId, enrollmentId);
    setCompleting(false);
    if (res.error) {
      toastError(res.error);
      return;
    }
    setCompleted(true);
    success(t('action.save'));
    if (onComplete) onComplete();
    // Rafraîchit progress agrégée.
    const progressRes = await getLessonProgress(enrollmentId);
    if (!progressRes.error && progressRes.data) {
      setProgress(progressRes.data);
    }
  }, [lessonId, enrollmentId, onComplete, success, toastError]);

  // ── Render ──────────────────────────────────────────────────────────────

  const headerTitle = lessonTitle ?? t('lms.lessons.title');
  const sortedQuizzes = useMemo(
    () => [...quizzes].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [quizzes],
  );

  return (
    <div className="space-y-6" data-testid="lesson-viewer">
      {/* ── Header lesson ─────────────────────────────────────────────── */}
      <header className="space-y-2">
        <p className="t-meta text-[var(--text-muted)]">
          {t('lms.lessons.title')}
        </p>
        <h1 className="t-h1 text-[var(--text-primary)]">{headerTitle}</h1>
        {progress ? (
          <div
            className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]"
            data-testid="lesson-progress"
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon as={Clock} size="sm" aria-hidden="true" />
              {t('lms.progress.completion')}:{' '}
              <span className="font-medium text-[var(--text-primary)]">
                {progress.completed_lessons} / {progress.total_lessons}
              </span>
              <span className="text-[var(--text-muted)]">
                ({formatPct(progress.progress_pct)})
              </span>
            </span>
            {progress.can_get_certificate ? (
              <Badge intent="success" dot>
                {t('lms.certificates.title')}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* ── Video player ───────────────────────────────────────────────── */}
      {lessonVideoUrl ? (
        <div
          className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-black"
          data-testid="lesson-video"
        >
          <video
            controls
            src={lessonVideoUrl}
            className="w-full h-auto block"
            aria-label={`${t('lms.lessons.title')} — ${headerTitle}`}
          >
            <track kind="captions" />
          </video>
        </div>
      ) : null}

      {/* ── Content (markdown/plain) ────────────────────────────────────── */}
      {lessonContent ? (
        <article
          className="prose-stripe whitespace-pre-wrap text-[var(--text-primary)] leading-relaxed"
          data-testid="lesson-content"
        >
          {lessonContent}
        </article>
      ) : (
        !lessonVideoUrl && !loading ? (
          <EmptyState
            icon={<Icon as={PlayCircle} size={32} />}
            title={t('lms.lessons.no_content')}
          />
        ) : null
      )}

      {/* ── Quizzes ────────────────────────────────────────────────────── */}
      <section className="space-y-4" aria-labelledby="lesson-viewer-quizzes">
        <h2
          id="lesson-viewer-quizzes"
          className="t-h2 text-[var(--text-primary)] flex items-center gap-2"
        >
          <Icon as={ListChecks} size="md" aria-hidden="true" />
          {t('lms.quizzes.title')}
        </h2>

        {loading ? (
          <div
            className="space-y-3"
            data-testid="lesson-viewer-loading"
            aria-busy="true"
            aria-live="polite"
            aria-label={t('common.loading')}
          >
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : loadError ? (
          <div
            role="alert"
            data-testid="lesson-viewer-error"
            className="p-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 flex items-start justify-between gap-3 flex-wrap"
          >
            <p className="text-sm text-[var(--text-primary)]">
              {t('common.loading_error')}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadAll()}
              aria-label={t('common.retry')}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : sortedQuizzes.length === 0 ? (
          <EmptyState
            icon={<Icon as={ListChecks} size={32} />}
            title={t('lms.quizzes.empty')}
          />
        ) : (
          sortedQuizzes.map((quiz) => {
            const questions = (questionsByQuiz[quiz.id] ?? []).slice().sort(
              (a, b) => a.order_index - b.order_index,
            );
            const draft = drafts[quiz.id] ?? {
              answers: {},
              result: null,
              submitting: false,
            };
            const isLocked = draft.result !== null;

            return (
              <form
                key={quiz.id}
                onSubmit={(e) => void handleSubmitQuiz(quiz.id, e)}
                className="p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] bg-white space-y-4"
                data-testid={`quiz-form-${quiz.id}`}
                aria-label={quiz.title ?? t('lms.quizzes.title')}
              >
                <header className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="t-h3 text-[var(--text-primary)] truncate">
                      {quiz.title ?? t('lms.quizzes.title')}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {t('lms.quizzes.passing_score')}:{' '}
                      {formatPct(quiz.passing_score)}
                      {' • '}
                      {t('lms.quizzes.max_attempts')}: {quiz.max_attempts}
                    </p>
                  </div>
                  {draft.result ? (
                    <Badge
                      intent={draft.result.passed ? 'success' : 'danger'}
                      fill="soft"
                      dot
                      data-testid={`quiz-result-${quiz.id}`}
                    >
                      {draft.result.passed
                        ? t('lms.attempts.passed')
                        : t('lms.attempts.failed')}
                      {' · '}
                      {t('lms.attempts.score')}: {formatPct(draft.result.score)}
                    </Badge>
                  ) : null}
                </header>

                {questions.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    {t('lms.questions.title')} — {t('lms.lessons.empty')}
                  </p>
                ) : (
                  <ol className="space-y-4 list-none p-0 m-0">
                    {questions.map((q, idx) => {
                      const opts = parseOptions(q.options_json);
                      const selected = draft.answers[q.id] ?? '';
                      const inputName = `q-${q.id}`;
                      return (
                        <li
                          key={q.id}
                          data-testid={`question-${q.id}`}
                          className="space-y-2"
                        >
                          <p className="font-medium text-[var(--text-primary)] flex gap-2">
                            <span
                              className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--gray-100)] text-[var(--gray-700)] text-xs font-mono shrink-0 mt-0.5"
                              aria-hidden="true"
                            >
                              {idx + 1}
                            </span>
                            <span>{q.question_text}</span>
                          </p>

                          {/* MC : radio par option JSON. */}
                          {q.type === 'multiple_choice' && opts.length > 0 ? (
                            <fieldset
                              className="space-y-1.5 pl-8"
                              aria-label={q.question_text}
                            >
                              {opts.map((opt, i) => (
                                <label
                                  key={`${q.id}-opt-${i}`}
                                  className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer"
                                >
                                  <input
                                    type="radio"
                                    name={inputName}
                                    value={opt}
                                    checked={selected === opt}
                                    onChange={(e) =>
                                      setAnswer(quiz.id, q.id, e.target.value)
                                    }
                                    disabled={isLocked}
                                    className="cursor-pointer accent-[var(--primary)]"
                                    aria-label={opt}
                                  />
                                  {opt}
                                </label>
                              ))}
                            </fieldset>
                          ) : null}

                          {/* True/False : radio binaire. */}
                          {q.type === 'true_false' ? (
                            <fieldset
                              className="flex gap-4 pl-8"
                              aria-label={q.question_text}
                            >
                              {['true', 'false'].map((val) => {
                                const label =
                                  val === 'true'
                                    ? t('lms.questions.true')
                                    : t('lms.questions.false');
                                return (
                                  <label
                                    key={val}
                                    className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer"
                                  >
                                    <input
                                      type="radio"
                                      name={inputName}
                                      value={val}
                                      checked={selected === val}
                                      onChange={(e) =>
                                        setAnswer(quiz.id, q.id, e.target.value)
                                      }
                                      disabled={isLocked}
                                      className="cursor-pointer accent-[var(--primary)]"
                                      aria-label={label}
                                    />
                                    {label}
                                  </label>
                                );
                              })}
                            </fieldset>
                          ) : null}

                          {/* Text : textarea libre. */}
                          {q.type === 'text' ? (
                            <div className="pl-8">
                              <Textarea
                                id={`q-text-${q.id}`}
                                value={selected}
                                onChange={(e) =>
                                  setAnswer(quiz.id, q.id, e.target.value)
                                }
                                rows={2}
                                disabled={isLocked}
                                aria-label={q.question_text}
                              />
                            </div>
                          ) : null}

                          <p className="pl-8 text-xs text-[var(--text-muted)]">
                            {t('lms.questions.points')}: {q.points}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {questions.length > 0 ? (
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      isLoading={draft.submitting}
                      disabled={draft.submitting || isLocked}
                      aria-label={t('action.submit')}
                    >
                      {t('action.submit')}
                    </Button>
                  </div>
                ) : null}
              </form>
            );
          })
        )}
      </section>

      {/* ── Mark complete ─────────────────────────────────────────────── */}
      <footer className="flex justify-end pt-2">
        <Button
          variant="premium"
          onClick={() => void handleMarkComplete()}
          isLoading={completing}
          disabled={completing || completed}
          leftIcon={<Icon as={CheckCircle2} size="sm" />}
          aria-label={
            completed
              ? t('lms.lessons.completed')
              : t('lms.lessons.mark_complete')
          }
          data-testid="lesson-complete-btn"
        >
          {completed
            ? t('lms.lessons.completed')
            : t('lms.lessons.mark_complete')}
        </Button>
      </footer>
    </div>
  );
}

export default LessonViewer;
