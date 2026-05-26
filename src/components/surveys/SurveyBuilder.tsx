// ── SurveyBuilder — Sprint 50 (Agent B1) ────────────────────────────────────
// CRUD surveys + CRUD questions du survey sélectionné + branching logic.
// Layout : cards-list survey (gauche) → SlidePanel questions builder (droit).
//
// API back FIGÉE (Phase A) :
//   listSurveys / createSurvey / updateSurvey / deleteSurvey / publishSurvey
//   listSurveyQuestions / createSurveyQuestion / updateSurveyQuestion / deleteSurveyQuestion
//   listBranches / createBranch / deleteBranch
//
// Style : Stripe-clean. Pas de console.log (CLAUDE.md). aria-labels i18n.
// Imports RELATIFS (consigne sprint 50).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  ClipboardList,
  HelpCircle,
  Pencil,
  Trash2,
  Send,
  GitBranch,
  X as XIcon,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { Tag } from '../ui/Tag';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { SlidePanel } from '../ui/SlidePanel';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  listSurveys,
  createSurvey,
  updateSurvey,
  deleteSurvey,
  publishSurvey,
  listSurveyQuestions,
  createSurveyQuestion,
  updateSurveyQuestion,
  deleteSurveyQuestion,
  listBranches,
  createBranch,
  deleteBranch,
  type Survey,
  type SurveyType,
  type SurveyQuestion,
  type SurveyQuestionType,
  type SurveyBranch,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

function surveyTypeLabel(type: SurveyType | null | undefined): string {
  if (type === 'nps') return t('surveys.type.nps');
  if (type === 'csat') return t('surveys.type.csat');
  if (type === 'custom') return t('surveys.type.custom');
  return t('surveys.type.standard');
}

function surveyTypeVariant(
  type: SurveyType | null | undefined,
): 'brand' | 'success' | 'accent' | 'neutral' {
  if (type === 'nps') return 'brand';
  if (type === 'csat') return 'success';
  if (type === 'custom') return 'accent';
  return 'neutral';
}

function questionTypeLabel(type: SurveyQuestionType | null | undefined): string {
  switch (type) {
    case 'multiple_choice':
      return t('lms.questions.multiple_choice');
    case 'rating':
      return t('lms.questions.rating');
    case 'nps':
      return t('surveys.type.nps');
    case 'csat':
      return t('surveys.type.csat');
    case 'date':
      return t('lms.questions.date');
    case 'text':
    default:
      return t('lms.questions.text');
  }
}

/** Parse options_json safely → tag list pour preview. */
function parseOptions(raw: string | null | undefined): string[] {
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

// ── Composant ──────────────────────────────────────────────────────────────

export function SurveyBuilder() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  // Surveys
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loadingSurveys, setLoadingSurveys] = useState<boolean>(true);
  const [loadSurveysError, setLoadSurveysError] = useState<string | null>(null);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);

  // Survey create/edit modal
  const [surveyModalOpen, setSurveyModalOpen] = useState<boolean>(false);
  const [editingSurveyId, setEditingSurveyId] = useState<string | null>(null);
  const [sFormTitle, setSFormTitle] = useState<string>('');
  const [sFormDescription, setSFormDescription] = useState<string>('');
  const [sFormType, setSFormType] = useState<SurveyType>('standard');
  const [submittingSurvey, setSubmittingSurvey] = useState<boolean>(false);

  // Questions du survey sélectionné
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState<boolean>(false);
  const [loadQuestionsError, setLoadQuestionsError] = useState<string | null>(
    null,
  );

  // Question create/edit modal
  const [questionModalOpen, setQuestionModalOpen] = useState<boolean>(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(
    null,
  );
  const [qFormText, setQFormText] = useState<string>('');
  const [qFormType, setQFormType] = useState<SurveyQuestionType>('text');
  const [qFormOptionsJson, setQFormOptionsJson] = useState<string>('["", ""]');
  const [qFormRequired, setQFormRequired] = useState<boolean>(false);
  const [qFormPageNumber, setQFormPageNumber] = useState<number>(1);
  const [qFormOrderIndex, setQFormOrderIndex] = useState<number>(0);
  const [submittingQuestion, setSubmittingQuestion] = useState<boolean>(false);

  // Branches : map question_id → branches[] (lazy load on expand)
  const [branchesByQ, setBranchesByQ] = useState<Record<string, SurveyBranch[]>>(
    {},
  );
  const [loadingBranchesFor, setLoadingBranchesFor] = useState<string | null>(
    null,
  );
  const [expandedBranchQ, setExpandedBranchQ] = useState<string | null>(null);
  const [bFormCondition, setBFormCondition] = useState<string>('');
  const [bFormNextQuestionId, setBFormNextQuestionId] = useState<string>('');
  const [bFormJumpToEnd, setBFormJumpToEnd] = useState<boolean>(false);
  const [submittingBranch, setSubmittingBranch] = useState<boolean>(false);

  const selectedSurvey = useMemo<Survey | null>(
    () => surveys.find((s) => s.id === selectedSurveyId) ?? null,
    [surveys, selectedSurveyId],
  );

  // ── Loads ───────────────────────────────────────────────────────────────

  const loadSurveys = useCallback(async () => {
    setLoadingSurveys(true);
    setLoadSurveysError(null);
    const res = await listSurveys();
    if (res.error) {
      setLoadSurveysError(res.error);
      toastError(res.error);
      setSurveys([]);
    } else if (res.data) {
      setSurveys(res.data);
    }
    setLoadingSurveys(false);
  }, [toastError]);

  const loadQuestions = useCallback(
    async (surveyId: string) => {
      setLoadingQuestions(true);
      setLoadQuestionsError(null);
      const res = await listSurveyQuestions(surveyId);
      if (res.error) {
        setLoadQuestionsError(res.error);
        toastError(res.error);
        setQuestions([]);
      } else if (res.data) {
        setQuestions(res.data);
      }
      setLoadingQuestions(false);
    },
    [toastError],
  );

  const loadBranches = useCallback(
    async (questionId: string) => {
      setLoadingBranchesFor(questionId);
      const res = await listBranches(questionId);
      setLoadingBranchesFor(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      if (res.data) {
        setBranchesByQ((prev) => ({ ...prev, [questionId]: res.data ?? [] }));
      }
    },
    [toastError],
  );

  useEffect(() => {
    void loadSurveys();
  }, [loadSurveys]);

  useEffect(() => {
    if (selectedSurveyId) {
      void loadQuestions(selectedSurveyId);
    } else {
      setQuestions([]);
      setBranchesByQ({});
      setExpandedBranchQ(null);
    }
  }, [selectedSurveyId, loadQuestions]);

  const sortedQuestions = useMemo(
    () =>
      [...questions].sort((a, b) => {
        const pa = a.page_number ?? 1;
        const pb = b.page_number ?? 1;
        if (pa !== pb) return pa - pb;
        return (a.order_index ?? 0) - (b.order_index ?? 0);
      }),
    [questions],
  );

  // ── Survey CRUD ─────────────────────────────────────────────────────────

  const handleOpenCreateSurvey = useCallback(() => {
    setEditingSurveyId(null);
    setSFormTitle('');
    setSFormDescription('');
    setSFormType('standard');
    setSurveyModalOpen(true);
  }, []);

  const handleOpenEditSurvey = useCallback((s: Survey) => {
    setEditingSurveyId(s.id);
    setSFormTitle(s.title);
    setSFormDescription(s.description ?? '');
    setSFormType((s.type ?? 'standard') as SurveyType);
    setSurveyModalOpen(true);
  }, []);

  const handleSubmitSurvey = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const title = sFormTitle.trim();
      if (!title) return;
      setSubmittingSurvey(true);
      const body = {
        title,
        description: sFormDescription.trim() || undefined,
        type: sFormType,
      };
      const res = editingSurveyId
        ? await updateSurvey(editingSurveyId, body)
        : await createSurvey(body);
      setSubmittingSurvey(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setSurveyModalOpen(false);
      if (!editingSurveyId && res.data) {
        setSelectedSurveyId(res.data.id);
      }
      void loadSurveys();
    },
    [
      editingSurveyId,
      sFormTitle,
      sFormDescription,
      sFormType,
      success,
      toastError,
      loadSurveys,
    ],
  );

  const handleDeleteSurvey = useCallback(
    async (s: Survey) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${s.title} — ${t('surveys.title')}`,
        danger: true,
        confirmLabel: t('action.delete'),
      });
      if (!ok) return;
      const res = await deleteSurvey(s.id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.delete'));
      if (selectedSurveyId === s.id) setSelectedSurveyId(null);
      void loadSurveys();
    },
    [confirm, selectedSurveyId, success, toastError, loadSurveys],
  );

  const handleTogglePublished = useCallback(
    async (s: Survey) => {
      // Si pas publié → POST /publish (idempotent + pose published_at).
      // Si déjà publié → PUT /surveys/:id { is_published: 0 } pour dépublier.
      const isPub = (s.is_published ?? 0) === 1;
      const res = isPub
        ? await updateSurvey(s.id, { is_published: 0 })
        : await publishSurvey(s.id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(isPub ? t('surveys.unpublish') : t('surveys.publish'));
      void loadSurveys();
    },
    [success, toastError, loadSurveys],
  );

  // ── Question CRUD ───────────────────────────────────────────────────────

  const resetQuestionForm = useCallback(() => {
    setEditingQuestionId(null);
    setQFormText('');
    setQFormType('text');
    setQFormOptionsJson('["", ""]');
    setQFormRequired(false);
    setQFormPageNumber(1);
    setQFormOrderIndex(questions.length);
  }, [questions.length]);

  const handleOpenCreateQuestion = useCallback(() => {
    resetQuestionForm();
    setQuestionModalOpen(true);
  }, [resetQuestionForm]);

  const handleOpenEditQuestion = useCallback((q: SurveyQuestion) => {
    setEditingQuestionId(q.id);
    setQFormText(q.question_text);
    setQFormType((q.type ?? 'text') as SurveyQuestionType);
    setQFormOptionsJson(q.options_json ?? '["", ""]');
    setQFormRequired((q.required ?? 0) === 1);
    setQFormPageNumber(q.page_number ?? 1);
    setQFormOrderIndex(q.order_index ?? 0);
    setQuestionModalOpen(true);
  }, []);

  const handleSubmitQuestion = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!selectedSurveyId) return;
      const question_text = qFormText.trim();
      if (!question_text) return;

      // Valide options_json côté UI selon type (HANDLER refusera sinon).
      let options_json: string | undefined;
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
          toastError(t('surveys.question.options_invalid'));
          return;
        }
      } else if (
        qFormType === 'rating' ||
        qFormType === 'nps' ||
        qFormType === 'csat'
      ) {
        const raw = qFormOptionsJson.trim();
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (
              !parsed ||
              typeof parsed !== 'object' ||
              Array.isArray(parsed)
            ) {
              throw new Error('not_object');
            }
            options_json = JSON.stringify(parsed);
          } catch {
            toastError(t('surveys.question.options_invalid'));
            return;
          }
        }
      }

      setSubmittingQuestion(true);
      const baseBody = {
        question_text,
        type: qFormType,
        options_json,
        required: qFormRequired ? 1 : 0,
        page_number: Math.max(1, Math.floor(qFormPageNumber)),
        order_index: Math.max(0, Math.floor(qFormOrderIndex)),
      };
      const res = editingQuestionId
        ? await updateSurveyQuestion(editingQuestionId, baseBody)
        : await createSurveyQuestion(selectedSurveyId, baseBody);
      setSubmittingQuestion(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setQuestionModalOpen(false);
      void loadQuestions(selectedSurveyId);
    },
    [
      selectedSurveyId,
      editingQuestionId,
      qFormText,
      qFormType,
      qFormOptionsJson,
      qFormRequired,
      qFormPageNumber,
      qFormOrderIndex,
      success,
      toastError,
      loadQuestions,
    ],
  );

  const handleDeleteQuestion = useCallback(
    async (q: SurveyQuestion) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: q.question_text,
        danger: true,
        confirmLabel: t('action.delete'),
      });
      if (!ok) return;
      const res = await deleteSurveyQuestion(q.id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.delete'));
      if (selectedSurveyId) void loadQuestions(selectedSurveyId);
    },
    [confirm, selectedSurveyId, success, toastError, loadQuestions],
  );

  // ── Branches CRUD ───────────────────────────────────────────────────────

  const handleToggleBranches = useCallback(
    async (q: SurveyQuestion) => {
      if (expandedBranchQ === q.id) {
        setExpandedBranchQ(null);
        return;
      }
      setExpandedBranchQ(q.id);
      setBFormCondition('');
      setBFormNextQuestionId('');
      setBFormJumpToEnd(false);
      if (!branchesByQ[q.id]) {
        await loadBranches(q.id);
      }
    },
    [expandedBranchQ, branchesByQ, loadBranches],
  );

  const handleAddBranch = useCallback(
    async (questionId: string) => {
      const condition_value = bFormCondition.trim();
      if (!condition_value) return;
      if (!bFormJumpToEnd && !bFormNextQuestionId) {
        toastError(t('surveys.branching.missing'));
        return;
      }
      setSubmittingBranch(true);
      const res = await createBranch(questionId, {
        condition_value,
        next_question_id: bFormJumpToEnd ? null : bFormNextQuestionId,
        jump_to_end: bFormJumpToEnd ? 1 : 0,
      });
      setSubmittingBranch(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setBFormCondition('');
      setBFormNextQuestionId('');
      setBFormJumpToEnd(false);
      void loadBranches(questionId);
    },
    [
      bFormCondition,
      bFormNextQuestionId,
      bFormJumpToEnd,
      success,
      toastError,
      loadBranches,
    ],
  );

  const handleDeleteBranch = useCallback(
    async (questionId: string, branchId: string) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: t('surveys.branching.title'),
        danger: true,
        confirmLabel: t('action.delete'),
      });
      if (!ok) return;
      const res = await deleteBranch(branchId);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.delete'));
      void loadBranches(questionId);
    },
    [confirm, success, toastError, loadBranches],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="survey-builder">
      {/* ── Header + Create CTA ──────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2
            id="survey-builder-title"
            className="t-h2 text-[var(--text-primary)]"
          >
            {t('surveys.title')}
          </h2>
        </div>
        <Button
          onClick={handleOpenCreateSurvey}
          size="sm"
          leftIcon={<Icon as={Plus} size="sm" />}
          aria-label={t('surveys.create')}
        >
          {t('surveys.create')}
        </Button>
      </header>

      {/* ── Liste surveys (cards) ────────────────────────────────────────── */}
      {loadingSurveys ? (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
          role="status"
          aria-busy="true"
          aria-live="polite"
          aria-label={t('surveys.title')}
          data-testid="surveys-loading"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : loadSurveysError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
          role="alert"
          data-testid="surveys-error"
        >
          <p className="font-medium mb-1">{t('surveys.loading_error')}</p>
          <p className="text-xs opacity-80">{loadSurveysError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadSurveys()}
            className="mt-2"
            aria-label={t('action.retry')}
          >
            {t('action.retry')}
          </Button>
        </div>
      ) : surveys.length === 0 ? (
        <EmptyState
          icon={<Icon as={ClipboardList} size={32} />}
          title={t('surveys.empty')}
          action={
            <Button
              onClick={handleOpenCreateSurvey}
              size="sm"
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('surveys.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 list-none p-0 m-0"
          data-testid="surveys-list"
          aria-label={t('surveys.title')}
        >
          {surveys.map((s) => {
            const isPub = (s.is_published ?? 0) === 1;
            return (
              <li
                key={s.id}
                data-testid={`survey-card-${s.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--text-primary)] truncate">
                      {s.title}
                    </p>
                    {s.description ? (
                      <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                        {s.description}
                      </p>
                    ) : null}
                  </div>
                  <Tag
                    variant={surveyTypeVariant(s.type)}
                    size="xs"
                  >
                    {surveyTypeLabel(s.type)}
                  </Tag>
                </div>

                <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-[var(--border-subtle)]">
                  <Switch
                    checked={isPub}
                    onCheckedChange={() => void handleTogglePublished(s)}
                    size="sm"
                    variant="success"
                    label={
                      isPub ? t('surveys.publish') : t('surveys.unpublish')
                    }
                    id={`survey-pub-${s.id}`}
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedSurveyId(s.id)}
                      leftIcon={<Icon as={HelpCircle} size="sm" />}
                      aria-label={t('surveys.question.add')}
                    >
                      {t('lms.questions.title')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEditSurvey(s)}
                      aria-label={t('action.edit')}
                    >
                      <Icon as={Pencil} size="sm" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDeleteSurvey(s)}
                      aria-label={t('action.delete')}
                    >
                      <Icon as={Trash2} size="sm" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Modal create/edit survey ─────────────────────────────────────── */}
      <Modal
        open={surveyModalOpen}
        onOpenChange={setSurveyModalOpen}
        title={editingSurveyId ? t('action.edit') : t('surveys.create')}
        size="md"
        closeLabel={t('action.close')}
      >
        <form onSubmit={handleSubmitSurvey} className="space-y-4">
          <div>
            <label
              htmlFor="survey-title"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('surveys.title')}
            </label>
            <Input
              id="survey-title"
              value={sFormTitle}
              onChange={(e) => setSFormTitle(e.target.value)}
              autoFocus
              required
              maxLength={200}
              aria-label={t('surveys.title')}
            />
          </div>

          <div>
            <label
              htmlFor="survey-description"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('surveys.description')}
            </label>
            <Textarea
              id="survey-description"
              value={sFormDescription}
              onChange={(e) => setSFormDescription(e.target.value)}
              rows={3}
              aria-label={t('surveys.description')}
            />
          </div>

          <div>
            <label
              htmlFor="survey-type"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('surveys.type.label')}
            </label>
            <Select
              id="survey-type"
              value={sFormType}
              onChange={(e) => setSFormType(e.target.value as SurveyType)}
              aria-label={t('surveys.type.label')}
            >
              <option value="standard">{t('surveys.type.standard')}</option>
              <option value="nps">{t('surveys.type.nps')}</option>
              <option value="csat">{t('surveys.type.csat')}</option>
              <option value="custom">{t('surveys.type.custom')}</option>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSurveyModalOpen(false)}
              disabled={submittingSurvey}
            >
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              isLoading={submittingSurvey}
              disabled={submittingSurvey || !sFormTitle.trim()}
              aria-label={t('action.save')}
            >
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Drawer questions builder ─────────────────────────────────────── */}
      <SlidePanel
        open={selectedSurveyId !== null}
        onOpenChange={(o) => {
          if (!o) setSelectedSurveyId(null);
        }}
        title={selectedSurvey?.title ?? t('lms.questions.title')}
        description={t('lms.questions.title')}
        size="lg"
        closeLabel={t('action.close')}
        headerActions={
          <Button
            onClick={handleOpenCreateQuestion}
            size="sm"
            leftIcon={<Icon as={Plus} size="sm" />}
            aria-label={t('surveys.question.add')}
          >
            {t('surveys.question.add')}
          </Button>
        }
      >
        {loadingQuestions ? (
          <div
            className="space-y-2"
            data-testid="survey-questions-loading"
            role="status"
            aria-busy="true"
            aria-live="polite"
            aria-label={t('lms.questions.title')}
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : loadQuestionsError ? (
          <div
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
            role="alert"
            data-testid="survey-questions-error"
          >
            <p className="font-medium mb-1">
              {t('surveys.questions.loading_error')}
            </p>
            <p className="text-xs opacity-80">{loadQuestionsError}</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (selectedSurveyId) void loadQuestions(selectedSurveyId);
              }}
              className="mt-2"
              aria-label={t('action.retry')}
            >
              {t('action.retry')}
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
                {t('surveys.question.add')}
              </Button>
            }
          />
        ) : (
          <ol
            className="space-y-3 list-none p-0 m-0"
            data-testid="survey-questions-list"
            aria-label={t('lms.questions.title')}
          >
            {sortedQuestions.map((q, idx) => {
              const opts = parseOptions(q.options_json);
              const isExpanded = expandedBranchQ === q.id;
              const branches = branchesByQ[q.id] ?? [];
              return (
                <li
                  key={q.id}
                  data-testid={`survey-question-row-${q.id}`}
                  className="p-3 rounded-xl border border-[var(--border-subtle)] bg-white"
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
                        <Tag size="xs" variant="neutral">
                          {questionTypeLabel(q.type)}
                        </Tag>
                        <span>
                          p.{q.page_number ?? 1} · #{q.order_index ?? 0}
                        </span>
                        {(q.required ?? 0) === 1 ? (
                          <Tag size="xs" variant="warning">
                            {t('surveys.question.required')}
                          </Tag>
                        ) : null}
                      </div>
                      {opts.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-1.5 list-none p-0 m-0">
                          {opts.map((opt, i) => (
                            <li
                              key={`${q.id}-opt-${i}`}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-white text-[var(--text-secondary)] border-[var(--border-subtle)]"
                            >
                              {opt}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleToggleBranches(q)}
                        leftIcon={<Icon as={GitBranch} size="sm" />}
                        aria-label={t('surveys.branching.title')}
                        aria-expanded={isExpanded}
                      >
                        {branches.length || ''}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEditQuestion(q)}
                        aria-label={t('action.edit')}
                      >
                        <Icon as={Pencil} size="sm" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDeleteQuestion(q)}
                        aria-label={t('action.delete')}
                      >
                        <Icon as={Trash2} size="sm" />
                      </Button>
                    </div>
                  </div>

                  {/* Branches expansion */}
                  {isExpanded ? (
                    <div
                      className="mt-3 ml-9 p-3 rounded-lg bg-[var(--gray-50)] border border-[var(--border-subtle)] space-y-3"
                      data-testid={`branches-${q.id}`}
                    >
                      <h5 className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                        <Icon as={GitBranch} size="sm" />
                        {t('surveys.branching.title')}
                      </h5>

                      {loadingBranchesFor === q.id ? (
                        <Skeleton className="h-10 w-full rounded-md" />
                      ) : branches.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)]">
                          —
                        </p>
                      ) : (
                        <ul className="space-y-1.5 list-none p-0 m-0">
                          {branches.map((b) => {
                            const targetQ = b.next_question_id
                              ? questions.find(
                                  (qq) => qq.id === b.next_question_id,
                                )
                              : null;
                            return (
                              <li
                                key={b.id}
                                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-white border border-[var(--border-subtle)] text-xs"
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="font-mono text-[var(--text-primary)]">
                                    « {b.condition_value} »
                                  </span>
                                  <span className="text-[var(--text-muted)] mx-1.5">
                                    →
                                  </span>
                                  <span className="text-[var(--text-secondary)]">
                                    {(b.jump_to_end ?? 0) === 1
                                      ? t('surveys.branching.end')
                                      : (targetQ?.question_text ??
                                        b.next_question_id ??
                                        '—')}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDeleteBranch(q.id, b.id)
                                  }
                                  className="text-[var(--text-muted)] hover:text-[var(--danger)] shrink-0"
                                  aria-label={t('action.delete')}
                                >
                                  <Icon as={XIcon} size="sm" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {/* Form add branch */}
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                        <div>
                          <label
                            htmlFor={`b-cond-${q.id}`}
                            className="text-[11px] font-medium text-[var(--text-muted)] block mb-1"
                          >
                            {t('surveys.branching.condition')}
                          </label>
                          <Input
                            id={`b-cond-${q.id}`}
                            value={bFormCondition}
                            onChange={(e) => setBFormCondition(e.target.value)}
                            aria-label={t('surveys.branching.condition')}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`b-next-${q.id}`}
                            className="text-[11px] font-medium text-[var(--text-muted)] block mb-1"
                          >
                            {t('surveys.branching.next')}
                          </label>
                          <Select
                            id={`b-next-${q.id}`}
                            value={bFormNextQuestionId}
                            onChange={(e) =>
                              setBFormNextQuestionId(e.target.value)
                            }
                            disabled={bFormJumpToEnd}
                            aria-label={t('surveys.branching.next')}
                          >
                            <option value="">—</option>
                            {questions
                              .filter((qq) => qq.id !== q.id)
                              .map((qq) => (
                                <option key={qq.id} value={qq.id}>
                                  {qq.question_text.slice(0, 50)}
                                </option>
                              ))}
                          </Select>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleAddBranch(q.id)}
                          isLoading={submittingBranch}
                          disabled={
                            submittingBranch || !bFormCondition.trim()
                          }
                          leftIcon={<Icon as={Plus} size="sm" />}
                          aria-label={t('action.add')}
                        >
                          {t('action.add')}
                        </Button>
                      </div>
                      <Switch
                        checked={bFormJumpToEnd}
                        onCheckedChange={setBFormJumpToEnd}
                        size="sm"
                        label={t('surveys.branching.jump_to_end')}
                        id={`b-jump-${q.id}`}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </SlidePanel>

      {/* ── Modal create/edit question ───────────────────────────────────── */}
      <Modal
        open={questionModalOpen}
        onOpenChange={setQuestionModalOpen}
        title={
          editingQuestionId
            ? t('action.edit')
            : t('surveys.question.add')
        }
        size="md"
        closeLabel={t('action.close')}
      >
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
              {t('surveys.question.type')}
            </label>
            <Select
              id="q-type"
              value={qFormType}
              onChange={(e) =>
                setQFormType(e.target.value as SurveyQuestionType)
              }
              aria-label={t('surveys.question.type')}
            >
              <option value="text">{t('lms.questions.text')}</option>
              <option value="multiple_choice">
                {t('lms.questions.multiple_choice')}
              </option>
              <option value="rating">{t('lms.questions.rating')}</option>
              <option value="nps">{t('surveys.type.nps')}</option>
              <option value="csat">{t('surveys.type.csat')}</option>
              <option value="date">{t('lms.questions.date')}</option>
            </Select>
          </div>

          {qFormType === 'multiple_choice' ? (
            <div>
              <label
                htmlFor="q-options-mc"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('surveys.question.options_array')}
              </label>
              <Textarea
                id="q-options-mc"
                value={qFormOptionsJson}
                onChange={(e) => setQFormOptionsJson(e.target.value)}
                rows={3}
                placeholder='["A","B","C","D"]'
                className="font-mono text-xs"
                aria-label={t('surveys.question.options_array')}
              />
            </div>
          ) : qFormType === 'rating' ||
            qFormType === 'nps' ||
            qFormType === 'csat' ? (
            <div>
              <label
                htmlFor="q-options-scale"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('surveys.question.options_scale')}
              </label>
              <Textarea
                id="q-options-scale"
                value={qFormOptionsJson}
                onChange={(e) => setQFormOptionsJson(e.target.value)}
                rows={2}
                placeholder={
                  qFormType === 'nps'
                    ? '{"min":0,"max":10,"scale":11}'
                    : '{"min":1,"max":5,"scale":5}'
                }
                className="font-mono text-xs"
                aria-label={t('surveys.question.options_scale')}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="q-page"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('surveys.question.page_number')}
              </label>
              <Input
                id="q-page"
                type="number"
                min={1}
                step={1}
                value={qFormPageNumber}
                onChange={(e) =>
                  setQFormPageNumber(
                    Number.parseInt(e.target.value, 10) || 1,
                  )
                }
                aria-label={t('surveys.question.page_number')}
              />
            </div>
            <div>
              <label
                htmlFor="q-order"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('surveys.question.order_index')}
              </label>
              <Input
                id="q-order"
                type="number"
                min={0}
                step={1}
                value={qFormOrderIndex}
                onChange={(e) =>
                  setQFormOrderIndex(
                    Number.parseInt(e.target.value, 10) || 0,
                  )
                }
                aria-label={t('surveys.question.order_index')}
              />
            </div>
          </div>

          <Switch
            checked={qFormRequired}
            onCheckedChange={setQFormRequired}
            size="sm"
            label={t('surveys.question.required')}
            id="q-required"
          />

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
              disabled={submittingQuestion || !qFormText.trim()}
              leftIcon={<Icon as={Send} size="sm" />}
              aria-label={t('action.save')}
            >
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
