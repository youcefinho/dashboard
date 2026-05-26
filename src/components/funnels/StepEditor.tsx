// ── StepEditor — Sprint 44 (Agent B1) ──────────────────────────────────────
// CRUD des FunnelBuilderStep d'un funnel donné.
// Rendu à l'intérieur du SlidePanel "Étapes" de FunnelsManager.
//
// API back FIGÉE (Sprint 44 — paritaire worker.ts seq139) :
//   listFunnelSteps(funnelId)              → ApiResponse<FunnelBuilderStep[]>
//   createFunnelStep(funnelId, partial)    → ApiResponse<FunnelBuilderStep>
//   updateFunnelStep(stepId, partial)      → ApiResponse<FunnelBuilderStep>
//   deleteFunnelStep(stepId)               → ApiResponse<{ success }>
//
// Le bouton "Variants" est un STUB Sprint 44 — déclenchera <VariantBuilder>
// (livré par Agent B2). On expose un slot `onOpenVariants?` pour wirer plus
// tard, mais par défaut on toast neutre.
//
// Style : Stripe-clean, badges step_type, tri ASC par order_index.
// Toutes les chaînes via t(). aria-labels i18n sur chaque action.
// Imports RELATIFS (règle Sprint 44 — pas d'alias @/).

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Layers,
  FlaskConical,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  listFunnelSteps,
  createFunnelStep,
  updateFunnelStep,
  deleteFunnelStep,
  type FunnelBuilderStep,
  type FunnelStepType,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

const STEP_TYPES: ReadonlyArray<FunnelStepType> = [
  'landing',
  'optin',
  'upsell',
  'downsell',
  'thank_you',
  'custom',
];

/** Label i18n pour un step_type (whitelist HANDLER worker). */
function stepTypeLabel(type: FunnelStepType): string {
  switch (type) {
    case 'landing':
      return t('funnels.steps.type_landing');
    case 'optin':
      return t('funnels.steps.type_optin');
    case 'upsell':
      return t('funnels.steps.type_upsell');
    case 'downsell':
      return t('funnels.steps.type_downsell');
    case 'thank_you':
      return t('funnels.steps.type_thank_you');
    case 'custom':
    default:
      return t('funnels.steps.type_custom');
  }
}

/** Palette badge par step_type — différenciation visuelle rapide dans la liste. */
const STEP_TYPE_BADGE_CLASS: Record<FunnelStepType, string> = {
  landing: 'bg-sky-50 text-sky-700 border-sky-200',
  optin: 'bg-violet-50 text-violet-700 border-violet-200',
  upsell: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  downsell: 'bg-amber-50 text-amber-700 border-amber-200',
  thank_you: 'bg-rose-50 text-rose-700 border-rose-200',
  custom: 'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]',
};

// ── Composant ──────────────────────────────────────────────────────────────

export interface StepEditorProps {
  funnelId: string;
  /** Optionnel — hook vers <VariantBuilder> (livré Agent B2). */
  onOpenVariants?: (stepId: string) => void;
}

export function StepEditor({ funnelId, onOpenVariants }: StepEditorProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [steps, setSteps] = useState<FunnelBuilderStep[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Modal CRUD step
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formType, setFormType] = useState<FunnelStepType>('landing');
  const [formOrder, setFormOrder] = useState<number>(0);
  const [formRedirect, setFormRedirect] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  // ── Chargement initial / sur changement de funnelId ─────────────────────
  const loadSteps = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listFunnelSteps(funnelId);
    if (res.error) {
      toastError(res.error);
      setSteps([]);
      setLoadError(res.error);
    } else if (res.data) {
      // Tri ASC par order_index (le worker peut déjà renvoyer trié, on
      // sécurise quand même côté UI pour éviter tout flicker visuel).
      const sorted = [...res.data].sort(
        (a, b) => a.order_index - b.order_index,
      );
      setSteps(sorted);
    }
    setLoading(false);
  }, [funnelId, toastError]);

  useEffect(() => {
    void loadSteps();
  }, [loadSteps]);

  // ── Modal helpers ───────────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setEditId(null);
    setFormName('');
    setFormType('landing');
    // Suggère le prochain order_index libre (max + 1) pour la création.
    const nextOrder = steps.length
      ? Math.max(...steps.map((s) => s.order_index)) + 1
      : 0;
    setFormOrder(nextOrder);
    setFormRedirect('');
  }, [steps]);

  const handleOpenCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const handleOpenEdit = useCallback((step: FunnelBuilderStep) => {
    setEditId(step.id);
    setFormName(step.name);
    setFormType(step.step_type);
    setFormOrder(step.order_index);
    setFormRedirect(step.redirect_after_url ?? '');
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = formName.trim();
      if (!name) return;
      setSubmitting(true);
      const payload = {
        name,
        step_type: formType,
        order_index: Number.isFinite(formOrder) ? formOrder : 0,
        redirect_after_url: formRedirect.trim() || null,
      };
      const res = editId
        ? await updateFunnelStep(editId, payload)
        : await createFunnelStep(funnelId, payload);
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setModalOpen(false);
      setEditId(null);
      void loadSteps();
    },
    [
      formName,
      formType,
      formOrder,
      formRedirect,
      editId,
      funnelId,
      success,
      toastError,
      loadSteps,
    ],
  );

  // ── Actions par step ────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (step: FunnelBuilderStep) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('action.delete')} — ${step.name}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(step.id);
      const res = await deleteFunnelStep(step.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadSteps();
    },
    [confirm, toastError, loadSteps],
  );

  const handleVariants = useCallback(
    (step: FunnelBuilderStep) => {
      if (onOpenVariants) {
        onOpenVariants(step.id);
        return;
      }
      // Stub — Agent B2 livrera <VariantBuilder>. On signale via toast
      // pour que l'utilisateur sache que l'action est reconnue.
      success(`${t('funnels.variants.title')} — ${step.name}`);
    },
    [onOpenVariants, success],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  const formValid = formName.trim().length > 0;

  return (
    <div className="space-y-5" data-testid={`step-editor-${funnelId}`}>
      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="t-h4">{t('funnels.steps.title')}</h3>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="sm" />}
          aria-label={t('funnels.steps.create')}
        >
          {t('funnels.steps.create')}
        </Button>
      </header>

      {/* Liste / loading / empty / error */}
      {loading ? (
        <div
          className="space-y-2"
          data-testid="steps-loading"
          aria-busy="true"
          aria-live="polite"
          aria-label={t('common.loading')}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-3 rounded-lg border border-[var(--border-subtle)] bg-white"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div
          role="alert"
          data-testid="steps-error"
          className="p-3 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 flex items-start justify-between gap-3 flex-wrap"
        >
          <p className="text-sm text-[var(--text-primary)]">
            {t('common.loading_error')}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadSteps()}
            aria-label={t('common.retry')}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : steps.length === 0 ? (
        <EmptyState
          icon={<Icon as={Layers} size={36} />}
          title={t('funnels.steps.title')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('funnels.steps.create')}
            </Button>
          }
        />
      ) : (
        <ol
          className="space-y-2 list-none p-0 m-0"
          data-testid="steps-list"
          aria-label={t('funnels.steps.title')}
        >
          {steps.map((step) => {
            const isBusy = busyId === step.id;
            const labelEdit = t('action.edit');
            const labelDelete = t('action.delete');
            const labelVariants = t('funnels.variants.title');
            const typeCls = STEP_TYPE_BADGE_CLASS[step.step_type];
            return (
              <li
                key={step.id}
                data-testid={`step-row-${step.id}`}
                className="p-3 rounded-lg border border-[var(--border-subtle)] bg-white flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex-1 min-w-0 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[var(--bg-subtle)] text-[var(--text-muted)] text-xs font-mono shrink-0"
                  >
                    {step.order_index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[var(--text-primary)] truncate">
                        {step.name}
                      </span>
                      <span
                        data-testid={`step-type-${step.id}`}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${typeCls}`}
                      >
                        {stepTypeLabel(step.step_type)}
                      </span>
                    </div>
                    {step.redirect_after_url ? (
                      <div className="text-xs text-[var(--text-muted)] font-mono truncate mt-0.5">
                        → {step.redirect_after_url}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={FlaskConical} size="sm" />}
                    onClick={() => handleVariants(step)}
                    disabled={isBusy}
                    aria-label={`${labelVariants} — ${step.name}`}
                  >
                    {labelVariants}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => handleOpenEdit(step)}
                    disabled={isBusy}
                    aria-label={`${labelEdit} — ${step.name}`}
                  >
                    {labelEdit}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(step)}
                    disabled={isBusy}
                    aria-label={`${labelDelete} — ${step.name}`}
                  >
                    {labelDelete}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Modal CRUD */}
      <Modal
        open={modalOpen}
        onOpenChange={(o) => {
          setModalOpen(o);
          if (!o) setEditId(null);
        }}
        title={editId ? t('action.edit') : t('funnels.steps.create')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="step-name"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('funnels.steps.title')}
            </label>
            <Input
              id="step-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              autoFocus
              required
              aria-label={t('funnels.steps.title')}
            />
          </div>
          <div>
            <label
              htmlFor="step-type"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('funnels.primary_goal')}
            </label>
            <Select
              id="step-type"
              value={formType}
              onChange={(e) => setFormType(e.target.value as FunnelStepType)}
              aria-label={t('funnels.primary_goal')}
            >
              {STEP_TYPES.map((type) => (
                <option key={type} value={type}>
                  {stepTypeLabel(type)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label
              htmlFor="step-order"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('funnels.steps.order')}
            </label>
            <Input
              id="step-order"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={Number.isFinite(formOrder) ? String(formOrder) : '0'}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setFormOrder(Number.isFinite(n) ? n : 0);
              }}
              aria-label={t('funnels.steps.order')}
            />
          </div>
          <div>
            <label
              htmlFor="step-redirect"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('funnels.steps.redirect_url')}
            </label>
            <Input
              id="step-redirect"
              type="url"
              value={formRedirect}
              onChange={(e) => setFormRedirect(e.target.value)}
              placeholder="https://…"
              aria-label={t('funnels.steps.redirect_url')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setModalOpen(false);
                setEditId(null);
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
    </div>
  );
}
