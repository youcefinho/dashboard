// ── TaxRatesManager — Sprint 70 (Calculateur de Taxes) ───────────────────────
// CRUD UI sur les taux de taxes simplifiés par tenant (table tax_rates).
// Style Stripe-clean : Card + Modal + Switch + inputs numériques.
// Utilisé pour configurer TPS/TVQ/TVA de manière simplifiée.

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Globe } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Switch } from '../ui/Switch';
import { Tag } from '../ui/Tag';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import {
  listTaxRates,
  createTaxRate,
  updateTaxRate,
  deleteTaxRate,
} from '../../lib/api';
import type {
  CreateTaxRateInput,
  UpdateTaxRateInput,
} from '../../lib/api';
import type { TaxRate } from '../../lib/types';
import { t } from '../../lib/i18n';

export function TaxRatesManager() {
  const { success, error: toastError } = useToast();

  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal CRUD state
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields (les taux sont saisis en pourcentage ex: 5 pour 5%, stockés/envoyés sous forme décimale ex: 0.05)
  const [formCountry, setFormCountry] = useState('CA');
  const [formProvince, setFormProvince] = useState('');
  const [formRateTps, setFormRateTps] = useState('0');
  const [formRateTvq, setFormRateTvq] = useState('0');
  const [formRateTva, setFormRateTva] = useState('0');
  const [formIsActive, setFormIsActive] = useState(true);

  // ── Load ──
  const loadRates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTaxRates();
      if (res.data) setRates(res.data);
      else if (res.error) toastError(res.error);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  // ── Form helpers ──
  const resetForm = () => {
    setEditId(null);
    setFormCountry('CA');
    setFormProvince('');
    setFormRateTps('0');
    setFormRateTvq('0');
    setFormRateTva('0');
    setFormIsActive(true);
  };

  const openCreate = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (rate: TaxRate) => {
    setEditId(rate.id);
    setFormCountry(rate.country);
    setFormProvince(rate.state_province ?? '');
    setFormRateTps(String(rate.rate_tps * 100));
    setFormRateTvq(String(rate.rate_tvq * 100));
    setFormRateTva(String(rate.rate_tva * 100));
    setFormIsActive(rate.is_active === 1);
    setModalOpen(true);
  };

  const isFormValid = formCountry.trim().length === 2;

  // ── Submit ──
  const submit = async () => {
    if (!isFormValid) return;

    setSaving(true);
    try {
      const rateTpsDec = parseFloat(formRateTps) / 100 || 0;
      const rateTvqDec = parseFloat(formRateTvq) / 100 || 0;
      const rateTvaDec = parseFloat(formRateTva) / 100 || 0;

      if (editId) {
        const payload: UpdateTaxRateInput = {
          country: formCountry.trim().toUpperCase(),
          state_province: formProvince.trim().toUpperCase() || null,
          rate_tps: rateTpsDec,
          rate_tvq: rateTvqDec,
          rate_tva: rateTvaDec,
          is_active: formIsActive ? 1 : 0,
        };
        const res = await updateTaxRate(editId, payload);
        if (res.error) {
          toastError(res.error);
          return;
        }
        success('Taux de taxe mis à jour');
      } else {
        const payload: CreateTaxRateInput = {
          country: formCountry.trim().toUpperCase(),
          state_province: formProvince.trim().toUpperCase() || null,
          rate_tps: rateTpsDec,
          rate_tvq: rateTvqDec,
          rate_tva: rateTvaDec,
          is_active: formIsActive ? 1 : 0,
        };
        const res = await createTaxRate(payload);
        if (res.error) {
          toastError(res.error);
          return;
        }
        success('Taux de taxe créé avec succès');
      }
      setModalOpen(false);
      resetForm();
      await loadRates();
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──
  const remove = async (rate: TaxRate) => {
    const label = rate.state_province ? `${rate.country} (${rate.state_province})` : rate.country;
    if (typeof window !== 'undefined' && !window.confirm(`Supprimer le taux de taxe pour ${label} ?`)) {
      return;
    }
    const res = await deleteTaxRate(rate.id);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success('Taux de taxe supprimé');
    await loadRates();
  };

  // ── Toggle active inline ──
  const toggleActive = async (rate: TaxRate) => {
    const res = await updateTaxRate(rate.id, { is_active: rate.is_active === 1 ? 0 : 1 });
    if (res.error) {
      toastError(res.error);
      return;
    }
    await loadRates();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="text-lg font-semibold flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <Icon as={Globe} size={18} /> Configuration des taxes simplifiées
          </h2>
          <p
            className="text-sm mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            Gère ici les taux de taxes standards (TPS, TVQ ou TVA) applicables en fonction du pays et de la province.
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="shrink-0"
          data-testid="tax-rate-add"
        >
          <Icon as={Plus} size={15} /> Ajouter un taux
        </Button>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Chargement…
        </Card>
      ) : rates.length === 0 ? (
        <Card className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
          <p className="text-sm">Aucun taux de taxe simplifié configuré.</p>
          <Button
            onClick={openCreate}
            className="mt-3"
            data-testid="tax-rate-empty-add"
          >
            <Icon as={Plus} size={15} /> Configurer un taux
          </Button>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="tax-rate-list">
          {rates.map((r) => {
            const hasTps = r.rate_tps > 0;
            const hasTvq = r.rate_tvq > 0;
            const hasTva = r.rate_tva > 0;
            
            return (
              <Card
                key={r.id}
                className="p-4"
                data-testid={`tax-rate-card-${r.country}-${r.state_province || 'all'}`}
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
                        {r.country}
                        {r.state_province ? ` - ${r.state_province}` : ''}
                      </code>
                      <span
                        className="font-medium text-sm text-[var(--text-primary)]"
                      >
                        {r.state_province ? `Taxes pour ${r.state_province} (${r.country})` : `Taxes nationales (${r.country})`}
                      </span>
                      {r.is_active === 1 ? (
                        <Tag variant="success" size="sm">Actif</Tag>
                      ) : (
                        <Tag variant="neutral" size="sm">Inactif</Tag>
                      )}
                    </div>
                    <div
                      className="mt-1.5 text-xs flex items-center gap-2 flex-wrap"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {hasTps && (
                        <span>{r.country === 'CA' ? 'TPS/GST' : 'Taxe 1'} : {r.rate_tps * 100}%</span>
                      )}
                      {hasTvq && (
                        <>
                          <span>·</span>
                          <span>{r.country === 'CA' ? (r.state_province === 'QC' ? 'TVQ' : 'TVP/PST') : 'Taxe 2'} : {r.rate_tvq * 100}%</span>
                        </>
                      )}
                      {hasTva && (
                        <>
                          {r.rate_tps > 0 || r.rate_tvq > 0 ? <span>·</span> : null}
                          <span>TVA : {r.rate_tva * 100}%</span>
                        </>
                      )}
                      {!hasTps && !hasTvq && !hasTva && (
                        <span>Aucune taxe configurée (0%)</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Switch
                      checked={r.is_active === 1}
                      onCheckedChange={() => void toggleActive(r)}
                      label="Actif"
                      size="sm"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(r)}
                      data-testid={`tax-rate-edit-${r.id}`}
                    >
                      <Icon as={Pencil} size={14} /> {t('set.team.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void remove(r)}
                      data-testid={`tax-rate-delete-${r.id}`}
                    >
                      <Icon as={Trash2} size={14} /> {t('common.delete')}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Modal CRUD ── */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editId ? 'Modifier le taux de taxe' : 'Ajouter un taux de taxe'}
        size="md"
      >
        <div className="space-y-4 p-1">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Code Pays (2 lettres)"
              value={formCountry}
              onChange={(e) => setFormCountry(e.target.value.slice(0, 2))}
              placeholder="CA"
              required
              data-testid="tax-rate-form-country"
            />
            <Input
              label="Province / État (Optionnel)"
              value={formProvince}
              onChange={(e) => setFormProvince(e.target.value)}
              placeholder="QC"
              data-testid="tax-rate-form-province"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Taux TPS / GST (%)"
              type="number"
              step="any"
              value={formRateTps}
              onChange={(e) => setFormRateTps(e.target.value)}
              placeholder="5"
              data-testid="tax-rate-form-tps"
            />
            <Input
              label="Taux TVQ / PST (%)"
              type="number"
              step="any"
              value={formRateTvq}
              onChange={(e) => setFormRateTvq(e.target.value)}
              placeholder="9.975"
              data-testid="tax-rate-form-tvq"
            />
            <Input
              label="Taux TVA / VAT (%)"
              type="number"
              step="any"
              value={formRateTva}
              onChange={(e) => setFormRateTva(e.target.value)}
              placeholder="20"
              data-testid="tax-rate-form-tva"
            />
          </div>

          <Switch
            checked={formIsActive}
            onCheckedChange={setFormIsActive}
            label="Activer ce taux de taxe"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setModalOpen(false)}
            >
              Annuler
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!isFormValid || saving}
              isLoading={saving}
              data-testid="tax-rate-form-submit"
            >
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
