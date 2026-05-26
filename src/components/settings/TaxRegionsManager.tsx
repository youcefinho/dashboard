// ── TaxRegionsManager — Sprint 39 (Agent B2) ────────────────────────────────
// CRUD UI sur les régions fiscales tenant (table tax_regions, seq134).
// Stripe-clean strict : Card + Modal + Switch + Tag soft tints, pas de gradient
// ni halo. Helpers async figés : listTaxRegions / createTaxRegion /
// updateTaxRegion / deleteTaxRegion (api.ts §Sprint 39 Tax regions).
// Imports RELATIFS uniquement (consigne B2). aria-labels via t() i18n.

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Globe } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import { Tag } from '../ui/Tag';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import {
  listTaxRegions,
  createTaxRegion,
  updateTaxRegion,
  deleteTaxRegion,
} from '../../lib/api';
import type {
  CreateTaxRegionInput,
  UpdateTaxRegionInput,
} from '../../lib/api';
import type { TaxRegion } from '../../lib/types';
import { t } from '../../lib/i18n';

// ── Constantes ──────────────────────────────────────────────────────────────

type TaxType = TaxRegion['type'];

const TAX_TYPES: TaxType[] = ['vat', 'gst_pst', 'sales_tax', 'tva_dz', 'exempt'];

const TYPE_LABELS: Record<TaxType, string> = {
  vat: 'TVA (UE)',
  gst_pst: 'TPS/TVQ (CA)',
  sales_tax: 'Sales tax (US)',
  tva_dz: 'TVA (DZ)',
  exempt: 'Exempt',
};

// Variants Tag mappés depuis le type fiscal (Stripe soft tints).
const TYPE_VARIANTS: Record<TaxType, 'brand' | 'info' | 'accent' | 'warning' | 'neutral'> = {
  vat: 'info',
  gst_pst: 'brand',
  sales_tax: 'accent',
  tva_dz: 'warning',
  exempt: 'neutral',
};

const PLACEHOLDER_RATES = JSON.stringify({ standard: 14.975, reduced: 5 }, null, 2);

// ── Composant ───────────────────────────────────────────────────────────────

export function TaxRegionsManager() {
  const { success, error: toastError } = useToast();

  const [regions, setRegions] = useState<TaxRegion[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formCountry, setFormCountry] = useState('CA');
  const [formSubdiv, setFormSubdiv] = useState('');
  const [formType, setFormType] = useState<TaxType>('gst_pst');
  const [formRatesJson, setFormRatesJson] = useState(PLACEHOLDER_RATES);
  const [formTaxInclusive, setFormTaxInclusive] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);

  // ── Load ──
  const loadRegions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTaxRegions();
      if (res.data) setRegions(res.data);
      else if (res.error) toastError(res.error);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void loadRegions();
  }, [loadRegions]);

  // ── Form helpers ──

  const resetForm = () => {
    setEditId(null);
    setFormCode('');
    setFormName('');
    setFormCountry('CA');
    setFormSubdiv('');
    setFormType('gst_pst');
    setFormRatesJson(PLACEHOLDER_RATES);
    setFormTaxInclusive(false);
    setRatesError(null);
  };

  const openCreate = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (region: TaxRegion) => {
    setEditId(region.id);
    setFormCode(region.code);
    setFormName(region.name);
    setFormCountry(region.country);
    setFormSubdiv(region.country_subdiv ?? '');
    setFormType(region.type);
    setFormRatesJson(JSON.stringify(region.rates_json ?? {}, null, 2));
    setFormTaxInclusive(region.tax_inclusive);
    setRatesError(null);
    setModalOpen(true);
  };

  // Validation JSON rates_json. Renvoie l'objet parsé si OK, null sinon (et set err).
  const validateRates = (raw: string): Record<string, number> | null => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setRatesError('JSON doit être un objet { catégorie: taux }');
        return null;
      }
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== 'number' || Number.isNaN(v)) {
          setRatesError(`Taux "${k}" doit être un nombre`);
          return null;
        }
      }
      setRatesError(null);
      return parsed as Record<string, number>;
    } catch {
      setRatesError('JSON invalide');
      return null;
    }
  };

  // Bouton submit désactivé tant que requis manquants OU JSON invalide.
  const isFormValid = (() => {
    if (!formCode.trim() || !formName.trim() || !formCountry.trim()) return false;
    try {
      const parsed = JSON.parse(formRatesJson);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      for (const v of Object.values(parsed)) {
        if (typeof v !== 'number' || Number.isNaN(v)) return false;
      }
      return true;
    } catch {
      return false;
    }
  })();

  // ── Submit ──

  const submit = async () => {
    const ratesParsed = validateRates(formRatesJson);
    if (!ratesParsed) return;
    if (!formCode.trim() || !formName.trim() || !formCountry.trim()) {
      toastError('Champs requis manquants');
      return;
    }

    setSaving(true);
    try {
      if (editId) {
        const payload: UpdateTaxRegionInput = {
          code: formCode.trim(),
          name: formName.trim(),
          country: formCountry.trim().toUpperCase(),
          country_subdiv: formSubdiv.trim() || null,
          type: formType,
          rates_json: ratesParsed,
          tax_inclusive: formTaxInclusive,
        };
        const res = await updateTaxRegion(editId, payload);
        if (res.error) {
          toastError(res.error);
          return;
        }
        success('Région fiscale mise à jour');
      } else {
        const payload: CreateTaxRegionInput = {
          code: formCode.trim(),
          name: formName.trim(),
          country: formCountry.trim().toUpperCase(),
          country_subdiv: formSubdiv.trim() || null,
          type: formType,
          rates_json: ratesParsed,
          tax_inclusive: formTaxInclusive,
        };
        const res = await createTaxRegion(payload);
        if (res.error) {
          toastError(res.error);
          return;
        }
        success('Région fiscale créée');
      }
      setModalOpen(false);
      resetForm();
      await loadRegions();
    } finally {
      setSaving(false);
    }
  };

  // ── Delete (soft) ──

  const remove = async (region: TaxRegion) => {
    if (typeof window !== 'undefined' && !window.confirm(`Supprimer la région ${region.name} ?`)) {
      return;
    }
    const res = await deleteTaxRegion(region.id);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success('Région fiscale supprimée');
    await loadRegions();
  };

  // ── Toggle active inline ──
  const toggleActive = async (region: TaxRegion) => {
    const res = await updateTaxRegion(region.id, { active: !region.active });
    if (res.error) {
      toastError(res.error);
      return;
    }
    await loadRegions();
  };

  // ── Render ──

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="text-lg font-semibold flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <Icon as={Globe} size={18} /> {t('shop.tax.regions.title')}
          </h2>
          <p
            className="text-sm mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            Régions fiscales tenant (TPS/TVQ, TVA, sales tax, etc.).
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="shrink-0"
          data-testid="tax-region-add"
          aria-label={t('shop.tax.regions.add')}
        >
          <Icon as={Plus} size={15} /> {t('shop.tax.regions.add')}
        </Button>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Chargement…
        </Card>
      ) : regions.length === 0 ? (
        <Card className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
          <p className="text-sm">Aucune région fiscale.</p>
          <Button
            onClick={openCreate}
            className="mt-3"
            data-testid="tax-region-empty-add"
          >
            <Icon as={Plus} size={15} /> {t('shop.tax.regions.add')}
          </Button>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="tax-region-list">
          {regions.map((r) => (
            <Card
              key={r.id}
              className="p-4"
              data-testid={`tax-region-card-${r.code}`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code
                      className="text-xs px-2 py-0.5 rounded font-mono"
                      style={{
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {r.code}
                    </code>
                    <span
                      className="font-medium text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {r.name}
                    </span>
                    <Tag variant={TYPE_VARIANTS[r.type]} size="sm">
                      {TYPE_LABELS[r.type]}
                    </Tag>
                    {r.tax_inclusive && (
                      <Tag variant="neutral" size="sm">
                        {t('shop.tax.regions.tax_inclusive')}
                      </Tag>
                    )}
                  </div>
                  <div
                    className="mt-1.5 text-xs flex items-center gap-2 flex-wrap"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span>
                      {t('shop.tax.regions.country')} : {r.country}
                      {r.country_subdiv ? ` · ${r.country_subdiv}` : ''}
                    </span>
                    <span>·</span>
                    <span>
                      {Object.entries(r.rates_json ?? {})
                        .map(([k, v]) => `${k}: ${v}%`)
                        .join(' · ') || '—'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Switch
                    checked={r.active}
                    onCheckedChange={() => void toggleActive(r)}
                    label={t('shop.tax.regions.active')}
                    size="sm"
                    data-testid={`tax-region-active-${r.code}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(r)}
                    data-testid={`tax-region-edit-${r.code}`}
                    aria-label={`${t('set.team.edit')} ${r.name}`}
                  >
                    <Icon as={Pencil} size={14} /> {t('set.team.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void remove(r)}
                    data-testid={`tax-region-delete-${r.code}`}
                    aria-label={`${t('common.delete')} ${r.name}`}
                  >
                    <Icon as={Trash2} size={14} /> {t('common.delete')}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Modal CRUD ── */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editId ? `${t('set.team.edit')} — ${formCode || formName}` : t('shop.tax.regions.add')}
        size="md"
      >
        <div className="space-y-4 p-1">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('shop.tax.regions.code')}
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              placeholder="QC-CA"
              required
              data-testid="tax-region-form-code"
              aria-label={t('shop.tax.regions.code')}
            />
            <Input
              label={t('shop.tax.regions.name')}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Québec"
              required
              data-testid="tax-region-form-name"
              aria-label={t('shop.tax.regions.name')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('shop.tax.regions.country')}
              value={formCountry}
              onChange={(e) => setFormCountry(e.target.value)}
              placeholder="CA"
              required
              data-testid="tax-region-form-country"
              aria-label={t('shop.tax.regions.country')}
            />
            <Input
              label={t('shop.tax.regions.subdiv')}
              value={formSubdiv}
              onChange={(e) => setFormSubdiv(e.target.value)}
              placeholder="QC"
              data-testid="tax-region-form-subdiv"
              aria-label={t('shop.tax.regions.subdiv')}
            />
          </div>

          <Select
            label={t('shop.tax.regions.type')}
            value={formType}
            onChange={(e) => setFormType(e.target.value as TaxType)}
            data-testid="tax-region-form-type"
            aria-label={t('shop.tax.regions.type')}
          >
            {TAX_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {TYPE_LABELS[tp]}
              </option>
            ))}
          </Select>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--text-primary)' }}
              htmlFor="tax-region-form-rates"
            >
              {t('shop.tax.regions.rates')}{' '}
              <span
                className="font-normal"
                style={{ color: 'var(--text-muted)' }}
              >
                (JSON)
              </span>
            </label>
            <Textarea
              id="tax-region-form-rates"
              value={formRatesJson}
              onChange={(e) => {
                setFormRatesJson(e.target.value);
                validateRates(e.target.value);
              }}
              rows={6}
              className="font-mono text-xs"
              data-testid="tax-region-form-rates"
              aria-label={t('shop.tax.regions.rates')}
              error={ratesError ?? undefined}
            />
            {ratesError ? (
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--danger)' }}
                data-testid="tax-region-form-rates-error"
              >
                {ratesError}
              </p>
            ) : (
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Exemple : <code>{'{ "standard": 14.975 }'}</code>
              </p>
            )}
          </div>

          <Switch
            checked={formTaxInclusive}
            onCheckedChange={setFormTaxInclusive}
            label={t('shop.tax.regions.tax_inclusive')}
            data-testid="tax-region-form-tax-inclusive"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setModalOpen(false)}
              data-testid="tax-region-form-cancel"
            >
              Annuler
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!isFormValid || saving}
              isLoading={saving}
              data-testid="tax-region-form-submit"
            >
              {editId ? t('set.team.edit') : t('shop.tax.regions.add')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
