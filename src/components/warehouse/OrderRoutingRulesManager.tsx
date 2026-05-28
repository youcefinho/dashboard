// ── OrderRoutingRulesManager — Sprint 66 (2026-05-29) ─────────────────────────
// CRUD UI premium pour la gestion des règles de routage automatique des commandes.
// Permet de configurer des conditions géographiques par priorité et d'assigner
// l'entrepôt physique idéal.
//
// API :
//   getOrderRoutingRules()                 → ApiResponse<OrderRoutingRule[]>
//   createOrderRoutingRule(body)           → ApiResponse<{ id: string }>
//   updateOrderRoutingRule(id, body)       → ApiResponse<{ id: string }>
//   deleteOrderRoutingRule(id)             → ApiResponse<{ id: string }>
//   listWarehouses()                       → ApiResponse<Warehouse[]>

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
  MapPin,
  ArrowUp,
  ArrowDown,
  Settings,
  X,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  getOrderRoutingRules,
  createOrderRoutingRule,
  updateOrderRoutingRule,
  deleteOrderRoutingRule,
  listWarehouses,
  type Warehouse,
} from '../../lib/api';
import type { OrderRoutingRule, OrderRoutingCondition } from '../../lib/types';

// Dictionnaire de traduction local en français
const TXT: Record<string, string> = {
  title: 'Règles de routage des commandes',
  subtitle: 'Configurez des règles prioritaires pour acheminer automatiquement vos commandes vers le bon entrepôt physique en fonction de l’adresse de livraison.',
  create_btn: 'Ajouter une règle',
  edit_title: 'Modifier la règle de routage',
  create_title: 'Créer une règle de routage',
  name_label: 'Nom de la règle',
  name_placeholder: 'Ex: Commandes Québec / Dropship Ontario',
  priority_label: 'Priorité (les valeurs les plus élevées s’appliquent en premier)',
  warehouse_label: 'Entrepôt de destination',
  warehouse_placeholder: 'Sélectionner un entrepôt...',
  active_label: 'Règle active',
  conditions_title: 'Conditions géographiques (ET logique)',
  conditions_desc: 'La règle s’appliquera si l’adresse de livraison remplit toutes les conditions ci-dessous. Une règle sans conditions fait office de règle générale (catch-all).',
  add_condition: 'Ajouter une condition',
  field_label: 'Champ de l’adresse',
  operator_label: 'Opérateur',
  value_label: 'Valeur',
  delete_confirm_title: 'Supprimer la règle',
  delete_confirm_desc: 'Es-tu certain de vouloir supprimer définitivement la règle « {{name}} » ? Cette action est irréversible.',
  empty_state_title: 'Aucune règle de routage',
  empty_state_desc: 'Les commandes sans règle correspondante seront affectées à votre entrepôt par défaut.',
  error_load: 'Impossible de charger les règles de routage ou les entrepôts.',
  field_country: 'Pays (Code ISO alpha-2, ex: CA, FR)',
  field_subdiv: 'Province / État (ex: QC, ON, NY)',
  field_postal: 'Code postal / ZIP',
  op_equals: 'Égal à',
  op_not_equals: 'Différent de',
  op_contains: 'Contient',
  op_starts_with: 'Commence par',
};

interface FormState {
  name: string;
  priority: number;
  action_warehouse_id: string;
  is_active: boolean;
  conditions: OrderRoutingCondition[];
}

const EMPTY_FORM: FormState = {
  name: '',
  priority: 0,
  action_warehouse_id: '',
  is_active: true,
  conditions: [],
};

export function OrderRoutingRulesManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [rules, setRules] = useState<OrderRoutingRule[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Chargement ───────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [rulesRes, whRes] = await Promise.all([
      getOrderRoutingRules(),
      listWarehouses(),
    ]);

    if (rulesRes.error || whRes.error) {
      const err = rulesRes.error || whRes.error || TXT.error_load!;
      setLoadError(err);
      toastError(err);
    } else {
      setRules(rulesRes.data || []);
      setWarehouses(whRes.data || []);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── CRUD Actions ─────────────────────────────────────────────────────────
  const handleOpenCreate = useCallback(() => {
    // La priorité par défaut est la priorité max + 10
    const maxPriority = rules.reduce((max, r) => Math.max(max, r.priority || 0), 0);
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      priority: maxPriority + 10,
      action_warehouse_id: warehouses.find((w) => w.is_default === 1)?.id || warehouses[0]?.id || '',
    });
    setModalOpen(true);
  }, [rules, warehouses]);

  const handleOpenEdit = useCallback((rule: OrderRoutingRule) => {
    let conditions: OrderRoutingCondition[] = [];
    try {
      conditions = JSON.parse(rule.conditions_json || '[]');
    } catch {
      conditions = [];
    }

    setEditingId(rule.id);
    setForm({
      name: rule.name,
      priority: rule.priority,
      action_warehouse_id: rule.action_warehouse_id,
      is_active: rule.is_active === 1,
      conditions,
    });
    setModalOpen(true);
  }, []);

  const handleDelete = useCallback(async (rule: OrderRoutingRule) => {
    const ok = await confirm({
      title: TXT.delete_confirm_title!,
      description: TXT.delete_confirm_desc!.replace('{{name}}', rule.name),
      confirmLabel: t('action.delete'),
      cancelLabel: t('action.cancel'),
      danger: true,
    });
    if (!ok) return;

    setBusyId(rule.id);
    const res = await deleteOrderRoutingRule(rule.id);
    setBusyId(null);

    if (res.error) {
      toastError(res.error);
    } else {
      success(t('action.save'));
      void loadData();
    }
  }, [confirm, toastError, success, loadData]);

  const handleToggleActive = useCallback(async (rule: OrderRoutingRule, next: boolean) => {
    setBusyId(rule.id);
    const res = await updateOrderRoutingRule(rule.id, { is_active: next ? 1 : 0 });
    setBusyId(null);

    if (res.error) {
      toastError(res.error);
    } else {
      void loadData();
    }
  }, [toastError, loadData]);

  const handleIncrementPriority = useCallback(async (rule: OrderRoutingRule, delta: number) => {
    setBusyId(rule.id);
    const res = await updateOrderRoutingRule(rule.id, { priority: (rule.priority || 0) + delta });
    setBusyId(null);

    if (res.error) {
      toastError(res.error);
    } else {
      void loadData();
    }
  }, [toastError, loadData]);

  const handleSubmit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!form.action_warehouse_id) {
      toastError(TXT.warehouse_placeholder!);
      return;
    }

    setSubmitting(true);
    const payload = {
      name: form.name.trim(),
      priority: form.priority,
      action_warehouse_id: form.action_warehouse_id,
      is_active: form.is_active ? 1 : 0,
      conditions_json: JSON.stringify(form.conditions),
    };

    const res = editingId
      ? await updateOrderRoutingRule(editingId, payload)
      : await createOrderRoutingRule(payload);

    setSubmitting(false);

    if (res.error) {
      toastError(res.error);
    } else {
      success(t('action.save'));
      setModalOpen(false);
      void loadData();
    }
  }, [editingId, form, success, toastError, loadData]);

  // ── Gestion des conditions ───────────────────────────────────────────────
  const addCondition = useCallback(() => {
    setForm((f) => ({
      ...f,
      conditions: [
        ...f.conditions,
        { field: 'shipping_country', operator: 'equals', value: '' },
      ],
    }));
  }, []);

  const removeCondition = useCallback((index: number) => {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.filter((_, i) => i !== index),
    }));
  }, []);

  const updateCondition = useCallback((index: number, key: keyof OrderRoutingCondition, val: string) => {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.map((c, i) => {
        if (i !== index) return c;
        return { ...c, [key]: val };
      }),
    }));
  }, []);

  // ── Rendu ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6" data-testid="order-routing-rules-manager">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 max-w-2xl">
          <h2 className="t-h2">{TXT.title}</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">{TXT.subtitle}</p>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          disabled={loading || warehouses.length === 0}
        >
          {TXT.create_btn}
        </Button>
      </header>

      {loading ? (
        <div className="space-y-3" role="status" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white">
              <div className="flex-1 space-y-2 min-w-0">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-red-50 p-4 text-sm text-red-800" role="alert">
          <p className="font-medium mb-1">{t('warehouse.errors.load_failed')}</p>
          <p className="text-xs opacity-80">{loadError}</p>
          <Button size="sm" variant="ghost" onClick={() => void loadData()} className="mt-2 text-red-800 hover:bg-red-100">
            {t('action.retry')}
          </Button>
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Icon as={Settings} size={40} />}
          title={TXT.empty_state_title!}
          description={TXT.empty_state_desc!}
          action={
            warehouses.length > 0 ? (
              <Button onClick={handleOpenCreate} leftIcon={<Icon as={Plus} size="sm" />}>
                {TXT.create_btn}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          <ul className="space-y-3 list-none p-0 m-0">
            {rules.map((rule) => {
              const wh = warehouses.find((w) => w.id === rule.action_warehouse_id);
              const isActive = rule.is_active === 1;
              const isBusy = busyId === rule.id;
              let parsedConditions: OrderRoutingCondition[] = [];
              try {
                parsedConditions = JSON.parse(rule.conditions_json || '[]');
              } catch {
                parsedConditions = [];
              }

              return (
                <li
                  key={rule.id}
                  data-testid={`routing-rule-${rule.id}`}
                  className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-[var(--text-primary)] truncate">
                        {rule.name}
                      </h3>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                        {t('priority.title') || 'Priorité'} : {rule.priority}
                      </span>
                      {!isActive && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                          Inactif
                        </span>
                      )}
                    </div>

                    <div className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
                      <Icon as={MapPin} size="sm" className="text-emerald-500 shrink-0" />
                      <span>
                        Route vers :{' '}
                        <strong className="text-[var(--text-primary)]">
                          {wh ? wh.name : 'Entrepôt inconnu'}
                        </strong>
                        {wh?.is_default === 1 && (
                          <span className="ml-1.5 text-xs text-emerald-600 font-medium">
                            (Par défaut)
                          </span>
                        )}
                      </span>
                    </div>

                    {parsedConditions.length > 0 ? (
                      <div className="pt-1">
                        <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider block mb-1">
                          Conditions
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {parsedConditions.map((cond, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-slate-50 text-slate-700 border border-slate-200"
                            >
                              <code className="font-semibold text-slate-800 mr-1">
                                {cond.field === 'shipping_country' && 'Pays'}
                                {cond.field === 'shipping_country_subdiv' && 'Province'}
                                {cond.field === 'shipping_postal_code' && 'CP'}
                              </code>
                              <span className="text-slate-400 mr-1">
                                {cond.operator === 'equals' && '='}
                                {cond.operator === 'not_equals' && '≠'}
                                {cond.operator === 'contains' && 'contient'}
                                {cond.operator === 'starts_with' && 'commence par'}
                              </span>
                              <strong className="text-slate-900 font-medium">"{cond.value}"</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--text-muted)] italic">
                        Règle générale (catch-all)
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center flex-wrap">
                    <div className="flex items-center border border-[var(--border-subtle)] rounded-lg overflow-hidden mr-2">
                      <button
                        onClick={() => handleIncrementPriority(rule, 10)}
                        disabled={isBusy}
                        className="p-1.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-600 border-r border-[var(--border-subtle)] disabled:opacity-50"
                        title="Augmenter la priorité (+10)"
                      >
                        <Icon as={ArrowUp} size="sm" />
                      </button>
                      <button
                        onClick={() => handleIncrementPriority(rule, -10)}
                        disabled={isBusy || (rule.priority || 0) <= 0}
                        className="p-1.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-600 disabled:opacity-50"
                        title="Diminuer la priorité (-10)"
                      >
                        <Icon as={ArrowDown} size="sm" />
                      </button>
                    </div>

                    <Switch
                      checked={isActive}
                      onCheckedChange={(next) => void handleToggleActive(rule, next)}
                      disabled={isBusy}
                      size="sm"
                    />

                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Icon as={Pencil} size="sm" />}
                      onClick={() => handleOpenEdit(rule)}
                      disabled={isBusy}
                    >
                      {t('action.edit')}
                    </Button>

                    <Button
                      variant="danger"
                      size="sm"
                      leftIcon={<Icon as={Trash2} size="sm" />}
                      onClick={() => void handleDelete(rule)}
                      disabled={isBusy}
                    >
                      {t('action.delete')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Modal de création / édition */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingId ? TXT.edit_title || '' : TXT.create_title || ''}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={TXT.name_label!}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={TXT.name_placeholder}
            required
            autoFocus
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              type="number"
              label={TXT.priority_label!}
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
              min={0}
              required
            />

            <div className="flex flex-col">
              <label className="text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                {TXT.warehouse_label}
              </label>
              <select
                value={form.action_warehouse_id}
                onChange={(e) => setForm((f) => ({ ...f, action_warehouse_id: e.target.value }))}
                className="w-full h-10 px-3 rounded-lg border border-[var(--border-subtle)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                required
              >
                <option value="" disabled>
                  {TXT.warehouse_placeholder}
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.is_default === 1 ? `(${t('warehouse.default')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                  {TXT.conditions_title}
                </h4>
                <p className="text-xs text-[var(--text-muted)] max-w-xl mt-0.5">
                  {TXT.conditions_desc}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<Icon as={Plus} size="sm" />}
                onClick={addCondition}
              >
                {TXT.add_condition}
              </Button>
            </div>

            {form.conditions.length > 0 ? (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {form.conditions.map((cond, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-[var(--border-subtle)]"
                  >
                    <div className="grid grid-cols-3 gap-2 flex-1">
                      <div>
                        <select
                          value={cond.field}
                          onChange={(e) =>
                            updateCondition(
                              idx,
                              'field',
                              e.target.value as OrderRoutingCondition['field'],
                            )
                          }
                          className="w-full h-8 px-2 rounded-md border border-[var(--border-subtle)] bg-white text-xs"
                        >
                          <option value="shipping_country">Pays</option>
                          <option value="shipping_country_subdiv">Province / État</option>
                          <option value="shipping_postal_code">Code postal</option>
                        </select>
                      </div>

                      <div>
                        <select
                          value={cond.operator}
                          onChange={(e) =>
                            updateCondition(
                              idx,
                              'operator',
                              e.target.value as OrderRoutingCondition['operator'],
                            )
                          }
                          className="w-full h-8 px-2 rounded-md border border-[var(--border-subtle)] bg-white text-xs"
                        >
                          <option value="equals">=</option>
                          <option value="not_equals">≠</option>
                          <option value="contains">contient</option>
                          <option value="starts_with">commence par</option>
                        </select>
                      </div>

                      <div>
                        <input
                          type="text"
                          value={cond.value}
                          onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                          placeholder="Ex: CA, QC, G1A..."
                          className="w-full h-8 px-2 rounded-md border border-[var(--border-subtle)] bg-white text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeCondition(idx)}
                      className="p-1 hover:bg-slate-200 active:bg-slate-300 rounded text-slate-500 hover:text-slate-800 transition"
                    >
                      <Icon as={X} size="sm" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-4">
            <Switch
              checked={form.is_active}
              onCheckedChange={(next) => setForm((f) => ({ ...f, is_active: next }))}
              label={TXT.active_label!}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" isLoading={submitting} disabled={submitting || !form.name.trim()}>
              {t('action.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
