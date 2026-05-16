// ── Settings — Région & devise — Sprint E-R M3.2 ────────────────────────────
// Configuration régionale de la boutique e-commerce : région fiscale, pays,
// devise par défaut, régime de taxes + indicateurs légaux (Loi 25 / RGPD /
// conso DZ — affichage informatif, l'application effective viendra en E6).
// Wirée GET/PUT /api/ecommerce/region (contrat M2 — helpers api.ts bloc E-R).
// Stripe SUBTLE, FR québécois, a11y focus-visible + aria. AutosaveIndicator.

import { useEffect, useState } from 'react';
import {
  Card, Button, Select, Switch, AutosaveIndicator, useToast, Icon, Skeleton,
  type AutosaveState,
} from '@/components/ui';
import {
  getEcommerceRegion, updateEcommerceRegion,
  type RegionConfig, type SupportedCurrency, type TaxRegime,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { Globe } from 'lucide-react';

// Région → métadonnées contextuelles (devise + régime + pays ISO suggérés).
const REGIONS: Array<{
  id: string;
  labelKey: string;
  currency: SupportedCurrency;
  regime: TaxRegime;
  countries: Array<{ code: string; label: string }>;
}> = [
  {
    id: 'QC',
    labelKey: 'shop.region.region_qc',
    currency: 'CAD',
    regime: 'qc',
    countries: [{ code: 'CA', label: 'Canada' }],
  },
  {
    id: 'EU',
    labelKey: 'shop.region.region_eu',
    currency: 'EUR',
    regime: 'eu',
    countries: [
      { code: 'FR', label: 'France' },
      { code: 'BE', label: 'Belgique' },
      { code: 'DE', label: 'Allemagne' },
      { code: 'ES', label: 'Espagne' },
      { code: 'IT', label: 'Italie' },
    ],
  },
  {
    id: 'DZ',
    labelKey: 'shop.region.region_dz',
    currency: 'DZD',
    regime: 'dz',
    countries: [{ code: 'DZ', label: 'Algérie' }],
  },
];

const CURRENCIES: SupportedCurrency[] = ['CAD', 'EUR', 'DZD'];

const TAX_REGIMES: Array<{ id: TaxRegime; labelKey: string }> = [
  { id: 'qc', labelKey: 'shop.region.regime_qc' },
  { id: 'eu', labelKey: 'shop.region.regime_eu' },
  { id: 'dz', labelKey: 'shop.region.regime_dz' },
  { id: 'exempt', labelKey: 'shop.region.regime_exempt' },
];

const DEFAULT_CONFIG: RegionConfig = {
  region: 'QC',
  country: 'CA',
  currency: 'CAD',
  tax_regime: 'qc',
  legal_flags: { loi25: true },
};

export function RegionSettings() {
  const { success, error: toastError } = useToast();
  const [config, setConfig] = useState<RegionConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [autosave, setAutosave] = useState<AutosaveState>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getEcommerceRegion()
      .then((r) => {
        if (cancelled || !r.data) return;
        setConfig({ ...DEFAULT_CONFIG, ...r.data, legal_flags: r.data.legal_flags || {} });
      })
      .catch(() => {
        if (!cancelled) toastError(t('shop.region.load_error'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeRegion = REGIONS.find((r) => r.id === config.region) || REGIONS[0];
  const countryOptions = activeRegion.countries;

  // Changer de région réaligne devise + régime + pays par défaut (l'admin peut
  // ensuite ajuster manuellement chaque champ).
  const handleRegionChange = (regionId: string) => {
    const r = REGIONS.find((x) => x.id === regionId) || REGIONS[0];
    setConfig((prev) => ({
      ...prev,
      region: r.id,
      currency: r.currency,
      tax_regime: r.regime,
      country: r.countries[0]?.code || prev.country,
    }));
  };

  const setFlag = (key: keyof RegionConfig['legal_flags'], val: boolean) => {
    setConfig((prev) => ({
      ...prev,
      legal_flags: { ...prev.legal_flags, [key]: val },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setAutosave('saving');
    try {
      const res = await updateEcommerceRegion(config);
      if (res.error || !res.data) throw new Error(res.error || 'Échec');
      setConfig({ ...DEFAULT_CONFIG, ...res.data, legal_flags: res.data.legal_flags || {} });
      setAutosave('saved');
      setLastSaved(new Date());
      success(t('shop.region.saved'));
    } catch {
      setAutosave('error');
      toastError(t('shop.region.save_error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="settings-card p-6 space-y-4">
          <Skeleton className="h-5 w-44 rounded" />
          <Skeleton className="h-3 w-2/3 rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
          <Skeleton className="h-9 w-40 rounded-md" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Globe} size={16} className="text-[var(--primary)]" />
              {t('shop.region.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('shop.region.subtitle')}
            </p>
          </div>
          <AutosaveIndicator state={autosave} lastSaved={lastSaved} />
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-5">
          {/* Région */}
          <div>
            <label htmlFor="region-region"
              className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              {t('shop.region.region')}
            </label>
            <Select
              id="region-region"
              value={config.region}
              onChange={(e: any) => handleRegionChange(e.target.value)}
              aria-label={t('shop.region.region')}
            >
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>{t(r.labelKey)}</option>
              ))}
            </Select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              {t('shop.region.region_hint')}
            </p>
          </div>

          {/* Pays */}
          <div>
            <label htmlFor="region-country"
              className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              {t('shop.region.country')}
            </label>
            <Select
              id="region-country"
              value={config.country}
              onChange={(e: any) => setConfig((p) => ({ ...p, country: e.target.value }))}
              aria-label={t('shop.region.country')}
            >
              {countryOptions.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </Select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              {t('shop.region.country_hint')}
            </p>
          </div>

          {/* Devise par défaut */}
          <div>
            <label htmlFor="region-currency"
              className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              {t('shop.region.currency')}
            </label>
            <Select
              id="region-currency"
              value={config.currency}
              onChange={(e: any) =>
                setConfig((p) => ({ ...p, currency: e.target.value as SupportedCurrency }))}
              aria-label={t('shop.region.currency')}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              {t('shop.region.currency_hint')}
            </p>
          </div>

          {/* Régime fiscal */}
          <div>
            <label htmlFor="region-regime"
              className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              {t('shop.region.tax_regime')}
            </label>
            <Select
              id="region-regime"
              value={config.tax_regime}
              onChange={(e: any) =>
                setConfig((p) => ({ ...p, tax_regime: e.target.value as TaxRegime }))}
              aria-label={t('shop.region.tax_regime')}
            >
              {TAX_REGIMES.map((r) => (
                <option key={r.id} value={r.id}>{t(r.labelKey)}</option>
              ))}
            </Select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              {t('shop.region.tax_regime_hint')}
            </p>
          </div>
        </div>

        {/* Obligations légales (affichage — impl effective E6) */}
        <div className="mt-6 pt-5 border-t border-[var(--border-subtle)]">
          <h4 className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t('shop.region.legal')}
          </h4>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 mb-3">
            {t('shop.region.legal_hint')}
          </p>
          <div className="flex flex-col gap-3">
            <Switch
              label={t('shop.region.flag_loi25')}
              checked={Boolean(config.legal_flags.loi25)}
              onCheckedChange={(v: boolean) => setFlag('loi25', v)}
            />
            <Switch
              label={t('shop.region.flag_rgpd')}
              checked={Boolean(config.legal_flags.rgpd)}
              onCheckedChange={(v: boolean) => setFlag('rgpd', v)}
            />
            <Switch
              label={t('shop.region.flag_dz_conso')}
              checked={Boolean(config.legal_flags.dz_conso)}
              onCheckedChange={(v: boolean) => setFlag('dz_conso', v)}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {t('shop.region.save')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
