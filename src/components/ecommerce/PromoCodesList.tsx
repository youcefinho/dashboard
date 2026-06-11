import { useEffect, useState } from 'react';
import {
  Card, EmptyState, Skeleton, SlidePanel, Button, Tag, Input,
  Select, useToast, useConfirm,
} from '@/components/ui';
import {
  getEcommercePromoCodes, createEcommercePromoCode, updateEcommercePromoCode,
  deleteEcommercePromoCode,
} from '@/lib/api';
import type { PromoCode, PromoCodeInput } from '@/lib/api';
import { formatMoneyCents } from '@/lib/i18n/number';
import { Ticket, Plus, Trash2, Pencil, RefreshCw, Layers } from 'lucide-react';

interface PromoCodesListProps {
  clientId?: string;
}

type RuleState = {
  min_order_cents: string;
  allowed_variant_ids: string;
  allowed_product_ids: string;
};

type FormState = {
  code: string;
  discount_type: string;
  value: string;
  starts_at: string;
  expires_at: string;
  max_uses: string;
  rules: RuleState;
};

const EMPTY_FORM: FormState = {
  code: '',
  discount_type: 'percent',
  value: '',
  starts_at: '',
  expires_at: '',
  max_uses: '',
  rules: {
    min_order_cents: '',
    allowed_variant_ids: '',
    allowed_product_ids: '',
  },
};

function promoToForm(p: PromoCode): FormState {
  let rules: RuleState = {
    min_order_cents: '',
    allowed_variant_ids: '',
    allowed_product_ids: '',
  };
  try {
    const parsed = JSON.parse(p.rules_json || '{}');
    rules = {
      min_order_cents: parsed.min_order_cents != null ? String(parsed.min_order_cents) : '',
      allowed_variant_ids: Array.isArray(parsed.allowed_variant_ids)
        ? parsed.allowed_variant_ids.join(', ')
        : '',
      allowed_product_ids: Array.isArray(parsed.allowed_product_ids)
        ? parsed.allowed_product_ids.join(', ')
        : '',
    };
  } catch {
    //
  }

  return {
    code: p.code || '',
    discount_type: p.discount_type || 'percent',
    value: p.value != null ? String(p.value) : '',
    starts_at: p.starts_at || '',
    expires_at: p.expires_at || '',
    max_uses: p.max_uses != null ? String(p.max_uses) : '',
    rules,
  };
}

function formToInput(f: FormState): PromoCodeInput {
  const rulesJsonObj: Record<string, any> = {};
  
  if (f.rules.min_order_cents) {
    rulesJsonObj.min_order_cents = Number(f.rules.min_order_cents);
  }
  
  if (f.rules.allowed_variant_ids.trim()) {
    rulesJsonObj.allowed_variant_ids = f.rules.allowed_variant_ids
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  
  if (f.rules.allowed_product_ids.trim()) {
    rulesJsonObj.allowed_product_ids = f.rules.allowed_product_ids
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }

  return {
    code: f.code.trim().toUpperCase(),
    discount_type: f.discount_type,
    value: Number(f.value) || 0,
    starts_at: f.starts_at || null,
    expires_at: f.expires_at || null,
    max_uses: f.max_uses ? Number(f.max_uses) : null,
    rules_json: JSON.stringify(rulesJsonObj),
  };
}

export function PromoCodesList({}: PromoCodesListProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await getEcommercePromoCodes();
      if (res.data) {
        setPromos(res.data);
      } else {
        setPromos([]);
        setLoadError(true);
      }
    } catch {
      setPromos([]);
      setLoadError(true);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setPanelOpen(true);
  };

  const openEdit = (p: PromoCode) => {
    setEditId(p.id);
    setForm(promoToForm(p));
    setFormError(null);
    setPanelOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) {
      setFormError('Le code promo est requis.');
      return;
    }
    if (!form.value) {
      setFormError('La valeur de la remise est requise.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = formToInput(form);
      const res = editId
        ? await updateEcommercePromoCode(editId, payload)
        : await createEcommercePromoCode(payload);
      
      if (!res.data) {
        setFormError(res.error || 'Impossible d’enregistrer le code promo');
        setSaving(false);
        return;
      }
      success('Le code promo a été enregistré avec succès.');
      setPanelOpen(false);
      await load();
    } catch {
      setFormError('Une erreur inattendue est survenue.');
    }
    setSaving(false);
  };

  const handleDelete = async (p: PromoCode) => {
    const ok = await confirm({
      title: 'Supprimer le code promo ?',
      description: `Êtes-vous sûr de vouloir supprimer définitivement le code "${p.code}" ?`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await deleteEcommercePromoCode(p.id);
      if (res && (res.error || res.data === undefined)) {
        toastError(res.error || 'Impossible de supprimer le code promo');
        return;
      }
      setPromos((prev) => prev.filter((x) => x.id !== p.id));
      success('Code promo supprimé.');
    } catch {
      toastError('Impossible de supprimer le code promo');
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const setRule = <K extends keyof RuleState>(k: K, v: RuleState[K]) =>
    setForm((p) => ({ ...p, rules: { ...p.rules, [k]: v } }));

  const discountLabel = (p: PromoCode): string => {
    if (p.discount_type === 'fixed') {
      return formatMoneyCents(p.value, 'fr-CA', 'CAD');
    }
    return `${p.value} %`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-wider text-[var(--text-primary)]">CODES PROMO & MOTEUR DE RABAIS</h2>
          <p className="text-sm text-[var(--text-muted)]">Gérez les codes de rabais dynamiques avec restrictions complexes pour votre vitrine e-commerce.</p>
        </div>
        <Button variant="primary" size="sm" leftIcon={<Plus size={15} />} onClick={openCreate}>
          Nouveau code promo
        </Button>
      </div>

      {isLoading ? (
        <Card className="p-0 overflow-hidden" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Chargement...</span>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-4 w-1/4 rounded" />
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="h-3 w-16 rounded ml-auto" />
              </div>
            ))}
          </div>
        </Card>
      ) : promos.length === 0 ? (
        <Card className="p-0 overflow-hidden">
          <EmptyState
            variant={loadError ? 'compact' : 'first-time'}
            icon={loadError ? <RefreshCw size={32} strokeWidth={1.8} /> : <Ticket size={32} strokeWidth={1.8} />}
            meta="E-commerce"
            title={loadError ? 'Erreur lors du chargement' : 'Aucun code promotionnel'}
            description={loadError ? 'Impossible de récupérer la liste des codes promos.' : 'Créez votre premier code de réduction dynamique.'}
            action={
              loadError ? (
                <Button variant="primary" size="sm" leftIcon={<RefreshCw size={15} />} onClick={() => void load()}>
                  Réessayer
                </Button>
              ) : (
                <Button variant="primary" size="sm" leftIcon={<Plus size={15} />} onClick={openCreate}>
                  Créer un code promo
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden border border-[var(--border-subtle)] shadow-md bg-[var(--bg-surface)] dark:bg-zinc-900 rounded-lg">
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]" style={{ minWidth: 150 }}>Code</th>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Remise</th>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Plancher d'achat</th>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Validité</th>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Utilisations</th>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Ciblage</th>
                  <th style={{ width: 96 }}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {promos.map((p, idx) => {
                  let minOrder = 'Aucun';
                  let targeting = 'Tout le catalogue';
                  try {
                    const parsed = JSON.parse(p.rules_json || '{}');
                    if (parsed.min_order_cents) {
                      minOrder = formatMoneyCents(parsed.min_order_cents, 'fr-CA', 'CAD');
                    }
                    const vCount = parsed.allowed_variant_ids?.length || 0;
                    const pCount = parsed.allowed_product_ids?.length || 0;
                    if (vCount > 0 && pCount > 0) {
                      targeting = `${pCount} prod, ${vCount} var`;
                    } else if (vCount > 0) {
                      targeting = `${vCount} variantes`;
                    } else if (pCount > 0) {
                      targeting = `${pCount} produits`;
                    }
                  } catch {
                    //
                  }

                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-[var(--bg-subtle)] transition-colors list-item-enter"
                      style={{ animationDelay: `${idx * 28}ms` }}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-[14px] text-cyan-600 dark:text-cyan-400">
                        {p.code}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">
                        <div className="flex items-center gap-1.5 font-medium">
                          {discountLabel(p)}
                          <span className="text-[11px] text-[var(--text-muted)] font-normal">
                            ({p.discount_type === 'fixed' ? 'Montant fixe' : 'Pourcentage'})
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">
                        {minOrder}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)] text-sm">
                        <div className="flex flex-col">
                          <span>Du {p.starts_at?.slice(0, 10) || 'Immédiat'}</span>
                          <span>Au {p.expires_at?.slice(0, 10) || 'Jamais'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-sm">
                        {p.current_uses ?? 0} {p.max_uses ? `/ ${p.max_uses}` : ''}
                      </td>
                      <td className="px-4 py-3">
                        <Tag size="sm" variant={(targeting !== 'Tout le catalogue') ? 'success' : 'neutral'}>
                          {targeting}
                        </Tag>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label="Modifier"
                            onClick={() => openEdit(p)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label="Supprimer"
                            onClick={() => void handleDelete(p)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
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

      {/* SlidePanel de création / édition */}
      <SlidePanel
        open={panelOpen}
        onOpenChange={(o) => {
          if (!o) setPanelOpen(false);
        }}
        title={editId ? 'Modifier le code promo' : 'Nouveau code promo'}
        description="Configurez les paramètres et les critères d'admissibilité du rabais."
        size="md"
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
              Code promotionnel
            </label>
            <Input
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
              placeholder="EX: ETE2026, VIP-15"
              className="font-mono uppercase"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                Type de remise
              </label>
              <Select
                value={form.discount_type}
                onChange={(e) => set('discount_type', e.target.value)}
              >
                <option value="percent">Pourcentage (%)</option>
                <option value="fixed">Montant fixe ($)</option>
              </Select>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                {form.discount_type === 'percent' ? 'Pourcentage' : 'Valeur (en cents ou CAD)'}
              </label>
              <Input
                type="number"
                value={form.value}
                onChange={(e) => set('value', e.target.value)}
                placeholder={form.discount_type === 'percent' ? '15' : '1500 (pour 15.00$)'}
              />
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-4 mt-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
              <Layers size={16} className="text-cyan-600" />
              Règles d'admissibilité (rules_json)
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                  Plancher d'achat (en cents)
                </label>
                <Input
                  type="number"
                  value={form.rules.min_order_cents}
                  onChange={(e) => setRule('min_order_cents', e.target.value)}
                  placeholder="Ex: 5000 (pour 50$ minimum)"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                  ID variantes autorisées (séparés par des virgules)
                </label>
                <Input
                  value={form.rules.allowed_variant_ids}
                  onChange={(e) => setRule('allowed_variant_ids', e.target.value)}
                  placeholder="Ex: var_1, var_2"
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Laissez vide pour autoriser toutes les variantes.</p>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                  ID produits autorisés (séparés par des virgules)
                </label>
                <Input
                  value={form.rules.allowed_product_ids}
                  onChange={(e) => setRule('allowed_product_ids', e.target.value)}
                  placeholder="Ex: prod_1, prod_2"
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Laissez vide pour autoriser tous les produits.</p>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-4 mt-2 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                Date de début
              </label>
              <Input
                type="date"
                value={form.starts_at}
                onChange={(e) => set('starts_at', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                Date d'expiration
              </label>
              <Input
                type="date"
                value={form.expires_at}
                onChange={(e) => set('expires_at', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
              Limite maximale d'utilisations
            </label>
            <Input
              type="number"
              value={form.max_uses}
              onChange={(e) => set('max_uses', e.target.value)}
              placeholder="Ex: 100 (laissez vide pour illimité)"
            />
          </div>

          {formError && (
            <p className="text-[13px] text-[var(--danger)] font-medium bg-[var(--danger-soft)] p-2 rounded">{formError}</p>
          )}

          <div className="flex items-center gap-2 pt-4 border-t border-[var(--border-subtle)]">
            <Button
              variant="primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
            <Button variant="secondary" onClick={() => setPanelOpen(false)} disabled={saving}>
              Annuler
            </Button>
          </div>
        </div>
      </SlidePanel>
    </div>
  );
}
