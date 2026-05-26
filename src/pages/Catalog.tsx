// ── Catalogue de services / produits (Sprint 18 CATALOGUE DE SERVICES) ───────
// docs/LOT-CATALOG.md §6.H (Manager-C) : page de gestion du catalogue.
//   - liste listCatalogItems / création createCatalogItem / édition updateCatalogItem
//   - suppression deleteCatalogItem (confirm)
//   - import depuis la Boutique importCatalogFromProducts (cents→dollars côté worker)
//   - i18n via t('catalog.*') — 13 clés FIGÉES Phase A (aucune créée)
// Page séparée (route /catalog), sous requireAuth SEUL côté worker (catalogue de
// SERVICES vivable sans Boutique). Style sobre, primitives existantes (calque
// Quotes.tsx). unit_price en DOLLARS REAL (aligné quote_items) — pas de cents.

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Card, Button, Input, Select, Textarea, Skeleton, EmptyState, PageHero, Tag,
  useToast, useConfirm,
} from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Package, Pencil, Trash2, DownloadCloud } from 'lucide-react';
import { formatCurrency } from '@/lib/i18n/number';
import { getLocale, t } from '@/lib/i18n';
import {
  listCatalogItems,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  importCatalogFromProducts,
  type CatalogItem,
  type CatalogKind,
  type CatalogItemInput,
} from '@/lib/api';

interface FormState {
  name: string;
  description: string;
  kind: CatalogKind;
  unit_price: string;
  currency: string;
  category: string;
  recurrence: 'one_time' | 'recurring';
}

const blankForm = (): FormState => ({
  name: '',
  description: '',
  kind: 'service',
  unit_price: '',
  currency: 'CAD',
  category: '',
  recurrence: 'one_time',
});

export function CatalogPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // ── Sprint LOT 1-3 — Error state inline + retry (gap audit Catalog) ──
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());

  const fetchItems = async () => {
    setLoadError(null);
    try {
      const res = await listCatalogItems();
      if (res.data) {
        setItems(res.data);
      } else if (res.error) {
        setLoadError(res.error);
      }
    } catch (err) {
      console.error(err);
      setLoadError(err instanceof Error ? err.message : t('catalog.error.load_failed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void fetchItems(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(blankForm());
    setShowForm(true);
  };

  const openEdit = (item: CatalogItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      description: item.description || '',
      kind: item.kind === 'product' ? 'product' : 'service',
      unit_price: item.unit_price != null ? String(item.unit_price) : '',
      currency: item.currency || 'CAD',
      category: item.category || '',
      recurrence: item.recurrence === 'recurring' ? 'recurring' : 'one_time',
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error(t('catalog.name'));
      return;
    }
    const price = Number(form.unit_price);
    const payload: CatalogItemInput = {
      name,
      description: form.description.trim() || undefined,
      kind: form.kind,
      unit_price: Number.isFinite(price) && price >= 0 ? price : 0,
      currency: form.currency || undefined,
      category: form.category.trim() || undefined,
      recurrence: form.recurrence,
    };
    setSubmitting(true);
    try {
      // §6.A : pas de champ `code` — discrimine sur data / texte error.
      const res = editingId
        ? await updateCatalogItem(editingId, payload)
        : await createCatalogItem(payload);
      if (res.data) {
        setShowForm(false);
        setForm(blankForm());
        setEditingId(null);
        void fetchItems();
      } else {
        toast.error(res.error || t('catalog.new'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('catalog.new'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item: CatalogItem) => {
    // Sprint LOT 1-3 — confirm copy fix : utilise clé delete_confirm dédiée
    const ok = await confirm({
      title: t('catalog.action.delete_confirm'),
      description: item.name,
      danger: true,
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      const res = await deleteCatalogItem(item.id);
      if (res.data) void fetchItems();
      else toast.error(res.error || t('catalog.title'));
    } catch (err) {
      console.error(err);
    } finally {
      setBusyId(null);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await importCatalogFromProducts();
      if (res.data) {
        toast.success(t('catalog.import_products'));
        void fetchItems();
      } else {
        toast.error(res.error || t('catalog.import_products'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('catalog.import_products'));
    } finally {
      setImporting(false);
    }
  };

  const kindLabel = (k: CatalogKind) =>
    k === 'product' ? t('catalog.kind.product') : t('catalog.kind.service');
  const recurrenceLabel = (r?: string | null) =>
    r === 'recurring' ? t('catalog.recurrence.recurring') : t('catalog.recurrence.one_time');

  return (
    <AppLayout title={t('catalog.title')}>
      <PageHero
        meta="Workspace"
        title={t('catalog.title')}
        highlight={t('catalog.title')}
        description={t('catalog.subtitle')}
        actions={
          <div className="inline-flex items-center gap-2">
            <Button variant="secondary" onClick={() => void handleImport()} disabled={importing}>
              <DownloadCloud size={14} /> {t('catalog.import_products')}
            </Button>
            <Button variant="premium" onClick={openCreate}>{t('catalog.new')}</Button>
          </div>
        }
      />

      <Card className="overflow-hidden p-0">
        {loadError && !isLoading ? (
          // Sprint LOT 1-3 — Error inline + retry (gap audit Catalog)
          <div className="p-6" role="alert" aria-live="assertive">
            <p className="text-sm font-semibold text-[var(--danger)] mb-1">
              {t('catalog.error.load_failed')}
            </p>
            <p className="text-xs text-[var(--text-muted)] mb-3 break-all">{loadError}</p>
            <Button variant="secondary" onClick={() => { setIsLoading(true); void fetchItems(); }}>
              {t('action.retry')}
            </Button>
          </div>
        ) : isLoading ? (
          <div className="overflow-x-auto" aria-busy="true" aria-live="polite">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-3 w-20 rounded" />)}
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-3 w-40 rounded flex-1" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-3 w-24 rounded" />
                </div>
              ))}
            </div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            variant="first-time"
            icon={<Package size={40} className="text-[var(--text-muted)]" />}
            title={t('catalog.empty')}
            description={t('catalog.empty')}
            action={<Button variant="primary" onClick={openCreate}>{t('catalog.new')}</Button>}
          />
        ) : (
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium">
              <thead>
                <tr>
                  <th className="text-left">{t('catalog.name')}</th>
                  <th className="text-left">{t('catalog.kind.service')}</th>
                  <th className="text-right">{t('catalog.price')}</th>
                  <th className="text-left">{t('catalog.category')}</th>
                  <th className="text-left">{t('catalog.recurrence.one_time')}</th>
                  <th style={{ width: 120 }} className="text-right">—</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id} className="list-item-enter" style={{ animationDelay: `${idx * 28}ms` }}>
                    <td>
                      <div className="flex items-center gap-2 min-w-0">
                        <Package size={14} className="text-[var(--text-muted)] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold truncate">{item.name}</div>
                          {item.description && (
                            <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[280px]">{item.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <Tag size="xs" variant={item.kind === 'product' ? 'info' : 'neutral'}>
                        {kindLabel(item.kind === 'product' ? 'product' : 'service')}
                      </Tag>
                    </td>
                    <td className="text-right font-bold t-mono-num text-[13px]">
                      {formatCurrency(item.unit_price || 0, getLocale(), item.currency || 'CAD')}
                    </td>
                    <td className="text-[12px] text-[var(--text-secondary)]">
                      {item.category || <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="text-[12px] text-[var(--text-secondary)]">
                      {recurrenceLabel(item.recurrence)}
                    </td>
                    <td className="text-right">
                      {/* Sprint LOT 1-3 — labels édition/suppression i18n + a11y */}
                      <div className="inline-flex items-center gap-3 justify-end">
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => openEdit(item)}
                          aria-label={`${t('catalog.action.edit')} : ${item.name}`}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--primary)] hover:underline cursor-pointer disabled:opacity-50"
                        >
                          <Pencil size={11} aria-hidden="true" /> {t('catalog.action.edit')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void handleDelete(item)}
                          className="text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer disabled:opacity-50"
                          aria-label={`${t('catalog.action.delete')} : ${item.name}`}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showForm}
        onOpenChange={(v) => { if (!v) { setShowForm(false); setEditingId(null); } }}
        title={t('catalog.new')}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('catalog.name')}</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('catalog.title')}</label>
            <Textarea
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t('catalog.kind.service')}
              value={form.kind}
              onChange={e => setForm(f => ({ ...f, kind: e.target.value as CatalogKind }))}
            >
              <option value="service">{t('catalog.kind.service')}</option>
              <option value="product">{t('catalog.kind.product')}</option>
            </Select>
            <Select
              label={t('catalog.recurrence.one_time')}
              value={form.recurrence}
              onChange={e => setForm(f => ({ ...f, recurrence: e.target.value as 'one_time' | 'recurring' }))}
            >
              <option value="one_time">{t('catalog.recurrence.one_time')}</option>
              <option value="recurring">{t('catalog.recurrence.recurring')}</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('catalog.price')}</label>
              <Input
                type="number" min="0" step="0.01"
                value={form.unit_price}
                onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('catalog.category')}</label>
              <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-6">
            <Button variant="secondary" onClick={() => { setShowForm(false); setEditingId(null); }} disabled={submitting}>
              {t('catalog.title')}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting}>{t('catalog.new')}</Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
