// ── CustomerGroupsManager — Sprint 48 (Agent B1) ────────────────────────────
// Gestion des segments tarifaires B2B (customer_groups) : CRUD groupes +
// assignation/retrait de customers. Cap clients.manage (FIGÉE).
//
// API back FIGÉE (seq143 §6) :
//   listCustomerGroups()                 → ApiResponse<CustomerGroup[]>
//   createCustomerGroup({...})           → ApiResponse<CustomerGroup>
//   updateCustomerGroup(id, {...})       → ApiResponse<CustomerGroup>
//   deleteCustomerGroup(id)              → ApiResponse<{ ok: true }>
//   assignCustomerToGroup(id, cid, exp?) → ApiResponse<CustomerGroupAssignment>
//   removeFromGroup(id, cid)             → ApiResponse<{ ok: true }>
//
// Style : Stripe-clean (calque SnapshotManager). Flat surfaces, focus ring
// purple, badges status gris/vert. Toutes chaînes via t(). aria-labels i18n
// sur chaque action. Aucun console.log (CLAUDE.md règle d'or #6).

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
  UserPlus,
  Users,
  UserMinus,
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
  listCustomerGroups,
  createCustomerGroup,
  updateCustomerGroup,
  deleteCustomerGroup,
  assignCustomerToGroup,
  removeFromGroup,
  type CustomerGroup,
  type CustomerGroupInput,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Slugifie : NFD strip diacritics, [^a-z0-9]+ → '-', trim '-', max 60. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Clamp default_discount_pct entre 0 et 100. */
function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

// ── État form modal ────────────────────────────────────────────────────────

type FormState = {
  name: string;
  slug: string;
  description: string;
  defaultDiscountPct: number;
  isActive: boolean;
  /** Si true → user a manuellement édité le slug → arrêter auto-sync. */
  slugDirty: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  slug: '',
  description: '',
  defaultDiscountPct: 0,
  isActive: true,
  slugDirty: false,
};

// ── Composant ──────────────────────────────────────────────────────────────

export function CustomerGroupsManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modal CRUD (create | edit)
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Modal Assign customer
  const [assignOpen, setAssignOpen] = useState<boolean>(false);
  const [assignGroup, setAssignGroup] = useState<CustomerGroup | null>(null);
  const [assignCustomerId, setAssignCustomerId] = useState<string>('');
  const [assignedCustomerIds, setAssignedCustomerIds] = useState<string[]>([]);
  const [assignSubmitting, setAssignSubmitting] = useState<boolean>(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Chargement ─────────────────────────────────────────────────────────
  const loadGroups = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listCustomerGroups();
    if (res.error) {
      toastError(res.error);
      setLoadError(res.error);
      setGroups([]);
    } else if (res.data) {
      setGroups(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  // ── CRUD modal ─────────────────────────────────────────────────────────

  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((g: CustomerGroup) => {
    setEditingId(g.id);
    setForm({
      name: g.name,
      slug: g.slug ?? '',
      description: g.description ?? '',
      defaultDiscountPct: g.default_discount_pct,
      isActive: g.is_active === 1,
      slugDirty: true,
    });
    setModalOpen(true);
  }, []);

  const handleNameChange = useCallback((v: string) => {
    setForm((prev) => ({
      ...prev,
      name: v,
      slug: prev.slugDirty ? prev.slug : slugify(v),
    }));
  }, []);

  const handleSlugChange = useCallback((v: string) => {
    setForm((prev) => ({ ...prev, slug: v, slugDirty: true }));
  }, []);

  const handleSubmitCrud = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = form.name.trim();
      if (!name) return;
      const payload: CustomerGroupInput = {
        name,
        slug: form.slug.trim() || null,
        description: form.description.trim() || null,
        default_discount_pct: clampPct(form.defaultDiscountPct),
        is_active: form.isActive ? 1 : 0,
      };
      setSubmitting(true);
      const res = editingId
        ? await updateCustomerGroup(editingId, payload)
        : await createCustomerGroup(payload);
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('action.save'));
      setModalOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      void loadGroups();
    },
    [form, editingId, success, toastError, loadGroups],
  );

  const handleToggleActive = useCallback(
    async (g: CustomerGroup, next: boolean) => {
      setBusyId(g.id);
      const res = await updateCustomerGroup(g.id, {
        is_active: next ? 1 : 0,
      });
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadGroups();
    },
    [toastError, loadGroups],
  );

  const handleDelete = useCallback(
    async (g: CustomerGroup) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('action.delete')} — ${g.name}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(g.id);
      const res = await deleteCustomerGroup(g.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadGroups();
    },
    [confirm, toastError, loadGroups],
  );

  // ── Modal Assign ───────────────────────────────────────────────────────

  const handleOpenAssign = useCallback((g: CustomerGroup) => {
    setAssignGroup(g);
    setAssignCustomerId('');
    setAssignedCustomerIds([]);
    setAssignOpen(true);
  }, []);

  const handleAssignSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!assignGroup) return;
      const customerId = assignCustomerId.trim();
      if (!customerId) return;
      setAssignSubmitting(true);
      const res = await assignCustomerToGroup(assignGroup.id, customerId);
      setAssignSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('customer_groups.assign'));
      setAssignedCustomerIds((prev) =>
        prev.includes(customerId) ? prev : [...prev, customerId],
      );
      setAssignCustomerId('');
    },
    [assignGroup, assignCustomerId, success, toastError],
  );

  const handleRemoveAssigned = useCallback(
    async (customerId: string) => {
      if (!assignGroup) return;
      setAssignSubmitting(true);
      const res = await removeFromGroup(assignGroup.id, customerId);
      setAssignSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      setAssignedCustomerIds((prev) => prev.filter((c) => c !== customerId));
    },
    [assignGroup, toastError],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="customer-groups-manager">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('customer_groups.title')}</h2>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('customer_groups.create')}
        >
          {t('customer_groups.create')}
        </Button>
      </header>

      {loading ? (
        <div
          className="space-y-3"
          data-testid="customer-groups-loading"
          role="status"
          aria-busy="true"
          aria-live="polite"
          aria-label={t('state.loading')}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)] flex items-start justify-between gap-3 flex-wrap"
          role="alert"
          data-testid="customer-groups-error"
        >
          <div className="min-w-0">
            <p className="font-medium mb-0.5">{t('common.error.title')}</p>
            <p className="text-xs opacity-80 break-words">{loadError}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadGroups()}
            aria-label={t('common.retry')}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Icon as={Users} size={40} />}
          title={t('customer_groups.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('customer_groups.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="customer-groups-list"
          aria-label={t('customer_groups.title')}
        >
          {groups.map((g) => {
            const isBusy = busyId === g.id;
            const isActive = g.is_active === 1;
            return (
              <li
                key={g.id}
                data-testid={`customer-group-row-${g.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {g.name}
                    </h3>
                    {g.slug ? (
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        {g.slug}
                      </span>
                    ) : null}
                    <span
                      data-testid={`customer-group-discount-${g.id}`}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]"
                      aria-label={`${t('customer_groups.discount_pct')}: ${g.default_discount_pct}%`}
                    >
                      −{g.default_discount_pct}%
                    </span>
                  </div>
                  {g.description ? (
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                      {g.description}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(next) => void handleToggleActive(g, next)}
                    size="sm"
                    disabled={isBusy}
                    aria-label={`${t('action.toggle_active')} — ${g.name}`}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={UserPlus} size="sm" />}
                    onClick={() => handleOpenAssign(g)}
                    disabled={isBusy}
                    aria-label={`${t('customer_groups.assign')} — ${g.name}`}
                  >
                    {t('customer_groups.assign')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => handleOpenEdit(g)}
                    disabled={isBusy}
                    aria-label={`${t('action.edit')} — ${g.name}`}
                  >
                    {t('action.edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(g)}
                    disabled={isBusy}
                    aria-label={`${t('action.delete')} — ${g.name}`}
                  >
                    {t('action.delete')}
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
        onOpenChange={setModalOpen}
        title={
          editingId ? t('action.edit') : t('customer_groups.create')
        }
        size="md"
      >
        <form onSubmit={handleSubmitCrud} className="space-y-4">
          <div>
            <label
              htmlFor="cg-name"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('field.name')}
            </label>
            <Input
              id="cg-name"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              autoFocus
              required
              aria-label={t('field.name')}
            />
          </div>
          <div>
            <label
              htmlFor="cg-slug"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('field.slug')}
            </label>
            <Input
              id="cg-slug"
              value={form.slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              aria-label={t('field.slug')}
              placeholder={slugify(form.name)}
            />
          </div>
          <div>
            <label
              htmlFor="cg-desc"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('field.description')}
            </label>
            <Textarea
              id="cg-desc"
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              rows={3}
              maxLength={500}
              showCounter
              aria-label={t('field.description')}
            />
          </div>
          <div>
            <label
              htmlFor="cg-discount"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('customer_groups.discount_pct')}
            </label>
            <Input
              id="cg-discount"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={String(form.defaultDiscountPct)}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  defaultDiscountPct: clampPct(Number(e.target.value)),
                }))
              }
              aria-label={t('customer_groups.discount_pct')}
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Switch
              checked={form.isActive}
              onCheckedChange={(next) =>
                setForm((p) => ({ ...p, isActive: next }))
              }
              size="sm"
              label={t('action.toggle_active')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setModalOpen(false)}
              disabled={submitting}
            >
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              isLoading={submitting}
              disabled={submitting || !form.name.trim()}
              aria-label={t('action.save')}
            >
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Assign */}
      <Modal
        open={assignOpen}
        onOpenChange={(open) => {
          setAssignOpen(open);
          if (!open) {
            setAssignGroup(null);
            setAssignCustomerId('');
            setAssignedCustomerIds([]);
          }
        }}
        title={`${t('customer_groups.assign')}${assignGroup ? ` — ${assignGroup.name}` : ''}`}
        size="md"
      >
        <form onSubmit={handleAssignSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="cg-assign-customer"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('field.customer_id')}
            </label>
            <div className="flex gap-2">
              <Input
                id="cg-assign-customer"
                value={assignCustomerId}
                onChange={(e) => setAssignCustomerId(e.target.value)}
                autoFocus
                aria-label={t('field.customer_id')}
                placeholder="cust_..."
                containerClassName="flex-1"
              />
              <Button
                type="submit"
                size="sm"
                isLoading={assignSubmitting}
                disabled={assignSubmitting || !assignCustomerId.trim()}
                aria-label={t('customer_groups.assign')}
              >
                {t('customer_groups.assign')}
              </Button>
            </div>
          </div>
        </form>

        {assignedCustomerIds.length > 0 ? (
          <div className="mt-5 space-y-2">
            <h4 className="text-sm font-medium text-[var(--text-secondary)]">
              {t('customer_groups.members')}
            </h4>
            <ul className="space-y-1.5 list-none p-0 m-0">
              {assignedCustomerIds.map((cid) => (
                <li
                  key={cid}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-[var(--border-subtle)] bg-[var(--gray-50)]"
                >
                  <span className="font-mono text-xs text-[var(--text-primary)] truncate">
                    {cid}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={UserMinus} size="sm" />}
                    onClick={() => void handleRemoveAssigned(cid)}
                    disabled={assignSubmitting}
                    aria-label={`${t('action.remove')} — ${cid}`}
                  >
                    {t('action.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
