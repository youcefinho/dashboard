// ── DropshipRoutingsEditor — Sprint 47 (Agent B2) ───────────────────────────
// CRUD UI sur les routages dropshipping (table dropship_routings, seq142).
// Chaque routage lie une variant_id à un supplier (FK dropship_suppliers) avec
// un supplier_sku, un cost_cents et un flag auto_route.
//
// Helpers async FIGÉS (api.ts §Sprint 47 — Dropship Routings + Suppliers) :
//   listDropshipRoutings / createDropshipRouting / updateDropshipRouting /
//   deleteDropshipRouting + listDropshipSuppliers (pour Select fournisseur).
//
// Style : Stripe-clean (Card + Modal + Switch + Tag soft tints), pas de glow
// ni gradient ni halo. Imports RELATIFS uniquement (consigne Sprint 47 B2).
// aria-labels via t() i18n.
//
// Validation côté UI :
//   - variant_id, supplier_id obligatoires.
//   - Unicité variant_id (UNIQUE par variant×client côté DB) — affiche un
//     warning si la variant est déjà routée (sauf en édition de cette ligne).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Route as RouteIcon } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import {
  listDropshipRoutings,
  createDropshipRouting,
  updateDropshipRouting,
  deleteDropshipRouting,
  listDropshipSuppliers,
} from '../../lib/api';
import type {
  DropshipRouting,
  DropshipRoutingInput,
  DropshipSupplier,
} from '../../lib/api';
import { t } from '../../lib/i18n';

// ── Composant ───────────────────────────────────────────────────────────────

export function DropshipRoutingsEditor() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [routings, setRoutings] = useState<DropshipRouting[]>([]);
  const [suppliers, setSuppliers] = useState<DropshipSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formVariantId, setFormVariantId] = useState('');
  const [formSupplierId, setFormSupplierId] = useState('');
  const [formSupplierSku, setFormSupplierSku] = useState('');
  const [formCostCents, setFormCostCents] = useState('');
  const [formAutoRoute, setFormAutoRoute] = useState(true);

  // ── Load ────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [routingsRes, suppliersRes] = await Promise.all([
        listDropshipRoutings(),
        listDropshipSuppliers(),
      ]);
      if (routingsRes.data) setRoutings(routingsRes.data);
      else if (routingsRes.error) {
        setLoadError(routingsRes.error);
        toastError(routingsRes.error);
      }
      if (suppliersRes.data) setSuppliers(suppliersRes.data);
      else if (suppliersRes.error) toastError(suppliersRes.error);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── Index suppliers par id pour lookup name dans la liste ───────────────
  const supplierById = useMemo(() => {
    const map = new Map<string, DropshipSupplier>();
    for (const s of suppliers) map.set(s.id, s);
    return map;
  }, [suppliers]);

  // ── Unicité variant_id (warning UI) ─────────────────────────────────────
  const variantAlreadyRouted = useMemo(() => {
    if (!formVariantId.trim()) return false;
    return routings.some(
      (r) => r.variant_id === formVariantId.trim() && r.id !== editId,
    );
  }, [formVariantId, routings, editId]);

  // ── Form helpers ────────────────────────────────────────────────────────
  const resetForm = () => {
    setEditId(null);
    setFormVariantId('');
    setFormSupplierId(suppliers[0]?.id ?? '');
    setFormSupplierSku('');
    setFormCostCents('');
    setFormAutoRoute(true);
  };

  const openCreate = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (routing: DropshipRouting) => {
    setEditId(routing.id);
    setFormVariantId(routing.variant_id);
    setFormSupplierId(routing.supplier_id);
    setFormSupplierSku(routing.supplier_sku ?? '');
    setFormCostCents(String(routing.cost_cents ?? 0));
    setFormAutoRoute(routing.auto_route === 1);
    setModalOpen(true);
  };

  // Bouton submit désactivé tant que requis manquants OU variant en doublon.
  const isFormValid = useMemo(() => {
    if (!formVariantId.trim()) return false;
    if (!formSupplierId.trim()) return false;
    if (variantAlreadyRouted) return false;
    const cost = Number(formCostCents);
    if (formCostCents !== '' && (Number.isNaN(cost) || cost < 0)) return false;
    return true;
  }, [formVariantId, formSupplierId, formCostCents, variantAlreadyRouted]);

  // ── Submit ──────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!isFormValid) {
      toastError(t('error.required_fields'));
      return;
    }
    setSaving(true);
    try {
      const cost = formCostCents === '' ? 0 : Number(formCostCents);
      const payload: DropshipRoutingInput = {
        variant_id: formVariantId.trim(),
        supplier_id: formSupplierId,
        supplier_sku: formSupplierSku.trim() || null,
        cost_cents: cost,
        auto_route: formAutoRoute ? 1 : 0,
      };

      if (editId) {
        const res = await updateDropshipRouting(editId, payload);
        if (res.error) {
          toastError(res.error);
          return;
        }
        success(`${t('dropship.routings.title')} — ${t('common.updated')}`);
      } else {
        const res = await createDropshipRouting(payload);
        if (res.error) {
          toastError(res.error);
          return;
        }
        success(t('dropship.routings.create'));
      }
      setModalOpen(false);
      resetForm();
      await loadAll();
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────
  const remove = async (routing: DropshipRouting) => {
    const ok = await confirm({
      title: t('action.delete'),
      description: `${t('dropship.routings.delete.confirm')} — ${routing.variant_id}`,
      confirmLabel: t('action.delete'),
      cancelLabel: t('action.cancel'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteDropshipRouting(routing.id);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success(t('common.delete'));
    await loadAll();
  };

  // ── Toggle auto_route inline ────────────────────────────────────────────
  const toggleAutoRoute = async (routing: DropshipRouting) => {
    const res = await updateDropshipRouting(routing.id, {
      auto_route: routing.auto_route === 1 ? 0 : 1,
    });
    if (res.error) {
      toastError(res.error);
      return;
    }
    await loadAll();
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="text-lg font-semibold flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <Icon as={RouteIcon} size={18} /> {t('dropship.routings.title')}
          </h2>
          <p
            className="text-sm mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('dropship.routings.auto_route')}
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="shrink-0"
          data-testid="dropship-routing-add"
          aria-label={t('dropship.routings.create')}
          disabled={suppliers.length === 0}
        >
          <Icon as={Plus} size={15} /> {t('dropship.routings.create')}
        </Button>
      </div>

      {suppliers.length === 0 && !loading ? (
        <Card
          className="p-4 text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          {t('dropship.suppliers.empty')}
        </Card>
      ) : null}

      {loading ? (
        <div
          className="space-y-2"
          data-testid="dropship-routing-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('dropship.routings.title')}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
          role="alert"
          data-testid="dropship-routing-error"
        >
          <p className="font-medium mb-1">{t('dropship.routings.errors.load_failed')}</p>
          <p className="text-xs opacity-80">{loadError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadAll()}
            className="mt-2"
            aria-label={t('action.retry')}
          >
            {t('action.retry')}
          </Button>
        </div>
      ) : routings.length === 0 ? (
        <EmptyState
          icon={<Icon as={RouteIcon} size={40} />}
          title={t('dropship.routings.empty')}
          action={
            suppliers.length > 0 ? (
              <Button
                onClick={openCreate}
                leftIcon={<Icon as={Plus} size={15} />}
                data-testid="dropship-routing-empty-add"
              >
                {t('dropship.routings.create')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid="dropship-routing-list"
            >
              <thead>
                <tr
                  className="text-left text-xs uppercase tracking-wide"
                  style={{
                    color: 'var(--text-muted)',
                    background: 'var(--bg-subtle)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <th className="px-4 py-2.5 font-semibold">variant_id</th>
                  <th className="px-4 py-2.5 font-semibold">
                    {t('dropship.suppliers.title')}
                  </th>
                  <th className="px-4 py-2.5 font-semibold">supplier_sku</th>
                  <th className="px-4 py-2.5 font-semibold text-right">
                    cost_cents
                  </th>
                  <th className="px-4 py-2.5 font-semibold">
                    {t('dropship.routings.auto_route')}
                  </th>
                  <th className="px-4 py-2.5 font-semibold text-right">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {routings.map((r) => {
                  const supplier = supplierById.get(r.supplier_id);
                  return (
                    <tr
                      key={r.id}
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      data-testid={`dropship-routing-row-${r.id}`}
                    >
                      <td className="px-4 py-3 align-top">
                        <code
                          className="text-xs px-2 py-0.5 rounded font-mono"
                          style={{
                            background: 'var(--bg-subtle)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {r.variant_id}
                        </code>
                      </td>
                      <td
                        className="px-4 py-3 align-top"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {supplier?.name ?? (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {r.supplier_id}
                          </span>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 align-top"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {r.supplier_sku ?? '—'}
                      </td>
                      <td
                        className="px-4 py-3 align-top text-right font-mono text-xs"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {(r.cost_cents / 100).toFixed(2)} $
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Switch
                          checked={r.auto_route === 1}
                          onCheckedChange={() => void toggleAutoRoute(r)}
                          size="sm"
                          variant="success"
                          data-testid={`dropship-routing-auto-${r.id}`}
                          aria-label={t('dropship.routings.auto_route')}
                        />
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(r)}
                            data-testid={`dropship-routing-edit-${r.id}`}
                            aria-label={`${t('set.team.edit') || 'Modifier'} routage ${r.variant_id}`}
                          >
                            <Icon as={Pencil} size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void remove(r)}
                            data-testid={`dropship-routing-delete-${r.id}`}
                            aria-label={`${t('common.delete') || 'Supprimer'} routage ${r.variant_id}`}
                          >
                            <Icon as={Trash2} size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Modal CRUD ─────────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={
          editId
            ? `${t('set.team.edit') || 'Modifier'} — ${formVariantId}`
            : t('dropship.routings.create')
        }
        size="md"
      >
        <div className="space-y-4 p-1">
          <Input
            label={t('dropship.routings.variant_id')}
            value={formVariantId}
            onChange={(e) => setFormVariantId(e.target.value)}
            placeholder="vrt_xxxxxxxxxxxx"
            required
            data-testid="dropship-routing-form-variant"
            aria-label={t('dropship.routings.variant_id')}
            error={variantAlreadyRouted ? t('error.duplicate') : undefined}
          />
          {variantAlreadyRouted ? (
            <p
              className="text-xs -mt-2"
              style={{ color: 'var(--warning)' }}
              data-testid="dropship-routing-form-variant-warning"
            >
              {t('error.duplicate')}
            </p>
          ) : null}

          <Select
            label={t('dropship.suppliers.title')}
            value={formSupplierId}
            onChange={(e) => setFormSupplierId(e.target.value)}
            required
            data-testid="dropship-routing-form-supplier"
            aria-label={t('dropship.suppliers.title')}
          >
            <option value="" disabled>
              {t('dropship.suppliers.title')}…
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>

          <Input
            label={t('dropship.routings.supplier_sku')}
            value={formSupplierSku}
            onChange={(e) => setFormSupplierSku(e.target.value)}
            placeholder="SKU-1234"
            data-testid="dropship-routing-form-sku"
            aria-label={t('dropship.routings.supplier_sku')}
          />

          <Input
            label={t('dropship.routings.cost_cents')}
            type="number"
            min={0}
            step={1}
            value={formCostCents}
            onChange={(e) => setFormCostCents(e.target.value)}
            placeholder="1999"
            data-testid="dropship-routing-form-cost"
            aria-label={t('dropship.routings.cost_cents')}
            helper={t('dropship.routings.cost_cents.helper')}
          />

          <Switch
            checked={formAutoRoute}
            onCheckedChange={setFormAutoRoute}
            label={t('dropship.routings.auto_route')}
            variant="success"
            data-testid="dropship-routing-form-auto"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setModalOpen(false)}
              data-testid="dropship-routing-form-cancel"
            >
              {t('action.cancel') || 'Annuler'}
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!isFormValid || saving}
              isLoading={saving}
              data-testid="dropship-routing-form-save"
              aria-label={t('action.save') || 'Enregistrer'}
            >
              {t('action.save') || 'Enregistrer'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default DropshipRoutingsEditor;
