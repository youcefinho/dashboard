// ── Boutique — SlidePanel gestion catégories — Sprint E2 M3.4 ────────────────
// CRUD catégories hiérarchiques (parent_id + sort_order). Pas de drag (trivial
// non) → input sort_order + select parent. Wiré endpoints M1.

import { useEffect, useState } from 'react';
import { SlidePanel, Input, Select, Button, Icon, useToast, useConfirm } from '@/components/ui';
import {
  getEcommerceCategories, createEcommerceCategory,
  updateEcommerceCategory, deleteEcommerceCategory,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import type { ProductCategory } from '@/lib/types';
import { Plus, Trash2, FolderTree, Check } from 'lucide-react';

interface CategoriesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

export function CategoriesPanel({ open, onOpenChange, onChanged }: CategoriesPanelProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [cats, setCats] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');
  const [edit, setEdit] = useState<Record<string, { name: string; sort_order: string; parent_id: string }>>({});

  const load = () => {
    setLoading(true);
    getEcommerceCategories()
      .then((r) => setCats(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (open) load(); }, [open]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createEcommerceCategory({
        name: newName.trim(),
        parent_id: newParent || null,
        sort_order: cats.length,
      });
      setNewName(''); setNewParent('');
      success(t('shop.product_created'));
      load(); onChanged?.();
    } catch {
      toastError(t('shop.product_save_error'));
    }
  };

  const handleSave = async (c: ProductCategory) => {
    const e = edit[c.id];
    if (!e) return;
    try {
      await updateEcommerceCategory(c.id, {
        name: e.name.trim() || c.name,
        sort_order: parseInt(e.sort_order, 10) || 0,
        parent_id: e.parent_id || null,
      });
      setEdit((prev) => { const n = { ...prev }; delete n[c.id]; return n; });
      success(t('shop.product_updated'));
      load(); onChanged?.();
    } catch {
      toastError(t('shop.product_save_error'));
    }
  };

  const handleDelete = async (c: ProductCategory) => {
    const ok = await confirm({
      title: t('shop.delete_product_q').replace('produit', 'catégorie').replace('product', 'category'),
      description: 'Les produits liés ne seront pas supprimés, seulement dissociés.',
      confirmLabel: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try {
      await deleteEcommerceCategory(c.id);
      load(); onChanged?.();
    } catch {
      toastError(t('shop.product_save_error'));
    }
  };

  return (
    <SlidePanel open={open} onOpenChange={onOpenChange}
      title={t('shop.manage_categories')} size="md">
      <div className="flex flex-col gap-5">
        {/* Création */}
        <div className="p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex flex-col gap-3">
          <span className="text-[13px] font-semibold inline-flex items-center gap-1.5">
            <Icon as={FolderTree} size="sm" /> {t('shop.add_category')}
          </span>
          <Input label={t('shop.category_name')} value={newName}
            onChange={(e: any) => setNewName(e.target.value)} placeholder="Vêtements" />
          <Select label={t('shop.parent_category')} value={newParent}
            onChange={(e: any) => setNewParent(e.target.value)}>
            <option value="">— {t('shop.no_category')} —</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Button size="md" className="self-start gap-2" disabled={!newName.trim()}
            onClick={handleCreate}>
            <Icon as={Plus} size="md" /> {t('shop.add_category')}
          </Button>
        </div>

        {/* Liste */}
        {loading ? (
          <p className="text-[12px] text-[var(--text-muted)]">…</p>
        ) : cats.length === 0 ? (
          <p className="text-[13px] text-[var(--text-muted)]">{t('shop.no_category')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {cats.map((c) => {
              const e = edit[c.id];
              const editing = Boolean(e);
              return (
                <div key={c.id}
                  className="p-3 rounded-lg border border-[var(--border-subtle)] flex items-center gap-3">
                  {editing ? (
                    <>
                      <Input className="flex-1" value={e.name}
                        onChange={(ev: any) => setEdit((p) => ({ ...p, [c.id]: { ...e, name: ev.target.value } }))} />
                      <Input className="w-16" value={e.sort_order} inputMode="numeric"
                        aria-label={t('shop.sort_order')}
                        onChange={(ev: any) => setEdit((p) => ({ ...p, [c.id]: { ...e, sort_order: ev.target.value } }))} />
                      <button type="button" aria-label="Enregistrer"
                        className="p-1.5 rounded text-[var(--success)] hover:bg-[var(--success)]/10"
                        onClick={() => handleSave(c)}>
                        <Icon as={Check} size="sm" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button"
                        className="flex-1 text-left text-[13px] font-medium hover:text-[var(--primary)] transition-colors"
                        onClick={() => setEdit((p) => ({
                          ...p,
                          [c.id]: {
                            name: c.name,
                            sort_order: String(c.sort_order ?? 0),
                            parent_id: c.parent_id || '',
                          },
                        }))}>
                        {c.name}
                        {c.parent_id && (
                          <span className="text-[11px] text-[var(--text-muted)] ml-2">
                            ↳ {cats.find((x) => x.id === c.parent_id)?.name || ''}
                          </span>
                        )}
                      </button>
                      {typeof c.product_count === 'number' && (
                        <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
                          {c.product_count}
                        </span>
                      )}
                      <button type="button" aria-label="Supprimer la catégorie"
                        className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                        onClick={() => handleDelete(c)}>
                        <Icon as={Trash2} size="sm" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SlidePanel>
  );
}
