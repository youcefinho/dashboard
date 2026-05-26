// ── Tax rules per category editor — Sprint 39 Agent B3 ─────────────────────
//
// Éditeur des règles fiscales par catégorie produit pour une région donnée.
// Props : { regionId }. Charge listTaxRules(regionId) au mount, expose un
// formulaire inline (catégorie + taux + compound) → createTaxRule + refresh,
// + tableau des règles existantes avec action Delete (via useConfirm).
//
// Style Stripe-clean : Card + en-tête sobre, form inline en grille, tableau
// avec Badge "Composé" si compound=true. a11y : aria-labels i18n, focus-visible
// natif des composants UI, role="alert" sur message d'erreur de validation.
//
// Règles métier :
//   - rate ∈ [0.0, 1.0] (0 % à 100 %). Au-delà → bouton Add disabled + helper.
//   - product_category : trim non-vide. Doublon non vérifié côté UI (worker l'a).
//   - compound : checkbox (rare — cas QC pré-2013 type TVQ sur TPS+sub).
//
// Pas d'édition in-place : on supprime puis recrée (workflow Sprint 39).

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  Input,
  Button,
  Badge,
  Skeleton,
  EmptyState,
  useToast,
  useConfirm,
  Icon,
} from '../ui';
import {
  listTaxRules,
  createTaxRule,
  deleteTaxRule,
  type CreateTaxRuleInput,
} from '../../lib/api';
import type { TaxRule } from '../../lib/types';
import { t, getLocale } from '../../lib/i18n';
import { formatDate } from '../../lib/i18n/datetime';
import { Plus, Trash2, Percent } from 'lucide-react';

export interface TaxRulesEditorProps {
  regionId: string;
}

export function TaxRulesEditor({ regionId }: TaxRulesEditorProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const [rules, setRules] = useState<TaxRule[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Form state ───────────────────────────────────────────────────────────
  const [formCategory, setFormCategory] = useState<string>('standard');
  const [formRate, setFormRate] = useState<string>(''); // string pour gérer "" pré-validation
  const [formCompound, setFormCompound] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Fetch list ───────────────────────────────────────────────────────────
  const fetchRules = useCallback(async () => {
    setLoading(true);
    const res = await listTaxRules(regionId);
    if (res.error) {
      toast.error(t('shop.tax.rules.title'));
      setRules([]);
    } else {
      setRules(res.data ?? []);
    }
    setLoading(false);
  }, [regionId, toast]);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  // ── Validation ───────────────────────────────────────────────────────────
  const parsedRate = formRate.trim() === '' ? NaN : Number(formRate);
  const rateValid =
    Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 1;
  const categoryValid = formCategory.trim().length > 0;
  const canSubmit = rateValid && categoryValid && !submitting;

  // ── Add rule ─────────────────────────────────────────────────────────────
  const handleAdd = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setFormError(null);
      if (!categoryValid) {
        setFormError(t('shop.tax.rules.category'));
        return;
      }
      if (!rateValid) {
        setFormError(t('shop.tax.rules.rate'));
        return;
      }
      setSubmitting(true);
      const input: CreateTaxRuleInput = {
        product_category: formCategory.trim(),
        rate: parsedRate,
        compound: formCompound,
      };
      const res = await createTaxRule(regionId, input);
      setSubmitting(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      // Reset form (catégorie revient à 'standard' pour itérer vite).
      setFormCategory('standard');
      setFormRate('');
      setFormCompound(false);
      toast.success(t('shop.tax.rules.add'));
      await fetchRules();
    },
    [
      categoryValid,
      rateValid,
      formCategory,
      parsedRate,
      formCompound,
      regionId,
      toast,
      fetchRules,
    ],
  );

  // ── Delete rule ──────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (rule: TaxRule) => {
      const ok = await confirm({
        title: t('common.delete'),
        description: `${rule.product_category} — ${(rule.rate * 100).toFixed(2)} %`,
        confirmLabel: t('common.delete'),
        danger: true,
      });
      if (!ok) return;
      setDeletingId(rule.id);
      const res = await deleteTaxRule(rule.id);
      setDeletingId(null);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      await fetchRules();
    },
    [confirm, toast, fetchRules],
  );

  // ── Render ───────────────────────────────────────────────────────────────
  const locale = getLocale();

  return (
    <Card className="settings-card p-6 space-y-5">
      <header className="settings-section-header">
        <div className="flex items-center gap-2">
          <Icon as={Percent} size={16} className="text-[var(--primary)]" />
          <h3 className="t-h3">{t('shop.tax.rules.title')}</h3>
        </div>
      </header>

      {/* ── Form add inline ─────────────────────────────────────────────── */}
      <form
        onSubmit={handleAdd}
        className="grid grid-cols-1 sm:grid-cols-[1fr,140px,auto,auto] gap-3 items-end"
        aria-label={t('shop.tax.rules.add')}
      >
        <Input
          id="tax-rule-category"
          label={t('shop.tax.rules.category')}
          aria-label={t('shop.tax.rules.category')}
          value={formCategory}
          onChange={(e) => setFormCategory(e.target.value)}
          placeholder="standard"
          data-testid="tax-rule-input-category"
        />
        <Input
          id="tax-rule-rate"
          type="number"
          step="0.0001"
          min="0"
          max="1"
          label={t('shop.tax.rules.rate')}
          aria-label={t('shop.tax.rules.rate')}
          value={formRate}
          onChange={(e) => setFormRate(e.target.value)}
          placeholder="0.05"
          error={
            formRate.trim() !== '' && !rateValid
              ? t('shop.tax.rules.rate')
              : undefined
          }
          data-testid="tax-rule-input-rate"
        />
        <label
          className="inline-flex items-center gap-2 t-body-sm select-none pb-2"
          htmlFor="tax-rule-compound"
        >
          <input
            id="tax-rule-compound"
            type="checkbox"
            checked={formCompound}
            onChange={(e) => setFormCompound(e.target.checked)}
            aria-label={t('shop.tax.rules.compound')}
            data-testid="tax-rule-input-compound"
            className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          />
          {t('shop.tax.rules.compound')}
        </label>
        <Button
          type="submit"
          variant="primary"
          size="md"
          leftIcon={<Plus size={14} />}
          disabled={!canSubmit}
          isLoading={submitting}
          aria-label={t('shop.tax.rules.add')}
          data-testid="tax-rule-btn-add"
        >
          {t('shop.tax.rules.add')}
        </Button>
        {formError ? (
          <p
            role="alert"
            className="t-caption text-[var(--danger)] sm:col-span-4"
            data-testid="tax-rule-form-error"
          >
            {formError}
          </p>
        ) : null}
      </form>

      {/* ── Liste ───────────────────────────────────────────────────────── */}
      <div
        className="overflow-x-auto"
        role="region"
        aria-label={t('shop.tax.rules.title')}
      >
        {loading ? (
          <div className="space-y-2" data-testid="tax-rules-loading">
            <Skeleton className="h-9 w-full rounded" />
            <Skeleton className="h-9 w-full rounded" />
            <Skeleton className="h-9 w-full rounded" />
          </div>
        ) : rules.length === 0 ? (
          <div data-testid="tax-rules-empty">
            <EmptyState
              title={t('shop.tax.rules.title')}
              description={t('shop.tax.rules.add')}
            />
          </div>
        ) : (
          <table
            className="w-full text-left t-body-sm"
            data-testid="tax-rules-table"
          >
            <thead className="text-[var(--text-muted)] t-caption uppercase tracking-wide">
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('shop.tax.rules.category')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium text-right">
                  {t('shop.tax.rules.rate')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('shop.tax.rules.compound')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('shop.tax.rules.applies_from')}
                </th>
                <th scope="col" className="py-2 font-medium text-right">
                  <span className="sr-only">{t('common.delete')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr
                  key={rule.id}
                  className="border-b border-[var(--border-subtle)] last:border-b-0"
                  data-testid={`tax-rule-row-${rule.id}`}
                >
                  <td className="py-2 pr-3 font-medium text-[var(--text)]">
                    {rule.product_category}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-right">
                    {(rule.rate * 100).toFixed(2)} %
                  </td>
                  <td className="py-2 pr-3">
                    {rule.compound ? (
                      <Badge intent="warning" fill="soft">
                        {t('shop.tax.rules.compound')}
                      </Badge>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[var(--text-muted)]">
                    {formatDate(rule.applies_from, locale)}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Trash2 size={14} />}
                      onClick={() => void handleDelete(rule)}
                      disabled={deletingId === rule.id}
                      isLoading={deletingId === rule.id}
                      aria-label={`${t('common.delete')} — ${rule.product_category}`}
                      data-testid={`tax-rule-btn-delete-${rule.id}`}
                    >
                      {t('common.delete')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
