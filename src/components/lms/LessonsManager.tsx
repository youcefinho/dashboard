// ── LessonsManager — Sprint 43 (Agent B1) ───────────────────────────────────
// CRUD leçons d'un cours LMS + configuration drip (délai jours) + publish.
//
// API back FIGÉE (Phase A) :
//   listCourseLessons(courseId)        → ApiResponse<CourseLesson[]>
//   createCourseLesson(courseId, in)   → ApiResponse<CourseLesson>
//   updateCourseLesson(id, in)         → ApiResponse<CourseLesson>
//   deleteCourseLesson(id)             → ApiResponse<{ success: boolean }>
//
// Style : Stripe-clean, surfaces blanches, focus ring purple. Switch is_published
// inline. Bouton « Quiz » par leçon ouvre QuizBuilder dans un Modal. Toutes les
// chaînes via t(). Aucun console.log (CLAUDE.md). aria-labels i18n.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  ListChecks,
  BookOpen,
  Clock,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  listCourseLessons,
  createCourseLesson,
  updateCourseLesson,
  deleteCourseLesson,
  type CourseLesson,
} from '../../lib/api';
import { QuizBuilder } from './QuizBuilder';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Tronque le content markdown pour preview list (sans casser un mot). */
function previewContent(content: string | null): string {
  if (!content) return '';
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= 140) return flat;
  return `${flat.slice(0, 137).trimEnd()}…`;
}

interface LessonsManagerProps {
  courseId: string;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function LessonsManager({ courseId }: LessonsManagerProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [lessons, setLessons] = useState<CourseLesson[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Form CRUD modal
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState<string>('');
  const [formContent, setFormContent] = useState<string>('');
  const [formVideoUrl, setFormVideoUrl] = useState<string>('');
  const [formOrderIndex, setFormOrderIndex] = useState<number>(0);
  const [formDripDelayDays, setFormDripDelayDays] = useState<number>(0);
  const [formIsPublished, setFormIsPublished] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Quiz drawer / modal
  const [quizLessonId, setQuizLessonId] = useState<string | null>(null);

  // ── Chargement ──────────────────────────────────────────────────────────
  const loadLessons = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listCourseLessons(courseId);
    if (res.error) {
      toastError(res.error);
      setLessons([]);
      setLoadError(res.error);
    } else if (res.data) {
      setLessons(res.data);
    }
    setLoading(false);
  }, [courseId, toastError]);

  useEffect(() => {
    void loadLessons();
  }, [loadLessons]);

  // Tri stable order_index ASC (HANDLER trie déjà mais on s'assure côté UI).
  const sortedLessons = useMemo(
    () => [...lessons].sort((a, b) => a.order_index - b.order_index),
    [lessons],
  );

  // ── Form helpers ────────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setEditId(null);
    setFormTitle('');
    setFormContent('');
    setFormVideoUrl('');
    // Suggest next order_index = max + 1 (clearer UX que 0 sur add).
    const maxOrder = lessons.reduce(
      (acc, l) => (l.order_index > acc ? l.order_index : acc),
      -1,
    );
    setFormOrderIndex(maxOrder + 1);
    setFormDripDelayDays(0);
    setFormIsPublished(false);
  }, [lessons]);

  const handleOpenCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const handleOpenEdit = useCallback((lesson: CourseLesson) => {
    setEditId(lesson.id);
    setFormTitle(lesson.title);
    setFormContent(lesson.content ?? '');
    setFormVideoUrl(lesson.video_url ?? '');
    setFormOrderIndex(lesson.order_index);
    setFormDripDelayDays(lesson.drip_delay_days);
    setFormIsPublished(lesson.is_published);
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const title = formTitle.trim();
      if (!title) return;
      setSubmitting(true);
      const payload = {
        title,
        content: formContent.trim() || null,
        video_url: formVideoUrl.trim() || null,
        order_index: Number.isFinite(formOrderIndex) ? formOrderIndex : 0,
        drip_delay_days: Number.isFinite(formDripDelayDays)
          ? Math.max(0, formDripDelayDays)
          : 0,
        is_published: formIsPublished,
      };
      const res = editId
        ? await updateCourseLesson(editId, payload)
        : await createCourseLesson(courseId, payload);
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setModalOpen(false);
      resetForm();
      void loadLessons();
    },
    [
      formTitle,
      formContent,
      formVideoUrl,
      formOrderIndex,
      formDripDelayDays,
      formIsPublished,
      editId,
      courseId,
      success,
      toastError,
      loadLessons,
      resetForm,
    ],
  );

  // ── Actions ligne ───────────────────────────────────────────────────────

  const handleTogglePublished = useCallback(
    async (lesson: CourseLesson, next: boolean) => {
      setBusyId(lesson.id);
      const res = await updateCourseLesson(lesson.id, { is_published: next });
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadLessons();
    },
    [toastError, loadLessons],
  );

  const handleDelete = useCallback(
    async (lesson: CourseLesson) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('action.delete')} — ${lesson.title}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(lesson.id);
      const res = await deleteCourseLesson(lesson.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadLessons();
    },
    [confirm, toastError, loadLessons],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="lessons-manager">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('lms.lessons.title')}</h2>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('lms.lessons.create')}
        >
          {t('lms.lessons.create')}
        </Button>
      </header>

      {/* Liste / loading / empty / error */}
      {loading ? (
        <div
          className="space-y-3"
          data-testid="lessons-loading"
          aria-busy="true"
          aria-live="polite"
          aria-label={t('common.loading')}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-6 w-12 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div
          role="alert"
          data-testid="lessons-error"
          className="p-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 flex items-start justify-between gap-3 flex-wrap"
        >
          <p className="text-sm text-[var(--text-primary)]">
            {t('common.loading_error')}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadLessons()}
            aria-label={t('common.retry')}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : sortedLessons.length === 0 ? (
        <EmptyState
          icon={<Icon as={BookOpen} size={40} />}
          title={t('lms.lessons.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('lms.lessons.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="lessons-list"
          aria-label={t('lms.lessons.title')}
        >
          {sortedLessons.map((lesson) => {
            const isBusy = busyId === lesson.id;
            const labelEdit = t('action.edit');
            const labelDelete = t('action.delete');
            const labelQuiz = t('lms.quizzes.title');
            const labelPublished = t('lms.lessons.published');
            return (
              <li
                key={lesson.id}
                data-testid={`lesson-row-${lesson.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[var(--gray-100)] text-[var(--gray-700)] text-xs font-mono shrink-0"
                      aria-hidden="true"
                    >
                      {lesson.order_index}
                    </span>
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {lesson.title}
                    </h3>
                    {lesson.drip_delay_days > 0 ? (
                      <span
                        data-testid={`lesson-drip-${lesson.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-amber-200 bg-amber-50 text-amber-700"
                      >
                        <Icon as={Clock} size="sm" aria-hidden="true" />
                        {t('lms.lessons.drip_delay')}: {lesson.drip_delay_days}
                      </span>
                    ) : null}
                  </div>
                  {lesson.content ? (
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                      {previewContent(lesson.content)}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Switch
                    checked={lesson.is_published}
                    onCheckedChange={(next) =>
                      void handleTogglePublished(lesson, next)
                    }
                    disabled={isBusy}
                    size="sm"
                    variant="success"
                    label={labelPublished}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={ListChecks} size="sm" />}
                    onClick={() => setQuizLessonId(lesson.id)}
                    disabled={isBusy}
                    aria-label={`${labelQuiz} — ${lesson.title}`}
                  >
                    {labelQuiz}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => handleOpenEdit(lesson)}
                    disabled={isBusy}
                    aria-label={`${labelEdit} — ${lesson.title}`}
                  >
                    {labelEdit}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(lesson)}
                    disabled={isBusy}
                    aria-label={`${labelDelete} — ${lesson.title}`}
                  >
                    {labelDelete}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal CRUD leçon */}
      <Modal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) resetForm();
        }}
        title={editId ? t('action.edit') : t('lms.lessons.create')}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="lesson-title"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('lms.lessons.title')}
            </label>
            <Input
              id="lesson-title"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              autoFocus
              required
              maxLength={200}
              aria-label={t('lms.lessons.title')}
            />
          </div>

          <div>
            <label
              htmlFor="lesson-content"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('lms.lessons.markdown')}
            </label>
            <Textarea
              id="lesson-content"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              rows={6}
              aria-label={t('lms.lessons.markdown')}
            />
          </div>

          <div>
            <label
              htmlFor="lesson-video"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('lms.lessons.video_url')}
            </label>
            <Input
              id="lesson-video"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={formVideoUrl}
              onChange={(e) => setFormVideoUrl(e.target.value)}
              aria-label={t('lms.lessons.video_url')}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="lesson-order"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('lms.lessons.order')}
              </label>
              <Input
                id="lesson-order"
                type="number"
                min={0}
                step={1}
                value={formOrderIndex}
                onChange={(e) =>
                  setFormOrderIndex(Number.parseInt(e.target.value, 10) || 0)
                }
                aria-label={t('lms.lessons.order')}
              />
            </div>
            <div>
              <label
                htmlFor="lesson-drip"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('lms.lessons.drip_delay')}
              </label>
              <Input
                id="lesson-drip"
                type="number"
                min={0}
                step={1}
                value={formDripDelayDays}
                onChange={(e) =>
                  setFormDripDelayDays(
                    Number.parseInt(e.target.value, 10) || 0,
                  )
                }
                aria-label={t('lms.lessons.drip_delay')}
              />
            </div>
          </div>

          <div className="pt-1">
            <Switch
              id="lesson-published"
              checked={formIsPublished}
              onCheckedChange={setFormIsPublished}
              variant="success"
              label={t('lms.lessons.published')}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setModalOpen(false);
                resetForm();
              }}
              disabled={submitting}
            >
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              isLoading={submitting}
              disabled={submitting || !formTitle.trim()}
              aria-label={t('action.save')}
            >
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Quiz Builder — modal large per-leçon */}
      <Modal
        open={quizLessonId !== null}
        onOpenChange={(open) => {
          if (!open) setQuizLessonId(null);
        }}
        title={t('lms.quizzes.title')}
        size="xl"
      >
        {quizLessonId ? <QuizBuilder lessonId={quizLessonId} /> : null}
      </Modal>
    </div>
  );
}
