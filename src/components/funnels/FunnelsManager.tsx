// ── FunnelsManager — Sprint 44 (Agent B1) ──────────────────────────────────
// Liste + CRUD + publish toggle des FunnelBuilder du tenant courant.
// Click "Étapes" → ouvre SlidePanel droit avec <StepEditor funnelId={id} />.
//
// API back FIGÉE (Sprint 44 — paritaire worker.ts seq139, cap settings.manage) :
//   listFunnels()                              → ApiResponse<FunnelBuilder[]>
//   createFunnelBuilder({ name, slug, ... })   → ApiResponse<FunnelBuilder>
//   updateFunnelBuilder(id, partial)           → ApiResponse<FunnelBuilder>
//   publishFunnelBuilder(id, publish: boolean) → ApiResponse<FunnelBuilder>
//   deleteFunnelBuilder(id)                    → ApiResponse<{ success }>
//
// Style : Stripe-clean, flat surfaces, focus ring purple, badges goal + status.
// Toutes les chaînes via t(). aria-labels i18n sur chaque action.
// Imports RELATIFS (règle Sprint 44 — pas d'alias @/).

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
  Send,
  ArrowDownToLine,
  ListOrdered,
  BarChart3,
  GitBranch,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { SlidePanel } from '../ui/SlidePanel';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  listFunnels,
  createFunnelBuilder,
  updateFunnelBuilder,
  publishFunnelBuilder,
  deleteFunnelBuilder,
  type FunnelBuilder,
  type FunnelPrimaryGoal,
} from '../../lib/api';
import { StepEditor } from './StepEditor';

// ── Helpers ────────────────────────────────────────────────────────────────

const PRIMARY_GOALS: ReadonlyArray<FunnelPrimaryGoal> = [
  'lead_capture',
  'sale',
  'webinar',
  'other',
];

/** Label i18n pour un goal (whitelist HANDLER côté worker). */
function goalLabel(goal: FunnelPrimaryGoal): string {
  switch (goal) {
    case 'lead_capture':
      return t('funnels.goal_lead_capture');
    case 'sale':
      return t('funnels.goal_sale');
    case 'webinar':
      return t('funnels.goal_webinar');
    case 'other':
    default:
      return t('funnels.goal_other');
  }
}

/** Classe Tailwind pour le badge goal — palette cohérente par catégorie. */
const GOAL_BADGE_CLASS: Record<FunnelPrimaryGoal, string> = {
  lead_capture: 'bg-violet-50 text-violet-700 border-violet-200',
  sale: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  webinar: 'bg-sky-50 text-sky-700 border-sky-200',
  other: 'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]',
};

/** Slugify name → slug URL-safe (lowercase, NFD, single dashes). */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ── Composant ──────────────────────────────────────────────────────────────

export function FunnelsManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [funnels, setFunnels] = useState<FunnelBuilder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Modal CRUD funnel
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formSlug, setFormSlug] = useState<string>('');
  const [formSlugTouched, setFormSlugTouched] = useState<boolean>(false);
  const [formDescription, setFormDescription] = useState<string>('');
  const [formGoal, setFormGoal] = useState<FunnelPrimaryGoal>('lead_capture');
  const [submitting, setSubmitting] = useState<boolean>(false);

  // SlidePanel "Étapes"
  const [stepsPanelOpen, setStepsPanelOpen] = useState<boolean>(false);
  const [stepsFunnelId, setStepsFunnelId] = useState<string | null>(null);
  const stepsFunnel = useMemo(
    () => funnels.find((f) => f.id === stepsFunnelId) ?? null,
    [funnels, stepsFunnelId],
  );

  // ── Chargement initial ──────────────────────────────────────────────────
  const loadFunnels = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listFunnels();
    if (res.error) {
      setLoadError(res.error);
      toastError(res.error);
      setFunnels([]);
    } else if (res.data) {
      setFunnels(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadFunnels();
  }, [loadFunnels]);

  // ── Modal helpers ───────────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setEditId(null);
    setFormName('');
    setFormSlug('');
    setFormSlugTouched(false);
    setFormDescription('');
    setFormGoal('lead_capture');
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const handleOpenEdit = useCallback((f: FunnelBuilder) => {
    setEditId(f.id);
    setFormName(f.name);
    setFormSlug(f.slug);
    setFormSlugTouched(true); // ne pas écraser un slug existant
    setFormDescription(f.description ?? '');
    setFormGoal(f.primary_goal);
    setModalOpen(true);
  }, []);

  const handleNameChange = useCallback(
    (value: string) => {
      setFormName(value);
      // Auto-slug uniquement si l'utilisateur n'a pas explicitement touché le slug.
      if (!formSlugTouched && !editId) {
        setFormSlug(slugify(value));
      }
    },
    [formSlugTouched, editId],
  );

  const handleSlugChange = useCallback((value: string) => {
    setFormSlug(slugify(value));
    setFormSlugTouched(true);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = formName.trim();
      const slug = formSlug.trim();
      if (!name || !slug) return;
      setSubmitting(true);
      const payload = {
        name,
        slug,
        description: formDescription.trim() || null,
        primary_goal: formGoal,
      };
      const res = editId
        ? await updateFunnelBuilder(editId, payload)
        : await createFunnelBuilder(payload);
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setModalOpen(false);
      resetForm();
      void loadFunnels();
    },
    [
      formName,
      formSlug,
      formDescription,
      formGoal,
      editId,
      success,
      toastError,
      resetForm,
      loadFunnels,
    ],
  );

  // ── Actions par funnel ──────────────────────────────────────────────────

  const handleTogglePublish = useCallback(
    async (f: FunnelBuilder) => {
      setBusyId(f.id);
      const res = await publishFunnelBuilder(f.id, !f.is_published);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadFunnels();
    },
    [toastError, loadFunnels],
  );

  const handleDelete = useCallback(
    async (f: FunnelBuilder) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: f.name,
        confirmLabel: t('action.delete'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(f.id);
      const res = await deleteFunnelBuilder(f.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadFunnels();
    },
    [toastError, loadFunnels],
  );

  const handleOpenSteps = useCallback((f: FunnelBuilder) => {
    setStepsFunnelId(f.id);
    setStepsPanelOpen(true);
  }, []);

  const handleAnalytics = useCallback((f: FunnelBuilder) => {
    // Sprint 44 — Analytics drilldown délégué à Agent B3 (FunnelAnalyticsPanel).
    // Stub neutre : on log via toast pour signaler la route à venir.
    // Pas de console.log (CLAUDE.md).
    success(`${t('funnels.analytics.title')} — ${f.name}`);
  }, [success]);

  // ── Render ──────────────────────────────────────────────────────────────

  const formValid = formName.trim().length > 0 && formSlug.trim().length > 0;

  return (
    <div className="space-y-6" data-testid="funnels-manager">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('funnels.title')}</h2>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('funnels.create')}
        >
          {t('funnels.create')}
        </Button>
      </header>

      {/* Liste / loading / error / empty */}
      {loading ? (
        <div
          className="space-y-3"
          data-testid="funnels-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('funnels.title')}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
          role="alert"
          data-testid="funnels-error"
        >
          <p className="font-medium mb-1">{t('common.loading_error')}</p>
          <p className="text-xs opacity-80">{loadError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadFunnels()}
            className="mt-2"
            aria-label={t('action.retry')}
          >
            {t('action.retry')}
          </Button>
        </div>
      ) : funnels.length === 0 ? (
        <EmptyState
          icon={<Icon as={GitBranch} size={40} />}
          title={t('funnels.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('funnels.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="funnels-list"
          aria-label={t('funnels.title')}
        >
          {funnels.map((f) => {
            const isBusy = busyId === f.id;
            const labelEdit = t('action.edit');
            const labelDelete = t('action.delete');
            const labelSteps = t('funnels.steps.title');
            const labelAnalytics = t('funnels.analytics.title');
            const labelPub = f.is_published
              ? t('funnels.unpublish')
              : t('funnels.publish');
            const goalCls = GOAL_BADGE_CLASS[f.primary_goal];
            return (
              <li
                key={f.id}
                data-testid={`funnel-row-${f.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {f.name}
                    </h3>
                    <span
                      data-testid={`funnel-goal-${f.id}`}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${goalCls}`}
                      title={t('funnels.primary_goal')}
                    >
                      {goalLabel(f.primary_goal)}
                    </span>
                    {f.is_published ? (
                      <span
                        data-testid={`funnel-published-${f.id}`}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200"
                      >
                        {t('funnels.publish')}
                      </span>
                    ) : null}
                  </div>
                  {f.description ? (
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                      {f.description}
                    </p>
                  ) : null}
                  <div className="text-xs text-[var(--text-muted)] font-mono truncate">
                    /{f.slug}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => handleOpenEdit(f)}
                    disabled={isBusy}
                    aria-label={`${labelEdit} — ${f.name}`}
                  >
                    {labelEdit}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={ListOrdered} size="sm" />}
                    onClick={() => handleOpenSteps(f)}
                    disabled={isBusy}
                    aria-label={`${labelSteps} — ${f.name}`}
                  >
                    {labelSteps}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={BarChart3} size="sm" />}
                    onClick={() => handleAnalytics(f)}
                    disabled={isBusy}
                    aria-label={`${labelAnalytics} — ${f.name}`}
                  >
                    {labelAnalytics}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={
                      <Icon
                        as={f.is_published ? ArrowDownToLine : Send}
                        size="sm"
                      />
                    }
                    onClick={() => void handleTogglePublish(f)}
                    disabled={isBusy}
                    aria-label={`${labelPub} — ${f.name}`}
                  >
                    {labelPub}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(f)}
                    disabled={isBusy}
                    aria-label={`${labelDelete} — ${f.name}`}
                  >
                    {labelDelete}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal CRUD */}
      <Modal
        open={modalOpen}
        onOpenChange={(o) => {
          setModalOpen(o);
          if (!o) resetForm();
        }}
        title={editId ? t('action.edit') : t('funnels.create')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="funnel-name"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('funnels.title')}
            </label>
            <Input
              id="funnel-name"
              value={formName}
              onChange={(e) => handleNameChange(e.target.value)}
              autoFocus
              required
              aria-label={t('funnels.title')}
            />
          </div>
          <div>
            <label
              htmlFor="funnel-slug"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              Slug
            </label>
            <Input
              id="funnel-slug"
              value={formSlug}
              onChange={(e) => handleSlugChange(e.target.value)}
              required
              aria-label="Slug"
              helper="URL publique : /:slug"
            />
          </div>
          <div>
            <label
              htmlFor="funnel-description"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('snapshots.create.description_label')}
            </label>
            <Textarea
              id="funnel-description"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={3}
              maxLength={500}
              showCounter
              aria-label={t('snapshots.create.description_label')}
            />
          </div>
          <div>
            <label
              htmlFor="funnel-goal"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('funnels.primary_goal')}
            </label>
            <Select
              id="funnel-goal"
              value={formGoal}
              onChange={(e) =>
                setFormGoal(e.target.value as FunnelPrimaryGoal)
              }
              aria-label={t('funnels.primary_goal')}
            >
              {PRIMARY_GOALS.map((g) => (
                <option key={g} value={g}>
                  {goalLabel(g)}
                </option>
              ))}
            </Select>
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
              disabled={submitting || !formValid}
              aria-label={t('action.save')}
            >
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Drawer Steps */}
      <SlidePanel
        open={stepsPanelOpen}
        onOpenChange={(o) => {
          setStepsPanelOpen(o);
          if (!o) setStepsFunnelId(null);
        }}
        title={
          stepsFunnel
            ? `${t('funnels.steps.title')} — ${stepsFunnel.name}`
            : t('funnels.steps.title')
        }
        size="lg"
        closeLabel={t('common.close')}
      >
        {stepsFunnelId ? <StepEditor funnelId={stepsFunnelId} /> : null}
      </SlidePanel>
    </div>
  );
}
