// ── QuizBuilder — Sprint 43 (Agent B1) ──────────────────────────────────────
// CRUD quizzes d'une leçon + CRUD questions du quiz sélectionné.
// 2 sections : « Quizzes » (gauche) puis « Questions » (sous, quand quiz pick).
//
// API back FIGÉE (Phase A) :
//   listLessonQuizzes(lessonId)        → ApiResponse<CourseQuiz[]>
//   createQuiz(lessonId, in)           → ApiResponse<CourseQuiz>
//   getQuizQuestions(quizId)           → ApiResponse<QuizQuestion[]>
//   createQuizQuestion(quizId, in)     → ApiResponse<QuizQuestion>
//
// Style : Stripe-clean. Pas de console.log (CLAUDE.md). aria-labels i18n.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { Plus, ClipboardList, HelpCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import {
  listLessonQuizzes,
  createQuiz,
  getQuizQuestions,
  createQuizQuestion,
  type CourseQuiz,
  type QuizQuestion,
  type QuizQuestionType,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

function questionTypeLabel(type: QuizQuestionType): string {
  if (type === 'multiple_choice') return t('lms.questions.multiple_choice');
  if (type === 'true_false') return t('lms.questions.true_false');
  return t('lms.questions.text');
}

/** Format `passing_score` (0..1) en `%`, ex 0.7 → "70 %". */
function formatPassingScore(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return `${Math.round(score * 100)} %`;
}

/** Parse options_json safely → tag list pour preview. */
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
    // Silent — preview only.
  }
  return [];
}

interface QuizBuilderProps {
  lessonId: string;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function QuizBuilder({ lessonId }: QuizBuilderProps) {
  const { success, error: toastError } = useToast();

  // Quizzes
  const [quizzes, setQuizzes] = useState<CourseQuiz[]>([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState<boolean>(true);
  const [quizzesError, setQuizzesError] = useState<string | null>(null);
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);

  // Questions du quiz sélectionné
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState<boolean>(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  // Modal quiz
  const [quizModalOpen, setQuizModalOpen] = useState<boolean>(false);
  const [quizFormTitle, setQuizFormTitle] = useState<string>('');
  const [quizFormPassingScore, setQuizFormPassingScore] = useState<number>(0.7);
  const [quizFormMaxAttempts, setQuizFormMaxAttempts] = useState<number>(3);
  const [submittingQuiz, setSubmittingQuiz] = useState<boolean>(false);

  // Modal question
  const [questionModalOpen, setQuestionModalOpen] = useState<boolean>(false);
  const [qFormText, setQFormText] = useState<string>('');
  const [qFormType, setQFormType] = useState<QuizQuestionType>('multiple_choice');
  const [qFormOptionsJson, setQFormOptionsJson] = useState<string>(
    '["", "", "", ""]',
  );
  const [qFormCorrectAnswer, setQFormCorrectAnswer] = useState<string>('');
  const [qFormPoints, setQFormPoints] = useState<number>(1);
  const [submittingQuestion, setSubmittingQuestion] = useState<boolean>(false);

  // ── Loads ───────────────────────────────────────────────────────────────
  const loadQuizzes = useCallback(async () => {
    setLoadingQuizzes(true);
    setQuizzesError(null);
    const res = await listLessonQuizzes(lessonId);
    if (res.error) {
      toastError(res.error);
      setQuizzes([]);
      setQuizzesError(res.error);
    } else if (res.data) {
      setQuizzes(res.data);
      // Auto-sélectionne le 1er quiz si rien de pick et non vide.
      const firstQuiz = res.data[0];
      if (!selectedQuizId && firstQuiz) {
        setSelectedQuizId(firstQuiz.id);
      }
    }
    setLoadingQuizzes(false);
  }, [lessonId, selectedQuizId, toastError]);

  const loadQuestions = useCallback(
    async (quizId: string) => {
      setLoadingQuestions(true);
      setQuestionsError(null);
      const res = await getQuizQuestions(quizId);
      if (res.error) {
        toastError(res.error);
        setQuestions([]);
        setQuestionsError(res.error);
      } else if (res.data) {
        setQuestions(res.data);
      }
      setLoadingQuestions(false);
    },
    [toastError],
  );

  useEffect(() => {
    void loadQuizzes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  useEffect(() => {
    if (selectedQuizId) {
      void loadQuestions(selectedQuizId);
    } else {
      setQuestions([]);
    }
  }, [selectedQuizId, loadQuestions]);

  const sortedQuestions = useMemo(
    () => [...questions].sort((a, b) => a.order_index - b.order_index),
    [questions],
  );

  // ── Form quiz ───────────────────────────────────────────────────────────
  const handleOpenCreateQuiz = useCallback(() => {
    setQuizFormTitle('');
    setQuizFormPassingScore(0.7);
    setQuizFormMaxAttempts(3);
    setQuizModalOpen(true);
  }, []);

  const handleSubmitQuiz = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmittingQuiz(true);
      const passing = Math.min(1, Math.max(0, quizFormPassingScore));
      const attempts = Math.max(1, Math.floor(quizFormMaxAttempts));
      const res = await createQuiz(lessonId, {
        title: quizFormTitle.trim() || null,
        passing_score: passing,
        max_attempts: attempts,
      });
      setSubmittingQuiz(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setQuizModalOpen(false);
      if (res.data) setSelectedQuizId(res.data.id);
      void loadQuizzes();
    },
    [
      lessonId,
      quizFormTitle,
      quizFormPassingScore,
      quizFormMaxAttempts,
      success,
      toastError,
      loadQuizzes,
    ],
  );

  // ── Form question ───────────────────────────────────────────────────────
  const handleOpenCreateQuestion = useCallback(() => {
    if (!selectedQuizId) return;
    setQFormText('');
    setQFormType('multiple_choice');
    setQFormOptionsJson('["", "", "", ""]');
    setQFormCorrectAnswer('');
    setQFormPoints(1);
    setQuestionModalOpen(true);
  }, [selectedQuizId]);

  const handleSubmitQuestion = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!selectedQuizId) return;
      const question_text = qFormText.trim();
      const correct_answer = qFormCorrectAnswer.trim();
      if (!question_text || !correct_answer) return;

      // Validation options_json côté UI (HANDLER refusera sinon).
      let options_json: string | null = null;
      if (qFormType === 'multiple_choice') {
        const raw = qFormOptionsJson.trim();
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) throw new Error('not_array');
          options_json = JSON.stringify(
            parsed
              .filter((v): v is string => typeof v === 'string')
              .map((s) => s.trim())
              .filter(Boolean),
          );
        } catch {
          toastError(t('lms.questions.options_invalid'));
          return;
        }
      }

      setSubmittingQuestion(true);
      const res = await createQuizQuestion(selectedQuizId, {
        question_text,
        type: qFormType,
        options_json,
        correct_answer,
        points: Math.max(0, qFormPoints),
        order_index: questions.length,
      });
      setSubmittingQuestion(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setQuestionModalOpen(false);
      void loadQuestions(selectedQuizId);
    },
    [
      selectedQuizId,
      qFormText,
      qFormType,
      qFormOptionsJson,
      qFormCorrectAnswer,
      qFormPoints,
      questions.length,
      success,
      toastError,
      loadQuestions,
    ],
  );

  // ── Render sections ─────────────────────────────────────────────────────

  return (
    <div className="space-y-8" data-testid="quiz-builder">
      {/* ── Section Quizzes ────────────────────────────────────────────── */}
      <section className="space-y-3" aria-labelledby="quiz-builder-quizzes">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <h3
            id="quiz-builder-quizzes"
            className="t-h3 text-[var(--text-primary)]"
          >
            {t('lms.quizzes.title')}
          </h3>
          <Button
            onClick={handleOpenCreateQuiz}
            size="sm"
            leftIcon={<Icon as={Plus} size="sm" />}
            aria-label={t('lms.quizzes.title')}
          >
            {t('action.create')}
          </Button>
        </header>

        {loadingQuizzes ? (
          <div
            className="space-y-2"
            data-testid="quizzes-loading"
            aria-busy="true"
            aria-live="polite"
            aria-label={t('common.loading')}
          >
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : quizzesError ? (
          <div
            role="alert"
            data-testid="quizzes-error"
            className="p-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 flex items-start justify-between gap-3 flex-wrap"
          >
            <p className="text-sm text-[var(--text-primary)]">
              {t('common.loading_error')}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadQuizzes()}
              aria-label={t('common.retry')}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : quizzes.length === 0 ? (
          <EmptyState
            icon={<Icon as={ClipboardList} size={32} />}
            title={t('lms.quizzes.empty')}
            action={
              <Button
                onClick={handleOpenCreateQuiz}
                size="sm"
                leftIcon={<Icon as={Plus} size="sm" />}
              >
                {t('action.create')}
              </Button>
            }
          />
        ) : (
          <ul
            className="space-y-2 list-none p-0 m-0"
            data-testid="quizzes-list"
            aria-label={t('lms.quizzes.title')}
          >
            {quizzes.map((quiz) => {
              const isSelected = quiz.id === selectedQuizId;
              return (
                <li key={quiz.id} data-testid={`quiz-row-${quiz.id}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedQuizId(quiz.id)}
                    aria-pressed={isSelected}
                    aria-label={quiz.title ?? t('lms.quizzes.title')}
                    className={[
                      'w-full text-left p-3 rounded-xl border bg-[var(--bg-surface)] transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1',
                      isSelected
                        ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]/30'
                        : 'border-[var(--border-subtle)] hover:bg-[var(--gray-50)]',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--text-primary)] truncate">
                          {quiz.title ?? t('lms.quizzes.title')}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          {t('lms.quizzes.passing_score')}{' '}
                          {formatPassingScore(quiz.passing_score)}
                          {' • '}
                          {t('lms.quizzes.max_attempts')}: {quiz.max_attempts}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Section Questions ──────────────────────────────────────────── */}
      {selectedQuizId ? (
        <section className="space-y-3" aria-labelledby="quiz-builder-questions">
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <h3
              id="quiz-builder-questions"
              className="t-h3 text-[var(--text-primary)]"
            >
              {t('lms.questions.title')}
            </h3>
            <Button
              onClick={handleOpenCreateQuestion}
              size="sm"
              leftIcon={<Icon as={Plus} size="sm" />}
              aria-label={t('lms.questions.title')}
            >
              {t('action.create')}
            </Button>
          </header>

          {loadingQuestions ? (
            <div
              className="space-y-2"
              data-testid="questions-loading"
              aria-busy="true"
              aria-live="polite"
              aria-label={t('common.loading')}
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : questionsError ? (
            <div
              role="alert"
              data-testid="questions-error"
              className="p-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 flex items-start justify-between gap-3 flex-wrap"
            >
              <p className="text-sm text-[var(--text-primary)]">
                {t('common.loading_error')}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => selectedQuizId && void loadQuestions(selectedQuizId)}
                aria-label={t('common.retry')}
              >
                {t('common.retry')}
              </Button>
            </div>
          ) : sortedQuestions.length === 0 ? (
            <EmptyState
              icon={<Icon as={HelpCircle} size={32} />}
              title={t('lms.questions.title')}
              action={
                <Button
                  onClick={handleOpenCreateQuestion}
                  size="sm"
                  leftIcon={<Icon as={Plus} size="sm" />}
                >
                  {t('action.create')}
                </Button>
              }
            />
          ) : (
            <ol
              className="space-y-2 list-none p-0 m-0"
              data-testid="questions-list"
              aria-label={t('lms.questions.title')}
            >
              {sortedQuestions.map((q, idx) => {
                const opts = parseOptions(q.options_json);
                return (
                  <li
                    key={q.id}
                    data-testid={`question-row-${q.id}`}
                    className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--gray-100)] text-[var(--gray-700)] text-xs font-mono shrink-0 mt-0.5"
                        aria-hidden="true"
                      >
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-[var(--text-primary)]">
                          {q.question_text}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--gray-50)]">
                            {questionTypeLabel(q.type)}
                          </span>
                          <span>
                            {t('lms.questions.points')}: {q.points}
                          </span>
                        </div>
                        {opts.length > 0 ? (
                          <ul className="mt-2 flex flex-wrap gap-1.5 list-none p-0 m-0">
                            {opts.map((opt, i) => {
                              const isCorrect =
                                opt.trim().toLowerCase() ===
                                q.correct_answer.trim().toLowerCase();
                              return (
                                <li
                                  key={`${q.id}-opt-${i}`}
                                  className={[
                                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs border',
                                    isCorrect
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
                                  ].join(' ')}
                                >
                                  {opt}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="mt-1 text-xs text-[var(--text-muted)] font-mono">
                            ✓ {q.correct_answer}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}

      {/* Modal create quiz — inline (pas de Modal portal car déjà dans Modal parent) */}
      {quizModalOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label={t('lms.quizzes.title')}
          data-testid="quiz-create-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setQuizModalOpen(false);
          }}
        >
          <div className="w-full max-w-md bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] shadow-lg p-5">
            <h4 className="t-h3 mb-4">{t('lms.quizzes.title')}</h4>
            <form onSubmit={handleSubmitQuiz} className="space-y-4">
              <div>
                <label
                  htmlFor="quiz-title"
                  className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                >
                  {t('lms.quizzes.title')}
                </label>
                <Input
                  id="quiz-title"
                  value={quizFormTitle}
                  onChange={(e) => setQuizFormTitle(e.target.value)}
                  autoFocus
                  maxLength={200}
                  aria-label={t('lms.quizzes.title')}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="quiz-passing"
                    className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                  >
                    {t('lms.quizzes.passing_score')}
                  </label>
                  <Input
                    id="quiz-passing"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={quizFormPassingScore}
                    onChange={(e) =>
                      setQuizFormPassingScore(
                        Number.parseFloat(e.target.value) || 0,
                      )
                    }
                    aria-label={t('lms.quizzes.passing_score')}
                  />
                </div>
                <div>
                  <label
                    htmlFor="quiz-max-attempts"
                    className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                  >
                    {t('lms.quizzes.max_attempts')}
                  </label>
                  <Input
                    id="quiz-max-attempts"
                    type="number"
                    min={1}
                    step={1}
                    value={quizFormMaxAttempts}
                    onChange={(e) =>
                      setQuizFormMaxAttempts(
                        Number.parseInt(e.target.value, 10) || 1,
                      )
                    }
                    aria-label={t('lms.quizzes.max_attempts')}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setQuizModalOpen(false)}
                  disabled={submittingQuiz}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  type="submit"
                  isLoading={submittingQuiz}
                  disabled={submittingQuiz}
                  aria-label={t('action.save')}
                >
                  {t('action.save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal create question — inline */}
      {questionModalOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label={t('lms.questions.title')}
          data-testid="question-create-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setQuestionModalOpen(false);
          }}
        >
          <div className="w-full max-w-lg bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] shadow-lg p-5 max-h-[90vh] overflow-y-auto">
            <h4 className="t-h3 mb-4">{t('lms.questions.title')}</h4>
            <form onSubmit={handleSubmitQuestion} className="space-y-4">
              <div>
                <label
                  htmlFor="q-text"
                  className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                >
                  {t('lms.questions.title')}
                </label>
                <Textarea
                  id="q-text"
                  value={qFormText}
                  onChange={(e) => setQFormText(e.target.value)}
                  autoFocus
                  required
                  rows={2}
                  aria-label={t('lms.questions.title')}
                />
              </div>

              <div>
                <label
                  htmlFor="q-type"
                  className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                >
                  {t('lms.questions.title')}
                </label>
                <Select
                  id="q-type"
                  value={qFormType}
                  onChange={(e) =>
                    setQFormType(e.target.value as QuizQuestionType)
                  }
                  aria-label={t('lms.questions.title')}
                >
                  <option value="multiple_choice">
                    {t('lms.questions.multiple_choice')}
                  </option>
                  <option value="text">{t('lms.questions.text')}</option>
                  <option value="true_false">
                    {t('lms.questions.true_false')}
                  </option>
                </Select>
              </div>

              {qFormType === 'multiple_choice' ? (
                <div>
                  <label
                    htmlFor="q-options"
                    className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                  >
                    {t('lms.questions.options_label')}
                  </label>
                  <Textarea
                    id="q-options"
                    value={qFormOptionsJson}
                    onChange={(e) => setQFormOptionsJson(e.target.value)}
                    rows={3}
                    placeholder='["A","B","C","D"]'
                    className="font-mono text-xs"
                    aria-label={t('lms.questions.options_label')}
                  />
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="q-correct"
                  className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                >
                  {t('lms.questions.correct_answer')}
                </label>
                <Input
                  id="q-correct"
                  value={qFormCorrectAnswer}
                  onChange={(e) => setQFormCorrectAnswer(e.target.value)}
                  required
                  aria-label={t('lms.questions.correct_answer')}
                />
              </div>

              <div>
                <label
                  htmlFor="q-points"
                  className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                >
                  {t('lms.questions.points')}
                </label>
                <Input
                  id="q-points"
                  type="number"
                  min={0}
                  step={1}
                  value={qFormPoints}
                  onChange={(e) =>
                    setQFormPoints(Number.parseInt(e.target.value, 10) || 0)
                  }
                  aria-label={t('lms.questions.points')}
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setQuestionModalOpen(false)}
                  disabled={submittingQuestion}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  type="submit"
                  isLoading={submittingQuestion}
                  disabled={
                    submittingQuestion ||
                    !qFormText.trim() ||
                    !qFormCorrectAnswer.trim()
                  }
                  aria-label={t('action.save')}
                >
                  {t('action.save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
